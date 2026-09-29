/**
 * AM-18: client-side preview only, mirroring
 * app.assets.service.compute_warranty_upto exactly -- the backend's own
 * computed value after save always remains authoritative, same pattern
 * this app already uses for the Add Asset tax/total-cost preview.
 *
 * `years <= 0` -> Warranty Upto equals Purchase Date. A positive N ->
 * covered through the day before the Nth anniversary (10-Apr-2026 + 3
 * years -> 09-Apr-2029).
 */
export function computeWarrantyUpto(purchaseDateIso: string, years: number): string | null {
  if (!purchaseDateIso) return null;
  const [y, m, d] = purchaseDateIso.split("-").map(Number);
  if (!y || !m || !d) return null;
  if (years <= 0) return purchaseDateIso;

  const targetYear = y + years;
  const isLeap = (yr: number) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  // Feb 29 has no exact anniversary on a non-leap target year -- fall back
  // to Feb 28, matching the backend's own explicit fallback, rather than
  // letting it silently roll over to Mar 1.
  const anniversaryDay = m === 2 && d === 29 && !isLeap(targetYear) ? 28 : d;

  // UTC, not local time -- a plain "YYYY-MM-DD" business date has no
  // timezone of its own, and local-time arithmetic near a DST boundary
  // could otherwise shift the calendar date by a day.
  const anchor = new Date(Date.UTC(targetYear, m - 1, anniversaryDay));
  anchor.setUTCDate(anchor.getUTCDate() - 1);

  const yyyy = anchor.getUTCFullYear();
  const mm = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(anchor.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
