import { test, expect, type Page } from "@playwright/test";
import {
  optionMatcher, newSeedRegistry, seedTestCompany, teardownTestCompany, fillAddAssetProcurementFields, addAssetsAndOpenFirst,
  createTestLogin, type SeedRegistry,
} from "./fixtures";

// Asset User / RBAC / Responsibility rebuild, permanent E2E coverage (spec §60):
// an ADMIN logs in, IT and NON_IT categories exist side by side, a fresh asset
// is procured into each, the Responsibility preview/filter/dashboard-selector/
// Asset 360 display all agree on the derived domain -- and, separately, a
// genuinely ordinary (non-Primary-Owner) ADMIN account is proven, end to end
// through the real API, to have exactly the S3a-1 rights: it may add the small
// masters its flows need (vendor, brand, cost centre, stock room, Item) and the
// Asset Groups of its own work area, but never change / remove those masters or
// touch companies, locations, departments, custom fields, sets, code rules,
// imports or the ERP mapping; a one-work-area ADMIN never creates in the other area.

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

// AddAssetForm/AssetRegister/Dashboard use shadcn's Radix-based <Select>, not a
// native <select> -- same convention every other spec in this suite uses.
async function selectRadix(page: Page, label: string, optionText: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: optionMatcher(optionText) }).click();
}

