import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { OPERATOR_IT, VIEWER, withCapabilities } from "../../test-capabilities";
import { todayIso } from "./receive-model";

vi.mock("../../lib/api-client");

// ---------------------------------------------------------------------------
// Fixtures: GET /purchase-orders/1/receive-info and POST /purchase-orders/1/receive
// ---------------------------------------------------------------------------

type Line = Record<string, unknown> & { line_no: number; waiting: number };

function line(over: Partial<Line> & { line_no: number }): Line {
  return {
    item_id: 44, item_name: "Indoor Camera", description: "Indoor Camera 2MP", ordered: 3, received_before: 0, waiting: 3,
    cancelled: 0, serial_mode: "HAS_SERIAL", work_area: "IT", rate: 2500, tax_percent: 18, unit_total: 2950,
    erp_item_code: null, brand_name: null, model: null, bundle_label: null, status: "WAITING",
    ...over,
  };
}

const CAMERA = line({ line_no: 1 });
const GANG_BOX = line({ line_no: 2, item_id: 45, item_name: "Gang Box PVC", description: "Gang Box PVC 4x4", ordered: 5, waiting: 5, serial_mode: "NO_SERIAL", work_area: "NON_IT" });
const ACCESS_POINT = line({ line_no: 3, item_id: 46, item_name: "Netgear WAX610", description: "Netgear WAX610", ordered: 2, waiting: 2, serial_mode: "SERIAL_LATER" });

function info(over: Record<string, unknown> = {}) {
  const lines = (over.lines as Line[] | undefined) ?? [CAMERA, GANG_BOX, ACCESS_POINT];
  return {
    po_id: 1, po_number: "SPO/012247", po_date: "2026-01-01", is_active: true,
    company_id: 1, company_name: "Citykart Stores Pvt Ltd", company_code: "CKSPL",
    vendor_id: 3, vendor_name: "Harshit Infosolution",
    received_into_asset_user_id: 5, received_into_name: "IT Stock-HO",
    ordered_units: 10, received_units: 0, waiting_units: lines.reduce((n, l) => n + l.waiting, 0),
    lines, required_custom_fields: [], blockers: [],
    ...over,
  };
}

function result(n: number, over: Record<string, unknown> = {}) {
  const assets = Array.from({ length: n }, (_, i) => ({
    asset_id: 500 + i, asset_code: `FA/CKSPL/IT/${String(i + 1).padStart(4, "0")}`, line_no: 1, serial_number: `S${i}`, serial_pending: false,
  }));
  return {
    po_id: 1, invoice_number: "HI/771", assets_created: n, serial_pending: 0, assets,
    label_asset_ids: assets.map((a) => a.asset_id), po_status: "RECEIVED", waiting_units: 0, ...over,
  };
}

let currentInfo: ReturnType<typeof info>;
let conflictsFor: (serials: string[]) => { serial: string; asset_code: string }[] = () => [];

function mockApi(i = info(), opts: { caps?: Capabilities | null; rooms?: unknown[] } = {}) {
  currentInfo = i;
  const base = (path: string) => {
    if (path === "/purchase-orders/1/receive-info") return Promise.resolve(currentInfo);
    if (path.startsWith("/stock-rooms?company_id=")) return Promise.resolve(opts.rooms ?? [{ id: 5, name: "IT Stock-HO" }, { id: 6, name: "Gate Stock" }]);
    if (path.startsWith("/assets?")) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve([]);
  };
  (apiClient.get as any).mockImplementation(opts.caps !== undefined ? withCapabilities(opts.caps, base) : base);
  (apiClient.post as any).mockImplementation((path: string, body: { serials?: string[] }) => {
    if (path === "/purchase-orders/check-serials") return Promise.resolve({ conflicts: conflictsFor(body.serials ?? []) });
    if (path === "/purchase-orders/1/receive") return Promise.resolve(result(3));
    return Promise.resolve({});
  });
}

function renderAt(url = "/receive/1") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const lineGroup = (n: number) => screen.getByRole("group", { name: new RegExp(`^Line ${n}:`) });
const qty = (n: number) => screen.getByLabelText(`Receiving now on line ${n}`) as HTMLInputElement;
const box = (n: number) => screen.getByLabelText(`Serial numbers for line ${n}`) as HTMLTextAreaElement;
const receiveBtn = () => screen.getByRole("button", { name: /^Receive \d[\d,]* units?$/ });
const why = () => document.getElementById("receive-why")!;
const receiveCalls = () => (apiClient.post as any).mock.calls.filter(([p]: [string]) => p === "/purchase-orders/1/receive");
const lastBody = () => receiveCalls()[receiveCalls().length - 1][1];

async function ready(url?: string) {
  const router = renderAt(url);
  await screen.findByRole("heading", { name: "Receive PO SPO/012247" });
  await waitFor(() => expect(screen.getAllByLabelText(/received into/i)[0]).toHaveTextContent("IT Stock-HO"));
  return router;
}

