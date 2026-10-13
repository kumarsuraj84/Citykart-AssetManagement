import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act, cleanup } from "@testing-library/react";
import { currentIdempotencyKey } from "../../lib/request-key";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { KINDS, OPERATOR_IT, withCapabilities } from "../../test-capabilities";
import { entryForServerMessage } from "./NewPurchaseOrderForm";

vi.mock("../../lib/api-client");

function renderFormAt(url = "/purchase-orders/new") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, category_id: 1, subcategory_id: 10, serial_required: true, serial_later: false, bundle_id: null,
  default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0, ...over,
});
const ITEMS = [
  item(12, "Laptop", { default_brand_id: 4, default_warranty_years: 3 }),
  item(13, "Office Chair", { category_id: 2, subcategory_id: null, serial_required: false }),
  item(14, "Amplifier", { serial_later: true }),
];
const DESKTOP_SET = {
  id: 5, name: "Desktop", is_active: true,
  parts: [
    { id: 8, name: "CPU", item_id: 1, item_name: "CPU", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 80, sort_order: 0 },
    { id: 9, name: "TFT", item_id: 2, item_name: "TFT", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 20, sort_order: 1 },
  ],
};
const PO_AFTER = { id: 42, company_id: 1, po_number: "PO-1", po_date: "2026-10-13", vendor_id: null, cost_center_id: 3 };

/** A world with one company, two cost centres, Items, a set and a stock room. */
function world({
  companies = [{ id: 1, name: "Citykart Stores" }], caps = OPERATOR_IT as Capabilities | null,
  costCentres1 = [{ id: 3, name: "Head Office" }, { id: 4, name: "Warehouse" }],
} = {}) {
  (apiClient.get as any).mockImplementation(withCapabilities(caps, (path: string) => {
    if (path === "/asset-users/me/companies") return Promise.resolve(companies);
    if (path === "/masters/cost-centers?company_id=1") return Promise.resolve(costCentres1);
    if (path === "/masters/cost-centers?company_id=2") return Promise.resolve([{ id: 30, name: "B Cost Centre" }]);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
    if (path === "/masters/brands") return Promise.resolve([{ id: 4, name: "Dell" }, { id: 6, name: "HP" }]);
    if (path === "/masters/categories") return Promise.resolve([{ id: 1, name: "IT Fixed Assets", asset_domain: "IT" }, { id: 2, name: "Furniture", asset_domain: "NON_IT" }]);
    if (path === "/masters/subcategories") return Promise.resolve([{ id: 10, category_id: 1, name: "Laptops" }]);
    if (path === "/items?work_area=mine") return Promise.resolve(ITEMS);
    if (path === "/bundles") return Promise.resolve([DESKTOP_SET]);
    if (path === "/masters/locations?company_id=1") return Promise.resolve([{ id: 50, name: "Head Office" }]);
    if (path === "/stock-rooms?company_id=1") return Promise.resolve([
      { id: 7, name: "WH Tajnagar Stores", location_name: "Tajnagar", company_code: "CKSPL" },
      { id: 8, name: "HO Stock", location_name: "Head Office", company_code: "CKSPL" },
    ]);
    if (path === "/purchase-orders/42") return Promise.resolve(PO_AFTER);
    return Promise.resolve([]);
  }));
}

async function ready() {
  await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
}

async function pick(label: string | RegExp, option: RegExp) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

async function fillHeader(poNo = "PO-1") {
  fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: poNo } });
  await pick(/^cost centre/i, /^Head Office$/);
}

async function fillLine(n: number, itemName: RegExp, qty: string, cost: string) {
  await pick(`Line ${n} Item`, itemName);
  fireEvent.change(screen.getByLabelText(`Line ${n} Quantity`), { target: { value: qty } });
  fireEvent.change(screen.getByLabelText(`Line ${n} Unit Cost`), { target: { value: cost } });
}

const saveButton = () => screen.getByRole("button", { name: /^save po$/i });
const sentBody = () => (apiClient.post as any).mock.calls.find((c: unknown[]) => c[0] === "/purchase-orders/with-lines")?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5 });
  world();
});
afterEach(() => useAuthStore.getState().logout());

