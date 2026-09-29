import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

function renderListAt(url = "/purchase-orders") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("PurchaseOrdersList", () => {
  const PO_A = {
    id: 1, company_id: 1, po_number: "PO-2026-001", po_date: "2026-01-01", vendor_id: 9,
    pi_status: "PENDING", pi_number: null, pi_date: null,
  };
  const PO_B = {
    id: 2, company_id: 1, po_number: "PO-2026-002", po_date: "2026-02-01", vendor_id: 9,
    pi_status: "RECORDED", pi_number: "PI-9001", pi_date: "2026-02-10",
  };

  function mockGets(pos: unknown[]) {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/purchase-orders")) return Promise.resolve(pos);
      if (path.startsWith("/masters/vendors")) return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
      return Promise.resolve([]);
    });
  }

  it("shows purchase orders with resolved vendor names", async () => {
    mockGets([PO_A]);
    renderListAt();
    await waitFor(() => expect(screen.getByText("PO-2026-001")).toBeInTheDocument());
    expect(screen.getByText("Acme Traders")).toBeInTheDocument();
  });

  it("shows an empty state when there are no purchase orders", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    renderListAt();
    await waitFor(() => expect(screen.getByText("No purchase orders yet.")).toBeInTheDocument());
  });

  it("links to /purchase-orders/new", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    renderListAt();
    await waitFor(() => expect(screen.getByRole("link", { name: "New Purchase Order" })).toHaveAttribute("href", "/purchase-orders/new"));
  });

  it("AM-19: shows PI Status/No/Date, distinguishing Pending from Recorded", async () => {
    mockGets([PO_A, PO_B]);
    renderListAt();
    await waitFor(() => expect(screen.getByText("PO-2026-001")).toBeInTheDocument());

    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(screen.getByText("PI-9001")).toBeInTheDocument();
    expect(screen.getByText("2026-02-10")).toBeInTheDocument();
  });

  it("AM-21: search filters by PI Number, so a Pending PI is easy to find from home", async () => {
    mockGets([PO_A, PO_B]);
    renderListAt();
    await waitFor(() => expect(screen.getByText("PO-2026-001")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/search purchase orders/i), { target: { value: "PI-9001" } });
    await waitFor(() => expect(screen.queryByText("PO-2026-001")).not.toBeInTheDocument());
    expect(screen.getByText("PO-2026-002")).toBeInTheDocument();
  });

  it("AM-21: PO No column is sortable", async () => {
    mockGets([PO_B, PO_A]); // API order: 002 then 001
    renderListAt();
    await waitFor(() => expect(screen.getByText("PO-2026-002")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /sort by po no/i }));
    const rowsText = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    await waitFor(() => expect(rowsText()[0]).toContain("PO-2026-001")); // ascending
  });
});
