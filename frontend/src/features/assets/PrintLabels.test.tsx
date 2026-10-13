import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

// Rendered through the real route tree (the page links to Dispatch, so it needs a router).
async function renderPrintLabels(url = "/print-labels") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText(/scan or type/i);
}

const LAPTOP = { id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", serial_number: "SN-001", description: "Dell Laptop" };
const MOUSE = { id: 2, asset_code: "FA/HO01/IT/MOU/CK_2", serial_number: "SN-002", description: "Logitech Mouse" };

function mockGets(searchResults: Record<string, typeof LAPTOP[]> = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/assets?q=")) {
      const q = decodeURIComponent(path.split("q=")[1].split("&")[0]);
      const items = searchResults[q] ?? [];
      return Promise.resolve({ items, total: items.length });
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
  try {
    window.localStorage.clear();
  } catch {
    // no-op if storage is unavailable in this environment
  }
  // The label image itself (LabelImage -> authFetch -> window.fetch) isn't
  // what these tests are about -- a 404 short-circuits it to "still loading",
  // same technique AssetDetail.test.tsx already uses for its own QR image.
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-label");
  window.URL.revokeObjectURL = vi.fn();
  window.print = vi.fn();
});

describe("PrintLabels label content and delivery preload", () => {
  it("a label shows the item name, asset code, serial and ERP item code, and the default size is 70 x 20 mm", async () => {
    mockGets({
      "SN-777": [{ ...LAPTOP, id: 7, asset_code: "FA/HO01/AV/AMP/CK_7", serial_number: "SN-777", description: "Amp 100W", item_name: "Amplifier", erp_item_code: "CT100200" } as any],
    });
    await renderPrintLabels();
    fireEvent.change(await screen.findByLabelText(/scan or type/i), { target: { value: "SN-777" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    const label = document.querySelector(".print-labels-sheet .print-label") as HTMLElement;
    expect(label).toHaveTextContent("Amplifier");
    expect(label).toHaveTextContent("FA/HO01/AV/AMP/CK_7");
    expect(label).toHaveTextContent("SN: SN-777");
    expect(label).toHaveTextContent("ERP: CT100200");
    expect(label.style.width).toBe("70mm");
    expect(label.style.height).toBe("20mm");
  });

  it("S5a: uses the one shared Label settings disclosure (closed, saying what will print)", async () => {
    mockGets({});
    await renderPrintLabels();
    expect(screen.getAllByTestId("label-settings")).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: /label settings/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Barcode + QR · 70 × 20 mm");
    fireEvent.click(toggle);
    expect(screen.getByRole("combobox", { name: "Label Size" })).toBeInTheDocument();
  });

  it("links to Move Assets for labelling as you send", async () => {
    mockGets({});
    await renderPrintLabels();
    expect(await screen.findByRole("link", { name: "Move Assets (label as you send)" })).toHaveAttribute("href", "/asset-movement");
  });

  it("an asset whose serial is still to be added says so on its label", async () => {
    mockGets({ AMP: [{ ...LAPTOP, id: 8, serial_number: null, serial_pending: true, item_name: "Amplifier" } as any] });
    await renderPrintLabels();
    fireEvent.change(await screen.findByLabelText(/scan or type/i), { target: { value: "AMP" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(document.querySelector(".print-labels-sheet .print-label")).toHaveTextContent("SN: to be added");
  });

  it("an asset with no serial prints with its asset code and item name, not a made-up serial", async () => {
    mockGets({ MOU: [{ ...MOUSE, serial_number: null, item_name: "Mouse" } as any] });
    await renderPrintLabels();
    fireEvent.change(await screen.findByLabelText(/scan or type/i), { target: { value: "MOU" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    const label = document.querySelector(".print-labels-sheet .print-label") as HTMLElement;
    expect(label).toHaveTextContent("Mouse");
    expect(label).toHaveTextContent("FA/HO01/IT/MOU/CK_2");
    expect(label).toHaveTextContent("SN: none");
  });

  it("opened from a delivery it starts with that delivery's assets already queued, in order", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets?ids=")) {
        return Promise.resolve({ items: [MOUSE, LAPTOP], total: 2 });          // the server's order differs
      }
      return Promise.resolve([]);
    });
    await renderPrintLabels("/print-labels?assets=1,2");
    await waitFor(() => expect(screen.getByText(/Queued \(2\)/)).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledWith("/assets?ids=1%2C2&limit=1000");
    const codes = Array.from(document.querySelectorAll(".print-labels-sheet .print-label")).map((l) => l.textContent ?? "");
    expect(codes[0]).toContain("FA/HO01/IT/LAP/CK_1");
    expect(codes[1]).toContain("FA/HO01/IT/MOU/CK_2");
    expect(screen.getByRole("button", { name: /print 2 labels/i })).toBeEnabled();
  });

  it("scanning the label's QR (a link to the asset) finds that one asset", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets?ids=9")) return Promise.resolve({ items: [{ ...LAPTOP, id: 9 }], total: 1 });
      return Promise.resolve({ items: [], total: 0 });
    });
    await renderPrintLabels();
    fireEvent.change(await screen.findByLabelText(/scan or type/i), { target: { value: "http://10.0.1.98:3211/assets/9" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });
});

describe("PrintLabels", () => {
  it("scans an exact match straight into the queue and shows it in the preview", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    await renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.getAllByText(/Dell Laptop/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /print 1 label/i })).toBeEnabled();
  });

  it("shows the Serial Number on the previewed label, alongside the Asset Code", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    await renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.getByText(`SN: ${LAPTOP.serial_number}`)).toBeInTheDocument();
  });

  it("shows an error when nothing matches", async () => {
    mockGets({});
    await renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "NOPE" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/no asset found/i);
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
  });

  it("shows a pick list when the scan matches more than one asset, and adds the chosen one", async () => {
    mockGets({ "SN-00": [LAPTOP, MOUSE] });
    await renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-00" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/more than one match/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Logitech Mouse/));

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.queryByText(/more than one match/i)).not.toBeInTheDocument();
  });

  it("does not add the same asset twice on a repeat scan", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    await renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });

  it("Remove takes an asset out of the queue", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    await renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /print 0 labels/i })).toBeDisabled();
  });

  it("Print is disabled with an empty queue, and calls window.print() once assets are queued", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    await renderPrintLabels();

    expect(screen.getByRole("button", { name: /print 0 labels/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: /print 1 label/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /print 1 label/i }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
