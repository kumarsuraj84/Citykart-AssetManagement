import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend/e2e -> frontend -> repo root (where docker-compose.yml lives).
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// IMPORTANT -- where this runs: seedTestCompany writes real rows (a company, an
// ADMIN login, asset_users, masters, and -- via the spec -- an asset with ledger
// events) into whatever database the `api` service of the *current* compose
// project uses. Run Playwright against a dedicated E2E/staging stack, never a
// stack whose database might later be backed up into production. See
// docs/deployment.md, "End-to-end (Playwright) tests". teardownTestCompany below
// deactivates everything this
// fixture created, but the asset ledger is append-only by design, so the test
// asset and its events can never be removed.

export interface SeedAssetUser {
  id: number;
  code: string;
  name: string;
}

export interface SeedContext {
  company: { id: number; name: string };
  costCenter: { id: number; name: string };
  category: { id: number; name: string };
  subcategory: { id: number; name: string };
  noSerialSubcategory: { id: number; name: string };
  /** The Item Add Asset / PO lines / Bundle parts pick: it decides Category and Sub-Category. */
  item: { id: number; name: string };
  /** An Item (same Category) that carries no serial number -- a mouse / keyboard. The serial rule lives on the Item. */
  noSerialItem: { id: number; name: string };
  /** Vendor is a genuinely global master (no company_id column, like
   * Category -- AM-08). Mandatory on Add Asset now (docs/ai/DECISIONS.md),
   * so every spec driving that form needs one. */
  vendor: { id: number; name: string };
  stock: SeedAssetUser;
  /** A test-only EMPLOYEE asset_user. Deliberately NOT named/coded like the real
   * Ankur Pahwa (CS6872) account in this environment -- see fixtures' code
   * below, which is a distinct, timestamp-suffixed code. */
  employee: SeedAssetUser;
  employeePassword: string;
  store: SeedAssetUser;
  admin: { companyId: number; empCode: string; password: string };
}

/**
 * Everything seedTestCompany created, recorded *as it is created* so that
 * teardownTestCompany can clean up even after a seed that failed halfway.
 */
export interface SeedRegistry {
  companyId?: number;
  adminAssetUserId?: number;
  adminEmpCode: string;
  adminPassword: string;
  asset_userIds: number[];
  /** [masters resource, id], e.g. ["cost-centers", 12]; deactivated in reverse order. */
  masters: [string, number][];
  /** Item ids (/api/items), deactivated before the masters they sit under. */
  items: number[];
  /** The test stock room: teardown moves assets still with a person or store back here before retiring them. */
  stockRoomId?: number;
}

export function newSeedRegistry(): SeedRegistry {
  return {
    adminEmpCode: "SEEDADMIN",
    // Throwaway, per-run password: a SEEDADMIN left behind by a crashed run is
    // no longer guessable from this file (it used to be a fixed, committed value).
    adminPassword: `E2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}!`,
    asset_userIds: [],
    masters: [],
    items: [],
  };
}

interface AssetUserOut extends SeedAssetUser {
  company_id: number;
  location_id: number;
  department_id: number | null;
  role: string;
}

