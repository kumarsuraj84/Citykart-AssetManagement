import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { downloadFile } from "../../lib/auth-fetch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";

interface Option {
  id: number;
  name: string;
}

function asOptionArray(data: unknown): Option[] {
  return Array.isArray(data) ? (data as Option[]) : [];
}

// Matches backend/app/assets/models.py ASSET_STATUSES -- same closed set
// AssetRegister's own status filter uses.
const ASSET_STATUSES = ["IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST"];
const ALL = "ALL";

// Same Responsibility values/labels as AssetRegister's own filter (spec §38) --
// always further bounded server-side by the caller's allowed_asset_domains,
// never a way to widen past it (see search_assets).
const DOMAINS = [
  { value: "IT", label: "IT" },
  { value: "NON_IT", label: "Admin / Non-IT" },
];

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFromDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return toDateInput(d);
}

// Authenticated exports can't just be a plain <a href="/api/..."> link: every other
// request in this app carries its bearer token as an Authorization header, and a
// browser navigating a bare href never attaches that header, so the download would
// 401. downloadFile (lib/auth-fetch.ts) fetches with the token (refreshing it if
// needed) and hands the browser a blob to save under a real filename.
function downloadXlsx(path: string, filename: string): Promise<void> {
  return downloadFile(path, filename, "Export failed");
}

export function ReportsScreen() {
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [domain, setDomain] = useState("");
  const [movementsFrom, setMovementsFrom] = useState(defaultFromDate());
  const [movementsTo, setMovementsTo] = useState(toDateInput(new Date()));
  const [changesFrom, setChangesFrom] = useState(defaultFromDate());
  const [changesTo, setChangesTo] = useState(toDateInput(new Date()));

  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [movementsError, setMovementsError] = useState<string | null>(null);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [assetsPending, setAssetsPending] = useState(false);
  const [movementsPending, setMovementsPending] = useState(false);
  const [changesPending, setChangesPending] = useState(false);

  const { data: categoriesData } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Option[]>("/masters/categories"),
  });
  const categories = asOptionArray(categoriesData);

  async function handleAssetsExport() {
    setAssetsError(null);
    setAssetsPending(true);
    try {
      const params = new URLSearchParams({
        ...(status ? { status } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(domain ? { domain } : {}),
      }).toString();
      await downloadXlsx(`/reports/export/assets${params ? `?${params}` : ""}`, "asset_register.xlsx");
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
        `/reports/export/movements?from_date=${movementsFrom}&to_date=${movementsTo}`,
        "movement_log.xlsx",
      );
    } catch (err) {
      setMovementsError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setMovementsPending(false);
    }
  }

  async function handleChangesExport() {
    setChangesError(null);
    setChangesPending(true);
    try {
      await downloadXlsx(
        `/reports/export/field-changes?from_date=${changesFrom}&to_date=${changesTo}`,
        "field_change_audit.xlsx",
      );
    } catch (err) {
      setChangesError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setChangesPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" description="Export the asset register, movement log, or field-change audit to Excel." />

      <Card>
        <CardHeader>
          <CardTitle>Asset Register</CardTitle>
          <CardDescription>Every asset currently in scope for your account, as an Excel file.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField htmlFor="assets-status" label="Status" className="w-40">
              <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? "" : v)}>
                <SelectTrigger id="assets-status" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {ASSET_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField htmlFor="assets-category" label="Category" className="w-40">
              <Select value={categoryId || ALL} onValueChange={(v) => setCategoryId(v === ALL ? "" : v)}>
                <SelectTrigger id="assets-category" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField htmlFor="assets-domain" label="Responsibility" className="w-40">
              <Select value={domain || ALL} onValueChange={(v) => setDomain(v === ALL ? "" : v)}>
                <SelectTrigger id="assets-domain" aria-label="Responsibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {DOMAINS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <AsyncButton onClick={handleAssetsExport} pending={assetsPending} pendingLabel="Preparing…" className="w-fit">
              Download Asset Register (Excel)
            </AsyncButton>
          </div>
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
            <FormField htmlFor="movements-from-date" label="From">
              <Input
                id="movements-from-date"
                aria-label="From"
                type="date"
                value={movementsFrom}
                onChange={(e) => setMovementsFrom(e.target.value)}
              />
            </FormField>
            <FormField htmlFor="movements-to-date" label="To">
              <Input
                id="movements-to-date"
                aria-label="To"
                type="date"
                value={movementsTo}
                onChange={(e) => setMovementsTo(e.target.value)}
              />
            </FormField>
            <AsyncButton onClick={handleMovementsExport} pending={movementsPending} pendingLabel="Preparing…">
              Download Movement Log (Excel)
            </AsyncButton>
          </div>
          {movementsError && <p className="text-sm text-destructive">{movementsError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Field Change Audit</CardTitle>
          <CardDescription>
            Every edit to a descriptive/procurement field (e.g. a corrected serial number) in a date range -- separate
            from the movement log above, which tracks custody, not data corrections.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField htmlFor="changes-from-date" label="Changes From">
              <Input
                id="changes-from-date"
                aria-label="Changes From"
                type="date"
                value={changesFrom}
                onChange={(e) => setChangesFrom(e.target.value)}
              />
            </FormField>
            <FormField htmlFor="changes-to-date" label="Changes To">
              <Input
                id="changes-to-date"
                aria-label="Changes To"
                type="date"
                value={changesTo}
                onChange={(e) => setChangesTo(e.target.value)}
              />
            </FormField>
            <AsyncButton onClick={handleChangesExport} pending={changesPending} pendingLabel="Preparing…">
              Download Field Change Audit (Excel)
            </AsyncButton>
          </div>
          {changesError && <p className="text-sm text-destructive">{changesError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
