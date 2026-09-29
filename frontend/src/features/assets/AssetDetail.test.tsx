import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetDetail } from "./AssetDetail";
import { apiClient, ApiError } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

// Keeps the real ApiError class (so `instanceof ApiError` checks inside
// AssetDetail work against the same class this test constructs) while still
// mocking apiClient's own methods, unlike a plain vi.mock(...) automock
// which would replace both.
vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});
vi.mock("../../lib/auth-store");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const FULL_ASSET = {
  id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", legacy_asset_code: "OLD-001", description: "Laptop",
  status: "IN_STOCK", company_id: 1, cost_center_id: 3, category_id: 1, subcategory_id: 2,
  brand: "Dell", model: "Latitude 5440", serial_number: "SN-ABC123", barcode: "BC-XYZ789",
  vendor_id: 7, po_number: "PO-1001", po_date: "2025-05-20",
  invoice_number: "INV-2001", invoice_date: "2025-05-25", invoice_amount: 70800,
  pi_number: "PI-3001", pi_date: "2025-05-22",
  purchase_cost: 60000, tax_percent: 18, tax_amount: 10800, total_cost: 70800,
  purchase_date: "2025-06-01", warranty_years: 3, warranty_upto: "2027-06-01",
  current_holder_id: 5, status_since: "2025-06-01",
  custom_fields: { asset_tag: "TAG-1", retired_field: "kept for history" },
  category_name: "IT Equipment", subcategory_name: "Laptop", cost_center_name: "Head Office",
  vendor_name: "Acme Traders", current_holder_name: "IT Stock-HO", current_holder_type: "IT_STOCK",
  location_name: "Head Office", department_name: "IT",
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
    if (path.startsWith("/holders")) return Promise.resolve(overrides.holders ?? [{ id: 5, name: "Ankur" }]);
    if (path.startsWith("/masters/vendors")) return Promise.resolve(overrides.vendors ?? [{ id: 7, name: "Acme Traders" }]);
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

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth("ADMIN");
  // 404, not 401: a 401 would (correctly) send authFetch into its refresh-then-
  // redirect-to-login path, which isn't what these tests are about.
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-qr");
  window.URL.revokeObjectURL = vi.fn();
});