function fillInvoice(no = "HI/771", amount = "312700") {
  fireEvent.change(screen.getByLabelText(/invoice no/i), { target: { value: no } });
  fireEvent.change(screen.getByLabelText(/invoice amount/i), { target: { value: amount } });
}

function typeSerials(n: number, text: string) {
  fireEvent.change(box(n), { target: { value: text } });
}

beforeEach(() => {
  vi.clearAllMocks();
  conflictsFor = () => [];
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 7 });
});
afterEach(() => useAuthStore.getState().logout());

// ---------------------------------------------------------------------------

describe("Receive screen: one screen, common details once, a quantity per line", () => {
  it("shows the PO, its lines with Ordered / Received before / Waiting, everything waiting as the default, and no unit tick boxes", async () => {
    mockApi(info({ lines: [CAMERA, line({ ...GANG_BOX, received_before: 3, ordered: 8, status: "PARTLY_RECEIVED" }), ACCESS_POINT] }));
    await ready();
    expect(screen.getByText(/Harshit Infosolution · Citykart Stores Pvt Ltd/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to Receive" })).toHaveAttribute("href", "/receive");
    // The menu shows where we are: Receive.
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Receive" })).toHaveAttribute("data-active", "true");
    expect(apiClient.get).toHaveBeenCalledWith("/purchase-orders/1/receive-info");

    const g2 = lineGroup(2);
    expect(within(g2).getByText("Gang Box PVC")).toBeInTheDocument();
    expect(within(g2).getByText("Gang Box PVC 4x4")).toBeInTheDocument();       // description, muted
    expect(within(g2).getByText("Admin / Non-IT Team")).toBeInTheDocument();           // work-area chip in words
    expect(within(g2).getByLabelText("Ordered: 8")).toBeInTheDocument();
    expect(within(g2).getByLabelText("Received before: 3")).toBeInTheDocument();
    expect(within(g2).getByLabelText("Waiting: 5")).toBeInTheDocument();

    expect([qty(1).value, qty(2).value, qty(3).value]).toEqual(["3", "5", "2"]);
    expect(receiveBtn()).toHaveTextContent("Receive 10 units");
    // No unit rows and nothing to tick.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // A serial box only where the rule says "Has serial number".
    expect(box(1)).toBeInTheDocument();
    expect(screen.queryByLabelText("Serial numbers for line 2")).not.toBeInTheDocument();
    expect(within(g2).getByText("No serial number: each asset is saved with N/A.")).toBeInTheDocument();
    expect(within(lineGroup(3)).getByText("Serial numbers will be entered later from Assets > Serial Pending.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/HAS_SERIAL|NO_SERIAL|SERIAL_LATER|Holder|pending_asset/);
  });

  it("the receipt details are entered once and the request carries them once, with a quantity per line", async () => {
    mockApi();
    await ready();
    expect(screen.getByLabelText(/invoice date/i)).toHaveValue(todayIso());
    // Asked once each: Received Into, Invoice No / Date / Amount (no per-line or per-unit copies).
    for (const label of [/^received into/i, /^invoice no/i, /^invoice date/i, /^invoice amount/i]) {
      expect(new Set(screen.queryAllByLabelText(label)).size).toBe(1);
    }
    fillInvoice();
    typeSerials(1, "CAM-1\nCAM-2\nCAM-3");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(lastBody()).toEqual({
      received_into_asset_user_id: 5, invoice_number: "HI/771", invoice_date: todayIso(), invoice_amount: 312700,
      lines: [
        { line_no: 1, quantity: 3, serial_numbers: ["CAM-1", "CAM-2", "CAM-3"] },
        { line_no: 2, quantity: 5 },
        { line_no: 3, quantity: 2 },
      ],
    });
  });

  it("AM-22: Received Into and Invoice No / Date / Amount are visibly required; the amount says it is the invoice total", async () => {
    mockApi();
    await ready();
    for (const id of ["received-into", "invoice-number", "invoice-date", "invoice-amount"]) {
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label?.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
    }
    expect(screen.getByText("The invoice total.")).toBeInTheDocument();
  });

  it("Received Into starts at the PO's delivery place; a stock room can be chosen instead and is sent and remembered", async () => {
    mockApi();
    await ready();
    fireEvent.click(screen.getAllByLabelText(/received into/i)[0]);
    fireEvent.click(await screen.findByText("Gate Stock"));
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(lastBody().received_into_asset_user_id).toBe(6));
    await screen.findByText(/3 assets created/);
    expect(JSON.parse(window.localStorage.getItem("ckam:last-used:7:1")!)).toEqual({ stock_room: "6" });
  });

  it("with no delivery place on the PO, Received Into starts at the stock room this person used last", async () => {
    window.localStorage.setItem("ckam:last-used:7:1", JSON.stringify({ stock_room: "6" }));
    mockApi(info({ received_into_asset_user_id: null, received_into_name: null }));
    renderAt();
    await screen.findByRole("heading", { name: "Receive PO SPO/012247" });
    await waitFor(() => expect(screen.getAllByLabelText(/received into/i)[0]).toHaveTextContent("Gate Stock"));
  });

  it("with no delivery place and nothing remembered, the reason says to choose where it is Received Into", async () => {
    mockApi(info({ received_into_asset_user_id: null, received_into_name: null }));
    renderAt();
    await screen.findByRole("heading", { name: "Receive PO SPO/012247" });
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    await waitFor(() => expect(why()).toHaveTextContent("Choose where the goods are Received Into."));
    expect(receiveBtn()).toBeDisabled();
  });

  it("S3b-1: a new Stock Room can be added right here (capabilities allow) and is picked at once", async () => {
    mockApi(info(), { caps: OPERATOR_IT });
    await ready();
    const base = (apiClient.get as any).getMockImplementation();
    let created = false;
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/stock-rooms?company_id=") && created) return Promise.resolve([{ id: 5, name: "IT Stock-HO" }, { id: 77, name: "Back Room" }]);
      if (path === "/masters/locations?company_id=1") return Promise.resolve([{ id: 50, name: "Head Office" }]);
      return base(path);
    });
    const postBase = (apiClient.post as any).getMockImplementation();
    (apiClient.post as any).mockImplementation((path: string, body: Record<string, unknown>) =>
      path === "/stock-rooms" ? Promise.resolve({ id: 77, name: body.name }) : postBase(path, body));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    fireEvent.click(screen.getAllByLabelText(/received into/i)[0]);
    fireEvent.click(await screen.findByRole("option", { name: /new stock room/i }));
    const add = await screen.findByRole("dialog", { name: /new stock room/i });
    fireEvent.change(within(add).getByLabelText(/^name/i), { target: { value: "Back Room" } });
    fireEvent.click(within(add).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: "Head Office" }));
    created = true;
    fireEvent.click(within(add).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", { name: "Back Room", company_id: 1, location_id: 50 }));
    await waitFor(() => expect(screen.getAllByLabelText(/received into/i)[0]).toHaveTextContent("Back Room"));
    expect(screen.getByRole("heading", { name: "Receive PO SPO/012247" })).toBeInTheDocument(); // still receiving
  });

  it("S3b-1: a login that may not add stock rooms gets no New Stock Room", async () => {
    mockApi(info(), { caps: VIEWER });
    await ready();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getAllByLabelText(/received into/i)[0]);
    await screen.findAllByRole("option");
    expect(screen.queryByRole("option", { name: /new stock room/i })).not.toBeInTheDocument();
  });
});

