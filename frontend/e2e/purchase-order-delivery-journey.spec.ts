import { test, expect, type Page } from "@playwright/test";
import { optionMatcher, newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

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
  await page.getByRole("option", { name: optionMatcher(optionText) }).click();
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
  await page.getByRole("option", { name: optionMatcher(optionText) }).click();
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

  // ---- S3b-2: a new Purchase Order WITH its line, on one screen (Cost Centre required, Vendor set too) ----
  await page.goto("/purchase-orders/new");
  const poNumber = `E2E-PO-${ts}`;
  await page.locator("#po-number").fill(poNumber); // required field -- see selectRadixById's comment
  await selectRadix(page, "Vendor", ctx.vendor.name); // not required -- plain "Vendor" label, no asterisk
  await selectRadixById(page, "cost-center", ctx.costCenter.name);

  // One line with Quantity = 3. The line's controls carry their own aria-label ("Line 1 …").
  const lineDescription = `E2E PO Delivery Laptop ${ts}`;
  const barcode = `E2E-BC-${ts}`;
  await page.getByLabel("Line 1 Item", { exact: true }).click();
  await page.getByRole("option", { name: optionMatcher(ctx.item.name) }).click();
  await page.getByLabel("Line 1 Quantity", { exact: true }).fill("3");
  await page.getByLabel("Line 1 Unit Cost", { exact: true }).fill("1000");
  await page.getByLabel("Line 1 Tax %", { exact: true }).fill("5");
  // Description starts as the Item's name and the barcode is optional: both under More details.
  await page.getByRole("button", { name: "Line 1: more details", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill(lineDescription);
  await page.getByLabel("Barcode", { exact: true }).fill(barcode);
  await expect(page.getByLabel("Purchase order total")).toContainText("1 line · 3 units");
  await page.getByRole("button", { name: "Save PO", exact: true }).click();

  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);
  await expect(page.getByRole("heading", { name: `Purchase Order ${poNumber}`, level: 1 })).toBeVisible();
  const poPath = new URL(page.url()).pathname;

  // ---- S2: the PO shows ONE line holding 3 waiting units (not 3 rows) ----
  await expect(page.getByRole("status").filter({ hasText: "PO created: 1 line, 3 units waiting." })).toBeVisible();
  const lineRow = page.getByRole("row", { name: /^Line 1:/ });
  await expect(lineRow).toHaveCount(1);
  // #, Item, Ordered, Received, Waiting
  await expect(lineRow.getByRole("cell").nth(2)).toHaveText("3");
  await expect(lineRow.getByRole("cell").nth(3)).toHaveText("0");
  await expect(lineRow.getByRole("cell").nth(4)).toHaveText("3");
  await expect(lineRow.getByText("Waiting", { exact: true })).toBeVisible();

  // ---- S4: Receive the line on the Receive screen (no unit rows, nothing to tick) ----
  await lineRow.getByRole("button", { name: /^Receive line 1\b/ }).click();
  await expect(page).toHaveURL(/\/receive\/\d+\?line=1$/);
  await expect(page.getByRole("heading", { name: `Receive PO ${poNumber}`, level: 1 })).toBeVisible();
  const receiveLine = page.getByRole("group", { name: /^Line 1:/ });
  await expect(receiveLine.getByLabel("Waiting: 3")).toBeVisible();

  // ---- Receipt details, entered once ----
  const invoiceNumber = `E2E-INV-${ts}`;
  await page.locator("#invoice-number").fill(invoiceNumber);
  const invoiceDate = "2026-01-15";
  await page.locator("#invoice-date").fill(invoiceDate);
  await page.locator("#invoice-amount").fill("2100");
  // Received Into: once for the whole receipt (a stock room of the PO's company).
  await page.locator("#received-into").click();
  await page.getByRole("option", { name: optionMatcher(ctx.stock.name) }).click();

  // ---- Receive 2 of the 3: the quantity says so, the 3rd stays waiting ----
  await page.locator("#qty-line-1").fill("2");
  await expect(receiveLine.getByText("1 unit will stay waiting on this PO.")).toBeVisible();
  const serialsBox = page.locator("#serials-line-1");
  await expect(page.locator('textarea[id^="serials-line-"]')).toHaveCount(1);
  const serialA = `E2E-SN-${ts}-A`;
  const serialB = `E2E-SN-${ts}-B`;
  await serialsBox.fill(`${serialA}\n${serialB}`);
  await expect(receiveLine.getByText("2 of 2 entered", { exact: true })).toBeVisible();

  // ---- Receive ----
  await page.getByRole("button", { name: "Receive 2 units", exact: true }).click();
  const received = page.getByRole("region", { name: "Received" });
  await expect(received.getByText("2 assets created", { exact: true })).toBeVisible();
  await expect(received.getByRole("button", { name: "Print labels (2)" })).toBeVisible();

  // ---- Exactly 2 units received, the 3rd still waiting: the line's counts ----
  await page.goto(poPath);
  await expect(lineRow.getByRole("cell").nth(3)).toHaveText("2");
  await expect(lineRow.getByRole("cell").nth(4)).toHaveText("1");
  await expect(lineRow.getByText("Partly Received", { exact: true })).toBeVisible();
  // The invoices card (GET /invoices) lists the invoice with its units.
  await expect(page.getByRole("region", { name: "Invoices received" }).getByText(invoiceNumber, { exact: true })).toBeVisible();

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
  // S5a: Asset 360 is a summary plus sections (no tabs to open for these facts).
  const identity = page.getByRole("region", { name: "Identity" });
  await expect(identity.getByText(serialA, { exact: true })).toBeVisible();
  await expect(identity.getByText(barcode, { exact: true })).toBeVisible();
  // AM-18: the line's Warranty Years was left at its default of 0, so Warranty Upto == Purchase Date.
  await expect(identity.getByText(`0 years · until ${invoiceDate}`, { exact: true })).toBeVisible();

  const procurement = page.getByRole("region", { name: "Procurement" });
  await expect(procurement.getByText(poNumber)).toBeVisible();
  await expect(procurement.getByText(`${invoiceNumber} · ${invoiceDate}`, { exact: true })).toBeVisible();
  // Purchase Date (derived from the Invoice Date).
  await expect(procurement.getByText(invoiceDate, { exact: true })).toHaveCount(1);

  await expect(page.getByTestId("asset-summary").getByText(ctx.stock.name, { exact: true })).toBeVisible();

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

  const identityB = page.getByRole("region", { name: "Identity" });
  await expect(identityB.getByText(serialB, { exact: true })).toBeVisible();
  await expect(identityB.getByText(barcode, { exact: true })).toBeVisible();

  await expect(page.getByTestId("asset-summary").getByText(ctx.stock.name, { exact: true })).toBeVisible();

  // ---- Revisit the PO detail: the 3rd, undelivered unit is still PENDING --
  // and (AM-17 Part B) attempting to deliver it with a REAL duplicate Serial
  // Number (reusing unit A's serialA) is rejected end to end, with a visible
  // UI error, not silently accepted. ----
  await page.goto(poPath);
  const lineAgain = page.getByRole("row", { name: /^Line 1:/ });
  await expect(lineAgain.getByRole("cell").nth(3)).toHaveText("2");
  await expect(lineAgain.getByRole("cell").nth(4)).toHaveText("1");

  await lineAgain.getByRole("button", { name: /^Receive line 1\b/ }).click();
  await expect(page).toHaveURL(/\/receive\/\d+\?line=1$/);
  const lineOnce = page.getByRole("group", { name: /^Line 1:/ });
  await expect(page.locator("#qty-line-1")).toHaveValue("1");
  await page.locator("#invoice-number").fill(`E2E-INV-DUP-${ts}`);
  await page.locator("#invoice-date").fill("2026-01-16");
  await page.locator("#invoice-amount").fill("1050");
  await page.locator("#serials-line-1").fill(serialA); // duplicate, real value -- not "N/A"

  // The screen asks the server while the serial is being typed, so the clash
  // is shown right away -- naming the asset that already has it, on its row --
  // and Receive stays disabled with the reason beside it. (The server's own
  // refusal of a duplicate on receipt is covered by the backend tests.)
  await expect(lineOnce.getByText(/is already used by asset/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Receive 1 unit", exact: true })).toBeDisabled();
  await expect(page.locator("#receive-why")).toContainText("Line 1:");
  await page.getByRole("link", { name: "Open PO" }).click();
  await expect(lineAgain.getByRole("cell").nth(3)).toHaveText("2");
  await expect(lineAgain.getByRole("cell").nth(4)).toHaveText("1");
});
