import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { ErpStoresDialog } from "./ErpStoresDialog";

vi.mock("../../lib/api-client");

const COMPANIES = [{ id: 1, name: "Citykart Stores" }, { id: 2, name: "Citykart Ventures" }];

const store = (over: object) => ({
  site_code: 1, code: "LAM", name: "LAM", state: "UP", city: "LUCKNOW", store_status: "ACTIVE", group: "READY", email: "sm.lam@citykartstores.com",
  exists: false, selectable: true, selected_by_default: true, reason: null, ...over,
});

const RESPONSE = {
  company_id: 1, copied: true,
  summary: { READY: 2, UPCOMING: 1, INACTIVE: 1, NOT_A_STORE_CODE: 1, ALREADY_CREATED: 1 },
  stores: [
    store({ code: "LAM" }),
    store({ code: "SPR2", email: "sm.spr2@citykartstores.com" }),
    store({ code: "BWR", group: "UPCOMING", store_status: "UPCOMING_STORE", email: "sm.bwr@citykartstores.com", selected_by_default: false }),
    store({ code: "ALS", group: "INACTIVE", store_status: "CLOSED", email: "sm.als@citykartstores.com", selected_by_default: false }),
    store({ code: "LAD", exists: true, selectable: false, selected_by_default: false, reason: "A user with this code already exists." }),
    store({ code: "UP-DUMMY", group: "NOT_A_STORE_CODE", email: null, selectable: false, selected_by_default: false, reason: "This is not a usual store code" }),
  ],
};

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ErpStoresDialog /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Stores from ERP" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/masters/companies") return Promise.resolve(COMPANIES);
    if (path === "/erp/stores?company_id=1") return Promise.resolve(RESPONSE);
    if (path === "/erp/stores?company_id=2") return Promise.resolve({ ...RESPONSE, company_id: 2, summary: { READY: 0, UPCOMING: 0, INACTIVE: 0, NOT_A_STORE_CODE: 0, ALREADY_CREATED: 0 }, stores: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  (apiClient.post as any).mockResolvedValue({ created: ["LAM", "SPR2"], skipped: [] });
});

describe("Stores from the ERP", () => {
  it("starts with the open stores ticked, and shows each store's login email", async () => {
    renderDialog();
    expect(await screen.findByLabelText("Select LAM")).toBeChecked();
    expect(screen.getByLabelText("Select SPR2")).toBeChecked();
    expect(screen.getByLabelText("Select BWR")).not.toBeChecked();
    expect(screen.getByLabelText("Select ALS")).not.toBeChecked();
    expect(screen.getByText("sm.spr2@citykartstores.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create 2 stores" })).toBeInTheDocument();
    expect(screen.getByLabelText("Store summary")).toHaveTextContent("2 open · 1 upcoming · 1 closed or inactive · 1 already created · 1 not store codes");
  });

  it("does not list stores that already exist, and says why dummy codes are not offered", async () => {
    renderDialog();
    await screen.findByLabelText("Select LAM");
    expect(screen.queryByLabelText("Select LAD")).not.toBeInTheDocument();
    expect(screen.getByText(/Not offered, because they are not usual store codes/)).toHaveTextContent("UP-DUMMY");
    expect(screen.queryByLabelText("Select UP-DUMMY")).not.toBeInTheDocument();
  });

  it("creates the ticked stores in the chosen company", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Create 2 stores" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/stores/create", { company_id: 1, codes: ["LAM", "SPR2"] }));
    expect(await screen.findByRole("status")).toHaveTextContent("Created 2 stores.");
  });

  it("lets a whole group be ticked, and one store unticked", async () => {
    renderDialog();
    await screen.findByLabelText("Select LAM");
    fireEvent.click(screen.getByRole("button", { name: "Tick all upcoming stores" }));
    expect(screen.getByLabelText("Select BWR")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Select LAM"));
    fireEvent.click(screen.getByRole("button", { name: "Create 2 stores" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/stores/create", { company_id: 1, codes: ["SPR2", "BWR"] }));
  });

  it("narrows the list by search", async () => {
    renderDialog();
    await screen.findByLabelText("Select LAM");
    fireEvent.change(screen.getByLabelText("Search stores"), { target: { value: "spr" } });
    expect(screen.queryByLabelText("Select LAM")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Select SPR2")).toBeInTheDocument();
  });

  it("shows what was skipped and why", async () => {
    (apiClient.post as any).mockResolvedValue({ created: ["LAM"], skipped: [{ code: "SPR2", reason: "The login email is already used by another user in this company (sm.spr2@citykartstores.com)." }] });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Create 2 stores" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Created 1 store.");
    expect(within(status).getByText(/SPR2: The login email is already used/)).toBeInTheDocument();
  });

  it("S5: says how many stock rooms and install points the stores were given, and any room that could not be made", async () => {
    (apiClient.post as any).mockResolvedValue({
      created: ["LAM", "SPR2"], skipped: [], stock_rooms_created: 2, install_points_created: 1,
      rooms: [
        { code: "LAM", stock_room_code: "STK-LAM", stock_room_created: true, install_point_code: "INS-LAM", install_point_created: true, problems: [] },
        { code: "SPR2", stock_room_code: "STK-SPR2", stock_room_created: true, install_point_code: null, install_point_created: false,
          problems: ["The code INS-SPR2 is already used by Old Point, so the install point of store SPR2 was not made."] },
      ],
    });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Create 2 stores" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Created 2 stores. 2 stock rooms and 1 install point were added.");
    expect(within(status).getByRole("list", { name: "Rooms not made" })).toHaveTextContent("SPR2: The code INS-SPR2 is already used by Old Point");
  });

  it("S5: stores that already had their rooms are said so", async () => {
    (apiClient.post as any).mockResolvedValue({ created: [], skipped: [{ code: "LAM", reason: "Already a store." }], stock_rooms_created: 0, install_points_created: 0, rooms: [] });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Create 2 stores" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Created 0 stores. Every store already had its Stock Room and Install Point.");
  });

  it("asks for the company when there are two, and reads that company's stores", async () => {
    renderDialog();
    await screen.findByLabelText("Select LAM");
    fireEvent.click(screen.getByRole("combobox", { name: "Company" }));
    fireEvent.click(await screen.findByRole("option", { name: "Citykart Ventures" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/stores?company_id=2"));
    expect(await screen.findByText("No stores match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create 0 stores" })).toBeDisabled();
  });

  it("says when the ERP data has not been copied yet", async () => {
    (apiClient.get as any).mockImplementation((path: string) =>
      path === "/masters/companies" ? Promise.resolve([COMPANIES[0]]) : Promise.resolve({ company_id: 1, copied: false, summary: {}, stores: [] }));
    renderDialog();
    expect(await screen.findByText(/has not been copied yet/)).toBeInTheDocument();
  });

  it("shows the server's message when it cannot read the stores", async () => {
    (apiClient.get as any).mockImplementation((path: string) =>
      path === "/masters/companies" ? Promise.resolve(COMPANIES) : Promise.reject(new Error("company not found")));
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("company not found");
  });
});
