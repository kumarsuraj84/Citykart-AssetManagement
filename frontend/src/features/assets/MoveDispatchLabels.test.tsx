import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

// Move, sending to a store: labels print as each asset is scanned, and "add by Item"
// covers assets that have no serial to scan.

const asset = (id: number, code: string, over: Record<string, unknown> = {}) => ({
  id, asset_code: code, serial_number: `SN-${id}`, serial_pending: false, description: "Dell Laptop", item_name: "Laptop",
  erp_item_code: "CT111", status: "IN_STOCK", current_asset_user_name: "WH Stock", current_asset_user_location_name: "WH",
  current_asset_user_type: "STOCK_POINT", ...over,
});
const LAPTOP = asset(1, "FA/IT/LAP/1");
const AMP = asset(2, "FA/AV/AMP/2", { serial_number: null, serial_pending: true, item_name: "Amplifier", erp_item_code: null });
const MICE = [10, 11, 12, 13, 14, 15, 16].map((i) => asset(i, `FA/IT/MSE/${i}`, { serial_number: null, item_name: "Mouse", erp_item_code: null }));

const USERS = [
  { id: 5, name: "WH Stock", asset_user_type: "STOCK_POINT" },
  { id: 6, name: "Store Hisar", asset_user_type: "STORE" },
  { id: 7, name: "Ravi Kumar", asset_user_type: "EMPLOYEE" },
];
const ITEMS = [{ id: 31, name: "Mouse", category_id: 1, subcategory_id: 2, serial_required: false, serial_later: false, bundle_id: null, default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0 }];

/** Move's "Add by Item": GET /assets/pick answers the oldest `quantity` in stock and X-Total-Count. */
function mockPick(stock: { id: number; asset_code: string; serial_number: string | null }[]) {
  (apiClient.getPage as any).mockImplementation((path: string) => {
    if (!path.startsWith("/assets/pick?")) return Promise.resolve({ data: [], total: 0 });
    const quantity = Number(/[?&]quantity=(\d+)/.exec(path)?.[1] ?? 0);
    const rows = stock.slice(0, quantity).map((a) => ({ asset_id: a.id, asset_code: a.asset_code, serial_number: a.serial_number }));
    return Promise.resolve({ data: rows, total: stock.length });
  });
}

function mockGets(found: Record<string, unknown[]> = {}, pool: { id: number }[] = MICE) {
  mockPick(MICE);
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/asset-users") return Promise.resolve(USERS);
    // "Currently in stock at" lists stock rooms from GET /stock-rooms (S3b-1).
    if (path === "/stock-rooms") return Promise.resolve(USERS.filter((u) => u.asset_user_type === "STOCK_POINT"));
    if (path === "/items?work_area=mine") return Promise.resolve(ITEMS);
    if (path.startsWith("/assets?")) {
      const q = /[?&]q=([^&]*)/.exec(path);
      const ids = /[?&]ids=([^&]*)/.exec(path);
      const key = decodeURIComponent(ids ? `ids:${ids[1]}` : q ? q[1] : "");
      if (ids && !(key in found)) {
        const wanted = decodeURIComponent(ids[1]).split(",").map(Number);
        const items = pool.filter((a) => wanted.includes(a.id));
        return Promise.resolve({ items, total: items.length });
      }
      const items = found[key] ?? [];
      return Promise.resolve({ items, total: items.length });
    }
    return Promise.resolve([]);
  });
}

async function renderMovement(url = "/asset-movement") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByLabelText(/scan or type/i);
  return router;
}

function scan(value: string) {
  const input = screen.getByLabelText(/scan or type/i);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function choose(name: string) {
  fireEvent.click(screen.getByRole("radio", { name }));
}

async function chooseDestination(picker = "Store", name = "Store Hisar") {
  fireEvent.click(screen.getByRole("combobox", { name: picker }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

function openLabelSettings() {
  fireEvent.click(screen.getByRole("button", { name: /label settings/i }));
}

const applyButton = (label: string, n: number) => screen.getByRole("button", { name: `${label} (${n} asset${n === 1 ? "" : "s"})` });

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); } catch { /* no storage here */ }
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;   // label pictures: not what these tests are about
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
  window.URL.revokeObjectURL = vi.fn();
  window.print = vi.fn();
  (apiClient.post as any).mockResolvedValue({ done: 1, failed: [] });
});
afterEach(() => useAuthStore.getState().logout());

