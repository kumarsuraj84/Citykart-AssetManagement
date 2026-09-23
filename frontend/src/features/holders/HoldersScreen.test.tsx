import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HoldersScreen } from "./HoldersScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
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
const LOCATION = { id: 1, name: "Head Office" };

function mockGets(holders: unknown[] = [HOLDER]) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/holders") return Promise.resolve(holders);
    if (path === "/masters/companies") return Promise.resolve([COMPANY]);
    if (path === "/masters/locations") return Promise.resolve([LOCATION]);
    if (path === "/masters/departments") return Promise.resolve([]);
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
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

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
});
