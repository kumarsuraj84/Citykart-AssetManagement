import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { apiClient } from "@/lib/api-client";
import {
  AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_ENTITIES, AUDIT_OUTCOMES, auditActionLabel, auditCategoryLabel,
  auditOutcomeLabel, entityLabel, fieldLabel, logSourceLabel, roleLabel,
} from "@/lib/labels";
import {
  DEFAULT_PERIOD, changeRows, formatTime, personOf, plainValue, presetPeriod, type AuditRow, type Period,
} from "./logs-api";
import {
  Chips, DetailRow, ExportButtons, OutcomeBadge, PeriodFilter, RequestLink, TechLine, pagerFor, useLogPage,
} from "./log-ui";

const ALL = "__all";

/** A text filter applied a moment after typing stops. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function recordText(row: Pick<AuditRow, "entity" | "entity_id">): string {
  if (!row.entity) return "—";
  return row.entity_id ? `${entityLabel(row.entity)} ${row.entity_id}` : entityLabel(row.entity);
}

/** An asset / PO id in `changes.ids` opens that record. */
function idLinks(entity: string | null, ids: unknown) {
  if (!Array.isArray(ids)) return plainValue(ids);
  const to = entity === "asset" ? "/assets/$id" : entity === "purchase_order" ? "/purchase-orders/$id" : null;
  if (!to) return ids.join(", ");
  return (
    <span className="flex flex-wrap gap-x-2">
      {ids.map((id) => (
        <Link key={String(id)} to={to as never} params={{ id: String(id) } as never} className="text-primary underline-offset-2 hover:underline">
          {String(id)}
        </Link>
      ))}
    </span>
  );
}

