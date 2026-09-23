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

function mockGets(holders: unknown[] = [{ id: 4, name: "IT Stock-HO" }]) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, code: "IT", name: "IT Equipment" }]);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, code: "LAP", name: "Laptop" }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, code: "HO01", name: "Head Office" }]);
    if (path.startsWith("/holders")) return Promise.resolve(holders);
    return Promise.resolve([]);
  });
}

async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
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

    // Required selects start blank and Save stays disabled until each is
    // explicitly picked -- nothing here is auto-filled on the admin's behalf.
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost center/i, "Head Office");
    await pickSelectOption(/initial holder/i, "IT Stock-HO");

    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_1/)).toBeInTheDocument());
    expect(screen.getByText(/FA\/HO01\/IT\/LAP\/CK_2/)).toBeInTheDocument();

    expect(apiClient.post).toHaveBeenCalledWith(
      "/assets",
      expect.objectContaining({
        company_id: 1,
        category_id: 1,
        cost_center_id: 3,
        description: "Test Laptop",
        purchase_cost: 1000,
        tax_percent: 18,
        initial_holder_id: 4,
        quantity: 2,
      }),
    );
  });

  it("does not submit while no IT_STOCK holder is available for the company", async () => {
    mockGets([]);

    renderWithClient(<AddAssetForm companyId={1} />);

    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost center/i, "Head Office");

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("/holders")));

    expect(screen.getByText(/no it stock holder found for this company/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("leaves the Initial Holder select blank when the company has more than one IT_STOCK holder, and blocks Save until one is explicitly picked", async () => {
    mockGets([
      { id: 4, name: "IT Stock-HO" },
      { id: 5, name: "IT Stock-WH-F" },
    ]);
    (apiClient.post as any).mockResolvedValue([{ id: 20, asset_code: "FA/HO01/IT/LAP/CK_1" }]);

    renderWithClient(<AddAssetForm companyId={1} />);

    fireEvent.change(await screen.findByLabelText(/description/i), { target: { value: "Test Laptop" } });
    await pickSelectOption(/^category$/i, "IT Equipment");
    await pickSelectOption(/cost center/i, "Head Office");

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining("/holders")));

    // Neither of the two holders is pre-selected -- the combobox still shows
    // its placeholder, and clicking Save without a pick must not submit.
    const holderCombobox = screen.getByRole("combobox", { name: /initial holder/i });
    expect(holderCombobox).not.toHaveTextContent("IT Stock-HO");
    expect(holderCombobox).not.toHaveTextContent("IT Stock-WH-F");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(apiClient.post).not.toHaveBeenCalled();

    await pickSelectOption(/initial holder/i, "IT Stock-WH-F");
    await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/assets",
        expect.objectContaining({ initial_holder_id: 5 }),
      ),
    );
  });
});
