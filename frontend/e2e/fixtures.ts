import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// frontend/e2e -> frontend -> repo root (where docker-compose.yml lives).
const REPO_ROOT = path.resolve(__dirname, "..", "..");

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
  stock: SeedHolder;
  /** A test-only EMPLOYEE holder. Deliberately NOT named/coded like the real
   * Ankur Pahwa (CS6872) account that owns company id 1 in this environment --
   * see fixtures' emp_code below, which is a distinct, timestamp-suffixed code. */
  employee: SeedHolder;
  employeePassword: string;
  store: SeedHolder;
  admin: { companyId: number; empCode: string; password: string };
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
  // real "Citykart Stores" (company id 1) or any previous E2E run's company.
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

/**
 * Seeds one fresh, uniquely-named company + masters + holders directly through the
 * real backend API (never hardcoding any id -- every id used below is one the API
 * itself just returned), authenticated as a bootstrap ADMIN created by
 * `backend/scripts/seed_admin.py`. Every run gets its own company (timestamp-suffixed
 * code), so this can never collide with the real "Citykart Stores" company (id 1 in
 * this environment) or with any other run of this suite, past or concurrent.
 */
export async function seedTestCompany(baseURL: string): Promise<SeedContext> {
  const ts = Date.now();
  // Base-36 for anything that lands in a `code` column -- several of those are
  // VARCHAR(20) (company.code, location.code, cost_center.code, asset_category.code),
  // and seed_admin.py appends "-HO" to the company code for the location it creates,
  // so the raw 13-digit decimal timestamp (used further below only in human-readable
  // *names*, which have much more headroom) would overflow that limit.
  const codeTs = ts.toString(36);
  const companyCode = `E2E-${codeTs}`;
  const adminPassword = "E2ePassw0rd!1";

  const { companyId, holderId } = runSeedAdmin(companyCode, adminPassword);

  const login = await api<{ access_token: string }>(baseURL, "POST", "/api/auth/login", undefined, {
    company_id: companyId,
    emp_code: "SEEDADMIN",
    password: adminPassword,
  });
  const token = login.access_token;

  // Reuse the location/department seed_admin.py already created for this company
  // (read back from the API, not re-derived/guessed) rather than creating a second,
  // redundant location.
  const companyHolders = await api<HolderOut[]>(baseURL, "GET", `/api/holders?company_id=${companyId}`, token);
  const seedAdminHolder = companyHolders.find((h) => h.id === holderId);
  if (!seedAdminHolder) {
    throw new Error(`SEEDADMIN holder ${holderId} not found in company ${companyId}`);
  }
  const { location_id: locationId, department_id: departmentId } = seedAdminHolder;

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
  const category = await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/categories", token, {
    code: `E2E${codeTs}`,
    name: `E2E IT ${ts}`,
  });
  const subcategory = await api<{ id: number; name: string }>(baseURL, "POST", "/api/masters/subcategories", token, {
    category_id: category.id,
    code: "LAP",
    name: `E2E Laptop ${ts}`,
  });

  // Scoped to this fresh company only (not global/company_id: null) so it can never
  // shadow, or be shadowed by, the real Citykart Stores company's own code rule, and
  // so repeated runs never stack up multiple ambiguous global rules (get_active_rule
  // picks the most company-specific match, but ties among rules at the same
  // specificity are unordered).
  await api(baseURL, "POST", "/api/code-rules", token, {
    company_id: companyId,
    prefix_template: "E2E/{cost_center.code}/{category.code}/{subcategory.code}/",
    suffix_template: "",
    start_number: 1,
    pad_width: 0,
  });

  const mkHolder = (body: object) =>
    api<HolderOut>(baseURL, "POST", "/api/holders", token, {
      company_id: companyId,
      location_id: locationId,
      department_id: departmentId,
      ...body,
    });

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
    stock,
    employee,
    employeePassword: employeeReset.temp_password,
    store,
    admin: { companyId, empCode: "SEEDADMIN", password: adminPassword },
  };
}
