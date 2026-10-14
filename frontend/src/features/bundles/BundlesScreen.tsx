import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { useCanCreate } from "@/lib/capabilities";
import { ItemFormDialog } from "../items/ItemFormDialog";
import type { Item } from "../items/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { namesById } from "@/lib/option-labels";
import { BundlePartsEditor } from "./BundlePartsEditor";
import {
  blankPart, desktopExample, draftPartsFromBundle, partsPayload, partsReady, partsSummary,
  type Bundle, type DraftPart,
} from "./bundle-parts";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

// The types live with the rest of the set logic (bundle-parts.ts); re-exported for existing imports.
export type { Bundle, BundlePart } from "./bundle-parts";

interface Named {
  id: number;
  name: string;
}

/**
 * Bundles: a direct link only since S6a -- sets are now made on the Item itself
 * (Settings › Catalogue › Items, "Comes as a set"). Kept so every existing set,
 * including one not tied to a single Item, can still be seen and changed.
 */
export function BundlesScreen() {
  const qc = useQueryClient();
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles") });
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Named[]>("/masters/categories") });
  const subcategoriesQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<Named[]>("/masters/subcategories") });
  const canCreate = useCanCreate("item");
  // A part is a single thing (CPU, Mouse), never an Item that is itself a bundle.
  const partItems = (itemsQ.data ?? []).filter((i) => i.bundle_id === null);
  const bundles = bundlesQ.data ?? [];
  const [newItemFor, setNewItemFor] = useState<number | null>(null);

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
    setParts(draftPartsFromBundle(b));
    setEditing(b);
  }
  function setPart(i: number, patch: Partial<DraftPart>) {
    setParts((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  const canSave = name.trim() !== "" && partsReady(parts);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), parts: partsPayload(parts) };
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
        description="A bundle (for example a Desktop) becomes ordinary lines on a Purchase Order, one per part, and each part is an Item of its own (CPU, TFT, Keyboard, Mouse). It is never an asset itself. New sets are usually made on the Item: Settings › Catalogue › Items, “Comes as a set”."
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
              <Button type="button" variant="outline" size="sm" onClick={() => { setName(name || "Desktop"); setParts(desktopExample()); }}>
                Use the Desktop example
              </Button>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            <BundlePartsEditor
              parts={parts}
              onChange={setParts}
              items={partItems}
              categories={namesById(categoriesQ.data)}
              subcategories={namesById(subcategoriesQ.data)}
              onNewItem={canCreate ? setNewItemFor : undefined}
            />
          </div>

          {saveMutation.isError && (
            <ErrorMessage className="shrink-0 text-sm text-destructive" error={saveMutation.error} message={saveMutation.error instanceof Error ? saveMutation.error.message : "Could not save the bundle."} />
          )}
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <AsyncButton onClick={() => saveMutation.mutate()} disabled={!canSave} pending={saveMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ItemFormDialog
        open={newItemFor !== null}
        onOpenChange={(open) => !open && setNewItemFor(null)}
        initialName={newItemFor !== null ? parts[newItemFor]?.name : undefined}
        allowSet={false}
        onSaved={(saved) => newItemFor !== null && setPart(newItemFor, { itemId: String(saved.id) })}
      />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Deactivate {deleting?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            It will no longer be offered on Purchase Orders. It is deactivated, not deleted: lines already created from it
            are not changed and its history is kept.
          </p>
          {deleteMutation.isError && (
            <ErrorMessage className="text-sm text-destructive" error={deleteMutation.error} message={deleteMutation.error instanceof Error ? deleteMutation.error.message : "Could not deactivate."} />
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
