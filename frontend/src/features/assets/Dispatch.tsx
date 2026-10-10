import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Item } from "../items/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { EmptyState } from "@/components/shared/EmptyState";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";
import {
  LabelPrintStyle, PrintNow, serialText, useLabelSettings, type LabelAsset,
} from "@/components/labels/AssetLabel";
import { LabelSettingsFields } from "@/components/labels/LabelSettingsFields";
import { assetScanQuery, isAssetLink } from "../../lib/scan";
import { Printer, ScanBarcode } from "lucide-react";

interface DispatchAsset extends LabelAsset {
  status: string;
  current_asset_user_name?: string | null;
}

interface AssetUserOption {
  id: number;
  name: string;
  asset_user_type?: string;
}

interface Row {
  asset: DispatchAsset;
  printed: boolean;
  confirmed: boolean;
}

const PREFS_KEY = "ckam.dispatch.prefs";

function loadPrefs(): { autoPrint: boolean; verify: boolean } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as { autoPrint?: boolean; verify?: boolean } | null;
    return { autoPrint: raw?.autoPrint !== false, verify: raw?.verify === true };
  } catch {
    return { autoPrint: true, verify: false };
  }
}

type Found = { items: DispatchAsset[]; total: number };

/**
 * Dispatch: the person who sends assets to a store scans each one here instead of in
 * Excel. CKAM finds the asset, prints its label right then (so the label that comes out
 * is for the asset in hand), and one click at the end moves everything to the store.
 * Assets with no serial are added by Item ("7 mouse"): CKAM picks that many from the
 * sender's stock and prints one label each.
 */
