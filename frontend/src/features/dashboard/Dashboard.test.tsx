import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { attentionRowsFrom, buildAttentionRows, type DashboardData, type HomeAttention } from "./Dashboard";

vi.mock("../../lib/api-client");

// Home links into Assets, Receive, Serial Pending and Asset 360, so it needs a
// real RouterProvider ancestor (the actual route tree at /dashboard).
function renderHome(url = "/dashboard") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const baseDashboardData: DashboardData = {
  status_counts: { IN_STOCK: 5, ALLOTTED: 3 },
  stock_by_location: [{ location: "HO", count: 5 }],
  warranty_alerts: [{ asset_id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", warranty_upto: "2026-10-01" }],
  long_allocation_alerts: [],
  exception_counts: { UNDER_REPAIR: 0, LOST: 0, DISPOSED: 0, SOLD: 0, SCRAPPED: 0 },
  recent_activity: [],
  pending_po_summary: { count: 0, value: 0 },
  open_purchase_orders: [],
};

/** S6: what GET /home/attention answers when nothing needs attention. */
const QUIET: HomeAttention = {
  serial_pending: 0, under_repair: 0, lost: 0, unlinked_assets: null, waiting_pos: 0, waiting_units: 0,
  erp_available: false, erp_changed_pos: null, erp_arrived_pos: null, erp_pos_needing_input: null, inbox: null,
};

/** `attention`: the Home call's answer, or "fail" (a 503). */
function mockApiGet(dashboardData: unknown, attention: Partial<HomeAttention> | "fail" = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/home/attention")) {
      return attention === "fail" ? Promise.reject(new Error("503 Service Unavailable")) : Promise.resolve({ ...QUIET, ...attention });
    }
    if (path.startsWith("/erp/")) return Promise.reject(new Error("Home must not call the ERP screens' endpoints"));
    if (path.startsWith("/masters/")) return Promise.resolve([]);
    return Promise.resolve(dashboardData);
  });
}

function loginAs(role: string, isPrimaryOwner = false) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role, companyId: 1, isPrimaryOwner, mustChangePassword: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  loginAs("ADMIN");
});

afterEach(() => useAuthStore.getState().logout());

const quickActions = () => within(screen.getByRole("navigation", { name: "Quick actions" }));

