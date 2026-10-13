import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { PackageCheck } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";

/**
 * Receive: the purchase orders that still have goods to come in, each with a
 * clear way into the PO, where the delivery is recorded today.
 *
 * Deliberately small and self-contained: a later stage replaces it with the
 * real receipt screen. Built only from what the server already returns:
 *  - GET /purchase-orders (every active PO; "nothing received yet" when its
 *    Purchase Invoice status is NOT_DELIVERED; and `waiting_units` once the
 *    server adds it -- then that count alone decides),
 *  - GET /reports/dashboard `open_purchase_orders` (exact waiting-unit counts
 *    for the newest open POs),
 *  - GET /erp/reminders (POs where the ERP shows goods received that are not
 *    yet received here) -- optional, any ERP trouble is simply ignored.
 */

interface PurchaseOrderRow {
  id: number;
  company_id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
  pi_status: "NOT_DELIVERED" | "PENDING" | "RECORDED";
  /** Not returned by the server yet (backend request); used when present. */
  waiting_units?: number | null;
}

interface Named {
  id: number;
  name: string;
}

interface DashboardOpenPo {
  id: number;
  pending_line_count: number;
}

interface Reminder {
  po_id: number;
  to_deliver: number;
}

export interface ReceiveRow {
  po: PurchaseOrderRow;
  /** Units known to be waiting, or null when only "nothing received yet" is known. */
  waiting: number | null;
  /** Units the ERP shows as received but not yet received here. */
  erpReceived: number | null;
}

const asArray = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Which POs still have goods to come in (pure; exported for tests). */
export function buildReceiveRows(
  pos: PurchaseOrderRow[],
  openPos: DashboardOpenPo[],
  reminders: Reminder[],
): ReceiveRow[] {
  const known = new Map(openPos.map((p) => [p.id, p.pending_line_count]));
  const erp = new Map(reminders.map((r) => [r.po_id, r.to_deliver]));
  const rows: ReceiveRow[] = [];
  for (const po of pos) {
    const erpReceived = erp.get(po.id) ?? null;
    if (typeof po.waiting_units === "number") {
      if (po.waiting_units > 0) rows.push({ po, waiting: po.waiting_units, erpReceived });
      continue;
    }
    const waiting = known.get(po.id) ?? null;
    if ((waiting !== null && waiting > 0) || po.pi_status === "NOT_DELIVERED" || erpReceived !== null) {
      rows.push({ po, waiting, erpReceived });
    }
  }
  return rows;
}

export function ReceiveQueue() {
  const navigate = useNavigate();
  const posQ = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => apiClient.get<PurchaseOrderRow[]>("/purchase-orders"),
  });
  const vendorsQ = useQuery({
    queryKey: ["masters", "vendors"],
    queryFn: () => apiClient.get<Named[]>("/masters/vendors"),
  });
  const companiesQ = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Named[]>("/masters/companies"),
  });
  const dashboardQ = useQuery({
    queryKey: ["dashboard", "ALL"],
    queryFn: () => apiClient.get<{ open_purchase_orders?: DashboardOpenPo[] }>("/reports/dashboard"),
    retry: false,
  });
  const erpStatusQ = useQuery({
    queryKey: ["erp", "status"],
    queryFn: () => apiClient.get<{ configured: boolean }>("/erp/status"),
    retry: false,
  });
  const remindersQ = useQuery({
    queryKey: ["erp", "reminders", "all"],
    queryFn: () => apiClient.get<Reminder[]>("/erp/reminders"),
    enabled: erpStatusQ.data?.configured === true,
    retry: false,
  });

  const vendorNames = Object.fromEntries(asArray<Named>(vendorsQ.data).map((v) => [v.id, v.name]));
  const companyNames = Object.fromEntries(asArray<Named>(companiesQ.data).map((c) => [c.id, c.name]));
  const rows = buildReceiveRows(
    asArray<PurchaseOrderRow>(posQ.data),
    asArray<DashboardOpenPo>(dashboardQ.data?.open_purchase_orders),
    asArray<Reminder>(remindersQ.data),
  );
  const showCompany = new Set(rows.map((r) => r.po.company_id)).size > 1;

  const columns: DataTableColumn<ReceiveRow>[] = [
    {
      key: "po_number",
      header: "PO No",
      cellClassName: "font-medium",
      cell: (r) => (
        <Link to="/purchase-orders/$id" params={{ id: String(r.po.id) }} onClick={(e) => e.stopPropagation()}>
          {r.po.po_number}
        </Link>
      ),
    },
    { key: "po_date", header: "PO Date", cell: (r) => r.po.po_date },
    { key: "vendor", header: "Vendor", cell: (r) => (r.po.vendor_id ? (vendorNames[r.po.vendor_id] ?? "—") : "—") },
    ...(showCompany
      ? [{ key: "company", header: "Company", cell: (r: ReceiveRow) => companyNames[r.po.company_id] ?? "—" }]
      : []),
    {
      key: "waiting",
      header: "Waiting",
      cell: (r) =>
        r.waiting !== null && r.waiting > 0
          ? `${plural(r.waiting, "unit")} waiting`
          : r.po.pi_status === "NOT_DELIVERED"
            ? "Nothing received yet"
            : "Some units waiting",
    },
    {
      key: "erp",
      header: "ERP",
      cell: (r) =>
        r.erpReceived !== null ? (
          <span className="text-xs">ERP shows {plural(r.erpReceived, "unit")} arrived</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "__open",
      header: <span className="sr-only">Open</span>,
      headerClassName: "text-right",
      cellClassName: "text-right",
      cell: (r) => (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/purchase-orders/$id"
            params={{ id: String(r.po.id) }}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open ${r.po.po_number}`}
          >
            Open
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Receive"
        description="Purchase orders with goods still to come in. Open one to record what arrived."
        actions={
          <Button asChild variant="outline">
            <Link to="/purchase-orders">All Purchase Orders</Link>
          </Button>
        }
      />

      {posQ.isError ? (
        <ErrorState message="Couldn't load purchase orders." onRetry={() => posQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.po.id}
          isLoading={posQ.isLoading}
          onRowClick={(r) => navigate({ to: "/purchase-orders/$id", params: { id: String(r.po.id) } })}
          emptyState={
            <EmptyState
              icon={PackageCheck}
              title="Nothing waiting to be received."
              description="Every purchase order's goods have been received."
            />
          }
        />
      )}
      <p className="text-xs text-muted-foreground">
        A purchase order that is already partly received may not show here yet; the full list is under Purchase
        Orders.
      </p>
    </div>
  );
}
