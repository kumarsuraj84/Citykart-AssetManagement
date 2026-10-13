import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
