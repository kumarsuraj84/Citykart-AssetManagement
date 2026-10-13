import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { KINDS, OPERATOR_IT, withCapabilities } from "../../test-capabilities";

vi.mock("../../lib/api-client");

// Rendered through the real route tree (the page links to Print Labels, so it needs a router).
async function renderMovement() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/asset-movement"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText(/scan or type/i);
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

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); } catch { /* no storage here */ }
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
  // Labels print as assets are scanned for a Move; the label pictures themselves are not what these tests are about.
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
  window.URL.revokeObjectURL = vi.fn();
  window.print = vi.fn();
});
afterEach(() => useAuthStore.getState().logout());

describe("AssetMovement", () => {
  it("scans an exact match straight into the queue", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    await renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Dell Laptop/)).toBeInTheDocument());
    expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Suraj/)).toBeInTheDocument();
  });

  it("shows an error when nothing matches", async () => {
    mockGets({ searchResults: {} });
    await renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "NOPE" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/no asset found/i);
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
  });

  it("shows a pick list when the scan matches more than one asset, and adds the chosen one", async () => {
    mockGets({ searchResults: { "SN-00": [LAPTOP, SCRAPPED_MOUSE] } });
    await renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-00" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/more than one match/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Logitech Mouse/));

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.queryByText(/more than one match/i)).not.toBeInTheDocument();
  });

  it("does not add the same asset twice on a repeat scan", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    await renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });

  it("flags a scanned asset as not eligible for the chosen action, and excludes it from Apply's count", async () => {
    mockGets({ searchResults: { "SN-002": [SCRAPPED_MOUSE] } });
    await renderMovement();

    // Default action is Move, which SCRAPPED (terminal) can never do.
    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-002" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/not eligible/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /apply ".*" to 0 assets/i })).toBeDisabled();
  });

  it("Move requires a destination asset_user before Apply is enabled", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    await renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("combobox", { name: /^move to$/i }));
    fireEvent.click(await screen.findByRole("option", { name: "IT Stock-HO" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /apply/i })).toBeEnabled());
  });

  it("applies the action to every eligible asset in the queue and reports the result", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    (apiClient.post as any).mockResolvedValue({ done: 1, failed: [] });
    await renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("combobox", { name: /^move to$/i }));
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
    await renderMovement();

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
    await renderMovement();

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
    await renderMovement();

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

  it("\"Currently With\" browses everything a chosen asset_user holds, showing code/serial/status", async () => {
    const ankurLaptop = {
      id: 50, asset_code: "FA/HO01/IT/LAP/CK_50", serial_number: "SN-ANK-1", description: "Ankur's Laptop",
      status: "ALLOTTED", current_asset_user_name: "Ankur",
    };
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 9, name: "IT Stock-HO" }, { id: 11, name: "Ankur" }, { id: 12, name: "Arvind" }]);
      if (path.startsWith("/assets?asset_user_id=11")) return Promise.resolve({ items: [ankurLaptop], total: 1 });
      return Promise.resolve([]);
    });
    await renderMovement();

    fireEvent.click(screen.getByRole("combobox", { name: /currently with/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Ankur" }));

    await waitFor(() => expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_50/)).toBeInTheDocument());
    expect(screen.getByText(/assets with ankur \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/SN-ANK-1/)).toBeInTheDocument();
  });

  it("selecting assets under \"Currently With\" and clicking Add Selected queues them", async () => {
    const ankurLaptop = {
      id: 51, asset_code: "FA/HO01/IT/LAP/CK_51", serial_number: "SN-ANK-2", description: "Ankur's Monitor",
      status: "ALLOTTED", current_asset_user_name: "Ankur",
    };
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 9, name: "IT Stock-HO" }, { id: 11, name: "Ankur" }]);
      if (path.startsWith("/assets?asset_user_id=11")) return Promise.resolve({ items: [ankurLaptop], total: 1 });
      return Promise.resolve([]);
    });
    await renderMovement();

    fireEvent.click(screen.getByRole("combobox", { name: /currently with/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Ankur" }));
    await waitFor(() => expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_51/)).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /add selected to queue/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FA/HO01/IT/LAP/CK_51" }));
    fireEvent.click(screen.getByRole("button", { name: /add 1 selected to queue/i }));

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });

  it("sorting the queue by \"With\" really reorders it by who has each asset", async () => {
    const withZara = { ...LAPTOP, id: 61, asset_code: "FA/Z/61", description: "Zara's Laptop", current_asset_user_name: "Zara" };
    const withAmit = { ...LAPTOP, id: 62, asset_code: "FA/A/62", description: "Amit's Laptop", current_asset_user_name: "Amit" };
    const withMeena = { ...LAPTOP, id: 63, asset_code: "FA/M/63", description: "Meena's Laptop", current_asset_user_name: "Meena" };
    mockGets({ searchResults: { z: [withZara], a: [withAmit], m: [withMeena] } });
    await renderMovement();
    for (const q of ["z", "a", "m"]) {
      fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: q } });
      fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    }
    await waitFor(() => expect(screen.getByText(/Queued \(3\)/)).toBeInTheDocument());

    const order = () => screen.getAllByText(/^With: /).map((el) => el.textContent?.match(/^With: (\w+)/)?.[1]);
    expect(order()).toEqual(["Zara", "Amit", "Meena"]);                       // scan order
    expect(screen.queryByRole("button", { name: /sort queue by asset user/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sort queue by With" }));
    expect(order()).toEqual(["Amit", "Meena", "Zara"]);                       // A -> Z
    fireEvent.click(screen.getByRole("button", { name: "Sort queue by With" }));
    expect(order()).toEqual(["Zara", "Meena", "Amit"]);                       // Z -> A
  });

  it("the queue and pick list say who has an asset in plain words, never raw codes", async () => {
    const inStock = { ...LAPTOP, id: 71, asset_code: "FA/S/71", description: "Spare Laptop", status: "IN_STOCK", current_asset_user_name: "HO Stock", current_asset_user_location_name: "Head Office", current_asset_user_type: "STOCK_POINT" };
    const withEmployee = { ...LAPTOP, id: 72, asset_code: "FA/E/72", description: "Suraj's Laptop", status: "ALLOTTED", current_asset_user_name: "Suraj", current_asset_user_location_name: "Head Office", current_asset_user_type: "EMPLOYEE" };
    mockGets({ searchResults: { lap: [inStock, withEmployee] } });
    await renderMovement();

    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "lap" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/more than one match/i)).toBeInTheDocument());
    expect(screen.getByText("With: HO Stock (Head Office) · In Stock")).toBeInTheDocument();
    expect(screen.getByText("With: Suraj (Head Office) · With Employee")).toBeInTheDocument();
    // Only the asset that is not in a stock room gets the warning badge.
    expect(screen.getAllByText("With a person or at a store")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/IN_STOCK|ALLOTTED|STOCK_POINT|AssetUser:|Not in IT Stock|Status: /);

    fireEvent.click(screen.getByText(/Suraj's Laptop/));
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.getByText(/With: Suraj \(Head Office\) · With Employee/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/IN_STOCK|ALLOTTED|STOCK_POINT|AssetUser:|Not in IT Stock|Destination Asset User/);
  });

  it("people and places in the pickers show their place, and the company when the list spans companies", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/asset-users")) return Promise.resolve([
        { id: 11, code: "CS6872", name: "Ankur", asset_user_type: "EMPLOYEE", company_id: 1, location_id: 50 },
        { id: 12, code: "STK-WH", name: "WH Stock", asset_user_type: "STOCK_POINT", company_id: 2, location_id: 51 },
      ]);
      if (path === "/masters/locations") return Promise.resolve([{ id: 50, name: "Head Office" }, { id: 51, name: "Warehouse" }]);
      if (path === "/masters/companies") return Promise.resolve([{ id: 1, code: "CKSPL", name: "CityKart Stores" }, { id: 2, code: "CKRPL", name: "CityKart Retail" }]);
      return Promise.resolve([]);
    });
    await renderMovement();
    fireEvent.click(screen.getByRole("combobox", { name: /^move to$/i }));
    expect(await screen.findByRole("option", { name: /^CS6872 · Ankur\s?· Head Office · CKSPL$/ })).toBeInTheDocument();
    // A Stock Room reads by its name, not its machine code.
    expect(screen.getByRole("option", { name: /^WH Stock\s?· Warehouse · CKRPL$/ })).toBeInTheDocument();
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
    await renderMovement();

    fireEvent.click(screen.getByRole("checkbox", { name: /only assets currently in stock/i }));
    fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value: "SN-001" } });
    fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });
});

