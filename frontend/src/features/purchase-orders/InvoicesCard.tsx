import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { cn } from "@/lib/utils";
import { ErpPiPanel } from "../erp/ErpPiDialog";
import { PrintLabelsAction } from "../labels/PrintLabelsAction";
import { money } from "./po-detail-types";

/** One invoice received under a PO (GET /purchase-orders/{id}/invoices). */
export interface InvoiceSummary {
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_amount: number | null;
  units: number;
  asset_ids: number[];
  asset_count: number;
  asset_ids_truncated?: boolean;
  pi_number: string | null;
  pi_date: string | null;
  /** PENDING (some asset has no PI yet) | RECORDED */
  pi_status: string;
}

interface RecordPiResult {
  invoice_number: string;
  updated: string[];
  skipped: string[];
}

const plural = (n: number, one: string) => `${n.toLocaleString("en-IN")} ${one}${n === 1 ? "" : "s"}`;

function piText(inv: InvoiceSummary): string {
  if (inv.pi_status === "RECORDED") {
    return inv.pi_number ? `PI ${inv.pi_number}${inv.pi_date ? ` · ${inv.pi_date}` : ""}` : "PI recorded (more than one)";
  }
  return inv.pi_number ? `PI ${inv.pi_number} on some units; others pending` : "PI pending";
}

/**
 * The invoices received under a PO, from one small request (no unit list is
 * loaded): number, date, amount, units and their Purchase Invoice (PI). One
 * entry point records a PI -- typed in per invoice, or (for a PO from the ERP)
 * fetched from the ERP -- and the received units' labels can be printed here.
 */
