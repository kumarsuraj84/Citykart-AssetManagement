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
  /** S7 (P1-1): false = the ERP cannot give purchase invoices (e.g. it does not provide them yet); `message` says why. */
  available?: boolean;
  message?: string | null;
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

/** "Fetch from ERP": the PIs the ERP holds for this PO, matched to the invoices
 * received here. A preview first; only ticked rows are recorded, through the
 * same function as Record PI (so the audit trail is the same). Rendered inside
 * the PO page's one Purchase Invoice (PI) dialog, or on its own (ErpPiDialog). */
export function ErpPiPanel({ poId, onClose, onTypeItIn }: {
  poId: number;
  onClose?: () => void;
  /** S7: offered when the ERP gives no PI (switches the dialog to typing it in). */
  onTypeItIn?: () => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<ApplyResult[] | null>(null);

  const previewQ = useQuery({
    queryKey: ["erp", "pi", poId],
    queryFn: async () => {
      const data = await apiClient.get<PiPreview>(`/erp/purchase-orders/${poId}/pi`);
      const rowsRead = Array.isArray(data?.rows) ? data.rows : [];
      setPicked(Object.fromEntries(rowsRead.filter((r) => r.status === "ready").map((r) => [keyOf(r), true])));
      setOverwrite({});
      return { ...data, rows: rowsRead };
    },
    retry: false,
    gcTime: 0,
  });
  const rows = previewQ.data?.rows ?? [];
  // S7 (P1-1): the ERP gives no PIs (not provided yet, or unreadable): its plain sentence, calmly, and "Type it in".
  const unavailable = previewQ.data?.available === false;
  const calmMessage = unavailable
    ? previewQ.data?.message || "The ERP does not provide purchase invoices yet."
    : previewQ.isError
      ? previewQ.error instanceof Error ? previewQ.error.message : "The ERP could not be read just now."
      : null;
  const chosen = rows.filter((r) => picked[keyOf(r)] && r.ckam_invoice_number);

  const applyMutation = useMutation({
    mutationFn: () =>
      apiClient.post<ApplyResult[]>(`/erp/purchase-orders/${poId}/pi/apply`, {
        items: chosen.map((r) => ({ pi_number: r.pi_number, ckam_invoice_number: r.ckam_invoice_number, overwrite: !!overwrite[keyOf(r)] })),
      }),
    onSuccess: (res) => {
      setResult(res);
      // The PO page (its invoices card included) and the PO list show the PI.
      qc.invalidateQueries({ queryKey: ["purchase-order", poId] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["erp", "pi", poId] });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {previewQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP…</p>}
      {calmMessage && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2.5 text-sm" role="note" aria-label="ERP purchase invoices">
          <p>{calmMessage}</p>
          {onTypeItIn && (
            <Button size="sm" variant="outline" className="self-start" onClick={onTypeItIn}>Type it in</Button>
          )}
        </div>
      )}
      {previewQ.data && !unavailable && rows.length === 0 && (
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
        {onClose && <Button variant="outline" onClick={onClose}>{result ? "Close" : "Cancel"}</Button>}
        {!result && (
          <AsyncButton onClick={() => applyMutation.mutate()} disabled={chosen.length === 0} pending={applyMutation.isPending} pendingLabel="Recording…">
            Record {chosen.length > 0 ? chosen.length : ""} PI
          </AsyncButton>
        )}
      </div>
    </div>
  );
}

/** "Fetch PI from ERP" as its own button and dialog. */
export function ErpPiDialog({ poId }: { poId: number }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setRound((r) => r + 1); setOpen(true); }}>Fetch PI from ERP</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Purchase Invoice (PI) from the ERP</DialogTitle>
            <DialogDescription>
              The PIs the ERP holds for this purchase order, matched to the invoices delivered here by the vendor's invoice number. Nothing is recorded until you confirm.
            </DialogDescription>
          </DialogHeader>
          {open && <ErpPiPanel key={round} poId={poId} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
