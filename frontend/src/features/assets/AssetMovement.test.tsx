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
async function renderMovement(url = "/asset-movement") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText(/scan or type/i);
  return router;
}

const LAPTOP = {
  id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", serial_number: "SN-001", description: "Dell Laptop",
  status: "ALLOTTED", current_asset_user_name: "Suraj",
};
const SCRAPPED_MOUSE = {
  id: 2, asset_code: "FA/HO01/IT/MOU/CK_2", serial_number: "SN-002", description: "Logitech Mouse",
  status: "SCRAPPED", current_asset_user_name: "IT Stock-HO",
};
const REPAIR_PRINTER = {
  id: 3, asset_code: "FA/HO01/IT/PRN/CK_3", serial_number: "SN-003", description: "Printer",
  status: "UNDER_REPAIR", current_asset_user_name: "IT Stock-HO",
};

const PEOPLE = [
  { id: 9, name: "IT Stock-HO", asset_user_type: "STOCK_POINT" },
  { id: 11, code: "E11", name: "Ankur", asset_user_type: "EMPLOYEE" },
  { id: 12, code: "S12", name: "Lamington Store", asset_user_type: "STORE" },
  { id: 13, name: "Lamington Install Point", asset_user_type: "INSTALLED" },
];

function mockGets({ searchResults = {} as Record<string, unknown[]>, byIds = [] as unknown[] } = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/asset-users")) return Promise.resolve(PEOPLE);
    if (path.startsWith("/assets?ids=")) return Promise.resolve({ items: byIds, total: byIds.length });
    if (path.startsWith("/assets?q=")) {
      const q = decodeURIComponent(path.split("q=")[1].split("&")[0]);
      const items = searchResults[q] ?? [];
      return Promise.resolve({ items, total: items.length });
    }
    return Promise.resolve([]);
  });
}

function scan(value: string) {
  fireEvent.change(screen.getByLabelText(/scan or type/i), { target: { value } });
  fireEvent.keyDown(screen.getByLabelText(/scan or type/i), { key: "Enter" });
}

const choose = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
const applyButton = (label: string, n: number) => screen.getByRole("button", { name: `${label} (${n} asset${n === 1 ? "" : "s"})` });

