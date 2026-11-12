/**
 * Brands and work areas. A brand lists the work areas it is used for (`work_areas`: "IT", "NON_IT"); a picker shows only
 * the brands that fit the work area of the Item being used, so the IT list is not mixed with Non-IT brands. A brand that
 * is used for both (Samsung) is in both lists. An older server sends no `work_areas`: such a brand counts as every area.
 */
import { brandOptions } from "./option-labels";

export interface BrandLike {
  id: number;
  name: string;
  code?: string | null;
  work_areas?: string[] | null;
}

export const BRAND_AREA_WORDS: Record<string, string> = { IT: "IT", NON_IT: "Non-IT" };

/** The brands used for `area` (every brand when the area is not known yet). */
export function brandsForArea<T extends BrandLike>(brands: T[], area: string | null | undefined): T[] {
  if (!area) return brands;
  return brands.filter((b) => !b.work_areas || b.work_areas.includes(area));
}

/** The select options for a picker: the brands used for `area`, plus the brand already chosen even if it does not
 * fit (so the box never shows blank while a value is still held; the server refuses a brand that does not fit). */
export function brandChoicesFor(all: BrandLike[], area: string | null | undefined, selectedId: string | null | undefined) {
  const fit = brandsForArea(all, area);
  const keep = all.filter((b) => String(b.id) === selectedId && !fit.includes(b));
  return brandOptions([...fit, ...keep]);
}

/** "IT", "Non-IT" or "IT and Non-IT". */
export function brandAreasText(areas: string[] | null | undefined): string {
  const list = areas && areas.length > 0 ? areas : ["IT", "NON_IT"];
  return list.map((a) => BRAND_AREA_WORDS[a] ?? a).join(" and ");
}

/** The one-select choices of "Used for" (a future work area is one more row here). */
export const BRAND_AREA_CHOICES: { value: string; label: string; areas: string[] }[] = [
  { value: "BOTH", label: "Both IT and Non-IT", areas: ["IT", "NON_IT"] },
  { value: "IT", label: "IT only", areas: ["IT"] },
  { value: "NON_IT", label: "Non-IT only", areas: ["NON_IT"] },
];

/** A brand's stored areas -> the select's value. */
export function brandAreaChoiceOf(areas: unknown): string {
  const list = Array.isArray(areas) ? (areas as string[]) : ["IT", "NON_IT"];
  const found = BRAND_AREA_CHOICES.find((c) => c.areas.length === list.length && c.areas.every((a) => list.includes(a)));
  return found?.value ?? "BOTH";
}

/** The select's value -> the areas to send. */
export function brandAreasOfChoice(choice: unknown): string[] {
  return (BRAND_AREA_CHOICES.find((c) => c.value === choice) ?? BRAND_AREA_CHOICES[0]).areas;
}
