import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  id, name, category_id: 1, subcategory_id: 10, serial_required: null, bundle_id: null, default_brand_id: null,
  default_warranty_years: null, is_active: true, effective_serial_required: true, map_count: 1, ...over,
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

async function chooseItem(label: RegExp, name: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name }));
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
    expect(await screen.findByText(/Computers › CPU$/)).toBeInTheDocument();    // category and sub-category come from the Item
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