describe("Receive screen: quantities", () => {
  it("− / + steppers stay within 0..waiting; 0 skips the line and leaves it out of the request", async () => {
    mockApi();
    await ready();
    const plus = () => screen.getByRole("button", { name: "One more on line 1" });
    const minus = () => screen.getByRole("button", { name: "One less on line 1" });
    expect(plus()).toBeDisabled();                       // already everything waiting
    fireEvent.click(minus());
    expect(qty(1)).toHaveValue(2);
    fireEvent.click(minus());
    fireEvent.click(minus());
    expect(qty(1)).toHaveValue(0);
    expect(minus()).toBeDisabled();
    expect(within(lineGroup(1)).getByText("Skipped: all 3 stay waiting on this PO.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Serial numbers for line 1")).not.toBeInTheDocument();
    expect(receiveBtn()).toHaveTextContent("Receive 7 units");
    fireEvent.click(plus());
    expect(qty(1)).toHaveValue(1);

    fireEvent.change(qty(1), { target: { value: "0" } });
    fillInvoice();
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(lastBody().lines.map((l: { line_no: number }) => l.line_no)).toEqual([2, 3]);
  });

  it("a partial quantity receives that many and says the rest stays waiting", async () => {
    mockApi();
    await ready();
    fireEvent.change(qty(2), { target: { value: "2" } });
    expect(within(lineGroup(2)).getByText("3 units will stay waiting on this PO.")).toBeInTheDocument();
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    expect(receiveBtn()).toHaveTextContent("Receive 7 units");
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(lastBody().lines[1]).toEqual({ line_no: 2, quantity: 2 });
  });

  it("a quantity above what is waiting, or not a whole number, blocks Receive with the line named", async () => {
    mockApi();
    await ready();
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    fireEvent.change(qty(2), { target: { value: "6" } });
    expect(await within(lineGroup(2)).findByText("Only 5 units are waiting.")).toBeInTheDocument();
    await waitFor(() => expect(why()).toHaveTextContent("Line 2: Only 5 units are waiting."));
    expect(receiveBtn()).toBeDisabled();
    fireEvent.change(qty(2), { target: { value: "2.5" } });
    await waitFor(() => expect(why()).toHaveTextContent("Line 2: Enter a whole number."));
    fireEvent.change(qty(2), { target: { value: "5" } });
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
  });

  it("from a PO line (?line=2): only that line starts filled in, the others at 0, and the cursor is on it", async () => {
    mockApi();
    await ready("/receive/1?line=2");
    expect([qty(1).value, qty(2).value, qty(3).value]).toEqual(["0", "5", "0"]);
    await waitFor(() => expect(document.activeElement).toBe(qty(2)));
    expect(receiveBtn()).toHaveTextContent("Receive 5 units");
  });

  it("?line= for a line with nothing waiting falls back to everything waiting", async () => {
    mockApi(info({ lines: [CAMERA, line({ ...GANG_BOX, waiting: 0, received_before: 5, status: "RECEIVED" })] }));
    await ready("/receive/1?line=2");
    expect(qty(1).value).toBe("3");
    expect(within(lineGroup(2)).getByText("Nothing on this line is waiting.")).toBeInTheDocument();
  });
});

