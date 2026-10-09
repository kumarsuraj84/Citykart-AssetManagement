import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { effectiveSerialRequired } from "../../lib/serial-rule";
import CategoriesSetup from "./categories";
import SubcategoriesSetup from "./subcategories";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const CATEGORIES = [
  { id: 1, code: "COMP", name: "Computers", asset_domain: "IT", serial_required: true, is_active: true },
  { id: 2, code: "CAB", name: "Cables", asset_domain: "IT", serial_required: false, is_active: true },
];
const SUBCATEGORIES = [
  { id: 10, category_id: 1, code: "CPU", name: "CPU", serial_required: null, is_active: true },
  { id: 11, category_id: 1, code: "MS", name: "Mouse", serial_required: false, is_active: true },
  { id: 12, category_id: 2, code: "PCH", name: "Patch cord", serial_required: null, is_active: true },
  { id: 13, category_id: 2, code: "SW", name: "Switch", serial_required: true, is_active: true },
];

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/masters/categories") return Promise.resolve(CATEGORIES);
    if (path === "/masters/subcategories") return Promise.resolve(SUBCATEGORIES);
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.put as any).mockResolvedValue({});
});

async function chooseOption(dialog: HTMLElement, label: string, option: string) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("effectiveSerialRequired", () => {
  it("uses the sub-category's own setting, else the category's", () => {
    expect(effectiveSerialRequired({ serial_required: true }, undefined)).toBe(true);
    expect(effectiveSerialRequired({ serial_required: false }, undefined)).toBe(false);
    expect(effectiveSerialRequired({ serial_required: false }, { serial_required: null })).toBe(false);
    expect(effectiveSerialRequired({ serial_required: false }, { serial_required: true })).toBe(true);
    expect(effectiveSerialRequired({ serial_required: true }, { serial_required: false })).toBe(false);
    expect(effectiveSerialRequired(undefined, undefined)).toBe(true);
  });
});

describe("Categories: serial number setting", () => {
  it("shows each category's setting", async () => {
    renderWith(<CategoriesSetup />);
    expect(await screen.findByText("Cables")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /serial number/i })).toBeInTheDocument();
    const cablesRow = screen.getByText("Cables").closest("tr")!;
    expect(within(cablesRow).getByText("No")).toBeInTheDocument();
    expect(within(screen.getByText("Computers").closest("tr")!).getByText("Yes")).toBeInTheDocument();
  });

  it("a new category starts as Yes and can be saved as No serial number", async () => {
    renderWith(<CategoriesSetup />);
    await screen.findByText("Cables");
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Serial number" })).toHaveTextContent("Yes, has a serial number");

    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "MIC" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Microphones" } });
    await chooseOption(dialog, "Responsibility", "IT");
    await chooseOption(dialog, "Serial number", "No serial number");
    fireEvent.click(within(dialog).getByRole("button", { name: /^(save|add|create)/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/categories", {
        code: "MIC", name: "Microphones", asset_domain: "IT", serial_required: false,
      }),
    );
  });

  it("editing opens with the stored value and sends the change", async () => {
    renderWith(<CategoriesSetup />);
    fireEvent.click(await screen.findByRole("button", { name: /edit cables/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Serial number" })).toHaveTextContent("No serial number");
    await chooseOption(dialog, "Serial number", "Yes, has a serial number");
    fireEvent.click(within(dialog).getByRole("button", { name: /^(save|update)/i }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/masters/categories/2", { name: "Cables", asset_domain: "IT", serial_required: true }),
    );
  });
});

describe("Sub-Categories: serial number setting", () => {
  it("shows the effective answer, spelling out what 'same as category' means", async () => {
    renderWith(<SubcategoriesSetup />);
    expect(await screen.findByText("Patch cord")).toBeInTheDocument();
    expect(within(screen.getByText("Patch cord").closest("tr")!).getByText("Same as category (No)")).toBeInTheDocument();
    expect(within(screen.getAllByText("CPU")[0].closest("tr")!).getByText("Same as category (Yes)")).toBeInTheDocument();
    expect(within(screen.getByText("Mouse").closest("tr")!).getByText("No")).toBeInTheDocument();
    expect(within(screen.getByText("Switch").closest("tr")!).getByText("Yes")).toBeInTheDocument();
  });

  it("a new sub-category follows its category unless told otherwise", async () => {
    renderWith(<SubcategoriesSetup />);
    await screen.findByText("Patch cord");
    fireEvent.click(screen.getByRole("button", { name: /add subcategory/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Serial number" })).toHaveTextContent("Same as the category");

    await chooseOption(dialog, "Category", "Computers");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "KB" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Keyboard" } });
    await chooseOption(dialog, "Serial number", "No serial number");
    fireEvent.click(within(dialog).getByRole("button", { name: /^(save|add|create)/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/masters/subcategories", {
        category_id: 1, code: "KB", name: "Keyboard", serial_required: false,
      }),
    );
  });

  it("editing can put a sub-category back to 'same as the category' (sends null)", async () => {
    renderWith(<SubcategoriesSetup />);
    fireEvent.click(await screen.findByRole("button", { name: /edit mouse/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Serial number" })).toHaveTextContent("No serial number");
    await chooseOption(dialog, "Serial number", "Same as the category");
    fireEvent.click(within(dialog).getByRole("button", { name: /^(save|update)/i }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/masters/subcategories/11", { name: "Mouse", serial_required: null }),
    );
  });
});
