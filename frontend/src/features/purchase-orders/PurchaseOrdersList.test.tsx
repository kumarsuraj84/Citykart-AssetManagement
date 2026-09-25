import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("PurchaseOrdersList", () => {
  it("shows purchase orders with resolved vendor names", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/purchase-orders")) {
        return Promise.resolve([{ id: 1, company_id: 1, po_number: "PO-2026-001", po_date: "2026-01-01", vendor_id: 9 }]);
      }
      if (path.startsWith("/masters/vendors")) return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
      return Promise.resolve([]);
    });

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
});
