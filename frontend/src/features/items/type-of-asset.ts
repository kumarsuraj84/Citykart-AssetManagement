/**
 * "Type of asset": the Item form's ONE picker for what used to be two
 * (Category, then Sub-category). Each entry is "Category › Sub-category" with
 * the Category's work area as a chip; a Category with no Sub-category yet is
 * listed on its own so it can be given one ("+ New type").
 *
 * The backend still stores (and requires) both ids on an Item; this module
 * only turns them into one choice and back. Values are "s:<sub id>" for a
 * Sub-category and "c:<category id>" for a Category that has none.
 */
import type { SearchableSelectOption } from "@/components/shared/SearchableSelect";
import { workAreaLabel } from "@/lib/labels";

export interface TypeCategory {
  id: number;
  name: string;
  code?: string | null;
  asset_domain?: string | null;
}

export interface TypeSubcategory {
  id: number;
  name: string;
  category_id: number;
  code?: string | null;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** The combined list, Category by Category. */
export function typeOfAssetOptions(
  categories: TypeCategory[] | undefined | null,
  subcategories: TypeSubcategory[] | undefined | null,
): SearchableSelectOption[] {
  const cats = [...(Array.isArray(categories) ? categories : [])].sort(byName);
  const subs = Array.isArray(subcategories) ? subcategories : [];
  const out: SearchableSelectOption[] = [];
  for (const c of cats) {
    const badge = workAreaLabel(c.asset_domain) || undefined;
    const own = subs.filter((s) => s.category_id === c.id).sort(byName);
    if (own.length === 0) {
      out.push({
        value: `c:${c.id}`, label: c.name, detail: "no Sub-category yet", badge,
        keywords: [c.code ?? ""].filter(Boolean),
      });
      continue;
    }
    for (const s of own) {
      out.push({
        value: `s:${s.id}`, label: `${c.name} › ${s.name}`, badge,
        keywords: [c.code ?? "", s.code ?? ""].filter(Boolean),
      });
    }
  }
  return out;
}

export type ParsedType = { kind: "sub"; id: number } | { kind: "cat"; id: number } | null;

export function parseTypeValue(value: string | undefined | null): ParsedType {
  if (!value) return null;
  const m = /^([sc]):(\d+)$/.exec(value);
  if (!m) return null;
  return m[1] === "s" ? { kind: "sub", id: Number(m[2]) } : { kind: "cat", id: Number(m[2]) };
}

/** A Category's only Sub-category, used automatically; null when it has none or several. */
export function autoSubcategory(categoryId: number | null | undefined, subcategories: TypeSubcategory[] | undefined | null): number | null {
  if (categoryId == null) return null;
  const own = (Array.isArray(subcategories) ? subcategories : []).filter((s) => s.category_id === categoryId);
  return own.length === 1 ? own[0].id : null;
}

/** The picker value for a stored pair (a missing Sub-category falls back to the Category's only one). */
export function typeValueFor(
  categoryId: number | null | undefined,
  subcategoryId: number | null | undefined,
  subcategories: TypeSubcategory[] | undefined | null,
): string | undefined {
  if (subcategoryId) return `s:${subcategoryId}`;
  const auto = autoSubcategory(categoryId, subcategories);
  if (auto) return `s:${auto}`;
  return categoryId ? `c:${categoryId}` : undefined;
}
