import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { ErrorMessage, ReferenceLine } from "@/components/shared/ErrorMessage";
import { NOTE_MAX, sendUserReport, type ReportAnswer } from "@/lib/client-reports";
import { useAuthStore } from "@/lib/auth-store";
import { useReportProblem } from "./report-problem-store";

/** What is attached to every report, in the words shown to the person. */
export const ATTACHED_LINE = "This screen, the last few actions and the last requests — no passwords or typed values.";

/**
 * S8: "Report a problem" (any signed-in person): one note, sent with the screen, the last actions and the
 * last requests (lib/client-reports.ts) as a USER_REPORT. The answer's reference is shown to quote.
 */
export function ReportProblemDialog() {
  const { open, context, close } = useReportProblem();
  const signedIn = useAuthStore((s) => !!s.accessToken);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [answer, setAnswer] = useState<ReportAnswer | null>(null);

  // Signed out while open: forget it (it must not pop up after the next sign-in).
  useEffect(() => {
    if (open && !signedIn) close();
  }, [open, signedIn, close]);

  // A fresh form every time it opens.
  useEffect(() => {
    if (open) {
      setNote("");
      setFailure(null);
      setAnswer(null);
      setPending(false);
    }
  }, [open]);

  const trimmed = note.trim();
  const tooLong = note.length > NOTE_MAX;

  async function send() {
    if (!trimmed || tooLong || pending) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await sendUserReport({
        note: trimmed,
        message: context?.message ?? undefined,
        stack: context?.stack ?? null,
        requestId: context?.requestId ?? null,
      });
      setAnswer(result);
    } catch (e) {
      setFailure(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open && signedIn} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Report a problem</DialogTitle>
          {!answer && (
            <DialogDescription>The head-office admin sees your note with what the app knows about this screen.</DialogDescription>
          )}
        </DialogHeader>
        {answer ? (
          <div className="flex flex-col gap-2 text-sm" role="status">
            <p className="font-medium">
              Thank you.{answer.duplicate ? " This problem was already reported a moment ago." : ""}
            </p>
            <p>
              <ReferenceLine requestId={answer.reference} className="text-sm text-foreground" />
            </p>
            <p className="text-muted-foreground">Quote this reference when you talk to the head-office admin.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-note">
                What were you doing and what went wrong?
                <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              </Label>
              <Textarea
                id="report-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={NOTE_MAX + 200}
                aria-invalid={tooLong || undefined}
                placeholder="For example: I pressed Save on the purchase order and nothing happened."
              />
              <span className={`text-xs tabular-nums ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
                {note.length} / {NOTE_MAX}{tooLong ? " — please shorten it" : ""}
              </span>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="report-attached">
              <span className="font-medium text-foreground">Attached:</span> {ATTACHED_LINE}
              {context?.requestId && <> About reference <code className="font-mono">{context.requestId}</code>.</>}
            </p>
            {failure !== null && <ErrorMessage error={failure} />}
          </div>
        )}
        <DialogFooter>
          {answer ? (
            <Button onClick={close}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <AsyncButton onClick={() => void send()} pending={pending} pendingLabel="Sending…" disabled={!trimmed || tooLong}>
                Send
              </AsyncButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
