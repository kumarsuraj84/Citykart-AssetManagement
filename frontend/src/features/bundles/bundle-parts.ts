/**
 * The ONE frontend home of the "set / bundle" rules: the parts a set is made of,
 * their share of the price, the Desktop example, and how a price is split
 * across the parts. Used by Settings › Catalogue › Items ("Comes as a set"),
 * the Bundles screen, the PO "Add Bundle" dialog and the ERP PO review. The
 * server re-checks everything (app.bundles.service).
 */

export interface BundlePart {
  id: number;
  name: string;
  item_id: number | null;
  item_name: string | null;
  category_id: number;
  subcategory_id: number | null;
  serial_required: boolean;
  share_percent: number;
  sort_order: number;
}

export interface Bundle {
  id: number;
  name: string;
  is_active: boolean;
  parts: BundlePart[];
}

/** A part being edited in a form. */
export interface DraftPart {
  /** The saved part's id (kept on edit so lines already made from it stay linked); null = new. */
  id: number | null;
  name: string;
  /** The Item this part is (CPU, TFT, Keyboard, Mouse). */
  itemId: string;
  share: string;
}

export const blankPart = (): DraftPart => ({ id: null, name: "", itemId: "", share: "" });

/** The Desktop split the business uses; the Item of each part still has to be picked. */
export const DESKTOP_EXAMPLE: readonly DraftPart[] = [
  { id: null, name: "CPU", itemId: "", share: "70" },
  { id: null, name: "TFT", itemId: "", share: "26" },
  { id: null, name: "Keyboard", itemId: "", share: "2" },
  { id: null, name: "Mouse", itemId: "", share: "2" },
];

export const desktopExample = (): DraftPart[] => DESKTOP_EXAMPLE.map((p) => ({ ...p }));

/** The parts of a saved bundle, ready to edit. */
export function draftPartsFromBundle(bundle: Bundle): DraftPart[] {
  return bundle.parts.map((p) => ({
    id: p.id,
    name: p.name,
    itemId: p.item_id ? String(p.item_id) : "",
    share: String(p.share_percent),
  }));
}

/** Sum of the typed shares. */
export function shareTotal(parts: DraftPart[]): number {
  return parts.reduce((sum, p) => sum + (Number(p.share) || 0), 0);
}

/** The shares must add up to exactly 100% (same tolerance as the server). */
export function sharesAddUp(parts: DraftPart[]): boolean {
  return Math.abs(shareTotal(parts) - 100) < 0.005;
}

/** Every part named, given an Item and a share above 0, and the shares total 100%. */
export function partsReady(parts: DraftPart[]): boolean {
  return (
    parts.length > 0 &&
    sharesAddUp(parts) &&
    parts.every((p) => p.name.trim() !== "" && p.itemId !== "" && Number(p.share) > 0)
  );
}

/** The `parts` of a POST/PUT /bundles body. */
export function partsPayload(parts: DraftPart[]) {
  return parts.map((p) => ({
    id: p.id,
    name: p.name.trim(),
    item_id: Number(p.itemId),
    share_percent: Number(p.share),
  }));
}

/** "CPU 70%, TFT 26%, ..." */
export function partsSummary(parts: BundlePart[]): string {
  return parts.map((p) => `${p.name} ${p.share_percent}%`).join(", ");
}

/** Each part's amount = price x share%, to the paisa; leftover paise go to the
 * biggest share so the parts add up to the price exactly (mirrors
 * app.bundles.service.split_amounts, which re-checks the total on the server). */
export function splitAmounts(price: number, shares: number[]): number[] {
  const priceP = Math.round(price * 100);
  const amounts = shares.map((s) => Math.round((priceP * s) / 100));
  const diff = priceP - amounts.reduce((a, b) => a + b, 0);
  if (diff !== 0 && amounts.length > 0) {
    let biggest = 0;
    shares.forEach((s, i) => {
      if (s > shares[biggest]) biggest = i;
    });
    amounts[biggest] += diff;
  }
  return amounts.map((a) => a / 100);
}
