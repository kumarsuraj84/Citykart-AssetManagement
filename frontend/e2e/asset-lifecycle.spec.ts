import { test, expect, type Page } from "@playwright/test";
import { seedTestCompany } from "./fixtures";

async function loginAs(page: Page, companyId: number, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Company", { exact: true }).selectOption(String(companyId));
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

// AddAssetForm/AssetDetail use shadcn's Radix-based <Select>, not a native <select> --
// Playwright's `.selectOption()` only works on real <select> elements, so every one of
// these fields is driven by opening the combobox trigger and clicking the listbox option.
async function selectRadix(page: Page, label: string, optionText: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

test("full custody journey: procure, allot, return, allot again", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await seedTestCompany(baseURL!);

  // ---- Log in as the bootstrap ADMIN and add an asset ----
  await loginAs(page, ctx.company.id, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/assets/new");
  await selectRadix(page, "Category", ctx.category.name);
  await selectRadix(page, "Sub-Category", ctx.subcategory.name);
  await page.getByLabel("Description", { exact: true }).fill("E2E Test Laptop");
  await selectRadix(page, "Cost Center", ctx.costCenter.name);
  await selectRadix(page, "Initial Holder", ctx.stock.name);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  const createdItem = page.locator("ul li", { hasText: "E2E/" }).first();
  await expect(createdItem).toBeVisible();
  const assetCode = (await createdItem.textContent())!.trim();
  expect(assetCode.startsWith("E2E/")).toBe(true);

  // ---- Asset Register: filter to this asset and verify row-click navigation ----
  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(assetCode);
  const row = page.locator("tr", { hasText: assetCode });
  await expect(row).toBeVisible();
  // Click the description cell (not the code <a> or the checkbox, both of which
  // stopPropagation on the row's own onClick) to exercise AssetRegister's row-level
  // `onClick={() => window.location.href = ...}` navigation, not the plain <a href>.
  await row.getByText("E2E Test Laptop", { exact: true }).click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  await expect(page.getByText(assetCode, { exact: true })).toBeVisible();

  // ---- Allot to the test EMPLOYEE holder ----
  await page.getByRole("button", { name: "Move / Allot", exact: true }).click();
  await selectRadix(page, "Holder", ctx.employee.name);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("ALLOTTED", { exact: true })).toBeVisible();

  // ---- Return to IT Stock ----
  await page.getByRole("button", { name: "Move / Transfer", exact: true }).click();
  await selectRadix(page, "Holder", ctx.stock.name);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("IN STOCK", { exact: true })).toBeVisible();

  // ---- Allot to the test STORE holder ----
  await page.getByRole("button", { name: "Move / Allot", exact: true }).click();
  await selectRadix(page, "Holder", ctx.store.name);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("ALLOTTED", { exact: true })).toBeVisible();

  // ---- History tab: all four steps, in order ----
  await page.getByRole("tab", { name: "History", exact: true }).click();
  const timelineItems = page.locator("ol > li");
  await expect(timelineItems).toHaveCount(4);
  await expect(timelineItems.nth(0)).toContainText("PROCURED");
  await expect(timelineItems.nth(1)).toContainText("MOVED");
  await expect(timelineItems.nth(2)).toContainText("MOVED");
  await expect(timelineItems.nth(3)).toContainText("MOVED");

  // ---- Log out, log in as the EMPLOYEE holder: no currently-held assets ----
  // (the asset's custody ended at the STORE holder, not the employee, so the
  // employee's read-only "My Assets" view -- scoped server-side to
  // current_holder_id == their own id -- must be empty of it)
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, ctx.company.id, ctx.employee.emp_code, ctx.employeePassword);
  await expect(page).toHaveURL(/\/my-assets$/);
  await expect(page.getByText(assetCode, { exact: true })).not.toBeVisible();
});
