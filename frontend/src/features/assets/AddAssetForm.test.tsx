import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { ASK_TO_ADD, type Capabilities } from "../../lib/capabilities";
import { ADMIN_BOTH, HEAD_OFFICE, KINDS, VIEWER, withCapabilities } from "../../test-capabilities";

vi.mock("../../lib/api-client");

// AddAssetForm navigates to the new asset's Asset 360 on a single-asset
// create (AM-04 §12), so it needs a real RouterProvider ancestor -- render
// it through the actual route tree at /assets/new, same pattern
// AssetRegister.test.tsx and router.test.tsx already use.
function renderFormAt(url = "/assets/new") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, category_id: 1, subcategory_id: 2, serial_required: true, bundle_id: null,
  default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0, ...over,
});

const CUSTOM_FIELDS = [
  { id: 1, field_key: "asset_tag", label: "Asset Tag", field_type: "text", options: null, is_required: true, sort_order: 1, company_id: null },
  { id: 2, field_key: "ram_gb", label: "RAM (GB)", field_type: "number", options: null, is_required: false, sort_order: 2, company_id: null },
  { id: 3, field_key: "delivered_on", label: "Delivered On", field_type: "date", options: null, is_required: false, sort_order: 3, company_id: null },
  { id: 4, field_key: "color", label: "Color", field_type: "dropdown", options: { choices: ["Black", "Silver"] }, is_required: false, sort_order: 4, company_id: null },
  { id: 5, field_key: "refurbished", label: "Refurbished?", field_type: "checkbox", options: null, is_required: false, sort_order: 5, company_id: null },
];

