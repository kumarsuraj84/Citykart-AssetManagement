import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const PO = { id: 7, company_id: 1, po_number: "SPO/012994/26-27", po_date: "2026-09-18", vendor_id: null, cost_center_id: 3, erp_po_code: 1133610106 };

const report = (over: Record<string, unknown> = {}) => ({
  po_id: 7, po_number: PO.po_number, found: true, watching: true, erp_status: "OPEN", erp_as_of: "2026-10-12T00:30:00+00:00",
  changes: [], info: [], log: [], ...over,
});

const CANCELLED = { id: "PO_CANCELLED", kind: "PO_CANCELLED", item_code: null, pending_units: 5, delivered_units: 2, message: "This purchase order was cancelled in the ERP." };
const REDUCED = { id: "CANCEL_UNITS:CT324973", kind: "CANCEL_UNITS", item_code: "CT324973", description: "DELL DESKTOP", was_units: 7, erp_units: 4, pending_units: 5, delivered_units: 2, count: 3, over_delivered: 0 };
const RAISED = { id: "ADD_UNITS:CT324973", kind: "ADD_UNITS", item_code: "CT324973", description: "DELL DESKTOP", was_units: 7, erp_units: 9, count: 2, can_add: true };
const COST = { id: "COST_CHANGED:CT324973", kind: "COST_CHANGED", item_code: "CT324973", description: "DELL DESKTOP", was_rate: 20000, now_rate: 25000, was_tax: 18, now_tax: 12, pending_units: 6, delivered_units: 1 };
const NEWITEM = { id: "NEW_ITEM:CT500001", kind: "NEW_ITEM", item_code: "CT500001", description: "48 PORT SWITCH", qty: 2, rate: 9000 };
const VENDOR = { id: "VENDOR_CHANGED", kind: "VENDOR_CHANGED", item_code: null, was_vendor: "11338", now_code: "2264", now_name: "JAGANNATH ENTERPRISES", linked_vendor_id: 9, linked_vendor_name: "Jagannath Enterprises" };
const HEADER = { id: "HEADER", kind: "HEADER", item_code: null, messages: ["The ERP now shows this purchase order as closed (fully received there). Nothing to change here."] };

function mockApi(changes: unknown = report(), summary: unknown = { available: true, items: [] }) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/erp/status") return Promise.resolve({ configured: true });
    if (path === "/purchase-orders/7") return Promise.resolve(PO);
    if (path === "/purchase-orders/7/lines") return Promise.resolve([]);
    if (path === "/erp/purchase-orders/7/changes") return Promise.resolve(changes);
    if (path === "/erp/changes/summary") return Promise.resolve(summary);
    if (path === "/purchase-orders") return Promise.resolve([{ ...PO, pi_status: "NOT_DELIVERED", pi_number: null, pi_date: null }]);
    if (path === "/erp/reminders" || path.startsWith("/erp/reminders?")) return Promise.resolve([]);
    if (path === "/reports/dashboard") {
      return Promise.resolve({
        status_counts: { IN_STOCK: 1 }, stock_by_location: [], warranty_alerts: [], long_allocation_alerts: [],
        exception_counts: { UNDER_REPAIR: 0, LOST: 0, DISPOSED: 0, SOLD: 0, SCRAPPED: 0 }, recent_activity: [],
        pending_po_summary: { count: 0, value: 0 }, open_purchase_orders: [],
      });
    }
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockResolvedValue(report());
}

