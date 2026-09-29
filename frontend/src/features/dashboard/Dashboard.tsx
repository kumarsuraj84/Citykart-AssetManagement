import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";

// Matches router.tsx's own WRITE_ROLES: the Purchase Orders module is
// ADMIN/OPERATOR only, so this card (and the data behind it -- see
// dashboard_service.py's include_purchase_orders) is too.
const PURCHASE_ORDER_ROLES = ["ADMIN", "OPERATOR"];

interface DashboardData {
  status_counts: Record<string, number>;
  stock_by_location: { location: string; count: number }[];
  warranty_alerts: { asset_id: number; asset_code: string; warranty_upto: string }[];
  long_allocation_alerts: { asset_id: number; asset_code: string; days_allotted: number }[];
  // AM-12 G03
  exception_counts: Record<string, number>;
  recent_activity: {
    id: number;
    asset_id: number;
    asset_code: string;
    event_type: string;
    event_date: string;
    label: string;
    recorded_by_name: string | null;
  }[];
  // Purchase Orders card (2026-09-25)
  pending_po_summary: { count: number; value: number };
  open_purchase_orders: {
    id: number;
    po_number: string;
    po_date: string;
    vendor_id: number | null;
    pending_line_count: number;
  }[];
}

interface LocationRow {
  location: string;
  count: number;
}
interface WarrantyRow {
  asset_id: number;
  asset_code: string;
  warranty_upto: string;
}
interface AllocationRow {
  asset_id: number;
  asset_code: string;
  days_allotted: number;
}

const locationColumns: DataTableColumn<LocationRow>[] = [
  { key: "location", header: "Location", cell: (r) => r.location },
  {
    key: "count",
    header: "Count",
    headerClassName: "text-right",
    cellClassName: "text-right",
    // "N unit(s)", not a bare number: a KPI tile above already renders the same
    // figures as standalone digits, and this row's own count must stay
    // text-distinct so both remain independently findable.
    cell: (r) => `${r.count} unit${r.count === 1 ? "" : "s"}`,
  },
];

const warrantyColumns: DataTableColumn<WarrantyRow>[] = [
  {
    key: "asset",
    header: "Asset",
    cellClassName: "font-mono text-sm",
    cell: (r) => <a href={`/assets/${r.asset_id}`}>{r.asset_code}</a>,
  },
  {
    key: "warranty",
    header: "Warranty Until",
    headerClassName: "text-right",
    cellClassName: "text-right",
    cell: (r) => <Badge variant="secondary">{r.warranty_upto}</Badge>,
  },
];

// AM-12 G03: the fixed, recognized "something needs attention or is
// permanently closed out" statuses (backend/app/assets/models.py's
// ASSET_STATUSES) -- mirrors EXCEPTION_STATUSES in
// backend/app/reports/dashboard_service.py exactly, in display order.
// IN_STOCK/ALLOTTED/INSTALLED stay in the existing per-status KPI cards
// above; nothing here duplicates or replaces that.
const EXCEPTION_STATUSES = ["UNDER_REPAIR", "LOST", "DISPOSED", "SOLD", "SCRAPPED"];

interface ExceptionRow {
  status: string;
  count: number;
}

const exceptionColumns: DataTableColumn<ExceptionRow>[] = [
  { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} compact /> },
  {
    key: "count",
    header: "Count",
    headerClassName: "text-right",
    cellClassName: "text-right",
    // Every row is a real navigation target (AM-12 §6), not a dead number --
    // the Asset Register's own single-status Select filter is what this
    // deep-links into, so each of the five states gets its own link rather
    // than a lossy "Closed/Disposed" total that couldn't be filtered to in
    // one click anyway.
    cell: (r) => (
      <Link to="/assets" search={{ status: r.status }} className="font-medium underline-offset-2 hover:underline">
        {r.count}
      </Link>
    ),
  },
];

interface ActivityRow {
  id: number;
  asset_id: number;
  asset_code: string;
  event_date: string;
  label: string;
  recorded_by_name: string | null;
}

const activityColumns: DataTableColumn<ActivityRow>[] = [
  {
    key: "asset",
    header: "Asset",
    cellClassName: "font-mono text-sm",
    cell: (r) => <Link to="/assets/$id" params={{ id: String(r.asset_id) }}>{r.asset_code}</Link>,
  },
  { key: "activity", header: "Activity", cell: (r) => r.label },
  {
    key: "when",
    header: "When",
    headerClassName: "text-right",
    cellClassName: "text-right whitespace-nowrap",
    // Locale date+time, not a raw ISO string -- consistent with warranty_upto's
    // own already-readable rendering elsewhere on this page.
    cell: (r) => new Date(r.event_date).toLocaleString(),
  },
  {
    key: "by",
    header: "By",
    cell: (r) => r.recorded_by_name ?? "—",
  },
];

interface OpenPoRow {
  id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
  pending_line_count: number;
}

const openPoColumns = (vendorNames: Record<number, string>): DataTableColumn<OpenPoRow>[] => [
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
  {
    key: "pending",
    header: "Pending Lines",
    headerClassName: "text-right",
    cellClassName: "text-right",
    cell: (po) => po.pending_line_count,
  },
];

const allocationColumns: DataTableColumn<AllocationRow>[] = [
  {
    key: "asset",
    header: "Asset",
    cellClassName: "font-mono text-sm",
    cell: (r) => <a href={`/assets/${r.asset_id}`}>{r.asset_code}</a>,
  },
  {
    key: "days",
    header: "Days Allotted",
    headerClassName: "text-right",
    cellClassName: "text-right",
    cell: (r) => <Badge variant="destructive">{r.days_allotted} days</Badge>,
  },
];

