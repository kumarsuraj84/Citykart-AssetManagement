import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(() => vi.clearAllMocks());

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

  it("pages through the register with limit/offset and shows the total", async () => {
    const rows = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: start + i,
        asset_code: `FA/CK_${start + i}`,
        description: "Laptop",
        status: "IN_STOCK",
      }));
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/assets")) {
        const params = new URLSearchParams(path.split("?")[1]);
        const offset = Number(params.get("offset"));
        const limit = Number(params.get("limit"));
        const total = 120;
        return Promise.resolve({ items: rows(offset + 1, Math.min(limit, total - offset)), total });
      }
      return Promise.resolve([]);
    });

    renderWithClient(<AssetRegister />);
    await waitFor(() => expect(screen.getByText("FA/CK_1")).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringMatching(/limit=50.*offset=0|offset=0.*limit=50/));
    expect(screen.getByText(/showing 1–50 of 120/i)).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("FA/CK_51")).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("offset=50"));
    expect(screen.getByText(/showing 51–100 of 120/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("FA/CK_101")).toBeInTheDocument());
    expect(screen.getByText(/showing 101–120 of 120/i)).toBeInTheDocument();
    expect(screen.getByText(/page 3 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();

    // Changing a filter goes back to the first page.
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "CK" } });
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith(expect.stringMatching(/q=CK.*offset=0/)));
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
