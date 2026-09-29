import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function api<T>(baseURL: string, method: string, urlPath: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseURL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status}: ${await res.text().catch(() => "")}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function loginAdmin(baseURL: string, reg: SeedRegistry): Promise<string> {
  const res = await fetch(`${baseURL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: reg.companyId, login_id: reg.adminEmpCode, password: reg.adminPassword }),
  });
  if (!res.ok) throw new Error(`login -> ${res.status}: ${await res.text().catch(() => "")}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

async function codeOf(baseURL: string, token: string, resource: string, id: number): Promise<string> {
  const rows = await api<{ id: number; code: string }[]>(baseURL, "GET", `/api/masters/${resource}`, token);
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`${resource} id ${id} not found`);
  return row.code;
}

/** Builds a one-row Excel fixture through the real backend column contract
 * (app/imports/asset_import_service.py::TEMPLATE_COLUMNS), via
 * backend/scripts/build_e2e_import_fixture.py -- the same "shell out to a
 * real backend script" pattern fixtures.ts::runSeedAdmin already
 * established, rather than adding an xlsx-writing dependency to the
 * frontend just for this one test. */
function buildFixture(args: Record<string, string>): Buffer {
  const flags = Object.entries(args).flatMap(([k, v]) => [`--${k}`, v]);
  const base64 = execFileSync(
    "docker", ["compose", "exec", "-T", "api", "python", "-m", "scripts.build_e2e_import_fixture", ...flags],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  ).trim();
  return Buffer.from(base64, "base64");
}

let registry: SeedRegistry | null = null;

test.afterEach(async ({ baseURL }) => {
  if (registry) {
    const reg = registry;
    registry = null;
    await teardownTestCompany(baseURL!, reg);
  }
});

test("import journey: fixture file -> preview -> commit -> find the asset -> PI Number and a company-scoped custom field show on Asset 360", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const token = await loginAdmin(baseURL!, registry);

  const companyCode = await codeOf(baseURL!, token, "companies", ctx.company.id);
  const costCentreCode = await codeOf(baseURL!, token, "cost-centers", ctx.costCenter.id);
  const categoryCode = await codeOf(baseURL!, token, "categories", ctx.category.id);
  // AM-23: Subcategory Code (and Vendor Code, Serial Number) are mandatory
  // columns now, matching Add Asset's own contract.
  const subcategoryCode = await codeOf(baseURL!, token, "subcategories", ctx.subcategory.id);
  const vendorCode = await codeOf(baseURL!, token, "vendors", ctx.vendor.id);

  const fieldKey = `e2e_warranty_${Date.now()}`;
  await api(baseURL!, "POST", "/api/masters/custom-fields", token, {
    field_key: fieldKey, label: "E2E Warranty Card", field_type: "text", company_id: ctx.company.id,
  });

  const legacyCode = `E2E-IMPORT-${Date.now()}`;
  const fixture = buildFixture({
    "company-code": companyCode,
    "cost-centre-code": costCentreCode,
    "category-code": categoryCode,
    "subcategory-code": subcategoryCode,
    "description": "E2E Import Journey Laptop",
    "legacy-asset-code": legacyCode,
    "invoice-date": "2025-06-01",
    "pi-number": "PI-E2E-IMPORT",
    "vendor-code": vendorCode,
    "initial-asset_user-code": ctx.stock.emp_code,
    "custom-field-key": fieldKey,
    "custom-field-value": "WARR-E2E-9",
  });

  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/import");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "import.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fixture,
  });
  await page.getByRole("button", { name: "Preview", exact: true }).click();

  await expect(page.getByText("1 row ready to import")).toBeVisible();
  await expect(page.getByText("0 rows with errors")).toBeVisible();

  await page.getByRole("button", { name: /^Commit/ }).click();
  await expect(page.getByText("Imported 1 asset.")).toBeVisible();

  // Find the created asset through the real Asset Register search, the same
  // way an operator would -- the Import screen itself never shows the
  // server-generated Asset Code. The Register's own columns don't display
  // Legacy Code, so the row is located by the (also-unique) description the
  // search itself narrowed down to, not by the search term.
  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(legacyCode);
  const descriptionCell = page.getByText("E2E Import Journey Laptop", { exact: true });
  await expect(descriptionCell).toBeVisible();
  await descriptionCell.click();

  await expect(page).toHaveURL(/\/assets\/\d+$/);
  await page.getByRole("tab", { name: "Procurement", exact: true }).click();
  await expect(page.getByText("PI-E2E-IMPORT")).toBeVisible();

  await page.getByRole("tab", { name: "Custom Fields", exact: true }).click();
  await expect(page.getByText("WARR-E2E-9")).toBeVisible();
});
