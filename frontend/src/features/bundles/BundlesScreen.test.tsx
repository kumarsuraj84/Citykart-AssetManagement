import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { BundlesScreen } from "./BundlesScreen";
import { HEAD_OFFICE, VIEWER } from "../../test-capabilities";

vi.mock("../../lib/api-client");

const DESKTOP = {
  id: 1, name: "Desktop", is_active: true,
  parts: [
    { id: 11, name: "CPU", item_id: 101, item_name: "CPU", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 70, sort_order: 0 },
    { id: 12, name: "TFT", item_id: 102, item_name: "TFT", category_id: 2, subcategory_id: 20, serial_required: true, share_percent: 30, sort_order: 1 },
  ],
};

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, category_id: 1, subcategory_id: 10, serial_required: true, bundle_id: null,
  default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0, ...over,
});

function mockGets(bundles: unknown[]) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/capabilities") return Promise.resolve(useAuthStore.getState().isPrimaryOwner ? HEAD_OFFICE : VIEWER);
    if (path === "/bundles") return Promise.resolve(bundles);
    if (path === "/items") {
      return Promise.resolve([
        item(101, "CPU"),
        item(102, "TFT", { category_id: 2, subcategory_id: 20 }),
        item(103, "Mouse", { serial_required: false }),
        item(104, "Desktop", { bundle_id: 1 }),                 // a bundle itself: never offered as a part
      ]);
    }
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

afterEach(() => useAuthStore.getState().logout());

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

  it("the Desktop example fills the 70/26/2/2 parts, and Save needs every part's Item and a 100% total", async () => {
    mockGets([]);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /new bundle/i }));
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", { name: /^save$/i });

    fireEvent.click(within(dialog).getByRole("button", { name: /use the desktop example/i }));
    expect(within(dialog).getByLabelText("Bundle name*")).toHaveValue("Desktop");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Total 100%");
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument(); // the serial rule is on the Item, not the bundle
    expect(save).toBeDisabled(); // the Items are not chosen yet

    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#part-share-0" }), { target: { value: "60" } });
    expect(within(dialog).getByRole("status")).toHaveTextContent("must be exactly 100%");
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#part-share-0" }), { target: { value: "70" } });
    expect(within(dialog).getByRole("status")).not.toHaveTextContent("must be exactly");
  });

  it("creates a bundle whose parts are Items, and a bundle Item is not offered as a part", async () => {
    mockGets([]);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /new bundle/i }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Bundle name*"), { target: { value: "Combo" } });
    fireEvent.change(within(dialog).getByLabelText("Part name", { selector: "#part-name-0" }), { target: { value: "Base" } });
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#part-share-0" }), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByLabelText("Item", { selector: "#part-item-0" }));
    expect(screen.queryByRole("option", { name: /^Desktop\b/ })).not.toBeInTheDocument();
    // Each Item reads with its Category › Sub-category, so similar names can be told apart.
    // (jsdom computes the name without the space before "·"; a browser reads "CPU · Computers › CPU Unit".)
    fireEvent.click(await screen.findByRole("option", { name: /^CPU ?· Computers › CPU Unit$/ }));
    expect(within(dialog).getByText("Serial: Yes")).toBeInTheDocument();     // the Item's own setting
    expect(within(dialog).getByText("Computers › CPU Unit")).toBeInTheDocument();

    const save = within(dialog).getByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/bundles", {
        name: "Combo",
        parts: [{ id: null, name: "Base", item_id: 101, share_percent: 100 }],
      }),
    );
  });

  it("a part whose Item has no serial says so", async () => {
    mockGets([]);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /new bundle/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Item", { selector: "#part-item-0" }));
    fireEvent.click(await screen.findByRole("option", { name: /^Mouse ?· / }));
    expect(within(dialog).getByText("Serial: No")).toBeInTheDocument();
  });

  it("the Primary Owner can create a part's Item right here and it is picked", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: null, isPrimaryOwner: true, mustChangePassword: false });
    mockGets([]);
    (apiClient.post as any).mockResolvedValue(item(105, "Speaker"));
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /new bundle/i }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Part name", { selector: "#part-name-0" }), { target: { value: "Speaker" } });
    fireEvent.click(within(dialog).getByLabelText("Item", { selector: "#part-item-0" }));
    fireEvent.click(await screen.findByRole("option", { name: /new item/i }));

    dialog = await screen.findByRole("dialog", { name: /new item/i });
    expect(within(dialog).getByLabelText(/item name/i)).toHaveValue("Speaker");     // starts from the part's name
    fireEvent.click(within(dialog).getByRole("combobox", { name: /type of asset/i }));
    fireEvent.click(await screen.findByRole("option", { name: /^Computers › CPU Unit/ }));
    // A part is a single thing: the Item made here is not offered "Comes as a set".
    fireEvent.click(within(dialog).getByRole("button", { name: /^more$/i }));
    expect(within(dialog).getByLabelText(/default warranty/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole("switch", { name: /comes as a set/i })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({ name: "Speaker", category_id: 1, subcategory_id: 10 })),
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
          { id: 11, name: "CPU", item_id: 101, share_percent: 75 },
          { id: 12, name: "TFT", item_id: 102, share_percent: 25 },
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
