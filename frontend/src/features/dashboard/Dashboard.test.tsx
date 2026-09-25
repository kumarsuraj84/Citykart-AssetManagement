import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

// Dashboard now links into the Asset Register (AM-12 §6, Exceptions) and
// Asset 360 (Recent Activity), so it needs a real RouterProvider ancestor --
// same pattern AssetRegister.test.tsx already uses.
function renderDashboard(url = "/dashboard") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const baseDashboardData = {
  status_counts: { IN_STOCK: 5, ALLOTTED: 3 },
  stock_by_location: [{ location: "HO", count: 5 }],
  warranty_alerts: [{ asset_id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", warranty_upto: "2026-10-01" }],
  long_allocation_alerts: [],
  exception_counts: { UNDER_REPAIR: 0, LOST: 0, DISPOSED: 0, SOLD: 0, SCRAPPED: 0 },
  recent_activity: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, mustChangePassword: false });
});

afterEach(() => useAuthStore.getState().logout());

describe("Dashboard", () => {
  it("shows KPI tiles and warranty alerts", async () => {
    (apiClient.get as any).mockResolvedValue(baseDashboardData);
    renderDashboard();

    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_1/)).toBeInTheDocument();
    // KPI tile labels render through StatusBadge, not raw text.
    expect(screen.getByText("IN STOCK")).toBeInTheDocument();
  });

  it("shows a real empty state, not just blank cards, when there is genuinely no data", async () => {
    (apiClient.get as any).mockResolvedValue({
      ...baseDashboardData,
      status_counts: {},
      stock_by_location: [],
      warranty_alerts: [],
    });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("No assets yet.")).toBeInTheDocument());
    expect(screen.getByText("No stock on hand.")).toBeInTheDocument();
    expect(screen.getByText("Nothing expiring soon.")).toBeInTheDocument();
    expect(screen.getByText("Nothing overdue.")).toBeInTheDocument();
  });

  it("shows an error state with a retry action instead of getting stuck on Loading forever when the fetch fails", async () => {
    (apiClient.get as any).mockRejectedValue(new Error("network down"));
    renderDashboard();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/couldn't load the dashboard/i)).toBeInTheDocument();
    expect(screen.queryByText(/^loading/i)).not.toBeInTheDocument();

    (apiClient.get as any).mockResolvedValue(baseDashboardData);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
  });

  it("shows every exception status explicitly at 0, never hidden, when nothing is in that state (AM-12)", async () => {
    (apiClient.get as any).mockResolvedValue(baseDashboardData);
    renderDashboard();

    // "Exceptions" (the CardTitle) is static and renders before data loads --
    // wait for a real loaded KPI value first so the table below it is past
    // its own loading skeleton.
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    for (const label of ["UNDER REPAIR", "LOST", "DISPOSED", "SOLD", "SCRAPPED"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows real repair/lost/disposal counts, each linking to the matching Asset Register filter (AM-12)", async () => {
    (apiClient.get as any).mockResolvedValue({
      ...baseDashboardData,
      exception_counts: { UNDER_REPAIR: 2, LOST: 1, DISPOSED: 3, SOLD: 0, SCRAPPED: 0 },
    });
    renderDashboard();

    await waitFor(() => expect(screen.getByRole("link", { name: "2" })).toBeInTheDocument());
    const repairLink = screen.getByRole("link", { name: "2" });
    expect(repairLink).toHaveAttribute("href", expect.stringContaining("status=UNDER_REPAIR"));
    const lostLink = screen.getByRole("link", { name: "1" });
    expect(lostLink).toHaveAttribute("href", expect.stringContaining("status=LOST"));
    const disposedLink = screen.getByRole("link", { name: "3" });
    expect(disposedLink).toHaveAttribute("href", expect.stringContaining("status=DISPOSED"));
  });

  it("shows recent activity with asset code, action, time and actor, most-recent evidence intact", async () => {
    (apiClient.get as any).mockResolvedValue({
      ...baseDashboardData,
      recent_activity: [
        {
          id: 1, asset_id: 42, asset_code: "FA/HO01/IT/LAP/CK_99", event_type: "MOVED",
          event_date: "2026-09-25T10:00:00Z", label: "Allotted to Jane Doe", recorded_by_name: "Admin User",
        },
      ],
    });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_99")).toBeInTheDocument());
    expect(screen.getByText("Allotted to Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
  });

  it("shows a clear empty state for Recent Activity, not blank space", async () => {
    (apiClient.get as any).mockResolvedValue(baseDashboardData);
    renderDashboard();

    await waitFor(() => expect(screen.getByText("No recent asset activity.")).toBeInTheDocument());
  });

  it("falls back to an em dash when an activity row has no resolvable actor name", async () => {
    (apiClient.get as any).mockResolvedValue({
      ...baseDashboardData,
      recent_activity: [
        {
          id: 1, asset_id: 42, asset_code: "FA/HO01/IT/LAP/CK_99", event_type: "PROCURED",
          event_date: "2026-09-25T10:00:00Z", label: "Procured", recorded_by_name: null,
        },
      ],
    });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_99")).toBeInTheDocument());
    const row = screen.getByText("FA/HO01/IT/LAP/CK_99").closest("tr");
    expect(row ? within(row).getByText("—") : null).toBeInTheDocument();
  });
});
