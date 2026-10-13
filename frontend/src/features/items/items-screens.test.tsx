import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { HEAD_OFFICE } from "../../test-capabilities";

vi.mock("../../lib/api-client");

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, category_id: 1, subcategory_id: 10, serial_required: true, bundle_id: null, default_brand_id: null,
  default_warranty_years: null, is_active: true, map_count: 0, ...over,
});
const ITEMS = [
  item(1, "Desktop", { bundle_id: 1, map_count: 2 }),
  item(2, "Mouse", { category_id: 3, subcategory_id: 31, serial_required: false }),
  item(3, "UPS", { category_id: 3, subcategory_id: 32 }),
];
const ARTICLES = [
  { article_key: "FA_CE_UPS", article_name: "FA_CE_UPS", section: "COMPUTER EQUIPMENT", department: "FA_CE_UPS", codes: 2, units: 900, lines: 114,
    samples: ["APC UPS"], item_id: null, item_name: null, name_rules: 0, code_rules: 0, suggested_item_id: 3, suggested_item_name: "UPS" },
  { article_key: "02-I3 CORE[IT-01]", article_name: "02-I3 CORE[IT-01]", section: "IT EQUIPMENTS", department: "FA_CE_DESKTOP", codes: 5, units: 657, lines: 60,
    samples: ["DELL DESKTOP REFURB/I3"], icodes: ["CT324973", "CT999001"], names: ["DELL DESKTOP REFURB/I3", "LENOVO DESKTOP I3"],
    item_id: 1, item_name: "Desktop", name_rules: 1, code_rules: 0, suggested_item_id: null, suggested_item_name: null },
  { article_key: "FA_IT_OTHERS", article_name: "FA_IT_OTHERS", section: "IT EQUIPMENTS", department: "FA_IT_OTHERS", codes: 109, units: 7696955, lines: 209,
    samples: ["6U RACK", "48 PORT SWITCH"], item_id: null, item_name: null, name_rules: 0, code_rules: 0, suggested_item_id: null, suggested_item_name: null },
];
const CODES = [
  { icode: "CT500001", name: "48 PORT SWITCH", name_key: "48 port switch", description: "48 PORT SWITCH · TP-LINK", units: 12, lines: 3, item_id: null, item_name: null, matched_by: null },
  { icode: "CT500002", name: "6U RACK", name_key: "6u rack", description: "6U RACK", units: 5, lines: 2, item_id: 2, item_name: "Mouse", matched_by: "NAME" },
];

function mockApi(articlesError: Error | null = null) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/capabilities") return Promise.resolve(HEAD_OFFICE);
    if (path === "/items") return Promise.resolve(ITEMS);
    if (path === "/items/articles") return articlesError ? Promise.reject(articlesError) : Promise.resolve(ARTICLES);
    if (path.startsWith("/items/articles/codes")) return Promise.resolve(CODES);
    if (path === "/masters/categories") {
      return Promise.resolve([{ id: 1, code: "COMP", name: "Computers", asset_domain: "IT" }, { id: 3, code: "ACC", name: "Accessories", asset_domain: "NON_IT" }]);
    }
    if (path === "/masters/subcategories") return Promise.resolve([{ id: 10, category_id: 1, name: "CPU" }, { id: 31, category_id: 3, name: "Mouse Unit" }, { id: 32, category_id: 3, name: "UPS Unit" }]);
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