describe("Receive screen: serial rule per line", () => {
  it("defaults to the Item's rule and can be changed for this receipt (sent as serial_mode only when changed)", async () => {
    mockApi();
    await ready();
    const rule1 = within(screen.getByRole("radiogroup", { name: "Serial rule for line 1" }));
    expect(rule1.getByRole("radio", { name: "Has serial number" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(rule1.getByRole("radio", { name: "No serial number" }));
    expect(screen.queryByLabelText("Serial numbers for line 1")).not.toBeInTheDocument();
    expect(within(lineGroup(1)).getByText(/Changed for this receipt only; the Item says “Has serial number”/)).toBeInTheDocument();

    const rule3 = within(screen.getByRole("radiogroup", { name: "Serial rule for line 3" }));
    fireEvent.click(rule3.getByRole("radio", { name: "Has serial number" }));
    typeSerials(3, "AP-1\nAP-2");
    fillInvoice();
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(lastBody().lines).toEqual([
      { line_no: 1, quantity: 3, serial_mode: "NO_SERIAL" },
      { line_no: 2, quantity: 5 },
      { line_no: 3, quantity: 2, serial_mode: "HAS_SERIAL", serial_numbers: ["AP-1", "AP-2"] },
    ]);
  });

  it("a serial-later line needs nothing now and goes to Serial Pending", async () => {
    mockApi(info({ lines: [ACCESS_POINT] }));
    await ready();
    fillInvoice();
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(lastBody().lines).toEqual([{ line_no: 3, quantity: 2 }]));
  });

  it("set lines show their set tag; a part that never carries a serial needs no serial box", async () => {
    mockApi(info({
      lines: [
        line({ line_no: 1, item_name: "Dell Desktop - CPU", bundle_label: "Desktop", ordered: 2, waiting: 2 }),
        line({ line_no: 2, item_name: "Dell Desktop - Mouse", bundle_label: "Desktop", ordered: 2, waiting: 2, serial_mode: "NO_SERIAL" }),
      ],
    }));
    await ready();
    expect(within(lineGroup(1)).getByText("Set: Desktop")).toBeInTheDocument();
    expect(within(lineGroup(2)).getByText("Set: Desktop")).toBeInTheDocument();
    expect(screen.queryByLabelText("Serial numbers for line 2")).not.toBeInTheDocument();
    fillInvoice();
    typeSerials(1, "CPU-1\nCPU-2");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(lastBody().lines).toEqual([
      { line_no: 1, quantity: 2, serial_numbers: ["CPU-1", "CPU-2"] },
      { line_no: 2, quantity: 2 },
    ]));
  });
});

describe("Receive screen: the serial box", () => {
  it("counts as you type ('k of n entered') and blocks a short or long list with the line named", async () => {
    mockApi();
    await ready();
    fillInvoice();
    typeSerials(1, "SN-1\nSN-2\n");
    expect(await within(lineGroup(1)).findByText("2 of 3 entered")).toBeInTheDocument();
    await waitFor(() => expect(why()).toHaveTextContent("Line 1: 3 serial numbers needed, 2 entered."));
    expect(receiveBtn()).toBeDisabled();
    typeSerials(1, "SN-1\nSN-2\nSN-3\nSN-4");
    expect(await within(lineGroup(1)).findByText(/4 of 3 entered — 1 too many, remove it/)).toBeInTheDocument();
    await waitFor(() => expect(why()).toHaveTextContent("Line 1: 1 serial number too many: 3 needed, 4 entered."));
    // Pasted text with Windows line ends, spaces and blank rows: trimmed, blanks ignored.
    typeSerials(1, "SN-1\r\n\r\n SN-2 \r\nSN-3\r\n");
    expect(await within(lineGroup(1)).findByText("3 of 3 entered")).toBeInTheDocument();
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(lastBody().lines[0].serial_numbers).toEqual(["SN-1", "SN-2", "SN-3"]));
  });

  it("a serial typed twice in one box (any case) names both rows and marks them", async () => {
    mockApi();
    await ready();
    fillInvoice();
    typeSerials(1, "A1\nB2\na1");
    expect(await within(lineGroup(1)).findByText("A1 is typed more than once in this box (rows 1 and 3).")).toBeInTheDocument();
    const gutter = screen.getByTestId("serials-line-1-gutter");
    const marked = [...gutter.querySelectorAll("[data-problem]")].map((el) => el.getAttribute("data-row"));
    expect(marked).toEqual(["1", "3"]);
    expect(receiveBtn()).toBeDisabled();
    expect(why()).toHaveTextContent("Line 1: A1 is typed more than once");
    typeSerials(1, "A1\nB2\nC3");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    expect(gutter.querySelectorAll("[data-problem]")).toHaveLength(0);
  });

  it("a serial typed on two lines of this receipt is flagged on both", async () => {
    mockApi(info({ lines: [CAMERA, line({ ...ACCESS_POINT, serial_mode: "HAS_SERIAL" })] }));
    await ready();
    fillInvoice();
    typeSerials(1, "X1\nX2\nX3");
    typeSerials(3, "Y1\nx2");
    expect(await within(lineGroup(1)).findByText("X2 is also typed for line 3.")).toBeInTheDocument();
    expect(within(lineGroup(3)).getByText("x2 is also typed for line 1.")).toBeInTheDocument();
    expect(receiveBtn()).toBeDisabled();
  });

  it("N/A may repeat (it is never a duplicate)", async () => {
    mockApi();
    await ready();
    fillInvoice();
    typeSerials(1, "N/A\nn/a\nSN-9");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
  });

  it("serials CKAM already has are flagged as you type (server check), naming the asset and the row", async () => {
    mockApi();
    conflictsFor = (serials) => serials.filter((s) => s === "111").map((serial) => ({ serial, asset_code: "FA/CKSPL/ITSW/CKAM1" }));
    await ready();
    fillInvoice();
    typeSerials(1, "222\n111\n333");
    expect(await within(lineGroup(1)).findByText('Row 2: Serial "111" is already used by asset FA/CKSPL/ITSW/CKAM1.')).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/check-serials", { serials: ["222", "111", "333"] });
    expect(receiveBtn()).toBeDisabled();
    typeSerials(1, "222\n444\n333");
    await waitFor(() => expect(within(lineGroup(1)).queryByText(/already used/)).not.toBeInTheDocument());
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
  });

  it("a masked conflict is shown as the server worded it", async () => {
    mockApi();
    conflictsFor = (serials) => serials.filter((s) => s === "111").map((serial) => ({ serial, asset_code: "an asset outside your companies or work area" }));
    await ready();
    typeSerials(1, "111\n2\n3");
    expect(await within(lineGroup(1)).findByText('Row 1: Serial "111" is already used by an asset outside your companies or work area.')).toBeInTheDocument();
  });

  it("a failed server check means 'no information', not an error", async () => {
    mockApi();
    const postBase = (apiClient.post as any).getMockImplementation();
    (apiClient.post as any).mockImplementation((path: string, body: unknown) =>
      path === "/purchase-orders/check-serials" ? Promise.reject(new Error("503")) : postBase(path, body));
    await ready();
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/check-serials", expect.anything()));
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    expect(screen.queryByText(/503/)).not.toBeInTheDocument();
  });
});

