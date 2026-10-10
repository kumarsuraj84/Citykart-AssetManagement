import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/BundlesScreen";
import type { Item } from "./types";
import { ItemFormDialog } from "./ItemFormDialog";
import { yesNo } from "../../lib/serial-rule";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";

interface Named {
  id: number;
  name: string;
}
interface Sub extends Named {
  category_id: number;
}

/** Setup > Items: CityKart's own names for what an asset is. */
export function ItemsScreen() {
  const qc = useQueryClient();
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Named[]>("/masters/categories") });
  const subsQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<Sub[]>("/masters/subcategories") });
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles") });
  const items = itemsQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const subs = subsQ.data ?? [];
  const bundles = bundlesQ.data ?? [];

  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? "";
  const subName = (id: number | null) => (id ? subs.find((s) => s.id === id)?.name ?? "" : "");

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
    { key: "serial", header: "Serial number", cell: (i) => yesNo(i.serial_required) },
    { key: "bundle", header: "Bundle", cell: (i) => bundles.find((b) => b.id === i.bundle_id)?.name ?? "—" },
    { key: "maps", header: "ERP links", cellClassName: "tabular-nums", cell: (i) => (i.map_count === 0 ? "—" : i.map_count) },
    {
      key: "actions", header: "",
      cell: (i) => (
        <div className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => setEditing(i)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Deactivate ${i.name}`} onClick={() => { deleteMutation.reset(); setDeleting(i); }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Items"
        description="An Item is what an asset is, in CityKart's own words (for example Ceiling Fan, PoE Switch, UPS). It sits under a Category and a Sub-Category, and it is the only place that says whether the thing has a serial number. Many ERP item codes can point to one Item; link them under ERP Articles."
        actions={
          <>
            <Button asChild variant="outline"><Link to="/setup/erp-articles">ERP Articles</Link></Button>
            <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              Create from Sub-Categories
            </Button>
            <Button onClick={() => setEditing("new")}>New Item</Button>
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

      <ItemFormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        item={editing === "new" ? null : editing}
      />

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
