import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup as cleanupDom, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "./router";
import { apiClient } from "./lib/api-client";
import { useAuthStore } from "./lib/auth-store";

vi.mock("./lib/api-client");

// Shaped like AssetDetailOut (AM-04) -- AssetDetail reads every one of these
// fields unconditionally, so a route-guard test that renders it needs the
// full shape even though these tests don't otherwise care about it.
const ASSET = {
  id: 123, asset_code: "FA/HO01/IT/LAP/CK_123", legacy_asset_code: null, description: "Scanned Laptop",
  status: "IN_STOCK", company_id: 1, cost_center_id: 1, category_id: 1, subcategory_id: null,
  brand_id: null, model: null, serial_number: null, vendor_id: null, po_number: null, po_date: null,
  invoice_number: null, invoice_date: null, invoice_amount: null, pi_number: null, pi_date: null, purchase_cost: null,
  tax_percent: null, tax_amount: null, total_cost: null, purchase_date: "2025-01-01",
  warranty_years: null, warranty_upto: null,
  current_asset_user_id: 1, status_since: "2025-01-01", custom_fields: {},
  category_name: null, subcategory_name: null, cost_center_name: null, vendor_name: null, brand_name: null,
  current_asset_user_name: "IT Stock-HO", current_asset_user_type: "STOCK_POINT", location_name: null, department_name: null,
};

function mockApi() {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/reports/dashboard") {
      return Promise.resolve({ status_counts: {}, stock_by_location: [], warranty_alerts: [], long_allocation_alerts: [] });
    }
    if (path === "/assets/123") return Promise.resolve(ASSET);
    if (path.startsWith("/assets")) return Promise.resolve({ items: [], total: 0 });
    if (path === "/assets/123/changes") return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

function renderAt(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function loginAs(role: string, mustChangePassword = false, isPrimaryOwner = false) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role, companyId: isPrimaryOwner ? null : 1, isPrimaryOwner, mustChangePassword });
}

async function submitLogin() {
  await screen.findByLabelText(/user id/i);
  fireEvent.change(screen.getByLabelText(/user id/i), { target: { value: "CS1" } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "Temp-Passw0rd" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
  useAuthStore.getState().logout();
  // AssetDetail's QR image goes through authFetch -> window.fetch.
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
});

afterEach(() => useAuthStore.getState().logout());

describe("route guards", () => {
  it("sends an unauthenticated visitor (e.g. a scanned QR label) to /login, remembering the asset URL", async () => {
    const router = renderAt("/assets/123");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toEqual({ next: "/assets/123" });
  });

  it("forces a asset_user with must_change_password onto the change-password screen", async () => {
    loginAs("ADMIN", true);
    const router = renderAt("/dashboard");
    await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));
    expect(await screen.findByText(/set a new password/i)).toBeInTheDocument();
    // No app navigation is rendered while the change is pending.
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("keeps bouncing to change-password whatever page is requested", async () => {
    loginAs("OPERATOR", true);
    for (const url of ["/assets", "/setup/asset-users", "/my-assets", "/"]) {
      const router = renderAt(url);
      await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));
    }
  });
});

describe("login flow", () => {
  it("returns to the originally requested asset after logging in", async () => {
    (apiClient.post as any).mockResolvedValue({ access_token: "tok", must_change_password: false, role: "ADMIN", company_id: 1 });
    const router = renderAt("/login?next=%2Fassets%2F123");

    await submitLogin();

    await waitFor(() => expect(router.state.location.pathname).toBe("/assets/123"));
    expect(await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_123" })).toBeInTheDocument();
  });

  it("lands on the role's home page when there is no next", async () => {
    (apiClient.post as any).mockResolvedValue({ access_token: "tok", must_change_password: false, role: "SELF_SERVICE", company_id: 1 });
    const router = renderAt("/login");
    await submitLogin();
    await waitFor(() => expect(router.state.location.pathname).toBe("/my-assets"));
  });

  it("ignores an off-site next (open redirect)", async () => {
    (apiClient.post as any).mockResolvedValue({ access_token: "tok", must_change_password: false, role: "ADMIN", company_id: 1 });
    const router = renderAt("/login?next=%2F%2Fevil.example%2Fphish");
    await submitLogin();
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });

  it("routes a must-change-password login through the change screen, then on to next", async () => {
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/auth/login") {
        return Promise.resolve({ access_token: "tok", must_change_password: true, role: "ADMIN", company_id: 1 });
      }
      return Promise.resolve(undefined); // /auth/change-password -> 204
    });
    const router = renderAt("/login?next=%2Fassets%2F123");

    await submitLogin();
    await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));

    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: "Temp-Passw0rd" } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "My-Own-Passw0rd" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "My-Own-Passw0rd" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/auth/change-password", {
        old_password: "Temp-Passw0rd",
        new_password: "My-Own-Passw0rd",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/assets/123"));
    expect(useAuthStore.getState().mustChangePassword).toBe(false);
  });
});

const navLinkNames = (nav: HTMLElement) => within(nav).getAllByRole("link").map((l) => l.textContent?.trim());

