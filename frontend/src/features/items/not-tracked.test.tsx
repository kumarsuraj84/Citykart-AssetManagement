import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const ITEMS = [
  { id: 3, name: "Indoor Camera", category_id: 1, subcategory_id: 10, serial_required: true, serial_later: false, bundle_id: null, default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0 },
  { id: 4, name: "UPS", category_id: 1, subcategory_id: 10, serial_required: true, serial_later: false, bundle_id: null, default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0 },
];

const article = (over: Record<string, unknown>) => ({
  article_key: "", article_name: "", section: "IT EQUIPMENTS", department: "FA_CE_CCTV", division: "FIXED ASSETS", codes: 1, units: 10, lines: 2, samples: [],
  icodes: [], names: [], item_id: null, item_name: null, name_rules: 0, code_rules: 0, untracked_rules: 0, suggested_item_id: null, suggested_item_name: null,
  decision: null, not_tracked_by: null, not_tracked_level: null, decision_map_id: null, ...over,
});

const ARTICLES = [
  article({ article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", codes: 8, units: 2694 }),
  article({ article_key: "FA_CE_CAMERA PVC BOX", article_name: "FA_CE_CAMERA PVC BOX", codes: 1 }),
  article({ article_key: "FA_CE_UPS", article_name: "FA_CE_UPS", department: "FA_CE_UPS", item_id: 4, item_name: "UPS", decision: "ITEM" }),
  article({ article_key: "FA_FF_HANGER_PLASTIC", article_name: "FA_FF_HANGER_PLASTIC", section: "FURNITURE & FIXTURE", department: "FA_FF_HANGER", decision: "NOT_TRACKED",
    not_tracked_by: "Department FA_FF_HANGER", not_tracked_level: "DEPARTMENT", decision_map_id: 50 }),
  article({ article_key: "FA_EF_CABLES", article_name: "FA_EF_CABLES", section: "ELECTRICAL FITTINGS", department: "FA_EF_CABLES", decision: "NOT_TRACKED",
    not_tracked_by: "Article", not_tracked_level: "ARTICLE", decision_map_id: 7 }),
];

const code = (over: Record<string, unknown>) => ({
  icode: "", name: "", name_key: "", description: "", units: 1, lines: 1, item_id: null, item_name: null, matched_by: null, not_tracked: false,
  not_tracked_by: null, map_id: null, article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", section: "IT EQUIPMENTS", department: "FA_CE_CCTV", division: "FIXED ASSETS", ...over,
});
const CAMERA = { item_id: 3, item_name: "Indoor Camera", matched_by: "ARTICLE" };
// Every bought barcode, one row each. The camera Article holds real cameras AND a cable and a connector.
const ALL_CODES = [
  code({ icode: "CT392128", name: "PRAMA- IP DOME CAMERA", name_key: "prama ip dome camera", description: "PRAMA- IP DOME CAMERA - PT-NC323P1-N", units: 1950, ...CAMERA }),
  code({ icode: "CT392127", name: "PRAMA- IP BULLET CAMERA", name_key: "prama ip bullet camera", description: "PRAMA- IP BULLET CAMERA", units: 283, ...CAMERA }),
  code({ icode: "CT166452", name: "CABLE CAT-6", name_key: "cable cat 6", description: "CABLE CAT-6 · DLINK (305 MTR)", units: 12, ...CAMERA }),
  code({ icode: "CT107735", name: "CONNECTOR", name_key: "connector", description: "CONNECTOR · RZ 45", ...CAMERA }),
  code({ icode: "CT555", name: "GANG BOX PVC", name_key: "gang box pvc", description: "GANG BOX PVC 4 X 4", article_key: "FA_CE_CAMERA PVC BOX", article_name: "FA_CE_CAMERA PVC BOX" }),
  code({ icode: "CT777", name: "HANGER", name_key: "hanger", article_key: "FA_FF_HANGER_PLASTIC", article_name: "FA_FF_HANGER_PLASTIC", section: "FURNITURE & FIXTURE",
    department: "FA_FF_HANGER", not_tracked: true, matched_by: "DEPARTMENT", not_tracked_by: "Department FA_FF_HANGER", map_id: 50 }),
  code({ icode: "CT888", name: "APC UPS", name_key: "apc ups", article_key: "FA_CE_UPS", article_name: "FA_CE_UPS", department: "FA_CE_UPS", item_id: 4, item_name: "UPS", matched_by: "CODE", map_id: 61 }),
];

const GROUPS = [
  { value: "FA_FF_HANGER", level: "DEPARTMENT", articles: 6, codes: 24, units: 7745579, section: "FURNITURE & FIXTURE", samples: ["FA_FF_HANGER_PLASTIC"], not_tracked: true, map_id: 50 },
  { value: "FA_EF_CABLES", level: "DEPARTMENT", articles: 5, codes: 75, units: 103034, section: "ELECTRICAL FITTINGS", samples: ["FA_EF_CABLES"], not_tracked: false, map_id: null },
];

function mockApi(codes: unknown[] = ALL_CODES) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/items") return Promise.resolve(ITEMS);
    if (path === "/items/codes") return Promise.resolve(codes);
    if (path === "/items/articles") return Promise.resolve(ARTICLES);
    if (path.startsWith("/items/articles/codes")) return Promise.resolve(ALL_CODES.filter((c) => c.article_key === "FA_CE_CAMERA"));
    if (path === "/items/articles/groups?level=DEPARTMENT") return Promise.resolve(GROUPS);
    if (path === "/items/articles/groups?level=SECTION") return Promise.resolve([{ ...GROUPS[1], value: "ELECTRICAL FITTINGS", level: "SECTION" }]);
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.delete as any).mockResolvedValue(undefined);
}