describe("AssetDetail (Asset 360)", () => {
  it("shows a loading state, not a blank screen, before the asset arrives", () => {
    (apiClient.get as any).mockImplementation(() => new Promise(() => {})); // never resolves
    const { container } = renderWithClient(<AssetDetail assetId={1} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
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
  });

  it("displays procurement fields including PI Number, and custody, on the real data", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    clickTab("Procurement");
    const procurementPanel = await screen.findByRole("tabpanel", { name: "Procurement" });
    expect(within(procurementPanel).getByText("PI-3001")).toBeInTheDocument();
    expect(within(procurementPanel).getByText("Acme Traders")).toBeInTheDocument();
    expect(within(procurementPanel).getByText("PO-1001")).toBeInTheDocument();
    expect(within(procurementPanel).getByText("INV-2001")).toBeInTheDocument();
    expect(within(procurementPanel).getByText("2027-06-01")).toBeInTheDocument();

    clickTab("Custody");
    const custodyPanel = await screen.findByRole("tabpanel", { name: "Custody" });
    expect(within(custodyPanel).getByText("IT Stock-HO")).toBeInTheDocument();
    // "Head Office" is legitimately both the location and the cost centre in this fixture.
    expect(within(custodyPanel).getAllByText("Head Office")).toHaveLength(2);
  });

  it("displays custom field values, including a value whose definition was later retired", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    clickTab("Custom Fields");
    const panel = await screen.findByRole("tabpanel", { name: "Custom Fields" });
    expect(within(panel).getByText("Asset Tag")).toBeInTheDocument();
    expect(within(panel).getByText("TAG-1")).toBeInTheDocument();
    // Not silently hidden just because no active definition matches it anymore.
    expect(within(panel).getByText("kept for history")).toBeInTheDocument();
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
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    // Read-only tab: the retained value under the other company's field key is still shown.
    clickTab("Custom Fields");
    const panel = await screen.findByRole("tabpanel", { name: "Custom Fields" });
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

  it("displays the lifecycle timeline under History", async () => {
    mockGets({ events: [{ id: 1, event_type: "PROCURED", event_date: "2025-06-01T00:00:00Z", status_after: "IN_STOCK", remarks: null, reference_no: null, label: "Procured" }] });
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    clickTab("History");
    expect(await screen.findByText("Procured")).toBeInTheDocument();
  });

  it("displays the field-change audit under Changes, distinct from lifecycle History", async () => {
    mockGets({
      changes: [{ id: 1, field_name: "brand", old_value: "Dell", new_value: "HP", actor_id: 9, actor_name: "Admin", request_id: "r1", created_at: "2025-07-01T00:00:00Z" }],
    });
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    clickTab("Changes");
    const panel = await screen.findByRole("tabpanel", { name: "Changes" });
    expect(within(panel).getByText("brand")).toBeInTheDocument();
    expect(within(panel).getByText("Dell")).toBeInTheDocument();
    expect(within(panel).getByText("HP")).toBeInTheDocument();
    expect(within(panel).getByText("Admin")).toBeInTheDocument();
  });

  it("preserves the Documents tab", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    clickTab("Documents");
    expect(await screen.findByText(/no documents uploaded/i)).toBeInTheDocument();
  });

  it("shows the Edit action for ADMIN/IT_TEAM but not for VIEWER or HOLDER", async () => {
    mockGets();
    const { unmount } = renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    unmount();

    mockAuth("VIEWER");
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("never renders an editable control for an immutable/lifecycle field while editing", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByRole("button", { name: /^save$/i })).toBeInTheDocument();

    for (const forbidden of [/^category$/i, /^sub-category$/i, /cost centre/i, /purchase date/i, /^status$/i]) {
      expect(screen.queryByLabelText(forbidden)).not.toBeInTheDocument();
    }
    // The asset code itself is never a form control anywhere on this page.
    expect(screen.queryByDisplayValue("FA/HO01/IT/LAP/CK_1")).not.toBeInTheDocument();
  });

  it("shows Barcode on Overview, distinct from Serial Number, and can edit it", async () => {
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...FULL_ASSET, barcode: "BC-NEW-000" });
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    const overviewPanel = await screen.findByRole("tabpanel", { name: "Overview" });
    expect(within(overviewPanel).getByText("SN-ABC123")).toBeInTheDocument();
    expect(within(overviewPanel).getByText("BC-XYZ789")).toBeInTheDocument();

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
    (apiClient.put as any).mockResolvedValue({ ...FULL_ASSET, brand: "HP" });
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const brandInput = await screen.findByLabelText(/^brand$/i);
    fireEvent.change(brandInput, { target: { value: "HP" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      "/assets/1",
      expect.objectContaining({ description: "Laptop", pi_number: "PI-3001" }),
    ));
    // Back to the read view, showing the just-saved value.
    fireEvent.click(await screen.findByRole("tab", { name: "Overview" }));
    expect(screen.getByText("HP")).toBeInTheDocument();
  });

  it("shows a save-error message instead of losing the edit silently", async () => {
    mockGets();
    (apiClient.put as any).mockRejectedValue(new Error("missing required custom field(s): asset_tag"));
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/missing required custom field/i)).toBeInTheDocument();
  });

  it("only shows actions valid for the current status and posts the chosen action", async () => {
    mockGets();
    (apiClient.post as any).mockResolvedValue({ id: 99, status_after: "ALLOTTED" });

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /move \/ allot/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /receive from repair/i })).not.toBeInTheDocument();

    // Holders are scoped to the asset's own company, not fetched unscoped.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/holders?company_id=1"));

    fireEvent.click(screen.getByRole("button", { name: /move \/ allot/i }));
    await pickSelectOption(/holder/i, "Ankur");
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/1/events", expect.objectContaining({
      event_type: "MOVED", to_holder_id: 5,
    })));
  });

  it("hides all lifecycle action buttons, and the Edit action, for HOLDER-role viewers", async () => {
    mockAuth("HOLDER");
    mockGets();

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /move \/ allot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    // Print Label is a read-only action available to every role.
    expect(screen.getByRole("button", { name: /print label/i })).toBeInTheDocument();
  });

  it("shows a QR code image and a working Print Label button", async () => {
    mockGets();
    (useAuthStore as any).getState = vi.fn().mockReturnValue({ role: "ADMIN", accessToken: "test-token" });
    const qrBlob = new Blob(["fake-png-bytes"]);
    window.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(qrBlob) }) as any;
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" })).toBeInTheDocument());

    await waitFor(() => expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/assets/1/qr.png"),
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    ));
    await waitFor(() => expect(screen.getByAltText(/asset qr code/i)).toHaveAttribute("src", "blob:mock-qr"));

    fireEvent.click(screen.getByRole("button", { name: /print label/i }));
    expect(printSpy).toHaveBeenCalled();
  });
});

