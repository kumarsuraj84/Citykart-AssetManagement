import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { cn } from "@/lib/utils";
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
  cost_center_id: number | null;
}

/** AM-14: a compact KPI tile for the PO detail summary row -- a smaller,
 * denser sibling of Dashboard's own KPI Card (that one needs a title+
 * description header slot; this one is just label+number, so it isn't
 * built out of `Card`/`CardHeader`/`CardContent` at all). */
function SummaryTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

interface PendingAssetRow {
  id: number;
  purchase_order_id: number;
  description: string;
  barcode: string | null;
  category_id: number;
  subcategory_id: number | null;
  brand: string | null;
  model: string | null;
  warranty_years: number | null;
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

// AM-16: dot + plain text, matching StatusBadge's own `compact` presentation
// for a dense table row (live A/B on Asset Register showed a real reduction
// in visual noise vs. a colored pill per row, status text still fully
// legible) -- this table isn't Asset.status, so it can't reuse StatusBadge
// itself, but reuses the identical compact dot pattern for one consistent
// "how a status reads in a table" rule across the app.
const LINE_STATUS_DOT: Record<string, string> = {
  PENDING: "bg-warning",
  DELIVERED: "bg-success",
  CANCELLED: "bg-secondary-foreground",
};

function LineStatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", LINE_STATUS_DOT[status] ?? "bg-secondary-foreground")} aria-hidden="true" />
      {status}
    </span>
  );
}

