import { test, expect, type Page } from "@playwright/test";
import { api, loginAdmin, newSeedRegistry, seedTestCompany, teardownTestCompany, type SeedRegistry } from "./fixtures";

// S3a-2 / S3b-2 headline journey: "Purchase Orders from the ERP" lists EVERY open ERP purchase
// order -- one whose ERP supplier is not matched to a CKAM vendor yet is NOT hidden: it is listed
// with "Needs your input" and the sentence "Vendor needs matching.", and its review says the vendor
// needs matching. Read-only: nothing is created, linked or written back.
//
// Data: the stack's own copy of the ERP (CKSPL / CKVPL purchase orders). Which supplier is still
// unmatched changes over time, so the PO is chosen at run time from the same API the screen uses;
// the test is skipped (with the reason) when the ERP copy is not set up or every supplier is matched.

async function loginAs(page: Page, empCode: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("User ID", { exact: true }).fill(empCode);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

interface ErpPoRow {
  po_code: number;
  po_number: string;
  company_code: string;
  vendor_linked?: boolean;
  vendor_id: number | null;
  erp_vendor_name?: string | null;
  vendor_name: string;
  readiness?: string;
  problems?: { kind: string; message: string }[];
}

let registry: SeedRegistry | null = null;

test.afterEach(async ({ baseURL }) => {
  if (registry) {
    const reg = registry;
    registry = null;
    await teardownTestCompany(baseURL!, reg);
  }
});

test("an ERP purchase order of an unmatched supplier is listed as needing input, and its review says the vendor needs matching", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  registry = newSeedRegistry();
  const ctx = await seedTestCompany(baseURL!, registry);
  const token = await loginAdmin(baseURL!, registry);

  const status = await api<{ configured: boolean }>(baseURL!, "GET", "/api/erp/status", token);
  test.skip(!status.configured, "The ERP connection / copy is not set up on this stack.");
  const envelope = await api<{ pos: ErpPoRow[] }>(baseURL!, "GET", "/api/erp/pos?envelope=true&readiness=NEEDS_INPUT", token);
  const unmatched = envelope.pos.find((p) => p.vendor_linked === false && p.vendor_id === null);
  test.skip(!unmatched, "Every open ERP purchase order's supplier is already matched to a vendor on this stack.");
  const po = unmatched!;
  expect(po.readiness).toBe("NEEDS_INPUT");
  expect(po.problems?.map((p) => p.message)).toContain("Vendor needs matching.");

  await loginAs(page, ctx.admin.empCode, ctx.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/purchase-orders/from-erp");
  await expect(page.getByRole("heading", { name: "Purchase Orders from the ERP", level: 1 })).toBeVisible();

  // Listed under "All" (nothing hidden) -- found by its PO number.
  await page.getByLabel("Search ERP purchase orders", { exact: true }).fill(po.po_number);
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: po.po_number, exact: true }) }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("(ERP supplier)");
  await expect(row).toContainText("Needs your input");
  await expect(row).toContainText("Vendor needs matching.");

  // ...and under "Needs your input" too.
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^Needs your input/ }).click();
  await expect(row).toBeVisible();

  // The review says what is needed (and offers to match it -- not done here).
  await row.getByRole("button", { name: `Review ${po.po_number}`, exact: true }).click();
  await expect(page.getByRole("region", { name: "Vendor needs matching" })).toBeVisible();
  await expect(page.getByText(/· needs matching$/).first()).toBeVisible();
});