const OPERATOR_MENU = ["Home", "Assets", "Purchase Orders", "Receive", "Move", "Reports"];
const PEOPLE_MENU = ["Employees", "Stores", "Stock Rooms", "Install Points"];
const SETTINGS_LINKS = [
  "All Settings", "Organisation",
  "Items", "Asset Groups", "Brands",
  "Vendors", "Users & Access", "ERP Mapping", "ERP Data Sync",
  "Custom Fields", "Asset Code Format", "Bulk Import",
];

describe("AppShell navigation (role-aware sidebar)", () => {
  it("gives the head-office admin the work menu, People & Places and a collapsed Settings group", async () => {
    loginAs("ADMIN", false, true);
    renderAt("/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(navLinkNames(nav)).toEqual(["Home", "Assets", "Purchase Orders", "Receive", "Move", ...PEOPLE_MENU, "Reports"]);

    // Settings starts collapsed: none of its screens are listed until it is opened.
    const settings = within(nav).getByRole("button", { name: /settings/i });
    expect(settings).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).queryByRole("link", { name: "Organisation" })).not.toBeInTheDocument();

    fireEvent.click(settings);
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Organisation" })).toBeInTheDocument());
    // Exactly the new structure, in order: no Sub-categories, Bundles or separate Companies/Places entries.
    const settingsList = within(nav).getByRole("list", { name: "Settings" });
    expect(within(settingsList).getAllByRole("link").map((l) => l.textContent?.trim())).toEqual(SETTINGS_LINKS);
    for (const gone of ["Bundles", "Sub-categories", "Companies", "People & Logins"]) {
      expect(within(nav).queryByRole("link", { name: gone })).not.toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: "All Settings" })).toHaveAttribute("href", "/settings");
    expect(within(nav).getByRole("link", { name: "Organisation" })).toHaveAttribute("href", "/settings/organisation");
    expect(within(nav).getByRole("link", { name: "Asset Groups" })).toHaveAttribute("href", "/settings/catalogue/asset-groups");
    expect(within(nav).getByRole("link", { name: "Asset Code Format" })).toHaveAttribute("href", "/settings/advanced/code-format");
    expect(within(nav).getByRole("link", { name: "ERP Mapping" })).toHaveAttribute("href", "/settings/erp/mapping");
    expect(within(nav).getByRole("link", { name: "ERP Data Sync" })).toHaveAttribute("href", "/settings/erp/sync");
    expect(within(nav).getByRole("link", { name: "Bulk Import" })).toHaveAttribute("href", "/settings/advanced/import");
    expect(within(nav).getByRole("link", { name: "Users & Access" })).toHaveAttribute("href", "/settings/users-access");
  });

  it("opens the Settings group by itself, and highlights the entry, when the current page is one of its screens", async () => {
    loginAs("ADMIN", false, true);
    renderAt("/setup/companies"); // an old address: lands on Organisation › Companies
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const org = await within(nav).findByRole("link", { name: "Organisation" });
    expect(within(nav).getByRole("button", { name: /settings/i })).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(org).toHaveAttribute("data-active", "true"));
    expect(within(nav).getByRole("link", { name: "Items" })).toHaveAttribute("data-active", "false");
  });

  it("gives an ordinary ADMIN the operator menu plus People & Places, but no Settings", async () => {
    loginAs("ADMIN");
    renderAt("/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(navLinkNames(nav)).toEqual(["Home", "Assets", "Purchase Orders", "Receive", "Move", ...PEOPLE_MENU, "Reports"]);
    expect(within(nav).queryByRole("button", { name: /settings/i })).not.toBeInTheDocument();
  });

  it("gives an OPERATOR (IT or Non-IT: the same menu) Home, Assets, Purchase Orders, Receive, Move and Reports", async () => {
    loginAs("OPERATOR");
    renderAt("/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(navLinkNames(nav)).toEqual(OPERATOR_MENU);
    expect(within(nav).queryByRole("button", { name: /settings/i })).not.toBeInTheDocument();
  });

  it("gives a VIEWER Home, Assets and Reports only", async () => {
    loginAs("VIEWER");
    renderAt("/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(navLinkNames(nav)).toEqual(["Home", "Assets", "Reports"]);
  });

  it("gives a self-service login only My Assets", async () => {
    loginAs("SELF_SERVICE");
    renderAt("/my-assets");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(navLinkNames(nav)).toEqual(["My Assets"]);
  });

  it("no longer lists Add Asset, Serial Pending, Print Labels, Import or My Assets for staff", async () => {
    loginAs("ADMIN", false, true);
    renderAt("/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    for (const name of ["Add Asset", "Serial Pending", "Print Labels", "Import", "My Assets", "Dashboard", "Asset Register"]) {
      expect(within(nav).queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });

  it("shows the person's access level in plain words in the header", async () => {
    loginAs("OPERATOR");
    renderAt("/dashboard");
    expect(await screen.findByTestId("session-role")).toHaveTextContent("Can Add & Move Assets");
  });
});

describe("route guards by area", () => {
  // UX only: the server still refuses; the point is that nobody sees a
  // working-looking screen that later fails with 403.
  const NO_ACCESS = /you don't have access to this area/i;

  async function expectNoAccess(url: string) {
    renderAt(url);
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument();
  }

  async function expectAllowed(url: string) {
    renderAt(url);
    await screen.findByRole("navigation", { name: "Main" });
    // The screen's own page heading renders, and it is not the no-access page.
    await waitFor(() => expect(document.querySelector("h1")).not.toBeNull());
    expect(screen.queryByText(NO_ACCESS)).not.toBeInTheDocument();
  }

  afterEach(() => cleanupDom());

  it("Settings screens and Bulk Import: head-office admin only", async () => {
    for (const url of [
      "/setup/companies", "/setup/custom-fields", "/setup/code-rule", "/setup/erp-articles", "/import",
      "/settings", "/settings/setup", "/settings/organisation", "/settings/catalogue/asset-groups",
      "/settings/users-access", "/settings/erp/sync", "/setup/bundles",
    ]) {
      loginAs("ADMIN", false, true);
      await expectAllowed(url);
      cleanupDom();
      for (const role of ["ADMIN", "OPERATOR", "VIEWER", "SELF_SERVICE"]) {
        loginAs(role);
        await expectNoAccess(url);
        cleanupDom();
      }
    }
  });

  it("People & Places: role ADMIN (head-office admin included) only", async () => {
    for (const url of ["/people/employees", "/people/stores", "/people/stock-rooms", "/people/install-points"]) {
      loginAs("ADMIN");
      await expectAllowed(url);
      cleanupDom();
      loginAs("ADMIN", false, true);
      await expectAllowed(url);
      cleanupDom();
      for (const role of ["OPERATOR", "VIEWER", "SELF_SERVICE"]) {
        loginAs(role);
        await expectNoAccess(url);
        cleanupDom();
      }
    }
  });

  it("Purchase Orders, Receive, Add Assets, Move, Serial Pending, Print Labels: ADMIN or OPERATOR", async () => {
    for (const url of ["/receive", "/purchase-orders", "/purchase-orders/new", "/assets/new", "/asset-movement", "/serial-pending", "/print-labels"]) {
      for (const role of ["ADMIN", "OPERATOR"]) {
        loginAs(role);
        await expectAllowed(url);
        cleanupDom();
      }
      for (const role of ["VIEWER", "SELF_SERVICE"]) {
        loginAs(role);
        await expectNoAccess(url);
        cleanupDom();
      }
    }
  });

  it("Home, Assets and Reports: every staff role, not a self-service login", async () => {
    for (const url of ["/dashboard", "/assets", "/reports"]) {
      for (const role of ["ADMIN", "OPERATOR", "VIEWER"]) {
        loginAs(role);
        await expectAllowed(url);
        cleanupDom();
      }
      loginAs("SELF_SERVICE");
      await expectNoAccess(url);
      cleanupDom();
    }
  });

  it("the no-access page offers a way back Home (My Assets for a self-service login)", async () => {
    loginAs("OPERATOR");
    renderAt("/setup/companies");
    expect(await screen.findByRole("link", { name: /go to home/i })).toHaveAttribute("href", "/dashboard");
    cleanupDom();
    loginAs("SELF_SERVICE");
    renderAt("/dashboard");
    expect(await screen.findByRole("link", { name: /go to my assets/i })).toHaveAttribute("href", "/my-assets");
  });

  it("never fetches a guarded screen's data for someone who may not use it", async () => {
    loginAs("OPERATOR");
    renderAt("/setup/companies");
    await screen.findByText(NO_ACCESS);
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining("/masters/companies"));
  });

  it("keeps Asset 360 open to everyone the server allows, including a self-service login", async () => {
    loginAs("SELF_SERVICE");
    renderAt("/assets/123");
    expect(await screen.findByRole("heading", { name: "FA/HO01/IT/LAP/CK_123" })).toBeInTheDocument();
    expect(screen.queryByText(NO_ACCESS)).not.toBeInTheDocument();
  });

  it("sends the old Asset Users address to People & Places > Employees", async () => {
    loginAs("ADMIN");
    const router = renderAt("/setup/asset-users");
    await waitFor(() => expect(router.state.location.pathname).toBe("/people/employees"));
  });
});

describe("My Assets", () => {
  it("sends staff to Assets with the Mine filter on", async () => {
    loginAs("OPERATOR");
    const router = renderAt("/my-assets");
    await waitFor(() => expect(router.state.location.pathname).toBe("/assets"));
    expect(router.state.location.search).toEqual({ mine: true });
  });

  it("stays the self-service login's own page", async () => {
    loginAs("SELF_SERVICE");
    const router = renderAt("/my-assets");
    expect(await screen.findByRole("heading", { name: "My Assets" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/my-assets");
    expect(screen.getByText(/assets that are with you/i)).toBeInTheDocument();
  });
});
