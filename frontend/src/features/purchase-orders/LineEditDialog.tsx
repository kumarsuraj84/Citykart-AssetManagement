import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { SearchableSelect, type SearchableSelectOption } from "@/components/shared/SearchableSelect";
import { NewBrandDialog } from "@/components/quick-create/masters";
import { canCreate as may, useCapabilities } from "@/lib/capabilities";
import { ItemFormDialog } from "../items/ItemFormDialog";
import { MAX_QUANTITY } from "@/lib/limits";
import { type LineGroup, type PendingAssetRow, lineTitle } from "./po-detail-types";

/** What is being edited: a whole PO line (S2, with its ordered quantity), or one unit of it (as before). */
export type EditTarget = { kind: "line"; line: LineGroup } | { kind: "unit"; unit: PendingAssetRow };

interface FormState {
  description: string;
  barcode: string;
  itemId: string;
  brandId: string;
  model: string;
  warrantyYears: string;
  purchaseCost: string;
  taxPercent: string;
  quantity: string;
}

function initialForm(t: EditTarget): FormState {
  const src = t.kind === "line"
    ? { ...t.line, purchase_cost: t.line.rate }
    : t.unit;
  return {
    description: src.description ?? "",
    barcode: src.barcode ?? "",
    itemId: src.item_id ? String(src.item_id) : "",
    brandId: src.brand_id ? String(src.brand_id) : "",
    model: src.model ?? "",
    warrantyYears: String(src.warranty_years ?? 0),
    purchaseCost: String(src.purchase_cost ?? 0),
    taxPercent: String(src.tax_percent ?? 0),
    quantity: t.kind === "line" ? String(t.line.ordered) : "",
  };
}

/**
 * The new ordered total of a line: a whole number from 0 to 1,000 and never
 * below what has already been received (the server refuses the same).
 * Null when fine.
 */
export function orderedQuantityProblem(value: string, received: number): string | null {
  const raw = value.trim();
  if (raw === "") return "Enter how many are ordered (0 to 1,000).";
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "Enter a whole number.";
  if (n < 0) return "Enter 0 or more.";
  if (n > MAX_QUANTITY) return `At most ${MAX_QUANTITY.toLocaleString("en-IN")}.`;
  if (n < received) {
    return `${received} of this line ${received === 1 ? "has" : "have"} already been received, so the quantity cannot be less than ${received}.`;
  }
  return null;
}

/** Only the fields that changed (the whole-line edit changes exactly what it is sent). */
export function lineEditPayload(line: LineGroup, form: FormState): Record<string, unknown> {
  const init = initialForm({ kind: "line", line });
  const body: Record<string, unknown> = {};
  if (form.description !== init.description) body.description = form.description;
  if (form.barcode !== init.barcode) body.barcode = form.barcode || null;
  if (form.itemId !== init.itemId) body.item_id = form.itemId ? Number(form.itemId) : null;
  if (form.brandId !== init.brandId) body.brand_id = form.brandId ? Number(form.brandId) : null;
  if (form.model !== init.model) body.model = form.model || null;
  if (Number(form.warrantyYears) !== Number(init.warrantyYears)) body.warranty_years = Number(form.warrantyYears) || 0;
  if (Number(form.purchaseCost) !== Number(init.purchaseCost)) body.purchase_cost = Number(form.purchaseCost) || 0;
  if (Number(form.taxPercent) !== Number(init.taxPercent)) body.tax_percent = Number(form.taxPercent) || 0;
  if (form.quantity.trim() !== "" && Number(form.quantity) !== line.ordered) body.quantity = Number(form.quantity);
  return body;
}

interface Props {
  poId: number;
  target: EditTarget | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  itemSelectOptions: SearchableSelectOption[];
  brandSelectOptions: SearchableSelectOption[];
}

