import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ClipboardList,
  PackageCheck,
  PackagePlus,
  ScanBarcode,
  Search,
  type LucideIcon,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useAccess } from "../../lib/access";
import { statusLabel, workAreaLabel, ASSET_STATUSES } from "../../lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useErpChangesSummary } from "../erp/ErpChanges";
import { fetchPoPage } from "../purchase-orders/po-list";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";

/**
 * Home (route /dashboard): what to do next, not a wall of numbers.
 *  1. Quick actions the person's role may use.
 *  2. "Needs attention": rows built only from data the server already returns
 *     (GET /reports/dashboard, /erp/changes/summary, /erp/reminders), each
 *     opening the screen where it is dealt with. ERP trouble (503, not set up)
 *     simply means fewer rows -- never an alarming error.
 *  3. Recent changes and Stock by Place, compact; a collapsed Watch list keeps
 *     Warranty Expiring Soon and the long-with-someone list.
 */

export interface DashboardData {
  status_counts: Record<string, number>;
  stock_by_location: { location: string; count: number }[];
  warranty_alerts: { asset_id: number; asset_code: string; warranty_upto: string }[];
  long_allocation_alerts: { asset_id: number; asset_code: string; days_allotted: number }[];
  exception_counts: Record<string, number>;
  /** Assets whose serial is still to be added (the Serial Pending list). */
  serial_pending_count?: number;
  recent_activity: {
    id: number;
    asset_id: number;
    asset_code: string;
    event_type: string;
    event_date: string;
    label: string;
    recorded_by_name: string | null;
  }[];
  /** `count` = units on purchase orders still waiting for goods. */
  pending_po_summary: { count: number; value: number };
  open_purchase_orders: {
    id: number;
    po_number: string;
    po_date: string;
    vendor_id: number | null;
    pending_line_count: number;
  }[];
}

interface Reminder {
  po_id: number;
  to_deliver: number;
}

