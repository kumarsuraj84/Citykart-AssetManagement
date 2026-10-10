import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { yesNo } from "../../lib/serial-rule";
import CategoriesSetup from "./categories";
import SubcategoriesSetup from "./subcategories";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const CATEGORIES = [
  { id: 1, code: "ITFA", name: "IT Fixed Assets", asset_domain: "IT", is_active: true },
  { id: 2, code: "ADMFA", name: "Admin Fixed Assets", asset_domain: "NON_IT", is_active: true },
];
const SUBCATEGORIES = [
  { id: 10, category_id: 1, code: "SWT", name: "Network Switch", is_active: true },
  { id: 11, category_id: 2, code: "FAN", name: "Fan", is_active: true },
];

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: null, isPrimaryOwner: true, mustChangePassword: false });
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/masters/categories") return Promise.resolve(CATEGORIES);
    if (path === "/masters/subcategories") return Promise.resolve(SUBCATEGORIES);
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.put as any).mockResolvedValue({});
});
afterEach(() => useAuthStore.getState().logout());

describe("the serial number rule is not on Categories or Sub-Categories", () => {
  it("yesNo only spells out an Item's setting", () => {
    expect(yesNo(true)).toBe("Yes");
    expect(yesNo(false)).toBe("No");
  });

  it("the Category list and form have no serial number setting", async () => {
    renderWith(<CategoriesSetup />);
    expect(await screen.findByText("Admin Fixed Assets")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /serial number/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Responsibility")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/serial number/i)).not.toBeInTheDocument();
  });

  it("a new category is saved without any serial setting", async () => {
    renderWith(<CategoriesSetup />);
    await screen.findByText("Admin Fixed Assets");
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "HRFA" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "HR Fixed Assets" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Responsibility" }));
    fireEvent.click(await screen.findByRole("option", { name: "Admin / Non-IT" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/categories", { code: "HRFA", name: "HR Fixed Assets", asset_domain: "NON_IT" }),
    );
  });

  it("the Sub-Category list and form have no serial number setting", async () => {
    renderWith(<SubcategoriesSetup />);
    expect(await screen.findByText("Network Switch")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /serial number/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add subcategory/i }));
    expect(within(screen.getByRole("dialog")).queryByLabelText(/serial number/i)).not.toBeInTheDocument();
  });
});

describe("a missing Category is created from the Sub-Category form", () => {
  it("offers New Category… and picks the new one", async () => {
    // Like the real server: once the Category exists, the lists include it.
    const categories = [...CATEGORIES];
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/masters/categories") return Promise.resolve(categories);
      if (path === "/masters/subcategories") return Promise.resolve(SUBCATEGORIES);
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockImplementation((path: string, body: any) => {
      if (path !== "/masters/categories") return Promise.resolve({});
      const created = { id: 3, is_active: true, ...body };
      categories.push(created);
      return Promise.resolve(created);
    });
    renderWith(<SubcategoriesSetup />);
    await screen.findByText("Network Switch");
    fireEvent.click(screen.getByRole("button", { name: /add subcategory/i }));
    const subDialog = screen.getByRole("dialog");
    fireEvent.click(within(subDialog).getByRole("combobox", { name: "Category" }));
    fireEvent.click(await screen.findByRole("option", { name: /new category/i }));

    const catDialog = await screen.findByRole("dialog", { name: /new category/i });
    fireEvent.change(within(catDialog).getByLabelText(/^name/i), { target: { value: "Stores Fixed Assets" } });
    fireEvent.change(within(catDialog).getByLabelText(/^code/i), { target: { value: "STFA" } });
    fireEvent.click(within(catDialog).getByLabelText(/^responsibility/i));
    fireEvent.click(await screen.findByRole("option", { name: "Admin / Non-IT" }));
    fireEvent.click(within(catDialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/categories", { name: "Stores Fixed Assets", code: "STFA", asset_domain: "NON_IT" }),
    );

    // back on the Sub-Category form: finish it with the Category that was just made
    const back = await screen.findByRole("dialog", { name: /add subcategory/i });
    fireEvent.change(within(back).getByLabelText("Code"), { target: { value: "RACK" } });
    fireEvent.change(within(back).getByLabelText("Name"), { target: { value: "Rack" } });
    fireEvent.click(within(back).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/subcategories", { category_id: 3, code: "RACK", name: "Rack" }),
    );
  });

  it("is not offered to anyone but the Primary Owner", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    renderWith(<SubcategoriesSetup />);
    await screen.findByText("Network Switch");
    fireEvent.click(screen.getByRole("button", { name: /add subcategory/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Category" }));
    await screen.findByRole("option", { name: "IT Fixed Assets" });
    expect(screen.queryByRole("option", { name: /new category/i })).not.toBeInTheDocument();
  });
});
