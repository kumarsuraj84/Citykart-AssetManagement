import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

export interface BundlePart {
  id: number;
  name: string;
  category_id: number;
  subcategory_id: number | null;
  serial_required: boolean;
  share_percent: number;
  sort_order: number;
}

export interface Bundle {
  id: number;
  name: string;
  is_active: boolean;
  parts: BundlePart[];
}

interface Option {
  id: number;
  name: string;
}

interface DraftPart {
  id: number | null;
  name: string;
  categoryId: string;
  subcategoryId: string;
  serialRequired: boolean;
  share: string;
}

const blankPart = (): DraftPart => ({ id: null, name: "", categoryId: "", subcategoryId: "", serialRequired: true, share: "" });

// The Desktop split the business uses; the categories still have to be picked.
const DESKTOP_EXAMPLE: DraftPart[] = [
  { id: null, name: "CPU", categoryId: "", subcategoryId: "", serialRequired: true, share: "70" },
  { id: null, name: "TFT", categoryId: "", subcategoryId: "", serialRequired: true, share: "26" },
  { id: null, name: "Keyboard", categoryId: "", subcategoryId: "", serialRequired: false, share: "2" },
  { id: null, name: "Mouse", categoryId: "", subcategoryId: "", serialRequired: false, share: "2" },
];

function partsSummary(parts: BundlePart[]): string {
  return parts.map((p) => `${p.name} ${p.share_percent}%`).join(", ");
}

