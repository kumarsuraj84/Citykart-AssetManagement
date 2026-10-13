import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { ItemFormDialog, SERIAL_MODES, serialFlags, serialModeOf } from "./ItemFormDialog";
import { autoSubcategory, parseTypeValue, typeOfAssetOptions, typeValueFor } from "./type-of-asset";
import type { Item } from "./types";
import type { Capabilities } from "../../lib/capabilities";
import { ADMIN_BOTH, HEAD_OFFICE, KINDS, OPERATOR_IT } from "../../test-capabilities";

vi.mock("../../lib/api-client");

const CATS = [
  { id: 1, code: "ITFA", name: "IT Fixed Assets", asset_domain: "IT" },
  { id: 2, code: "FUR", name: "Furniture", asset_domain: "NON_IT" },
  { id: 3, code: "NET", name: "Network", asset_domain: "IT" },
];
let SUBS: { id: number; category_id: number; code: string; name: string }[] = [];
const BASE_SUBS = [
  { id: 10, category_id: 1, code: "LAP", name: "Laptop" },
  { id: 30, category_id: 3, code: "SW", name: "Switch" },
  { id: 31, category_id: 3, code: "AP", name: "Access Point" },
];

const item = (id: number, name: string, over: Partial<Item> = {}): Item => ({
  id, name, category_id: 1, subcategory_id: 10, serial_required: true, serial_later: false, bundle_id: null,
  default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0, ...over,
});
const ITEMS = [item(101, "CPU"), item(102, "TFT"), item(103, "Desktop", { bundle_id: 7, map_count: 2 })];
const BUNDLES = [{
  id: 7, name: "Desktop Set", is_active: true,
  parts: [
    { id: 71, name: "CPU", item_id: 101, item_name: "CPU", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 70, sort_order: 0 },
    { id: 72, name: "TFT", item_id: 102, item_name: "TFT", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 30, sort_order: 1 },
  ],
}];

// What GET /auth/capabilities answers in the current test (S3b-1).
let CAPS: Capabilities = HEAD_OFFICE;

function mockGets() {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/capabilities") return Promise.resolve(CAPS);
    if (path === "/masters/categories") return Promise.resolve(CATS);
    if (path === "/masters/subcategories") return Promise.resolve(SUBS);
    if (path === "/items") return Promise.resolve(ITEMS);
    if (path === "/bundles") return Promise.resolve(BUNDLES);
    return Promise.resolve([]);
  });
}

function renderForm(props: Partial<React.ComponentProps<typeof ItemFormDialog>> = {}) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ItemFormDialog open onOpenChange={onOpenChange} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onSaved, onOpenChange, dialog: screen.getByRole("dialog", { name: /item/i }) };
}

async function pickType(dialog: HTMLElement, name: RegExp) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: /type of asset/i }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