/** One "needs attention" row: plain sentence + where to deal with it. */
export interface AttentionRow {
  key: string;
  text: string;
  to: string;
  search?: Record<string, string>;
  action: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Builds the "Needs attention" rows (pure; exported for tests). */
export function buildAttentionRows(input: {
  data: DashboardData | undefined;
  canWork: boolean;
  erpChangedPos: number;
  erpArrivedPos: number;
  /** POs with units waiting (the PO list's total), when known; else the unit count is used. */
  waitingPos?: number | null;
  /** S5b-1 (admins): assets with no Item yet, when known. */
  unlinkedAssets?: number | null;
}): AttentionRow[] {
  const { data, canWork, erpChangedPos, erpArrivedPos, waitingPos, unlinkedAssets } = input;
  const rows: AttentionRow[] = [];
  if (canWork) {
    const waitingUnits = data?.pending_po_summary?.count ?? 0;
    if (typeof waitingPos === "number") {
      if (waitingPos > 0) {
        rows.push({
          key: "receive",
          text:
            `${plural(waitingPos, "purchase order")} waiting for goods` +
            (waitingUnits > 0 ? ` (${plural(waitingUnits, "unit")})` : ""),
          to: "/receive",
          action: "Receive",
        });
      }
    } else if (waitingUnits > 0) {
      rows.push({
        key: "receive",
        text: `${plural(waitingUnits, "unit")} on purchase orders ${waitingUnits === 1 ? "is" : "are"} waiting for goods`,
        to: "/receive",
        action: "Receive",
      });
    }
    if (erpArrivedPos > 0) {
      rows.push({
        key: "erp-arrived",
        text: `The ERP shows goods arrived for ${plural(erpArrivedPos, "purchase order")} not yet received here`,
        to: "/receive",
        action: "Receive",
      });
    }
    const serialPending = data?.serial_pending_count ?? 0;
    if (serialPending > 0) {
      rows.push({
        key: "serial",
        text: `${plural(serialPending, "asset")} waiting for a serial number`,
        to: "/serial-pending",
        action: "Add serials",
      });
    }
    if (erpChangedPos > 0) {
      rows.push({
        key: "erp-changed",
        text: `The ERP changed ${plural(erpChangedPos, "purchase order")}`,
        to: "/purchase-orders",
        action: "Review",
      });
    }
  }
  const underRepair = data?.exception_counts?.UNDER_REPAIR ?? 0;
  if (underRepair > 0) {
    rows.push({
      key: "repair",
      text: `${plural(underRepair, "asset")} under repair`,
      to: "/assets",
      search: { status: "UNDER_REPAIR" },
      action: "See them",
    });
  }
  const lost = data?.exception_counts?.LOST ?? 0;
  if (lost > 0) {
    rows.push({
      key: "lost",
      text: `${plural(lost, "asset")} reported lost`,
      to: "/assets",
      search: { status: "LOST" },
      action: "See them",
    });
  }
  if (typeof unlinkedAssets === "number" && unlinkedAssets > 0) {
    rows.push({
      key: "link-items",
      text: `${plural(unlinkedAssets, "asset")} ${unlinkedAssets === 1 ? "has" : "have"} no Item yet`,
      to: "/settings/catalogue/link-assets",
      action: "Link to Items",
    });
  }
  return rows;
}

interface QuickAction {
  label: string;
  to: string;
  search?: Record<string, string | boolean>;
  icon: LucideIcon;
}

function quickActionsFor(canWork: boolean): QuickAction[] {
  const find: QuickAction = { label: "Find Asset", to: "/assets", search: { find: true }, icon: Search };
  if (!canWork) return [find];
  return [
    { label: "Create PO", to: "/purchase-orders/new", icon: ClipboardList },
    { label: "Receive Delivery", to: "/receive", icon: PackageCheck },
    { label: "Add Assets", to: "/assets/new", icon: PackagePlus },
    { label: "Move Assets", to: "/asset-movement", icon: ScanBarcode },
    find,
  ];
}

// Work area filter: a convenience view, never an authorization restriction --
// the server always narrows to the person's own allowed work area anyway.
const WORK_AREA_FILTER = [
  { value: "ALL", label: "All" },
  { value: "IT", label: workAreaLabel("IT") },
  { value: "NON_IT", label: workAreaLabel("NON_IT") },
];

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
type ActivityRow = DashboardData["recent_activity"][number];

const assetLink = (id: number, code: string) => (
  <Link to="/assets/$id" params={{ id: String(id) }}>
    {code}
  </Link>
);

const locationColumns: DataTableColumn<LocationRow>[] = [
  { key: "location", header: "Place", cell: (r) => r.location },
  {
    key: "count",
    header: "In Stock",
    headerClassName: "text-right",
    cellClassName: "text-right tabular-nums",
    cell: (r) => `${r.count} unit${r.count === 1 ? "" : "s"}`,
  },
];

const warrantyColumns: DataTableColumn<WarrantyRow>[] = [
  { key: "asset", header: "Asset", cellClassName: "font-mono text-sm", cell: (r) => assetLink(r.asset_id, r.asset_code) },
  {
    key: "warranty",
    header: "Warranty Until",
    headerClassName: "text-right",
    cellClassName: "text-right",
    cell: (r) => <Badge variant="secondary">{r.warranty_upto}</Badge>,
  },
];

const allocationColumns: DataTableColumn<AllocationRow>[] = [
  { key: "asset", header: "Asset", cellClassName: "font-mono text-sm", cell: (r) => assetLink(r.asset_id, r.asset_code) },
  {
    key: "days",
    header: "Days",
    headerClassName: "text-right",
    cellClassName: "text-right",
    cell: (r) => <Badge variant="destructive">{r.days_allotted} days</Badge>,
  },
];

const activityColumns: DataTableColumn<ActivityRow>[] = [
  { key: "asset", header: "Asset", cellClassName: "font-mono text-sm", cell: (r) => assetLink(r.asset_id, r.asset_code) },
  { key: "activity", header: "What happened", cell: (r) => r.label },
  {
    key: "when",
    header: "When",
    headerClassName: "text-right",
    cellClassName: "text-right whitespace-nowrap",
    cell: (r) => new Date(r.event_date).toLocaleString(),
  },
  { key: "by", header: "By", cell: (r) => r.recorded_by_name ?? "—" },
];

/** ERP "goods arrived here but not received" reminders; any ERP trouble = none. */
function useErpArrivedReminders(enabled: boolean) {
  const statusQ = useQuery({
    queryKey: ["erp", "status"],
    queryFn: () => apiClient.get<{ configured: boolean }>("/erp/status"),
    enabled,
    retry: false,
  });
  return useQuery({
    queryKey: ["erp", "reminders", "all"],
    queryFn: () => apiClient.get<Reminder[]>("/erp/reminders"),
    enabled: enabled && statusQ.data?.configured === true,
    retry: false,
  });
}

export interface DashboardProps {
  /** Extension point: a later stage adds a "Head-office admin" group of rows
   * (new ERP items / vendors / stores) here, shown under Needs attention. */
  headOfficeSection?: ReactNode;
}

export function Dashboard({ headOfficeSection }: DashboardProps = {}) {
  const [domain, setDomain] = useState("ALL");
  const { can } = useAccess();
  const canWork = can("work");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard", domain],
    queryFn: () =>
      apiClient.get<DashboardData>(`/reports/dashboard${domain !== "ALL" ? `?domain=${domain}` : ""}`),
  });

  const erpChangesQ = useErpChangesSummary(canWork);
  const erpRemindersQ = useErpArrivedReminders(canWork);
  const erpChangedPos = Array.isArray(erpChangesQ.data?.items) ? erpChangesQ.data.items.length : 0;
  const erpArrivedPos = Array.isArray(erpRemindersQ.data) ? erpRemindersQ.data.length : 0;

  // S2: how many POs wait for goods, straight from the PO list's total
  // (?waiting=true, X-Total-Count). It counts the person's whole work area, so
  // it is used only when Home is not narrowed to one area; otherwise (or when
  // the server does not say) the waiting-unit count above is used.
  const waitingPosQ = useQuery({
    queryKey: ["purchase-orders", "waiting-count"],
    queryFn: async () => (await fetchPoPage({ waiting: true, limit: 1 })).total,
    enabled: canWork,
    retry: false,
  });
  const waitingPos = domain === "ALL" && typeof waitingPosQ.data === "number" ? waitingPosQ.data : null;

  // S5b-1: admins see how many assets still have no Item (one cheap count: limit=1, X-Total-Count).
  const canLink = can("admin");
  const unlinkedQ = useQuery({
    queryKey: ["assets", "unlinked-items", "count"],
    queryFn: async () => {
      const page = await apiClient.getPage<unknown[]>("/assets/unlinked-items?limit=1");
      return typeof page?.total === "number" ? page.total : null;
    },
    enabled: canLink,
    retry: false,
  });
  const unlinkedAssets = canLink && typeof unlinkedQ.data === "number" ? unlinkedQ.data : null;

  const attention = buildAttentionRows({ data, canWork, erpChangedPos, erpArrivedPos, waitingPos, unlinkedAssets });
  const statusCounts = ASSET_STATUSES.filter((s) => (data?.status_counts?.[s] ?? 0) > 0).map((s) => ({
    status: s,
    count: data?.status_counts?.[s] ?? 0,
  }));
  const warranty = data?.warranty_alerts ?? [];
  const longWith = data?.long_allocation_alerts ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Home"
        description="What needs doing, and where to start."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="home-work-area" className="text-xs text-muted-foreground">
              Work area
            </Label>
            <Select value={domain} onValueChange={setDomain}>
              <SelectTrigger id="home-work-area" aria-label="Work area" className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_AREA_FILTER.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
        {quickActionsFor(canWork).map((a) => (
          <Button key={a.label} asChild variant={a.label === "Find Asset" ? "outline" : "default"} size="sm">
            <Link to={a.to} search={a.search as never}>
              <a.icon className="h-4 w-4" aria-hidden="true" />
              {a.label}
            </Link>
          </Button>
        ))}
      </nav>

      {isError ? (
        <ErrorState message="Couldn't load Home." onRetry={() => refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Needs attention</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-5 w-1/2" />
                </div>
              ) : attention.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
              ) : (
                <ul className="flex flex-col divide-y" aria-label="Needs attention">
                  {attention.map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>{r.text}</span>
                      <Link
                        to={r.to}
                        search={r.search as never}
                        className="inline-flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                        data-attention={r.key}
                      >
                        {r.action}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {headOfficeSection}

          {statusCounts.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-label="Assets by status">
              <span className="text-muted-foreground">Assets:</span>
              {statusCounts.map(({ status, count }) => (
                <Link
                  key={status}
                  to="/assets"
                  search={{ status }}
                  className="underline-offset-2 hover:underline"
                >
                  {statusLabel(status)} <span className="font-semibold tabular-nums">{count}</span>
                </Link>
              ))}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Recent changes</CardTitle>
                <CardDescription>The latest moves and updates. The full history is in Reports.</CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={activityColumns}
                  rows={(data?.recent_activity ?? []).slice(0, 8)}
                  rowKey={(r) => r.id}
                  isLoading={isLoading}
                  emptyState={<EmptyState title="No recent asset activity." />}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Stock by Place</CardTitle>
                <CardDescription>Assets in Stock Rooms, by place.</CardDescription>
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

          <details className="rounded-md border bg-card" data-testid="watch-list">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
              Watch list
              <span className="ml-2 font-normal text-muted-foreground">
                {plural(warranty.length, "warranty", "warranties")} ending soon ·{" "}
                {plural(longWith.length, "asset")} with someone over 180 days
              </span>
            </summary>
            <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
              <section aria-labelledby="watch-warranty">
                <h2 id="watch-warranty" className="mb-1 text-sm font-semibold">
                  Warranty Expiring Soon
                </h2>
                <p className="mb-2 text-xs text-muted-foreground">Within the next 30 days.</p>
                <DataTable
                  columns={warrantyColumns}
                  rows={warranty}
                  rowKey={(r) => r.asset_id}
                  isLoading={isLoading}
                  emptyState={<EmptyState title="Nothing expiring soon." />}
                />
              </section>
              <section aria-labelledby="watch-long">
                <h2 id="watch-long" className="mb-1 text-sm font-semibold">
                  With Employee / Store Over 180 Days
                </h2>
                <p className="mb-2 text-xs text-muted-foreground">May need to be recalled or checked on.</p>
                <DataTable
                  columns={allocationColumns}
                  rows={longWith}
                  rowKey={(r) => r.asset_id}
                  isLoading={isLoading}
                  emptyState={<EmptyState title="Nothing overdue." />}
                />
              </section>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