describe("AssetDetail -- AM-07 asset correction", () => {
  it("shows the Correct Classification action only for ADMIN/IT_TEAM, never VIEWER/HOLDER", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    expect(screen.getByRole("button", { name: /correct classification/i })).toBeInTheDocument();
  });

  it("is hidden for VIEWER", async () => {
    mockAuth("VIEWER");
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    expect(screen.queryByRole("button", { name: /correct classification/i })).not.toBeInTheDocument();
  });

  it("opens with current values prefilled, and Asset Code shown read-only", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    fireEvent.click(screen.getByRole("button", { name: /correct classification/i }));
    const dialog = await screen.findByRole("dialog", { name: /correct classification/i });
    expect(within(dialog).getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument();
    expect(within(dialog).getByText(/asset code will not change/i)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent("IT Equipment"));
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Sub-Category" })).toHaveTextContent("Laptop"));
    expect(within(dialog).getByLabelText("Purchase Date")).toHaveValue("2025-06-01");
  });

  it("ordinary Edit mode never shows Category/Subcategory/Purchase Date controls", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sub-Category")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Purchase Date")).not.toBeInTheDocument();
  });

  it("Category change updates the Sub-Category options and clears an invalid old selection", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    fireEvent.click(screen.getByRole("button", { name: /correct classification/i }));
    await screen.findByRole("dialog", { name: /correct classification/i });

    await pickSelectOption("Category", "Furniture");
    const subcategoryTrigger = screen.getByRole("combobox", { name: "Sub-Category" });
    expect(subcategoryTrigger).toHaveTextContent(/none/i); // Laptop no longer valid for Furniture

    fireEvent.click(subcategoryTrigger);
    expect(await screen.findByRole("option", { name: "Chair" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Laptop" })).not.toBeInTheDocument();
  });

  it("requires a reason and at least one real change before Confirm is enabled", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    fireEvent.click(screen.getByRole("button", { name: /correct classification/i }));
    await screen.findByRole("dialog", { name: /correct classification/i });

    const confirm = screen.getByRole("button", { name: /confirm correction/i });
    expect(confirm).toBeDisabled(); // no change yet, no reason yet

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong category selected initially" } });
    expect(confirm).toBeDisabled(); // reason alone isn't enough -- nothing actually changed

    await pickSelectOption("Category", "Furniture");
    await pickSelectOption("Sub-Category", "Chair");
    expect(confirm).toBeEnabled();
  });

  it("shows an impact summary naming the old/new values and that Asset Code is unchanged", async () => {
    mockGets();
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    fireEvent.click(screen.getByRole("button", { name: /correct classification/i }));
    await screen.findByRole("dialog", { name: /correct classification/i });

    await pickSelectOption("Category", "Furniture");
    await pickSelectOption("Sub-Category", "Chair");

    expect(screen.getByText(/impact summary/i)).toBeInTheDocument();
    expect(screen.getByText("Category: IT Equipment → Furniture")).toBeInTheDocument();
    expect(screen.getByText("Sub-Category: Laptop → Chair")).toBeInTheDocument();
    expect(screen.getByText(/asset code: fa\/ho01\/it\/lap\/ck_1 — unchanged/i)).toBeInTheDocument();
  });

  it("submits only the changed fields, refreshes Asset 360, and closes the dialog on success", async () => {
    mockGets();
    (apiClient.post as any).mockResolvedValue({ ...FULL_ASSET, category_id: 4, subcategory_id: 8, category_name: "Furniture", subcategory_name: "Chair" });
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    fireEvent.click(screen.getByRole("button", { name: /correct classification/i }));
    await screen.findByRole("dialog", { name: /correct classification/i });

    await pickSelectOption("Category", "Furniture");
    await pickSelectOption("Sub-Category", "Chair");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong category selected initially" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm correction/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/1/corrections", {
      reason: "Wrong category selected initially", category_id: 4, subcategory_id: 8,
    }));
    // purchase_date was never touched -- must not appear in the body at all.
    expect((apiClient.post as any).mock.calls[0][1]).not.toHaveProperty("purchase_date");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /correct classification/i })).not.toBeInTheDocument());
    clickTab("Overview");
    const overviewPanel = await screen.findByRole("tabpanel", { name: "Overview" });
    expect(within(overviewPanel).getByText("Furniture")).toBeInTheDocument();
  });

  it("shows a server validation error inside the dialog without closing it", async () => {
    mockGets();
    (apiClient.post as any).mockRejectedValue(new Error("purchase date cannot be after the asset's earliest recorded event (2025-06-01)"));
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });
    fireEvent.click(screen.getByRole("button", { name: /correct classification/i }));
    await screen.findByRole("dialog", { name: /correct classification/i });

    fireEvent.change(screen.getByLabelText("Purchase Date"), { target: { value: "2025-06-10" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "trying to move it later" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm correction/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/earliest recorded event/i);
    expect(screen.getByRole("dialog", { name: /correct classification/i })).toBeInTheDocument();
  });

  it("the Changes tab shows a correction entry distinctly, with its reason", async () => {
    mockGets({
      changes: [
        {
          id: 1, field_name: "category_id", old_value: "CAT-1 - IT Equipment (#1)", new_value: "CAT-4 - Furniture (#4)",
          actor_id: 9, actor_name: "Admin", request_id: "r1", created_at: "2025-07-01T00:00:00Z",
          reason: "Wrong category selected initially",
        },
        {
          id: 2, field_name: "brand", old_value: "Dell", new_value: "HP",
          actor_id: 9, actor_name: "Admin", request_id: "r2", created_at: "2025-07-02T00:00:00Z",
          reason: null,
        },
      ],
    });
    renderWithClient(<AssetDetail assetId={1} />);
    await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_1" });

    clickTab("Changes");
    const panel = await screen.findByRole("tabpanel", { name: "Changes" });
    expect(within(panel).getByText("Correction")).toBeInTheDocument();
    expect(within(panel).getByText("Wrong category selected initially")).toBeInTheDocument();
    expect(within(panel).getByText("CAT-1 - IT Equipment (#1)")).toBeInTheDocument();
    expect(within(panel).getByText("Edit")).toBeInTheDocument();
  });
});
