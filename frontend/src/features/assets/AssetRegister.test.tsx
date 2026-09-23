import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetRegister } from "./AssetRegister";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Same click-based interaction as AssetDetail.test.tsx (Task 18) and AddAssetForm.test.tsx
// (Task 17) use for a real shadcn/ui Select: it's a Radix combobox trigger + listbox, not a
// native <select>, so it must be driven by clicking the trigger then the option.
async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

describe("AssetRegister", () => {
  it("lists assets and searches by the query box", async () => {
    (apiClient.get as any).mockResolvedValue({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }], total: 1 });

    renderWithClient(<AssetRegister />);
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "CK_1" } });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("q=CK_1")));
  });

  it("re-queries the register when a filter-bar dimension is picked", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets")) {
        return Promise.resolve({
          items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" }],
          total: 1,
        });
      }
      // /masters/categories, /masters/companies, /holders
      return Promise.resolve([]);
    });

    renderWithClient(<AssetRegister />);
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    await pickSelectOption(/status/i, /in stock/i);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("status=IN_STOCK")));
  });

  it("keeps the bulk-move dialog open and shows per-asset reasons on a partial failure", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets")) {
        return Promise.resolve({
          items: [
            { id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop 1", status: "IN_STOCK" },
            { id: 2, asset_code: "FA/HO01/IT/LAP/CK_2", description: "Laptop 2", status: "IN_STOCK" },
          ],
          total: 2,
        });
      }
      if (path.startsWith("/holders")) {
        return Promise.resolve([{ id: 5, name: "Warehouse" }]);
      }
      return Promise.resolve([]); // /masters/categories, /masters/companies
    });
    (apiClient.post as any).mockResolvedValue({
      moved: 1,
      failed: [{ asset_id: 2, reason: "assets can only move within their own company" }],
    });

    renderWithClient(<AssetRegister />);
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: /move/i }));

    await pickSelectOption(/move to/i, "Warehouse");
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    // The dialog must still be open with the failure detail visible -- not silently
    // closed the instant the (partially-successful) response comes back.
    await waitFor(() => expect(screen.getByText(/1 moved, 1 failed/i)).toBeInTheDocument());
    expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_2.*assets can only move within their own company/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /move to/i })).toBeInTheDocument();
    // Cancel became Done -- another signal the dialog is in its "review the failure"
    // state rather than having auto-dismissed.
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
  });
});
