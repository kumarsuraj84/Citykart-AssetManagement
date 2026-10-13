import { test, expect, type Page } from "@playwright/test";
import { api, loginAdmin, newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

// "Create it right here": the head-office admin adding an Item whose type of asset
// (Asset Group › Sub-category) does not exist yet makes both from the Item form's
// "New type…" (no trip to Settings › Catalogue › Asset Groups and back), and the
// Item lands under them.

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

let registry: SeedRegistry | null = null;

test.afterEach(async ({ baseURL }) => {
  if (registry) {
    const reg = registry;
    registry = null;
    await teardownTestCompany(baseURL!, reg);
  }
});

test("a new Item brings its own new Category and Sub-Category with it, all from the Item form", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const ts = Date.now().toString(36);
  const categoryName = `E2E Admin Fixed Assets ${ts}`;
  const subName = `E2E Fan ${ts}`;
  const itemName = `E2E Ceiling Fan ${ts}`;

  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings/catalogue/items");
  await page.getByRole("button", { name: "New Item", exact: true }).click();
  const itemDialog = page.getByRole("dialog", { name: "New Item" });
  await itemDialog.locator("#item-name").fill(itemName);

  // ---- no type of asset yet: "New type…" makes the Sub-category ----
  await itemDialog.locator("#item-type").click();
  await page.getByRole("option", { name: "New type…" }).click();
  const subDialog = page.getByRole("dialog", { name: "New Sub-category" });

  // ---- and, from there, its group (Category) ----
  await subDialog.locator("#qc-category_id").click();
  await page.getByRole("option", { name: "New Category…" }).click();
  const categoryDialog = page.getByRole("dialog", { name: "New Category" });
  await categoryDialog.locator("#qc-cat-name").fill(categoryName);
  await categoryDialog.locator("#qc-cat-code").fill(`E2EC${ts}`);
  await categoryDialog.locator("#qc-cat-asset_domain").click();
  await page.getByRole("option", { name: "Admin / Non-IT Team", exact: true }).click();
  await categoryDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(subDialog.locator("#qc-category_id")).toHaveText(categoryName);       // picked for us

  await subDialog.locator("#qc-name").fill(subName);
  await subDialog.locator("#qc-code").fill(`E2ES${ts}`);
  await subDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(itemDialog.locator("#item-type")).toContainText(`${categoryName} › ${subName}`);

  await itemDialog.getByRole("button", { name: "Save", exact: true }).click();
  const row = page.getByRole("row", { name: new RegExp(itemName) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`${categoryName} › ${subName}`);

  // Clean up what this run made (the seeded company's own rows are removed by teardown).
  const token = await loginAdmin(baseURL!, registry!);
  const cats = await api<{ id: number; name: string }[]>(baseURL!, "GET", "/api/masters/categories", token);
  const subs = await api<{ id: number; name: string }[]>(baseURL!, "GET", "/api/masters/subcategories", token);
  const items = await api<{ id: number; name: string }[]>(baseURL!, "GET", "/api/items", token);
  const cat = cats.find((c) => c.name === categoryName);
  const sub = subs.find((s) => s.name === subName);
  const item = items.find((i) => i.name === itemName);
  if (item) registry!.items.push(item.id);
  if (cat) registry!.masters.push(["categories", cat.id]);
  if (sub) registry!.masters.push(["subcategories", sub.id]);
});
