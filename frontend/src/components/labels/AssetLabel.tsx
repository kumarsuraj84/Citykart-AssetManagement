import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authFetch } from "../../lib/auth-fetch";

/** What a label needs to know about an asset (a subset of what the asset list returns). */
export interface LabelAsset {
  id: number;
  asset_code: string;
  serial_number: string | null;
  serial_pending?: boolean;
  description: string;
  item_name?: string | null;
  erp_item_code?: string | null;
}

/** barcode: bars only (asset code). qr: a QR of the asset code. both: bars (asset code, for
 * scanners) plus a QR that opens the asset's page when a phone camera scans it. */
export type LabelSymbol = "barcode" | "qr" | "both";

// What a picture on a label encodes: the bare asset code as bars or as a QR (what every scan
// field in this app expects), or a link that opens the asset (for a phone camera).
type PictureKind = "bars" | "code-qr" | "link-qr";
const PICTURE_PATH: Record<PictureKind, (id: number) => string> = {
  "bars": (id) => `/assets/${id}/label.png?symbol=barcode`,
  "code-qr": (id) => `/assets/${id}/label.png?symbol=qr`,
  "link-qr": (id) => `/assets/${id}/qr.png`,
};

const SYMBOL_STORAGE_KEY = "ckam.printLabels.symbol";
const SIZE_STORAGE_KEY = "ckam.printLabels.size";

// Common physical label sizes loaded into a label printer -- "Custom" covers anything
// else. Millimetres throughout (CSS `mm` maps onto them directly). 70 x 20 is the
// size CityKart uses, so it is the default.
export const LABEL_SIZE_PRESETS: { key: string; label: string; widthMm: number; heightMm: number }[] = [
  { key: "70x20", label: "70 × 20 mm", widthMm: 70, heightMm: 20 },
  { key: "50x25", label: "50 × 25 mm", widthMm: 50, heightMm: 25 },
  { key: "40x20", label: "40 × 20 mm", widthMm: 40, heightMm: 20 },
  { key: "38x25", label: "38 × 25 mm", widthMm: 38, heightMm: 25 },
  { key: "2x1in", label: "2\" × 1\" (50.8 × 25.4 mm)", widthMm: 50.8, heightMm: 25.4 },
];
export const CUSTOM_SIZE_KEY = "custom";

/** What each symbol choice is called on screen. */
export const SYMBOL_WORDS: Record<LabelSymbol, string> = {
  both: "Barcode + QR",
  barcode: "Barcode",
  qr: "QR Code",
};
const DEFAULT_CUSTOM_WIDTH_MM = 70;
const DEFAULT_CUSTOM_HEIGHT_MM = 20;

interface StoredSize {
  sizeKey: string;
  customWidthMm: number;
  customHeightMm: number;
}

function loadStoredSymbol(): LabelSymbol {
  try {
    // Both by default: bars for any handheld scanner (a plain 1D scanner cannot read a QR),
    // and a QR that a phone camera opens in CKAM to see where the asset is.
    const raw = window.localStorage.getItem(SYMBOL_STORAGE_KEY);
    return raw === "qr" || raw === "barcode" ? raw : "both";
  } catch {
    return "both";
  }
}

function loadStoredSize(): StoredSize {
  const fallback: StoredSize = { sizeKey: LABEL_SIZE_PRESETS[0].key, customWidthMm: DEFAULT_CUSTOM_WIDTH_MM, customHeightMm: DEFAULT_CUSTOM_HEIGHT_MM };
  try {
    const raw = window.localStorage.getItem(SIZE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredSize>;
    return {
      sizeKey: typeof parsed.sizeKey === "string" ? parsed.sizeKey : fallback.sizeKey,
      customWidthMm: typeof parsed.customWidthMm === "number" && parsed.customWidthMm > 0 ? parsed.customWidthMm : fallback.customWidthMm,
      customHeightMm: typeof parsed.customHeightMm === "number" && parsed.customHeightMm > 0 ? parsed.customHeightMm : fallback.customHeightMm,
    };
  } catch {
    return fallback;
  }
}

/** The label symbol and size, remembered in this browser (best effort) so the PC that
 * prints labels keeps its printer's setup between visits and between screens. */
export function useLabelSettings() {
  const [symbol, setSymbol] = useState<LabelSymbol>(loadStoredSymbol);
  const [size, setSize] = useState<StoredSize>(loadStoredSize);
  useEffect(() => {
    try {
      window.localStorage.setItem(SYMBOL_STORAGE_KEY, symbol);
    } catch {
      // best effort
    }
  }, [symbol]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
    } catch {
      // best effort
    }
  }, [size]);
  const preset = LABEL_SIZE_PRESETS.find((p) => p.key === size.sizeKey);
  return {
    symbol, setSymbol, size, setSize,
    /** "Barcode + QR · 70 × 20 mm": what the closed Label settings disclosure shows. */
    summary: `${SYMBOL_WORDS[symbol]} · ${preset ? preset.label : `${size.customWidthMm} × ${size.customHeightMm} mm`}`,
    widthMm: preset ? preset.widthMm : size.customWidthMm,
    heightMm: preset ? preset.heightMm : size.customHeightMm,
  };
}

/** Print CSS: one label per printed page at the label's own size. `.label-offscreen`
 * keeps a print-only sheet off the visible page until the browser prints. */
export function LabelPrintStyle({ widthMm, heightMm }: { widthMm: number; heightMm: number }) {
  return (
    <style>{`
      .label-offscreen { position: absolute; left: -10000px; top: 0; }
      @media print {
        @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
        body * { visibility: hidden; }
        .print-labels-sheet, .print-labels-sheet * { visibility: visible; }
        .print-labels-sheet { position: absolute; top: 0; left: 0; margin: 0; }
        .label-offscreen { left: 0 !important; }
        .print-label { break-after: page; page-break-after: always; }
        .print-label:last-child { break-after: auto; page-break-after: auto; }
      }
    `}</style>
  );
}

