import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const SPL = { id: 1, is_active: true, code: "CKSPL", name: "Citykart Stores", erp_company_code: null };
const VPL_OFF = { id: 2, is_active: false, code: "CKVPL", name: "Citykart Ventures", erp_company_code: null };

/** Companies that are on, and companies that are switched off; the reactivate call moves one across. */
function mockCompanies(on: unknown[], off: unknown[]) {
  const state = { on: [...on], off: [...off] };
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/masters/companies") return Promise.resolve(state.on);
    if (path === "/masters/companies/inactive") return Promise.resolve(state.off);
    if (path === "/reports/dashboard") return Promise.resolve({ status_counts: {}, stock_by_location: [], warranty_alerts: [], long_allocation_alerts: [] });
    if (path.startsWith("/assets")) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockImplementation((path: string) => {
    const m = /^\/masters\/companies\/(\d+)\/reactivate$/.exec(path);
    if (!m) return Promise.resolve(undefined);
    const id = Number(m[1]);
    const row = state.off.find((c: any) => c.id === id) as any;
    state.off = state.off.filter((c: any) => c.id !== id);
    state.on = [...state.on, { ...row, is_active: true }];
    return Promise.resolve({ ...row, is_active: true });
  });
  return state;
}

function renderAt(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

const loginAs = (role: string, isPrimaryOwner = false) =>
  useAuthStore.getState().setAuth({ accessToken: "tok", role, companyId: isPrimaryOwner ? null : 1, isPrimaryOwner, mustChangePassword: false });

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().logout();
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
});
afterEach(() => useAuthStore.getState().logout());

describe("the 'No company is switched on' banner", () => {
  it("tells staff, in words, why nothing can be added, and says who can fix it", async () => {
    loginAs("OPERATOR");
    mockCompanies([], [VPL_OFF]);
    renderAt("/assets");
    const note = await screen.findByRole("note", { name: "No company is switched on" });
    expect(note).toHaveTextContent("No company is switched on, so purchase orders, assets and receiving cannot be added.");
    expect(note).toHaveTextContent("Ask the head-office admin to switch one on.");
    expect(within(note).queryByRole("link")).not.toBeInTheDocument();
  });

  it("points the head-office admin to Settings › Organisation › Companies", async () => {
    loginAs("ADMIN", true);
    mockCompanies([], [VPL_OFF]);
    renderAt("/assets");
    const note = await screen.findByRole("note", { name: "No company is switched on" });
    const link = within(note).getByRole("link", { name: "Settings › Organisation › Companies" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/settings/organisation"));
    expect(link).toHaveAttribute("href", expect.stringContaining("tab=companies"));
  });

  it("is not shown while a company is switched on", async () => {
    loginAs("OPERATOR");
    mockCompanies([SPL], []);
    renderAt("/assets");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    expect(screen.queryByRole("note", { name: "No company is switched on" })).not.toBeInTheDocument();
  });

  it("is not shown to a self-service login, who is not even asked for the company list", async () => {
    loginAs("SELF_SERVICE");
    mockCompanies([], []);
    renderAt("/my-assets");
    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("note", { name: "No company is switched on" })).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/masters/companies");
  });

  it("is not shown inside Settings, where the admin is already fixing it", async () => {
    loginAs("ADMIN", true);
    mockCompanies([], [VPL_OFF]);
    renderAt("/settings/organisation?tab=companies");
    await screen.findByRole("region", { name: "Switched-off companies" });
    expect(screen.queryByRole("note", { name: "No company is switched on" })).not.toBeInTheDocument();
  });
});

describe("Settings › Organisation › Companies: switch a company on again", () => {
  it("opens the switched-off list by itself when no company is on, and switches one on after a confirmation", async () => {
    loginAs("ADMIN", true);
    mockCompanies([], [VPL_OFF]);
    renderAt("/settings/organisation?tab=companies");
    const section = await screen.findByRole("region", { name: "Switched-off companies" });
    expect(within(section).getByRole("button", { name: /Show switched-off companies \(1\)/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(section).getByText("Citykart Ventures")).toBeInTheDocument();
    expect(screen.getByText("No company is switched on. Add a company, or switch one back on if you switched one off.")).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Switch on Citykart Ventures again" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Switch on Citykart Ventures again?");
    expect(dialog).toHaveTextContent("Its places, cost centres, people and assets are exactly as you left them.");
    expect(apiClient.post).not.toHaveBeenCalled();                     // nothing happens until it is confirmed
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch on" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/companies/2/reactivate"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Switched-off companies" })).not.toBeInTheDocument());
    expect(await screen.findByText("CKVPL")).toBeInTheDocument();      // now in the Companies list
  });

  it("Cancel switches nothing on", async () => {
    loginAs("ADMIN", true);
    mockCompanies([], [VPL_OFF]);
    renderAt("/settings/organisation?tab=companies");
    fireEvent.click(await screen.findByRole("button", { name: "Switch on Citykart Ventures again" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("stays folded while another company is on, with the count, and opens when asked", async () => {
    loginAs("ADMIN", true);
    mockCompanies([SPL], [VPL_OFF]);
    renderAt("/settings/organisation?tab=companies");
    const toggle = await screen.findByRole("button", { name: "Show switched-off companies (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Citykart Ventures")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByText("Citykart Ventures")).toBeInTheDocument();
  });

  it("shows nothing at all when no company is switched off", async () => {
    loginAs("ADMIN", true);
    mockCompanies([SPL], []);
    renderAt("/settings/organisation?tab=companies");
    await screen.findByText("CKSPL");
    expect(screen.queryByRole("region", { name: "Switched-off companies" })).not.toBeInTheDocument();
  });

  it("shows the server's sentence when it is refused (the same name is already on)", async () => {
    loginAs("ADMIN", true);
    mockCompanies([], [VPL_OFF]);
    (apiClient.post as any).mockRejectedValue(new Error("Another company that is switched on is already called Citykart Ventures. Rename or switch off that one first."));
    renderAt("/settings/organisation?tab=companies");
    fireEvent.click(await screen.findByRole("button", { name: "Switch on Citykart Ventures again" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch on" }));
    expect(await within(dialog).findByText(/Another company that is switched on is already called Citykart Ventures/)).toBeInTheDocument();
    // still off (the open dialog hides the page behind it from the accessibility tree)
    expect(screen.getByRole("region", { name: "Switched-off companies", hidden: true })).toBeInTheDocument();
  });
});
