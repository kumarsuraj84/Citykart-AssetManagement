/**
 * S8: what the browser remembers about its own calls to the server, in memory only (never stored,
 * never sent anywhere except inside a problem report the person or the app sends).
 *
 * - a ring buffer of the last 50 calls: {at, method, path (template: ids and query values removed),
 *   status, ms, requestId} -- the "last requests" of a problem report;
 * - the reference (request id) of the last failures by their message, so an error sentence shown on
 *   any screen can show its reference even where the screen only kept the text;
 * - a tiny listener list for failed calls (5xx / no answer), used by the automatic problem reports
 *   (lib/client-reports.ts) once they are switched on in main.tsx -- nothing listens in unit tests.
 */

export interface RequestRecord {
  /** ISO time the call started. */
  at: string;
  method: string;
  /** The path with ids and query values taken out ("/assets/{id}?status="). */
  path: string;
  /** HTTP status; 0 = no answer (network failure). */
  status: number;
  ms: number;
  requestId: string | null;
}

export interface ApiFailure extends RequestRecord {
  /** The sentence shown to the person. */
  message: string;
}

const MAX_REQUESTS = 50;
const requests: RequestRecord[] = [];

/** One id segment: a number, a uuid / long hex, or a code with digits that is clearly an id. */
const ID_SEGMENT = /^(\d+|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * "/assets/12/events?status=LOST&q=abc" -> "/assets/{id}/events?q=&status=".
 * Query values can hold what a person typed (a search) -- only the keys are kept.
 */
export function pathTemplate(path: string): string {
  const [rawPath, rawQuery] = path.split("?", 2);
  const template = rawPath
    .split("/")
    .map((seg) => (seg && ID_SEGMENT.test(seg) ? "{id}" : seg))
    .join("/");
  if (!rawQuery) return template;
  const keys = Array.from(new Set(rawQuery.split("&").map((p) => p.split("=")[0]).filter(Boolean))).sort();
  return keys.length ? `${template}?${keys.map((k) => `${k}=`).join("&")}` : template;
}

export function recordRequest(entry: RequestRecord): void {
  requests.push(entry);
  if (requests.length > MAX_REQUESTS) requests.splice(0, requests.length - MAX_REQUESTS);
}

/** The last `n` calls, oldest first. */
export function recentRequests(n = MAX_REQUESTS): RequestRecord[] {
  return requests.slice(-n).map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// The reference of a failure, by the sentence shown for it
// ---------------------------------------------------------------------------

interface RememberedFailure {
  message: string;
  requestId: string;
  status: number;
  at: number;
}

const MAX_FAILURES = 50;
/** A sentence older than this is not matched to a new display of the same words. */
const FAILURE_MATCH_MS = 10 * 60 * 1000;
const failures: RememberedFailure[] = [];

export function rememberFailure(message: string, requestId: string | null | undefined, status: number): void {
  if (!message || !requestId) return;
  failures.push({ message: message.trim(), requestId, status, at: Date.now() });
  if (failures.length > MAX_FAILURES) failures.splice(0, failures.length - MAX_FAILURES);
}

/** The most recent failure shown with exactly these words (within ten minutes), or null. */
export function failureForMessage(message: string | null | undefined): { requestId: string; status: number } | null {
  if (!message) return null;
  const wanted = message.trim();
  const now = Date.now();
  for (let i = failures.length - 1; i >= 0; i--) {
    const f = failures[i];
    if (now - f.at > FAILURE_MATCH_MS) break;
    if (f.message === wanted) return { requestId: f.requestId, status: f.status };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Failed calls (5xx / no answer) -> listeners (the automatic problem reports)
// ---------------------------------------------------------------------------

type FailureListener = (failure: ApiFailure) => void;
const listeners = new Set<FailureListener>();

export function onApiFailure(listener: FailureListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyApiFailure(failure: ApiFailure): void {
  for (const l of listeners) {
    try {
      l(failure);
    } catch {
      // a listener must never break the call that failed
    }
  }
}

/** A new request id: 32 hex characters (the server keeps a well-formed id it is sent). Works on plain http too. */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The `X-Request-ID` of an answer, tolerant of test doubles without headers. */
export function responseRequestId(res: { headers?: { get?: (name: string) => string | null } } | null | undefined): string | null {
  try {
    const v = res?.headers?.get?.("X-Request-ID");
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Tests only. */
export function resetRequestLog(): void {
  requests.length = 0;
  failures.length = 0;
  listeners.clear();
}