function runSeedAdmin(companyCode: string, password: string): { companyId: number; asset_userId: number } {
  // backend/scripts/seed_admin.py (Task 25) is idempotent and scopes its SEEDADMIN
  // lookup by company_id, not just emp_code -- see its own comment. Passing a fresh,
  // timestamp-suffixed --company-code here means this always creates a brand-new
  // company (+ location + department + SEEDADMIN asset_user) rather than reusing the
  // real "Citykart Stores" company or any previous E2E run's company.
  // `docker compose` honours COMPOSE_PROJECT_NAME from the environment, so a
  // dedicated E2E stack (see e2e/README.md) is targeted by exporting it.
  const output = execFileSync(
    "docker",
    [
      "compose", "exec", "-T", "api",
      "python", "-m", "scripts.seed_admin",
      "--company-code", companyCode,
      "--password", password,
    ],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  const match = output.match(/company_id=(\d+)\s+asset_user_id=(\d+)/);
  if (!match) {
    throw new Error(`Could not parse seed_admin.py output:\n${output}`);
  }
  return { companyId: Number(match[1]), asset_userId: Number(match[2]) };
}

export async function api<T>(
  baseURL: string,
  method: string,
  urlPath: string,
  token: string | undefined,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseURL}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function loginAdmin(baseURL: string, reg: SeedRegistry): Promise<string> {
  const login = await api<{ access_token: string }>(baseURL, "POST", "/api/auth/login", undefined, {
    company_id: reg.companyId,
    login_id: reg.adminEmpCode,
    password: reg.adminPassword,
  });
  return login.access_token;
}

/**
 * Seeds one fresh, uniquely-named company + masters + asset_users directly through the
 * real backend API (never hardcoding any id -- every id used below is one the API
 * itself just returned), authenticated as a bootstrap ADMIN created by
 * `backend/scripts/seed_admin.py`. Every run gets its own company (timestamp-suffixed
 * code), so this can never collide with the real "Citykart Stores" company or with
 * any other run of this suite, past or concurrent. Every created row is recorded in
 * `reg` for teardownTestCompany.
 */
export async function seedTestCompany(baseURL: string, reg: SeedRegistry): Promise<SeedContext> {
  const ts = Date.now();
  // Base-36 for anything that lands in a `code` column -- several of those are
  // VARCHAR(20) (company.code, location.code, cost_center.code, asset_category.code),
  // and seed_admin.py appends "-HO" to the company code for the location it creates,
  // so the raw 13-digit decimal timestamp (used further below only in human-readable
  // *names*, which have much more headroom) would overflow that limit.
  const codeTs = ts.toString(36);
  const companyCode = `E2E-${codeTs}`;

  const { companyId, asset_userId } = runSeedAdmin(companyCode, reg.adminPassword);
  reg.companyId = companyId;
  reg.adminAssetUserId = asset_userId;

  const token = await loginAdmin(baseURL, reg);

  // Reuse the location/department seed_admin.py already created for this company
  // (read back from the API, not re-derived/guessed) rather than creating a second,
  // redundant location.
  const companyAssetUsers = await api<AssetUserOut[]>(baseURL, "GET", `/api/asset-users?company_id=${companyId}`, token);
  const seedAdminAssetUser = companyAssetUsers.find((h) => h.id === asset_userId);
  if (!seedAdminAssetUser) {
    throw new Error(`SEEDADMIN asset_user ${asset_userId} not found in company ${companyId}`);
  }
  const { location_id: locationId, department_id: departmentId } = seedAdminAssetUser;
  reg.masters.push(["locations", locationId]);
  if (departmentId !== null) reg.masters.push(["departments", departmentId]);

  // Read the company's real display name back from the API (the public /auth/companies
  // list the login screen itself uses) rather than guessing what seed_admin.py named it.
  const publicCompanies = await api<{ id: number; name: string }[]>(baseURL, "GET", "/api/auth/companies", undefined);
  const companyRecord = publicCompanies.find((c) => c.id === companyId);
  if (!companyRecord) {
    throw new Error(`Company ${companyId} not found in /api/auth/companies`);
  }

  // Category code/name are GLOBAL in this schema (no company scoping), so every
  // label the spec will click on in a <Select> is timestamp-suffixed to guarantee
  // it can never collide with the real company's masters or a previous/concurrent
  // E2E run's leftover rows.
  const costCenter = await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/cost-centers", token, {
    company_id: companyId,
    code: `HO${codeTs}`,
    name: `E2E HO ${ts}`,
  });
  reg.masters.push(["cost-centers", costCenter.id]);
  const category = await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/categories", token, {
    code: `E2E${codeTs}`,
    name: `E2E IT ${ts}`,
    asset_domain: "IT",
  });
  reg.masters.push(["categories", category.id]);
  const subcategory = await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/subcategories", token, {
    category_id: category.id,
    code: "LAP",
    name: `E2E Laptop ${ts}`,
  });
  reg.masters.push(["subcategories", subcategory.id]);
  const noSerialSubcategory = await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/subcategories", token, {
    category_id: category.id,
    code: "MSE",
    name: `E2E Mouse ${ts}`,
  });
  reg.masters.push(["subcategories", noSerialSubcategory.id]);
  // Items: what people actually pick. The serial rule lives here, not on the sub-category.
  const item = await api<{ id: number; name: string }>(baseURL, "POST", "/api/items", token, {
    name: `E2E Laptop Item ${ts}`, category_id: category.id, subcategory_id: subcategory.id, serial_required: true,
  });
  reg.items.push(item.id);
  const noSerialItem = await api<{ id: number; name: string }>(baseURL, "POST", "/api/items", token, {
    name: `E2E Mouse Item ${ts}`, category_id: category.id, subcategory_id: noSerialSubcategory.id, serial_required: false,
  });
  reg.items.push(noSerialItem.id);
  const vendor =await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/vendors", token, {
    code: `E2EV${codeTs}`,
    name: `E2E Vendor ${ts}`,
  });
  reg.masters.push(["vendors", vendor.id]);

  // Scoped to this fresh company only (not global/company_id: null) so it can never
  // shadow, or be shadowed by, the real Citykart Stores company's own code rule.
  // Saving it deactivates nothing outside this company's own scope.
  await api(baseURL, "POST", "/api/code-rules", token, {
    company_id: companyId,
    prefix_template: "E2E/{cost_center.code}/{category.code}/{subcategory.code}/",
    suffix_template: "",
    start_number: 1,
    pad_width: 0,
  });

  const mkAssetUser = async (body: object) => {
    const asset_user = await api<AssetUserOut>(baseURL, "POST", "/api/asset-users", token, {
      company_id: companyId,
      location_id: locationId,
      department_id: departmentId,
      ...body,
    });
    reg.asset_userIds.push(asset_user.id);
    return asset_user;
  };

  const stock = await mkAssetUser({
    code: `STK${ts}`,
    name: `E2E IT Stock ${ts}`,
    asset_user_type: "STOCK_POINT",
    role: "SELF_SERVICE",
  });
  reg.stockRoomId = stock.id;
  const employee = await mkAssetUser({
    code: `EMP${ts}`,
    name: `E2E Test Employee ${ts}`,
    asset_user_type: "EMPLOYEE",
    role: "SELF_SERVICE",
    login_enabled: true,
  });
  const store = await mkAssetUser({
    code: `STR${ts}`,
    name: `E2E Test Store ${ts}`,
    asset_user_type: "STORE",
    role: "SELF_SERVICE",
  });

  const employeeReset = await api<{ temp_password: string }>(
    baseURL, "POST", `/api/asset-users/${employee.id}/reset-password`, token,
  );

  return {
    company: { id: companyId, name: companyRecord.name },
    costCenter,
    category,
    subcategory,
    noSerialSubcategory,
    item,
    noSerialItem,
    vendor,
    stock,
    employee,
    employeePassword: employeeReset.temp_password,
    store,
    admin: { companyId, empCode: reg.adminEmpCode, password: reg.adminPassword },
  };
}

