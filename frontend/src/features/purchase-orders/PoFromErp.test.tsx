import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Draft } from "./PoDraftCard";

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

const ROW = {
  po_code: 1133610106, po_number: "SPO/012994/26-27", po_date: "2026-09-18", company_code: "CKSPL",
  delivery_location: "CKSPL-WH-TAJNAGAR", vendor_id: 7, vendor_name: "Vansh Enterprises", line_count: 1, net_amount: 165200,
};

function draft(over: Partial<Draft> = {}): Draft {
  return {
    erp_po_code: 1133610106, po_number: "SPO/012994/26-27", po_date: "2026-09-18", company_id: 1, company_code: "CKSPL",
    company_name: "CITYKART STORES PVT. LTD.", cost_center_id: 5, vendor_id: 7, vendor_name: "VANSH ENTERPRISES",
    warehouse_code: "CKSPL-WH-TAJNAGAR", warehouse: "WH-TAJNAGAR", delivery_asset_user_id: 9,
    delivery_candidates: [{ id: 9, name: "WH Tajnagar Stores" }], already_created_id: null, status: "OPEN", warnings: [],
    lines: [{
      item_code: "CT324973", description: "DELL DESKTOP REFURB/i3", barcode: "CT324973", quantity: 7, rate: 20000, amount: 140000,
      tax_percent: 18, hsn: "84732900", group_code: "FA_CE_DESKTOP", warranty_years: 1, category_id: null, subcategory_id: null,
      brand_id: null, model: null, bundle_id: 1, remembered: false, category_from_group: false, warnings: [],
    }],
    ...over,
  };
}

function mockApi({ configured = true, rows = [ROW] as unknown[], posError = null as Error | null, d = draft() } = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/erp/status") return Promise.resolve({ configured });
    if (path === "/erp/pos") return posError ? Promise.reject(posError) : Promise.resolve(rows);
    if (path.startsWith("/erp/pos/") && path.endsWith("/draft")) return Promise.resolve(d);
    if (path === "/bundles") return Promise.resolve([DESKTOP_BUNDLE]);
    if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Citykart Stores Pvt Ltd" }]);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 7, name: "Vansh Enterprises" }]);
    if (path === "/masters/categories") return Promise.resolve([{ id: 1, name: "Accessories" }]);
    if (path === "/masters/subcategories") return Promise.resolve([{ id: 10, category_id: 1, name: "Cable" }]);
    if (path === "/masters/brands") return Promise.resolve([]);
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

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("Purchase Orders from the ERP", () => {
  it("lists the offered POs and opens one as a prefilled draft", async () => {
    mockApi();
    renderScreen();
    expect(await screen.findByText("SPO/012994/26-27")).toBeInTheDocument();
    expect(screen.getByText("CKSPL-WH-TAJNAGAR")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review SPO/012994/26-27" }));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/pos/1133610106/draft"));
    expect(await screen.findByLabelText(/^po no\*?$/i)).toHaveValue("SPO/012994/26-27");
    expect(screen.getByLabelText(/^barcode\*?$/i)).toHaveValue("CT324973");
    expect(screen.getByText(/In the ERP: VANSH ENTERPRISES/)).toBeInTheDocument();
    expect(screen.getByText(/Location in the ERP: WH-TAJNAGAR/)).toBeInTheDocument();
    expect(screen.getByText(/Becomes 28 lines: 7 of each part/)).toBeInTheDocument();
    expect(screen.getByLabelText("Line 1 amount for CPU")).toHaveValue(14000);
  });

  it("creates the PO with its ERP code, the bundle's part amounts and the delivery location, then links to it", async () => {
    mockApi();
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Review SPO/012994/26-27" }));
    const create = await screen.findByRole("button", { name: /create this purchase order/i });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/pos/create", {
        erp_po_code: 1133610106, company_id: 1, po_number: "SPO/012994/26-27", po_date: "2026-09-18", vendor_id: 7, cost_center_id: 5,
        delivery_asset_user_id: 9, warehouse_code: "CKSPL-WH-TAJNAGAR",
        lines: [{
          item_code: "CT324973", group_code: "FA_CE_DESKTOP", description: "DELL DESKTOP REFURB/i3", barcode: "CT324973",
          quantity: 7, rate: 20000, tax_percent: 18, warranty_years: 1, category_id: null, subcategory_id: null,
          brand_id: null, model: null, bundle_id: 1,
          bundle_parts: [{ part_id: 11, amount: 14000 }, { part_id: 12, amount: 5200 }, { part_id: 13, amount: 400 }, { part_id: 14, amount: 400 }],
          remember: true,
        }],
      }),
    );
    expect(await screen.findByRole("link", { name: "Open SPO/012994/26-27" })).toHaveAttribute("href", "/purchase-orders/42");
    expect(screen.getByRole("status")).toHaveTextContent("Created. 28 lines added.");
  });

  it("a plain line needs its category and sub-category before it can be created", async () => {
    const plain = draft({ lines: [{ ...draft().lines[0], item_code: "CT222433", description: "CAT-6 CABLE", bundle_id: null, quantity: 3 }] });
    mockApi({ d: plain });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Review SPO/012994/26-27" }));
    const create = await screen.findByRole("button", { name: /create this purchase order/i });
    expect(create).toBeDisabled();
    expect(screen.getByText(/Line 1: category and sub-category are required\./)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^category\*?$/i));
    fireEvent.click(await screen.findByText("Accessories"));
    fireEvent.click(screen.getByLabelText(/^sub-category\*?$/i));
    fireEvent.click(await screen.findByText("Cable"));
    await waitFor(() => expect(create).not.toBeDisabled());
  });

  it("shows warnings, and blocks a PO that was already created", async () => {
    mockApi({ d: draft({ vendor_id: null, already_created_id: 3, warnings: ["Purchase order SPO/012994/26-27 was already created here; it cannot be created again."] }) });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Review SPO/012994/26-27" }));
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
