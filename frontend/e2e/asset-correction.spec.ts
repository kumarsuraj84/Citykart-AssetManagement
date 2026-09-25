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

// AM-07's core UX journey: create a safe UAT asset, correct its Category/
// Sub-Category/Purchase Date through the dedicated correction dialog (never
// ordinary Edit mode), and confirm Asset Code, lifecycle History, and every
// other identity field are untouched while Overview/Procurement reflect the
// corrected values and Changes records the correction with its reason.
test("asset correction journey: correct classification and purchase date, Asset Code and History stay untouched", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const token = await loginAdmin(baseURL!, registry);

  // A second Category/Sub-Category to correct INTO -- registered for
  // teardown just like seedTestCompany's own masters.
  const category2 = await api<{ id: number; name: string }>(baseURL!, "POST", "/api/masters/categories", token, {
    code: `E2E2${Date.now().toString(36)}`, name: `E2E Correction Target Category ${Date.now()}`,
  });
  registry.masters.push(["categories", category2.id]);
  const subcategory2 = await api<{ id: number; name: string }>(baseURL!, "POST", "/api/masters/subcategories", token, {
    category_id: category2.id, code: "MON", name: `E2E Correction Target Subcategory ${Date.now()}`,
  });
  registry.masters.push(["subcategories", subcategory2.id]);

  // Purchase Date is derived from Invoice Date now (docs/ai/DECISIONS.md) --
  // sent as invoice_date below so the created asset's own purchase_date
  // still comes out to "2025-06-01", matching this test's later assertions
  // against the correction dialog's impact summary and Procurement tab.
  const [asset] = await api<{ id: number; asset_code: string }[]>(baseURL!, "POST", "/api/assets", token, {
    company_id: ctx.company.id, cost_center_id: ctx.costCenter.id, category_id: ctx.category.id,
    subcategory_id: ctx.subcategory.id, description: "Correction Journey Laptop",
    vendor_id: ctx.vendor.id, po_number: "E2E-PO-1", po_date: "2025-05-25",
    invoice_number: "E2E-INV-1", invoice_date: "2025-06-01",
    pi_number: "E2E-PI-1", pi_date: "2025-05-27",
    // Serial Number is mandatory + globally unique now (docs/ai/DECISIONS.md);
    // "N/A" is the reserved exempt placeholder, safe to reuse across runs.
    serial_number: "N/A",
    initial_holder_id: ctx.stock.id,
  });

  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(`/assets/${asset.id}`);
  await expect(page.getByRole("heading", { name: asset.asset_code })).toBeVisible();

  // History before correcting: exactly the initial PROCURED event.
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByText("Procured into", { exact: false })).toBeVisible();
  const historyItemsBefore = await page.locator("ol > li").count();
  expect(historyItemsBefore).toBe(1);

  await page.getByRole("button", { name: "Correct Classification", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /correct classification/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(asset.asset_code)).toBeVisible();
  await expect(dialog.getByText(/asset code will not change/i)).toBeVisible();

  await pickSelectOption(page, "Category", category2.name);
  await pickSelectOption(page, "Sub-Category", subcategory2.name);
  await page.getByLabel("Purchase Date", { exact: true }).fill("2025-05-28");
  await page.getByLabel("Reason", { exact: true }).fill("Wrong category selected during initial entry");

  await expect(dialog.getByText(/impact summary/i)).toBeVisible();
  await expect(dialog.getByText(`Category: ${ctx.category.name} → ${category2.name}`)).toBeVisible();
  await expect(dialog.getByText(`Purchase Date: 2025-06-01 → 2025-05-28`)).toBeVisible();

  await dialog.getByRole("button", { name: "Confirm Correction", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  // Asset Code unchanged -- still the same heading, no navigation happened.
  await expect(page.getByRole("heading", { name: asset.asset_code })).toBeVisible();

  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(page.getByText(category2.name, { exact: true })).toBeVisible();
  await expect(page.getByText(subcategory2.name, { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Procurement", exact: true }).click();
  await expect(page.getByText("2025-05-28", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  const changesPanel = page.getByRole("tabpanel", { name: "Changes" });
  await expect(changesPanel.getByText("Correction").first()).toBeVisible();
  await expect(changesPanel.getByText("Wrong category selected during initial entry").first()).toBeVisible();
  await expect(changesPanel.getByText("category_id", { exact: true })).toBeVisible();
  await expect(changesPanel.getByText("subcategory_id", { exact: true })).toBeVisible();
  await expect(changesPanel.getByText("purchase_date", { exact: true })).toBeVisible();

  // History unchanged: still exactly the one original PROCURED event, same text.
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByText("Procured into", { exact: false })).toBeVisible();
  const historyItemsAfter = await page.locator("ol > li").count();
  expect(historyItemsAfter).toBe(historyItemsBefore);
});