export function Dispatch() {
  const qc = useQueryClient();
  const labelSettings = useLabelSettings();
  const { symbol, widthMm, heightMm } = labelSettings;
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // best effort
    }
  }, [prefs]);

  const [destination, setDestination] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DispatchAsset[] | null>(null);
  const [printing, setPrinting] = useState<DispatchAsset[] | null>(null);
  const [moveResult, setMoveResult] = useState<{ moved: number; failed: { asset_id: number; reason: string }[] } | null>(null);

  // By Item (assets with no serial to scan)
  const [itemId, setItemId] = useState("");
  const [fromId, setFromId] = useState("");
  const [qty, setQty] = useState("1");
  const [itemError, setItemError] = useState<string | null>(null);

  const usersQ = useQuery({ queryKey: ["asset_users"], queryFn: () => apiClient.get<AssetUserOption[]>("/asset-users") });
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const places = (usersQ.data ?? []).filter((u) => u.asset_user_type === "STOCK_POINT" || u.asset_user_type === "STORE");
  const stockPoints = (usersQ.data ?? []).filter((u) => u.asset_user_type === "STOCK_POINT");

  function printLabels(assets: DispatchAsset[]) {
    if (assets.length === 0) return;
    setPrinting(assets);
  }
  function markPrinted(ids: number[]) {
    setRows((rs) => rs.map((r) => (ids.includes(r.asset.id) ? { ...r, printed: true } : r)));
    setPrinting(null);
  }

  function addAssets(found: DispatchAsset[]) {
    const have = new Set(rows.map((r) => r.asset.id));
    const fresh = found.filter((a) => !have.has(a.id));
    setRows((rs) => [...rs, ...fresh.map((asset) => ({ asset, printed: false, confirmed: false }))]);
    if (prefs.autoPrint) printLabels(fresh);
    return fresh;
  }

  const scanMutation = useMutation({
    mutationFn: async (value: string): Promise<Found> => {
      // the label's QR is a link to the asset: look that asset up directly
      if (isAssetLink(value)) return apiClient.get<Found>(`/assets?${assetScanQuery(value)}`);
      // whole identifiers first (serial, asset code, barcode), so a scan lands on exactly one asset
      const exact = await apiClient.get<Found>(`/assets?${assetScanQuery(value, "&exact=true")}`);
      if (exact.items.length > 0) return exact;
      return apiClient.get<Found>(`/assets?${assetScanQuery(value)}`);
    },
    onSuccess: (result, value) => {
      setMoveResult(null);
      if (result.items.length === 0) {
        setScanError(`No asset found matching "${value}".`);
        setCandidates(null);
        return;
      }
      if (result.items.length > 1) {
        setScanError(null);
        setCandidates(result.items);
        return;
      }
      const [asset] = result.items;
      setScanValue("");
      setCandidates(null);
      if (rows.some((r) => r.asset.id === asset.id)) {
        setScanError(`${asset.asset_code} is already in this dispatch.`);
        return;
      }
      setScanError(null);
      addAssets([asset]);
    },
    onError: () => setScanError("Search failed -- try again."),
  });

  function handleScan() {
    const value = scanValue.trim();
    if (!value) return;
    // Confirming a label that was stuck on: scanning the label itself ticks it off.
    if (prefs.verify) {
      const match = rows.find((r) => r.printed && !r.confirmed && r.asset.asset_code.toLowerCase() === value.toLowerCase());
      if (match) {
        setRows((rs) => rs.map((r) => (r.asset.id === match.asset.id ? { ...r, confirmed: true } : r)));
        setScanValue("");
        setScanError(null);
        return;
      }
    }
    setCandidates(null);
    scanMutation.mutate(value);
  }

  const byItemMutation = useMutation({
    mutationFn: (v: { itemId: string; fromId: string; count: number }) =>
      apiClient.get<Found>(`/assets?item_id=${v.itemId}&asset_user_id=${v.fromId}&status=IN_STOCK&limit=200`),
    onSuccess: (result, v) => {
      setMoveResult(null);
      const have = new Set(rows.map((r) => r.asset.id));
      const free = result.items.filter((a) => !have.has(a.id));
      if (free.length < v.count) {
        setItemError(`Only ${free.length} of that Item ${free.length === 1 ? "is" : "are"} in stock there${have.size ? " (not counting the ones already in this dispatch)" : ""}.`);
        return;
      }
      setItemError(null);
      addAssets(free.slice(0, v.count));
    },
    onError: () => setItemError("Search failed -- try again."),
  });

  const moveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ moved: number; failed: { asset_id: number; reason: string }[] }>("/assets/bulk-move", {
        asset_ids: rows.map((r) => r.asset.id), to_asset_user_id: Number(destination),
      }),
    onSuccess: (result) => {
      setMoveResult(result);
      const failedIds = new Set(result.failed.map((f) => f.asset_id));
      setRows((rs) => rs.filter((r) => failedIds.has(r.asset.id)));
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const unprinted = rows.filter((r) => !r.printed).map((r) => r.asset);
  const unconfirmed = prefs.verify ? rows.filter((r) => !r.confirmed).length : 0;
  const canMove = rows.length > 0 && destination !== "" && unconfirmed === 0 && !moveMutation.isPending;
  const destinationName = places.find((p) => String(p.id) === destination)?.name ?? "";
  const failureReason = (id: number) => moveResult?.failed.find((f) => f.asset_id === id)?.reason;

  return (
    <div className="flex flex-col gap-4">
      <LabelPrintStyle widthMm={widthMm} heightMm={heightMm} />
      {printing && (
        <PrintNow assets={printing} symbol={symbol} widthMm={widthMm} heightMm={heightMm} onPrinted={() => markPrinted(printing.map((a) => a.id))} />
      )}

      <PageHeader
        title="Dispatch"
        description="Send assets to a store. Scan each asset's serial (or type its asset code): CKAM finds it and prints its label at once, so the label is for the asset in your hand. Assets with no serial are added by Item. At the end, move them all in one click."
        actions={<Button asChild variant="outline"><Link to="/print-labels">Print Labels</Link></Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="dispatch-destination" label="Send to" required>
          <SearchableSelect
            id="dispatch-destination" aria-label="Send to" value={destination || undefined} onValueChange={setDestination}
            options={places.map((p) => ({ value: String(p.id), label: p.name }))} placeholder="Choose the store"
          />
        </FormField>
        <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
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
      </div>

      <LabelSettingsFields settings={labelSettings} />

      <FormField
        htmlFor="dispatch-scan" label="Scan the serial number (or type the asset code)"
        helperText={prefs.verify ? "Press Enter after each. After sticking a label on, scan the label to tick it off." : "Press Enter after each -- a barcode scanner does this automatically."}
      >
        <div className="flex gap-2">
          <Input
            id="dispatch-scan" aria-label="Scan the serial number (or type the asset code)" value={scanValue} autoFocus
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScan();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={handleScan} disabled={scanMutation.isPending}>
            <ScanBarcode className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </FormField>
      {scanError && <p className="text-sm text-destructive" role="alert">{scanError}</p>}
      {candidates && (
        <div className="rounded-md border p-2">
          <p className="mb-1 text-xs text-muted-foreground">More than one match -- pick the right one:</p>
          <ul className="flex flex-col gap-1">
            {candidates.map((a) => (
              <li key={a.id}>
                <Button
                  type="button" variant="ghost" size="sm" className="w-full justify-start"
                  onClick={() => { setCandidates(null); setScanValue(""); if (!rows.some((r) => r.asset.id === a.id)) addAssets([a]); }}
                >
                  {a.asset_code} — {a.item_name ?? a.description} ({a.serial_pending ? "serial to be added" : a.serial_number ?? "no serial"})
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border p-3">
        <h2 className="mb-1 text-sm font-semibold">No serial to scan? Add by Item</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          For things such as mice and keyboards with no serial: choose the Item and how many, and CKAM picks that many from the stock
          you are sending from, with one label each.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField htmlFor="dispatch-item" label="Item">
            <SearchableSelect
              id="dispatch-item" aria-label="Item" value={itemId || undefined} onValueChange={setItemId}
              options={(itemsQ.data ?? []).map((i) => ({ value: String(i.id), label: i.name }))} placeholder="Choose the Item"
            />
          </FormField>
          <FormField htmlFor="dispatch-from" label="Sending from">
            <SearchableSelect
              id="dispatch-from" aria-label="Sending from" value={fromId || undefined} onValueChange={setFromId}
              options={stockPoints.map((p) => ({ value: String(p.id), label: p.name }))} placeholder="Choose the stock point"
            />
          </FormField>
          <FormField htmlFor="dispatch-qty" label="How many">
            <Input id="dispatch-qty" aria-label="How many" type="number" min={1} max={200} value={qty} onChange={(e) => setQty(e.target.value)} />
          </FormField>
          <div className="flex items-end">
            <Button
              type="button" variant="outline"
              disabled={!itemId || !fromId || !(Number(qty) >= 1) || byItemMutation.isPending}
              onClick={() => byItemMutation.mutate({ itemId, fromId, count: Math.floor(Number(qty)) })}
            >
              Add {Number(qty) >= 1 ? Math.floor(Number(qty)) : ""} to this dispatch
            </Button>
          </div>
        </div>
        {itemError && <p className="mt-2 text-sm text-destructive" role="alert">{itemError}</p>}
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">In this dispatch ({rows.length})</h2>
          <div className="flex gap-2">
            {unprinted.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => printLabels(unprinted)}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print {unprinted.length} label{unprinted.length === 1 ? "" : "s"} not printed yet
              </Button>
            )}
            {rows.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setRows([])}>Clear</Button>}
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Nothing scanned yet." description="Scan an asset above, or add some by Item." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.asset.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border bg-muted/40 px-2 py-1.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate">
                    <span className="font-mono text-xs">{r.asset.asset_code}</span> — {r.asset.item_name ?? r.asset.description}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {serialText(r.asset)}{r.asset.erp_item_code ? ` · ERP ${r.asset.erp_item_code}` : ""}
                  </p>
                  {failureReason(r.asset.id) && <p className="text-xs text-destructive" role="alert">{r.asset.asset_code}: {failureReason(r.asset.id)}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {r.confirmed ? "Confirmed" : r.printed ? (prefs.verify ? "Printed: scan the label" : "Printed") : "Label not printed"}
                  </span>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Print label for ${r.asset.asset_code}`} onClick={() => printLabels([r.asset])}>
                    {r.printed ? "Reprint" : "Print"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${r.asset.asset_code}`} onClick={() => setRows((rs) => rs.filter((x) => x.asset.id !== r.asset.id))}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {moveResult && (
        <p className="text-sm" role="status">
          Moved {moveResult.moved} asset{moveResult.moved === 1 ? "" : "s"}{moveResult.failed.length > 0 ? `; ${moveResult.failed.length} could not be moved (listed above).` : "."}
        </p>
      )}
      {moveMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {moveMutation.error instanceof Error ? moveMutation.error.message : "Could not move the assets."}
        </p>
      )}
      {unconfirmed > 0 && <p className="text-xs text-muted-foreground">{unconfirmed} label{unconfirmed === 1 ? " is" : "s are"} not confirmed yet.</p>}
      <div>
        <AsyncButton onClick={() => moveMutation.mutate()} disabled={!canMove} pending={moveMutation.isPending} pendingLabel="Moving…">
          Move {rows.length} asset{rows.length === 1 ? "" : "s"}{destinationName ? ` to ${destinationName}` : ""}
        </AsyncButton>
      </div>
    </div>
  );
}
