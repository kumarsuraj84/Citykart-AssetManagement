import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { authFetch } from "../../lib/auth-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScanBarcode, Printer } from "lucide-react";

interface AssetSearchResult {
  id: number;
  asset_code: string;
  serial_number: string | null;
  description: string;
}

type Symbol = "barcode" | "qr";

const SYMBOL_STORAGE_KEY = "ckam.printLabels.symbol";
const SIZE_STORAGE_KEY = "ckam.printLabels.size";

// Common physical label sizes this app's users might have loaded into a
// label printer -- "Custom" covers anything else without hard-coding every
// possible size. Millimetres throughout (the unit CSS's own `mm` length
// maps onto directly, and the unit printer/label vendors publish sizes in).
const SIZE_PRESETS: { key: string; label: string; widthMm: number; heightMm: number }[] = [
  { key: "50x25", label: "50 × 25 mm", widthMm: 50, heightMm: 25 },
  { key: "40x20", label: "40 × 20 mm", widthMm: 40, heightMm: 20 },
  { key: "38x25", label: "38 × 25 mm", widthMm: 38, heightMm: 25 },
  { key: "2x1in", label: "2\" × 1\" (50.8 × 25.4 mm)", widthMm: 50.8, heightMm: 25.4 },
];
const CUSTOM_SIZE_KEY = "custom";
const DEFAULT_CUSTOM_WIDTH_MM = 50;
const DEFAULT_CUSTOM_HEIGHT_MM = 25;

function loadStoredSymbol(): Symbol {
  try {
    const raw = window.localStorage.getItem(SYMBOL_STORAGE_KEY);
    return raw === "qr" ? "qr" : "barcode";
  } catch {
    return "barcode";
  }
}

interface StoredSize {
  sizeKey: string;
  customWidthMm: number;
  customHeightMm: number;
}

function loadStoredSize(): StoredSize {
  const fallback: StoredSize = { sizeKey: SIZE_PRESETS[0].key, customWidthMm: DEFAULT_CUSTOM_WIDTH_MM, customHeightMm: DEFAULT_CUSTOM_HEIGHT_MM };
  try {
    const raw = window.localStorage.getItem(SIZE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredSize>;
    const sizeKey = typeof parsed.sizeKey === "string" ? parsed.sizeKey : fallback.sizeKey;
    const customWidthMm = typeof parsed.customWidthMm === "number" && parsed.customWidthMm > 0 ? parsed.customWidthMm : fallback.customWidthMm;
    const customHeightMm = typeof parsed.customHeightMm === "number" && parsed.customHeightMm > 0 ? parsed.customHeightMm : fallback.customHeightMm;
    return { sizeKey, customWidthMm, customHeightMm };
  } catch {
    return fallback;
  }
}

// Fetches one asset's label image as a blob URL (authFetch, not a bare <img
// src>, since the endpoint requires the bearer token -- same pattern
// AssetDetail.tsx already uses for its own single-asset QR). Re-fetches
// whenever the asset or the chosen symbol changes; revokes its own object
// URL on unmount/change so a long queue never leaks blob URLs.
function LabelImage({ assetId, symbol }: { assetId: number; symbol: Symbol }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    async function load() {
      const res = await authFetch(`/assets/${assetId}/label.png?symbol=${symbol}`);
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setUrl(objectUrl);
    }
    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, symbol]);

  if (!url) return <div className="h-full w-full animate-pulse rounded bg-muted" />;
  return <img src={url} alt="" className="max-h-full max-w-full object-contain" />;
}

