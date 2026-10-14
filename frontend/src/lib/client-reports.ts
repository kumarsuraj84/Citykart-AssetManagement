/**
 * S8: problem reports from the browser -> POST /api/client-reports.
 *
 * Automatic (once `installErrorCapture()` has run in main.tsx; never in unit tests unless a test
 * switches it on):
 *   - JS_ERROR: a screen that crashed (the ErrorBoundary), `window` "error" and "unhandledrejection";
 *   - API_ERROR: a call answered with 5xx or not answered at all (lib/request-log.ts announces it).
 * By a person: USER_REPORT from "Report a problem" (always available while signed in).
 *
 * Every report carries the route, the app version, the last 30 breadcrumbs, the last 10 requests (with
 * their request ids) and a cut stack. Rules: nothing is sent when not signed in; the same error (same
 * message + top stack line) is sent once a minute; at most 10 automatic reports per session; a 429 stops
 * automatic reports for 5 minutes; any failure while reporting is swallowed (never a loop); everything is
 * redacted first (lib/redact.ts). The user agent is taken by the server from the request itself.
 */
import { useAuthStore } from "./auth-store";
import { API_BASE, authFetch } from "./auth-fetch";
import { addBreadcrumb, getBreadcrumbs, installBreadcrumbListeners } from "./breadcrumbs";
import { newRequestId, onApiFailure, recentRequests, type ApiFailure } from "./request-log";
import { redactDeep } from "./redact";
import { APP_VERSION } from "./app-version";

export type ReportKind = "JS_ERROR" | "API_ERROR" | "USER_REPORT";

export interface ReportPayload {
  kind: ReportKind;
  message: string;
  stack?: string | null;
  route: string;
  app_version: string;
  breadcrumbs: unknown[];
  recent_requests: unknown[];
  note?: string | null;
  request_id?: string | null;
}

export interface ReportAnswer {
  id: number;
  reference: string;
  duplicate: boolean;
}

export const MAX_AUTO_REPORTS = 10;
export const DEDUPE_MS = 60 * 1000;
export const BACKOFF_MS = 5 * 60 * 1000;
export const MAX_REPORT_BYTES = 60 * 1024;
const MAX_STACK = 8000;
export const NOTE_MAX = 1000;

const state = {
  installed: false,
  autoSent: 0,
  backoffUntil: 0,
  /** fingerprint -> {at, reference promise} */
  recent: new Map<string, { at: number; reference: Promise<string | null> }>(),
  uninstall: [] as (() => void)[],
};

function signedIn(): boolean {
  const s = useAuthStore.getState();
  return !!s.accessToken && !s.mustChangePassword;
}

function currentRoute(): string {
  try {
    return window.location.pathname;
  } catch {
    return "";
  }
}

/** The first line of a stack that names a place in the code (the "top frame"). */
export function topFrame(stack: string | null | undefined): string {
  if (!stack) return "";
  const lines = stack.split("\n").map((l) => l.trim());
  return lines.find((l) => l.startsWith("at ") || l.includes("@")) ?? "";
}

export function fingerprintOf(kind: ReportKind, message: string, stack?: string | null): string {
  return `${kind}|${message.slice(0, 300)}|${topFrame(stack)}`;
}