// S3b-1: Move's stock-room pickers read GET /stock-rooms; a destination stock room
// can be added right here (people and stores are not created inline).
describe("S3b-1: stock rooms on Move", () => {
  const ROOMS = [{ id: 9, name: "IT Stock-HO", location_name: "Head Office", company_code: "CKSPL", company_id: 1 }];

  function world(caps: Capabilities) {
    (apiClient.get as any).mockImplementation(withCapabilities(caps, (path: string) => {
      if (path === "/stock-rooms") return Promise.resolve(ROOMS);
      if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Citykart Stores" }]);
      if (path === "/masters/locations?company_id=1") return Promise.resolve([{ id: 50, name: "Head Office" }]);
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 9, name: "IT Stock-HO", asset_user_type: "STOCK_POINT" }, { id: 3, code: "E1", name: "Ankur", asset_user_type: "EMPLOYEE" }]);
      return Promise.resolve([]);
    }));
  }

  it("Add by Item's \"Currently in stock at\" lists the stock rooms of the person's companies from /stock-rooms", async () => {
    world(OPERATOR_IT);
    await renderMovement();
    fireEvent.click(screen.getByRole("combobox", { name: /currently in stock at/i }));
    expect(await screen.findByRole("option", { name: /^IT Stock-HO\s?· Head Office · CKSPL$/ })).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/stock-rooms");
    // a brand-new room holds nothing, so the source never offers to create one
    expect(screen.queryByRole("option", { name: /new stock room/i })).not.toBeInTheDocument();
  });

  it.each(KINDS)("%s: Move To offers New Stock Room only when allowed, and never a new person", async (_kind, caps) => {
    world(caps);
    await renderMovement();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    const trigger = screen.getByRole("combobox", { name: /move to/i });
    fireEvent.click(trigger);
    await screen.findByRole("option", { name: /Ankur/ });
    expect(screen.queryByRole("option", { name: /new stock room/i }) !== null).toBe(caps.can_create.stock_room === true);
    expect(screen.queryByRole("option", { name: /new (employee|store|person)/i })).not.toBeInTheDocument();
  });

  it("a new destination stock room asks for the company only when there is a choice, then is picked as Move To", async () => {
    world(OPERATOR_IT);
    (apiClient.post as any).mockResolvedValue({ id: 70, name: "Hisar Stock" });
    await renderMovement();
    fireEvent.click(screen.getByRole("combobox", { name: /move to/i }));
    fireEvent.click(await screen.findByRole("option", { name: /new stock room/i }));
    const dialog = await screen.findByRole("dialog", { name: /new stock room/i });
    await waitFor(() => expect(within(dialog).getByLabelText(/^company/i)).toHaveTextContent("Citykart Stores"));
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Hisar Stock" } });
    fireEvent.click(within(dialog).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: "Head Office" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", { name: "Hisar Stock", company_id: 1, location_id: 50 }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /new stock room/i })).not.toBeInTheDocument());
  });
});
