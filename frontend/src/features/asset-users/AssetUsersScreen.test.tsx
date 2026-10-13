import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetUsersScreen } from "./AssetUsersScreen";
import { apiClient, ApiError } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

// Keeps the real ApiError class (so `instanceof ApiError` checks inside the
// bulk-deactivate helper work against the same class this test constructs)
// while still mocking apiClient's own methods -- see MasterCrudScreen.test.tsx.
vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ASSET_USER: Record<string, unknown> = {
  id: 1,
  company_id: 1,
  code: "CS6872",
  name: "Ankur",
  asset_user_type: "EMPLOYEE",
  location_id: 1,
  department_id: 1,
  email: null,
  phone: null,
  role: "SELF_SERVICE",
  login_enabled: true,
  is_primary_owner: false,
  is_active: true,
};

const ASSET_USER_2: Record<string, unknown> = {
  id: 2,
  company_id: 1,
  code: "CS9001",
  name: "Priya",
  asset_user_type: "EMPLOYEE",
  location_id: 1,
  department_id: 1,
  email: null,
  phone: null,
  role: "SELF_SERVICE",
  login_enabled: true,
  is_primary_owner: false,
  is_active: true,
};

const COMPANY = { id: 1, name: "CityKart HQ" };
const COMPANY_B = { id: 2, name: "CityKart Ventures" };
const LOCATION = { id: 1, company_id: 1, code: "HO", name: "Head Office" };
const LOCATION_WH1 = { id: 2, company_id: 1, code: "WH1", name: "Warehouse 1" };

// Locations are company-scoped -- mimic the real API's own `?company_id=`
// filtering rather than returning every location for every company.
function mockGets(
  asset_users: unknown[] = [ASSET_USER],
  companies: unknown[] = [COMPANY],
  locations: { id: number; company_id: number }[] = [LOCATION],
) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/asset-users") return Promise.resolve(asset_users);
    if (path === "/masters/companies") return Promise.resolve(companies);
    if (path.startsWith("/masters/locations")) {
      const companyId = Number(new URL(path, "http://x").searchParams.get("company_id"));
      return Promise.resolve(locations.filter((l) => l.company_id === companyId));
    }
    if (path === "/masters/departments") return Promise.resolve([]);
    if (path === "/asset-users/1/company-access") return Promise.resolve({ company_ids: [] });
    return Promise.resolve([]);
  });
}

async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