export function InvoicesCard({ poId, invoices, fromErp }: { poId: number; invoices: InvoiceSummary[]; fromErp: boolean }) {
  const [piOpen, setPiOpen] = useState(false);
  const [round, setRound] = useState(0);
  const assetIds = [...new Set(invoices.flatMap((i) => i.asset_ids ?? []))];
  const truncated = invoices.some((i) => i.asset_ids_truncated);
  const withNumber = invoices.filter((i) => !!i.invoice_number);

  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" aria-label="Invoices received">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Invoices received ({invoices.length})</h2>
        <div className="flex flex-wrap gap-2">
          {assetIds.length > 0 && (
            <PrintLabelsAction assetIds={assetIds}>Print labels for the received units</PrintLabelsAction>
          )}
          {withNumber.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => { setRound((r) => r + 1); setPiOpen(true); }}>
              Record PI
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Purchase Invoice (PI) number and date arrive from Finance per invoice, not per PO: each invoice below gets its own PI.
        {truncated ? " Labels: the first 200 units of each invoice." : ""}
      </p>
      <ul className="flex flex-col divide-y rounded-md border" aria-label="Invoices">
        {invoices.map((inv, i) => (
          <li key={`${inv.invoice_number ?? "none"}-${i}`} className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_6rem_7rem_4rem_minmax(0,12rem)] sm:items-center">
            <span className="font-medium">{inv.invoice_number ?? "No invoice number"}</span>
            <span className="text-xs text-muted-foreground sm:text-sm sm:text-foreground">{inv.invoice_date ?? "—"}</span>
            <span className="tabular-nums sm:text-right">{inv.invoice_amount != null ? money(inv.invoice_amount) : "—"}</span>
            <span className="tabular-nums text-muted-foreground sm:text-right">{plural(inv.units, "unit")}</span>
            <span className={cn("col-span-2 text-xs sm:col-span-1", inv.pi_status === "RECORDED" ? "text-foreground" : "text-warning-foreground")}>
              {piText(inv)}
            </span>
          </li>
        ))}
      </ul>

      <Dialog open={piOpen} onOpenChange={setPiOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record PI</DialogTitle>
            <DialogDescription>
              {fromErp ? "Fetch the PI from the ERP, or type it in for one invoice." : "Type in the PI for one invoice."}
            </DialogDescription>
          </DialogHeader>
          {piOpen && <PiEntry key={round} poId={poId} invoices={withNumber} fromErp={fromErp} onClose={() => setPiOpen(false)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Inside the one PI dialog: "Fetch from ERP" (ERP POs) or "Type it in" (per invoice, with overwrite). */
function PiEntry({ poId, invoices, fromErp, onClose }: { poId: number; invoices: InvoiceSummary[]; fromErp: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [way, setWay] = useState<"erp" | "type">(fromErp ? "erp" : "type");
  const firstPending = invoices.find((i) => i.pi_status !== "RECORDED") ?? invoices[0];
  const [invoice, setInvoice] = useState(firstPending?.invoice_number ?? "");
  const [form, setForm] = useState({ piNumber: "", piDate: "", overwrite: false });
  const [result, setResult] = useState<RecordPiResult | null>(null);

  const recordMutation = useMutation({
    mutationFn: () =>
      apiClient.post<RecordPiResult>(`/purchase-orders/${poId}/record-pi`, {
        invoice_number: invoice,
        pi_number: form.piNumber,
        pi_date: form.piDate,
        overwrite: form.overwrite,
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["purchase-order", poId] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
  const canSave = invoice !== "" && form.piNumber.trim() !== "" && form.piDate !== "";

  return (
    <div className="flex flex-col gap-3">
      {fromErp && (
        <div role="radiogroup" aria-label="How to record the PI" className="flex flex-wrap gap-1.5">
          {([["erp", "Fetch from ERP"], ["type", "Type it in"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={way === v}
              onClick={() => setWay(v)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm",
                way === v ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {way === "erp" ? (
        <ErpPiPanel poId={poId} onClose={onClose} />
      ) : result ? (
        <div className="flex flex-col gap-2 text-sm" role="status">
          <p>PI recorded for invoice {result.invoice_number}: {plural(result.updated.length, "asset")} updated.</p>
          {result.skipped.length > 0 && (
            <p className="text-muted-foreground">
              {plural(result.skipped.length, "asset")} already had a PI and {result.skipped.length === 1 ? "was" : "were"} left as {result.skipped.length === 1 ? "it was" : "they were"} (tick “Overwrite existing values” and save again to correct them).
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResult(null); setForm({ piNumber: "", piDate: "", overwrite: false }); }}>Record another</Button>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium" id="pi-invoice-label">Invoice</span>
            <div role="radiogroup" aria-labelledby="pi-invoice-label" className="flex flex-col gap-1">
              {invoices.map((inv) => (
                <label key={inv.invoice_number} className="flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1 text-sm">
                  <input
                    type="radio"
                    name="pi-invoice"
                    value={inv.invoice_number ?? ""}
                    checked={invoice === inv.invoice_number}
                    onChange={() => setInvoice(inv.invoice_number ?? "")}
                    aria-label={`Invoice ${inv.invoice_number}`}
                  />
                  <span className="font-medium">{inv.invoice_number}</span>
                  <span className="text-xs text-muted-foreground">{plural(inv.units, "unit")} · {piText(inv)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField htmlFor="record-pi-number" label="PI Number" required>
              <Input id="record-pi-number" aria-label="PI Number" value={form.piNumber} onChange={(e) => setForm((f) => ({ ...f, piNumber: e.target.value }))} />
            </FormField>
            <FormField htmlFor="record-pi-date" label="PI Date" required>
              <Input id="record-pi-date" aria-label="PI Date" type="date" value={form.piDate} onChange={(e) => setForm((f) => ({ ...f, piDate: e.target.value }))} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label="Overwrite existing values"
              checked={form.overwrite}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, overwrite: checked === true }))}
            />
            Overwrite existing values
          </label>
          <p className="text-xs text-muted-foreground">
            Off (default): only fills in the assets of this invoice that have no PI yet. On: replaces the PI on every asset of this invoice, even ones already set (to fix a typo).
          </p>
          {recordMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {recordMutation.error instanceof Error ? recordMutation.error.message : "Failed to record the PI."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <AsyncButton onClick={() => recordMutation.mutate()} disabled={!canSave} pending={recordMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </>
      )}
    </div>
  );
}
