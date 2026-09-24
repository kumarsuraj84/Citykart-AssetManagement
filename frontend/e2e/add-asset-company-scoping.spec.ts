import { test, expect, type Page } from "@playwright/test";
import { newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function pickSelectOption(page: Page, label: string, optionText: string) {
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

let registry: SeedRegistry | null = null;

test.afterEach(async ({ baseURL }) => {
  if (registry) {
    const reg = registry;
    registry = null;
    await teardownTestCompany(baseURL!, reg);
  }
});

// AM-08 Bug 1's core regression journey: Add Asset's Cost Centre options must
// be scoped to the logged-in ADMIN's own company -- a second company's cost
// centre (created purely to prove the boundary) must never appear as an
// option, and creating a real asset through the correctly-scoped form must
// still work end to end.
test("Add Asset offers only this company's own Cost Centres, and asset creation still succeeds", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const token = await loginAdmin(baseURL!, registry);

  // A second, unrelated company -- created purely to prove Company A's Add
  // Asset never lists it. Registered for teardown like seedTestCompany's own
  // masters.
  const companyB = await api<{ id: number; name: string }>(baseURL!, "POST", "/api/masters/companies", token, {
    code: `E2EB${Date.now().toString(36)}`, name: `E2E Other Company ${Date.now()}`,
  });
  registry.masters.push(["companies", companyB.id]);
  const costCenterB = await api<{ id: number; name: string }>(baseURL!, "POST", "/api/masters/cost-centers", token, {
    company_id: companyB.id, code: `OB${Date.now().toString(36)}`, name: `E2E Other Company Cost Centre ${Date.now()}`,
  });
  registry.masters.push(["cost-centers", costCenterB.id]);

  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/assets/new");
  await page.getByLabel("Cost Centre", { exact: true }).click();

  await expect(page.getByRole("option", { name: ctx.costCenter.name, exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: costCenterB.name, exact: true })).not.toBeVisible();
  await page.getByRole("option", { name: ctx.costCenter.name, exact: true }).click();

  await page.getByLabel("Description", { exact: true }).fill("AM08 Company-Scoped Cost Centre Test Laptop");
  await pickSelectOption(page, "Category", ctx.category.name);
  await pickSelectOption(page, "Sub-Category", ctx.subcategory.name);
  await pickSelectOption(page, "Goes Into", ctx.stock.name);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  await expect(page.getByRole("tabpanel", { name: "Overview" }).getByText("AM08 Company-Scoped Cost Centre Test Laptop")).toBeVisible();
});
