import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { KINDS, withCapabilities } from "../../test-capabilities";

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

type Unit = Record<string, unknown> & { id: number; status: string; line_no?: number; description: string };

const PENDING_LINE: Unit = {
  id: 10, purchase_order_id: 1, line_no: 1, description: "Dell Laptop", barcode: "BC-777", category_id: 1, subcategory_id: null,
  cost_center_id: 3, purchase_cost: 1000, tax_percent: 18, total_cost: 1180,
  status: "PENDING", serial_number: null, invoice_number: null, delivered_asset_id: null,
};
const DELIVERED_LINE: Unit = {
  ...PENDING_LINE, id: 11, line_no: 2, description: "HP Printer", status: "DELIVERED", serial_number: "SN-999",
  invoice_number: "INV-777", delivered_asset_id: 99,
};
const PENDING_LINE_2: Unit = { ...PENDING_LINE, id: 12, line_no: 2, description: "Logitech Mouse", barcode: "CT123" };

/** One PO line as GET .../line-groups returns it. */
function group(over: Record<string, unknown> = {}) {
  return {
    line_no: 1, item_id: null, item_name: null, description: "Dell Laptop", barcode: "BC-777", erp_item_code: null,
    category_id: 1, category_name: "IT Equipment", subcategory_id: null, subcategory_name: null, work_area: "IT",
    brand_id: null, brand_name: null, model: null, warranty_years: 0, rate: 1000, tax_percent: 18, unit_total: 1180,
    ordered: 1, received: 0, waiting: 1, cancelled: 0, line_value: 1180, status: "WAITING", serial_mode: "HAS_SERIAL",
    bundle_label: null, waiting_unit_count: 1,
    ...over,
  };
}

/** The line groups the server would make of these units (one per line_no). */
function groupsFrom(units: Unit[]) {
  const byLine = new Map<number, Unit[]>();
  for (const u of units) {
    const n = u.line_no ?? 1;
    byLine.set(n, [...(byLine.get(n) ?? []), u]);
  }
  return [...byLine].sort(([a], [b]) => a - b).map(([n, us]) => {
    const received = us.filter((u) => u.status === "DELIVERED").length;
    const waiting = us.filter((u) => u.status === "PENDING").length;
    const cancelled = us.filter((u) => u.status === "CANCELLED").length;
    const status = received + waiting === 0 ? "CANCELLED" : waiting === 0 ? "RECEIVED" : received > 0 ? "PARTLY_RECEIVED" : "WAITING";
    const first = us.find((u) => u.status === "PENDING") ?? us[0];
    return group({
      line_no: n, description: first.description, barcode: first.barcode ?? null, bundle_label: first.bundle_label ?? null,
      ordered: received + waiting, received, waiting, cancelled, line_value: (received + waiting) * 1180, status,
      serial_mode: first.serial_required === false ? "NO_SERIAL" : first.serial_later ? "SERIAL_LATER" : "HAS_SERIAL",
    });
  });
}

const UNIT_STATUS: Record<string, string> = { WAITING: "PENDING", RECEIVED: "DELIVERED", CANCELLED: "CANCELLED" };

function mockGets(units: Unit[], opts: { po?: unknown; groups?: unknown[]; invoices?: unknown[] } = {}) {
  const groups = opts.groups ?? groupsFrom(units);
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/purchase-orders/1") return Promise.resolve(opts.po ?? PO);
    if (path === "/purchase-orders/1/line-groups") return Promise.resolve(groups);
    if (path === "/purchase-orders/1/lines") return Promise.resolve(units);
    if (path === "/purchase-orders/1/invoices") return Promise.resolve(opts.invoices ?? []);
    const m = path.match(/^\/purchase-orders\/1\/line-groups\/(\d+)\/units\?status=(\w+)$/);
    if (m) return Promise.resolve(units.filter((u) => (u.line_no ?? 1) === Number(m[1]) && u.status === UNIT_STATUS[m[2]]));
    if (path === "/items") {
      return Promise.resolve([{
        id: 21, name: "Laptop", category_id: 1, subcategory_id: 2, serial_required: true, bundle_id: null,
        default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0,
      }]);
    }
    if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, name: "IT Equipment", asset_domain: "IT" }]);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, name: "Laptop", category_id: 1 }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, name: "Head Office" }]);
    if (path.startsWith("/masters/brands")) return Promise.resolve([{ id: 9, name: "Dell" }]);
    // Received Into lists the PO company's stock rooms (S3b-1: GET /stock-rooms).
    if (path.startsWith("/stock-rooms?company_id=")) return Promise.resolve([{ id: 5, name: "IT Stock-HO" }]);
    if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 5, name: "IT Stock-HO" }]);
    return Promise.resolve([]);
  });
}