describe("Receive screen: extra fields needed for every asset", () => {
  const FIELDS = [
    { id: 1, key: "warranty_card", label: "Warranty card number", type: "text", options: null, sort_order: 1 },
    { id: 2, key: "rack_no", label: "Rack number", type: "number", options: null, sort_order: 2 },
    { id: 3, key: "installed_on", label: "Installed on", type: "date", options: null, sort_order: 3 },
    { id: 4, key: "floor", label: "Floor", type: "dropdown", options: { choices: ["Ground", "First"] }, sort_order: 4 },
    { id: 5, key: "insured", label: "Insured", type: "checkbox", options: null, sort_order: 5 },
  ];

  it("renders each type with a required marker and one sentence on why, and blocks Receive until filled", async () => {
    mockApi(info({ lines: [GANG_BOX], required_custom_fields: FIELDS }));
    await ready();
    const section = screen.getByRole("region", { name: "Needed for every asset received" });
    expect(section).toHaveTextContent("Citykart Stores Pvt Ltd asks for these on every asset, so they are filled in once here and copied onto each asset received.");
    expect(within(section).getByLabelText("Warranty card number")).toHaveAttribute("type", "text");
    expect(within(section).getByLabelText("Rack number")).toHaveAttribute("type", "number");
    expect(within(section).getByLabelText("Installed on")).toHaveAttribute("type", "date");
    expect(within(section).getByRole("combobox", { name: "Floor" })).toBeInTheDocument();
    expect(within(section).getByRole("checkbox", { name: "Insured" })).not.toBeChecked();
    for (const key of ["warranty_card", "rack_no", "installed_on", "floor"]) {
      expect(document.querySelector(`label[for="rf-${key}"] [aria-hidden="true"]`)?.textContent).toBe("*");
    }
    fillInvoice();
    await waitFor(() => expect(why()).toHaveTextContent("Warranty card number is needed for every asset received."));
    expect(receiveBtn()).toBeDisabled();

    fireEvent.change(within(section).getByLabelText("Warranty card number"), { target: { value: "WC-ALL" } });
    fireEvent.change(within(section).getByLabelText("Rack number"), { target: { value: "12" } });
    fireEvent.change(within(section).getByLabelText("Installed on"), { target: { value: "2026-02-01" } });
    fireEvent.click(within(section).getByRole("combobox", { name: "Floor" }));
    fireEvent.click(await screen.findByRole("option", { name: "First" }));
    fireEvent.click(within(section).getByRole("checkbox", { name: "Insured" }));
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(lastBody().lines).toEqual([{
      line_no: 2, quantity: 5,
      custom_fields: { warranty_card: "WC-ALL", rack_no: 12, installed_on: "2026-02-01", floor: "First", insured: true },
    }]);
  });

  it("different values per asset: one value per row (aligned with the serials); blank rows use the common value", async () => {
    mockApi(info({ lines: [CAMERA], required_custom_fields: [FIELDS[0]] }));
    await ready();
    fillInvoice();
    typeSerials(1, "C1\nC2\nC3");
    fireEvent.click(screen.getByRole("button", { name: "Different values per asset" }));
    const perUnit = screen.getByLabelText(/Warranty card number — line 1/);
    // Only some assets covered and no common value: still needed.
    fireEvent.change(perUnit, { target: { value: "WC-1\n\nWC-3" } });
    await waitFor(() => expect(why()).toHaveTextContent("Warranty card number is needed for every asset (line 1)."));
    fireEvent.change(screen.getByLabelText("Warranty card number"), { target: { value: "WC-ALL" } });
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(lastBody().lines[0]).toEqual({
      line_no: 1, quantity: 3, serial_numbers: ["C1", "C2", "C3"],
      custom_fields: { warranty_card: "WC-ALL" },
      unit_custom_fields: [{ warranty_card: "WC-1" }, null, { warranty_card: "WC-3" }],
    });
  });

  it("per-asset values alone can cover every asset; too many rows is a problem", async () => {
    mockApi(info({ lines: [CAMERA], required_custom_fields: [FIELDS[0]] }));
    await ready();
    fillInvoice();
    typeSerials(1, "C1\nC2\nC3");
    fireEvent.click(screen.getByRole("button", { name: "Different values per asset" }));
    fireEvent.change(screen.getByLabelText(/Warranty card number — line 1/), { target: { value: "W1\nW2\nW3\nW4" } });
    await waitFor(() => expect(why()).toHaveTextContent("Line 1: Warranty card number: 4 values typed for 3 assets."));
    fireEvent.change(screen.getByLabelText(/Warranty card number — line 1/), { target: { value: "W1\nW2\nW3" } });
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(lastBody().lines[0].unit_custom_fields).toEqual([{ warranty_card: "W1" }, { warranty_card: "W2" }, { warranty_card: "W3" }]));
    expect(lastBody().lines[0].custom_fields).toBeUndefined();
  });
});

