import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { buildAttentionRows, type DashboardData } from "./Dashboard";

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

interface ErpMocks {
  configured?: boolean;
  changes?: unknown;
  reminders?: unknown;
  /** Make the ERP endpoints fail like a 503. */
  fail?: boolean;
}

function mockApiGet(dashboardData: unknown, erp: ErpMocks = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/erp/")) {
      if (erp.fail) return Promise.reject(new Error("503 Service Unavailable"));
      if (path === "/erp/status") return Promise.resolve({ configured: erp.configured ?? false });
      if (path === "/erp/changes/summary") return Promise.resolve(erp.changes ?? { available: true, items: [] });
      if (path.startsWith("/erp/reminders")) return Promise.resolve(erp.reminders ?? []);
    }
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

  it("lists what needs attention, each row opening the right screen", async () => {
    mockApiGet(
      {
        ...baseDashboardData,
        serial_pending_count: 7,
        pending_po_summary: { count: 12, value: 2360 },
        exception_counts: { UNDER_REPAIR: 2, LOST: 1, DISPOSED: 0, SOLD: 0, SCRAPPED: 0 },
      },
      { configured: true, changes: { available: true, items: [{ po_id: 3, po_number: "SPO/1", changes: 2, cancelled: false }] }, reminders: [{ po_id: 4, to_deliver: 5 }] },
    );
    renderHome();
    const list = await screen.findByRole("list", { name: "Needs attention" });
    await waitFor(() => expect(within(list).getByText(/the erp changed 1 purchase order/i)).toBeInTheDocument());

    const row = (text: RegExp) => within(list).getByText(text).closest("li") as HTMLElement;
    expect(within(row(/12 units on purchase orders are waiting for goods/i)).getByRole("link")).toHaveAttribute("href", "/receive");
    expect(within(row(/7 assets waiting for a serial number/i)).getByRole("link")).toHaveAttribute("href", "/serial-pending");
    expect(within(row(/the erp changed 1 purchase order/i)).getByRole("link")).toHaveAttribute("href", "/purchase-orders");
    expect(within(row(/goods arrived for 1 purchase order/i)).getByRole("link")).toHaveAttribute("href", "/receive");
    expect(within(row(/2 assets under repair/i)).getByRole("link")).toHaveAttribute("href", "/assets?status=UNDER_REPAIR");
    expect(within(row(/1 asset reported lost/i)).getByRole("link")).toHaveAttribute("href", "/assets?status=LOST");
  });

  it("S2: counts the POs waiting for goods from the PO list's total (waiting=true), with the units beside it", async () => {
    mockApiGet({ ...baseDashboardData, pending_po_summary: { count: 104, value: 0 } });
    (apiClient.getPage as any).mockResolvedValue({ data: [{ id: 1 }], total: 3 });
    renderHome();
    const list = await screen.findByRole("list", { name: "Needs attention" });
    const text = await within(list).findByText("3 purchase orders waiting for goods (104 units)");
    expect(within(text.closest("li") as HTMLElement).getByRole("link")).toHaveAttribute("href", "/receive");
    expect(apiClient.getPage).toHaveBeenCalledWith("/purchase-orders?waiting=true&limit=1");
  });

  it("S2: keeps the unit-count sentence when the PO list gives no total", async () => {
    mockApiGet({ ...baseDashboardData, pending_po_summary: { count: 12, value: 0 } });
    (apiClient.getPage as any).mockRejectedValue(new Error("503"));
    renderHome();
    expect(await screen.findByText("12 units on purchase orders are waiting for goods")).toBeInTheDocument();
  });

  it("says nothing needs attention when nothing does", async () => {
    mockApiGet(baseDashboardData);
    renderHome();
    expect(await screen.findByText(/nothing needs your attention right now/i)).toBeInTheDocument();
  });

  it("tolerates the ERP being down (503): no ERP rows, no alarming error", async () => {
    mockApiGet({ ...baseDashboardData, serial_pending_count: 2 }, { fail: true });
    renderHome();
    expect(await screen.findByText(/2 assets waiting for a serial number/i)).toBeInTheDocument();
    expect(screen.queryByText(/erp/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not show purchase-order or serial rows to a VIEWER, only repair/lost", async () => {
    loginAs("VIEWER");
    mockApiGet({
      ...baseDashboardData,
      serial_pending_count: 7,
      pending_po_summary: { count: 12, value: 1 },
      exception_counts: { UNDER_REPAIR: 2, LOST: 0, DISPOSED: 0, SOLD: 0, SCRAPPED: 0 },
    });
    renderHome();
    expect(await screen.findByText(/2 assets under repair/i)).toBeInTheDocument();
    expect(screen.queryByText(/serial number/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting for goods/i)).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/erp/status");
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

describe("buildAttentionRows", () => {
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