function mockGets({
  asset_users = [{ id: 4, name: "IT Stock-HO" }] as unknown[], customFields = [] as unknown[],
  categories = [{ id: 1, code: "IT", name: "IT Equipment", asset_domain: "IT" }] as unknown[],
  subcategories = [{ id: 2, code: "LAP", name: "Laptop", category_id: 1 }] as unknown[],
  items = [item(11, "Laptop")] as unknown[],
  locations = [] as unknown[],
  caps = ADMIN_BOTH as Capabilities | null,
  vendors = [{ id: 7, code: "VND1", name: "Acme Traders" }] as unknown[],
  costCentres = [{ id: 3, code: "HO01", name: "Head Office" }] as unknown[],
} = {}) {
  (apiClient.get as any).mockImplementation(withCapabilities(caps, (path: string) => {
    if (path === "/items") return Promise.resolve(items);
    // Received Into lists the company's stock rooms (S3b-1: GET /stock-rooms).
    if (path.startsWith("/stock-rooms")) return Promise.resolve(asset_users);
    if (path === "/masters/locations") return Promise.resolve(locations);
    if (path.startsWith("/masters/categories")) return Promise.resolve(categories);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve(subcategories);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve(costCentres);
    if (path.startsWith("/masters/vendors")) return Promise.resolve(vendors);
    if (path.startsWith("/masters/brands")) return Promise.resolve([{ id: 9, code: "DELL", name: "Dell" }]);
    if (path.startsWith("/masters/custom-fields")) return Promise.resolve(customFields);
    if (path.startsWith("/asset-users")) return Promise.resolve(asset_users);
    return Promise.resolve([]);
  }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A dropdown option now reads "label · context" (e.g. "Laptop · IT
// Equipment"). jsdom drops the space before the muted " · context" span when
// it computes the accessible name, so the matchers allow either spacing.
function optionName(label: string, detail?: string): RegExp {
  const tail = detail === undefined ? "(\\s?· .*)?" : `\\s?· ${escapeRe(detail)}`;
  return new RegExp(`^${escapeRe(label)}${tail}$`);
}

// A plain string picks the option whose label it is, with or without context.
async function pickSelectOption(label: RegExp | string, name: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: typeof name === "string" ? optionName(name) : name });
  fireEvent.click(option);
}

// Item/Vendor/Serial Number are mandatory (docs/ai/DECISIONS.md);
// PO/Invoice/PI are optional as of AM-19 but filled in here anyway for
// tests that want a fully-populated form, not just the minimum Save needs.
// Every test that expects Save to become enabled needs at least the
// mandatory subset filled, on top of whatever Category/Cost Centre/AssetUser
// selection it already makes. The Serial Number label query is anchored
// (^...$) because an unanchored /serial number/i also matches the "No
// serial number" checkbox's own aria-label.
async function fillMandatoryProcurementFields() {
  await pickSelectOption(/^vendor$/i, "Acme Traders");
  fireEvent.change(screen.getByLabelText(/po number/i), { target: { value: "PO-1" } });
  fireEvent.change(screen.getByLabelText(/po date/i), { target: { value: "2025-06-01" } });
  fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: "INV-1" } });
  fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: "2025-06-02" } });
  fireEvent.change(screen.getByLabelText(/purchase invoice \(pi\) number/i), { target: { value: "PI-1" } });
  fireEvent.change(screen.getByLabelText(/pi date/i), { target: { value: "2025-06-03" } });
  fireEvent.change(screen.getByLabelText(/^serial number\*?$/i), { target: { value: "SN-1" } });
  fireEvent.change(screen.getByLabelText(/^barcode$/i), { target: { value: "BC-1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});

afterEach(() => useAuthStore.getState().logout());

describe("AddAssetForm", () => {
  it("renders procurement fields (vendor, PO, invoice, PI Number, warranty) and submits them", async () => {
    // Resolves with 2 created assets (not 1) purely so this test doesn't
    // trigger the single-asset navigate-to-Asset-360 flow -- it only cares
    // about the POST payload, not what happens after.
    mockGets();
    (apiClient.post as any).mockResolvedValue([
      { id: 20, asset_code: "FA/HO01/IT/LAP/CK_1" },
      { id: 21, asset_code: "FA/HO01/IT/LAP/CK_2" },
    ]);

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");
    await pickSelectOption(/^vendor$/i, "Acme Traders");
    await pickSelectOption(/^brand$/i, "Dell");

    fireEvent.change(screen.getByLabelText(/po number/i), { target: { value: "PO-1" } });
    fireEvent.change(screen.getByLabelText(/po date/i), { target: { value: "2025-06-01" } });
    fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: "INV-1" } });
    fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: "2025-06-02" } });
    fireEvent.change(screen.getByLabelText(/purchase invoice \(pi\) number/i), { target: { value: "PI-1" } });
    fireEvent.change(screen.getByLabelText(/pi date/i), { target: { value: "2025-06-03" } });
    fireEvent.change(screen.getByLabelText(/warranty years/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^serial number\*?$/i), { target: { value: "SN-1" } });
    fireEvent.change(screen.getByLabelText(/^barcode$/i), { target: { value: "BC-1" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/assets",
        expect.objectContaining({
          vendor_id: 7, brand_id: 9, po_number: "PO-1", po_date: "2025-06-01",
          invoice_number: "INV-1", invoice_date: "2025-06-02",
          pi_number: "PI-1", pi_date: "2025-06-03", warranty_years: 3,
          serial_number: "SN-1", barcode: "BC-1", item_id: 11,
        }),
      ),
    );
    // The server derives Category and Sub-Category from the Item; the form no longer sends them.
    expect(apiClient.post).not.toHaveBeenCalledWith("/assets", expect.objectContaining({ category_id: expect.anything() }));
  });

  it("checking \"No serial number\" disables the input and submits \"N/A\"", async () => {
    mockGets();
    // 2 created assets (not 1), purely so this test doesn't trigger the
    // single-asset navigate-to-Asset-360 flow -- it only cares about the
    // POST payload.
    (apiClient.post as any).mockResolvedValue([
      { id: 42, asset_code: "FA/HO01/IT/LAP/CK_42" },
      { id: 43, asset_code: "FA/HO01/IT/LAP/CK_43" },
    ]);

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Mouse" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");
    await fillMandatoryProcurementFields();

    const serialInput = screen.getByLabelText(/^serial number\*?$/i);
    fireEvent.change(serialInput, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /no serial number/i }));
    expect(serialInput).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/assets", expect.objectContaining({ serial_number: "N/A" })),
    );
  });

  it("the Item's serial setting sets the \"No serial number\" box when it is picked, and it can still be changed", async () => {
    mockGets({
      items: [
        item(11, "Laptop"),                                   // has a serial
        item(12, "Mouse", { serial_required: false }),        // none
        item(13, "Patch cord", { serial_required: false }),
      ],
    });
    renderFormAt();
    const noSerial = () => screen.getByRole("checkbox", { name: /no serial number/i });
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());

    await pickSelectOption(/^item$/i, "Laptop");
    expect(noSerial()).not.toBeChecked();                          // a serial is expected
    await pickSelectOption(/^item$/i, "Mouse");
    expect(noSerial()).toBeChecked();                              // the Mouse Item says no
    expect(screen.getByLabelText(/^serial number\*?$/i)).toBeDisabled();
    await pickSelectOption(/^item$/i, "Laptop");
    expect(noSerial()).not.toBeChecked();                          // back to a serial

    fireEvent.click(noSerial());                                   // still the user's call
    expect(noSerial()).toBeChecked();
    fireEvent.click(noSerial());
    expect(noSerial()).not.toBeChecked();
    expect(screen.getByLabelText(/^serial number\*?$/i)).toBeEnabled();
  });

  it("an Item whose serial is read later starts with 'add it later' ticked and saves the asset as pending", async () => {
    mockGets({ items: [item(11, "Amplifier", { serial_later: true })] });
    (apiClient.post as any).mockResolvedValue([
      { id: 20, asset_code: "FA/HO01/IT/AMP/CK_1" },
      { id: 21, asset_code: "FA/HO01/IT/AMP/CK_2" },
    ]);
    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Amplifier" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
    await pickSelectOption(/^item$/i, "Amplifier");
    const later = () => screen.getByRole("checkbox", { name: /serial number will be added later/i });
    expect(later()).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /no serial number/i })).not.toBeChecked();      // pending is not N/A
    expect(screen.getByLabelText(/^serial number\*?$/i)).toBeDisabled();

    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");
    await pickSelectOption(/^vendor$/i, "Acme Traders");
    fireEvent.change(screen.getByLabelText(/^barcode$/i), { target: { value: "BC-1" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/assets", expect.objectContaining({ serial_number: null, serial_pending: true, item_id: 11 })),
    );
  });

  it("an old asset of a serial-later Item can still be given a real serial or 'no serial'", async () => {
    mockGets({ items: [item(11, "Amplifier", { serial_later: true })] });
    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
    await pickSelectOption(/^item$/i, "Amplifier");
    fireEvent.click(screen.getByRole("checkbox", { name: /serial number will be added later/i }));     // untick: type it now
    expect(screen.getByLabelText(/^serial number\*?$/i)).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /no serial number/i }));
    expect(screen.getByRole("checkbox", { name: /serial number will be added later/i })).not.toBeChecked();
  });

  it("an Item's default brand and warranty fill the form when it is picked", async () => {
    mockGets({ items: [item(11, "Laptop", { default_brand_id: 9, default_warranty_years: 3 })] });
    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
    await pickSelectOption(/^item$/i, "Laptop");
    expect(screen.getByRole("combobox", { name: /^brand$/i })).toHaveTextContent("Dell");
    expect(screen.getByLabelText(/warranty years/i)).toHaveValue(3);
  });

  it("shows the Item's Category and Sub-category and the Work area that follows", async () => {
    mockGets();
    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
    await pickSelectOption(/^item$/i, "Laptop");
    expect(screen.getByText(/IT Equipment › Laptop/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^work area$/i)).toHaveValue("IT Team");
    expect(screen.queryByText(/responsibility/i)).not.toBeInTheDocument();
  });

  it("Item options show their Category so similar names can be told apart", async () => {
    mockGets();
    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("combobox", { name: /^item$/i }));
    expect(await screen.findByRole("option", { name: optionName("Laptop", "IT Equipment") })).toBeInTheDocument();
  });

  it("asks where the asset is Received Into, listing the company's Stock Rooms with place and company", async () => {
    mockGets({
      asset_users: [{ id: 4, name: "HO Stock", code: "STK-HO", location_id: 50, location_name: "Head Office", company_code: "CKSPL", company_id: 1 }],
    });
    renderFormAt();
    await screen.findByLabelText(/description/i);
    expect(screen.getByText("Where it is received")).toBeInTheDocument();
    expect(screen.queryByText(/goes into|initial custody/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^received into$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("combobox", { name: /^received into$/i }));
    // A Stock Room reads by its name (not its machine code) plus its place and company code.
    expect(await screen.findByRole("option", { name: optionName("HO Stock", "Head Office · CKSPL") })).toBeInTheDocument();
    // From the stock-rooms endpoint, for this company -- not people filtered by type.
    expect(apiClient.get).toHaveBeenCalledWith("/stock-rooms?company_id=1");
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining("asset_user_type=STOCK_POINT"));
  });

  it("offers no \"New Item…\" while it cannot be told whether this person may add one (capabilities failed)", async () => {
    mockGets({ caps: null });
    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("combobox", { name: /^item$/i }));
    await screen.findByRole("option", { name: /^Laptop\b/ });
    expect(screen.queryByRole("option", { name: /new item/i })).not.toBeInTheDocument();
  });

  it("the head-office admin can create the Item right from here and it is picked", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    mockGets({ caps: HEAD_OFFICE });
    (apiClient.post as any).mockResolvedValue(item(14, "Ceiling Fan", { serial_required: false }));
    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("combobox", { name: /^item$/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new item/i }));

    const dialog = await screen.findByRole("dialog", { name: /new item/i });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: "Ceiling Fan" } });
    // One "Type of asset" pick (group › Sub-category), not two dropdowns.
    fireEvent.click(screen.getByRole("combobox", { name: /type of asset/i }));
    fireEvent.click(await screen.findByRole("option", { name: /^IT Equipment › Laptop/ }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({
        name: "Ceiling Fan", category_id: 1, subcategory_id: 2, serial_required: true,
      })),
    );
  });

  it("renders dynamic custom fields in sort order, one control per type, and submits their values", async () => {
    mockGets({ customFields: CUSTOM_FIELDS });
    (apiClient.post as any).mockResolvedValue([
      { id: 20, asset_code: "FA/HO01/IT/LAP/CK_1" },
      { id: 21, asset_code: "FA/HO01/IT/LAP/CK_2" },
    ]);

    renderFormAt();
    await screen.findByLabelText(/description/i);
    await screen.findByText("Asset Tag");

    // sort_order: Asset Tag, RAM (GB), Delivered On, Color, Refurbished?
    // (Asset Tag is required, so its label also carries a trailing "*" marker.)
    const labels = screen.getAllByText(/^(Asset Tag\*?|RAM \(GB\)|Delivered On|Color|Refurbished\?)$/);
    expect(labels.map((l) => l.textContent)).toEqual(["Asset Tag*", "RAM (GB)", "Delivered On", "Color", "Refurbished?"]);

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");
    await fillMandatoryProcurementFields();

    fireEvent.change(screen.getByLabelText(/asset tag/i), { target: { value: "TAG-1" } });
    fireEvent.change(screen.getByLabelText(/ram \(gb\)/i), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText(/delivered on/i), { target: { value: "2025-06-05" } });
    await pickSelectOption(/^color$/i, "Black");
    fireEvent.click(screen.getByLabelText(/refurbished\?/i));

    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/assets",
        expect.objectContaining({
          custom_fields: {
            asset_tag: "TAG-1", ram_gb: 16, delivered_on: "2025-06-05", color: "Black", refurbished: true,
          },
        }),
      ),
    );
  });

  it("blocks Save and shows an error when a required custom field is missing", async () => {
    mockGets({ customFields: CUSTOM_FIELDS });

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");
    await fillMandatoryProcurementFields();

    // Asset Tag (required) was never filled in.
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(screen.getByText(/asset tag is required/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/asset tag/i), { target: { value: "TAG-1" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
  });

  it("AM-05: only Global and this company's own custom fields render -- another company's required field never blocks Save", async () => {
    // useAuthStore companyId is 1 (see beforeEach).
    const scopedFields = [
      { id: 1, field_key: "global_notes", label: "Global Notes", field_type: "text", options: null, is_required: false, sort_order: 1, company_id: null },
      { id: 2, field_key: "own_company_tag", label: "Own Company Tag", field_type: "text", options: null, is_required: false, sort_order: 2, company_id: 1 },
      { id: 3, field_key: "other_company_required", label: "Other Company Required", field_type: "text", options: null, is_required: true, sort_order: 3, company_id: 2 },
    ];
    mockGets({ customFields: scopedFields });
    (apiClient.post as any).mockResolvedValue([
      { id: 20, asset_code: "FA/HO01/IT/LAP/CK_1" },
      { id: 21, asset_code: "FA/HO01/IT/LAP/CK_2" },
    ]);

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");
    await fillMandatoryProcurementFields();

    expect(await screen.findByText("Global Notes")).toBeInTheDocument();
    expect(screen.getByText("Own Company Tag")).toBeInTheDocument();
    expect(screen.queryByText("Other Company Required")).not.toBeInTheDocument();

    // Company 2's required field must never block a Company 1 asset from saving.
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/assets",
        expect.objectContaining({ custom_fields: expect.not.objectContaining({ other_company_required: expect.anything() }) }),
      ),
    );
  });

  it("navigates to the new asset's Asset 360 page after a single-asset creation", async () => {
    mockGets();
    (apiClient.post as any).mockResolvedValue([{ id: 42, asset_code: "FA/HO01/IT/LAP/CK_42" }]);
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/42") {
        return Promise.resolve({
          id: 42, asset_code: "FA/HO01/IT/LAP/CK_42", legacy_asset_code: null, description: "Test Laptop",
          status: "IN_STOCK", company_id: 1, cost_center_id: 3, category_id: 1, subcategory_id: null,
          brand_id: null, model: null, serial_number: null, vendor_id: null, po_number: null, po_date: null,
          invoice_number: null, invoice_date: null, pi_number: null, pi_date: null, purchase_cost: 0,
          tax_percent: 0, tax_amount: 0, total_cost: 0, purchase_date: "2025-06-01", warranty_upto: null,
          current_asset_user_id: 4, status_since: "2025-06-01", custom_fields: {},
          category_name: "IT Equipment", subcategory_name: null, cost_center_name: "Head Office", vendor_name: null,
          brand_name: null,
          current_asset_user_name: "IT Stock-HO", current_asset_user_type: "STOCK_POINT", location_name: null, department_name: null,
        });
      }
      if (path === "/items") return Promise.resolve([item(11, "Laptop")]);
      if (path === "/assets/42/events") return Promise.resolve([]);
      if (path === "/assets/42/changes") return Promise.resolve([]);
      if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment" }]);
      if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, code: "LAP", name: "Laptop", category_id: 1 }]);
      if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, code: "HO01", name: "Head Office" }]);
      if (path.startsWith("/masters/vendors")) return Promise.resolve([{ id: 7, code: "VND1", name: "Acme Traders" }]);
      if (path.startsWith("/masters/custom-fields")) return Promise.resolve([]);
      if (path.startsWith("/stock-rooms")) return Promise.resolve([{ id: 4, name: "IT Stock-HO" }]);
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 4, name: "IT Stock-HO" }]);
      return Promise.resolve([]);
    });
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;

    const router = renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");
    await fillMandatoryProcurementFields();

    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/assets/42"));
    expect(await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_42" })).toBeInTheDocument();
  });

  it("shows a server validation error instead of crashing", async () => {
    mockGets();
    (apiClient.post as any).mockRejectedValue(new Error("cost center must belong to the same company as the asset"));

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");
    await fillMandatoryProcurementFields();

    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/cost center must belong to the same company/i)).toBeInTheDocument();
  });

  it("computes a tax preview live", async () => {
    mockGets();
    renderFormAt();

    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    fireEvent.change(screen.getByLabelText(/purchase cost/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/tax %/i), { target: { value: "18" } });

    expect(screen.getByTestId("tax-amount")).toHaveTextContent("180.00");
    expect(screen.getByTestId("total-cost")).toHaveTextContent("1180.00");
  });

  it("AM-19: has no Quantity field -- every save creates exactly one asset", async () => {
    mockGets();
    renderFormAt();
    await screen.findByLabelText(/description/i);
    expect(screen.queryByLabelText(/quantity/i)).not.toBeInTheDocument();
  });

  it("AM-19: PO/Invoice/PI No+Date are optional -- Save is enabled without them", async () => {
    mockGets();
    (apiClient.post as any).mockResolvedValue([{ id: 10, asset_code: "FA/HO01/IT/LAP/CK_1" }]);
    const router = renderFormAt();

    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "No Paperwork Yet" } });
    fireEvent.change(screen.getByLabelText(/^serial number\*?$/i), { target: { value: "SN-1" } });
    fireEvent.change(screen.getByLabelText(/^barcode$/i), { target: { value: "BC-1" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/^vendor$/i, "Acme Traders");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));
    await pickSelectOption(/received into/i, "IT Stock-HO");

    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/assets/10"));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/assets",
      expect.objectContaining({
        po_number: null, po_date: null, invoice_number: null, invoice_date: null,
        invoice_amount: null, pi_number: null, pi_date: null,
      }),
    );
    expect(apiClient.post).not.toHaveBeenCalledWith("/assets", expect.objectContaining({ quantity: expect.anything() }));
  });

  it("AM-08: requests Cost Centre options scoped to this asset's own company", async () => {
    mockGets();
    renderFormAt();
    await screen.findByLabelText(/description/i);

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringMatching(/^\/masters\/cost-centers\?company_id=1$/)),
    );
  });

  it("AM-08: does not submit when the company has no cost centre, and offers to add one right here", async () => {
    mockGets({ costCentres: [] });

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("/masters/cost-centers")));
    expect(await screen.findByText("This company has no cost centre yet. Add one with “New Cost Centre…” in the list.")).toBeInTheDocument();
    // The old dead end ("Ask the head-office admin … under Settings › Organisation") is gone.
    expect(screen.queryByText(/settings › organisation/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("does not submit while the company has no stock room, and offers to add one right here", async () => {
    mockGets({ asset_users: [] });

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/stock-rooms?company_id=1"));

    expect(await screen.findByText("This company has no stock room yet. Add one with “New Stock Room…” in the list.")).toBeInTheDocument();
    expect(screen.queryByText(/people & places › stock rooms/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("leaves the Initial AssetUser select blank when the company has more than one IT_STOCK asset_user, and blocks Save until one is explicitly picked", async () => {
    mockGets({ asset_users: [{ id: 4, name: "IT Stock-HO" }, { id: 5, name: "IT Stock-WH-F" }] });
    // 2 created assets (not 1), purely so clicking Save at the end of this
    // test doesn't trigger the single-asset navigate-to-Asset-360 flow.
    (apiClient.post as any).mockResolvedValue([
      { id: 20, asset_code: "FA/HO01/IT/LAP/CK_1" },
      { id: 21, asset_code: "FA/HO01/IT/LAP/CK_2" },
    ]);

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/cost centre/i, optionName("HO01 · Head Office"));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("/stock-rooms")));

    // Neither of the two asset_users is pre-selected -- the combobox still shows
    // its placeholder, and clicking Save without a pick must not submit.
    const assetUserCombobox = screen.getByRole("combobox", { name: /received into/i });
    expect(assetUserCombobox).not.toHaveTextContent("IT Stock-HO");
    expect(assetUserCombobox).not.toHaveTextContent("IT Stock-WH-F");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(apiClient.post).not.toHaveBeenCalled();

    await pickSelectOption(/received into/i, "IT Stock-WH-F");
    await fillMandatoryProcurementFields();
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/assets", expect.objectContaining({ initial_asset_user_id: 5 })),
    );
  });

  it("AM-24: shows a Company picker when the caller has access to more than one, and re-scopes Cost Centre on switch", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/items") return Promise.resolve([item(11, "Laptop")]);
      if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Company A" }, { id: 2, name: "Company B" }]);
      if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment" }]);
      if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, code: "LAP", name: "Laptop", category_id: 1 }]);
      if (path.startsWith("/masters/cost-centers?company_id=1")) return Promise.resolve([{ id: 3, name: "A Cost Centre" }]);
      if (path.startsWith("/masters/cost-centers?company_id=2")) return Promise.resolve([{ id: 30, name: "B Cost Centre" }]);
      if (path.startsWith("/masters/vendors")) return Promise.resolve([{ id: 7, name: "Acme Traders" }]);
      if (path.startsWith("/masters/custom-fields")) return Promise.resolve([]);
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 4, name: "IT Stock-HO" }]);
      return Promise.resolve([]);
    });
    renderFormAt();

    await waitFor(() => expect(screen.getByRole("combobox", { name: /^company$/i })).toBeInTheDocument());
    await pickSelectOption(/^cost centre$/i, "A Cost Centre");
    expect(screen.getByRole("combobox", { name: /^cost centre$/i })).toHaveTextContent("A Cost Centre");

    await pickSelectOption(/^company$/i, "Company B");

    // Switching company resets the now-stale Cost Centre selection and
    // refetches Cost Centre options scoped to the newly chosen company.
    expect(screen.getByRole("combobox", { name: /^cost centre$/i })).not.toHaveTextContent("A Cost Centre");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/cost-centers?company_id=2"));
    await pickSelectOption(/^cost centre$/i, "B Cost Centre");
    expect(screen.getByRole("combobox", { name: /^cost centre$/i })).toHaveTextContent("B Cost Centre");
  });
});

