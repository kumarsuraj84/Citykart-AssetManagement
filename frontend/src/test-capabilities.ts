/**
 * Test fixtures: what `GET /api/auth/capabilities` answers for each kind of
 * login (shapes copied from backend app/core/capabilities.py, S3a-1), and a
 * helper that makes a mocked `apiClient.get` answer it.
 */
import type { Capabilities } from "./lib/capabilities";

const NO_MANAGE = {
  vendor: false, brand: false, cost_centre: false, category: false, sub_category: false, item: false,
  change_work_area: false, erp_vendor_link: false, erp_vendor_unlink: false, users: false, company: false,
  location: false, department: false, custom_field: false, bundle: false, code_rule: false, item_rules: false,
  erp_setup: false, imports: false,
};

const SMALL = { vendor: true, brand: true, cost_centre: true, stock_room: true };

export const HEAD_OFFICE: Capabilities = {
  role: "ADMIN", role_label: "Head-office Admin", is_head_office_admin: true,
  work_areas: ["IT", "NON_IT"], work_area_label: "IT and Non-IT",
  can_create: { ...SMALL, item: true, category: true, sub_category: true },
  item_create_work_areas: ["IT", "NON_IT"], domain_manage_work_areas: ["IT", "NON_IT"],
  can_manage: Object.fromEntries(Object.keys(NO_MANAGE).map((k) => [k, true])),
  company_ids: [1, 2], companies: [],
};

export const ADMIN_BOTH: Capabilities = {
  role: "ADMIN", role_label: "Full Admin", is_head_office_admin: false,
  work_areas: ["IT", "NON_IT"], work_area_label: "IT and Non-IT",
  can_create: { ...SMALL, item: true, category: true, sub_category: true },
  item_create_work_areas: ["IT", "NON_IT"], domain_manage_work_areas: ["IT", "NON_IT"],
  can_manage: { ...NO_MANAGE, category: true, sub_category: true, item: true, change_work_area: true, erp_vendor_link: true, users: true },
  company_ids: [1, 2], companies: [],
};

export const ADMIN_IT: Capabilities = {
  ...ADMIN_BOTH,
  work_areas: ["IT"], work_area_label: "IT",
  item_create_work_areas: ["IT"], domain_manage_work_areas: ["IT"],
  can_manage: { ...NO_MANAGE, category: true, sub_category: true, item: true, erp_vendor_link: true, users: true },
};

export const OPERATOR_IT: Capabilities = {
  role: "OPERATOR", role_label: "Can Add & Move Assets", is_head_office_admin: false,
  work_areas: ["IT"], work_area_label: "IT",
  can_create: { ...SMALL, item: true, category: false, sub_category: false },
  item_create_work_areas: ["IT"], domain_manage_work_areas: [],
  can_manage: { ...NO_MANAGE, erp_vendor_link: true },
  company_ids: [1], companies: [],
};

export const VIEWER: Capabilities = {
  role: "VIEWER", role_label: "View Only", is_head_office_admin: false,
  work_areas: ["IT", "NON_IT"], work_area_label: "IT and Non-IT",
  can_create: { vendor: false, brand: false, cost_centre: false, stock_room: false, item: false, category: false, sub_category: false },
  item_create_work_areas: [], domain_manage_work_areas: [],
  can_manage: { ...NO_MANAGE },
  company_ids: [1], companies: [],
};

/** Every kind of login the S3b-1 gating tests walk through. */
export const KINDS: [string, Capabilities][] = [
  ["head-office admin", HEAD_OFFICE],
  ["ADMIN (both work areas)", ADMIN_BOTH],
  ["ADMIN (IT only)", ADMIN_IT],
  ["OPERATOR (IT)", OPERATOR_IT],
  ["VIEWER", VIEWER],
];

type GetImpl = (path: string) => Promise<unknown> | unknown;

/** Wraps a mocked GET so `/auth/capabilities` answers `caps` (null = the call fails). */
export function withCapabilities(caps: Capabilities | null, impl: GetImpl): GetImpl {
  return (path: string) => {
    if (path === "/auth/capabilities") return caps ? Promise.resolve(caps) : Promise.reject(new Error("Request failed: 500"));
    return impl(path);
  };
}
