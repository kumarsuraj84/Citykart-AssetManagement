import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const SPL = { id: 1, is_active: true, code: "CKSPL", name: "Citykart Stores", erp_company_code: null };

const ERP_COMPANIES = {
  copied: true, names_known: true, note: null,
  companies: [
    { code: "CKSPL", erp_name: "CITYKART STORES PVT. LTD.", suggested_name: "Citykart Stores Pvt. Ltd.", exists: true, company_id: 1, is_active: true,
      ckam_name: "Citykart Stores", name_differs: false, selectable: false, reason: "This company is already here." },
    { code: "CKVPL", erp_name: "CITYKART RETAIL PVT. LTD.", suggested_name: "Citykart Retail Pvt. Ltd.", exists: true, company_id: 2, is_active: true,
      ckam_name: "Citykart Ventures", name_differs: true, selectable: false, reason: "This company is already here." },
    { code: "NEWCO", erp_name: "NEW COMPANY PVT. LTD.", suggested_name: "New Company Pvt. Ltd.", exists: false, company_id: null, is_active: null,
      ckam_name: null, name_differs: false, selectable: true, reason: null },
  ],
};

const place = (code: string, group: string, over: Record<string, unknown> = {}) => ({
  site_code: 1, code, name: code, kind: group, group, city: null, state: null, active: true, exists: false, location_id: null,
  selectable: true, selected_by_default: group === "HEAD_OFFICE" || group === "WAREHOUSE", reason: null, note: null, ...over,
});
const ERP_PLACES = {
  company_id: 1, copied: true,
  summary: { HEAD_OFFICE: 2, WAREHOUSE: 1, OTHER_WAREHOUSE: 1, OLD_WAREHOUSE: 0, ALREADY_CREATED: 3 },
  groups: [
    { key: "HEAD_OFFICE", title: "Head offices", hint: "Offices of the company." },
    { key: "WAREHOUSE", title: "Warehouses", hint: "The company's warehouses." },
    { key: "OTHER_WAREHOUSE", title: "Other warehouses", hint: "Other warehouse sites in the ERP: add the ones you really use." },
    { key: "OLD_WAREHOUSE", title: "Old warehouses", hint: "Marked as old in the ERP." },
  ],
  places: [
    place("CKSPL-GRGN-HO", "HEAD_OFFICE"),
    place("CKVPL-HO", "HEAD_OFFICE", { selected_by_default: false, note: "Named for CKVPL but listed under CKSPL in the ERP: check before adding." }),
    place("CKSPL-WH-TAJNAGAR", "WAREHOUSE", { city: "Tajnagar" }),
    place("CKPL-DEL-WH", "OTHER_WAREHOUSE"),
    place("A-VERY-LONG-WAREHOUSE-NAME", "WAREHOUSE", { selectable: false, selected_by_default: false, reason: "The ERP code is longer than 20 characters, so it cannot be a place code." }),
  ],
};

function mockApi(over: { companies?: unknown; places?: unknown } = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/masters/companies") return Promise.resolve([SPL]);
    if (path === "/masters/companies/inactive") return Promise.resolve([]);
    if (path === "/erp/companies") return Promise.resolve(over.companies ?? ERP_COMPANIES);
    if (path.startsWith("/erp/places")) return Promise.resolve(over.places ?? ERP_PLACES);
    return Promise.resolve([]);
  });
}

function renderAt(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: null, isPrimaryOwner: true, mustChangePassword: false });
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
});
afterEach(() => useAuthStore.getState().logout());

