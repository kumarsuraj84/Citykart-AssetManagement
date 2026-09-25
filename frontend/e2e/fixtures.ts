import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend/e2e -> frontend -> repo root (where docker-compose.yml lives).
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// IMPORTANT -- where this runs: seedTestCompany writes real rows (a company, an
// ADMIN login, holders, masters, and -- via the spec -- an asset with ledger
// events) into whatever database the `api` service of the *current* compose
// project uses. Run Playwright against a dedicated E2E/staging stack, never a
// stack whose database might later be backed up into production. See
// docs/deployment.md, "End-to-end (Playwright) tests". teardownTestCompany below
// deactivates everything this
// fixture created, but the asset ledger is append-only by design, so the test
// asset and its events can never be removed.

export interface SeedHolder {
  id: number;
  emp_code: string;
  name: string;
}

export interface SeedContext {
  company: { id: number; name: string };
  costCenter: { id: number; name: string };
  category: { id: number; name: string };
  subcategory: { id: number; name: string };
  /** Vendor is a genuinely global master (no company_id column, like
   * Category -- AM-08). Mandatory on Add Asset now (docs/ai/DECISIONS.md),
   * so every spec driving that form needs one. */
  vendor: { id: number; name: string };
  stock: SeedHolder;
  /** A test-only EMPLOYEE holder. Deliberately NOT named/coded like the real
   * Ankur Pahwa (CS6872) account in this environment -- see fixtures' emp_code
   * below, which is a distinct, timestamp-suffixed code. */
  employee: SeedHolder;
  employeePassword: string;
  store: SeedHolder;
  admin: { companyId: number; empCode: string; password: string };
}

/**
 * Everything seedTestCompany created, recorded *as it is created* so that
 * teardownTestCompany can clean up even after a seed that failed halfway.
 */
export interface SeedRegistry {
  companyId?: number;
  adminHolderId?: number;
  adminEmpCode: string;
  adminPassword: string;
  holderIds: number[];
  /** [masters resource, id], e.g. ["cost-centers", 12]; deactivated in reverse order. */
  masters: [string, number][];
}

export function newSeedRegistry(): SeedRegistry {
  return {
    adminEmpCode: "SEEDADMIN",
    // Throwaway, per-run password: a SEEDADMIN left behind by a crashed run is
    // no longer guessable from this file (it used to be a fixed, committed value).
    adminPassword: `E2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}!`,
    holderIds: [],
    masters: [],
  };
}

interface HolderOut extends SeedHolder {
  company_id: number;
  location_id: number;
  department_id: number | null;
  role: string;
}

function runSeedAdmin(companyCode: string, password: string): { companyId: number; holderId: number } {
  // backend/scripts/seed_admin.py (Task 25) is idempotent and scopes its SEEDADMIN
  // lookup by company_id, not just emp_code -- see its own comment. Passing a fresh,
  // timestamp-suffixed --company-code here means this always creates a brand-new
  // company (+ location + department + SEEDADMIN holder) rather than reusing the
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
  const match = output.match(/company_id=(\d+)\s+holder_id=(\d+)/);
  if (!match) {
    throw new Error(`Could not parse seed_admin.py output:\n${output}`);
  }
  return { companyId: Number(match[1]), holderId: Number(match[2]) };
}