describe("Move: Send to Store prints labels as assets are scanned", () => {
  it("scanning a serial finds the asset and prints its label straight away", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    choose("Send to Store");
    scan("SN-1");
    expect(await screen.findByText(/FA\/IT\/LAP\/1/)).toBeInTheDocument();
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Printed")).toBeInTheDocument());
    expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument();
  });

  it("looks for a whole serial / code first, so a scan lands on exactly one asset", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    expect(apiClient.get).toHaveBeenCalledWith("/assets?q=SN-1&exact=true&limit=5");
  });

  it("says so when nothing matches, and when the asset is already in this batch", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    choose("Send to Store");
    scan("NOPE");
    expect(await screen.findByRole("alert")).toHaveTextContent('No asset found matching "NOPE"');
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    scan("SN-1");
    expect(await screen.findByText(/already in this batch/i)).toBeInTheDocument();
    expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument();
    expect(window.print).toHaveBeenCalledTimes(1);                                // not printed twice
  });

  it("an asset whose serial is still pending is moved by its asset code, and the row says so", async () => {
    mockGets({ "FA/AV/AMP/2": [AMP] });
    await renderMovement();
    scan("FA/AV/AMP/2");
    expect(await screen.findByText(/serial to be added/)).toBeInTheDocument();
  });

  it("the QR on a label (a link to the asset) is understood as that asset", async () => {
    mockGets({ "ids:9": [asset(9, "FA/IT/LAP/9")] });
    await renderMovement();
    scan("http://10.0.1.98:3211/assets/9");
    expect(await screen.findByText(/FA\/IT\/LAP\/9/)).toBeInTheDocument();
  });

  it("with 'print labels as I scan' off nothing prints until asked, and unprinted labels can be printed together", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderMovement();
    choose("Send to Store");
    fireEvent.click(screen.getByRole("checkbox", { name: /print labels as i scan/i }));
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    scan("FA/AV/AMP/2");
    await screen.findByText(/FA\/AV\/AMP\/2/);
    expect(window.print).not.toHaveBeenCalled();
    expect(screen.getAllByText("Label not printed")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /print 2 labels not printed yet/i }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText("Printed")).toHaveLength(2));
  });

  it("the 'print as I scan' choice is remembered in this browser", async () => {
    mockGets();
    await renderMovement();
    choose("Send to Store");
    fireEvent.click(screen.getByRole("checkbox", { name: /print labels as i scan/i }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("ckam.movement.prefs") ?? "{}")).toMatchObject({ autoPrint: false }));
  });

  it("a label can be reprinted, and an asset taken out again", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    choose("Send to Store");
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Print label for FA/IT/LAP/1" })).toHaveTextContent("Reprint"));
    fireEvent.click(screen.getByRole("button", { name: "Print label for FA/IT/LAP/1" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Remove FA/IT/LAP/1" }));
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
  });

  it("sends everything scanned to the store in one click", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderMovement();
    choose("Send to Store");
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    scan("FA/AV/AMP/2");
    await screen.findByText(/FA\/AV\/AMP\/2/);

    expect(applyButton("Send to Store", 2)).toBeDisabled();                  // no store chosen yet
    expect(screen.getByText("Choose the store.")).toBeInTheDocument();
    await chooseDestination();
    expect(applyButton("Send to Store", 2)).toBeEnabled();
    (apiClient.post as any).mockResolvedValue({ done: 2, failed: [] });
    fireEvent.click(applyButton("Send to Store", 2));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/assets/bulk-action", {
        asset_ids: [1, 2], event_type: "MOVED", to_asset_user_id: 6, remarks: null,
      }),
    );
    expect(await screen.findByTestId("bulk-action-done-count")).toHaveTextContent("2");
    expect(screen.getByTestId("move-result")).toHaveTextContent("2 assets sent to the store.");
  });

  it("an asset that could not be moved stays in the queue with the reason, named by its code", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderMovement();
    choose("Send to Store");
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    scan("FA/AV/AMP/2");
    await screen.findByText(/FA\/AV\/AMP\/2/);
    await chooseDestination();
    (apiClient.post as any).mockResolvedValue({ done: 1, failed: [{ asset_id: 2, reason: "This asset is scrapped, so it cannot be moved." }] });
    fireEvent.click(applyButton("Send to Store", 2));
    expect(await screen.findByText("FA/AV/AMP/2: This asset is scrapped, so it cannot be moved.")).toBeInTheDocument();
    expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument();
  });

  it("no serial to scan: add 7 mice by Item, one label each, printed together", async () => {
    mockGets();
    const labelsOnThePage: number[] = [];
    window.print = vi.fn(() => { labelsOnThePage.push(document.querySelectorAll(".print-labels-sheet .print-label").length); });
    await renderMovement();
    choose("Send to Store");
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Currently in stock at" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /add 7 to this batch/i }));

    expect(await screen.findByText(/Queued \(7\)/)).toBeInTheDocument();
    // One pick (oldest first, server-side) instead of searching page by page.
    expect(apiClient.getPage).toHaveBeenCalledWith("/assets/pick?item_id=31&asset_user_id=5&quantity=7");
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining("/assets?item_id="));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));            // one print job, seven labels
    expect(labelsOnThePage).toEqual([7]);
    await waitFor(() => expect(screen.getAllByText("Printed")).toHaveLength(7));
  });

  it("asking for more than are in stock adds nothing and says how many there are", async () => {
    mockGets();
    await renderMovement();
    choose("Send to Store");
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Currently in stock at" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /add 9 to this batch/i }));
    expect(await screen.findByText("Only 7 in stock at WH Stock — you asked for 9. Nothing was added.")).toBeInTheDocument();
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("with confirm-by-scanning on (inside Label settings), the move waits until each label has been scanned back", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    choose("Send to Store");
    expect(screen.queryByRole("checkbox", { name: /confirm each label by scanning it/i })).not.toBeInTheDocument();
    openLabelSettings();
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm each label by scanning it/i }));
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    await waitFor(() => expect(screen.getByText("Printed: scan the label")).toBeInTheDocument());
    await chooseDestination();
    expect(applyButton("Send to Store", 1)).toBeDisabled();
    expect(screen.getByText(/1 label is not confirmed yet/)).toBeInTheDocument();

    scan("FA/IT/LAP/1");                                                // scanning the stuck-on label ticks it off
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeInTheDocument());
    expect(applyButton("Send to Store", 1)).toBeEnabled();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining("q=FA%2FIT%2FLAP%2F1"));   // no second search needed
  });

  it("the label controls belong to sending to a store: any other choice neither prints nor shows them", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    expect(screen.queryByRole("checkbox", { name: /print labels as i scan/i })).not.toBeInTheDocument();
    choose("Send to Store");
    expect(screen.getByRole("checkbox", { name: /print labels as i scan/i })).toBeInTheDocument();
    for (const other of ["Give to Employee", "Move to Stock Room", "Install", "Send for Repair"]) {
      choose(other);
      expect(screen.queryByRole("checkbox", { name: /print labels as i scan/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /label settings/i })).not.toBeInTheDocument();
    }
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    expect(window.print).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /print label for/i })).not.toBeInTheDocument();
  });

  it("S5a: all label settings sit in one closed 'Label settings' disclosure that shows the current setup", async () => {
    mockGets();
    await renderMovement();
    choose("Send to Store");
    const toggle = screen.getByRole("button", { name: /label settings/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Barcode + QR · 70 × 20 mm");          // the defaults
    expect(screen.queryByRole("combobox", { name: "Label Contains" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Label Size" })).not.toBeInTheDocument();
    openLabelSettings();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Label Contains" })).toHaveTextContent(/Barcode \+ QR/);
    expect(screen.getByRole("combobox", { name: "Label Size" })).toHaveTextContent("70 × 20 mm");
    expect(screen.getAllByTestId("label-settings")).toHaveLength(1);
  });
});

describe("S0: the destination follows the server's rule", () => {
  it.each([
    ["Give to Employee", "Employee"],
    ["Move to Stock Room", "Stock Room"],
    ["Send to Store", "Store"],
    ["Install", "Install Point"],
    ["Receive from Repair", "Received into"],
  ])("%s asks for a destination (%s) and will not apply without one", async (choice, label) => {
    mockGets();
    await renderMovement();
    choose(choice);
    expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
  });

  it.each(["Send for Repair", "Report Lost", "Dispose", "Sell", "Scrap"])(
    "%s has no destination picker, and a destination chosen earlier is not sent",
    async (choice) => {
      mockGets({ "SN-1": [LAPTOP] });
      await renderMovement();
      scan("SN-1");
      await screen.findByText(/FA\/IT\/LAP\/1/);
      choose("Send to Store");
      await chooseDestination();                                    // chosen while the choice was "Send to Store"
      choose(choice);
      expect(screen.queryByRole("combobox", { name: /^(employee|store|stock room|install point|received into)$/i })).not.toBeInTheDocument();
      fireEvent.click(applyButton(choice, 1));
      // S7 P2-8: Sell / Scrap / Dispose are final: confirmed first.
      if (["Dispose", "Sell", "Scrap"].includes(choice)) {
        const confirm = await screen.findByRole("alertdialog");
        fireEvent.click(within(confirm).getByRole("button", { name: `${choice} 1 asset` }));
      }
      await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
      expect((apiClient.post as any).mock.calls.at(-1)[1]).toMatchObject({ to_asset_user_id: null });
    },
  );

  it("the server's refusal for an asset is listed with its plain sentence", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    choose("Send to Store");
    await chooseDestination();
    (apiClient.post as any).mockResolvedValue({ done: 0, failed: [{ asset_id: 1, reason: "Store Hisar is no longer active, so assets cannot be sent there." }] });
    fireEvent.click(applyButton("Send to Store", 1));
    expect(await screen.findByText("FA/IT/LAP/1: Store Hisar is no longer active, so assets cannot be sent there.")).toBeInTheDocument();
  });

  it("a whole-request refusal (422 sentence) is shown", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    choose("Send to Store");
    await chooseDestination();
    (apiClient.post as any).mockRejectedValue(new Error("You can choose at most 1,000 assets at a time."));
    fireEvent.click(applyButton("Send to Store", 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can choose at most 1,000 assets at a time.");
  });
});

describe("S0: quantities are 1 to 1,000", () => {
  it("Qty must be a whole number from 1 to 1,000: the hint is printed and a bad value blocks adding", async () => {
    mockGets({ keyboard: [LAPTOP] });
    await renderMovement();
    expect(screen.getAllByText(/Whole number, 1 to 1,000\./)).toHaveLength(2);   // under Qty and under "How many"
    const qty = screen.getByLabelText(/^qty$/i);
    expect(qty).toHaveAttribute("max", "1000");
    const add = screen.getByRole("button", { name: /^add$/i });

    for (const [value, sentence] of [["0", /enter at least 1/i], ["1001", /at most 1,000/i], ["2.5", /whole number\./i], ["", /enter how many/i]] as const) {
      fireEvent.change(qty, { target: { value } });
      expect(await screen.findByText(sentence)).toBeInTheDocument();
      expect(add).toBeDisabled();
      scan("keyboard");                                             // Enter does nothing either
    }
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining("q=keyboard"));

    fireEvent.change(qty, { target: { value: "1000" } });
    await waitFor(() => expect(add).toBeEnabled());
  });

  it("Qty above 200 never asks the server for more than its 200-per-search limit", async () => {
    mockGets({ keyboard: [LAPTOP] });
    await renderMovement();
    fireEvent.change(screen.getByLabelText(/^qty$/i), { target: { value: "800" } });
    scan("keyboard");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("q=keyboard&limit=200")));
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining("limit=500"));
  });

  it("'How many' by Item is 1 to 1,000 too: a bad value shows the hint and blocks the button", async () => {
    mockGets();
    await renderMovement();
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Currently in stock at" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    const how = screen.getByLabelText("How many");
    expect(how).toHaveAttribute("max", "1000");
    for (const value of ["0", "1001", "-4"]) {
      fireEvent.change(how, { target: { value } });
      expect(screen.getByRole("button", { name: /to this batch/i })).toBeDisabled();
    }
    expect(screen.getByText(/At most 1,000 at a time\.|Enter at least 1\./)).toBeInTheDocument();
    fireEvent.change(how, { target: { value: "1000" } });
    expect(screen.getByRole("button", { name: /add 1000 to this batch/i })).toBeEnabled();
  });

  it("S5b-1: 450 by Item is one pick (the server picks the oldest), then their rows by id", async () => {
    const MANY = Array.from({ length: 450 }, (_, i) => asset(1000 + i, `FA/IT/MSE/${1000 + i}`, { serial_number: null, item_name: "Mouse", erp_item_code: null }));
    mockGets({}, MANY);
    mockPick(MANY);
    await renderMovement();
    choose("Send for Repair");                                       // no labels to print
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Currently in stock at" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "450" } });
    fireEvent.click(screen.getByRole("button", { name: /add 450 to this batch/i }));
    expect(await screen.findByText(/Queued \(450\)/)).toBeInTheDocument();
    expect(apiClient.getPage).toHaveBeenCalledTimes(1);
    expect(apiClient.getPage).toHaveBeenCalledWith("/assets/pick?item_id=31&asset_user_id=5&quantity=450");
  });

  it("S5b-1: the ones already in this batch are not counted twice: it asks for more and says how many are in the batch", async () => {
    mockGets();
    await renderMovement();
    choose("Send for Repair");
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Currently in stock at" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /add 5 to this batch/i }));
    expect(await screen.findByText(/Queued \(5\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add 5 to this batch/i }));
    await waitFor(() => expect(apiClient.getPage).toHaveBeenLastCalledWith("/assets/pick?item_id=31&asset_user_id=5&quantity=10"));
    expect(await screen.findByText("Only 7 in stock at WH Stock (5 already in this batch) — you asked for 5. Nothing was added.")).toBeInTheDocument();
    expect(screen.getByText(/Queued \(5\)/)).toBeInTheDocument();
  });
});

describe("Move is one screen", () => {
  it("is a single menu entry, and the old Dispatch address goes to it", async () => {
    mockGets();
    const router = await renderMovement("/dispatch");
    expect(router.state.location.pathname).toBe("/asset-movement");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Move" })).toHaveAttribute("href", "/asset-movement");
    expect(within(nav).queryByRole("link", { name: "Dispatch" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Asset Movement" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Move" })).toBeInTheDocument();
  });
});
