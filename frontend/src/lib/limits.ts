/**
 * Input limits shared with the server (S0.2): wherever a person types "how many",
 * the number must be a whole number from 1 to 1,000. The server refuses anything
 * else; checking here just tells the person before they press Save.
 */
export const MAX_QUANTITY = 1000;

/** A set (bundle) can have at most this many parts. */
export const MAX_BUNDLE_PARTS = 50;

/** The hint printed under a quantity box. */
export function quantityHint(max: number = MAX_QUANTITY): string {
  return `Whole number, 1 to ${max.toLocaleString("en-IN")}.`;
}

/**
 * Null when `value` is a whole number from 1 to `max`; otherwise a short sentence
 * saying what is wrong (never an empty string).
 */
export function quantityProblem(value: string | number, max: number = MAX_QUANTITY): string | null {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (raw === "") return `Enter how many (1 to ${max.toLocaleString("en-IN")}).`;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "Enter a whole number.";
  if (n < 1) return "Enter at least 1.";
  if (n > max) return `At most ${max.toLocaleString("en-IN")} at a time.`;
  return null;
}
