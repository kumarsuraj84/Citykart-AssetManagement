import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

/** Reusable inline error pattern (REVIEW_FINDINGS.md #3 -- AM-00/AM-02 both
 * identified missing error states, e.g. Dashboard could get stuck on
 * "Loading…" forever on a fetch failure since isLoading/!data never
 * distinguished "still loading" from "failed"). `role="alert"` so assistive
 * tech announces it without the page needing focus management. */
export function ErrorState({ message = "Something went wrong.", onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-md border border-destructive/30 bg-destructive-soft/50 px-4 py-8 text-center"
    >
      <p className="text-sm font-medium text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
