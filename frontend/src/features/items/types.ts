/** CityKart's own Item: what an asset IS ("Cassette AC"). Many ERP item codes
 * (one per vendor / spec) point to one Item; Category / Sub-Category stay
 * underneath as the internal classification. */
export interface Item {
  id: number;
  name: string;
  category_id: number;
  subcategory_id: number | null;
  /** Whether it carries a serial number (the only place this rule lives). */
  serial_required: boolean;
  /** Has a serial, but it is only read later, once the box is opened (an amplifier). */
  serial_later: boolean;
  bundle_id: number | null;
  default_brand_id: number | null;
  default_warranty_years: number | null;
  is_active: boolean;
  map_count: number;
}

export type MatchType = "CODE" | "NAME" | "ARTICLE";

export interface ArticleRow {
  article_key: string;
  article_name: string;
  section: string;
  department: string;
  codes: number;
  units: number;
  lines: number;
  samples: string[];
  /** Every bought item code and product name of the Article (for searching). */
  icodes: string[];
  names: string[];
  item_id: number | null;
  item_name: string | null;
  name_rules: number;
  code_rules: number;
  suggested_item_id: number | null;
  suggested_item_name: string | null;
}

export interface ArticleCodeRow {
  icode: string;
  name: string;
  name_key: string;
  description: string;
  units: number;
  lines: number;
  item_id: number | null;
  item_name: string | null;
  matched_by: MatchType | null;
}
