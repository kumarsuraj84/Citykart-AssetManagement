import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/BundlesScreen";
import type { Item } from "./types";
import { NewBrandDialog, NewCategoryDialog, NewSubcategoryDialog, useCanCreateMasters } from "@/components/quick-create/masters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

interface Named {
  id: number;
  name: string;
}
interface Sub extends Named {
  category_id: number;
}

interface Draft {
  name: string;
  categoryId: string;
  subcategoryId: string;
  serial: "yes" | "no";
  bundleId: string;
  brandId: string;
  warranty: string;
}

const BLANK: Draft = { name: "", categoryId: "", subcategoryId: "", serial: "yes", bundleId: "", brandId: "", warranty: "" };

const SERIAL_OPTIONS = [
  { value: "yes", label: "Yes, it has a serial number" },
  { value: "no", label: "No serial number" },
];

/**
 * The Item form -- one dialog for Setup > Items and for every screen that needs an Item
 * it does not have yet (Add Asset, a PO line, the ERP review, a Bundle part, ERP
 * Articles), so nobody has to leave what they were doing. The Category and Sub-Category
 * can be created from here too.
 */
export function ItemFormDialog({
  open, onOpenChange, item, initialName, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null / undefined = a new Item. */
  item?: Item | null;
  /** Prefills the name of a new Item (for example the ERP product name). */
  initialName?: string;
  onSaved?: (saved: Item) => void;
}) {
  const qc = useQueryClient();
  const canCreate = useCanCreateMasters();
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Named[]>("/masters/categories"), enabled: open });
  const subsQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<Sub[]>("/masters/subcategories"), enabled: open });
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles"), enabled: open });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Named[]>("/masters/brands"), enabled: open });
  const categories = categoriesQ.data ?? [];
  const subs = subsQ.data ?? [];
  const bundles = bundlesQ.data ?? [];
  const brands = brandsQ.data ?? [];

  const [draft, setDraft] = useState<Draft>(BLANK);
  const [newCategory, setNewCategory] = useState(false);
  const [newSub, setNewSub] = useState(false);
  const [newBrand, setNewBrand] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    if (!open) return;
    saveMutation.reset();
    setDraft(
      item
        ? {
            name: item.name, categoryId: String(item.category_id), subcategoryId: item.subcategory_id ? String(item.subcategory_id) : "",
            serial: item.serial_required === false ? "no" : "yes", bundleId: item.bundle_id ? String(item.bundle_id) : "",
            brandId: item.default_brand_id ? String(item.default_brand_id) : "",
            warranty: item.default_warranty_years != null ? String(item.default_warranty_years) : "",
          }
        : { ...BLANK, name: initialName ?? "" },
    );
    // Starts fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name.trim(), category_id: Number(draft.categoryId), subcategory_id: Number(draft.subcategoryId),
        serial_required: draft.serial === "yes", bundle_id: draft.bundleId ? Number(draft.bundleId) : null,
        default_brand_id: draft.brandId ? Number(draft.brandId) : null,
        default_warranty_years: draft.warranty !== "" ? Number(draft.warranty) : null,
      };
      return item ? apiClient.put<Item>(`/items/${item.id}`, body) : apiClient.post<Item>("/items", body);
    },
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: ["items"] });
      onOpenChange(false);
      onSaved?.(saved);
    },
  });

  const canSave = draft.name.trim() !== "" && draft.categoryId !== "" && draft.subcategoryId !== "";
  const visibleSubs = subs.filter((s) => !draft.categoryId || s.category_id === Number(draft.categoryId));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">{item ? "Edit Item" : "New Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField htmlFor="item-name" label="Item name" required className="col-span-2">
              <Input id="item-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ceiling Fan" />
            </FormField>
            <FormField htmlFor="item-category" label="Category" required>
              <SearchableSelect
                id="item-category" value={draft.categoryId || undefined}
                onValueChange={(v) => set({ categoryId: v, subcategoryId: "" })}
                options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
                onCreateNew={canCreate ? () => setNewCategory(true) : undefined} createLabel="New Category…"
              />
            </FormField>
            <FormField htmlFor="item-subcategory" label="Sub-Category" required>
              <SearchableSelect
                id="item-subcategory" value={draft.subcategoryId || undefined} onValueChange={(v) => set({ subcategoryId: v })}
                options={visibleSubs.map((s) => ({ value: String(s.id), label: s.name }))}
                onCreateNew={canCreate ? () => setNewSub(true) : undefined} createLabel="New Sub-Category…"
              />
            </FormField>
            <FormField htmlFor="item-serial" label="Serial number" helperText="A default only: a serial can still be typed, or saved as N/A.">
              <SearchableSelect id="item-serial" value={draft.serial} onValueChange={(v) => set({ serial: v as Draft["serial"] })} options={SERIAL_OPTIONS} />
            </FormField>
            <FormField htmlFor="item-bundle" label="Becomes several assets (bundle)" helperText="For a Desktop-style item: one asset per part.">
              <SearchableSelect
                id="item-bundle" value={draft.bundleId || undefined} onValueChange={(v) => set({ bundleId: v })}
                options={[{ value: "", label: "No, a single asset" }, ...bundles.map((b) => ({ value: String(b.id), label: b.name }))]}
                placeholder="No, a single asset"
              />
            </FormField>
            <FormField htmlFor="item-brand" label="Default brand">
              <SearchableSelect
                id="item-brand" value={draft.brandId || undefined} onValueChange={(v) => set({ brandId: v })}
                options={[{ value: "", label: "None" }, ...brands.map((b) => ({ value: String(b.id), label: b.name }))]}
                placeholder="None"
                onCreateNew={canCreate ? () => setNewBrand(true) : undefined} createLabel="New Brand…"
              />
            </FormField>
            <FormField htmlFor="item-warranty" label="Default warranty (years)">
              <Input id="item-warranty" type="number" min={0} step={1} value={draft.warranty} onChange={(e) => set({ warranty: e.target.value })} />
            </FormField>
          </div>
          {saveMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {saveMutation.error instanceof Error ? saveMutation.error.message : "Could not save the Item."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <AsyncButton onClick={() => saveMutation.mutate()} disabled={!canSave} pending={saveMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewCategoryDialog open={newCategory} onOpenChange={setNewCategory} onCreated={(row) => set({ categoryId: String(row.id), subcategoryId: "" })} />
      <NewSubcategoryDialog
        open={newSub} onOpenChange={setNewSub} defaultCategoryId={draft.categoryId || undefined}
        onCreated={(row) => set({ categoryId: String(row.category_id), subcategoryId: String(row.id) })}
      />
      <NewBrandDialog open={newBrand} onOpenChange={setNewBrand} onCreated={(row) => set({ brandId: String(row.id) })} />
    </>
  );
}
