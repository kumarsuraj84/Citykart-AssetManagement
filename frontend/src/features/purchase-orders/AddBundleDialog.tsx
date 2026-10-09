import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/BundlesScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

/** Each part's amount = price x share%, to the paisa; leftover paise go to the
 * biggest share so the parts add up to the price exactly (mirrors
 * app.bundles.service.split_amounts, which re-checks the total on the server). */
export function splitAmounts(price: number, shares: number[]): number[] {
  const priceP = Math.round(price * 100);
  const amounts = shares.map((s) => Math.round((priceP * s) / 100));
  const diff = priceP - amounts.reduce((a, b) => a + b, 0);
  if (diff !== 0 && amounts.length > 0) {
    let biggest = 0;
    shares.forEach((s, i) => { if (s > shares[biggest]) biggest = i; });
    amounts[biggest] += diff;
  }
  return amounts.map((a) => a / 100);
}

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  poId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddBundleDialog({ poId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles"), enabled: open });
  const bundles = bundlesQ.data ?? [];

  const [bundleId, setBundleId] = useState("");
  const [description, setDescription] = useState("");
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [taxPercent, setTaxPercent] = useState("18");
  const [warrantyYears, setWarrantyYears] = useState("0");
  // Per-part amounts as typed; reset to the bundle's split whenever the
  // bundle or the price changes, then freely editable.
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  const bundle = bundles.find((b) => String(b.id) === bundleId);
  const priceNum = Number(price) || 0;

  useEffect(() => {
    if (!open) return;
    setBundleId("");
    setDescription("");
    setBarcode("");
    setQuantity("1");
    setPrice("");
    setTaxPercent("18");
    setWarrantyYears("0");
    setAmounts({});
    addMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!bundle) { setAmounts({}); return; }
    const split = priceNum > 0 ? splitAmounts(priceNum, bundle.parts.map((p) => p.share_percent)) : bundle.parts.map(() => 0);
    setAmounts(Object.fromEntries(bundle.parts.map((p, i) => [p.id, split[i] ? String(split[i]) : ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId, price, bundles.length]);

  const qty = Number(quantity) || 0;
  const tax = Number(taxPercent) || 0;
  const partTotal = useMemo(
    () => (bundle ? bundle.parts.reduce((sum, p) => sum + (Number(amounts[p.id]) || 0), 0) : 0),
    [bundle, amounts],
  );
  const totalMatches = Math.abs(partTotal - priceNum) < 0.005;
  const canAdd =
    !!bundle && description.trim() !== "" && barcode.trim() !== "" && qty >= 1 && priceNum > 0 &&
    totalMatches && bundle.parts.every((p) => Number(amounts[p.id]) > 0);

  const addMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/purchase-orders/${poId}/bundle-lines`, {
        bundle_id: Number(bundleId), description: description.trim(), barcode: barcode.trim(),
        quantity: qty, price: priceNum, tax_percent: tax, warranty_years: Number(warrantyYears) || 0,
        parts: bundle!.parts.map((p) => ({ part_id: p.id, amount: Number(amounts[p.id]) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      onOpenChange(false);
    },
  });

  const lineCount = bundle ? bundle.parts.length * qty : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-base">Add Bundle</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {!bundlesQ.isLoading && bundles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bundles are set up yet. The Primary Owner can create one under Masters, Bundles.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <FormField htmlFor="bundle-pick" label="Bundle" required>
                  <SearchableSelect
                    id="bundle-pick"
                    value={bundleId || undefined}
                    onValueChange={setBundleId}
                    options={bundles.map((b) => ({ value: String(b.id), label: b.name }))}
                  />
                </FormField>
                <FormField htmlFor="bundle-description" label="Description" required helperText="Each part's line is named “Description - Part”.">
                  <Input id="bundle-description" value={description} onChange={(e) => setDescription(e.target.value)} />
                </FormField>
                <FormField htmlFor="bundle-barcode" label="Barcode" required helperText="The same barcode goes on every part.">
                  <Input id="bundle-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                </FormField>
                <FormField htmlFor="bundle-quantity" label="Quantity" required>
                  <Input id="bundle-quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </FormField>
                <FormField htmlFor="bundle-price" label="Price per bundle (before tax)" required>
                  <Input id="bundle-price" type="number" min={0.01} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                </FormField>
                <FormField htmlFor="bundle-tax" label="Tax %">
                  <Input id="bundle-tax" type="number" min={0} value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
                </FormField>
                <FormField htmlFor="bundle-warranty" label="Warranty Years" helperText="Enter 0 if there is no warranty.">
                  <Input id="bundle-warranty" type="number" min={0} step={1} value={warrantyYears} onChange={(e) => setWarrantyYears(e.target.value)} />
                </FormField>
              </div>

              {bundle && (
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
                                aria-label={`Amount for ${p.name}`}
                                type="number" min={0} step="0.01" className="h-8 w-32"
                                value={amounts[p.id] ?? ""}
                                onChange={(e) => setAmounts((a) => ({ ...a, [p.id]: e.target.value }))}
                              />
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{money(amt * (1 + tax / 100))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="font-medium">
                        <td className="px-2 py-1.5" colSpan={2}>Per bundle</td>
                        <td className={`px-2 py-1.5 tabular-nums ${totalMatches ? "" : "text-destructive"}`} role="status">
                          {money(partTotal)} {totalMatches ? "(matches the price)" : `(must equal ${money(priceNum)})`}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(partTotal * (1 + tax / 100))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {bundle && qty >= 1 && (
                <p className="text-sm text-muted-foreground">
                  This will add {lineCount} line{lineCount === 1 ? "" : "s"}: {bundle.parts.map((p) => `${qty} ${p.name}`).join(", ")}.
                </p>
              )}
            </>
          )}
        </div>

        {addMutation.isError && (
          <p className="shrink-0 text-sm text-destructive" role="alert">
            {addMutation.error instanceof Error ? addMutation.error.message : "Failed to add the bundle."}
          </p>
        )}
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <AsyncButton onClick={() => addMutation.mutate()} disabled={!canAdd} pending={addMutation.isPending} pendingLabel="Adding…">
            Add Bundle
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
