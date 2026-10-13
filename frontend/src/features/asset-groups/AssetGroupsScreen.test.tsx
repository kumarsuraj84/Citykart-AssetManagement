import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { createAppRouter } from "../../router";
import { AssetGroupsScreen, WORK_AREA_CHANGE_TEXT } from "./AssetGroupsScreen";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const CATEGORIES = [
  { id: 1, code: "ITFA", name: "IT Fixed Assets", asset_domain: "IT", is_active: true },
  { id: 2, code: "ADMFA", name: "Admin Fixed Assets", asset_domain: "NON_IT", is_active: true },
  { id: 3, code: "FUR", name: "Furniture", asset_domain: "NON_IT", is_active: true },
];
const SUBCATEGORIES = [
  { id: 10, category_id: 1, code: "SWT", name: "Network Switch", is_active: true },
  { id: 11, category_id: 1, code: "LAP", name: "Laptop", is_active: true },
  { id: 20, category_id: 2, code: "FAN", name: "Fan", is_active: true },
];
const ITEMS = [
  { id: 1, name: "Dell Laptop", category_id: 1, subcategory_id: 11 },
  { id: 2, name: "HP Laptop", category_id: 1, subcategory_id: 11 },
  { id: 3, name: "PoE Switch", category_id: 1, subcategory_id: 10 },
  { id: 4, name: "Ceiling Fan", category_id: 2, subcategory_id: 20 },
];

function mockApi() {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/masters/categories") return Promise.resolve(CATEGORIES);
    if (path === "/masters/subcategories") return Promise.resolve(SUBCATEGORIES);
    if (path === "/items") return Promise.resolve(ITEMS);
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.put as any).mockResolvedValue({});
  (apiClient.delete as any).mockResolvedValue(undefined);
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AssetGroupsScreen /></QueryClientProvider>);
}

const groupRow = (name: string) => screen.getByText(name, { selector: "span.font-semibold" }).closest("div")!;

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: null, isPrimaryOwner: true, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("Asset Groups: Categories and Sub-categories in one nested screen", () => {
  it("shows each group with its work area in plain words, its Item count, and its Sub-categories underneath", async () => {
    renderScreen();
    expect(await screen.findByRole("heading", { name: "Asset Groups" })).toBeInTheDocument();
    await screen.findByText("Laptop");
    const it = groupRow("IT Fixed Assets");
    expect(within(it).getByText("IT Team")).toBeInTheDocument();
    expect(within(it).getByText("3 Items")).toBeInTheDocument();
    const subs = screen.getByRole("list", { name: "Sub-categories of IT Fixed Assets" });
    expect(within(subs).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Laptop"), expect.stringContaining("Network Switch"),
    ]);
    expect(within(subs).getByText("2 Items")).toBeInTheDocument();
    expect(within(groupRow("Admin Fixed Assets")).getByText("Admin / Non-IT Team")).toBeInTheDocument();
    // A group without a Sub-category says Items need one.
    expect(screen.getByText(/no sub-category yet: items need one/i)).toBeInTheDocument();
    // No raw codes for the work area, no "Responsibility", no serial setting.
    expect(screen.queryByText(/NON_IT|responsibility|serial/i)).not.toBeInTheDocument();
  });

  it("search keeps a group when it or one of its Sub-categories matches", async () => {
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.change(screen.getByLabelText("Search asset groups"), { target: { value: "fan" } });
    expect(screen.getByText("Admin Fixed Assets")).toBeInTheDocument();
    expect(screen.queryByText("IT Fixed Assets")).not.toBeInTheDocument();
  });

  it("Add Group asks for a name and work area; the Code is suggested from the name (editable under More)", async () => {
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Add Group" }));
    const dialog = screen.getByRole("dialog", { name: "Add Group" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Store Fixtures" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Work area" }));
    fireEvent.click(await screen.findByRole("option", { name: "Admin / Non-IT Team" }));
    // The suggestion shows on the More button; opening More lets it be changed.
    expect(within(dialog).getByRole("button", { name: /more/i })).toHaveTextContent("Code SF");
    fireEvent.click(within(dialog).getByRole("button", { name: /more/i }));
    expect(within(dialog).getByLabelText(/^code/i)).toHaveValue("SF");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/categories", { code: "SF", name: "Store Fixtures", asset_domain: "NON_IT" }),
    );
  });

  it("a suggested Code that is taken gets a number, and a typed Code wins", async () => {
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Add Group" }));
    const dialog = screen.getByRole("dialog", { name: "Add Group" });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Furniture" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /more/i }));
    expect(within(dialog).getByLabelText(/^code/i)).toHaveValue("FURNIT");
    fireEvent.change(within(dialog).getByLabelText(/^code/i), { target: { value: "fur2" } });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Furniture Two" } });
    expect(within(dialog).getByLabelText(/^code/i)).toHaveValue("FUR2");
  });

  it("adds a Sub-category inside a group, with the group fixed and the Code suggested", async () => {
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Add Sub-category to IT Fixed Assets" }));
    const dialog = screen.getByRole("dialog", { name: "Add Sub-category" });
    expect(dialog).toHaveTextContent("IT Fixed Assets");
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Server Rack" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/subcategories", { category_id: 1, code: "SR", name: "Server Rack" }),
    );
  });

  it("editing a Sub-category changes only its name; the group and Code are shown as not editable", async () => {
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Edit Laptop" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Sub-category" });
    expect(dialog).toHaveTextContent("LAP");
    expect(dialog).toHaveTextContent(/not editable after creation/i);
    expect(within(dialog).queryByLabelText(/^code/i)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Notebook" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/masters/subcategories/11", { name: "Notebook" }));
  });

  it("renaming a group keeps its work area and asks nothing more", async () => {
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Edit IT Fixed Assets" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Group" });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "IT Assets" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/masters/categories/1", { name: "IT Assets", asset_domain: "IT" }));
  });

  it("changing a group's work area asks for confirmation first, in plain words", async () => {
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Edit IT Fixed Assets" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Group" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Work area" }));
    fireEvent.click(await screen.findByRole("option", { name: "Admin / Non-IT Team" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(WORK_AREA_CHANGE_TEXT);
    expect(apiClient.put).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Change work area" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/masters/categories/1", { name: "IT Fixed Assets", asset_domain: "NON_IT" }));
  });

  it("deactivates a group or a Sub-category after asking (never deletes)", async () => {
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Fan" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(/deactivated, not deleted/i);
    fireEvent.click(within(confirm).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/masters/subcategories/20"));

    fireEvent.click(screen.getByRole("button", { name: "Deactivate Furniture" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/masters/categories/3"));
  });

  it("several can be deactivated at once, and a refusal is listed", async () => {
    (apiClient.delete as any).mockImplementation((path: string) =>
      path === "/masters/categories/2" ? Promise.reject(new Error("in use")) : Promise.resolve(undefined));
    renderScreen();
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Network Switch" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Admin Fixed Assets" }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate 2 selected" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/masters/subcategories/10"));
    expect(apiClient.delete).toHaveBeenCalledWith("/masters/categories/2");
    expect(await screen.findByText(/could not deactivate 1/i)).toBeInTheDocument();
  });
});

describe("old Categories / Sub-categories addresses", () => {
  it.each(["/setup/categories", "/setup/subcategories"])("%s opens Asset Groups", async (url) => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/catalogue/asset-groups"));
    expect(await screen.findByRole("heading", { name: "Asset Groups" })).toBeInTheDocument();
  });
});
