import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { linesAndUnitsSentence, poListPath } from "./po-list";
import { distinctLines } from "./po-detail-types";

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
  (apiClient.get as any).mockResolvedValue([]);
});
afterEach(() => useAuthStore.getState().logout());

const PO_A = {
  id: 1, company_id: 1, po_number: "PO-2026-001", po_date: "2026-01-01", vendor_id: 9, vendor_name: "Acme Traders",
  company_name: "Citykart Stores Pvt Ltd", pi_status: "PENDING", pi_number: null, pi_date: null,
  ordered_units: 47, received_units: 0, waiting_units: 47, cancelled_units: 0, status: "WAITING",
};
const PO_B = {
  id: 2, company_id: 1, po_number: "PO-2026-002", po_date: "2026-02-01", vendor_id: 9, vendor_name: "Acme Traders",
  company_name: "Citykart Stores Pvt Ltd", pi_status: "RECORDED", pi_number: "PI-9001", pi_date: "2026-02-10",
  ordered_units: 10, received_units: 10, waiting_units: 0, cancelled_units: 2, status: "RECEIVED",
};
const PO_C = {
  ...PO_A, id: 3, po_number: "PO-2026-003", vendor_name: "Zenith Supplies", company_name: "Citykart Ventures",
  ordered_units: 5, received_units: 2, waiting_units: 3, status: "PARTLY_RECEIVED",
};

/** A fake server for GET /purchase-orders: status, q (PO No / vendor), limit, offset and X-Total-Count. */
function mockServer(pos: Record<string, unknown>[]) {
  (apiClient.getPage as any).mockImplementation((path: string) => {
    const url = new URL(path, "http://x");
    let rows = pos;
    const status = url.searchParams.get("status");
    if (status) rows = rows.filter((p) => p.status === status);
    if (url.searchParams.get("waiting") === "true") rows = rows.filter((p) => (p.waiting_units as number) > 0);
    const q = url.searchParams.get("q")?.toLowerCase();
    if (q) rows = rows.filter((p) => String(p.po_number).toLowerCase().includes(q) || String(p.vendor_name).toLowerCase().includes(q));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 200);
    return Promise.resolve({ data: rows.slice(offset, offset + limit), total: rows.length });
  });
}

const pageCalls = () => (apiClient.getPage as any).mock.calls.map(([p]: [string]) => p as string);
const bodyRows = () => screen.getAllByRole("row").slice(1);

