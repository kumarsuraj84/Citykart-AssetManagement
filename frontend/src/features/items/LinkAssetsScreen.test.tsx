import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { currentIdempotencyKey } from "../../lib/request-key";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { ApiError, apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { itemsOfGroup, suggestionText } from "./LinkAssetsScreen";
import type { Item } from "./types";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...real, apiClient: { get: vi.fn(), getPage: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const PATH = "/settings/catalogue/link-assets";

function renderAt(url = PATH) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

const row = (id: number, over: Record<string, unknown> = {}) => ({
  asset_id: id, asset_code: `FA/CK/${id}`, description: `Asset ${id}`, serial_number: `SN-${id}`, erp_item_code: null,
  status: "IN_STOCK", company_code: "CKSPL", category_id: 3, category_name: "Computers", subcategory_id: 7, subcategory_name: "Laptop",
  holder_name: "HO Stock", holder_kind_label: "Stock Room",
  suggestions: [
    { item_id: 44, item_name: "Laptop", score: 1, reason: "ERP_CODE" },
    { item_id: 45, item_name: "Gaming Laptop", score: 0.4, reason: "GROUP" },
  ],
  ...over,
});

const ITEMS = [
  { id: 44, name: "Laptop", category_id: 3, subcategory_id: 7, is_active: true },
  { id: 45, name: "Gaming Laptop", category_id: 3, subcategory_id: 7, is_active: true },
  { id: 46, name: "Ceiling Fan", category_id: 9, subcategory_id: 10, is_active: true },
];

function mockList(rows: unknown[], total = rows.length) {
  (apiClient.getPage as any).mockImplementation(() => Promise.resolve({ data: rows, total }));
  (apiClient.get as any).mockImplementation((path: string) => (path === "/items" ? Promise.resolve(ITEMS) : Promise.resolve([])));
}

function loginAs(role: string, isPrimaryOwner = false) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role, companyId: 1, isPrimaryOwner, mustChangePassword: false, assetUserId: 9 });
}

beforeEach(() => {
  vi.clearAllMocks();
  loginAs("ADMIN");
});
afterEach(() => useAuthStore.getState().logout());