describe("Settings › Organisation › Companies › Add from the ERP", () => {
  async function openDialog() {
    renderAt("/settings/organisation?tab=companies");
    fireEvent.click(await screen.findByRole("button", { name: "Add from the ERP" }));
    return await screen.findByRole("dialog", { name: "Add companies from the ERP" });
  }

  it("lists the ERP's companies with their names: new ones ticked with the tidied name, existing ones shown and never changed", async () => {
    mockApi();
    const dialog = await openDialog();
    const list = await within(dialog).findByRole("list", { name: "ERP companies" });
    expect(within(list).getByRole("checkbox", { name: "Select NEWCO" })).toBeChecked();
    expect(within(list).getByRole("textbox", { name: "Name for NEWCO" })).toHaveValue("New Company Pvt. Ltd.");
    expect(within(list).getByRole("checkbox", { name: "Select CKSPL" })).toBeDisabled();
    expect(within(list).getAllByText("This company is already here.")).toHaveLength(2);
    // CKVPL: the ERP's name and CKAM's differ -> side by side, with nothing changed
    expect(within(list).getByRole("note", { name: "Name differs for CKVPL" }))
      .toHaveTextContent("The ERP calls it Citykart Retail Pvt. Ltd.; CKAM calls it Citykart Ventures. Nothing was changed");
    expect(within(dialog).getByRole("button", { name: "Add 1 company" })).toBeEnabled();
  });

  it("adds the ticked company with the name as edited, and its cost centre, after one click", async () => {
    mockApi();
    (apiClient.post as any).mockResolvedValue({ created: ["NEWCO"], skipped: [], cost_centres_created: 1 });
    const dialog = await openDialog();
    const name = await within(dialog).findByRole("textbox", { name: "Name for NEWCO" });
    fireEvent.change(name, { target: { value: "NewCo Retail" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 company" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/companies/create", {
      companies: [{ code: "NEWCO", name: "NewCo Retail", with_cost_centre: true }],
    }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Added 1 company and 1 cost centre.");
  });

  it("leaves the cost centre out when asked, and a blank name means the ERP's name", async () => {
    mockApi();
    (apiClient.post as any).mockResolvedValue({ created: ["NEWCO"], skipped: [], cost_centres_created: 0 });
    const dialog = await openDialog();
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "Name for NEWCO" }), { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also make a cost centre for each company" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 company" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/companies/create", {
      companies: [{ code: "NEWCO", name: null, with_cost_centre: false }],
    }));
  });

  it("says when the ERP's names could not be read, and shows what the server refused", async () => {
    mockApi({ companies: { ...ERP_COMPANIES, names_known: false, note: "The ERP's company names could not be read so only the company codes are shown: type the name yourself." } });
    (apiClient.post as any).mockResolvedValue({ created: [], skipped: [{ code: "NEWCO", reason: "A company called Citykart Stores is already switched on: choose another name." }], cost_centres_created: 0 });
    const dialog = await openDialog();
    expect(await within(dialog).findByText(/type the name yourself/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 company" }));
    expect(await within(dialog).findByText(/A company called Citykart Stores is already switched on/)).toBeInTheDocument();
  });

  it("offers nothing to add when every ERP company is already here", async () => {
    mockApi({ companies: { ...ERP_COMPANIES, companies: ERP_COMPANIES.companies.slice(0, 2) } });
    const dialog = await openDialog();
    await within(dialog).findByRole("list", { name: "ERP companies" });
    expect(within(dialog).getByRole("button", { name: "Add 0 companies" })).toBeDisabled();
  });
});

describe("Settings › Organisation › Places › Add from the ERP", () => {
  async function openDialog() {
    renderAt("/settings/organisation?tab=places");
    fireEvent.click(await screen.findByRole("button", { name: "Add from the ERP" }));
    return await screen.findByRole("dialog", { name: "Head offices and warehouses from the ERP" });
  }

  it("groups the ERP's head offices and warehouses, ticks the usual ones, and warns about a site named for the other company", async () => {
    mockApi();
    const dialog = await openDialog();
    const heads = await within(dialog).findByRole("region", { name: "Head offices" });
    expect(within(heads).getByRole("checkbox", { name: "Select CKSPL-GRGN-HO" })).toBeChecked();
    expect(within(heads).getByRole("checkbox", { name: "Select CKVPL-HO" })).not.toBeChecked();
    expect(within(heads).getByRole("note", { name: "Check CKVPL-HO" })).toHaveTextContent("Named for CKVPL but listed under CKSPL in the ERP: check before adding.");
    expect(within(within(dialog).getByRole("region", { name: "Warehouses" })).getByRole("checkbox", { name: "Select CKSPL-WH-TAJNAGAR" })).toBeChecked();
    // the "other" warehouses are offered but not ticked; a code too long for a place is refused with the reason
    expect(within(within(dialog).getByRole("region", { name: "Other warehouses" })).getByRole("checkbox", { name: "Select CKPL-DEL-WH" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Select A-VERY-LONG-WAREHOUSE-NAME" })).toBeDisabled();
    expect(within(dialog).getByText(/longer than 20 characters/)).toBeInTheDocument();
    expect(within(dialog).getByText("3 sites already here as a Place (not listed).")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add 2 places" })).toBeEnabled();
  });

  it("makes the ticked ones with a Stock Point each by default, and says what was made", async () => {
    mockApi();
    (apiClient.post as any).mockResolvedValue({
      created: ["CKSPL-GRGN-HO", "CKSPL-WH-TAJNAGAR"], skipped: [], install_points_created: 2, stock_points_created: 2,
      places: [{ code: "CKSPL-GRGN-HO", install_point_created: true, stock_point_created: true, problems: [] }, { code: "CKSPL-WH-TAJNAGAR", install_point_created: true, stock_point_created: true, problems: [] }],
    });
    const dialog = await openDialog();
    await within(dialog).findByRole("region", { name: "Head offices" });
    expect(within(dialog).getByRole("checkbox", { name: "Also make a Stock Point for each" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 2 places" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/places/create", {
      company_id: 1, codes: expect.arrayContaining(["CKSPL-GRGN-HO", "CKSPL-WH-TAJNAGAR"]), with_stock_point: true,
    }));
    expect((apiClient.post as any).mock.calls[0][1].codes).toHaveLength(2);
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Added 2 places: 2 install points and 2 stock points made.");
  });

  it("leaves the Stock Point out when unticked, and an extra ticked site is included", async () => {
    mockApi();
    (apiClient.post as any).mockResolvedValue({ created: [], skipped: [], install_points_created: 0, stock_points_created: 0, places: [] });
    const dialog = await openDialog();
    await within(dialog).findByRole("region", { name: "Head offices" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also make a Stock Point for each" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Select CKPL-DEL-WH" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 3 places" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/places/create", expect.objectContaining({ with_stock_point: false })));
    expect((apiClient.post as any).mock.calls[0][1].codes).toContain("CKPL-DEL-WH");
  });

  it("'Tick all' ticks every site of a group and then becomes 'Untick all'", async () => {
    mockApi();
    const dialog = await openDialog();
    const heads = await within(dialog).findByRole("region", { name: "Head offices" });
    fireEvent.click(within(heads).getByRole("button", { name: "Tick all head offices" }));      // CKVPL-HO was not ticked
    expect(within(heads).getByRole("checkbox", { name: "Select CKVPL-HO" })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Add 3 places" })).toBeEnabled();
    fireEvent.click(within(heads).getByRole("button", { name: "Untick all head offices" }));
    expect(within(heads).getByRole("checkbox", { name: "Select CKSPL-GRGN-HO" })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Add 1 place" })).toBeEnabled();         // only the warehouse is left
  });
});