describe("New Purchase Order: one screen (S3b-2)", () => {
  it("Save waits for PO No, Cost Centre and a line, and says what is still needed", async () => {
    renderFormAt();
    await ready();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/Still needed: the PO No, the Cost Centre, at least one line or set\./)).toBeInTheDocument();
    await fillHeader();
    expect(screen.getByText(/Still needed: at least one line or set\./)).toBeInTheDocument();
    await pick("Line 1 Item", /^Laptop/);
    expect(screen.getByText(/Line 1: enter the unit cost\./)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Line 1 Unit Cost"), { target: { value: "55000" } });
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
  });

  it("saves header and lines in ONE call (with-lines), leaving the Item's defaults to the server, then opens the PO with what was made", async () => {
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 2, units_created: 3 });
    const router = renderFormAt();
    await ready();
    await fillHeader();
    await pick(/^vendor$/i, /^Acme Traders/);
    await fillLine(1, /^Laptop/, "2", "55000");
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    await fillLine(2, /^Office Chair/, "1", "4000");
    fireEvent.change(screen.getByLabelText("Line 2 Tax %"), { target: { value: "12" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/with-lines", {
      company_id: 1, po_number: "PO-1", po_date: expect.any(String), vendor_id: 9, cost_center_id: 3,
      lines: [
        { item_id: 12, quantity: 2, purchase_cost: 55000, tax_percent: 18 },
        { item_id: 13, quantity: 1, purchase_cost: 4000, tax_percent: 12 },
      ],
      sets: [],
    }));
    expect(apiClient.post).not.toHaveBeenCalledWith("/purchase-orders", expect.anything());
    await waitFor(() => expect(router.state.location.pathname).toBe("/purchase-orders/42"));
    expect(await screen.findByText("PO created: 2 lines, 3 units waiting.")).toBeInTheDocument();
  });

  it("More details start from the Item (description, default brand and warranty) with read-only chips; only changes are sent", async () => {
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 1, units_created: 1 });
    renderFormAt();
    await ready();
    await fillHeader();
    await fillLine(1, /^Laptop/, "1", "60000");
    fireEvent.click(screen.getByRole("button", { name: "Line 1: more details" }));
    const id = (await screen.findByLabelText("Description")).id;
    expect(screen.getByLabelText("Description")).toHaveValue("Laptop");
    expect(document.getElementById(id.replace("description", "brand"))).toHaveTextContent("Dell");
    expect(document.getElementById(id.replace("description", "warranty"))).toHaveValue(3);
    const chips = screen.getByLabelText("Line 1 from the Item");
    expect(chips).toHaveTextContent("IT Fixed Assets › Laptops");
    expect(chips).toHaveTextContent("IT Team");
    expect(chips).toHaveTextContent("Has serial number");
    expect(screen.getByLabelText("Barcode")).toHaveValue("");             // optional, never required

    fireEvent.change(document.getElementById(id.replace("description", "model"))!, { target: { value: "Latitude 5440" } });
    fireEvent.change(document.getElementById(id.replace("description", "barcode"))!, { target: { value: "BC-1" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(sentBody()).toBeDefined());
    // Description, brand and warranty were left as the Item's: not sent (the server applies them).
    expect(sentBody().lines[0]).toEqual({ item_id: 12, quantity: 1, purchase_cost: 60000, tax_percent: 18, barcode: "BC-1", model: "Latitude 5440" });
  });

  it("a changed description, brand or warranty is sent", async () => {
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 1, units_created: 1 });
    renderFormAt();
    await ready();
    await fillHeader();
    await fillLine(1, /^Laptop/, "1", "60000");
    fireEvent.click(screen.getByRole("button", { name: "Line 1: more details" }));
    const id = (await screen.findByLabelText("Description")).id;
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Laptop for CFO" } });
    await pick(new RegExp(`^Brand$`), /^HP$/);
    fireEvent.change(document.getElementById(id.replace("description", "warranty"))!, { target: { value: "1" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(sentBody()).toBeDefined());
    expect(sentBody().lines[0]).toMatchObject({ description: "Laptop for CFO", brand_id: 6, warranty_years: 1 });
  });

  it("serial mode chips speak plainly (no serial / read later)", async () => {
    renderFormAt();
    await ready();
    await pick("Line 1 Item", /^Office Chair/);
    fireEvent.click(screen.getByRole("button", { name: "Line 1: more details" }));
    expect(await screen.findByLabelText("Line 1 from the Item")).toHaveTextContent("No serial number");
    expect(screen.getByLabelText("Line 1 from the Item")).toHaveTextContent("Admin / Non-IT Team");
    await pick("Line 1 Item", /^Amplifier/);
    expect(screen.getByLabelText("Line 1 from the Item")).toHaveTextContent("Serial will be entered later");
  });

  it("the footer counts lines, units and the value with tax", async () => {
    renderFormAt();
    await ready();
    await fillLine(1, /^Laptop/, "2", "100");
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    await fillLine(2, /^Office Chair/, "3", "10");
    fireEvent.change(screen.getByLabelText("Line 2 Tax %"), { target: { value: "0" } });
    // 2 × 100 × 1.18 + 3 × 10 = 266
    expect(screen.getByLabelText("Purchase order total")).toHaveTextContent("2 lines · 5 units · ₹266.00 with tax");
  });

  it("a set: price per set split over its parts with the shared table, counted as one line per part", async () => {
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 2, units_created: 4 });
    renderFormAt();
    await ready();
    await fillHeader();
    fireEvent.click(screen.getByRole("button", { name: "Remove line 1" }));
    fireEvent.click(screen.getByRole("button", { name: /add set/i }));
    const set = screen.getByLabelText("Set 1");
    fireEvent.click(within(set).getByLabelText(/^set\*?$/i));
    fireEvent.click(await screen.findByRole("option", { name: "Desktop" }));
    fireEvent.change(within(set).getByLabelText(/^quantity/i), { target: { value: "2" } });
    fireEvent.change(within(set).getByLabelText(/^price per set/i), { target: { value: "1000" } });
    expect(screen.getByLabelText("Set 1 amount for CPU")).toHaveValue(800);
    expect(screen.getByLabelText("Set 1 amount for TFT")).toHaveValue(200);
    expect(within(set).getByText(/Desktop: 2 lines, 4 units waiting \(2 of each part\)\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Purchase order total")).toHaveTextContent("2 lines · 4 units · ₹2,360.00 with tax");
    fireEvent.change(screen.getByLabelText("Set 1 amount for CPU"), { target: { value: "700" } });
    expect(screen.getByText(/Set 1: the part amounts must add up to 1,000\.00\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Set 1 amount for TFT"), { target: { value: "300" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(sentBody()).toBeDefined());
    expect(sentBody()).toMatchObject({
      lines: [],
      sets: [{ bundle_id: 5, quantity: 2, price_per_set: 1000, tax_percent: 18, part_amounts: [{ part_id: 8, amount: 700 }, { part_id: 9, amount: 300 }] }],
    });
  });

  it("a refusal that names a line marks that line, keeps everything typed, and says so at the bottom", async () => {
    (apiClient.post as any).mockRejectedValue(new Error("Line 2: The Item Office Chair is no longer active; choose another."));
    renderFormAt();
    await ready();
    await fillHeader("PO-77");
    await fillLine(1, /^Laptop/, "2", "55000");
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    await fillLine(2, /^Office Chair/, "1", "4000");
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert", { name: "Line 2 refused" })).toHaveTextContent("Line 2: The Item Office Chair is no longer active; choose another.");
    expect(screen.queryByRole("alert", { name: "Line 1 refused" })).not.toBeInTheDocument();
    expect(screen.getByText(/The purchase order was not created\. Fix the line marked in red above/)).toBeInTheDocument();
    expect(screen.getByLabelText(/po no/i)).toHaveValue("PO-77");
    expect(screen.getByLabelText("Line 1 Unit Cost")).toHaveValue(55000);
    expect(screen.getByLabelText("Line 2 Item")).toHaveTextContent("Office Chair");
  });

  it("a header refusal is shown once, as the server wrote it", async () => {
    (apiClient.post as any).mockRejectedValue(new Error("PO number PO-1 is already used in this company."));
    renderFormAt();
    await ready();
    await fillHeader();
    await fillLine(1, /^Laptop/, "1", "1");
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("PO number PO-1 is already used in this company.");
  });

  it("Enter in a line's cost or tax adds the next line and moves to its Item", async () => {
    renderFormAt();
    await ready();
    await fillLine(1, /^Laptop/, "1", "100");
    // The picker hands focus back to its button when it closes; a person is then typing in the cost box.
    await new Promise((r) => setTimeout(r, 30));
    screen.getByLabelText("Line 1 Unit Cost").focus();
    fireEvent.keyDown(screen.getByLabelText("Line 1 Unit Cost"), { key: "Enter" });
    const next = await screen.findByLabelText("Line 2 Item");
    await waitFor(() => expect(document.activeElement).toBe(next));
    fireEvent.keyDown(screen.getByLabelText("Line 2 Tax %"), { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("Line 3 Item")).toBeInTheDocument());
    // From an earlier line, Enter just moves on (no extra line).
    fireEvent.keyDown(screen.getByLabelText("Line 1 Tax %"), { key: "Enter" });
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Line 2 Item"));
    expect(screen.queryByLabelText("Line 4 Item")).not.toBeInTheDocument();
  });

  it("lines nobody started are left out of the PO", async () => {
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 1, units_created: 1 });
    renderFormAt();
    await ready();
    await fillHeader();
    await fillLine(1, /^Laptop/, "1", "100");
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(sentBody()).toBeDefined());
    expect(sentBody().lines).toHaveLength(1);
  });

  it("the server's line words are read from the start of its sentence", () => {
    expect(entryForServerMessage("Line 2: The brand Gone Brand is no longer active; choose another.")).toEqual({ kind: "line", index: 1 });
    expect(entryForServerMessage("Set 1: The set you chose does not exist or is no longer active.")).toEqual({ kind: "set", index: 0 });
    expect(entryForServerMessage("PO number already used")).toBeNull();
  });

  it("AM-24: shows a Company picker when the caller has access to more than one, and submits the chosen company", async () => {
    world({ companies: [{ id: 1, name: "Company A" }, { id: 2, name: "Company B" }] });
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 1, units_created: 1 });
    renderFormAt();
    await ready();
    await waitFor(() => expect(screen.getByLabelText(/^company/i)).toBeInTheDocument());
    await pick(/^company/i, /^Company B$/);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/cost-centers?company_id=2"));
    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    await pick(/^cost centre/i, /^B Cost Centre$/);
    await fillLine(1, /^Laptop/, "1", "1");
    fireEvent.click(saveButton());
    await waitFor(() => expect(sentBody()).toMatchObject({ company_id: 2, cost_center_id: 30 }));
  });

  it("a single company is not asked for", async () => {
    renderFormAt();
    await ready();
    expect(screen.queryByLabelText(/^company/i)).not.toBeInTheDocument();
  });
});