const linesTable = () => screen.getByRole("table", { name: "Purchase order lines" });
const lineRows = () => within(linesTable()).getAllByRole("row", { name: /^Line \d+:/ });
const unitCalls = () => (apiClient.get as any).mock.calls.filter(([p]: [string]) => /\/line-groups\/\d+\/units/.test(p));
const allUnitsCalls = () => (apiClient.get as any).mock.calls.filter(([p]: [string]) => p === "/purchase-orders/1/lines");

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("PurchaseOrderDetail: lines, not units (S2)", () => {
  it("renders the PO header and one row per line with Ordered / Received / Waiting and a plain-word status", async () => {
    mockGets([PENDING_LINE], {
      groups: [group({ item_id: 21, item_name: "Laptop", description: "Dell Latitude 5440", ordered: 3, waiting: 3, line_value: 3540 })],
    });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText(/PO-2026-001/)).toBeInTheDocument());
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    const row = lineRows()[0];
    expect(row).toHaveAccessibleName("Line 1: Laptop");
    expect(within(row).getByText("Laptop")).toBeInTheDocument();
    expect(within(row).getByText(/Dell Latitude 5440 · Has serial number/)).toBeInTheDocument();
    expect(within(row).getByText("IT Team")).toBeInTheDocument();
    expect(within(row).getByText("Waiting")).toBeInTheDocument();
    expect(within(row).getByText("3,540.00")).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/WAITING|HAS_SERIAL|\bIT\b(?! Team)/);
    await waitFor(() => expect(screen.getByText(/Head Office/)).toBeInTheDocument());
  });

  it("a 3-line PO with 104 waiting units shows 3 rows, no unit rows, and loads no unit list until asked", async () => {
    const units: Unit[] = [];
    let id = 1000;
    for (const [line, n, desc] of [[1, 50, "Indoor Camera"], [2, 50, "Gang Box PVC"], [3, 4, "Netgear WAX610"]] as const) {
      for (let i = 0; i < n; i++) units.push({ ...PENDING_LINE, id: id++, line_no: line, description: desc, barcode: `BC-${line}` });
    }
    mockGets(units, {
      groups: [
        group({ line_no: 1, description: "Indoor Camera", ordered: 50, waiting: 50, line_value: 50 * 3410 }),
        group({ line_no: 2, description: "Gang Box PVC", ordered: 50, waiting: 50, serial_mode: "NO_SERIAL", line_value: 50 * 53 }),
        group({ line_no: 3, description: "Netgear WAX610", ordered: 4, waiting: 4, serial_mode: "SERIAL_LATER", line_value: 4 * 19234 }),
      ],
    });
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(3));
    expect(within(linesTable()).getAllByRole("row")).toHaveLength(4); // header + 3 lines, nothing else
    expect(screen.queryByRole("table", { name: /units of line/i })).not.toBeInTheDocument();
    expect(screen.queryAllByText("Indoor Camera")).toHaveLength(1);
    expect(screen.getByText(/No serial number/)).toBeInTheDocument();
    expect(screen.getByText(/Serial will be entered later/)).toBeInTheDocument();
    expect(screen.getByText("Lines").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Ordered units").nextSibling).toHaveTextContent("104");
    expect(screen.getByText("Waiting units").nextSibling).toHaveTextContent("104");
    expect(screen.getByText("Received units").nextSibling).toHaveTextContent("0");
    expect(screen.getByRole("button", { name: "Receive all waiting (104)" })).toBeInTheDocument();
    expect(unitCalls()).toHaveLength(0);
    // S4: the page no longer loads every unit (the invoices card has its own small request).
    expect(allUnitsCalls()).toHaveLength(0);
    expect(apiClient.get).toHaveBeenCalledWith("/purchase-orders/1/invoices");
  });

  it("partly received, fully received and cancelled lines show their counts and status in words, with only the actions that apply", async () => {
    mockGets([], {
      groups: [
        group({ line_no: 1, description: "Dell Laptop", ordered: 5, received: 2, waiting: 3, status: "PARTLY_RECEIVED" }),
        group({ line_no: 2, description: "HP Printer", ordered: 2, received: 2, waiting: 0, status: "RECEIVED" }),
        group({ line_no: 3, description: "Old Chair", ordered: 0, received: 0, waiting: 0, cancelled: 4, status: "CANCELLED" }),
      ],
    });
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(3));
    const [partly, done, cancelled] = lineRows();
    expect(within(partly).getByText("Partly Received")).toBeInTheDocument();
    expect(within(partly).getAllByRole("cell").slice(2, 5).map((c) => c.textContent)).toEqual(["5", "2", "3"]);
    expect(within(partly).getByRole("button", { name: /receive line 1/i })).toBeInTheDocument();
    expect(within(partly).getByRole("button", { name: /cancel waiting on line 1/i })).toBeInTheDocument();
    expect(within(done).getByText("Received")).toBeInTheDocument();
    expect(within(done).queryByRole("button", { name: /^receive/i })).not.toBeInTheDocument();
    expect(within(done).queryByRole("button", { name: /cancel waiting/i })).not.toBeInTheDocument();
    expect(within(cancelled).getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Received units").nextSibling).toHaveTextContent("4");
    expect(screen.getByText("Waiting units").nextSibling).toHaveTextContent("3");
  });

  it("Receive on a line opens the Receive screen for this PO with only that line (?line=N), loading no units", async () => {
    const line1 = [PENDING_LINE, { ...PENDING_LINE, id: 13 }];
    const line2 = [20, 21, 22].map((id) => ({ ...PENDING_LINE, id, line_no: 2, description: "Logitech Mouse" }));
    mockGets([...line1, ...line2]);
    const router = renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /receive line 2/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/receive/1"));
    expect(router.state.location.search).toEqual({ line: 2 });
    expect(unitCalls()).toHaveLength(0);
    expect(allUnitsCalls()).toHaveLength(0);
    // The old tick-rows dialog is gone.
    expect(screen.queryByRole("dialog", { name: /receive \d+ units?/i })).not.toBeInTheDocument();
  });

  it("Receive all waiting (header) opens the Receive screen for the whole PO", async () => {
    mockGets([PENDING_LINE, PENDING_LINE_2, DELIVERED_LINE]);
    const router = renderDetailAt();
    const all = await screen.findByRole("button", { name: "Receive all waiting (2)" });
    await waitFor(() => expect(all).not.toBeDisabled());
    fireEvent.click(all);
    await waitFor(() => expect(router.state.location.pathname).toBe("/receive/1"));
    expect(router.state.location.search).toEqual({});
    expect(allUnitsCalls()).toHaveLength(0);
  });

  it("a PO with nothing waiting cannot be received", async () => {
    mockGets([DELIVERED_LINE]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    expect(screen.getByRole("button", { name: /receive all waiting/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /cancel waiting items/i })).not.toBeInTheDocument();
  });

});

