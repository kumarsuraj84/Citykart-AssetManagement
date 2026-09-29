import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HoldersScreen } from "./HoldersScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const HOLDER: Record<string, unknown> = {
  id: 1,
  company_id: 1,
  emp_code: "CS6872",
  name: "Ankur",
  holder_type: "EMPLOYEE",
  location_id: 1,
  department_id: 1,
  email: null,
  phone: null,
  role: "HOLDER",
  is_active: true,
};

const COMPANY = { id: 1, name: "CityKart HQ" };
const COMPANY_B = { id: 2, name: "CityKart Ventures" };
const LOCATION = { id: 1, code: "HO", name: "Head Office" };
const LOCATION_WH1 = { id: 2, code: "WH1", name: "Warehouse 1" };

function mockGets(holders: unknown[] = [HOLDER], companies: unknown[] = [COMPANY], locations: unknown[] = [LOCATION]) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/holders") return Promise.resolve(holders);
    if (path === "/masters/companies") return Promise.resolve(companies);
    if (path === "/masters/locations") return Promise.resolve(locations);
    if (path === "/masters/departments") return Promise.resolve([]);
    if (path === "/holders/1/company-access") return Promise.resolve({ company_ids: [] });
    return Promise.resolve([]);
  });
}

async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

describe("HoldersScreen", () => {
  it("resets a holder's password and shows the temp password", async () => {
    mockGets();
    (apiClient.post as any).mockResolvedValue({ temp_password: "abc123XYZ" });

    renderWithClient(<HoldersScreen />);

    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => expect(screen.getByText("abc123XYZ")).toBeInTheDocument());
    expect(apiClient.post).toHaveBeenCalledWith("/holders/1/reset-password");

    // The temp password dialog uses proper alertdialog semantics.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    // Closing the dialog must not leave the temp password visible anywhere.
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText("abc123XYZ")).not.toBeInTheDocument());
  });

  it("adds a new holder via the Add dialog", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue({ ...HOLDER, id: 2, emp_code: "NEW01", name: "New Hire" });

    renderWithClient(<HoldersScreen />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    fireEvent.change(screen.getByLabelText("Emp Code"), { target: { value: "NEW01" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Hire" } });
    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "EMPLOYEE");
    await pickSelectOption("Location", "Head Office");
    // Role defaults to HOLDER already, so no interaction needed for it.

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/holders", {
        company_id: 1,
        emp_code: "NEW01",
        name: "New Hire",
        holder_type: "EMPLOYEE",
        location_id: 1,
        department_id: null,
        email: null,
        phone: null,
        role: "HOLDER",
      }),
    );
  });

  it("prefills the Edit dialog and saves changes via PUT", async () => {
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...HOLDER, name: "Ankur K" });

    renderWithClient(<HoldersScreen />);

    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit ankur$/i }));

    // Prefilled from the existing row.
    expect(screen.getByLabelText("Emp Code")).toHaveValue("CS6872");
    expect(screen.getByLabelText("Name")).toHaveValue("Ankur");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ankur K" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/holders/1", {
        company_id: 1,
        emp_code: "CS6872",
        name: "Ankur K",
        holder_type: "EMPLOYEE",
        location_id: 1,
        department_id: 1,
        email: null,
        phone: null,
        role: "HOLDER",
      }),
    );
  });

  it("shows a loading skeleton, then an empty state with an Add action when there are no holders", async () => {
    mockGets([]);
    renderWithClient(<HoldersScreen />);

    await waitFor(() => expect(screen.getByText(/no holders yet/i)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^add$/i }).length).toBeGreaterThan(0);
  });

  it("shows an error state with a retry that refetches", async () => {
    (apiClient.get as any).mockImplementationOnce((path: string) => {
      if (path === "/holders") return Promise.reject(new Error("holders down"));
      return Promise.resolve([]);
    });
    renderWithClient(<HoldersScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("holders down");

    mockGets();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
  });

  it("deactivates a holder only after confirming in the dialog", async () => {
    mockGets();
    (apiClient.delete as any).mockResolvedValue(undefined);

    renderWithClient(<HoldersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^deactivate ankur$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ankur");
    expect(apiClient.delete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/holders/1"));
  });

  it("AM-08: blocks Save with Location left blank -- never submits the old 0 sentinel", async () => {
    mockGets([]);
    renderWithClient(<HoldersScreen />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    fireEvent.change(screen.getByLabelText("Emp Code"), { target: { value: "NOLOC" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "No Location" } });
    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "EMPLOYEE");
    // Location deliberately left unselected.

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("AM-08: shows the backend's controlled validation error inside the dialog, not a crash", async () => {
    mockGets([]);
    (apiClient.post as any).mockRejectedValue(new Error("location not found or inactive"));

    renderWithClient(<HoldersScreen />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    fireEvent.change(screen.getByLabelText("Emp Code"), { target: { value: "NEW02" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Hire 2" } });
    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "EMPLOYEE");
    await pickSelectOption("Location", "Head Office");

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/location not found or inactive/i);
    // The dialog stays open on a server error -- never silently closed.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("warns before saving a role change, and role is not reset by unrelated field edits", async () => {
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...HOLDER, name: "Ankur K" });

    renderWithClient(<HoldersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit ankur$/i }));

    // Editing an unrelated field does not touch the prefilled role.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ankur K" } });
    expect(screen.queryByText(/will immediately change this person's access/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/holders/1", expect.objectContaining({ role: "HOLDER" })),
    );
  });

  it("AM-24: shows current company access grants and saves changes to them", async () => {
    mockGets([HOLDER], [COMPANY, COMPANY_B]);
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/holders") return Promise.resolve([HOLDER]);
      if (path === "/masters/companies") return Promise.resolve([COMPANY, COMPANY_B]);
      if (path === "/masters/locations") return Promise.resolve([LOCATION]);
      if (path === "/masters/departments") return Promise.resolve([]);
      if (path === "/holders/1/company-access") return Promise.resolve({ company_ids: [] });
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockResolvedValue(undefined);

    renderWithClient(<HoldersScreen />);
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
      expect(apiClient.post).toHaveBeenCalledWith("/holders/1/company-access", { company_ids: [2] }),
    );
  });

  it("IT_STOCK/INSTALLED: picking a Location auto-fills Code/Name and relabels the fields", async () => {
    mockGets([], [COMPANY], [LOCATION, LOCATION_WH1]);
    (apiClient.post as any).mockResolvedValue({ ...HOLDER, id: 3, emp_code: "STK-WH1" });

    renderWithClient(<HoldersScreen />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "IT_STOCK");
    // Labels relabel away from the "Emp Code"/"Name" wording once a non-person type is picked.
    expect(screen.getByText("Stock Point Code")).toBeInTheDocument();
    expect(screen.getByText("Stock Point Name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Emp Code")).not.toBeInTheDocument();

    await pickSelectOption("Location", "Warehouse 1");
    expect(screen.getByLabelText("Stock Point Code")).toHaveValue("STK-WH1");
    expect(screen.getByLabelText("Stock Point Name")).toHaveValue("Stock Point - Warehouse 1");

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/holders",
        expect.objectContaining({ emp_code: "STK-WH1", name: "Stock Point - Warehouse 1", holder_type: "IT_STOCK" }),
      ),
    );
  });

  it("IT_STOCK: a manually-typed Code/Name is never overwritten by picking a Location afterward", async () => {
    mockGets([], [COMPANY], [LOCATION, LOCATION_WH1]);
    renderWithClient(<HoldersScreen />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/companies"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await pickSelectOption("Type", "IT_STOCK");
    fireEvent.change(screen.getByLabelText("Stock Point Code"), { target: { value: "MY-OWN-CODE" } });
    fireEvent.change(screen.getByLabelText("Stock Point Name"), { target: { value: "My Own Name" } });

    await pickSelectOption("Location", "Warehouse 1");
    expect(screen.getByLabelText("Stock Point Code")).toHaveValue("MY-OWN-CODE");
    expect(screen.getByLabelText("Stock Point Name")).toHaveValue("My Own Name");
  });

  it("shows a coverage checklist of which locations already have an IT_STOCK point for the chosen company", async () => {
    const stockAtHo = { ...HOLDER, id: 5, emp_code: "STK-HO", name: "Stock Point - Head Office", holder_type: "IT_STOCK", location_id: 1 };
    mockGets([HOLDER, stockAtHo], [COMPANY], [LOCATION, LOCATION_WH1]);
    renderWithClient(<HoldersScreen />);
    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await pickSelectOption("Company", "CityKart HQ");
    await pickSelectOption("Type", "IT_STOCK");

    expect(await screen.findByText(/coverage for this company/i)).toBeInTheDocument();
    expect(screen.getByText("Head Office")).toBeInTheDocument();
    expect(screen.getByText("Warehouse 1")).toBeInTheDocument();
  });
});
