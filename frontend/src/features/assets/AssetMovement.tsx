import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Item } from "../items/types";
import { actionsFor, targetLabelFor } from "./actionRules";
import { statusLabel } from "../../lib/labels";
import { itemOptions, placeOptions, stockRoomOptions } from "../../lib/option-labels";
import { useCategoryLookups, usePlaceLookups } from "../../lib/lookups";
import { MAX_QUANTITY, quantityHint, quantityProblem } from "../../lib/limits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { useTableSort } from "@/components/shared/useTableSort";
import { ScanBarcode, ArrowUp, ArrowDown, ChevronsUpDown, Printer } from "lucide-react";
import { assetScanQuery, isAssetLink } from "../../lib/scan";
import { LabelPrintStyle, PrintNow, useLabelSettings, type LabelAsset } from "@/components/labels/AssetLabel";
import { LabelSettingsFields } from "@/components/labels/LabelSettingsFields";

// A person or place (backend: an asset user).
interface Option {
  id: number;
  code?: string | null;
  email?: string | null;
  name: string;
  asset_user_type?: string | null;
  company_id?: number | null;
  location_id?: number | null;
}

interface AssetSearchResult extends LabelAsset {
  status: string;
  current_asset_user_name: string | null;
  current_asset_user_location_name: string | null;
  current_asset_user_type: string | null;
}

interface QueuedAsset extends AssetSearchResult {
  eligible: boolean;
  /** The label has been printed (this session) / scanned back to confirm it was stuck on. */
  printed: boolean;
  confirmed: boolean;
}

const PREFS_KEY = "ckam.movement.prefs";
/** The most assets the server returns for one search. */
const PAGE_SIZE = 200;

function loadPrefs(): { autoPrint: boolean; verify: boolean } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as { autoPrint?: boolean; verify?: boolean } | null;
    return { autoPrint: raw?.autoPrint !== false, verify: raw?.verify === true };
  } catch {
    return { autoPrint: true, verify: false };
  }
}

interface BulkActionResult {
  done: number;
  failed: { asset_id: number; reason: string }[];
}

// AM-20: every lifecycle action the single-asset Asset 360 screen already
// offers (actionRules.ts), reused here as a flat list -- this screen isn't
// status-scoped like that one (a batch can mix assets starting in several
// different statuses), so eligibility is checked per scanned asset instead
// (via the same actionsFor() rule, not a duplicated one).
const BULK_ACTIONS: { eventType: string; label: string; needsAssetUser: boolean }[] = [
  { eventType: "MOVED", label: "Move / Allot / Transfer", needsAssetUser: true },
  { eventType: "SENT_FOR_REPAIR", label: "Send for Repair", needsAssetUser: false },
  { eventType: "RECEIVED_FROM_REPAIR", label: "Receive from Repair", needsAssetUser: true },
  { eventType: "LOST", label: "Report Lost", needsAssetUser: false },
  { eventType: "FOUND", label: "Mark Found", needsAssetUser: true },
  { eventType: "DISPOSED", label: "Dispose", needsAssetUser: false },
  { eventType: "SOLD", label: "Sell", needsAssetUser: false },
  { eventType: "SCRAPPED", label: "Scrap", needsAssetUser: false },
];

function isEligible(status: string, eventType: string): boolean {
  return actionsFor(status).some((a) => a.eventType === eventType);
}

// An operator scanning a batch should be able to tell at a glance that an
// asset is currently with a real person/store/install point, not sitting in
// a Stock Room -- moving it means pulling it out of someone's hands, worth a
// second look before it's bundled into a bulk action.
function isNotInStockRoom(assetUserType: string | null | undefined): boolean {
  return assetUserType != null && assetUserType !== "STOCK_POINT";
}

function notInStockRoomText(assetUserType: string | null | undefined): string {
  return assetUserType === "INSTALLED" ? "At an install point" : "With a person or at a store";
}

/** "With: Suraj (Head Office) · With Employee". */
function withLine(a: AssetSearchResult): string {
  return `With: ${a.current_asset_user_name ?? "—"} (${a.current_asset_user_location_name ?? "—"}) · ${statusLabel(a.status, a.current_asset_user_type)}`;
}