describe("Receive screen: why can't I receive?", () => {
  it.each([
    ["the invoice number", () => fireEvent.change(screen.getByLabelText(/invoice no/i), { target: { value: " " } }), "Enter the invoice number."],
    ["the invoice amount", () => fireEvent.change(screen.getByLabelText(/invoice amount/i), { target: { value: "" } }), "Enter the invoice amount (the invoice total)."],
    ["a negative amount", () => fireEvent.change(screen.getByLabelText(/invoice amount/i), { target: { value: "-5" } }), "The invoice amount must be a number, 0 or more."],
    ["the invoice date", () => fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: "" } }), "Enter the invoice date."],
    ["a future invoice date", () => fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: "2999-01-01" } }), "The invoice date cannot be in the future."],
    ["every quantity 0", () => [1, 2, 3].forEach((n) => fireEvent.change(qty(n), { target: { value: "0" } })), "Enter how many you are receiving on at least one line."],
    ["a serial count", () => typeSerials(1, "only-one"), "Line 1: 3 serial numbers needed, 1 entered."],
  ])("names %s next to the disabled button", async (_what, breakIt, sentence) => {
    mockApi();
    await ready();
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    breakIt();
    await waitFor(() => expect(why()).toHaveTextContent(`Why can't I receive? ${sentence}`));
    expect(receiveBtn()).toBeDisabled();
    expect(receiveBtn()).toHaveAttribute("aria-describedby", "receive-why");
  });

  it("shows the server's blockers (no code rule, nothing waiting) and never enables Receive", async () => {
    const rule = "No code rule (asset code format) is set up for this company yet. Ask the head-office admin to set it up.";
    mockApi(info({ blockers: [rule] }));
    await ready();
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    await waitFor(() => expect(why()).toHaveTextContent(rule));
    expect(receiveBtn()).toBeDisabled();
  });

  it("several problems: the first is named and the rest counted", async () => {
    mockApi();
    await ready();
    await waitFor(() => expect(why()).toHaveTextContent(/Enter the invoice number\. \(\d+ more things? to fix\)/));
  });
});

