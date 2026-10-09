import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";

interface PiRow {
  pi_number: string;
  pi_date: string | null;
  pi_amount: number | null;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  ckam_invoice_number: string | null;
  match: "invoice" | "single" | "none";
  assets: number;
  recorded: number;
  status: "ready" | "done" | "different" | "no_match";
}

interface PiPreview {
  po_id: number;
  po_number: string;
  rows: PiRow[];
  not_booked: number;
  ckam_invoices: string[];
  delivered_assets: number;
}

interface ApplyResult {
  invoice_number: string;
  updated: string[];
  skipped: string[];
}

const STATUS_TEXT: Record<PiRow["status"], string> = {
  ready: "Ready to record",
  done: "Already recorded",
  different: "Different PI already recorded",
  no_match: "No matching invoice delivered here",
};

const keyOf = (r: PiRow) => `${r.pi_number}||${r.ckam_invoice_number}`;

/** "Fetch PI from ERP": the PIs the ERP holds for this PO, matched to the invoices
 * delivered here. A preview first; only ticked rows are recorded, through the
 * same function as Record PI (so the audit trail is the same). */
export function ErpPiDialog({ poId }: { poId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<ApplyResult[] | null>(null);

  const previewQ = useQuery({
    queryKey: ["erp", "pi", poId],
    queryFn: async () => {
      const data = await apiClient.get<PiPreview>(`/erp/purchase-orders/${poId}/pi`);
      setPicked(Object.fromEntries(data.rows.filter((r) => r.status === "ready").map((r) => [keyOf(r), true])));
      setOverwrite({});
      return data;
    },
    enabled: open,
    retry: false,
    gcTime: 0,
  });
  const rows = previewQ.data?.rows ?? [];
  const chosen = rows.filter((r) => picked[keyOf(r)] && r.ckam_invoice_number);

  const applyMutation = useMutation({
    mutationFn: () =>
      apiClient.post<ApplyResult[]>(`/erp/purchase-orders/${poId}/pi/apply`, {
        items: chosen.map((r) => ({ pi_number: r.pi_number, ckam_invoice_number: r.ckam_invoice_number, overwrite: !!overwrite[keyOf(r)] })),
      }),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["erp", "pi", poId] });
    },
  });

  function openDialog() {
    setResult(null);
    applyMutation.reset();
    setOpen(true);
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={openDialog}>Fetch PI from ERP</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>PI from the ERP</DialogTitle>
            <DialogDescription>
              The PIs the ERP holds for this purchase order, matched to the invoices delivered here by the vendor's invoice number. Nothing is recorded until you confirm.
            </DialogDescription>
          </DialogHeader>

          {previewQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP…</p>}
          {previewQ.isError && (
            <p className="text-sm text-destructive" role="alert">
              {previewQ.error instanceof Error ? previewQ.error.message : "Could not read the PIs from the ERP."}
            </p>
          )}
          {previewQ.data && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              The ERP has no PI for this purchase order yet{previewQ.data.not_booked > 0 ? ` (${previewQ.data.not_booked} invoice(s) are not booked)` : ""}.
            </p>
          )}
          {rows.length > 0 && (
            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {rows.map((r) => {
                const k = keyOf(r);
                const canPick = r.status === "ready" || r.status === "different";
                return (
                  <li key={k} className="rounded-md border p-2 text-sm">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        aria-label={`Record PI ${r.pi_number}`} checked={!!picked[k]} disabled={!canPick || result !== null}
                        onCheckedChange={(c) => setPicked((p) => ({ ...p, [k]: c === true }))}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          PI {r.pi_number}{r.pi_date ? ` · ${r.pi_date}` : ""}{r.pi_amount != null ? ` · ${r.pi_amount.toLocaleString("en-IN")}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Vendor invoice {r.vendor_invoice_no ?? "—"}
                          {r.ckam_invoice_number ? ` → delivered here as ${r.ckam_invoice_number} (${r.assets} asset${r.assets === 1 ? "" : "s"})` : ""}
                          {r.match === "single" ? " · paired because it is the only invoice and the only PI" : ""}
                        </p>
                        <p className={`text-xs ${r.status === "ready" ? "text-success" : r.status === "done" ? "text-muted-foreground" : "text-warning-foreground"}`}>
                          {STATUS_TEXT[r.status]}
                        </p>
                        {r.status === "different" && (
                          <label className="mt-1 flex items-center gap-1.5 text-xs">
                            <Checkbox
                              aria-label={`Replace the PI already recorded for ${r.ckam_invoice_number}`} checked={!!overwrite[k]}
                              disabled={result !== null} onCheckedChange={(c) => setOverwrite((o) => ({ ...o, [k]: c === true }))}
                            />
                            Replace the PI already recorded
                          </label>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {applyMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {applyMutation.error instanceof Error ? applyMutation.error.message : "Could not record the PI."}
            </p>
          )}
          {result && (
            <p className="text-sm text-success" role="status">
              Recorded. {result.reduce((n, r) => n + r.updated.length, 0)} asset(s) updated
              {result.some((r) => r.skipped.length > 0) ? `, ${result.reduce((n, r) => n + r.skipped.length, 0)} left as they were` : ""}.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{result ? "Close" : "Cancel"}</Button>
            {!result && (
              <AsyncButton onClick={() => applyMutation.mutate()} disabled={chosen.length === 0} pending={applyMutation.isPending} pendingLabel="Recording…">
                Record {chosen.length > 0 ? chosen.length : ""} PI
              </AsyncButton>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
