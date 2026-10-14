/**
 * S8: nothing secret leaves the browser in a problem report. The server redacts again; this is the
 * browser's own first pass, applied to every report before it is sent.
 *
 * - a value under a sensitive key (password, token, secret, authorization, cookie, api key, …) is dropped;
 * - a string that looks like a JWT, a "Bearer …" header or a "password=…" pair has that part replaced.
 */

export const REMOVED = "[removed]";

const SENSITIVE_KEY = /password|passwd|pwd|secret|token|authori[sz]ation|cookie|api[-_]?key|private[-_]?key|credential|^pass$|^otp$/i;

const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PASSWORD_PAIR = /\b(pass(?:word|wd)?|pwd|secret|token|api[-_]?key)\b(\s*["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi;

/** A string with every token-looking part replaced. */
export function redactText(text: string): string {
  return text
    .replace(JWT, REMOVED)
    .replace(BEARER, `Bearer ${REMOVED}`)
    .replace(PASSWORD_PAIR, (_m, key: string, sep: string) => `${key}${sep}${REMOVED}`);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** A deep copy with sensitive keys dropped and token-looking text replaced (cycles cut). */
export function redactDeep<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "string") return redactText(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return REMOVED as unknown as T;
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) continue;
    out[k] = redactDeep(v, seen);
  }
  return out as T;
}
