import { test, expect, type Page } from "@playwright/test";
import { newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await fillLogin(page, empCode, password);
}

// Fills and submits the login form already on screen (keeps any ?next= in the URL).
// The login screen no longer asks for a company -- login_id alone resolves the holder.
async function fillLogin(page: Page, empCode: string, password: string) {
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

// AddAssetForm/AssetDetail use shadcn's Radix-based <Select>, not a native <select> --
// Playwright's `.selectOption()` only works on real <select> elements, so every one of
// these fields is driven by opening the combobox trigger and clicking the listbox option.
async function selectRadix(page: Page, label: string, optionText: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

// Filled in by seedTestCompany as it creates each row, so the afterEach below can
// deactivate everything -- including after a failed test or a half-finished seed.
let registry: SeedRegistry | null = null;

test.afterEach(async ({ baseURL }) => {
  if (registry) {
    const reg = registry;
    registry = null;
    await teardownTestCompany(baseURL!, reg);
  }
});

test("full custody journey: procure, allot, return, allot again", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);

  // ---- Log in as the bootstrap ADMIN and add an asset ----
  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/assets/new");
  await selectRadix(page, "Category", ctx.category.name);
  await selectRadix(page, "Sub-Category", ctx.subcategory.name);
  await page.getByLabel("Description", { exact: true }).fill("E2E Test Laptop");
  await selectRadix(page, "Cost Centre", ctx.costCenter.name);
  await selectRadix(page, "Goes Into", ctx.stock.name);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // AM-04: creating exactly one asset navigates straight to its Asset 360
  // page (Asset Code is always server-generated -- read it back from there,
  // not guessed or parsed out of a client-side list). Match on the real code
  // pattern, not just heading level 1 -- Asset 360's own loading skeleton
  // renders a placeholder "Asset" heading first, and the real one only
  // appears once the asset itself has loaded.
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  const heading = page.getByRole("heading", { level: 1, name: /^E2E\// });
  await expect(heading).toBeVisible();
  const assetCode = (await heading.textContent())!.trim();

  // ---- Expired/invalid access token: the app refreshes it via the httpOnly
  // refresh cookie and retries, instead of dying after 15 minutes ----
  const BROKEN_TOKEN = "expired.or.invalid.token";
  await page.evaluate((broken) => {
    const stored = JSON.parse(sessionStorage.getItem("ckam-auth")!);
    stored.state.accessToken = broken;
    sessionStorage.setItem("ckam-auth", JSON.stringify(stored));
  }, BROKEN_TOKEN);

  // ---- Asset Register: filter to this asset and verify row-click navigation ----
  await page.goto("/assets");
  await page.getByLabel("Search", { exact: true }).fill(assetCode);
  const row = page.locator("tr", { hasText: assetCode });
  await expect(row).toBeVisible();
  await expect(page.getByText("Showing 1–1 of 1 asset", { exact: true })).toBeVisible();
  const refreshedToken = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ckam-auth")!).state.accessToken);
  expect(refreshedToken).not.toBe(BROKEN_TOKEN);
  // Click the description cell (not the code <a> or the checkbox, both of which
  // stopPropagation on the row's own onClick) to exercise AssetRegister's row-level
  // onClick, which navigates via the SPA router (AM-03) -- not a full page reload.
  await row.getByText("E2E Test Laptop", { exact: true }).click();
  await expect(page).toHaveURL(/\/assets\/\d+$/);
  await expect(page.getByRole("heading", { name: assetCode })).toBeVisible();

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
  // Human-readable custody labels built server-side with the real holder names.
  await expect(timelineItems.nth(0)).toContainText(`Procured into ${ctx.stock.name}`);
  await expect(timelineItems.nth(1)).toContainText(`Allotted to ${ctx.employee.name}`);
  await expect(timelineItems.nth(2)).toContainText(`Returned to ${ctx.stock.name}`);
  await expect(timelineItems.nth(3)).toContainText(`Allotted to ${ctx.store.name}`);

  // ---- QR label flow: scanning the label while logged out goes via /login and
  // lands back on the asset (not the dashboard) ----
  const assetPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(assetPath);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(assetPath)}$`));
  await fillLogin(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(new RegExp(`${assetPath}$`));
  await expect(page.getByRole("heading", { name: assetCode })).toBeVisible();

  // ---- Log out, log in as the EMPLOYEE holder: no currently-held assets ----
  // (the asset's custody ended at the STORE holder, not the employee, so the
  // employee's read-only "My Assets" view -- scoped server-side to
  // current_holder_id == their own id -- must be empty of it)
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, ctx.employee.emp_code, ctx.employeePassword);

  // The employee signed in with the admin-issued temporary password, so the app
  // forces a password change before anything else is reachable.
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto("/my-assets"); // trying to skip it just bounces back
  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel("Current password", { exact: true }).fill(ctx.employeePassword);
  await page.getByLabel("New password", { exact: true }).fill("E2e-Own-Passw0rd");
  await page.getByLabel("Confirm new password", { exact: true }).fill("E2e-Own-Passw0rd");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page).toHaveURL(/\/my-assets$/);
  await expect(page.getByText(assetCode, { exact: true })).not.toBeVisible();

  // ---- Session really over (no refresh cookie, invalid access token): back to
  // /login, remembering the page ----
  await page.context().clearCookies();
  await page.evaluate((broken) => {
    const stored = JSON.parse(sessionStorage.getItem("ckam-auth")!);
    stored.state.accessToken = broken;
    sessionStorage.setItem("ckam-auth", JSON.stringify(stored));
  }, BROKEN_TOKEN);
  await page.goto("/my-assets");
  await expect(page).toHaveURL(/\/login\?next=%2Fmy-assets$/);
});
