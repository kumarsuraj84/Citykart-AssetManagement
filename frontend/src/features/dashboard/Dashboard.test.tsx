import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./Dashboard";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Dashboard /></QueryClientProvider>);
}

describe("Dashboard", () => {
  it("shows KPI tiles and warranty alerts", async () => {
    (apiClient.get as any).mockResolvedValue({
      status_counts: { IN_STOCK: 5, ALLOTTED: 3 },
      stock_by_location: [{ location: "HO", count: 5 }],
      warranty_alerts: [{ asset_id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", warranty_upto: "2026-10-01" }],
      long_allocation_alerts: [],
    });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_1/)).toBeInTheDocument();
    // KPI tile labels render through StatusBadge, not raw text.
    expect(screen.getByText("IN STOCK")).toBeInTheDocument();
  });

  it("shows a real empty state, not just blank cards, when there is genuinely no data", async () => {
    (apiClient.get as any).mockResolvedValue({
      status_counts: {},
      stock_by_location: [],
      warranty_alerts: [],
      long_allocation_alerts: [],
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

    (apiClient.get as any).mockResolvedValue({
      status_counts: { IN_STOCK: 1 },
      stock_by_location: [],
      warranty_alerts: [],
      long_allocation_alerts: [],
    });
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
  });
});
