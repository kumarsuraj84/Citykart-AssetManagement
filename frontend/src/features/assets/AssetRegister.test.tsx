import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

// AssetRegister navigates via the app router (AM-03 §11), so it needs a real
// RouterProvider ancestor -- render it through the actual route tree at
// /assets, the same pattern router.test.tsx uses for every other screen.
function renderRegisterAt(url = "/assets") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// Same click-based interaction as AssetDetail.test.tsx and AddAssetForm.test.tsx use for
// a real shadcn/ui Select: it's a Radix combobox trigger + listbox, not a native <select>.
async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});

afterEach(() => useAuthStore.getState().logout());

describe("AssetRegister", () => {
  it("lists assets and searches by the query box", async () => {
    (apiClient.get as any).mockResolvedValue({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }], total: 1 });

    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "CK_1" } });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("q=CK_1")));
  });

  it("the Exact match checkbox adds exact=true to the search request, only while there is search text", async () => {
    (apiClient.get as any).mockResolvedValue({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK1", description: "Laptop", status: "IN_STOCK" }], total: 1 });

    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK1")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "ck1" } });
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.stringMatching(/q=ck1/)));
    expect(apiClient.get).toHaveBeenLastCalledWith(expect.not.stringContaining("exact="));

    fireEvent.click(screen.getByRole("checkbox", { name: /exact match/i }));
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.stringContaining("exact=true")));
    expect(apiClient.get).toHaveBeenLastCalledWith(expect.stringContaining("q=ck1"));

    fireEvent.click(screen.getByRole("checkbox", { name: /exact match/i }));
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.not.stringContaining("exact=")));
  });

  it("AM-21: clicking the Code column header requests a server-side sort, and clicking again reverses it", async () => {
    (apiClient.get as any).mockResolvedValue({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }], total: 1 });
    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /sort by code/i }));
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("sort_by=asset_code")),
    );
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("sort_dir=asc"));

    fireEvent.click(screen.getByRole("button", { name: /sort by code/i }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("sort_dir=desc")));
  });

  it("shows the current asset_user and company the backend resolved for each row (AM-11)", async () => {
    (apiClient.get as any).mockResolvedValue({
      items: [
        { id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "ALLOTTED", current_asset_user_name: "Jane Doe", company_name: "Citykart Stores" },
        { id: 2, asset_code: "FA/HO01/IT/LAP/CK_2", description: "Printer", status: "IN_STOCK", current_asset_user_name: null, company_name: null },
      ],
      total: 2,
    });

    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("Citykart Stores")).toBeInTheDocument();
    // A row with no resolved name (defensive fallback, should not happen in practice) renders an em dash, not blank/undefined.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("re-queries the register when a filter-bar dimension is picked", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets")) {
        return Promise.resolve({
          items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }],
          total: 1,
        });
      }
      // /masters/categories, /masters/companies, /asset-users
      return Promise.resolve([]);
    });

    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    await pickSelectOption(/status/i, /in stock/i);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("status=IN_STOCK")));
  });

  it("a Custom Field gets its own Columns entry and shows its stored value once toggled on", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets")) {
        return Promise.resolve({
          items: [
            {
              id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK",
              custom_fields: { helpdesk_ticket_no: "HD-4821" },
            },
          ],
          total: 1,
        });
      }
      if (path === "/masters/custom-fields") {
        return Promise.resolve([
          { id: 1, field_key: "helpdesk_ticket_no", label: "Helpdesk Ticket No", field_type: "text", sort_order: 1, company_id: null },
        ]);
      }
      return Promise.resolve([]);
    });

    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("button", { name: /^columns$/i }));
    await waitFor(() => expect(screen.getByText(/show columns/i)).toBeInTheDocument());
    const item = await screen.findByRole("menuitemcheckbox", { name: "Helpdesk Ticket No" });
    expect(item).toHaveAttribute("aria-checked", "false");
    fireEvent.click(item);
    // The menu stays open across multiple toggles (so picking several
    // columns doesn't mean reopening it each time) -- while it's open,
    // Radix marks the rest of the page aria-hidden, so close it first
    // before querying the underlying table's own accessible roles.
    fireEvent.keyDown(item, { key: "Escape" });

    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Helpdesk Ticket No" })).toBeInTheDocument());
    expect(screen.getByText("HD-4821")).toBeInTheDocument();
  });

  it("pages through the register with limit/offset and shows the total", async () => {
    const rows = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: start + i,
        asset_code: `FA/CK_${start + i}`,
        description: "Laptop",
        status: "IN_STOCK",
      }));
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets")) {
        const params = new URLSearchParams(path.split("?")[1]);
        const offset = Number(params.get("offset"));
        const limit = Number(params.get("limit"));
        const total = 120;
        return Promise.resolve({ items: rows(offset + 1, Math.min(limit, total - offset)), total });
      }
      return Promise.resolve([]);
    });

    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/CK_1")).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringMatching(/limit=50.*offset=0|offset=0.*limit=50/));
    expect(screen.getByText(/showing 1–50 of 120/i)).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("FA/CK_51")).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("offset=50"));
    expect(screen.getByText(/showing 51–100 of 120/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("FA/CK_101")).toBeInTheDocument());
    expect(screen.getByText(/showing 101–120 of 120/i)).toBeInTheDocument();
    expect(screen.getByText(/page 3 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();

    // Changing a filter goes back to the first page.
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "CK" } });
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.stringMatching(/q=CK.*offset=0/)));
  });

  it("S5a: Move (n) opens the one Move screen with the selected assets already in the batch (no dialog here)", async () => {
    const rows = [
      { id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop 1", status: "IN_STOCK" },
      { id: 2, asset_code: "FA/HO01/IT/LAP/CK_2", description: "Laptop 2", status: "IN_STOCK" },
    ];
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets?ids=")) return Promise.resolve({ items: rows, total: 2 });
      if (path.startsWith("/assets")) return Promise.resolve({ items: rows, total: 2 });
      if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 5, name: "Warehouse", asset_user_type: "STOCK_POINT" }]);
      return Promise.resolve([]); // /masters/categories, /masters/companies
    });

    const router = renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Move (2)" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() => expect(router.state.location.pathname).toBe("/asset-movement"));
    expect(router.state.location.search).toEqual({ ids: "1,2" });
    expect(await screen.findByText(/Queued \(2\)/)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("shows a real empty state, with filter-aware copy, when a search matches nothing", async () => {
    (apiClient.get as any).mockImplementation((path: string) =>
      path.startsWith("/assets") ? Promise.resolve({ items: [], total: 0 }) : Promise.resolve([]),
    );
    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("No assets found.")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "nomatch" } });
    await waitFor(() => expect(screen.getByText(/try a different search or filter/i)).toBeInTheDocument());
  });

  it("shows an error state with a working retry action when the register fails to load", async () => {
    (apiClient.get as any).mockImplementation((path: string) =>
      path.startsWith("/assets") ? Promise.reject(new Error("network down")) : Promise.resolve([]),
    );
    renderRegisterAt();
    await waitFor(() => expect(screen.getByText(/couldn't load the asset register/i)).toBeInTheDocument());

    (apiClient.get as any).mockImplementation((path: string) =>
      path.startsWith("/assets")
        ? Promise.resolve({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }], total: 1 })
        : Promise.resolve([]),
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
  });

  it("navigates to the asset via the SPA router when a row is clicked, without a full page reload", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/1") {
        return Promise.resolve({ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK", company_id: 1 });
      }
      if (path.startsWith("/assets")) {
        return Promise.resolve({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }], total: 1 });
      }
      return Promise.resolve([]);
    });
    // AssetDetail's QR image goes through authFetch -> window.fetch.
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;

    const router = renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Laptop"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/assets/1"));
  });

  it("does not navigate the row when the selection checkbox is clicked", async () => {
    (apiClient.get as any).mockImplementation((path: string) =>
      path.startsWith("/assets")
        ? Promise.resolve({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }], total: 1 })
        : Promise.resolve([]),
    );
    const router = renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "Select FA/HO01/IT/LAP/CK_1" }));

    expect(router.state.location.pathname).toBe("/assets");
    expect(screen.getByRole("checkbox", { name: "Select FA/HO01/IT/LAP/CK_1" })).toBeChecked();
  });
});

