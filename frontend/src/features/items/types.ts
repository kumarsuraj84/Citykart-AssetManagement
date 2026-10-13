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
  /** "IT" / "NON_IT": the work area of the Item's Category (server, S3a-1). */
  work_area?: string | null;
  category_name?: string | null;
  subcategory_name?: string | null;
  /** S6: the Item comes as a set, and that set's name (from the server). */
  is_set?: boolean;
  bundle_name?: string | null;
}

export type MatchType = "CODE" | "NAME" | "ARTICLE" | "DEPARTMENT" | "SECTION" | "DIVISION";
/** The broad levels can only say "not tracked in CKAM". */
export type GroupLevel = "DEPARTMENT" | "SECTION" | "DIVISION";

export interface ArticleRow {
  article_key: string;
  article_name: string;
  section: string;
  department: string;
  division: string;
  /** "ITEM" (linked to an Item), "NOT_TRACKED" (the Article or its Department / Section / Division is marked so), or none yet. */
  decision: "ITEM" | "NOT_TRACKED" | null;
  not_tracked_by: string | null;
  not_tracked_level: MatchType | null;
  decision_map_id: number | null;
  /** Code / product-name rules inside the Article that say "not tracked". */
  untracked_rules: number;
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
  not_tracked: boolean;
  not_tracked_by: string | null;
  map_id: number | null;
}

/** A Department / Section / Division the company has bought from, for marking a whole group not tracked. */
export interface GroupRow {
  value: string;
  level: GroupLevel;
  articles: number;
  codes: number;
  units: number;
  section: string;
  samples: string[];
  not_tracked: boolean;
  map_id: number | null;
}
