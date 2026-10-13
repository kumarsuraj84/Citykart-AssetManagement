import { splitAmounts, type Bundle } from "../bundles/bundle-parts";
import { Input } from "@/components/ui/input";

/**
 * The ONE "price per set → amount per part" table (S3b-2): used by the PO page's
 * Add Set dialog and by the one-screen New Purchase Order. The split rule itself
 * lives in ../bundles/bundle-parts (splitAmounts); the server re-checks the total.
 */

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The bundle's own split of `price`, as the editable strings the table holds ("" when there is no price yet). */
export function partAmountsFor(bundle: Bundle | undefined, price: number | string): Record<number, string> {
  const p = Number(price) || 0;
  if (!bundle) return {};
  const split = p > 0 ? splitAmounts(p, bundle.parts.map((x) => x.share_percent)) : bundle.parts.map(() => 0);
  return Object.fromEntries(bundle.parts.map((x, i) => [x.id, split[i] ? String(split[i]) : ""]));
}

/** Sum of the typed part amounts. */
export function partTotal(bundle: Bundle | undefined, amounts: Record<number, string>): number {
  return bundle ? bundle.parts.reduce((s, p) => s + (Number(amounts[p.id]) || 0), 0) : 0;
}

/** Every part has an amount above 0 and they add up to the price (to the paisa). */
export function partsMatchPrice(bundle: Bundle | undefined, amounts: Record<number, string>, price: number | string): boolean {
  if (!bundle) return false;
  return Math.abs(partTotal(bundle, amounts) - (Number(price) || 0)) < 0.005 && bundle.parts.every((p) => Number(amounts[p.id]) > 0);
}

/** `part_amounts` / `parts` of a request body. */
export function partAmountsPayload(bundle: Bundle, amounts: Record<number, string>) {
  return bundle.parts.map((p) => ({ part_id: p.id, amount: Number(amounts[p.id]) }));
}

export function SetPartAmounts({
  bundle, price, taxPercent, amounts, onAmountsChange, labelPrefix = "",
}: {
  bundle: Bundle;
  price: number | string;
  taxPercent: number | string;
  amounts: Record<number, string>;
  onAmountsChange: (next: Record<number, string>) => void;
  /** Put before "Amount for CPU" when several sets are on one screen ("Set 1 amount for CPU"). */
  labelPrefix?: string;
}) {
  const priceNum = Number(price) || 0;
  const tax = Number(taxPercent) || 0;
  const total = partTotal(bundle, amounts);
  const matches = Math.abs(total - priceNum) < 0.005;
  const label = (name: string) => (labelPrefix ? `${labelPrefix} amount for ${name}` : `Amount for ${name}`);
  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Part</th>
            <th className="px-2 py-1.5 font-medium">Serial</th>
            <th className="px-2 py-1.5 font-medium">Amount (before tax)</th>
            <th className="px-2 py-1.5 text-right font-medium">With tax</th>
          </tr>
        </thead>
        <tbody>
          {bundle.parts.map((p) => {
            const amt = Number(amounts[p.id]) || 0;
            return (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-2 py-1">{p.name}</td>
                <td className="px-2 py-1 text-xs text-muted-foreground">{p.serial_required ? "Needs serial" : "No serial"}</td>
                <td className="px-2 py-1">
                  <Input
                    aria-label={label(p.name)}
                    type="number" min={0} step="0.01" className="h-8 w-32"
                    value={amounts[p.id] ?? ""}
                    onChange={(e) => onAmountsChange({ ...amounts, [p.id]: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{money(amt * (1 + tax / 100))}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td className="px-2 py-1.5" colSpan={2}>Per set</td>
            <td className={`px-2 py-1.5 tabular-nums ${matches ? "" : "text-destructive"}`} role="status">
              {money(total)} {matches ? "(matches the price)" : `(must equal ${money(priceNum)})`}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{money(total * (1 + tax / 100))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
