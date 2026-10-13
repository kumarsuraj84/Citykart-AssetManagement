import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import {
  CUSTOM_SIZE_KEY, LABEL_SIZE_PRESETS, SYMBOL_WORDS, type LabelSymbol, type useLabelSettings,
} from "@/components/labels/AssetLabel";
import type { ScanLabelPrefs } from "./useScanLabelPrefs";

export type LabelSettings = ReturnType<typeof useLabelSettings>;

/**
 * The ONE label-settings UI, used everywhere labels print (Move, Print labels, the
 * print dialog on Assets / Asset 360 / a delivery). Closed, it is one line that says
 * what will print ("Barcode + QR · 70 × 20 mm"); open, it holds every label control.
 * Everything is remembered in this browser.
 *
 * With `scanPrefs` (Move, sending to a store) the one everyday control -- "Print labels
 * as I scan" -- stays visible beside the closed disclosure, and "confirm by scanning"
 * sits inside it with the rest.
 */
export function LabelSettingsDisclosure({
  settings, scanPrefs, defaultOpen = false,
}: { settings: LabelSettings; scanPrefs?: ScanLabelPrefs; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const { symbol, setSymbol, size, setSize } = settings;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-2" data-testid="label-settings">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        {scanPrefs && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label="Print labels as I scan"
              checked={scanPrefs.autoPrint}
              onCheckedChange={(c) => scanPrefs.setAutoPrint(c === true)}
            />
            Print labels as I scan
          </label>
        )}
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((o) => !o)}
        >
          <Chevron className="h-4 w-4" aria-hidden="true" />
          <span className="font-medium text-foreground">Label settings</span>
          <span className="text-xs">{settings.summary}</span>
        </button>
      </div>

      {open && (
        <div id={contentId} className="flex flex-col gap-3 border-t pt-3">
          {scanPrefs && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label="Confirm each label by scanning it"
                checked={scanPrefs.verify}
                onCheckedChange={(c) => scanPrefs.setVerify(c === true)}
              />
              Confirm each label by scanning it after sticking it on
            </label>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField htmlFor={`${contentId}-symbol`} label="Label Contains">
              <Select value={symbol} onValueChange={(v) => setSymbol(v as LabelSymbol)}>
                <SelectTrigger id={`${contentId}-symbol`} aria-label="Label Contains">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">{SYMBOL_WORDS.both} (QR opens the asset on a phone)</SelectItem>
                  <SelectItem value="barcode">{SYMBOL_WORDS.barcode}</SelectItem>
                  <SelectItem value="qr">{SYMBOL_WORDS.qr}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField htmlFor={`${contentId}-size`} label="Label Size">
              <Select value={size.sizeKey} onValueChange={(v) => setSize((s) => ({ ...s, sizeKey: v }))}>
                <SelectTrigger id={`${contentId}-size`} aria-label="Label Size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LABEL_SIZE_PRESETS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_SIZE_KEY}>Custom…</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {size.sizeKey === CUSTOM_SIZE_KEY && (
              <div className="flex items-end gap-2">
                <FormField htmlFor={`${contentId}-width`} label="Width (mm)">
                  <Input
                    id={`${contentId}-width`} type="number" min={10} step="0.1" value={size.customWidthMm}
                    onChange={(e) => setSize((s) => ({ ...s, customWidthMm: Number(e.target.value) || 70 }))}
                  />
                </FormField>
                <FormField htmlFor={`${contentId}-height`} label="Height (mm)">
                  <Input
                    id={`${contentId}-height`} type="number" min={10} step="0.1" value={size.customHeightMm}
                    onChange={(e) => setSize((s) => ({ ...s, customHeightMm: Number(e.target.value) || 20 }))}
                  />
                </FormField>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
