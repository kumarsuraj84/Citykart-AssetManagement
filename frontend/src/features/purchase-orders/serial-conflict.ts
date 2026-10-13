/**
 * One line for "this serial number is already on another asset", from the
 * advisory POST /purchase-orders/check-serials answer.
 *
 * The server names the asset by its code, or, when that asset is outside the
 * caller's companies or work area, hides the code and says "an asset outside
 * your companies or work area". That phrase is already a noun phrase, so it is
 * shown as returned (no "asset" put in front of it).
 */
export function serialConflictSentence(serial: string, assetCode: string): string {
  const who = assetCode.trim();
  const isSentence = /^an?\s/i.test(who);
  return `Serial "${serial}" is already used by ${isSentence ? who : `asset ${who}`}.`;
}
