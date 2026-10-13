import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { useTableSort } from "@/components/shared/useTableSort";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PO_STATUSES, poStatusLabel } from "@/lib/labels";
import { DeliveryRemindersCard } from "../erp/DeliveryReminders";
import { ErpChangedBadge, ErpChangesCard, useErpChangesSummary } from "../erp/ErpChanges";
import { ErpSyncStatus } from "../erp/ErpSyncStatus";
import { PoStatusBadge } from "./PoStatusBadge";
import { type PoListRow, loadedAndTotal, useDebounced, usePoPages } from "./po-list";

type PiStatus = NonNullable<PoListRow["pi_status"]>;

const PI_STATUS_LABEL: Record<PiStatus, string> = {
  NOT_DELIVERED: "—",
  PENDING: "Pending",
  RECORDED: "Recorded",
};

/** The Purchase Invoice (PI) of a PO, compact: status dot + word, then the PI No · Date when one is set. */
function PiCell({ po }: { po: PoListRow }) {
  const status = po.pi_status ?? "NOT_DELIVERED";
  if (status === "NOT_DELIVERED") return <span className="text-muted-foreground">—</span>;
  const dotClass = status === "RECORDED" ? "bg-success" : "bg-warning";
  const detail = [po.pi_number, po.pi_date].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col">
      <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        {PI_STATUS_LABEL[status]}
      </span>
      {detail && <span className="text-[11px] text-muted-foreground">{detail}</span>}
    </div>
  );
}

const num = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-IN") : "—");

const columns = (erpChanges: Parameters<typeof ErpChangedBadge>[0]["summary"]): DataTableColumn<PoListRow>[] => [
  {
    key: "po_number",
    header: "PO No",
    cellClassName: "font-medium",
    sortable: true,
    // A real, independently keyboard-focusable link -- the row's own onClick
    // is a mouse-convenience shortcut to the same destination.
    cell: (po) => (
      <>
        <Link to="/purchase-orders/$id" params={{ id: String(po.id) }} onClick={(e) => e.stopPropagation()}>
          {po.po_number}
        </Link>
        <ErpChangedBadge summary={erpChanges} poId={po.id} />
      </>
    ),
  },
  { key: "vendor", header: "Vendor", sortable: true, cell: (po) => po.vendor_name ?? "—" },
  { key: "company", header: "Company", sortable: true, cell: (po) => po.company_name ?? "—" },
  { key: "po_date", header: "Date", sortable: true, cell: (po) => po.po_date },
  {
    // S7 (P3-7): everything ordered, cancelled units included -- a cancelled PO reads "15 (15 cancelled)", not 0.
    key: "ordered", header: "Ordered", headerClassName: "text-right", cellClassName: "text-right tabular-nums",
    cell: (po) => {
      const cancelled = po.cancelled_units ?? 0;
      const ordered = po.originally_ordered_units ?? ((po.ordered_units ?? 0) + cancelled);
      return cancelled > 0
        ? <>{num(ordered)} <span className="text-xs text-muted-foreground">({num(cancelled)} cancelled)</span></>
        : num(po.ordered_units);
    },
  },
  { key: "received", header: "Received", headerClassName: "text-right", cellClassName: "text-right tabular-nums", cell: (po) => num(po.received_units) },
  {
    key: "waiting", header: "Waiting", headerClassName: "text-right", sortable: true,
    cellClassName: "text-right tabular-nums",
    cell: (po) => <span className={(po.waiting_units ?? 0) > 0 ? "font-semibold" : undefined}>{num(po.waiting_units)}</span>,
  },
  { key: "status", header: "Status", sortable: true, cell: (po) => <PoStatusBadge status={po.status} /> },
  // Purchase Invoice is spelled out once on the screen, in this column's header.
  { key: "pi", header: "Purchase Invoice (PI)", sortable: true, cell: (po) => <PiCell po={po} /> },
];

