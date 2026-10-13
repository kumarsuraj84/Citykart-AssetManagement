import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { computeSetupSteps, type SetupCounts } from "./setup-progress";
import { SETTINGS_SECTIONS } from "./settings-structure";

vi.mock("../../lib/api-client");

type Level = "empty" | "partial" | "complete";

const person = (id: number, type: string, over: Record<string, unknown> = {}) => ({
  id, code: `P${id}`, name: `Person ${id}`, asset_user_type: type, company_id: 1, location_id: 1, department_id: null,
  phone: null, email: null, login_enabled: false, role: null, is_primary_owner: false, is_active: true, ...over,
});

function mockApi(level: Level, erp: { configured?: boolean } = {}) {
  const some = (rows: unknown[]) => (level === "complete" ? rows : []);
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/reports/dashboard" || path.startsWith("/reports/dashboard?")) {
      return Promise.resolve({ status_counts: {}, stock_by_location: [], warranty_alerts: [], long_allocation_alerts: [], recent_activity: [] });
    }
    if (path === "/erp/sync") {
      return Promise.resolve(erp.configured
        ? { configured: true, last: null, last_success: { status: "success", trigger: "auto", started_at: "2026-10-13T08:00:00Z", finished_at: "2026-10-13T08:01:00Z", source_stamp: null, message: null, po_lines_new: 0, po_lines_changed: 0, po_lines_gone: 0 } }
        : { configured: false, last: null, last_success: null });
    }
    if (path.startsWith("/erp/")) return Promise.resolve({ configured: false });
    if (level === "empty") return Promise.resolve([]);
    if (path === "/masters/companies") return Promise.resolve([{ id: 1, code: "CKS", name: "Citykart Stores", erp_company_code: null }]);
    if (path.startsWith("/masters/locations")) return Promise.resolve([{ id: 1, company_id: 1, code: "HO", name: "Head Office", address: null }]);
    if (path === "/asset-users") {
      const rows = [person(1, "EMPLOYEE", { is_primary_owner: true }), person(5, "STOCK_POINT")];
      return Promise.resolve(level === "complete" ? [...rows, person(6, "EMPLOYEE"), person(7, "STORE")] : rows);
    }
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve(some([{ id: 1, company_id: 1, code: "HO", name: "Head Office" }]));
    if (path === "/masters/categories") return Promise.resolve(some([{ id: 1, code: "ITFA", name: "IT Fixed Assets", asset_domain: "IT" }]));
    if (path === "/masters/subcategories") return Promise.resolve(some([{ id: 10, category_id: 1, code: "LAP", name: "Laptop" }]));
    if (path === "/items") return Promise.resolve(some([{ id: 1, name: "Laptop", category_id: 1, subcategory_id: 10, serial_required: true, serial_later: false, bundle_id: null, default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0 }]));
    if (path === "/masters/vendors") return Promise.resolve(some([{ id: 1, code: "ACME", name: "Acme", gstin: null, erp_links: [] }]));
    if (path === "/code-rules") return Promise.resolve(some([{ id: 1, company_id: null, prefix_template: "FA/{company.code}/", suffix_template: "", start_number: 1, pad_width: 4 }]));
    return Promise.resolve([]);
  });
}

function renderAt(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

function loginAs(role: string, isPrimaryOwner = false) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role, companyId: isPrimaryOwner ? null : 1, isPrimaryOwner, mustChangePassword: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
  loginAs("ADMIN", true);
});
afterEach(() => useAuthStore.getState().logout());

// ---------------------------------------------------------------------------

const ZERO: SetupCounts = {
  companies: 0, places: 0, stockRooms: 0, costCentres: 0, groups: 0, items: 0, vendors: 0, employees: 0, stores: 0, codeFormat: false,
};

describe("Set up CKAM: step status comes from the data", () => {
  it("nothing exists: seven steps, none done", () => {
    const steps = computeSetupSteps(ZERO);
    expect(steps.map((s) => s.title)).toEqual([
      "Company", "Stock Room / Places", "Cost Centre", "Asset Groups and first Items", "Vendors", "People / Stores", "Asset Code Format",
    ]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps[1].status).toBe("no place yet · no stock room yet");
  });

  it("partial: a step needing two things is done only when both exist", () => {
    const steps = computeSetupSteps({ ...ZERO, companies: 2, places: 1, groups: 1, stores: 1 });
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(["company", "people"]);
    expect(steps[0].status).toBe("2 companies");
    expect(steps[1].done).toBe(false);          // a Place but no Stock Room
    expect(steps[3].done).toBe(false);          // a group but no Item
  });

  it("complete: every step done", () => {
    const steps = computeSetupSteps({
      companies: 1, places: 1, stockRooms: 1, costCentres: 1, groups: 1, items: 3, vendors: 1, employees: 1, stores: 0, codeFormat: true,
    });
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps[6].status).toBe("saved");
  });
});

