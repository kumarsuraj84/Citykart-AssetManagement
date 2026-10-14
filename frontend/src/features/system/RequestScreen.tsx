import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { apiClient } from "@/lib/api-client";
import {
  auditActionLabel, auditCategoryLabel, errorKindLabel, reportKindLabel, reportStatusLabel, roleLabel,
} from "@/lib/labels";
import {
  formatTime, personOf, type AccessLine, type AuditRow, type ClientReportRow, type ErrorRow, type RequestCorrelation, type SystemRow,
} from "./logs-api";
import { CopyButton, LevelBadge, OutcomeBadge } from "./log-ui";
import { AuditSheet } from "./AuditTab";
import { ErrorSheet } from "./ErrorsTab";
import { SystemDetail, systemWhat } from "./SystemTab";
import { BreadcrumbList, RecentRequests } from "./ReportsTab";
import { BundleActions } from "./BundleActions";
import { LOGS_PATH, ReferenceSearch } from "./LogsScreen";

type Entry =
  | { kind: "access"; at: string; row: AccessLine }
  | { kind: "audit"; at: string; row: AuditRow }
  | { kind: "security"; at: string; row: AuditRow }
  | { kind: "error"; at: string; row: ErrorRow }
  | { kind: "system"; at: string; row: SystemRow }
  | { kind: "report"; at: string; row: ClientReportRow };

const KIND_WORDS: Record<Entry["kind"], string> = {
  access: "Request",
  audit: "Change",
  security: "Security",
  error: "Error",
  system: "System",
  report: "Problem report",
};

/** Every row of the correlation, oldest first. */
export function timeline(data: RequestCorrelation): Entry[] {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const entries: Entry[] = [
    ...list(data.access_log).map((row: AccessLine) => ({ kind: "access" as const, at: row.ts ?? row.at ?? "", row })),
    ...list(data.audit).map((row: AuditRow) => ({ kind: "audit" as const, at: row.at, row })),
    ...list(data.security).map((row: AuditRow) => ({ kind: "security" as const, at: row.at, row })),
    ...list(data.errors).map((row: ErrorRow) => ({ kind: "error" as const, at: row.at, row })),
    ...list(data.system).map((row: SystemRow) => ({ kind: "system" as const, at: row.at, row })),
    ...list(data.client_reports).map((row: ClientReportRow) => ({ kind: "report" as const, at: row.at, row })),
  ];
  const t = (s: string) => {
    const n = new Date(s).getTime();
    return Number.isNaN(n) ? 0 : n;
  };
  return entries.sort((a, b) => t(a.at) - t(b.at));
}

