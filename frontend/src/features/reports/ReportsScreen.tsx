import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Search } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { downloadFile } from "../../lib/auth-fetch";
import { useMyCompanies } from "../../lib/capabilities";
import { usePlaceLookups } from "../../lib/lookups";
import { WORK_AREA_OPTIONS, statusOptions } from "@/lib/labels";
import { categoryOptions, companyOptions, itemOptions, placeOptions, vendorOptions, type PlaceLike } from "@/lib/option-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounced } from "../purchase-orders/po-list";
import type { Item } from "../items/types";

interface Named {
  id: number;
  name: string;
  code?: string | null;
  gstin?: string | null;
}

const ALL = "ALL";
export const REPORT_PAGE_SIZE = 50;

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function defaultFromDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return toDateInput(d);
}

/** The asset report's filters (the Excel file and the on-screen preview use exactly these). */
export interface AssetReportFilters {
  companyId: string;
  workArea: string;
  status: string;
  categoryId: string;
  itemId: string;
  vendorId: string;
  poNumber: string;
  holderId: string;
  purchaseFrom: string;
  purchaseTo: string;
}

export const NO_FILTERS: AssetReportFilters = {
  companyId: "", workArea: "", status: "", categoryId: "", itemId: "", vendorId: "", poNumber: "", holderId: "", purchaseFrom: "", purchaseTo: "",
};

/** The query string shared by `/reports/assets/preview` and `/reports/export/assets` (empty filters left out). */
export function assetReportParams(f: AssetReportFilters): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string) => { if (v.trim() !== "") p.set(k, v.trim()); };
  put("company_id", f.companyId);
  put("work_area", f.workArea);
  put("status", f.status);
  put("category_id", f.categoryId);
  put("item_id", f.itemId);
  put("vendor_id", f.vendorId);
  put("po_number", f.poNumber);
  put("holder_id", f.holderId);
  put("purchase_from", f.purchaseFrom);
  put("purchase_to", f.purchaseTo);
  return p.toString();
}

interface AssetPreview {
  total: number;
  columns: string[];
  rows: Record<string, unknown>[];
  asset_ids?: number[];
  summary?: {
    by_status?: { status: string; status_label: string; count: number }[];
    by_category?: { category_id: number | null; category_name: string | null; count: number }[];
    by_item?: { item_id: number | null; item_name: string | null; count: number }[];
  };
}

interface MovementPreview {
  total: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

const cellText = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const n = (v: number) => v.toLocaleString("en-IN");

function Pager({ page, total, onPage, noun, busy }: { page: number; total: number; onPage: (p: number) => void; noun: string; busy: boolean }) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
  const first = page * REPORT_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * REPORT_PAGE_SIZE);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>Showing {n(first)}–{n(last)} of {n(total)} {noun}</span>
      <div className="flex items-center gap-2">
        <span>Page {page + 1} of {pages}</span>
        <Button size="sm" variant="outline" disabled={page === 0 || busy} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages || busy} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** The preview table: the file's own headings and rows (the server builds both). */
