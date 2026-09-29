import { test, expect, type Page } from "@playwright/test";
import { newSeedRegistry, seedTestCompany, teardownTestCompany, fillAddAssetProcurementFields, type SeedRegistry } from "./fixtures";

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function selectRadix(page: Page, label: string, optionText: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: optionText, exact: true }).click();
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

let registryA: SeedRegistry | null = null;
// Only company A gets a full seedTestCompany (its own SEEDADMIN, masters,
// asset_users) -- company B is a bare row created through company A's own
// (globally-unrestricted, per app/core/deps.py::scoped_company_ids) ADMIN
// token, existing only to give the custom field somewhere else to be scoped
// to. A second seedTestCompany would mint a second concurrently-active
// SEEDADMIN login, and /api/auth/login resolves login_id across every
// active company with no company selector (app/auth/router.py) -- two
// active SEEDADMINs at once makes company A's own browser login ambiguous.
let companyBId: number | null = null;
let customFieldId: number | null = null;

test.afterEach(async ({ baseURL }) => {
  const reg = registryA;
  registryA = null;
  const failures: string[] = [];
  if (reg && reg.companyId !== undefined) {
    try {
      const token = await loginAdmin(baseURL!, reg);
      if (customFieldId !== null) {
        await api(baseURL!, "DELETE", `/api/masters/custom-fields/${customFieldId}`, token).catch((err) =>
          failures.push(String(err)),
        );
      }
      if (companyBId !== null) {
        await api(baseURL!, "DELETE", `/api/masters/companies/${companyBId}`, token).catch((err) =>
          failures.push(String(err)),
        );
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    customFieldId = null;
    companyBId = null;
    try {
      await teardownTestCompany(baseURL!, reg);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
});

// AM-05's core new guarantee: a required Custom Field scoped to one company
// must never block asset creation for a DIFFERENT company. Company B here
// is a bare row (no asset_users/masters of its own) -- everything the test
// exercises through the browser happens as company A.
test("a required custom field scoped to company B never blocks asset creation for company A", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registryA = newSeedRegistry();
  const ctxA = await seedTestCompany(baseURL!, registryA);
  const tokenA = await loginAdmin(baseURL!, registryA);

  const ts = Date.now().toString(36);
  const companyB = await api<{ id: number; name: string }>(baseURL!, "POST", "/api/masters/companies", tokenA, {
    code: `E2EB${ts}`,
    name: `E2E Company B ${ts}`,
  });
  companyBId = companyB.id;

  const field = await api<{ id: number }>(baseURL!, "POST", "/api/masters/custom-fields", tokenA, {
    field_key: `b_required_${ts}`,
    label: "Company B Required Field",
    field_type: "text",
    is_required: true,
    company_id: companyB.id,
  });
  customFieldId = field.id;

  await loginAs(page, ctxA.admin.empCode, ctxA.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/assets/new");
  // Company B's required field must not even render on company A's form.
  await expect(page.getByText("Company B Required Field")).not.toBeVisible();

  await selectRadix(page, "Category", ctxA.category.name);
  await selectRadix(page, "Sub-Category", ctxA.subcategory.name);
  await page.getByLabel("Description", { exact: true }).fill("Multi-Company UDF Test Laptop");
  await selectRadix(page, "Cost Centre", ctxA.costCenter.name);
  await selectRadix(page, "Goes Into", ctxA.stock.name);
  await fillAddAssetProcurementFields(page, ctxA.vendor.name);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page).toHaveURL(/\/assets\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: /^E2E\// })).toBeVisible();
});
