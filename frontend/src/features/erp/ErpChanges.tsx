import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCompareArrows } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/shared/AsyncButton";

export interface ErpChange {
  id: string;
  kind: "PO_CANCELLED" | "CANCEL_UNITS" | "ADD_UNITS" | "COST_CHANGED" | "NEW_ITEM" | "HEADER" | "VENDOR_CHANGED";
  item_code: string | null;
  // VENDOR_CHANGED: the ERP moved the PO to another supplier. `linked_vendor_*` is the CKAM vendor linked to
  // that supplier in this PO's company, when there is one.
  was_vendor?: string;
  now_code?: string;
  now_name?: string;
  linked_vendor_id?: number | null;
  linked_vendor_name?: string | null;
  description?: string;
  message?: string;
  messages?: string[];
  pending_units?: number;
  delivered_units?: number;
  was_units?: number;
  erp_units?: number;
  count?: number;
  over_delivered?: number;
  can_add?: boolean;
  was_rate?: number;
  now_rate?: number;
  was_tax?: number | null;
  now_tax?: number | null;
  qty?: number;
  rate?: number;
}

export interface ErpChangesReport {
  po_id: number;
  po_number: string;
  found: boolean;
  watching: boolean;
  erp_status: string | null;
  erp_as_of: string | null;
  changes: ErpChange[];
  info: string[];
  log: { at: string; by: string | null; kind: string; item_code: string | null; summary: string }[];
}