// The barcode / QR picture comes from the server as a PNG that needs the bearer token,
// so it is fetched and shown through a blob URL (a bare <img src> could not send it).
// `onDone` fires once the picture is there (or could not be loaded), so a print waits for it.
function LabelImage({ assetId, kind, onDone }: { assetId: number; kind: PictureKind; onDone?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    async function load() {
      try {
        const res = await authFetch(PICTURE_PATH[kind](assetId));
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch {
        // fall through to onDone below
      } finally {
        if (!cancelled && !objectUrl) doneRef.current?.();
      }
    }
    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, kind]);

  if (!url) return <div className="h-full w-full animate-pulse rounded bg-muted" />;
  return <img src={url} alt="" className="max-h-full max-w-full object-contain" onLoad={() => doneRef.current?.()} onError={() => doneRef.current?.()} />;
}

/** The serial line: the real serial, or what is going on instead of one. */
export function serialText(a: Pick<LabelAsset, "serial_number" | "serial_pending">): string {
  if (a.serial_pending) return "SN: to be added";
  return a.serial_number ? `SN: ${a.serial_number}` : "SN: none";
}

/**
 * One asset's label: the item name, asset code, serial and ERP item code in text a person
 * can read, plus the codes a scanner reads.
 *  - Barcode + QR: the QR (opens the asset on a phone) on the left; on the right three text
 *    lines and the bars (the asset code, for scanners) along the bottom.
 *  - QR only: the QR on the left, four text lines on the right.
 *  - Barcode only: three text lines on top, the bars across the bottom.
 */
export function AssetLabel({
  asset, symbol, widthMm, heightMm, onImageDone,
}: { asset: LabelAsset; symbol: LabelSymbol; widthMm: number; heightMm: number; onImageDone?: () => void }) {
  const name = asset.item_name || asset.description;
  // Serial and ERP code share a line on the compact "both" layout (the bars need the height).
  const compact = symbol === "both";
  const text = (
    <>
      <p className="w-full truncate text-[7pt] font-bold leading-tight">{name}</p>
      <p className="w-full truncate font-mono text-[6.5pt] font-semibold leading-tight">{asset.asset_code}</p>
      {compact ? (
        <p className="w-full truncate font-mono text-[6.5pt] leading-tight">
          {serialText(asset)}{asset.erp_item_code ? ` · ERP: ${asset.erp_item_code}` : ""}
        </p>
      ) : (
        <>
          <p className="w-full truncate font-mono text-[6.5pt] leading-tight">{serialText(asset)}</p>
          {asset.erp_item_code && <p className="w-full truncate font-mono text-[6.5pt] leading-tight">ERP: {asset.erp_item_code}</p>}
        </>
      )}
    </>
  );
  const squareMm = `${Math.min(heightMm - 2, widthMm / 2)}mm`;
  return (
    <div
      className="print-label flex overflow-hidden border bg-white p-[0.8mm] text-left text-black"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
    >
      {symbol === "qr" ? (
        <>
          <div className="flex shrink-0 items-center justify-center" style={{ width: squareMm }}>
            <LabelImage assetId={asset.id} kind="code-qr" onDone={onImageDone} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.3mm] pl-[1mm]">{text}</div>
        </>
      ) : symbol === "both" ? (
        <>
          <div className="flex shrink-0 items-center justify-center" style={{ width: squareMm }}>
            <LabelImage assetId={asset.id} kind="link-qr" onDone={onImageDone} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[0.3mm] pl-[1mm]">
            <div className="flex shrink-0 flex-col gap-[0.2mm]">{text}</div>
            <div className="flex min-h-0 flex-1 items-center justify-start">
              <LabelImage assetId={asset.id} kind="bars" onDone={onImageDone} />
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-[0.3mm]">
          <div className="flex shrink-0 flex-col gap-[0.2mm]">{text}</div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <LabelImage assetId={asset.id} kind="bars" onDone={onImageDone} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Prints these labels straight away (the browser's print, one label per page): renders
 * them off-screen, waits for every barcode picture, calls window.print(), then
 * `onPrinted`. With the browser set to print silently to the label printer, this is one
 * scan = one label with nothing to click. The sheet (and the print-only stylesheet that
 * hides the rest of the page) is mounted on <body> only while printing, so wherever it is
 * used -- a page, a dialog -- only the labels print, never the page around them.
 */
export function PrintNow({
  assets, symbol, widthMm, heightMm, onPrinted,
}: { assets: LabelAsset[]; symbol: LabelSymbol; widthMm: number; heightMm: number; onPrinted: () => void }) {
  const [loaded, setLoaded] = useState(0);
  const printedRef = useRef(false);
  const done = useRef(onPrinted);
  done.current = onPrinted;

  useEffect(() => {
    const expected = assets.length * (symbol === "both" ? 2 : 1);
    if (assets.length > 0 && loaded >= expected && !printedRef.current) {
      printedRef.current = true;
      // let the pictures paint before the print snapshot
      const t = setTimeout(() => {
        window.print();
        done.current();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [loaded, assets.length, symbol]);

  return createPortal(
    <>
      <LabelPrintStyle widthMm={widthMm} heightMm={heightMm} />
      <div className="print-labels-sheet label-offscreen" aria-hidden="true">
        {assets.map((a) => (
          <AssetLabel key={a.id} asset={a} symbol={symbol} widthMm={widthMm} heightMm={heightMm} onImageDone={() => setLoaded((n) => n + 1)} />
        ))}
      </div>
    </>,
    document.body,
  );
}
