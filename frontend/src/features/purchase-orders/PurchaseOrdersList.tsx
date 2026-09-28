import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";

interface PurchaseOrderRow {
  id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
  // AM-14: PurchaseOrderOut already returns cost_center_id (backend/app/
  // purchase_orders/schemas.py) -- the frontend just never declared or
  // rendered it. Reading an already-returned field is not a backend change.
  cost_center_id: number | null;
}

interface Option {
  id: number;
  name: string;
}

const columns = (
  vendorNames: Record<number, string>,
  costCenterNames: Record<number, string>,
): DataTableColumn<PurchaseOrderRow>[] => [
  {
    key: "po_number",
    header: "PO No",
    cellClassName: "font-medium",
    // A real, independently keyboard-focusable link -- the row's own onClick
    // below is a mouse-convenience shortcut to the same destination, matching
    // Asset Register's own established row-navigation pattern.
    cell: (po) => (
      <Link to="/purchase-orders/$id" params={{ id: String(po.id) }} onClick={(e) => e.stopPropagation()}>
        {po.po_number}
      </Link>
    ),
  },
  { key: "po_date", header: "PO Date", cell: (po) => po.po_date },
  { key: "vendor", header: "Vendor", cell: (po) => (po.vendor_id ? (vendorNames[po.vendor_id] ?? "—") : "—") },
  {
    key: "cost_center",
    header: "Cost Centre",
    cell: (po) => (po.cost_center_id ? (costCenterNames[po.cost_center_id] ?? "—") : "—"),
  },
];

export function PurchaseOrdersList() {
  const navigate = useNavigate();
  const posQ = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => apiClient.get<PurchaseOrderRow[]>("/purchase-orders"),
  });
  const vendorsQ = useQuery({
    queryKey: ["masters", "vendors"],
    queryFn: () => apiClient.get<Option[]>("/masters/vendors"),
  });
  const vendorNames = Object.fromEntries((vendorsQ.data ?? []).map((v) => [v.id, v.name]));
  // Every company's cost centres -- an ADMIN's PO list spans companies, so
  // (unlike a single-company screen) there's no one company id to scope this
  // lookup to, same reasoning Asset Register's own Holder filter already uses.
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", "all"],
    queryFn: () => apiClient.get<Option[]>("/masters/cost-centers"),
  });
  const costCenterNames = Object.fromEntries((costCentersQ.data ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Purchase Orders"
        description="Track assets on order until they're delivered and invoiced."
        actions={
          <Button asChild>
            <Link to="/purchase-orders/new">New Purchase Order</Link>
          </Button>
        }
      />

      {posQ.isError ? (
        <ErrorState message="Couldn't load purchase orders." onRetry={() => posQ.refetch()} />
      ) : (
        <DataTable
          columns={columns(vendorNames, costCenterNames)}
          rows={posQ.data ?? []}
          rowKey={(po) => po.id}
          isLoading={posQ.isLoading}
          onRowClick={(po) => navigate({ to: "/purchase-orders/$id", params: { id: String(po.id) } })}
          emptyState={<EmptyState title="No purchase orders yet." />}
        />
      )}
    </div>
  );
}
