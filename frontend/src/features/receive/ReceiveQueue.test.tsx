import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { buildReceiveRows } from "./ReceiveQueue";

vi.mock("../../lib/api-client");

function renderAt(url = "/receive") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const PO = (id: number, pi_status: string, extra: Record<string, unknown> = {}) => ({
  id, company_id: 1, po_number: `PO-${id}`, po_date: "2026-10-01", vendor_id: 9, pi_status, ...extra,
});

function mockApi(pos: unknown[], openPos: unknown[] = [], erp: { configured: boolean; reminders?: unknown; fail?: boolean } = { configured: false }) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/purchase-orders") return Promise.resolve(pos);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
    if (path === "/masters/companies") return Promise.resolve([{ id: 1, name: "CityKart" }, { id: 2, name: "CityKart Ventures" }]);
    if (path === "/reports/dashboard") return Promise.resolve({ open_purchase_orders: openPos });
    if (path === "/erp/status") return erp.fail ? Promise.reject(new Error("503")) : Promise.resolve({ configured: erp.configured });
    if (path === "/erp/reminders") return Promise.resolve(erp.reminders ?? []);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});

afterEach(() => useAuthStore.getState().logout());

describe("Receive queue", () => {
  it("lists only purchase orders with goods still to come, each with an Open link to the PO", async () => {
    mockApi(
      [PO(1, "NOT_DELIVERED"), PO(2, "RECORDED"), PO(3, "PENDING"), PO(4, "RECORDED")],
      [{ id: 3, pending_line_count: 6 }],
    );
    renderAt();
    expect(await screen.findByRole("heading", { name: "Receive" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getByText("PO-1")).toBeInTheDocument());
    expect(within(table).getByText("PO-3")).toBeInTheDocument();
    expect(within(table).queryByText("PO-2")).not.toBeInTheDocument();
    expect(within(table).queryByText("PO-4")).not.toBeInTheDocument();
    expect(within(table).getByText("Nothing received yet")).toBeInTheDocument();
    await waitFor(() => expect(within(table).getByText("6 units waiting")).toBeInTheDocument());
    expect(within(table).getAllByText("Acme Traders")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open PO-3" })).toHaveAttribute("href", "/purchase-orders/3");
    expect(screen.getByRole("link", { name: "All Purchase Orders" })).toHaveAttribute("href", "/purchase-orders");
  });

  it("adds POs the ERP shows as arrived, and tolerates the ERP being down", async () => {
    mockApi([PO(2, "RECORDED"), PO(5, "PENDING")], [], { configured: true, reminders: [{ po_id: 5, to_deliver: 3 }] });
    renderAt();
    expect(await screen.findByText("ERP shows 3 units arrived")).toBeInTheDocument();
    expect(screen.getByText("PO-5")).toBeInTheDocument();

    mockApi([PO(1, "NOT_DELIVERED")], [], { configured: true, fail: true });
    renderAt();
    expect(await screen.findAllByText("PO-1")).not.toHaveLength(0);
  });

  it("says so when nothing is waiting", async () => {
    mockApi([PO(2, "RECORDED")]);
    renderAt();
    expect(await screen.findByText("Nothing waiting to be received.")).toBeInTheDocument();
  });

  it("uses the server's waiting_units when it sends it (a later backend addition)", () => {
    const rows = buildReceiveRows(
      [PO(1, "NOT_DELIVERED", { waiting_units: 0 }), PO(2, "RECORDED", { waiting_units: 4 })] as never,
      [{ id: 1, pending_line_count: 9 }],
      [],
    );
    expect(rows.map((r) => [r.po.id, r.waiting])).toEqual([[2, 4]]);
  });
});

describe("People & Places routes", () => {
  it.each([
    ["/people/employees", "Employees", "Add Employee"],
    ["/people/stores", "Stores", "Add Store"],
    ["/people/stock-rooms", "Stock Rooms", "Add Stock Room"],
    ["/people/install-points", "Install Points", "Add Install Point"],
  ])("%s shows %s with %s", async (url, title, add) => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    (apiClient.get as any).mockResolvedValue([]);
    renderAt(url);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: add }).length).toBeGreaterThan(0);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: title })).toHaveAttribute("data-active", "true");
  });
});