async function api<T>(baseURL: string, method: string, urlPath: string, token: string | undefined, body?: unknown): Promise<T | { status: number }> {
  const res = await fetch(`${baseURL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function loginAdmin(baseURL: string, reg: SeedRegistry): Promise<string> {
  const login = (await api<{ access_token: string }>(baseURL, "POST", "/api/auth/login", undefined, {
    company_id: reg.companyId,
    login_id: reg.adminEmpCode,
    password: reg.adminPassword,
  })) as { access_token: string };
  return login.access_token;
}

let registry: SeedRegistry | null = null;

test.afterEach(async ({ baseURL }) => {
  if (registry) {
    const reg = registry;
    registry = null;
    await teardownTestCompany(baseURL!, reg);
  }
});

test("Asset User RBAC / Responsibility rebuild: IT vs NON_IT domain scoping end to end", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry); // ctx.category is IT (asset_domain: "IT")
  const ts = Date.now().toString(36);
  // SEEDADMIN: role=ADMIN *and* is_primary_owner (scripts/seed_admin.py) -- the
  // dev/E2E bootstrap account, never how a real ordinary ADMIN is provisioned.
  const ownerToken = await loginAdmin(baseURL!, registry);

  // ---- A second, NON_IT category+subcategory alongside the IT one seedTestCompany
  // already created -- masters writes only succeed here because SEEDADMIN carries
  // is_primary_owner. ----
  const nonItCategory = (await api<{ id: number; name: string }>(baseURL!, "POST", "/api/masters/categories", ownerToken, {
    code: `E2ENIT${ts}`,
    name: `E2E Non-IT Category ${ts}`,
    asset_domain: "NON_IT",
  })) as { id: number; name: string };
  registry.masters.push(["categories", nonItCategory.id]);
  const nonItSubcategory = (await api<{ id: number; name: string }>(baseURL!, "POST", "/api/masters/subcategories", ownerToken, {
    category_id: nonItCategory.id,
    code: "CHR",
    name: `E2E Chair ${ts}`,
  })) as { id: number; name: string };
  registry.masters.push(["subcategories", nonItSubcategory.id]);
  const nonItItem = (await api<{ id: number; name: string }>(baseURL!, "POST", "/api/items", ownerToken, {
    name: `E2E Chair Item ${ts}`, category_id: nonItCategory.id, subcategory_id: nonItSubcategory.id,
  })) as { id: number; name: string };
  registry.items.push(nonItItem.id);

  // ---- A genuinely ordinary ADMIN (no is_primary_owner, both work areas) and an
  // ADMIN limited to the IT work area -- provisioned the same way a real company
  // admin is (Asset User create + reset password), never scripts.seed_admin's
  // elevated bootstrap path. ----
  const ordinary = await createTestLogin(baseURL!, ownerToken, registry, ctx, {
    code: `ORDADM${ts}`, name: `E2E Ordinary Admin ${ts}`, role: "ADMIN",
  });
  const itAdmin = await createTestLogin(baseURL!, ownerToken, registry, ctx, {
    code: `ITADM${ts}`, name: `E2E IT Admin ${ts}`, role: "ADMIN", allowed_asset_domains: "IT",
  });

  // ---- Backend authorization is authoritative (CLAUDE.md rule #1), with the S3a-1
  // rules (docs/ai/CKAM_SIMPLIFICATION_S3A1_REPORT.md section 3): an ordinary ADMIN
  // may ADD the small masters its flows need (vendor, brand, cost centre, stock
  // room, Item) and the Asset Groups of its own work area; everything else stays
  // with the head-office admin -- all checked here through the real API. ----
  const call = (token: string, method: string, urlPath: string, body?: unknown) => fetch(`${baseURL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  async function allowed(token: string, urlPath: string, body: unknown): Promise<{ id: number; name: string; location_id: number }> {
    const res = await call(token, "POST", urlPath, body);
    expect(res.status, `POST ${urlPath} must be allowed: ${await res.clone().text()}`).toBe(201);
    return (await res.json()) as { id: number; name: string; location_id: number };
  }
  async function forbidden(token: string, method: string, urlPath: string, body?: unknown) {
    const res = await call(token, method, urlPath, body);
    expect(res.status, `${method} ${urlPath} must stay forbidden: ${await res.clone().text()}`).toBe(403);
  }
  const ordTok = ordinary.token;

  // Allowed since S3a-1 (in-flow creation); a code is made from the name when none is sent.
  const ordVendor = await allowed(ordTok, "/api/masters/vendors", { name: `E2E Ordinary Vendor ${ts}` });
  registry.masters.push(["vendors", ordVendor.id]);
  const ordBrand = await allowed(ordTok, "/api/masters/brands", { name: `E2E Ordinary Brand ${ts}` });
  registry.masters.push(["brands", ordBrand.id]);
  const ordCostCentre = await allowed(ordTok, "/api/masters/cost-centers", { company_id: ctx.company.id, name: `E2E Ordinary CC ${ts}` });
  registry.masters.push(["cost-centers", ordCostCentre.id]);
  // A both-area ADMIN looks after the Asset Groups of both work areas.
  const ordItCategory = await allowed(ordTok, "/api/masters/categories", { name: `E2E Ordinary IT Group ${ts}`, asset_domain: "IT" });
  registry.masters.push(["categories", ordItCategory.id]);
  const ordNonItCategory = await allowed(ordTok, "/api/masters/categories", { name: `E2E Ordinary Non-IT Group ${ts}`, asset_domain: "NON_IT" });
  registry.masters.push(["categories", ordNonItCategory.id]);
  const ordSub = await allowed(ordTok, "/api/masters/subcategories", { category_id: ordItCategory.id, code: "ORD", name: `E2E Ordinary Sub ${ts}` });
  registry.masters.push(["subcategories", ordSub.id]);
  const ordItem = await allowed(ordTok, "/api/items", {
    name: `E2E Ordinary Item ${ts}`, category_id: ordItCategory.id, subcategory_id: ordSub.id, serial_required: false,
  });
  registry.items.push(ordItem.id);
  // A stock room, with a new place made from its name.
  const ordStockRoom = await allowed(ordTok, "/api/stock-rooms", {
    name: `E2E Ordinary Stock ${ts}`, company_id: ctx.company.id, location_name: `E2E Ordinary Place ${ts}`,
  });
  registry.asset_userIds.push(ordStockRoom.id);
  registry.masters.unshift(["locations", ordStockRoom.location_id]);

  // Still head-office only: changing or removing those small masters, companies,
  // locations, departments, custom fields, sets (bundles), the asset code rule,
  // Excel imports and the ERP mapping.
  await forbidden(ordTok, "PUT", `/api/masters/vendors/${ordVendor.id}`, { name: `E2E Renamed ${ts}` });
  await forbidden(ordTok, "DELETE", `/api/masters/vendors/${ordVendor.id}`);
  await forbidden(ordTok, "DELETE", `/api/masters/cost-centers/${ordCostCentre.id}`);
  await forbidden(ordTok, "POST", "/api/masters/companies", { code: `NO${ts}`, name: `Should Never Be Created ${ts}` });
  await forbidden(ordTok, "POST", "/api/masters/locations", { company_id: ctx.company.id, code: `NO${ts}`, name: "Should Never Be Created" });
  await forbidden(ordTok, "POST", "/api/masters/departments", { name: `Should Never Be Created ${ts}` });
  await forbidden(ordTok, "POST", "/api/masters/custom-fields", { field_key: `no_${ts}`, label: "Should Never Be Created", field_type: "text" });
  await forbidden(ordTok, "POST", "/api/bundles", { name: `Should Never Be Created ${ts}`, parts: [] });
  await forbidden(ordTok, "POST", "/api/code-rules", {
    company_id: ctx.company.id, prefix_template: "NO/{category.code}/", suffix_template: "", start_number: 1, pad_width: 0,
  });
  await forbidden(ordTok, "GET", "/api/imports/assets/template");
  await forbidden(ordTok, "POST", "/api/items/maps", { item_id: ordItem.id, company_id: ctx.company.id, erp_item_code: `NO${ts}` });
  await forbidden(ordTok, "GET", "/api/erp/vendors");

  // ---- One work area: the IT-only ADMIN works inside IT and is refused the
  // Admin / Non-IT team's groups and Items (no cross-area creation or removal). ----
  const itCategory = await allowed(itAdmin.token, "/api/masters/categories", { name: `E2E IT Admin Group ${ts}`, asset_domain: "IT" });
  registry.masters.push(["categories", itCategory.id]);
  await forbidden(itAdmin.token, "POST", "/api/masters/categories", { name: `Should Never Be Created ${ts}`, asset_domain: "NON_IT" });
  await forbidden(itAdmin.token, "POST", "/api/masters/subcategories", { category_id: nonItCategory.id, code: "NO", name: `Should Never Be Created ${ts}` });
  await forbidden(itAdmin.token, "POST", "/api/items", {
    name: `Should Never Be Created ${ts}`, category_id: nonItCategory.id, subcategory_id: nonItSubcategory.id,
  });
  await forbidden(itAdmin.token, "DELETE", `/api/items/${nonItItem.id}`);

  // What the server enforces is what it tells the screens (GET /api/auth/capabilities).
  const caps = (await (await call(ordTok, "GET", "/api/auth/capabilities")).json()) as {
    is_head_office_admin: boolean; can_create: Record<string, boolean>; can_manage: Record<string, boolean>;
  };
  expect(caps.is_head_office_admin).toBe(false);
  expect(caps.can_create).toMatchObject({ vendor: true, brand: true, cost_centre: true, stock_room: true, item: true, category: true });
  expect(caps.can_manage).toMatchObject({
    vendor: false, company: false, location: false, department: false, custom_field: false, bundle: false, code_rule: false, imports: false,
  });

  // ---- The same ordinary ADMIN, in the real UI: Settings (incl. Bulk Import) is absent
  // from the sidebar entirely (UX only -- the 403s above are the real gate). ----
  await loginAs(page, ordinary.code, ordinary.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Import", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).not.toBeVisible();
  // ...and typing the address shows the route guard instead of the screen.
  await page.goto("/settings");
  await expect(page.getByText("You don't have access to this area.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);

  // ---- Back to SEEDADMIN (Primary Owner): procure one IT asset and one NON_IT
  // asset, verifying the read-only Work area preview on Add Asset for each. ----
  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  // S5b-1: the Item's work area is shown as a chip on Add Assets (never asked).
  await page.goto("/assets/new");
  await selectRadix(page, "Item", ctx.item.name);
  await expect(page.getByLabel("What the Item decides")).toContainText("IT Team");
  await selectRadix(page, "Received Into", ctx.stock.name);
  await selectRadix(page, "Cost Centre", ctx.costCenter.name);
  await fillAddAssetProcurementFields(page, ctx.vendor.name, `E2E RBAC IT Asset ${ts}`);
  await addAssetsAndOpenFirst(page, 1);
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  const itHeading = page.getByRole("heading", { level: 1, name: /^E2E\// });
  await expect(itHeading).toBeVisible();
  const itAssetCode = (await itHeading.textContent())!.trim();

  await page.goto("/assets/new");
  await selectRadix(page, "Item", nonItItem.name);
  await expect(page.getByLabel("What the Item decides")).toContainText("Admin / Non-IT Team");
  await selectRadix(page, "Received Into", ctx.stock.name);
  await selectRadix(page, "Cost Centre", ctx.costCenter.name);
  await fillAddAssetProcurementFields(page, ctx.vendor.name, `E2E RBAC Non-IT Asset ${ts}`);
  await addAssetsAndOpenFirst(page, 1);
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  const nonItHeading = page.getByRole("heading", { level: 1, name: /^E2E\// });
  await expect(nonItHeading).toBeVisible();
  const nonItAssetCode = (await nonItHeading.textContent())!.trim();
  expect(nonItAssetCode).not.toBe(itAssetCode);

  // ---- Asset 360 (the Work area chip in the summary): each asset's own Work
  // area, server-derived from Category at procurement time -- never client-trusted. ----
  await expect(page.getByTestId("work-area-chip").getByText("Admin / Non-IT Team", { exact: true })).toBeVisible();

  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(itAssetCode);
  await page.locator("tbody tr", { hasText: itAssetCode }).click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  await expect(page.getByTestId("work-area-chip").getByText("IT Team", { exact: true })).toBeVisible();

  // ---- Asset Register: the Work area filter narrows to exactly the
  // matching asset, never the other one. ----
  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(`E2E RBAC`);
  // S5b-1: Work area sits under "More filters".
  await page.getByRole("button", { name: /More filters/ }).click();
  await selectRadix(page, "Work area", "IT Team");
  const itRow = page.locator("tr", { hasText: itAssetCode });
  const nonItRow = page.locator("tr", { hasText: nonItAssetCode });
  await expect(itRow).toBeVisible();
  await expect(nonItRow).not.toBeVisible();

  await selectRadix(page, "Work area", "Admin / Non-IT Team");
  await expect(nonItRow).toBeVisible();
  await expect(itRow).not.toBeVisible();

  // ---- Dashboard: the Home "Work area" selector narrows every figure
  // server-side (spec §37/§67) -- confirmed here by watching the request itself
  // carry the chosen domain and resolve successfully, same proof used for the
  // Asset Register filter above via the UI's own narrowing. ----
  await page.goto("/dashboard");
  const dashboardDomainRequest = page.waitForResponse((r) => r.url().includes("/api/reports/dashboard?domain=IT") && r.ok());
  await selectRadix(page, "Work area", "IT Team");
  await dashboardDomainRequest;
});