interface Summary {
  available: boolean;
  items: { po_id: number; po_number: string; changes: number; cancelled: boolean }[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const money = (n: number | undefined) => (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null);

/** Which POs the ERP has changed. Only asks when this server has an ERP connection; any ERP trouble is
 * simply "nothing to show", since this is an extra and must never get in the way of the screen. */
export function useErpChangesSummary(enabled = true) {
  const statusQ = useQuery({
    queryKey: ["erp", "status"],
    queryFn: () => apiClient.get<{ configured: boolean }>("/erp/status"),
    enabled,
  });
  return useQuery({
    queryKey: ["erp", "changes-summary"],
    queryFn: () => apiClient.get<Summary>("/erp/changes/summary"),
    enabled: enabled && statusQ.data?.configured === true,
    retry: false,
  });
}

/** A small tag beside a PO number in a list. */
export function ErpChangedBadge({ summary, poId }: { summary: Summary | undefined; poId: number }) {
  const hit = summary?.items?.find((i) => i.po_id === poId);
  if (!hit) return null;
  return (
    <span
      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${hit.cancelled ? "bg-destructive/10 text-destructive" : "bg-warning/20 text-foreground"}`}
      title="The ERP has changed this purchase order since it was made here"
    >
      {hit.cancelled ? "Cancelled in ERP" : "ERP changed"}
    </span>
  );
}

/** Top of the Purchase Orders list: every PO the ERP has changed. */
export function ErpChangesCard() {
  const q = useErpChangesSummary();
  const items = q.data?.items ?? [];
  if (!Array.isArray(q.data?.items) || items.length === 0) return null;
  return (
    <section className="rounded-md border border-warning/50 bg-warning/10 p-3" aria-label="Purchase orders changed in the ERP">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
        The ERP has changed {plural(items.length, "purchase order")} made from it
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">Open the PO to see what is different. Nothing is changed here until you apply it.</p>
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.po_id}>
            <Link to="/purchase-orders/$id" params={{ id: String(i.po_id) }} className="rounded-sm border bg-background px-2 py-1 text-sm underline">
              {i.po_number}{i.cancelled ? " (cancelled)" : ` (${plural(i.changes, "change")})`}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What each difference is, in plain words, and what applying it would do. */
function Change({ c, busy, onChoose }: { c: ErpChange; busy: boolean; onChoose: (id: string, mode: "apply" | "keep") => void }) {
  const label = c.description ? `${c.description} (${c.item_code})` : c.item_code;
  const keep = (text: string) => (
    <Button size="sm" variant="outline" disabled={busy} aria-label={`${text}: ${c.id}`} onClick={() => onChoose(c.id, "keep")}>{text}</Button>
  );
  if (c.kind === "PO_CANCELLED") {
    return (
      <li className="flex flex-col gap-1 rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm">
        <p className="font-medium text-destructive">{c.message}</p>
        <p className="text-xs">
          {plural(c.pending_units ?? 0, "unit")} still pending here.
          {(c.delivered_units ?? 0) > 0 && ` ${plural(c.delivered_units ?? 0, "unit")} were already delivered before the cancel, so check with purchasing: they stay in the register.`}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => onChoose(c.id, "apply")}>
            Cancel the {plural(c.pending_units ?? 0, "pending unit")}
          </Button>
          {keep("Keep as it is")}
        </div>
      </li>
    );
  }
  if (c.kind === "CANCEL_UNITS") {
    return (
      <li className="flex flex-col gap-1 rounded-md border p-2 text-sm">
        <p>The ERP reduced <b>{label}</b> from {c.was_units} to {c.erp_units}.</p>
        {(c.over_delivered ?? 0) > 0 && (
          <p className="text-xs text-destructive">{plural(c.over_delivered ?? 0, "unit")} more than that {(c.over_delivered ?? 0) === 1 ? "was" : "were"} already delivered here: check with purchasing.</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onChoose(c.id, "apply")}>
            {(c.count ?? 0) > 0 ? `Cancel ${plural(c.count ?? 0, "pending unit")}` : "Nothing pending to cancel: mark as dealt with"}
          </Button>
          {(c.count ?? 0) > 0 && keep("Keep as it is")}
        </div>
      </li>
    );
  }
  if (c.kind === "ADD_UNITS") {
    return (
      <li className="flex flex-col gap-1 rounded-md border p-2 text-sm">
        <p>The ERP raised <b>{label}</b> from {c.was_units} to {c.erp_units}.</p>
        {!c.can_add && <p className="text-xs text-muted-foreground">There are no lines here to copy: add the extra units with + Add Line, then choose Keep.</p>}
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !c.can_add} onClick={() => onChoose(c.id, "apply")}>Add {plural(c.count ?? 0, "unit")}</Button>
          {keep("Keep as it is")}
        </div>
      </li>
    );
  }
  if (c.kind === "COST_CHANGED") {
    return (
      <li className="flex flex-col gap-1 rounded-md border p-2 text-sm">
        <p>
          The ERP changed the cost of <b>{label}</b> from {money(c.was_rate)} + {c.was_tax ?? 0}% tax to {money(c.now_rate)} + {c.now_tax ?? 0}% tax.
        </p>
        <p className="text-xs text-muted-foreground">
          {(c.pending_units ?? 0) > 0 ? `${plural(c.pending_units ?? 0, "pending unit")} would get the new cost.` : "Nothing is pending here."}
          {(c.delivered_units ?? 0) > 0 && ` ${plural(c.delivered_units ?? 0, "delivered unit")} keep the cost they were delivered with (the head-office admin can correct an asset's cost by editing it).`}
        </p>
        <div className="flex gap-2">
          {(c.pending_units ?? 0) > 0 && <Button size="sm" disabled={busy} onClick={() => onChoose(c.id, "apply")}>Update {plural(c.pending_units ?? 0, "pending unit")}</Button>}
          {keep((c.pending_units ?? 0) > 0 ? "Keep as it is" : "Noted")}
        </div>
      </li>
    );
  }
  if (c.kind === "VENDOR_CHANGED") {
    const known = c.linked_vendor_id != null;
    return (
      <li className="flex flex-col gap-1 rounded-md border p-2 text-sm">
        <p>The ERP moved this purchase order to another vendor: <b>{c.now_name}</b> (ERP code {c.now_code}).</p>
        {known ? (
          <p className="text-xs text-muted-foreground">That is the vendor <b>{c.linked_vendor_name}</b> here. Units already delivered keep the vendor they were delivered with.</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            That supplier is not linked to a vendor here yet. The head-office admin can link it in Settings › Vendors (Add from ERP), then you can move the PO.
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !known} onClick={() => onChoose(c.id, "apply")}>
            {known ? `Move this PO to ${c.linked_vendor_name}` : "Move this PO to the new vendor"}
          </Button>
          {keep("Keep the vendor")}
        </div>
      </li>
    );
  }
  if (c.kind === "NEW_ITEM") {
    return (
      <li className="flex flex-col gap-1 rounded-md border p-2 text-sm">
        <p>New in the ERP: <b>{label}</b>, {c.qty} at {money(c.rate)}.</p>
        <p className="text-xs text-muted-foreground">Add it with + Add Line (or + Add Bundle) below, then choose "Added it".</p>
        <div className="flex gap-2">{keep("Added it")}</div>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-1 rounded-md border p-2 text-sm">
      {(c.messages ?? []).map((m) => <p key={m}>{m}</p>)}
      <div className="flex gap-2">{keep("Noted")}</div>
    </li>
  );
}

/**
 * On a PO made from the ERP: what the ERP says is different now (cancelled, a quantity or cost edited, a new
 * line), and what applying each would do. Nothing changes by itself; delivered units are never touched.
 */
export function ErpChangesPanel({ poId }: { poId: number }) {
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ["erp", "status"], queryFn: () => apiClient.get<{ configured: boolean }>("/erp/status") });
  const q = useQuery({
    queryKey: ["erp", "po-changes", poId],
    queryFn: () => apiClient.get<ErpChangesReport>(`/erp/purchase-orders/${poId}/changes`),
    enabled: statusQ.data?.configured === true,
    retry: false,
  });
  const [showLog, setShowLog] = useState(false);

  const mutation = useMutation({
    mutationFn: (items: { id: string; mode: "apply" | "keep" }[]) =>
      apiClient.post<ErpChangesReport>(`/erp/purchase-orders/${poId}/changes/apply`, { items }),
    onSuccess: (report) => {
      qc.setQueryData(["erp", "po-changes", poId], report);
      qc.invalidateQueries({ queryKey: ["purchase-order", poId] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["erp", "changes-summary"] });
      qc.invalidateQueries({ queryKey: ["erp", "reminders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const choose = (id: string, mode: "apply" | "keep") => mutation.mutate([{ id, mode }]);

  const report = q.data;
  if (!report) return null;                                  // not set up, not readable, or loading: an extra, never in the way
  const asOf = when(report.erp_as_of);

  if (!report.watching) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm" aria-label="ERP changes">
        <span>This PO is not being compared with the ERP yet, so a cancellation or edit there would not show here.</span>
        <AsyncButton size="sm" variant="outline" pending={mutation.isPending} pendingLabel="Starting…" onClick={() => choose("WATCH", "apply")}>
          Start comparing with the ERP
        </AsyncButton>
      </section>
    );
  }
  if (report.changes.length === 0 && report.log.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/5 p-3" aria-label="ERP changes">
      {report.changes.length > 0 ? (
        <>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
            The ERP changed this purchase order since it was made here
          </h2>
          <p className="text-xs text-muted-foreground">
            Nothing is changed until you choose. Delivered units are never touched.{asOf && ` ERP data as of ${asOf}.`}
          </p>
          <ul className="flex flex-col gap-2">
            {report.changes.map((c) => <Change key={c.id} c={c} busy={mutation.isPending} onChoose={choose} />)}
          </ul>
        </>
      ) : null}
      {mutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {mutation.error instanceof Error ? mutation.error.message : "Could not apply the change."}
        </p>
      )}
      {report.log.length > 0 && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowLog((v) => !v)}>
            {showLog ? "Hide" : "Show"} what was done about ERP changes ({report.log.length})
          </Button>
          {showLog && (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {report.log.map((l) => (
                <li key={`${l.at}-${l.kind}-${l.item_code ?? ""}`}>
                  {when(l.at)} · {l.by ?? "—"}: {l.summary}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
