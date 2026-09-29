import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

function renderFormAt(url = "/purchase-orders/new") {
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
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, name: "Head Office" }]);
    return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
  });
});
afterEach(() => useAuthStore.getState().logout());

describe("NewPurchaseOrderForm", () => {
  it("disables Create until PO No, PO Date and Cost Centre are filled", async () => {
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /create purchase order/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    expect(screen.getByRole("button", { name: /create purchase order/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    expect(screen.getByRole("button", { name: /create purchase order/i })).not.toBeDisabled();
  });

  it("creates a PO and navigates to its detail page", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 42 });
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders",
        expect.objectContaining({ company_id: 1, po_number: "PO-1", cost_center_id: 3 }),
      ),
    );
  });

  it("shows a server-side error inline", async () => {
    (apiClient.post as any).mockRejectedValue(new Error("PO number already used"));
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("PO number already used"));
  });

  it("AM-24: shows a Company picker when the caller has access to more than one, and submits the chosen company", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Company A" }, { id: 2, name: "Company B" }]);
      if (path === "/masters/cost-centers?company_id=1") return Promise.resolve([{ id: 3, name: "A Cost Centre" }]);
      if (path === "/masters/cost-centers?company_id=2") return Promise.resolve([{ id: 30, name: "B Cost Centre" }]);
      return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
    });
    (apiClient.post as any).mockResolvedValue({ id: 42 });
    renderFormAt();

    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText(/^company/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/^company/i));
    fireEvent.click(await screen.findByText("Company B"));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/cost-centers?company_id=2"));

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("B Cost Centre"));
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders",
        expect.objectContaining({ company_id: 2, cost_center_id: 30 }),
      ),
    );
  });
});
