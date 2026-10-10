import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const asset = (id: number, code: string, over: Record<string, unknown> = {}) => ({
  id, asset_code: code, serial_number: `SN-${id}`, serial_pending: false, description: "Dell Laptop", item_name: "Laptop",
  erp_item_code: "CT111", status: "IN_STOCK", ...over,
});
const LAPTOP = asset(1, "FA/IT/LAP/1");
const AMP = asset(2, "FA/AV/AMP/2", { serial_number: null, serial_pending: true, item_name: "Amplifier", erp_item_code: null });
const MICE = [10, 11, 12, 13, 14, 15, 16].map((i) => asset(i, `FA/IT/MSE/${i}`, { serial_number: null, item_name: "Mouse", erp_item_code: null }));

const USERS = [
  { id: 5, name: "WH Stock", asset_user_type: "STOCK_POINT" },
  { id: 6, name: "Store Hisar", asset_user_type: "STORE" },
  { id: 7, name: "Ravi (employee)", asset_user_type: "EMPLOYEE" },
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

async function renderDispatch() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/dispatch"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByLabelText(/scan the serial number/i);
}

async function scan(value: string) {
  const input = screen.getByLabelText(/scan the serial number/i);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

async function chooseDestination() {
  fireEvent.click(screen.getByRole("combobox", { name: "Send to" }));
  fireEvent.click(await screen.findByRole("option", { name: "Store Hisar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); } catch { /* no storage here */ }
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;   // label pictures: not what these tests are about
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
  window.URL.revokeObjectURL = vi.fn();
  window.print = vi.fn();
  (apiClient.post as any).mockResolvedValue({ moved: 1, failed: [] });
});
afterEach(() => useAuthStore.getState().logout());

describe("Dispatch", () => {
  it("scanning a serial finds the asset and prints its label straight away", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderDispatch();
    await scan("SN-1");
    expect(await screen.findByText("FA/IT/LAP/1")).toBeInTheDocument();
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Printed")).toBeInTheDocument());
    expect(screen.getByText(/In this dispatch \(1\)/)).toBeInTheDocument();
  });

  it("looks for a whole serial / code first, so a scan lands on exactly one asset", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderDispatch();
    await scan("SN-1");
    await screen.findByText("FA/IT/LAP/1");
    expect(apiClient.get).toHaveBeenCalledWith("/assets?q=SN-1&limit=5&exact=true");
  });

  it("says so when nothing matches, and when the asset is already in this dispatch", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderDispatch();
    await scan("NOPE");
    expect(await screen.findByRole("alert")).toHaveTextContent('No asset found matching "NOPE"');
    await scan("SN-1");
    await screen.findByText("FA/IT/LAP/1");
    await scan("SN-1");
    expect(await screen.findByText(/already in this dispatch/i)).toBeInTheDocument();
    expect(screen.getByText(/In this dispatch \(1\)/)).toBeInTheDocument();
  });

  it("an asset whose serial is still pending is dispatched by its asset code, and its label says so", async () => {
    mockGets({ "FA/AV/AMP/2": [AMP] });
    await renderDispatch();
    await scan("FA/AV/AMP/2");
    expect(await screen.findByText(/SN: to be added/)).toBeInTheDocument();
  });

  it("the QR on a label (a link to the asset) is understood as that asset", async () => {
    mockGets({ "ids:9": [asset(9, "FA/IT/LAP/9")] });
    await renderDispatch();
    await scan("http://10.0.1.98:3211/assets/9");
    expect(await screen.findByText("FA/IT/LAP/9")).toBeInTheDocument();
  });

  it("with 'print as I scan' off nothing prints until asked, and unprinted labels can be printed together", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderDispatch();
    fireEvent.click(screen.getByRole("checkbox", { name: /print the label as i scan/i }));
    await scan("SN-1");
    await screen.findByText("FA/IT/LAP/1");
    await scan("FA/AV/AMP/2");
    await screen.findByText("FA/AV/AMP/2");
    expect(window.print).not.toHaveBeenCalled();
    expect(screen.getAllByText("Label not printed")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /print 2 labels not printed yet/i }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText("Printed")).toHaveLength(2));
  });

  it("moves everything scanned to the store in one click", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderDispatch();
    await scan("SN-1");
    await screen.findByText("FA/IT/LAP/1");
    await scan("FA/AV/AMP/2");
    await screen.findByText("FA/AV/AMP/2");

    const move = () => screen.getByRole("button", { name: /^move 2 assets/i });
    expect(move()).toBeDisabled();                                   // no store chosen yet
    await chooseDestination();
    expect(move()).toBeEnabled();
    expect(move()).toHaveTextContent("Move 2 assets to Store Hisar");
    (apiClient.post as any).mockResolvedValue({ moved: 2, failed: [] });
    fireEvent.click(move());
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/bulk-move", { asset_ids: [1, 2], to_asset_user_id: 6 }));
    expect(await screen.findByRole("status")).toHaveTextContent("Moved 2 assets.");
    expect(screen.getByText(/In this dispatch \(0\)/)).toBeInTheDocument();
  });

  it("an asset that could not be moved stays in the list with the reason", async () => {
    mockGets({ "SN-1": [LAPTOP], "FA/AV/AMP/2": [AMP] });
    await renderDispatch();
    await scan("SN-1");
    await screen.findByText("FA/IT/LAP/1");
    await scan("FA/AV/AMP/2");
    await screen.findByText("FA/AV/AMP/2");
    await chooseDestination();
    (apiClient.post as any).mockResolvedValue({ moved: 1, failed: [{ asset_id: 2, reason: "asset is already scrapped" }] });
    fireEvent.click(screen.getByRole("button", { name: /^move 2 assets/i }));
    expect(await screen.findByText(/FA\/AV\/AMP\/2: asset is already scrapped/)).toBeInTheDocument();
    expect(screen.getByText(/In this dispatch \(1\)/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Moved 1 asset; 1 could not be moved");
  });

  it("only stores and stock points are offered as the destination", async () => {
    mockGets();
    await renderDispatch();
    fireEvent.click(screen.getByRole("combobox", { name: "Send to" }));
    expect(await screen.findByRole("option", { name: "Store Hisar" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "WH Stock" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Ravi/ })).not.toBeInTheDocument();
  });

  it("no serial to scan: add 7 mice by Item, one label each, printed together", async () => {
    mockGets();
    const labelsOnThePage: number[] = [];
    window.print = vi.fn(() => { labelsOnThePage.push(document.querySelectorAll(".print-labels-sheet .print-label").length); });
    await renderDispatch();
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Sending from" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /add 7 to this dispatch/i }));

    expect(await screen.findByText(/In this dispatch \(7\)/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/assets?item_id=31&asset_user_id=5&status=IN_STOCK&limit=200");
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));            // one print job, seven labels
    expect(labelsOnThePage).toEqual([7]);                                          // all seven labels were on the page when it printed
    await waitFor(() => expect(screen.getAllByText("Printed")).toHaveLength(7));
  });

  it("asking for more than are in stock adds nothing and says how many there are", async () => {
    mockGets();
    await renderDispatch();
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Mouse" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Sending from" }));
    fireEvent.click(await screen.findByRole("option", { name: "WH Stock" }));
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /add 9 to this dispatch/i }));
    expect(await screen.findByText(/Only 7 of that Item are in stock there/)).toBeInTheDocument();
    expect(screen.getByText(/In this dispatch \(0\)/)).toBeInTheDocument();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("with confirm-by-scanning on, Move waits until each label has been scanned back", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderDispatch();
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm each label by scanning it/i }));
    await scan("SN-1");
    await screen.findByText("FA/IT/LAP/1");
    await waitFor(() => expect(screen.getByText("Printed: scan the label")).toBeInTheDocument());
    await chooseDestination();
    expect(screen.getByRole("button", { name: /^move 1 asset/i })).toBeDisabled();
    expect(screen.getByText(/1 label is not confirmed yet/)).toBeInTheDocument();

    await scan("FA/IT/LAP/1");                                           // scanning the stuck-on label ticks it off
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^move 1 asset/i })).toBeEnabled();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining("q=FA%2FIT%2FLAP%2F1"));   // no second search needed
  });

  it("a label can be reprinted, and an asset taken out again", async () => {
    mockGets({ "SN-1": [LAPTOP] });
    await renderDispatch();
    await scan("SN-1");
    await screen.findByText("FA/IT/LAP/1");
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Print label for FA/IT/LAP/1" })).toHaveTextContent("Reprint"));
    fireEvent.click(screen.getByRole("button", { name: "Print label for FA/IT/LAP/1" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Remove FA/IT/LAP/1" }));
    expect(screen.getByText(/In this dispatch \(0\)/)).toBeInTheDocument();
  });

  it("is a menu entry for people who may edit assets", async () => {
    mockGets();
    await renderDispatch();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Dispatch" })).toHaveAttribute("href", "/dispatch");
  });
});
