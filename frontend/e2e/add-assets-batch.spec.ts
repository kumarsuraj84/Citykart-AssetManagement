import { test, expect, type Page } from "@playwright/test";
import { api, loginAdmin, newSeedRegistry, pick, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

// S5b-1 headline journey: Add Assets is ONE batch form. 20 identical assets of a
// no-serial Item are added with one quantity (no per-asset rows, no serial box),
// each gets its own server-made Asset Code, and all 20 land in the chosen Stock Room.

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

test("Add Assets: 20 identical assets in one batch, one quantity, 20 distinct codes in the stock room", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const ts = Date.now().toString(36);
  const description = `E2E Batch Mouse ${ts}`;

  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/assets/new");
  await pick(page, page.getByLabel("Item", { exact: true }), ctx.noSerialItem.name);
  await page.getByLabel("Quantity", { exact: true }).fill("20");
  await pick(page, page.getByLabel("Received Into", { exact: true }), ctx.stock.name);
  await pick(page, page.getByLabel("Cost Centre", { exact: true }), ctx.costCenter.name);
  // The Item has no serial number: nobody is asked for 20 serials.
  await expect(page.getByLabel("Serial numbers", { exact: true })).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  await page.getByRole("button", { name: /Advanced/ }).click();
  await page.getByLabel("Description", { exact: true }).fill(description);

  await page.getByRole("button", { name: "Add 20 assets", exact: true }).click();
  const panel = page.getByRole("region", { name: "Added" });
  await expect(panel.getByText("20 assets created", { exact: true })).toBeVisible();
  const codes = (await panel.getByRole("list", { name: "New asset codes" }).getByRole("link").allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(20);
  expect(new Set(codes).size).toBe(20);
  for (const c of codes) expect(c).toMatch(/^E2E\//);

  // The register finds exactly these 20 by their shared description.
  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(description);
  await expect(page.getByText("Showing 1–20 of 20 assets", { exact: true })).toBeVisible();

  // Server truth: 20 assets of that Item, in stock with the chosen Stock Room, serial N/A.
  const token = await loginAdmin(baseURL!, registry);
  const listed = await api<{ items: { asset_code: string; status: string; current_asset_user_id: number; serial_number: string | null }[]; total: number }>(
    baseURL!, "GET", `/api/assets?company_id=${ctx.company.id}&item_id=${ctx.noSerialItem.id}&limit=50`, token,
  );
  expect(listed.total).toBe(20);
  expect(new Set(listed.items.map((a) => a.asset_code))).toEqual(new Set(codes));
  for (const a of listed.items) {
    expect(a.status).toBe("IN_STOCK");
    expect(a.current_asset_user_id).toBe(ctx.stock.id);
    expect(a.serial_number).toBe("N/A");
  }
});
