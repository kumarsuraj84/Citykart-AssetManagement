/**
 * One line for "this serial number is already on another asset", from the
 * advisory POST /purchase-orders/check-serials answer.
 *
 * The server names the asset by its code. When that asset is outside the
 * caller's companies or work area it says so with `masked: true` (S6); the
 * screen then says "an asset you cannot see" instead of a code. A noun phrase
 * ("an asset …") is shown as it is (no "asset" put in front of it).
 */
export const MASKED_ASSET = "an asset you cannot see";

export function serialConflictSentence(serial: string, assetCode: string): string {
  const who = assetCode.trim();
  const isSentence = /^an?\s/i.test(who);
  return `Serial "${serial}" is already used by ${isSentence ? who : `asset ${who}`}.`;
}