describe("PurchaseOrdersList", () => {
  it("shows PO No, Vendor, Company, Date, Ordered / Received / Waiting and a plain-word status for each PO", async () => {
    mockServer([PO_A, PO_B, PO_C]);
    renderListAt();
    await waitFor(() => expect(screen.getByText("PO-2026-001")).toBeInTheDocument());
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["PO No", "Vendor", "Company", "Date", "Ordered", "Received", "Waiting", "Status", "Purchase Invoice (PI)"]);
    const [a, b, c] = bodyRows();
    expect(within(a).getAllByRole("cell").map((x) => x.textContent)).toEqual([
      "PO-2026-001", "Acme Traders", "Citykart Stores Pvt Ltd", "2026-01-01", "47", "0", "47", "Waiting", "Pending",
    ]);
    expect(within(b).getByText("Received")).toBeInTheDocument();
    expect(within(c).getByText("Partly Received")).toBeInTheDocument();
    expect(screen.queryByText(/PARTLY_RECEIVED|WAITING/)).not.toBeInTheDocument();
    expect(pageCalls()[0]).toBe("/purchase-orders?limit=200");
  });

  it("rows open the PO", async () => {
    mockServer([PO_A]);
    const router = renderListAt();
    fireEvent.click(await screen.findByText("Acme Traders"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/purchase-orders/1"));
  });

  it("shows an empty state when there are no purchase orders", async () => {
    mockServer([]);
    renderListAt();
    await waitFor(() => expect(screen.getByText("No purchase orders yet.")).toBeInTheDocument());
  });

  it("links to /purchase-orders/new", async () => {
    mockServer([]);
    renderListAt();
    await waitFor(() => expect(screen.getByRole("link", { name: "New Purchase Order" })).toHaveAttribute("href", "/purchase-orders/new"));
  });

  it("AM-19: keeps the Purchase Invoice (PI) status, number and date, compactly in one column", async () => {
    mockServer([PO_A, PO_B]);
    renderListAt();
    await waitFor(() => expect(screen.getByText("PO-2026-001")).toBeInTheDocument());
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(screen.getByText("PI-9001 · 2026-02-10")).toBeInTheDocument();
    // PI is spelled out once on the screen.
    expect(screen.getAllByText(/Purchase Invoice \(PI\)/)).toHaveLength(1);
  });

  it("status chips ask the server for that status", async () => {
    mockServer([PO_A, PO_B, PO_C]);
    renderListAt();
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const chips = within(screen.getByRole("group", { name: "Show purchase orders" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Waiting", "Partly Received", "Received", "Cancelled"]);
    expect(chips.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chips.getByRole("button", { name: "Partly Received" }));
    await waitFor(() => expect(pageCalls()).toContain("/purchase-orders?status=PARTLY_RECEIVED&limit=200"));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(screen.getByText("PO-2026-003")).toBeInTheDocument();

    fireEvent.click(chips.getByRole("button", { name: "Cancelled" }));
    await waitFor(() => expect(screen.getByText("No matches")).toBeInTheDocument());
  });

  it("the search box drives the server's q (PO No or vendor), after typing stops", async () => {
    mockServer([PO_A, PO_B, PO_C]);
    renderListAt();
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const box = screen.getByLabelText(/search purchase orders/i);
    expect(box).toHaveAttribute("placeholder", "Search PO No, Vendor or PI No…");

    fireEvent.change(box, { target: { value: "zen" } });
    fireEvent.change(box, { target: { value: "zenith" } });
    await waitFor(() => expect(pageCalls()).toContain("/purchase-orders?q=zenith&limit=200"));
    expect(pageCalls()).not.toContain("/purchase-orders?q=zen&limit=200"); // debounced
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(screen.getByText("PO-2026-003")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "2026-02-10" } });
    await waitFor(() => expect(screen.getByText("No matches")).toBeInTheDocument());
  });

  it("AM-21: a PI Number is still found among the loaded purchase orders", async () => {
    mockServer([PO_A, PO_B]);
    renderListAt();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText(/search purchase orders/i), { target: { value: "PI-9001" } });
    await waitFor(() => expect(pageCalls()).toContain("/purchase-orders?q=PI-9001&limit=200"));
    expect(await screen.findByText("PO-2026-002")).toBeInTheDocument();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(screen.queryByText("PO-2026-001")).not.toBeInTheDocument();
  });

  it("pages through the server's list: Showing x of y, then Load more", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ ...PO_A, id: 1000 + i, po_number: `PO-${String(1000 + i)}` }));
    mockServer(many);
    renderListAt();
    expect(await screen.findByText("Showing 200 of 250 purchase orders")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(pageCalls()).toContain("/purchase-orders?limit=200&offset=200"));
    expect(await screen.findByText("Showing 250 of 250 purchase orders")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(250);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("AM-21: PO No column is sortable", async () => {
    mockServer([PO_B, PO_A]); // server order: 002 then 001
    renderListAt();
    await waitFor(() => expect(screen.getByText("PO-2026-002")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /sort by po no/i }));
    await waitFor(() => expect(bodyRows()[0].textContent).toContain("PO-2026-001")); // ascending
  });

  it("shows the server's sentence when the list cannot be loaded", async () => {
    (apiClient.getPage as any).mockRejectedValue(new Error("Choose a status: waiting, partly received, received or cancelled."));
    renderListAt();
    expect(await screen.findByText("Choose a status: waiting, partly received, received or cancelled.")).toBeInTheDocument();
  });
});

describe("lines-and-units wording", () => {
  it("says lines and units apart, never 'N lines added' for N units", () => {
    expect(linesAndUnitsSentence(3, 104)).toBe("3 lines, 104 units waiting");
    expect(linesAndUnitsSentence(1, 1)).toBe("1 line, 1 unit waiting");
    expect(linesAndUnitsSentence(4, 4000)).toBe("4 lines, 4,000 units waiting");
    expect(distinctLines([{ line_no: 4 }, { line_no: 4 }, { line_no: 5 }])).toBe(2);
    expect(distinctLines([{ line_no: null }, { line_no: null }])).toBe(1);
    expect(distinctLines([])).toBe(0);
  });
});

describe("poListPath", () => {
  it("builds the query the server expects, leaving out what is empty", () => {
    expect(poListPath()).toBe("/purchase-orders");
    expect(poListPath({ waiting: true, limit: 1 })).toBe("/purchase-orders?waiting=true&limit=1");
    expect(poListPath({ status: "WAITING", q: "  acme & co ", limit: 200, offset: 400 })).toBe(
      "/purchase-orders?status=WAITING&q=acme+%26+co&limit=200&offset=400",
    );
  });
});
