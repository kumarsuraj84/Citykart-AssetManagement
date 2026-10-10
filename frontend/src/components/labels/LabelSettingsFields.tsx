import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import { CUSTOM_SIZE_KEY, LABEL_SIZE_PRESETS, type LabelSymbol, type useLabelSettings } from "./AssetLabel";

/** What goes on the label, and the label stock in the printer. Remembered in this browser. */
export function LabelSettingsFields({ settings }: { settings: ReturnType<typeof useLabelSettings> }) {
  const { symbol, setSymbol, size, setSize } = settings;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <FormField htmlFor="label-symbol" label="Label Contains">
        <Select value={symbol} onValueChange={(v) => setSymbol(v as LabelSymbol)}>
          <SelectTrigger id="label-symbol" aria-label="Label Contains">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">Barcode + QR (QR opens the asset on a phone)</SelectItem>
            <SelectItem value="barcode">Barcode</SelectItem>
            <SelectItem value="qr">QR Code</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <FormField htmlFor="label-size" label="Label Size">
        <Select value={size.sizeKey} onValueChange={(v) => setSize((s) => ({ ...s, sizeKey: v }))}>
          <SelectTrigger id="label-size" aria-label="Label Size">
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
          <FormField htmlFor="label-width" label="Width (mm)">
            <Input
              id="label-width" type="number" min={10} step="0.1" value={size.customWidthMm}
              onChange={(e) => setSize((s) => ({ ...s, customWidthMm: Number(e.target.value) || 70 }))}
            />
          </FormField>
          <FormField htmlFor="label-height" label="Height (mm)">
            <Input
              id="label-height" type="number" min={10} step="0.1" value={size.customHeightMm}
              onChange={(e) => setSize((s) => ({ ...s, customHeightMm: Number(e.target.value) || 20 }))}
            />
          </FormField>
        </div>
      )}
    </div>
  );
}
