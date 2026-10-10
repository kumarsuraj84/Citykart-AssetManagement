import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, category_id: 1, subcategory_id: 10, serial_required: null, bundle_id: null, default_brand_id: null,
  default_warranty_years: null, is_active: true, effective_serial_required: true, map_count: 0, ...over,
});
const ITEMS = [
  item(1, "Desktop", { bundle_id: 1, map_count: 2 }),
  item(2, "Mouse", { category_id: 3, subcategory_id: 31, serial_required: false, effective_serial_required: false }),
  item(3, "UPS", { category_id: 3, subcategory_id: null }),
];
const ARTICLES = [
  { article_key: "FA_CE_UPS", article_name: "FA_CE_UPS", section: "COMPUTER EQUIPMENT", department: "FA_CE_UPS", codes: 2, units: 900, lines: 114,
    samples: ["APC UPS"], item_id: null, item_name: null, name_rules: 0, code_rules: 0, suggested_item_id: 3, suggested_item_name: "UPS" },
  { article_key: "02-I3 CORE[IT-01]", article_name: "02-I3 CORE[IT-01]", section: "IT EQUIPMENTS", department: "FA_CE_DESKTOP", codes: 5, units: 657, lines: 60,
    samples: ["DELL DESKTOP REFURB/I3"], item_id: 1, item_name: "Desktop", name_rules: 1, code_rules: 0, suggested_item_id: null, suggested_item_name: null },
  { article_key: "FA_IT_OTHERS", article_name: "FA_IT_OTHERS", section: "IT EQUIPMENTS", department: "FA_IT_OTHERS", codes: 109, units: 7696955, lines: 209,
    samples: ["6U RACK", "48 PORT SWITCH"], item_id: null, item_name: null, name_rules: 0, code_rules: 0, suggested_item_id: null, suggested_item_name: null },
];
const CODES = [
  { icode: "CT500001", name: "48 PORT SWITCH", name_key: "48 port switch", description: "48 PORT SWITCH · TP-LINK", units: 12, lines: 3, item_id: null, item_name: null, matched_by: null },
  { icode: "CT500002", name: "6U RACK", name_key: "6u rack", description: "6U RACK", units: 5, lines: 2, item_id: 2, item_name: "Mouse", matched_by: "NAME" },
];

