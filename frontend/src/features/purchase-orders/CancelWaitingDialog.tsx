import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { type LineGroup, lineTitle } from "./po-detail-types";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

const units = (n: number) => `${n.toLocaleString("en-IN")} waiting unit${n === 1 ? "" : "s"}`;

/** Null when `value` is a whole number from 1 to `waiting`. */
export function cancelCountProblem(value: string, waiting: number): string | null {
  const raw = value.trim();
  if (raw === "") return `Enter how many to cancel (1 to ${waiting}).`;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "Enter a whole number.";
  if (n < 1) return "Enter at least 1.";
  if (n > waiting) return `Only ${waiting} ${waiting === 1 ? "is" : "are"} waiting.`;
  return null;
}

/**
 * Cancel waiting items: of one line (how many, default all of them) or of the
 * whole purchase order. Received items are never touched and the PO stays.
 * Mount with a fresh `key` each time it opens.
 */
export type CancelTarget = { kind: "line"; line: LineGroup } | { kind: "po"; waiting: number };

interface Props {
  poId: number;
  target: CancelTarget | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function CancelWaitingDialog({ poId, target, onClose, onDone }: Props) {
  const qc = useQueryClient();
  const line = target?.kind === "line" ? target.line : null;
  const waiting = target ? (target.kind === "line" ? target.line.waiting : target.waiting) : 0;
  const [count, setCount] = useState(String(waiting));
  const problem = line ? cancelCountProblem(count, waiting) : null;

  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (line) {
        const n = Number(count);
        await apiClient.post<LineGroup>(`/purchase-orders/${poId}/line-groups/${line.line_no}/cancel-waiting`, { quantity: n });
        return `${units(n)} of line ${line.line_no} cancelled.`;
      }
      const out = await apiClient.post<{ cancelled_units: number; status: string }>(`/purchase-orders/${poId}/cancel-waiting`);
      const n = typeof out?.cancelled_units === "number" ? out.cancelled_units : waiting;
      return `${units(n)} cancelled. Received items stay as they are.`;
    },
    onSuccess: (message) => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      onDone(message);
      onClose();
    },
  });

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">
            {line ? `Cancel waiting units of line ${line.line_no}: ${lineTitle(line)}` : "Cancel the waiting items of this purchase order?"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          {line ? (
            <>
              <p>
                {units(waiting)} on this line{line.received > 0 ? `; ${line.received} already received` : ""}.
              </p>
              <FormField
                htmlFor="cancel-quantity"
                label="How many to cancel"
                required
                helperText="The most recently added units are cancelled first."
                errorText={problem ?? undefined}
              >
                <Input id="cancel-quantity" type="number" min={1} max={waiting} step={1} value={count} onChange={(e) => setCount(e.target.value)} />
              </FormField>
            </>
          ) : (
            <p>All {units(waiting)} on this purchase order will be cancelled. The purchase order stays.</p>
          )}
          <p className="text-muted-foreground">Items already received are not affected: they stay in the register as they are.</p>
        </div>
        {mutation.isError && (
          <ErrorMessage className="text-sm text-destructive" error={mutation.error} message={mutation.error instanceof Error ? mutation.error.message : "Failed to cancel."} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep them
          </Button>
          <AsyncButton
            onClick={() => mutation.mutate()}
            disabled={waiting === 0 || problem !== null}
            pending={mutation.isPending}
            pendingLabel="Cancelling…"
          >
            {line ? "Cancel these units" : "Cancel waiting items"}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