async function renderAt(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("ERP changes on a purchase order", () => {
  it("shows nothing when the ERP has not changed anything", async () => {
    mockApi(report());
    await renderAt("/purchase-orders/7");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/purchase-orders/7/changes"));
    expect(screen.queryByLabelText("ERP changes")).not.toBeInTheDocument();
  });

  it("a PO cancelled in the ERP offers to cancel the pending units, and says what stays", async () => {
    mockApi(report({ erp_status: "CANCELLED", changes: [CANCELLED] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(panel).toHaveTextContent("The ERP changed this purchase order since it was made here");
    expect(panel).toHaveTextContent("This purchase order was cancelled in the ERP.");
    expect(panel).toHaveTextContent("5 units still pending here");
    expect(panel).toHaveTextContent("2 units were already delivered before the cancel");
    expect(panel).toHaveTextContent("ERP data as of");
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel the 5 pending units" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "PO_CANCELLED", mode: "apply" }] }),
    );
  });

  it("Keep as it is leaves the PO alone and only records the choice", async () => {
    mockApi(report({ changes: [CANCELLED] }));
    await renderAt("/purchase-orders/7");
    fireEvent.click(await screen.findByRole("button", { name: /keep as it is/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "PO_CANCELLED", mode: "keep" }] }),
    );
  });

  it("a reduced quantity: cancel the pending units, and warn about units already delivered beyond it", async () => {
    mockApi(report({ changes: [{ ...REDUCED, over_delivered: 1 }] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(panel).toHaveTextContent("The ERP reduced DELL DESKTOP (CT324973) from 7 to 4.");
    expect(panel).toHaveTextContent("1 unit more than that was already delivered here: check with purchasing.");
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel 3 pending units" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "CANCEL_UNITS:CT324973", mode: "apply" }] }),
    );
  });

  it("a reduction with nothing left to cancel can just be marked as dealt with", async () => {
    mockApi(report({ changes: [{ ...REDUCED, count: 0, pending_units: 0 }] }));
    await renderAt("/purchase-orders/7");
    expect(await screen.findByRole("button", { name: /nothing pending to cancel/i })).toBeInTheDocument();
  });

  it("a raised quantity: add the extra units", async () => {
    mockApi(report({ changes: [RAISED] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(panel).toHaveTextContent("raised DELL DESKTOP (CT324973) from 7 to 9");
    fireEvent.click(within(panel).getByRole("button", { name: "Add 2 units" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "ADD_UNITS:CT324973", mode: "apply" }] }),
    );
  });

  it("extra units cannot be added automatically when there are no lines here to copy", async () => {
    mockApi(report({ changes: [{ ...RAISED, can_add: false }] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(within(panel).getByRole("button", { name: "Add 2 units" })).toBeDisabled();
    expect(panel).toHaveTextContent("add the extra units with + Add Line");
  });

  it("a changed cost: pending units get the new cost, delivered units keep theirs", async () => {
    mockApi(report({ changes: [COST] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(panel).toHaveTextContent("from 20,000 + 18% tax to 25,000 + 12% tax");
    expect(panel).toHaveTextContent("6 pending units would get the new cost.");
    expect(panel).toHaveTextContent("1 delivered unit keep the cost they were delivered with");
    fireEvent.click(within(panel).getByRole("button", { name: "Update 6 pending units" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "COST_CHANGED:CT324973", mode: "apply" }] }),
    );
  });

  it("a new line in the ERP is added by hand, then marked as added", async () => {
    mockApi(report({ changes: [NEWITEM] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(panel).toHaveTextContent("New in the ERP: 48 PORT SWITCH (CT500001), 2 at 9,000.");
    expect(within(panel).queryByRole("button", { name: /^add \d/i })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Added it: NEW_ITEM:CT500001" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "NEW_ITEM:CT500001", mode: "keep" }] }),
    );
  });

  it("header changes (closed, vendor, location) are information only", async () => {
    mockApi(report({ changes: [HEADER] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(panel).toHaveTextContent("closed (fully received there)");
    fireEvent.click(within(panel).getByRole("button", { name: "Noted: HEADER" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "HEADER", mode: "keep" }] }),
    );
  });

  it("a vendor the ERP moved the PO to: the PO can be moved when that supplier is known here", async () => {
    mockApi(report({ changes: [VENDOR] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(panel).toHaveTextContent("The ERP moved this purchase order to another vendor: JAGANNATH ENTERPRISES (ERP code 2264).");
    expect(panel).toHaveTextContent("Units already delivered keep the vendor they were delivered with.");
    fireEvent.click(within(panel).getByRole("button", { name: "Move this PO to Jagannath Enterprises" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "VENDOR_CHANGED", mode: "apply" }] }),
    );
  });

  it("a supplier that is not linked here yet cannot be moved to, and the way to link it is said", async () => {
    mockApi(report({ changes: [{ ...VENDOR, linked_vendor_id: null, linked_vendor_name: null }] }));
    await renderAt("/purchase-orders/7");
    const panel = await screen.findByLabelText("ERP changes");
    expect(within(panel).getByRole("button", { name: "Move this PO to the new vendor" })).toBeDisabled();
    expect(panel).toHaveTextContent("not linked to a vendor here yet");
    expect(panel).toHaveTextContent("Setup > Vendors");
    fireEvent.click(within(panel).getByRole("button", { name: "Keep the vendor: VENDOR_CHANGED" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "VENDOR_CHANGED", mode: "keep" }] }),
    );
  });

  it("a PO that is not being compared yet offers to start", async () => {
    mockApi(report({ watching: false }));
    await renderAt("/purchase-orders/7");
    fireEvent.click(await screen.findByRole("button", { name: /start comparing with the erp/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/7/changes/apply", { items: [{ id: "WATCH", mode: "apply" }] }),
    );
  });

  it("shows the server's refusal", async () => {
    mockApi(report({ changes: [REDUCED] }));
    (apiClient.post as any).mockRejectedValue(new Error("That change is not there any more (the ERP data or this PO has changed). Reload and look again."));
    await renderAt("/purchase-orders/7");
    fireEvent.click(await screen.findByRole("button", { name: /cancel 3 pending units/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not there any more");
  });

  it("lists what was done about earlier ERP changes", async () => {
    mockApi(report({ log: [{ at: "2026-10-11T10:00:00+00:00", by: "Suraj", kind: "APPLY_CANCEL_UNITS", item_code: "CT324973", summary: "The ERP reduced CT324973 from 7 to 4: cancelled 3 pending units." }] }));
    await renderAt("/purchase-orders/7");
    fireEvent.click(await screen.findByRole("button", { name: /show what was done about erp changes \(1\)/i }));
    expect(screen.getByText(/Suraj: The ERP reduced CT324973 from 7 to 4/)).toBeInTheDocument();
  });

  it("is silent when the ERP is not set up on this server", async () => {
    mockApi();
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/erp/status") return Promise.resolve({ configured: false });
      if (path === "/purchase-orders/7") return Promise.resolve(PO);
      return Promise.resolve([]);
    });
    await renderAt("/purchase-orders/7");
    await screen.findByText(/SPO\/012994\/26-27/);
    expect(apiClient.get).not.toHaveBeenCalledWith("/erp/purchase-orders/7/changes");
    expect(screen.queryByLabelText("ERP changes")).not.toBeInTheDocument();
  });
});

describe("ERP changes in the Purchase Orders list and on the dashboard", () => {
  const SUMMARY = { available: true, items: [{ po_id: 7, po_number: PO.po_number, changes: 2, cancelled: false }] };

  it("the list names the changed POs and tags them", async () => {
    mockApi(report(), SUMMARY);
    await renderAt("/purchase-orders");
    const card = await screen.findByLabelText("Purchase orders changed in the ERP");
    expect(card).toHaveTextContent("The ERP has changed 1 purchase order made from it");
    expect(card).toHaveTextContent("(2 changes)");
    expect(within(card).getByRole("link", { name: /SPO\/012994\/26-27/ })).toHaveAttribute("href", "/purchase-orders/7");
    expect(await screen.findByText("ERP changed")).toBeInTheDocument();
  });

  it("a cancelled PO is tagged as cancelled in the ERP", async () => {
    mockApi(report(), { available: true, items: [{ po_id: 7, po_number: PO.po_number, changes: 1, cancelled: true }] });
    await renderAt("/purchase-orders");
    expect(await screen.findByText("Cancelled in ERP")).toBeInTheDocument();
  });

  it("shows nothing when none changed, or when the ERP cannot be read", async () => {
    mockApi(report(), { available: false, items: [] });
    await renderAt("/purchase-orders");
    await screen.findByRole("link", { name: "Pick from ERP" });
    expect(screen.queryByLabelText("Purchase orders changed in the ERP")).not.toBeInTheDocument();
  });

  it("the dashboard counts them and links to the list", async () => {
    mockApi(report(), SUMMARY);
    await renderAt("/dashboard");
    expect(await screen.findByTestId("erp-changed-po-count")).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: /open purchase orders/i })).toHaveAttribute("href", "/purchase-orders");
  });

  it("the dashboard shows no such card when nothing changed", async () => {
    mockApi(report(), { available: true, items: [] });
    await renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Dashboard" });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/changes/summary"));
    expect(screen.queryByTestId("erp-changed-po-count")).not.toBeInTheDocument();
  });
});
