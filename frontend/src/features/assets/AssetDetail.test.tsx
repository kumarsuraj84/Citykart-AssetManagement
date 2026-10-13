import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router";
import { AssetDetail } from "./AssetDetail";
import { choicesFor } from "./actionRules";
import { apiClient, ApiError } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { KINDS, OPERATOR_IT, withCapabilities } from "../../test-capabilities";

// Keeps the real ApiError class (so `instanceof ApiError` checks inside
// AssetDetail work against the same class this test constructs) while still
// mocking apiClient's own methods, unlike a plain vi.mock(...) automock
// which would replace both.
vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});
vi.mock("../../lib/auth-store");

// Asset 360 links back to Assets and opens Move, so it is rendered inside a small
// router: /assets/1 is this screen, anything else lands on a stub page.
function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const assetRoute = createRoute({ getParentRoute: () => rootRoute, path: "/assets/$id", component: () => ui });
  const elsewhere = createRoute({ getParentRoute: () => rootRoute, path: "$", component: () => <p>Another page</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([assetRoute, elsewhere]),
    history: createMemoryHistory({ initialEntries: ["/assets/1"] }),
  });
  const result = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { ...result, router };
}

const FULL_ASSET = {
  id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", legacy_asset_code: "OLD-001", description: "Laptop",
  status: "IN_STOCK", company_id: 1, cost_center_id: 3, category_id: 1, subcategory_id: 2,
  brand_id: 9, model: "Latitude 5440", serial_number: "SN-ABC123", barcode: "BC-XYZ789",
  vendor_id: 7, po_number: "PO-1001", po_date: "2025-05-20",
  invoice_number: "INV-2001", invoice_date: "2025-05-25", invoice_amount: 70800,
  pi_number: "PI-3001", pi_date: "2025-05-22",
  purchase_cost: 60000, tax_percent: 18, tax_amount: 10800, total_cost: 70800,
  purchase_date: "2025-06-01", warranty_years: 3, warranty_upto: "2027-06-01",
  current_asset_user_id: 5, status_since: "2025-06-01", asset_domain: "IT",
  custom_fields: { asset_tag: "TAG-1", retired_field: "kept for history" },
  category_name: "IT Equipment", subcategory_name: "Laptop", cost_center_name: "Head Office",
  vendor_name: "Acme Traders", brand_name: "Dell", current_asset_user_name: "IT Stock-HO", current_asset_user_type: "STOCK_POINT",
  location_name: "Head Office", department_name: "IT", company_name: "CityKart Stores",
  item_name: "Business Laptop", erp_item_code: "CT175673",
};

const CUSTOM_FIELD_DEFS = [
  { field_key: "asset_tag", label: "Asset Tag", field_type: "text", options: null, is_required: true, sort_order: 1, company_id: null },
];

const CATEGORIES = [
  { id: 1, name: "IT Equipment" },
  { id: 4, name: "Furniture" },
];
const SUBCATEGORIES = [
  { id: 2, name: "Laptop", category_id: 1 },
  { id: 3, name: "Desktop", category_id: 1 },
  { id: 8, name: "Chair", category_id: 4 },
];

function mockGets(overrides: Record<string, unknown> = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/assets/1") return Promise.resolve(overrides.asset ?? FULL_ASSET);
    if (path === "/assets/1/events") return Promise.resolve(overrides.events ?? []);
    if (path === "/assets/1/changes") return Promise.resolve(overrides.changes ?? []);
    if (path.startsWith("/asset-users")) return Promise.resolve(overrides.asset_users ?? [{ id: 5, name: "Ankur" }]);
    if (path.startsWith("/masters/vendors")) return Promise.resolve(overrides.vendors ?? [{ id: 7, name: "Acme Traders" }]);
    if (path.startsWith("/masters/brands")) return Promise.resolve(overrides.brands ?? [{ id: 9, name: "Dell" }, { id: 10, name: "HP" }]);
    if (path.startsWith("/masters/custom-fields")) return Promise.resolve(overrides.customFieldDefs ?? CUSTOM_FIELD_DEFS);
    if (path.startsWith("/masters/categories")) return Promise.resolve(overrides.categories ?? CATEGORIES);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve(overrides.subcategories ?? SUBCATEGORIES);
    return Promise.resolve([]);
  });
}