/** The before / after table of a row's `changes` (or field / value for creates and bulk rows). */
export function ChangesTable({ row }: { row: Pick<AuditRow, "changes" | "entity"> }) {
  const rows = changeRows(row.changes);
  if (rows.length === 0) return null;
  const diffs = rows.some((r) => r.kind === "diff");
  return (
    <table className="w-full table-fixed border-collapse text-xs" aria-label="Changes">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="w-1/3 py-1 pr-2 font-medium">Field</th>
          {diffs ? (
            <>
              <th className="py-1 pr-2 font-medium">Before</th>
              <th className="py-1 font-medium">After</th>
            </>
          ) : (
            <th className="py-1 font-medium">Value</th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field} className="border-b align-top last:border-0">
            <td className="py-1 pr-2 break-words">{fieldLabel(r.field)}</td>
            {r.kind === "diff" ? (
              <>
                <td className="py-1 pr-2 break-words text-muted-foreground">{plainValue(r.old)}</td>
                <td className="py-1 break-words">{plainValue(r.new)}</td>
              </>
            ) : diffs ? (
              <td colSpan={2} className="py-1 break-words">{r.field === "ids" ? idLinks(row.entity, r.value) : plainValue(r.value)}</td>
            ) : (
              <td className="py-1 break-words">{r.field === "ids" ? idLinks(row.entity, r.value) : plainValue(r.value)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Everything of one audit row (drawer body). */
export function AuditDetail({ row }: { row: AuditRow }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{row.summary || auditActionLabel(row.action)}</p>
      <dl className="divide-y">
        <DetailRow label="When">{formatTime(row.at)}</DetailRow>
        <DetailRow label="Person">
          {personOf(row)}
          {row.actor_role && <span className="text-muted-foreground"> · {roleLabel(row.actor_role, !!row.is_head_office_admin)}</span>}
        </DetailRow>
        <DetailRow label="What">{auditCategoryLabel(row.category)} · {auditActionLabel(row.action)}</DetailRow>
        <DetailRow label="Record">{recordText(row)}</DetailRow>
        <DetailRow label="Outcome"><OutcomeBadge outcome={row.outcome} /></DetailRow>
        <DetailRow label="Reference"><RequestLink id={row.request_id} /></DetailRow>
        <DetailRow label="IP address">{row.ip || "—"}</DetailRow>
        <DetailRow label="Source">{logSourceLabel(row.source) || "—"}</DetailRow>
      </dl>
      <ChangesTable row={row} />
      <TechLine parts={{ id: row.id, category: row.category, action: row.action, entity: row.entity, entity_id: row.entity_id, outcome: row.outcome, source: row.source, company_id: row.company_id }} />
    </div>
  );
}

export function AuditSheet({ row, onClose }: { row: AuditRow | null; onClose: () => void }) {
  return (
    <Sheet open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-xl">
        {row && (
          <>
            <SheetHeader className="pr-6 text-left">
              <SheetTitle className="text-base">{auditActionLabel(row.action)}</SheetTitle>
              <SheetDescription>{formatTime(row.at)}</SheetDescription>
            </SheetHeader>
            <div className="mt-3"><AuditDetail row={row} /></div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function auditColumns(): DataTableColumn<AuditRow>[] {
  return [
    { key: "at", header: "Time", cellClassName: "whitespace-nowrap text-xs tabular-nums", cell: (r) => formatTime(r.at) },
    { key: "person", header: "Person", cellClassName: "text-xs", cell: (r) => personOf(r) },
    {
      key: "what", header: "What",
      cell: (r) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-sm">{r.summary || auditActionLabel(r.action)}</span>
          <span className="text-xs text-muted-foreground">{auditCategoryLabel(r.category)} · {auditActionLabel(r.action)}</span>
        </div>
      ),
    },
    { key: "record", header: "Record", cellClassName: "text-xs", cell: (r) => recordText(r) },
    { key: "outcome", header: "Outcome", cell: (r) => <OutcomeBadge outcome={r.outcome} /> },
  ];
}

interface PersonOption {
  id: number;
  code: string | null;
  name: string;
  login_enabled?: boolean;
}

function FilterSelect({
  id, label, value, onChange, options,
}: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger id={id} aria-label={label} className="h-8 w-44 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export { FilterSelect, ALL };

/**
 * The audit trail (all data changes and security events) -- also the Security tab
 * (`mode="security"`: Security / Access rows only, with Refused / Failed chips).
 */
export function AuditTab({ mode = "audit" }: { mode?: "audit" | "security" }) {
  const security = mode === "security";
  const [period, setPeriod] = useState<Period>(() => presetPeriod(DEFAULT_PERIOD));
  const [actorId, setActorId] = useState("");
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [category, setCategory] = useState(security ? "SECURITY" : "");
  const [outcome, setOutcome] = useState("");
  const [requestIdDraft, setRequestIdDraft] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const q = useDebounced(qDraft);
  const requestId = useDebounced(requestIdDraft);

  const params = useMemo(() => ({
    from: period.from, to: period.to, actor_id: actorId, entity, action, category, outcome,
    request_id: requestId.trim(), q: q.trim(),
  }), [period, actorId, entity, action, category, outcome, requestId, q]);

  // Any filter change starts again at the first page.
  useEffect(() => setPage(0), [params]);

  const listQ = useLogPage<AuditRow>("audit", params, page);
  const peopleQ = useQuery({
    queryKey: ["admin-logs", "people"],
    queryFn: () => apiClient.get<PersonOption[]>("/asset-users"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const people = (Array.isArray(peopleQ.data) ? peopleQ.data : [])
    .filter((p) => p.login_enabled !== false)
    .map((p) => ({ value: String(p.id), label: p.name, detail: p.code ?? undefined }));

  const rows = listQ.data?.data ?? [];
  const total = listQ.data?.total ?? null;
  const prefix = security ? "sec" : "audit";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <PeriodFilter value={period} onChange={setPeriod} idPrefix={prefix} />
        <ExportButtons kind="audit" period={period} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {security ? (
          <>
            <Chips
              label="Kind of event"
              value={category}
              onChange={setCategory}
              options={[{ value: "SECURITY", label: auditCategoryLabel("SECURITY") }, { value: "ACCESS", label: auditCategoryLabel("ACCESS") }]}
            />
            <Chips
              label="Outcome"
              value={outcome}
              onChange={setOutcome}
              options={[{ value: "", label: "All" }, { value: "DENIED", label: auditOutcomeLabel("DENIED") }, { value: "FAILED", label: auditOutcomeLabel("FAILED") }]}
            />
          </>
        ) : (
          <>
            <FilterSelect id={`${prefix}-category`} label="Category" value={category} onChange={setCategory}
              options={AUDIT_CATEGORIES.map((c) => ({ value: c, label: auditCategoryLabel(c) }))} />
            <FilterSelect id={`${prefix}-entity`} label="Record type" value={entity} onChange={setEntity}
              options={AUDIT_ENTITIES.map((e) => ({ value: e, label: entityLabel(e) })).sort((a, b) => a.label.localeCompare(b.label))} />
            <FilterSelect id={`${prefix}-outcome`} label="Outcome" value={outcome} onChange={setOutcome}
              options={AUDIT_OUTCOMES.map((o) => ({ value: o, label: auditOutcomeLabel(o) }))} />
          </>
        )}
        <FilterSelect id={`${prefix}-action`} label="Action" value={action} onChange={setAction}
          options={AUDIT_ACTIONS.map((a) => ({ value: a, label: auditActionLabel(a) })).sort((a, b) => a.label.localeCompare(b.label))} />
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground" id={`${prefix}-person-label`}>Person</span>
          <div className="flex items-center gap-1">
            <SearchableSelect
              aria-label="Person"
              value={actorId || undefined}
              onValueChange={setActorId}
              options={people}
              placeholder="Anyone"
              className="h-8 w-48 text-xs"
            />
            {actorId && (
              <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setActorId("")}>Clear</button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={`${prefix}-request`} className="text-xs text-muted-foreground">Reference</Label>
          <Input id={`${prefix}-request`} className="h-8 w-44 font-mono text-xs" value={requestIdDraft} onChange={(e) => setRequestIdDraft(e.target.value)} placeholder="Request id" />
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={`${prefix}-q`} className="text-xs text-muted-foreground">Search</Label>
          <Input id={`${prefix}-q`} className="h-8 w-52 text-xs" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Name, code, record, words…" />
        </div>
      </div>
      <DataTable<AuditRow>
        columns={auditColumns()}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={listQ.isLoading}
        isError={listQ.isError}
        error={listQ.error}
        errorMessage="Couldn't read the audit trail."
        onRetry={() => listQ.refetch()}
        onRowClick={setOpen}
        emptyState={<EmptyState title={security ? "No security events in this period." : "Nothing recorded in this period."} description="Try a longer period or fewer filters." />}
        pagination={pagerFor(page, rows.length, total, setPage, security ? "events" : "entries")}
      />
      <AuditSheet row={open} onClose={() => setOpen(null)} />
    </div>
  );
}
