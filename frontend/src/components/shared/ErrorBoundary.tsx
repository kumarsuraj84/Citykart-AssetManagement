import { Component, useEffect, useState, type ErrorInfo as ReactErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportJsError } from "@/lib/client-reports";
import { useAuthStore } from "@/lib/auth-store";
import { useReportProblem } from "@/features/support/report-problem-store";
import { ReferenceLine } from "./ErrorMessage";

/** Each crashed error is reported once, however often its fallback renders. */
const reported = new WeakMap<object, Promise<string | null>>();

function reportOnce(error: unknown): Promise<string | null> {
  if (error && typeof error === "object") {
    const known = reported.get(error);
    if (known) return known;
    const p = reportJsError(error, "screen");
    reported.set(error, p);
    return p;
  }
  return reportJsError(error, "screen");
}

/**
 * S8: what a person sees instead of a screen that crashed: plain words, the reference of the automatic
 * report (or of the failed request), [Try again] and [Report this problem]. Used by the router for every
 * route (`defaultErrorComponent`) and by the app-wide ErrorBoundary.
 */
export function ErrorFallback({
  error, onRetry, fullPage = false,
}: { error: unknown; onRetry?: () => void; fullPage?: boolean }) {
  const signedIn = useAuthStore((s) => !!s.accessToken);
  const openReport = useReportProblem((s) => s.openReport);
  const ownId = error && typeof error === "object" && typeof (error as { requestId?: unknown }).requestId === "string"
    ? (error as { requestId: string }).requestId
    : null;
  const [reference, setReference] = useState<string | null>(ownId);

  useEffect(() => {
    let alive = true;
    void reportOnce(error).then((ref) => {
      if (alive && ref && !ownId) setReference(ref);
    });
    return () => {
      alive = false;
    };
  }, [error, ownId]);

  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return (
    <section
      role="alert"
      aria-labelledby="screen-problem-title"
      className={`mx-auto flex max-w-md flex-col items-center gap-3 rounded-md border bg-card p-6 text-center ${fullPage ? "mt-16" : "mt-6"}`}
    >
      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      <h1 id="screen-problem-title" className="text-lg font-semibold">This screen had a problem.</h1>
      <p className="text-sm text-muted-foreground">
        Try again. If it happens again, report it: the head-office admin gets what is needed to find it.
      </p>
      {reference && <ReferenceLine requestId={reference} className="text-sm" />}
      <div className="flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button size="sm" onClick={onRetry}>Try again</Button>
        )}
        {signedIn && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openReport({ requestId: reference, message, stack: error instanceof Error ? error.stack ?? null : null })}
          >
            Report this problem
          </Button>
        )}
      </div>
    </section>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Rendered instead of the default fallback (tests, special places). */
  fallback?: (error: unknown, reset: () => void) => ReactNode;
  fullPage?: boolean;
  /** Changing this value clears a caught error (e.g. the current path). */
  resetKey?: unknown;
}

interface BoundaryState {
  error: unknown;
  hasError: boolean;
  resetKey: unknown;
}

/** S8: catches a crash anywhere below it and shows <ErrorFallback /> (which reports it). */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, hasError: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error, hasError: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, hasError: false, error: null };
    return null;
  }

  componentDidCatch(error: unknown, _info: ReactErrorInfo): void {
    void reportOnce(error);
  }

  reset = () => this.setState({ error: null, hasError: false });

  render() {
    if (this.state.hasError) {
      return this.props.fallback
        ? this.props.fallback(this.state.error, this.reset)
        : <ErrorFallback error={this.state.error} onRetry={this.reset} fullPage={this.props.fullPage} />;
    }
    return this.props.children;
  }
}
