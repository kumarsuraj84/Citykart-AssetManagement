import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const row = (id: number, code: string, over: Record<string, unknown> = {}) => ({
  id, asset_code: code, description: "Amplifier 100W", item_name: "Amplifier", category_name: "Admin Fixed Assets",
  subcategory_name: "Audio", current_asset_user_name: "Store Hisar", current_asset_user_location_name: "Hisar",
  purchase_date: "2026-09-01", status: "ALLOTTED", serial_pending: true, ...over,
});
const LIST = { items: [row(1, "FA/AMP/1"), row(2, "FA/AMP/2", { current_asset_user_name: "Store Rohtak", purchase_date: "2026-08-01" })], total: 2 };

function renderScreen() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/serial-pending"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/assets?serial_pending=true")) return Promise.resolve(LIST);
    return Promise.resolve([]);
  });
  (apiClient.put as any).mockResolvedValue({});
});
afterEach(() => useAuthStore.getState().logout());

describe("Serial Pending list", () => {
  it("lists every asset waiting for its serial, the one waiting longest first, with who has it", async () => {
    renderScreen();
    expect(await screen.findByText("FA/AMP/1")).toBeInTheDocument();
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
    const codes = screen.getAllByRole("link", { name: /^FA\/AMP/ }).map((l) => l.textContent);
    expect(codes).toEqual(["FA/AMP/2", "FA/AMP/1"]);          // 2026-08-01 before 2026-09-01
    expect(screen.getByText("Store Rohtak")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/assets?serial_pending=true&limit=200");
    // One spelling of Sub-category in visible text.
    expect(screen.getByText("Category › Sub-category")).toBeInTheDocument();
    expect(screen.queryByText(/Sub-Category/)).not.toBeInTheDocument();
  });

  it("keeps working past 200: every page of the waiting list is read (200 at a time)", async () => {
    const many = Array.from({ length: 450 }, (_, i) => row(i + 1, `FA/AMP/${i + 1}`, { purchase_date: "2026-09-01" }));
    (apiClient.get as any).mockImplementation((path: string) => {
      if (!path.startsWith("/assets?serial_pending=true")) return Promise.resolve([]);
      const offset = Number(new URL(path, "http://x").searchParams.get("offset") ?? 0);
      return Promise.resolve({ items: many.slice(offset, offset + 200), total: 450 });
    });
    renderScreen();
    expect(await screen.findByText("450 waiting")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/assets?serial_pending=true&limit=200");
    expect(apiClient.get).toHaveBeenCalledWith("/assets?serial_pending=true&limit=200&offset=200");
    expect(apiClient.get).toHaveBeenCalledWith("/assets?serial_pending=true&limit=200&offset=400");
    expect(screen.getByRole("link", { name: "FA/AMP/450" })).toBeInTheDocument();
  });

  it("types the serial and saves it for that asset only", async () => {
    renderScreen();
    await screen.findByText("FA/AMP/1");
    const save = () => screen.getByRole("button", { name: "Save serial for FA/AMP/1" });
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Serial for FA/AMP/1"), { target: { value: " AMP-0001 " } });
    fireEvent.click(save());
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/assets/1/serial", { serial_number: "AMP-0001" }));
    expect(apiClient.put).toHaveBeenCalledTimes(1);
  });

  it("'No serial' marks it as having none (N/A) instead", async () => {
    renderScreen();
    await screen.findByText("FA/AMP/1");
    fireEvent.click(screen.getByRole("button", { name: "No serial for FA/AMP/2" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/assets/2/serial", { no_serial: true }));
  });

  it("shows the server's refusal beside that row (a serial already used)", async () => {
    (apiClient.put as any).mockRejectedValue(new Error('serial number "AMP-1" is already used by asset FA/OTHER/9'));
    renderScreen();
    await screen.findByText("FA/AMP/1");
    fireEvent.change(screen.getByLabelText("Serial for FA/AMP/1"), { target: { value: "AMP-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save serial for FA/AMP/1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already used by asset FA/OTHER/9");
  });

  it("searches by asset, item or where it is", async () => {
    renderScreen();
    await screen.findByText("FA/AMP/1");
    fireEvent.change(screen.getByLabelText("Search pending serials"), { target: { value: "rohtak" } });
    expect(screen.getByText("FA/AMP/2")).toBeInTheDocument();
    expect(screen.queryByText("FA/AMP/1")).not.toBeInTheDocument();
  });

  it("says so when nothing is waiting", async () => {
    (apiClient.get as any).mockImplementation(() => Promise.resolve({ items: [], total: 0 }));
    renderScreen();
    expect(await screen.findByText("No serial numbers are waiting.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S4: many at once -- tick rows, paste serials in list order, preview, save all (PUT /assets/serials)
// ---------------------------------------------------------------------------
describe("Serial Pending: bulk entry for the selected assets", () => {
  const BULK = {
    items: [
      row(1, "FA/AMP/1", { po_number: "PO-1", purchase_date: "2026-09-01" }),
      row(2, "FA/AMP/2", { po_number: "PO-2", purchase_date: "2026-08-01", current_asset_user_name: "Store Rohtak" }),
      row(3, "FA/RTR/3", { item_name: "Router", description: "Wifi router", po_number: "PO-2", purchase_date: "2026-08-15" }),
    ],
    total: 3,
  };
  const pasteBox = () => screen.getByLabelText(/^Serials for \d+ selected assets?$/);
  const preview = () => screen.getByRole("table", { name: "Preview: which asset gets which serial" });
  const bulkCalls = () => (apiClient.put as any).mock.calls.filter(([p]: [string]) => p === "/assets/serials");

  beforeEach(() => {
    (apiClient.get as any).mockImplementation((path: string) =>
      path.startsWith("/assets?serial_pending=true") ? Promise.resolve(BULK) : Promise.resolve([]));
    (apiClient.post as any).mockImplementation((path: string, body: { serials?: string[] }) =>
      Promise.resolve(path === "/purchase-orders/check-serials"
        ? { conflicts: (body.serials ?? []).filter((s) => s === "USED").map((serial) => ({ serial, asset_code: "FA/OTHER/9" })) }
        : {}));
    (apiClient.put as any).mockResolvedValue({ updated: 2, results: [] });
  });

  async function selectRows(...codes: string[]) {
    renderScreen();
    await screen.findByText("FA/AMP/1");
    for (const c of codes) fireEvent.click(screen.getByRole("checkbox", { name: `Select ${c}` }));
  }

  it("no paste box until rows are ticked; then the serials go to the ticked assets in list order, shown in a preview", async () => {
    renderScreen();
    await screen.findByText("FA/AMP/1");
    expect(screen.queryByRole("region", { name: "Serials for the selected assets" })).not.toBeInTheDocument();
    // Ticked out of order: list order (oldest first) decides who gets which serial.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FA/AMP/1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FA/AMP/2" }));
    expect(screen.getByText("Paste serials for 2 selected assets")).toBeInTheDocument();
    fireEvent.change(pasteBox(), { target: { value: "AMP-A\nAMP-B" } });
    await waitFor(() => expect(within(preview()).getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual(["1FA/AMP/2AMP-A", "2FA/AMP/1AMP-B"]));
    expect(screen.getByText("2 of 2 entered")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save 2 serials" });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toEqual({ entries: [{ asset_id: 2, serial_number: "AMP-A" }, { asset_id: 1, serial_number: "AMP-B" }] });
    expect(await screen.findByText("2 serial numbers saved.")).toBeInTheDocument();
    expect((apiClient.put as any).mock.calls.filter(([p]: [string]) => /^\/assets\/\d+\/serial$/.test(p))).toHaveLength(0);
  });

  it("checks the count live: too few blocks Save; too many shows the extra one with no asset", async () => {
    await selectRows("FA/AMP/1", "FA/AMP/2");
    fireEvent.change(pasteBox(), { target: { value: "ONE" } });
    expect(await screen.findByText("1 of 2 entered")).toBeInTheDocument();
    expect(screen.getByText("2 serials needed, 1 pasted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 2 serials" })).toBeDisabled();
    fireEvent.change(pasteBox(), { target: { value: "ONE\nTWO\nTHREE" } });
    expect(await screen.findByText(/3 of 2 entered — 1 too many/)).toBeInTheDocument();
    expect(within(preview()).getByText("No asset for this one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 2 serials" })).toBeDisabled();
  });

  it("S6: a conflict the server marks `masked` reads 'an asset you cannot see', never a code", async () => {
    (apiClient.post as any).mockImplementation((path: string, body: { serials?: string[] }) =>
      Promise.resolve(path === "/purchase-orders/check-serials"
        ? { conflicts: (body.serials ?? []).filter((s) => s === "HIDDEN").map((serial) => ({ serial, asset_code: "an asset outside your companies or work area", masked: true })) }
        : {}));
    await selectRows("FA/AMP/1");
    fireEvent.change(pasteBox(), { target: { value: "HIDDEN" } });
    expect(await screen.findByText('Row 1: Serial "HIDDEN" is already used by an asset you cannot see.')).toBeInTheDocument();
    expect(screen.queryByText(/outside your companies/)).not.toBeInTheDocument();
  });

  it("a serial pasted twice (any case) names its rows and marks them; one CKAM already has is flagged too", async () => {
    await selectRows("FA/AMP/1", "FA/AMP/2", "FA/RTR/3");
    fireEvent.change(pasteBox(), { target: { value: "X1\nx1\nUSED" } });
    expect(await screen.findByText("X1 is typed more than once (rows 1 and 2).")).toBeInTheDocument();
    expect(await screen.findByText('Row 3: Serial "USED" is already used by asset FA/OTHER/9.')).toBeInTheDocument();
    const marked = [...screen.getByTestId("bulk-serials-gutter").querySelectorAll("[data-problem]")].map((el) => el.getAttribute("data-row"));
    expect(marked).toEqual(["1", "2", "3"]);
    expect(screen.getByRole("button", { name: "Save 3 serials" })).toBeDisabled();
  });

  it("a refused save (422) saves nothing and marks the exact asset and row", async () => {
    (apiClient.put as any).mockRejectedValue(Object.assign(new Error("Entry 2: Serial number AMP-B is already used by asset FA/OTHER/9."), {
      status: 422,
      body: { detail: "x", errors: [], problems: [{ entry_index: 2, asset_id: 1, serial: "AMP-B", message: "Serial number AMP-B is already used by asset FA/OTHER/9." }] },
    }));
    await selectRows("FA/AMP/1", "FA/AMP/2");
    fireEvent.change(pasteBox(), { target: { value: "AMP-A\nAMP-B" } });
    const save = screen.getByRole("button", { name: "Save 2 serials" });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    expect(await screen.findByText("Nothing was saved: 1 problem needs fixing, marked below.")).toBeInTheDocument();
    // Beside the asset's own row in the list, and on the paste-box row it came from.
    const assetRow = screen.getByRole("checkbox", { name: "Select FA/AMP/1" }).closest("tr") as HTMLElement;
    expect(within(assetRow).getByRole("alert")).toHaveTextContent("Serial number AMP-B is already used by asset FA/OTHER/9.");
    const marked = [...screen.getByTestId("bulk-serials-gutter").querySelectorAll("[data-problem]")].map((el) => el.getAttribute("data-row"));
    expect(marked).toEqual(["2"]);
    expect(pasteBox()).toHaveValue("AMP-A\nAMP-B");          // nothing typed is lost
  });

  it("Mark N as no serial asks once, then saves them all as N/A in one request", async () => {
    await selectRows("FA/AMP/2", "FA/RTR/3");
    fireEvent.click(screen.getByRole("button", { name: "Mark 2 as no serial" }));
    expect(screen.getByText("Save 2 assets as having no serial number (N/A)?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, mark them" }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toEqual({ entries: [{ asset_id: 2, no_serial: true }, { asset_id: 3, no_serial: true }] });
    expect(await screen.findByText("2 assets marked as having no serial number.")).toBeInTheDocument();
  });

  it("filters by Item and by PO; a filter change clears the selection", async () => {
    await selectRows("FA/AMP/1");
    expect(screen.getByText("Paste serials for 1 selected asset")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("PO"));
    fireEvent.click(await screen.findByRole("option", { name: "PO-2" }));
    await waitFor(() => expect(screen.queryByText("FA/AMP/1")).not.toBeInTheDocument());
    expect(screen.getByText("FA/AMP/2")).toBeInTheDocument();
    expect(screen.getByText("FA/RTR/3")).toBeInTheDocument();
    expect(screen.queryByText(/Paste serials for/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Item"));
    fireEvent.click(await screen.findByRole("option", { name: "Router" }));
    await waitFor(() => expect(screen.queryByText("FA/AMP/2")).not.toBeInTheDocument());
    expect(screen.getByText("FA/RTR/3")).toBeInTheDocument();
  });

  it("search matches the PO number", async () => {
    renderScreen();
    await screen.findByText("FA/AMP/1");
    fireEvent.change(screen.getByLabelText("Search pending serials"), { target: { value: "po-1" } });
    expect(screen.getByText("FA/AMP/1")).toBeInTheDocument();
    expect(screen.queryByText("FA/AMP/2")).not.toBeInTheDocument();
  });

  it("100 assets: one paste of 100 serials, saved in one request", async () => {
    const many = Array.from({ length: 100 }, (_, i) => row(100 + i, `FA/AMP/${100 + i}`, { purchase_date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}` }));
    (apiClient.get as any).mockImplementation((path: string) =>
      path.startsWith("/assets?serial_pending=true") ? Promise.resolve({ items: many, total: 100 }) : Promise.resolve([]));
    (apiClient.put as any).mockResolvedValue({ updated: 100, results: [] });
    renderScreen();
    await screen.findByText("FA/AMP/100");
    fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    expect(screen.getByText("Paste serials for 100 selected assets")).toBeInTheDocument();
    fireEvent.change(pasteBox(), { target: { value: Array.from({ length: 100 }, (_, i) => `SN-${i}`).join("\n") } });
    expect(await screen.findByText("100 of 100 entered")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save 100 serials" });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].entries).toHaveLength(100);
    expect(await screen.findByText("100 serial numbers saved.")).toBeInTheDocument();
  });
});