export function PurchaseOrdersList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const q = useDebounced(search.trim(), 300);

  const baseQ = usePoPages({ status });
  const searchQ = usePoPages({ status, q }, q !== "");
  const posQ = q ? searchQ : baseQ;
  const erpChangesQ = useErpChangesSummary();

  const baseRows = (baseQ.data?.pages ?? []).flatMap((p) => p.rows);
  const serverRows = (posQ.data?.pages ?? []).flatMap((p) => p.rows);
  // The server searches PO No and vendor; a PI No (AM-21) is still found
  // among the purchase orders already loaded.
  const needle = q.toLowerCase();
  const piMatches = q
    ? baseRows.filter((po) => (po.pi_number ?? "").toLowerCase().includes(needle) && !serverRows.some((r) => r.id === po.id))
    : [];
  const rows = [...serverRows, ...piMatches];
  const page = loadedAndTotal(posQ.data?.pages);
  const loaded = page.loaded + piMatches.length;
  const total = page.total === null ? null : page.total + piMatches.length;

  const { sortedRows, sort, toggleSort } = useTableSort<PoListRow>(rows, {
    po_number: (po) => po.po_number,
    po_date: (po) => po.po_date,
    vendor: (po) => po.vendor_name ?? "",
    company: (po) => po.company_name ?? "",
    waiting: (po) => po.waiting_units ?? 0,
    status: (po) => poStatusLabel(po.status),
    pi: (po) => PI_STATUS_LABEL[po.pi_status ?? "NOT_DELIVERED"],
  });

  const filtered = search.trim() !== "" || status !== "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Purchase Orders"
        description="Track goods on order until they are received and invoiced."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/purchase-orders/from-erp">Pick from ERP</Link>
            </Button>
            <Button asChild>
              <Link to="/purchase-orders/new">New Purchase Order</Link>
            </Button>
          </div>
        }
      />

      {/* ERP: secondary and compact; each shows only when there is something to act on. */}
      <div className="flex flex-col gap-2">
        <ErpSyncStatus />
        <ErpChangesCard />
        <DeliveryRemindersCard />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search Purchase Orders"
          placeholder="Search PO No, Vendor or PI No…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show purchase orders">
          {[{ value: "", label: "All" }, ...PO_STATUSES.map((s) => ({ value: s, label: poStatusLabel(s) }))].map((chip) => (
            <Button
              key={chip.value || "all"}
              size="sm"
              variant={status === chip.value ? "secondary" : "ghost"}
              className="h-8 px-2.5 text-xs"
              aria-pressed={status === chip.value}
              onClick={() => setStatus(chip.value)}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      </div>

      {posQ.isError ? (
        <ErrorState
          message={posQ.error instanceof Error ? posQ.error.message : "Couldn't load purchase orders."}
          onRetry={() => posQ.refetch()}
        />
      ) : (
        <>
          <DataTable
            columns={columns(erpChangesQ.data)}
            rows={sortedRows}
            rowKey={(po) => po.id}
            isLoading={posQ.isLoading}
            onRowClick={(po) => navigate({ to: "/purchase-orders/$id", params: { id: String(po.id) } })}
            sort={sort}
            onSortToggle={toggleSort}
            emptyState={
              filtered ? (
                <EmptyState title="No matches" description="Try a different search or status." />
              ) : (
                <EmptyState title="No purchase orders yet." />
              )
            }
          />
          {!posQ.isLoading && rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span role="status">
                Showing {loaded.toLocaleString("en-IN")}
                {total !== null ? ` of ${total.toLocaleString("en-IN")}` : ""} purchase order{(total ?? loaded) === 1 ? "" : "s"}
              </span>
              {posQ.hasNextPage && (
                <AsyncButton
                  size="sm"
                  variant="outline"
                  onClick={() => posQ.fetchNextPage()}
                  pending={posQ.isFetchingNextPage}
                  pendingLabel="Loading…"
                >
                  Load more
                </AsyncButton>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