describe("Home", () => {
  it("is titled Home and offers every quick action to someone who can add and move assets", async () => {
    mockApiGet(baseDashboardData);
    renderHome();
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    const names = quickActions().getAllByRole("link").map((l) => l.textContent?.trim());
    expect(names).toEqual(["Create PO", "Receive Delivery", "Add Assets", "Move Assets", "Find Asset"]);
    expect(quickActions().getByRole("link", { name: "Create PO" })).toHaveAttribute("href", "/purchase-orders/new");
    expect(quickActions().getByRole("link", { name: "Receive Delivery" })).toHaveAttribute("href", "/receive");
    expect(quickActions().getByRole("link", { name: "Add Assets" })).toHaveAttribute("href", "/assets/new");
    expect(quickActions().getByRole("link", { name: "Move Assets" })).toHaveAttribute("href", "/asset-movement");
    expect(quickActions().getByRole("link", { name: "Find Asset" })).toHaveAttribute("href", expect.stringContaining("/assets?find=true"));
  });

  it("gives an OPERATOR the same quick actions as an ADMIN", async () => {
    loginAs("OPERATOR");
    mockApiGet(baseDashboardData);
    renderHome();
    await screen.findByRole("heading", { name: "Home" });
    expect(quickActions().getAllByRole("link")).toHaveLength(5);
  });

  it("gives a VIEWER only Find Asset", async () => {
    loginAs("VIEWER");
    mockApiGet(baseDashboardData);
    renderHome();
    await screen.findByRole("heading", { name: "Home" });
    expect(quickActions().getAllByRole("link").map((l) => l.textContent?.trim())).toEqual(["Find Asset"]);
  });

  it("S6: lists what needs attention from ONE call (GET /home/attention), each row opening the right screen", async () => {
    mockApiGet(baseDashboardData, {
      waiting_pos: 3, waiting_units: 12, serial_pending: 7, under_repair: 2, lost: 1, unlinked_assets: 4,
      erp_available: true, erp_changed_pos: 1, erp_arrived_pos: 1, erp_pos_needing_input: 2,
    });
    renderHome();
    const list = await screen.findByRole("list", { name: "Needs attention" });
    const row = (text: RegExp) => within(list).getByText(text).closest("li") as HTMLElement;
    expect(within(row(/3 purchase orders waiting for goods \(12 units\)/i)).getByRole("link")).toHaveAttribute("href", "/receive");
    expect(within(row(/goods arrived for 1 purchase order/i)).getByRole("link")).toHaveAttribute("href", "/receive");
    expect(within(row(/2 ERP purchase orders need your input/i)).getByRole("link")).toHaveAttribute("href", "/purchase-orders/from-erp");
    expect(within(row(/7 assets waiting for a serial number/i)).getByRole("link")).toHaveAttribute("href", "/serial-pending");
    expect(within(row(/the erp changed 1 purchase order/i)).getByRole("link")).toHaveAttribute("href", "/purchase-orders");
    expect(within(row(/2 assets under repair/i)).getByRole("link")).toHaveAttribute("href", "/assets?status=UNDER_REPAIR");
    expect(within(row(/1 asset reported lost/i)).getByRole("link")).toHaveAttribute("href", "/assets?status=LOST");
    expect(within(row(/4 assets have no Item yet/i)).getByRole("link")).toHaveAttribute("href", "/settings/catalogue/link-assets");
    // The old assembly is gone: no PO list count, ERP summary, reminders or unlinked-items calls.
    expect(apiClient.getPage).not.toHaveBeenCalled();
    const asked = (apiClient.get as any).mock.calls.map((c: unknown[]) => c[0]);
    expect(asked.some((p: string) => p.startsWith("/erp/"))).toBe(false);
  });

  it("S6: ERP figures are left out when the ERP is not available (no alarming message)", async () => {
    mockApiGet(baseDashboardData, { serial_pending: 2, erp_available: false, erp_changed_pos: null, erp_arrived_pos: null, erp_pos_needing_input: null });
    renderHome();
    expect(await screen.findByText(/2 assets waiting for a serial number/i)).toBeInTheDocument();
    expect(screen.queryByText(/erp/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("S7 P1-1: one ERP figure missing (goods receipts) never hides the others", async () => {
    mockApiGet(baseDashboardData, { erp_available: false, erp_arrived_pos: null, erp_changed_pos: 2, erp_pos_needing_input: 3 });
    renderHome();
    const list = await screen.findByRole("list", { name: "Needs attention" });
    expect(within(list).getByText(/3 ERP purchase orders need your input/)).toBeInTheDocument();
    expect(within(list).getByText(/The ERP changed 2 purchase orders/)).toBeInTheDocument();
    expect(within(list).queryByText(/goods arrived/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("S7 P2-4: the Recent changes / Stock by Place cards may shrink below their table's width (no page-wide scroll)", async () => {
    mockApiGet(baseDashboardData);
    renderHome();
    const recent = await screen.findByText("Recent changes");
    const card = recent.closest(".min-w-0");
    expect(card).not.toBeNull();
    expect(card!.parentElement!.className).toContain("grid-cols-1");
  });

  it("S6: if the Home call fails, the rows the dashboard numbers allow are still shown (no ERP rows, no error)", async () => {
    mockApiGet({
      ...baseDashboardData, serial_pending_count: 5, pending_po_summary: { count: 12, value: 0 },
      exception_counts: { UNDER_REPAIR: 1, LOST: 0, DISPOSED: 0, SOLD: 0, SCRAPPED: 0 },
    }, "fail");
    renderHome();
    expect(await screen.findByText("12 units on purchase orders are waiting for goods")).toBeInTheDocument();
    expect(screen.getByText(/5 assets waiting for a serial number/i)).toBeInTheDocument();
    expect(screen.getByText(/1 asset under repair/i)).toBeInTheDocument();
    expect(screen.queryByText(/erp/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing needs attention when nothing does", async () => {
    mockApiGet(baseDashboardData);
    renderHome();
    expect(await screen.findByText(/nothing needs your attention right now/i)).toBeInTheDocument();
  });

  it("does not show purchase-order, serial or ERP rows to a VIEWER, only repair/lost", async () => {
    loginAs("VIEWER");
    mockApiGet(baseDashboardData, {
      serial_pending: 7, under_repair: 2, waiting_pos: null, waiting_units: null,
      erp_available: true, erp_changed_pos: 3,
    });
    renderHome();
    expect(await screen.findByText(/2 assets under repair/i)).toBeInTheDocument();
    expect(screen.queryByText(/serial number/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting for goods/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/erp/i)).not.toBeInTheDocument();
  });

  it("no longer shows status tiles or an Exceptions table, but keeps counts per status as plain-word links", async () => {
    mockApiGet(baseDashboardData);
    renderHome();
    const counts = await screen.findByLabelText("Assets by status");
    expect(within(counts).getByRole("link", { name: /in stock 5/i })).toHaveAttribute("href", "/assets?status=IN_STOCK");
    expect(within(counts).getByRole("link", { name: /with employee \/ store 3/i })).toHaveAttribute("href", "/assets?status=ALLOTTED");
    expect(screen.queryByText("Exceptions")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/IN_STOCK|IN STOCK|ALLOTTED|UNDER_REPAIR/);
  });

  it("shows Recent changes and Stock by Place, and keeps the warranty / long-allotment lists in a collapsed Watch list", async () => {
    mockApiGet({
      ...baseDashboardData,
      recent_activity: [
        {
          id: 1, asset_id: 42, asset_code: "FA/HO01/IT/LAP/CK_99", event_type: "MOVED",
          event_date: "2026-09-25T10:00:00Z", label: "Allotted to Jane Doe", recorded_by_name: "Admin User",
        },
      ],
      long_allocation_alerts: [{ asset_id: 9, asset_code: "FA/CK_9", days_allotted: 200 }],
    });
    renderHome();
    expect(await screen.findByText("Allotted to Jane Doe")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FA/HO01/IT/LAP/CK_99" })).toHaveAttribute("href", "/assets/42");
    expect(screen.getByText("HO")).toBeInTheDocument();

    const watch = screen.getByTestId("watch-list");
    expect(watch).not.toHaveAttribute("open");
    // SPA links (no full page reloads) to Asset 360.
    expect(within(watch).getByRole("link", { name: "FA/HO01/IT/LAP/CK_1" })).toHaveAttribute("href", "/assets/1");
    expect(within(watch).getByRole("link", { name: "FA/CK_9" })).toHaveAttribute("href", "/assets/9");
    expect(within(watch).getByText("200 days")).toBeInTheDocument();
  });

  it("shows empty states when there is genuinely no data", async () => {
    mockApiGet({ ...baseDashboardData, status_counts: {}, stock_by_location: [], warranty_alerts: [] });
    renderHome();
    expect(await screen.findByText("No stock on hand.")).toBeInTheDocument();
    expect(screen.getByText("No recent asset activity.")).toBeInTheDocument();
    expect(screen.getByText("Nothing expiring soon.")).toBeInTheDocument();
    expect(screen.getByText("Nothing overdue.")).toBeInTheDocument();
  });

  it("filters by work area with plain words and re-asks the server", async () => {
    mockApiGet(baseDashboardData);
    renderHome();
    fireEvent.click(await screen.findByRole("combobox", { name: "Work area" }));
    expect(await screen.findByRole("option", { name: "IT Team" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Admin / Non-IT Team" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/reports/dashboard?domain=NON_IT"));
    expect(apiClient.get).toHaveBeenCalledWith("/home/attention?work_area=NON_IT");
  });

  it("shows an error state with a retry action when Home's numbers fail to load", async () => {
    (apiClient.get as any).mockRejectedValue(new Error("network down"));
    renderHome();
    expect(await screen.findByText(/couldn't load home/i)).toBeInTheDocument();
    mockApiGet(baseDashboardData);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/nothing needs your attention/i)).toBeInTheDocument();
  });
});

describe("attentionRowsFrom (S6: GET /home/attention)", () => {
  const ALL_NULL: HomeAttention = {
    serial_pending: null, under_repair: null, lost: null, unlinked_assets: null, waiting_pos: null, waiting_units: null,
    erp_available: false, erp_changed_pos: null, erp_arrived_pos: null, erp_pos_needing_input: null, inbox: null,
  };

  it("null numbers (not for this login) give no rows", () => {
    expect(attentionRowsFrom(ALL_NULL)).toEqual([]);
  });

  it("S7 P1-1: every ERP figure that came is shown, even when another ERP read failed (erp_available false)", () => {
    const a = { ...ALL_NULL, erp_changed_pos: 2, erp_arrived_pos: 1, erp_pos_needing_input: 1 };
    expect(attentionRowsFrom({ ...a, erp_available: true }).map((r) => r.key)).toEqual(["erp-arrived", "erp-needs-input", "erp-changed"]);
    // The goods-receipts view is missing: only that figure is null; the others still show.
    const partly = { ...a, erp_available: false, erp_arrived_pos: null };
    expect(attentionRowsFrom(partly).map((r) => r.key)).toEqual(["erp-needs-input", "erp-changed"]);
  });

  it("singular and plural words, and the order of the rows", () => {
    const rows = attentionRowsFrom({
      ...ALL_NULL, waiting_pos: 1, waiting_units: 1, serial_pending: 1, under_repair: 1, lost: 2, unlinked_assets: 1,
      erp_available: true, erp_pos_needing_input: 1,
    });
    expect(rows.map((r) => r.text)).toEqual([
      "1 purchase order waiting for goods (1 unit)",
      "1 ERP purchase order needs your input before it can be brought in",
      "1 asset waiting for a serial number",
      "1 asset under repair",
      "2 assets reported lost",
      "1 asset has no Item yet",
    ]);
  });

  it("someone who cannot do the work gets no work rows", () => {
    const rows = attentionRowsFrom({ ...ALL_NULL, waiting_pos: 3, serial_pending: 4, under_repair: 1, erp_available: true, erp_changed_pos: 1 }, { canWork: false });
    expect(rows.map((r) => r.key)).toEqual(["repair"]);
  });
});

describe("buildAttentionRows (the fallback when Home's call fails)", () => {
  it("only offers work rows to people who can do the work", () => {
    const data = { ...baseDashboardData, serial_pending_count: 3, pending_po_summary: { count: 1, value: 0 } };
    const forWorker = buildAttentionRows({ data, canWork: true, erpChangedPos: 0, erpArrivedPos: 0 }).map((r) => r.key);
    const forViewer = buildAttentionRows({ data, canWork: false, erpChangedPos: 4, erpArrivedPos: 4 }).map((r) => r.key);
    expect(forWorker).toEqual(["receive", "serial"]);
    expect(forViewer).toEqual([]);
  });

  it("S2: the PO count wins when known (none waiting = no row); unknown falls back to units", () => {
    const data = { ...baseDashboardData, pending_po_summary: { count: 5, value: 0 } };
    const base = { data, canWork: true, erpChangedPos: 0, erpArrivedPos: 0 };
    expect(buildAttentionRows({ ...base, waitingPos: 1 })[0].text).toBe("1 purchase order waiting for goods (5 units)");
    expect(buildAttentionRows({ ...base, waitingPos: 0 }).map((r) => r.key)).toEqual([]);
    expect(buildAttentionRows({ ...base, waitingPos: null })[0].text).toBe("5 units on purchase orders are waiting for goods");
  });

  it("S5b-1: admins are told how many assets have no Item yet, linking to the tool (only when there are some)", () => {
    const base = { data: baseDashboardData, canWork: true, erpChangedPos: 0, erpArrivedPos: 0 };
    const row = buildAttentionRows({ ...base, unlinkedAssets: 12 }).find((r) => r.key === "link-items")!;
    expect(row).toMatchObject({ text: "12 assets have no Item yet", to: "/settings/catalogue/link-assets", action: "Link to Items" });
    expect(buildAttentionRows({ ...base, unlinkedAssets: 1 }).find((r) => r.key === "link-items")!.text).toBe("1 asset has no Item yet");
    expect(buildAttentionRows({ ...base, unlinkedAssets: 0 }).some((r) => r.key === "link-items")).toBe(false);
    expect(buildAttentionRows({ ...base, unlinkedAssets: null }).some((r) => r.key === "link-items")).toBe(false);
  });

  it("uses singular and plural words correctly", () => {
    const rows = buildAttentionRows({
      data: { ...baseDashboardData, pending_po_summary: { count: 1, value: 0 }, exception_counts: { UNDER_REPAIR: 1, LOST: 2 } },
      canWork: true, erpChangedPos: 1, erpArrivedPos: 0,
    });
    expect(rows.map((r) => r.text)).toEqual([
      "1 unit on purchase orders is waiting for goods",
      "The ERP changed 1 purchase order",
      "1 asset under repair",
      "2 assets reported lost",
    ]);
  });
});
