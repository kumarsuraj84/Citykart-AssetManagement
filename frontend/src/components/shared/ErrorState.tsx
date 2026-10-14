import { Button } from "@/components/ui/button";
import { ReferenceLine, errorInfo } from "./ErrorMessage";

interface ErrorStateProps {
  message?: string;
  /** S8: the error behind it -- its reference (request id) is shown under the message. */
  error?: unknown;
  onRetry?: () => void;
}

/** Reusable inline error pattern (REVIEW_FINDINGS.md #3 -- AM-00/AM-02 both
 * identified missing error states, e.g. Dashboard could get stuck on
 * "Loading…" forever on a fetch failure since isLoading/!data never
 * distinguished "still loading" from "failed"). `role="alert"` so assistive
 * tech announces it without the page needing focus management.
 * S8: the message is followed by the quiet "Reference: … [Copy]" line (lib: ErrorMessage). */
export function ErrorState({ message, error, onRetry }: ErrorStateProps) {
  const info = errorInfo(error, message, "Something went wrong.");
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-md border border-destructive/30 bg-destructive-soft/50 px-4 py-8 text-center"
    >
      <p className="text-sm font-medium text-destructive">
        {info.text}
        <ReferenceLine requestId={info.requestId} serious={info.serious} />
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
