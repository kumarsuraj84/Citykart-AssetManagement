import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddAssetForm } from "./AddAssetForm";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function mockGets() {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment" }]);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, code: "LAP", name: "Laptop" }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, code: "HO01", name: "Head Office" }]);
    if (path.startsWith("/holders")) return Promise.resolve([{ id: 4, name: "IT Stock-HO" }]);
    return Promise.resolve([]);
  });
}

describe("AddAssetForm", () => {
  it("computes tax live and shows the generated codes after submit", async () => {
    mockGets();
    (apiClient.post as any).mockResolvedValue([
      { id: 10, asset_code: "FA/HO01/IT/LAP/CK_1" },
      { id: 11, asset_code: "FA/HO01/IT/LAP/CK_2" },
    ]);

    renderWithClient(<AddAssetForm companyId={1} />);

    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    fireEvent.change(screen.getByLabelText(/purchase cost/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/tax %/i), { target: { value: "18" } });

    expect(screen.getByTestId("tax-amount")).toHaveTextContent("180");
    expect(screen.getByTestId("total-cost")).toHaveTextContent("1180");

    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "2" } });

    // The initial IT_STOCK holder is defaulted in from the company's holder
    // list once it loads, so Save is not blocked waiting on a manual pick.
    await waitFor(() => expect(screen.getByRole("combobox", { name: /initial holder/i })).toHaveTextContent("IT Stock-HO"));

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_1/)).toBeInTheDocument());
    expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_2/)).toBeInTheDocument();

    expect(apiClient.post).toHaveBeenCalledWith(
      "/assets",
      expect.objectContaining({
        company_id: 1,
        description: "Test Laptop",
        purchase_cost: 1000,
        tax_percent: 18,
        initial_holder_id: 4,
        quantity: 2,
      }),
    );
  });

  it("does not submit while no IT_STOCK holder is available for the company", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/holders")) return Promise.resolve([]);
      return Promise.resolve([{ id: 1, code: "X", name: "X" }]);
    });

    renderWithClient(<AddAssetForm companyId={1} />);

    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("/holders")));

    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
