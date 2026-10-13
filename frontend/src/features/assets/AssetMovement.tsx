import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Item } from "../items/types";
import { choiceAvailability, isChoiceAllowed, moveChoice, type MoveChoice } from "./actionRules";
import { placeTypeLabel, statusLabel } from "../../lib/labels";
import { itemOptions, placeOptions, type Option as PickerOption } from "../../lib/option-labels";
import { useCategoryLookups, usePlaceLookups } from "../../lib/lookups";
import { useCanCreate } from "../../lib/capabilities";
import { cn } from "@/lib/utils";
import { NewStockRoomDialog } from "@/components/quick-create/masters";
import { stockRoomPickerOptions, useStockRooms } from "@/components/quick-create/StockRoomSelect";
import { MAX_QUANTITY, quantityHint, quantityProblem } from "../../lib/limits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { useTableSort } from "@/components/shared/useTableSort";
import { ScanBarcode, ArrowUp, ArrowDown, ChevronsUpDown, ChevronDown, ChevronRight, Printer } from "lucide-react";
import { assetScanQuery, isAssetLink } from "../../lib/scan";
import { PrintNow, useLabelSettings, type LabelAsset } from "@/components/labels/AssetLabel";
import { LabelSettingsDisclosure } from "../labels/LabelSettingsDisclosure";
import { useScanLabelPrefs } from "../labels/useScanLabelPrefs";
import { PrintLabelsAction, fetchAssetsByIds, labelsWord, parseIdList } from "../labels/PrintLabelsAction";

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
  /** The label has been printed (this session) / scanned back to confirm it was stuck on. */
  printed: boolean;
  confirmed: boolean;
}

/** The most assets the server returns for one search. */
const PAGE_SIZE = 200;

interface BulkActionResult {
  done: number;
  failed: { asset_id: number; reason: string }[];
}