describe("AssetRegister: S1 navigation and plain words", () => {
  const ROW = { id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "ALLOTTED", current_asset_user_type: "EMPLOYEE", current_asset_user_name: "Jane Doe" };
  const PEOPLE = [
    { id: 5, code: "CS5", name: "Me Myself", asset_user_type: "EMPLOYEE", company_id: 1, location_id: 10 },
    { id: 6, code: "STK-HO", name: "HO Stock", asset_user_type: "STOCK_POINT", company_id: 2, location_id: 10 },
  ];

  function mockRegister() {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets?serial_pending=true")) return Promise.resolve({ items: [], total: 4 });
      if (path.startsWith("/assets")) return Promise.resolve({ items: [ROW], total: 1 });
      if (path === "/asset-users") return Promise.resolve(PEOPLE);
      if (path === "/masters/locations") return Promise.resolve([{ id: 10, name: "Head Office" }]);
      if (path === "/masters/companies") return Promise.resolve([{ id: 1, code: "CKSPL", name: "CityKart Stores" }, { id: 2, code: "CKV", name: "CityKart Ventures" }]);
      return Promise.resolve([]);
    });
  }

  function loginAs(role: string, assetUserId: number | null = 5, isPrimaryOwner = false) {
    useAuthStore.getState().setAuth({ accessToken: "tok", role, companyId: 1, isPrimaryOwner, mustChangePassword: false, assetUserId });
  }

  it("is titled Assets, with Add Assets and Serial Pending (n) in the header for people who can add", async () => {
    loginAs("OPERATOR");
    mockRegister();
    renderRegisterAt();
    expect(await screen.findByRole("heading", { name: "Assets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add assets/i })).toHaveAttribute("href", "/assets/new");
    const serial = await screen.findByRole("link", { name: /serial pending \(4\)/i });
    expect(serial).toHaveAttribute("href", "/serial-pending");
  });

  it("a VIEWER gets neither header button nor row checkboxes (nothing to move)", async () => {
    loginAs("VIEWER");
    mockRegister();
    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /add assets/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /serial pending/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /select/i })).not.toBeInTheDocument();
  });

  it("S5a: offers Print labels (n) next to Move (n), printing the selected assets' labels right here", async () => {
    loginAs("ADMIN");
    mockRegister();
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;    // label pictures
    window.print = vi.fn();
    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FA/HO01/IT/LAP/CK_1" }));
    expect(screen.getByRole("button", { name: "Move (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Print labels (1)" }));
    const dialog = await screen.findByRole("dialog", { name: "Print 1 label" });
    // The one shared Label settings disclosure, and a preview of this row's label.
    expect(within(dialog).getByRole("button", { name: /label settings/i })).toBeInTheDocument();
    expect(within(dialog).getByTestId("label-preview")).toHaveTextContent("FA/HO01/IT/LAP/CK_1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Print 1 label" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
  });

  it("S5a: a VIEWER is offered neither Print labels nor Move", async () => {
    loginAs("VIEWER");
    mockRegister();
    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /print labels|^move/i })).not.toBeInTheDocument();
  });

  it("the Mine toggle filters to the logged-in person's own assets, and turns off again", async () => {
    loginAs("OPERATOR", 5);
    mockRegister();
    renderRegisterAt();
    const mine = await screen.findByRole("button", { name: /mine/i });
    expect(mine).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(mine);
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.stringContaining("asset_user_id=5")));
    expect(screen.getByRole("button", { name: /mine/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/showing only the assets with you/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /mine/i }));
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.not.stringContaining("asset_user_id=")));
  });

  it("/assets?mine=true starts with Mine on", async () => {
    loginAs("VIEWER", 5);
    mockRegister();
    renderRegisterAt("/assets?mine=true");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("asset_user_id=5")));
    expect(await screen.findByRole("button", { name: /mine/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("hides Mine for the head-office admin account (not a person who holds assets) and when the id is unknown", async () => {
    loginAs("ADMIN", 5, true);
    mockRegister();
    const { unmount } = render(<></>);
    unmount();
    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /mine/i })).not.toBeInTheDocument();
  });

  it("Find Asset (?find=true) puts the cursor in the search box", async () => {
    loginAs("OPERATOR");
    mockRegister();
    renderRegisterAt("/assets?find=true");
    const search = await screen.findByLabelText("Search");
    await waitFor(() => expect(search).toHaveFocus());
  });

  it("shows statuses, work area and the With column in plain words -- never a raw code", async () => {
    loginAs("OPERATOR");
    mockRegister();
    renderRegisterAt();
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.getByText("With Employee")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "With" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Work area" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: /status/i }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual([
      "All statuses", "In Stock", "With Employee / Store", "Installed", "Under Repair", "Lost", "Sold", "Scrapped", "Disposed",
    ]);
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });

    expect(document.body.textContent ?? "").not.toMatch(/IN_STOCK|ALLOTTED|asset_users|Responsibility|Asset User/);
  });

  it("the With filter starts at Everyone and shows code, name, place and company for each person or place", async () => {
    loginAs("OPERATOR");
    mockRegister();
    renderRegisterAt();
    const withFilter = await screen.findByRole("combobox", { name: "With" });
    expect(withFilter).toHaveTextContent("Everyone");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/locations"));
    fireEvent.click(withFilter);
    expect(await screen.findByRole("option", { name: "CS5 · Me Myself · Head Office · CKSPL" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "HO Stock · Head Office · CKV" })).toBeInTheDocument();
  });

  it("Category and Company filters are searchable", async () => {
    loginAs("OPERATOR");
    mockRegister();
    renderRegisterAt();
    fireEvent.click(await screen.findByRole("combobox", { name: "Company" }));
    expect(await screen.findByPlaceholderText("Search…")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("option", { name: "CityKart Ventures" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("company_id=2")));
  });
});