describe("Link existing assets to Items", () => {
  it("lists assets without an Item with their suggestions as one-click chips in words, with how sure", async () => {
    mockList([row(1), row(2, { suggestions: [{ item_id: 44, item_name: "Laptop", score: 0.95, reason: "DESCRIPTION" }] }), row(3, { suggestions: [] })], 3);
    renderAt();
    expect(await screen.findByRole("heading", { name: "Link existing assets to Items" })).toBeInTheDocument();
    expect(apiClient.getPage).toHaveBeenCalledWith("/assets/unlinked-items?limit=50&offset=0");
    const first = await screen.findByRole("listitem", { name: "FA/CK/1" });
    expect(within(first).getByRole("button", { name: /^Laptop — same ERP code/ })).toHaveTextContent("100%");
    expect(within(first).getByRole("button", { name: /^Gaming Laptop — same group/ })).toBeInTheDocument();
    expect(within(first).getByText("Group: Computers › Laptop")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "FA/CK/2" })).getByRole("button", { name: /Laptop — similar description/ })).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "FA/CK/3" })).getByText("No suggestion.")).toBeInTheDocument();
    expect(screen.getByText("3 assets without an Item")).toBeInTheDocument();
  });

  it("nothing is linked by itself: Use <suggestion> only stages it, and Review asks to confirm in plain words", async () => {
    mockList([row(1), row(2)]);
    (apiClient.post as any).mockResolvedValue({ linked: 2, unchanged: 0, results: [] });
    renderAt();
    const first = await screen.findByRole("listitem", { name: "FA/CK/1" });
    fireEvent.click(within(first).getByRole("button", { name: "Use Laptop" }));
    fireEvent.click(within(screen.getByRole("listitem", { name: "FA/CK/2" })).getByRole("button", { name: /Gaming Laptop — same group/ }));
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(within(screen.getByRole("listitem", { name: "FA/CK/1" })).getByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("2 links ready to confirm.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review and link 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Link 2 assets to Items?" });
    expect(within(dialog).getByText("Link 2 assets to Items. This does not change their group, status or place.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Links to make")).toHaveTextContent("FA/CK/1 → Laptop");
    expect(within(dialog).getByLabelText("Links to make")).toHaveTextContent("FA/CK/2 → Gaming Laptop");
    fireEvent.click(within(dialog).getByRole("button", { name: "Link 2" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/link-items", [
      { asset_id: 1, item_id: 44 }, { asset_id: 2, item_id: 45 },
    ]));
    expect(await screen.findByText("Linked 2 assets to their Items.")).toBeInTheDocument();
  });

  it("S7 P1-2: a double activation of the confirm sends ONE link request, with an Idempotency-Key", async () => {
    mockList([row(1)]);
    const keys: (string | null)[] = [];
    (apiClient.post as any).mockImplementation(() => {
      keys.push(currentIdempotencyKey());
      return new Promise(() => {});
    });
    renderAt();
    const first = await screen.findByRole("listitem", { name: "FA/CK/1" });
    fireEvent.click(within(first).getByRole("button", { name: "Use Laptop" }));
    fireEvent.click(screen.getByRole("button", { name: "Review and link 1" }));
    const dialog = await screen.findByRole("dialog");
    const link = within(dialog).getByRole("button", { name: "Link 1" });
    act(() => {
      link.click();
      link.click();
    });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("Undo takes a staged link back", async () => {
    mockList([row(1)]);
    renderAt();
    const first = await screen.findByRole("listitem", { name: "FA/CK/1" });
    fireEvent.click(within(first).getByRole("button", { name: "Use Laptop" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo FA/CK/1" }));
    expect(screen.queryByText(/links? ready to confirm/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "FA/CK/1" })).getByRole("button", { name: "Use Laptop" })).toBeInTheDocument();
  });

  it("bulk: tick rows -> Link N to their suggested Item (rows without one are left, and said so), confirmed first", async () => {
    mockList([row(1), row(2), row(3, { suggestions: [] })]);
    (apiClient.post as any).mockResolvedValue({ linked: 2, unchanged: 0, results: [] });
    renderAt();
    await screen.findByRole("listitem", { name: "FA/CK/1" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("1 has no suggestion; choose their Item yourself.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Link 2 to their suggested Item" }));
    const dialog = await screen.findByRole("dialog", { name: "Link 2 assets to Items?" });
    expect(apiClient.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Link 2" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/link-items", [
      { asset_id: 1, item_id: 44 }, { asset_id: 2, item_id: 44 },
    ]));
  });

  it("bulk: Link N to one Item… offers only Items of the same asset group, then confirms", async () => {
    mockList([row(1), row(2)]);
    (apiClient.post as any).mockResolvedValue({ linked: 2, unchanged: 0, results: [] });
    renderAt();
    await screen.findByRole("listitem", { name: "FA/CK/1" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FA/CK/1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FA/CK/2" }));
    fireEvent.click(screen.getByRole("button", { name: "Link 2 to one Item…" }));
    const choose = await screen.findByRole("dialog", { name: "Link 2 assets to one Item" });
    expect(within(choose).getByText(/Only Items of the same asset group are offered \(Computers › Laptop\)/)).toBeInTheDocument();
    fireEvent.click(within(choose).getByRole("combobox", { name: "Item" }));
    expect(await screen.findByRole("option", { name: /^Gaming Laptop/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Ceiling Fan/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /^Gaming Laptop/ }));
    fireEvent.click(within(choose).getByRole("button", { name: "Use for 2 assets" }));
    const confirm = await screen.findByRole("dialog", { name: "Link 2 assets to Items?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Link 2" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/link-items", [
      { asset_id: 1, item_id: 45 }, { asset_id: 2, item_id: 45 },
    ]));
  });

  it("Choose another Item… for one row", async () => {
    mockList([row(1, { suggestions: [] })]);
    renderAt();
    const first = await screen.findByRole("listitem", { name: "FA/CK/1" });
    fireEvent.click(within(first).getByRole("button", { name: "Choose another Item…" }));
    const choose = await screen.findByRole("dialog", { name: "Choose the Item for FA/CK/1" });
    fireEvent.click(within(choose).getByRole("combobox", { name: "Item" }));
    fireEvent.click(await screen.findByRole("option", { name: /^Laptop/ }));
    fireEvent.click(within(choose).getByRole("button", { name: "Use this Item" }));
    expect(await screen.findByText("1 link ready to confirm.")).toBeInTheDocument();
  });

  it("a refusal is shown on its row, word for word, and nothing is linked", async () => {
    mockList([row(1), row(2)]);
    (apiClient.post as any).mockRejectedValue(new ApiError("x", 422, {
      detail: "x",
      problems: [{ entry_index: 1, asset_id: 2, item_id: 45, message: "This Item belongs to a different asset group; use Correct Classification first." }],
    }));
    renderAt();
    await screen.findByRole("listitem", { name: "FA/CK/1" });
    fireEvent.click(within(screen.getByRole("listitem", { name: "FA/CK/1" })).getByRole("button", { name: "Use Laptop" }));
    fireEvent.click(within(screen.getByRole("listitem", { name: "FA/CK/2" })).getByRole("button", { name: /Gaming Laptop — same group/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review and link 2" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Link 2" }));
    expect(await screen.findByText("Nothing was linked: 1 problem needs fixing, marked on the rows below.")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "FA/CK/2" })).getByRole("alert"))
      .toHaveTextContent("This Item belongs to a different asset group; use Correct Classification first.");
    // Still staged, to fix or undo.
    expect(screen.getByText("2 links ready to confirm.")).toBeInTheDocument();
  });

  it("searches and pages", async () => {
    mockList([row(1)], 120);
    renderAt();
    await screen.findByRole("listitem", { name: "FA/CK/1" });
    fireEvent.change(screen.getByLabelText("Search unlinked assets"), { target: { value: "cam" } });
    await waitFor(() => expect(apiClient.getPage).toHaveBeenCalledWith("/assets/unlinked-items?q=cam&limit=50&offset=0"));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(apiClient.getPage).toHaveBeenCalledWith("/assets/unlinked-items?q=cam&limit=50&offset=50"));
  });

  it("empty: every asset is linked", async () => {
    mockList([], 0);
    renderAt();
    expect(await screen.findByText("Every asset is linked to an Item.")).toBeInTheDocument();
  });

  it("an ordinary admin may use it (the server allows ADMIN); an operator may not", async () => {
    mockList([], 0);
    loginAs("ADMIN", false);
    renderAt();
    expect(await screen.findByText("Every asset is linked to an Item.")).toBeInTheDocument();
  });

  it("an operator gets no access, and nothing is asked of the server", async () => {
    mockList([], 0);
    loginAs("OPERATOR");
    renderAt();
    expect(await screen.findByText("You don't have access to this area.")).toBeInTheDocument();
    expect(apiClient.getPage).not.toHaveBeenCalled();
  });

  it("helpers: suggestion words and Items of the same group", () => {
    expect(suggestionText({ item_id: 1, item_name: "Laptop", score: 0.4, reason: "GROUP" })).toBe("Laptop — same group");
    const items = ITEMS as unknown as Item[];
    expect(itemsOfGroup(items, [{ category_id: 3, subcategory_id: 7 }]).map((i) => i.id)).toEqual([44, 45]);
    expect(itemsOfGroup(items, [{ category_id: 3, subcategory_id: 7 }, { category_id: 9, subcategory_id: 10 }])).toEqual([]);
  });
});
