import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ERROR_KINDS, LOG_LEVELS, errorKindLabel, errorSourceLabel, logLevelLabel } from "@/lib/labels";
import { DEFAULT_PERIOD, formatTime, presetPeriod, type ErrorGroup, type ErrorRow, type Period } from "./logs-api";
import {
  Chips, CodeBlock, DetailRow, ExportButtons, LevelBadge, PeriodFilter, RequestLink, TechLine, jsonText, pagerFor, useLogPage,
} from "./log-ui";
import { FilterSelect, useDebounced } from "./AuditTab";

/** Everything of one error occurrence (drawer body). */
export function ErrorDetail({ row }: { row: ErrorRow }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium break-words">{row.message || "—"}</p>
      <dl className="divide-y">
        <DetailRow label="When">{formatTime(row.at)}</DetailRow>
        <DetailRow label="What">{errorKindLabel(row.kind)}{row.exception_type ? ` · ${row.exception_type}` : ""}</DetailRow>
        <DetailRow label="Level"><LevelBadge level={row.level} /></DetailRow>
        <DetailRow label="Where">{[row.method, row.route].filter(Boolean).join(" ") || "—"}{row.status_code ? ` → ${row.status_code}` : ""}</DetailRow>
        <DetailRow label="Person">{row.actor_code || "—"}</DetailRow>
        <DetailRow label="Reference"><RequestLink id={row.request_id} /></DetailRow>
        <DetailRow label="From">{errorSourceLabel(row.source) || "—"}</DetailRow>
        <DetailRow label="IP address">{row.ip || "—"}</DetailRow>
        <DetailRow label="Browser">{row.user_agent || "—"}</DetailRow>
      </dl>
      {row.stack && <CodeBlock label="Stack trace" text={row.stack} />}
      {row.context !== null && row.context !== undefined && <CodeBlock label="Context" text={jsonText(row.context)} />}
      <TechLine parts={{ id: row.id, level: row.level, kind: row.kind, source: row.source, fingerprint: row.fingerprint }} />
    </div>
  );
}

