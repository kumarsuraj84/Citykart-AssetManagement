import { test, expect, type Page } from "@playwright/test";
import { newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

// AM-17: the PO->delivery->Asset 360 journey had zero permanent E2E coverage
// before this spec (5 existing specs never touch Purchase Orders at all).
// This closes that gap end to end: raise a PO, add a quantity-3 line (three
// individual PENDING units), deliver exactly 2 of them with distinct serials
// and distinct initial asset_users, and verify both the PO detail screen and the
// two new assets' own Asset 360 pages reflect that correctly -- plus (AM-17
// Part B) one thin full-stack proof that Serial Number's global uniqueness
// rule (already covered thoroughly at the backend unit/integration level --
// see backend/tests/purchase_orders/test_service.py,
// backend/tests/imports/test_am06_import_full_field_support.py, and
// check_serial_number_unique's own docstring in backend/app/assets/service.py)
// is enforced when driven through the real UI, not just the API.

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

// PurchaseOrdersList/PurchaseOrderDetail/NewPurchaseOrderForm use shadcn's
// Radix-based <Select>, same as every other CKAM form -- open the combobox
// trigger, then click the listbox option (same convention asset-lifecycle.spec.ts
// and add-asset-company-scoping.spec.ts already use).
async function selectRadix(page: Page, label: string, optionText: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

// NewPurchaseOrderForm/PurchaseOrderDetail's Add-Line form build their
// required-field labels through the shared FormField component, which
// appends an aria-hidden "*" INSIDE the <label> (e.g. "PO No" + a hidden
// "*" -- correctly excluded from the accessible name real assistive tech
// computes, so this is not a screen-reader defect). Unlike AddAssetForm's
// own inputs, these particular inputs never set an aria-label to override
// that association, and Playwright's getByLabel matches on the <label>
// element's raw text content ("PO No*"), not the accname-stripped version
// -- so `getByLabel("PO No", { exact: true })` never resolves and the action
// hangs until the test timeout. Every required field on these two forms is
// therefore driven by its input `id` directly, not by label text.
async function selectRadixById(page: Page, triggerId: string, optionText: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

let registry: SeedRegistry | null = null;

test.afterEach(async ({ baseURL }) => {
  if (registry) {
    const reg = registry;
    registry = null;
    await teardownTestCompany(baseURL!, reg);
  }
});

test("PO delivery journey: raise PO, deliver partial quantity, verify Asset 360, reject a duplicate serial", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const ts = Date.now().toString(36);

  // ---- Log in as the seeded ADMIN ----
  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  // ---- Create a new Purchase Order (Cost Centre required, Vendor set too) ----
  await page.goto("/purchase-orders/new");
  const poNumber = `E2E-PO-${ts}`;
  await page.locator("#po-number").fill(poNumber); // required field -- see selectRadixById's comment
  await selectRadix(page, "Vendor", ctx.vendor.name); // not required -- plain "Vendor" label, no asterisk
  await selectRadixById(page, "cost-center", ctx.costCenter.name);
  await page.getByRole("button", { name: "Create Purchase Order", exact: true }).click();

  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);
  await expect(page.getByRole("heading", { name: `Purchase Order ${poNumber}`, level: 1 })).toBeVisible();
  const poPath = new URL(page.url()).pathname;

  // ---- Add one line with Quantity = 3 ----
  const lineDescription = `E2E PO Delivery Laptop ${ts}`;
  const barcode = `E2E-BC-${ts}`;
  await page.getByRole("button", { name: "+ Add Line", exact: true }).click();
  // Description/Barcode/Category/Sub-Category/Cost/Quantity are all required
  // here -- id-based, same reason as the PO header fields above.
  await page.locator("#line-description").fill(lineDescription);
  await page.locator("#line-barcode").fill(barcode);
  await selectRadixById(page, "line-category", ctx.category.name);
  await selectRadixById(page, "line-subcategory", ctx.subcategory.name);
  await page.locator("#line-cost").fill("1000");
  await page.locator("#line-tax").fill("5");
  await page.locator("#line-quantity").fill("3");
  await page.getByRole("button", { name: "Add Line", exact: true }).click();

  // ---- Confirm 3 individual PENDING units now exist for this line ----
  // (the Pending Delivery table has no per-row status badge -- every row in
  // it is implicitly PENDING, same status the section heading's own count
  // already reflects)
  const lineCheckboxes = page.getByRole("checkbox", { name: `Select ${lineDescription}` });
  await expect(lineCheckboxes).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Pending Delivery (3)", exact: true })).toBeVisible();

  // ---- Select exactly 2 of the 3 pending units ----
  await lineCheckboxes.nth(0).click();
  await lineCheckboxes.nth(1).click();
  await expect(page.getByRole("button", { name: "Mark 2 Delivery Done", exact: true })).toBeVisible();

  // ---- Trigger Delivery Done ----
  await page.getByRole("button", { name: "Mark 2 Delivery Done", exact: true }).click();
  // Named, not a bare "dialog": the Initial Asset User dropdown's popup also
  // has role=dialog and can still be in the DOM while this dialog closes.
  const deliverDialog = page.getByRole("dialog", { name: /assets? delivered/ });
  await expect(deliverDialog.getByRole("heading", { name: "Mark 2 assets delivered" })).toBeVisible();

  // ---- Shared Invoice fields, filled once ----
  const invoiceNumber = `E2E-INV-${ts}`;
  await deliverDialog.locator("#invoice-number").fill(invoiceNumber);
  const invoiceDate = "2026-01-15";
  await deliverDialog.locator("#invoice-date").fill(invoiceDate);
  await deliverDialog.locator("#invoice-amount").fill("2100");

  // ---- Initial AssetUser: chosen once for the whole delivery (a PO goes to
  // one location only), not per unit ----
  await expect(deliverDialog.locator('[id^="asset-user-"]')).toHaveCount(0);
  await deliverDialog.locator("#initial-asset-user").click();
  await page.getByRole("option", { name: ctx.stock.name, exact: true }).click();

  // ---- Distinct Serial Number per selected unit ----
  // The 2 selected units are identical units of one line item, so the dialog
  // groups them into ONE block with a single list box (one serial per line).
  // (id is "serials-<first pending id>", unknown ahead of time -- select by
  // the id prefix.)
  await expect(deliverDialog.getByText("2 units", { exact: true })).toBeVisible();
  const serialsBox = deliverDialog.locator('textarea[id^="serials-"]');
  await expect(serialsBox).toHaveCount(1);

  const serialA = `E2E-SN-${ts}-A`;
  const serialB = `E2E-SN-${ts}-B`;
  await serialsBox.fill(`${serialA}\n${serialB}`);
  await expect(deliverDialog.getByText("2 of 2 entered")).toBeVisible();

  // ---- Confirm the delivery ----
  await deliverDialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(deliverDialog).not.toBeVisible();

  // ---- Exactly 2 units DELIVERED, the 3rd still PENDING (section heading
  // counts -- see the "no per-row status badge" note above) ----
  await expect(page.getByRole("heading", { name: "Delivered (2)", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending Delivery (1)", exact: true })).toBeVisible();

  // ---- 2 new Assets now exist -- verified via the Asset Register, since
  // PurchaseOrderDetail has no link to the delivered asset -- searching by
  // each unit's own unique Serial Number narrows to exactly one row. ----
  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(serialA);
  await expect(page.getByText("Showing 1–1 of 1 asset", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.locator("tbody tr").first().click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: /^E2E\// })).toBeVisible();
  const assetCodeA = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
  expect(assetCodeA.length).toBeGreaterThan(0);

  // ---- Asset 360 for unit A: PO/Invoice/Purchase Date/Barcode/Serial/AssetUser ----
  const overview = page.getByRole("tabpanel", { name: "Overview" });
  await expect(overview.getByText(serialA, { exact: true })).toBeVisible();
  await expect(overview.getByText(barcode, { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Procurement", exact: true }).click();
  const procurement = page.getByRole("tabpanel", { name: "Procurement" });
  await expect(procurement.getByText(poNumber, { exact: true })).toBeVisible();
  await expect(procurement.getByText(invoiceNumber, { exact: true })).toBeVisible();
  // Invoice Date, Purchase Date, and Warranty Upto (AM-18: the line's Warranty
  // Years was left at its default of 0, so Warranty Upto == Purchase Date too).
  await expect(procurement.getByText(invoiceDate, { exact: true })).toHaveCount(3);

  await page.getByRole("tab", { name: "Custody", exact: true }).click();
  const custody = page.getByRole("tabpanel", { name: "Custody" });
  await expect(custody.getByText(ctx.stock.name, { exact: true })).toBeVisible();

  // ---- Unit B: same checks, via its own unique Serial Number -- proves the
  // two units were not accidentally merged during delivery, and that the one
  // shared initial asset_user was applied to it too. ----
  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(serialB);
  await expect(page.getByText("Showing 1–1 of 1 asset", { exact: true })).toBeVisible();
  await page.locator("tbody tr").first().click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  const assetCodeB = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
  expect(assetCodeB.length).toBeGreaterThan(0);
  expect(assetCodeB).not.toBe(assetCodeA);

  const overviewB = page.getByRole("tabpanel", { name: "Overview" });
  await expect(overviewB.getByText(serialB, { exact: true })).toBeVisible();
  await expect(overviewB.getByText(barcode, { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Custody", exact: true }).click();
  const custodyB = page.getByRole("tabpanel", { name: "Custody" });
  await expect(custodyB.getByText(ctx.stock.name, { exact: true })).toBeVisible();

  // ---- Revisit the PO detail: the 3rd, undelivered unit is still PENDING --
  // and (AM-17 Part B) attempting to deliver it with a REAL duplicate Serial
  // Number (reusing unit A's serialA) is rejected end to end, with a visible
  // UI error, not silently accepted. ----
  await page.goto(poPath);
  await expect(page.getByRole("heading", { name: "Pending Delivery (1)", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivered (2)", exact: true })).toBeVisible();

  const lastCheckbox = page.getByRole("checkbox", { name: `Select ${lineDescription}` });
  await expect(lastCheckbox).toHaveCount(1);
  await lastCheckbox.click();
  await page.getByRole("button", { name: "Mark 1 Delivery Done", exact: true }).click();

  const dupDialog = page.getByRole("dialog", { name: /assets? delivered/ });
  await expect(dupDialog.getByRole("heading", { name: "Mark 1 asset delivered" })).toBeVisible();
  await dupDialog.locator("#invoice-number").fill(`E2E-INV-DUP-${ts}`);
  await dupDialog.locator("#invoice-date").fill("2026-01-16");
  await dupDialog.locator("#invoice-amount").fill("1050");
  await dupDialog.locator('input[id^="serial-"]').fill(serialA); // duplicate, real value -- not "N/A"
  await dupDialog.locator("#initial-asset-user").click();
  await page.getByRole("option", { name: ctx.store.name, exact: true }).click();
  await dupDialog.getByRole("button", { name: "Confirm", exact: true }).click();

  // Rejected with a visible, specific error -- dialog stays open, no 3rd
  // asset gets created, and the line remains PENDING.
  await expect(dupDialog.getByRole("alert").or(dupDialog.getByText(/already used/i))).toBeVisible();
  await expect(dupDialog).toBeVisible();
  await dupDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dupDialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending Delivery (1)", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivered (2)", exact: true })).toBeVisible();
});