function cut(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters cut)` : text;
}

/** The report as it is sent: redacted, and cut to fit the server's size limit. */
export function buildPayload(input: {
  kind: ReportKind;
  message: string;
  stack?: string | null;
  note?: string | null;
  requestId?: string | null;
}): ReportPayload {
  const payload: ReportPayload = redactDeep({
    kind: input.kind,
    message: (input.message || "").slice(0, 2000),
    stack: cut(input.stack, MAX_STACK),
    route: currentRoute(),
    app_version: APP_VERSION,
    breadcrumbs: getBreadcrumbs(30),
    recent_requests: recentRequests(10),
    note: input.note ? input.note.slice(0, NOTE_MAX) : null,
    request_id: input.requestId ?? null,
  });
  // Oldest breadcrumbs / requests go first, then the stack, until it fits.
  const size = () => new Blob([JSON.stringify(payload)]).size;
  while (size() > MAX_REPORT_BYTES && payload.breadcrumbs.length > 0) payload.breadcrumbs.shift();
  while (size() > MAX_REPORT_BYTES && payload.recent_requests.length > 0) payload.recent_requests.shift();
  if (size() > MAX_REPORT_BYTES && payload.stack) payload.stack = cut(payload.stack, 2000);
  return payload;
}

async function post(payload: ReportPayload, viaAuthFetch: boolean): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": newRequestId() },
    body: JSON.stringify(payload),
  };
  if (viaAuthFetch) return authFetch("/client-reports", init);
  // Automatic reports: no refresh, no redirect to sign-in -- a report must never move the person.
  const token = useAuthStore.getState().accessToken;
  return fetch(`${API_BASE}/client-reports`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: "include",
  });
}

/** Sends an automatic report (JS_ERROR / API_ERROR). Resolves to its reference, or null when not sent. */
export function sendAutomaticReport(input: {
  kind: "JS_ERROR" | "API_ERROR";
  message: string;
  stack?: string | null;
  requestId?: string | null;
}): Promise<string | null> {
  try {
    if (!state.installed || !signedIn()) return Promise.resolve(null);
    const now = Date.now();
    if (now < state.backoffUntil) return Promise.resolve(null);
    const fp = fingerprintOf(input.kind, input.message, input.stack);
    for (const [key, v] of state.recent) if (now - v.at > DEDUPE_MS) state.recent.delete(key);
    const seen = state.recent.get(fp);
    if (seen) return seen.reference;
    if (state.autoSent >= MAX_AUTO_REPORTS) return Promise.resolve(null);
    state.autoSent += 1;
    const reference = (async () => {
      try {
        const res = await post(buildPayload(input), false);
        if (res.status === 429) {
          state.backoffUntil = Date.now() + BACKOFF_MS;
          return null;
        }
        if (!res.ok) return null;
        const body = (await res.json()) as Partial<ReportAnswer>;
        return typeof body?.reference === "string" ? body.reference : null;
      } catch {
        return null; // never a loop, never a second error
      }
    })();
    state.recent.set(fp, { at: now, reference });
    return reference;
  } catch {
    return Promise.resolve(null);
  }
}

/** A crash or an unhandled error, from anywhere. Ordinary refusals (4xx answers) are not reported. */
export function reportJsError(error: unknown, where = "window"): Promise<string | null> {
  try {
    if (error && typeof error === "object") {
      const status = (error as { status?: unknown }).status;
      if (typeof status === "number" && status > 0 && status < 500) return Promise.resolve(null);
      // A call that got no answer is already an API_ERROR report.
      if ((error as { isNetworkError?: unknown }).isNetworkError) return Promise.resolve(null);
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "Unknown error");
    const stack = error instanceof Error ? error.stack ?? null : null;
    addBreadcrumb("error", `${where}: ${message}`.slice(0, 160));
    return sendAutomaticReport({ kind: "JS_ERROR", message, stack });
  } catch {
    return Promise.resolve(null);
  }
}

function onFailure(f: ApiFailure): void {
  void sendAutomaticReport({ kind: "API_ERROR", message: f.message, requestId: f.requestId });
}

/** "Report a problem": always sent while signed in (the server rate-limits); throws a readable Error on failure. */
export async function sendUserReport(input: {
  note: string;
  message?: string;
  stack?: string | null;
  requestId?: string | null;
}): Promise<ReportAnswer> {
  if (!signedIn()) throw new Error("Sign in first, then report the problem.");
  const payload = buildPayload({
    kind: "USER_REPORT",
    message: input.message || "Reported by the person using the app",
    stack: input.stack,
    note: input.note.trim(),
    requestId: input.requestId,
  });
  let res: Response;
  try {
    res = await post(payload, true);
  } catch {
    throw new Error("The report could not be sent: the server did not answer. Try again in a moment.");
  }
  if (res.status === 429) throw new Error("You have sent many problem reports in the last minute. Wait a minute and try again.");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body && typeof body.detail === "string" ? body.detail : `The report could not be sent (${res.status}).`;
    throw new Error(detail);
  }
  return (await res.json()) as ReportAnswer;
}

/**
 * Browser notices that are not errors in CKAM: Chrome / Edge fire "ResizeObserver loop completed with undelivered
 * notifications" whenever a panel resizes while the page is drawing (harmless, nothing is broken). Reporting them
 * made Home say "3 user reports need a look" for nothing.
 */
export function isBenignBrowserNotice(message: string | null | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return text.includes("resizeobserver loop") || text.includes("resizeobserver loop limit exceeded");
}

/** main.tsx: switch on the automatic reports and breadcrumbs. Returns the stop function. */
export function installErrorCapture(): () => void {
  if (state.installed) return uninstallErrorCapture;
  state.installed = true;
  const onError = (e: ErrorEvent) => {
    if (isBenignBrowserNotice(e.message)) return;
    void reportJsError(e.error ?? e.message, "window");
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    if (isBenignBrowserNotice(e.reason instanceof Error ? e.reason.message : String(e.reason ?? ""))) return;
    void reportJsError(e.reason, "unhandled promise");
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  state.uninstall.push(
    () => window.removeEventListener("error", onError),
    () => window.removeEventListener("unhandledrejection", onRejection),
    onApiFailure(onFailure),
    installBreadcrumbListeners(),
  );
  return uninstallErrorCapture;
}

export function uninstallErrorCapture(): void {
  for (const fn of state.uninstall.splice(0)) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
  state.installed = false;
}

/** Tests only: a fresh session. */
export function resetClientReports(): void {
  uninstallErrorCapture();
  state.autoSent = 0;
  state.backoffUntil = 0;
  state.recent.clear();
}