function NotInStockRoomBadge({ type }: { type: string | null | undefined }) {
  return (
    <Badge variant="outline" className="border-transparent bg-warning-soft text-on-warning-soft px-1.5 py-0 text-[10px] font-medium">
      {notInStockRoomText(type)}
    </Badge>
  );
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

export function AssetMovement() {
  const [eventType, setEventType] = useState(BULK_ACTIONS[0].eventType);
  const [toAssetUserId, setToAssetUserId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [qty, setQty] = useState("1");
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<AssetSearchResult[] | null>(null);
  const [queue, setQueue] = useState<QueuedAsset[]>([]);
  const [queueSearch, setQueueSearch] = useState("");
  const [currentlyWithId, setCurrentlyWithId] = useState("");
  const [browseSelected, setBrowseSelected] = useState<number[]>([]);

  const action = BULK_ACTIONS.find((a) => a.eventType === eventType)!;

  // Labels: print each asset's label as it is scanned (the label that comes out is for the asset
  // in hand), optionally scan it back to confirm it was stuck on the right asset.
  const labelSettings = useLabelSettings();
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // best effort
    }
  }, [prefs]);
  const [printing, setPrinting] = useState<QueuedAsset[] | null>(null);
  // Add by Item: assets with no serial to scan ("7 mouse")
  const [itemId, setItemId] = useState("");
  const [fromId, setFromId] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemError, setItemError] = useState<string | null>(null);
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  // Moving to a store is the case that labels are for.
  const labelsOn = eventType === "MOVED";

  function printLabels(assets: QueuedAsset[]) {
    if (assets.length > 0) setPrinting(assets);
  }
  function markPrinted(ids: number[]) {
    setQueue((q) => q.map((a) => (ids.includes(a.id) ? { ...a, printed: true } : a)));
    setPrinting(null);
  }
  // The one way assets get onto the queue: skips what is already there, checks eligibility,
  // and prints the new ones' labels when that is switched on.
  function enqueue(assets: AssetSearchResult[], onlyEligible = false): QueuedAsset[] {
    const have = new Set(queue.map((a) => a.id));
    const fresh = assets
      .filter((a) => !have.has(a.id))
      .map((a) => ({ ...a, eligible: isEligible(a.status, eventType), printed: false, confirmed: false }))
      .filter((a) => !onlyEligible || a.eligible);
    if (fresh.length > 0) {
      setQueue((q) => [...q, ...fresh]);
      if (labelsOn && prefs.autoPrint) printLabels(fresh.filter((a) => a.eligible));
    }
    return fresh;
  }

  const asset_usersQ = useQuery({ queryKey: ["asset_users"], queryFn: () => apiClient.get<Option[]>("/asset-users") });
  const asset_users = asset_usersQ.data ?? [];
  // Dropdown context: people/places show their place (and company when the
  // list spans companies); Items show their Category.
  const placeLookups = usePlaceLookups();
  const categoryLookups = useCategoryLookups();
  const peopleAndPlaces = placeOptions(asset_users, placeLookups);

  // "Currently With" browse: everything a specific person/store/point holds
  // right now, so an operator who knows WHO has something (but not its
  // serial/code) can find and select it instead of needing to already know
  // a search term -- the same /api/assets list the Asset Register's own
  // Asset User filter already uses, just capped at the endpoint's own
  // max limit (200) since this is a browse-and-pick list, not a register.
  const browseQ = useQuery({
    queryKey: ["assets", "movement-browse", currentlyWithId],
    queryFn: () => apiClient.get<{ items: AssetSearchResult[]; total: number }>(`/assets?asset_user_id=${currentlyWithId}&limit=200`),
    enabled: currentlyWithId !== "",
  });
  const browseItems = browseQ.data?.items ?? [];
  const browseTotal = browseQ.data?.total ?? 0;

  function handleCurrentlyWithChange(v: string) {
    setCurrentlyWithId(v);
    setBrowseSelected([]);
  }

  function toggleBrowseOne(id: number, checked: boolean) {
    setBrowseSelected((s) => (checked ? [...s, id] : s.filter((x) => x !== id)));
  }

  function toggleBrowseAll(checked: boolean) {
    setBrowseSelected(checked ? browseItems.map((a) => a.id) : []);
  }

  function addSelectedToQueue() {
    enqueue(browseItems.filter((a) => browseSelected.includes(a.id)));
    setBrowseSelected([]);
  }

  function addToQueue(asset: AssetSearchResult) {
    if (queue.some((existing) => existing.id === asset.id)) {
      setScanError(`${asset.asset_code} is already in this batch.`);       // a repeat scan is ignored, and said so
      setScanValue("");
      setCandidates(null);
      return;
    }
    enqueue([asset]);
    setScanValue("");
    setScanError(null);
    setCandidates(null);
  }

  // Add by Item: the sender's own stock of that Item, one label each.
  const byItemMutation = useMutation({
    mutationFn: async (v: { itemId: string; fromId: string; count: number }) => {
      // The server returns at most 200 assets a request, so a bigger count is read page by page
      // (enough to cover the count plus whatever is already in this batch).
      const base = `/assets?item_id=${v.itemId}&asset_user_id=${v.fromId}&status=IN_STOCK&limit=${PAGE_SIZE}`;
      const wanted = v.count + queue.length;
      let page = await apiClient.get<{ items: AssetSearchResult[]; total: number }>(base);
      const items = [...page.items];
      while (items.length < wanted && page.items.length > 0 && items.length < page.total) {
        page = await apiClient.get<{ items: AssetSearchResult[]; total: number }>(`${base}&offset=${items.length}`);
        items.push(...page.items);
      }
      return { items, total: page.total };
    },
    onSuccess: (result, v) => {
      const have = new Set(queue.map((a) => a.id));
      const free = result.items.filter((a) => !have.has(a.id));
      if (free.length < v.count) {
        setItemError(`Only ${free.length} of that Item ${free.length === 1 ? "is" : "are"} in stock there${have.size ? " (not counting the ones already in this batch)" : ""}.`);
        return;
      }
      setItemError(null);
      setBulkSummary(null);
      enqueue(free.slice(0, v.count));
    },
    onError: () => setItemError("Search failed -- try again."),
  });

  function removeFromQueue(id: number) {
    setQueue((q) => q.filter((a) => a.id !== id));
  }

  interface SearchVars {
    value: string;
    requestedQty: number;
    status?: string;
  }

  const searchMutation = useMutation({
    mutationFn: (vars: SearchVars) => {
      // A requested Qty > 1 means "find me up to that many matches" (e.g.
      // typing a shared description/barcode for a batch of identical,
      // serial-less items) -- the ordinary single-scan case still only
      // ever needs enough to detect "more than one match", hence 5.
      const fetchLimit = vars.requestedQty > 1 ? Math.min(Math.max(vars.requestedQty, 5), PAGE_SIZE) : 5;
      const statusParam = vars.status ? `&status=${vars.status}` : "";
      type Found = { items: AssetSearchResult[]; total: number };
      // The QR on an asset label is a link to the asset: look that one asset up directly.
      if (isAssetLink(vars.value)) {
        return apiClient.get<Found>(`/assets?${assetScanQuery(vars.value)}`);
      }
      const search = async (): Promise<Found> => {
        // A single scan lands on exactly one asset when it is a whole serial / asset code / barcode
        if (vars.requestedQty <= 1) {
          const exact = await apiClient.get<Found>(`/assets?q=${encodeURIComponent(vars.value)}&exact=true&limit=5${statusParam}`);
          if (exact.items.length > 0) return exact;
        }
        return apiClient.get<Found>(`/assets?q=${encodeURIComponent(vars.value)}&limit=${fetchLimit}${statusParam}`);
      };
      return search();
    },
    onSuccess: (result, vars) => {
      if (vars.requestedQty > 1) {
        if (result.items.length === 0) {
          setScanError(`No asset found matching "${vars.value}".`);
          setBulkSummary(null);
          return;
        }
        // Never re-add something already queued from an earlier scan --
        // dedup BEFORE capping to the requested Qty, so a partial overlap
        // with the existing queue never silently shrinks how many genuinely
        // new assets get added.
        const queuedIds = new Set(queue.map((a) => a.id));
        const eligibleNew = result.items.filter((a) => isEligible(a.status, eventType) && !queuedIds.has(a.id));
        const toAdd = eligibleNew.slice(0, vars.requestedQty);
        enqueue(toAdd);
        setBulkSummary(
          toAdd.length < vars.requestedQty
            ? `Added ${toAdd.length} of ${vars.requestedQty} requested -- only ${toAdd.length} eligible match${toAdd.length === 1 ? "" : "es"} found for "${vars.value}".`
            : `Added ${toAdd.length} of ${vars.requestedQty} requested.`,
        );
        setScanValue("");
        setScanError(null);
        setCandidates(null);
        return;
      }

      setBulkSummary(null);
      if (result.items.length === 0) {
        setScanError(`No asset found matching "${vars.value}".`);
        setCandidates(null);
        return;
      }
      if (result.items.length === 1) {
        addToQueue(result.items[0]);
        return;
      }
      // More than one match (a partial scan/typed fragment) -- let the
      // operator pick which one, rather than guessing.
      setScanError(null);
      setCandidates(result.items);
    },
    onError: () => setScanError("Search failed -- try again."),
  });

  const qtyProblem = quantityProblem(qty);
  const itemQtyProblem = quantityProblem(itemQty);

  function handleScanSubmit() {
    const value = scanValue.trim();
    if (!value || qtyProblem) return;
    // Confirming a label that was stuck on: scanning the label itself ticks it off.
    if (prefs.verify) {
      const match = queue.find((a) => a.printed && !a.confirmed && a.asset_code.toLowerCase() === value.toLowerCase());
      if (match) {
        setQueue((q) => q.map((a) => (a.id === match.id ? { ...a, confirmed: true } : a)));
        setScanValue("");
        setScanError(null);
        return;
      }
    }
    setCandidates(null);
    setBulkSummary(null);
    searchMutation.mutate({
      value,
      requestedQty: Number(qty),
      status: onlyInStock ? "IN_STOCK" : undefined,
    });
  }

  // Re-checks every already-queued asset's eligibility whenever the chosen
  // action changes, instead of leaving a stale eligible/ineligible flag from
  // a different action on screen.
  function handleActionChange(next: string) {
    setEventType(next);
    setQueue((q) => q.map((a) => ({ ...a, eligible: isEligible(a.status, next) })));
  }

  // Apply always acts on the FULL queue's eligible assets, never the
  // filtered/sorted view below -- searching/sorting the queue only changes
  // what's displayed while scanning, never what gets submitted.
  const eligibleQueue = queue.filter((a) => a.eligible);

  const queueSearchLower = queueSearch.trim().toLowerCase();
  const filteredQueue = queueSearchLower
    ? queue.filter((a) =>
        [a.asset_code, a.description, a.current_asset_user_name, statusLabel(a.status, a.current_asset_user_type)]
          .some((v) => (v ?? "").toLowerCase().includes(queueSearchLower)),
      )
    : queue;
  const { sortedRows: sortedQueue, sort: queueSort, toggleSort: toggleQueueSort } = useTableSort<QueuedAsset>(filteredQueue, {
    asset_code: (a) => a.asset_code,
    description: (a) => a.description,
    asset_user: (a) => a.current_asset_user_name,
    status: (a) => statusLabel(a.status, a.current_asset_user_type),
  });

  function QueueSortButton({ label, sortKey }: { label: string; sortKey: string }) {
    const Icon = queueSort?.key !== sortKey ? ChevronsUpDown : queueSort.direction === "asc" ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => toggleQueueSort(sortKey)}
        aria-label={`Sort queue by ${label}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${queueSort?.key === sortKey ? "" : "opacity-40"}`} aria-hidden="true" />
      </button>
    );
  }
  const unprinted = eligibleQueue.filter((a) => !a.printed);
  const unconfirmed = prefs.verify && labelsOn ? eligibleQueue.filter((a) => !a.confirmed).length : 0;
  const tooManyToApply = eligibleQueue.length > MAX_QUANTITY;
  const canApply =
    eligibleQueue.length > 0 &&
    !tooManyToApply &&
    (!action.needsAssetUser || toAssetUserId !== "") &&
    unconfirmed === 0;

  const applyMutation = useMutation({
    mutationFn: () =>
      apiClient.post<BulkActionResult>("/assets/bulk-action", {
        asset_ids: eligibleQueue.map((a) => a.id),
        event_type: eventType,
        to_asset_user_id: action.needsAssetUser ? Number(toAssetUserId) : null,
        remarks: remarks || null,
      }),
    onSuccess: (result) => {
      const failedIds = new Set(result.failed.map((f) => f.asset_id));
      // Successful ones fall off the queue; a failure stays, so the operator
      // can see exactly which ones still need attention and why.
      setQueue((q) => q.filter((a) => failedIds.has(a.id)));
    },
  });

  function resetAfterApply() {
    applyMutation.reset();
    setQueue([]);
    setRemarks("");
    setToAssetUserId("");
    setCurrentlyWithId("");
    setBrowseSelected([]);
  }

  return (
    <div className="flex flex-col gap-4">
      <LabelPrintStyle widthMm={labelSettings.widthMm} heightMm={labelSettings.heightMm} />
      {printing && (
        <PrintNow
          assets={printing} symbol={labelSettings.symbol} widthMm={labelSettings.widthMm} heightMm={labelSettings.heightMm}
          onPrinted={() => markPrinted(printing.map((a) => a.id))}
        />
      )}

      <PageHeader
        title="Move Assets"
        description="Move or dispatch assets in one batch: scan or type a Serial Number/Asset Code to queue them, then apply one action to the whole batch. For a move to a store, each asset's label prints as you scan it, so the label is for the asset in your hand."
        actions={<Button asChild variant="outline"><Link to="/print-labels">Print Labels</Link></Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="movement-action" label="Action" required>
          <Select value={eventType} onValueChange={handleActionChange}>
            <SelectTrigger id="movement-action" aria-label="Action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BULK_ACTIONS.map((a) => (
                <SelectItem key={a.eventType} value={a.eventType}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {action.needsAssetUser && (
          <FormField htmlFor="movement-asset-user" label={targetLabelFor(eventType)} required>
            <SearchableSelect
              id="movement-asset-user"
              aria-label={targetLabelFor(eventType)}
              value={selectValue(toAssetUserId)}
              onValueChange={setToAssetUserId}
              options={peopleAndPlaces}
              placeholder="Pick an employee, store or stock room…"
              searchPlaceholder="Search by name or code…"
            />
          </FormField>
        )}
      </div>

      <FormField htmlFor="movement-remarks" label="Remarks" helperText="Optional. Applied to every asset in this batch.">
        <Textarea id="movement-remarks" aria-label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          aria-label="Only assets currently in stock"
          checked={onlyInStock}
          onCheckedChange={(checked) => setOnlyInStock(checked === true)}
        />
        Only assets currently in stock
      </label>

      {labelsOn && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <h2 className="text-sm font-semibold">Labels</h2>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2">
              <Checkbox
                aria-label="Print the label as I scan"
                checked={prefs.autoPrint} onCheckedChange={(c) => setPrefs((p) => ({ ...p, autoPrint: c === true }))}
              />
              Print the label as I scan
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                aria-label="Confirm each label by scanning it"
                checked={prefs.verify} onCheckedChange={(c) => setPrefs((p) => ({ ...p, verify: c === true }))}
              />
              Confirm each label by scanning it after sticking it on
            </label>
          </div>
          <LabelSettingsFields settings={labelSettings} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <FormField
          htmlFor="movement-scan"
          label="Scan or type Serial Number, Asset Code, or Description"
          helperText="Press Enter after each one -- a barcode scanner does this automatically."
        >
          <div className="flex gap-2">
            <Input
              id="movement-scan" aria-label="Scan or type Serial Number, Asset Code, or Description" value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScanSubmit();
                }
              }}
              autoFocus
            />
            <Button type="button" variant="outline" onClick={handleScanSubmit} disabled={searchMutation.isPending || qtyProblem !== null}>
              <ScanBarcode className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </div>
        </FormField>
        <FormField
          htmlFor="movement-qty"
          label="Qty"
          helperText={`For a batch of identical, serial-less items (keyboards, cables…): search by description/barcode above, and this many eligible matches get queued in one go. ${quantityHint()}`}
          errorText={qtyProblem ?? undefined}
        >
          <Input
            id="movement-qty" aria-label="Qty" type="number" min={1} max={MAX_QUANTITY} step={1} value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-20"
          />
        </FormField>
      </div>
      {scanError && <p className="text-sm text-destructive" role="alert">{scanError}</p>}
      {bulkSummary && <p className="text-sm text-muted-foreground" role="status">{bulkSummary}</p>}
      {candidates && (
        <div className="rounded-md border p-2">
          <p className="mb-1 text-xs text-muted-foreground">More than one match -- pick the right one:</p>
          <ul className="flex flex-col gap-1">
            {candidates.map((a) => (
              <li key={a.id}>
                <Button type="button" variant="ghost" size="sm" className="w-full flex-col items-start" onClick={() => addToQueue(a)}>
                  <span className="flex items-center gap-1.5">
                    {a.asset_code} — {a.description} ({a.serial_number ?? "no serial"})
                    {isNotInStockRoom(a.current_asset_user_type) && <NotInStockRoomBadge type={a.current_asset_user_type} />}
                  </span>
                  <span className="text-xs text-muted-foreground">{withLine(a)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border p-3">
        <h2 className="mb-1 text-sm font-semibold">No serial to scan? Add by Item</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          For things such as mice and keyboards with no serial: choose the Item, where it is now and how many, and CKAM picks that many
          from that stock{labelsOn ? ", with one label each" : ""}.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField htmlFor="movement-item" label="Item">
            <SearchableSelect
              id="movement-item" aria-label="Item" value={selectValue(itemId)} onValueChange={setItemId}
              options={itemOptions(itemsQ.data, categoryLookups)} placeholder="Choose the Item"
            />
          </FormField>
          <FormField htmlFor="movement-from" label="Currently in stock at">
            <SearchableSelect
              id="movement-from" aria-label="Currently in stock at" value={selectValue(fromId)} onValueChange={setFromId}
              options={stockRoomOptions(asset_users.filter((u) => u.asset_user_type === "STOCK_POINT"), placeLookups)}
              placeholder="Choose the Stock Room"
            />
          </FormField>
          <FormField htmlFor="movement-item-qty" label="How many" helperText={quantityHint()} errorText={itemQtyProblem ?? undefined}>
            <Input id="movement-item-qty" aria-label="How many" type="number" min={1} max={MAX_QUANTITY} step={1} value={itemQty} onChange={(e) => setItemQty(e.target.value)} />
          </FormField>
          <div className="flex items-end">
            <Button
              type="button" variant="outline"
              disabled={!itemId || !fromId || itemQtyProblem !== null || byItemMutation.isPending}
              onClick={() => byItemMutation.mutate({ itemId, fromId, count: Math.floor(Number(itemQty)) })}
            >
              Add {itemQtyProblem === null ? Math.floor(Number(itemQty)) : ""} to this batch
            </Button>
          </div>
        </div>
        {itemError && <p className="mt-2 text-sm text-destructive" role="alert">{itemError}</p>}
      </div>

      <FormField
        htmlFor="movement-currently-with"
        label="Currently With"
        helperText="Browse everything that is with a specific person, store or stock room right now, then select what to move -- for when you know WHO has something but not its serial or code."
      >
        <SearchableSelect
          id="movement-currently-with"
          aria-label="Currently With"
          value={selectValue(currentlyWithId)}
          onValueChange={handleCurrentlyWithChange}
          options={peopleAndPlaces}
          placeholder="Pick an employee, store or stock room…"
          searchPlaceholder="Search by name or code…"
        />
      </FormField>

      {currentlyWithId !== "" && (
        <div className="rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Assets with {asset_users.find((h) => String(h.id) === currentlyWithId)?.name ?? "…"} ({browseTotal})
            </h2>
            <Button type="button" size="sm" onClick={addSelectedToQueue} disabled={browseSelected.length === 0}>
              Add {browseSelected.length > 0 ? browseSelected.length : ""} Selected to Queue
            </Button>
          </div>
          {browseTotal > browseItems.length && (
            <p className="mb-2 text-xs text-muted-foreground">
              Showing the first {browseItems.length} of {browseTotal}.
            </p>
          )}
          {browseQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : browseItems.length === 0 ? (
            <EmptyState title="Nothing here." description="No assets are with this person, store or stock room right now." />
          ) : (
            <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
              <li className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                <Checkbox
                  aria-label="Select all"
                  checked={browseItems.length > 0 && browseItems.every((a) => browseSelected.includes(a.id))}
                  onCheckedChange={(checked) => toggleBrowseAll(checked === true)}
                />
                Select all
              </li>
              {browseItems.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-sm border bg-muted/40 px-2 py-1.5 text-sm">
                  <Checkbox
                    aria-label={`Select ${a.asset_code}`}
                    checked={browseSelected.includes(a.id)}
                    onCheckedChange={(checked) => toggleBrowseOne(a.id, checked === true)}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{a.asset_code} — {a.description}</span>
                    <span className="text-xs text-muted-foreground">
                      Serial: {a.serial_number ?? "—"} · {statusLabel(a.status, a.current_asset_user_type)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-md border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Queued ({queue.length}){eligibleQueue.length !== queue.length && ` — ${eligibleQueue.length} eligible`}
          </h2>
          {labelsOn && unprinted.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => printLabels(unprinted)}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print {unprinted.length} label{unprinted.length === 1 ? "" : "s"} not printed yet
            </Button>
          )}
          {queue.length > 1 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Sort:</span>
              <QueueSortButton label="Code" sortKey="asset_code" />
              <QueueSortButton label="Description" sortKey="description" />
              <QueueSortButton label="With" sortKey="asset_user" />
              <QueueSortButton label="Status" sortKey="status" />
            </div>
          )}
        </div>
        {queue.length > 1 && (
          <Input
            aria-label="Search queued assets"
            placeholder="Search queued assets…"
            value={queueSearch}
            onChange={(e) => setQueueSearch(e.target.value)}
            className="mb-2 max-w-sm"
          />
        )}
        {queue.length === 0 ? (
          <EmptyState title="Nothing scanned yet." description="Scan or type a Serial Number/Asset Code above to add assets here." />
        ) : sortedQueue.length === 0 ? (
          <EmptyState title="No matches" description="Try a different search." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sortedQueue.map((a) => {
              const notInStock = isNotInStockRoom(a.current_asset_user_type);
              return (
              <li
                key={a.id}
                className={`flex items-center justify-between gap-2 rounded-sm border px-2 py-1.5 text-sm ${
                  !a.eligible
                    ? "border-destructive/50 bg-destructive/5"
                    : notInStock
                      ? "border-warning/50 bg-warning-soft"
                      : "bg-muted/40"
                }`}
              >
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5 font-medium">
                    {a.asset_code} — {a.item_name ?? a.description} ({a.serial_pending ? "serial to be added" : a.serial_number ?? "no serial"})
                    {notInStock && <NotInStockRoomBadge type={a.current_asset_user_type} />}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {withLine(a)}
                    {!a.eligible && ` · not eligible for "${action.label}" from this status`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {labelsOn && a.eligible && (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {a.confirmed ? "Confirmed" : a.printed ? (prefs.verify ? "Printed: scan the label" : "Printed") : "Label not printed"}
                      </span>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Print label for ${a.asset_code}`} onClick={() => printLabels([a])}>
                        {a.printed ? "Reprint" : "Print"}
                      </Button>
                    </>
                  )}
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${a.asset_code}`} onClick={() => removeFromQueue(a.id)}>
                    Remove
                  </Button>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      {tooManyToApply && (
        <p className="text-sm text-destructive" role="alert">
          You can move at most {MAX_QUANTITY.toLocaleString("en-IN")} assets at a time. Remove {eligibleQueue.length - MAX_QUANTITY} from the batch, then apply, and do the rest in a second batch.
        </p>
      )}
      {unconfirmed > 0 && <p className="text-xs text-muted-foreground">{unconfirmed} label{unconfirmed === 1 ? " is" : "s are"} not confirmed yet.</p>}
      {applyMutation.isSuccess && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p>
            <span className="font-semibold tabular-nums" data-testid="bulk-action-done-count">{applyMutation.data.done}</span> asset(s) updated.
          </p>
          {applyMutation.data.failed.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-destructive">
              {applyMutation.data.failed.map((f) => (
                <li key={f.asset_id}>Asset #{f.asset_id}: {f.reason}</li>
              ))}
            </ul>
          )}
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={resetAfterApply}>
            Start a new batch
          </Button>
        </div>
      )}
      {applyMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {applyMutation.error instanceof Error ? applyMutation.error.message : "Failed to apply the action."}
        </p>
      )}

      <div>
        <AsyncButton onClick={() => applyMutation.mutate()} disabled={!canApply} pending={applyMutation.isPending} pendingLabel="Applying…">
          Apply "{action.label}" to {eligibleQueue.length} asset{eligibleQueue.length === 1 ? "" : "s"}
        </AsyncButton>
      </div>
    </div>
  );
}
