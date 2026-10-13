import { authFetch } from "./auth-fetch";

/** Same as a plain Error everywhere existing `instanceof Error` checks look
 * (message-only) -- `status` is additive, so a screen that needs to tell a
 * 404 apart from any other failure (AM-04: Asset 360's not-found treatment)
 * can, without changing anything about how every other caller already
 * handles errors. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // FormData (multipart uploads, e.g. the Excel import screen) must be sent
  // as-is: JSON.stringify-ing it would produce "[object FormData]", and
  // setting Content-Type ourselves would drop the multipart boundary the
  // browser generates. Only set the JSON header/serialize for plain bodies.
  const isFormData = body instanceof FormData;
  // authFetch attaches the bearer token and handles 401 -> refresh -> retry once
  // -> otherwise redirect to /login (see lib/auth-fetch.ts).
  const res = await authFetch(path, {
    method,
    headers: isFormData ? {} : { "Content-Type": "application/json" },
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(errorMessageFrom(body, res.status), res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