describe("Receive screen: keyboard", () => {
  it("Ctrl+Enter receives when everything is ready, does nothing while something is missing; Enter alone never submits", async () => {
    mockApi();
    await ready();
    fireEvent.keyDown(screen.getByLabelText(/invoice no/i), { key: "Enter", ctrlKey: true });
    expect(receiveCalls()).toHaveLength(0);
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.keyDown(screen.getByLabelText(/invoice no/i), { key: "Enter" });
    fireEvent.keyDown(box(1), { key: "Enter" });
    expect(receiveCalls()).toHaveLength(0);
    fireEvent.keyDown(box(1), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
  });
});

describe("Receive screen: a refused receipt (422) keeps everything typed", () => {
  it("maps problems to the receipt details, the line and the exact serial row, with one summary sentence", async () => {
    mockApi();
    await ready();
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    const problems = [
      { line_no: null, message: "The invoice date cannot be before the PO date (01-01-2026)." },
      { line_no: 1, unit_index: 2, serial: "B", message: "Serial number B is already used by asset FA/CKSPL/IT/0009." },
      { line_no: 2, message: "Only 3 are still waiting, so 5 cannot be received." },
    ];
    const postBase = (apiClient.post as any).getMockImplementation();
    (apiClient.post as any).mockImplementation((path: string, body: unknown) =>
      path === "/purchase-orders/1/receive"
        ? Promise.reject(Object.assign(new Error("Nothing was received: 3 problems need fixing."), { status: 422, body: { detail: "x", errors: [], problems } }))
        : postBase(path, body));
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());

    expect(await screen.findByText("Nothing was received: 3 problems need fixing, marked below. Everything you typed is still here.")).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Problems with the receipt details" })).toHaveTextContent("The invoice date cannot be before the PO date (01-01-2026).");
    expect(within(lineGroup(1)).getByRole("alert", { name: "Problems on line 1" })).toHaveTextContent("Serial number B is already used by asset FA/CKSPL/IT/0009.");
    expect(within(lineGroup(2)).getByRole("alert", { name: "Problems on line 2" })).toHaveTextContent("Only 3 are still waiting, so 5 cannot be received.");
    const marked = [...screen.getByTestId("serials-line-1-gutter").querySelectorAll("[data-problem]")].map((el) => el.getAttribute("data-row"));
    expect(marked).toEqual(["2"]);
    // Nothing typed was lost.
    expect(screen.getByLabelText(/invoice no/i)).toHaveValue("HI/771");
    expect(box(1)).toHaveValue("A\nB\nC");
    expect(qty(2)).toHaveValue(5);

    // Editing line 2 clears only line 2's refusal.
    fireEvent.change(qty(2), { target: { value: "3" } });
    await waitFor(() => expect(within(lineGroup(2)).queryByRole("alert")).not.toBeInTheDocument());
    expect(within(lineGroup(1)).getByRole("alert", { name: "Problems on line 1" })).toBeInTheDocument();
  });

  it("any other failure shows the server's sentence and keeps the form", async () => {
    mockApi();
    await ready();
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    const postBase = (apiClient.post as any).getMockImplementation();
    (apiClient.post as any).mockImplementation((path: string, body: unknown) =>
      path === "/purchase-orders/1/receive" ? Promise.reject(Object.assign(new Error("Line 2: This is Non-IT work, which is outside your work area."), { status: 403 })) : postBase(path, body));
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    expect(await screen.findByText("Line 2: This is Non-IT work, which is outside your work area.")).toBeInTheDocument();
    expect(box(1)).toHaveValue("A\nB\nC");
  });
});