function loginAs(isPrimaryOwner: boolean, caps: Capabilities = isPrimaryOwner ? HEAD_OFFICE : ADMIN_BOTH) {
  CAPS = caps;
  useAuthStore.getState().setAuth({ accessToken: "tok", role: caps.role, companyId: isPrimaryOwner ? null : 1, isPrimaryOwner, mustChangePassword: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  SUBS = [...BASE_SUBS];
  mockGets();
  loginAs(true);
  (apiClient.post as any).mockImplementation((path: string, body: any) =>
    Promise.resolve(path === "/bundles" ? { id: 77, ...body } : { id: 500, ...body }));
  (apiClient.put as any).mockImplementation((_path: string, body: any) => Promise.resolve({ id: 103, ...body }));
});
afterEach(() => useAuthStore.getState().logout());

describe("Type of asset (one pick for group › Sub-category)", () => {
  it("lists every Sub-category as 'Group › Sub-category' with the group's work area, and a group without one on its own", () => {
    const opts = typeOfAssetOptions(CATS, BASE_SUBS);
    expect(opts.map((o) => [o.value, o.label, o.badge])).toEqual([
      ["c:2", "Furniture", "Admin / Non-IT Team"],
      ["s:10", "IT Fixed Assets › Laptop", "IT Team"],
      ["s:31", "Network › Access Point", "IT Team"],
      ["s:30", "Network › Switch", "IT Team"],
    ]);
    expect(opts[0].detail).toBe("no Sub-category yet");
  });

  it("uses a group's only Sub-category automatically, and never guesses between several", () => {
    expect(autoSubcategory(1, BASE_SUBS)).toBe(10);
    expect(autoSubcategory(3, BASE_SUBS)).toBeNull();
    expect(autoSubcategory(2, BASE_SUBS)).toBeNull();
    expect(typeValueFor(1, null, BASE_SUBS)).toBe("s:10");
    expect(typeValueFor(3, null, BASE_SUBS)).toBe("c:3");
    expect(typeValueFor(3, 31, BASE_SUBS)).toBe("s:31");
    expect(parseTypeValue("s:31")).toEqual({ kind: "sub", id: 31 });
    expect(parseTypeValue("c:2")).toEqual({ kind: "cat", id: 2 });
    expect(parseTypeValue("x")).toBeNull();
  });
});

describe("serial number: three plain choices, stored in the Item's two existing fields", () => {
  it("maps each choice to serial_required / serial_later and back", () => {
    expect(serialFlags("has")).toEqual({ serial_required: true, serial_later: false });
    expect(serialFlags("none")).toEqual({ serial_required: false, serial_later: false });
    expect(serialFlags("later")).toEqual({ serial_required: true, serial_later: true });
    for (const m of SERIAL_MODES) expect(serialModeOf(serialFlags(m.value))).toBe(m.value);
    expect(SERIAL_MODES.map((m) => m.label)).toEqual(["Has serial number", "No serial number", "Serial will be entered later"]);
  });

  it.each([
    ["Has serial number", { serial_required: true, serial_later: false }],
    ["No serial number", { serial_required: false, serial_later: false }],
    ["Serial will be entered later", { serial_required: true, serial_later: true }],
  ])("%s is saved as %o", async (label, flags) => {
    const { dialog } = renderForm();
    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Thing" } });
    await pickType(dialog, /^IT Fixed Assets › Laptop/);
    fireEvent.click(within(dialog).getByRole("radio", { name: label }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/items", {
        name: "Thing", category_id: 1, subcategory_id: 10, ...flags, bundle_id: null,
        default_brand_id: null, default_warranty_years: null,
      }),
    );
  });

  it("starts on 'Has serial number' and needs only a name and a type to save (the brand, warranty and set stay under More)", async () => {
    const { dialog } = renderForm();
    expect(within(dialog).getByRole("radio", { name: "Has serial number" })).toBeChecked();
    expect(within(dialog).queryByLabelText(/default warranty/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^more$/i })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Sub-category is still required by the server, but never asked separately", () => {
  it("an Item stored without a Sub-category gets its group's only one on Save", async () => {
    const { dialog } = renderForm({ item: item(9, "Old Laptop", { subcategory_id: null }) });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: /type of asset/i })).toHaveTextContent("IT Fixed Assets › Laptop"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/items/9", expect.objectContaining({ category_id: 1, subcategory_id: 10 })));
  });

  it("a group with no Sub-category opens New Sub-category for it right away, with the Code suggested", async () => {
    (apiClient.post as any).mockImplementation((path: string, body: any) => {
      if (path === "/masters/subcategories") {
        const created = { id: 60, ...body };
        SUBS.push(created);
        return Promise.resolve(created);
      }
      return Promise.resolve({ id: 500, ...body });
    });
    const { dialog } = renderForm({ initialName: "Office Chair" });
    await pickType(dialog, /^Furniture/);
    const sub = await screen.findByRole("dialog", { name: /new sub-category/i });
    expect(within(sub).getByLabelText(/^category/i)).toHaveTextContent("Furniture");
    fireEvent.change(within(sub).getByLabelText(/^name/i), { target: { value: "Office Chair" } });
    // The Code is made from the name and kept under More (it can still be changed there).
    expect(within(sub).queryByLabelText(/^code/i)).not.toBeInTheDocument();
    fireEvent.click(within(sub).getByRole("button", { name: /^more$/i }));
    expect(within(sub).getByLabelText(/^code/i)).toHaveValue("OC");
    fireEvent.click(within(sub).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/subcategories", { category_id: 2, name: "Office Chair", code: "OC" }));
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: /type of asset/i })).toHaveTextContent("Furniture › Office Chair"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({ category_id: 2, subcategory_id: 60 })));
  });

  it("someone who may not add types of asset (an operator) is not offered New type… and is told whom to ask", async () => {
    loginAs(false, { ...OPERATOR_IT, item_create_work_areas: ["IT", "NON_IT"] });
    const { dialog } = renderForm({ initialName: "Desk" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: /type of asset/i }));
    await screen.findByRole("option", { name: /^Furniture/ });
    expect(screen.queryByRole("option", { name: /new type/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /^Furniture/ }));
    expect(within(dialog).getByRole("note")).toHaveTextContent(/ask the head-office admin/i);
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: /new sub-category/i })).not.toBeInTheDocument();
  });
});

