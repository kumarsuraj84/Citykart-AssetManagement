import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetMovement } from "./AssetMovement";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderMovement() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AssetMovement />
    </QueryClientProvider>,
  );
}

const LAPTOP = {
  id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", serial_number: "SN-001", description: "Dell Laptop",
  status: "ALLOTTED", current_asset_user_name: "Suraj",
};
const SCRAPPED_MOUSE = {
  id: 2, asset_code: "FA/HO01/IT/MOU/CK_2", serial_number: "SN-002", description: "Logitech Mouse",
  status: "SCRAPPED", current_asset_user_name: "IT Stock-HO",
};

function mockGets({ searchResults = {} as Record<string, typeof LAPTOP[]> } = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 9, name: "IT Stock-HO" }]);
    if (path.startsWith("/assets?q=")) {
      const q = decodeURIComponent(path.split("q=")[1].split("&")[0]);
      const items = searchResults[q] ?? [];
      return Promise.resolve({ items, total: items.length });
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => vi.clearAllMocks());

describe("AssetMovement", () => {
  it("scans an exact match straight into the queue", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Dell Laptop/)).toBeInTheDocument());
    expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Suraj/)).toBeInTheDocument();
  });

  it("shows an error when nothing matches", async () => {
    mockGets({ searchResults: {} });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "NOPE" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/no asset found/i);
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
  });

  it("shows a pick list when the scan matches more than one asset, and adds the chosen one", async () => {
    mockGets({ searchResults: { "SN-00": [LAPTOP, SCRAPPED_MOUSE] } });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-00" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/more than one match/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Logitech Mouse/));

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.queryByText(/more than one match/i)).not.toBeInTheDocument();
  });

  it("does not add the same asset twice on a repeat scan", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });

  it("flags a scanned asset as not eligible for the chosen action, and excludes it from Apply's count", async () => {
    mockGets({ searchResults: { "SN-002": [SCRAPPED_MOUSE] } });
    renderMovement();

    // Default action is Move, which SCRAPPED (terminal) can never do.
    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-002" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/not eligible/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /apply ".*" to 0 assets/i })).toBeDisabled();
  });

  it("Move requires a destination asset_user before Apply is enabled", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("combobox", { name: /destination asset user/i }));
    fireEvent.click(await screen.findByRole("option", { name: "IT Stock-HO" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /apply/i })).toBeEnabled());
  });

  it("applies the action to every eligible asset in the queue and reports the result", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    (apiClient.post as any).mockResolvedValue({ done: 1, failed: [] });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("combobox", { name: /destination asset user/i }));
    fireEvent.click(await screen.findByRole("option", { name: "IT Stock-HO" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /apply/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/assets/bulk-action", {
        asset_ids: [1], event_type: "MOVED", to_asset_user_id: 9, remarks: null,
      }),
    );
    expect(await screen.findByTestId("bulk-action-done-count")).toHaveTextContent("1");
  });

  it("Qty > 1 queues that many eligible matches in one go, without a pick-one-at-a-time list", async () => {
    const keyboards = Array.from({ length: 5 }, (_, i) => ({
      id: 100 + i, asset_code: `FA/HO01/IT/KBD/CK_${i}`, serial_number: "N/A",
      description: "Generic Keyboard", status: "IN_STOCK", current_asset_user_name: "IT Stock-HO",
    }));
    mockGets({ searchResults: { keyboard: keyboards } });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/^qty$/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "keyboard" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Queued \(3\)/)).toBeInTheDocument());
    expect(screen.getByText(/added 3 of 3 requested/i)).toBeInTheDocument();
    expect(screen.queryByText(/more than one match/i)).not.toBeInTheDocument();
  });

  it("Qty > 1 reports a shortfall when fewer eligible matches exist than requested", async () => {
    const keyboards = Array.from({ length: 2 }, (_, i) => ({
      id: 200 + i, asset_code: `FA/HO01/IT/KBD/CK_${i}`, serial_number: "N/A",
      description: "Generic Keyboard", status: "IN_STOCK", current_asset_user_name: "IT Stock-HO",
    }));
    mockGets({ searchResults: { keyboard: keyboards } });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/^qty$/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "keyboard" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Queued \(2\)/)).toBeInTheDocument());
    expect(screen.getByText(/added 2 of 10 requested/i)).toBeInTheDocument();
  });

  it("Qty > 1 never re-queues an asset already added from an earlier scan", async () => {
    const keyboards = Array.from({ length: 3 }, (_, i) => ({
      id: 300 + i, asset_code: `FA/HO01/IT/KBD/CK_${i}`, serial_number: "N/A",
      description: "Generic Keyboard", status: "IN_STOCK", current_asset_user_name: "IT Stock-HO",
    }));
    mockGets({ searchResults: { keyboard: keyboards } });
    renderMovement();

    fireEvent.change(screen.getByLabelText(/^qty$/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "keyboard" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(3\)/)).toBeInTheDocument());

    // Same 3 already queued -- searching again for the same 3 finds nothing new.
    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "keyboard" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/added 0 of 3 requested/i)).toBeInTheDocument());
    expect(screen.getByText(/Queued \(3\)/)).toBeInTheDocument();
  });

  it("checking \"Only assets currently in stock\" adds status=IN_STOCK to the search", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 9, name: "IT Stock-HO" }]);
      if (path.startsWith("/assets?q=")) {
        expect(path).toContain("status=IN_STOCK");
        return Promise.resolve({ items: [LAPTOP], total: 1 });
      }
      return Promise.resolve([]);
    });
    renderMovement();

    fireEvent.click(screen.getByRole("checkbox", { name: /only assets currently in stock/i }));
    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });
});
