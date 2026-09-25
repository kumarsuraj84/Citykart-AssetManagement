import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";

interface PurchaseOrderOut {
  id: number;
  company_id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
}

interface PendingAssetRow {
  id: number;
  purchase_order_id: number;
  description: string;
  category_id: number;
  subcategory_id: number | null;
  cost_center_id: number;
  purchase_cost: number | null;
  tax_percent: number | null;
  total_cost: number | null;
  status: "PENDING" | "DELIVERED" | "CANCELLED";
  serial_number: string | null;
  delivered_asset_id: number | null;
}

interface Option {
  id: number;
  name: string;
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

const LINE_STATUS_TONE: Record<string, string> = {
  PENDING: "border-transparent bg-warning-soft text-on-warning-soft",
  DELIVERED: "border-transparent bg-success-soft text-on-success-soft",
  CANCELLED: "border-transparent bg-secondary text-secondary-foreground",
};

function LineStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={LINE_STATUS_TONE[status] ?? "border-transparent bg-secondary"}>{status}</Badge>;
}

export function PurchaseOrderDetail({ poId }: { poId: number }) {
  const qc = useQueryClient();

  const poQ = useQuery({
    queryKey: ["purchase-order", poId],
    queryFn: () => apiClient.get<PurchaseOrderOut>(`/purchase-orders/${poId}`),
  });
  const linesQ = useQuery({
    queryKey: ["purchase-order", poId, "lines"],
    queryFn: () => apiClient.get<PendingAssetRow[]>(`/purchase-orders/${poId}/lines`),
  });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const subcategoriesQ = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<(Option & { category_id: number })[]>("/masters/subcategories"),
  });
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", poQ.data?.company_id],
    queryFn: () => apiClient.get<Option[]>(`/masters/cost-centers?company_id=${poQ.data!.company_id}`),
    enabled: !!poQ.data,
  });
  const holdersQ = useQuery({
    queryKey: ["holders", poQ.data?.company_id],
    queryFn: () => apiClient.get<Option[]>(`/holders?company_id=${poQ.data!.company_id}`),
    enabled: !!poQ.data,
  });

  const categories = categoriesQ.data ?? [];
  const subcategories = subcategoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const holders = holdersQ.data ?? [];
  const lines = linesQ.data ?? [];
  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? String(id);

  // --- Add Line form ---
  const [lineForm, setLineForm] = useState({
    description: "", categoryId: "", subcategoryId: "", costCenterId: "",
    purchaseCost: "0", taxPercent: "0", quantity: "1",
  });
  const visibleSubcategories = lineForm.categoryId
    ? subcategories.filter((s) => s.category_id === Number(lineForm.categoryId))
    : subcategories;
  const canAddLine = lineForm.description.trim() !== "" && lineForm.categoryId !== "" && lineForm.costCenterId !== "";

  const addLineMutation = useMutation({
    mutationFn: () =>
      apiClient.post<PendingAssetRow[]>(`/purchase-orders/${poId}/lines`, {
        description: lineForm.description,
        category_id: Number(lineForm.categoryId),
        subcategory_id: lineForm.subcategoryId ? Number(lineForm.subcategoryId) : null,
        cost_center_id: Number(lineForm.costCenterId),
        purchase_cost: Number(lineForm.purchaseCost) || 0,
        tax_percent: Number(lineForm.taxPercent) || 0,
        quantity: Number(lineForm.quantity) || 1,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      setLineForm({ description: "", categoryId: "", subcategoryId: "", costCenterId: "", purchaseCost: "0", taxPercent: "0", quantity: "1" });
    },
  });

  // --- Edit line dialog ---
  const [editingLine, setEditingLine] = useState<PendingAssetRow | null>(null);
  const [editForm, setEditForm] = useState({ description: "", categoryId: "", subcategoryId: "", costCenterId: "", purchaseCost: "0", taxPercent: "0" });

  function openEdit(line: PendingAssetRow) {
    setEditingLine(line);
    setEditForm({
      description: line.description, categoryId: String(line.category_id),
      subcategoryId: line.subcategory_id ? String(line.subcategory_id) : "",
      costCenterId: String(line.cost_center_id), purchaseCost: String(line.purchase_cost ?? 0),
      taxPercent: String(line.tax_percent ?? 0),
    });
  }

  const editMutation = useMutation({
    mutationFn: () =>
      apiClient.put<PendingAssetRow>(`/purchase-orders/lines/${editingLine!.id}`, {
        description: editForm.description, category_id: Number(editForm.categoryId),
        subcategory_id: editForm.subcategoryId ? Number(editForm.subcategoryId) : null,
        cost_center_id: Number(editForm.costCenterId),
        purchase_cost: Number(editForm.purchaseCost) || 0, tax_percent: Number(editForm.taxPercent) || 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      setEditingLine(null);
    },
  });

  // --- Cancel line ---
  const cancelMutation = useMutation({
    mutationFn: (lineId: number) => apiClient.post(`/purchase-orders/lines/${lineId}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] }),
  });

  // --- Selection + Delivery Done ---
  const [selected, setSelected] = useState<number[]>([]);
  function toggleOne(id: number, checked: boolean) {
    setSelected((s) => (checked ? [...s, id] : s.filter((x) => x !== id)));
  }

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [perLine, setPerLine] = useState<Record<number, { serial: string; holderId: string }>>({});

  function openDeliver() {
    deliverMutation.reset();
    setInvoiceNumber("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setInvoiceAmount("");
    setPerLine(Object.fromEntries(selected.map((id) => [id, { serial: "", holderId: "" }])));
    setDeliverOpen(true);
  }

  const selectedLines = useMemo(() => lines.filter((l) => selected.includes(l.id)), [lines, selected]);
  const canDeliver =
    invoiceNumber.trim() !== "" && invoiceDate !== "" && invoiceAmount !== "" &&
    selectedLines.every((l) => perLine[l.id]?.serial.trim() && perLine[l.id]?.holderId);

  const deliverMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/purchase-orders/${poId}/deliver`, {
        invoice_number: invoiceNumber, invoice_date: invoiceDate, invoice_amount: Number(invoiceAmount) || 0,
        lines: selectedLines.map((l) => ({
          pending_asset_id: l.id, serial_number: perLine[l.id].serial, initial_holder_id: Number(perLine[l.id].holderId),
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      setSelected([]);
      setDeliverOpen(false);
    },
  });

  const lineColumns: DataTableColumn<PendingAssetRow>[] = [
    {
      key: "select",
      header: "",
      cell: (l) =>
        l.status === "PENDING" ? (
          <Checkbox
            aria-label={`Select ${l.description}`}
            checked={selected.includes(l.id)}
            onCheckedChange={(checked) => toggleOne(l.id, checked === true)}
          />
        ) : null,
    },
    { key: "description", header: "Description", cell: (l) => l.description },
    { key: "category", header: "Category", cell: (l) => categoryName(l.category_id) },
    { key: "cost", header: "PO Value", headerClassName: "text-right", cellClassName: "text-right", cell: (l) => (l.total_cost ?? 0).toFixed(2) },
    { key: "status", header: "Status", cell: (l) => <LineStatusBadge status={l.status} /> },
    { key: "serial", header: "Serial No", cell: (l) => l.serial_number ?? "—" },
    {
      key: "actions",
      header: "",
      cell: (l) =>
        l.status === "PENDING" ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => openEdit(l)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate(l.id)}>
              Cancel
            </Button>
          </div>
        ) : null,
    },
  ];

  if (poQ.isError) return <ErrorState message="Couldn't load this purchase order." onRetry={() => poQ.refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={poQ.data ? `Purchase Order ${poQ.data.po_number}` : "Purchase Order"}
        description={poQ.data ? `PO Date: ${poQ.data.po_date}` : undefined}
        actions={
          <Button onClick={openDeliver} disabled={selected.length === 0}>
            Mark {selected.length > 0 ? selected.length : ""} Delivery Done
          </Button>
        }
      />

      <div className="rounded-md border p-4">
        <h2 className="mb-3 text-sm font-semibold">Add Line</h2>
        <div className="grid grid-cols-3 gap-3">
          <FormField htmlFor="line-description" label="Description" required>
            <Input id="line-description" value={lineForm.description} onChange={(e) => setLineForm((f) => ({ ...f, description: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-category" label="Category" required>
            <Select value={selectValue(lineForm.categoryId)} onValueChange={(v) => setLineForm((f) => ({ ...f, categoryId: v, subcategoryId: "" }))}>
              <SelectTrigger id="line-category">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField htmlFor="line-subcategory" label="Sub-Category">
            <Select value={selectValue(lineForm.subcategoryId)} onValueChange={(v) => setLineForm((f) => ({ ...f, subcategoryId: v }))}>
              <SelectTrigger id="line-subcategory">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {visibleSubcategories.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField htmlFor="line-cost-center" label="Cost Centre" required>
            <Select value={selectValue(lineForm.costCenterId)} onValueChange={(v) => setLineForm((f) => ({ ...f, costCenterId: v }))}>
              <SelectTrigger id="line-cost-center">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {costCenters.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField htmlFor="line-cost" label="Cost">
            <Input id="line-cost" type="number" value={lineForm.purchaseCost} onChange={(e) => setLineForm((f) => ({ ...f, purchaseCost: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-tax" label="Tax %">
            <Input id="line-tax" type="number" value={lineForm.taxPercent} onChange={(e) => setLineForm((f) => ({ ...f, taxPercent: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-quantity" label="Quantity">
            <Input id="line-quantity" type="number" min={1} value={lineForm.quantity} onChange={(e) => setLineForm((f) => ({ ...f, quantity: e.target.value }))} />
          </FormField>
        </div>
        {addLineMutation.isError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {addLineMutation.error instanceof Error ? addLineMutation.error.message : "Failed to add line."}
          </p>
        )}
        <div className="mt-3">
          <AsyncButton onClick={() => addLineMutation.mutate()} disabled={!canAddLine} pending={addLineMutation.isPending} pendingLabel="Adding…">
            Add Line
          </AsyncButton>
        </div>
      </div>

      <DataTable
        columns={lineColumns}
        rows={lines}
        rowKey={(l) => l.id}
        isLoading={linesQ.isLoading}
        emptyState={<EmptyState title="No lines added yet." />}
      />

      <Dialog open={editingLine !== null} onOpenChange={(open) => !open && setEditingLine(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit line</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <FormField htmlFor="edit-description" label="Description" required>
              <Input id="edit-description" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-cost" label="Cost">
              <Input id="edit-cost" type="number" value={editForm.purchaseCost} onChange={(e) => setEditForm((f) => ({ ...f, purchaseCost: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-tax" label="Tax %">
              <Input id="edit-tax" type="number" value={editForm.taxPercent} onChange={(e) => setEditForm((f) => ({ ...f, taxPercent: e.target.value }))} />
            </FormField>
          </div>
          {editMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {editMutation.error instanceof Error ? editMutation.error.message : "Failed to update line."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLine(null)}>
              Cancel
            </Button>
            <AsyncButton onClick={() => editMutation.mutate()} pending={editMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deliverOpen} onOpenChange={(open) => !open && setDeliverOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Mark {selectedLines.length} asset{selectedLines.length === 1 ? "" : "s"} delivered
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoice-number">Invoice No</Label>
              <Input id="invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoice-date">Invoice Date</Label>
              <Input id="invoice-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoice-amount">Invoice Amount</Label>
              <Input id="invoice-amount" type="number" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {selectedLines.map((l) => (
              <div key={l.id} className="grid grid-cols-3 items-end gap-3 rounded-md border p-3">
                <div className="col-span-3 text-sm font-medium">{l.description}</div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`serial-${l.id}`}>Serial Number</Label>
                  <Input
                    id={`serial-${l.id}`}
                    value={perLine[l.id]?.serial ?? ""}
                    onChange={(e) => setPerLine((p) => ({ ...p, [l.id]: { ...p[l.id], serial: e.target.value } }))}
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor={`holder-${l.id}`}>Initial Holder</Label>
                  <Select
                    value={selectValue(perLine[l.id]?.holderId ?? "")}
                    onValueChange={(v) => setPerLine((p) => ({ ...p, [l.id]: { ...p[l.id], holderId: v } }))}
                  >
                    <SelectTrigger id={`holder-${l.id}`}>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {holders.map((h) => (
                        <SelectItem key={h.id} value={String(h.id)}>
                          {h.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>

          {deliverMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {deliverMutation.error instanceof Error ? deliverMutation.error.message : "Failed to mark delivery done."}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverOpen(false)}>
              Cancel
            </Button>
            <AsyncButton onClick={() => deliverMutation.mutate()} disabled={!canDeliver} pending={deliverMutation.isPending} pendingLabel="Saving…">
              Confirm
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