// S3b-1 (kept): Vendor, Cost Centre, the Received Into stock room and the Item can be added right here.
describe("S3b-1: inline creation on New Purchase Order", () => {
  it.each(KINDS)("%s: New Vendor / New Cost Centre / New Stock Room / New Item follow the capabilities", async (_kind, caps) => {
    world({ caps });
    renderFormAt();
    await ready();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    const checks: [string | RegExp, RegExp, boolean][] = [
      [/^vendor$/i, /new vendor/i, caps.can_create.vendor === true],
      [/^cost centre/i, /new cost centre/i, caps.can_create.cost_centre === true],
      [/^received into$/i, /new stock room/i, caps.can_create.stock_room === true],
      ["Line 1 Item", /new item/i, caps.can_create.item === true],
    ];
    for (const [label, entry, allowed] of checks) {
      const trigger = screen.getByLabelText(label);
      fireEvent.click(trigger);
      await screen.findAllByRole("option");
      if (allowed) expect(await screen.findByRole("option", { name: entry })).toBeInTheDocument();
      else expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument();
      fireEvent.click(trigger);
      await waitFor(() => expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument());
    }
  });

  it("a new Cost Centre is made for the PO's company (no code) and picked", async () => {
    (apiClient.post as any).mockImplementation((_path: string, body: { name: string }) => Promise.resolve({ id: 44, ...body }));
    renderFormAt();
    await ready();
    fireEvent.click(screen.getByLabelText(/^cost centre/i));
    fireEvent.click(await screen.findByRole("option", { name: /new cost centre/i }));
    const dialog = await screen.findByRole("dialog", { name: /new cost centre/i });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Farukhnagar W/H" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/cost-centers", { company_id: 1, name: "Farukhnagar W/H" }));
  });

  it("Received Into lists stock rooms as \"Name · Place · Company code\"", async () => {
    renderFormAt();
    await ready();
    fireEvent.click(screen.getByLabelText(/^received into$/i));
    expect(await screen.findByRole("option", { name: /^HO Stock\s?· Head Office · CKSPL$/ })).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/asset-users\?company_id=/));
  });

  it("starts with the Cost Centre and stock room this person used last for this company, and remembers them after saving", async () => {
    window.localStorage.setItem("ckam:last-used:5:1", JSON.stringify({ cost_centre: "3", stock_room: "8" }));
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 1, units_created: 1 });
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/^cost centre/i)).toHaveTextContent("Head Office"));
    await waitFor(() => expect(screen.getByLabelText(/^received into$/i)).toHaveTextContent("HO Stock"));
    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-9" } });
    await fillLine(1, /^Laptop/, "1", "1");
    fireEvent.click(saveButton());
    await waitFor(() => expect(sentBody()).toMatchObject({ cost_center_id: 3, delivery_asset_user_id: 8 }));
  });

  it("without a stock room nothing about it is sent", async () => {
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 1, units_created: 1 });
    renderFormAt();
    await ready();
    await fillHeader();
    await fillLine(1, /^Laptop/, "1", "1");
    fireEvent.click(saveButton());
    await waitFor(() => expect(sentBody()).toBeDefined());
    expect(sentBody()).not.toHaveProperty("delivery_asset_user_id");
  });
});

