import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { ApiError, apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { ASK_TO_ADD, type Capabilities } from "../../lib/capabilities";
import { ADMIN_BOTH, HEAD_OFFICE, KINDS, VIEWER, withCapabilities } from "../../test-capabilities";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...real, apiClient: { get: vi.fn(), getPage: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

// S5b-1: Add Assets is one batch form (Item, Quantity, Received Into, Cost Centre;
// serial numbers by the Item's rule; purchase details and the rest folded away).
// These tests carry over every intent of the old single Add Asset form's tests.

function renderAt(url = "/assets/new") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, category_id: 1, subcategory_id: 2, serial_required: true, serial_later: false, bundle_id: null,
  default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0,
  work_area: "IT", category_name: "IT Equipment", subcategory_name: "Laptops", ...over,
});

const LAPTOP = item(11, "Laptop");
const MOUSE = item(12, "Mouse", { serial_required: false, subcategory_name: "Mice" });
const AMP = item(13, "Amplifier", { serial_later: true, work_area: "NON_IT", category_name: "AV", subcategory_name: null });

const CUSTOM_FIELDS = [
  { id: 1, field_key: "asset_tag", label: "Asset Tag", field_type: "text", options: null, is_required: true, sort_order: 1, company_id: null },
  { id: 2, field_key: "ram_gb", label: "RAM (GB)", field_type: "number", options: null, is_required: false, sort_order: 2, company_id: null },
  { id: 3, field_key: "delivered_on", label: "Delivered On", field_type: "date", options: null, is_required: false, sort_order: 3, company_id: null },
  { id: 4, field_key: "color", label: "Color", field_type: "dropdown", options: { choices: ["Black", "Silver"] }, is_required: false, sort_order: 4, company_id: null },
  { id: 5, field_key: "refurbished", label: "Refurbished?", field_type: "checkbox", options: null, is_required: false, sort_order: 5, company_id: null },
  { id: 6, field_key: "other_required", label: "Other Company Tag", field_type: "text", options: null, is_required: true, sort_order: 6, company_id: 2 },
];

interface Setup {
  items?: unknown[];
  rooms?: unknown[];
  costCentres?: unknown[];
  vendors?: unknown[];
  customFields?: unknown[];
  companies?: unknown[];
  caps?: Capabilities | null;
  conflicts?: { serial: string; asset_code: string }[];
}

function mockApi(s: Setup = {}) {
  const {
    items = [LAPTOP, MOUSE, AMP], rooms = [{ id: 4, name: "HO Stock", location_name: "Head Office", company_code: "CKSPL", company_id: 1 }],
    costCentres = [{ id: 3, code: "HO01", name: "Head Office" }], vendors = [{ id: 7, name: "Acme Traders" }], customFields = [],
    companies = [{ id: 1, name: "Company A" }], caps = ADMIN_BOTH, conflicts = [],
  } = s;
  (apiClient.get as any).mockImplementation(withCapabilities(caps, (path: string) => {
    if (path.startsWith("/items")) return Promise.resolve(items);
    if (path.startsWith("/stock-rooms")) return Promise.resolve(rooms);
    if (path === "/asset-users/me/companies") return Promise.resolve(companies);
    if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment", asset_domain: "IT" }]);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, code: "LAP", name: "Laptops", category_id: 1 }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve(costCentres);
    if (path.startsWith("/masters/vendors")) return Promise.resolve(vendors);
    if (path.startsWith("/masters/brands")) return Promise.resolve([{ id: 9, code: "DELL", name: "Dell" }]);
    if (path.startsWith("/masters/custom-fields")) return Promise.resolve(customFields);
    return Promise.resolve([]);
  }));
  (apiClient.post as any).mockImplementation((path: string) => {
    if (path === "/purchase-orders/check-serials") return Promise.resolve({ conflicts });
    return Promise.resolve(batchResult(1));
  });
}

function batchResult(n: number, pending = 0) {
  const assets = Array.from({ length: n }, (_, i) => ({ asset_id: 500 + i, asset_code: `FA/CK/IT/${i + 1}`, serial_number: null, serial_pending: i < pending }));
  return { assets_created: n, serial_pending: pending, assets, label_asset_ids: assets.map((a) => a.asset_id) };
}

/** Answers POST /assets/batch with `result` (or rejects with it). */
function onBatch(result: unknown, reject = false) {
  const prev = (apiClient.post as any).getMockImplementation();
  (apiClient.post as any).mockImplementation((path: string, body: unknown) => {
    if (path === "/assets/batch") return reject ? Promise.reject(result) : Promise.resolve(result);
    return prev(path, body);
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function optionName(label: string): RegExp {
  return new RegExp(`^${escapeRe(label)}(\\s?· .*)?$`);
}

async function pick(label: RegExp | string, name: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: typeof name === "string" ? optionName(name) : name }));
}

