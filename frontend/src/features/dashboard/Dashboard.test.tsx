import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./Dashboard";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("Dashboard", () => {
  it("shows KPI tiles and warranty alerts", async () => {
    (apiClient.get as any).mockResolvedValue({
      status_counts: { IN_STOCK: 5, ALLOTTED: 3 },
      stock_by_location: [{ location: "HO", count: 5 }],
      warranty_alerts: [{ asset_id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", warranty_upto: "2026-10-01" }],
      long_allocation_alerts: [],
    });
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><Dashboard /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_1/)).toBeInTheDocument();
  });
});
