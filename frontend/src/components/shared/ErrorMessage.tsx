import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { copyText, selectContents } from "@/lib/clipboard";
import { failureForMessage } from "@/lib/request-log";
import { useAuthStore } from "@/lib/auth-store";
import { useReportProblem } from "@/features/support/report-problem-store";

/**
 * S8: every server error on every screen is shown the same way -- the sentence, then a quiet
 * "Reference: <request id> [Copy]" line the person can quote to the head-office admin, who finds
 * everything about it in Settings › System › Logs. For a 5xx or a call that got no answer the line reads
 * "Please try again; if it keeps happening, tell the administrator this reference: …" with
 * "Report a problem" next to it.
 */

export interface ErrorInfo {
  /** The sentence to show. */
  text: string;
  requestId: string | null;
  status: number | null;
  /** A server fault (5xx) or no answer at all: not something the person can fix. */
  serious: boolean;
}

const GENERIC = [/^Request failed: 5\d\d$/, /^Something went wrong on the server/i];
const NETWORK = [/^Failed to fetch$/i, /^NetworkError/i, /^Load failed$/i, /^Network request failed$/i];

function field<T>(error: unknown, key: string, guard: (v: unknown) => v is T): T | null {
  if (!error || typeof error !== "object") return null;
  const v = (error as Record<string, unknown>)[key];
  return guard(v) ? v : null;
}
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Everything an error display needs, from an Error (ApiError, a failed download, a network failure) or a sentence. */
export function errorInfo(error: unknown, message?: string | null, fallback = "Something went wrong."): ErrorInfo {
  const ownMessage = field(error, "message", isText);
  let text = (message && message.trim()) || ownMessage || (typeof error === "string" && error.trim() ? error : null) || fallback;
  let requestId = field(error, "requestId", isText);
  let status = field(error, "status", isNumber);
  if (!requestId) {
    const remembered = failureForMessage(text) ?? (ownMessage ? failureForMessage(ownMessage) : null);
    if (remembered) {
      requestId = remembered.requestId;
      status = status ?? remembered.status;
    }
  }
  const network = field(error, "isNetworkError", (v): v is boolean => v === true) === true
    || NETWORK.some((re) => re.test(ownMessage ?? text));
  const serious = network || (status !== null && status >= 500);
  if (serious && (GENERIC.some((re) => re.test(text)) || NETWORK.some((re) => re.test(text)))) {
    text = "Something went wrong.";
  }
  return { text, requestId, status, serious };
}

/** "Reference: abc… [Copy]" (copies the full id; selects it when copying is not possible). */
export function ReferenceLine({
  requestId, serious = false, className, label = "Reference",
}: { requestId: string | null; serious?: boolean; className?: string; label?: string }) {
  const signedIn = useAuthStore((s) => !!s.accessToken);
  const openReport = useReportProblem((s) => s.openReport);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const codeRef = useRef<HTMLElement>(null);
  if (!requestId && !serious) return null;

  async function copy() {
    if (!requestId) return;
    const ok = await copyText(requestId);
    setCopied(ok ? "yes" : "no");
    if (!ok) selectContents(codeRef.current);
  }

  return (
    <span className={cn("mt-0.5 block text-xs font-normal text-muted-foreground", className)} data-reference-line="">
      {" "}
      {serious && (requestId ? "Please try again; if it keeps happening, tell the administrator this reference: " : "Please try again; if it keeps happening, tell the administrator. ")}
      {!serious && requestId && `${label}: `}
      {requestId && (
        <>
          <code ref={codeRef} className="break-all font-mono text-[11px] text-foreground/80" data-testid="error-reference">
            {requestId}
          </code>{" "}
          <button
            type="button"
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              void copy();
            }}
            aria-label={`Copy the reference ${requestId}`}
          >
            {copied === "yes" ? "Copied" : "Copy"}
          </button>
          {copied === "no" && <span> · selected, press Ctrl+C to copy</span>}
        </>
      )}
      {serious && signedIn && (
        <>
          {" · "}
          <button
            type="button"
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              openReport({ requestId });
            }}
          >
            Report a problem
          </button>
        </>
      )}
    </span>
  );
}

interface ErrorMessageProps {
  /** The error (ApiError / any Error / unknown). Its message is shown unless `message` is given. */
  error?: unknown;
  /** The sentence to show instead of the error's own message. */
  message?: string | null;
  /** Shown when the error has no message. */
  fallback?: string;
  className?: string;
  as?: "p" | "span" | "div";
  "aria-label"?: string;
  "data-testid"?: string;
  /** Extra content after the sentence (before the reference line). */
  children?: ReactNode;
  /** false: no `role="alert"` of its own (it sits inside an alert already). */
  announce?: boolean;
}

/** The one inline error display (`role="alert"`): the sentence and, when known, its reference. */
export function ErrorMessage({
  error, message, fallback, className, as = "p", children, announce = true, ...rest
}: ErrorMessageProps) {
  const info = errorInfo(error, message, fallback);
  const Tag = as;
  return (
    <Tag role={announce ? "alert" : undefined} className={cn("text-sm text-destructive", className)} {...rest}>
      {info.text}
      {children}
      <ReferenceLine requestId={info.requestId} serious={info.serious} />
    </Tag>
  );
}
