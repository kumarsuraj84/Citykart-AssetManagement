import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { StatusBadge } from "@/components/shared/StatusBadge";

interface DashboardData {
  status_counts: Record<string, number>;
  stock_by_location: { location: string; count: number }[];
  warranty_alerts: { asset_id: number; asset_code: string; warranty_upto: string }[];
  long_allocation_alerts: { asset_id: number; asset_code: string; days_allotted: number }[];
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

export function Dashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiClient.get<DashboardData>("/reports/dashboard"),
  });

  const statusEntries = Object.entries(data?.status_counts ?? {});

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description="Asset counts, stock levels and alerts across your companies." />

      {isError ? (
        <ErrorState message="Couldn't load the dashboard." onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
                    <p className="text-2xl font-semibold">{count}</p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Stock by Location</CardTitle>
              <CardDescription>Assets currently sitting in IT stock, by location.</CardDescription>
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
        </>
      )}
    </div>
  );
}