// The screen opens on its Codes view; these tests are about the Articles view.
async function openArticles() {
  fireEvent.click(await screen.findByRole("button", { name: "Articles" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("Items screen", () => {
  it("lists each Item with its classification, serial default, bundle and ERP links", async () => {
    mockApi();
    renderAt("/settings/catalogue/items");
    const desktop = (await screen.findByText("Desktop")).closest("tr")!;
    await waitFor(() => expect(within(desktop).getByText("Computers › CPU")).toBeInTheDocument());
    expect(within(desktop).getByText("Yes")).toBeInTheDocument();
    expect(within(desktop).getByText("Desktop Set")).toBeInTheDocument();
    expect(within(desktop).getByText("2")).toBeInTheDocument();
    const mouse = screen.getByText("Mouse").closest("tr")!;
    expect(within(mouse).getByText("No")).toBeInTheDocument();
    expect(await screen.findByText("Accessories › Mouse Unit")).toBeInTheDocument();
  });

  it("creates an Item with a name, ONE type-of-asset pick and a serial choice (Category and Sub-category are never asked separately)", async () => {
    mockApi();
    renderAt("/settings/catalogue/items");
    fireEvent.click(await screen.findByRole("button", { name: "New Item" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(dialog).queryByRole("combobox", { name: /^category$/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: /^sub-category$/i })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Cassette AC" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: /type of asset/i }));
    // Each entry is "Group › Sub-category" with the group's work area as a chip.
    const option = await screen.findByRole("option", { name: /^Computers › CPU/ });
    expect(option).toHaveTextContent("IT Team");
    fireEvent.click(option);
    expect(within(dialog).getByText(/work area: it team/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: "No serial number" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^more$/i }));
    fireEvent.change(within(dialog).getByLabelText(/default warranty/i), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items", {
        name: "Cassette AC", category_id: 1, subcategory_id: 10, serial_required: false, serial_later: false, bundle_id: null,
        default_brand_id: null, default_warranty_years: 2,
      }),
    );
  });

  it("\"Serial will be entered later\" (an amplifier) is saved as a serial read later", async () => {
    mockApi();
    renderAt("/settings/catalogue/items");
    fireEvent.click(await screen.findByRole("button", { name: "New Item" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Amplifier" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: /type of asset/i }));
    fireEvent.click(await screen.findByRole("option", { name: /^Computers › CPU/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Serial will be entered later" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({ name: "Amplifier", serial_required: true, serial_later: true })),
    );
  });

  it("an Item's list entry spells out that its serial is entered later", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/items") return Promise.resolve([item(9, "Amplifier", { serial_later: true })]);
      return Promise.resolve([]);
    });
    renderAt("/settings/catalogue/items");
    const row = (await screen.findByText("Amplifier")).closest("tr")!;
    expect(within(row).getByText("Yes (entered later)")).toBeInTheDocument();
  });

  it("Save stays off until there is a name and a type of asset, and says what is still needed", async () => {
    mockApi();
    renderAt("/settings/catalogue/items");
    fireEvent.click(await screen.findByRole("button", { name: "New Item" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Ceiling Fan" } });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(dialog).getByText(/still needed: the type of asset/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("combobox", { name: /type of asset/i }));
    fireEvent.click(await screen.findByRole("option", { name: /^Accessories › Mouse Unit/ }));
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("\"New type…\" creates a Sub-category from the Item form and picks it, with its Code suggested", async () => {
    mockApi();
    (apiClient.post as any).mockImplementation((path: string, body: any) =>
      Promise.resolve(path === "/masters/subcategories" ? { id: 40, ...body } : {}));
    renderAt("/settings/catalogue/items");
    fireEvent.click(await screen.findByRole("button", { name: "New Item" }));
    const itemDialog = screen.getByRole("dialog");
    fireEvent.change(within(itemDialog).getByLabelText(/^item name/i), { target: { value: "PoE Switch" } });
    fireEvent.click(within(itemDialog).getByRole("combobox", { name: /type of asset/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new type/i }));

    const subDialog = await screen.findByRole("dialog", { name: /new sub-category/i });
    fireEvent.click(within(subDialog).getByLabelText(/^category/i));
    fireEvent.click(await screen.findByRole("option", { name: "Computers" }));
    fireEvent.change(within(subDialog).getByLabelText(/^name/i), { target: { value: "Network Switch" } });
    fireEvent.click(within(subDialog).getByRole("button", { name: /^more$/i }));
    expect(within(subDialog).getByLabelText(/^code/i)).toHaveValue("NS");      // suggested, still editable under More
    fireEvent.click(within(subDialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/subcategories", { category_id: 1, name: "Network Switch", code: "NS" }),
    );

    // back on the Item form with the new type chosen: it can be saved straight away
    const back = await screen.findByRole("dialog", { name: /new item/i });
    await waitFor(() => expect(within(back).getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(within(back).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({ name: "PoE Switch", category_id: 1, subcategory_id: 40 })),
    );
  });

  it("\"New type…\" can make a new group (Category) too, from the Sub-category dialog", async () => {
    mockApi();
    (apiClient.post as any).mockImplementation((path: string, body: any) =>
      Promise.resolve(path === "/masters/categories" ? { id: 50, ...body } : path === "/masters/subcategories" ? { id: 41, ...body } : {}));
    renderAt("/settings/catalogue/items");
    fireEvent.click(await screen.findByRole("button", { name: "New Item" }));
    const itemDialog = screen.getByRole("dialog");
    fireEvent.change(within(itemDialog).getByLabelText(/^item name/i), { target: { value: "Ceiling Fan" } });
    fireEvent.click(within(itemDialog).getByRole("combobox", { name: /type of asset/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new type/i }));
    const subDialog = await screen.findByRole("dialog", { name: /new sub-category/i });
    fireEvent.click(within(subDialog).getByLabelText(/^category/i));
    fireEvent.click(await screen.findByRole("option", { name: /new category/i }));

    const catDialog = await screen.findByRole("dialog", { name: /new category/i });
    fireEvent.change(within(catDialog).getByLabelText(/^name/i), { target: { value: "Admin Fixed Assets" } });
    fireEvent.click(within(catDialog).getByRole("button", { name: /^more$/i }));
    expect(within(catDialog).getByLabelText(/^code/i)).toHaveValue("AFA");
    fireEvent.click(within(catDialog).getByLabelText(/^work area/i));
    fireEvent.click(await screen.findByRole("option", { name: "Admin / Non-IT Team" }));
    fireEvent.click(within(catDialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/categories", { name: "Admin Fixed Assets", code: "AFA", asset_domain: "NON_IT" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /new category/i })).not.toBeInTheDocument());
    const back = await screen.findByRole("dialog", { name: /new sub-category/i });
    fireEvent.change(within(back).getByLabelText(/^name/i), { target: { value: "Fan" } });
    fireEvent.click(within(back).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/subcategories", { category_id: 50, name: "Fan", code: "FAN" }),
    );
  });

  it("editing opens with the stored values and PUTs the change", async () => {
    mockApi();
    renderAt("/settings/catalogue/items");
    fireEvent.click(await screen.findByRole("button", { name: "Edit Mouse" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^item name/i)).toHaveValue("Mouse");
    expect(within(dialog).getByRole("radio", { name: "No serial number" })).toBeChecked();
    expect(within(dialog).getByRole("combobox", { name: /type of asset/i })).toHaveTextContent("Accessories › Mouse Unit");
    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Wireless Mouse" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/items/2", expect.objectContaining({ name: "Wireless Mouse", category_id: 3, subcategory_id: 31, serial_required: false })),
    );
  });

  it("deactivating asks first, then calls DELETE", async () => {
    mockApi();
    renderAt("/settings/catalogue/items");
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate UPS" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Deactivate UPS?");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/3"));
  });

  it("Create from Sub-categories reports how many Items were made", async () => {
    mockApi();
    (apiClient.post as any).mockResolvedValue({ created: 3 });
    renderAt("/settings/catalogue/items");
    fireEvent.click(await screen.findByRole("button", { name: "Create from Sub-categories" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Created 3 Items from Sub-categories.");
    expect(apiClient.post).toHaveBeenCalledWith("/items/seed-from-subcategories", {});
  });
});

describe("ERP Mapping screen (formerly ERP Articles)", () => {
  it("is titled ERP Mapping, and its Item picker shows each Item's Category", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    expect(await screen.findByRole("heading", { name: "ERP Mapping" })).toBeInTheDocument();
    await openArticles();
    fireEvent.click(await screen.findByLabelText("Item for FA_CE_UPS"));
    expect(await screen.findByRole("option", { name: /^UPS ?· Accessories › UPS Unit$/ })).toBeInTheDocument();
  });

  it("shows the Articles not linked yet, with a suggested Item, and links one", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    await openArticles();
    expect(await screen.findByText("FA_CE_UPS")).toBeInTheDocument();
    expect(screen.getByText("COMPUTER EQUIPMENT › FA_CE_UPS")).toBeInTheDocument();
    expect(screen.getByText("Suggested: UPS")).toBeInTheDocument();
    expect(screen.queryByText("02-I3 CORE[IT-01]")).not.toBeInTheDocument();                 // already linked: hidden in "Not linked"
    expect(screen.getByRole("button", { name: "Not decided (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Linked (1)" })).toBeInTheDocument();
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
    await openArticles();
    await screen.findByText("FA_CE_UPS");
    fireEvent.click(screen.getByRole("button", { name: "All (3)" }));
    const row = screen.getByText("02-I3 CORE[IT-01]").closest("tr")!;
    expect(within(row).getByText("+ 1 by name, 0 by code")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Link 02-I3 CORE[IT-01]" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Item for 02-I3 CORE[IT-01]"));
    fireEvent.click(await screen.findByRole("option", { name: /^UPS( ?· |$)/ }));
    expect(within(row).getByRole("button", { name: "Link 02-I3 CORE[IT-01]" })).toHaveTextContent("Change");
    expect(within(row).getByRole("button", { name: "Link 02-I3 CORE[IT-01]" })).not.toBeDisabled();
  });

  it("searches by Article, department or product", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    await openArticles();
    await screen.findByText("FA_CE_UPS");
    fireEvent.click(screen.getByRole("button", { name: "All (3)" }));
    fireEvent.change(screen.getByLabelText("Search ERP Articles"), { target: { value: "rack" } });
    expect(screen.getByText("FA_IT_OTHERS")).toBeInTheDocument();
    expect(screen.queryByText("FA_CE_UPS")).not.toBeInTheDocument();
  });

  it("searching an item code (the barcode) finds its Article, even one that is already linked, and says which code matched", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    await openArticles();
    await screen.findByText("FA_CE_UPS");
    expect(screen.queryByText("02-I3 CORE[IT-01]")).not.toBeInTheDocument();       // linked, so hidden by "Not linked" while nothing is typed

    fireEvent.change(screen.getByLabelText("Search ERP Articles"), { target: { value: "CT324973" } });
    const row = (await screen.findByText("02-I3 CORE[IT-01]")).closest("tr")!;
    expect(within(row).getByText("CT324973")).toBeInTheDocument();
    expect(within(row).getByText(/decide the code itself above/)).toBeInTheDocument();       // the code's own decision is shown in the codes panel, not its Article's
    expect(screen.queryByText("FA_CE_UPS")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search ERP Articles"), { target: { value: "ct9990" } });       // partial and case-insensitive; another code of the same Article
    expect(within((await screen.findByText("02-I3 CORE[IT-01]")).closest("tr")!).getByText("CT999001")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search ERP Articles"), { target: { value: "lenovo" } });       // a product name beyond the sample shown
    expect(await screen.findByText("02-I3 CORE[IT-01]")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search ERP Articles"), { target: { value: "CT000000" } });
    expect(await screen.findByText("No Articles match.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search ERP Articles"), { target: { value: "" } });
    expect(await screen.findByText("FA_CE_UPS")).toBeInTheDocument();                                      // back to the "Not linked" view
    expect(screen.queryByText("02-I3 CORE[IT-01]")).not.toBeInTheDocument();
  });

  it("a mixed Article is linked code by code or product name by product name", async () => {
    mockApi();
    renderAt("/setup/erp-articles");
    await openArticles();
    fireEvent.click(await screen.findByRole("button", { name: "Codes of FA_IT_OTHERS" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("48 PORT SWITCH")).toBeInTheDocument();
    expect(within(dialog).getByText("Not decided yet")).toBeInTheDocument();
    expect(within(dialog).getByText(/by its product name/)).toBeInTheDocument();             // the rack already follows a name rule

    fireEvent.click(within(dialog).getByLabelText("Item for CT500001"));
    fireEvent.click(await screen.findByRole("option", { name: /^UPS( ?· |$)/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Every code with the same product name" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Link CT500001" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", {
        item_id: 3, match_type: "NAME", article_key: "FA_IT_OTHERS", article_name: "FA_IT_OTHERS", section: "IT EQUIPMENTS",
        department: "FA_IT_OTHERS", name_key: "48 port switch",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "This code only" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Link CT500001" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ match_type: "CODE", erp_item_code: "CT500001", item_id: 3 })),
    );
  });

  it("shows the server's message when the ERP cannot be read", async () => {
    mockApi(new Error("The ERP database could not be reached (OSError)."));
    renderAt("/setup/erp-articles");
    await openArticles();
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
    await openArticles();
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
    await openArticles();
      await screen.findByText("FA_CE_UPS");
      fireEvent.click(screen.getByRole("button", { name: "Link FA_CE_UPS" }));
      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ company_id: 1, match_type: "ARTICLE", article_key: "FA_CE_UPS" })),
      );
      fireEvent.click(screen.getByLabelText("Company"));
      fireEvent.click(await screen.findByRole("option", { name: "Citykart Ventures" }));
      await screen.findByText("VT_MIC_STD");
      fireEvent.click(screen.getByLabelText("Item for VT_MIC_STD"));
      fireEvent.click(await screen.findByRole("option", { name: /^UPS( ?· |$)/ }));
      fireEvent.click(screen.getByRole("button", { name: "Link VT_MIC_STD" }));
      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ company_id: 2, article_key: "VT_MIC_STD", item_id: 3 })),
      );
    });

    it("the codes of an Article are read and linked for the chosen company", async () => {
      mockTwoCompanies();
      renderAt("/setup/erp-articles");
    await openArticles();
      fireEvent.click(await screen.findByRole("button", { name: "Codes of FA_IT_OTHERS" }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("48 PORT SWITCH");
      expect(apiClient.get).toHaveBeenCalledWith("/items/articles/codes?article_key=FA_IT_OTHERS&company_id=1");
      fireEvent.click(within(dialog).getByLabelText("Item for CT500001"));
      fireEvent.click(await screen.findByRole("option", { name: /^UPS( ?· |$)/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Link CT500001" }));
      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ company_id: 1, match_type: "CODE", erp_item_code: "CT500001" })),
      );
    });
  });
});
