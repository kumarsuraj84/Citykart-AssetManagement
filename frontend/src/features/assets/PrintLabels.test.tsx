import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrintLabels } from "./PrintLabels";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderPrintLabels() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PrintLabels />
    </QueryClientProvider>,
  );
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

describe("PrintLabels", () => {
  it("scans an exact match straight into the queue and shows it in the preview", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.getAllByText(/Dell Laptop/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /print 1 label/i })).toBeEnabled();
  });

  it("shows an error when nothing matches", async () => {
    mockGets({});
    renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "NOPE" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/no asset found/i);
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
  });

  it("shows a pick list when the scan matches more than one asset, and adds the chosen one", async () => {
    mockGets({ "SN-00": [LAPTOP, MOUSE] });
    renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-00" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/more than one match/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Logitech Mouse/));

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.queryByText(/more than one match/i)).not.toBeInTheDocument();
  });

  it("does not add the same asset twice on a repeat scan", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });

  it("Remove takes an asset out of the queue", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    renderPrintLabels();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /print 0 labels/i })).toBeDisabled();
  });

  it("Print is disabled with an empty queue, and calls window.print() once assets are queued", async () => {
    mockGets({ "SN-001": [LAPTOP] });
    renderPrintLabels();

    expect(screen.getByRole("button", { name: /print 0 labels/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: /print 1 label/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /print 1 label/i }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