function renderScreen() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/setup/erp-articles"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

async function renderArticles() {
  renderScreen();
  fireEvent.click(await screen.findByRole("button", { name: "Articles" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

const rowOf = (icode: string) => screen.getByText(icode).closest("tr")!;
const ARTICLE_RULE = { match_type: "ARTICLE", section: "IT EQUIPMENTS", department: "FA_CE_CCTV" };

describe("ERP codes: every barcode is its own row", () => {
  it("opens on the Codes view and lists each code separately, never bundled by Article", async () => {
    renderScreen();
    expect(await screen.findByLabelText("Select code CT555")).toBeInTheDocument();                       // the only code not decided yet
    expect(screen.queryByLabelText("Select code CT166452")).not.toBeInTheDocument();
    for (const name of ["Not decided (1)", "Linked (5)", "Not tracked (1)", "All (7)"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All (7)" }));
    for (const c of ["CT392128", "CT392127", "CT166452", "CT107735", "CT555", "CT777", "CT888"]) expect(screen.getByLabelText(`Select code ${c}`)).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBe(1 + 7);                                              // a header and one row per barcode
  });

  it("shows each code's own decision: the cable among the cameras follows the Article only by inheritance", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "All (7)" }));
    expect(within(rowOf("CT166452")).getByText("Indoor Camera · through its Article")).toBeInTheDocument();
    expect(within(rowOf("CT777")).getByText("Not tracked · through its Department")).toBeInTheDocument();
    expect(within(rowOf("CT888")).getByText("UPS · by its code")).toBeInTheDocument();
    expect(within(rowOf("CT555")).getByText("Not decided yet")).toBeInTheDocument();
  });

  it("searching a barcode finds just that code, whatever its state", async () => {
    renderScreen();
    await screen.findByLabelText("Select code CT555");
    fireEvent.change(screen.getByLabelText("Search codes"), { target: { value: "ct166452" } });
    expect(screen.getByLabelText("Select code CT166452")).toBeInTheDocument();
    expect(screen.queryByLabelText("Select code CT392128")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Select code CT555")).not.toBeInTheDocument();
  });

  it("ticks codes from different Articles and links them to one Item as codes only", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "All (7)" }));
    fireEvent.click(screen.getByLabelText("Select code CT392128"));
    fireEvent.click(screen.getByLabelText("Select code CT392127"));
    fireEvent.click(screen.getByLabelText("Select code CT555"));                                         // another Article
    const bar = screen.getByRole("region", { name: "Selected codes" });
    expect(bar).toHaveTextContent("3 codes selected");
    expect(within(bar).getByRole("button", { name: "Link 3 to this Item" })).toBeDisabled();
    fireEvent.click(within(bar).getByLabelText("Item for the selected codes"));
    fireEvent.click(await screen.findByRole("option", { name: /^Indoor Camera( ?· |$)/ }));
    fireEvent.click(within(bar).getByRole("button", { name: "Link 3 to this Item" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", {
      item_id: 3, match_type: "CODE", erp_item_code: "CT392128", article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", section: "IT EQUIPMENTS", department: "FA_CE_CCTV",
    });
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ item_id: 3, match_type: "CODE", erp_item_code: "CT555", article_key: "FA_CE_CAMERA PVC BOX" }));
    expect(apiClient.post).not.toHaveBeenCalledWith("/items/maps", expect.objectContaining({ match_type: "ARTICLE" }));      // nothing is bundled unless asked
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selected codes" })).not.toBeInTheDocument());
  });

  it("marks the cable and the connector not tracked together, leaving the cameras alone", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "All (7)" }));
    fireEvent.click(screen.getByLabelText("Select code CT166452"));
    fireEvent.click(screen.getByLabelText("Select code CT107735"));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected codes" })).getByRole("button", { name: "Mark 2 not tracked" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ not_tracked: true, match_type: "CODE", erp_item_code: "CT166452" }));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ not_tracked: true, match_type: "CODE", erp_item_code: "CT107735" }));
  });

  it("can also decide the Articles of the ticked codes, only when asked", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "All (7)" }));
    fireEvent.click(screen.getByLabelText("Select code CT392128"));
    fireEvent.click(screen.getByLabelText("Select code CT392127"));                                     // the same Article
    fireEvent.click(screen.getByLabelText("Select code CT555"));
    const bar = screen.getByRole("region", { name: "Selected codes" });
    fireEvent.click(within(bar).getByLabelText("Also for new codes of these Articles"));
    fireEvent.click(within(bar).getByLabelText("Item for the selected codes"));
    fireEvent.click(await screen.findByRole("option", { name: /^Indoor Camera( ?· |$)/ }));
    fireEvent.click(within(bar).getByRole("button", { name: "Link 3 to this Item" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(5));                              // 3 codes + 2 distinct Articles
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { item_id: 3, article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", ...ARTICLE_RULE });
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { item_id: 3, article_key: "FA_CE_CAMERA PVC BOX", article_name: "FA_CE_CAMERA PVC BOX", ...ARTICLE_RULE });
  });

  it("the header tick selects every code that matches the filters", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "All (7)" }));
    fireEvent.click(screen.getByLabelText("Select all shown codes"));
    expect(screen.getByRole("region", { name: "Selected codes" })).toHaveTextContent("7 codes selected");
    fireEvent.click(screen.getByLabelText("Select all shown codes"));
    expect(screen.queryByRole("region", { name: "Selected codes" })).not.toBeInTheDocument();
  });

  it("narrows by Department", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "All (7)" }));
    fireEvent.click(screen.getByLabelText("Department"));
    fireEvent.click(await screen.findByRole("option", { name: "FA_FF_HANGER (1)" }));
    expect(screen.getByLabelText("Select code CT777")).toBeInTheDocument();
    expect(screen.queryByLabelText("Select code CT166452")).not.toBeInTheDocument();
  });

  it("only a code's own decision can be undone there", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "All (7)" }));
    expect(within(rowOf("CT166452")).queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();     // inherited from its Article
    fireEvent.click(within(rowOf("CT888")).getByRole("button", { name: "Undo CT888" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/61"));
  });

  it("says when every code has been decided", async () => {
    mockApi(ALL_CODES.filter((c) => c.item_id !== null || c.not_tracked));
    renderScreen();
    expect(await screen.findByText("Every bought code has been decided.")).toBeInTheDocument();
  });

  it("shows the server's message when the codes cannot be read", async () => {
    (apiClient.get as any).mockImplementation((path: string) => (path === "/items/codes" ? Promise.reject(new Error("The ERP database could not be reached (OSError).")) : Promise.resolve([])));
    renderScreen();
    expect(await screen.findByText(/could not be reached/)).toBeInTheDocument();
  });
});