describe("PurchaseOrderDetail: editing a line (S2)", () => {
  const LINE = group({
    item_id: 21, item_name: "Laptop", description: "Dell Laptop", ordered: 5, received: 2, waiting: 3,
    status: "PARTLY_RECEIVED", brand_id: 9, model: "5440", warranty_years: 1,
  });

  async function openLineEdit(line = LINE) {
    mockGets([], { groups: [line] });
    (apiClient.put as any).mockResolvedValue({ ...line, ordered: 6, waiting: 4 });
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /edit line 1/i }));
    return screen.getByRole("dialog");
  }

  it("opens pre-filled from the line and sends only what changed, including the new Ordered quantity", async () => {
    const dialog = await openLineEdit();
    expect(within(dialog).getByLabelText(/^description/i)).toHaveValue("Dell Laptop");
    expect(within(dialog).getByLabelText(/^ordered/i)).toHaveValue(5);
    expect(within(dialog).getByLabelText(/^cost/i)).toHaveValue(1000);
    expect(within(dialog).getByText(/2 received \+ 3 waiting/)).toBeInTheDocument();

    const save = within(dialog).getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled(); // nothing changed yet
    fireEvent.change(within(dialog).getByLabelText(/^description/i), { target: { value: "Dell Laptop 14in" } });
    fireEvent.change(within(dialog).getByLabelText(/^cost/i), { target: { value: "950" } });
    fireEvent.change(within(dialog).getByLabelText(/^ordered/i), { target: { value: "6" } });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/1/line-groups/1", { description: "Dell Laptop 14in", purchase_cost: 950, quantity: 6 }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Line 1 saved: 6 ordered, 2 received, 4 waiting.");
  });

  it("refuses an Ordered quantity below what was received, or above 1,000, before asking the server", async () => {
    const dialog = await openLineEdit();
    const qty = within(dialog).getByLabelText(/^ordered/i);
    const save = within(dialog).getByRole("button", { name: /^save$/i });
    fireEvent.change(qty, { target: { value: "1" } });
    expect(await within(dialog).findByText("2 of this line have already been received, so the quantity cannot be less than 2.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(qty, { target: { value: "1001" } });
    expect(await within(dialog).findByText("At most 1,000.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(qty, { target: { value: "2" } });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/1/line-groups/1", { quantity: 2 }));
    expect(apiClient.put).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal inside the dialog", async () => {
    const dialog = await openLineEdit();
    (apiClient.put as any).mockRejectedValue(new Error("This Item is no longer active; choose another."));
    fireEvent.change(within(dialog).getByLabelText(/^model/i), { target: { value: "5450" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This Item is no longer active; choose another.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("an old line without a barcode can still have only its quantity changed; a cleared Cost blocks Save", async () => {
    const dialog = await openLineEdit(group({ barcode: null, ordered: 3, waiting: 3 }));
    const save = within(dialog).getByRole("button", { name: /^save$/i });
    fireEvent.change(within(dialog).getByLabelText(/^cost/i), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText(/^ordered/i), { target: { value: "4" } });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^cost/i), { target: { value: "1000" } });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/1/line-groups/1", { quantity: 4 }));
  });

  it("a line with nothing waiting can only have its Ordered quantity raised", async () => {
    const dialog = await openLineEdit(group({ ordered: 2, received: 2, waiting: 0, status: "RECEIVED" }));
    expect(within(dialog).getByText(/only the ordered quantity can be raised/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^description/i)).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^ordered/i), { target: { value: "3" } });
    await waitFor(() => expect(within(dialog).getByLabelText(/^description/i)).not.toBeDisabled());
  });
});

describe("PurchaseOrderDetail: cancelling waiting items and deleting (S2)", () => {
  const LINE = group({ ordered: 5, received: 1, waiting: 4, status: "PARTLY_RECEIVED" });

  it("Cancel waiting on a line: a number (default all waiting), says received items are not affected, and sends it", async () => {
    mockGets([], { groups: [LINE] });
    (apiClient.post as any).mockResolvedValue({ ...LINE, waiting: 2 });
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /cancel waiting on line 1/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/received are not affected|already received are not affected/i)).toBeInTheDocument();
    const qty = within(dialog).getByLabelText(/how many to cancel/i);
    expect(qty).toHaveValue(4);
    fireEvent.change(qty, { target: { value: "5" } });
    expect(await within(dialog).findByText("Only 4 are waiting.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /cancel these units/i })).toBeDisabled();
    fireEvent.change(qty, { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel these units/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/line-groups/1/cancel-waiting", { quantity: 2 }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("2 waiting units of line 1 cancelled.");
  });

  it("Cancel waiting on a line: keeping the default cancels all of them; a refusal is shown as the server worded it", async () => {
    mockGets([], { groups: [LINE] });
    (apiClient.post as any).mockRejectedValueOnce(new Error("Only 3 of this line are still waiting."));
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /cancel waiting on line 1/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel these units/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/line-groups/1/cancel-waiting", { quantity: 4 }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Only 3 of this line are still waiting.");
  });

  it("Cancel waiting items (header) confirms, cancels every waiting unit of the PO and keeps the received ones", async () => {
    mockGets([], { groups: [LINE, group({ line_no: 2, description: "Mouse", ordered: 3, waiting: 3 })] });
    (apiClient.post as any).mockResolvedValue({ cancelled_units: 7, status: "RECEIVED" });
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Cancel waiting items" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("All 7 waiting units on this purchase order will be cancelled. The purchase order stays.");
    expect(dialog).toHaveTextContent(/not affected/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel waiting items" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/cancel-waiting"));
    expect(await screen.findByRole("status")).toHaveTextContent("7 waiting units cancelled. Received items stay as they are.");
  });

  it("Delete PO is offered (quietly) only when nothing has been received", async () => {
    mockGets([PENDING_LINE]);
    renderDetailAt();
    const del = await screen.findByRole("button", { name: "Delete PO" });
    expect(del.className).not.toMatch(/bg-destructive/);
    fireEvent.click(del);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("1 waiting unit on 1 line will be cancelled.");
    expect(dialog).toHaveTextContent("no assets are affected");
    (apiClient.delete as any).mockResolvedValue({ cancelled_lines: 1, deleted_assets: 0 });
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/purchase-orders/1"));
  });

  it("Delete PO is not offered once anything was received", async () => {
    mockGets([PENDING_LINE, DELIVERED_LINE]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Delete PO" })).not.toBeInTheDocument();
  });

  it("a 409 on delete (something was received meanwhile) shows the server's sentence and offers to cancel the waiting items", async () => {
    mockGets([PENDING_LINE]);
    const sentence = "This purchase order already has received items, so it cannot be deleted; its received assets must stay in the register. Cancel the waiting items instead.";
    (apiClient.delete as any).mockRejectedValue(Object.assign(new Error(sentence), { status: 409 }));
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: "Delete PO" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^delete$/i }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(sentence);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /cancel waiting items instead/i }));
    expect(await screen.findByRole("dialog", { name: /cancel the waiting items/i })).toBeInTheDocument();
  });
});

