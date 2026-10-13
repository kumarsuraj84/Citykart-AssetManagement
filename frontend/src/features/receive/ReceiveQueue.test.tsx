import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

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

const PO = (id: number, extra: Record<string, unknown> = {}) => ({
  id, company_id: 1, po_number: `PO-${id}`, po_date: "2026-10-01", vendor_id: 9, vendor_name: "Acme Traders",
  company_name: "CityKart", pi_status: "NOT_DELIVERED", ordered_units: 10, received_units: 0, waiting_units: 10,
  cancelled_units: 0, status: "WAITING", ...extra,
});

/** A fake GET /purchase-orders (waiting, status, q, paging + X-Total-Count) and the optional ERP reminders. */
function mockApi(pos: Record<string, unknown>[], erp: { configured: boolean; reminders?: unknown; fail?: boolean } = { configured: false }) {
  (apiClient.getPage as any).mockImplementation((path: string) => {
    const url = new URL(path, "http://x");
    let rows = pos;
    if (url.searchParams.get("waiting") === "true") rows = rows.filter((p) => (p.waiting_units as number) > 0);
    const status = url.searchParams.get("status");
    if (status) rows = rows.filter((p) => p.status === status);
    const q = url.searchParams.get("q")?.toLowerCase();
    if (q) rows = rows.filter((p) => String(p.po_number).toLowerCase().includes(q) || String(p.vendor_name).toLowerCase().includes(q));
    return Promise.resolve({ data: rows, total: rows.length });
  });
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/erp/status") return erp.fail ? Promise.reject(new Error("503")) : Promise.resolve({ configured: erp.configured });
    if (path === "/erp/reminders") return Promise.resolve(erp.reminders ?? []);
    return Promise.resolve([]);
  });
}

const pageCalls = () => (apiClient.getPage as any).mock.calls.map(([p]: [string]) => p as string);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});

afterEach(() => useAuthStore.getState().logout());

describe("Receive queue (S2: built on GET /purchase-orders?waiting=true)", () => {
  it("lists only POs with units waiting, with Waiting / Ordered / Received, status, vendor, company and date", async () => {
    mockApi([
      PO(1),
      PO(2, { ordered_units: 10, received_units: 10, waiting_units: 0, status: "RECEIVED" }),
      PO(3, { company_name: "CityKart Ventures", ordered_units: 8, received_units: 2, waiting_units: 6, status: "PARTLY_RECEIVED" }),
    ]);
    renderAt();
    expect(await screen.findByRole("heading", { name: "Receive" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getByText("PO-1")).toBeInTheDocument());
    expect(pageCalls()[0]).toBe("/purchase-orders?waiting=true&limit=200");
    expect(within(table).queryByText("PO-2")).not.toBeInTheDocument();
    const row3 = within(table).getByText("PO-3").closest("tr") as HTMLElement;
    expect(within(row3).getAllByRole("cell").slice(0, 8).map((c) => c.textContent)).toEqual([
      "PO-3", "Acme Traders", "CityKart Ventures", "2026-10-01", "6", "8", "2", "Partly Received",
    ]);
    expect(screen.getByRole("link", { name: "Open PO-3" })).toHaveAttribute("href", "/purchase-orders/3");
    expect(screen.getByRole("link", { name: "All Purchase Orders" })).toHaveAttribute("href", "/purchase-orders");
    expect(screen.getByText("Showing 2 of 2 purchase orders")).toBeInTheDocument();
    // The S1 workaround note is gone now that the server counts waiting units.
    expect(screen.queryByText(/may not show here yet/i)).not.toBeInTheDocument();
  });

  it("Receive goes straight to the Receive screen of that PO (S4); the row itself opens the PO", async () => {
    mockApi([PO(4)]);
    const router = renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "Receive PO-4" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/receive/4"));
    expect(router.state.location.search).toEqual({});
  });

  it("searches (server q) and filters Waiting / Partly Received", async () => {
    mockApi([PO(1), PO(3, { vendor_name: "Zenith", received_units: 2, waiting_units: 8, status: "PARTLY_RECEIVED" })]);
    renderAt();
    await screen.findByText("PO-1");
    const chips = within(screen.getByRole("group", { name: "Show" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual(["All waiting", "Waiting", "Partly Received"]);
    fireEvent.click(chips.getByRole("button", { name: "Partly Received" }));
    await waitFor(() => expect(pageCalls()).toContain("/purchase-orders?status=PARTLY_RECEIVED&waiting=true&limit=200"));
    await waitFor(() => expect(screen.queryByText("PO-1")).not.toBeInTheDocument());
    expect(screen.getByText("PO-3")).toBeInTheDocument();

    fireEvent.click(chips.getByRole("button", { name: "All waiting" }));
    fireEvent.change(screen.getByLabelText("Search purchase orders to receive"), { target: { value: "zenith" } });
    await waitFor(() => expect(pageCalls()).toContain("/purchase-orders?waiting=true&q=zenith&limit=200"));
    await waitFor(() => expect(screen.queryByText("PO-1")).not.toBeInTheDocument());
    expect(screen.getByText("PO-3")).toBeInTheDocument();
  });

  it("notes POs the ERP shows as arrived, and tolerates the ERP being down", async () => {
    mockApi([PO(5)], { configured: true, reminders: [{ po_id: 5, to_deliver: 3 }] });
    renderAt();
    expect(await screen.findByText("ERP shows 3 units arrived")).toBeInTheDocument();
  });

  it("works when the ERP cannot be reached", async () => {
    mockApi([PO(1)], { configured: true, fail: true });
    renderAt();
    expect(await screen.findByText("PO-1")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "ERP" })).not.toBeInTheDocument();
  });

  it("says so when nothing is waiting", async () => {
    mockApi([PO(2, { waiting_units: 0, status: "RECEIVED" })]);
    renderAt();
    expect(await screen.findByText("Nothing waiting to be received.")).toBeInTheDocument();
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
