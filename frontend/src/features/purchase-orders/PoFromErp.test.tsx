import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Draft, DraftLine } from "./PoDraftCard";

vi.mock("../../lib/api-client");

const DESKTOP_BUNDLE = {
  id: 1, name: "Desktop", is_active: true,
  parts: [
    { id: 11, name: "CPU", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 70, sort_order: 0 },
    { id: 12, name: "TFT", category_id: 2, subcategory_id: 20, serial_required: true, share_percent: 26, sort_order: 1 },
    { id: 13, name: "Keyboard", category_id: 3, subcategory_id: 30, serial_required: false, share_percent: 2, sort_order: 2 },
    { id: 14, name: "Mouse", category_id: 3, subcategory_id: 31, serial_required: false, share_percent: 2, sort_order: 3 },
  ],
};

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, category_id: 1, subcategory_id: 10, serial_required: true, bundle_id: null, default_brand_id: null,
  default_warranty_years: null, is_active: true, map_count: 1, ...over,
});
const ITEMS = [item(1, "Desktop", { bundle_id: 1 }), item(2, "Cable"), item(3, "Network Switch")];

const ROW = {
  po_code: 1133610106, po_number: "SPO/012994/26-27", po_date: "2026-09-18", company_code: "CKSPL",
  delivery_location: "CKSPL-WH-TAJNAGAR", vendor_id: 7, vendor_name: "Vansh Enterprises", line_count: 1, net_amount: 165200,
};

function line(over: Partial<DraftLine> = {}): DraftLine {
  return {
    item_code: "CT324973", description: "DELL DESKTOP REFURB/i3", barcode: "CT324973", quantity: 7, rate: 20000, amount: 140000,
    tax_percent: 18, hsn: "84732900", warranty_years: 1, brand_id: null, model: null,
    item_id: 1, item_name: "Desktop", matched_by: "ARTICLE", category_name: "Computers", subcategory_name: "CPU",
    bundle_id: 1, bundle_name: "Desktop", erp_description: "DELL DESKTOP REFURB/i3 · HARSHIT INFOSOLUTION", erp_name: "DELL DESKTOP REFURB/i3",
    article_key: "02-I3 CORE[IT-01]", article_name: "02-I3 CORE[IT-01]", section: "IT EQUIPMENTS", department: "FA_CE_DESKTOP",
    name_key: "dell desktop refurb i3", warnings: [], ...over,
  };
}

function draft(over: Partial<Draft> = {}, lines: DraftLine[] = [line()]): Draft {
  return {
    erp_po_code: 1133610106, po_number: "SPO/012994/26-27", po_date: "2026-09-18", company_id: 1, company_code: "CKSPL",
    company_name: "CITYKART STORES PVT. LTD.", cost_center_id: 5, vendor_id: 7, vendor_name: "VANSH ENTERPRISES",
    warehouse_code: "CKSPL-WH-TAJNAGAR", warehouse: "WH-TAJNAGAR", delivery_asset_user_id: 9,
    delivery_candidates: [{ id: 9, name: "WH Tajnagar Stores" }], already_created_id: null, status: "OPEN", warnings: [], lines, ...over,
  };
}

function mockApi({ configured = true, rows = [ROW] as unknown[], posError = null as Error | null, d = draft() } = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/erp/status") return Promise.resolve({ configured });
    if (path === "/erp/pos") return posError ? Promise.reject(posError) : Promise.resolve(rows);
    if (path.startsWith("/erp/pos/") && path.endsWith("/draft")) return Promise.resolve(d);
    if (path === "/bundles") return Promise.resolve([DESKTOP_BUNDLE]);
    if (path === "/items") return Promise.resolve(ITEMS);
    if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Citykart Stores Pvt Ltd" }]);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 7, name: "Vansh Enterprises" }]);
    if (path === "/masters/categories") return Promise.resolve([{ id: 1, name: "Computers" }]);
    if (path === "/masters/subcategories") return Promise.resolve([{ id: 10, category_id: 1, name: "CPU" }]);
    if (path === "/masters/brands") return Promise.resolve([{ id: 4, name: "Dell" }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 5, name: "CKSPL" }]);
    if (path.startsWith("/asset-users?company_id=")) return Promise.resolve([{ id: 9, name: "WH Tajnagar Stores", asset_user_type: "STOCK_POINT" }]);
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockImplementation((path: string) => {
    if (path === "/erp/pos/create") return Promise.resolve({ po_id: 42, po_number: "SPO/012994/26-27", lines_created: 28 });
    return Promise.resolve({});
  });
}

