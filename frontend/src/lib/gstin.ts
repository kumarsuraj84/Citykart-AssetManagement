/** Same rule as the server (backend app/core/validation.py check_gstin): 15 characters, e.g. 07AAAAA0000A1Z5. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** null when blank (GSTIN is optional) or valid; otherwise the server's own sentence. */
export function gstinProblem(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (v === "") return null;
  return GSTIN_RE.test(v) ? null : "GSTIN is not valid. It has 15 characters, for example 07AAAAA0000A1Z5.";
}