describe("AssetUsersScreen", () => {
  it("offers Stores from ERP to the Primary Owner only", async () => {
    mockGets();
    useAuthStore.getState().setAuth({ accessToken: "t", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    const { unmount } = renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Stores from ERP" })).not.toBeInTheDocument();
    unmount();

    useAuthStore.getState().setAuth({ accessToken: "t", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    renderWithClient(<AssetUsersScreen />);
    expect(await screen.findByRole("button", { name: "Stores from ERP" })).toBeInTheDocument();
    useAuthStore.getState().logout();
  });

  it("resets a asset_user's password and shows the temp password", async () => {
    mockGets();
    (apiClient.post as any).mockResolvedValue({ temp_password: "abc123XYZ" });

    renderWithClient(<AssetUsersScreen />);

    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => expect(screen.getByText("abc123XYZ")).toBeInTheDocument());
    expect(apiClient.post).toHaveBeenCalledWith("/asset-users/1/reset-password");

    // The temp password dialog uses proper alertdialog semantics.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    // Closing the dialog must not leave the temp password visible anywhere.
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText("abc123XYZ")).not.toBeInTheDocument());
  });

  it("adds a new asset_user via the Add dialog", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue({ ...ASSET_USER, id: 2, code: "NEW01", name: "New Hire" });

    renderWithClient(<AssetUsersScreen />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "NEW01" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Hire" } });
    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "Employee");
    await pickSelectOption("Place", "Head Office");
    // Login Enabled stays unchecked -- Role/Email aren't shown, and the
    // payload's role falls back to SELF_SERVICE, with no interaction needed.

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/asset-users", {
        company_id: 1,
        code: "NEW01",
        name: "New Hire",
        asset_user_type: "EMPLOYEE",
        location_id: 1,
        department_id: null,
        email: null,
        phone: null,
        role: "SELF_SERVICE",
        login_enabled: false,
      }),
    );
  });

  it("prefills the Edit dialog and saves changes via PUT", async () => {
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...ASSET_USER, name: "Ankur K" });

    renderWithClient(<AssetUsersScreen />);

    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit ankur$/i }));

    // Prefilled from the existing row.
    expect(screen.getByLabelText("Employee Code")).toHaveValue("CS6872");
    expect(screen.getByLabelText("Name")).toHaveValue("Ankur");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ankur K" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/asset-users/1", {
        company_id: 1,
        code: "CS6872",
        name: "Ankur K",
        asset_user_type: "EMPLOYEE",
        location_id: 1,
        department_id: 1,
        email: null,
        phone: null,
        role: "SELF_SERVICE",
        login_enabled: true,
      }),
    );
  });

  it("shows a loading skeleton, then an empty state with an Add action when there are no asset_users", async () => {
    mockGets([]);
    renderWithClient(<AssetUsersScreen />);

    await waitFor(() => expect(screen.getByText(/no people or places yet/i)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^add$/i }).length).toBeGreaterThan(0);
  });

  it("shows an error state with a retry that refetches", async () => {
    (apiClient.get as any).mockImplementationOnce((path: string) => {
      if (path === "/asset-users") return Promise.reject(new Error("asset_users down"));
      return Promise.resolve([]);
    });
    renderWithClient(<AssetUsersScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("asset_users down");

    mockGets();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
  });

  it("deactivates a asset_user only after confirming in the dialog", async () => {
    mockGets();
    (apiClient.delete as any).mockResolvedValue(undefined);

    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^deactivate ankur$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ankur");
    expect(apiClient.delete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/asset-users/1"));
  });

  it("bulk-deactivates every selected asset user after one confirmation, then clears the selection", async () => {
    mockGets([ASSET_USER, ASSET_USER_2]);
    (apiClient.delete as any).mockResolvedValue(undefined);

    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select ankur/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select priya/i }));
    fireEvent.click(screen.getByRole("button", { name: /^deactivate 2 selected$/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(apiClient.delete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith("/asset-users/1");
      expect(apiClient.delete).toHaveBeenCalledWith("/asset-users/2");
    });
    await waitFor(() => expect(screen.queryByText(/selected/i)).not.toBeInTheDocument());
  });

  it("reports a partial bulk-deactivate failure (e.g. the last Primary Owner guard) and keeps the failed row selected", async () => {
    mockGets([ASSET_USER, ASSET_USER_2]);
    (apiClient.delete as any).mockImplementation((path: string) =>
      path.endsWith("/2") ? Promise.reject(new ApiError("cannot remove the last Primary Owner", 422)) : Promise.resolve(undefined),
    );

    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select ankur/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select priya/i }));
    fireEvent.click(screen.getByRole("button", { name: /^deactivate 2 selected$/i }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /^deactivate$/i }));

    const summary = await screen.findByRole("alert", { name: /could not deactivate/i });
    expect(summary).toHaveTextContent("Priya");
    expect(summary).toHaveTextContent("cannot remove the last Primary Owner");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("AM-08: blocks Save with Location left blank -- never submits the old 0 sentinel", async () => {
    mockGets([]);
    renderWithClient(<AssetUsersScreen />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "NOLOC" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "No Location" } });
    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "Employee");
    // Location deliberately left unselected.

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("AM-08: shows the backend's controlled validation error inside the dialog, not a crash", async () => {
    mockGets([]);
    (apiClient.post as any).mockRejectedValue(new Error("location not found or inactive"));

    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "NEW02" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Hire 2" } });
    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "Employee");
    await pickSelectOption("Place", "Head Office");

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/location not found or inactive/i);
    // The dialog stays open on a server error -- never silently closed.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("warns before saving a role change, and role is not reset by unrelated field edits", async () => {
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...ASSET_USER, name: "Ankur K" });

    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit ankur$/i }));

    // Editing an unrelated field does not touch the prefilled role.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ankur K" } });
    expect(screen.queryByText(/will immediately change what this person can do/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/asset-users/1", expect.objectContaining({ role: "SELF_SERVICE" })),
    );
  });

  it("AM-24: shows current company access grants and saves changes to them", async () => {
    mockGets([ASSET_USER], [COMPANY, COMPANY_B]);
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/asset-users") return Promise.resolve([ASSET_USER]);
      if (path === "/masters/companies") return Promise.resolve([COMPANY, COMPANY_B]);
      if (path === "/masters/locations") return Promise.resolve([LOCATION]);
      if (path === "/masters/departments") return Promise.resolve([]);
      if (path === "/asset-users/1/company-access") return Promise.resolve({ company_ids: [] });
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockResolvedValue(undefined);

    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /company access for ankur/i }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).queryByText(/loading/i)).not.toBeInTheDocument());
    // Own company never shows as a pickable checkbox -- always implicit.
    expect(within(dialog).queryByText("CityKart HQ")).not.toBeInTheDocument();
    expect(within(dialog).getByText("CityKart Ventures")).toBeInTheDocument();

    const checkbox = within(dialog).getByRole("checkbox", { name: "CityKart Ventures" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);

    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/asset-users/1/company-access", { company_ids: [2] }),
    );
  });

  it("IT_STOCK/INSTALLED: picking a Location auto-fills Code/Name and relabels the fields", async () => {
    mockGets([], [COMPANY], [LOCATION, LOCATION_WH1]);
    (apiClient.post as any).mockResolvedValue({ ...ASSET_USER, id: 3, code: "STK-WH1" });

    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "Stock Room");
    // Labels relabel away from the "Code"/"Name" wording once a non-person type is picked.
    expect(screen.getByText("Stock Room Code")).toBeInTheDocument();
    expect(screen.getByText("Stock Room Name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();

    await pickSelectOption("Place", "Warehouse 1");
    expect(screen.getByLabelText("Stock Room Code")).toHaveValue("STK-WH1");
    expect(screen.getByLabelText("Stock Room Name")).toHaveValue("Stock Room - Warehouse 1");

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/asset-users",
        expect.objectContaining({ code: "STK-WH1", name: "Stock Room - Warehouse 1", asset_user_type: "STOCK_POINT" }),
      ),
    );
  });

  it("IT_STOCK: a manually-typed Code/Name is never overwritten by picking a Location afterward", async () => {
    mockGets([], [COMPANY], [LOCATION, LOCATION_WH1]);
    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "Stock Room");
    fireEvent.change(screen.getByLabelText("Stock Room Code"), { target: { value: "MY-OWN-CODE" } });
    fireEvent.change(screen.getByLabelText("Stock Room Name"), { target: { value: "My Own Name" } });

    await pickSelectOption("Place", "Warehouse 1");
    expect(screen.getByLabelText("Stock Room Code")).toHaveValue("MY-OWN-CODE");
    expect(screen.getByLabelText("Stock Room Name")).toHaveValue("My Own Name");
  });

  it("shows a coverage checklist of which locations already have an IT_STOCK point for the chosen company", async () => {
    const stockAtHo = { ...ASSET_USER, id: 5, code: "STK-HO", name: "Stock Room - Head Office", asset_user_type: "STOCK_POINT", location_id: 1 };
    mockGets([ASSET_USER, stockAtHo], [COMPANY], [LOCATION, LOCATION_WH1]);
    renderWithClient(<AssetUsersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "Stock Room");

    expect(await screen.findByText(/already have a Stock Room/i)).toBeInTheDocument();
    expect(screen.getByText("Head Office")).toBeInTheDocument();
    expect(screen.getByText("Warehouse 1")).toBeInTheDocument();
  });
});