export function BundlesScreen() {
  const qc = useQueryClient();
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles") });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const subcategoriesQ = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<(Option & { category_id: number })[]>("/masters/subcategories"),
  });
  const categories = categoriesQ.data ?? [];
  const subcategories = subcategoriesQ.data ?? [];
  const bundles = bundlesQ.data ?? [];

  // editing === null: dialog closed; editing === "new": creating; a Bundle: editing it.
  const [editing, setEditing] = useState<Bundle | "new" | null>(null);
  const [name, setName] = useState("");
  const [parts, setParts] = useState<DraftPart[]>([]);
  const [deleting, setDeleting] = useState<Bundle | null>(null);

  function openNew() {
    saveMutation.reset();
    setName("");
    setParts([blankPart()]);
    setEditing("new");
  }
  function openEdit(b: Bundle) {
    saveMutation.reset();
    setName(b.name);
    setParts(
      b.parts.map((p) => ({
        id: p.id, name: p.name, categoryId: String(p.category_id),
        subcategoryId: p.subcategory_id ? String(p.subcategory_id) : "", serialRequired: p.serial_required,
        share: String(p.share_percent),
      })),
    );
    setEditing(b);
  }
  function setPart(i: number, patch: Partial<DraftPart>) {
    setParts((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  const totalShare = parts.reduce((sum, p) => sum + (Number(p.share) || 0), 0);
  const totalOk = Math.abs(totalShare - 100) < 0.005;
  const canSave =
    name.trim() !== "" && parts.length > 0 && totalOk &&
    parts.every((p) => p.name.trim() !== "" && p.categoryId !== "" && Number(p.share) > 0);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        parts: parts.map((p) => ({
          id: p.id, name: p.name.trim(), category_id: Number(p.categoryId),
          subcategory_id: p.subcategoryId ? Number(p.subcategoryId) : null,
          serial_required: p.serialRequired, share_percent: Number(p.share),
        })),
      };
      return editing === "new" || editing === null
        ? apiClient.post("/bundles", body)
        : apiClient.put(`/bundles/${editing.id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bundles"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/bundles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bundles"] });
      setDeleting(null);
    },
  });

  const columns: DataTableColumn<Bundle>[] = [
    { key: "name", header: "Bundle", cellClassName: "font-medium", cell: (b) => b.name },
    { key: "parts", header: "Parts (share of the price)", cell: (b) => partsSummary(b.parts) },
    {
      key: "actions", header: "",
      cell: (b) => (
        <div className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label={`Edit ${b.name}`} onClick={() => openEdit(b)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Deactivate ${b.name}`} onClick={() => { deleteMutation.reset(); setDeleting(b); }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Bundles"
        description="A bundle (for example a Desktop) is a shortcut on a Purchase Order. It becomes ordinary lines, one per part, each in its own category. It is never an asset category."
        actions={<Button onClick={openNew}>New Bundle</Button>}
      />

      <DataTable
        columns={columns}
        rows={bundles}
        rowKey={(b) => b.id}
        isLoading={bundlesQ.isLoading}
        emptyState={<EmptyState title="No bundles yet." description="Create one, for example Desktop = CPU + TFT + Keyboard + Mouse." />}
      />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-base">{editing === "new" ? "New Bundle" : "Edit Bundle"}</DialogTitle>
          </DialogHeader>

          <div className="flex shrink-0 items-end gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="bundle-name" className="text-xs">
                Bundle name<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input id="bundle-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Desktop" />
            </div>
            {editing === "new" && (
              <Button type="button" variant="outline" size="sm" onClick={() => { setName(name || "Desktop"); setParts(DESKTOP_EXAMPLE.map((p) => ({ ...p }))); }}>
                Use the Desktop example
              </Button>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {parts.map((p, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-md border p-2">
                <div className="col-span-2 flex flex-col gap-1">
                  <Label htmlFor={`part-name-${i}`} className="text-xs">Part name</Label>
                  <Input id={`part-name-${i}`} value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} />
                </div>
                <div className="col-span-3 flex flex-col gap-1">
                  <Label htmlFor={`part-category-${i}`} className="text-xs">Category</Label>
                  <SearchableSelect
                    id={`part-category-${i}`}
                    value={p.categoryId || undefined}
                    onValueChange={(v) => setPart(i, { categoryId: v, subcategoryId: "" })}
                    options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
                  />
                </div>
                <div className="col-span-3 flex flex-col gap-1">
                  <Label htmlFor={`part-subcategory-${i}`} className="text-xs">Sub-Category</Label>
                  <SearchableSelect
                    id={`part-subcategory-${i}`}
                    value={p.subcategoryId || undefined}
                    onValueChange={(v) => setPart(i, { subcategoryId: v })}
                    options={subcategories
                      .filter((s) => !p.categoryId || s.category_id === Number(p.categoryId))
                      .map((s) => ({ value: String(s.id), label: s.name }))}
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <Label htmlFor={`part-share-${i}`} className="text-xs">Share %</Label>
                  <Input id={`part-share-${i}`} type="number" min={0} step="0.01" value={p.share} onChange={(e) => setPart(i, { share: e.target.value })} />
                </div>
                <label className="col-span-1 flex items-center gap-1.5 pb-2 text-xs">
                  <Checkbox
                    aria-label={`Needs serial number: ${p.name || `part ${i + 1}`}`}
                    checked={p.serialRequired}
                    onCheckedChange={(checked) => setPart(i, { serialRequired: checked === true })}
                  />
                  Serial
                </label>
                <Button
                  size="icon" variant="ghost" className="col-span-1" aria-label={`Remove ${p.name || `part ${i + 1}`}`}
                  disabled={parts.length === 1} onClick={() => setParts((ps) => ps.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={() => setParts((ps) => [...ps, blankPart()])}>
                + Add part
              </Button>
              <p className={`text-sm tabular-nums ${totalOk ? "text-muted-foreground" : "text-destructive"}`} role="status">
                Total {Math.round(totalShare * 100) / 100}% {totalOk ? "" : "(must be exactly 100%)"}
              </p>
            </div>
          </div>

          {saveMutation.isError && (
            <p className="shrink-0 text-sm text-destructive" role="alert">
              {saveMutation.error instanceof Error ? saveMutation.error.message : "Could not save the bundle."}
            </p>
          )}
          <DialogFooter className="shrink-0">
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
            It will no longer be offered on Purchase Orders. Lines already created from it are not changed.
          </p>
          {deleteMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Could not deactivate."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <AsyncButton
              variant="destructive"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              pending={deleteMutation.isPending}
              pendingLabel="Deactivating…"
            >
              Deactivate
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