describe("PurchaseOrderDetail: a line's units (View units)", () => {
  it("loads a line's units only when opened, by status, with the per-unit detail and actions", async () => {
    const received = { ...PENDING_LINE, id: 11, status: "DELIVERED", serial_number: "SN-999", invoice_number: "INV-777", delivered_asset_id: 99 };
    mockGets([PENDING_LINE, received]);
    (apiClient.put as any).mockResolvedValue(PENDING_LINE);
    (apiClient.post as any).mockResolvedValue({ ...PENDING_LINE, status: "CANCELLED" });
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    expect(unitCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /view units of line 1/i }));
    const units = await screen.findByRole("table", { name: /units of line 1/i });
    expect(apiClient.get).toHaveBeenCalledWith("/purchase-orders/1/line-groups/1/units?status=WAITING");
    expect(within(units).getByText("BC-777")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waiting (1)" })).toHaveAttribute("aria-pressed", "true");

    // Per-unit Edit (as before) and Cancel stay available for waiting units.
    fireEvent.click(within(units).getByRole("button", { name: "Edit unit 10" }));
    const dialog = screen.getByRole("dialog", { name: "Edit unit" });
    fireEvent.change(within(dialog).getByLabelText(/^description/i), { target: { value: "Dell Laptop Pro" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/lines/10", expect.objectContaining({ description: "Dell Laptop Pro", category_id: 1 })),
    );
    fireEvent.click(within(units).getByRole("button", { name: "Cancel unit 10" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/lines/10/cancel"));

    fireEvent.click(screen.getByRole("button", { name: "Received (1)" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/purchase-orders/1/line-groups/1/units?status=RECEIVED"));
    const receivedTable = await screen.findByRole("table", { name: /units of line 1/i });
    await waitFor(() => expect(within(receivedTable).getByText("SN-999")).toBeInTheDocument());
    expect(within(receivedTable).getByText("INV-777")).toBeInTheDocument();
    expect(within(receivedTable).getByRole("link", { name: "Open asset" })).toHaveAttribute("href", "/assets/99");
    expect(within(receivedTable).queryByRole("button", { name: /edit unit|cancel unit/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /hide units of line 1/i }));
    await waitFor(() => expect(screen.queryByRole("table", { name: /units of line 1/i })).not.toBeInTheDocument());
  });
});

describe("PurchaseOrderDetail: adding lines and sets", () => {
  it("posts an Add Line request including a shared Barcode, once every mandatory field is filled, then says lines and units", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue([10, 11, 12].map((id) => ({ ...PENDING_LINE, id, line_no: 4 })));
    renderDetailAt();
    // AM-14: Add Line is collapsed by default -- reveal it first.
    await waitFor(() => expect(screen.getByRole("button", { name: /\+ add line/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ add line/i }));
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Laptop" } });
    fireEvent.change(screen.getByLabelText(/^barcode\*?$/i), { target: { value: "BC-BATCH-9" } });

    // The Item alone isn't enough -- Cost/Quantity are also mandatory.
    expect(screen.getByRole("button", { name: /^add line$/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/^item\*?$/i));
    fireEvent.click(await screen.findByRole("option", { name: /^Laptop ?· IT Equipment$/ }));
    expect(screen.getByText(/IT Equipment › Laptop/)).toBeInTheDocument();      // the Item decides the Category and Sub-Category
    fireEvent.change(screen.getByLabelText(/^cost\*?$/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/^quantity\*?$/i), { target: { value: "3" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /^add line$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^add line$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/lines",
        expect.objectContaining({ description: "Dell Laptop", barcode: "BC-BATCH-9", item_id: 21, purchase_cost: 1000, quantity: 3 }),
      ),
    );
    // Never "3 lines added": one line holding 3 units.
    expect(await screen.findByRole("status")).toHaveTextContent("Line added: 1 line, 3 units waiting.");
  });

  it("S0: Add Line quantity is 1 to 1,000 -- hint shown, a bad value blocks Add Line with a sentence", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByRole("button", { name: /\+ add line/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ add line/i }));
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Laptop" } });
    fireEvent.change(screen.getByLabelText(/^barcode\*?$/i), { target: { value: "BC-1" } });
    fireEvent.click(screen.getByLabelText(/^item\*?$/i));
    fireEvent.click(await screen.findByRole("option", { name: /^Laptop ?· IT Equipment$/ }));
    fireEvent.change(screen.getByLabelText(/^cost\*?$/i), { target: { value: "1000" } });

    const qty = screen.getByLabelText(/^quantity\*?$/i);
    expect(qty).toHaveAttribute("max", "1000");
    expect(screen.getByText("Whole number, 1 to 1,000.")).toBeInTheDocument();
    const add = screen.getByRole("button", { name: /^add line$/i });
    await waitFor(() => expect(add).not.toBeDisabled());

    for (const [value, sentence] of [["0", "Enter at least 1."], ["1001", "At most 1,000 at a time."], ["15000000000", "At most 1,000 at a time."], ["2.5", "Enter a whole number."], ["", "Enter how many (1 to 1,000)."]] as const) {
      fireEvent.change(qty, { target: { value } });
      expect(await screen.findByText(sentence)).toBeInTheDocument();
      expect(add).toBeDisabled();
    }
    expect(apiClient.post).not.toHaveBeenCalled();

    fireEvent.change(qty, { target: { value: "1000" } });
    await waitFor(() => expect(add).not.toBeDisabled());
    fireEvent.click(add);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/lines", expect.objectContaining({ quantity: 1000 })),
    );
  });

  it("S0: the server's refusal of a line (readable sentence) is shown under the form", async () => {
    mockGets([]);
    (apiClient.post as any).mockRejectedValue(new Error("Quantity must be at least 1. Cost cannot be negative."));
    renderDetailAt();
    await waitFor(() => expect(screen.getByRole("button", { name: /\+ add line/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ add line/i }));
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Laptop" } });
    fireEvent.change(screen.getByLabelText(/^barcode\*?$/i), { target: { value: "BC-1" } });
    fireEvent.click(screen.getByLabelText(/^item\*?$/i));
    fireEvent.click(await screen.findByRole("option", { name: /^Laptop ?· IT Equipment$/ }));
    fireEvent.change(screen.getByLabelText(/^cost\*?$/i), { target: { value: "1000" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /^add line$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^add line$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Quantity must be at least 1. Cost cannot be negative.");
  });

  it("posts an Add Line request with the selected Brand's id, not free text", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByRole("button", { name: /\+ add line/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ add line/i }));
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Laptop" } });
    fireEvent.change(screen.getByLabelText(/^barcode\*?$/i), { target: { value: "BC-BATCH-9" } });

    fireEvent.click(screen.getByLabelText(/^item\*?$/i));
    fireEvent.click(await screen.findByRole("option", { name: /^Laptop ?· IT Equipment$/ }));
    fireEvent.change(screen.getByLabelText(/^cost\*?$/i), { target: { value: "1000" } });

    fireEvent.click(screen.getByLabelText(/^brand$/i));
    fireEvent.click(await screen.findByText("Dell"));

    await waitFor(() => expect(screen.getByRole("button", { name: /^add line$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^add line$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/lines", expect.objectContaining({ brand_id: 9 })),
    );
  });

  it("picking an Item shows its Work area in plain words, never Responsibility or a raw code", async () => {
    mockGets([]);
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: /\+ add line/i }));
    fireEvent.click(await screen.findByLabelText(/^item\*?$/i));
    fireEvent.click(await screen.findByRole("option", { name: /^Laptop ?· IT Equipment$/ }));
    expect(await screen.findByLabelText("Work area")).toHaveValue("IT Team");
    expect(screen.queryByText(/responsibility/i)).not.toBeInTheDocument();
  });

  it("Add Set opens the set dialog", async () => {
    mockGets([]);
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: "+ Add Set" }));
    expect(await screen.findByRole("dialog", { name: "Add Set" })).toBeInTheDocument();
  });
});

// The old Mark Delivery Done dialog's behaviour (invoice once, received into, serial lists, N/A,
// serial later, duplicates, check-serials, partial receipt, sets, labels, server errors) is now the
// Receive screen's: see features/receive/ReceiveScreen.test.tsx.

describe("PurchaseOrderDetail: invoices received and their Purchase Invoice (PI)", () => {
  const INVOICE = {
    invoice_number: "INV-777", invoice_date: "2026-02-01", invoice_amount: 2360, units: 2, asset_ids: [99, 98],
    asset_count: 2, asset_ids_truncated: false, pi_number: null, pi_date: null, pi_status: "PENDING",
  };
  const RECORDED = { ...INVOICE, invoice_number: "INV-778", invoice_date: "2026-02-05", units: 1, asset_ids: [97], pi_number: "PI-9", pi_date: "2026-03-05", pi_status: "RECORDED" };
  const invoicesCard = () => screen.getByRole("region", { name: "Invoices received" });

  it("lists each invoice from GET /invoices (no., date, amount, units, PI) without loading any unit", async () => {
    mockGets([PENDING_LINE], { invoices: [INVOICE, RECORDED] });
    renderDetailAt();
    expect(await screen.findByText("INV-777")).toBeInTheDocument();
    const card = invoicesCard();
    expect(card).toHaveTextContent("Invoices received (2)");
    const rows = within(within(card).getByRole("list", { name: "Invoices" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/INV-777.*2026-02-01.*2,360\.00.*2 units.*PI pending/);
    expect(rows[1]).toHaveTextContent(/INV-778.*1 unit.*PI PI-9 · 2026-03-05/);
    expect(apiClient.get).toHaveBeenCalledWith("/purchase-orders/1/invoices");
    expect(allUnitsCalls()).toHaveLength(0);
    // PI is spelled out once on the screen.
    expect(screen.getAllByText(/Purchase Invoice \(PI\)/)).toHaveLength(1);
    // ONE entry point for the PI.
    expect(within(card).getAllByRole("button", { name: /PI/ })).toHaveLength(1);
  });

  it("no invoices yet: no card", async () => {
    mockGets([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/purchase-orders/1/invoices"));
    expect(screen.queryByRole("region", { name: "Invoices received" })).not.toBeInTheDocument();
  });

  it("offers the labels of every received unit (the invoices' asset ids)", async () => {
    mockGets([DELIVERED_LINE], { invoices: [INVOICE, RECORDED] });
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: /print labels for the received units/i }));
    expect(await screen.findByRole("dialog", { name: /print 3 labels/i })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/assets?ids=99%2C98%2C97&limit=1000"));
  });

  it("a PO created from the ERP: the one Record PI dialog starts on Fetch from ERP, and can switch to typing it in", async () => {
    mockGets([DELIVERED_LINE], { po: { ...PO, erp_po_code: 1133610106 }, invoices: [INVOICE] });
    const base = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation((path: string) =>
      path === "/erp/purchase-orders/1/pi"
        ? Promise.resolve({ po_id: 1, po_number: "PO-2026-001", rows: [], not_booked: 0, ckam_invoices: ["INV-777"], delivered_assets: 2 })
        : base(path));
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: "Record PI" }));
    const dialog = await screen.findByRole("dialog", { name: "Record PI" });
    expect(within(dialog).getByRole("radio", { name: "Fetch from ERP" })).toHaveAttribute("aria-checked", "true");
    expect(await within(dialog).findByText(/The ERP has no PI for this purchase order yet/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/erp/purchase-orders/1/pi");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Type it in" }));
    expect(within(dialog).getByLabelText("PI Number")).toBeInTheDocument();
    // No separate "Fetch PI from ERP" button any more: one entry point.
    expect(screen.queryByRole("button", { name: "Fetch PI from ERP" })).not.toBeInTheDocument();
  });

  it("a PO made by hand: Record PI types it in (no ERP choice)", async () => {
    mockGets([DELIVERED_LINE], { invoices: [INVOICE] });
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: "Record PI" }));
    const dialog = await screen.findByRole("dialog", { name: "Record PI" });
    expect(within(dialog).queryByRole("radio", { name: "Fetch from ERP" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("PI Number")).toBeInTheDocument();
  });

  it("AM-19: Record PI for the chosen invoice posts to record-pi and shows the result", async () => {
    mockGets([DELIVERED_LINE], { invoices: [RECORDED, INVOICE] });
    (apiClient.post as any).mockResolvedValue({ invoice_number: "INV-777", updated: ["FA/1", "FA/2"], skipped: [] });
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: "Record PI" }));
    const dialog = await screen.findByRole("dialog", { name: "Record PI" });
    // The invoice still waiting for its PI is chosen first; existing PIs are shown.
    expect(within(dialog).getByRole("radio", { name: "Invoice INV-777" })).toBeChecked();
    expect(within(dialog).getByText(/PI PI-9 · 2026-03-05/)).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/pi number/i), { target: { value: "PI-2001" } });
    fireEvent.change(within(dialog).getByLabelText(/pi date/i), { target: { value: "2026-02-15" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/record-pi", {
        invoice_number: "INV-777", pi_number: "PI-2001", pi_date: "2026-02-15", overwrite: false,
      }),
    );
    expect(await within(dialog).findByText(/PI recorded for invoice INV-777: 2 assets updated/)).toBeInTheDocument();
  });

  it("AM-19: another invoice can be chosen, and Overwrite existing values is sent through", async () => {
    mockGets([DELIVERED_LINE], { invoices: [INVOICE, RECORDED] });
    (apiClient.post as any).mockResolvedValue({ invoice_number: "INV-778", updated: [], skipped: ["FA/3"] });
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: "Record PI" }));
    const dialog = await screen.findByRole("dialog", { name: "Record PI" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Invoice INV-778" }));
    fireEvent.change(within(dialog).getByLabelText(/pi number/i), { target: { value: "PI-CORRECTED" } });
    fireEvent.change(within(dialog).getByLabelText(/pi date/i), { target: { value: "2026-02-15" } });
    fireEvent.click(within(dialog).getByLabelText(/overwrite existing values/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/record-pi", expect.objectContaining({ invoice_number: "INV-778", overwrite: true })),
    );
    expect(await within(dialog).findByText(/1 asset already had a PI/)).toBeInTheDocument();
  });

  it("a refused PI shows the server's sentence and keeps the dialog open", async () => {
    mockGets([DELIVERED_LINE], { invoices: [INVOICE] });
    (apiClient.post as any).mockRejectedValue(new Error("PI date cannot be in the future."));
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: "Record PI" }));
    const dialog = await screen.findByRole("dialog", { name: "Record PI" });
    fireEvent.change(within(dialog).getByLabelText(/pi number/i), { target: { value: "PI-1" } });
    fireEvent.change(within(dialog).getByLabelText(/pi date/i), { target: { value: "2099-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("PI date cannot be in the future.");
  });

  it("a received unit links to its asset by code (delivered_asset_code)", async () => {
    const received = { ...PENDING_LINE, id: 11, status: "DELIVERED", serial_number: "SN-1", invoice_number: "INV-777", delivered_asset_id: 99, delivered_asset_code: "FA/CKSPL/IT/0099" };
    mockGets([received]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /view units of line 1/i }));
    const table = await screen.findByRole("table", { name: /units of line 1/i });
    expect(await within(table).findByRole("link", { name: "FA/CKSPL/IT/0099" })).toHaveAttribute("href", "/assets/99");
  });

  it("Close navigates back to the Purchase Orders list", async () => {
    mockGets([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    fireEvent.click(screen.getByRole("link", { name: /^close$/i }));
    await waitFor(() => expect(screen.getByRole("link", { name: /new purchase order/i })).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// S3b-1: Item / Brand on Add Line and Edit line, and the Received Into stock
// room, can be added right here by whoever the capabilities allow.
// ---------------------------------------------------------------------------
describe("S3b-1: inline creation on the PO page", () => {
  function withCaps(caps: Capabilities | null) {
    const base = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation(withCapabilities(caps, base));
  }

  async function offered(label: RegExp, entry: RegExp, scope: HTMLElement = document.body): Promise<boolean> {
    const trigger = within(scope).getByLabelText(label);
    fireEvent.click(trigger);
    await screen.findAllByRole("option");
    const found = screen.queryByRole("option", { name: entry }) !== null;
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument());
    return found;
  }

  const settle = async () => {
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
  };

  beforeEach(() => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5 });
  });

  it.each(KINDS)("%s: Add Line offers New Item / New Brand as the capabilities say", async (_kind, caps) => {
    mockGets([]);
    withCaps(caps);
    renderDetailAt();
    fireEvent.click(await screen.findByRole("button", { name: /\+ add line/i }));
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());
    await settle();
    expect(await offered(/^item\*?$/i, /new item/i)).toBe(caps.can_create.item === true);
    expect(await offered(/^brand$/i, /new brand/i)).toBe(caps.can_create.brand === true);
  });

  it.each(KINDS)("%s: Edit line offers New Item / New Brand as the capabilities say", async (_kind, caps) => {
    mockGets([], { groups: [group({ item_id: 21, item_name: "Laptop", ordered: 2, waiting: 2 })] });
    withCaps(caps);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /edit line 1/i }));
    const dialog = screen.getByRole("dialog");
    await settle();
    expect(await offered(/^item$/i, /new item/i, dialog)).toBe(caps.can_create.item === true);
    expect(await offered(/^brand$/i, /new brand/i, dialog)).toBe(caps.can_create.brand === true);
  });

  // Received Into (stock rooms, + New Stock Room, remembered choice) now lives on the Receive
  // screen: see features/receive/ReceiveScreen.test.tsx.
});