function EntryBody({ entry, onOpen }: { entry: Entry; onOpen: (e: Entry) => void }) {
  const open = (label: string) => (
    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => onOpen(entry)} aria-label={label}>Details</Button>
  );
  switch (entry.kind) {
    case "access": {
      const r = entry.row;
      return (
        <span>
          {r.method} {r.route ?? r.path} → <span className="font-medium">{r.status}</span>
          <span className="text-muted-foreground">
            {typeof r.duration_ms === "number" ? ` in ${Math.round(r.duration_ms)} ms` : ""}
            {typeof r.sql_count === "number" ? ` · ${r.sql_count} database queries` : ""}
            {r.role ? ` · ${roleLabel(r.role)}` : ""}{r.ip ? ` · ${r.ip}` : ""}
          </span>
          {r.path && r.route && r.path !== r.route && <span className="block break-all font-mono text-[11px] text-muted-foreground">{r.path}</span>}
        </span>
      );
    }
    case "audit":
    case "security": {
      const r = entry.row;
      return (
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{r.summary || auditActionLabel(r.action)}</span>
          <span className="text-xs text-muted-foreground">{auditCategoryLabel(r.category)} · {auditActionLabel(r.action)} · {personOf(r)}</span>
          {r.outcome && r.outcome !== "OK" && <OutcomeBadge outcome={r.outcome} />}
          {open("Details of this change")}
        </span>
      );
    }
    case "error": {
      const r = entry.row;
      return (
        <span className="flex flex-wrap items-center gap-x-2">
          <LevelBadge level={r.level} />
          <span className="break-words">{r.message || "—"}</span>
          <span className="text-xs text-muted-foreground">{errorKindLabel(r.kind)}{r.exception_type ? ` · ${r.exception_type}` : ""}</span>
          {open("Details of this error")}
        </span>
      );
    }
    case "system":
      return (
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{entry.row.message || systemWhat(entry.row)}</span>
          <span className="text-xs text-muted-foreground">{systemWhat(entry.row)}</span>
          {open("Details of this event")}
        </span>
      );
    case "report": {
      const r = entry.row;
      return (
        <span className="flex flex-col gap-1">
          <span>
            {reportKindLabel(r.kind)}: {r.note || r.message || "—"}
            <span className="text-xs text-muted-foreground"> · {r.actor_code || "—"} · {reportStatusLabel(r.status)}</span>
          </span>
          {r.reference && <span className="text-xs text-muted-foreground">Report reference <code className="font-mono">{r.reference}</code></span>}
          <details className="text-xs">
            <summary className="cursor-pointer text-primary">Last actions and requests</summary>
            <div className="mt-1 flex flex-col gap-2">
              <BreadcrumbList items={r.breadcrumbs} />
              <RecentRequests items={r.recent_requests} />
            </div>
          </details>
        </span>
      );
    }
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Settings › System › Logs › Everything for request <id>: one request, in time order, across every log. */
export function RequestScreen({ requestId }: { requestId: string }) {
  const q = useQuery({
    queryKey: ["admin-logs", "request", requestId],
    queryFn: () => apiClient.get<RequestCorrelation>(`/admin/logs/request/${encodeURIComponent(requestId)}`),
    retry: false,
  });
  const [audit, setAudit] = useState<AuditRow | null>(null);
  const [error, setError] = useState<ErrorRow | null>(null);
  const [system, setSystem] = useState<SystemRow | null>(null);
  const entries = q.data ? timeline(q.data) : [];

  function onOpen(e: Entry) {
    if (e.kind === "audit" || e.kind === "security") setAudit(e.row);
    if (e.kind === "error") setError(e.row);
    if (e.kind === "system") setSystem(e.row);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Everything for this request"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={LOGS_PATH}>Back to Logs</Link>
          </Button>
        }
      >
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Reference</span>
          <code className="break-all font-mono text-xs" data-testid="request-id">{requestId}</code>
          <CopyButton text={requestId} />
        </p>
      </PageHeader>
      <ReferenceSearch />
      {q.isError ? (
        <ErrorState message="Couldn't read the logs for this reference." error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !q.data?.found && entries.length === 0 ? (
        <EmptyState
          title="Nothing was found for this reference."
          description="Check it was copied in full. Old entries may have been removed after the keeping period (the audit trail is kept forever)."
        />
      ) : (
        <Section title={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}, oldest first`}>
          <ol className="flex flex-col divide-y" aria-label="Everything for this request">
            {entries.map((e, i) => (
              <li key={`${e.kind}-${i}`} className="grid grid-cols-1 gap-1 py-2 text-sm sm:grid-cols-[9.5rem_7rem_minmax(0,1fr)] sm:gap-3" data-entry={e.kind}>
                <span className="text-xs tabular-nums text-muted-foreground">{formatTime(e.at)}</span>
                <span className="text-xs font-medium">{KIND_WORDS[e.kind]}</span>
                <EntryBody entry={e} onOpen={onOpen} />
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section title="Diagnostics for support">
        <BundleActions requestId={requestId} />
      </Section>
      <AuditSheet row={audit} onClose={() => setAudit(null)} />
      <ErrorSheet row={error} onClose={() => setError(null)} />
      {system && (
        <Section title="System event">
          <SystemDetail row={system} />
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSystem(null)}>Close</Button>
        </Section>
      )}
    </div>
  );
}