// Spec §37/§67: "All" is the always-safe default -- the caller's own
// primary_asset_domain isn't threaded into the frontend auth session, so
// rather than guess it this simply starts unfiltered and lets anyone
// (ADMIN/Primary Owner included, since this is a convenience view, never
// an authorization restriction -- spec §14) narrow it themselves.
const DOMAIN_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "IT", label: "IT" },
  { value: "NON_IT", label: "Admin / Non-IT" },
];

export function Dashboard() {
  const [domain, setDomain] = useState("ALL");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard", domain],
    queryFn: () =>
      apiClient.get<DashboardData>(`/reports/dashboard${domain !== "ALL" ? `?domain=${domain}` : ""}`),
  });
  const role = useAuthStore((s) => s.role);
  const canSeePurchaseOrders = role !== null && PURCHASE_ORDER_ROLES.includes(role);

  const vendorsQ = useQuery({
    queryKey: ["masters", "vendors"],
    queryFn: () => apiClient.get<{ id: number; name: string }[]>("/masters/vendors"),
    enabled: canSeePurchaseOrders,
  });
  const vendorNames = Object.fromEntries((vendorsQ.data ?? []).map((v) => [v.id, v.name]));

  const statusEntries = Object.entries(data?.status_counts ?? {});

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboard"
        description="Asset counts, stock levels and alerts across your companies."
        actions={
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-domain" className="text-xs text-muted-foreground">My Responsibility</Label>
            <Select value={domain} onValueChange={setDomain}>
              <SelectTrigger id="dashboard-domain" aria-label="My Responsibility" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOMAIN_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {isError ? (
        <ErrorState message="Couldn't load the dashboard." onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={`kpi-skeleton-${i}`}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-20" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-12" />
                  </CardContent>
                </Card>
              ))
            ) : statusEntries.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="pt-6">
                  <EmptyState title="No assets yet." />
                </CardContent>
              </Card>
            ) : (
              statusEntries.map(([status, count]) => (
                <Card key={status}>
                  <CardHeader className="pb-2">
                    <CardDescription>
                      <StatusBadge status={status} />
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">{count}</p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Exceptions + Stock by Location are both compact two-column tables -- pairing
              them (same lg:grid-cols-2 pattern as Warranty/Allotted below) uses the
              available laptop-width horizontal space instead of two full-width rows. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Exceptions</CardTitle>
                <CardDescription>
                  Assets that may need attention, or have reached a closed/disposed state. Each count links to the
                  matching Asset Register filter.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={exceptionColumns}
                  rows={EXCEPTION_STATUSES.map((status) => ({ status, count: data?.exception_counts?.[status] ?? 0 }))}
                  rowKey={(r) => r.status}
                  isLoading={isLoading}
                  // Every one of the 5 recognized exception statuses always renders its own
                  // row (defaulted to 0), so this never actually triggers -- required by
                  // DataTable's own contract regardless.
                  emptyState={<EmptyState title="No exception data." />}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stock by Location</CardTitle>
                <CardDescription>Assets currently at a stock point, by location.</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={locationColumns}
                  rows={data?.stock_by_location ?? []}
                  rowKey={(r) => r.location}
                  isLoading={isLoading}
                  emptyState={<EmptyState title="No stock on hand." />}
                />
              </CardContent>
            </Card>
          </div>

          {canSeePurchaseOrders && (
            <Card>
              <CardHeader>
                <CardTitle>Purchase Orders</CardTitle>
                <CardDescription>Assets on order, not yet delivered.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Link to="/purchase-orders" className="flex items-baseline gap-2 text-2xl font-semibold tabular-nums hover:underline">
                  {isLoading ? <Skeleton className="h-8 w-12" /> : (data?.pending_po_summary.count ?? 0)}
                  <span className="text-sm font-normal text-muted-foreground">
                    pending {(data?.pending_po_summary.count ?? 0) === 1 ? "line" : "lines"} · value{" "}
                    {(data?.pending_po_summary.value ?? 0).toFixed(2)}
                  </span>
                </Link>
                <DataTable
                  columns={openPoColumns(vendorNames)}
                  rows={data?.open_purchase_orders ?? []}
                  rowKey={(po) => po.id}
                  isLoading={isLoading}
                  emptyState={<EmptyState title="No open purchase orders." />}
                />
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Warranty Expiring Soon</CardTitle>
                <CardDescription>Within the next 30 days.</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={warrantyColumns}
                  rows={data?.warranty_alerts ?? []}
                  rowKey={(r) => r.asset_id}
                  isLoading={isLoading}
                  emptyState={<EmptyState title="Nothing expiring soon." />}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Allotted Over 180 Days</CardTitle>
                <CardDescription>Assets that may need to be recalled or checked on.</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={allocationColumns}
                  rows={data?.long_allocation_alerts ?? []}
                  rowKey={(r) => r.asset_id}
                  isLoading={isLoading}
                  emptyState={<EmptyState title="Nothing overdue." />}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>The latest lifecycle events. For full history, see the Movement Log report.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={activityColumns}
                rows={data?.recent_activity ?? []}
                rowKey={(r) => r.id}
                isLoading={isLoading}
                emptyState={<EmptyState title="No recent asset activity." />}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
