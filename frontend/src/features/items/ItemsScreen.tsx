import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/BundlesScreen";
import type { Item } from "./types";
import { SERIAL_SUBCATEGORY_OPTIONS, yesNo } from "../../lib/serial-rule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
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
  serial: "same" | "yes" | "no";
  bundleId: string;
  brandId: string;
  warranty: string;
}

const BLANK: Draft = { name: "", categoryId: "", subcategoryId: "", serial: "same", bundleId: "", brandId: "", warranty: "" };

const serialToApi = (s: Draft["serial"]) => (s === "yes" ? true : s === "no" ? false : null);
const serialFromApi = (v: boolean | null): Draft["serial"] => (v === true ? "yes" : v === false ? "no" : "same");

/** Setup > Items: CityKart's own names for what an asset is. */
export function ItemsScreen() {
  const qc = useQueryClient();
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Named[]>("/masters/categories") });
  const subsQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<Sub[]>("/masters/subcategories") });
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles") });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Named[]>("/masters/brands") });
  const items = itemsQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const subs = subsQ.data ?? [];
  const bundles = bundlesQ.data ?? [];
  const brands = brandsQ.data ?? [];

  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? "";
  const subName = (id: number | null) => (id ? subs.find((s) => s.id === id)?.name ?? "" : "");

  function openNew() {
    saveMutation.reset();
    setDraft(BLANK);
    setEditing("new");
  }
  function openEdit(i: Item) {
    saveMutation.reset();
    setDraft({
      name: i.name, categoryId: String(i.category_id), subcategoryId: i.subcategory_id ? String(i.subcategory_id) : "",
      serial: serialFromApi(i.serial_required), bundleId: i.bundle_id ? String(i.bundle_id) : "",
      brandId: i.default_brand_id ? String(i.default_brand_id) : "", warranty: i.default_warranty_years != null ? String(i.default_warranty_years) : "",
    });
    setEditing(i);
  }
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const canSave = draft.name.trim() !== "" && draft.categoryId !== "";

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name.trim(), category_id: Number(draft.categoryId),
        subcategory_id: draft.subcategoryId ? Number(draft.subcategoryId) : null,
        serial_required: serialToApi(draft.serial), bundle_id: draft.bundleId ? Number(draft.bundleId) : null,
        default_brand_id: draft.brandId ? Number(draft.brandId) : null,
        default_warranty_years: draft.warranty !== "" ? Number(draft.warranty) : null,
      };
      return editing === "new" || editing === null ? apiClient.post("/items", body) : apiClient.put(`/items/${editing.id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      setEditing(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/items/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      setDeleting(null);
    },
  });
  const seedMutation = useMutation({
    mutationFn: () => apiClient.post<{ created: number }>("/items/seed-from-subcategories", {}),
    onSuccess: (r) => {
      setSeeded(r.created);
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });

  const columns: DataTableColumn<Item>[] = [
    { key: "name", header: "Item", cellClassName: "font-medium", cell: (i) => i.name },
    {
      key: "class", header: "Category › Sub-Category",
      cell: (i) => [catName(i.category_id), subName(i.subcategory_id)].filter(Boolean).join(" › "),
    },
    {
      key: "serial", header: "Serial number",
      cell: (i) => (i.serial_required === null ? `Same as above (${yesNo(i.effective_serial_required)})` : yesNo(i.serial_required)),
    },
    { key: "bundle", header: "Bundle", cell: (i) => bundles.find((b) => b.id === i.bundle_id)?.name ?? "—" },
    { key: "maps", header: "ERP links", cellClassName: "tabular-nums", cell: (i) => (i.map_count === 0 ? "—" : i.map_count) },
    {
      key: "actions", header: "",
      cell: (i) => (
        <div className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => openEdit(i)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Deactivate ${i.name}`} onClick={() => { deleteMutation.reset(); setDeleting(i); }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  const visibleSubs = subs.filter((s) => !draft.categoryId || s.category_id === Number(draft.categoryId));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Items"
        description="An Item is what an asset is, in CityKart's own words (for example Cassette AC, Floor Gondola, UPS). Many ERP item codes can point to one Item; link them under ERP Articles."
        actions={
          <>
            <Button asChild variant="outline"><Link to="/setup/erp-articles">ERP Articles</Link></Button>
            <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              Create from Sub-Categories
            </Button>
            <Button onClick={openNew}>New Item</Button>
          </>
        }
      />
      {seeded !== null && (
        <p className="text-sm text-muted-foreground" role="status">
          {seeded === 0 ? "Every Sub-Category already has an Item." : `Created ${seeded} Item${seeded === 1 ? "" : "s"} from Sub-Categories.`}
        </p>
      )}
      {seedMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {seedMutation.error instanceof Error ? seedMutation.error.message : "Could not create the Items."}
        </p>
      )}

      <DataTable
        columns={columns} rows={items} rowKey={(i) => i.id} isLoading={itemsQ.isLoading}
        emptyState={<EmptyState title="No Items yet." description="Use Create from Sub-Categories to start from today's classification, or add one by hand." />}
      />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">{editing === "new" ? "New Item" : "Edit Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField htmlFor="item-name" label="Item name" required className="col-span-2">
              <Input id="item-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Cassette AC" />
            </FormField>
            <FormField htmlFor="item-category" label="Category" required>
              <SearchableSelect
                id="item-category" value={draft.categoryId || undefined}
                onValueChange={(v) => set({ categoryId: v, subcategoryId: "" })}
                options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
              />
            </FormField>
            <FormField htmlFor="item-subcategory" label="Sub-Category">
              <SearchableSelect
                id="item-subcategory" value={draft.subcategoryId || undefined} onValueChange={(v) => set({ subcategoryId: v })}
                options={visibleSubs.map((s) => ({ value: String(s.id), label: s.name }))}
              />
            </FormField>
            <FormField htmlFor="item-serial" label="Serial number" helperText="A default only: a serial can still be typed, or saved as N/A.">
              <SearchableSelect
                id="item-serial" value={draft.serial} onValueChange={(v) => set({ serial: v as Draft["serial"] })}
                options={SERIAL_SUBCATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.value === "same" ? "Same as the Sub-Category / Category" : o.label }))}
              />
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
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <AsyncButton onClick={() => saveMutation.mutate()} disabled={!canSave} pending={saveMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Deactivate {deleting?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            It will no longer be offered, and its ERP links stop applying. Assets already linked to it keep their link.
          </p>
          {deleteMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Could not deactivate."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <AsyncButton
              variant="destructive" onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              pending={deleteMutation.isPending} pendingLabel="Deactivating…"
            >
              Deactivate
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
