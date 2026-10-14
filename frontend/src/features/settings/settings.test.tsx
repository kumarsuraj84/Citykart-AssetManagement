import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { computeSetupSteps, stepsFromStatus, type SetupCounts } from "./setup-progress";
import { SETTINGS_SECTIONS } from "./settings-structure";

vi.mock("../../lib/api-client");

type Level = "empty" | "partial" | "complete";

const person = (id: number, type: string, over: Record<string, unknown> = {}) => ({
  id, code: `P${id}`, name: `Person ${id}`, asset_user_type: type, company_id: 1, location_id: 1, department_id: null,
  phone: null, email: null, login_enabled: false, role: null, is_primary_owner: false, is_active: true, ...over,
});

/** What GET /setup/status answers for each level (S6: one call; the head-office admin is never counted). */
function setupStatus(level: Level) {
  const c = level === "complete"
    ? { company_count: 1, place_count: 1, stock_room_count: 1, cost_centre_count: 1, category_count: 1, subcategory_count: 1, item_count: 1, vendor_count: 1, people_count: 1, store_count: 1, code_rule_configured: true }
    : level === "partial"
      ? { company_count: 1, place_count: 1, stock_room_count: 1, cost_centre_count: 0, category_count: 0, subcategory_count: 0, item_count: 0, vendor_count: 0, people_count: 0, store_count: 0, code_rule_configured: false }
      : { company_count: 0, place_count: 0, stock_room_count: 0, cost_centre_count: 0, category_count: 0, subcategory_count: 0, item_count: 0, vendor_count: 0, people_count: 0, store_count: 0, code_rule_configured: false };
  const done = {
    company: c.company_count > 0, "stock-room": c.place_count > 0 && c.stock_room_count > 0, "cost-centre": c.cost_centre_count > 0,
    catalogue: c.category_count > 0 && c.item_count > 0, vendors: c.vendor_count > 0, people: c.people_count + c.store_count > 0,
    "code-format": c.code_rule_configured,
  };
  const steps = Object.entries(done).map(([key, d]) => ({ key, label: key, done: d }));
  return { ...c, steps, done_count: steps.filter((s) => s.done).length, total_steps: 7 };
}

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
    // (S7 fix 2: a company just added in step 1 is chosen, so its own status is asked for too)
    if (path === "/setup/status" || path.startsWith("/setup/status?company_id=")) return Promise.resolve(setupStatus(level));
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
    if (path === "/code-rules" || path.startsWith("/code-rules?company_id=")) return Promise.resolve(some([{ id: 1, company_id: null, prefix_template: "FA/{company.code}/", suffix_template: "", start_number: 1, pad_width: 4 }]));
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
    // S7 P2-3: Finish ends on a completion state, not on step 7.
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const summary = await screen.findByRole("region", { name: "Set-up summary" });
    expect(summary).toHaveTextContent("CKAM is set up.");
    expect(within(summary).getByRole("link", { name: "Add the first assets" })).toHaveAttribute("href", "/assets/new");
    expect(within(summary).getByRole("link", { name: "Go to Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("heading", { name: "Asset Code Format" })).not.toBeInTheDocument();
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

describe("S6: Set up CKAM from GET /setup/status (one call)", () => {
  it("the steps and the x-of-7 count come from one call, not from seven lists", async () => {
    mockApi("partial");
    renderAt("/settings/setup?step=1");
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("2 of 7 done"));
    const asked = (apiClient.get as any).mock.calls.map((c: unknown[]) => c[0]);
    expect(asked.filter((p: string) => p === "/setup/status").length).toBeGreaterThanOrEqual(1);
    for (const list of ["/items", "/masters/vendors", "/code-rules", "/asset-users", "/masters/cost-centers"]) {
      expect(asked).not.toContain(list);
    }
  });

  it("the server's own 'done' decides each step; its counts give the words", () => {
    const steps = stepsFromStatus({
      ...setupStatus("partial"),
      steps: [{ key: "company", label: "Company", done: false }],
    });
    expect(steps[0].done).toBe(false);                       // the server said not done
    expect(steps[0].status).toBe("1 company");
    expect(steps[1].done).toBe(true);                        // not in the server's list: from the counts
  });

  it("a save made while the wizard is open asks for the status again", async () => {
    mockApi("empty");
    (apiClient.post as any).mockResolvedValue({ id: 1, name: "Citykart Stores" });
    renderAt("/settings/setup?step=1");
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("0 of 7 done"));
    const before = (apiClient.get as any).mock.calls.filter((c: unknown[]) => c[0] === "/setup/status").length;
    mockApi("partial");
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Company" }))[0]);
    const dialog = await screen.findByRole("dialog");
    for (const input of within(dialog).getAllByRole("textbox")) fireEvent.change(input, { target: { value: "CKS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    await waitFor(() => expect((apiClient.get as any).mock.calls.filter((c: unknown[]) => c[0] === "/setup/status").length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("2 of 7 done"));
  });
});

describe("S7 P2-3: set-up per company", () => {
  const TWO = [{ id: 2, code: "CKSPL", name: "Citykart Stores" }, { id: 3, code: "NEW2", name: "UAT New Two" }];

  function perCompany() {
    const base = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/asset-users/me/companies") return Promise.resolve(TWO);
      if (path === "/setup/status?company_id=2") return Promise.resolve({ ...setupStatus("complete"), company_id: 2 });
      if (path === "/setup/status?company_id=3") return Promise.resolve({ ...setupStatus("partial"), company_id: 3 });
      return base(path);
    });
  }

  it("the guide is about the company the person works in, and another one can be chosen", async () => {
    loginAs("ADMIN", true);
    mockApi("complete");
    perCompany();
    renderAt("/settings/setup?step=7");
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("7 of 7 done for CKSPL"));
    expect(apiClient.get).toHaveBeenCalledWith("/setup/status?company_id=2");
    // Step 7's example is that company's (S7 fix 2, N4: the preview is asked for its id; the rule stays global).
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/code-rules/preview?company_id=2", expect.objectContaining({ company_id: null })));
    expect(screen.getByTestId("code-preview-label")).toHaveTextContent("Next Asset Code in CKSPL");
    fireEvent.click(screen.getByRole("combobox", { name: "Company being set up" }));
    fireEvent.click(await screen.findByRole("option", { name: /UAT New Two/ }));
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("2 of 7 done for NEW2"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/code-rules/preview?company_id=3", expect.objectContaining({ company_id: null })));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const summary = await screen.findByRole("region", { name: "Set-up summary" });
    expect(summary).toHaveTextContent("2 of 7 steps done for NEW2.");
    expect(summary).toHaveTextContent("Still to do: Cost Centre, Asset Groups and first Items, Vendors, People / Stores, Asset Code Format.");
    expect(within(summary).getByRole("button", { name: "Continue with Cost Centre" })).toBeInTheDocument();
  });

  it("S7 fix 2 (N3): a company added in step 1 is in the picker at once and chosen, without a reload", async () => {
    loginAs("ADMIN", true);
    mockApi("complete");
    perCompany();
    (apiClient.post as any).mockImplementation((path: string) =>
      path === "/masters/companies" ? Promise.resolve({ id: 9, code: "UATRT2", name: "UAT RT Two", erp_company_code: null }) : Promise.resolve({}));
    const base = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation((path: string) =>
      path === "/setup/status?company_id=9" ? Promise.resolve({ ...setupStatus("partial"), company_id: 9, company_code: "UATRT2" }) : base(path));
    renderAt("/settings/setup?step=1");
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("for CKSPL"));
    const companiesAsked = (apiClient.get as any).mock.calls.filter((c: unknown[]) => c[0] === "/asset-users/me/companies").length;
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Company" }))[0]);
    const dialog = await screen.findByRole("dialog");
    for (const input of within(dialog).getAllByRole("textbox")) fireEvent.change(input, { target: { value: "UATRT2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save/i }));
    // chosen at once: the count is for the new company, and the picker lists it
    await waitFor(() => expect(screen.getByTestId("setup-done-count")).toHaveTextContent("2 of 7 done for UATRT2"));
    expect(apiClient.get).toHaveBeenCalledWith("/setup/status?company_id=9");
    fireEvent.click(screen.getByRole("combobox", { name: "Company being set up" }));
    expect(await screen.findByRole("option", { name: /UAT RT Two/ })).toBeInTheDocument();
    // and the lists the picker reads are asked for again
    await waitFor(() => expect((apiClient.get as any).mock.calls.filter((c: unknown[]) => c[0] === "/asset-users/me/companies").length).toBeGreaterThan(companiesAsked));
  });

  it("Home's 'Finish setting up' row follows the default company (a complete company shows none)", async () => {
    loginAs("ADMIN", true);
    mockApi("partial");
    perCompany();
    renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Home" });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/setup/status?company_id=2"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("region", { name: "Finish setting up" })).not.toBeInTheDocument();
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
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/setup/status"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("region", { name: "Finish setting up" })).not.toBeInTheDocument();
  });

  it("is never shown to anyone else, and their Home reads no set-up data", async () => {
    mockApi("empty");
    loginAs("ADMIN");
    renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Home" });
    expect(screen.queryByRole("region", { name: "Finish setting up" })).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/setup/status");
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
