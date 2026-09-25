import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

function renderDetailAt(url = "/purchase-orders/1") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const PO = { id: 1, company_id: 1, po_number: "PO-2026-001", po_date: "2026-01-01", vendor_id: null, cost_center_id: 3 };

const PENDING_LINE = {
  id: 10, purchase_order_id: 1, description: "Dell Laptop", category_id: 1, subcategory_id: null,
  cost_center_id: 3, purchase_cost: 1000, tax_percent: 18, total_cost: 1180,
  status: "PENDING", serial_number: null, delivered_asset_id: null,
};
const DELIVERED_LINE = {
  ...PENDING_LINE, id: 11, description: "HP Printer", status: "DELIVERED", serial_number: "SN-999", delivered_asset_id: 99,
};

function mockGets(lines: unknown[]) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/purchase-orders/1") return Promise.resolve(PO);
    if (path === "/purchase-orders/1/lines") return Promise.resolve(lines);
    if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, name: "IT Equipment" }]);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, name: "Laptop", category_id: 1 }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, name: "Head Office" }]);
    if (path.startsWith("/holders")) return Promise.resolve([{ id: 5, name: "IT Stock-HO" }]);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("PurchaseOrderDetail", () => {
  it("renders the PO header and its lines", async () => {
    mockGets([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText(/PO-2026-001/)).toBeInTheDocument());
    expect(screen.getByText("Dell Laptop")).toBeInTheDocument();
    expect(screen.getByText("PENDING")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Head Office/)).toBeInTheDocument());
  });

  it("posts an Add Line request including quantity", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Laptop" } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "3" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /add line/i })).toBeDisabled());
  });

  it("edit opens pre-filled with the line's current values and PUTs the update", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.put as any).mockResolvedValue({ ...PENDING_LINE, description: "Dell Laptop Pro" });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/description/i)).toHaveValue("Dell Laptop");

    fireEvent.change(within(dialog).getByLabelText(/description/i), { target: { value: "Dell Laptop Pro" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/lines/10", expect.objectContaining({ description: "Dell Laptop Pro" })),
    );
  });

  it("cancel posts a cancel request", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.post as any).mockResolvedValue({ ...PENDING_LINE, status: "CANCELLED" });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/lines/10/cancel"));
  });

  it("a DELIVERED line shows no Edit/Cancel actions and no selection checkbox", async () => {
    mockGets([DELIVERED_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("HP Printer")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("selecting a pending line and confirming Delivery Done submits the right payload", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.post as any).mockResolvedValue([{ ...PENDING_LINE, status: "DELIVERED" }]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select dell laptop/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark 1 delivery done/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /confirm/i })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.change(within(dialog).getByLabelText(/serial number/i), { target: { value: "SN-001" } });

    // Radix Select isn't a native <select>; pick the holder option via its trigger.
    fireEvent.click(within(dialog).getByLabelText(/initial holder/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));

    await waitFor(() => expect(within(dialog).getByRole("button", { name: /confirm/i })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          invoice_number: "INV-1",
          invoice_amount: 1180,
          lines: [{ pending_asset_id: 10, serial_number: "SN-001", initial_holder_id: 5 }],
        }),
      ),
    );
  });

  it("shows a server-side error inline on a failed Delivery Done submit and keeps the dialog open", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/purchase-orders/1/deliver") return Promise.reject(new Error("pending asset 10 is not PENDING (already DELIVERED)"));
      return Promise.resolve([]);
    });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select dell laptop/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark 1 delivery done/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.change(within(dialog).getByLabelText(/serial number/i), { target: { value: "SN-001" } });
    fireEvent.click(within(dialog).getByLabelText(/initial holder/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(/not PENDING/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
