import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { apiClient } from "@/lib/api-client";
import { entityLabel, humanizeCode } from "@/lib/labels";
import { formatTime, type DbAnswer, type HealthAnswer } from "./logs-api";
import { BundleActions } from "./BundleActions";
import { LOGS_PATH } from "./LogsScreen";

const isList = <T,>(v: unknown): v is T[] => Array.isArray(v);

/** A part the app's database account may not read: said calmly, never as an error. */
function NotPermitted({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value : "";
  return (
    <span className="text-xs text-muted-foreground">
      {text.startsWith("failed") ? `Could not be read (${text.replace(/^failed\s*/, "").replace(/[()]/g, "")}).` : "Not visible to the app's database account."}
    </span>
  );
}

function Check({ ok, label, children }: { ok: boolean | undefined; label: string; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Fine" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-label="Needs a look" />
      )}
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {children && <span className="text-muted-foreground"> · {children}</span>}
      </span>
    </li>
  );
}

function ago(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)} minutes ago`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const COUNT_WORDS: Record<string, string> = {
  audit_log: "Audit entries",
  error_log: "Errors kept",
  system_event: "System events",
  client_report: "Problem reports",
  asset_user: "People & places",
};

function HealthCard() {
  const q = useQuery({
    queryKey: ["admin-diagnostics", "health"],
    queryFn: () => apiClient.get<HealthAnswer>("/admin/diagnostics/health"),
    retry: false,
  });
  const h = q.data;
  const c = h?.checks ?? {};
  const counts = c.table_counts;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Health</CardTitle>
        <CardDescription>
          {h ? (
            <>
              {h.status === "ok" ? "Everything looks fine." : "Something needs a look."}{" "}
              <span className="text-xs">Version {h.version || "unknown"} · {humanizeCode(h.environment) || "—"} · checked {formatTime(h.checked_at)}</span>
            </>
          ) : "Is the app able to do its work?"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <ErrorState message="Couldn't run the health check." error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <ul className="divide-y" aria-label="Health checks">
              <Check ok={c.database?.ok} label="Database">
                {c.database?.ok ? `answers in ${c.database.latency_ms ?? "?"} ms` : c.database?.problem || "not reachable"}
              </Check>
              <Check ok={c.log_dir?.ok} label="Log folder">
                {c.log_dir?.ok ? "writable" : c.log_dir?.problem || "cannot be written"}
                {c.log_dir?.path ? ` (${c.log_dir.path})` : ""}
              </Check>
              <Check ok={c.migrations?.ok} label="Database version">
                {c.migrations?.pending ? "an update of the database is waiting" : c.migrations?.matches ? "up to date" : "differs from the app"}
              </Check>
              <Check ok={c.erp_sync?.ok} label="ERP data copy">
                {c.erp_sync?.configured === false ? "not set up" : c.erp_sync?.enabled === false ? "switched off" : `last good copy ${ago(c.erp_sync?.minutes_since_last_success)}`}
              </Check>
            </ul>
            {counts && typeof counts === "object" ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3" aria-label="Counts">
                {Object.entries(counts).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{COUNT_WORDS[k] ?? entityLabel(k)}</dt>
                    <dd className="tabular-nums">{typeof v === "number" ? v.toLocaleString("en-IN") : "—"}</dd>
                  </div>
                ))}
              </dl>
            ) : counts !== undefined ? <NotPermitted value={counts} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Rows({ value, empty, render }: { value: unknown; empty: string; render: (rows: Record<string, unknown>[]) => ReactNode }) {
  if (!isList<Record<string, unknown>>(value)) return value === undefined ? null : <NotPermitted value={value} />;
  if (value.length === 0) return <span className="text-xs text-muted-foreground">{empty}</span>;
  return <>{render(value)}</>;
}

function DatabaseCard() {
  const q = useQuery({
    queryKey: ["admin-diagnostics", "db"],
    queryFn: () => apiClient.get<DbAnswer>("/admin/diagnostics/db"),
    retry: false,
  });
  const d = q.data;
  const db = isList<{ name?: string; size?: string }>(d?.database) ? d!.database[0] : null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Database</CardTitle>
        <CardDescription>
          {d ? (d.connected ? `Connected · ${d.latency_ms ?? "?"} ms · PostgreSQL ${String(d.server_version ?? "").split(" ")[0]}` : "Not connected") : "Connections, slow queries, locks and size."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {q.isError ? (
          <ErrorState message="Couldn't read the database figures." error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading || !d ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold">Size</span>
              {db ? <span>{db.name ? `${db.name}: ` : ""}{db.size ?? "—"}</span> : <NotPermitted value={d.database} />}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold">Connections</span>
              <Rows value={d.connections_by_state} empty="None." render={(rows) => (
                <span>{rows.map((r) => `${humanizeCode(String(r.state ?? "unknown"))}: ${r.connections}`).join(" · ")}</span>
              )} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold">Long-running queries</span>
              <Rows value={d.long_running_queries} empty="None right now." render={(rows) => (
                <ul className="flex flex-col gap-1 text-xs">
                  {rows.map((r, i) => (
                    <li key={i} className="break-all font-mono">{String(r.seconds ?? r.duration ?? "")} {String(r.query ?? JSON.stringify(r)).slice(0, 300)}</li>
                  ))}
                </ul>
              )} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold">Waiting for a lock</span>
              <Rows value={d.lock_waits} empty="Nothing is waiting." render={(rows) => (
                <ul className="flex flex-col gap-1 text-xs">
                  {rows.map((r, i) => <li key={i} className="break-all font-mono">{JSON.stringify(r).slice(0, 300)}</li>)}
                </ul>
              )} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold">Largest tables</span>
              <Rows value={d.largest_tables} empty="—" render={(rows) => (
                <table className="w-full text-xs" aria-label="Largest tables">
                  <tbody>
                    {rows.slice(0, 8).map((r) => (
                      <tr key={String(r.table)} className="border-b last:border-0">
                        <td className="py-0.5 font-mono">{String(r.table)}</td>
                        <td className="py-0.5 text-right tabular-nums">{String(r.size ?? "")}</td>
                        <td className="py-0.5 text-right tabular-nums text-muted-foreground">{typeof r.live_rows === "number" ? `${r.live_rows.toLocaleString("en-IN")} rows` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold">Slow-query logging</span>
              {typeof d.slow_statement_logging_on === "boolean" ? (
                <span>{d.slow_statement_logging_on ? "On — statements slower than the limit are written to the database's own log." : "Off — ask the DBA to switch it on (see the logging guide)."}</span>
              ) : <NotPermitted value={d.slow_statement_logging_on} />}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Settings › System › Diagnostics (head-office admin): health, database, and the support bundle. */
export function DiagnosticsScreen() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Diagnostics"
        description="How the app and its database are doing, and everything support needs in one copy."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={LOGS_PATH}>Logs</Link>
          </Button>
        }
      />
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Diagnostics for support</CardTitle>
          <CardDescription>Versions, recent errors, security and system events, slow requests and the database, in one text.</CardDescription>
        </CardHeader>
        <CardContent>
          <BundleActions />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HealthCard />
        <DatabaseCard />
      </div>
    </div>
  );
}