function mockAuth(role: string) {
  (useAuthStore as any).getState = vi.fn().mockReturnValue({ role, accessToken: null });
  (useAuthStore as any).mockImplementation((selector: any) => {
    const state = { role, accessToken: null, companyId: 1, mustChangePassword: false };
    return selector ? selector(state) : state;
  });
}

async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

// Radix Tabs (activationMode="automatic", the default) switches the active
// tab on focus, not on click -- a real browser click also focuses the
// button, but jsdom's fireEvent.click alone does not, so drive it directly.
function clickTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  fireEvent.click(tab);
  tab.focus();
}

const region = (name: string) => screen.getByRole("region", { name });

async function openPage() {
  const r = renderWithClient(<AssetDetail assetId={1} />);
  await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
  return r;
}

/** The "⋯" menu: lifecycle choices and Correct Classification. */
async function openMoreActions() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), { button: 0, ctrlKey: false });
  return await screen.findByRole("menu");
}

async function openCorrection() {
  await openMoreActions();
  fireEvent.click(screen.getByRole("menuitem", { name: /correct classification/i }));
  return await screen.findByRole("dialog", { name: /correct classification/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth("ADMIN");
  // 404, not 401: a 401 would (correctly) send authFetch into its refresh-then-
  // redirect-to-login path, which isn't what these tests are about.
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-qr");
  window.URL.revokeObjectURL = vi.fn();
  window.print = vi.fn();
});

describe("AssetDetail (Asset 360)", () => {
  it("shows a loading state, not a blank screen, before the asset arrives", async () => {
    (apiClient.get as any).mockImplementation(() => new Promise(() => {})); // never resolves
    const { container } = renderWithClient(<AssetDetail assetId={1} />);
    await waitFor(() => expect(container.querySelector(".animate-pulse")).not.toBeNull());
  });

  it("shows an error state with a working retry action on a genuine fetch failure", async () => {
    (apiClient.get as any).mockRejectedValue(new Error("network down"));
    renderWithClient(<AssetDetail assetId={1} />);

    // AssetDetail's own retry policy retries a non-404 failure up to twice
    // (with react-query's default backoff) before giving up -- allow for that
    // real delay rather than asserting on an artificially instant failure.
    expect(await screen.findByRole("alert", {}, { timeout: 8000 })).toHaveTextContent(/couldn't load this asset/i);

    mockGets();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" })).toBeInTheDocument();
  });

  it("shows a not-found treatment, not a generic error, for a 404", async () => {
    (apiClient.get as any).mockRejectedValue(new ApiError("Not Found", 404));
    renderWithClient(<AssetDetail assetId={1} />);
    expect(await screen.findByText(/asset not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /assets/i })).toHaveAttribute("href", "/assets");
  });

  it("S5a: a breadcrumb leads back to Assets", async () => {
    mockGets();
    const { router } = await openPage();
    const back = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: /assets/i });
    expect(back).toHaveAttribute("href", "/assets");
    fireEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe("/assets"));
  });

  it("S5a: four sections instead of seven tabs -- Identity, Procurement, Where it is & history, More", async () => {
    mockGets();
    await openPage();
    for (const name of ["Identity", "Procurement", "Where it is & history", "More"]) {
      expect(region(name)).toBeInTheDocument();
    }
    // The old tabs are gone; More holds the four reference areas.
    for (const old of ["Overview", "Custody", "History", "Changes"]) {
      expect(screen.queryByRole("tab", { name: old })).not.toBeInTheDocument();
    }
    expect(within(region("More")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Documents", "Field changes", "Custom fields", "Advanced"]);
  });

  it("S5a: the summary says what it is, its status, who or where has it, its company and work area", async () => {
    mockGets();
    await openPage();
    const summary = screen.getByTestId("asset-summary");
    expect(within(summary).getByText("Business Laptop")).toBeInTheDocument();
    expect(within(summary).getByText("In Stock")).toBeInTheDocument();
    expect(within(summary).getByText("IT Stock-HO")).toBeInTheDocument();
    expect(within(summary).getByText(/\(Stock Room\)/)).toBeInTheDocument();
    expect(within(summary).getByText("Company")).toBeInTheDocument();
    expect(within(summary).getByText("CityKart Stores")).toBeInTheDocument();
    expect(within(screen.getByTestId("work-area-chip")).getByText("IT Team")).toBeInTheDocument();
  });

  it("S5a: every fact is shown once -- nothing repeated between the summary and the sections", async () => {
    mockGets();
    await openPage();
    for (const value of ["SN-ABC123", "BC-XYZ789", "Acme Traders", "Latitude 5440", "Dell", "IT Stock-HO", "CityKart Stores", "Business Laptop", "CT175673"]) {
      expect(screen.getAllByText(value)).toHaveLength(1);
    }
    expect(screen.getAllByText("In Stock")).toHaveLength(1);
    expect(screen.getAllByText(/PO-1001/)).toHaveLength(1);
    expect(screen.getAllByText(/INV-2001/)).toHaveLength(1);
    expect(screen.getAllByText(/PI-3001/)).toHaveLength(1);
    expect(screen.getAllByText("IT Team")).toHaveLength(1);
  });

  it("Identity holds serial, barcode, ERP code, brand, model, description and warranty", async () => {
    mockGets();
    await openPage();
    const identity = region("Identity");
    for (const text of ["SN-ABC123", "BC-XYZ789", "CT175673", "Dell", "Latitude 5440", "Laptop", "3 years · until 2027-06-01"]) {
      expect(within(identity).getByText(text)).toBeInTheDocument();
    }
  });

  it("a pending serial and a 'no serial' asset say so in plain words", async () => {
    mockGets({ asset: { ...FULL_ASSET, serial_number: null, serial_pending: true } });
    const { unmount } = await openPage();
    expect(within(region("Identity")).getByText("Pending: still to be added")).toBeInTheDocument();
    unmount();
    mockGets({ asset: { ...FULL_ASSET, serial_number: "N/A" } });
    await openPage();
    expect(within(region("Identity")).getByText("None (N/A)")).toBeInTheDocument();
  });

  it("Procurement holds vendor, PO, invoice, Purchase Invoice (PI), purchase date, cost, tax and total", async () => {
    mockGets();
    await openPage();
    const p = region("Procurement");
    expect(within(p).getByText("Acme Traders")).toBeInTheDocument();
    expect(within(p).getByText("PO-1001 · 2025-05-20")).toBeInTheDocument();
    expect(within(p).getByText("INV-2001 · 2025-05-25")).toBeInTheDocument();
    expect(within(p).getByText("Purchase Invoice (PI)")).toBeInTheDocument();
    expect(within(p).getByText("PI-3001 · 2025-05-22")).toBeInTheDocument();
    expect(within(p).getByText("2025-06-01")).toBeInTheDocument();
    expect(within(p).getByText("60000.00")).toBeInTheDocument();
    expect(within(p).getByText("18.00% · 10800.00")).toBeInTheDocument();
    expect(within(p).getAllByText("70800.00")).toHaveLength(2);               // invoice amount and total
    expect(within(p).getByText("Head Office")).toBeInTheDocument();          // cost centre
  });

  it("displays custom field values under More, including a value whose definition was later retired", async () => {
    mockGets();
    await openPage();
    clickTab("Custom fields");
    const panel = await screen.findByRole("tabpanel", { name: "Custom fields" });
    expect(within(panel).getByText("Asset Tag")).toBeInTheDocument();
    expect(within(panel).getByText("TAG-1")).toBeInTheDocument();
    // Not silently hidden just because no active definition matches it anymore.
    expect(within(panel).getByText("kept for history")).toBeInTheDocument();
  });

  it("Advanced (under More) keeps the legacy code and the category", async () => {
    mockGets();
    await openPage();
    clickTab("Advanced");
    const panel = await screen.findByRole("tabpanel", { name: "Advanced" });
    expect(within(panel).getByText("OLD-001")).toBeInTheDocument();
    expect(within(panel).getByText("IT Equipment")).toBeInTheDocument();
  });

  it("AM-05: only Global and this asset's own company's custom fields are editable -- another company's field never appears, and its stored value is still shown read-only", async () => {
    const scopedAsset = {
      ...FULL_ASSET,
      // company_id: 1 (from FULL_ASSET). A value under a key whose
      // definition is scoped to a DIFFERENT company -- e.g. because it was
      // re-scoped after this asset's value was recorded -- must behave like
      // the AM-04 retired-field precedent: preserved and visible, never
      // editable here.
      custom_fields: { asset_tag: "TAG-1", other_company_field: "kept for history" },
    };
    const scopedDefs = [
      { field_key: "asset_tag", label: "Asset Tag", field_type: "text", options: null, is_required: true, sort_order: 1, company_id: null },
      { field_key: "own_company_tag", label: "Own Company Tag", field_type: "text", options: null, is_required: false, sort_order: 2, company_id: 1 },
      { field_key: "other_company_field", label: "Other Company Field", field_type: "text", options: null, is_required: true, sort_order: 3, company_id: 2 },
    ];
    mockGets({ asset: scopedAsset, customFieldDefs: scopedDefs });
    await openPage();

    // Read-only tab: the retained value under the other company's field key is still shown.
    clickTab("Custom fields");
    const panel = await screen.findByRole("tabpanel", { name: "Custom fields" });
    expect(within(panel).getByText("kept for history")).toBeInTheDocument();

    // Edit mode: Global + own-company fields are editable; the other company's field is not offered at all.
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByLabelText("Asset Tag")).toBeInTheDocument();
    expect(screen.getByLabelText("Own Company Tag")).toBeInTheDocument();
    expect(screen.queryByLabelText("Other Company Field")).not.toBeInTheDocument();

    // Saving is never blocked by the other company's required field, and the
    // retained value under its key is preserved verbatim rather than dropped.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
    const [, body] = (apiClient.put as any).mock.calls[0];
    expect(body.custom_fields.other_company_field).toBe("kept for history");
  });

  it("shows the lifecycle timeline under Where it is & history, without a click", async () => {
    mockGets({ events: [{ id: 1, event_type: "PROCURED", event_date: "2025-06-01T00:00:00Z", status_after: "IN_STOCK", remarks: null, reference_no: "GP-7", label: "Procured" }] });
    await openPage();
    const where = region("Where it is & history");
    expect(await within(where).findByText("Procured")).toBeInTheDocument();
    expect(within(where).getByText("Ref: GP-7")).toBeInTheDocument();
    expect(within(where).getByText("Department")).toBeInTheDocument();
  });

  it("displays the field-change audit under More > Field changes, distinct from the history", async () => {
    mockGets({
      changes: [{ id: 1, field_name: "brand_id", old_value: "Dell (#9)", new_value: "HP (#10)", actor_id: 9, actor_name: "Admin", request_id: "r1", created_at: "2025-07-01T00:00:00Z" }],
    });
    await openPage();
    clickTab("Field changes");
    const panel = await screen.findByRole("tabpanel", { name: "Field changes" });
    expect(within(panel).getByText("Brand")).toBeInTheDocument();
    expect(within(panel).getByText("Dell (#9)")).toBeInTheDocument();
    expect(within(panel).getByText("HP (#10)")).toBeInTheDocument();
    expect(within(panel).getByText("Admin")).toBeInTheDocument();
  });

  it("Field changes names each field in plain words, never its internal name", async () => {
    mockGets({
      changes: [
        { id: 1, field_name: "serial_number", old_value: "SN-1", new_value: "SN-2", actor_id: 9, actor_name: "Admin", request_id: "r1", created_at: "2025-07-01T00:00:00Z", reason: null },
        { id: 2, field_name: "custom_fields.asset_tag", old_value: "T-1", new_value: "T-2", actor_id: 9, actor_name: null, request_id: "r2", created_at: "2025-07-02T00:00:00Z", reason: null },
        { id: 3, field_name: "pi_number", old_value: null, new_value: "PI-9", actor_id: 9, actor_name: "Admin", request_id: "r3", created_at: "2025-07-03T00:00:00Z", reason: null },
      ],
    });
    await openPage();
    clickTab("Field changes");
    const panel = await screen.findByRole("tabpanel", { name: "Field changes" });
    expect(within(panel).getByText("Serial number")).toBeInTheDocument();
    expect(within(panel).getByText("Asset Tag")).toBeInTheDocument();          // the custom field's own label
    expect(within(panel).getByText("Purchase Invoice (PI) number")).toBeInTheDocument();
    expect(within(panel).queryByText(/serial_number|custom_fields|pi_number/)).not.toBeInTheDocument();
    // A change whose actor is not known reads "Unknown", never "#9".
    expect(within(panel).getByText("Unknown")).toBeInTheDocument();
    expect(within(panel).queryByText("#9")).not.toBeInTheDocument();
  });

  it("says who has the asset in plain words: Stock Room, IT Team, never raw codes or 'Holder'", async () => {
    mockGets({ asset: { ...FULL_ASSET, asset_domain: "NON_IT" } });
    await openPage();
    expect(screen.getByText(/\(Stock Room\)/)).toBeInTheDocument();
    expect(screen.getByText("In Stock")).toBeInTheDocument();
    expect(screen.getByText("Admin / Non-IT Team")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/IN_STOCK|STOCK_POINT|NON_IT|Holder|stock point|Asset User|Responsibility/i);
  });

  it("an allotted asset's status says exactly who has it (With Employee)", async () => {
    mockGets({ asset: { ...FULL_ASSET, status: "ALLOTTED", current_asset_user_name: "Ankur", current_asset_user_type: "EMPLOYEE" } });
    await openPage();
    expect(screen.getByText("With Employee")).toBeInTheDocument();
    expect(screen.getByText(/\(Employee\)/)).toBeInTheDocument();
  });

  it("keeps Documents (the first area under More)", async () => {
    mockGets();
    await openPage();
    expect(await within(region("More")).findByText(/no documents uploaded/i)).toBeInTheDocument();
  });

  it("shows the Edit action for ADMIN/OPERATOR but not for VIEWER", async () => {
    mockGets();
    const { unmount } = await openPage();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    unmount();

    mockAuth("VIEWER");
    await openPage();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("never renders an editable control for an immutable/lifecycle field while editing", async () => {
    mockGets();
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByRole("button", { name: /^save$/i })).toBeInTheDocument();

    for (const forbidden of [/^category$/i, /^sub-category$/i, /cost centre/i, /purchase date/i, /^status$/i]) {
      expect(screen.queryByLabelText(forbidden)).not.toBeInTheDocument();
    }
    // The asset code itself is never a form control anywhere on this page.
    expect(screen.queryByDisplayValue("FA/HO01/IT/LAP/CK_1")).not.toBeInTheDocument();
  });

  it("shows Barcode under Identity, distinct from Serial Number, and can edit it", async () => {
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...FULL_ASSET, barcode: "BC-NEW-000" });
    await openPage();

    expect(within(region("Identity")).getByText("SN-ABC123")).toBeInTheDocument();
    expect(within(region("Identity")).getByText("BC-XYZ789")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const barcodeInput = await screen.findByLabelText(/^barcode$/i);
    fireEvent.change(barcodeInput, { target: { value: "BC-NEW-000" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      "/assets/1",
      expect.objectContaining({ barcode: "BC-NEW-000" }),
    ));
  });

  it("saves an edit through PUT /api/assets/{id} and refreshes the displayed data", async () => {
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...FULL_ASSET, brand_id: 10, brand_name: "HP" });
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByLabelText(/^brand$/i);
    await pickSelectOption(/^brand$/i, "HP");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      "/assets/1",
      expect.objectContaining({ description: "Laptop", pi_number: "PI-3001" }),
    ));
    // Back to the read view, showing the just-saved value.
    expect(await within(await screen.findByRole("region", { name: "Identity" })).findByText("HP")).toBeInTheDocument();
  });

  it("shows a save-error message instead of losing the edit silently", async () => {
    mockGets();
    (apiClient.put as any).mockRejectedValue(new Error("missing required custom field(s): asset_tag"));
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/missing required custom field/i)).toBeInTheDocument();
  });

  describe("S0: the serial number on Edit", () => {
    async function openEdit(asset: Record<string, unknown> = FULL_ASSET) {
      mockGets({ asset });
      (apiClient.put as any).mockResolvedValue(asset);
      await openPage();
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
      return await screen.findByLabelText("Serial Number");
    }
    const lastBody = () => (apiClient.put as any).mock.calls.at(-1)[1] as Record<string, unknown>;

    it("saving without touching the serial leaves it out of the request (the server keeps it)", async () => {
      await openEdit();
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
      expect(lastBody()).not.toHaveProperty("serial_number");
      expect(lastBody()).toMatchObject({ description: "Laptop", barcode: "BC-XYZ789" });
    });

    it("a changed serial is sent, trimmed", async () => {
      const box = await openEdit();
      fireEvent.change(box, { target: { value: "  SN-NEW-9 " } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
      expect(lastBody().serial_number).toBe("SN-NEW-9");
    });

    it("'No serial number' sends N/A", async () => {
      await openEdit();
      fireEvent.click(screen.getByRole("checkbox", { name: "No serial number" }));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
      expect(lastBody().serial_number).toBe("N/A");
    });

    it("emptying an existing serial is stopped with the server's sentence; nothing is sent, never null or blank", async () => {
      const box = await openEdit();
      fireEvent.change(box, { target: { value: "" } });
      expect(await screen.findByText("The serial number cannot be removed. Type N/A if the asset has none.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(apiClient.put).not.toHaveBeenCalled();
      // Typing N/A (or anything) clears it again.
      fireEvent.change(box, { target: { value: "N/A" } });
      expect(screen.queryByText(/cannot be removed/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
    });

    it("an asset with no serial yet can be saved without one, and the field stays out of the request", async () => {
      await openEdit({ ...FULL_ASSET, serial_number: null });
      expect(screen.queryByText(/cannot be removed/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
      expect(lastBody()).not.toHaveProperty("serial_number");
    });

    it("if the server still refuses the serial, its sentence is shown", async () => {
      const box = await openEdit();
      (apiClient.put as any).mockRejectedValue(new ApiError("The serial number cannot be removed. Type N/A if the asset has none.", 422));
      fireEvent.change(box, { target: { value: "SN-OTHER" } });
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      expect(await screen.findByText("The serial number cannot be removed. Type N/A if the asset has none.")).toBeInTheDocument();
    });
  });

  describe("S5a: lifecycle choices come from the shared rule and open the Move screen", () => {
    const menuLabels = () => screen.getAllByRole("menuitem").map((m) => m.textContent);

    it.each(["IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "LOST"])(
      "from %s the menu offers exactly choicesFor(status), then Correct Classification",
      async (status) => {
        mockGets({ asset: { ...FULL_ASSET, status } });
        await openPage();
        await openMoreActions();
        expect(menuLabels()).toEqual([...choicesFor(status, { isAdmin: true }).map((c) => c.label), "Correct Classification"]);
      },
    );

    it("an operator is not offered Mark Found (only an admin may)", async () => {
      mockAuth("OPERATOR");
      mockGets({ asset: { ...FULL_ASSET, status: "LOST" } });
      await openPage();
      await openMoreActions();
      expect(menuLabels()).toEqual(["Correct Classification"]);
      expect(screen.queryByRole("button", { name: "Move…" })).not.toBeInTheDocument();
    });

    it("a final status (sold) offers no Move at all", async () => {
      mockGets({ asset: { ...FULL_ASSET, status: "SOLD" } });
      await openPage();
      expect(screen.queryByRole("button", { name: "Move…" })).not.toBeInTheDocument();
      await openMoreActions();
      expect(menuLabels()).toEqual(["Correct Classification"]);
    });

    it("Move… opens the Move screen with this asset already in the batch", async () => {
      mockGets();
      const { router } = await openPage();
      fireEvent.click(screen.getByRole("button", { name: "Move…" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/asset-movement"));
      expect(router.state.location.search).toEqual({ ids: "1" });
    });

    it("picking a choice opens Move with the asset and that choice (no separate dialog here)", async () => {
      mockGets({ asset: { ...FULL_ASSET, status: "UNDER_REPAIR" } });
      const { router } = await openPage();
      await openMoreActions();
      fireEvent.click(screen.getByRole("menuitem", { name: "Receive from Repair" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/asset-movement"));
      expect(router.state.location.search).toEqual({ ids: "1", choice: "from-repair" });
      expect(apiClient.post).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("hides every action -- Move, Print Label, Edit, the menu -- for a self-service login", async () => {
    mockAuth("SELF_SERVICE");
    mockGets();
    await openPage();
    for (const name of [/^move/i, /print label/i, /^edit$/i, /more actions/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("S5a: a VIEWER sees no action buttons at all (they only look)", async () => {
    mockAuth("VIEWER");
    mockGets();
    await openPage();
    for (const name of [/^move/i, /print label/i, /^edit$/i, /more actions/i, /send for repair/i, /correct classification/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    // The facts themselves are all there.
    expect(region("Identity")).toBeInTheDocument();
  });

  it("shows the asset's QR code image", async () => {
    mockGets();
    (useAuthStore as any).getState = vi.fn().mockReturnValue({ role: "ADMIN", accessToken: "test-token" });
    const qrBlob = new Blob(["fake-png-bytes"]);
    window.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(qrBlob) }) as any;
    await openPage();
    await waitFor(() => expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/assets/1/qr.png"),
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    ));
    await waitFor(() => expect(screen.getByAltText(/asset qr code/i)).toHaveAttribute("src", "blob:mock-qr"));
  });

  it("S5a: Print Label uses the shared print action and prints only this asset's label, not the page", async () => {
    mockGets();
    const sheets: number[] = [];
    window.print = vi.fn(() => {
      sheets.push(document.querySelectorAll(".print-labels-sheet .print-label").length);
    });
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: /print label/i }));
    const dialog = await screen.findByRole("dialog", { name: "Print 1 label" });
    expect(within(dialog).getByRole("button", { name: /label settings/i })).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).getByTestId("label-preview")).toHaveTextContent("FA/HO01/IT/LAP/CK_1");
    expect(window.print).not.toHaveBeenCalled();                      // never the whole page straight away
    fireEvent.click(within(dialog).getByRole("button", { name: "Print 1 label" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(sheets).toEqual([1]);                                      // exactly one label on the printed sheet
    // The print-only stylesheet is there only while printing.
    await waitFor(() => expect(document.querySelector(".print-labels-sheet")).toBeNull());
  });
});

describe("AssetDetail -- AM-07 asset correction", () => {
  it("offers Correct Classification (in the ⋯ menu) to ADMIN/OPERATOR", async () => {
    mockGets();
    await openPage();
    await openMoreActions();
    expect(screen.getByRole("menuitem", { name: /correct classification/i })).toBeInTheDocument();
  });

  it("is hidden for VIEWER", async () => {
    mockAuth("VIEWER");
    mockGets();
    await openPage();
    expect(screen.queryByRole("button", { name: /more actions/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/correct classification/i)).not.toBeInTheDocument();
  });

  it("opens with current values prefilled, and Asset Code shown read-only", async () => {
    mockGets();
    await openPage();

    const dialog = await openCorrection();
    expect(within(dialog).getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument();
    expect(within(dialog).getByText(/asset code will not change/i)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent("IT Equipment"));
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Sub-category" })).toHaveTextContent("Laptop"));
    expect(within(dialog).getByLabelText("Purchase Date")).toHaveValue("2025-06-01");
  });

  it("ordinary Edit mode never shows Category/Subcategory/Purchase Date controls", async () => {
    mockGets();
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sub-category")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Purchase Date")).not.toBeInTheDocument();
  });

  it("Category change updates the Sub-Category options and clears an invalid old selection", async () => {
    mockGets();
    await openPage();
    await openCorrection();

    await pickSelectOption("Category", "Furniture");
    const subcategoryTrigger = screen.getByRole("combobox", { name: "Sub-category" });
    expect(subcategoryTrigger).toHaveTextContent(/none/i); // Laptop no longer valid for Furniture

    fireEvent.click(subcategoryTrigger);
    expect(await screen.findByRole("option", { name: "Chair" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Laptop" })).not.toBeInTheDocument();
  });

  it("requires a reason and at least one real change before Confirm is enabled", async () => {
    mockGets();
    await openPage();
    await openCorrection();

    const confirm = screen.getByRole("button", { name: /confirm correction/i });
    expect(confirm).toBeDisabled(); // no change yet, no reason yet

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong category selected initially" } });
    expect(confirm).toBeDisabled(); // reason alone isn't enough -- nothing actually changed

    await pickSelectOption("Category", "Furniture");
    await pickSelectOption("Sub-category", "Chair");
    expect(confirm).toBeEnabled();
  });

  it("shows an impact summary naming the old/new values and that Asset Code is unchanged", async () => {
    mockGets();
    await openPage();
    await openCorrection();

    await pickSelectOption("Category", "Furniture");
    await pickSelectOption("Sub-category", "Chair");

    expect(screen.getByText(/impact summary/i)).toBeInTheDocument();
    expect(screen.getByText("Category: IT Equipment → Furniture")).toBeInTheDocument();
    expect(screen.getByText("Sub-category: Laptop → Chair")).toBeInTheDocument();
    expect(screen.getByText(/asset code: fa\/ho01\/it\/lap\/ck_1 — unchanged/i)).toBeInTheDocument();
  });

  it("submits only the changed fields, refreshes Asset 360, and closes the dialog on success", async () => {
    mockGets();
    (apiClient.post as any).mockResolvedValue({ ...FULL_ASSET, category_id: 4, subcategory_id: 8, category_name: "Furniture", subcategory_name: "Chair" });
    await openPage();
    await openCorrection();

    await pickSelectOption("Category", "Furniture");
    await pickSelectOption("Sub-category", "Chair");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong category selected initially" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm correction/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/1/corrections", {
      reason: "Wrong category selected initially", category_id: 4, subcategory_id: 8,
    }));
    // purchase_date was never touched -- must not appear in the body at all.
    expect((apiClient.post as any).mock.calls[0][1]).not.toHaveProperty("purchase_date");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /correct classification/i })).not.toBeInTheDocument());
    clickTab("Advanced");
    const panel = await screen.findByRole("tabpanel", { name: "Advanced" });
    expect(within(panel).getByText("Furniture")).toBeInTheDocument();
  });

  it("shows a server validation error inside the dialog without closing it", async () => {
    mockGets();
    (apiClient.post as any).mockRejectedValue(new Error("purchase date cannot be after the asset's earliest recorded event (2025-06-01)"));
    await openPage();
    await openCorrection();

    fireEvent.change(screen.getByLabelText("Purchase Date"), { target: { value: "2025-06-10" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "trying to move it later" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm correction/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/earliest recorded event/i);
    expect(screen.getByRole("dialog", { name: /correct classification/i })).toBeInTheDocument();
  });

  it("Field changes shows a correction entry distinctly, with its reason", async () => {
    mockGets({
      changes: [
        {
          id: 1, field_name: "category_id", old_value: "CAT-1 - IT Equipment (#1)", new_value: "CAT-4 - Furniture (#4)",
          actor_id: 9, actor_name: "Admin", request_id: "r1", created_at: "2025-07-01T00:00:00Z",
          reason: "Wrong category selected initially",
        },
        {
          id: 2, field_name: "brand_id", old_value: "Dell (#9)", new_value: "HP (#10)",
          actor_id: 9, actor_name: "Admin", request_id: "r2", created_at: "2025-07-02T00:00:00Z",
          reason: null,
        },
      ],
    });
    await openPage();

    clickTab("Field changes");
    const panel = await screen.findByRole("tabpanel", { name: "Field changes" });
    expect(within(panel).getByText("Correction")).toBeInTheDocument();
    expect(within(panel).getByText("Wrong category selected initially")).toBeInTheDocument();
    expect(within(panel).getByText("CAT-1 - IT Equipment (#1)")).toBeInTheDocument();
    expect(within(panel).getByText("Edit")).toBeInTheDocument();
  });
});

// S3b-1: Asset 360 Edit can add a missing brand or vendor right there.
describe("AssetDetail -- S3b-1 brand / vendor added in Edit", () => {
  function signedInWith(caps: Capabilities) {
    (useAuthStore as any).mockImplementation((selector: any) => {
      const state = { role: "ADMIN", accessToken: "tok", companyId: 1, mustChangePassword: false, isPrimaryOwner: false, assetUserId: 5 };
      return selector ? selector(state) : state;
    });
    const base = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation(withCapabilities(caps, base));
  }

  async function openEdit() {
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByLabelText(/^brand$/i);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
  }

  async function offered(label: RegExp, entry: RegExp) {
    const trigger = screen.getByRole("combobox", { name: label });
    fireEvent.click(trigger);
    await screen.findAllByRole("option");
    const found = screen.queryByRole("option", { name: entry }) !== null;
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument());
    return found;
  }

  it.each(KINDS)("%s: New Brand / New Vendor follow the capabilities", async (_kind, caps) => {
    mockGets();
    signedInWith(caps);
    await openEdit();
    expect(await offered(/^brand$/i, /new brand/i)).toBe(caps.can_create.brand === true);
    expect(await offered(/^vendor$/i, /new vendor/i)).toBe(caps.can_create.vendor === true);
  });

  it("a brand added here is picked and saved with the asset", async () => {
    const brands = [{ id: 9, name: "Dell" }];
    mockGets({ brands });
    signedInWith(OPERATOR_IT);
    (apiClient.post as any).mockImplementation((path: string, body: { name: string }) => {
      const row = { id: 12, ...body };
      if (path === "/masters/brands") brands.push(row);
      return Promise.resolve(row);
    });
    (apiClient.put as any).mockResolvedValue({ ...FULL_ASSET, brand_id: 12 });
    await openEdit();
    fireEvent.click(screen.getByRole("combobox", { name: /^brand$/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new brand/i }));
    const dialog = await screen.findByRole("dialog", { name: /new brand/i });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Lenovo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/brands", { name: "Lenovo" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: /^brand$/i })).toHaveTextContent("Lenovo"));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/assets/1", expect.objectContaining({ brand_id: 12 })));
  });
});
