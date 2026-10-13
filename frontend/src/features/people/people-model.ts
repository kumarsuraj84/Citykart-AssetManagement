/**
 * People & Places (S5b-2): the four lists over the one backend table, read from
 * `GET /api/people?kind=…` (server search, paging with X-Total-Count), and the
 * small pure helpers their screens share. The menu is the type: nobody ever
 * picks "type" in a form.
 */
import type { PlaceType } from "@/lib/labels";

export type PeopleKind = "employees" | "stores" | "stock-rooms" | "install-points";

/** One row of `GET /api/people` (PersonOut). */
export interface PersonRow {
  id: number;
  kind: string | null;
  kind_label: string | null;
  code: string | null;
  name: string;
  company_id: number | null;
  company_code?: string | null;
  company_name?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  /** Only for someone who can sign in ("Full Admin", …, "Head-office Admin"). */
  role_label?: string | null;
  /** IT / NON_IT / BOTH -- only for a staff login. */
  work_area?: string | null;
  work_area_label?: string | null;
  login_enabled: boolean;
  has_password: boolean;
  must_change_password?: boolean;
  is_primary_owner: boolean;
  is_active: boolean;
}

export interface KindInfo {
  kind: PeopleKind;
  /** The backend asset_user_type of this list. */
  type: PlaceType;
  noun: string;
  plural: string;
  description: string;
  /** People who can sign in (logins, passwords) -- not a place. */
  hasLogins: boolean;
}

export const KIND_INFO: Record<PeopleKind, KindInfo> = {
  employees: {
    kind: "employees", type: "EMPLOYEE", noun: "Employee", plural: "Employees", hasLogins: true,
    description: "People who can be given assets, and their logins.",
  },
  stores: {
    kind: "stores", type: "STORE", noun: "Store", plural: "Stores", hasLogins: true,
    description: "CityKart stores that hold assets. Each store has its own Stock Room and Install Point.",
  },
  "stock-rooms": {
    kind: "stock-rooms", type: "STOCK_POINT", noun: "Stock Room", plural: "Stock Rooms", hasLogins: false,
    description: "Places where assets are kept in stock, such as head-office stock or a warehouse.",
  },
  "install-points": {
    kind: "install-points", type: "INSTALLED", noun: "Install Point", plural: "Install Points", hasLogins: false,
    description: "Places where assets are installed, such as inside a store.",
  },
};

export const PEOPLE_PAGE_SIZE = 50;

/** `/people?kind=stores&q=lam&company_id=1&limit=50&offset=0` (empty parts left out). */
export function peopleListPath(opts: { kind: PeopleKind; q?: string; companyId?: string | number | null; page?: number; pageSize?: number }): string {
  const size = opts.pageSize ?? PEOPLE_PAGE_SIZE;
  const p = new URLSearchParams({ kind: opts.kind });
  const q = (opts.q ?? "").trim();
  if (q) p.set("q", q);
  if (opts.companyId !== undefined && opts.companyId !== null && opts.companyId !== "") p.set("company_id", String(opts.companyId));
  p.set("limit", String(size));
  p.set("offset", String((opts.page ?? 0) * size));
  return `/people?${p.toString()}`;
}

export const yesNoWord = (v: boolean) => (v ? "Yes" : "No");

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
export { plural };

/** The work areas a login's stored value stands for ("BOTH" / unset = both). */
export function areasOf(workArea: string | null | undefined): string[] {
  if (!workArea || workArea === "BOTH") return ["IT", "NON_IT"];
  return [workArea];
}

/**
 * S6: a one-area admin may not change the login, access level or work area of
 * someone whose work area is wider than their own (the server answers 403).
 * True when the person's area reaches outside `myAreas`. Unknown on either side = false
 * (the server decides).
 */
export function isWiderThanMine(personArea: string | null | undefined, myAreas: string[] | null | undefined): boolean {
  if (!personArea || !myAreas || myAreas.length === 0) return false;
  return areasOf(personArea).some((a) => !myAreas.includes(a));
}

/** "Store LAM, its Stock Room and its Install Point" -- words joined the plain way. */
export function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export type StorePart = "store" | "stock_room" | "install_point";

/**
 * What `POST /people/stores` did, in one or two plain sentences:
 * "Store LAM, its Stock Room and its Install Point were created." /
 * "Store LAM already existed. Its Stock Room and its Install Point were created." /
 * "Store LAM, its Stock Room and its Install Point already existed. Nothing new was added."
 */
export function storeResultSentence(code: string, created: string[], reused: string[]): string {
  const word = (p: string) => (p === "store" ? `Store ${code}` : p === "stock_room" ? "its Stock Room" : p === "install_point" ? "its Install Point" : p);
  const order: StorePart[] = ["store", "stock_room", "install_point"];
  const made = order.filter((p) => created.includes(p));
  const kept = order.filter((p) => reused.includes(p));
  const madeText = made.length > 0 ? `${capitalise(joinWords(made.map(word)))} ${made.length === 1 ? "was" : "were"} created.` : "";
  const keptText = kept.length > 0 ? `${capitalise(joinWords(kept.map(word)))} already existed.` : "";
  if (made.length === 0) return `${keptText} Nothing new was added.`.trim();
  return made.includes("store") || kept.length === 0 ? [madeText, keptText].filter(Boolean).join(" ") : `${keptText} ${madeText}`;
}

// ---------------------------------------------------------------------------
// Issued passwords (POST /asset-users/issue-passwords): shown once, never kept.
// ---------------------------------------------------------------------------

export interface IssuedPassword {
  asset_user_id: number;
  code: string | null;
  name: string;
  email: string | null;
  temp_password: string;
}

function csvCell(v: string | null | undefined): string {
  const s = v ?? "";
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The CSV handed to the admin: Code, Name, Email, Temporary password (one account per line). */
export function passwordsCsv(rows: IssuedPassword[]): string {
  const lines = [["Code", "Name", "Email", "Temporary password"].join(",")];
  for (const r of rows) lines.push([r.code, r.name, r.email, r.temp_password].map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** The same list as plain text for the clipboard (tab-separated, pastes into a sheet). */
export function passwordsText(rows: IssuedPassword[]): string {
  return ["Code\tName\tEmail\tTemporary password", ...rows.map((r) => [r.code ?? "", r.name, r.email ?? "", r.temp_password].join("\t"))].join("\n");
}