function ColumnSearchHeader({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1 py-1">
      <span>{label}</span>
      <Input
        aria-label={`Search ${label}`}
        placeholder="Search…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs font-normal"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
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
  // AM-14: the header previously named PO Date/Cost Centre but never Vendor --
  // the same master-list lookup PurchaseOrdersList.tsx already uses.
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });

  const categories = categoriesQ.data ?? [];
  const subcategories = subcategoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const holders = holdersQ.data ?? [];
  const vendors = vendorsQ.data ?? [];
  const lines = linesQ.data ?? [];
  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? String(id);
  const costCenterName = (id: number | null) => (id == null ? "—" : costCenters.find((c) => c.id === id)?.name ?? String(id));
  const vendorName = (id: number | null) => (id == null ? "—" : vendors.find((v) => v.id === id)?.name ?? String(id));

  // AM-14 summary row -- derived entirely from `lines`, already fetched for the
  // table below, so this costs zero extra requests. Value is every non-
  // cancelled line's own total_cost (matches the table's own "PO Value" column).
  const pendingCount = lines.filter((l) => l.status === "PENDING").length;
  const deliveredCount = lines.filter((l) => l.status === "DELIVERED").length;
  const totalValue = lines
    .filter((l) => l.status !== "CANCELLED")
    .reduce((sum, l) => sum + (l.total_cost ?? 0), 0);

  // --- Add Line form ---
  // AM-14: collapsed by default -- the form previously stayed permanently
  // expanded, always paying its vertical space even when nobody was adding a
  // line. Same fields/mutation/validation, purely a visibility toggle.
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineForm, setLineForm] = useState({
    description: "", barcode: "", categoryId: "", subcategoryId: "",
    brand: "", model: "", warrantyYears: "0",
    purchaseCost: "0", taxPercent: "0", quantity: "1",
  });
  const visibleSubcategories = lineForm.categoryId
    ? subcategories.filter((s) => s.category_id === Number(lineForm.categoryId))
    : subcategories;
  const canAddLine =
    lineForm.description.trim() !== "" &&
    lineForm.barcode.trim() !== "" &&
    lineForm.categoryId !== "" &&
    lineForm.subcategoryId !== "" &&
    Number(lineForm.purchaseCost) > 0 &&
    Number(lineForm.quantity) >= 1 &&
    lineForm.warrantyYears.trim() !== "" &&
    Number(lineForm.warrantyYears) >= 0;

  const addLineMutation = useMutation({
    mutationFn: () =>
      apiClient.post<PendingAssetRow[]>(`/purchase-orders/${poId}/lines`, {
        description: lineForm.description,
        barcode: lineForm.barcode || null,
        category_id: Number(lineForm.categoryId),
        subcategory_id: lineForm.subcategoryId ? Number(lineForm.subcategoryId) : null,
        brand: lineForm.brand || null,
        model: lineForm.model || null,
        warranty_years: Number(lineForm.warrantyYears) || 0,
        purchase_cost: Number(lineForm.purchaseCost) || 0,
        tax_percent: Number(lineForm.taxPercent) || 0,
        quantity: Number(lineForm.quantity) || 1,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      setLineForm({
        description: "", barcode: "", categoryId: "", subcategoryId: "",
        brand: "", model: "", warrantyYears: "0", purchaseCost: "0", taxPercent: "0", quantity: "1",
      });
    },
  });

  // --- Edit line dialog ---
  const [editingLine, setEditingLine] = useState<PendingAssetRow | null>(null);
  const [editForm, setEditForm] = useState({
    description: "", barcode: "", categoryId: "", subcategoryId: "",
    brand: "", model: "", warrantyYears: "0", purchaseCost: "0", taxPercent: "0",
  });

  function openEdit(line: PendingAssetRow) {
    setEditingLine(line);
    setEditForm({
      description: line.description, barcode: line.barcode ?? "", categoryId: String(line.category_id),
      subcategoryId: line.subcategory_id ? String(line.subcategory_id) : "",
      brand: line.brand ?? "", model: line.model ?? "", warrantyYears: String(line.warranty_years ?? 0),
      purchaseCost: String(line.purchase_cost ?? 0),
      taxPercent: String(line.tax_percent ?? 0),
    });
  }

  const canSaveEdit =
    editForm.description.trim() !== "" && editForm.barcode.trim() !== "" && Number(editForm.purchaseCost) > 0 &&
    editForm.warrantyYears.trim() !== "" && Number(editForm.warrantyYears) >= 0;

  const editMutation = useMutation({
    mutationFn: () =>
      apiClient.put<PendingAssetRow>(`/purchase-orders/lines/${editingLine!.id}`, {
        description: editForm.description, barcode: editForm.barcode || null, category_id: Number(editForm.categoryId),
        subcategory_id: editForm.subcategoryId ? Number(editForm.subcategoryId) : null,
        brand: editForm.brand || null, model: editForm.model || null,
        warranty_years: Number(editForm.warrantyYears) || 0,
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

  // --- Lines table: per-column search ---
  const [columnFilters, setColumnFilters] = useState({
    description: "", barcode: "", category: "", cost: "", status: "", serial: "",
  });
  function setColumnFilter(key: keyof typeof columnFilters, value: string) {
    setColumnFilters((f) => ({ ...f, [key]: value }));
  }
  const filteredLines = useMemo(() => {
    const f = columnFilters;
    return lines.filter((l) => {
      const cost = (l.total_cost ?? 0).toFixed(2);
      return (
        l.description.toLowerCase().includes(f.description.toLowerCase()) &&
        (l.barcode ?? "").toLowerCase().includes(f.barcode.toLowerCase()) &&
        categoryName(l.category_id).toLowerCase().includes(f.category.toLowerCase()) &&
        cost.includes(f.cost.toLowerCase()) &&
        l.status.toLowerCase().includes(f.status.toLowerCase()) &&
        (l.serial_number ?? "").toLowerCase().includes(f.serial.toLowerCase())
      );
    });
  }, [lines, columnFilters, categories]);

  // --- Selection + Delivery Done ---
  const [selected, setSelected] = useState<number[]>([]);
  function toggleOne(id: number, checked: boolean) {
    setSelected((s) => (checked ? [...s, id] : s.filter((x) => x !== id)));
  }

  // Select All acts only on the currently-visible (filtered) PENDING rows --
  // a hidden/filtered-out row's own selection state is never touched by it,
  // matching the requested "select all of what's currently filtered, or
  // everything if nothing is filtered" behavior.
  const selectableVisibleLines = useMemo(() => filteredLines.filter((l) => l.status === "PENDING"), [filteredLines]);
  const isAllVisibleSelected =
    selectableVisibleLines.length > 0 && selectableVisibleLines.every((l) => selected.includes(l.id));
  function toggleAllVisible(checked: boolean) {
    const visibleIds = new Set(selectableVisibleLines.map((l) => l.id));
    setSelected((s) =>
      checked ? [...new Set([...s, ...visibleIds])] : s.filter((id) => !visibleIds.has(id)),
    );
  }

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [perLine, setPerLine] = useState<Record<number, { serial: string; holderId: string; noSerial: boolean }>>({});

  function openDeliver() {
    deliverMutation.reset();
    setInvoiceNumber("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setInvoiceAmount("");
    setPerLine(Object.fromEntries(selected.map((id) => [id, { serial: "", holderId: "", noSerial: false }])));
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
      header: selectableVisibleLines.length > 0 ? (
        <Checkbox
          aria-label="Select all pending lines"
          checked={isAllVisibleSelected}
          onCheckedChange={(checked) => toggleAllVisible(checked === true)}
        />
      ) : null,
      cell: (l) =>
        l.status === "PENDING" ? (
          <Checkbox
            aria-label={`Select ${l.description}`}
            checked={selected.includes(l.id)}
            onCheckedChange={(checked) => toggleOne(l.id, checked === true)}
          />
        ) : null,
    },
    {
      key: "description",
      header: <ColumnSearchHeader label="Description" value={columnFilters.description} onChange={(v) => setColumnFilter("description", v)} />,
      cell: (l) => l.description,
    },
    {
      key: "barcode",
      header: <ColumnSearchHeader label="Barcode" value={columnFilters.barcode} onChange={(v) => setColumnFilter("barcode", v)} />,
      cell: (l) => l.barcode ?? "—",
    },
    {
      key: "category",
      header: <ColumnSearchHeader label="Category" value={columnFilters.category} onChange={(v) => setColumnFilter("category", v)} />,
      cell: (l) => categoryName(l.category_id),
    },
    {
      key: "cost",
      header: <ColumnSearchHeader label="PO Value" value={columnFilters.cost} onChange={(v) => setColumnFilter("cost", v)} />,
      headerClassName: "text-right", cellClassName: "text-right tabular-nums",
      cell: (l) => (l.total_cost ?? 0).toFixed(2),
    },
    {
      key: "status",
      header: <ColumnSearchHeader label="Status" value={columnFilters.status} onChange={(v) => setColumnFilter("status", v)} />,
      cell: (l) => <LineStatusBadge status={l.status} />,
    },
    {
      key: "serial",
      header: <ColumnSearchHeader label="Serial No" value={columnFilters.serial} onChange={(v) => setColumnFilter("serial", v)} />,
      cell: (l) => l.serial_number ?? "—",
    },
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
    <div className="flex flex-col gap-4">
      <PageHeader
        title={poQ.data ? `Purchase Order ${poQ.data.po_number}` : "Purchase Order"}
        description={
          poQ.data
            ? `Vendor: ${vendorName(poQ.data.vendor_id)} · PO Date: ${poQ.data.po_date} · Cost Centre: ${costCenterName(poQ.data.cost_center_id)}`
            : undefined
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/purchase-orders">Close</Link>
            </Button>
            <Button onClick={openDeliver} disabled={selected.length === 0}>
              Mark {selected.length > 0 ? selected.length : ""} Delivery Done
            </Button>
          </>
        }
      />

      {/* AM-14: a KPI summary row, derived from the already-fetched `lines` --
          the page previously had no at-a-glance sense of this PO's overall
          size/progress/value without reading every table row. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Total Lines" value={lines.length} />
        <SummaryTile label="Pending" value={pendingCount} />
        <SummaryTile label="Delivered" value={deliveredCount} />
        <SummaryTile label="Value" value={totalValue.toFixed(2)} />
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add Line</h2>
          {!showAddLine && (
            <Button size="sm" variant="outline" onClick={() => setShowAddLine(true)}>
              + Add Line
            </Button>
          )}
        </div>
        {showAddLine && (
        <>
        <div className="grid grid-cols-3 gap-2">
          <FormField htmlFor="line-description" label="Description" required>
            <Input id="line-description" value={lineForm.description} onChange={(e) => setLineForm((f) => ({ ...f, description: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-barcode" label="Barcode" required helperText="CityKart's own internal tag — may repeat across assets.">
            <Input id="line-barcode" value={lineForm.barcode} onChange={(e) => setLineForm((f) => ({ ...f, barcode: e.target.value }))} />
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
          <FormField htmlFor="line-subcategory" label="Sub-Category" required>
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
          <FormField htmlFor="line-cost" label="Cost" required>
            <Input id="line-cost" type="number" min={0.01} step="0.01" value={lineForm.purchaseCost} onChange={(e) => setLineForm((f) => ({ ...f, purchaseCost: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-tax" label="Tax %">
            <Input id="line-tax" type="number" value={lineForm.taxPercent} onChange={(e) => setLineForm((f) => ({ ...f, taxPercent: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-quantity" label="Quantity" required>
            <Input id="line-quantity" type="number" min={1} value={lineForm.quantity} onChange={(e) => setLineForm((f) => ({ ...f, quantity: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-brand" label="Brand">
            <Input id="line-brand" value={lineForm.brand} onChange={(e) => setLineForm((f) => ({ ...f, brand: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-model" label="Model">
            <Input id="line-model" value={lineForm.model} onChange={(e) => setLineForm((f) => ({ ...f, model: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-warranty-years" label="Warranty Years" required helperText="Enter 0 if there is no warranty.">
            <Input id="line-warranty-years" type="number" min={0} step={1} value={lineForm.warrantyYears} onChange={(e) => setLineForm((f) => ({ ...f, warrantyYears: e.target.value }))} />
          </FormField>
        </div>
        {addLineMutation.isError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {addLineMutation.error instanceof Error ? addLineMutation.error.message : "Failed to add line."}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <AsyncButton onClick={() => addLineMutation.mutate()} disabled={!canAddLine} pending={addLineMutation.isPending} pendingLabel="Adding…">
            Add Line
          </AsyncButton>
          <Button variant="ghost" onClick={() => setShowAddLine(false)}>
            Cancel
          </Button>
        </div>
        </>
        )}
      </div>

      <DataTable
        columns={lineColumns}
        rows={filteredLines}
        rowKey={(l) => l.id}
        isLoading={linesQ.isLoading}
        emptyState={<EmptyState title={lines.length === 0 ? "No lines added yet." : "No lines match the current search."} />}
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
            <FormField htmlFor="edit-barcode" label="Barcode" required>
              <Input id="edit-barcode" value={editForm.barcode} onChange={(e) => setEditForm((f) => ({ ...f, barcode: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-cost" label="Cost" required>
              <Input id="edit-cost" type="number" min={0.01} step="0.01" value={editForm.purchaseCost} onChange={(e) => setEditForm((f) => ({ ...f, purchaseCost: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-tax" label="Tax %">
              <Input id="edit-tax" type="number" value={editForm.taxPercent} onChange={(e) => setEditForm((f) => ({ ...f, taxPercent: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-brand" label="Brand">
              <Input id="edit-brand" value={editForm.brand} onChange={(e) => setEditForm((f) => ({ ...f, brand: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-model" label="Model">
              <Input id="edit-model" value={editForm.model} onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-warranty-years" label="Warranty Years" required helperText="Enter 0 if there is no warranty.">
              <Input id="edit-warranty-years" type="number" min={0} step={1} value={editForm.warrantyYears} onChange={(e) => setEditForm((f) => ({ ...f, warrantyYears: e.target.value }))} />
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
            <AsyncButton onClick={() => editMutation.mutate()} disabled={!canSaveEdit} pending={editMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deliverOpen} onOpenChange={(open) => !open && setDeliverOpen(false)}>
        {/* flex flex-col + max-h + overflow-hidden caps the dialog to the
            viewport; only the per-line list below scrolls (flex-1 min-h-0),
            so Cancel/Confirm in the footer stay reachable no matter how many
            lines were selected -- previously the dialog just grew past the
            viewport with no way to scroll down to them. */}
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-base">
              Mark {selectedLines.length} asset{selectedLines.length === 1 ? "" : "s"} delivered
            </DialogTitle>
          </DialogHeader>

          <div className="grid shrink-0 grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="invoice-number" className="text-xs">Invoice No</Label>
              <Input id="invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="invoice-date" className="text-xs">Invoice Date</Label>
              <Input id="invoice-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="invoice-amount" className="text-xs">Invoice Amount</Label>
              <Input id="invoice-amount" type="number" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {selectedLines.map((l) => (
              <div key={l.id} className="grid grid-cols-3 items-end gap-2 rounded-md border p-2">
                <div className="col-span-3 truncate text-xs font-medium">{l.description}</div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`serial-${l.id}`} className="text-xs">
                    Serial Number<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id={`serial-${l.id}`}
                    value={perLine[l.id]?.serial ?? ""}
                    disabled={perLine[l.id]?.noSerial}
                    onChange={(e) => setPerLine((p) => ({ ...p, [l.id]: { ...p[l.id], serial: e.target.value } }))}
                  />
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      aria-label={`No serial number for ${l.description}`}
                      checked={perLine[l.id]?.noSerial ?? false}
                      onCheckedChange={(checked) => {
                        const noSerial = checked === true;
                        setPerLine((p) => ({ ...p, [l.id]: { ...p[l.id], noSerial, serial: noSerial ? "N/A" : "" } }));
                      }}
                    />
                    No serial number
                  </label>
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <Label htmlFor={`holder-${l.id}`} className="text-xs">
                    Initial Holder<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                  </Label>
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
            <p className="shrink-0 text-sm text-destructive" role="alert">
              {deliverMutation.error instanceof Error ? deliverMutation.error.message : "Failed to mark delivery done."}
            </p>
          )}

          <DialogFooter className="shrink-0">
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
