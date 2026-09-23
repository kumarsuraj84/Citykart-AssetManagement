import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MasterCrudScreen } from "./MasterCrudScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MasterCrudScreen", () => {
  it("lists items and creates a new one", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, code: "V1", name: "Vendor One", is_active: true }]);
    (apiClient.post as any).mockResolvedValue({ id: 2, code: "V2", name: "Vendor Two", is_active: true });

    renderWithClient(
      <MasterCrudScreen
        config={{
          resource: "vendors",
          title: "Vendors",
          columns: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }],
          formFields: [{ key: "code", label: "Code" }, { key: "name", label: "Name" }],
        }}
      />
    );

    await waitFor(() => expect(screen.getByText("Vendor One")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "V2" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vendor Two" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", { code: "V2", name: "Vendor Two" }));
  });
});