async function pick(combobox: string | RegExp, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: combobox }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); } catch { /* no storage here */ }
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
  // Labels print as assets are scanned for a store; the label pictures themselves are not what these tests are about.
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

    scan("SN-001");

    await waitFor(() => expect(screen.getByText(/Dell Laptop/)).toBeInTheDocument());
    expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Suraj/)).toBeInTheDocument();
  });

  it("shows an error when nothing matches", async () => {
    mockGets({ searchResults: {} });
    await renderMovement();

    scan("NOPE");

    expect(await screen.findByRole("alert")).toHaveTextContent(/no asset found/i);
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
  });

  it("shows a pick list when the scan matches more than one asset, and adds the chosen one", async () => {
    mockGets({ searchResults: { "SN-00": [LAPTOP, SCRAPPED_MOUSE] } });
    await renderMovement();

    scan("SN-00");

    await waitFor(() => expect(screen.getByText(/more than one match/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Logitech Mouse/));

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.queryByText(/more than one match/i)).not.toBeInTheDocument();
  });

  it("does not add the same asset twice on a repeat scan", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    await renderMovement();

    scan("SN-001");
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    scan("SN-001");
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });

  it("flags a queued asset the chosen action cannot apply to, and leaves it out of the count", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP], "SN-002": [SCRAPPED_MOUSE] } });
    await renderMovement();
    choose("Give to Employee");
    scan("SN-001");
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    scan("SN-002");
    await waitFor(() => expect(screen.getByText(/not possible: Give to Employee \(it is Scrapped\)/)).toBeInTheDocument());
    expect(screen.getByText(/Queued \(2\) — 1 can be done/)).toBeInTheDocument();
    expect(applyButton("Give to Employee", 1)).toBeInTheDocument();
  });

  it("Give to Employee requires the employee before Apply is enabled", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    await renderMovement();

    scan("SN-001");
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Choose what to do" })).toBeDisabled();
    choose("Give to Employee");
    expect(applyButton("Give to Employee", 1)).toBeDisabled();
    expect(screen.getByText("Choose the employee.")).toBeInTheDocument();

    await pick("Employee", /Ankur/);
    await waitFor(() => expect(applyButton("Give to Employee", 1)).toBeEnabled());
  });

  it("applies the choice to every eligible asset in the queue and reports the result", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    (apiClient.post as any).mockResolvedValue({ done: 1, failed: [] });
    await renderMovement();

    scan("SN-001");
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());

    choose("Return to Stock Room");
    await pick("Stock Room", "IT Stock-HO");
    fireEvent.click(applyButton("Return to Stock Room", 1));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/assets/bulk-action", {
        asset_ids: [1], event_type: "MOVED", to_asset_user_id: 9, remarks: null,
      }),
    );
    expect(await screen.findByTestId("bulk-action-done-count")).toHaveTextContent("1");
    expect(screen.getByTestId("move-result")).toHaveTextContent("1 asset returned to the stock room.");
  });

  it("Qty > 1 queues that many eligible matches in one go, without a pick-one-at-a-time list", async () => {
    const keyboards = Array.from({ length: 5 }, (_, i) => ({
      id: 100 + i, asset_code: `FA/HO01/IT/KBD/CK_${i}`, serial_number: "N/A",
      description: "Generic Keyboard", status: "IN_STOCK", current_asset_user_name: "IT Stock-HO",
    }));
    mockGets({ searchResults: { keyboard: keyboards } });
    await renderMovement();

    fireEvent.change(screen.getByLabelText(/^qty$/i), { target: { value: "3" } });
    scan("keyboard");

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
    scan("keyboard");

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
    scan("keyboard");
    await waitFor(() => expect(screen.getByText(/Queued \(3\)/)).toBeInTheDocument());

    // Same 3 already queued -- searching again for the same 3 finds nothing new.
    scan("keyboard");

    await waitFor(() => expect(screen.getByText(/added 0 of 3 requested/i)).toBeInTheDocument());
    expect(screen.getByText(/Queued \(3\)/)).toBeInTheDocument();
  });

  it("\"Currently With\" browses everything a chosen person or place holds, showing code/serial/status", async () => {
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

    await pick(/currently with/i, "Ankur");

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

    await pick(/currently with/i, "Ankur");
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
    for (const q of ["z", "a", "m"]) scan(q);
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

    scan("lap");
    await waitFor(() => expect(screen.getByText(/more than one match/i)).toBeInTheDocument());
    expect(screen.getByText("With: HO Stock (Head Office) · In Stock")).toBeInTheDocument();
    expect(screen.getByText("With: Suraj (Head Office) · With Employee")).toBeInTheDocument();
    // Only the asset that is not in a stock room gets the warning badge.
    expect(screen.getAllByText("With a person or at a store")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/IN_STOCK|ALLOTTED|STOCK_POINT|AssetUser:|Not in IT Stock|Status: /);

    fireEvent.click(screen.getByText(/Suraj's Laptop/));
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    expect(screen.getByText(/With: Suraj \(Head Office\) · With Employee/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/IN_STOCK|ALLOTTED|STOCK_POINT|AssetUser:|Not in IT Stock|Destination Asset User|Holder|Move \/ Allot/);
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
    choose("Give to Employee");
    fireEvent.click(screen.getByRole("combobox", { name: "Employee" }));
    expect(await screen.findByRole("option", { name: /^CS6872 · Ankur\s?· Head Office · CKSPL$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Employee" }));
    choose("Return to Stock Room");
    fireEvent.click(screen.getByRole("combobox", { name: "Stock Room" }));
    // A Stock Room reads by its name, not its machine code.
    expect(await screen.findByRole("option", { name: /^WH Stock\s?· Warehouse · CKRPL$/ })).toBeInTheDocument();
  });

  it("checking \"Only assets currently in stock\" adds status=IN_STOCK to the search", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/asset-users")) return Promise.resolve(PEOPLE);
      if (path.startsWith("/assets?q=")) {
        expect(path).toContain("status=IN_STOCK");
        return Promise.resolve({ items: [LAPTOP], total: 1 });
      }
      return Promise.resolve([]);
    });
    await renderMovement();

    fireEvent.click(screen.getByRole("checkbox", { name: /only assets currently in stock/i }));
    scan("SN-001");

    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
  });
});

describe("S5a: one Move screen with plain-word choices", () => {
  it("offers the eleven choices as one segmented list, none picked until the person picks one", async () => {
    mockGets();
    await renderMovement();
    const group = screen.getByRole("radiogroup", { name: "What do you want to do?" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Give to Employee", "Return to Stock Room", "Send to Store", "Install",
      "Send for Repair", "Receive from Repair", "Report Lost", "Mark Found", "Sell", "Scrap", "Dispose",
    ]);
    expect(within(group).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
    choose("Send for Repair");
    expect(screen.getByRole("radio", { name: "Send for Repair" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("combobox", { name: /action/i })).not.toBeInTheDocument();      // no "Action" dropdown any more
  });

  it.each([
    ["Give to Employee", "Employee", ["E11 · Ankur"]],
    ["Return to Stock Room", "Stock Room", ["IT Stock-HO"]],
    ["Send to Store", "Store", ["S12 · Lamington Store"]],
    ["Install", "Install Point", ["Lamington Install Point"]],
    ["Mark Found", "Stock Room", ["IT Stock-HO"]],
  ])("%s lists only the matching kind (%s)", async (choice, picker, expected) => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    mockGets();
    await renderMovement();
    choose(choice);
    fireEvent.click(screen.getByRole("combobox", { name: picker }));
    await screen.findAllByRole("option");
    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "").filter((t) => !/new stock room/i.test(t));
    expect(names.map((n) => n.trim())).toEqual(expected);
  });

  it("Receive from Repair may go back to anyone, and each entry says what it is", async () => {
    mockGets();
    await renderMovement();
    choose("Receive from Repair");
    fireEvent.click(screen.getByRole("combobox", { name: "Received into" }));
    expect(await screen.findByRole("option", { name: /IT Stock-HO\s?· Stock Room/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ankur\s?· Employee/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Lamington Store\s?· Store/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Lamington Install Point\s?· Install Point/ })).toBeInTheDocument();
  });

  it.each(["Send for Repair", "Report Lost", "Sell", "Scrap", "Dispose"])("%s shows no destination picker", async (choice) => {
    mockGets();
    await renderMovement();
    choose(choice);
    expect(screen.queryByRole("combobox", { name: /^(employee|store|stock room|install point|received into)$/i })).not.toBeInTheDocument();
  });

  it("switching to another kind clears a destination that does not fit it", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    await renderMovement();
    scan("SN-001");
    await screen.findByText(/Queued \(1\)/);
    choose("Send to Store");
    await pick("Store", /Lamington Store/);
    expect(applyButton("Send to Store", 1)).toBeEnabled();
    choose("Give to Employee");
    expect(applyButton("Give to Employee", 1)).toBeDisabled();
  });

  it("a batch of mixed statuses offers only what fits all of them, and says why in one line", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP], "SN-003": [REPAIR_PRINTER] } });
    await renderMovement();
    scan("SN-001");
    await screen.findByText(/Queued \(1\)/);
    // with one asset (with a person): no "Receive from Repair", no "Sell"
    expect(screen.getByRole("radio", { name: "Receive from Repair" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Sell" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Give to Employee" })).toBeEnabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    scan("SN-003");
    await screen.findByText(/Queued \(2\)/);
    for (const r of screen.getAllByRole("radio")) expect(r).toBeDisabled();       // nothing fits both
    expect(screen.getByRole("note")).toHaveTextContent("This batch has assets that are With Employee / Store, Under Repair: only what is possible for all of them is offered.");
    expect(screen.getByRole("radio", { name: "Give to Employee" })).toHaveAttribute("title", "Not possible for every asset in this batch.");
    fireEvent.click(screen.getByRole("button", { name: "Remove FA/HO01/IT/LAP/CK_1" }));
    expect(screen.getByRole("radio", { name: "Receive from Repair" })).toBeEnabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("Mark Found is for an admin only", async () => {
    mockGets();
    await renderMovement();
    expect(screen.getByRole("radio", { name: "Mark Found" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Mark Found" })).toHaveAttribute("title", "Only an admin can do this.");
  });

  it("opened from Assets / Asset 360 (?ids=&choice=) it starts with those assets and that choice", async () => {
    const inStock = { ...LAPTOP, id: 4, asset_code: "FA/HO01/IT/LAP/CK_4", status: "IN_STOCK" };
    mockGets({ byIds: [inStock, LAPTOP] });
    await renderMovement("/asset-movement?ids=1,4&choice=store");
    await waitFor(() => expect(screen.getByText(/Queued \(2\)/)).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledWith("/assets?ids=1%2C4&limit=1000");
    expect(screen.getByRole("radio", { name: "Send to Store" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: "Store" })).toBeInTheDocument();
    // In the order they were sent, and nothing printed: nothing was scanned.
    const codes = screen.getAllByText(/^FA\/HO01\/IT\/LAP\/CK_\d/).map((el) => el.textContent?.split(" ")[0]);
    expect(codes).toEqual(["FA/HO01/IT/LAP/CK_1", "FA/HO01/IT/LAP/CK_4"]);
    expect(window.print).not.toHaveBeenCalled();
  });

  it("an unknown ?choice= is ignored", async () => {
    mockGets();
    await renderMovement("/asset-movement?choice=teleport");
    expect(screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
  });

  it("the scan box has the cursor on arrival and gets it back after each add (scanner-friendly)", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP], "SN-00": [LAPTOP, SCRAPPED_MOUSE] } });
    await renderMovement();
    const box = screen.getByLabelText(/scan or type/i);
    await waitFor(() => expect(document.activeElement).toBe(box));
    choose("Send for Repair");                                        // focus moves to the button...
    scan("SN-00");
    fireEvent.click(await screen.findByText(/Logitech Mouse/));       // ...and to the pick list
    await waitFor(() => expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box).toHaveValue("");
  });

  it("date, reference number and remarks sit under More; remarks alone go with the batch request", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    (apiClient.post as any).mockResolvedValue({ done: 1, failed: [] });
    await renderMovement();
    expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: /^more/i });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(screen.getByLabelText("Date")).toHaveValue(new Date().toLocaleDateString("en-CA"));   // today
    fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "handed over at reception" } });
    scan("SN-001");
    await screen.findByText(/Queued \(1\)/);
    choose("Send for Repair");
    fireEvent.click(applyButton("Send for Repair", 1));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/bulk-action", {
      asset_ids: [1], event_type: "SENT_FOR_REPAIR", to_asset_user_id: null, remarks: "handed over at reception",
    }));
  });

  it("S6: a reference number with today's date sends reference_no only (no date)", async () => {
    mockGets({ searchResults: { "SN-001": [LAPTOP] } });
    (apiClient.post as any).mockResolvedValue({ done: 1, failed: [] });
    await renderMovement();
    scan("SN-001");
    await screen.findByText(/Queued \(1\)/);
    choose("Send for Repair");
    fireEvent.click(screen.getByRole("button", { name: /^more/i }));
    fireEvent.change(screen.getByLabelText("Reference number"), { target: { value: " GP-9 " } });
    fireEvent.click(applyButton("Send for Repair", 1));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/bulk-action", {
      asset_ids: [1], event_type: "SENT_FOR_REPAIR", to_asset_user_id: null, remarks: null, reference_no: "GP-9",
    }));
  });

  it("S6: an earlier date and a reference number go with the ONE batch request; a refused asset comes back with its sentence", async () => {
    const second = { ...LAPTOP, id: 5, asset_code: "FA/HO01/IT/LAP/CK_5" };
    mockGets({ searchResults: { "SN-001": [LAPTOP], "SN-005": [second] } });
    (apiClient.post as any).mockResolvedValue({
      done: 1, failed: [{ asset_id: 5, reason: "The date cannot be before the asset's last recorded movement (02-10-2026)." }],
    });
    await renderMovement();
    scan("SN-001");
    await screen.findByText(/Queued \(1\)/);
    scan("SN-005");
    await screen.findByText(/Queued \(2\)/);
    choose("Give to Employee");
    await pick("Employee", /Ankur/);
    fireEvent.click(screen.getByRole("button", { name: /^more/i }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Reference number"), { target: { value: "GP-114" } });
    fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "new joiner kit" } });
    fireEvent.click(applyButton("Give to Employee", 2));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith("/assets/bulk-action", {
      asset_ids: [1, 5], event_type: "MOVED", to_asset_user_id: 11, remarks: "new joiner kit",
      event_date: new Date("2026-10-01").toISOString(), reference_no: "GP-114",
    });
    // No per-asset fallback any more.
    expect((apiClient.post as any).mock.calls.some((c: unknown[]) => String(c[0]).endsWith("/events"))).toBe(false);
    const result = await screen.findByTestId("move-result");
    expect(result).toHaveTextContent("1 asset given to the employee.");
    expect(result).toHaveTextContent("FA/HO01/IT/LAP/CK_5: The date cannot be before the asset's last recorded movement (02-10-2026).");
    expect(screen.getByText(/Queued \(1\)/)).toBeInTheDocument();          // the failed one stays
  });

  it("the result offers Print labels for what moved and Move more for the next batch", async () => {
    mockGets({ searchResults: { "SN-001": [{ ...LAPTOP, item_name: "Laptop" }] } });
    (apiClient.post as any).mockResolvedValue({ done: 1, failed: [] });
    await renderMovement();
    scan("SN-001");
    await screen.findByText(/Queued \(1\)/);
    choose("Install");
    await pick("Install Point", /Lamington Install Point/);
    fireEvent.click(applyButton("Install", 1));
    const result = await screen.findByTestId("move-result");
    expect(result).toHaveTextContent("1 asset installed.");

    fireEvent.click(within(result).getByRole("button", { name: "Print labels (1)" }));
    const dialog = await screen.findByRole("dialog", { name: "Print 1 label" });
    expect(within(dialog).getByTestId("label-preview")).toHaveTextContent("FA/HO01/IT/LAP/CK_1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Print 1 label" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(within(screen.getByTestId("move-result")).getByRole("button", { name: "Move more" }));
    expect(screen.queryByTestId("move-result")).not.toBeInTheDocument();
    expect(screen.getByText(/Queued \(0\)/)).toBeInTheDocument();
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

  it.each(KINDS)("%s: Return to Stock Room offers New Stock Room only when allowed; Give to Employee never offers a new person", async (_kind, caps) => {
    world(caps);
    await renderMovement();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    choose("Return to Stock Room");
    const trigger = screen.getByRole("combobox", { name: "Stock Room" });
    fireEvent.click(trigger);
    await screen.findByRole("option", { name: /IT Stock-HO/ });
    expect(screen.queryByRole("option", { name: /new stock room/i }) !== null).toBe(caps.can_create.stock_room === true);
    fireEvent.click(trigger);
    choose("Give to Employee");
    fireEvent.click(screen.getByRole("combobox", { name: "Employee" }));
    await screen.findByRole("option", { name: /Ankur/ });
    expect(screen.queryByRole("option", { name: /new (stock room|employee|store|person)/i })).not.toBeInTheDocument();
  });

  it("a new destination stock room asks for the company only when there is a choice, then is picked", async () => {
    world(OPERATOR_IT);
    (apiClient.post as any).mockResolvedValue({ id: 70, name: "Hisar Stock" });
    await renderMovement();
    choose("Return to Stock Room");
    fireEvent.click(screen.getByRole("combobox", { name: "Stock Room" }));
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
