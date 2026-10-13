/**
 * The manual PO being typed, kept in this browser tab (sessionStorage) so an
 * accidental reload does not lose it (S7 fix P2-12). Cleared once the PO is
 * saved or the person chooses "Start again". Every read and write is guarded:
 * blocked storage just means no draft.
 */
export const PO_DRAFT_KEY = "ckam:manual-po-draft";

export interface PoDraft<L, S> {
  v: 1;
  companyId: number | null;
  poNumber: string;
  poDate: string;
  vendorId: string;
  costCenterId: string;
  deliveryId: string;
  lines: L[];
  sets: S[];
}

export function readPoDraft<L, S>(): PoDraft<L, S> | null {
  try {
    const raw = window.sessionStorage.getItem(PO_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PoDraft<L, S>>;
    if (!d || d.v !== 1 || !Array.isArray(d.lines) || !Array.isArray(d.sets)) return null;
    return d as PoDraft<L, S>;
  } catch {
    return null;
  }
}

export function writePoDraft<L, S>(draft: PoDraft<L, S>): void {
  try {
    window.sessionStorage.setItem(PO_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // storage blocked or full: no draft
  }
}

export function clearPoDraft(): void {
  try {
    window.sessionStorage.removeItem(PO_DRAFT_KEY);
  } catch {
    // nothing to clear
  }
}