interface AssetRow {
  id: number;
  status: string;
}

/**
 * S0: a person or place that still holds assets cannot be deactivated
 * ("… still holds 1 asset. Move them … first"). Disposed, sold, scrapped and
 * lost assets do not count. So before the holders are deactivated, every asset
 * of the test company is retired through the product's own legal moves (the
 * ledger stays append-only; apply_event writes every step):
 *   with a person / store / install point -> moved back to the test stock room,
 *   in stock -> disposed of, under repair -> scrapped. Lost / terminal: nothing.
 */
async function retireCompanyAssets(baseURL: string, token: string, reg: SeedRegistry, failures: string[]): Promise<void> {
  const rows: AssetRow[] = [];
  try {
    for (let offset = 0; ; offset += 200) {
      const page = await api<{ items: AssetRow[]; total: number }>(
        baseURL, "GET", `/api/assets?company_id=${reg.companyId}&limit=200&offset=${offset}`, token,
      );
      rows.push(...page.items);
      if (page.items.length < 200 || rows.length >= page.total) break;
    }
  } catch (err) {
    failures.push(`list assets: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const ids = (statuses: string[]) => rows.filter((a) => statuses.includes(a.status)).map((a) => a.id);
  const act = async (assetIds: number[], body: object) => {
    for (let i = 0; i < assetIds.length; i += 1000) {
      const chunk = assetIds.slice(i, i + 1000);
      try {
        const res = await api<{ done: number; failed: { asset_id: number; reason: string }[] }>(
          baseURL, "POST", "/api/assets/bulk-action", token, { asset_ids: chunk, remarks: "E2E teardown", ...body },
        );
        for (const f of res.failed) failures.push(`asset ${f.asset_id}: ${f.reason}`);
      } catch (err) {
        failures.push(`bulk-action ${JSON.stringify(body)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  const held = ids(["ALLOTTED", "INSTALLED"]);
  if (held.length > 0) {
    if (reg.stockRoomId === undefined) failures.push(`${held.length} asset(s) are held but no test stock room is known`);
    else await act(held, { event_type: "MOVED", to_asset_user_id: reg.stockRoomId });
  }
  await act(ids(["UNDER_REPAIR"]), { event_type: "SCRAPPED" });
  await act([...ids(["IN_STOCK"]), ...held], { event_type: "DISPOSED" });
}

/**
 * Deactivates (is_active = false -- this app never hard-deletes) everything
 * seedTestCompany recorded in `reg`, through the app's own ADMIN endpoints, in
 * the order the server's own rules require (S0 / S6):
 *   1. the company's assets are retired (a holder of assets cannot be deactivated),
 *   2. the test asset_users,
 *   3. every active Item under a registered Category -- also Items a spec made
 *      through the UI -- (a Sub-category with active Items cannot be deactivated),
 *   4. every active Sub-category under a registered Category (a Category with
 *      active Sub-categories cannot be deactivated),
 *   5. the remaining masters in reverse creation order, the company, and finally
 *      the SEEDADMIN login itself (last, since its token performs every step).
 * Best-effort: every step is attempted even if an earlier one fails, then any
 * failures are thrown together so a broken teardown is loud, not silent.
 */
export async function teardownTestCompany(baseURL: string, reg: SeedRegistry): Promise<void> {
  if (reg.companyId === undefined || reg.adminAssetUserId === undefined) return; // nothing was created

  const token = await loginAdmin(baseURL, reg);
  const failures: string[] = [];
  const attempt = async (label: string, urlPath: string) => {
    try {
      await api(baseURL, "DELETE", urlPath, token);
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await retireCompanyAssets(baseURL, token, reg, failures);
  for (const id of reg.asset_userIds) await attempt(`asset_user ${id}`, `/api/asset-users/${id}`);

  const categoryIds = new Set(reg.masters.filter(([r]) => r === "categories").map(([, id]) => id));
  const itemIds = new Set(reg.items);
  const subcategoryIds = new Set<number>();
  // Sets (bundles) a spec made from this run's Items -- e.g. a spec that failed before
  // its own "deactivate the bundle" step -- so they never linger in later runs' lists.
  try {
    const bundles = await api<{ id: number; is_active: boolean; parts: { category_id: number }[] }[]>(baseURL, "GET", "/api/bundles", token);
    for (const b of bundles) {
      if (b.is_active && b.parts.some((p) => categoryIds.has(p.category_id))) await attempt(`bundle ${b.id}`, `/api/bundles/${b.id}`);
    }
  } catch (err) {
    failures.push(`list bundles: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const items = await api<{ id: number; category_id: number; is_active?: boolean }[]>(baseURL, "GET", "/api/items", token);
    for (const it of items) if (it.is_active !== false && categoryIds.has(it.category_id)) itemIds.add(it.id);
    const subs = await api<{ id: number; category_id: number; is_active?: boolean }[]>(baseURL, "GET", "/api/masters/subcategories", token);
    for (const s of subs) if (s.is_active !== false && categoryIds.has(s.category_id)) subcategoryIds.add(s.id);
  } catch (err) {
    failures.push(`list items / sub-categories: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const id of [...itemIds].reverse()) await attempt(`item ${id}`, `/api/items/${id}`);
  for (const id of subcategoryIds) await attempt(`subcategories ${id}`, `/api/masters/subcategories/${id}`);
  for (const [resource, id] of [...reg.masters].reverse()) {
    if (resource === "subcategories" && subcategoryIds.has(id)) continue; // done above
    await attempt(`${resource} ${id}`, `/api/masters/${resource}/${id}`);
  }
  await attempt(`company ${reg.companyId}`, `/api/masters/companies/${reg.companyId}`);
  await attempt(`SEEDADMIN asset_user ${reg.adminAssetUserId}`, `/api/asset-users/${reg.adminAssetUserId}`);

  if (failures.length > 0) {
    throw new Error(`E2E teardown could not deactivate everything it created:\n  ${failures.join("\n  ")}`);
  }
}

export interface TestLogin {
  id: number;
  code: string;
  password: string;
  token: string;
}

/**
 * A genuinely ordinary login (never scripts.seed_admin's head-office bootstrap):
 * created the way a real admin creates one (Asset User + reset password), its
 * forced first password change done through the API, then logged in. Registered
 * for teardown. `allowed_asset_domains` "IT" / "NON_IT" limits it to one work area.
 */
export async function createTestLogin(
  baseURL: string, ownerToken: string, reg: SeedRegistry, ctx: SeedContext,
  opts: { code: string; name: string; role: "ADMIN" | "OPERATOR" | "VIEWER"; allowed_asset_domains?: "IT" | "NON_IT" },
): Promise<TestLogin> {
  const companyAssetUsers = await api<AssetUserOut[]>(baseURL, "GET", `/api/asset-users?company_id=${ctx.company.id}`, ownerToken);
  const stock = companyAssetUsers.find((h) => h.id === ctx.stock.id);
  if (!stock) throw new Error(`stock room ${ctx.stock.id} not found`);
  const created = await api<{ id: number }>(baseURL, "POST", "/api/asset-users", ownerToken, {
    company_id: ctx.company.id,
    location_id: stock.location_id,
    code: opts.code,
    name: opts.name,
    asset_user_type: "EMPLOYEE",
    role: opts.role,
    login_enabled: true,
    ...(opts.allowed_asset_domains ? { allowed_asset_domains: opts.allowed_asset_domains } : {}),
  });
  reg.asset_userIds.push(created.id);
  const reset = await api<{ temp_password: string }>(baseURL, "POST", `/api/asset-users/${created.id}/reset-password`, ownerToken);
  const password = `E2e-${opts.role}-${Date.now().toString(36)}!`;
  const first = await api<{ access_token: string }>(baseURL, "POST", "/api/auth/login", undefined, {
    company_id: ctx.company.id, login_id: opts.code, password: reset.temp_password,
  });
  await api(baseURL, "POST", "/api/auth/change-password", first.access_token, {
    old_password: reset.temp_password, new_password: password,
  });
  const login = await api<{ access_token: string }>(baseURL, "POST", "/api/auth/login", undefined, {
    company_id: ctx.company.id, login_id: opts.code, password,
  });
  return { id: created.id, code: opts.code, password, token: login.access_token };
}

/**
 * Dropdown options show context since S1 ("CODE · Name · Place · Company",
 * "Laptop · IT Fixed Assets", "Acme · GSTIN"), so an option is matched by one
 * whole " · "-separated part of its text instead of the exact full text.
 */
export function optionMatcher(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|· )${escaped}( ·|$)`);
}

/**
 * Opens a picker (SearchableSelect / Select trigger), clicks the option and waits
 * until the list has closed. A closing list stays on the page for its short
 * closing animation, so opening the NEXT picker of the same list (two PO lines,
 * two set parts) at once would show every option twice and make the pick ambiguous.
 */
export async function pick(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  const name = typeof option === "string" ? optionMatcher(option) : option;
  await page.getByRole("option", { name }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

/**
 * S5b-1 Add Assets (one batch form): after the Item, Cost Centre and Received
 * Into are picked, fills one serial number (for an Item that has serials and a
 * quantity of 1), opens the folded "Purchase details" (vendor, PO No + Date,
 * invoice No + Date) and the folded "Advanced" (description, barcode). The PI
 * is recorded later (Asset 360 / Record PI), never on Add Assets.
 *
 * Serial numbers are unique across every asset ever created in the database
 * this suite runs against, and teardown never deletes assets, so the serial is
 * timestamp-suffixed.
 */
export async function fillAddAssetProcurementFields(page: Page, vendorName: string, description?: string): Promise<void> {
  const ts = Date.now().toString(36);
  // Only an Item with serial numbers shows the serial box.
  const serials = page.getByLabel("Serial numbers", { exact: true });
  if (await serials.count()) await serials.fill(`E2E-SN-${ts}`);
  await page.getByRole("button", { name: /Purchase details/ }).click();
  await page.getByLabel("Vendor", { exact: true }).click();
  await page.getByRole("option", { name: optionMatcher(vendorName) }).click();
  await page.getByLabel("PO No", { exact: true }).fill("E2E-PO-1");
  await page.getByLabel("PO Date", { exact: true }).fill("2025-06-01");
  await page.getByLabel("Invoice No", { exact: true }).fill("E2E-INV-1");
  await page.getByLabel("Invoice Date", { exact: true }).fill("2025-06-02");
  await page.getByRole("button", { name: /Advanced/ }).click();
  if (description) await page.getByLabel("Description", { exact: true }).fill(description);
  await page.getByLabel("Barcode", { exact: true }).fill(`E2E-BC-${ts}`);
}

/**
 * Presses "Add 1 asset" (or "Add N assets"), waits for the result panel and
 * opens the first new asset's Asset 360 from its code link. Returns the code.
 */
export async function addAssetsAndOpenFirst(page: Page, count = 1): Promise<string> {
  await page.getByRole("button", { name: `Add ${count} asset${count === 1 ? "" : "s"}`, exact: true }).click();
  const panel = page.getByRole("region", { name: "Added" });
  await panel.getByText(`${count} asset${count === 1 ? "" : "s"} created`, { exact: true }).waitFor();
  const first = panel.getByRole("list", { name: "New asset codes" }).getByRole("link").first();
  const code = (await first.textContent())!.trim();
  await first.click();
  return code;
}