function PreviewTable({ label, columns, rows, cell }: {
  label: string; columns: string[]; rows: Record<string, unknown>[]; cell?: (col: string, row: Record<string, unknown>, i: number) => ReactNode;
}) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border">
      <table className="w-full text-sm" aria-label={label}>
        <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
          <tr>
            {columns.map((c) => <th key={c} scope="col" className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{c.replace(/^Custom:/, "")}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-2 py-1">{cell ? cell(c, r, i) : cellText(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Authenticated exports cannot be a plain <a href>: the request needs the bearer
// token. downloadFile (lib/auth-fetch.ts) fetches with it and hands the browser a file.
function useDownload() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(path: string, filename: string) {
    setError(null);
    setPending(true);
    try {
      await downloadFile(path, filename, "Export failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}

function AssetReport() {
  const [f, setF] = useState<AssetReportFilters>(NO_FILTERS);
  const [poText, setPoText] = useState("");
  const po = useDebounced(poText.trim(), 400);
  const filters = { ...f, poNumber: po };
  const params = assetReportParams(filters);
  const [pageState, setPageState] = useState({ params: "", page: 0 });
  const page = pageState.params === params ? pageState.page : 0;
  const set = (patch: Partial<AssetReportFilters>) => setF((x) => ({ ...x, ...patch }));
  const download = useDownload();

  const { companies } = useMyCompanies();
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Named[]>("/masters/categories") });
  const itemsQ = useQuery({ queryKey: ["items", "mine"], queryFn: () => apiClient.get<Item[]>("/items?work_area=mine") });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Named[]>("/masters/vendors") });
  const peopleQ = useQuery({ queryKey: ["asset_users"], queryFn: () => apiClient.get<PlaceLike[]>("/asset-users") });
  const placeLookups = usePlaceLookups();
  const list = <T,>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
  const categories = list<Named>(categoriesQ.data);

  const previewQ = useQuery({
    queryKey: ["reports", "assets", "preview", params, page],
    queryFn: () => apiClient.get<AssetPreview>(
      `/reports/assets/preview?${params ? `${params}&` : ""}limit=${REPORT_PAGE_SIZE}&offset=${page * REPORT_PAGE_SIZE}`,
    ),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const preview = previewQ.data && typeof previewQ.data === "object" && Array.isArray(previewQ.data.rows) ? previewQ.data : null;
  const datesBackwards = f.purchaseFrom !== "" && f.purchaseTo !== "" && f.purchaseTo < f.purchaseFrom;
  const anyFilter = params !== "";

  const select = (id: string, label: string, value: string, onChange: (v: string) => void, options: { value: string; label: string; detail?: string }[], allLabel: string) => (
    <FormField htmlFor={id} label={label} className="w-full sm:w-48">
      <SearchableSelect
        id={id} aria-label={label} value={value || ALL}
        onValueChange={(v) => onChange(v === ALL ? "" : v)}
        options={[{ value: ALL, label: allLabel }, ...options]}
      />
    </FormField>
  );

  const summary = preview?.summary;
  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Filters" className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        {companies.length > 1 && select("report-company", "Company", f.companyId, (v) => set({ companyId: v }), companyOptions(companies), "All companies")}
        {select("report-work-area", "Work area", f.workArea, (v) => set({ workArea: v }), WORK_AREA_OPTIONS, "All")}
        {select("report-status", "Status", f.status, (v) => set({ status: v }), statusOptions(), "All statuses")}
        {select("report-group", "Asset group", f.categoryId, (v) => set({ categoryId: v }), categoryOptions(categories), "All groups")}
        {select("report-item", "Item", f.itemId, (v) => set({ itemId: v }), itemOptions(list<Item>(itemsQ.data), { categories: Object.fromEntries(categories.map((c) => [c.id, c.name])) }), "All Items")}
        {select("report-vendor", "Vendor", f.vendorId, (v) => set({ vendorId: v }), vendorOptions(list<Named>(vendorsQ.data)), "All vendors")}
        <FormField htmlFor="report-po" label="PO number" className="w-full sm:w-40">
          <Input id="report-po" aria-label="PO number" value={poText} onChange={(e) => setPoText(e.target.value)} placeholder="Whole PO number" />
        </FormField>
        {select("report-holder", "Person / Place", f.holderId, (v) => set({ holderId: v }), placeOptions(list<PlaceLike>(peopleQ.data), placeLookups), "Anyone")}
        <FormField htmlFor="report-purchase-from" label="Purchased from" className="w-full sm:w-40">
          <Input id="report-purchase-from" type="date" aria-label="Purchased from" value={f.purchaseFrom} onChange={(e) => set({ purchaseFrom: e.target.value })} />
        </FormField>
        <FormField htmlFor="report-purchase-to" label="Purchased to" className="w-full sm:w-40" errorText={datesBackwards ? "The 'to' date cannot be before the 'from' date." : undefined}>
          <Input id="report-purchase-to" type="date" aria-label="Purchased to" value={f.purchaseTo} onChange={(e) => set({ purchaseTo: e.target.value })} />
        </FormField>
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => { setF(NO_FILTERS); setPoText(""); }}>Clear filters</Button>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/assets" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          Find a specific asset → Assets
        </Link>
        <AsyncButton
          onClick={() => download.run(`/reports/export/assets${params ? `?${params}` : ""}`, "asset_register.xlsx")}
          pending={download.pending} pendingLabel="Preparing…" disabled={datesBackwards}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download Excel
        </AsyncButton>
      </div>
      {download.error && <p className="text-sm text-destructive" role="alert">{download.error}</p>}

      {previewQ.isError ? (
        <ErrorState
          message={previewQ.error instanceof Error ? previewQ.error.message : "Couldn't load the preview."}
          onRetry={() => previewQ.refetch()}
        />
      ) : !preview ? (
        <div className="flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : (
        <>
          <section aria-label="Summary" className="flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <p>
              <span className="font-semibold tabular-nums" data-testid="report-total">{n(preview.total)}</span>{" "}
              asset{preview.total === 1 ? "" : "s"} match.
            </p>
            {(summary?.by_status ?? []).length > 0 && (
              <p className="flex flex-wrap gap-x-3 gap-y-0.5" aria-label="By status">
                {summary!.by_status!.map((s) => (
                  <span key={s.status}>{s.status_label} <span className="font-semibold tabular-nums">{n(s.count)}</span></span>
                ))}
              </p>
            )}
            {(summary?.by_category ?? []).length > 0 && (
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground" aria-label="Top asset groups">
                <span>Groups:</span>
                {summary!.by_category!.slice(0, 5).map((c, i) => (
                  <span key={c.category_id ?? `none-${i}`} className="text-foreground">{c.category_name ?? "No group"} <span className="font-semibold tabular-nums">{n(c.count)}</span></span>
                ))}
              </p>
            )}
            {(summary?.by_item ?? []).length > 0 && (
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground" aria-label="Top Items">
                <span>Items:</span>
                {summary!.by_item!.slice(0, 5).map((it, i) => (
                  <span key={it.item_id ?? `none-${i}`} className="text-foreground">{it.item_name ?? "No Item yet"} <span className="font-semibold tabular-nums">{n(it.count)}</span></span>
                ))}
              </p>
            )}
          </section>

          {preview.total === 0 ? (
            <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">No assets match these filters.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">The same rows and columns as the Excel file, {REPORT_PAGE_SIZE} at a time.</p>
              <PreviewTable
                label="Asset register preview"
                columns={preview.columns}
                rows={preview.rows}
                cell={(col, row, i) => {
                  const id = preview.asset_ids?.[i];
                  if (col === "Asset Code" && id) {
                    return <Link to="/assets/$id" params={{ id: String(id) }} className="font-mono text-xs underline-offset-2 hover:underline">{cellText(row[col])}</Link>;
                  }
                  return cellText(row[col]);
                }}
              />
              <Pager page={page} total={preview.total} noun="assets" busy={previewQ.isFetching} onPage={(p) => setPageState({ params, page: p })} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function MovementReport() {
  const [from, setFrom] = useState(defaultFromDate());
  const [to, setTo] = useState(toDateInput(new Date()));
  const params = `from_date=${from}&to_date=${to}`;
  const [pageState, setPageState] = useState({ params: "", page: 0 });
  const page = pageState.params === params ? pageState.page : 0;
  const download = useDownload();
  const valid = from !== "" && to !== "" && to >= from;
  const previewQ = useQuery({
    queryKey: ["reports", "movements", "preview", params, page],
    queryFn: () => apiClient.get<MovementPreview>(`/reports/movements/preview?${params}&limit=${REPORT_PAGE_SIZE}&offset=${page * REPORT_PAGE_SIZE}`),
    enabled: valid,
    placeholderData: (prev) => prev,
    retry: false,
  });
  const preview = previewQ.data && typeof previewQ.data === "object" && Array.isArray(previewQ.data.rows) ? previewQ.data : null;
  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Movement dates" className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        <FormField htmlFor="movements-from-date" label="From">
          <Input id="movements-from-date" aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField htmlFor="movements-to-date" label="To" errorText={from && to && to < from ? "The 'to' date cannot be before the 'from' date." : undefined}>
          <Input id="movements-to-date" aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
        <AsyncButton
          className="ml-auto"
          onClick={() => download.run(`/reports/export/movements?${params}`, "movement_log.xlsx")}
          pending={download.pending} pendingLabel="Preparing…" disabled={!valid}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download Excel
        </AsyncButton>
      </section>
      {download.error && <p className="text-sm text-destructive" role="alert">{download.error}</p>}
      {!valid ? null : previewQ.isError ? (
        <ErrorState message={previewQ.error instanceof Error ? previewQ.error.message : "Couldn't load the preview."} onRetry={() => previewQ.refetch()} />
      ) : !preview ? (
        <Skeleton className="h-40 w-full" />
      ) : preview.total === 0 ? (
        <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">No movements in these dates.</p>
      ) : (
        <>
          <p className="text-sm"><span className="font-semibold tabular-nums" data-testid="movements-total">{n(preview.total)}</span> movement{preview.total === 1 ? "" : "s"} in these dates.</p>
          <PreviewTable label="Movement log preview" columns={preview.columns} rows={preview.rows} />
          <Pager page={page} total={preview.total} noun="movements" busy={previewQ.isFetching} onPage={(p) => setPageState({ params, page: p })} />
        </>
      )}
    </div>
  );
}

function FieldChangeAudit() {
  const [from, setFrom] = useState(defaultFromDate());
  const [to, setTo] = useState(toDateInput(new Date()));
  const download = useDownload();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Every edit to a descriptive or purchase field (for example a corrected serial number) in a date range -- separate from the
        movement log, which tracks where assets are, not corrections.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <FormField htmlFor="changes-from-date" label="Changes From">
          <Input id="changes-from-date" aria-label="Changes From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField htmlFor="changes-to-date" label="Changes To">
          <Input id="changes-to-date" aria-label="Changes To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
        <AsyncButton
          onClick={() => download.run(`/reports/export/field-changes?from_date=${from}&to_date=${to}`, "field_change_audit.xlsx")}
          pending={download.pending} pendingLabel="Preparing…"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download Field Change Audit (Excel)
        </AsyncButton>
      </div>
      {download.error && <p className="text-sm text-destructive" role="alert">{download.error}</p>}
    </div>
  );
}

/**
 * Reports (S5b-2): choose filters, SEE the result on screen (summary + the
 * file's own rows, 50 at a time), then download exactly that as Excel. The
 * server scopes everything to the person's companies and work area. To look up
 * one asset, the Assets register is the place (linked, not repeated here).
 */
export function ReportsScreen() {
  const [tab, setTab] = useState("assets");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description="Filter, check the result on screen, then download it as Excel." />
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-3">
        <TabsList className="h-auto w-fit max-w-full flex-wrap justify-start">
          <TabsTrigger value="assets">Asset register</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="changes">Field change audit</TabsTrigger>
        </TabsList>
        <TabsContent value="assets"><AssetReport /></TabsContent>
        <TabsContent value="movements"><MovementReport /></TabsContent>
        <TabsContent value="changes"><FieldChangeAudit /></TabsContent>
      </Tabs>
    </div>
  );
}
