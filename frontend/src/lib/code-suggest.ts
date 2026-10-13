/**
 * A short code suggested from a name, so nobody has to invent one ("IT Fixed
 * Assets" -> "ITFA", "Laptop" -> "LAPTOP", "Network Switch" -> "NS").
 *
 * Only a suggestion: the person can still change it (under "More") before
 * saving, and the server still decides whether it is valid and unique. Codes
 * of Categories and Sub-categories become part of asset codes and cannot be
 * changed later, which is why they stay visible and editable.
 *
 * Rule: upper-case letters and digits only. One word -> its first `max`
 * characters. Several words -> one letter per word, except a word that is
 * already an abbreviation (all capitals or digits, e.g. "IT", "CCTV", "4K"),
 * which is kept whole. When the result is already taken, a number is added
 * (ITFA2, ITFA3, ...).
 */
export function suggestCode(name: string, taken: Iterable<string> = [], max = 6): string {
  const words = name
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return "";
  let base: string;
  if (words.length === 1) {
    base = words[0].toUpperCase().slice(0, max);
  } else {
    base = words
      .map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w.charAt(0)))
      .join("")
      .toUpperCase()
      .slice(0, max + 2);
  }
  const used = new Set([...taken].map((c) => c.trim().toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}