describe("Set up CKAM screen", () => {
  it("with nothing set up: 0 of 7, opens step 1 with the normal Companies screen, and Skip moves on", async () => {
    mockApi("empty");
    const router = renderAt("/settings/setup");
    expect(await screen.findByRole("heading", { level: 1, name: "Set up CKAM" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("0 of 7 done"));
    await waitFor(() => expect(router.state.location.search).toEqual({ step: 1 }));
    expect(screen.getByRole("heading", { name: "Company" })).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: "Add Company" }))[0]).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ step: 2 }));
    expect(await screen.findByRole("heading", { name: "Places" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Stock Rooms" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ step: 1 }));
  });

  it("partly set up: shows what is done and resumes at the first step still to do", async () => {
    mockApi("partial");
    const router = renderAt("/settings/setup");
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("2 of 7 done"));
    await waitFor(() => expect(router.state.location.search).toEqual({ step: 3 }));
    const steps = screen.getByRole("list", { name: "Set-up steps" });
    expect(within(steps).getByText("Done · 1 company")).toBeInTheDocument();
    expect(within(steps).getByText("Done · 1 place · 1 stock room")).toBeInTheDocument();
    expect(within(steps).getByText("To do · no cost centre yet")).toBeInTheDocument();
    // The head-office admin's own record is not counted as an employee.
    expect(within(steps).getByText("To do · no employee yet · no store yet")).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: "Add Cost Centre" }))[0]).toBeInTheDocument();
  });

  it("complete: 7 of 7, says so, and the last step shows the live code example and Finish", async () => {
    mockApi("complete");
    renderAt("/settings/setup?step=7");
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("7 of 7 done"));
    expect(screen.getByRole("status")).toHaveTextContent("CKAM is set up");
    expect(await screen.findByTestId("code-preview")).toHaveTextContent("FA/CKS/0001");
    expect(screen.getByRole("link", { name: "Finish" })).toHaveAttribute("href", "/settings");
  });

  it("step 7 shows the SERVER's example for the format, asked from the preview endpoint", async () => {
    mockApi("complete");
    (apiClient.post as any).mockImplementation((path: string) =>
      path === "/code-rules/preview" ? Promise.resolve({ example: "FA/CKSPL/IT/0001" }) : Promise.resolve({}),
    );
    renderAt("/settings/setup?step=7");
    await waitFor(() => expect(screen.getByTestId("code-preview")).toHaveTextContent("FA/CKSPL/IT/0001"));
    expect(apiClient.post).toHaveBeenCalledWith("/code-rules/preview", expect.objectContaining({ company_id: null, prefix_template: "FA/{company.code}/" }));
  });

  it("step 7 for someone who may not change the format is read-only with the owner-only note", async () => {
    loginAs("ADMIN", false);
    mockApi("complete");
    renderAt("/settings/setup?step=7");
    // An ordinary admin is turned away from Settings altogether; the screen itself stays safe if reached.
    await screen.findByText(/don't have access/i);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});

describe("Home: Finish setting up", () => {
  it("shows the head-office admin how far set-up is, with a way in", async () => {
    mockApi("partial");
    renderAt("/dashboard");
    const row = await screen.findByRole("region", { name: "Finish setting up" });
    expect(row).toHaveTextContent("2 of 7 steps done");
    expect(within(row).getByRole("link", { name: /continue setup/i })).toHaveAttribute("href", "/settings/setup");
  });

  it("disappears once everything is set up", async () => {
    mockApi("complete");
    renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Home" });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/code-rules"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("region", { name: "Finish setting up" })).not.toBeInTheDocument();
  });

  it("is never shown to anyone else, and their Home reads no set-up data", async () => {
    mockApi("empty");
    loginAs("ADMIN");
    renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Home" });
    expect(screen.queryByRole("region", { name: "Finish setting up" })).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/code-rules");
  });
});

describe("Settings landing", () => {
  it("has one compact card per group, each entry with its one line, and the set-up progress", async () => {
    mockApi("empty");
    renderAt("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    for (const section of SETTINGS_SECTIONS) {
      const card = screen.getByRole("region", { name: section.label });
      for (const link of section.links) {
        expect(within(card).getByRole("link", { name: link.label })).toHaveAttribute("href", link.to);
        expect(within(card).getByText(link.line)).toBeInTheDocument();
      }
    }
    expect(screen.getByRole("region", { name: "ERP" })).toHaveTextContent("Advanced mapping rules");
    const setup = screen.getByRole("region", { name: "Set up CKAM" });
    await waitFor(() => expect(setup).toHaveTextContent("0 of 7 done"));
    expect(within(setup).getByRole("link", { name: /start/i })).toHaveAttribute("href", "/settings/setup");
  });
});

describe("Settings › Organisation: one screen, four tabs", () => {
  it("opens on Companies, and each tab keeps its own Add button and list", async () => {
    mockApi("partial");
    const router = renderAt("/settings/organisation");
    expect(await screen.findByRole("heading", { level: 1, name: "Organisation" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Companies" })).toHaveAttribute("aria-selected", "true");
    expect((await screen.findAllByRole("button", { name: "Add Company" }))[0]).toBeInTheDocument();
    expect(await screen.findByText("Citykart Stores")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Places" }));
    fireEvent.click(screen.getByRole("tab", { name: "Places" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "places" }));
    expect((await screen.findAllByRole("button", { name: "Add Place" }))[0]).toBeInTheDocument();
    expect(await screen.findByText("Head Office")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Company" })).not.toBeInTheDocument();
  });

  it.each([
    ["/setup/companies", "companies", "Companies", "Add Company"],
    ["/setup/locations", "places", "Places", "Add Place"],
    ["/setup/cost-centers", "cost-centres", "Cost Centres", "Add Cost Centre"],
    ["/setup/departments", "departments", "Departments", "Add Department"],
  ])("the old address %s opens the %s tab", async (url, tab, tabName, addButton) => {
    mockApi("empty");
    const router = renderAt(url);
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/organisation"));
    expect(router.state.location.search).toEqual({ tab });
    expect(await screen.findByRole("tab", { name: tabName })).toHaveAttribute("aria-selected", "true");
    expect((await screen.findAllByRole("button", { name: addButton }))[0]).toBeInTheDocument();
  });
});

describe("old Settings addresses still work", () => {
  it.each([
    ["/setup/items", "/settings/catalogue/items", "Items"],
    ["/setup/brands", "/settings/catalogue/brands", "Brands"],
    ["/setup/vendors", "/settings/vendors", "Vendors"],
    ["/setup/erp-articles", "/settings/erp/mapping", "ERP Mapping"],
    ["/setup/custom-fields", "/settings/advanced/custom-fields", "Custom Fields"],
    ["/setup/code-rule", "/settings/advanced/code-format", "Asset Code Format"],
    ["/import", "/settings/advanced/import", "Bulk Import"],
    ["/settings/catalogue", "/settings", "Settings"],
  ])("%s → %s", async (url, to, heading) => {
    mockApi("empty");
    const router = renderAt(url);
    await waitFor(() => expect(router.state.location.pathname).toBe(to));
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("/setup/bundles still opens the Bundles screen (a direct link only)", async () => {
    mockApi("empty");
    const router = renderAt("/setup/bundles");
    expect(await screen.findByRole("heading", { level: 1, name: "Bundles" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/setup/bundles");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Bundles" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Items" })).toHaveAttribute("data-active", "true");
  });
});

describe("Users & Access and ERP Data Sync", () => {
  it("Users & Access leads to the four People & Places lists", async () => {
    mockApi("empty");
    renderAt("/settings/users-access");
    expect(await screen.findByRole("heading", { level: 1, name: "Users & Access" })).toBeInTheDocument();
    const main = screen.getByRole("list", { name: "People & Places lists" });
    for (const [name, href] of [
      ["Employees", "/people/employees"], ["Stores", "/people/stores"], ["Stock Rooms", "/people/stock-rooms"], ["Install Points", "/people/install-points"],
    ]) {
      expect(within(main).getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(main).not.toHaveTextContent(/holder|asset user/i);
  });

  it("ERP Data Sync explains a server without an ERP connection", async () => {
    mockApi("empty");
    renderAt("/settings/erp/sync");
    expect(await screen.findByText("The ERP connection is not set up on this server.")).toBeInTheDocument();
  });

  it("ERP Data Sync shows when the data was copied, with Refresh now", async () => {
    mockApi("empty", { configured: true });
    renderAt("/settings/erp/sync");
    expect(await screen.findByText(/ERP data as of/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh now/i })).toBeInTheDocument();
    cleanup();
  });
});
