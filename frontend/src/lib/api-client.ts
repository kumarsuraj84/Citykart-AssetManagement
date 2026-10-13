import { authFetch } from "./auth-fetch";
import { currentIdempotencyKey } from "./request-key";

/** Same as a plain Error everywhere existing `instanceof Error` checks look
 * (message-only) -- `status` is additive, so a screen that needs to tell a
 * 404 apart from any other failure (AM-04: Asset 360's not-found treatment)
 * can, without changing anything about how every other caller already
 * handles errors. */
export class ApiError extends Error {
  status: number;
  /** The parsed response body (S4: a refused receipt's structured `problems`
   * live here), or null when the body was not JSON. Additive, like `status`. */
  body: unknown;
  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Joins sentences with a single space, dropping blanks and exact repeats. */
function joinSentences(parts: string[]): string {
  const seen: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  return seen.join(" ");
}

/**
 * The one readable sentence for a failed response.
 *
 * Since S0 the server answers every failure with `detail` as one plain string
 * (validation 422s also carry `errors: string[]` with the same sentences).
 * Defensive fallbacks, in order: `detail` as a string; the joined `errors`
 * list; the old FastAPI array-of-objects `detail` (each item's `msg`);
 * `detail.message`; and only then the status code.
 */
export function errorMessageFrom(body: unknown, status: number): string {
  const fallback = `Request failed: ${status}`;
  if (!body || typeof body !== "object") return fallback;
  const b = body as { detail?: unknown; errors?: unknown };
  if (typeof b.detail === "string" && b.detail.trim()) return b.detail.trim();
  if (Array.isArray(b.errors)) {
    const joined = joinSentences(b.errors.filter((e): e is string => typeof e === "string"));
    if (joined) return joined;
  }
  if (Array.isArray(b.detail)) {
    const parts = b.detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof (item as { msg?: unknown }).msg === "string") {
        return (item as { msg: string }).msg;
      }
      return "";
    });
    const joined = joinSentences(parts);
    if (joined) return joined;
  }
  if (b.detail && typeof b.detail === "object") {
    const m = (b.detail as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  return fallback;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  // S7 (P1-2): a submit started inside runWithIdempotencyKey carries its key, so
  // the server answers a repeat of the same intent with the stored result.
  // Read before the first await -- the key is only set for that moment.
  const key = method === "GET" ? null : currentIdempotencyKey();
  // FormData (multipart uploads, e.g. the Excel import screen) must be sent
  // as-is: JSON.stringify-ing it would produce "[object FormData]", and
  // setting Content-Type ourselves would drop the multipart boundary the
  // browser generates. Only set the JSON header/serialize for plain bodies.
  const isFormData = body instanceof FormData;
  const headers: Record<string, string> = isFormData ? {} : { "Content-Type": "application/json" };
  if (key) headers["Idempotency-Key"] = key;
  // authFetch attaches the bearer token and handles 401 -> refresh -> retry once
  // -> otherwise redirect to /login (see lib/auth-fetch.ts).
  const res = await authFetch(path, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(errorMessageFrom(body, res.status), res.status, body);
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** One page of a list plus the server's total before paging (its
 * `X-Total-Count` header); `total` is null when the server did not send one. */
export interface Page<T> {
  data: T;
  total: number | null;
}

async function requestPage<T>(path: string): Promise<Page<T>> {
  const res = await send("GET", path);
  const data = (await res.json()) as T;
  const raw = res.headers.get("X-Total-Count");
  const total = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return { data, total: Number.isFinite(total) ? total : null };
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  /** A paged list: the rows and the total (S2: the purchase-order list). */
  getPage: <T>(path: string) => requestPage<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
