import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DashboardData {
  status_counts: Record<string, number>;
  stock_by_location: { location: string; count: number }[];
  warranty_alerts: { asset_id: number; asset_code: string; warranty_upto: string }[];
  long_allocation_alerts: { asset_id: number; asset_code: string; days_allotted: number }[];
}

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiClient.get<DashboardData>("/reports/dashboard"),
  });

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const statusEntries = Object.entries(data.status_counts);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Asset counts, stock levels and alerts across your companies.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {statusEntries.map(([status, count]) => (
          <Card key={status}>
            <CardHeader className="pb-2">
              <CardDescription>{status.replace(/_/g, " ")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{count}</p>
            </CardContent>
          </Card>
        ))}
        {statusEntries.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="pt-6 text-center text-sm text-muted-foreground">
              No assets yet.
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock by Location</CardTitle>
          <CardDescription>Assets currently sitting in IT stock, by location.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.stock_by_location.map((s) => (
                <TableRow key={s.location}>
                  <TableCell>{s.location}</TableCell>
                  {/* "N unit(s)", not a bare number: a KPI tile above already renders the
                      same figures as standalone digits, and this row's own count must
                      stay text-distinct from those so both remain independently findable
                      (by a screen reader's text search as much as by testing-library's
                      exact-text getByText). */}
                  <TableCell className="text-right">
                    {s.count} unit{s.count === 1 ? "" : "s"}
                  </TableCell>
                </TableRow>
              ))}
              {data.stock_by_location.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                    No stock on hand.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Warranty Expiring Soon</CardTitle>
            <CardDescription>Within the next 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Warranty Until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.warranty_alerts.map((a) => (
                  <TableRow key={a.asset_id}>
                    <TableCell className="font-mono text-sm">
                      <a href={`/assets/${a.asset_id}`}>{a.asset_code}</a>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{a.warranty_upto}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {data.warranty_alerts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                      Nothing expiring soon.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Allotted Over 180 Days</CardTitle>
            <CardDescription>Assets that may need to be recalled or checked on.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Days Allotted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.long_allocation_alerts.map((a) => (
                  <TableRow key={a.asset_id}>
                    <TableCell className="font-mono text-sm">
                      <a href={`/assets/${a.asset_id}`}>{a.asset_code}</a>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="destructive">{a.days_allotted} days</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {data.long_allocation_alerts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                      Nothing overdue.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
