/**
 * What the signed-in person may create and manage -- the ONE source every
 * "+ New …" control reads (S3b-1). It comes from `GET /api/auth/capabilities`,
 * which the server builds from the very same functions its endpoints enforce
 * with, so the screen offers exactly what the server will allow.
 *
 * UX only: the server re-checks every request and stays the authority.
 * While the answer is loading, or when it could not be had, nothing may be
 * created from the screen (create controls never flash in and out).
 *
 * The route guards (lib/access.ts) are about which AREAS a person may open and
 * stay as they are; this module is only about creating / managing records.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import { useAuthStore } from "./auth-store";

/** The small records a person may be allowed to create inside a task. */
export type CreateKind = "vendor" | "brand" | "cost_centre" | "stock_room" | "item" | "category" | "sub_category";

/** Edit / deactivate and the heavier set-up rights. */
export type ManageKey =
  | "vendor" | "brand" | "cost_centre" | "category" | "sub_category" | "item" | "change_work_area"
  | "erp_vendor_link" | "erp_vendor_unlink" | "users" | "company" | "location" | "department"
  | "custom_field" | "bundle" | "code_rule" | "item_rules" | "erp_setup" | "imports";

/** "IT" or "NON_IT" (a Category's asset_domain). */
export type WorkArea = string;

export interface Capabilities {
  role: string;
  role_label: string;
  is_head_office_admin: boolean;
  work_areas: WorkArea[];
  work_area_label: string;
  can_create: Partial<Record<CreateKind, boolean>>;
  /** Work areas in which this person may create an Item. */
  item_create_work_areas: WorkArea[];
  /** Work areas in which this person may create / change Categories, Sub-categories and Items. */
  domain_manage_work_areas: WorkArea[];
  can_manage: Partial<Record<ManageKey, boolean>>;
  company_ids: number[];
  /** S5: the same companies as `company_ids`, with their code and name (empty from an older server). */
  companies: CompanyRef[];
}

/** A company this person works in. */
export interface CompanyRef {
  id: number;
  code: string;
  name: string;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const flags = (v: unknown): Record<string, boolean> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = val === true;
  return out;
};

/** The server's answer, or null when it is not a capabilities object (nothing is then allowed). */
export function parseCapabilities(data: unknown): Capabilities | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (!d.can_create || typeof d.can_create !== "object" || Array.isArray(d.can_create)) return null;
  return {
    role: typeof d.role === "string" ? d.role : "",
    role_label: typeof d.role_label === "string" ? d.role_label : "",
    is_head_office_admin: d.is_head_office_admin === true,
    work_areas: strings(d.work_areas),
    work_area_label: typeof d.work_area_label === "string" ? d.work_area_label : "",
    can_create: flags(d.can_create),
    item_create_work_areas: strings(d.item_create_work_areas),
    domain_manage_work_areas: strings(d.domain_manage_work_areas),
    can_manage: flags(d.can_manage),
    company_ids: Array.isArray(d.company_ids) ? d.company_ids.filter((x): x is number => typeof x === "number") : [],
    companies: Array.isArray(d.companies)
      ? d.companies
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as { id?: unknown }).id === "number")
          .map((c) => ({ id: c.id as number, code: typeof c.code === "string" ? c.code : "", name: typeof c.name === "string" ? c.name : "" }))
      : [],
  };
}

export function canCreate(caps: Capabilities | null | undefined, kind: CreateKind): boolean {
  return caps?.can_create[kind] === true;
}

export function canManage(caps: Capabilities | null | undefined, key: ManageKey): boolean {
  return caps?.can_manage[key] === true;
}

/** Work areas this person may add an Item in ([] = none). */
export function itemCreateAreas(caps: Capabilities | null | undefined): WorkArea[] {
  return canCreate(caps, "item") ? caps!.item_create_work_areas : [];
}

/** Work areas this person may add a Category / Sub-category in ([] = none). */
export function domainManageAreas(caps: Capabilities | null | undefined): WorkArea[] {
  return caps ? caps.domain_manage_work_areas : [];
}

/**
 * True when a record of `area` lies inside `areas`. A record whose work area is
 * unknown (an old Category without one) is left to the server to judge.
 */
export function inAreas(area: string | null | undefined, areas: WorkArea[]): boolean {
  if (!area) return true;
  return areas.includes(area);
}

export const CAPABILITIES_PATH = "/auth/capabilities";

/**
 * The capabilities of whoever is signed in. Cached for the session (never
 * stale on its own) and asked again on every login and token refresh, because
 * the token is part of the key. A refresh for the same person keeps showing the
 * last answer while the new one loads, so nothing blinks.
 */
export function useCapabilities(): {
  caps: Capabilities | null;
  /** The answer is here. */
  ready: boolean;
  /** Not waiting any more (answered, failed or not signed in): safe to say "ask someone". */
  settled: boolean;
} {
  const token = useAuthStore((s) => s.accessToken);
  const person = useAuthStore((s) => `${s.assetUserId ?? ""}:${s.role ?? ""}:${s.isPrimaryOwner ? 1 : 0}`);
  // Only the token's tail goes into the key (it changes with every new token).
  const session = token ? token.slice(-24) : "";
  const q = useQuery({
    queryKey: ["auth", "capabilities", person, session],
    queryFn: async () => parseCapabilities(await apiClient.get<unknown>(CAPABILITIES_PATH)),
    enabled: !!token,
    staleTime: Infinity,
    retry: 1,
    placeholderData: (previous, previousQuery) =>
      previousQuery && previousQuery.queryKey[2] === person ? previous : undefined,
  });
  const caps = q.isError ? null : (q.data ?? null);
  return { caps, ready: caps !== null, settled: caps !== null || !q.isFetching };
}

/**
 * The companies the signed-in person works in: `capabilities.companies` (S5), or -- from an older server, or
 * while that answer is missing -- `GET /asset-users/me/companies` (the same list). `ready` = known.
 */
export function useMyCompanies(): { companies: CompanyRef[]; ready: boolean } {
  const { caps, settled } = useCapabilities();
  const fromCaps = caps?.companies ?? [];
  const q = useQuery({
    queryKey: ["asset_users", "me", "companies"],
    queryFn: () => apiClient.get<CompanyRef[]>("/asset-users/me/companies"),
    enabled: settled && fromCaps.length === 0,
  });
  if (fromCaps.length > 0) return { companies: fromCaps, ready: true };
  const list = Array.isArray(q.data) ? q.data : [];
  return { companies: list, ready: q.isSuccess || q.isError };
}

/** May the signed-in person create a `kind` right here? False while loading or on failure. */
export function useCanCreate(kind: CreateKind): boolean {
  return canCreate(useCapabilities().caps, kind);
}

/** May the signed-in person edit / deactivate (or set up) `key`? False while loading or on failure. */
export function useCanManage(key: ManageKey): boolean {
  return canManage(useCapabilities().caps, key);
}

/** "Ask … to add a vendor." -- the short sentence shown when a person cannot add a record themselves. */
export const ASK_TO_ADD: Record<CreateKind, string> = {
  vendor: "Ask an admin or the head-office admin to add a vendor.",
  brand: "Ask an admin or the head-office admin to add a brand.",
  cost_centre: "Ask an admin or the head-office admin to add a cost centre.",
  stock_room: "Ask an admin or the head-office admin to add a stock room.",
  item: "Ask an admin or the head-office admin to add the Item.",
  category: "Ask the head-office admin to add this type of asset.",
  sub_category: "Ask the head-office admin to add this type of asset.",
};
