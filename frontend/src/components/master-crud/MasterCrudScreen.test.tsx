import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MasterCrudScreen } from "./MasterCrudScreen";
import { apiClient, ApiError } from "../../lib/api-client";

// Keeps the real ApiError class (so `instanceof ApiError` checks inside
// MasterCrudScreen work against the same class this test constructs) while
// still mocking apiClient's own methods, unlike a plain vi.mock(...)
// automock which would replace both (see AssetDetail.test.tsx).
vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const VENDOR_CONFIG = {
  resource: "vendors",
  title: "Vendors",
  singular: "Vendor",
  columns: [
    { key: "code" as const, label: "Code" },
    { key: "name" as const, label: "Name" },
  ],
  formFields: [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
  ],
  editFields: [{ key: "name", label: "Name" }],
};

describe("MasterCrudScreen", () => {
  it("shows a loading skeleton, then lists items", async () => {
    let resolveGet: (v: unknown) => void = () => {};
    (apiClient.get as any).mockReturnValue(new Promise((res) => (resolveGet = res)));

    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);
    expect(screen.queryByText("Vendor One")).not.toBeInTheDocument();

    resolveGet([{ id: 1, code: "V1", name: "Vendor One" }]);
    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());
  });

  it("shows an error state with a retry that refetches", async () => {
    (apiClient.get as any).mockRejectedValueOnce(new Error("network down"));
    (apiClient.get as any).mockResolvedValueOnce([{ id: 1, code: "V1", name: "Vendor One" }]);

    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());
  });

  it("shows an empty state with an Add action when there are no rows", async () => {
    (apiClient.get as any).mockResolvedValue([]);

    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);

    await waitFor(() => expect(screen.getByText(/no vendors yet/i)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /add vendor/i }).length).toBeGreaterThan(0);
  });

  it("creates a new item via the Add dialog", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, code: "V1", name: "Vendor One" }]);
    (apiClient.post as any).mockResolvedValue({ id: 2, code: "V2", name: "Vendor Two" });

    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add vendor/i }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "V2" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vendor Two" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", { code: "V2", name: "Vendor Two" }));
  });

  it("AM-21: search filters rows by any column's displayed value", async () => {
    (apiClient.get as any).mockResolvedValue([
      { id: 1, code: "V1", name: "Vendor One" },
      { id: 2, code: "V2", name: "Acme Traders" },
    ]);
    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^search vendors$/i), { target: { value: "acme" } });

    await waitFor(() => expect(screen.queryByText("Vendor One")).not.toBeInTheDocument());
    expect(screen.getByText("Acme Traders")).toBeInTheDocument();
  });

  it("AM-21: clicking a sortable column header sorts, and clicking again reverses it", async () => {
    (apiClient.get as any).mockResolvedValue([
      { id: 1, code: "V1", name: "Zebra Co" },
      { id: 2, code: "V2", name: "Acme Traders" },
    ]);
    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);
    await waitFor(() => expect(screen.getByText("Zebra Co")).toBeInTheDocument());

    const rowsText = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rowsText()[0]).toContain("Zebra Co"); // unsorted: API order

    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    await waitFor(() => expect(rowsText()[0]).toContain("Acme Traders")); // ascending

    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    await waitFor(() => expect(rowsText()[0]).toContain("Zebra Co")); // descending
  });

  it("AM-17 DEF-04: shows the API error inline in the Add dialog instead of failing silently", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, code: "V1", name: "Vendor One" }]);
    (apiClient.post as any).mockRejectedValue(new ApiError("a record with this code already exists", 422));

    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add vendor/i }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "V1" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("a record with this code already exists");
    // The dialog stays open so the user can correct the input, rather than
    // silently discarding what they typed.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("AM-17 DEF-04: shows the API error inline in the Edit dialog instead of failing silently", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, code: "V1", name: "Vendor One" }]);
    (apiClient.put as any).mockRejectedValue(new ApiError("a record with this code already exists", 422));

    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit vendor one$/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vendor One Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("a record with this code already exists");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits an item's name but the immutable code is never sent and shown read-only", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, code: "V1", name: "Vendor One" }]);
    (apiClient.put as any).mockResolvedValue({ id: 1, code: "V1", name: "Vendor One Renamed" });

    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit vendor one$/i }));

    // The immutable code is shown for context but not as an editable control.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("V1")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/not editable after creation/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vendor One Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/masters/vendors/1", { name: "Vendor One Renamed" }),
    );
  });

  it("AM-08: a read-only relational field with a `format` shows its human-readable label, not the raw id", async () => {
    const SUBCATEGORY_CONFIG = {
      resource: "subcategories",
      title: "Asset Subcategories",
      singular: "Subcategory",
      columns: [
        { key: "category_id" as const, label: "Category" },
        { key: "code" as const, label: "Code" },
        { key: "name" as const, label: "Name" },
      ],
      formFields: [
        {
          key: "category_id",
          label: "Category",
          type: "select" as const,
          options: [{ value: 11, label: "AM04 Test Category" }],
          format: () => "AM4CAT - AM04 Test Category",
        },
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
      ],
      editFields: [{ key: "name", label: "Name" }],
    };
    (apiClient.get as any).mockResolvedValue([{ id: 1, category_id: 11, code: "SUB1", name: "Sub One" }]);

    renderWithClient(<MasterCrudScreen config={SUBCATEGORY_CONFIG} />);

    await waitFor(() => expect(screen.getByText("Sub One")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit sub one$/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("AM4CAT - AM04 Test Category")).toBeInTheDocument();
    expect(within(dialog).queryByText("11")).not.toBeInTheDocument();
  });

  it("deactivates an item only after confirming in the dialog", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, code: "V1", name: "Vendor One" }]);
    (apiClient.delete as any).mockResolvedValue(undefined);

    renderWithClient(<MasterCrudScreen config={VENDOR_CONFIG} />);

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^deactivate vendor one$/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Vendor One");
    expect(apiClient.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/masters/vendors/1"));
  });
});