describe("S7 fixes on New Purchase Order", () => {
  it("P1-2: a double activation of Save sends ONE request, with an Idempotency-Key", async () => {
    const keys: (string | null)[] = [];
    (apiClient.post as any).mockImplementation(() => {
      keys.push(currentIdempotencyKey());
      return new Promise(() => {});
    });
    renderFormAt();
    await ready();
    await fillHeader();
    await fillLine(1, /^Laptop/, "1", "100");
    const button = saveButton();
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("P3-13: a company with exactly one Cost Centre has it chosen already", async () => {
    world({ costCentres1: [{ id: 3, name: "Head Office" }] });
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/^cost centre/i)).toHaveTextContent("Head Office"));
    expect(screen.getByText(/Still needed: the PO No, at least one line or set\./)).toBeInTheDocument();
  });

  it("P2-1: the vendor name typed in the picker starts the New Vendor dialog", async () => {
    world({ caps: { ...OPERATOR_IT, can_create: { ...OPERATOR_IT.can_create, vendor: true } } });
    renderFormAt();
    await ready();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getByLabelText(/^vendor$/i));
    fireEvent.change(await screen.findByPlaceholderText("Search…"), { target: { value: "ABC Traders" } });
    expect(await screen.findByText("No results found.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /New Vendor…/ }));
    const dialog = await screen.findByRole("dialog", { name: /new vendor/i });
    expect(within(dialog).getByLabelText(/^name/i)).toHaveValue("ABC Traders");
  });

  it("P2-6: the line Item picker lists only the Items of this person's work areas", async () => {
    renderFormAt();
    await ready();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/items?work_area=mine"));
    expect(apiClient.get).not.toHaveBeenCalledWith("/items");
  });

  it("P2-12: what is typed is kept for a reload of this tab, and comes back with a way to start again", async () => {
    renderFormAt();
    await ready();
    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-DRAFT" } });
    await fillLine(1, /^Laptop/, "3", "1500");
    await waitFor(() => expect(window.sessionStorage.getItem("ckam:manual-po-draft")).toContain("PO-DRAFT"));
    cleanup();
    renderFormAt();
    await ready();
    expect(screen.getByLabelText(/po no/i)).toHaveValue("PO-DRAFT");
    expect(screen.getByLabelText("Line 1 Quantity")).toHaveValue(3);
    expect(screen.getByLabelText("Line 1 Unit Cost")).toHaveValue(1500);
    expect(screen.getByText(/The purchase order you were typing before the page reloaded is back\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(screen.getByLabelText(/po no/i)).toHaveValue("");
    await waitFor(() => expect(window.sessionStorage.getItem("ckam:manual-po-draft")).toBeNull());
  });

  it("P2-12: the draft is cleared once the PO is saved", async () => {
    (apiClient.post as any).mockResolvedValue({ ...PO_AFTER, lines_created: 1, units_created: 1 });
    const router = renderFormAt();
    await ready();
    await fillHeader();
    await fillLine(1, /^Laptop/, "1", "100");
    await waitFor(() => expect(window.sessionStorage.getItem("ckam:manual-po-draft")).not.toBeNull());
    fireEvent.click(saveButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/purchase-orders/42"));
    expect(window.sessionStorage.getItem("ckam:manual-po-draft")).toBeNull();
  });

  it("P2-12: leaving a typed PO asks first (beforeunload and in-app navigation)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = renderFormAt();
    await ready();
    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-5" } });
    await new Promise((r) => setTimeout(r, 0));
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    act(() => { void router.navigate({ to: "/purchase-orders" }); });
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(router.state.location.pathname).toBe("/purchase-orders/new");
    confirm.mockRestore();
  });

  it("P2-4: lines are cards on a narrow screen -- no table that scrolls sideways", async () => {
    renderFormAt();
    await ready();
    const lines = screen.getByRole("region", { name: "Lines" });
    expect(lines.querySelector("table")).toBeNull();
    expect(lines.querySelector(".overflow-x-auto")).toBeNull();
    expect(within(lines).getByRole("group", { name: "Line 1" })).toBeInTheDocument();
  });
});