interface ApplyOutcome extends BulkActionResult {
  choice: MoveChoice;
  /** The assets that were sent, so the result can name failures and print labels. */
  sent: QueuedAsset[];
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// An operator scanning a batch should be able to tell at a glance that an
// asset is currently with a real person/store/install point, not sitting in
// a Stock Room -- moving it means pulling it out of someone's hands, worth a
// second look before it's bundled into a batch.
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

function assetsWord(n: number): string {
  return `${n} asset${n === 1 ? "" : "s"}`;
}

/** The choices in four small groups: moving, repair, lost/found, leaving CKAM. */
const CHOICE_GROUPS: string[][] = [
  ["employee", "stock-room", "store", "install"],
  ["repair", "from-repair"],
  ["lost", "found"],
  ["sell", "scrap", "dispose"],
];

interface AssetMovementProps {
  /** Asset ids to start the batch with (`?ids=1,2,3` from Assets or Asset 360). */
  preloadIds?: string;
  /** The choice to start with (`?choice=store`), see MOVE_CHOICES. */
  initialChoice?: string;
}

/**
 * Move: the one place an asset changes hands or status. Pick what to do in plain words
 * (Give to Employee, Send to Store, Send for Repair, ...), add the assets (scan, search,
 * by Item and quantity, or from whoever has them now), then apply once. Only choices the
 * server would accept for every queued asset are offered (actionRules.ts, the same rule
 * Asset 360 uses); the server re-checks each one.
 */
export function AssetMovement({ preloadIds, initialChoice }: AssetMovementProps = {}) {
  const isAdmin = useAuthStore((s) => s.role) === "ADMIN";
  const [choiceKey, setChoiceKey] = useState<string | null>(moveChoice(initialChoice)?.key ?? null);
  const [toAssetUserId, setToAssetUserId] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [eventDate, setEventDate] = useState(todayIso);
  const [referenceNo, setReferenceNo] = useState("");
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
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const choice = moveChoice(choiceKey);
  const eligibleFor = (a: { status: string }) => !choice || isChoiceAllowed(choice, a.status);

  /** The scan box gets the cursor back after every add, so a scanner can keep going. */
  function focusScan() {
    // after React has re-rendered (a just-closed pick list may have held the focus)
    setTimeout(() => scanRef.current?.focus(), 0);
  }

  // Labels: for a move to a store, each asset's label prints as it is scanned (the label
  // that comes out is for the asset in hand); optionally each is scanned back to confirm.
  const labelSettings = useLabelSettings();
  const scanPrefs = useScanLabelPrefs();
  const labelsOn = choice?.destination === "STORE";
  const [printing, setPrinting] = useState<QueuedAsset[] | null>(null);
  // Add by Item: assets with no serial to scan ("7 mouse")
  const [itemId, setItemId] = useState("");
  const [fromId, setFromId] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemError, setItemError] = useState<string | null>(null);
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });

  function printLabels(assets: QueuedAsset[]) {
    if (assets.length > 0) setPrinting(assets);
  }
  function markPrinted(ids: number[]) {
    setQueue((q) => q.map((a) => (ids.includes(a.id) ? { ...a, printed: true } : a)));
    setPrinting(null);
  }
  // The one way assets get onto the queue: skips what is already there, and prints the
  // new ones' labels when that is switched on (not for a batch handed over from another
  // screen: nothing was scanned, so nothing is in hand yet).
  function enqueue(assets: AssetSearchResult[], opts: { autoPrint?: boolean } = {}): QueuedAsset[] {
    const have = new Set(queue.map((a) => a.id));
    const fresh = assets.filter((a) => !have.has(a.id)).map((a) => ({ ...a, printed: false, confirmed: false }));
    if (fresh.length > 0) {
      setQueue((q) => [...q, ...fresh]);
      setOutcome(null);
      if (labelsOn && scanPrefs.autoPrint && opts.autoPrint !== false) printLabels(fresh.filter(eligibleFor));
    }
    focusScan();
    return fresh;
  }

  // A batch handed over from Assets or Asset 360 (?ids=...).
  const preloadQ = useQuery({
    queryKey: ["assets", "move-preload", preloadIds],
    queryFn: () => fetchAssetsByIds<AssetSearchResult>(parseIdList(preloadIds)),
    enabled: !!preloadIds && parseIdList(preloadIds).length > 0,
  });
  const preloadedRef = useRef(false);
  useEffect(() => {
    if (!preloadQ.data || preloadedRef.current) return;
    preloadedRef.current = true;
    enqueue(preloadQ.data, { autoPrint: false });
    // enqueue reads the current queue; this runs once, when the batch arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadQ.data]);

  const asset_usersQ = useQuery({ queryKey: ["asset_users"], queryFn: () => apiClient.get<Option[]>("/asset-users") });
  const asset_users = useMemo(() => (Array.isArray(asset_usersQ.data) ? asset_usersQ.data : []), [asset_usersQ.data]);
  // Dropdown context: people/places show their place (and company when the
  // list spans companies); Items show their Category.
  const placeLookups = usePlaceLookups();
  const categoryLookups = useCategoryLookups();
  const peopleAndPlaces = placeOptions(asset_users, placeLookups);
  // The destination list shows only the kind the choice sends to; "Receive from Repair"
  // can go back to anyone, so there each entry also says what it is.
  const destinationOptions: PickerOption[] = useMemo(() => {
    const kind = choice?.destination;
    if (!kind) return [];
    if (kind === "ANY") {
      return asset_users.map((u, i) => {
        const opt = peopleAndPlaces[i];
        const type = placeTypeLabel(u.asset_user_type);
        return { ...opt, detail: [type, opt.detail].filter(Boolean).join(" · ") || undefined };
      });
    }
    return peopleAndPlaces.filter((_, i) => asset_users[i].asset_user_type === kind);
  }, [choice?.destination, asset_users, peopleAndPlaces]);
  // Stock rooms of every company this person works in (Add by Item's "where it is now").
  const stockRoomsQ = useStockRooms("all");
  // A destination stock room that does not exist yet is added right here (people and
  // stores are not: those belong to People & Places).
  const mayAddStockRoom = useCanCreate("stock_room");
  const [newStockRoom, setNewStockRoom] = useState(false);
  const canAddDestination = mayAddStockRoom && (choice?.destination === "STOCK_POINT" || choice?.destination === "ANY");

  function chooseChoice(next: MoveChoice) {
    setChoiceKey(next.key);
    setOutcome(null);
    // A destination chosen for another kind of choice does not carry over.
    const stillFits = next.destination != null && (next.destination === "ANY" ||
      asset_users.some((u) => String(u.id) === toAssetUserId && u.asset_user_type === next.destination));
    if (!stillFits) setToAssetUserId("");
  }

  // "Currently With" browse: everything a specific person/store/point holds
  // right now, so an operator who knows WHO has something (but not its
  // serial/code) can find and select it instead of needing to already know
  // a search term -- capped at the endpoint's own max limit (200).
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
    setScanValue("");
    setCandidates(null);
    if (queue.some((existing) => existing.id === asset.id)) {
      setScanError(`${asset.asset_code} is already in this batch.`);       // a repeat scan is ignored, and said so
      focusScan();
      return;
    }
    setScanError(null);
    enqueue([asset]);
  }

  // Add by Item: the oldest N in stock of that Item at that stock room, one label each.
  // S5b-1: one GET /assets/pick (X-Total-Count = how many are there), then the picked
  // assets' full rows for the batch and the labels.
  const byItemMutation = useMutation({
    mutationFn: async (v: { itemId: string; fromId: string; count: number }) => {
      // Ask for enough to cover the ones already in this batch too.
      const want = Math.min(MAX_QUANTITY, v.count + queue.length);
      const picked = await apiClient.getPage<{ asset_id: number; asset_code: string; serial_number: string | null }[]>(
        `/assets/pick?item_id=${v.itemId}&asset_user_id=${v.fromId}&quantity=${want}`,
      );
      const rows = Array.isArray(picked?.data) ? picked.data : [];
      const have = new Set(queue.map((a) => a.id));
      const freeIds = rows.map((r) => r.asset_id).filter((id) => !have.has(id));
      const inStock = picked?.total ?? rows.length;
      if (freeIds.length < v.count) return { assets: [] as AssetSearchResult[], inStock, free: freeIds.length };
      const assets = await fetchAssetsByIds<AssetSearchResult>(freeIds.slice(0, v.count));
      return { assets, inStock, free: freeIds.length };
    },
    onSuccess: (result, v) => {
      if (result.free < v.count) {
        const room = stockRoomsQ.rows.find((r) => String(r.id) === v.fromId)?.name ?? "that stock room";
        const inBatch = result.inStock - result.free;
        setItemError(
          `Only ${result.inStock} in stock at ${room}` +
            (inBatch > 0 ? ` (${inBatch} already in this batch)` : "") +
            ` — you asked for ${v.count}. Nothing was added.`,
        );
        return;
      }
      setItemError(null);
      setBulkSummary(null);
      enqueue(result.assets);
    },
    onError: (err) => setItemError(err instanceof Error ? err.message : "Could not take them from stock -- try again."),
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
        const eligibleNew = result.items.filter((a) => eligibleFor(a) && !queuedIds.has(a.id));
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
        focusScan();
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
    if (scanPrefs.verify && labelsOn) {
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

  // Which choices fit the whole batch (the same rule Asset 360 uses).
  const queuedStatuses = useMemo(() => [...new Set(queue.map((a) => a.status))], [queue]);
  const availability = choiceAvailability(queuedStatuses, { isAdmin });
  const availabilityByKey = new Map(availability.map((s) => [s.choice.key, s]));
  const someOffForBatch = availability.some((s) => !s.enabled && !s.choice.adminOnly);
  const mixedLine =
    queuedStatuses.length > 1 && someOffForBatch
      ? `This batch has assets that are ${queuedStatuses.map((s) => statusLabel(s)).join(", ")}: only what is possible for all of them is offered.`
      : null;

  // Apply always acts on the FULL queue's eligible assets, never the
  // filtered/sorted view below -- searching/sorting the queue only changes
  // what's displayed while scanning, never what gets submitted.
  const eligibleQueue = choice ? queue.filter(eligibleFor) : [];

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
  const unprinted = labelsOn ? eligibleQueue.filter((a) => !a.printed) : [];
  const unconfirmed = scanPrefs.verify && labelsOn ? eligibleQueue.filter((a) => !a.confirmed).length : 0;
  const tooManyToApply = eligibleQueue.length > MAX_QUANTITY;
  const needsDestination = choice?.destination != null && toAssetUserId === "";
  const canApply = !!choice && eligibleQueue.length > 0 && !tooManyToApply && !needsDestination && unconfirmed === 0;
  const applyHint = !choice
    ? "Choose what to do."
    : queue.length === 0
      ? "Add the assets."
      : eligibleQueue.length === 0
        ? `None of these assets can be: ${choice.label}.`
        : needsDestination
          ? `Choose the ${choice.destinationLabel?.toLowerCase()}.`
          : null;

  // The batch goes in one request. A date other than today or a reference number is
  // recorded per asset through the single-asset endpoint (the batch endpoint does not take
  // them yet), each asset reported on its own exactly as the batch endpoint would.
  const applyMutation = useMutation({
    mutationFn: async (): Promise<ApplyOutcome> => {
      const c = choice!;
      const sent = eligibleQueue;
      const to = c.destination ? Number(toAssetUserId) : null;
      const reference = referenceNo.trim();
      const note = remarks.trim() || null;
      const customDate = eventDate !== "" && eventDate !== todayIso();
      if (!customDate && reference === "") {
        const result = await apiClient.post<BulkActionResult>("/assets/bulk-action", {
          asset_ids: sent.map((a) => a.id),
          event_type: c.eventType,
          to_asset_user_id: to,
          remarks: note,
        });
        return { ...result, choice: c, sent };
      }
      const failed: BulkActionResult["failed"] = [];
      let done = 0;
      for (const a of sent) {
        try {
          await apiClient.post(`/assets/${a.id}/events`, {
            event_type: c.eventType,
            to_asset_user_id: to,
            event_date: customDate ? new Date(eventDate).toISOString() : undefined,
            reference_no: reference || null,
            remarks: note,
          });
          done += 1;
        } catch (err) {
          failed.push({ asset_id: a.id, reason: err instanceof Error ? err.message : "Could not be recorded." });
        }
      }
      return { done, failed, choice: c, sent };
    },
    onSuccess: (result) => {
      const failedIds = new Set(result.failed.map((f) => f.asset_id));
      // Successful ones fall off the queue; a failure stays, so the operator
      // can see exactly which ones still need attention and why.
      setQueue((q) => q.filter((a) => failedIds.has(a.id)));
      setOutcome(result);
    },
  });

  function resetAfterApply() {
    applyMutation.reset();
    setOutcome(null);
    setQueue([]);
    setRemarks("");
    setReferenceNo("");
    setEventDate(todayIso());
    setToAssetUserId("");
    setCurrentlyWithId("");
    setBrowseSelected([]);
    focusScan();
  }

  const movedAssets = outcome ? outcome.sent.filter((a) => !outcome.failed.some((f) => f.asset_id === a.id)) : [];
  const codeOf = (id: number) => outcome?.sent.find((a) => a.id === id)?.asset_code ?? `Asset #${id}`;

  return (
    <div className="flex flex-col gap-4">
      {printing && (
        <PrintNow
          assets={printing} symbol={labelSettings.symbol} widthMm={labelSettings.widthMm} heightMm={labelSettings.heightMm}
          onPrinted={() => markPrinted(printing.map((a) => a.id))}
        />
      )}

      <PageHeader
        title="Move"
        description="Choose what to do, add the assets (scan, search, by Item, or from whoever has them), then apply once. Sending to a store prints each label as you scan, so the label is for the asset in your hand."
        actions={<Button asChild variant="outline" size="sm"><Link to="/print-labels">Print Labels</Link></Button>}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium" id="move-choice-label">What do you want to do?</span>
        <div role="radiogroup" aria-labelledby="move-choice-label" className="flex flex-wrap gap-x-3 gap-y-1.5">
          {CHOICE_GROUPS.map((group) => (
            <div key={group.join()} className="flex flex-wrap gap-1.5">
              {group.map((key) => {
                const state = availabilityByKey.get(key)!;
                const selected = choiceKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!state.enabled}
                    title={state.reason}
                    onClick={() => chooseChoice(state.choice)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-sm",
                      selected ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    {state.choice.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {mixedLine && <p className="text-xs text-muted-foreground" role="note">{mixedLine}</p>}
      </div>

      {choice?.destination && (
        <FormField htmlFor="movement-asset-user" label={choice.destinationLabel ?? "To"} required className="sm:max-w-md">
          <SearchableSelect
            id="movement-asset-user"
            aria-label={choice.destinationLabel}
            value={selectValue(toAssetUserId)}
            onValueChange={setToAssetUserId}
            options={destinationOptions}
            placeholder={`Choose the ${choice.destinationLabel?.toLowerCase()}…`}
            searchPlaceholder="Search by name or code…"
            onCreateNew={canAddDestination ? () => setNewStockRoom(true) : undefined}
            createLabel="New Stock Room…"
          />
          <NewStockRoomDialog open={newStockRoom} onOpenChange={setNewStockRoom} onCreated={(row) => setToAssetUserId(String(row.id))} />
        </FormField>
      )}

      {labelsOn && <LabelSettingsDisclosure settings={labelSettings} scanPrefs={scanPrefs} />}

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <FormField
          htmlFor="movement-scan"
          label="Scan or type Serial Number, Asset Code, or Description"
          helperText="Press Enter after each one -- a barcode scanner does this automatically."
        >
          <div className="flex gap-2">
            <Input
              id="movement-scan" aria-label="Scan or type Serial Number, Asset Code, or Description" value={scanValue}
              ref={scanRef}
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
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          aria-label="Only assets currently in stock"
          checked={onlyInStock}
          onCheckedChange={(checked) => setOnlyInStock(checked === true)}
        />
        Only assets currently in stock
      </label>
      {scanError && <p className="text-sm text-destructive" role="alert">{scanError}</p>}
      {bulkSummary && <p className="text-sm text-muted-foreground" role="status">{bulkSummary}</p>}
      {preloadQ.isError && <p className="text-sm text-destructive" role="alert">Couldn't load the assets that were sent here. Add them by scanning instead.</p>}
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
          For things such as mice and keyboards with no serial: choose the Item, where it is now and how many, and CKAM takes that many
          from that stock room{labelsOn ? ", with one label each" : ""}.
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
              options={stockRoomPickerOptions(stockRoomsQ.rows)}
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
            Queued ({queue.length}){choice && eligibleQueue.length !== queue.length && ` — ${eligibleQueue.length} can be done`}
          </h2>
          {unprinted.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => printLabels(unprinted)}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print {labelsWord(unprinted.length)} not printed yet
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
              const eligible = eligibleFor(a);
              return (
              <li
                key={a.id}
                className={`flex items-center justify-between gap-2 rounded-sm border px-2 py-1.5 text-sm ${
                  !eligible
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
                    {!eligible && choice && ` · not possible: ${choice.label} (it is ${statusLabel(a.status, a.current_asset_user_type)})`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {labelsOn && eligible && (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {a.confirmed ? "Confirmed" : a.printed ? (scanPrefs.verify ? "Printed: scan the label" : "Printed") : "Label not printed"}
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

      <div className="rounded-md border px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          aria-expanded={moreOpen}
          aria-controls="movement-more"
          onClick={() => setMoreOpen((o) => !o)}
        >
          {moreOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          <span className="font-medium text-foreground">More</span>
          <span className="text-xs">date, reference number, remarks</span>
        </button>
        {moreOpen && (
          <div id="movement-more" className="mt-3 grid gap-4 border-t pt-3 sm:grid-cols-3">
            <FormField htmlFor="movement-date" label="Date" helperText="Today unless it happened earlier.">
              <Input id="movement-date" aria-label="Date" type="date" max={todayIso()} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </FormField>
            <FormField htmlFor="movement-reference" label="Reference number" helperText="Optional: a gate pass, challan or ticket number.">
              <Input id="movement-reference" aria-label="Reference number" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </FormField>
            <FormField htmlFor="movement-remarks" label="Remarks" helperText="Optional. Applied to every asset in this batch.">
              <Textarea id="movement-remarks" aria-label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
            </FormField>
          </div>
        )}
      </div>

      {tooManyToApply && (
        <p className="text-sm text-destructive" role="alert">
          You can move at most {MAX_QUANTITY.toLocaleString("en-IN")} assets at a time. Remove {eligibleQueue.length - MAX_QUANTITY} from the batch, then apply, and do the rest in a second batch.
        </p>
      )}
      {unconfirmed > 0 && <p className="text-xs text-muted-foreground">{unconfirmed} label{unconfirmed === 1 ? " is" : "s are"} not confirmed yet.</p>}

      {outcome && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm" role="status" data-testid="move-result">
          <p>
            <span className="font-semibold tabular-nums" data-testid="bulk-action-done-count">{outcome.done}</span>{" "}
            {outcome.done === 1 ? "asset" : "assets"} {outcome.choice.doneWord}.
          </p>
          {outcome.failed.length > 0 && (
            <div className="text-destructive">
              <p>{assetsWord(outcome.failed.length)} could not be done (still in the batch above):</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {outcome.failed.map((f) => (
                  <li key={f.asset_id}>{codeOf(f.asset_id)}: {f.reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {movedAssets.length > 0 && <PrintLabelsAction assets={movedAssets} />}
            <Button type="button" variant="outline" size="sm" onClick={resetAfterApply}>
              Move more
            </Button>
          </div>
        </div>
      )}
      {applyMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {applyMutation.error instanceof Error ? applyMutation.error.message : "Failed to apply the action."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <AsyncButton onClick={() => applyMutation.mutate()} disabled={!canApply} pending={applyMutation.isPending} pendingLabel="Applying…">
          {choice ? `${choice.label} (${assetsWord(eligibleQueue.length)})` : "Choose what to do"}
        </AsyncButton>
        {applyHint && !applyMutation.isPending && <span className="text-xs text-muted-foreground">{applyHint}</span>}
      </div>
    </div>
  );
}
