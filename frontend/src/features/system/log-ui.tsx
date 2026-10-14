import { useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import type { DataTablePagination } from "@/components/shared/DataTable";
import { apiClient } from "@/lib/api-client";
import { downloadFile } from "@/lib/auth-fetch";
import { copyText, selectContents } from "@/lib/clipboard";
import { auditOutcomeLabel, logLevelLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  PAGE_SIZE, presetPeriod, queryString, requestPath, type Period, type PeriodPreset,
} from "./logs-api";

/** One list page of a log endpoint, with the server's total (X-Total-Count). */
export function useLogPage<T>(endpoint: string, params: Record<string, string | number | boolean | null | undefined>, page: number, enabled = true) {
  const qs = queryString({ ...params, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  return useQuery({
    queryKey: ["admin-logs", endpoint, qs],
    queryFn: () => apiClient.getPage<T[]>(`/admin/logs/${endpoint}?${qs}`),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });
}

/** The table's paging line ("Showing 51–100 of 312") for a page of `rows` rows. */
export function pagerFor(page: number, rows: number, total: number | null, setPage: (p: number) => void, noun: string): DataTablePagination | undefined {
  const known = total ?? (page * PAGE_SIZE + rows);
  if (known === 0) return undefined;
  const first = page * PAGE_SIZE + 1;
  const last = page * PAGE_SIZE + rows;
  const pages = Math.max(1, Math.ceil(known / PAGE_SIZE));
  return {
    summary: `Showing ${first.toLocaleString("en-IN")}–${last.toLocaleString("en-IN")} of ${known.toLocaleString("en-IN")} ${noun}`,
    pageLabel: `Page ${page + 1} of ${pages}`,
    onPrevious: () => setPage(Math.max(0, page - 1)),
    onNext: () => setPage(page + 1),
    previousDisabled: page === 0,
    nextDisabled: total !== null ? last >= total : rows < PAGE_SIZE,
  };
}

/** A row of toggle chips (one chosen). */
export function Chips<V extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="sm"
          variant={o.value === value ? "default" : "outline"}
          aria-pressed={o.value === value}
          className="h-7 px-2.5 text-xs"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

const PERIOD_CHIPS: { value: PeriodPreset; label: string }[] = [
  { value: "hour", label: "Last hour" },
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "any", label: "Any time" },
];

/** Period: quick chips (Last hour / Today / 7 days / Any time) and From / To dates. */
export function PeriodFilter({ value, onChange, idPrefix }: { value: Period; onChange: (p: Period) => void; idPrefix: string }) {
  const dateOf = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Chips
        label="Period"
        options={PERIOD_CHIPS}
        value={value.preset === "custom" ? ("custom" as PeriodPreset) : value.preset}
        onChange={(p) => onChange(presetPeriod(p))}
      />
      <div className="flex items-end gap-1.5">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={`${idPrefix}-from`} className="text-xs text-muted-foreground">From</Label>
          <Input
            id={`${idPrefix}-from`} type="date" className="h-8 w-36 text-xs" value={dateOf(value.from)}
            onChange={(e) => onChange({ preset: "custom", from: e.target.value, to: value.to })}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={`${idPrefix}-to`} className="text-xs text-muted-foreground">To</Label>
          <Input
            id={`${idPrefix}-to`} type="date" className="h-8 w-36 text-xs" value={dateOf(value.to)}
            onChange={(e) => onChange({ preset: "custom", from: value.from, to: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  const o = (outcome ?? "OK").toUpperCase();
  const tone = o === "OK" ? "text-muted-foreground" : o === "DENIED" ? "text-on-warning-soft bg-warning-soft border-warning/40" : "text-destructive bg-destructive/10 border-destructive/30";
  return <span className={cn("inline-flex rounded border px-1.5 py-0.5 text-xs", o === "OK" && "border-transparent px-0", tone)}>{auditOutcomeLabel(o)}</span>;
}

export function LevelBadge({ level }: { level: string | null | undefined }) {
  const l = (level ?? "").toUpperCase();
  const tone = l === "CRITICAL" || l === "ERROR"
    ? "text-destructive bg-destructive/10 border-destructive/30"
    : l === "WARNING" ? "text-on-warning-soft bg-warning-soft border-warning/40" : "text-muted-foreground border-transparent px-0";
  return <span className={cn("inline-flex rounded border px-1.5 py-0.5 text-xs", tone)}>{logLevelLabel(l) || "—"}</span>;
}

/** The raw codes of a row, muted, for support (never the only way something is said). */
export function TechLine({ parts }: { parts: Record<string, string | number | null | undefined> }) {
  const text = Object.entries(parts)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
  if (!text) return null;
  return <p className="break-all font-mono text-[11px] text-muted-foreground" data-testid="tech-line">{text}</p>;
}

/** One "label: value" line of a detail drawer. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** A copy button for any text (falls back to selecting the target element). */
export function CopyButton({ text, label = "Copy", target, className }: { text: string; label?: string; target?: () => Element | null; className?: string }) {
  const [state, setState] = useState<"idle" | "yes" | "no">("idle");
  return (
    <button
      type="button"
      className={cn("cursor-pointer text-xs font-medium text-primary underline-offset-2 hover:underline", className)}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyText(text);
        setState(ok ? "yes" : "no");
        if (!ok && target) selectContents(target());
      }}
    >
      {state === "yes" ? "Copied" : state === "no" ? "Selected — press Ctrl+C" : label}
    </button>
  );
}

/** A request id: a link to "Everything for this request" and Copy. */
export function RequestLink({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Link to={requestPath(id) as never} className="break-all font-mono text-xs text-primary underline-offset-2 hover:underline" title="Everything for this request">
        {id}
      </Link>
      <CopyButton text={id} />
    </span>
  );
}

/** A monospaced, scrollable block (stack traces, JSON) with Copy. */
export function CodeBlock({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton text={text} target={() => ref.current} />
      </div>
      <pre ref={ref} aria-label={label} className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-snug whitespace-pre">
        {text}
      </pre>
    </div>
  );
}

export function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** JSONL / CSV export of a log for the chosen period (GET /admin/logs/export). */
export function ExportButtons({ kind, period }: { kind: "audit" | "errors" | "system" | "client"; period: Period }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  async function run(format: "jsonl" | "csv") {
    setBusy(format);
    setFailure(null);
    try {
      const qs = queryString({ kind, from: period.from, to: period.to, format });
      await downloadFile(`/admin/logs/export?${qs}`, `ckam-${kind}-log.${format}`, "Export failed");
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5" title="Exports the chosen period, oldest first">
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy !== null} onClick={() => void run("jsonl")}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export JSONL
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy !== null} onClick={() => void run("csv")}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export CSV
        </Button>
      </div>
      {failure !== null && <ErrorMessage error={failure} className="text-xs" />}
    </div>
  );
}