describe("Comes as a set (the Item's own bundle)", () => {
  async function openSet(dialog: HTMLElement) {
    fireEvent.click(within(dialog).getByRole("button", { name: /^more$/i }));
    // Offered once the capabilities say this person may make sets (the head-office admin).
    fireEvent.click(await within(dialog).findByRole("switch", { name: /comes as a set/i }));
  }

  it("saves the set first, then the Item pointing at it", async () => {
    const { dialog, onSaved } = renderForm();
    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Desktop Pro" } });
    await pickType(dialog, /^IT Fixed Assets › Laptop/);
    await openSet(dialog);
    fireEvent.change(within(dialog).getByLabelText("Part name", { selector: "#item-part-name-0" }), { target: { value: "Base" } });
    fireEvent.click(within(dialog).getByLabelText("Item", { selector: "#item-part-item-0" }));
    // A part is a single thing: an Item that is itself a set is never offered.
    await screen.findByRole("option", { name: /^CPU/ });
    expect(screen.queryByRole("option", { name: /^Desktop/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /^CPU/ }));
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();           // share not 100% yet
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#item-part-share-0" }), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = apiClient.post as any;
    expect(post).toHaveBeenCalledWith("/bundles", { name: "Desktop Pro", parts: [{ id: null, name: "Base", item_id: 101, share_percent: 100 }] });
    expect(post).toHaveBeenCalledWith("/items", expect.objectContaining({ name: "Desktop Pro", bundle_id: 77 }));
    const order = post.mock.calls.map((c: unknown[]) => c[0]);
    expect(order.indexOf("/bundles")).toBeLessThan(order.indexOf("/items"));
  });

  it("the Desktop example fills the 70/26/2/2 parts", async () => {
    const { dialog } = renderForm({ initialName: "Desktop Pro" });
    await openSet(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: /use the desktop example/i }));
    expect(within(dialog).getByLabelText("Part name", { selector: "#item-part-name-3" })).toHaveValue("Mouse");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Total 100%");
  });

  it("editing an Item that comes as a set updates the same set (same parts) and keeps the Item on it", async () => {
    const { dialog } = renderForm({ item: ITEMS[2] });
    await waitFor(() => expect(within(dialog).getByLabelText("Part name", { selector: "#item-part-name-1" })).toHaveValue("TFT"));
    expect(within(dialog).getByText(/Parts of the set “Desktop Set”/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#item-part-share-0" }), { target: { value: "75" } });
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#item-part-share-1" }), { target: { value: "25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/bundles/7", {
        name: "Desktop Set",
        parts: [
          { id: 71, name: "CPU", item_id: 101, share_percent: 75 },
          { id: 72, name: "TFT", item_id: 102, share_percent: 25 },
        ],
      }),
    );
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/items/103", expect.objectContaining({ bundle_id: 7 })));
    expect(apiClient.post).not.toHaveBeenCalledWith("/bundles", expect.anything());
  });

  it("an existing set can be used instead of making a new one", async () => {
    const { dialog } = renderForm({ initialName: "Desktop Lite" });
    await pickType(dialog, /^IT Fixed Assets › Laptop/);
    await openSet(dialog);
    fireEvent.click(within(dialog).getByRole("combobox", { name: /set that already exists/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Desktop Set" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Part name", { selector: "#item-part-name-0" })).toHaveValue("CPU"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/bundles/7", expect.objectContaining({ name: "Desktop Set" })));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({ name: "Desktop Lite", bundle_id: 7 })));
  });

  it("if the set saved but the Item did not, says so, and Save again updates that set instead of making a second one", async () => {
    let itemTries = 0;
    (apiClient.post as any).mockImplementation((path: string, body: any) => {
      if (path === "/bundles") return Promise.resolve({ id: 77, ...body });
      if (path === "/items") {
        itemTries += 1;
        return itemTries === 1 ? Promise.reject(new Error("an Item named 'Desktop Pro' already exists")) : Promise.resolve({ id: 500, ...body });
      }
      return Promise.resolve({});
    });
    const { dialog, onSaved } = renderForm({ initialName: "Desktop Pro" });
    await pickType(dialog, /^IT Fixed Assets › Laptop/);
    await openSet(dialog);
    fireEvent.change(within(dialog).getByLabelText("Part name", { selector: "#item-part-name-0" }), { target: { value: "Base" } });
    fireEvent.click(within(dialog).getByLabelText("Item", { selector: "#item-part-item-0" }));
    fireEvent.click(await screen.findByRole("option", { name: /^CPU/ }));
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#item-part-share-0" }), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("The set (its parts) was saved, but the Item was not");
    expect(alert).toHaveTextContent("already exists");
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^item name/i), { target: { value: "Desktop Pro 2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((apiClient.post as any).mock.calls.filter((c: unknown[]) => c[0] === "/bundles")).toHaveLength(1);
    expect(apiClient.put).toHaveBeenCalledWith("/bundles/77", expect.objectContaining({ parts: [expect.objectContaining({ item_id: 101 })] }));
    expect(apiClient.post).toHaveBeenLastCalledWith("/items", expect.objectContaining({ name: "Desktop Pro 2", bundle_id: 77 }));
  });

  it("if the set itself is refused, shows why and saves nothing else", async () => {
    (apiClient.post as any).mockImplementation((path: string) =>
      path === "/bundles" ? Promise.reject(new Error("the shares add up to 90%, they must add up to exactly 100%")) : Promise.resolve({ id: 500 }));
    const { dialog } = renderForm({ initialName: "Desktop Pro" });
    await pickType(dialog, /^IT Fixed Assets › Laptop/);
    await openSet(dialog);
    fireEvent.change(within(dialog).getByLabelText("Part name", { selector: "#item-part-name-0" }), { target: { value: "Base" } });
    fireEvent.click(within(dialog).getByLabelText("Item", { selector: "#item-part-item-0" }));
    fireEvent.click(await screen.findByRole("option", { name: /^CPU/ }));
    fireEvent.change(within(dialog).getByLabelText("Share %", { selector: "#item-part-share-0" }), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Nothing was saved");
    expect(alert).toHaveTextContent("must add up to exactly 100%");
    expect(apiClient.post).not.toHaveBeenCalledWith("/items", expect.anything());
  });

  it("turning the set off unlinks it from the Item (the set itself is kept)", async () => {
    const { dialog } = renderForm({ item: ITEMS[2] });
    await waitFor(() => expect(within(dialog).getByLabelText("Part name", { selector: "#item-part-name-0" })).toHaveValue("CPU"));
    fireEvent.click(within(dialog).getByRole("switch", { name: /comes as a set/i }));
    expect(within(dialog).getByText(/the set itself is kept/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/items/103", expect.objectContaining({ bundle_id: null })));
    expect(apiClient.put).not.toHaveBeenCalledWith("/bundles/7", expect.anything());
    expect(apiClient.delete).not.toHaveBeenCalled();
  });
});

describe("ERP codes under More", () => {
  it("an existing Item shows how many ERP codes point to it and opens its ERP links", async () => {
    const { dialog } = renderForm({ item: ITEMS[2] });
    expect(within(dialog).getByText(/ERP codes:\s*2 linked/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Open ERP links" })).toBeInTheDocument();
    cleanup();
    const fresh = renderForm({ initialName: "New thing" });
    fireEvent.click(within(fresh.dialog).getByRole("button", { name: /^more$/i }));
    expect(within(fresh.dialog).getByText(/link them after saving/i)).toBeInTheDocument();
    expect(within(fresh.dialog).queryByRole("button", { name: "Open ERP links" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S3b-1: the Item form for every kind of login (capabilities endpoint).
// ---------------------------------------------------------------------------
describe("S3b-1: what each kind of login may do in the Item form", () => {
  async function typeOptions(dialog: HTMLElement): Promise<string[]> {
    const trigger = within(dialog).getByRole("combobox", { name: /type of asset/i });
    fireEvent.click(trigger);
    const opts = await screen.findAllByRole("option");
    const names = opts.map((o) => o.textContent ?? "");
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    return names;
  }

  const settle = async () => {
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
  };

  it.each(KINDS)("%s: types only of the work areas they may add Items in; New type… only if they may add types", async (_kind, caps) => {
    loginAs(caps.is_head_office_admin, caps);
    const { dialog } = renderForm({ initialName: "Thing" });
    await settle();
    if (caps.item_create_work_areas.length === 0) {
      fireEvent.click(within(dialog).getByRole("combobox", { name: /type of asset/i }));
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole("option", { name: /›/ })).not.toBeInTheDocument();
      return;
    }
    const names = await typeOptions(dialog);
    expect(names.some((n) => n.startsWith("IT Fixed Assets › Laptop"))).toBe(true);
    expect(names.some((n) => n.startsWith("Furniture"))).toBe(caps.item_create_work_areas.includes("NON_IT"));
    expect(names.some((n) => /new type/i.test(n))).toBe(caps.can_create.sub_category === true);
    if (!caps.can_create.sub_category) {
      expect(within(dialog).getByText(/Ask the head-office admin to add this type of asset\./)).toBeInTheDocument();
    }
    fireEvent.click(within(dialog).getByRole("button", { name: /^more$/i }));
    const brand = within(dialog).getByRole("combobox", { name: /default brand/i });
    fireEvent.click(brand);
    await screen.findAllByRole("option");
    expect(screen.queryByRole("option", { name: /new brand/i }) !== null).toBe(caps.can_create.brand === true);
  });

  it("an operator adds an IT Item (two fields and a choice) and it is saved for the IT type picked", async () => {
    loginAs(false, OPERATOR_IT);
    const { dialog, onSaved } = renderForm({ initialName: "Barcode Scanner" });
    await settle();
    await pickType(dialog, /^Network › Switch/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({
      name: "Barcode Scanner", category_id: 3, subcategory_id: 30,
    })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("the server's work-area refusal stays in the Item form, word for word", async () => {
    loginAs(false, OPERATOR_IT);
    const sentence = "This belongs to the Admin / Non-IT team; you can only work with IT items. Ask someone in the Admin / Non-IT team or the head-office admin.";
    (apiClient.post as any).mockRejectedValue(new Error(sentence));
    const { dialog, onOpenChange } = renderForm({ initialName: "Scanner" });
    await settle();
    await pickType(dialog, /^Network › Switch/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("someone who may not make sets can only point a new Item at an existing set (no set is created or changed)", async () => {
    loginAs(false, ADMIN_BOTH);
    const { dialog } = renderForm({ initialName: "Desktop Basic" });
    await settle();
    await pickType(dialog, /^IT Fixed Assets › Laptop/);
    fireEvent.click(within(dialog).getByRole("button", { name: /^more$/i }));
    fireEvent.click(await within(dialog).findByRole("switch", { name: /comes as a set/i }));
    expect(within(dialog).queryByRole("button", { name: /use the desktop example/i })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/only the head-office admin can make a new set/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("combobox", { name: /the set it comes as/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Desktop Set" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/items", expect.objectContaining({ name: "Desktop Basic", bundle_id: 7 })));
    expect(apiClient.post).not.toHaveBeenCalledWith("/bundles", expect.anything());
    expect(apiClient.put).not.toHaveBeenCalled();
  });
});
