import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { AssetLabel, PrintNow, useLabelSettings, type LabelAsset } from "@/components/labels/AssetLabel";
import { LabelSettingsDisclosure, type LabelSettings } from "./LabelSettingsDisclosure";

/** The most assets the server returns for one `?ids=` request (S6: up to 1,000 ids, limit up to 1,000). */
const IDS_PER_REQUEST = 1000;

export function labelsWord(n: number): string {
  return `${n} label${n === 1 ? "" : "s"}`;
}

/** Loads these assets (1,000 per request, the server's limit -- one request for any receipt), returned in the order of `ids`. */
export async function fetchAssetsByIds<T extends { id: number }>(ids: number[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + IDS_PER_REQUEST);
    const page = await apiClient.get<{ items: T[] }>(`/assets?ids=${encodeURIComponent(chunk.join(","))}&limit=${IDS_PER_REQUEST}`);
    out.push(...(Array.isArray(page?.items) ? page.items : []));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** "1,2,3" (a URL parameter) -> [1, 2, 3]; anything that is not a whole positive number is dropped. */
export function parseIdList(raw: string | undefined | null): number[] {
  return (raw ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

/** The label details (item name, code, serial, ERP code) of these assets, in this order. */
export function fetchLabelAssets(ids: number[]): Promise<LabelAsset[]> {
  return fetchAssetsByIds<LabelAsset>(ids);
}

/**
 * Labels laid out the way they print. `printable` marks it as the sheet the browser's
 * print isolates (the Print labels page, where the preview IS what prints); otherwise it
 * is a preview only and printing goes through PrintNow.
 */
export function LabelSheet({ assets, settings, printable = false }: { assets: LabelAsset[]; settings: LabelSettings; printable?: boolean }) {
  return (
    <div className={`${printable ? "print-labels-sheet " : ""}flex flex-wrap gap-3`} data-testid="label-preview">
      {assets.map((a) => (
        <AssetLabel key={a.id} asset={a} symbol={settings.symbol} widthMm={settings.widthMm} heightMm={settings.heightMm} />
      ))}
    </div>
  );
}

interface PrintLabelsActionProps {
  /** The assets, when the screen already has them (Asset 360, Move's result, the register page). */
  assets?: LabelAsset[];
  /** Or just their ids (a delivery): their label details are loaded when the dialog opens. */
  assetIds?: number[];
  /** The button's words; default "Print labels (n)". */
  children?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** Called after the labels went to the printer. */
  onPrinted?: () => void;
}

/**
 * The ONE "print these assets' labels" action, used wherever a set of assets is on screen:
 * the Assets register selection, Asset 360, Move's result and a delivery's "Print their
 * labels now". It opens a small dialog -- the shared Label settings, a preview, and
 * Print -- and prints only the labels (one per page at the label's size), never the page.
 */
export function PrintLabelsAction({ assets, assetIds, children, variant = "outline", size = "sm", className, onPrinted }: PrintLabelsActionProps) {
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const settings = useLabelSettings();
  const ids = assets ? assets.map((a) => a.id) : (assetIds ?? []);
  const count = ids.length;

  const loadQ = useQuery({
    queryKey: ["assets", "label-details", ids.join(",")],
    queryFn: () => fetchLabelAssets(ids),
    enabled: open && !assets && count > 0,
  });
  const labelAssets = assets ?? loadQ.data ?? [];

  function close() {
    setOpen(false);
    setPrinting(false);
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={count === 0} onClick={() => setOpen(true)}>
        <Printer className="h-4 w-4" aria-hidden="true" />
        {children ?? `Print labels (${count})`}
      </Button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Print {labelsWord(count)}</DialogTitle>
            <DialogDescription>One label per asset, at the size below. Only the labels print.</DialogDescription>
          </DialogHeader>

          <LabelSettingsDisclosure settings={settings} />

          <div className="max-h-72 overflow-y-auto rounded-md border p-3">
            {loadQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading the labels…</p>
            ) : loadQ.isError ? (
              <p className="text-sm text-destructive" role="alert">Couldn't load these assets' labels. Close and try again.</p>
            ) : labelAssets.length === 0 ? (
              <EmptyState title="No labels to print." />
            ) : (
              <LabelSheet assets={labelAssets} settings={settings} />
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="button" onClick={() => setPrinting(true)} disabled={labelAssets.length === 0 || printing}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              {printing ? "Printing…" : `Print ${labelsWord(labelAssets.length)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {printing && labelAssets.length > 0 && (
        <PrintNow
          assets={labelAssets} symbol={settings.symbol} widthMm={settings.widthMm} heightMm={settings.heightMm}
          onPrinted={() => {
            close();
            onPrinted?.();
          }}
        />
      )}
    </>
  );
}
