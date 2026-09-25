import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
}

interface Option {
  id: number;
  name: string;
}

const columns = (vendorNames: Record<number, string>): DataTableColumn<PurchaseOrderRow>[] => [
  {
    key: "po_number",
    header: "PO No",
    cell: (po) => (
      <Link to="/purchase-orders/$id" params={{ id: String(po.id) }}>
        {po.po_number}
      </Link>
    ),
  },
  { key: "po_date", header: "PO Date", cell: (po) => po.po_date },
  { key: "vendor", header: "Vendor", cell: (po) => (po.vendor_id ? (vendorNames[po.vendor_id] ?? "—") : "—") },
];

export function PurchaseOrdersList() {
  const posQ = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => apiClient.get<PurchaseOrderRow[]>("/purchase-orders"),
  });
  const vendorsQ = useQuery({
    queryKey: ["masters", "vendors"],
    queryFn: () => apiClient.get<Option[]>("/masters/vendors"),
  });
  const vendorNames = Object.fromEntries((vendorsQ.data ?? []).map((v) => [v.id, v.name]));

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
          columns={columns(vendorNames)}
          rows={posQ.data ?? []}
          rowKey={(po) => po.id}
          isLoading={posQ.isLoading}
          emptyState={<EmptyState title="No purchase orders yet." />}
        />
      )}
    </div>
  );
}
