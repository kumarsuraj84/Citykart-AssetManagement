import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

// Move / Dispatch: the Asset Movement screen with labels that print as each asset is scanned
// for a move, and "add by Item" for assets that have no serial to scan.

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
];
const ITEMS = [{ id: 31, name: "Mouse", category_id: 1, subcategory_id: 2, serial_required: false, serial_later: false, bundle_id: null, default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0 }];

function mockGets(found: Record<string, unknown[]> = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/asset-users") return Promise.resolve(USERS);
    if (path === "/items") return Promise.resolve(ITEMS);
    if (path.startsWith("/assets?item_id=31")) return Promise.resolve({ items: MICE, total: MICE.length });
    if (path.startsWith("/assets?")) {
      const q = /[?&]q=([^&]*)/.exec(path);
      const ids = /[?&]ids=([^&]*)/.exec(path);
      const key = decodeURIComponent(ids ? `ids:${ids[1]}` : q ? q[1] : "");
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

async function chooseDestination(name = "Store Hisar") {
  fireEvent.click(screen.getByRole("combobox", { name: "Destination Asset User" }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

const applyButton = (n: number) => screen.getByRole("button", { name: new RegExp(`^apply .*to ${n} asset`, "i") });

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

describe("Move / Dispatch: labels print as assets are scanned for a move", () => {
  it("scanning a serial finds the asset and prints its label straight away", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
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

  it("with 'print as I scan' off nothing prints until asked, and unprinted labels can be printed together", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderMovement();
    fireEvent.click(screen.getByRole("checkbox", { name: /print the label as i scan/i }));
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

  it("a label can be reprinted, and an asset taken out again", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Print label for FA/IT/LAP/1" })).toHaveTextContent("Reprint"));
    fireEvent.click(screen.getByRole("button", { name: "Print label for FA/IT/LAP/1" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Remove FA/IT/LAP/1" }));
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
  });

  it("moves everything scanned to the store in one click", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderMovement();
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    scan("FA/AV/AMP/2");
    await screen.findByText(/FA\/AV\/AMP\/2/);

    expect(applyButton(2)).toBeDisabled();                                   // no destination chosen yet
    await chooseDestination();
    expect(applyButton(2)).toBeEnabled();
    (apiClient.post as any).mockResolvedValue({ done: 2, failed: [] });
    fireEvent.click(applyButton(2));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/assets/bulk-action", expect.objectContaining({
        asset_ids: [1, 2], event_type: "MOVED", to_asset_user_id: 6,
      })),
    );
    expect(await screen.findByTestId("bulk-action-done-count")).toHaveTextContent("2");
  });

  it("an asset that could not be moved stays in the queue with the reason", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderMovement();
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    scan("FA/AV/AMP/2");
    await screen.findByText(/FA\/AV\/AMP\/2/);
    await chooseDestination();
    (apiClient.post as any).mockResolvedValue({ done: 1, failed: [{ asset_id: 2, reason: "asset is already scrapped" }] });
    fireEvent.click(applyButton(2));
    expect(await screen.findByText(/Asset #2: asset is already scrapped/)).toBeInTheDocument();
    expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument();
  });

  it("no serial to scan: add 7 mice by Item, one label each, printed together", async () => {
    mockGets();
    const labelsOnThePage: number[] = [];
    window.print = vi.fn(() => { labelsOnThePage.push(document.querySelectorAll(".print-labels-sheet .print-label").length); });
    await renderMovement();
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Currently in stock at" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /add 7 to this batch/i }));

    expect(await screen.findByText(/Queued \(7\)/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/assets?item_id=31&asset_user_id=5&status=IN_STOCK&limit=200");
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));            // one print job, seven labels
    expect(labelsOnThePage).toEqual([7]);
    await waitFor(() => expect(screen.getAllByText("Printed")).toHaveLength(7));
  });

  it("asking for more than are in stock adds nothing and says how many there are", async () => {
    mockGets();
    await renderMovement();
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Currently in stock at" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /add 9 to this batch/i }));
    expect(await screen.findByText(/Only 7 of that Item are in stock there/)).toBeInTheDocument();
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("with confirm-by-scanning on, the move waits until each label has been scanned back", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm each label by scanning it/i }));
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    await waitFor(() => expect(screen.getByText("Printed: scan the label")).toBeInTheDocument());
    await chooseDestination();
    expect(applyButton(1)).toBeDisabled();
    expect(screen.getByText(/1 label is not confirmed yet/)).toBeInTheDocument();

    scan("FA/IT/LAP/1");                                                // scanning the stuck-on label ticks it off
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeInTheDocument());
    expect(applyButton(1)).toBeEnabled();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining("q=FA%2FIT%2FLAP%2F1"));   // no second search needed
  });

  it("the label controls belong to a move: another action neither prints nor asks about labels", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderMovement();
    expect(screen.getByRole("checkbox", { name: /print the label as i scan/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Action" }));
    fireEvent.click(await screen.findByRole("option", { name: "Send for Repair" }));
    expect(screen.queryByRole("checkbox", { name: /print the label as i scan/i })).not.toBeInTheDocument();
    scan("SN-1");
    await screen.findByText(/FA\/IT\/LAP\/1/);
    expect(window.print).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /print label for/i })).not.toBeInTheDocument();
  });
});

describe("Move / Dispatch is one screen", () => {
  it("is a single menu entry, and the old Dispatch address goes to it", async () => {
    mockGets();
    const router = await renderMovement("/dispatch");
    expect(router.state.location.pathname).toBe("/asset-movement");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Move / Dispatch" })).toHaveAttribute("href", "/asset-movement");
    expect(within(nav).queryByRole("link", { name: "Dispatch" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Asset Movement" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Move / Dispatch" })).toBeInTheDocument();
  });
});
