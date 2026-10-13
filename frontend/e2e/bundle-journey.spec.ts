import { test, expect, type Page } from "@playwright/test";
import { optionMatcher, newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

// Desktop bundles end to end: define the bundle on the Bundles screen (/setup/bundles, a direct link since
// S6a; new sets are usually made on the Item: "Comes as a set"), add 2 Desktops to a
// PO (16000 each, 18% tax), see them become 8 ordinary lines, then deliver them
// -- the mouse and keyboard parts (their sub-category is set to "No serial
// number" in Setup) must start with "No serial number" ticked,
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
  // CPU and TFT are the ordinary Item (a serial is expected); Keyboard and Mouse
  // the one set to "No serial number" -- the rule lives on the Item, not on the bundle.
  for (let i = 0; i < 4; i++) {
    await selectRadixById(page, `part-item-${i}`, i < 2 ? ctx.item.name : ctx.noSerialItem.name);
  }
  await expect(editor.getByText("Serial: Yes")).toHaveCount(2);
  await expect(editor.getByText("Serial: No")).toHaveCount(2);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(bundleName, { exact: true })).toBeVisible();
  await expect(page.getByText("CPU 70%, TFT 26%, Keyboard 2%, Mouse 2%")).toBeVisible();

  // ---- S3b-2: a PO with the bundle twice, made on the one-screen New Purchase Order ----
  await page.goto("/purchase-orders/new");
  const poNumber = `E2E-BND-${ts}`;
  await page.locator("#po-number").fill(poNumber);
  await selectRadixById(page, "cost-center", ctx.costCenter.name);
  // The empty first Item line is left out when saving; a set is added instead.
  await page.getByRole("button", { name: "Add set", exact: true }).click();
  const set = page.getByLabel("Set 1", { exact: true });
  // Required labels end in a hidden "*": the set's own controls are reached by their id ending.
  await set.locator('[id$="-bundle"]').click();
  await page.getByRole("option", { name: optionMatcher(bundleName) }).click();
  await set.locator('[id$="-quantity"]').fill("2");
  await set.locator('[id$="-price"]').fill("16000");
  await expect(set.getByLabel("Set 1 amount for CPU")).toHaveValue("11200");
  await expect(set.getByLabel("Set 1 amount for TFT")).toHaveValue("4160");
  await expect(set.getByLabel("Set 1 amount for Keyboard")).toHaveValue("320");
  await expect(set.getByLabel("Set 1 amount for Mouse")).toHaveValue("320");
  // S2: one line per part, 2 units on each -- never "8 lines".
  await expect(set.getByText(/4 lines, 8 units waiting \(2 of each part\)/)).toBeVisible();
  await set.getByRole("button", { name: "Set 1: more details", exact: true }).click();
  await set.getByLabel("Description", { exact: true }).fill(`E2E Dell Desktop ${ts}`);
  await set.getByLabel("Barcode", { exact: true }).fill(`E2E-BC-${ts}`);
  await page.getByRole("button", { name: "Save PO", exact: true }).click();
  await expect(page).toHaveURL(/\/purchase-orders\/\d+$/);

  await expect(page.getByRole("status").filter({ hasText: "PO created: 4 lines, 8 units waiting." })).toBeVisible();
  await expect(page.getByRole("row", { name: /^Line \d+:/ })).toHaveCount(4);

  // ---- Receive all 8: serials only for the CPUs and TFTs ----
  await page.getByRole("button", { name: "Receive all waiting (8)", exact: true }).click();
  const deliver = page.getByRole("dialog", { name: /^Receive \d+ units?$/ });
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

  await expect(page.getByText("8 units received and now in the register.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Receive all waiting/ })).toBeDisabled();
  // The mouse/keyboard assets took N/A; the CPUs their own serials (seen in each line's units).
  const mouseLine = page.getByRole("row", { name: /^Line \d+: .*Mouse/ });
  await mouseLine.getByRole("button", { name: /^View units of line/ }).click();
  await expect(page.getByRole("table", { name: /^Units of line/ }).getByRole("cell", { name: "N/A", exact: true })).toHaveCount(2);
  await mouseLine.getByRole("button", { name: /^Hide units of line/ }).click();
  const cpuLine = page.getByRole("row", { name: /^Line \d+: .*CPU/ });
  await cpuLine.getByRole("button", { name: /^View units of line/ }).click();
  await expect(page.getByRole("table", { name: /^Units of line/ }).getByRole("cell", { name: `E2E-C-${ts}-1`, exact: true })).toBeVisible();

  // ---- Deactivate the bundle: it stops being offered ----
  await page.goto("/setup/bundles");
  await page.getByRole("button", { name: `Deactivate ${bundleName}` }).click();
  await page.getByRole("dialog", { name: /Deactivate/ }).getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByText(bundleName, { exact: true })).toHaveCount(0);
});