/** Mount with a fresh `key` per target: the form starts from the target's values. */
export function LineEditDialog({ poId, target, onClose, onSaved, itemSelectOptions, brandSelectOptions }: Props) {
  const qc = useQueryClient();
  // "+ New Item…" / "+ New Brand…" for whoever may add them (capabilities endpoint).
  const { caps } = useCapabilities();
  const [form, setForm] = useState<FormState>(() =>
    target ? initialForm(target) : initialForm({ kind: "unit", unit: {} as PendingAssetRow }),
  );
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newBrandOpen, setNewBrandOpen] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const line = target?.kind === "line" ? target.line : null;
  const unit = target?.kind === "unit" ? target.unit : null;
  const qtyProblem = line ? orderedQuantityProblem(form.quantity, line.received) : null;
  // A line with nothing waiting can only have its ordered quantity raised (the new units take the edits).
  const fieldsEditable = !line || line.waiting > 0 || (qtyProblem === null && Number(form.quantity) > line.ordered);
  const payload = line ? lineEditPayload(line, form) : null;
  const changed = line ? Object.keys(payload!).length > 0 : true;

  // A unit edit sends every field, so all must be valid; a line edit sends
  // only what changed, so only those are checked (an old line without a
  // barcode can still have its quantity changed).
  const sends = (key: string) => !payload || key in payload;
  const fieldsValid =
    (!sends("description") || form.description.trim() !== "") &&
    (!sends("barcode") || form.barcode.trim() !== "") &&
    (!sends("purchase_cost") || Number(form.purchaseCost) > 0) &&
    (!sends("warranty_years") || (form.warrantyYears.trim() !== "" && Number(form.warrantyYears) >= 0));
  const canSave = !!target && changed && qtyProblem === null && fieldsValid;

  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (line) {
        const out = await apiClient.put<LineGroup>(`/purchase-orders/${poId}/line-groups/${line.line_no}`, payload);
        const g = out && typeof out === "object" && "ordered" in out ? out : null;
        return g
          ? `Line ${line.line_no} saved: ${g.ordered} ordered, ${g.received} received, ${g.waiting} waiting.`
          : `Line ${line.line_no} saved.`;
      }
      const u = unit!;
      await apiClient.put<PendingAssetRow>(`/purchase-orders/lines/${u.id}`, {
        description: form.description, barcode: form.barcode || null, category_id: u.category_id,
        subcategory_id: u.subcategory_id ?? null,
        // An Item, when the unit has one, decides Category and Sub-Category on the server.
        item_id: form.itemId ? Number(form.itemId) : null,
        brand_id: form.brandId ? Number(form.brandId) : null, model: form.model || null,
        warranty_years: Number(form.warrantyYears) || 0,
        purchase_cost: Number(form.purchaseCost) || 0, tax_percent: Number(form.taxPercent) || 0,
      });
      return "Unit saved.";
    },
    onSuccess: (message) => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      onSaved(message);
      onClose();
    },
  });

  const title = line ? `Edit line ${line.line_no}: ${lineTitle(line)}` : "Edit unit";

  return (
    <>
      <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-base">{title}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {line && (
              <p className="text-xs text-muted-foreground">
                Changes apply to the {line.waiting} waiting unit{line.waiting === 1 ? "" : "s"} of this line. Received and cancelled units are never changed.
              </p>
            )}
            {line && !fieldsEditable && (
              <p className="text-xs text-muted-foreground" role="note">
                Nothing on this line is waiting, so only the ordered quantity can be raised.
              </p>
            )}
            {line && (
              <FormField
                htmlFor="edit-quantity"
                label="Ordered"
                required
                helperText={`Units on this line: ${line.received} received + ${line.waiting} waiting. More adds waiting units; fewer cancels waiting units, newest first. 0 to 1,000, not below ${line.received}.`}
                errorText={qtyProblem ?? undefined}
              >
                <Input
                  id="edit-quantity" type="number" min={line.received} max={MAX_QUANTITY} step={1}
                  value={form.quantity} onChange={(e) => set({ quantity: e.target.value })}
                />
              </FormField>
            )}
            <FormField htmlFor="edit-description" label="Description" required>
              <Input id="edit-description" disabled={!fieldsEditable} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </FormField>
            <FormField htmlFor="edit-barcode" label="Barcode" required>
              <Input id="edit-barcode" disabled={!fieldsEditable} value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} />
            </FormField>
            <FormField htmlFor="edit-item" label="Item" helperText="Changing the Item also changes the Category and Sub-category.">
              <SearchableSelect
                id="edit-item"
                value={form.itemId || undefined}
                onValueChange={(v) => set({ itemId: v })}
                options={itemSelectOptions}
                disabled={!fieldsEditable}
                onCreateNew={may(caps, "item") ? () => setNewItemOpen(true) : undefined}
                createLabel="New Item…"
              />
            </FormField>
            <FormField htmlFor="edit-cost" label="Cost" required>
              <Input id="edit-cost" type="number" min={0.01} step="0.01" disabled={!fieldsEditable} value={form.purchaseCost} onChange={(e) => set({ purchaseCost: e.target.value })} />
            </FormField>
            <FormField htmlFor="edit-tax" label="Tax %">
              <Input id="edit-tax" type="number" disabled={!fieldsEditable} value={form.taxPercent} onChange={(e) => set({ taxPercent: e.target.value })} />
            </FormField>
            <FormField htmlFor="edit-brand" label="Brand">
              <SearchableSelect
                id="edit-brand"
                value={form.brandId || undefined}
                onValueChange={(v) => set({ brandId: v })}
                options={brandSelectOptions}
                disabled={!fieldsEditable}
                onCreateNew={may(caps, "brand") ? () => setNewBrandOpen(true) : undefined}
                createLabel="New Brand…"
              />
            </FormField>
            <FormField htmlFor="edit-model" label="Model">
              <Input id="edit-model" disabled={!fieldsEditable} value={form.model} onChange={(e) => set({ model: e.target.value })} />
            </FormField>
            <FormField htmlFor="edit-warranty-years" label="Warranty Years" required helperText="Enter 0 if there is no warranty.">
              <Input id="edit-warranty-years" type="number" min={0} step={1} disabled={!fieldsEditable} value={form.warrantyYears} onChange={(e) => set({ warrantyYears: e.target.value })} />
            </FormField>
          </div>
          {mutation.isError && (
            <p className="shrink-0 text-sm text-destructive" role="alert">
              {mutation.error instanceof Error ? mutation.error.message : "Failed to save."}
            </p>
          )}
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <AsyncButton onClick={() => mutation.mutate()} disabled={!canSave} pending={mutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ItemFormDialog
        open={newItemOpen}
        onOpenChange={setNewItemOpen}
        initialName={form.description.trim() || undefined}
        onSaved={(saved) => set({ itemId: String(saved.id) })}
      />
      <NewBrandDialog
        open={newBrandOpen}
        onOpenChange={setNewBrandOpen}
        onCreated={(row) => set({ brandId: String(row.id) })}
      />
    </>
  );
}
