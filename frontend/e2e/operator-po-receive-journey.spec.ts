import { test, expect, type Page } from "@playwright/test";
import {
  api, createTestLogin, loginAdmin, newSeedRegistry, pick, seedTestCompany, teardownTestCompany, type SeedRegistry,
} from "./fixtures";

// S7 headline journeys for an ordinary OPERATOR ("Can Add & Move Assets", IT work area):
//  - Settings is not theirs: the address shows "You don't have access to this area." (route guard; UX only);
//  - the one-screen New Purchase Order (S3b-2): a Vendor and an Item that do not exist yet are created
//    right inside the PO (S3a-1 in-flow creation), no trip to Settings;
//  - the PO page shows the order BY LINE (S2): a 3-line / 104-unit PO is 3 rows, never 104;
//  - the Receive screen (S4): 50 units of a no-serial Item are received in ONE receipt with ONE quantity
//    entry -- no unit rows, no per-unit boxes or ticks.

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let registry: SeedRegistry | null = null;

test.afterEach(async ({ baseURL }) => {
  if (registry) {
    const reg = registry;
    registry = null;
    await teardownTestCompany(baseURL!, reg);
  }
});

test("operator: no Settings, one-screen PO with a new Vendor and Item, 3 lines / 104 units, 50 no-serial units in one receipt", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const ownerToken = await loginAdmin(baseURL!, registry);
  const ts = Date.now().toString(36);
  const operator = await createTestLogin(baseURL!, ownerToken, registry, ctx, {
    code: `OPR${ts}`, name: `E2E Operator ${ts}`, role: "OPERATOR", allowed_asset_domains: "IT",
  });

  await loginAs(page, operator.code, operator.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  // ---- (vi) Settings: not in the sidebar, and the address shows the route guard ----
  await expect(page.getByRole("button", { name: "Settings", exact: true })).not.toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText("You don't have access to this area.", { exact: true })).toBeVisible();
  await page.goto("/settings/catalogue/items");
  await expect(page.getByText("You don't have access to this area.", { exact: true })).toBeVisible();

  // ---- (iv) One-screen PO: the header ----
  await page.goto("/purchase-orders/new");
  await expect(page.getByRole("heading", { name: "New Purchase Order", level: 1 })).toBeVisible();
  const poNumber = `E2E-OPR-${ts}`;
  await page.locator("#po-number").fill(poNumber);
  await page.locator("#po-date").fill("2026-01-10"); // before the invoice (S0.5)
  await pick(page, page.locator("#cost-center"), ctx.costCenter.name);

  // A Vendor that does not exist yet: "New Vendor…" at the end of the list, saved and picked here.
  const vendorName = `E2E Operator Vendor ${ts}`;
  await pick(page, page.locator("#vendor"), "New Vendor…");
  const vendorDialog = page.getByRole("dialog", { name: "New Vendor" });
  await vendorDialog.locator("#qc-name").fill(vendorName);
  await vendorDialog.getByRole("button", { name: /^Save/ }).click();
  await expect(vendorDialog).toBeHidden();
  await expect(page.locator("#vendor")).toContainText(vendorName);
  // It really exists now (made by the operator); registered at once for teardown.
  const vendors = await api<{ id: number; name: string }[]>(baseURL!, "GET", "/api/masters/vendors", ownerToken);
  const inlineVendor = vendors.find((x) => x.name === vendorName);
  expect(inlineVendor, "the vendor made inside the PO exists").toBeTruthy();
  registry.masters.push(["vendors", inlineVendor!.id]);

  // ---- Line 1: an Item that does not exist yet, made from the line's own Item picker ----
  const newItemName = `E2E Operator Cable Tester ${ts}`;
  await pick(page, page.getByLabel("Line 1 Item", { exact: true }), "New Item…");
  const itemDialog = page.getByRole("dialog", { name: "New Item" });
  await itemDialog.locator("#item-name").fill(newItemName);
  await pick(page, itemDialog.locator("#item-type"), new RegExp(`^${escapeRe(`${ctx.category.name} › ${ctx.subcategory.name}`)}`));
  await itemDialog.getByRole("radio", { name: "No serial number", exact: true }).click();
  await itemDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(itemDialog).toBeHidden();
  await expect(page.getByLabel("Line 1 Item", { exact: true })).toContainText(newItemName);
  await page.getByLabel("Line 1 Quantity", { exact: true }).fill("50");
  await page.getByLabel("Line 1 Unit Cost", { exact: true }).fill("500");

  // ---- Lines 2 and 3: existing Items ----
  await page.getByRole("button", { name: "Add line", exact: true }).click();
  await pick(page, page.getByLabel("Line 2 Item", { exact: true }), ctx.item.name);
  await page.getByLabel("Line 2 Quantity", { exact: true }).fill("4");
  await page.getByLabel("Line 2 Unit Cost", { exact: true }).fill("60000");
  await page.getByRole("button", { name: "Add line", exact: true }).click();
  await pick(page, page.getByLabel("Line 3 Item", { exact: true }), ctx.noSerialItem.name);
  await page.getByLabel("Line 3 Quantity", { exact: true }).fill("50");
  await page.getByLabel("Line 3 Unit Cost", { exact: true }).fill("400");
  await expect(page.getByLabel("Purchase order total")).toContainText("3 lines · 104 units");
  await page.getByRole("button", { name: "Save PO", exact: true }).click();

  // ---- (v) The PO page: 3 line rows for 104 units, never a row per unit ----
  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);
  const poPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: `Purchase Order ${poNumber}`, level: 1 })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "PO created: 3 lines, 104 units waiting." })).toBeVisible();
  const lineRows = page.getByRole("row", { name: /^Line \d+:/ });
  await expect(lineRows).toHaveCount(3);
  // #, Item, Ordered, Received, Waiting
  const expected: [string, string][] = [[newItemName, "50"], [ctx.item.name, "4"], [ctx.noSerialItem.name, "50"]];
  for (const [i, [name, qty]] of expected.entries()) {
    const row = page.getByRole("row", { name: `Line ${i + 1}: ${name}` });
    await expect(row.getByRole("cell").nth(2)).toHaveText(qty);
    await expect(row.getByRole("cell").nth(3)).toHaveText("0");
    await expect(row.getByRole("cell").nth(4)).toHaveText(qty);
  }
  // The header carries the Vendor made inline.
  await expect(page.getByText(vendorName).first()).toBeVisible();

  // ---- (i) Receive the 50 no-serial units of line 3 in ONE receipt, ONE quantity ----
  await page.getByRole("row", { name: `Line 3: ${ctx.noSerialItem.name}` }).getByRole("button", { name: /^Receive line 3\b/ }).click();
  await expect(page).toHaveURL(/\/receive\/\d+\?line=3$/);
  await page.locator("#invoice-number").fill(`E2E-INV-${ts}`);
  await page.locator("#invoice-date").fill("2026-01-15");
  await page.locator("#invoice-amount").fill("23600");
  await pick(page, page.locator("#received-into"), ctx.stock.name);
  // Only line 3 this time: the other lines are set to 0 (skipped).
  await page.locator("#qty-line-1").fill("0");
  await page.locator("#qty-line-2").fill("0");
  await page.locator("#qty-line-3").fill("50");

  const line3 = page.getByRole("group", { name: `Line 3: ${ctx.noSerialItem.name}` });
  await expect(line3.getByText("Waiting", { exact: true })).toBeVisible();
  await expect(line3.getByText("No serial number: each asset is saved with N/A.")).toBeVisible();
  // One quantity box for the whole line -- no unit rows, no serial boxes, no per-unit ticks.
  await expect(line3.getByRole("spinbutton")).toHaveCount(1);
  await expect(line3.locator("textarea")).toHaveCount(0);
  await expect(line3.getByRole("checkbox")).toHaveCount(0);
  await expect(line3.getByRole("row")).toHaveCount(0);
  await expect(page.locator('textarea[id^="serials-line-"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Receive 50 units", exact: true }).click();
  const received = page.getByRole("region", { name: "Received" });
  await expect(received.getByText("50 assets created", { exact: true })).toBeVisible();

  // ---- Back on the PO: line 3 fully received, the other two still waiting ----
  await page.goto(poPath);
  const row3 = page.getByRole("row", { name: `Line 3: ${ctx.noSerialItem.name}` });
  await expect(row3.getByRole("cell").nth(3)).toHaveText("50");
  await expect(row3.getByRole("cell").nth(4)).toHaveText("0");
  const row1 = page.getByRole("row", { name: `Line 1: ${newItemName}` });
  await expect(row1.getByRole("cell").nth(4)).toHaveText("50");

  // The 50 assets exist, all from this one receipt.
  const listed = await api<{ total: number }>(
    baseURL!, "GET", `/api/assets?company_id=${ctx.company.id}&po_number=${encodeURIComponent(poNumber)}&limit=1`, ownerToken,
  );
  expect(listed.total).toBe(50);
  // (The inline Item sits under the seeded Category, which teardown sweeps.)
});
