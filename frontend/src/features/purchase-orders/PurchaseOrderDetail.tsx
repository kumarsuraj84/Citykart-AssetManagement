import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import type { Item } from "../items/types";
import { ItemFormDialog } from "../items/ItemFormDialog";
import { NewBrandDialog } from "@/components/quick-create/masters";
import { useCapabilities, canCreate as may } from "@/lib/capabilities";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { AddBundleDialog } from "./AddBundleDialog";
import { InvoicesCard, type InvoiceSummary } from "./InvoicesCard";
import { LineEditDialog, type EditTarget } from "./LineEditDialog";
import { CancelWaitingDialog, type CancelTarget } from "./CancelWaitingDialog";
import { PoHeaderEditDialog } from "./PoHeaderEditDialog";
import { PoLinesTable } from "./PoLinesTable";
import { type LineGroup, type Option, type PendingAssetRow, distinctLines, money } from "./po-detail-types";
import { linesAndUnitsSentence } from "./po-list";
import { clearPoFlash, peekPoFlash } from "./po-flash";
import { MAX_QUANTITY, quantityHint, quantityProblem } from "@/lib/limits";
import { DeliveryReminderBanner } from "../erp/DeliveryReminders";
import { ErpChangesPanel } from "../erp/ErpChanges";
import { workAreaLabel } from "@/lib/labels";
import { brandOptions, itemOptions, namesById } from "@/lib/option-labels";

interface PurchaseOrderOut {
  id: number;
  company_id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
  cost_center_id: number | null;
  delivery_asset_user_id?: number | null;
  warehouse_code?: string | null;
  erp_po_code?: number | null;
  vendor_name?: string | null;
}

/** AM-14: a compact KPI tile for the PO detail summary row (label + number). */
function SummaryTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// A person or place (the PO's delivery place is named in the header).
interface PlaceOption extends Option {
  asset_user_type?: string | null;
  company_id?: number | null;
  location_id?: number | null;
}