// ---------------------------------------------------------------------------
// S3b-1: create the missing small record right here, as the capabilities allow.
// The route guard lets ADMIN in; what is offered depends only on what
// GET /auth/capabilities answers for the kind of login under test.
// ---------------------------------------------------------------------------

const CREATE_ENTRIES: [string, RegExp, RegExp][] = [
  ["vendor", /^vendor$/i, /new vendor/i],
  ["brand", /^brand$/i, /new brand/i],
  ["item", /^item$/i, /new item/i],
  ["cost_centre", /^cost centre$/i, /new cost centre/i],
  ["stock_room", /^received into$/i, /new stock room/i],
];

describe("S3b-1: inline creation on Add Asset", () => {
  beforeEach(() => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5 });
  });

  it.each(KINDS)("%s: the \"+ New …\" entries follow the capabilities", async (_kind, caps) => {
    mockGets({ caps });
    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^item$/i })).toBeEnabled());
    // Wait for the answer: the Item picker's "New Item…" (or, without it, the type note in an opened Item list).
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    for (const [kind, label, entry] of CREATE_ENTRIES) {
      const allowed = caps.can_create[kind as keyof typeof caps.can_create] === true;
      const trigger = screen.getByRole("combobox", { name: label });
      fireEvent.click(trigger);
      if (allowed) {
        expect(await screen.findByRole("option", { name: entry })).toBeInTheDocument();
      } else {
        await new Promise((r) => setTimeout(r, 10));
        expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument();
      }
      fireEvent.click(trigger);
      await waitFor(() => expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument());
    }
  });

  it("a new vendor is made from the name only (no code), picked at once, and the form keeps everything typed", async () => {
    const vendors: { id: number; name: string }[] = [{ id: 7, name: "Acme Traders" }];
    mockGets({ vendors });
    (apiClient.post as any).mockImplementation((path: string, body: { name: string }) => {
      const row = { id: 31, ...body };
      if (path === "/masters/vendors") vendors.push(row);
      return Promise.resolve(row);
    });
    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    fireEvent.click(screen.getByRole("combobox", { name: /^vendor$/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new vendor/i }));
    const dialog = await screen.findByRole("dialog", { name: /new vendor/i });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Vansh Enterprises" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", expect.objectContaining({ name: "Vansh Enterprises" })));
    expect((apiClient.post as any).mock.calls[0][1]).not.toHaveProperty("code");
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^vendor$/i })).toHaveTextContent("Vansh Enterprises"));
    expect(screen.queryByRole("dialog", { name: /new vendor/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toHaveValue("Test Laptop");        // still on the same task
  });

  it("a new stock room (in a new place) is made for this company and becomes Received Into", async () => {
    const rooms: Record<string, unknown>[] = [];
    mockGets({ asset_users: rooms });
    (apiClient.post as any).mockImplementation((path: string, body: Record<string, unknown>) => {
      const row = { id: 88, name: body.name, location_name: body.location_name, company_code: "CKSPL", company_id: 1 };
      if (path === "/stock-rooms") rooms.push(row);
      return Promise.resolve(row);
    });
    renderFormAt();
    await screen.findByLabelText(/description/i);
    expect(await screen.findByText("This company has no stock room yet. Add one with “New Stock Room…” in the list.")).toBeInTheDocument();
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

  it("someone who may not add a vendor, cost centre or stock room is told who can, instead of a dead end", async () => {
    mockGets({ caps: VIEWER, costCentres: [], vendors: [], asset_users: [] });
    renderFormAt();
    expect(await screen.findByText(`This company has no cost centre yet. ${ASK_TO_ADD.cost_centre}`)).toBeInTheDocument();
    expect(await screen.findByText(`This company has no stock room yet. ${ASK_TO_ADD.stock_room}`)).toBeInTheDocument();
    expect(await screen.findByText(ASK_TO_ADD.vendor)).toBeInTheDocument();
  });

  it("remembers the Cost Centre and stock room used last (per person and company) and starts with them next time", async () => {
    mockGets({
      asset_users: [{ id: 4, name: "IT Stock-HO" }, { id: 5, name: "IT Stock-WH" }],
      costCentres: [{ id: 3, code: "HO01", name: "Head Office" }, { id: 6, code: "WH", name: "Warehouse" }],
    });
    (apiClient.post as any).mockResolvedValue([{ id: 20, asset_code: "A1" }, { id: 21, asset_code: "A2" }]);
    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^item$/i, "Laptop");
    await pickSelectOption(/^cost centre$/i, optionName("WH · Warehouse"));
    await pickSelectOption(/^received into$/i, "IT Stock-WH");
    await fillMandatoryProcurementFields();
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets", expect.objectContaining({ cost_center_id: 6, initial_asset_user_id: 5 })));
    cleanup();

    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^cost centre$/i })).toHaveTextContent("Warehouse"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^received into$/i })).toHaveTextContent("IT Stock-WH"));
  });

  it("a remembered record that no longer exists is quietly forgotten", async () => {
    window.localStorage.setItem("ckam:last-used:5:1", JSON.stringify({ cost_centre: "99", stock_room: "98" }));
    mockGets();
    renderFormAt();
    await screen.findByLabelText(/description/i);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/stock-rooms?company_id=1"));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("combobox", { name: /^cost centre$/i })).not.toHaveTextContent("Head Office");
    expect(screen.getByRole("combobox", { name: /^received into$/i })).not.toHaveTextContent("IT Stock-HO");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
