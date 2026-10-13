/**
 * One sentence handed from the screen that made a purchase order to the PO page
 * it opens next ("PO created: 3 lines, 25 units waiting."). Kept in memory only:
 * a reload simply shows the PO without it.
 */
const pending = new Map<number, string>();

export function setPoFlash(poId: number, text: string): void {
  pending.set(poId, text);
}

/** The sentence waiting for this PO, if any (read without removing it). */
export function peekPoFlash(poId: number): string | null {
  return pending.get(poId) ?? null;
}

/** Forget it once shown. */
export function clearPoFlash(poId: number): void {
  pending.delete(poId);
}
