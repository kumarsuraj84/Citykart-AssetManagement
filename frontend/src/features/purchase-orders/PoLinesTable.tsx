import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { cn } from "@/lib/utils";
import { serialModeLabel, workAreaLabel } from "@/lib/labels";
import { PoStatusBadge } from "./PoStatusBadge";
import { type LineGroup, type PendingAssetRow, lineTitle, money } from "./po-detail-types";

/**
 * A purchase order's LINES (S2): one row per line however many units it
 * holds, with Ordered / Received / Waiting counts. Unit-level detail (serial
 * numbers, the asset each received unit became, per-unit edit/cancel) is
 * behind "View units", loaded only for the line that is opened.
 */

type UnitFilter = "WAITING" | "RECEIVED" | "CANCELLED";

const FILTERS: { value: UnitFilter; label: string; count: (l: LineGroup) => number }[] = [
  { value: "WAITING", label: "Waiting", count: (l) => l.waiting },
  { value: "RECEIVED", label: "Received", count: (l) => l.received },
  { value: "CANCELLED", label: "Cancelled", count: (l) => l.cancelled },
];

interface Props {
  poId: number;
  lines: LineGroup[];
  isLoading: boolean;
  /** The line whose waiting units are being fetched for receiving. */
  receivingLine: number | null;
  onReceive: (line: LineGroup) => void;
  onEdit: (line: LineGroup) => void;
  onCancelWaiting: (line: LineGroup) => void;
  onEditUnit: (unit: PendingAssetRow) => void;
  onCancelUnit: (unit: PendingAssetRow) => void;
}

const COLS = 9;

export function PoLinesTable({ poId, lines, isLoading, receivingLine, onReceive, onEdit, onCancelWaiting, onEditUnit, onCancelUnit }: Props) {
  const [open, setOpen] = useState<Record<number, boolean>>({});

  return (
    <div className="overflow-hidden rounded-md border">
      <Table aria-label="Purchase order lines">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Ordered</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Waiting</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {Array.from({ length: COLS }).map((__, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))
          ) : lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLS} className="py-6 text-center text-sm text-muted-foreground">
                No lines yet. Add a line or a set.
              </TableCell>
            </TableRow>
          ) : (
            lines.map((l) => {
              const title = lineTitle(l);
              const expanded = !!open[l.line_no];
              const sub = [
                l.item_name && l.description !== l.item_name ? l.description : null,
                serialModeLabel(l.serial_mode),
              ].filter(Boolean).join(" · ");
              return (
                <Fragment key={l.line_no}>
                  <TableRow aria-label={`Line ${l.line_no}: ${title}`} className="align-top">
                    <TableCell className="tabular-nums text-muted-foreground">{l.line_no}</TableCell>
                    <TableCell className="min-w-[14rem]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{title}</span>
                        {l.bundle_label && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{l.bundle_label}</span>
                        )}
                        {l.work_area && (
                          <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{workAreaLabel(l.work_area)}</span>
                        )}
                      </div>
                      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.ordered}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.received}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", l.waiting > 0 && "font-semibold")}>{l.waiting}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(l.rate)}
                      {(l.tax_percent ?? 0) > 0 && <div className="text-[11px] text-muted-foreground">+{l.tax_percent}% tax</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.line_value)}</TableCell>
                    <TableCell><PoStatusBadge status={l.status} /></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {l.waiting > 0 && (
                          <AsyncButton
                            size="sm"
                            onClick={() => onReceive(l)}
                            pending={receivingLine === l.line_no}
                            pendingLabel="Opening…"
                            disabled={receivingLine !== null && receivingLine !== l.line_no}
                            aria-label={`Receive line ${l.line_no} (${title})`}
                          >
                            Receive
                          </AsyncButton>
                        )}
                        <Button size="sm" variant="outline" onClick={() => onEdit(l)} aria-label={`Edit line ${l.line_no} (${title})`}>
                          Edit
                        </Button>
                        {l.waiting > 0 && (
                          <Button size="sm" variant="outline" onClick={() => onCancelWaiting(l)} aria-label={`Cancel waiting on line ${l.line_no} (${title})`}>
                            Cancel waiting
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Hide" : "View"} units of line ${l.line_no} (${title})`}
                          onClick={() => setOpen((o) => ({ ...o, [l.line_no]: !expanded }))}
                        >
                          {expanded ? <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                          {expanded ? "Hide units" : "View units"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={COLS} className="p-2">
                        <LineUnits poId={poId} line={l} onEditUnit={onEditUnit} onCancelUnit={onCancelUnit} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function defaultFilter(l: LineGroup): UnitFilter {
  if (l.waiting > 0) return "WAITING";
  if (l.received > 0) return "RECEIVED";
  return "CANCELLED";
}

/** The units of one line, fetched only when the line is opened, one status at a time. */
function LineUnits({ poId, line, onEditUnit, onCancelUnit }: {
  poId: number;
  line: LineGroup;
  onEditUnit: (unit: PendingAssetRow) => void;
  onCancelUnit: (unit: PendingAssetRow) => void;
}) {
  const [filter, setFilter] = useState<UnitFilter>(() => defaultFilter(line));
  const q = useQuery({
    queryKey: ["purchase-order", poId, "line-units", line.line_no, filter],
    queryFn: () => apiClient.get<PendingAssetRow[]>(`/purchase-orders/${poId}/line-groups/${line.line_no}/units?status=${filter}`),
  });
  const units = Array.isArray(q.data) ? q.data : [];
  const title = lineTitle(line);

  return (
    <section className="flex flex-col gap-2" aria-label={`Units of line ${line.line_no}`}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Show units of line ${line.line_no}`}>
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label} ({f.count(line)})
          </Button>
        ))}
      </div>
      {q.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {q.error instanceof Error ? q.error.message : "Couldn't load the units."}
        </p>
      ) : q.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading units…</p>
      ) : units.length === 0 ? (
        <p className="text-xs text-muted-foreground">No {filter === "WAITING" ? "waiting" : filter === "RECEIVED" ? "received" : "cancelled"} units on this line.</p>
      ) : (
        <div className="overflow-hidden rounded-md border bg-background">
          <Table aria-label={`Units of line ${line.line_no} (${title})`}>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Barcode</TableHead>
                {filter === "RECEIVED" && <TableHead>Serial No</TableHead>}
                {filter === "RECEIVED" && <TableHead>Invoice No</TableHead>}
                {filter === "RECEIVED" && <TableHead>Asset</TableHead>}
                <TableHead className="text-right">Value</TableHead>
                {filter === "WAITING" && <TableHead><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    {u.description}
                    {u.bundle_label && (
                      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{u.bundle_label}</span>
                    )}
                  </TableCell>
                  <TableCell>{u.barcode ?? "—"}</TableCell>
                  {filter === "RECEIVED" && <TableCell>{u.serial_number ?? "—"}</TableCell>}
                  {filter === "RECEIVED" && <TableCell>{u.invoice_number ?? "—"}</TableCell>}
                  {filter === "RECEIVED" && (
                    <TableCell>
                      {u.delivered_asset_id != null ? (
                        <Link to="/assets/$id" params={{ id: String(u.delivered_asset_id) }} className="underline">
                          {u.delivered_asset_code || "Open asset"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">{money(u.total_cost)}</TableCell>
                  {filter === "WAITING" && (
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7" onClick={() => onEditUnit(u)} aria-label={`Edit unit ${u.id}`}>
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" className="h-7" onClick={() => onCancelUnit(u)} aria-label={`Cancel unit ${u.id}`}>
                          Cancel
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
