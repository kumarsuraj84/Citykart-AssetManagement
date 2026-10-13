/**
 * The Assets register's filters (S5b-1): what the address bar holds, how it
 * becomes the `GET /api/assets` request, and how each active filter reads as
 * a removable chip. Pure, so it is cheap to test.
 *
 * Every filter lives in the URL (`/assets?q=…&status=…&holder=store`), so a
 * view can be shared and the back button walks through earlier views.
 */
import { PLACE_TYPES, statusLabel } from "@/lib/labels";

/** The register's search parameters (all optional; ids are kept as text). */
export interface RegisterSearch {
  /** The one search box. */
  q?: string;
  /** Whole-value match only (kept for old links; the server ranks exact matches first anyway). */
  exact?: boolean;
  status?: string;
  /** Who or what holds it: employee | store | stock-room | install-point. */
  holder?: string;
  /** One person or place (asset user id). */
  with?: string;
  /** Only the assets with the signed-in person. */
  mine?: boolean;
  item?: string;
  vendor?: string;
  po?: string;
  /** IT | NON_IT */
  area?: string;
  company?: string;
  /** Asset group (Category id). */
  group?: string;
  /** Comma-separated asset ids (Receive / Add Assets "Open assets"). */
  ids?: string;
  /** Put the cursor in the search box (Home's "Find Asset"). */
  find?: boolean;
}

/** The URL words for the four kinds of holder, and the server's codes. */
export const HOLDER_WORDS: Record<string, string> = {
  employee: "EMPLOYEE",
  store: "STORE",
  "stock-room": "STOCK_POINT",
  "install-point": "INSTALLED",
};
const HOLDER_BY_CODE: Record<string, string> = Object.fromEntries(Object.entries(HOLDER_WORDS).map(([w, c]) => [c, w]));

/** "store" or "STORE" -> "STORE"; anything else -> undefined. */
export function holderCode(word: string | undefined | null): string | undefined {
  if (!word) return undefined;
  if ((PLACE_TYPES as readonly string[]).includes(word)) return word;
  return HOLDER_WORDS[word.toLowerCase()];
}

export function holderWord(code: string): string {
  return HOLDER_BY_CODE[code] ?? code.toLowerCase();
}

/** The filters that narrow the list (not the search box, not paging). */
export const FILTER_KEYS = ["status", "holder", "with", "mine", "item", "vendor", "po", "area", "company", "group", "exact"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** A stable text of everything that changes which rows match (paging restarts when it changes). */
export function filterKey(s: RegisterSearch): string {
  return JSON.stringify([s.q ?? "", ...FILTER_KEYS.map((k) => s[k] ?? ""), s.ids ?? ""]);
}

/** How many "More filters" are on (for the button). */
export function moreFilterCount(s: RegisterSearch): number {
  const n = (["status", "holder", "with", "item", "vendor", "po", "area", "company", "group"] as const).filter((k) => !!s[k]).length;
  // "With Store" is one choice (a status and its holder), so it counts once.
  return statusChoiceOf(s).includes(":") ? n - 1 : n;
}

/** The GET /api/assets query string for this view. */
export function registerQuery(
  s: RegisterSearch,
  opts: { myId: number | null; page: number; pageSize: number; sortBy?: string | null; sortDir?: "asc" | "desc" },
): string {
  const p = new URLSearchParams();
  const q = s.q?.trim();
  if (q) p.set("q", q);
  if (q && s.exact) p.set("exact", "true");
  if (s.status) p.set("status", s.status);
  const holder = holderCode(s.holder);
  if (holder) p.set("holder_type", holder);
  if (s.mine && opts.myId != null) p.set("asset_user_id", String(opts.myId));
  else if (s.with) p.set("asset_user_id", s.with);
  if (s.item) p.set("item_id", s.item);
  if (s.vendor) p.set("vendor_id", s.vendor);
  if (s.po?.trim()) p.set("po_number", s.po.trim());
  if (s.area) p.set("work_area", s.area);
  if (s.company) p.set("company_id", s.company);
  if (s.group) p.set("category_id", s.group);
  if (s.ids) p.set("ids", s.ids);
  if (opts.sortBy) {
    p.set("sort_by", opts.sortBy);
    p.set("sort_dir", opts.sortDir ?? "asc");
  }
  p.set("limit", String(opts.pageSize));
  p.set("offset", String(opts.page * opts.pageSize));
  return p.toString();
}

// ---------------------------------------------------------------------------
// Status in plain words: "With Employee" / "With Store" are a status plus who holds it
// ---------------------------------------------------------------------------

/** The status filter's choices: value = "STATUS" or "STATUS:HOLDER". */
export function statusChoices(current?: string): { value: string; label: string }[] {
  const base = [
    { value: "IN_STOCK", label: statusLabel("IN_STOCK") },
    { value: "ALLOTTED:EMPLOYEE", label: statusLabel("ALLOTTED", "EMPLOYEE") },
    { value: "ALLOTTED:STORE", label: statusLabel("ALLOTTED", "STORE") },
    { value: "INSTALLED", label: statusLabel("INSTALLED") },
    { value: "UNDER_REPAIR", label: statusLabel("UNDER_REPAIR") },
    { value: "LOST", label: statusLabel("LOST") },
    { value: "SOLD", label: statusLabel("SOLD") },
    { value: "SCRAPPED", label: statusLabel("SCRAPPED") },
    { value: "DISPOSED", label: statusLabel("DISPOSED") },
  ];
  // "With Employee / Store" only when a link asks for it (Home's status counts).
  if (current === "ALLOTTED") base.splice(1, 0, { value: "ALLOTTED", label: statusLabel("ALLOTTED") });
  return base;
}

/** The status choice this view is on ("" = all). */
export function statusChoiceOf(s: RegisterSearch): string {
  if (!s.status) return "";
  const holder = holderCode(s.holder);
  if (s.status === "ALLOTTED" && (holder === "EMPLOYEE" || holder === "STORE")) return `ALLOTTED:${holder}`;
  return s.status;
}

/** The view after choosing a status ("" = all statuses). */
export function withStatusChoice(s: RegisterSearch, choice: string): RegisterSearch {
  const [status, holder] = choice.split(":");
  const next: RegisterSearch = { ...s, status: status || undefined };
  const was = statusChoiceOf(s);
  if (holder) next.holder = holderWord(holder);
  else if (was.includes(":")) next.holder = undefined; // the holder came with the old status choice
  return next;
}

/** The status word of this view, for its chip. */
export function statusChipLabel(s: RegisterSearch): string {
  const choice = statusChoiceOf(s);
  const [status, holder] = choice.split(":");
  return statusLabel(status, holder ?? null);
}
