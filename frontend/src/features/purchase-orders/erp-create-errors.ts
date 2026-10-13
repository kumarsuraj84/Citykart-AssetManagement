/**
 * "Create from the ERP" is checked again on the server against the ERP's own
 * figures. Its refusals name the offending line in one of two ways:
 *
 *   "Line 2 (CT324973): the cost 1 is too far from the ERP rate 20000 (...)"
 *   "CT324973: 9 units asked, but the ERP purchase order has only 7 open."
 *
 * This finds which draft lines such a sentence is about, so it can be shown
 * right under them. Returns [] when the sentence is about the order as a whole.
 */
export function lineIndexesForServerMessage(message: string, itemCodes: (string | null | undefined)[]): number[] {
  const text = message.trim();
  const byNumber = /^Line (\d+)\b/i.exec(text);
  if (byNumber) {
    const index = Number(byNumber[1]) - 1;
    return index >= 0 && index < itemCodes.length ? [index] : [];
  }
  const byCode = /^([^\s:]+):\s/.exec(text);
  if (byCode) {
    const code = byCode[1].toUpperCase();
    return itemCodes.flatMap((c, i) => ((c ?? "").trim().toUpperCase() === code ? [i] : []));
  }
  return [];
}

/** The ERP's tolerance on a line's cost (kept in step with the server: half to double). */
export const RATE_LOW_FACTOR = 0.5;
export const RATE_HIGH_FACTOR = 2;
