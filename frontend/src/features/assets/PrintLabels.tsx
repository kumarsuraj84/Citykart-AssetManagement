import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { EmptyState } from "@/components/shared/EmptyState";
import { AssetLabel, LabelPrintStyle, useLabelSettings, type LabelAsset } from "@/components/labels/AssetLabel";
import { LabelSettingsFields } from "@/components/labels/LabelSettingsFields";
import { assetScanQuery } from "../../lib/scan";
import { ScanBarcode, Printer } from "lucide-react";

type AssetSearchResult = LabelAsset;

/**
 * Print Labels: labels for assets you already have in hand -- scan or type to queue them,
 * then print. Opened from a delivery ("Print labels for these"), it arrives with that
 * delivery's assets already queued, so every received unit can be tagged before it is
 * dispatched. (To label an asset at the moment it is sent, use Dispatch.)
 */
export function PrintLabels({ preloadIds }: { preloadIds?: string }) {
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<AssetSearchResult[] | null>(null);
  const [queue, setQueue] = useState<AssetSearchResult[]>([]);
  const settings = useLabelSettings();
  const { symbol, widthMm, heightMm } = settings;

  const preloadQ = useQuery({
    queryKey: ["assets", "labels-preload", preloadIds],
    queryFn: () => apiClient.get<{ items: AssetSearchResult[]; total: number }>(`/assets?ids=${encodeURIComponent(preloadIds ?? "")}&limit=200`),
    enabled: !!preloadIds,
  });
  useEffect(() => {
    if (!preloadQ.data) return;
    setQueue((q) => {
      const have = new Set(q.map((a) => a.id));
      const order = (preloadIds ?? "").split(",").map(Number);
      const loaded = [...preloadQ.data.items].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return [...q, ...loaded.filter((a) => !have.has(a.id))];
    });
  }, [preloadQ.data, preloadIds]);

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
      apiClient.get<{ items: AssetSearchResult[]; total: number }>(`/assets?${assetScanQuery(value)}`),
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
      <LabelPrintStyle widthMm={widthMm} heightMm={heightMm} />

      <PageHeader
        title="Print Labels"
        description="Scan or type a Serial Number/Asset Code to queue assets, then print all their labels in one go. Each label shows the item name, asset code, serial and ERP item code, with a barcode that scans back as the asset code."
        actions={<Button asChild variant="outline"><Link to="/asset-movement">Move / Dispatch (label as you send)</Link></Button>}
      />

      <LabelSettingsFields settings={settings} />

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
      {preloadQ.isError && <p className="text-sm text-destructive" role="alert">Couldn't load the assets of that delivery.</p>}
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
          {queue.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setQueue([])}>Clear</Button>}
        </div>
        {queue.length === 0 ? (
          <EmptyState title="Nothing scanned yet." description="Scan or type a Serial Number/Asset Code above to add assets here." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {queue.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-sm border bg-muted/40 px-2 py-1.5 text-sm">
                <span>{a.asset_code} — {a.item_name ?? a.description} ({a.serial_pending ? "serial to be added" : a.serial_number ?? "no serial"})</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeFromQueue(a.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Preview == what prints -- the same markup that the print-only
          stylesheet isolates onto the page, shown inline so it doubles as an
          on-screen preview before any label stock is used. */}
      <div className="rounded-md border p-3">
        <h2 className="mb-2 text-sm font-semibold">Preview</h2>
        {queue.length === 0 ? (
          <EmptyState title="No labels to preview yet." description="Labels appear here as you queue assets above." />
        ) : (
          <div className="print-labels-sheet flex flex-wrap gap-3">
            {queue.map((a) => (
              <AssetLabel key={a.id} asset={a} symbol={symbol} widthMm={widthMm} heightMm={heightMm} />
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
