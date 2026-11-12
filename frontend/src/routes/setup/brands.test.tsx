import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BrandsSetup from "./brands";
import { ApiError, apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const BRANDS = [
  { id: 1, code: "DELL", name: "Dell", is_active: true, work_areas: ["IT"] },
  { id: 2, code: "GODREJ", name: "Godrej", is_active: true, work_areas: ["NON_IT"] },
  { id: 3, code: "SAMSUNG", name: "Samsung", is_active: true, work_areas: ["IT", "NON_IT"] },
];

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BrandsSetup /></QueryClientProvider>);
}

async function choose(box: HTMLElement, optionName: string | RegExp) {
  fireEvent.click(box);
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.get as any).mockResolvedValue(BRANDS);
  (apiClient.post as any).mockResolvedValue({ id: 9 });
  (apiClient.put as any).mockResolvedValue({});
});

describe("Brands: where each one is used", () => {
  it("shows Used for as IT, Non-IT or IT and Non-IT", async () => {
    renderScreen();
    const row = async (name: string) => (await screen.findByText(name)).closest("tr")!;
    expect(within(await row("Dell")).getByText("IT")).toBeInTheDocument();
    expect(within(await row("Godrej")).getByText("Non-IT")).toBeInTheDocument();
    expect(within(await row("Samsung")).getByText("IT and Non-IT")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /used for/i })).toBeInTheDocument();
  });

  it("a new brand starts as both and sends the areas as a list", async () => {
    renderScreen();
    await screen.findByText("Dell");
    fireEvent.click(screen.getAllByRole("button", { name: /^add brand$/i })[0]);
    const dialog = await screen.findByRole("dialog", { name: /add brand/i });
    expect(within(dialog).getByRole("combobox", { name: "Used for" })).toHaveTextContent("Both IT and Non-IT");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Philips" } });
    await choose(within(dialog).getByRole("combobox", { name: "Used for" }), "Non-IT only");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/brands", expect.objectContaining({ name: "Philips", work_areas: ["NON_IT"] })));
  });

  it("editing a brand shows where it is used and saves a change", async () => {
    renderScreen();
    await screen.findByText("Dell");
    fireEvent.click(screen.getByRole("button", { name: "Edit Dell" }));
    const dialog = await screen.findByRole("dialog", { name: /edit brand/i });
    expect(within(dialog).getByRole("combobox", { name: "Used for" })).toHaveTextContent("IT only");
    await choose(within(dialog).getByRole("combobox", { name: "Used for" }), "Both IT and Non-IT");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/masters/brands/1", { name: "Dell", work_areas: ["IT", "NON_IT"] }));
  });

  it("ticked brands can be set to a work area in one go", async () => {
    renderScreen();
    await screen.findByText("Dell");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Dell" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Samsung" }));
    await choose(screen.getAllByRole("combobox", { name: "Used for" })[0], "IT only");
    fireEvent.click(screen.getByRole("button", { name: "Set used for (2)" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/brands/work-areas", { ids: [1, 3], work_areas: ["IT"] }));
  });

  it("says why when the server will not take an area off a brand", async () => {
    (apiClient.post as any).mockRejectedValue(new ApiError("Dell is the default brand of 2 IT Items (Laptop, Mouse), so IT cannot be taken off it.", 422));
    renderScreen();
    await screen.findByText("Dell");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Dell" }));
    await choose(screen.getAllByRole("combobox", { name: "Used for" })[0], "Non-IT only");
    fireEvent.click(screen.getByRole("button", { name: "Set used for (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("default brand of 2 IT Items");
  });
});
