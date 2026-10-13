/**
 * The ONE place that decides how a record reads inside a dropdown.
 *
 * A name alone is not enough to pick the right record ("Laptop" in which
 * group? "Rahul" at which store?), so every important picker shows context:
 *
 *   Item         Laptop · IT Fixed Assets            (Category; › Sub-category when it adds something)
 *   Person/place CS6872 · Ankur Pahwa · Head Office · CKSPL   (company only when the list spans companies)
 *   Stock Room   HO Stock · Head Office · CKSPL
 *   Cost Centre  IT-HO · IT Head Office
 *   Vendor       Acme Traders · 07ABCDE1234F1Z5      (GSTIN when known)
 *   Brand        Dell
 *
 * Each builder returns a SearchableSelect option: `label` is the main text,
 * `detail` the muted context, `keywords` extra searchable terms. Builders
 * only use data the screen already has; lookups (category names, location
 * names, company codes) are passed in as plain maps.
 */
import type { SearchableSelectOption } from "@/components/shared/SearchableSelect";

export type Option = SearchableSelectOption;

/** id -> display text. Plain object or Map both work. */
export type NameLookup = Record<number, string> | Map<number, string>;

function look(lookup: NameLookup | undefined, id: number | null | undefined): string | undefined {
  if (lookup === undefined || id === null || id === undefined) return undefined;
  const v = lookup instanceof Map ? lookup.get(id) : lookup[id];
  return v && v.trim() !== "" ? v : undefined;
}

const clean = (parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => typeof p === "string" && p.trim() !== "");

const join = (parts: (string | null | undefined)[]) => {
  const out = clean(parts);
  return out.length > 0 ? out.join(" · ") : undefined;
};

/** Builds an id -> name map from any list of `{ id, name }` records. */
export function namesById<T extends { id: number; name: string }>(rows: T[] | undefined | null): Record<number, string> {
  const out: Record<number, string> = {};
  for (const r of Array.isArray(rows) ? rows : []) out[r.id] = r.name;
  return out;
}

/** Builds an id -> code map (falls back to the name when a record has no code). */
export function codesById<T extends { id: number; name: string; code?: string | null }>(
  rows: T[] | undefined | null,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const r of Array.isArray(rows) ? rows : []) out[r.id] = r.code || r.name;
  return out;
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

export interface ItemLike {
  id: number;
  name: string;
  category_id?: number | null;
  subcategory_id?: number | null;
  /** Some endpoints already return the names; they win over the lookups. */
  category_name?: string | null;
  subcategory_name?: string | null;
}

export interface ItemContext {
  categories?: NameLookup;
  subcategories?: NameLookup;
}

/** "Laptop · IT Fixed Assets" (or "Desk · Furniture › Office Desks"). */
export function itemOption(item: ItemLike, ctx: ItemContext = {}): Option {
  const category = item.category_name ?? look(ctx.categories, item.category_id);
  const sub = item.subcategory_name ?? look(ctx.subcategories, item.subcategory_id);
  // The Sub-category only adds information when it is not just the Item's
  // own name again (Items were first created from Sub-categories) or the
  // Category's name.
  const showSub = sub && sub.toLowerCase() !== item.name.toLowerCase() && sub !== category;
  const detail = category ? (showSub ? `${category} › ${sub}` : category) : showSub ? sub : undefined;
  return { value: String(item.id), label: item.name, detail: detail ?? undefined };
}

export function itemOptions(items: ItemLike[] | undefined | null, ctx: ItemContext = {}): Option[] {
  return (Array.isArray(items) ? items : []).map((i) => itemOption(i, ctx));
}

// ---------------------------------------------------------------------------
// People & places (backend: asset users)
// ---------------------------------------------------------------------------

export interface PlaceLike {
  id: number;
  name: string;
  code?: string | null;
  email?: string | null;
  asset_user_type?: string | null;
  company_id?: number | null;
  location_id?: number | null;
  /** Used directly when an endpoint already returns them. */
  location_name?: string | null;
  company_code?: string | null;
}

export interface PlaceContext {
  /** location id -> name ("Head Office", "Lamington Road"). */
  locations?: NameLookup;
  /** company id -> short code ("CKSPL"). */
  companies?: NameLookup;
  /** Show the company. Default: only when the list spans more than one company. */
  showCompany?: boolean;
}