describe("ERP Articles view: not tracked", () => {
  it("has a tab for each state with its count, starting with what is not decided", async () => {
    await renderArticles();
    expect(await screen.findByText("FA_CE_CAMERA")).toBeInTheDocument();
    for (const name of ["Not decided (2)", "Linked (1)", "Not tracked (2)", "All (5)"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByText("FA_EF_CABLES")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not tracked (2)" }));
    expect(screen.getByText("FA_EF_CABLES")).toBeInTheDocument();
    expect(screen.queryByText("FA_CE_CAMERA")).not.toBeInTheDocument();
  });

  it("says where a not-tracked decision comes from", async () => {
    await renderArticles();
    await screen.findByText("FA_CE_CAMERA");
    fireEvent.click(screen.getByRole("button", { name: "Not tracked (2)" }));
    const viaDepartment = screen.getByText("FA_FF_HANGER_PLASTIC").closest("tr")!;
    expect(within(viaDepartment).getByText(/Not tracked · Department FA_FF_HANGER/)).toBeInTheDocument();
    expect(within(viaDepartment).getByRole("button", { name: "Not tracked: FA_FF_HANGER_PLASTIC" })).toBeDisabled();
    expect(within(viaDepartment).queryByRole("button", { name: /Track .* again/ })).not.toBeInTheDocument();     // undo it in Groups…
    expect(within(screen.getByText("FA_EF_CABLES").closest("tr")!).getByText("Not tracked")).toBeInTheDocument();
  });

  it("asks before marking a whole Article not tracked, and says to use Codes for a few codes", async () => {
    await renderArticles();
    fireEvent.click(await screen.findByRole("button", { name: "Not tracked: FA_CE_CAMERA PVC BOX" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Mark the whole Article FA_CE_CAMERA PVC BOX as not tracked?");
    expect(dialog).toHaveTextContent("use Codes… instead");
    expect(apiClient.post).not.toHaveBeenCalled();                                                       // nothing yet
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(apiClient.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Not tracked: FA_CE_CAMERA PVC BOX" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, the whole Article is not tracked" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { not_tracked: true, article_key: "FA_CE_CAMERA PVC BOX", article_name: "FA_CE_CAMERA PVC BOX", ...ARTICLE_RULE }),
    );
  });

  it("tracks an Article again", async () => {
    await renderArticles();
    await screen.findByText("FA_CE_CAMERA");
    fireEvent.click(screen.getByRole("button", { name: "Not tracked (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Track FA_EF_CABLES again" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/7"));
  });

  it("links several Articles to one Item in one go", async () => {
    await renderArticles();
    await screen.findByText("FA_CE_CAMERA");
    expect(screen.queryByRole("region", { name: "Selected Articles" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select FA_CE_CAMERA"));
    fireEvent.click(screen.getByLabelText("Select FA_CE_CAMERA PVC BOX"));
    const bar = screen.getByRole("region", { name: "Selected Articles" });
    expect(bar).toHaveTextContent("2 selected");
    fireEvent.click(within(bar).getByLabelText("Item for the selected Articles"));
    fireEvent.click(await screen.findByRole("option", { name: /^Indoor Camera( ?· |$)/ }));
    fireEvent.click(within(bar).getByRole("button", { name: "Link 2 to this Item" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { item_id: 3, article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", ...ARTICLE_RULE });
  });

  it("marks several Articles not tracked in one go", async () => {
    await renderArticles();
    await screen.findByText("FA_CE_CAMERA");
    fireEvent.click(screen.getByLabelText("Select all shown Articles"));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected Articles" })).getByRole("button", { name: "Mark 2 not tracked" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ not_tracked: true, article_key: "FA_CE_CAMERA" }));
  });
});

describe("Groups…", () => {
  it("marks a whole Department not tracked, and tracks it again", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Groups…" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("FA_FF_HANGER")).toBeInTheDocument();
    expect(within(dialog).getByText(/6 Articles · 24 codes · 77,45,579 units/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark Department FA_EF_CABLES not tracked" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { match_type: "DEPARTMENT", level_key: "FA_EF_CABLES", not_tracked: true }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Track FA_FF_HANGER again" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/50"));
  });

  it("switches to Sections and Divisions", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Groups…" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("FA_FF_HANGER");
    fireEvent.click(within(dialog).getByRole("button", { name: "Sections" }));
    expect(await within(dialog).findByText("ELECTRICAL FITTINGS")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark Section ELECTRICAL FITTINGS not tracked" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { match_type: "SECTION", level_key: "ELECTRICAL FITTINGS", not_tracked: true }));
    expect(within(dialog).getByRole("button", { name: "Divisions" })).toBeInTheDocument();
  });
});

describe("Codes… of an Article", () => {
  async function openCodes() {
    await renderArticles();
    fireEvent.click(await screen.findByRole("button", { name: "Codes of FA_CE_CAMERA" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("CABLE CAT-6");
    return dialog;
  }

  it("has two clear choices per code, Link and Not tracked, decided by this code or by its product name", async () => {
    const dialog = await openCodes();
    expect(within(dialog).getByRole("button", { name: "This code only" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Not tracked: CT166452" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", {
        not_tracked: true, match_type: "CODE", article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", section: "IT EQUIPMENTS", department: "FA_CE_CCTV", erp_item_code: "CT166452",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Every code with the same product name" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Not tracked: CT166452" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ not_tracked: true, match_type: "NAME", name_key: "cable cat 6" })));
  });

  it("shows each code's state and lets several be ticked and decided together", async () => {
    const dialog = await openCodes();
    expect(within(dialog).getAllByText("Indoor Camera · through its Article").length).toBe(4);
    fireEvent.click(within(dialog).getByLabelText("Select code CT166452"));
    fireEvent.click(within(dialog).getByLabelText("Select code CT107735"));
    const bar = within(dialog).getByRole("region", { name: "Selected codes" });
    fireEvent.click(within(bar).getByRole("button", { name: "Mark 2 not tracked" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
  });

  it("warns when the whole Article is marked not tracked and offers to track it again right there", async () => {
    await renderArticles();
    fireEvent.click(await screen.findByRole("button", { name: "Not tracked (2)" }));
    (apiClient.get as any).mockImplementation((path: string) => (path.startsWith("/items/articles/codes") ? Promise.resolve(ALL_CODES.slice(0, 2)) : Promise.resolve([])));
    fireEvent.click(screen.getByRole("button", { name: "Codes of FA_EF_CABLES" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("status")).toHaveTextContent("The whole Article is marked not tracked");
    fireEvent.click(within(dialog).getByRole("button", { name: "Track the Article again" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/7"));
  });
});