function renderScreen(path = "/purchase-orders/from-erp") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

async function openDraft() {
  fireEvent.click(await screen.findByRole("button", { name: "Review SPO/012994/26-27" }));
  return await screen.findByRole("button", { name: /create this purchase order/i });
}

// An option reads "label" or "label · detail" (Items show their Category › Sub-category).
async function chooseItem(label: RegExp, name: string) {
  fireEvent.click(screen.getByLabelText(label));
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${escaped}( ?· .*)?$`) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("Purchase Orders from the ERP", () => {
  it("lists the offered POs and opens one with the ERP words beside the code and the Item already chosen", async () => {
    mockApi();
    renderScreen();
    expect(await screen.findByText("SPO/012994/26-27")).toBeInTheDocument();
    expect(screen.getByText("CKSPL-WH-TAJNAGAR")).toBeInTheDocument();
    await openDraft();

    expect(screen.getByLabelText(/^po no\*?$/i)).toHaveValue("SPO/012994/26-27");
    expect(screen.getByText(/ERP code/)).toHaveTextContent("CT324973");
    expect(screen.getByText(/IT EQUIPMENTS › FA_CE_DESKTOP › 02-I3 CORE\[IT-01\]/)).toBeInTheDocument();
    expect(screen.getByText(/DELL DESKTOP REFURB\/i3 · HARSHIT INFOSOLUTION/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^item\*?$/i)).toHaveTextContent("Desktop");
    expect(await screen.findByText(/Computers › CPU · linked through its Article/)).toBeInTheDocument();
    expect(screen.getByText(/Desktop is a bundle: becomes 28 lines, 7 of each part/)).toBeInTheDocument();
    expect(screen.getByLabelText("Line 1 amount for CPU")).toHaveValue(14000);
    expect(screen.queryByLabelText(/^brand$/i)).not.toBeInTheDocument();          // a bundle has no single brand/model
  });

  it("creates the PO with the Item, the bundle's part amounts and no new rule when nothing changed", async () => {
    mockApi();
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/pos/create", {
        erp_po_code: 1133610106, company_id: 1, po_number: "SPO/012994/26-27", po_date: "2026-09-18", vendor_id: 7, cost_center_id: 5,
        delivery_asset_user_id: 9, warehouse_code: "CKSPL-WH-TAJNAGAR",
        lines: [{
          item_code: "CT324973", description: "DELL DESKTOP REFURB/i3", barcode: "CT324973", quantity: 7, rate: 20000, tax_percent: 18,
          warranty_years: 1, item_id: 1, brand_id: null, model: null,
          bundle_parts: [{ part_id: 11, amount: 14000 }, { part_id: 12, amount: 5200 }, { part_id: 13, amount: 400 }, { part_id: 14, amount: 400 }],
          map_scope: null, article_key: null, article_name: null, section: null, department: null, name_key: null,
        }],
      }),
    );
    expect(await screen.findByRole("link", { name: "Open SPO/012994/26-27" })).toHaveAttribute("href", "/purchase-orders/42");
    expect(screen.getByRole("status")).toHaveTextContent("Created. 28 lines added.");
  });

  it("an unlinked code asks for the Item, and remembers the choice for the whole Article by default", async () => {
    const unlinked = line({
      item_code: "CT500001", description: "48 PORT SWITCH", barcode: "CT500001", quantity: 2, rate: 9000, item_id: null, item_name: null,
      matched_by: null, category_name: null, subcategory_name: null, bundle_id: null, bundle_name: null, erp_description: "48 PORT SWITCH",
      article_key: "FA_IT_OTHERS", article_name: "FA_IT_OTHERS", department: "FA_IT_OTHERS", name_key: "48 port switch",
      warnings: ["No Item is linked to this ERP code yet (Article FA_IT_OTHERS). Choose the Item below; it is remembered for the next PO."],
    });
    mockApi({ d: draft({}, [unlinked]) });
    renderScreen();
    const create = await openDraft();
    expect(create).toBeDisabled();
    expect(screen.getByText(/Line 1: choose the Item\./)).toBeInTheDocument();
    expect(screen.getByText(/No Item is linked to this ERP code yet/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^remember$/i)).toHaveTextContent("Remember for every code of this Article");

    await chooseItem(/^item\*?$/i, "Network Switch");
    await waitFor(() => expect(create).not.toBeDisabled());
    expect(await screen.findByText("Computers › CPU")).toBeInTheDocument();    // category and sub-category come from the Item
    fireEvent.click(create);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    const sent = (apiClient.post as any).mock.calls[0][1].lines[0];
    expect(sent).toMatchObject({
      item_id: 3, map_scope: "ARTICLE", article_key: "FA_IT_OTHERS", article_name: "FA_IT_OTHERS", section: "IT EQUIPMENTS",
      department: "FA_IT_OTHERS", name_key: "48 port switch", bundle_parts: null,
    });
  });

  it("the remember choice can be narrowed to the product name or the code, or switched off", async () => {
    const unlinked = line({ item_id: null, item_name: null, matched_by: null, bundle_id: null, bundle_name: null, category_name: null, subcategory_name: null });
    mockApi({ d: draft({}, [unlinked]) });
    renderScreen();
    const create = await openDraft();
    await chooseItem(/^item\*?$/i, "Cable");
    await chooseItem(/^remember$/i, "Remember for this ERP code only");
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect((apiClient.post as any).mock.calls[0][1].lines[0]).toMatchObject({ item_id: 2, map_scope: "CODE" });
  });

  it("changing the Item of an already linked code re-points the rule that matched it", async () => {
    mockApi();
    renderScreen();
    const create = await openDraft();
    await chooseItem(/^item\*?$/i, "Cable");                          // Desktop -> Cable: no longer a bundle
    expect(screen.queryByText(/is a bundle/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^brand$/i)).toBeInTheDocument();    // now a single asset, brand and model apply
    expect(screen.getByLabelText(/^remember$/i)).toHaveTextContent("Remember for every code of this Article");   // it was linked through the Article
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect((apiClient.post as any).mock.calls[0][1].lines[0]).toMatchObject({ item_id: 2, map_scope: "ARTICLE", bundle_parts: null });
  });

  it("shows warnings, and blocks a PO that was already created", async () => {
    mockApi({ d: draft({ vendor_id: null, already_created_id: 3, warnings: ["Purchase order SPO/012994/26-27 was already created here; it cannot be created again."] }) });
    renderScreen();
    await openDraft();
    expect(await screen.findByLabelText("Things to check")).toHaveTextContent("already created here");
    expect(screen.getByRole("button", { name: /create this purchase order/i })).toBeDisabled();
  });

  it("filters the list by search", async () => {
    mockApi({ rows: [ROW, { ...ROW, po_code: 2, po_number: "SPO/777", vendor_name: "Jagannath" }] });
    renderScreen();
    expect(await screen.findByText("SPO/777")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search ERP purchase orders"), { target: { value: "jagan" } });
    expect(screen.queryByText("SPO/012994/26-27")).not.toBeInTheDocument();
    expect(screen.getByText("SPO/777")).toBeInTheDocument();
  });

  it("says so when the ERP connection is not set up", async () => {
    mockApi({ configured: false });
    renderScreen();
    expect(await screen.findByText("The ERP connection is not set up on this server.")).toBeInTheDocument();
    expect(screen.getByText("Ask the head-office admin.")).toBeInTheDocument();
    expect(screen.queryByText(/PO_SOURCE/)).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/erp/pos");
  });

  it("shows the server's own message when the ERP cannot be reached", async () => {
    mockApi({ posError: new Error("The ERP database could not be reached (OSError).") });
    renderScreen();
    expect(await screen.findByText(/could not be reached/)).toBeInTheDocument();
  });

  it("explains an empty list", async () => {
    mockApi({ rows: [] });
    renderScreen();
    expect(await screen.findByText("No open purchase orders to bring in.")).toBeInTheDocument();
  });

  it("the Purchase Orders list links to this screen", async () => {
    mockApi();
    renderScreen("/purchase-orders");
    expect(await screen.findByRole("link", { name: "Pick from ERP" })).toHaveAttribute("href", "/purchase-orders/from-erp");
  });
});

describe("Things CKAM does not track", () => {
  const CABLE = line({
    item_code: "CT166452", description: "CABLE CAT-6", barcode: "CT166452", quantity: 2, rate: 4000, amount: 8000, item_id: null, item_name: null, matched_by: null,
    category_name: null, subcategory_name: null, bundle_id: null, bundle_name: null, erp_description: "CABLE CAT-6 · DLINK", erp_name: "CABLE CAT-6",
    article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", section: "IT EQUIPMENTS", department: "FA_CE_CCTV", division: "FIXED ASSETS",
    name_key: "cable cat 6", warnings: ["No Item is linked to this ERP code yet."],
  });
  const LEFT_OUT = [{ item_code: "CT166452", description: "CABLE CAT-6", quantity: 2, rate: 4000, why: "Code" }];

  function asOwner(isPrimaryOwner: boolean) {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner, mustChangePassword: false });
  }

  it("the Primary Owner can say a line is not tracked, and the draft is read again without it", async () => {
    asOwner(true);
    const before = draft({}, [line(), CABLE]);
    const after = draft({ untracked_lines: LEFT_OUT }, [line()]);
    mockApi({ d: before });
    const base = (apiClient.get as any).getMockImplementation();
    let decided = false;
    (apiClient.get as any).mockImplementation((path: string) => (path.endsWith("/draft") ? Promise.resolve(decided ? after : before) : base(path)));
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/items/maps") decided = true;
      return Promise.resolve({});
    });
    renderScreen();
    await openDraft();
    fireEvent.click(screen.getByLabelText("Line 2: how far this reaches"));
    fireEvent.click(await screen.findByRole("option", { name: "This ERP code only" }));
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", {
        not_tracked: true, match_type: "CODE", company_id: 1, article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", section: "IT EQUIPMENTS",
        department: "FA_CE_CCTV", erp_item_code: "CT166452",
      }),
    );
    expect(await screen.findByText("1 line left out: not tracked in CKAM")).toBeInTheDocument();
    expect(screen.queryByLabelText("Line 2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("1 line left out: not tracked in CKAM"));
    expect(screen.getByText(/CABLE CAT-6/, { selector: "li" })).toHaveTextContent("2 × 4,000.00");
  });

  it("offers the whole Department, Section or Division too", async () => {
    asOwner(true);
    mockApi({ d: draft({}, [line(), CABLE]) });
    renderScreen();
    await openDraft();
    fireEvent.click(screen.getByLabelText("Line 2: how far this reaches"));
    expect(await screen.findByRole("option", { name: "The whole Department FA_CE_CCTV" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "The whole Section IT EQUIPMENTS" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "The whole Division FIXED ASSETS" }));
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { not_tracked: true, match_type: "DIVISION", company_id: 1, level_key: "FIXED ASSETS" }),
    );
  });

  it("people who cannot make rules do not see the choice, and a linked line never has it", async () => {
    asOwner(false);
    mockApi({ d: draft({}, [line(), CABLE]) });
    renderScreen();
    await openDraft();
    expect(screen.queryByRole("button", { name: "Line 2: not tracked" })).not.toBeInTheDocument();
    asOwner(true);
    expect(screen.queryByRole("button", { name: "Line 1: not tracked" })).not.toBeInTheDocument();      // line 1 is linked to Desktop
  });

  it("shows what a PO has beyond the lines CKAM tracks", async () => {
    mockApi({ rows: [{ ...ROW, tracked_lines: 1, untracked_lines: 3 }] });
    renderScreen();
    expect(await screen.findByText("1 (+3 not tracked)")).toBeInTheDocument();
  });
});

describe("S0 contract: the ERP decides number, date, vendor, open quantity and rate", () => {
  const CABLE_LINE = () => line({
    item_code: "CT900001", description: "HDMI CABLE", barcode: "CT900001", quantity: 10, rate: 100, item_id: 2, item_name: "Cable",
    matched_by: "CODE", bundle_id: null, bundle_name: null,
  });
  const QTY = "SPO/012994/26-27-line-0-quantity";
  const ID = "SPO/012994/26-27-line-0";

  async function openCableDraft(over: Partial<Draft> = {}) {
    mockApi({ d: draft(over, [CABLE_LINE()]) });
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    return create;
  }

  it("PO No, PO Date and the Vendor are shown read-only (from the ERP), and erp_po_code is always sent", async () => {
    mockApi();
    renderScreen();
    const create = await openDraft();
    const poNo = screen.getByLabelText(/^po no/i);
    const poDate = screen.getByLabelText(/^po date/i);
    expect(poNo).toHaveAttribute("readonly");
    expect(poDate).toHaveAttribute("readonly");
    expect(poNo).toHaveValue("SPO/012994/26-27");
    expect(poDate).toHaveValue("2026-09-18");
    const vendor = screen.getByLabelText(/^vendor/i);
    expect(vendor).toHaveAttribute("readonly");
    await waitFor(() => expect(vendor).toHaveValue("Vansh Enterprises")); // the CKAM vendor linked to the ERP supplier
    expect(screen.queryByText("New Vendor…")).not.toBeInTheDocument();
    expect(screen.getAllByText("From the ERP.").length).toBe(2);
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/pos/create", expect.objectContaining({
      erp_po_code: 1133610106, po_number: "SPO/012994/26-27", po_date: "2026-09-18", vendor_id: 7,
    })));
  });

  it("an ERP supplier with no linked vendor says so and blocks Create", async () => {
    mockApi({ d: draft({ vendor_id: null }) });
    renderScreen();
    const create = await openDraft();
    expect(await screen.findByText(/is not linked to a CKAM vendor for this company yet/i)).toBeInTheDocument();
    expect(create).toBeDisabled();
  });

  it("Item, description, barcode, brand, model, tax, warranty and FEWER units stay editable", async () => {
    const create = await openCableDraft();
    for (const field of ["description", "barcode", "tax", "warranty", "model"]) {
      expect(document.getElementById(`${ID}-${field}`)).not.toHaveAttribute("readonly");
      expect(document.getElementById(`${ID}-${field}`)).not.toBeDisabled();
    }
    fireEvent.change(document.getElementById(QTY)!, { target: { value: "4" } });
    fireEvent.change(document.getElementById(`${ID}-description`)!, { target: { value: "HDMI CABLE 2m" } });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect((apiClient.post as any).mock.calls[0][1].lines[0]).toMatchObject({ quantity: 4, description: "HDMI CABLE 2m", rate: 100 });
  });

  it("shows how many the ERP has open, and blocks more than that (and 0)", async () => {
    const create = await openCableDraft();
    const qty = document.getElementById(QTY)!;
    expect(qty).toHaveAttribute("max", "10");
    expect(screen.getByText("The ERP has 10 open: 1 to 10.")).toBeInTheDocument();

    fireEvent.change(qty, { target: { value: "11" } });
    expect(await screen.findByText(/Line 1: quantity cannot be more than the 10 the ERP still has open\./)).toBeInTheDocument();
    expect(create).toBeDisabled();

    fireEvent.change(qty, { target: { value: "0" } });
    expect(await screen.findByText(/Line 1: quantity must be a whole number, at least 1\./)).toBeInTheDocument();
    expect(create).toBeDisabled();

    fireEvent.change(qty, { target: { value: "10" } });
    await waitFor(() => expect(create).not.toBeDisabled());
  });

  it("a line the ERP has more than 1,000 of cannot be sent above 1,000", async () => {
    mockApi({ d: draft({}, [{ ...CABLE_LINE(), quantity: 5000 }]) });
    renderScreen();
    const create = await openDraft();
    expect(screen.getByText(/Whole number, 1 to 1,000\. The ERP has 5,000 open\./)).toBeInTheDocument();
    expect(await screen.findByText(/Line 1: quantity can be at most 1,000 on one line\./)).toBeInTheDocument();
    expect(create).toBeDisabled();
    fireEvent.change(document.getElementById(QTY)!, { target: { value: "1000" } });
    await waitFor(() => expect(create).not.toBeDisabled());
  });

  it("blocks a cost outside half to double the ERP rate, and says the range", async () => {
    const create = await openCableDraft();
    const rate = document.getElementById(`${ID}-rate`)!;
    expect(screen.getByText(/ERP rate 100\.00; keep within half to double\./)).toBeInTheDocument();
    fireEvent.change(rate, { target: { value: "0.0001" } });
    expect(await screen.findByText(/Line 1: cost must be between 50\.00 and 200\.00 \(half to double the ERP rate of 100\.00\)\./)).toBeInTheDocument();
    expect(create).toBeDisabled();
    fireEvent.change(rate, { target: { value: "250" } });
    await waitFor(() => expect(create).toBeDisabled());
    fireEvent.change(rate, { target: { value: "90" } });
    await waitFor(() => expect(create).not.toBeDisabled());
  });

  it("shows the server's 'units asked' refusal under the offending line, not only at the bottom", async () => {
    const create = await openCableDraft();
    (apiClient.post as any).mockRejectedValueOnce(new Error("CT900001: 12 units asked, but the ERP purchase order has only 10 open."));
    fireEvent.click(create);
    const inline = await screen.findByRole("alert", { name: "Line 1 refused" });
    expect(inline).toHaveTextContent("CT900001: 12 units asked, but the ERP purchase order has only 10 open.");
    expect(screen.getByText(/The purchase order was not created\. Fix line 1 marked in red above/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Line 1")).getByRole("alert")).toBe(inline);
  });

  it("shows the server's 'too far from the ERP rate' refusal under its line", async () => {
    const create = await openCableDraft();
    const sentence = "Line 1 (CT900001): the cost 60 is too far from the ERP rate 100 (it may be between half and double the ERP rate).";
    (apiClient.post as any).mockRejectedValueOnce(new Error(sentence));
    fireEvent.click(create);
    expect(await screen.findByRole("alert", { name: "Line 1 refused" })).toHaveTextContent(sentence);
  });

  it("an order-level refusal is shown once at the bottom, as the server wrote it", async () => {
    const create = await openCableDraft();
    const sentence = "This ERP purchase order belongs to the ERP company CKSPL, not to Other Co.";
    (apiClient.post as any).mockRejectedValueOnce(new Error(sentence));
    fireEvent.click(create);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "Line 1 refused" })).not.toBeInTheDocument();
  });
});
