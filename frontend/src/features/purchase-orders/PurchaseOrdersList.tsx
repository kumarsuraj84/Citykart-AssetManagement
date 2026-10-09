import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { useTableSort } from "@/components/shared/useTableSort";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeliveryRemindersCard } from "../erp/DeliveryReminders";

interface PurchaseOrderRow {
  id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
  // AM-14: PurchaseOrderOut already returns cost_center_id (backend/app/
  // purchase_orders/schemas.py) -- the frontend just never declared or
  // rendered it. Reading an already-returned field is not a backend change.
  cost_center_id: number | null;
  // AM-19: PI is recorded per Invoice, not per PO -- see PurchaseOrderOut's
  // own docstring. pi_number/pi_date are only ever populated when every
  // delivered asset under this PO shares the exact same value.
  pi_status: "NOT_DELIVERED" | "PENDING" | "RECORDED";
  pi_number: string | null;
  pi_date: string | null;
}

interface Option {
  id: number;
  name: string;
}

const PI_STATUS_LABEL: Record<PurchaseOrderRow["pi_status"], string> = {
  NOT_DELIVERED: "—",
  PENDING: "Pending",
  RECORDED: "Recorded",
};

function PiStatusBadge({ status }: { status: PurchaseOrderRow["pi_status"] }) {
  if (status === "NOT_DELIVERED") return <span className="text-muted-foreground">—</span>;
  const dotClass = status === "RECORDED" ? "bg-success" : "bg-warning";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      {PI_STATUS_LABEL[status]}
    </span>
  );
}

const columns = (
  vendorNames: Record<number, string>,
  costCenterNames: Record<number, string>,
): DataTableColumn<PurchaseOrderRow>[] => [
  {
    key: "po_number",
    header: "PO No",
    cellClassName: "font-medium",
    sortable: true,
    // A real, independently keyboard-focusable link -- the row's own onClick
    // below is a mouse-convenience shortcut to the same destination, matching
    // Asset Register's own established row-navigation pattern.
    cell: (po) => (
      <Link to="/purchase-orders/$id" params={{ id: String(po.id) }} onClick={(e) => e.stopPropagation()}>
        {po.po_number}
      </Link>
    ),
  },
  { key: "po_date", header: "PO Date", sortable: true, cell: (po) => po.po_date },
  {
    key: "vendor", header: "Vendor", sortable: true,
    cell: (po) => (po.vendor_id ? (vendorNames[po.vendor_id] ?? "—") : "—"),
  },
  {
    key: "cost_center", header: "Cost Centre", sortable: true,
    cell: (po) => (po.cost_center_id ? (costCenterNames[po.cost_center_id] ?? "—") : "—"),
  },
  {
    key: "pi_status", header: "PI Status", sortable: true,
    cell: (po) => <PiStatusBadge status={po.pi_status} />,
  },
  { key: "pi_number", header: "PI No", sortable: true, cell: (po) => po.pi_number ?? "—" },
  { key: "pi_date", header: "PI Date", sortable: true, cell: (po) => po.pi_date ?? "—" },
];

export function PurchaseOrdersList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
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
  // lookup to, same reasoning Asset Register's own AssetUser filter already uses.
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", "all"],
    queryFn: () => apiClient.get<Option[]>("/masters/cost-centers"),
  });
  const costCenterNames = Object.fromEntries((costCentersQ.data ?? []).map((c) => [c.id, c.name]));

  const rows = posQ.data ?? [];
  const searchLower = search.trim().toLowerCase();
  const filteredRows = searchLower
    ? rows.filter((po) => {
        const vendor = po.vendor_id ? (vendorNames[po.vendor_id] ?? "") : "";
        // Deliberately only these four fields (what the placeholder says);
        // dates and Cost Centre are not searched.
        return [po.po_number, po.pi_number, vendor, PI_STATUS_LABEL[po.pi_status]]
          .some((v) => (v ?? "").toLowerCase().includes(searchLower));
      })
    : rows;

  const { sortedRows, sort, toggleSort } = useTableSort<PurchaseOrderRow>(filteredRows, {
    po_number: (po) => po.po_number,
    po_date: (po) => po.po_date,
    vendor: (po) => (po.vendor_id ? (vendorNames[po.vendor_id] ?? "") : ""),
    cost_center: (po) => (po.cost_center_id ? (costCenterNames[po.cost_center_id] ?? "") : ""),
    pi_status: (po) => PI_STATUS_LABEL[po.pi_status],
    pi_number: (po) => po.pi_number,
    pi_date: (po) => po.pi_date,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Purchase Orders"
        description="Track assets on order until they're delivered and invoiced."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/purchase-orders/from-erp">Pick from ERP</Link>
            </Button>
            <Button asChild>
              <Link to="/purchase-orders/new">New Purchase Order</Link>
            </Button>
          </div>
        }
      />

      <DeliveryRemindersCard />

      <Input
        aria-label="Search Purchase Orders"
        placeholder="Search PO No, PI No, Vendor, PI Status…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {posQ.isError ? (
        <ErrorState message="Couldn't load purchase orders." onRetry={() => posQ.refetch()} />
      ) : (
        <DataTable
          columns={columns(vendorNames, costCenterNames)}
          rows={sortedRows}
          rowKey={(po) => po.id}
          isLoading={posQ.isLoading}
          onRowClick={(po) => navigate({ to: "/purchase-orders/$id", params: { id: String(po.id) } })}
          sort={sort}
          onSortToggle={toggleSort}
          emptyState={
            search.trim() ? (
              <EmptyState title="No matches" description="Try a different search." />
            ) : (
              <EmptyState title="No purchase orders yet." />
            )
          }
        />
      )}
    </div>
  );
}
