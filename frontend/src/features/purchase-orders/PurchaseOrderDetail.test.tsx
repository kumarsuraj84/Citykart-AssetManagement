import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { KINDS, OPERATOR_IT, VIEWER, withCapabilities } from "../../test-capabilities";

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

function mockGets(units: Unit[], opts: { po?: unknown; groups?: unknown[] } = {}) {
  const groups = opts.groups ?? groupsFrom(units);
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/purchase-orders/1") return Promise.resolve(opts.po ?? PO);
    if (path === "/purchase-orders/1/line-groups") return Promise.resolve(groups);
    if (path === "/purchase-orders/1/lines") return Promise.resolve(units);
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
const deliverCall = () => (apiClient.post as any).mock.calls.find(([p]: [string]) => p === "/purchase-orders/1/deliver");

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

  it("Receive on a line feeds the delivery dialog with exactly that line's waiting units", async () => {
    const line1 = [PENDING_LINE, { ...PENDING_LINE, id: 13 }];
    const line2 = [20, 21, 22].map((id) => ({ ...PENDING_LINE, id, line_no: 2, description: "Logitech Mouse" }));
    const done = { ...PENDING_LINE, id: 23, line_no: 2, description: "Logitech Mouse", status: "DELIVERED", serial_number: "M0", delivered_asset_id: 70 };
    mockGets([...line1, ...line2, done]);
    (apiClient.post as any).mockResolvedValue([]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /receive line 2/i }));
    const dialog = await screen.findByRole("dialog", { name: "Receive 3 units" });
    expect(apiClient.get).toHaveBeenCalledWith("/purchase-orders/1/line-groups/2/units?status=WAITING");
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-2" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "300" } });
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));
    fireEvent.change(within(dialog).getByLabelText(/^serial numbers\*?$/i), { target: { value: "M1\nM2\nM3" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /confirm/i })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(deliverCall()).toBeTruthy());
    const ids = deliverCall()[1].lines.map((l: { pending_asset_id: number }) => l.pending_asset_id);
    expect(ids).toEqual([20, 21, 22]);
  });

  it("Receive all waiting (header) opens the dialog with every waiting unit of every line", async () => {
    mockGets([PENDING_LINE, PENDING_LINE_2, DELIVERED_LINE]);
    renderDetailAt();
    const all = await screen.findByRole("button", { name: "Receive all waiting (2)" });
    await waitFor(() => expect(all).not.toBeDisabled());
    fireEvent.click(all);
    const dialog = await screen.findByRole("dialog", { name: "Receive 2 units" });
    expect(apiClient.get).toHaveBeenCalledWith("/purchase-orders/1/lines");
    expect(within(dialog).getAllByLabelText(/^serial number\*?$/i)).toHaveLength(2);
  });

  it("a PO with nothing waiting cannot be received", async () => {
    mockGets([DELIVERED_LINE]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    expect(screen.getByRole("button", { name: /receive all waiting/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /cancel waiting items/i })).not.toBeInTheDocument();
  });

  it("shows the server's sentence when a line's waiting units cannot be loaded", async () => {
    mockGets([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(1));
    const realGet = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation((path: string) =>
      path.includes("/units?") ? Promise.reject(new Error("This PO line was not found.")) : realGet(path),
    );
    fireEvent.click(screen.getByRole("button", { name: /receive line 1/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This PO line was not found.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

// --- The delivery dialog itself is unchanged; it is now fed a line's (or the PO's) waiting units. ---
describe("PurchaseOrderDetail: the Receive (Mark Delivery Done) dialog", () => {
  async function receiveLine(units: Unit[], lineNo = 1, opts: { po?: unknown } = {}) {
    mockGets(units, opts);
    renderDetailAt();
    await waitFor(() => expect(lineRows().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`receive line ${lineNo}\\b`, "i") }));
    return screen.findByRole("dialog");
  }

  async function openDeliveryFor(pending: Unit[]) {
    mockGets(pending);
    (apiClient.post as any).mockResolvedValue([]);
    renderDetailAt();
    const all = await screen.findByRole("button", { name: /receive all waiting/i });
    await waitFor(() => expect(all).not.toBeDisabled());
    fireEvent.click(all);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-9" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "900" } });
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));
    return dialog;
  }
  const confirmBtn = (d: HTMLElement) => within(d).getByRole("button", { name: /confirm/i });
  const LAPTOP_2 = { ...PENDING_LINE, id: 13 };
  const LAPTOP_3 = { ...PENDING_LINE, id: 14 };

  it("receiving one unit submits the same payload as before", async () => {
    (apiClient.post as any).mockResolvedValue([{ ...PENDING_LINE, status: "DELIVERED" }]);
    const dialog = await receiveLine([PENDING_LINE]);
    expect(dialog).toHaveAccessibleName("Receive 1 unit");
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.change(within(dialog).getByLabelText(/^serial number\*?$/i), { target: { value: "SN-001" } });
    // Radix Select isn't a native <select>; pick the place via its trigger.
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));

    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          invoice_number: "INV-1",
          invoice_amount: 1180,
          lines: [{ pending_asset_id: 10, serial_number: "SN-001", initial_asset_user_id: 5 }],
        }),
      ),
    );
  });

  it("asks where it is Received Into once, above the invoice fields, and sends it with every unit", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, PENDING_LINE_2]);
    expect(within(dialog).getAllByLabelText(/received into/i)).toHaveLength(1);
    expect(within(dialog).queryByText(/initial asset user|holder/i)).not.toBeInTheDocument();
    const assetUserLabel = dialog.querySelector('label[for="initial-asset-user"]')!;
    const invoiceLabel = dialog.querySelector('label[for="invoice-number"]')!;
    expect(assetUserLabel.compareDocumentPosition(invoiceLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const serials = within(dialog).getAllByLabelText(/^serial number\*?$/i);
    fireEvent.change(serials[0], { target: { value: "SN-A" } });
    fireEvent.change(serials[1], { target: { value: "SN-B" } });
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 10, serial_number: "SN-A", initial_asset_user_id: 5 },
            { pending_asset_id: 12, serial_number: "SN-B", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  it("a PO with a delivery location shows it in the header and starts receiving with it as Received Into", async () => {
    (apiClient.post as any).mockResolvedValue([]);
    const dialog = await receiveLine([PENDING_LINE], 1, { po: { ...PO, delivery_asset_user_id: 5, warehouse_code: "CKSPL-WH-TAJNAGAR" } });
    await waitFor(() => expect(screen.getByText(/Received Into: IT Stock-HO/)).toBeInTheDocument());
    await waitFor(() => expect(within(dialog).getByLabelText(/received into/i)).toHaveTextContent("IT Stock-HO"));

    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-3" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "500" } });
    fireEvent.change(within(dialog).getByLabelText(/^serial number\*?$/i), { target: { value: "SN-Z" } });
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({ lines: [{ pending_asset_id: 10, serial_number: "SN-Z", initial_asset_user_id: 5 }] }),
      ),
    );
  });

  it("units of the same line share one block with one list box, and a pasted list is handed out in order", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2, LAPTOP_3]);
    expect(within(dialog).getByText("3 units")).toBeInTheDocument();
    const box = within(dialog).getByLabelText(/^serial numbers\*?$/i);
    expect(within(dialog).getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA")).toHaveLength(1);

    fireEvent.change(box, { target: { value: "SN-1\nSN-2\n" } });
    expect(within(dialog).getByText(/2 of 3 entered/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(box, { target: { value: "SN-1\r\nSN-2\r\n SN-3 \r\n\r\n" } });
    expect(within(dialog).getByText(/3 of 3 entered/)).toBeInTheDocument();
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 10, serial_number: "SN-1", initial_asset_user_id: 5 },
            { pending_asset_id: 13, serial_number: "SN-2", initial_asset_user_id: 5 },
            { pending_asset_id: 14, serial_number: "SN-3", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  it("No serial number on a multi-unit block sets N/A for every unit in it, while another block takes a list", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2, PENDING_LINE_2]);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /no serial number for dell laptop/i }));
    expect(within(dialog).getByLabelText(/^serial numbers\*?$/i)).toBeDisabled();
    expect(confirmBtn(dialog)).toBeDisabled(); // the Logitech Mouse block still needs its serial
    fireEvent.change(within(dialog).getByLabelText(/^serial number\*?$/i), { target: { value: "MS-1" } });
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 10, serial_number: "N/A", initial_asset_user_id: 5 },
            { pending_asset_id: 13, serial_number: "N/A", initial_asset_user_id: 5 },
            { pending_asset_id: 12, serial_number: "MS-1", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  it("too many serials or a duplicate (even across blocks, ignoring case) keeps Confirm disabled and says why", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2, PENDING_LINE_2]);
    const box = within(dialog).getByLabelText(/^serial numbers\*?$/i);
    const mouse = within(dialog).getByLabelText(/^serial number\*?$/i);

    fireEvent.change(box, { target: { value: "A1\nA2\nA3" } });
    expect(within(dialog).getByText(/3 of 2 entered -- 1 too many/)).toBeInTheDocument();
    fireEvent.change(mouse, { target: { value: "M1" } });
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(box, { target: { value: "A1\na1" } });
    expect(within(dialog).getByText(/duplicate: A1, a1|duplicate: A1/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(box, { target: { value: "A1\nA2" } });
    fireEvent.change(mouse, { target: { value: "a2" } });
    expect(within(dialog).getByText(/Duplicate serial: a2/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(mouse, { target: { value: "M1" } });
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
  });

  it("fewer serials than units: Confirm stays blocked until the user ticks 'leave the rest waiting', then only the units with serials are sent", async () => {
    const units = [PENDING_LINE, LAPTOP_2, LAPTOP_3, { ...PENDING_LINE, id: 15 }, { ...PENDING_LINE, id: 16 }];
    const dialog = await openDeliveryFor(units);
    const box = within(dialog).getByLabelText(/^serial numbers\*?$/i);

    fireEvent.change(box, { target: { value: "S1\nS2\nS3\nS4" } });
    expect(within(dialog).getByText(/4 of 5 entered/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 unit has no serial yet/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /leave the remaining units waiting/i }));
    expect(within(dialog).getByText(/1 will stay waiting/)).toBeInTheDocument();
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 10, serial_number: "S1", initial_asset_user_id: 5 },
            { pending_asset_id: 13, serial_number: "S2", initial_asset_user_id: 5 },
            { pending_asset_id: 14, serial_number: "S3", initial_asset_user_id: 5 },
            { pending_asset_id: 15, serial_number: "S4", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  it("the 'leave waiting' option never appears for a complete list, and an empty dialog cannot be confirmed even with it ticked", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2]);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /leave the remaining units waiting/i }));
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^serial numbers\*?$/i), { target: { value: "X1\nX2" } });
    expect(within(dialog).queryByRole("checkbox", { name: /leave the remaining units waiting/i })).not.toBeInTheDocument();
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
  });

  it("serials CKAM already has are flagged as you type, naming the asset, and block Confirm until removed", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2]);
    (apiClient.post as any).mockImplementation((path: string, body: { serials?: string[] }) =>
      path === "/purchase-orders/check-serials"
        ? Promise.resolve({ conflicts: (body.serials ?? []).filter((s) => s === "111").map((s) => ({ serial: s, asset_code: "FA/CKSPL/ITSW/MSWINDOWS/CKAM1" })) })
        : Promise.resolve([]),
    );
    const box = within(dialog).getByLabelText(/^serial numbers\*?$/i);

    fireEvent.change(box, { target: { value: "111\n222" } });
    expect(await within(dialog).findByText(/Serial "111" is already used by asset FA\/CKSPL\/ITSW\/MSWINDOWS\/CKAM1/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();
    expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/check-serials", { serials: ["111", "222"] });

    fireEvent.change(box, { target: { value: "333\n222" } });
    await waitFor(() => expect(within(dialog).queryByText(/is already used by asset/)).not.toBeInTheDocument());
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
  });

  it("a conflict whose asset code the server masks is shown as the server worded it, still blocking Confirm", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2]);
    (apiClient.post as any).mockImplementation((path: string, body: { serials?: string[] }) =>
      path === "/purchase-orders/check-serials"
        ? Promise.resolve({ conflicts: (body.serials ?? []).filter((s) => s === "111").map((s) => ({ serial: s, asset_code: "an asset outside your companies or work area" })) })
        : Promise.resolve([]),
    );
    fireEvent.change(within(dialog).getByLabelText(/^serial numbers\*?$/i), { target: { value: "111\n222" } });
    const alert = await within(dialog).findByText(/Serial "111" is already used by/);
    expect(alert).toHaveTextContent('Serial "111" is already used by an asset outside your companies or work area.');
    expect(alert.textContent).not.toMatch(/by asset an asset/);
    expect(confirmBtn(dialog)).toBeDisabled();
  });

  it("set (bundle) lines show their set tag, and a part that never carries a serial starts with 'No serial number' ticked", async () => {
    const cpu = (id: number) => ({ ...PENDING_LINE, id, line_no: 1, description: "Dell Desktop - CPU", bundle_label: "Desktop", serial_required: true });
    const mouse = (id: number) => ({ ...PENDING_LINE, id, line_no: 2, description: "Dell Desktop - Mouse", bundle_label: "Desktop", serial_required: false });
    mockGets([cpu(20), cpu(21), mouse(22), mouse(23)]);
    (apiClient.post as any).mockResolvedValue([]);
    renderDetailAt();
    await waitFor(() => expect(lineRows()).toHaveLength(2));
    expect(within(linesTable()).getAllByText("Desktop")).toHaveLength(2); // the tag on each line
    expect(within(lineRows()[1]).getByText(/No serial number/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /receive all waiting/i }));
    const dialog = await screen.findByRole("dialog", { name: "Receive 4 units" });
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-D" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "5000" } });
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));

    expect(within(dialog).getByRole("checkbox", { name: /no serial number for dell desktop - mouse/i })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /no serial number for dell desktop - cpu/i })).not.toBeChecked();
    expect(confirmBtn(dialog)).toBeDisabled();
    const [cpuBox, mouseBox] = within(dialog).getAllByLabelText(/^serial numbers\*?$/i);
    expect(mouseBox).toBeDisabled();
    fireEvent.change(cpuBox, { target: { value: "CPU-1\nCPU-2" } });
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 20, serial_number: "CPU-1", initial_asset_user_id: 5 },
            { pending_asset_id: 21, serial_number: "CPU-2", initial_asset_user_id: 5 },
            { pending_asset_id: 22, serial_number: "N/A", initial_asset_user_id: 5 },
            { pending_asset_id: 23, serial_number: "N/A", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  it("AM-22 UAT: Invoice No/Date/Amount are visibly marked required", async () => {
    const dialog = await receiveLine([PENDING_LINE]);
    for (const id of ["invoice-number", "invoice-date", "invoice-amount"]) {
      const labelEl = dialog.querySelector(`label[for="${id}"]`);
      expect(labelEl).not.toBeNull();
      expect(labelEl!.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
    }
  });

  it("right after receiving, offers to print the labels of the units just received", async () => {
    (apiClient.post as any).mockResolvedValue([{ ...PENDING_LINE, status: "DELIVERED", delivered_asset_id: 77 }]);
    const dialog = await receiveLine([PENDING_LINE]);
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /no serial number for dell laptop/i }));
    fireEvent.click(confirmBtn(dialog));

    expect(await screen.findByText(/1 unit received and now in the register/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /print their labels now/i })).toHaveAttribute("href", expect.stringMatching(/^\/print-labels\?assets=.*77/));
  });

  it("a line whose Item's serial is read later starts with 'add it later' ticked, and delivers without a serial", async () => {
    (apiClient.post as any).mockResolvedValue([{ ...PENDING_LINE, status: "DELIVERED" }]);
    const dialog = await receiveLine([{ ...PENDING_LINE, serial_later: true }]);
    // (the page behind the open dialog is aria-hidden, hence `hidden: true`)
    expect(within(screen.getByRole("table", { name: "Purchase order lines", hidden: true })).getByText(/Serial will be entered later/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));

    const later = within(dialog).getByRole("checkbox", { name: /add the serial later for dell laptop/i });
    expect(later).toBeChecked();
    expect(within(dialog).getByLabelText(/^serial number\*?$/i)).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: /no serial number for dell laptop/i })).not.toBeChecked();
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({ lines: [{ pending_asset_id: 10, serial_pending: true, initial_asset_user_id: 5 }] }),
      ),
    );
  });

  it("'add it later' and 'no serial number' exclude each other, and either can be unticked to type serials", async () => {
    const dialog = await receiveLine([{ ...PENDING_LINE, serial_later: true }]);
    const later = () => within(dialog).getByRole("checkbox", { name: /add the serial later/i });
    const none = () => within(dialog).getByRole("checkbox", { name: /no serial number for/i });
    fireEvent.click(none());
    expect(none()).toBeChecked();
    expect(later()).not.toBeChecked();
    fireEvent.click(later());
    expect(later()).toBeChecked();
    expect(none()).not.toBeChecked();
    fireEvent.click(later());
    expect(within(dialog).getByLabelText(/^serial number\*?$/i)).toBeEnabled();
  });

  it("checking \"No serial number\" disables the input and submits N/A", async () => {
    (apiClient.post as any).mockResolvedValue([{ ...PENDING_LINE, status: "DELIVERED" }]);
    const dialog = await receiveLine([PENDING_LINE]);
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));

    const serialInput = within(dialog).getByLabelText(/^serial number\*?$/i);
    expect(confirmBtn(dialog)).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /no serial number for dell laptop/i }));
    expect(serialInput).toBeDisabled();
    expect(serialInput).toHaveValue("N/A");
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({ lines: [{ pending_asset_id: 10, serial_number: "N/A", initial_asset_user_id: 5 }] }),
      ),
    );
  });

  it("shows a server-side error inline on a failed receive and keeps the dialog open", async () => {
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/purchase-orders/1/deliver") return Promise.reject(new Error("This unit has already been received."));
      return Promise.resolve([]);
    });
    const dialog = await receiveLine([PENDING_LINE]);
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.change(within(dialog).getByLabelText(/^serial number\*?$/i), { target: { value: "SN-001" } });
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("This unit has already been received."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("PurchaseOrderDetail: invoices received and their Purchase Invoice (PI)", () => {
  it("AM-19: lists each distinct received Invoice Number with its own Record PI action", async () => {
    mockGets([PENDING_LINE, DELIVERED_LINE]);
    renderDetailAt();
    expect(await screen.findByText("INV-777")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record pi/i })).toBeInTheDocument();
    // PI is spelled out once on the screen.
    expect(screen.getByText(/Purchase Invoice \(PI\) Number\/Date/)).toBeInTheDocument();
    expect(screen.getAllByText(/Purchase Invoice \(PI\)/)).toHaveLength(1);
  });

  it("links to the labels of every received unit of the PO", async () => {
    mockGets([DELIVERED_LINE]);
    renderDetailAt();
    expect(await screen.findByRole("link", { name: /print labels for the received units/i })).toHaveAttribute("href", expect.stringMatching(/^\/print-labels\?assets=.*99/));
  });

  it("a PO created from the ERP offers Fetch PI from ERP next to its received invoices", async () => {
    mockGets([DELIVERED_LINE], { po: { ...PO, erp_po_code: 1133610106 } });
    renderDetailAt();
    expect(await screen.findByRole("button", { name: "Fetch PI from ERP" })).toBeInTheDocument();
  });

  it("a PO made by hand does not offer Fetch PI from ERP", async () => {
    mockGets([DELIVERED_LINE]);
    renderDetailAt();
    await screen.findByText("INV-777");
    expect(screen.queryByRole("button", { name: "Fetch PI from ERP" })).not.toBeInTheDocument();
  });

  it("AM-19: Record PI posts to the record-pi endpoint and shows the result", async () => {
    mockGets([DELIVERED_LINE]);
    (apiClient.post as any).mockResolvedValue({ invoice_number: "INV-777", updated: ["FA/1"], skipped: [] });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("INV-777")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /record pi/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/pi number/i), { target: { value: "PI-2001" } });
    fireEvent.change(within(dialog).getByLabelText(/pi date/i), { target: { value: "2026-02-15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/record-pi", {
        invoice_number: "INV-777", pi_number: "PI-2001", pi_date: "2026-02-15", overwrite: false,
      }),
    );
    expect(await within(dialog).findByText(/updated/i)).toBeInTheDocument();
  });

  it("AM-19: Overwrite existing values checkbox is sent through to the request", async () => {
    mockGets([DELIVERED_LINE]);
    (apiClient.post as any).mockResolvedValue({ invoice_number: "INV-777", updated: ["FA/1"], skipped: [] });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("INV-777")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /record pi/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/pi number/i), { target: { value: "PI-CORRECTED" } });
    fireEvent.change(within(dialog).getByLabelText(/pi date/i), { target: { value: "2026-02-15" } });
    fireEvent.click(within(dialog).getByLabelText(/overwrite existing values/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/record-pi", expect.objectContaining({ overwrite: true })),
    );
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

  async function openReceive(caps: Capabilities, po: unknown = PO) {
    mockGets([PENDING_LINE], { po });
    withCaps(caps);
    renderDetailAt();
    await waitFor(() => expect(lineRows().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /receive line 1\b/i }));
    return screen.findByRole("dialog");
  }

  it("Receive lists the PO company's stock rooms from /stock-rooms, and a new one is added and picked right there", async () => {
    const dialog = await openReceive(OPERATOR_IT);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/stock-rooms?company_id=1"));
    (apiClient.post as any).mockImplementation((path: string, body: Record<string, unknown>) =>
      Promise.resolve(path === "/stock-rooms" ? { id: 77, name: body.name } : []));
    const base = (apiClient.get as any).getMockImplementation();
    let created = false;
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/stock-rooms?company_id=") && created) return Promise.resolve([{ id: 5, name: "IT Stock-HO" }, { id: 77, name: "Gate Stock" }]);
      if (path === "/masters/locations?company_id=1") return Promise.resolve([{ id: 50, name: "Head Office" }]);
      return base(path);
    });
    fireEvent.click(within(dialog).getByLabelText(/received into/i));
    fireEvent.click(await screen.findByRole("option", { name: /new stock room/i }));
    const add = await screen.findByRole("dialog", { name: /new stock room/i });
    fireEvent.change(within(add).getByLabelText(/^name/i), { target: { value: "Gate Stock" } });
    fireEvent.click(within(add).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: "Head Office" }));
    created = true;
    fireEvent.click(within(add).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", { name: "Gate Stock", company_id: 1, location_id: 50 }));
    await waitFor(() => expect(within(dialog).getByLabelText(/received into/i)).toHaveTextContent("Gate Stock"));
    expect(screen.getByRole("dialog", { name: /receive 1 unit/i })).toBeInTheDocument();     // still receiving
  });

  it("a viewer-like login (capabilities say no) gets no New Stock Room in Receive", async () => {
    const dialog = await openReceive(VIEWER);
    await settle();
    expect(await offered(/received into/i, /new stock room/i, dialog)).toBe(false);
  });

  it("with no delivery place on the PO, Receive starts with the stock room this person received into last, and remembers the new choice", async () => {
    window.localStorage.setItem("ckam:last-used:5:1", JSON.stringify({ stock_room: "5" }));
    (apiClient.post as any).mockResolvedValue([]);
    const dialog = await openReceive(OPERATOR_IT);
    await waitFor(() => expect(within(dialog).getByLabelText(/received into/i)).toHaveTextContent("IT Stock-HO"));
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText(/^serial number\*?$/i), { target: { value: "SN-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(deliverCall()?.[1].lines[0]).toEqual(expect.objectContaining({ initial_asset_user_id: 5 })));
    expect(JSON.parse(window.localStorage.getItem("ckam:last-used:5:1")!)).toEqual({ stock_room: "5" });
  });
});
