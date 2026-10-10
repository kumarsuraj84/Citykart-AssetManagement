import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import CompaniesSetup from "./companies";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><CompaniesSetup /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.get as any).mockResolvedValue([
    { id: 1, code: "CKS", name: "Citykart Stores", erp_company_code: null, is_active: true },
    { id: 2, code: "CKV", name: "Citykart Ventures", erp_company_code: "CKVPL", is_active: true },
  ]);
  (apiClient.put as any).mockResolvedValue({});
  (apiClient.post as any).mockResolvedValue({});
});

describe("Companies: ERP company code", () => {
  it("shows what the ERP calls each company, and a dash when it is the same", async () => {
    renderScreen();
    const stores = (await screen.findByText("Citykart Stores")).closest("tr")!;
    expect(within(stores).getByText("—")).toBeInTheDocument();
    expect(within(screen.getByText("Citykart Ventures").closest("tr")!).getByText("CKVPL")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /erp company code/i })).toBeInTheDocument();
  });

  it("editing sets the ERP company code, and clearing it sends null", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /edit citykart stores/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/erp company code/i), { target: { value: " CKSPL " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^(save|update)/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/masters/companies/1", { name: "Citykart Stores", erp_company_code: "CKSPL" }));

    fireEvent.click(await screen.findByRole("button", { name: /edit citykart ventures/i }));
    const second = screen.getByRole("dialog");
    expect(within(second).getByLabelText(/erp company code/i)).toHaveValue("CKVPL");
    fireEvent.change(within(second).getByLabelText(/erp company code/i), { target: { value: "" } });
    fireEvent.click(within(second).getByRole("button", { name: /^(save|update)/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/masters/companies/2", { name: "Citykart Ventures", erp_company_code: null }));
  });

  it("a new company can be created with an ERP company code", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /add company/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^code$/i), { target: { value: "CKX" } });
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "X Co" } });
    fireEvent.change(within(dialog).getByLabelText(/erp company code/i), { target: { value: "XCO" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^(save|add|create)/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/companies", { code: "CKX", name: "X Co", erp_company_code: "XCO" }));
  });
});
