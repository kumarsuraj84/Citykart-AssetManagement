import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetDetail } from "./AssetDetail";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");
vi.mock("../../lib/auth-store");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Same click-based interaction as AddAssetForm.test.tsx (Task 17) and HoldersScreen's own tests
// (Task 10) use for a real shadcn/ui Select: it's a Radix combobox trigger + listbox, not a
// native <select>, so it must be driven by clicking the trigger then the option -- a plain
// fireEvent.change on it is a no-op.
async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

describe("AssetDetail", () => {
  it("only shows actions valid for the current status and posts the chosen action", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/1") {
        return Promise.resolve({
          id: 1,
          asset_code: "FA/HO01/IT/LAP/CK_1",
          description: "Laptop",
          status: "IN_STOCK",
          company_id: 1,
        });
      }
      if (path === "/assets/1/events") return Promise.resolve([]);
      if (path.startsWith("/holders")) return Promise.resolve([{ id: 5, name: "Ankur" }]);
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockResolvedValue({ id: 99, status_after: "ALLOTTED" });

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /move \/ allot/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /receive from repair/i })).not.toBeInTheDocument();

    // Holders are scoped to the asset's own company, not fetched unscoped -- matches the
    // Initial Holder select's scoping in AddAssetForm.tsx.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/holders?company_id=1"));

    fireEvent.click(screen.getByRole("button", { name: /move \/ allot/i }));
    await pickSelectOption(/holder/i, "Ankur");
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/1/events", expect.objectContaining({
      event_type: "MOVED", to_holder_id: 5,
    })));
  });

  it("hides all action buttons for HOLDER-role viewers", async () => {
    (useAuthStore as any).mockImplementation((selector: any) => {
      const state = { role: "HOLDER", accessToken: null, companyId: null, mustChangePassword: false };
      return selector ? selector(state) : state;
    });
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/1") {
        return Promise.resolve({
          id: 1,
          asset_code: "FA/HO01/IT/LAP/CK_1",
          description: "Laptop",
          status: "IN_STOCK",
          company_id: 1,
        });
      }
      if (path === "/assets/1/events") return Promise.resolve([]);
      if (path.startsWith("/holders")) return Promise.resolve([{ id: 5, name: "Ankur" }]);
      return Promise.resolve([]);
    });

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /move \/ allot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
