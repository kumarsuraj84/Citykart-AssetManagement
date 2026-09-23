import { useState } from "react";
import { useAuthStore } from "../../lib/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFromDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return toDateInput(d);
}

// Authenticated exports can't just be a plain <a href="/api/..."> link: every other
// request in this app carries its bearer token as an Authorization header (see
// lib/api-client.ts and AssetDetail's own DocumentsTab download), and a browser
// navigating a bare href never attaches that header, so the download would 401.
// This mirrors DocumentsTab.tsx's handleDownload: fetch with the token, then hand the
// browser a blob to save under a real filename.
async function downloadXlsx(path: string, filename: string): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ReportsScreen() {
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(toDateInput(new Date()));
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [movementsError, setMovementsError] = useState<string | null>(null);
  const [assetsPending, setAssetsPending] = useState(false);
  const [movementsPending, setMovementsPending] = useState(false);

  async function handleAssetsExport() {
    setAssetsError(null);
    setAssetsPending(true);
    try {
      await downloadXlsx("/reports/export/assets", "asset_register.xlsx");
    } catch (err) {
      setAssetsError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setAssetsPending(false);
    }
  }

  async function handleMovementsExport() {
    setMovementsError(null);
    setMovementsPending(true);
    try {
      await downloadXlsx(
        `/reports/export/movements?from_date=${fromDate}&to_date=${toDate}`,
        "movement_log.xlsx",
      );
    } catch (err) {
      setMovementsError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setMovementsPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">Export the asset register or the movement log to Excel.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Asset Register</CardTitle>
          <CardDescription>Every asset currently in scope for your account, as an Excel file.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={handleAssetsExport} disabled={assetsPending} className="w-fit">
            {assetsPending ? "Preparing…" : "Download Asset Register (Excel)"}
          </Button>
          {assetsError && <p className="text-sm text-destructive">{assetsError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Movement Log</CardTitle>
          <CardDescription>Every move, allotment, repair and disposal event in a date range.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="movements-from-date">From</Label>
              <Input
                id="movements-from-date"
                aria-label="From"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="movements-to-date">To</Label>
              <Input
                id="movements-to-date"
                aria-label="To"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <Button onClick={handleMovementsExport} disabled={movementsPending}>
              {movementsPending ? "Preparing…" : "Download Movement Log (Excel)"}
            </Button>
          </div>
          {movementsError && <p className="text-sm text-destructive">{movementsError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
