import { test, expect, type Page } from "@playwright/test";
import { newSeedRegistry, seedTestCompany, teardownTestCompany, fillAddAssetProcurementFields, type SeedRegistry } from "./fixtures";

// Asset User / RBAC / Responsibility rebuild, permanent E2E coverage (spec §60):
// an ADMIN logs in, IT and NON_IT categories exist side by side, a fresh asset
// is procured into each, the Responsibility preview/filter/dashboard-selector/
// Asset 360 display all agree on the derived domain -- and, separately, a
// genuinely ordinary (non-Primary-Owner) ADMIN account is proven, end to end
// through the real API, to have no master/Import write access at all (the
// spec's own words: "admin role user can only have rights to create PO, mark
// delivery, add asset, ... no master involvement").

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
  await page.getByRole("option", { name: optionText, exact: true }).click();
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

  // ---- A genuinely ordinary ADMIN (no is_primary_owner) -- provisioned the same
  // way a real company admin is, via the ordinary Asset User create+reset-password
  // flow, never scripts.seed_admin's elevated bootstrap path. ----
  const companyAssetUsers = (await api<{ id: number; location_id: number }[]>(
    baseURL!, "GET", `/api/asset-users?company_id=${ctx.company.id}`, ownerToken,
  )) as { id: number; location_id: number }[];
  const stockDetail = companyAssetUsers.find((h) => h.id === ctx.stock.id)!;
  const ordinaryAdmin = (await api<{ id: number }>(baseURL!, "POST", "/api/asset-users", ownerToken, {
    company_id: ctx.company.id,
    location_id: stockDetail.location_id,
    code: `ORDADM${ts}`,
    name: `E2E Ordinary Admin ${ts}`,
    asset_user_type: "EMPLOYEE",
    role: "ADMIN",
    login_enabled: true,
  })) as { id: number };
  registry.asset_userIds.push(ordinaryAdmin.id);
  const ordinaryReset = (await api<{ temp_password: string }>(
    baseURL!, "POST", `/api/asset-users/${ordinaryAdmin.id}/reset-password`, ownerToken,
  )) as { temp_password: string };
  const ordinaryPassword = "E2e-Ordinary-Passw0rd";
  const ordinaryLogin = (await api<{ access_token: string }>(baseURL!, "POST", "/api/auth/login", undefined, {
    company_id: ctx.company.id,
    login_id: `ORDADM${ts}`,
    password: ordinaryReset.temp_password,
  })) as { access_token: string };
  await api(baseURL!, "POST", "/api/auth/change-password", ordinaryLogin.access_token, {
    old_password: ordinaryReset.temp_password,
    new_password: ordinaryPassword,
  });
  const ordinaryToken = (await api<{ access_token: string }>(baseURL!, "POST", "/api/auth/login", undefined, {
    company_id: ctx.company.id,
    login_id: `ORDADM${ts}`,
    password: ordinaryPassword,
  })) as { access_token: string };

  // ---- Backend authorization is authoritative (CLAUDE.md rule #1): a plain
  // ADMIN gets 403 on both masters writes and Import, regardless of what the
  // frontend nav shows. ----
  const mastersAttempt = await fetch(`${baseURL}/api/masters/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ordinaryToken.access_token}` },
    body: JSON.stringify({ code: `SHOULD-FAIL-${ts}`, name: "Should Never Be Created", asset_domain: "IT" }),
  });
  expect(mastersAttempt.status).toBe(403);
  const importAttempt = await fetch(`${baseURL}/api/imports/assets/template`, {
    headers: { Authorization: `Bearer ${ordinaryToken.access_token}` },
  });
  expect(importAttempt.status).toBe(403);

  // ---- The same ordinary ADMIN, in the real UI: Masters and Import are absent
  // from the sidebar entirely (UX only -- the 403s above are the real gate). ----
  await loginAs(page, `ORDADM${ts}`, ordinaryPassword);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Import", exact: true })).not.toBeVisible();
  await expect(page.getByText("Masters", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);

  // ---- Back to SEEDADMIN (Primary Owner): procure one IT asset and one NON_IT
  // asset, verifying the read-only Responsibility preview on Add Asset for each. ----
  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/assets/new");
  await selectRadix(page, "Category", ctx.category.name);
  await expect(page.getByLabel("Responsibility", { exact: true })).toHaveValue("IT");
  await selectRadix(page, "Sub-Category", ctx.subcategory.name);
  await page.getByLabel("Description", { exact: true }).fill(`E2E RBAC IT Asset ${ts}`);
  await selectRadix(page, "Cost Centre", ctx.costCenter.name);
  await selectRadix(page, "Goes Into", ctx.stock.name);
  await fillAddAssetProcurementFields(page, ctx.vendor.name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  const itHeading = page.getByRole("heading", { level: 1, name: /^E2E\// });
  await expect(itHeading).toBeVisible();
  const itAssetCode = (await itHeading.textContent())!.trim();

  await page.goto("/assets/new");
  await selectRadix(page, "Category", nonItCategory.name);
  await expect(page.getByLabel("Responsibility", { exact: true })).toHaveValue("Admin / Non-IT");
  await selectRadix(page, "Sub-Category", nonItSubcategory.name);
  await page.getByLabel("Description", { exact: true }).fill(`E2E RBAC Non-IT Asset ${ts}`);
  await selectRadix(page, "Cost Centre", ctx.costCenter.name);
  await selectRadix(page, "Goes Into", ctx.stock.name);
  await fillAddAssetProcurementFields(page, ctx.vendor.name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  const nonItHeading = page.getByRole("heading", { level: 1, name: /^E2E\// });
  await expect(nonItHeading).toBeVisible();
  const nonItAssetCode = (await nonItHeading.textContent())!.trim();
  expect(nonItAssetCode).not.toBe(itAssetCode);

  // ---- Asset 360 (Custody tab): each asset's own Responsibility, server-derived
  // from Category at procurement time -- never client-trusted. ----
  await page.getByRole("tab", { name: "Custody", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Custody" }).getByText("Admin / Non-IT", { exact: true })).toBeVisible();

  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(itAssetCode);
  await page.locator("tbody tr", { hasText: itAssetCode }).click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  await page.getByRole("tab", { name: "Custody", exact: true }).click();
  const itCustody = page.getByRole("tabpanel", { name: "Custody" });
  await expect(itCustody.getByText("IT", { exact: true })).toBeVisible();

  // ---- Asset Register: the Responsibility filter narrows to exactly the
  // matching asset, never the other one. ----
  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(`E2E RBAC`);
  await selectRadix(page, "Responsibility", "IT");
  const itRow = page.locator("tr", { hasText: itAssetCode });
  const nonItRow = page.locator("tr", { hasText: nonItAssetCode });
  await expect(itRow).toBeVisible();
  await expect(nonItRow).not.toBeVisible();

  await selectRadix(page, "Responsibility", "Admin / Non-IT");
  await expect(nonItRow).toBeVisible();
  await expect(itRow).not.toBeVisible();

  // ---- Dashboard: the "My Responsibility" selector narrows every figure
  // server-side (spec §37/§67) -- confirmed here by watching the request itself
  // carry the chosen domain and resolve successfully, same proof used for the
  // Asset Register filter above via the UI's own narrowing. ----
  await page.goto("/dashboard");
  const dashboardDomainRequest = page.waitForResponse((r) => r.url().includes("/api/reports/dashboard?domain=IT") && r.ok());
  await selectRadix(page, "My Responsibility", "IT");
  await dashboardDomainRequest;
});
