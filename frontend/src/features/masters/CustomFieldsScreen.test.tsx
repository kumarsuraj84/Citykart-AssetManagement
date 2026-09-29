import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomFieldsScreen } from "./CustomFieldsScreen";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const COMPANIES = [
  { id: 1, name: "CityKart HQ" },
  { id: 2, name: "CityKart Retail" },
];

const FIELDS = [
  { id: 1, field_key: "warranty_card", label: "Warranty Card #", field_type: "text", options: null, is_required: false, sort_order: 1, company_id: null, is_active: true },
  { id: 2, field_key: "store_tag", label: "Store Tag", field_type: "text", options: null, is_required: false, sort_order: 2, company_id: 1, is_active: true },
  { id: 3, field_key: "other_tag", label: "Other Company Tag", field_type: "text", options: null, is_required: false, sort_order: 3, company_id: 2, is_active: true },
];

function mockGets(fields: unknown[] = FIELDS) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/masters/custom-fields") return Promise.resolve(fields);
    if (path === "/masters/companies") return Promise.resolve(COMPANIES);
    return Promise.resolve([]);
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => useAuthStore.getState().logout());

describe("CustomFieldsScreen", () => {
  it("shows a human-readable scope (Global or company name) per field", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    mockGets();
    renderWithClient(<CustomFieldsScreen />);

    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Global")).toBeInTheDocument();
    expect(within(rows[2]).getByText("CityKart HQ")).toBeInTheDocument();
    expect(within(rows[3]).getByText("CityKart Retail")).toBeInTheDocument();
  });

  it("the Primary Owner can create a Global field", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    mockGets();
    (apiClient.post as any).mockResolvedValue({ ...FIELDS[0], id: 9 });

    renderWithClient(<CustomFieldsScreen />);
    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Serial Tag" } });
    fireEvent.change(screen.getByLabelText("Field Key"), { target: { value: "serial_tag" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/masters/custom-fields",
        expect.objectContaining({ field_key: "serial_tag", label: "Serial Tag", company_id: null }),
      ),
    );
  });

  it("rejects a field key with spaces or uppercase before ever calling the API", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    mockGets();

    renderWithClient(<CustomFieldsScreen />);
    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add custom field/i }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Bad Key" } });
    fireEvent.change(screen.getByLabelText("Field Key"), { target: { value: "Bad Key!" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/lowercase letters, numbers, and underscores/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("an ordinary ADMIN (not the Primary Owner) has no Add Custom Field button at all", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    mockGets();
    renderWithClient(<CustomFieldsScreen />);

    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /add custom field/i })).not.toBeInTheDocument();
  });

  it("OPERATOR has no Add Custom Field button either -- master data is Primary-Owner-only", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    mockGets();
    renderWithClient(<CustomFieldsScreen />);

    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /add custom field/i })).not.toBeInTheDocument();
  });

  it("only the Primary Owner sees Edit/Deactivate actions on any field, regardless of scope", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    mockGets();
    renderWithClient(<CustomFieldsScreen />);

    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^edit store tag$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit warranty card #$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit other company tag$/i })).not.toBeInTheDocument();

    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    renderWithClient(<CustomFieldsScreen />);
    await waitFor(() => expect(screen.getAllByText("Warranty Card #").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /^edit store tag$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit other company tag$/i })).toBeInTheDocument();
  });

  it("field_key and field_type are shown read-only in the Edit dialog, never as inputs", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    mockGets();
    renderWithClient(<CustomFieldsScreen />);

    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit warranty card #$/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("warranty_card")).toBeInTheDocument();
    expect(within(dialog).getByText("text")).toBeInTheDocument();
    expect(screen.queryByLabelText("Field Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Field Type")).not.toBeInTheDocument();
  });

  it("requires a stronger confirmation naming every company before making a Global field required", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...FIELDS[0], is_required: true });

    renderWithClient(<CustomFieldsScreen />);
    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit warranty card #$/i }));

    fireEvent.click(screen.getByLabelText("Required"));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(/every company/i);
    expect(apiClient.put).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: /yes, make it required/i }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/masters/custom-fields/1", expect.objectContaining({ is_required: true })),
    );
  });

  it("names the specific company in the confirmation for a company-specific field", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    mockGets();
    (apiClient.put as any).mockResolvedValue({ ...FIELDS[1], is_required: true });

    renderWithClient(<CustomFieldsScreen />);
    await waitFor(() => expect(screen.getByText("Store Tag")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit store tag$/i }));

    fireEvent.click(screen.getByLabelText("Required"));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("CityKart HQ");
    expect(confirm).not.toHaveTextContent(/every company/i);
  });

  it("deactivates a field only after confirming", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
    mockGets();
    (apiClient.delete as any).mockResolvedValue(undefined);

    renderWithClient(<CustomFieldsScreen />);
    await waitFor(() => expect(screen.getByText("Warranty Card #")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^deactivate warranty card #$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Warranty Card #");
    expect(apiClient.delete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/masters/custom-fields/1"));
  });
});