async function api<T>(
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

async function loginAdmin(baseURL: string, reg: SeedRegistry): Promise<string> {
  const login = await api<{ access_token: string }>(baseURL, "POST", "/api/auth/login", undefined, {
    company_id: reg.companyId,
    login_id: reg.adminEmpCode,
    password: reg.adminPassword,
  });
  return login.access_token;
}

/**
 * Seeds one fresh, uniquely-named company + masters + holders directly through the
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

  const { companyId, holderId } = runSeedAdmin(companyCode, reg.adminPassword);
  reg.companyId = companyId;
  reg.adminHolderId = holderId;

  const token = await loginAdmin(baseURL, reg);

  // Reuse the location/department seed_admin.py already created for this company
  // (read back from the API, not re-derived/guessed) rather than creating a second,
  // redundant location.
  const companyHolders = await api<HolderOut[]>(baseURL, "GET", `/api/holders?company_id=${companyId}`, token);
  const seedAdminHolder = companyHolders.find((h) => h.id === holderId);
  if (!seedAdminHolder) {
    throw new Error(`SEEDADMIN holder ${holderId} not found in company ${companyId}`);
  }
  const { location_id: locationId, department_id: departmentId } = seedAdminHolder;
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
  });
  reg.masters.push(["categories", category.id]);
  const subcategory = await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/subcategories", token, {
    category_id: category.id,
    code: "LAP",
    name: `E2E Laptop ${ts}`,
  });
  reg.masters.push(["subcategories", subcategory.id]);
  const vendor = await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/vendors", token, {
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

  const mkHolder = async (body: object) => {
    const holder = await api<HolderOut>(baseURL, "POST", "/api/holders", token, {
      company_id: companyId,
      location_id: locationId,
      department_id: departmentId,
      ...body,
    });
    reg.holderIds.push(holder.id);
    return holder;
  };

  const stock = await mkHolder({
    emp_code: `STK${ts}`,
    name: `E2E IT Stock ${ts}`,
    holder_type: "IT_STOCK",
    role: "HOLDER",
  });
  const employee = await mkHolder({
    emp_code: `EMP${ts}`,
    name: `E2E Test Employee ${ts}`,
    holder_type: "EMPLOYEE",
    role: "HOLDER",
  });
  const store = await mkHolder({
    emp_code: `STR${ts}`,
    name: `E2E Test Store ${ts}`,
    holder_type: "STORE",
    role: "HOLDER",
  });

  const employeeReset = await api<{ temp_password: string }>(
    baseURL, "POST", `/api/holders/${employee.id}/reset-password`, token,
  );

  return {
    company: { id: companyId, name: companyRecord.name },
    costCenter,
    category,
    subcategory,
    vendor,
    stock,
    employee,
    employeePassword: employeeReset.temp_password,
    store,
    admin: { companyId, empCode: reg.adminEmpCode, password: reg.adminPassword },
  };
}

/**
 * Deactivates (is_active = false -- this app never hard-deletes) everything
 * seedTestCompany recorded in `reg`, through the app's own ADMIN endpoints:
 * the test holders, the masters, the company, and finally the SEEDADMIN login
 * itself (last, since its token performs every step before it). Best-effort:
 * every step is attempted even if an earlier one fails, then any failures are
 * thrown together so a broken teardown is loud, not silent.
 */
export async function teardownTestCompany(baseURL: string, reg: SeedRegistry): Promise<void> {
  if (reg.companyId === undefined || reg.adminHolderId === undefined) return; // nothing was created

  const token = await loginAdmin(baseURL, reg);
  const failures: string[] = [];
  const attempt = async (label: string, urlPath: string) => {
    try {
      await api(baseURL, "DELETE", urlPath, token);
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  for (const id of reg.holderIds) await attempt(`holder ${id}`, `/api/holders/${id}`);
  for (const [resource, id] of [...reg.masters].reverse()) {
    await attempt(`${resource} ${id}`, `/api/masters/${resource}/${id}`);
  }
  await attempt(`company ${reg.companyId}`, `/api/masters/companies/${reg.companyId}`);
  await attempt(`SEEDADMIN holder ${reg.adminHolderId}`, `/api/holders/${reg.adminHolderId}`);

  if (failures.length > 0) {
    throw new Error(`E2E teardown could not deactivate everything it created:\n  ${failures.join("\n  ")}`);
  }
}

/**
 * Fills the Add Asset form's mandatory procurement fields other than
 * Category/Sub-Category/Cost Centre/Description/Goes Into, which each spec
 * already picks in its own way (docs/ai/DECISIONS.md -- Vendor/PO No+Date/
 * Invoice No+Date/PI No+Date/Serial Number are all mandatory now, and
 * Purchase Date is no longer a field at all, since it's auto-derived from
 * Invoice Date). Call this after navigating to /assets/new and before
 * clicking Save.
 *
 * Serial Number is now globally unique across every asset ever created in
 * whatever database this suite runs against (docs/ai/DECISIONS.md) -- teardown
 * deactivates the company/masters/holders a spec creates but never the asset
 * itself (assets are never deleted, by design), so a literal serial would
 * collide with a previous run's leftover asset. Timestamp-suffixed, same
 * collision-avoidance convention this file already uses for company/category
 * codes.
 */
export async function fillAddAssetProcurementFields(page: Page, vendorName: string): Promise<void> {
  const ts = Date.now().toString(36);
  await page.getByLabel("Vendor", { exact: true }).click();
  await page.getByRole("option", { name: vendorName, exact: true }).click();
  await page.getByLabel("PO Number", { exact: true }).fill("E2E-PO-1");
  await page.getByLabel("PO Date", { exact: true }).fill("2025-06-01");
  await page.getByLabel("Invoice Number", { exact: true }).fill("E2E-INV-1");
  await page.getByLabel("Invoice Date", { exact: true }).fill("2025-06-02");
  await page.getByLabel("PI Number", { exact: true }).fill("E2E-PI-1");
  await page.getByLabel("PI Date", { exact: true }).fill("2025-06-03");
  await page.getByLabel("Serial Number", { exact: true }).fill(`E2E-SN-${ts}`);
}
