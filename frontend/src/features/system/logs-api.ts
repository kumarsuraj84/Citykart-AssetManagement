/**
 * S8: the head-office admin's Logs & Diagnostics API (backend `app/observability/admin_router.py`) --
 * the row shapes, the query strings, the periods. Every endpoint answers 403 to anyone else.
 */

export interface AuditRow {
  id: number;
  at: string;
  request_id: string | null;
  source: string | null;
  actor_id: number | null;
  actor_code: string | null;
  actor_name: string | null;
  actor_role: string | null;
  is_head_office_admin: boolean | null;
  company_id: number | null;
  ip: string | null;
  category: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  summary: string | null;
  changes: unknown;
  outcome: string | null;
}

export interface ErrorRow {
  id: number;
  at: string;
  request_id: string | null;
  level: string | null;
  source: string | null;
  kind: string | null;
  exception_type: string | null;
  message: string | null;
  stack: string | null;
  route: string | null;
  method: string | null;
  status_code: number | null;
  actor_id: number | null;
  actor_code: string | null;
  ip: string | null;
  user_agent: string | null;
  context: unknown;
  fingerprint: string | null;
}

export interface ErrorGroup {
  fingerprint: string;
  exception_type: string | null;
  message: string | null;
  level: string | null;
  kind: string | null;
  count: number;
  first_seen: string;
  last_seen: string;
  last_request_id: string | null;
  sample_route: string | null;
}

export interface SystemRow {
  id: number;
  at: string;
  level: string | null;
  component: string | null;
  event: string | null;
  message: string | null;
  details: unknown;
  request_id: string | null;
}

export interface ClientReportRow {
  id: number;
  at: string;
  request_id: string | null;
  reference: string | null;
  actor_id: number | null;
  actor_code: string | null;
  route: string | null;
  app_version: string | null;
  user_agent: string | null;
  kind: string;
  message: string | null;
  stack: string | null;
  breadcrumbs: unknown;
  recent_requests: unknown;
  note: string | null;
  status: string;
  fingerprint: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
}

export interface AccessLine {
  ts?: string;
  at?: string;
  kind?: string;
  request_id?: string;
  actor_id?: number | null;
  role?: string | null;
  ip?: string | null;
  method?: string;
  route?: string;
  path?: string;
  status?: number;
  duration_ms?: number;
  bytes?: number;
  sql_count?: number;
  sql_ms?: number;
}

export interface RequestCorrelation {
  request_id: string;
  found: boolean;
  audit: AuditRow[];
  security: AuditRow[];
  errors: ErrorRow[];
  system: SystemRow[];
  client_reports: ClientReportRow[];
  access_log: AccessLine[];
}

export type NotPermitted = string;

export interface HealthAnswer {
  status: string;
  version: string | null;
  environment: string | null;
  checked_at: string | null;
  checks: {
    database?: { ok: boolean; latency_ms?: number | null; problem?: string | null };
    log_dir?: { ok: boolean; path?: string | null; problem?: string | null };
    migrations?: { ok: boolean; code_head?: string | null; db_head?: string | null; matches?: boolean; pending?: boolean };
    erp_sync?: { ok: boolean; configured?: boolean; enabled?: boolean; minutes_since_last_success?: number | null };
    table_counts?: Record<string, number | null> | NotPermitted;
    [key: string]: unknown;
  };
}

export interface DbAnswer {
  checked_at?: string;
  connected?: boolean;
  latency_ms?: number | null;
  server_version?: string | null;
  database?: { name?: string; role?: string; size?: string; size_bytes?: number; is_replica?: boolean }[] | NotPermitted;
  connections_by_state?: { state: string | null; connections: number }[] | NotPermitted;
  long_running_queries?: Record<string, unknown>[] | NotPermitted;
  lock_waits?: Record<string, unknown>[] | NotPermitted;
  largest_tables?: { table: string; bytes?: number; size?: string; live_rows?: number | null }[] | NotPermitted;
  dead_tuples_top?: Record<string, unknown>[] | NotPermitted;
  logging_settings?: { name: string; setting: string; unit?: string | null }[] | NotPermitted;
  slow_statement_logging_on?: boolean | NotPermitted | null;
  [key: string]: unknown;
}

export interface BundleAnswer {
  markdown: string;
  generated_at?: string;
  period_hours?: number;
  [key: string]: unknown;
}

/** The page size of every log list. */
export const PAGE_SIZE = 50;

/** "a=1&b=x" from the set values only (blank / null / undefined / false left out). */
export function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === false) continue;
    const s = String(v).trim();
    if (s === "") continue;
    sp.set(k, s);
  }
  return sp.toString();
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type PeriodPreset = "hour" | "today" | "week" | "any" | "custom";

export interface Period {
  preset: PeriodPreset;
  /** A date (YYYY-MM-DD, the whole day) or an ISO date-time; "" = open. */
  from: string;
  to: string;
}

/** Today in the browser's own time zone, as YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The period of a quick chip, measured from `now`. */
export function presetPeriod(preset: PeriodPreset, now: Date = new Date()): Period {
  switch (preset) {
    case "hour":
      return { preset, from: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), to: "" };
    case "today":
      return { preset, from: localDate(now), to: localDate(now) };
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { preset, from: localDate(start), to: localDate(now) };
    }
    default:
      return { preset, from: "", to: "" };
  }
}

export const DEFAULT_PERIOD: PeriodPreset = "week";

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** "14 Oct 2026, 09:20:40" in the browser's time zone. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

/** A request id or a problem-report reference: 1–64 of A-Z a-z 0-9 . _ - (as the server accepts). */
export function cleanReference(input: string): string | null {
  const t = input.trim().replace(/^reference\s*[:#]?\s*/i, "").trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(t) ? t : null;
}

export function requestPath(id: string): string {
  return `/settings/system/logs/request/${encodeURIComponent(id)}`;
}

/** The person of an audit row: "Ravi Kumar (EMP01)"; a job / script row says so. */
export function personOf(row: { actor_name?: string | null; actor_code?: string | null; source?: string | null }): string {
  if (row.actor_name && row.actor_code) return `${row.actor_name} (${row.actor_code})`;
  if (row.actor_name || row.actor_code) return (row.actor_name || row.actor_code) as string;
  if (row.source === "job") return "Background job";
  if (row.source === "script") return "Set-up script";
  return "—";
}

/** A value of a "changes" cell, readable. */
export function plainValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" || typeof v === "number") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export type ChangeRow =
  | { kind: "diff"; field: string; old: unknown; new: unknown }
  | { kind: "value"; field: string; value: unknown };

/** `changes` as rows: `{field: {old, new}}` -> before/after; anything else -> field/value. */
export function changeRows(changes: unknown): ChangeRow[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  return Object.entries(changes as Record<string, unknown>).map(([field, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && ("old" in v || "new" in v)) {
      const d = v as { old?: unknown; new?: unknown };
      return { kind: "diff", field, old: d.old, new: d.new };
    }
    return { kind: "value", field, value: v };
  });
}
