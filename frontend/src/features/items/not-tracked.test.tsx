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
  not_tracked_by: null, map_id: null, ...over,
});
const CODES = [
  code({ icode: "CT392128", name: "PRAMA- IP DOME CAMERA", name_key: "prama ip dome camera", item_id: 3, item_name: "Indoor Camera", matched_by: "ARTICLE" }),
  code({ icode: "CT166452", name: "CABLE CAT-6", name_key: "cable cat 6" }),
  code({ icode: "CT107735", name: "CONNECTOR", name_key: "connector", not_tracked: true, matched_by: "CODE", not_tracked_by: "Code", map_id: 61 }),
  code({ icode: "CT777", name: "HANGER", name_key: "hanger", not_tracked: true, matched_by: "DEPARTMENT", not_tracked_by: "Department FA_FF_HANGER", map_id: 50 }),
];

const GROUPS = [
  { value: "FA_FF_HANGER", level: "DEPARTMENT", articles: 6, codes: 24, units: 7745579, section: "FURNITURE & FIXTURE", samples: ["FA_FF_HANGER_PLASTIC"], not_tracked: true, map_id: 50 },
  { value: "FA_EF_CABLES", level: "DEPARTMENT", articles: 5, codes: 75, units: 103034, section: "ELECTRICAL FITTINGS", samples: ["FA_EF_CABLES"], not_tracked: false, map_id: null },
];

function mockApi() {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/items") return Promise.resolve(ITEMS);
    if (path === "/items/articles") return Promise.resolve(ARTICLES);
    if (path.startsWith("/items/articles/codes")) return Promise.resolve(CODES);
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

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

const RULE = { match_type: "ARTICLE", section: "IT EQUIPMENTS", department: "FA_CE_CCTV" };

describe("ERP Articles: not tracked", () => {
  it("has a tab for each state with its count, starting with what is not decided", async () => {
    renderScreen();
    expect(await screen.findByText("FA_CE_CAMERA")).toBeInTheDocument();
    for (const name of ["Not decided (2)", "Linked (1)", "Not tracked (2)", "All (5)"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByText("FA_EF_CABLES")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not tracked (2)" }));
    expect(screen.getByText("FA_EF_CABLES")).toBeInTheDocument();
    expect(screen.queryByText("FA_CE_CAMERA")).not.toBeInTheDocument();
  });

  it("says where a not-tracked decision comes from", async () => {
    renderScreen();
    await screen.findByText("FA_CE_CAMERA");
    fireEvent.click(screen.getByRole("button", { name: "Not tracked (2)" }));
    const viaDepartment = screen.getByText("FA_FF_HANGER_PLASTIC").closest("tr")!;
    expect(within(viaDepartment).getByText(/Not tracked · Department FA_FF_HANGER/)).toBeInTheDocument();
    expect(within(viaDepartment).getByRole("button", { name: "Not tracked: FA_FF_HANGER_PLASTIC" })).toBeDisabled();
    expect(within(viaDepartment).queryByRole("button", { name: /Track .* again/ })).not.toBeInTheDocument();     // undo it in Groups…
    const viaArticle = screen.getByText("FA_EF_CABLES").closest("tr")!;
    expect(within(viaArticle).getByText("Not tracked")).toBeInTheDocument();
  });

  it("marks one Article not tracked, and tracks it again", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Not tracked: FA_CE_CAMERA PVC BOX" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { not_tracked: true, article_key: "FA_CE_CAMERA PVC BOX", article_name: "FA_CE_CAMERA PVC BOX", ...RULE }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Not tracked (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Track FA_EF_CABLES again" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/7"));
  });

  it("links several Articles to one Item in one go (the same Item from several Articles of a company)", async () => {
    renderScreen();
    await screen.findByText("FA_CE_CAMERA");
    expect(screen.queryByRole("region", { name: "Selected Articles" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select FA_CE_CAMERA"));
    fireEvent.click(screen.getByLabelText("Select FA_CE_CAMERA PVC BOX"));
    const bar = screen.getByRole("region", { name: "Selected Articles" });
    expect(bar).toHaveTextContent("2 selected");
    expect(within(bar).getByRole("button", { name: "Link 2 to this Item" })).toBeDisabled();
    fireEvent.click(within(bar).getByLabelText("Item for the selected Articles"));
    fireEvent.click(await screen.findByRole("option", { name: "Indoor Camera" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Link 2 to this Item" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { item_id: 3, article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", ...RULE });
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { item_id: 3, article_key: "FA_CE_CAMERA PVC BOX", article_name: "FA_CE_CAMERA PVC BOX", ...RULE });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selected Articles" })).not.toBeInTheDocument());      // the selection is cleared
  });

  it("marks several Articles not tracked in one go, and select-all takes what is shown", async () => {
    renderScreen();
    await screen.findByText("FA_CE_CAMERA");
    fireEvent.click(screen.getByLabelText("Select all shown Articles"));
    const bar = screen.getByRole("region", { name: "Selected Articles" });
    expect(bar).toHaveTextContent("2 selected");
    fireEvent.click(within(bar).getByRole("button", { name: "Mark 2 not tracked" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ not_tracked: true, article_key: "FA_CE_CAMERA" }));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ not_tracked: true, article_key: "FA_CE_CAMERA PVC BOX" }));
  });

  it("Groups… marks a whole Department not tracked, and tracks it again", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Groups…" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("FA_FF_HANGER")).toBeInTheDocument();
    expect(within(dialog).getByText(/6 Articles · 24 codes · 77,45,579 units/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark Department FA_EF_CABLES not tracked" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { match_type: "DEPARTMENT", level_key: "FA_EF_CABLES", not_tracked: true }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Track FA_FF_HANGER again" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/50"));
  });

  it("Groups… can switch to Sections and Divisions", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Groups…" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("FA_FF_HANGER");
    fireEvent.click(within(dialog).getByRole("button", { name: "Sections" }));
    expect(await within(dialog).findByText("ELECTRICAL FITTINGS")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/items/articles/groups?level=SECTION");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark Section ELECTRICAL FITTINGS not tracked" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", { match_type: "SECTION", level_key: "ELECTRICAL FITTINGS", not_tracked: true }),
    );
    expect(within(dialog).getByRole("button", { name: "Divisions" })).toBeInTheDocument();
  });

  it("in Codes…, a cable bought for the cameras is marked not tracked by its code or its product name", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Codes of FA_CE_CAMERA" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("CABLE CAT-6");
    expect(within(dialog).getAllByText(/Now:/)).toHaveLength(3);              // the camera (Item), the connector and the hanger (not tracked); the cable is not decided
    expect(within(dialog).getByText("Not decided yet")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Code CT166452 not tracked" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", {
        not_tracked: true, match_type: "CODE", article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", section: "IT EQUIPMENTS", department: "FA_CE_CCTV", erp_item_code: "CT166452",
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Name of CT166452 not tracked" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ not_tracked: true, match_type: "NAME", name_key: "cable cat 6" })),
    );
  });

  it("in Codes…, a code's own not-tracked rule can be undone, one that comes from further up cannot", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Codes of FA_CE_CAMERA" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("CONNECTOR");
    fireEvent.click(within(dialog).getByRole("button", { name: "Track CT107735 again" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/61"));
    expect(within(dialog).queryByRole("button", { name: "Track CT777 again" })).not.toBeInTheDocument();      // it is the Department's rule
    expect(within(dialog).getByText(/through its Department/)).toBeInTheDocument();
  });
});