export function PrintLabels() {
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<AssetSearchResult[] | null>(null);
  const [queue, setQueue] = useState<AssetSearchResult[]>([]);
  const [symbol, setSymbol] = useState<Symbol>(loadStoredSymbol);
  const [{ sizeKey, customWidthMm, customHeightMm }, setSize] = useState<StoredSize>(loadStoredSize);

  useEffect(() => {
    try {
      window.localStorage.setItem(SYMBOL_STORAGE_KEY, symbol);
    } catch {
      // Best-effort persistence only -- a full/blocked storage shouldn't break printing.
    }
  }, [symbol]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify({ sizeKey, customWidthMm, customHeightMm }));
    } catch {
      // Best-effort persistence only.
    }
  }, [sizeKey, customWidthMm, customHeightMm]);

  const preset = SIZE_PRESETS.find((p) => p.key === sizeKey);
  const widthMm = preset ? preset.widthMm : customWidthMm;
  const heightMm = preset ? preset.heightMm : customHeightMm;

  function addToQueue(asset: AssetSearchResult) {
    setQueue((q) => (q.some((existing) => existing.id === asset.id) ? q : [...q, asset]));
    setScanValue("");
    setScanError(null);
    setCandidates(null);
  }

  function removeFromQueue(id: number) {
    setQueue((q) => q.filter((a) => a.id !== id));
  }

  const searchMutation = useMutation({
    mutationFn: (value: string) =>
      apiClient.get<{ items: AssetSearchResult[]; total: number }>(`/assets?q=${encodeURIComponent(value)}&limit=5`),
    onSuccess: (result, value) => {
      if (result.items.length === 0) {
        setScanError(`No asset found matching "${value}".`);
        setCandidates(null);
        return;
      }
      if (result.items.length === 1) {
        addToQueue(result.items[0]);
        return;
      }
      setScanError(null);
      setCandidates(result.items);
    },
    onError: () => setScanError("Search failed -- try again."),
  });

  function handleScanSubmit() {
    const value = scanValue.trim();
    if (!value) return;
    setCandidates(null);
    searchMutation.mutate(value);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Print-only: isolates .print-labels-sheet to the page, sized to
          exactly one label per printed page (@page here, not on the
          on-screen preview below, which stays inline in normal page flow).
          Vanilla "hide everything else" CSS -- no print library needed for
          a single isolated print target. */}
      <style>{`
        @media print {
          @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
          body * { visibility: hidden; }
          .print-labels-sheet, .print-labels-sheet * { visibility: visible; }
          .print-labels-sheet { position: absolute; top: 0; left: 0; margin: 0; }
          .print-label { break-after: page; page-break-after: always; }
          .print-label:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <PageHeader
        title="Print Labels"
        description="Scan or type a Serial Number/Asset Code to queue assets, then print all their labels in one go."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField htmlFor="label-symbol" label="Label Contains">
          <Select value={symbol} onValueChange={(v) => setSymbol(v as Symbol)}>
            <SelectTrigger id="label-symbol" aria-label="Label Contains">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="barcode">Barcode</SelectItem>
              <SelectItem value="qr">QR Code</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <FormField htmlFor="label-size" label="Label Size">
          <Select value={sizeKey} onValueChange={(v) => setSize((s) => ({ ...s, sizeKey: v }))}>
            <SelectTrigger id="label-size" aria-label="Label Size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZE_PRESETS.map((p) => (
                <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
              ))}
              <SelectItem value={CUSTOM_SIZE_KEY}>Custom…</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        {sizeKey === CUSTOM_SIZE_KEY && (
          <div className="flex items-end gap-2">
            <FormField htmlFor="label-width" label="Width (mm)">
              <Input
                id="label-width" type="number" min={10} step="0.1" value={customWidthMm}
                onChange={(e) => setSize((s) => ({ ...s, customWidthMm: Number(e.target.value) || DEFAULT_CUSTOM_WIDTH_MM }))}
              />
            </FormField>
            <FormField htmlFor="label-height" label="Height (mm)">
              <Input
                id="label-height" type="number" min={10} step="0.1" value={customHeightMm}
                onChange={(e) => setSize((s) => ({ ...s, customHeightMm: Number(e.target.value) || DEFAULT_CUSTOM_HEIGHT_MM }))}
              />
            </FormField>
          </div>
        )}
      </div>

      <FormField
        htmlFor="print-labels-scan"
        label="Scan or type Serial Number / Asset Code"
        helperText="Press Enter after each one -- a barcode scanner does this automatically."
      >
        <div className="flex gap-2">
          <Input
            id="print-labels-scan" aria-label="Scan or type Serial Number / Asset Code" value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScanSubmit();
              }
            }}
            autoFocus
          />
          <Button type="button" variant="outline" onClick={handleScanSubmit} disabled={searchMutation.isPending}>
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
                <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => addToQueue(a)}>
                  {a.asset_code} — {a.description} ({a.serial_number ?? "no serial"})
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Queued ({queue.length})</h2>
        </div>
        {queue.length === 0 ? (
          <EmptyState title="Nothing scanned yet." description="Scan or type a Serial Number/Asset Code above to add assets here." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {queue.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-sm border bg-muted/40 px-2 py-1.5 text-sm">
                <span>{a.asset_code} — {a.description} ({a.serial_number ?? "no serial"})</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeFromQueue(a.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Preview == what prints -- the same markup that the print-only
          stylesheet above isolates onto the page, just displayed inline in
          normal flow here so it doubles as an on-screen preview to
          finalize the layout before committing paper/labels to it. */}
      <div className="rounded-md border p-3">
        <h2 className="mb-2 text-sm font-semibold">Preview</h2>
        {queue.length === 0 ? (
          <EmptyState title="No labels to preview yet." description="Labels appear here as you queue assets above." />
        ) : (
          <div className="print-labels-sheet flex flex-wrap gap-3">
            {queue.map((a) => (
              <div
                key={a.id}
                className="print-label flex flex-col items-center justify-center gap-1 overflow-hidden border p-1 text-center"
                style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
              >
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <LabelImage assetId={a.id} symbol={symbol} />
                </div>
                <p className="w-full shrink-0 truncate font-mono text-[9px] font-semibold leading-tight">{a.asset_code}</p>
                <p className="w-full shrink-0 truncate text-[8px] leading-tight text-muted-foreground">{a.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <Button type="button" onClick={() => window.print()} disabled={queue.length === 0}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print {queue.length} Label{queue.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}
