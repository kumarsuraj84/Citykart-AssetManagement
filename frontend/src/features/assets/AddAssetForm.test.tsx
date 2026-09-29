import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

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

const CUSTOM_FIELDS = [
  { id: 1, field_key: "asset_tag", label: "Asset Tag", field_type: "text", options: null, is_required: true, sort_order: 1, company_id: null },
  { id: 2, field_key: "ram_gb", label: "RAM (GB)", field_type: "number", options: null, is_required: false, sort_order: 2, company_id: null },
  { id: 3, field_key: "delivered_on", label: "Delivered On", field_type: "date", options: null, is_required: false, sort_order: 3, company_id: null },
  { id: 4, field_key: "color", label: "Color", field_type: "dropdown", options: { choices: ["Black", "Silver"] }, is_required: false, sort_order: 4, company_id: null },
  { id: 5, field_key: "refurbished", label: "Refurbished?", field_type: "checkbox", options: null, is_required: false, sort_order: 5, company_id: null },
];

function mockGets({ asset_users = [{ id: 4, name: "IT Stock-HO" }], customFields = [] as unknown[] } = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment" }]);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, code: "LAP", name: "Laptop", category_id: 1 }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, code: "HO01", name: "Head Office" }]);
    if (path.startsWith("/masters/vendors")) return Promise.resolve([{ id: 7, code: "VND1", name: "Acme Traders" }]);
    if (path.startsWith("/masters/brands")) return Promise.resolve([{ id: 9, code: "DELL", name: "Dell" }]);
    if (path.startsWith("/masters/custom-fields")) return Promise.resolve(customFields);
    if (path.startsWith("/asset-users")) return Promise.resolve(asset_users);
    return Promise.resolve([]);
  });
}

async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

// Sub-Category/Vendor/Serial Number are mandatory (docs/ai/DECISIONS.md);
// PO/Invoice/PI are optional as of AM-19 but filled in here anyway for
// tests that want a fully-populated form, not just the minimum Save needs.
// Every test that expects Save to become enabled needs at least the
// mandatory subset filled, on top of whatever Category/Cost Centre/AssetUser
// selection it already makes. The Serial Number label query is anchored
// (^...$) because an unanchored /serial number/i also matches the "No
// serial number" checkbox's own aria-label.
async function fillMandatoryProcurementFields() {
  await pickSelectOption(/sub-category/i, "Laptop");
  await pickSelectOption(/^vendor$/i, "Acme Traders");
  fireEvent.change(screen.getByLabelText(/po number/i), { target: { value: "PO-1" } });
  fireEvent.change(screen.getByLabelText(/po date/i), { target: { value: "2025-06-01" } });
  fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: "INV-1" } });
  fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: "2025-06-02" } });
  fireEvent.change(screen.getByLabelText(/pi number/i), { target: { value: "PI-1" } });
  fireEvent.change(screen.getByLabelText(/pi date/i), { target: { value: "2025-06-03" } });
  fireEvent.change(screen.getByLabelText(/^serial number\*?$/i), { target: { value: "SN-1" } });
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
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/sub-category/i, "Laptop");
    await pickSelectOption(/cost centre/i, "Head Office");
    await pickSelectOption(/goes into/i, "IT Stock-HO");
    await pickSelectOption(/^vendor$/i, "Acme Traders");
    await pickSelectOption(/^brand$/i, "Dell");

    fireEvent.change(screen.getByLabelText(/po number/i), { target: { value: "PO-1" } });
    fireEvent.change(screen.getByLabelText(/po date/i), { target: { value: "2025-06-01" } });
    fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: "INV-1" } });
    fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: "2025-06-02" } });
    fireEvent.change(screen.getByLabelText(/pi number/i), { target: { value: "PI-1" } });
    fireEvent.change(screen.getByLabelText(/pi date/i), { target: { value: "2025-06-03" } });
    fireEvent.change(screen.getByLabelText(/warranty years/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^serial number\*?$/i), { target: { value: "SN-1" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/assets",
        expect.objectContaining({
          vendor_id: 7, brand_id: 9, po_number: "PO-1", po_date: "2025-06-01",
          invoice_number: "INV-1", invoice_date: "2025-06-02",
          pi_number: "PI-1", pi_date: "2025-06-03", warranty_years: 3,
          serial_number: "SN-1",
        }),
      ),
    );
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
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost centre/i, "Head Office");
    await pickSelectOption(/goes into/i, "IT Stock-HO");
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
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost centre/i, "Head Office");
    await pickSelectOption(/goes into/i, "IT Stock-HO");
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
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost centre/i, "Head Office");
    await pickSelectOption(/goes into/i, "IT Stock-HO");
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
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost centre/i, "Head Office");
    await pickSelectOption(/goes into/i, "IT Stock-HO");
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
      if (path === "/assets/42/events") return Promise.resolve([]);
      if (path === "/assets/42/changes") return Promise.resolve([]);
      if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment" }]);
      if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, code: "LAP", name: "Laptop", category_id: 1 }]);
      if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, code: "HO01", name: "Head Office" }]);
      if (path.startsWith("/masters/vendors")) return Promise.resolve([{ id: 7, code: "VND1", name: "Acme Traders" }]);
      if (path.startsWith("/masters/custom-fields")) return Promise.resolve([]);
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 4, name: "IT Stock-HO" }]);
      return Promise.resolve([]);
    });
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;

    const router = renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost centre/i, "Head Office");
    await pickSelectOption(/goes into/i, "IT Stock-HO");
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
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost centre/i, "Head Office");
    await pickSelectOption(/goes into/i, "IT Stock-HO");
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
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/sub-category/i, "Laptop");
    await pickSelectOption(/^vendor$/i, "Acme Traders");
    await pickSelectOption(/cost centre/i, "Head Office");
    await pickSelectOption(/goes into/i, "IT Stock-HO");

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

  it("AM-08: does not submit and shows a clear message when the company has no active cost centres", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment" }]);
      if (path.startsWith("/masters/cost-centers")) return Promise.resolve([]);
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 4, name: "IT Stock-HO" }]);
      return Promise.resolve([]);
    });

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^category$/i, "IT Equipment");

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("/masters/cost-centers")));
    expect(screen.getByText(/no active cost centres are configured for this company/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("does not submit while no IT_STOCK asset_user is available for the company", async () => {
    mockGets({ asset_users: [] });

    renderFormAt();
    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost centre/i, "Head Office");

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("/asset-users")));

    expect(screen.getByText(/no it stock asset user found for this company/i)).toBeInTheDocument();
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
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost centre/i, "Head Office");

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("/asset-users")));

    // Neither of the two asset_users is pre-selected -- the combobox still shows
    // its placeholder, and clicking Save without a pick must not submit.
    const assetUserCombobox = screen.getByRole("combobox", { name: /goes into/i });
    expect(assetUserCombobox).not.toHaveTextContent("IT Stock-HO");
    expect(assetUserCombobox).not.toHaveTextContent("IT Stock-WH-F");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(apiClient.post).not.toHaveBeenCalled();

    await pickSelectOption(/goes into/i, "IT Stock-WH-F");
    await fillMandatoryProcurementFields();
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/assets", expect.objectContaining({ initial_asset_user_id: 5 })),
    );
  });

  it("AM-24: shows a Company picker when the caller has access to more than one, and re-scopes Cost Centre on switch", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
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
