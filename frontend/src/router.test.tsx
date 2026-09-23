import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "./router";
import { apiClient } from "./lib/api-client";
import { useAuthStore } from "./lib/auth-store";

vi.mock("./lib/api-client");

const ASSET = { id: 123, asset_code: "FA/HO01/IT/LAP/CK_123", description: "Scanned Laptop", status: "IN_STOCK", company_id: 1 };

function mockApi() {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/companies") return Promise.resolve([{ id: 1, name: "Citykart Stores" }]);
    if (path === "/reports/dashboard") {
      return Promise.resolve({ status_counts: {}, stock_by_location: [], warranty_alerts: [], long_allocation_alerts: [] });
    }
    if (path === "/assets/123") return Promise.resolve(ASSET);
    if (path.startsWith("/assets")) return Promise.resolve({ items: [], total: 0 });
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

function loginAs(role: string, mustChangePassword = false) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role, companyId: 1, mustChangePassword });
}

async function submitLogin() {
  await screen.findByLabelText(/user id/i);
  fireEvent.change(screen.getByLabelText(/user id/i), { target: { value: "CS1" } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "Temp-Passw0rd" } });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));
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

  it("forces a holder with must_change_password onto the change-password screen", async () => {
    loginAs("ADMIN", true);
    const router = renderAt("/dashboard");
    await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));
    expect(await screen.findByText(/set a new password/i)).toBeInTheDocument();
    // No app navigation is rendered while the change is pending.
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("keeps bouncing to change-password whatever page is requested", async () => {
    loginAs("IT_TEAM", true);
    for (const url of ["/assets", "/setup/holders", "/my-assets", "/"]) {
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
    expect(await screen.findByText("FA/HO01/IT/LAP/CK_123")).toBeInTheDocument();
  });

  it("lands on the role's home page when there is no next", async () => {
    (apiClient.post as any).mockResolvedValue({ access_token: "tok", must_change_password: false, role: "HOLDER", company_id: 1 });
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

describe("AppShell navigation", () => {
  async function openSetup() {
    const trigger = await screen.findByRole("button", { name: /setup/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.findByRole("menu");
  }

  it("gives an ADMIN every screen, including Import, Reports and all Setup screens", async () => {
    loginAs("ADMIN");
    renderAt("/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    for (const name of ["Dashboard", "Assets", "Add Asset", "Import", "Reports", "My Assets"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    const menu = await openSetup();
    for (const name of [
      "Companies", "Locations", "Departments", "Cost Centers", "Categories", "Sub-Categories",
      "Vendors", "Custom Fields", "Holders & Users", "Code Rule",
    ]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
    expect(within(menu).getByRole("menuitem", { name: "Code Rule" })).toHaveAttribute("href", "/setup/code-rule");
  });

  it("gives IT_TEAM the masters but not holders/users or the code rule", async () => {
    loginAs("IT_TEAM");
    renderAt("/dashboard");
    const menu = await openSetup();
    expect(within(menu).getByRole("menuitem", { name: "Cost Centers" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Code Rule" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Holders & Users" })).not.toBeInTheDocument();
  });

  it("gives a VIEWER read-only screens only", async () => {
    loginAs("VIEWER");
    renderAt("/dashboard");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Add Asset" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: /setup/i })).not.toBeInTheDocument();
  });

  it("gives a HOLDER only My Assets", async () => {
    loginAs("HOLDER");
    renderAt("/my-assets");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["My Assets"]);
  });
});
