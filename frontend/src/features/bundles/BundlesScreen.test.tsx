import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { BundlesScreen } from "./BundlesScreen";

vi.mock("../../lib/api-client");

const DESKTOP = {
  id: 1, name: "Desktop", is_active: true,
  parts: [
    { id: 11, name: "CPU", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 70, sort_order: 0 },
    { id: 12, name: "TFT", category_id: 2, subcategory_id: 20, serial_required: true, share_percent: 30, sort_order: 1 },
  ],
};

function mockGets(bundles: unknown[]) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/bundles") return Promise.resolve(bundles);
    if (path === "/masters/categories") return Promise.resolve([{ id: 1, name: "Computers" }, { id: 2, name: "Monitors" }]);
    if (path === "/masters/subcategories") {
      return Promise.resolve([{ id: 10, category_id: 1, name: "CPU Unit" }, { id: 20, category_id: 2, name: "TFT Screen" }]);
    }
    return Promise.resolve([]);
  });
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BundlesScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.put as any).mockResolvedValue({});
  (apiClient.delete as any).mockResolvedValue(undefined);
});

describe("BundlesScreen", () => {
  it("lists each bundle with its parts and their shares", async () => {
    mockGets([DESKTOP]);
    renderScreen();
    expect(await screen.findByText("Desktop")).toBeInTheDocument();
    expect(screen.getByText("CPU 70%, TFT 30%")).toBeInTheDocument();
  });

  it("shows an empty state when there are no bundles", async () => {
    mockGets([]);
    renderScreen();
    expect(await screen.findByText("No bundles yet.")).toBeInTheDocument();
  });

  it("the Desktop example fills the 70/26/2/2 parts, and Save needs every category and a 100% total", async () => {
    mockGets([]);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /new bundle/i }));
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", { name: /^save$/i });

    fireEvent.click(within(dialog).getByRole("button", { name: /use the desktop example/i }));
    expect(within(dialog).getByLabelText("Bundle name*")).toHaveValue("Desktop");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Total 100%");
    expect(within(dialog).getByRole("checkbox", { name: /needs serial number: keyboard/i })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /needs serial number: cpu/i })).toBeChecked();
    expect(save).toBeDisabled(); // categories not chosen yet

    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#part-share-0" }), { target: { value: "60" } });
    expect(within(dialog).getByRole("status")).toHaveTextContent("must be exactly 100%");
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#part-share-0" }), { target: { value: "70" } });
    expect(within(dialog).getByRole("status")).not.toHaveTextContent("must be exactly");
  });

  it("creates a bundle with the chosen categories and shares", async () => {
    mockGets([]);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /new bundle/i }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Bundle name*"), { target: { value: "Combo" } });
    fireEvent.change(within(dialog).getByLabelText("Part name", { selector: "#part-name-0" }), { target: { value: "Base" } });
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#part-share-0" }), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByLabelText("Category", { selector: "#part-category-0" }));
    fireEvent.click(await screen.findByText("Computers"));
    fireEvent.click(within(dialog).getByLabelText("Sub-Category", { selector: "#part-subcategory-0" }));
    fireEvent.click(await screen.findByText("CPU Unit"));

    const save = within(dialog).getByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/bundles", {
        name: "Combo",
        parts: [{ id: null, name: "Base", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 100 }],
      }),
    );
  });

  it("editing keeps each part's id and PUTs the whole bundle", async () => {
    mockGets([DESKTOP]);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Desktop" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Bundle name*")).toHaveValue("Desktop");

    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#part-share-0" }), { target: { value: "75" } });
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#part-share-1" }), { target: { value: "25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/bundles/1", {
        name: "Desktop",
        parts: [
          { id: 11, name: "CPU", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 75 },
          { id: 12, name: "TFT", category_id: 2, subcategory_id: 20, serial_required: true, share_percent: 25 },
        ],
      }),
    );
  });

  it("deactivating asks first, then calls DELETE", async () => {
    mockGets([DESKTOP]);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate Desktop" }));
    expect(apiClient.delete).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^deactivate$/i }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/bundles/1"));
  });

  it("shows the server's message when a save is refused", async () => {
    mockGets([DESKTOP]);
    (apiClient.put as any).mockRejectedValue(new Error("a bundle named 'Desktop' already exists"));
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Desktop" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});
