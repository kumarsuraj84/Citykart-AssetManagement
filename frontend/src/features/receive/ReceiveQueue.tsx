import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { poStatusLabel } from "@/lib/labels";
import { PoStatusBadge } from "../purchase-orders/PoStatusBadge";
import { type PoListRow, loadedAndTotal, useDebounced, usePoPages } from "../purchase-orders/po-list";
import { useErpReminders } from "../erp/DeliveryReminders";

/**
 * Receive: the purchase orders that still have units waiting for goods
 * (GET /purchase-orders?waiting=true), each with Open and Receive.
 *
 * Receive opens the Receive screen of that PO (/receive/$poId, S4): the
 * receipt details once, a quantity per line, serials only where needed.
 */

const num = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-IN") : "—");
const plural = (n: number, word: string) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;

const CHIPS = [
  { value: "", label: "All waiting" },
  { value: "WAITING", label: poStatusLabel("WAITING") },
  { value: "PARTLY_RECEIVED", label: poStatusLabel("PARTLY_RECEIVED") },
];

export function ReceiveQueue() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const q = useDebounced(search.trim(), 300);
  const posQ = usePoPages({ waiting: true, status, q });

  // Optional: POs where the ERP shows goods arrived that are not received here yet.
  // S7 (P1-1): the same reminders call as the PO list; "not available" is simply no information.
  const remindersQ = useErpReminders();
  const erpArrived = new Map((remindersQ.data?.available ? remindersQ.data.items : []).map((r) => [r.po_id, r.to_deliver]));

  const rows = (posQ.data?.pages ?? []).flatMap((p) => p.rows);
  const { loaded, total } = loadedAndTotal(posQ.data?.pages);
  const showErp = rows.some((r) => erpArrived.has(r.id));

  const openPo = (po: PoListRow) => navigate({ to: "/purchase-orders/$id", params: { id: String(po.id) } });
  const receivePo = (po: PoListRow) => navigate({ to: "/receive/$poId", params: { poId: String(po.id) }, search: {} });

  const columns: DataTableColumn<PoListRow>[] = [
    {
      key: "po_number",
      header: "PO No",
      cellClassName: "font-medium",
      cell: (po) => (
        <Link to="/purchase-orders/$id" params={{ id: String(po.id) }} onClick={(e) => e.stopPropagation()}>
          {po.po_number}
        </Link>
      ),
    },
    { key: "vendor", header: "Vendor", cell: (po) => po.vendor_name ?? "—" },
    { key: "company", header: "Company", cell: (po) => po.company_name ?? "—" },
    { key: "po_date", header: "PO Date", cell: (po) => po.po_date },
    {
      key: "waiting", header: "Waiting", headerClassName: "text-right", cellClassName: "text-right tabular-nums font-semibold",
      cell: (po) => num(po.waiting_units),
    },
    { key: "ordered", header: "Ordered", headerClassName: "text-right", cellClassName: "text-right tabular-nums", cell: (po) => num(po.ordered_units) },
    { key: "received", header: "Received", headerClassName: "text-right", cellClassName: "text-right tabular-nums", cell: (po) => num(po.received_units) },
    { key: "status", header: "Status", cell: (po) => <PoStatusBadge status={po.status} /> },
    ...(showErp
      ? [{
          key: "erp",
          header: "ERP",
          cell: (po: PoListRow) =>
            erpArrived.has(po.id) ? (
              <span className="text-xs">ERP shows {plural(erpArrived.get(po.id) ?? 0, "unit")} arrived</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        }]
      : []),
    {
      key: "__actions",
      header: <span className="sr-only">Actions</span>,
      headerClassName: "text-right",
      cellClassName: "text-right",
      cell: (po) => (
        <div className="flex justify-end gap-1.5">
          <Button asChild size="sm" variant="outline">
            <Link
              to="/purchase-orders/$id"
              params={{ id: String(po.id) }}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open ${po.po_number}`}
            >
              Open
            </Link>
          </Button>
          <Button
            size="sm"
            aria-label={`Receive ${po.po_number}`}
            onClick={(e) => {
              e.stopPropagation();
              receivePo(po);
            }}
          >
            Receive
          </Button>
        </div>
      ),
    },
  ];

  const filtered = q !== "" || status !== "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Receive"
        description="Purchase orders with units still waiting for goods. Receive opens one screen: receipt details once, a quantity per line."
        actions={
          <Button asChild variant="outline">
            <Link to="/purchase-orders">All Purchase Orders</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search purchase orders to receive"
          placeholder="Search PO No or Vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
          {CHIPS.map((chip) => (
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
            columns={columns}
            rows={rows}
            rowKey={(po) => po.id}
            isLoading={posQ.isLoading}
            onRowClick={(po) => openPo(po)}
            emptyState={
              filtered ? (
                <EmptyState title="No matches" description="Try a different search or filter." />
              ) : (
                <EmptyState
                  icon={PackageCheck}
                  title="Nothing waiting to be received."
                  description="Every purchase order's goods have been received."
                />
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
                <AsyncButton size="sm" variant="outline" onClick={() => posQ.fetchNextPage()} pending={posQ.isFetchingNextPage} pendingLabel="Loading…">
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
