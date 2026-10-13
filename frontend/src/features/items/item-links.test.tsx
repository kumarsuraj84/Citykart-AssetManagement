import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const item = (over: Record<string, unknown>) => ({
  id: 3, name: "Indoor Camera", category_id: 1, subcategory_id: 10, serial_required: true, serial_later: false, bundle_id: null,
  default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0, ...over,
});
const ITEMS = [item({ map_count: 3 }), item({ id: 4, name: "UPS", map_count: 0 })];

const code = (over: Record<string, unknown>) => ({
  icode: "", name: "", name_key: "", description: "", units: 1, lines: 1, item_id: null, item_name: null, matched_by: null, not_tracked: false,
  not_tracked_by: null, map_id: null, article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", section: "IT EQUIPMENTS", department: "FA_CE_CCTV", division: "FIXED ASSETS", ...over,
});
const CAMERA = { item_id: 3, item_name: "Indoor Camera" };
const CODES = [
  code({ icode: "CT392128", name: "PRAMA- IP DOME CAMERA", ...CAMERA, matched_by: "ARTICLE", map_id: 21 }),
  code({ icode: "CT392127", name: "PRAMA- IP BULLET CAMERA", ...CAMERA, matched_by: "ARTICLE", map_id: 21 }),
  code({ icode: "CT166999", name: "DOME SPECIAL", ...CAMERA, matched_by: "CODE", map_id: 22, article_key: "FA_OTHER", article_name: "FA_OTHER" }),
  code({ icode: "CT888", name: "APC UPS", item_id: 4, item_name: "UPS", matched_by: "CODE", map_id: 61, article_key: "FA_CE_UPS", article_name: "FA_CE_UPS" }),
  code({ icode: "CT555", name: "GANG BOX PVC", article_key: "FA_BOX", article_name: "FA_BOX" }),
];
const COMPANIES = [{ id: 1, name: "Citykart Stores Pvt Ltd" }, { id: 2, name: "Citykart Ventures Pvt Ltd" }];

function mockApi() {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/items") return Promise.resolve(ITEMS);
    if (path === "/masters/companies") return Promise.resolve(COMPANIES);
    if (path.startsWith("/items/codes")) return Promise.resolve(path.includes("company_id=2") ? [] : CODES);
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.delete as any).mockResolvedValue(undefined);
}

async function openLinks(name = "ERP links of Indoor Camera") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/setup/items"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name }));
  return await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("Items: ERP links", () => {
  it("shows what is linked to the Item, grouped by the rule that links it, and nothing of other Items", async () => {
    const dlg = await openLinks();
    expect(await within(dlg).findByRole("region", { name: "The whole Article FA_CE_CAMERA" })).toHaveTextContent("2 codes");
    expect(within(dlg).getByRole("region", { name: "Code CT166999" })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Linked (3)" })).toBeInTheDocument();
    expect(within(dlg).queryByText("CT888")).not.toBeInTheDocument();                       // linked to UPS
    expect(apiClient.get).toHaveBeenCalledWith("/items/codes?company_id=1");
  });

  it("looks at the other company on its own", async () => {
    const dlg = await openLinks();
    await within(dlg).findByRole("region", { name: "Code CT166999" });
    fireEvent.click(within(dlg).getByLabelText("Company"));
    fireEvent.click(await screen.findByRole("option", { name: "Citykart Ventures Pvt Ltd" }));
    expect(await within(dlg).findByText(/Nothing is linked to Indoor Camera for this company yet/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/items/codes?company_id=2");
  });

  it("unlinks one rule, which only deactivates it", async () => {
    const dlg = await openLinks();
    fireEvent.click(await within(dlg).findByRole("button", { name: "Unlink Code CT166999" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/22"));
    expect(apiClient.delete).toHaveBeenCalledTimes(1);
  });

  it("lists the codes behind an Article link", async () => {
    const dlg = await openLinks();
    const card = await within(dlg).findByRole("region", { name: "The whole Article FA_CE_CAMERA" });
    expect(within(card).getByText("CT392128")).toBeInTheDocument();
    expect(within(card).getByText("CT392127")).toBeInTheDocument();
  });

  it("searches the company's codes and links the ticked ones straight to this Item", async () => {
    const dlg = await openLinks();
    fireEvent.click(await within(dlg).findByRole("button", { name: "Add codes" }));
    fireEvent.change(await within(dlg).findByLabelText("Search codes"), { target: { value: "gang" } });
    fireEvent.click(within(dlg).getByLabelText("Select code CT555"));
    const bar = within(dlg).getByRole("region", { name: "Selected codes" });
    expect(within(bar).queryByLabelText("Item for the selected codes")).not.toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: /not tracked/ })).not.toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Link 1 to Indoor Camera" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith("/items/maps", expect.objectContaining({ match_type: "CODE", erp_item_code: "CT555", item_id: 3, company_id: 1 }));
  });

  it("an Item whose count is 0 shows Link… and still opens its own list", async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/setup/items"] }));
    render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
    expect(await screen.findByRole("button", { name: "ERP links of UPS" })).toHaveTextContent("Link…");
    cleanup();
    const dlg = await openLinks("ERP links of UPS");
    expect(await within(dlg).findByRole("button", { name: "Linked (1)" })).toBeInTheDocument();    // the one APC UPS code
  });
});
