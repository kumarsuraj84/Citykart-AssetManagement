import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { LOG_LEVELS, SYSTEM_COMPONENTS, logLevelLabel, systemComponentLabel, systemEventLabel } from "@/lib/labels";
import { DEFAULT_PERIOD, formatTime, presetPeriod, type Period, type SystemRow } from "./logs-api";
import {
  Chips, CodeBlock, DetailRow, ExportButtons, LevelBadge, PeriodFilter, RequestLink, TechLine, jsonText, pagerFor, useLogPage,
} from "./log-ui";
import { FilterSelect, useDebounced } from "./AuditTab";

export function systemWhat(r: Pick<SystemRow, "component" | "event">): string {
  return [systemComponentLabel(r.component), systemEventLabel(r.event)].filter(Boolean).join(" · ");
}

export function SystemDetail({ row }: { row: SystemRow }) {
  const hasDetails = row.details !== null && row.details !== undefined && !(typeof row.details === "object" && Object.keys(row.details as object).length === 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm break-words">{row.message || systemWhat(row)}</p>
      <dl className="divide-y">
        <DetailRow label="When">{formatTime(row.at)}</DetailRow>
        <DetailRow label="What">{systemWhat(row) || "—"}</DetailRow>
        <DetailRow label="Level"><LevelBadge level={row.level} /></DetailRow>
        <DetailRow label="Reference"><RequestLink id={row.request_id} /></DetailRow>
      </dl>
      {hasDetails && <CodeBlock label="Details" text={jsonText(row.details)} />}
      <TechLine parts={{ id: row.id, level: row.level, component: row.component, event: row.event }} />
    </div>
  );
}

/** System events: start-up / shut-down, ERP data copies, log clean-up, database lost / back… */
export function SystemTab() {
  const [period, setPeriod] = useState<Period>(() => presetPeriod(DEFAULT_PERIOD));
  const [level, setLevel] = useState("");
  const [component, setComponent] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<SystemRow | null>(null);
  const q = useDebounced(qDraft);
  const params = useMemo(() => ({ from: period.from, to: period.to, level, component, q: q.trim() }), [period, level, component, q]);
  useEffect(() => setPage(0), [params]);
  const listQ = useLogPage<SystemRow>("system", params, page);
  const rows = listQ.data?.data ?? [];

  const columns: DataTableColumn<SystemRow>[] = [
    { key: "at", header: "Time", cellClassName: "whitespace-nowrap text-xs tabular-nums", cell: (r) => formatTime(r.at) },
    { key: "level", header: "Level", cell: (r) => <LevelBadge level={r.level} /> },
    { key: "what", header: "What", cellClassName: "text-xs", cell: (r) => systemWhat(r) || "—" },
    { key: "message", header: "Message", cellClassName: "text-sm break-words", cell: (r) => r.message || "—" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <PeriodFilter value={period} onChange={setPeriod} idPrefix="system" />
        <ExportButtons kind="system" period={period} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Chips
          label="Level"
          value={level}
          onChange={setLevel}
          options={[{ value: "", label: "All" }, ...LOG_LEVELS.map((l) => ({ value: l, label: logLevelLabel(l) }))]}
        />
        <FilterSelect id="system-component" label="Part of the app" value={component} onChange={setComponent}
          options={SYSTEM_COMPONENTS.map((c) => ({ value: c, label: systemComponentLabel(c) }))} />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="system-q" className="text-xs text-muted-foreground">Search</Label>
          <Input id="system-q" className="h-8 w-52 text-xs" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Words in the message…" />
        </div>
      </div>
      <DataTable<SystemRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={listQ.isLoading}
        isError={listQ.isError}
        error={listQ.error}
        errorMessage="Couldn't read the system events."
        onRetry={() => listQ.refetch()}
        onRowClick={setOpen}
        emptyState={<EmptyState title="No system events in this period." />}
        pagination={pagerFor(page, rows.length, listQ.data?.total ?? null, setPage, "events")}
      />
      <Sheet open={open !== null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-xl">
          {open && (
            <>
              <SheetHeader className="pr-6 text-left">
                <SheetTitle className="text-base">{systemWhat(open) || "System event"}</SheetTitle>
                <SheetDescription>{formatTime(open.at)}</SheetDescription>
              </SheetHeader>
              <div className="mt-3"><SystemDetail row={open} /></div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