describe("People & Places lists (one type each)", () => {
  const STORE = { ...ASSET_USER, id: 7, code: "LAM", name: "Lamington Road", asset_user_type: "STORE", login_enabled: false };
  const STOCK = { ...ASSET_USER, id: 8, code: "STK-HO", name: "HO Stock", asset_user_type: "STOCK_POINT", login_enabled: false };
  const ADMIN_EMP = { ...ASSET_USER_2, role: "OPERATOR", allowed_asset_domains: "IT", primary_asset_domain: "IT" };
  const RAW = /\b(EMPLOYEE|STORE|STOCK_POINT|INSTALLED|SELF_SERVICE|OPERATOR|ADMIN|VIEWER|NON_IT)\b/;

  function mockAll() {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/asset-users") return Promise.resolve([ASSET_USER, ADMIN_EMP, STORE, STOCK]);
      if (path === "/masters/companies") return Promise.resolve([COMPANY]);
      if (path === "/masters/locations") return Promise.resolve([LOCATION]);
      if (path.startsWith("/masters/locations")) return Promise.resolve([LOCATION]);
      if (path === "/masters/departments") return Promise.resolve([{ id: 1, name: "IT" }]);
      return Promise.resolve([]);
    });
  }

  it("Employees: only employees, plain-word columns and access words, Add Employee with no type to pick", async () => {
    mockAll();
    renderWithClient(<AssetUsersScreen fixedType="EMPLOYEE" />);
    expect(await screen.findByRole("heading", { name: "Employees" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(screen.queryByText("Lamington Road")).not.toBeInTheDocument();
    expect(screen.queryByText("HO Stock")).not.toBeInTheDocument();

    for (const header of ["Employee Code", "Name", "Place", "Department", "Login", "Work area", "Company"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(await screen.findAllByText("Head Office")).not.toHaveLength(0);
    expect(screen.getByText("Own Assets Only")).toBeInTheDocument();
    expect(screen.getByText("Can Add & Move Assets")).toBeInTheDocument();
    expect(screen.getByText("IT Team")).toBeInTheDocument();
    expect(screen.getByRole("table").textContent ?? "").not.toMatch(RAW);

    fireEvent.click(screen.getByRole("button", { name: "Add Employee" }));
    expect(await screen.findByRole("dialog", { name: "Add Employee" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Type" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Employee Code")).toBeInTheDocument();
  });

  it("Employees: saving a new employee sends the fixed type", async () => {
    mockAll();
    (apiClient.post as any).mockResolvedValue({ ...ASSET_USER, id: 9 });
    renderWithClient(<AssetUsersScreen fixedType="EMPLOYEE" />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add Employee" }));
    fireEvent.change(screen.getByLabelText("Employee Code"), { target: { value: "CS1" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ravi" } });
    await pickSelectOption("Company", "CityKart HQ");
    // The Place list is the chosen company's own: wait for it before opening it.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/locations?company_id=1"));
    await pickSelectOption("Place", "Head Office");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/asset-users", expect.objectContaining({ asset_user_type: "EMPLOYEE", code: "CS1" })),
    );
  });

  it("access levels are offered in plain words", async () => {
    mockAll();
    renderWithClient(<AssetUsersScreen fixedType="EMPLOYEE" />);
    await waitFor(() => expect(screen.getByText("Priya")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit priya$/i }));
    expect(screen.getByText(/current access: can add & move assets/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Access Role" }));
    for (const name of ["Full Admin", "Can Add & Move Assets", "View Only", "Own Assets Only"]) {
      expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("option", { name: "View Only" }));
    expect(await screen.findByText(/from can add & move assets to view only/i)).toBeInTheDocument();
  });

  it("editing keeps the person's work area exactly as it was (never cleared by Save)", async () => {
    mockAll();
    (apiClient.put as any).mockResolvedValue(ADMIN_EMP);
    renderWithClient(<AssetUsersScreen fixedType="EMPLOYEE" />);
    await waitFor(() => expect(screen.getByText("Priya")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit priya$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        "/asset-users/2",
        expect.objectContaining({ allowed_asset_domains: "IT", primary_asset_domain: "IT", role: "OPERATOR" }),
      ),
    );
  });

  it("Stores: only stores, Add Store, and Stores from ERP for the head-office admin", async () => {
    mockAll();
    useAuthStore.getState().setAuth({ accessToken: "t", role: "ADMIN", companyId: null, isPrimaryOwner: true, mustChangePassword: false });
    renderWithClient(<AssetUsersScreen fixedType="STORE" />);
    expect(await screen.findByRole("heading", { name: "Stores" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Lamington Road")).toBeInTheDocument());
    expect(screen.queryByText("Ankur")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Store" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stores from ERP" })).toBeInTheDocument();
    expect(screen.getByText("No login")).toBeInTheDocument();
    useAuthStore.getState().logout();
  });

  it("Stock Rooms and Install Points: places, not people -- no login columns, no Stores from ERP", async () => {
    mockAll();
    useAuthStore.getState().setAuth({ accessToken: "t", role: "ADMIN", companyId: null, isPrimaryOwner: true, mustChangePassword: false });
    const { unmount } = renderWithClient(<AssetUsersScreen fixedType="STOCK_POINT" />);
    expect(await screen.findByRole("heading", { name: "Stock Rooms" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("HO Stock")).toBeInTheDocument());
    expect(screen.queryByRole("columnheader", { name: "Login" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Stock Room" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stores from ERP" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Stock Room" }));
    expect(await screen.findByLabelText("Stock Room Code")).toBeInTheDocument();
    unmount();

    renderWithClient(<AssetUsersScreen fixedType="INSTALLED" />);
    expect(await screen.findByRole("heading", { name: "Install Points" })).toBeInTheDocument();
    expect(await screen.findByText(/no install points yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add Install Point" }).length).toBeGreaterThan(0);
    useAuthStore.getState().logout();
  });

  it("deactivation never promises a restore that does not exist", async () => {
    mockAll();
    renderWithClient(<AssetUsersScreen fixedType="EMPLOYEE" />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^deactivate ankur$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/history is kept/i);
    expect(dialog.textContent ?? "").not.toMatch(/restored|reversed/i);
  });
});
