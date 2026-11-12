import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

export interface PiCandidate {
  pi_code: number;
  pi_number: string;
  pi_date: string | null;
  pi_amount: number | null;
  vendor_invoice_no: string | null;
  erp_vendor_name: string | null;
  posted: boolean;
  amount_check: "matches" | "differs" | "unknown";
  vendor_note: string | null;
  status: "ready" | "done" | "different" | "not_posted" | "no_match";
}

export interface PiWorkRow {
  po_id: number;
  po_number: string;
  company_code: string;
  vendor_name: string | null;
  invoice_number: string;
  invoice_date: string | null;
  invoice_amount: number | null;
  assets: number;
  recorded: number;
  candidates: PiCandidate[];
  /** ready: the ERP has a posted PI; not_posted: started in the ERP, not posted yet. */
  state: "ready" | "not_posted";
}

export interface PiWorklist {
  copied: boolean;
  counts: { ready: number; not_posted: number; waiting: number; ready_pos: number };
  rows: PiWorkRow[];
}

interface ApplyEntry {
  po_id: number;
  invoice_number: string;
  pi_number: string;
  ok: boolean;
  updated: number;
  message: string | null;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;
const money = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-IN") : "—");
const rowKey = (r: PiWorkRow) => `${r.po_id}|${r.invoice_number}`;

/** The invoices received here and what the ERP says about their PI: one small read of CKAM's own copy. */
export function usePiReady() {
  return useQuery({
    queryKey: ["erp", "pi-ready"],
    queryFn: async (): Promise<PiWorklist | null> => {
      try {
        const data = await apiClient.get<PiWorklist>("/erp/pi/ready");
        return data && typeof data === "object" && data.counts ? data : null;
      } catch {
        return null;           // an extra: never in the way
      }
    },
    retry: false,
  });
}

/** Top of the Purchase Orders list: received invoices whose PI is now done in the ERP. */
export function PiReadyCard() {
  const q = usePiReady();
  const [open, setOpen] = useState(false);
  const data = q.data;
  if (!data || data.counts.ready === 0) return null;
  const { ready, ready_pos, waiting, not_posted } = data.counts;
  return (
    <section className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/50 bg-success/10 px-3 py-2" aria-label="PI ready in the ERP">
      <div className="text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <ReceiptText className="h-4 w-4" aria-hidden="true" />
          The ERP has the PI for {plural(ready, "received invoice")} on {plural(ready_pos, "purchase order")}
        </p>
        <p className="text-xs text-muted-foreground">
          Review them and add the PI numbers here.
          {waiting > 0 ? ` ${plural(waiting, "invoice")} still waiting for the ERP.` : ""}
          {not_posted > 0 ? ` ${plural(not_posted, "PI")} started in the ERP but not posted yet.` : ""}
        </p>
      </div>
      <Button size="sm" onClick={() => setOpen(true)}>Review and add</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>PI ready in the ERP</DialogTitle>
            <DialogDescription>
              Found by the vendor's bill number in CKAM's copy of the ERP data. Nothing is added until you tick it and confirm.
            </DialogDescription>
          </DialogHeader>
          {open && <PiReadyPanel data={data} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** A row can be added without a second look when exactly one PI matches and nothing about it needs checking. */
function isClean(r: PiWorkRow): boolean {
  const ready = r.candidates.filter((c) => c.status === "ready");
  return r.state === "ready" && ready.length === 1 && ready[0].amount_check !== "differs" && !ready[0].vendor_note;
}

export function PiReadyPanel({ data, onClose }: { data: PiWorklist; onClose: () => void }) {
  const qc = useQueryClient();
  const ready = data.rows.filter((r) => r.state === "ready");
  const notPosted = data.rows.filter((r) => r.state === "not_posted");
  // The PI chosen for each invoice (its pi_number); clean rows start chosen, the rest wait for a person.
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(ready.filter(isClean).map((r) => [rowKey(r), r.candidates.find((c) => c.status === "ready")!.pi_number])),
  );
  const [results, setResults] = useState<ApplyEntry[] | null>(null);
  const chosen = ready.filter((r) => picked[rowKey(r)]);

  const apply = useMutation({
    mutationFn: () =>
      apiClient.post<ApplyEntry[]>("/erp/pi/apply", {
        items: chosen.map((r) => ({ po_id: r.po_id, pi_number: picked[rowKey(r)], ckam_invoice_number: r.invoice_number })),
      }),
    onSuccess: (res) => {
      setResults(res);
      qc.invalidateQueries({ queryKey: ["erp", "pi-ready"] });
      qc.invalidateQueries({ queryKey: ["erp", "pi"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-order"] });
    },
  });

  const done = results?.filter((r) => r.ok).length ?? 0;
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto" aria-label="Invoices with a PI in the ERP">
        {ready.map((r) => {
          const k = rowKey(r);
          const options = r.candidates.filter((c) => c.status === "ready");
          return (
            <li key={k} className="rounded-md border p-2 text-sm">
              <div className="flex items-start gap-2">
                <Checkbox
                  aria-label={`Add the PI for invoice ${r.invoice_number} of ${r.po_number}`}
                  checked={!!picked[k]} disabled={results !== null}
                  onCheckedChange={(c) => setPicked((p) => {
                    const next = { ...p };
                    if (c === true) next[k] = (picked[k] ?? options[0]?.pi_number) as string;
                    else delete next[k];
                    return next;
                  })}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <Link to="/purchase-orders/$id" params={{ id: String(r.po_id) }} className="underline">{r.po_number}</Link>
                    {r.vendor_name ? <span className="font-normal text-muted-foreground"> · {r.vendor_name}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Invoice {r.invoice_number}{r.invoice_date ? ` · ${r.invoice_date}` : ""}{r.invoice_amount != null ? ` · ${money(r.invoice_amount)}` : ""}
                    {` · ${plural(r.assets, "asset")}`}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {options.map((c) => (
                      <li key={c.pi_code} className="flex items-start gap-2 text-xs">
                        {options.length > 1 ? (
                          <input
                            type="radio" name={`pi-${k}`} aria-label={`PI ${c.pi_number} for invoice ${r.invoice_number}`}
                            checked={picked[k] === c.pi_number} disabled={results !== null}
                            onChange={() => setPicked((p) => ({ ...p, [k]: c.pi_number }))}
                          />
                        ) : null}
                        <span>
                          <span className="font-medium text-foreground">PI {c.pi_number}</span>
                          {c.pi_date ? ` · ${c.pi_date}` : ""}{c.pi_amount != null ? ` · ${money(c.pi_amount)}` : ""}
                          {c.amount_check === "matches" ? <span className="text-muted-foreground"> · amount matches</span> : null}
                          {c.amount_check === "differs" ? <span className="text-warning-foreground"> · amount differs from the invoice: check it</span> : null}
                          {c.vendor_note ? <span className="block text-warning-foreground">{c.vendor_note}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          );
        })}
        {notPosted.length > 0 && (
          <li className="rounded-md border border-dashed p-2 text-xs text-muted-foreground" aria-label="Not posted yet">
            <p className="font-medium text-foreground">Started in the ERP, not posted yet (cannot be added until it is)</p>
            <ul className="mt-1 list-disc pl-4">
              {notPosted.map((r) => (
                <li key={rowKey(r)}>{r.po_number} · invoice {r.invoice_number} · PI {r.candidates[0]?.pi_number}</li>
              ))}
            </ul>
          </li>
        )}
      </ul>

      {apply.isError && (
        <ErrorMessage className="text-sm text-destructive" error={apply.error} message={apply.error instanceof Error ? apply.error.message : "Could not add the PI."} />
      )}
      {results && (
        <div className="text-sm" role="status">
          <p className="text-success">{plural(done, "PI")} added{done > 0 ? ` (${plural(results.filter((r) => r.ok).reduce((n, r) => n + r.updated, 0), "asset")} updated)` : ""}.</p>
          {failed.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-destructive">
              {failed.map((f) => <li key={`${f.po_id}|${f.invoice_number}`}>Invoice {f.invoice_number}: {f.message}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{results ? "Close" : "Cancel"}</Button>
        {!results && (
          <AsyncButton onClick={() => apply.mutate()} disabled={chosen.length === 0} pending={apply.isPending} pendingLabel="Adding…">
            Add {chosen.length > 0 ? plural(chosen.length, "PI") : "PI"}
          </AsyncButton>
        )}
      </div>
    </div>
  );
}