describe("S6: Edit details of a PO (PUT /purchase-orders/{id})", () => {
  function mockWithVendors(units: Unit[], po: unknown = PO) {
    mockGets(units, { po });
    const base = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/masters/vendors") return Promise.resolve([{ id: 31, name: "Blue Star", gstin: null }, { id: 32, name: "Acme Traders", gstin: null }]);
      if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, code: "HO", name: "Head Office" }, { id: 4, code: "WH", name: "Warehouse" }]);
      return base(path);
    });
    (apiClient.put as any).mockResolvedValue(po);
  }

  async function openEdit() {
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    return screen.findByRole("dialog", { name: /edit details of/i });
  }

  async function choose(dialog: HTMLElement, label: string, option: string | RegExp) {
    const box = within(dialog).getByRole("combobox", { name: label });
    fireEvent.click(box);
    fireEvent.click(await screen.findByRole("option", { name: option }));
    await waitFor(() => expect(box).toHaveAttribute("aria-expanded", "false"));
  }

  it("sends ONLY the changed fields, then says it was saved", async () => {
    mockWithVendors([PENDING_LINE]);
    renderDetailAt();
    const dialog = await openEdit();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();          // nothing changed yet
    fireEvent.change(within(dialog).getByLabelText(/po number/i), { target: { value: "PO-2026-001A" } });
    await choose(dialog, "Vendor", /^Acme Traders/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/1", { vendor_id: 32, po_number: "PO-2026-001A" }));
    expect(await screen.findByText("PO details saved.")).toBeInTheDocument();
  });

  it("after a receipt only the delivery place can change: the rest is disabled with the reason", async () => {
    mockWithVendors([PENDING_LINE, DELIVERED_LINE], { ...PO, vendor_id: 31 });
    renderDetailAt();
    const dialog = await openEdit();
    expect(within(dialog).getByLabelText(/po number/i)).toBeDisabled();
    expect(within(dialog).getByLabelText(/po date/i)).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Vendor" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Cost Centre" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Delivery place" })).toBeEnabled();
    expect(dialog).toHaveTextContent("Goods have already been received on this purchase order, so this can no longer be changed");
    await choose(dialog, "Delivery place", /IT Stock-HO/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/1", { delivery_asset_user_id: 5 }));
  });

  it("an ERP-made PO keeps the ERP's number, date and vendor (disabled, with why); cost centre stays editable", async () => {
    mockWithVendors([PENDING_LINE], { ...PO, erp_po_code: 556677, vendor_id: 31 });
    renderDetailAt();
    const dialog = await openEdit();
    expect(within(dialog).getByLabelText(/po number/i)).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Vendor" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Cost Centre" })).toBeEnabled();
    expect(dialog).toHaveTextContent("made from the ERP, so its PO number and date are the ERP's");
    expect(dialog).toHaveTextContent("its vendor follows the ERP supplier");
    await choose(dialog, "Cost Centre", /Warehouse/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/1", { cost_center_id: 4 }));
  });

  it("a refusal is shown word for word and the dialog stays open", async () => {
    mockWithVendors([PENDING_LINE]);
    const sentence = "Purchase order PO-B already exists for this company.";
    (apiClient.put as any).mockRejectedValue(new Error(sentence));
    renderDetailAt();
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByLabelText(/po number/i), { target: { value: "PO-B" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(sentence);
    expect(screen.getByRole("dialog", { name: /edit details of/i })).toBeInTheDocument();
  });
});
