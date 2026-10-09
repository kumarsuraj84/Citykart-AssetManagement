import { test, expect, type Page } from "@playwright/test";
import { newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

// Desktop bundles end to end: define the bundle in Masters, add 2 Desktops to a
// PO (16000 each, 18% tax), see them become 8 ordinary lines, then deliver them
// -- the mouse and keyboard parts must start with "No serial number" ticked,
// CPU and TFT take pasted serial lists -- and finally deactivate the bundle.

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

// Required fields on these forms are driven by input id (see the note in
// purchase-order-delivery-journey.spec.ts).
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

test("Desktop bundle journey: define it, add 2 to a PO, deliver with no-serial defaults, deactivate it", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const ts = Date.now().toString(36);
  const bundleName = `E2E Desktop ${ts}`;

  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  // ---- Define the bundle: the Desktop example (CPU 70, TFT 26, Keyboard 2, Mouse 2) ----
  await page.goto("/setup/bundles");
  await page.getByRole("button", { name: "New Bundle", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New Bundle" });
  await editor.locator("#bundle-name").fill(bundleName);
  await editor.getByRole("button", { name: "Use the Desktop example" }).click();
  await expect(editor.getByRole("status")).toContainText("Total 100%");
  for (let i = 0; i < 4; i++) {
    await selectRadixById(page, `part-category-${i}`, ctx.category.name);
    await selectRadixById(page, `part-subcategory-${i}`, ctx.subcategory.name);
  }
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(bundleName, { exact: true })).toBeVisible();
  await expect(page.getByText("CPU 70%, TFT 26%, Keyboard 2%, Mouse 2%")).toBeVisible();

  // ---- A PO with the bundle added twice ----
  await page.goto("/purchase-orders/new");
  const poNumber = `E2E-BND-${ts}`;
  await page.locator("#po-number").fill(poNumber);
  await selectRadixById(page, "cost-center", ctx.costCenter.name);
  await page.getByRole("button", { name: "Create Purchase Order", exact: true }).click();
  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);

  await page.getByRole("button", { name: "+ Add Bundle", exact: true }).click();
  const addBundle = page.getByRole("dialog", { name: "Add Bundle" });
  await selectRadixById(page, "bundle-pick", bundleName);
  await addBundle.locator("#bundle-description").fill(`E2E Dell Desktop ${ts}`);
  await addBundle.locator("#bundle-barcode").fill(`E2E-BC-${ts}`);
  await addBundle.locator("#bundle-quantity").fill("2");
  await addBundle.locator("#bundle-price").fill("16000");
  await expect(addBundle.getByLabel("Amount for CPU")).toHaveValue("11200");
  await expect(addBundle.getByLabel("Amount for TFT")).toHaveValue("4160");
  await expect(addBundle.getByLabel("Amount for Keyboard")).toHaveValue("320");
  await expect(addBundle.getByLabel("Amount for Mouse")).toHaveValue("320");
  await expect(addBundle.getByText("This will add 8 lines")).toBeVisible();
  await addBundle.getByRole("button", { name: "Add Bundle", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Pending Delivery (8)", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Select E2E Dell Desktop ${ts} - Mouse` })).toHaveCount(2);

  // ---- Deliver all 8: serials only for the CPUs and TFTs ----
  await page.getByRole("checkbox", { name: "Select all pending lines" }).click();
  await page.getByRole("button", { name: "Mark 8 Delivery Done", exact: true }).click();
  const deliver = page.getByRole("dialog", { name: /assets? delivered/ });
  await deliver.locator("#invoice-number").fill(`E2E-INV-${ts}`);
  await deliver.locator("#invoice-amount").fill("37760");
  await selectRadixById(page, "initial-asset-user", ctx.stock.name);

  await expect(deliver.getByRole("checkbox", { name: `No serial number for E2E Dell Desktop ${ts} - Mouse` })).toBeChecked();
  await expect(deliver.getByRole("checkbox", { name: `No serial number for E2E Dell Desktop ${ts} - Keyboard` })).toBeChecked();
  await expect(deliver.getByRole("checkbox", { name: `No serial number for E2E Dell Desktop ${ts} - CPU` })).not.toBeChecked();
  await expect(deliver.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();

  const boxes = deliver.locator('textarea[id^="serials-"]'); // CPU, TFT, Keyboard, Mouse in that order
  await boxes.nth(0).fill(`E2E-C-${ts}-1\nE2E-C-${ts}-2`);
  await boxes.nth(1).fill(`E2E-T-${ts}-1\nE2E-T-${ts}-2`);
  await deliver.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(deliver).not.toBeVisible();

  await expect(page.getByRole("heading", { name: "Delivered (8)", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending Delivery (0)", exact: true })).toBeVisible();
  // The 4 mouse/keyboard assets took N/A; the CPUs and TFTs their own serials.
  await expect(page.getByRole("cell", { name: "N/A", exact: true })).toHaveCount(4);
  await expect(page.getByRole("cell", { name: `E2E-C-${ts}-1`, exact: true })).toBeVisible();

  // ---- Deactivate the bundle: it stops being offered ----
  await page.goto("/setup/bundles");
  await page.getByRole("button", { name: `Deactivate ${bundleName}` }).click();
  await page.getByRole("dialog", { name: /Deactivate/ }).getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByText(bundleName, { exact: true })).toHaveCount(0);
});