interface CategoryOption extends Option {
  // IT / NON_IT -- drives the read-only Work area preview on the Add Line
  // form; the backend independently re-derives it from this Category.
  asset_domain: string;
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

const plural = (n: number, one: string) => `${n.toLocaleString("en-IN")} ${one}${n === 1 ? "" : "s"}`;

/**
 * A purchase order, by LINE (S2): one row per line with Ordered / Received /
 * Waiting units, whatever the quantity. Receiving happens on the Receive
 * screen (S4: /receive/$poId, `?line=N` for one line); unit-level detail is
 * behind each line's "View units"; the invoices received come from one small
 * request (GET …/invoices), never from the unit list.
 */
export function PurchaseOrderDetail({ poId }: { poId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  // One plain sentence about the last thing done here (lines added, saved, cancelled).
  // S3b-2: the one-screen New Purchase Order hands over "PO created: …" for the first view.
  const [notice, setNotice] = useState<string | null>(() => peekPoFlash(poId));
  useEffect(() => clearPoFlash(poId), [poId]);

  const poQ = useQuery({
    queryKey: ["purchase-order", poId],
    queryFn: () => apiClient.get<PurchaseOrderOut>(`/purchase-orders/${poId}`),
  });
  // The PO's lines with their counts -- the primary view.
  const groupsQ = useQuery({
    queryKey: ["purchase-order", poId, "line-groups"],
    queryFn: () => apiClient.get<LineGroup[]>(`/purchase-orders/${poId}/line-groups`),
  });
  // S4: the invoices received under this PO -- one small request; no unit list is loaded.
  const invoicesQ = useQuery({
    queryKey: ["purchase-order", poId, "invoices"],
    queryFn: () => apiClient.get<InvoiceSummary[]>(`/purchase-orders/${poId}/invoices`),
  });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<CategoryOption[]>("/masters/categories") });
  const subcategoriesQ = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<(Option & { category_id: number })[]>("/masters/subcategories"),
  });
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", poQ.data?.company_id],
    queryFn: () => apiClient.get<Option[]>(`/masters/cost-centers?company_id=${poQ.data!.company_id}`),
    enabled: !!poQ.data,
  });
  const asset_usersQ = useQuery({
    queryKey: ["asset_users", poQ.data?.company_id],
    queryFn: () => apiClient.get<PlaceOption[]>(`/asset-users?company_id=${poQ.data!.company_id}`),
    enabled: !!poQ.data,
  });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Option[]>("/masters/brands") });
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const { caps } = useCapabilities();
  const [newItemForAdd, setNewItemForAdd] = useState(false);
  const [newBrandForAdd, setNewBrandForAdd] = useState(false);

  const items = itemsQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const subcategories = subcategoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const asset_users = asset_usersQ.data ?? [];
  const vendors = vendorsQ.data ?? [];
  const brands = brandsQ.data ?? [];
  const groups = Array.isArray(groupsQ.data) ? groupsQ.data : [];
  const invoices = Array.isArray(invoicesQ.data) ? invoicesQ.data : [];
  const costCenterName = (id: number | null) => (id == null ? "—" : costCenters.find((c) => c.id === id)?.name ?? String(id));
  const vendorName = (id: number | null) =>
    id == null ? "—" : vendors.find((v) => v.id === id)?.name ?? poQ.data?.vendor_name ?? String(id);
  const itemSelectOptions = itemOptions(items, { categories: namesById(categories), subcategories: namesById(subcategories) });
  const brandSelectOptions = brandOptions(brands);

  // Summary: units, counted by the server per line (the caller's work area).
  const totals = groups.reduce(
    (t, g) => ({
      ordered: t.ordered + g.ordered, received: t.received + g.received, waiting: t.waiting + g.waiting,
      value: t.value + (g.line_value ?? 0),
    }),
    { ordered: 0, received: 0, waiting: 0, value: 0 },
  );
  const groupsReady = groupsQ.isSuccess && Array.isArray(groupsQ.data);

  // Arriving from the Receive queue ("#po-lines"): bring the lines into view once they are there.
  const hash = useLocation({ select: (l) => l.hash });
  useEffect(() => {
    if (hash !== "po-lines" || !groupsReady) return;
    const el = document.getElementById("po-lines");
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, [hash, groupsReady]);

  // --- Add Line form (collapsed by default) ---
  const [showAddLine, setShowAddLine] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [lineForm, setLineForm] = useState({
    description: "", barcode: "", itemId: "",
    brandId: "", model: "", warrantyYears: "0",
    purchaseCost: "0", taxPercent: "0", quantity: "1",
  });
  const lineItem = items.find((i) => i.id === Number(lineForm.itemId));
  const lineCategory = lineItem ? categories.find((c) => c.id === lineItem.category_id) : undefined;
  const lineSubcategory = lineItem ? subcategories.find((s) => s.id === lineItem.subcategory_id) : undefined;
  // Picking an Item starts the brand and warranty from the Item's defaults (still editable).
  function pickLineItem(item: Item | undefined) {
    if (!item) return;
    setLineForm((f) => ({
      ...f, itemId: String(item.id),
      brandId: f.brandId || (item.default_brand_id ? String(item.default_brand_id) : ""),
      warrantyYears: f.warrantyYears === "0" && item.default_warranty_years != null ? String(item.default_warranty_years) : f.warrantyYears,
    }));
  }
  const canAddLine =
    lineForm.description.trim() !== "" &&
    lineForm.barcode.trim() !== "" &&
    lineForm.itemId !== "" &&
    Number(lineForm.purchaseCost) > 0 &&
    quantityProblem(lineForm.quantity) === null &&
    lineForm.warrantyYears.trim() !== "" &&
    Number(lineForm.warrantyYears) >= 0;

  function refreshPo() {
    qc.invalidateQueries({ queryKey: ["purchase-order", poId] });
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
  }

  function announceAdded(made: { line_no?: number | null }[], what: string) {
    setNotice(`${what}: ${linesAndUnitsSentence(distinctLines(made), made.length)}.`);
  }

  const addLineMutation = useMutation({
    mutationFn: () =>
      apiClient.post<PendingAssetRow[]>(`/purchase-orders/${poId}/lines`, {
        description: lineForm.description,
        barcode: lineForm.barcode || null,
        // The Item decides Category and Sub-Category (and the serial default) on the server.
        item_id: Number(lineForm.itemId),
        brand_id: lineForm.brandId ? Number(lineForm.brandId) : null,
        model: lineForm.model || null,
        warranty_years: Number(lineForm.warrantyYears) || 0,
        purchase_cost: Number(lineForm.purchaseCost) || 0,
        tax_percent: Number(lineForm.taxPercent) || 0,
        quantity: Number(lineForm.quantity),
      }),
    onSuccess: (made) => {
      refreshPo();
      announceAdded(Array.isArray(made) ? made : [], "Line added");
      setLineForm({
        description: "", barcode: "", itemId: "",
        brandId: "", model: "", warrantyYears: "0", purchaseCost: "0", taxPercent: "0", quantity: "1",
      });
    },
  });

  // --- Line / unit edit, cancel waiting ---
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editKey, setEditKey] = useState(0);
  function openEdit(t: EditTarget) {
    setEditKey((k) => k + 1);
    setEditTarget(t);
  }
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelKey, setCancelKey] = useState(0);
  function openCancel(t: CancelTarget) {
    setCancelKey((k) => k + 1);
    setCancelTarget(t);
  }

  // Cancelling one unit (from a line's units list) is immediate, as before.
  const cancelUnitMutation = useMutation({
    mutationFn: (unitId: number) => apiClient.post(`/purchase-orders/lines/${unitId}/cancel`),
    onSuccess: () => {
      refreshPo();
      setNotice("1 waiting unit cancelled.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete<{ cancelled_lines: number; deleted_assets: number }>(`/purchase-orders/${poId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate({ to: "/purchase-orders" });
    },
  });

  // --- Receive: the Receive screen, for the whole PO or one line (?line=N) ---
  function receiveLine(line: LineGroup) {
    navigate({ to: "/receive/$poId", params: { poId: String(poId) }, search: { line: line.line_no } });
  }
  function receiveAll() {
    navigate({ to: "/receive/$poId", params: { poId: String(poId) }, search: {} });
  }

  if (poQ.isError) return <ErrorState message="Couldn't load this purchase order." onRetry={() => poQ.refetch()} />;

  const po = poQ.data;
  const receivedIntoName = po?.delivery_asset_user_id
    ? asset_users.find((u) => u.id === po.delivery_asset_user_id)?.name ?? po.warehouse_code ?? ""
    : "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={po ? `Purchase Order ${po.po_number}` : "Purchase Order"}
        description={
          po
            ? `Vendor: ${vendorName(po.vendor_id)} · PO Date: ${po.po_date} · Cost Centre: ${costCenterName(po.cost_center_id)}` +
              (po.delivery_asset_user_id ? ` · Received Into: ${receivedIntoName}` : "")
            : undefined
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/purchase-orders">Close</Link>
            </Button>
            {po && (
              <Button variant="outline" disabled={!groupsReady} onClick={() => setHeaderOpen(true)}>
                Edit details
              </Button>
            )}
            {groupsReady && totals.waiting > 0 && (
              <Button variant="outline" onClick={() => openCancel({ kind: "po", waiting: totals.waiting })}>
                Cancel waiting items
              </Button>
            )}
            <Button onClick={receiveAll} disabled={!groupsReady || totals.waiting === 0}>
              Receive all waiting{groupsReady && totals.waiting > 0 ? ` (${totals.waiting})` : ""}
            </Button>
          </>
        }
      />

      {po?.erp_po_code != null && <ErpChangesPanel poId={poId} />}
      {po?.erp_po_code != null && <DeliveryReminderBanner poId={poId} fromErp />}

      {/* Units, counted per line by the server. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryTile label="Lines" value={groups.length} />
        <SummaryTile label="Ordered units" value={totals.ordered} />
        <SummaryTile label="Received units" value={totals.received} />
        <SummaryTile label="Waiting units" value={totals.waiting} />
        <SummaryTile label="Value" value={money(totals.value)} />
      </div>

      <section id="po-lines" className="flex scroll-mt-4 flex-col gap-2 rounded-md border p-3" aria-label="Lines">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Lines ({groups.length})</h2>
          <div className="flex gap-2">
            {!showAddLine && (
              <Button size="sm" variant="outline" onClick={() => setShowAddLine(true)}>
                + Add Line
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setBundleOpen(true)}>
              + Add Set
            </Button>
          </div>
        </div>

        {notice && (
          <p className="rounded-md border bg-muted/40 px-2 py-1.5 text-sm" role="status">{notice}</p>
        )}
        {cancelUnitMutation.isError && (
          <p className="text-sm text-destructive" role="alert">
            {cancelUnitMutation.error instanceof Error ? cancelUnitMutation.error.message : "Failed to cancel the unit."}
          </p>
        )}

        {showAddLine && (
          <div className="rounded-md border bg-muted/20 p-3">
            <h3 className="mb-2 text-sm font-semibold">Add Line</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FormField htmlFor="line-description" label="Description" required>
                <Input id="line-description" value={lineForm.description} onChange={(e) => setLineForm((f) => ({ ...f, description: e.target.value }))} />
              </FormField>
              <FormField htmlFor="line-barcode" label="Barcode" required helperText="CityKart's own internal tag — may repeat across assets.">
                <Input id="line-barcode" value={lineForm.barcode} onChange={(e) => setLineForm((f) => ({ ...f, barcode: e.target.value }))} />
              </FormField>
              <FormField
                htmlFor="line-item"
                label="Item"
                required
                helperText={lineItem ? `Category › Sub-category: ${[lineCategory?.name, lineSubcategory?.name].filter(Boolean).join(" › ")}` : "What this is. Its Category and Sub-category follow from it."}
              >
                <SearchableSelect
                  id="line-item"
                  value={selectValue(lineForm.itemId)}
                  onValueChange={(v) => pickLineItem(items.find((i) => i.id === Number(v)))}
                  options={itemSelectOptions}
                  onCreateNew={may(caps, "item") ? () => setNewItemForAdd(true) : undefined}
                  createLabel="New Item…"
                />
              </FormField>
              {lineForm.itemId && lineCategory && (
                <FormField htmlFor="line-work-area" label="Work area" helperText="Follows from the Item's Category.">
                  <Input id="line-work-area" value={workAreaLabel(lineCategory.asset_domain ?? "")} disabled readOnly />
                </FormField>
              )}
              <FormField htmlFor="line-cost" label="Cost" required>
                <Input id="line-cost" type="number" min={0.01} step="0.01" value={lineForm.purchaseCost} onChange={(e) => setLineForm((f) => ({ ...f, purchaseCost: e.target.value }))} />
              </FormField>
              <FormField htmlFor="line-tax" label="Tax %">
                <Input id="line-tax" type="number" value={lineForm.taxPercent} onChange={(e) => setLineForm((f) => ({ ...f, taxPercent: e.target.value }))} />
              </FormField>
              <FormField htmlFor="line-quantity" label="Quantity" required helperText={quantityHint()} errorText={quantityProblem(lineForm.quantity) ?? undefined}>
                <Input id="line-quantity" type="number" min={1} max={MAX_QUANTITY} step={1} value={lineForm.quantity} onChange={(e) => setLineForm((f) => ({ ...f, quantity: e.target.value }))} />
              </FormField>
              <FormField htmlFor="line-brand" label="Brand">
                <SearchableSelect
                  id="line-brand"
                  value={selectValue(lineForm.brandId)}
                  onValueChange={(v) => setLineForm((f) => ({ ...f, brandId: v }))}
                  options={brandSelectOptions}
                  onCreateNew={may(caps, "brand") ? () => setNewBrandForAdd(true) : undefined}
                  createLabel="New Brand…"
                />
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
          </div>
        )}

        {groupsQ.isError ? (
          <ErrorState
            message={groupsQ.error instanceof Error ? groupsQ.error.message : "Couldn't load the lines of this purchase order."}
            onRetry={() => groupsQ.refetch()}
          />
        ) : (
          <PoLinesTable
            poId={poId}
            lines={groups}
            isLoading={groupsQ.isLoading}
            onReceive={receiveLine}
            onEdit={(line) => openEdit({ kind: "line", line })}
            onCancelWaiting={(line) => openCancel({ kind: "line", line })}
            onEditUnit={(unit) => openEdit({ kind: "unit", unit })}
            onCancelUnit={(unit) => cancelUnitMutation.mutate(unit.id)}
          />
        )}
      </section>

      {invoices.length > 0 && <InvoicesCard poId={poId} invoices={invoices} fromErp={po?.erp_po_code != null} />}

      {/* De-emphasised and only offered while nothing has been received: once
          anything is received the server refuses (409) and the waiting items
          are cancelled instead. */}
      {groupsReady && totals.received === 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setDeleteOpen(true)}>
            Delete PO
          </Button>
        </div>
      )}

      {editTarget && (
        <LineEditDialog
          key={editKey}
          poId={poId}
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={setNotice}
          itemSelectOptions={itemSelectOptions}
          brandSelectOptions={brandSelectOptions}
        />
      )}

      {headerOpen && po && (
        <PoHeaderEditDialog
          po={po}
          receivedUnits={totals.received}
          deliveryPlaceName={receivedIntoName || undefined}
          onClose={() => setHeaderOpen(false)}
          onSaved={setNotice}
        />
      )}

      {cancelTarget && (
        <CancelWaitingDialog key={cancelKey} poId={poId} target={cancelTarget} onClose={() => setCancelTarget(null)} onDone={setNotice} />
      )}

      <ItemFormDialog
        open={newItemForAdd}
        onOpenChange={setNewItemForAdd}
        initialName={lineForm.description.trim() || undefined}
        onSaved={(saved) => pickLineItem(saved)}
      />
      <NewBrandDialog
        open={newBrandForAdd}
        onOpenChange={setNewBrandForAdd}
        onCreated={(row) => setLineForm((f) => ({ ...f, brandId: String(row.id) }))}
      />

      <AddBundleDialog poId={poId} open={bundleOpen} onOpenChange={setBundleOpen} onAdded={(made) => announceAdded(made, "Set added")} />

      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) deleteMutation.reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Purchase Order {po?.po_number}?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            {totals.waiting > 0 && (
              <p>{plural(totals.waiting, "waiting unit")} on {plural(groups.length, "line")} will be cancelled.</p>
            )}
            <p className="text-muted-foreground">Nothing has been received under this PO, so no assets are affected.</p>
          </div>
          {deleteMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete this purchase order."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Keep it
            </Button>
            {(deleteMutation.error as { status?: number } | null)?.status === 409 && totals.waiting > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteOpen(false);
                  deleteMutation.reset();
                  refreshPo();
                  openCancel({ kind: "po", waiting: totals.waiting });
                }}
              >
                Cancel waiting items instead
              </Button>
            )}
            <AsyncButton
              onClick={() => deleteMutation.mutate()}
              pending={deleteMutation.isPending}
              pendingLabel="Deleting…"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
