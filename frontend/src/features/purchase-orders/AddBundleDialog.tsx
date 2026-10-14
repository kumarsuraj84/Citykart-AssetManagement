import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { splitAmounts, type Bundle } from "../bundles/bundle-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { MAX_QUANTITY, quantityHint, quantityProblem } from "@/lib/limits";
import { linesAndUnitsSentence } from "./po-list";
import { useCanManage } from "@/lib/capabilities";
import { SetPartAmounts, partAmountsFor, partAmountsPayload, partsMatchPrice } from "./SetPartAmounts";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

// The split itself lives in ../bundles/bundle-parts (one copy for the whole app);
// re-exported here for existing imports.
export { splitAmounts };

interface Props {
  poId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The units the server made (one entry per unit; `line_no` tells the lines apart). */
  onAdded?: (units: { line_no?: number | null }[]) => void;
}

// A set (bundle) is said as a "set" on the purchase order: one line per part,
// each holding `quantity` units.
export function AddBundleDialog({ poId, open, onOpenChange, onAdded }: Props) {
  const qc = useQueryClient();
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles"), enabled: open });
  const bundles = bundlesQ.data ?? [];
  // Sets are made by the head-office admin (capabilities: can_manage.bundle).
  const mayMakeSets = useCanManage("bundle");

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
    setAmounts(partAmountsFor(bundle, priceNum));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId, price, bundles.length]);

  const qty = Number(quantity) || 0;
  const tax = Number(taxPercent) || 0;
  const canAdd =
    !!bundle && description.trim() !== "" && barcode.trim() !== "" && quantityProblem(quantity) === null && priceNum > 0 &&
    partsMatchPrice(bundle, amounts, priceNum);

  const addMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ line_no?: number | null }[]>(`/purchase-orders/${poId}/bundle-lines`, {
        bundle_id: Number(bundleId), description: description.trim(), barcode: barcode.trim(),
        quantity: qty, price: priceNum, tax_percent: tax, warranty_years: Number(warrantyYears) || 0,
        parts: partAmountsPayload(bundle!, amounts),
      }),
    onSuccess: (units) => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      onAdded?.(Array.isArray(units) ? units : []);
      onOpenChange(false);
    },
  });

  // One line per part; each line holds `qty` units.
  const lineCount = bundle ? bundle.parts.length : 0;
  const unitCount = lineCount * qty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-base">Add Set</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {!bundlesQ.isLoading && bundles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {mayMakeSets
                ? "No sets are set up yet. Make one on an Item (Settings › Catalogue › Items, “Comes as a set”)."
                : "No sets are set up yet. Ask the head-office admin to make one (an Item that “Comes as a set”)."}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <FormField htmlFor="bundle-pick" label="Set" required>
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
                <FormField htmlFor="bundle-quantity" label="Quantity" required helperText={quantityHint()} errorText={quantityProblem(quantity) ?? undefined}>
                  <Input id="bundle-quantity" type="number" min={1} max={MAX_QUANTITY} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </FormField>
                <FormField htmlFor="bundle-price" label="Price per set (before tax)" required>
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
                <SetPartAmounts bundle={bundle} price={price} taxPercent={taxPercent} amounts={amounts} onAmountsChange={setAmounts} />
              )}

              {bundle && quantityProblem(quantity) === null && (
                <p className="text-sm text-muted-foreground">
                  This will add {linesAndUnitsSentence(lineCount, unitCount)}: {bundle.parts.map((p) => `${qty} ${p.name}`).join(", ")}.
                </p>
              )}
            </>
          )}
        </div>

        {addMutation.isError && (
          <ErrorMessage className="shrink-0 text-sm text-destructive" error={addMutation.error} message={addMutation.error instanceof Error ? addMutation.error.message : "Failed to add the set."} />
        )}
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <AsyncButton onClick={() => addMutation.mutate()} disabled={!canAdd} pending={addMutation.isPending} pendingLabel="Adding…">
            Add Set
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
