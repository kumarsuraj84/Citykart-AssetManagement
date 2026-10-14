import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { apiClient } from "@/lib/api-client";
import { REPORT_KINDS, reportKindLabel, reportStatusLabel } from "@/lib/labels";
import { DEFAULT_PERIOD, formatTime, presetPeriod, type ClientReportRow, type Period } from "./logs-api";
import {
  Chips, CodeBlock, CopyButton, DetailRow, ExportButtons, PeriodFilter, RequestLink, TechLine, pagerFor, useLogPage,
} from "./log-ui";
import { FilterSelect, useDebounced } from "./AuditTab";

const CRUMB_WORDS: Record<string, string> = {
  nav: "Opened", click: "Clicked", dialog: "Dialog", api: "Request", key: "Key", error: "Error",
};

/** The breadcrumbs of a report, one readable line each (any shape tolerated). */
export function BreadcrumbList({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return <p className="text-xs text-muted-foreground">No recent actions were sent.</p>;
  return (
    <ol className="flex flex-col gap-0.5 text-xs" aria-label="Last actions">
      {list.map((c, i) => {
        const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
        const type = String(o.type ?? o.t ?? "");
        const text = typeof o.text === "string" ? o.text : typeof o.to === "string" ? `Opened ${o.to}` : JSON.stringify(c);
        const at = typeof o.at === "string" ? o.at : null;
        return (
          <li key={i} className="grid grid-cols-[7.5rem_4.5rem_minmax(0,1fr)] gap-2">
            <span className="tabular-nums text-muted-foreground">{at ? formatTime(at).split(", ").pop() : ""}</span>
            <span className="text-muted-foreground">{CRUMB_WORDS[type] ?? type}</span>
            <span className="break-words">{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The last requests of a report: method, path, answer, time, reference (links to everything for it). */
export function RecentRequests({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return <p className="text-xs text-muted-foreground">No requests were sent.</p>;
  return (
    <table className="w-full table-fixed text-xs" aria-label="Last requests">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="w-16 py-1 font-medium">Method</th>
          <th className="py-1 font-medium">Path</th>
          <th className="w-14 py-1 font-medium">Answer</th>
          <th className="w-14 py-1 text-right font-medium">ms</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r, i) => {
          const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
          const id = (typeof o.requestId === "string" && o.requestId) || (typeof o.request_id === "string" && o.request_id) || null;
          return (
            <tr key={i} className="border-b align-top last:border-0">
              <td className="py-1">{String(o.method ?? "")}</td>
              <td className="py-1 break-all">
                {String(o.path ?? "")}
                {id && <div><RequestLink id={id} /></div>}
              </td>
              <td className="py-1 tabular-nums">{o.status === 0 ? "none" : String(o.status ?? "")}</td>
              <td className="py-1 text-right tabular-nums">{typeof o.ms === "number" ? Math.round(o.ms) : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ReportDetail({ row, onReviewed }: { row: ClientReportRow; onReviewed?: (r: ClientReportRow) => void }) {
  const qc = useQueryClient();
  const review = useMutation({
    mutationFn: () => apiClient.patch<ClientReportRow>(`/admin/logs/client-reports/${row.id}`, { status: "REVIEWED" }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ["admin-logs"] });
      onReviewed?.(updated && typeof updated === "object" ? updated : { ...row, status: "REVIEWED" });
    },
  });
  return (
    <div className="flex flex-col gap-3">
      {row.note && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-xs text-muted-foreground">What the person wrote</span>
          <p className="whitespace-pre-wrap break-words">{row.note}</p>
        </div>
      )}
      {row.message && <p className="text-sm font-medium break-words">{row.message}</p>}
      <dl className="divide-y">
        <DetailRow label="When">{formatTime(row.at)}</DetailRow>
        <DetailRow label="Kind">{reportKindLabel(row.kind)}</DetailRow>
        <DetailRow label="Person">{row.actor_code || "—"}</DetailRow>
        <DetailRow label="Screen">{row.route || "—"}</DetailRow>
        <DetailRow label="Report reference">
          {row.reference ? (
            <span className="inline-flex flex-wrap items-center gap-2"><code className="break-all font-mono text-xs">{row.reference}</code><CopyButton text={row.reference} /></span>
          ) : "—"}
        </DetailRow>
        <DetailRow label="Failing request"><RequestLink id={row.request_id} /></DetailRow>
        <DetailRow label="App version">{row.app_version || "—"}</DetailRow>
        <DetailRow label="Browser">{row.user_agent || "—"}</DetailRow>
        <DetailRow label="Status">
          {reportStatusLabel(row.status)}
          {row.reviewed_at && <span className="text-muted-foreground"> · {formatTime(row.reviewed_at)}</span>}
        </DetailRow>
      </dl>
      {row.status !== "REVIEWED" && (
        <div className="flex flex-col items-start gap-1">
          <AsyncButton size="sm" onClick={() => review.mutate()} pending={review.isPending} pendingLabel="Saving…">Mark reviewed</AsyncButton>
          {review.isError && <ErrorMessage error={review.error} />}
        </div>
      )}
      <section aria-label="Last actions before the report" className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold">Last actions</h3>
        <BreadcrumbList items={row.breadcrumbs} />
      </section>
      <section aria-label="Last requests before the report" className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold">Last requests</h3>
        <RecentRequests items={row.recent_requests} />
      </section>
      {row.stack && <CodeBlock label="Stack trace" text={row.stack} />}
      <TechLine parts={{ id: row.id, kind: row.kind, status: row.status, fingerprint: row.fingerprint }} />
    </div>
  );
}

type StatusFilter = "NEW" | "REVIEWED" | "";

/** Problem reports from the browser: automatic (screen errors, failed requests) and "Report a problem". */
export function ReportsTab() {
  const [period, setPeriod] = useState<Period>(() => presetPeriod(DEFAULT_PERIOD));
  const [status, setStatus] = useState<StatusFilter>("NEW");
  const [kind, setKind] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<ClientReportRow | null>(null);
  const q = useDebounced(qDraft);
  const params = useMemo(() => ({ from: period.from, to: period.to, status, kind, q: q.trim() }), [period, status, kind, q]);
  useEffect(() => setPage(0), [params]);
  const listQ = useLogPage<ClientReportRow>("client-reports", params, page);
  const rows = listQ.data?.data ?? [];

  const columns: DataTableColumn<ClientReportRow>[] = [
    { key: "at", header: "Time", cellClassName: "whitespace-nowrap text-xs tabular-nums", cell: (r) => formatTime(r.at) },
    { key: "person", header: "Person", cellClassName: "text-xs", cell: (r) => r.actor_code || "—" },
    { key: "kind", header: "Kind", cellClassName: "text-xs", cell: (r) => reportKindLabel(r.kind) },
    { key: "what", header: "What", cellClassName: "text-sm break-words", cell: (r) => r.note || r.message || "—" },
    { key: "route", header: "Screen", cellClassName: "text-xs break-all", cell: (r) => r.route || "—" },
    { key: "status", header: "Status", cellClassName: "text-xs", cell: (r) => reportStatusLabel(r.status) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <PeriodFilter value={period} onChange={setPeriod} idPrefix="reports" />
        <ExportButtons kind="client" period={period} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Chips<StatusFilter>
          label="Status"
          value={status}
          onChange={setStatus}
          options={[{ value: "NEW", label: reportStatusLabel("NEW") }, { value: "REVIEWED", label: reportStatusLabel("REVIEWED") }, { value: "", label: "All" }]}
        />
        <FilterSelect id="reports-kind" label="Kind" value={kind} onChange={setKind}
          options={REPORT_KINDS.map((k) => ({ value: k, label: reportKindLabel(k) }))} />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="reports-q" className="text-xs text-muted-foreground">Search</Label>
          <Input id="reports-q" className="h-8 w-52 text-xs" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Words, screen, person…" />
        </div>
      </div>
      <DataTable<ClientReportRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={listQ.isLoading}
        isError={listQ.isError}
        error={listQ.error}
        errorMessage="Couldn't read the problem reports."
        onRetry={() => listQ.refetch()}
        onRowClick={setOpen}
        emptyState={<EmptyState title={status === "NEW" ? "No new problem reports." : "No problem reports in this period."} />}
        pagination={pagerFor(page, rows.length, listQ.data?.total ?? null, setPage, "reports")}
      />
      <Sheet open={open !== null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-2xl">
          {open && (
            <>
              <SheetHeader className="pr-6 text-left">
                <SheetTitle className="text-base">{reportKindLabel(open.kind)}</SheetTitle>
                <SheetDescription>{formatTime(open.at)}</SheetDescription>
              </SheetHeader>
              <div className="mt-3"><ReportDetail row={open} onReviewed={setOpen} /></div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
