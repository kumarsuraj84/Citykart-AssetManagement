import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MasterCrudScreen } from "./MasterCrudScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

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