function mockApi(articlesError: Error | null = null) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/items") return Promise.resolve(ITEMS);
    if (path === "/items/articles") return articlesError ? Promise.reject(articlesError) : Promise.resolve(ARTICLES);
    if (path.startsWith("/items/articles/codes")) return Promise.resolve(CODES);
    if (path === "/masters/categories") return Promise.resolve([{ id: 1, name: "Computers" }, { id: 3, name: "Accessories" }]);
    if (path === "/masters/subcategories") return Promise.resolve([{ id: 10, category_id: 1, name: "CPU" }, { id: 31, category_id: 3, name: "Mouse Unit" }]);
    if (path === "/bundles") return Promise.resolve([{ id: 1, name: "Desktop Set", is_active: true, parts: [] }]);
    if (path === "/masters/brands") return Promise.resolve([{ id: 4, name: "Dell" }]);
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.put as any).mockResolvedValue({});
  (apiClient.delete as any).mockResolvedValue(undefined);
}

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("Items screen", () => {
  it("lists each Item with its classification, serial default, bundle and ERP links", async () => {
    mockApi();
    renderAt("/setup/items");
    const desktop = (await screen.findByText("Desktop")).closest("tr")!;
    await waitFor(() => expect(within(desktop).getByText("Computers › CPU")).toBeInTheDocument());
    expect(within(desktop).getByText("Same as above (Yes)")).toBeInTheDocument();
    expect(within(desktop).getByText("Desktop Set")).toBeInTheDocument();
    expect(within(desktop).getByText("2")).toBeInTheDocument();
    const mouse = screen.getByText("Mouse").closest("tr")!;
    expect(within(mouse).getByText("No")).toBeInTheDocument();
    expect(await screen.findByText("Accessories › Mouse Unit")).toBeInTheDocument();
  });

  it("creates an Item with its category, sub-category and serial setting", async () => {
    mockApi();
    renderAt("/setup/items");
    fireEvent.click(await screen.findByRole("button", { name: "New Item" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Cassette AC" } });
    fireEvent.click(within(dialog).getByLabelText(/^category/i));
    fireEvent.click(await screen.findByRole("option", { name: "Computers" }));
    fireEvent.click(within(dialog).getByLabelText(/^sub-category/i));
    fireEvent.click(await screen.findByRole("option", { name: "CPU" }));
    fireEvent.click(within(dialog).getByLabelText(/^serial number/i));
    fireEvent.click(await screen.findByRole("option", { name: "No serial number" }));
    fireEvent.change(within(dialog).getByLabelText(/default warranty/i), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items", {
        name: "Cassette AC", category_id: 1, subcategory_id: 10, serial_required: false, bundle_id: null, default_brand_id: null,
        default_warranty_years: 2,
      }),
    );
  });

  it("editing opens with the stored values and PUTs the change", async () => {
    mockApi();
    renderAt("/setup/items");
    fireEvent.click(await screen.findByRole("button", { name: "Edit Mouse" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^item name/i)).toHaveValue("Mouse");
    expect(within(dialog).getByLabelText(/^serial number/i)).toHaveTextContent("No serial number");
    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Wireless Mouse" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/items/2", expect.objectContaining({ name: "Wireless Mouse", category_id: 3, subcategory_id: 31, serial_required: false })),
    );
  });

  it("deactivating asks first, then calls DELETE", async () => {
    mockApi();
    renderAt("/setup/items");
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate UPS" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Deactivate UPS?");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/3"));
  });

  it("Create from Sub-Categories reports how many Items were made", async () => {
    mockApi();
    (apiClient.post as any).mockResolvedValue({ created: 3 });
    renderAt("/setup/items");
    fireEvent.click(await screen.findByRole("button", { name: "Create from Sub-Categories" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Created 3 Items from Sub-Categories.");
    expect(apiClient.post).toHaveBeenCalledWith("/items/seed-from-subcategories", {});
  });
});

describe("ERP Articles screen", () => {
  it("shows the Articles not linked yet, with a suggested Item, and links one", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    expect(await screen.findByText("FA_CE_UPS")).toBeInTheDocument();
    expect(screen.getByText("COMPUTER EQUIPMENT › FA_CE_UPS")).toBeInTheDocument();
    expect(screen.getByText("Suggested: UPS")).toBeInTheDocument();
    expect(screen.queryByText("02-I3 CORE[IT-01]")).not.toBeInTheDocument();                 // already linked: hidden in "Not linked"
    expect(screen.getByText("1 of 3 Articles linked")).toBeInTheDocument();
    expect(screen.getByLabelText("Item for FA_CE_UPS")).toHaveTextContent("UPS");              // the suggestion is pre-filled, not saved
    fireEvent.click(screen.getByRole("button", { name: "Link FA_CE_UPS" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", {
        item_id: 3, match_type: "ARTICLE", article_key: "FA_CE_UPS", article_name: "FA_CE_UPS", section: "COMPUTER EQUIPMENT", department: "FA_CE_UPS",
      }),
    );
  });

  it("All shows linked Articles too, with their Item and extra rules, and Change is only offered after picking another Item", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    await screen.findByText("FA_CE_UPS");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    const row = screen.getByText("02-I3 CORE[IT-01]").closest("tr")!;
    expect(within(row).getByText("+ 1 by name, 0 by code")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Link 02-I3 CORE[IT-01]" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Item for 02-I3 CORE[IT-01]"));
    fireEvent.click(await screen.findByRole("option", { name: "UPS" }));
    expect(within(row).getByRole("button", { name: "Link 02-I3 CORE[IT-01]" })).toHaveTextContent("Change");
    expect(within(row).getByRole("button", { name: "Link 02-I3 CORE[IT-01]" })).not.toBeDisabled();
  });

  it("searches by Article, department or product", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    await screen.findByText("FA_CE_UPS");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByLabelText("Search ERP Articles"), { target: { value: "rack" } });
    expect(screen.getByText("FA_IT_OTHERS")).toBeInTheDocument();
    expect(screen.queryByText("FA_CE_UPS")).not.toBeInTheDocument();
  });

  it("a mixed Article is linked code by code or product name by product name", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    fireEvent.click(await screen.findByRole("button", { name: "Codes of FA_IT_OTHERS" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("48 PORT SWITCH")).toBeInTheDocument();
    expect(within(dialog).getByText("Not linked to any Item")).toBeInTheDocument();
    expect(within(dialog).getByText(/by its product name/)).toBeInTheDocument();             // the rack already follows a name rule

    fireEvent.click(within(dialog).getByLabelText("Item for CT500001"));
    fireEvent.click(await screen.findByRole("option", { name: "UPS" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Link name of CT500001" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", {
        item_id: 3, match_type: "NAME", article_key: "FA_IT_OTHERS", article_name: "FA_IT_OTHERS", section: "IT EQUIPMENTS",
        department: "FA_IT_OTHERS", name_key: "48 port switch",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Link code CT500001" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ match_type: "CODE", erp_item_code: "CT500001", item_id: 3 })),
    );
  });

  it("shows the server's message when the ERP cannot be read", async () => {
    mockApi(new Error("The ERP database could not be reached (OSError)."));
    renderAt("/setup/erp-articles");
    expect(await screen.findByText(/could not be reached/)).toBeInTheDocument();
  });

  describe("with two companies (each has its own ERP master)", () => {
    function mockTwoCompanies() {
      mockApi();
      const base = (apiClient.get as any).getMockImplementation();
      (apiClient.get as any).mockImplementation((path: string) => {
        if (path === "/masters/companies") return Promise.resolve([{ id: 1, name: "Citykart Stores" }, { id: 2, name: "Citykart Ventures" }]);
        if (path === "/items/articles?company_id=2") {
          return Promise.resolve([{ ...ARTICLES[0], article_key: "VT_MIC_STD", article_name: "VT_MIC_STD", department: "VT_AUDIO", samples: ["MIC STAND TYPE"], suggested_item_id: null, suggested_item_name: null }]);
        }
        if (path === "/items/articles?company_id=1") return base("/items/articles");
        return base(path);
      });
    }

    it("asks the ERP for the first company's Articles, and the other company's when switched", async () => {
      mockTwoCompanies();
      renderAt("/setup/erp-articles");
      expect(await screen.findByText("FA_CE_UPS")).toBeInTheDocument();
      expect(apiClient.get).toHaveBeenCalledWith("/items/articles?company_id=1");

      fireEvent.click(screen.getByLabelText("Company"));
      fireEvent.click(await screen.findByRole("option", { name: "Citykart Ventures" }));
      expect(await screen.findByText("VT_MIC_STD")).toBeInTheDocument();
      expect(apiClient.get).toHaveBeenCalledWith("/items/articles?company_id=2");
      expect(screen.queryByText("FA_CE_UPS")).not.toBeInTheDocument();
    });

    it("a link made for a company belongs to that company", async () => {
      mockTwoCompanies();
      renderAt("/setup/erp-articles");
      await screen.findByText("FA_CE_UPS");
      fireEvent.click(screen.getByRole("button", { name: "Link FA_CE_UPS" }));
      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ company_id: 1, match_type: "ARTICLE", article_key: "FA_CE_UPS" })),
      );
      fireEvent.click(screen.getByLabelText("Company"));
      fireEvent.click(await screen.findByRole("option", { name: "Citykart Ventures" }));
      await screen.findByText("VT_MIC_STD");
      fireEvent.click(screen.getByLabelText("Item for VT_MIC_STD"));
      fireEvent.click(await screen.findByRole("option", { name: "UPS" }));
      fireEvent.click(screen.getByRole("button", { name: "Link VT_MIC_STD" }));
      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ company_id: 2, article_key: "VT_MIC_STD", item_id: 3 })),
      );
    });

    it("the codes of an Article are read and linked for the chosen company", async () => {
      mockTwoCompanies();
      renderAt("/setup/erp-articles");
      fireEvent.click(await screen.findByRole("button", { name: "Codes of FA_IT_OTHERS" }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("48 PORT SWITCH");
      expect(apiClient.get).toHaveBeenCalledWith("/items/articles/codes?article_key=FA_IT_OTHERS&company_id=1");
      fireEvent.click(within(dialog).getByLabelText("Item for CT500001"));
      fireEvent.click(await screen.findByRole("option", { name: "UPS" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Link code CT500001" }));
      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ company_id: 1, match_type: "CODE", erp_item_code: "CT500001" })),
      );
    });
  });
});