/** True when the given records belong to more than one company. */
export function spansCompanies(rows: { company_id?: number | null }[] | undefined | null): boolean {
  const ids = new Set((Array.isArray(rows) ? rows : []).map((r) => r.company_id).filter((id) => id != null));
  return ids.size > 1;
}

function placeKeywords(p: PlaceLike): string[] {
  return clean([p.code, p.email]);
}

/**
 * "CS6872 · Ankur Pahwa · Head Office · CKSPL" -- never the name alone.
 * Stock Rooms have machine-made codes (STK-HO), so they read
 * "HO Stock · Head Office · CKSPL" instead (see stockRoomOption).
 */
export function placeOption(p: PlaceLike, ctx: PlaceContext = {}, showCompany = ctx.showCompany ?? false): Option {
  const rawPlace = p.location_name ?? look(ctx.locations, p.location_id);
  // A store's place usually has the store's own name: don't say it twice.
  const place = rawPlace && rawPlace.toLowerCase() !== p.name.toLowerCase() ? rawPlace : undefined;
  const company = showCompany ? (p.company_code ?? look(ctx.companies, p.company_id)) : undefined;
  const isStockRoom = p.asset_user_type === "STOCK_POINT" || p.asset_user_type === "INSTALLED";
  const label = isStockRoom || !p.code ? p.name : `${p.code} · ${p.name}`;
  return { value: String(p.id), label, detail: join([place, company]), keywords: placeKeywords(p) };
}

/** Options for a list of people/places; the company is added only when the list spans companies. */
export function placeOptions(rows: PlaceLike[] | undefined | null, ctx: PlaceContext = {}): Option[] {
  const list = Array.isArray(rows) ? rows : [];
  const showCompany = ctx.showCompany ?? spansCompanies(list);
  return list.map((p) => placeOption(p, ctx, showCompany));
}

/** "HO Stock · Head Office · CKSPL". */
export function stockRoomOption(p: PlaceLike, ctx: PlaceContext = {}, showCompany = ctx.showCompany ?? false): Option {
  return placeOption({ ...p, asset_user_type: "STOCK_POINT" }, ctx, showCompany);
}

export function stockRoomOptions(rows: PlaceLike[] | undefined | null, ctx: PlaceContext = {}): Option[] {
  const list = Array.isArray(rows) ? rows : [];
  const showCompany = ctx.showCompany ?? spansCompanies(list);
  return list.map((p) => stockRoomOption(p, ctx, showCompany));
}

// ---------------------------------------------------------------------------
// Small masters
// ---------------------------------------------------------------------------

export interface CodedLike {
  id: number;
  name: string;
  code?: string | null;
}

/** "IT-HO · IT Head Office". */
export function costCentreOption(c: CodedLike): Option {
  return { value: String(c.id), label: c.code ? `${c.code} · ${c.name}` : c.name, keywords: clean([c.code]) };
}

export function costCentreOptions(rows: CodedLike[] | undefined | null): Option[] {
  return (Array.isArray(rows) ? rows : []).map(costCentreOption);
}

export interface VendorLike {
  id: number;
  name: string;
  code?: string | null;
  gstin?: string | null;
}

/** "Acme Traders · 07ABCDE1234F1Z5" (GSTIN only when known). */
export function vendorOption(v: VendorLike): Option {
  return { value: String(v.id), label: v.name, detail: v.gstin || undefined, keywords: clean([v.code]) };
}

export function vendorOptions(rows: VendorLike[] | undefined | null): Option[] {
  return (Array.isArray(rows) ? rows : []).map(vendorOption);
}

/** Brand, Category, Company, Department, Bundle...: the name is enough. */
export function nameOption(r: CodedLike): Option {
  return { value: String(r.id), label: r.name, keywords: clean([r.code]) };
}

export function nameOptions(rows: CodedLike[] | undefined | null): Option[] {
  return (Array.isArray(rows) ? rows : []).map(nameOption);
}

export const brandOptions = nameOptions;
export const categoryOptions = nameOptions;
export const companyOptions = nameOptions;