describe("Receive screen: after receiving", () => {
  async function receiveWith(r: unknown) {
    mockApi();
    const postBase = (apiClient.post as any).getMockImplementation();
    (apiClient.post as any).mockImplementation((path: string, body: unknown) =>
      path === "/purchase-orders/1/receive" ? Promise.resolve(r) : postBase(path, body));
    const router = await ready();
    fillInvoice();
    typeSerials(1, "A\nB\nC");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await screen.findByRole("region", { name: "Received" });
    return router;
  }

  it("says what was made in plain words, lists the first 20 new codes and how many more", async () => {
    await receiveWith(result(25, { serial_pending: 2, waiting_units: 0 }));
    const panel = screen.getByRole("region", { name: "Received" });
    expect(panel).toHaveTextContent("25 assets created");
    expect(panel).toHaveTextContent("2 serial numbers pending");
    expect(panel).toHaveTextContent("Labels ready.");
    expect(within(within(panel).getByRole("list", { name: "New asset codes" })).getAllByRole("link")).toHaveLength(20);
    expect(within(panel).getByRole("link", { name: "FA/CKSPL/IT/0001" })).toHaveAttribute("href", "/assets/500");
    expect(panel).toHaveTextContent("and 5 more");
    expect(panel.textContent).not.toMatch(/pending_asset|converted|DELIVERED/);
  });

  it("Print labels opens the shared label dialog with the new assets", async () => {
    await receiveWith(result(3));
    fireEvent.click(screen.getByRole("button", { name: "Print labels (3)" }));
    expect(await screen.findByRole("dialog", { name: /print 3 labels/i })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/assets?ids=500%2C501%2C502&limit=200"));
  });

  it("Open assets shows exactly the new assets in the register", async () => {
    const router = await receiveWith(result(3));
    fireEvent.click(screen.getByRole("button", { name: "Open assets" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/assets"));
    expect(router.state.location.search).toEqual({ ids: "500,501,502" });
    expect(await screen.findByText("Showing only the 3 new assets.")).toBeInTheDocument();
    await waitFor(() => expect((apiClient.get as any).mock.calls.some(([p]: [string]) => p.startsWith("/assets?ids=500%2C501%2C502&"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Show all assets" }));
    await waitFor(() => expect(screen.queryByText(/Showing only the 3 new assets/)).not.toBeInTheDocument());
  });

  it("Receive more: back to this PO's fresh form while units still wait", async () => {
    await receiveWith(result(3, { waiting_units: 7, po_status: "PARTLY_RECEIVED" }));
    expect(screen.getByRole("region", { name: "Received" })).toHaveTextContent("7 units still waiting on PO SPO/012247.");
    currentInfo = info({ lines: [line({ ...CAMERA, received_before: 3, waiting: 0, status: "RECEIVED" }), GANG_BOX, ACCESS_POINT] });
    fireEvent.click(screen.getByRole("button", { name: "Receive more" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Received" })).not.toBeInTheDocument());
    await waitFor(() => expect(receiveBtn()).toHaveTextContent("Receive 7 units"));
    expect(screen.getByLabelText(/invoice no/i)).toHaveValue("");
  });

  it("Receive more: to the Receive queue when nothing is left waiting", async () => {
    const router = await receiveWith(result(3, { waiting_units: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Receive more" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/receive"));
  });
});

describe("Receive screen: 100 units are one interaction", () => {
  it("a 100-unit line takes 100 pasted serials in one box, renders no per-unit rows, and sends them in order", async () => {
    mockApi(info({ lines: [line({ line_no: 1, ordered: 100, waiting: 100 }), line({ ...GANG_BOX, ordered: 100, waiting: 100 })] }));
    await ready();
    const serials = Array.from({ length: 100 }, (_, i) => `CAM-${String(i + 1).padStart(4, "0")}`);
    fillInvoice();
    // One paste, one duplicate at rows 7 and 93.
    const withDup = [...serials];
    withDup[92] = serials[6];
    typeSerials(1, withDup.join("\n"));
    expect(await within(lineGroup(1)).findByText("CAM-0007 is typed more than once in this box (rows 7 and 93).")).toBeInTheDocument();
    typeSerials(1, serials.join("\n"));
    expect(await within(lineGroup(1)).findByText("100 of 100 entered")).toBeInTheDocument();
    // No unit rows: the only text inputs are the 2 quantities, the invoice fields and the one box.
    expect(screen.getAllByRole("textbox").length).toBeLessThanOrEqual(3);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(3); // 2 quantities + invoice amount
    expect(receiveBtn()).toHaveTextContent("Receive 200 units");
    await waitFor(() => expect(receiveBtn()).not.toBeDisabled());
    fireEvent.click(receiveBtn());
    await waitFor(() => expect(receiveCalls()).toHaveLength(1));
    expect(lastBody().lines[0].serial_numbers).toEqual(serials);
    expect(lastBody().lines[1]).toEqual({ line_no: 2, quantity: 100 });
  });
});

describe("Receive screen: loading and access", () => {
  it("a PO that cannot be loaded shows the server's sentence with Try again", async () => {
    (apiClient.get as any).mockImplementation((path: string) =>
      path === "/purchase-orders/1/receive-info" ? Promise.reject(new Error("Purchase order not found.")) : Promise.resolve([]));
    renderAt();
    expect(await screen.findByText("Purchase order not found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("is guarded like /receive: a viewer gets the no-access page", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "VIEWER", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    mockApi();
    renderAt();
    expect(await screen.findByText(/don't have access/i)).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/purchase-orders/1/receive-info");
  });
});