export function ErrorSheet({ row, onClose }: { row: ErrorRow | null; onClose: () => void }) {
  return (
    <Sheet open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-2xl">
        {row && (
          <>
            <SheetHeader className="pr-6 text-left">
              <SheetTitle className="text-base">{errorKindLabel(row.kind) || "Error"}</SheetTitle>
              <SheetDescription>{formatTime(row.at)}</SheetDescription>
            </SheetHeader>
            <div className="mt-3"><ErrorDetail row={row} /></div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

type View = "grouped" | "all";

/** Errors: grouped by fingerprint (default), or every occurrence; [Open] a group -> its occurrences. */
export function ErrorsTab() {
  const [view, setView] = useState<View>("grouped");
  const [period, setPeriod] = useState<Period>(() => presetPeriod(DEFAULT_PERIOD));
  const [kind, setKind] = useState("");
  const [level, setLevel] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [group, setGroup] = useState<ErrorGroup | null>(null);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<ErrorRow | null>(null);
  const q = useDebounced(qDraft);

  const grouped = view === "grouped" && group === null;
  const params = useMemo(() => ({
    from: period.from, to: period.to, kind, level, q: q.trim(),
    fingerprint: group?.fingerprint ?? "", group: grouped,
  }), [period, kind, level, q, group, grouped]);
  useEffect(() => setPage(0), [params]);

  const groupsQ = useLogPage<ErrorGroup>("errors", params, page, grouped);
  const rowsQ = useLogPage<ErrorRow>("errors", params, page, !grouped);

  const groupColumns: DataTableColumn<ErrorGroup>[] = [
    {
      key: "message", header: "Error",
      cell: (g) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-sm break-words">{g.message || "—"}</span>
          <span className="text-xs text-muted-foreground">
            {errorKindLabel(g.kind)}{g.exception_type ? ` · ${g.exception_type}` : ""}{g.sample_route ? ` · ${g.sample_route}` : ""}
          </span>
        </div>
      ),
    },
    { key: "count", header: "Times", cellClassName: "text-right tabular-nums", headerClassName: "text-right", cell: (g) => g.count.toLocaleString("en-IN") },
    { key: "first", header: "First seen", cellClassName: "whitespace-nowrap text-xs tabular-nums", cell: (g) => formatTime(g.first_seen) },
    { key: "last", header: "Last seen", cellClassName: "whitespace-nowrap text-xs tabular-nums", cell: (g) => formatTime(g.last_seen) },
    {
      key: "open", header: <span className="sr-only">Open</span>, cellClassName: "text-right",
      cell: (g) => (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" aria-label={`Open ${g.message ?? "this error"}`}
          onClick={(e) => { e.stopPropagation(); setGroup(g); }}>
          Open
        </Button>
      ),
    },
  ];

  const rowColumns: DataTableColumn<ErrorRow>[] = [
    { key: "at", header: "Time", cellClassName: "whitespace-nowrap text-xs tabular-nums", cell: (r) => formatTime(r.at) },
    { key: "level", header: "Level", cell: (r) => <LevelBadge level={r.level} /> },
    {
      key: "message", header: "Error",
      cell: (r) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-sm break-words">{r.message || "—"}</span>
          <span className="text-xs text-muted-foreground">{errorKindLabel(r.kind)}{r.exception_type ? ` · ${r.exception_type}` : ""}</span>
        </div>
      ),
    },
    { key: "route", header: "Where", cellClassName: "text-xs break-all", cell: (r) => [r.method, r.route].filter(Boolean).join(" ") || "—" },
    { key: "person", header: "Person", cellClassName: "text-xs", cell: (r) => r.actor_code || "—" },
  ];

  const groups = groupsQ.data?.data ?? [];
  const rows = rowsQ.data?.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <PeriodFilter value={period} onChange={setPeriod} idPrefix="errors" />
        <ExportButtons kind="errors" period={period} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Chips
          label="Show"
          value={view}
          onChange={(v) => { setView(v); setGroup(null); }}
          options={[{ value: "grouped", label: "Grouped" }, { value: "all", label: "Every occurrence" }]}
        />
        <FilterSelect id="errors-kind" label="Kind" value={kind} onChange={setKind}
          options={ERROR_KINDS.map((k) => ({ value: k, label: errorKindLabel(k) }))} />
        <FilterSelect id="errors-level" label="Level" value={level} onChange={setLevel}
          options={LOG_LEVELS.filter((l) => l !== "INFO").map((l) => ({ value: l, label: logLevelLabel(l) }))} />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="errors-q" className="text-xs text-muted-foreground">Search</Label>
          <Input id="errors-q" className="h-8 w-52 text-xs" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Message, route…" />
        </div>
      </div>
      {group && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status">
          <span className="min-w-0 break-words">
            Every time this happened: <span className="font-medium">{group.message || "—"}</span>{" "}
            <span className="text-muted-foreground">({group.count.toLocaleString("en-IN")})</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setGroup(null)}>Back to all errors</Button>
        </div>
      )}
      {grouped ? (
        <DataTable<ErrorGroup>
          columns={groupColumns}
          rows={groups}
          rowKey={(g) => g.fingerprint}
          isLoading={groupsQ.isLoading}
          isError={groupsQ.isError}
          error={groupsQ.error}
          errorMessage="Couldn't read the errors."
          onRetry={() => groupsQ.refetch()}
          onRowClick={setGroup}
          emptyState={<EmptyState title="No errors in this period." description="Good news. Try a longer period to see older ones." />}
          pagination={pagerFor(page, groups.length, groupsQ.data?.total ?? null, setPage, "kinds of error")}
        />
      ) : (
        <DataTable<ErrorRow>
          columns={rowColumns}
          rows={rows}
          rowKey={(r) => r.id}
          isLoading={rowsQ.isLoading}
          isError={rowsQ.isError}
          error={rowsQ.error}
          errorMessage="Couldn't read the errors."
          onRetry={() => rowsQ.refetch()}
          onRowClick={setOpen}
          emptyState={<EmptyState title="No errors in this period." />}
          pagination={pagerFor(page, rows.length, rowsQ.data?.total ?? null, setPage, "errors")}
        />
      )}
      <ErrorSheet row={open} onClose={() => setOpen(null)} />
    </div>
  );
}