async function ready() {
  await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
}

/** Item + where it goes: what every batch needs. */
async function fillEssentials(itemName = "Laptop", qty?: string) {
  await ready();
  await pick(/^item$/i, itemName);
  if (qty !== undefined) fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: qty } });
  await pick(/^received into$/i, "HO Stock");
  await pick(/^cost centre$/i, "HO01 · Head Office");
}

const addButton = () => screen.getByRole("button", { name: /^add (\d[\d,]* assets?|assets)$/i });
const whyLine = () => document.getElementById("add-why")!;
const lastBatchBody = () => {
  const call = (apiClient.post as any).mock.calls.filter(([p]: [string]) => p === "/assets/batch").pop();
  return call?.[1];
};

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); } catch { /* no storage */ }
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5 });
});
afterEach(() => useAuthStore.getState().logout());

describe("Add Assets: the batch form", () => {
  it("asks only for the essentials; purchase details and the rest are folded away (22 fields -> 4)", async () => {
    mockApi();
    renderAt();
    expect(await screen.findByRole("heading", { name: "Add Assets" })).toBeInTheDocument();
    await ready();
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
    expect(screen.getByRole("combobox", { name: /^received into$/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^cost centre$/i })).toBeInTheDocument();
    // Folded: nothing of them is on the page until opened.
    for (const label of ["Vendor", "PO No", "Invoice No", "Brand", "Barcode", "Description", "Warranty years"]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /purchase details/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /advanced/i })).toHaveAttribute("aria-expanded", "false");
    // The Item decides group and work area: never asked.
    expect(screen.queryByRole("combobox", { name: /category|sub-category|work area/i })).not.toBeInTheDocument();
    // One company only: no Company picker.
    expect(screen.queryByRole("combobox", { name: /^company$/i })).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/Holder|asset_user|STOCK_POINT/);
  });

  it("the Item shows what it decides in plain words: type, work area and serial number rule", async () => {
    mockApi();
    renderAt();
    await ready();
    fireEvent.click(screen.getByRole("combobox", { name: /^item$/i }));
    // Options carry their group so similar names can be told apart.
    expect(await screen.findByRole("option", { name: /^Laptop\s?· IT Equipment › Laptops$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /^Laptop\s?·/ }));
    const chips = screen.getByLabelText("What the Item decides");
    expect(chips).toHaveTextContent("IT Equipment › Laptops");
    expect(chips).toHaveTextContent("IT Team");
    expect(chips).toHaveTextContent("Has serial number");
    await pick(/^item$/i, "Amplifier");
    expect(screen.getByLabelText("What the Item decides")).toHaveTextContent("Admin / Non-IT Team");
    expect(screen.getByLabelText("What the Item decides")).toHaveTextContent("Serial will be entered later");
  });

  it("Item with a serial: 3 pasted serials go to the server in order, with nothing the Item already decides", async () => {
    mockApi();
    onBatch(batchResult(3));
    renderAt();
    await fillEssentials("Laptop", "3");
    fireEvent.change(screen.getByLabelText("Serial numbers"), { target: { value: "SN-1\r\nSN-2\n\n  SN-3  \n" } });
    await waitFor(() => expect(screen.getByText("3 of 3 entered")).toBeInTheDocument());
    await waitFor(() => expect(addButton()).toBeEnabled());
    expect(addButton()).toHaveTextContent("Add 3 assets");
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toEqual({
      item_id: 11, quantity: 3, received_into_asset_user_id: 4, cost_center_id: 3, serial_numbers: ["SN-1", "SN-2", "SN-3"],
    }));
    expect(apiClient.post).not.toHaveBeenCalledWith("/assets", expect.anything());
  });

  it("a short or long serial list says what is wrong and blocks Add; a serial typed twice marks its rows", async () => {
    mockApi();
    renderAt();
    await fillEssentials("Laptop", "3");
    fireEvent.change(screen.getByLabelText("Serial numbers"), { target: { value: "A1\nB2" } });
    await waitFor(() => expect(whyLine()).toHaveTextContent("3 serial numbers needed, 2 entered."));
    expect(addButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Serial numbers"), { target: { value: "A1\nB2\nC3\nD4" } });
    await waitFor(() => expect(screen.getByText(/1 too many, remove it/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Serial numbers"), { target: { value: "A1\nB2\na1" } });
    await waitFor(() => expect(screen.getByLabelText("Problems with the serial numbers")).toHaveTextContent("A1 is typed more than once (rows 1 and 3)."));
    const gutter = screen.getByTestId("add-serials-gutter");
    expect(gutter.querySelector('[data-row="1"]')).toHaveAttribute("data-problem", "true");
    expect(gutter.querySelector('[data-row="3"]')).toHaveAttribute("data-problem", "true");
    expect(addButton()).toBeDisabled();
  });

  it("a serial CKAM already has is named by the server check, on its row", async () => {
    mockApi({ conflicts: [{ serial: "B2", asset_code: "FA/CK/IT/0007" }] });
    renderAt();
    await fillEssentials("Laptop", "2");
    fireEvent.change(screen.getByLabelText("Serial numbers"), { target: { value: "A1\nB2" } });
    await waitFor(() =>
      expect(screen.getByLabelText("Problems with the serial numbers")).toHaveTextContent('Row 2: Serial "B2" is already used by asset FA/CK/IT/0007.'));
    expect(whyLine()).toHaveTextContent('Row 2: Serial "B2" is already used by asset FA/CK/IT/0007.');
    expect(screen.getByTestId("add-serials-gutter").querySelector('[data-row="2"]')).toHaveAttribute("data-problem", "true");
    expect(addButton()).toBeDisabled();
  });

  it("50 of an Item with no serial: no serial box at all, one request", async () => {
    mockApi();
    onBatch(batchResult(50));
    renderAt();
    await fillEssentials("Mouse", "50");
    expect(screen.queryByLabelText("Serial numbers")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "No serial number" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toEqual({ item_id: 12, quantity: 50, received_into_asset_user_id: 4, cost_center_id: 3 }));
  });

  it("10 whose serials are read later: one line instead of a box; saved as pending", async () => {
    mockApi();
    onBatch(batchResult(10, 10));
    renderAt();
    await fillEssentials("Amplifier", "10");
    expect(screen.getByText("Serial numbers will be entered later from Assets > Serial Pending.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Serial numbers")).not.toBeInTheDocument();
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toEqual({ item_id: 13, quantity: 10, received_into_asset_user_id: 4, cost_center_id: 3 }));
    expect(await screen.findByText("10 serial numbers pending — enter them later from Assets > Serial Pending.")).toBeInTheDocument();
  });

  it("the serial rule can be changed for this batch only, and is then sent", async () => {
    mockApi();
    renderAt();
    await fillEssentials("Laptop", "2");
    fireEvent.click(screen.getByRole("radio", { name: "No serial number" }));
    expect(screen.getByText("Changed for these assets only; the Item says “Has serial number”.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Serial numbers")).not.toBeInTheDocument();
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toMatchObject({ serial_mode: "NO_SERIAL" }));
    expect(lastBatchBody()).not.toHaveProperty("serial_numbers");
  });

  it("an old asset of a serial-later Item can still be given its serial now", async () => {
    mockApi();
    renderAt();
    await fillEssentials("Amplifier");
    fireEvent.click(screen.getByRole("radio", { name: "Has serial number" }));
    fireEvent.change(screen.getByLabelText("Serial numbers"), { target: { value: "AMP-77" } });
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toMatchObject({ serial_mode: "HAS_SERIAL", serial_numbers: ["AMP-77"] }));
  });

  it("the Item's brand and warranty start the Advanced fields; the description defaults to Item + brand + model", async () => {
    mockApi({ items: [item(11, "Laptop", { default_brand_id: 9, default_warranty_years: 3 })] });
    renderAt();
    await fillEssentials("Laptop");
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.getByRole("combobox", { name: /^brand$/i })).toHaveTextContent("Dell");
    expect(screen.getByLabelText("Warranty years")).toHaveValue(3);
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Latitude 5440" } });
    expect(screen.getByLabelText("Description")).toHaveAttribute("placeholder", "Laptop Dell Latitude 5440");
    expect(screen.getByText("Labels use the Asset Code unless a barcode is given here.")).toBeInTheDocument();
  });

  it("Advanced values are sent only when typed; the old asset code only for one asset", async () => {
    mockApi();
    renderAt();
    await fillEssentials("Mouse");
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    await pick(/^brand$/i, "Dell");
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "MS116" } });
    fireEvent.change(screen.getByLabelText("Warranty years"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Black mouse" } });
    fireEvent.change(screen.getByLabelText("Barcode"), { target: { value: "BC-1" } });
    fireEvent.change(screen.getByLabelText("Old asset code"), { target: { value: "OLD-9" } });
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toMatchObject({
      brand_id: 9, model: "MS116", warranty_years: 2, description: "Black mouse", barcode: "BC-1", legacy_asset_code: "OLD-9",
    }));
    cleanup();
    vi.clearAllMocks();
    mockApi();
    renderAt();
    await fillEssentials("Mouse", "2");
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.queryByLabelText("Old asset code")).not.toBeInTheDocument();
  });

  it("Purchase details: every field is optional and sent as typed, with a cost preview", async () => {
    mockApi();
    renderAt();
    await fillEssentials("Mouse", "4");
    fireEvent.click(screen.getByRole("button", { name: /purchase details/i }));
    await pick(/^vendor$/i, "Acme Traders");
    fireEvent.change(screen.getByLabelText("PO No"), { target: { value: "PO-77" } });
    fireEvent.change(screen.getByLabelText("PO Date"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Invoice No"), { target: { value: "INV-9" } });
    fireEvent.change(screen.getByLabelText("Invoice Date"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText("Invoice Amount"), { target: { value: "4720" } });
    fireEvent.change(screen.getByLabelText("Cost per asset"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Tax %"), { target: { value: "18" } });
    expect(screen.getByTestId("tax-amount")).toHaveTextContent("180.00");
    expect(screen.getByTestId("total-cost")).toHaveTextContent("1180.00");
    expect(screen.getByRole("button", { name: /purchase details/i })).toHaveTextContent("8 filled in");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toEqual({
      item_id: 12, quantity: 4, received_into_asset_user_id: 4, cost_center_id: 3, vendor_id: 7, po_number: "PO-77", po_date: "2026-01-01",
      invoice_number: "INV-9", invoice_date: "2026-02-01", invoice_amount: 4720, purchase_cost: 1000, tax_percent: 18,
    }));
  });

  it("an invoice date in the future, or before the PO date, blocks Add with the reason", async () => {
    mockApi();
    renderAt();
    await fillEssentials("Mouse");
    fireEvent.click(screen.getByRole("button", { name: /purchase details/i }));
    fireEvent.change(screen.getByLabelText("Invoice Date"), { target: { value: "2999-01-01" } });
    await waitFor(() => expect(whyLine()).toHaveTextContent("Purchase details: The invoice date cannot be in the future."));
    fireEvent.change(screen.getByLabelText("PO Date"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Invoice Date"), { target: { value: "2026-02-01" } });
    await waitFor(() => expect(whyLine()).toHaveTextContent("The invoice date cannot be before the PO date."));
    expect(addButton()).toBeDisabled();
  });

  it.each([
    ["0", "Enter at least 1."],
    ["1001", "At most 1,000 at a time."],
    ["2.5", "Enter a whole number."],
    ["", "Enter how many (1 to 1,000)."],
  ])("quantity %j is refused before sending: %s", async (value, sentence) => {
    mockApi();
    renderAt();
    await fillEssentials("Mouse");
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value } });
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(whyLine()).toHaveTextContent(`Quantity: ${sentence}`);
    expect(addButton()).toBeDisabled();
    expect(addButton()).toHaveTextContent("Add assets");
  });

  it("the − / + buttons stay between 1 and 1,000", async () => {
    mockApi();
    renderAt();
    await ready();
    expect(screen.getByRole("button", { name: "One less" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "One more" }));
    expect(screen.getByLabelText("Quantity")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "1000" } });
    expect(screen.getByRole("button", { name: "One more" })).toBeDisabled();
  });

  it("says why Add is not possible yet, beside the button, starting with the most important", async () => {
    mockApi({ rooms: [{ id: 4, name: "HO Stock" }, { id: 6, name: "WH Stock" }] });
    renderAt();
    await ready();
    await waitFor(() => expect(whyLine()).toHaveTextContent("Why can't I add? Choose the Item. (2 more things to fix)"));
    await pick(/^item$/i, "Mouse");
    await waitFor(() => expect(whyLine()).toHaveTextContent("Choose where the assets are Received Into. (1 more thing to fix)"));
    await pick(/^received into$/i, "HO Stock");
    await waitFor(() => expect(whyLine()).toHaveTextContent("Choose the Cost Centre."));
    await pick(/^cost centre$/i, "HO01 · Head Office");
    await waitFor(() => expect(whyLine()).toHaveTextContent("Ready. Ctrl+Enter also adds."));
  });

  it("Ctrl+Enter adds when everything is ready; Enter alone never does", async () => {
    mockApi();
    onBatch(batchResult(1));
    renderAt();
    await fillEssentials("Mouse");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.keyDown(screen.getByLabelText("Quantity"), { key: "Enter" });
    expect(apiClient.post).not.toHaveBeenCalledWith("/assets/batch", expect.anything());
    fireEvent.keyDown(screen.getByLabelText("Quantity"), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/batch", expect.anything()));
  });

  it("Ctrl+Enter does nothing while something is missing", async () => {
    mockApi();
    renderAt();
    await ready();
    fireEvent.keyDown(screen.getByLabelText("Quantity"), { key: "Enter", ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(apiClient.post).not.toHaveBeenCalledWith("/assets/batch", expect.anything());
  });
});

describe("Add Assets: extra fields", () => {
  it("required fields stand out, outside the folded parts, with one line why; optional ones are under Advanced", async () => {
    mockApi({ customFields: CUSTOM_FIELDS });
    renderAt();
    await ready();
    const needed = await screen.findByRole("region", { name: "Needed for every asset" });
    expect(within(needed).getByLabelText("Asset Tag")).toBeInTheDocument();
    expect(within(needed).getByText(/asks for these on every asset/)).toBeInTheDocument();
    // Another company's required field never shows (nor blocks).
    expect(screen.queryByLabelText("Other Company Tag")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("RAM (GB)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.getByLabelText("RAM (GB)")).toBeInTheDocument();
    expect(screen.getByLabelText("Refurbished?")).toBeInTheDocument();
  });

  it("a required field blocks Add until filled; every type's value is sent for every asset", async () => {
    mockApi({ customFields: CUSTOM_FIELDS });
    renderAt();
    await fillEssentials("Mouse");
    await waitFor(() => expect(whyLine()).toHaveTextContent("Asset Tag is needed for every asset."));
    expect(addButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Asset Tag"), { target: { value: "TAG-1" } });
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    fireEvent.change(screen.getByLabelText("RAM (GB)"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Delivered On"), { target: { value: "2026-01-05" } });
    await pick(/^color$/i, "Black");
    fireEvent.click(screen.getByLabelText("Refurbished?"));
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toMatchObject({
      custom_fields: { asset_tag: "TAG-1", ram_gb: 16, delivered_on: "2026-01-05", color: "Black", refurbished: true },
    }));
    expect(lastBatchBody().custom_fields).not.toHaveProperty("other_required");
  });

  it("different values per asset: one row per asset, sent as unit_custom_fields (a blank row = the common value)", async () => {
    mockApi({ customFields: CUSTOM_FIELDS.slice(0, 1) });
    renderAt();
    await fillEssentials("Mouse", "3");
    fireEvent.click(screen.getByRole("button", { name: /different values per asset/i }));
    fireEvent.change(screen.getByLabelText(/Asset Tag — one per asset/), { target: { value: "T-1\n\nT-3" } });
    await waitFor(() => expect(whyLine()).toHaveTextContent("Asset Tag is needed for every asset (fill every row or the value above)."));
    fireEvent.change(screen.getByLabelText("Asset Tag"), { target: { value: "T-ALL" } });
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toMatchObject({
      custom_fields: { asset_tag: "T-ALL" },
      unit_custom_fields: [{ asset_tag: "T-1" }, null, { asset_tag: "T-3" }],
    }));
  });

  it("more per-asset values than assets is refused before sending", async () => {
    mockApi({ customFields: CUSTOM_FIELDS.slice(0, 1) });
    renderAt();
    await fillEssentials("Mouse", "2");
    fireEvent.click(screen.getByRole("button", { name: /different values per asset/i }));
    fireEvent.change(screen.getByLabelText(/Asset Tag — one per asset/), { target: { value: "A\nB\nC" } });
    await waitFor(() => expect(whyLine()).toHaveTextContent("Asset Tag: 3 values typed for 2 assets."));
    expect(addButton()).toBeDisabled();
  });
});

describe("Add Assets: answers from the server", () => {
  it("a refused batch (422) is marked on the serial rows and fields, with one summary sentence; nothing typed is lost", async () => {
    mockApi();
    onBatch(new ApiError("Nothing was added: 2 problems need fixing.", 422, {
      detail: "Nothing was added: 2 problems need fixing.",
      problems: [
        { message: "The cost centre HO01 is no longer active." },
        { unit_index: 2, serial: "B2", message: "Serial number B2 is already used by asset FA/CK/IT/0007." },
      ],
    }), true);
    renderAt();
    await fillEssentials("Laptop", "2");
    fireEvent.change(screen.getByLabelText("Serial numbers"), { target: { value: "A1\nB2" } });
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    expect(await screen.findByText("Nothing was added: 2 problems need fixing, marked below. Everything you typed is still here.")).toBeInTheDocument();
    expect(screen.getByLabelText("Problems with Cost Centre")).toHaveTextContent("The cost centre HO01 is no longer active.");
    expect(screen.getByLabelText("Problems with the serial numbers")).toHaveTextContent("Serial number B2 is already used by asset FA/CK/IT/0007.");
    expect(screen.getByTestId("add-serials-gutter").querySelector('[data-row="2"]')).toHaveAttribute("data-problem", "true");
    expect(screen.getByLabelText("Serial numbers")).toHaveValue("A1\nB2");
    // Fixing the serial clears only the serial refusal.
    fireEvent.change(screen.getByLabelText("Serial numbers"), { target: { value: "A1\nC3" } });
    expect(screen.queryByLabelText("Problems with the serial numbers")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Problems with Cost Centre")).toBeInTheDocument();
  });

  it("a refusal about the purchase details opens that part to show it", async () => {
    mockApi();
    onBatch(new ApiError("x", 422, { detail: "x", problems: [{ message: "The vendor Acme Traders is no longer active." }] }), true);
    renderAt();
    await fillEssentials("Mouse");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    expect(await screen.findByLabelText("Problems with the purchase details")).toHaveTextContent("The vendor Acme Traders is no longer active.");
    expect(screen.getByRole("button", { name: /purchase details/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("any other refusal shows the server's sentence (another work area)", async () => {
    mockApi();
    onBatch(new ApiError("This is Non-IT work, which is outside your work area.", 403, { detail: "This is Non-IT work, which is outside your work area." }), true);
    renderAt();
    await fillEssentials("Mouse");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    expect(await screen.findByText("This is Non-IT work, which is outside your work area.")).toBeInTheDocument();
  });

  it("after adding: counts, Print labels for the new assets, Open assets and Add more", async () => {
    mockApi();
    onBatch(batchResult(25, 0));
    const router = renderAt();
    await fillEssentials("Mouse", "25");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    const panel = await screen.findByRole("region", { name: "Added" });
    expect(within(panel).getByText("25 assets created")).toBeInTheDocument();
    expect(within(panel).getByText("Labels ready.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Print labels (25)" })).toBeInTheDocument();
    expect(within(panel).getAllByRole("link").length).toBe(20);
    expect(within(panel).getByText("and 5 more")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Add more" }));
    await ready();
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
    expect(screen.getByRole("combobox", { name: /^item$/i })).toHaveTextContent("Choose the Item");
    // Where they went is remembered.
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^received into$/i })).toHaveTextContent("HO Stock"));
    expect(router.state.location.pathname).toBe("/assets/new");
  });

  it("Open assets shows just the new ones in the register", async () => {
    mockApi();
    onBatch(batchResult(2));
    const router = renderAt();
    await fillEssentials("Mouse", "2");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    fireEvent.click(await screen.findByRole("button", { name: "Open assets" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/assets"));
    expect(router.state.location.search).toEqual({ ids: "500,501" });
  });

  it("S6: Open assets after a big batch carries every id up to 1,000 (no 'first 200' note)", async () => {
    mockApi();
    onBatch(batchResult(450));
    const router = renderAt();
    await fillEssentials("Mouse", "450");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    const panel = await screen.findByRole("region", { name: "Added" });
    expect(within(panel).queryByText(/shows the first/i)).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Open assets" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/assets"));
    expect(String((router.state.location.search as { ids?: string }).ids).split(",")).toHaveLength(450);
  });
});

describe("Add Assets: company, smart defaults and creating what is missing", () => {
  it("Cost Centre and Received Into are this company's; the company is not sent (the server takes it from the cost centre)", async () => {
    mockApi();
    renderAt();
    await ready();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/cost-centers?company_id=1"));
    expect(apiClient.get).toHaveBeenCalledWith("/stock-rooms?company_id=1");
    // Items of this person's own work areas only.
    expect(apiClient.get).toHaveBeenCalledWith("/items?work_area=mine");
    await fillEssentials("Mouse");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await waitFor(() => expect(lastBatchBody()).toBeDefined());
    expect(lastBatchBody()).not.toHaveProperty("company_id");
  });

  it("someone in more than one company picks it first; switching re-scopes Cost Centre and Received Into", async () => {
    (apiClient.get as any).mockImplementation(withCapabilities(HEAD_OFFICE, (path: string) => {
      if (path.startsWith("/items")) return Promise.resolve([MOUSE]);
      if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Company A" }, { id: 2, name: "Company B" }]);
      if (path === "/masters/cost-centers?company_id=1") return Promise.resolve([{ id: 3, name: "A Cost Centre" }]);
      if (path === "/masters/cost-centers?company_id=2") return Promise.resolve([{ id: 30, name: "B Cost Centre" }]);
      if (path === "/stock-rooms?company_id=2") return Promise.resolve([{ id: 40, name: "B Stock" }]);
      if (path.startsWith("/stock-rooms")) return Promise.resolve([{ id: 4, name: "A Stock" }]);
      return Promise.resolve([]);
    }));
    (apiClient.post as any).mockResolvedValue({ conflicts: [] });
    renderAt();
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^company$/i })).toBeInTheDocument());
    await pick(/^cost centre$/i, "A Cost Centre");
    await pick(/^company$/i, "Company B");
    expect(screen.getByRole("combobox", { name: /^cost centre$/i })).not.toHaveTextContent("A Cost Centre");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/cost-centers?company_id=2"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^cost centre$/i })).toBeEnabled());
    await pick(/^cost centre$/i, "B Cost Centre");
    await pick(/^received into$/i, "B Stock");
    expect(screen.getByRole("combobox", { name: /^received into$/i })).toHaveTextContent("B Stock");
  });

  it("the head-office admin (no home company) starts with the first of their companies", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: null, isPrimaryOwner: true, mustChangePassword: false, assetUserId: 5 });
    mockApi({ caps: HEAD_OFFICE, companies: [{ id: 1, name: "Company A" }] });
    renderAt();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/cost-centers?company_id=1"));
  });

  it("remembers the Cost Centre and Received Into used last and starts with them next time", async () => {
    mockApi({
      rooms: [{ id: 4, name: "HO Stock" }, { id: 6, name: "WH Stock" }],
      costCentres: [{ id: 3, code: "HO01", name: "Head Office" }, { id: 8, code: "WH", name: "Warehouse" }],
    });
    onBatch(batchResult(1));
    renderAt();
    await ready();
    await pick(/^item$/i, "Mouse");
    await pick(/^received into$/i, "WH Stock");
    await pick(/^cost centre$/i, "WH · Warehouse");
    await waitFor(() => expect(addButton()).toBeEnabled());
    fireEvent.click(addButton());
    await screen.findByRole("region", { name: "Added" });
    cleanup();
    renderAt();
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^cost centre$/i })).toHaveTextContent("Warehouse"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^received into$/i })).toHaveTextContent("WH Stock"));
  });

  it("a remembered record that no longer exists is quietly forgotten", async () => {
    window.localStorage.setItem("ckam:last-used:5:1", JSON.stringify({ cost_centre: "99", stock_room: "98" }));
    mockApi();
    renderAt();
    await ready();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/stock-rooms?company_id=1"));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("combobox", { name: /^cost centre$/i })).toHaveTextContent("Choose the Cost Centre");
    expect(screen.getByRole("combobox", { name: /^received into$/i })).not.toHaveTextContent("HO Stock");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("no cost centre or stock room yet: says how to add one right here, and Add stays off", async () => {
    mockApi({ costCentres: [], rooms: [] });
    renderAt();
    expect(await screen.findByText("This company has no cost centre yet. Add one with “New Cost Centre…” in the list.")).toBeInTheDocument();
    expect(await screen.findByText("This company has no stock room yet. Add one with “New Stock Room…” in the list.")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  it("someone who may not add them is told who can, instead of a dead end", async () => {
    mockApi({ caps: VIEWER, costCentres: [], rooms: [], vendors: [] });
    renderAt();
    expect(await screen.findByText(`This company has no cost centre yet. ${ASK_TO_ADD.cost_centre}`)).toBeInTheDocument();
    expect(await screen.findByText(`This company has no stock room yet. ${ASK_TO_ADD.stock_room}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /purchase details/i }));
    expect(await screen.findByText(ASK_TO_ADD.vendor)).toBeInTheDocument();
  });

  it.each(KINDS)("%s: the \"+ New …\" entries follow the capabilities", async (_kind, caps) => {
    mockApi({ caps });
    renderAt();
    await ready();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getByRole("button", { name: /purchase details/i }));
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    const entries: [string, RegExp, RegExp][] = [
      ["item", /^item$/i, /new item/i],
      ["cost_centre", /^cost centre$/i, /new cost centre/i],
      ["stock_room", /^received into$/i, /new stock room/i],
      ["vendor", /^vendor$/i, /new vendor/i],
      ["brand", /^brand$/i, /new brand/i],
    ];
    for (const [kind, label, entry] of entries) {
      const allowed = (caps.can_create as Record<string, boolean | undefined>)[kind] === true;
      const trigger = screen.getByRole("combobox", { name: label });
      fireEvent.click(trigger);
      if (allowed) expect(await screen.findByRole("option", { name: entry })).toBeInTheDocument();
      else {
        await new Promise((r) => setTimeout(r, 10));
        expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument();
      }
      fireEvent.click(trigger);
      await waitFor(() => expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument());
    }
  });

  it("no \"New Item…\" while it cannot be told whether this person may add one (capabilities failed)", async () => {
    mockApi({ caps: null });
    renderAt();
    await ready();
    fireEvent.click(screen.getByRole("combobox", { name: /^item$/i }));
    await screen.findByRole("option", { name: /^Laptop\b/ });
    expect(screen.queryByRole("option", { name: /new item/i })).not.toBeInTheDocument();
  });

  it("a new Item made right here is picked at once, with its rule", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false, assetUserId: 5 });
    mockApi({ caps: HEAD_OFFICE });
    (apiClient.post as any).mockImplementation((path: string) =>
      path === "/items"
        ? Promise.resolve(item(14, "Ceiling Fan", { serial_required: false, category_name: "IT Equipment", subcategory_name: "Laptops" }))
        : Promise.resolve({ conflicts: [] }));
    renderAt();
    await ready();
    fireEvent.click(screen.getByRole("combobox", { name: /^item$/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new item/i }));
    const dialog = await screen.findByRole("dialog", { name: /new item/i });
    fireEvent.change(within(dialog).getByLabelText(/item name/i), { target: { value: "Ceiling Fan" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: /type of asset/i }));
    fireEvent.click(await screen.findByRole("option", { name: /^IT Equipment › Laptops/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({ name: "Ceiling Fan" })));
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toHaveTextContent("Ceiling Fan"));
    expect(screen.getByLabelText("What the Item decides")).toHaveTextContent("No serial number");
  });

  it("a new vendor is made from the name only, picked at once, and the form keeps everything typed", async () => {
    const vendors: { id: number; name: string }[] = [{ id: 7, name: "Acme Traders" }];
    mockApi({ vendors });
    (apiClient.post as any).mockImplementation((path: string, body: { name: string }) => {
      if (path === "/purchase-orders/check-serials") return Promise.resolve({ conflicts: [] });
      const row = { id: 31, ...body };
      if (path === "/masters/vendors") vendors.push(row);
      return Promise.resolve(row);
    });
    renderAt();
    await fillEssentials("Mouse", "6");
    fireEvent.click(screen.getByRole("button", { name: /purchase details/i }));
    fireEvent.click(screen.getByRole("combobox", { name: /^vendor$/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new vendor/i }));
    const dialog = await screen.findByRole("dialog", { name: /new vendor/i });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Vansh Enterprises" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", expect.objectContaining({ name: "Vansh Enterprises" })));
    expect((apiClient.post as any).mock.calls.find(([p]: [string]) => p === "/masters/vendors")[1]).not.toHaveProperty("code");
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^vendor$/i })).toHaveTextContent("Vansh Enterprises"));
    expect(screen.getByLabelText("Quantity")).toHaveValue(6);
  });

  it("a new stock room (in a new place) is made for this company and becomes Received Into", async () => {
    const rooms: Record<string, unknown>[] = [];
    mockApi({ rooms });
    (apiClient.post as any).mockImplementation((path: string, body: Record<string, unknown>) => {
      const row = { id: 88, name: body.name, location_name: body.location_name, company_code: "CKSPL", company_id: 1 };
      if (path === "/stock-rooms") rooms.push(row);
      return Promise.resolve(row);
    });
    renderAt();
    await ready();
    fireEvent.click(screen.getByRole("combobox", { name: /^received into$/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new stock room/i }));
    const dialog = await screen.findByRole("dialog", { name: /new stock room/i });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Farukhnagar Stock" } });
    fireEvent.change(await within(dialog).findByLabelText(/new place name/i), { target: { value: "Farukhnagar Warehouse" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", {
      name: "Farukhnagar Stock", company_id: 1, location_name: "Farukhnagar Warehouse",
    }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^received into$/i })).toHaveTextContent("Farukhnagar Stock"));
  });

  it("a load failure says so, with Try again", async () => {
    (apiClient.get as any).mockImplementation(withCapabilities(ADMIN_BOTH, (path: string) =>
      path.startsWith("/items") ? Promise.reject(new Error("down")) : Promise.resolve([])));
    renderAt();
    expect(await screen.findByText("Couldn't load what this form needs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("a viewer cannot open Add Assets", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "VIEWER", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    mockApi({ caps: VIEWER });
    renderAt();
    expect(await screen.findByText("You don't have access to this area.")).toBeInTheDocument();
  });
});
