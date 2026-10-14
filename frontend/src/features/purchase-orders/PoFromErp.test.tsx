import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { currentIdempotencyKey } from "../../lib/request-key";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Draft, DraftLine } from "./PoDraftCard";
import type { Capabilities } from "../../lib/capabilities";
import { ADMIN_BOTH, HEAD_OFFICE, KINDS, OPERATOR_IT, withCapabilities } from "../../test-capabilities";
import { erpPosPath } from "./PoFromErp";

vi.mock("../../lib/api-client");

const DESKTOP_BUNDLE = {
  id: 1, name: "Desktop", is_active: true,
  parts: [
    { id: 11, name: "CPU", category_id: 1, subcategory_id: 10, serial_required: true, share_percent: 70, sort_order: 0 },
    { id: 12, name: "TFT", category_id: 2, subcategory_id: 20, serial_required: true, share_percent: 26, sort_order: 1 },
    { id: 13, name: "Keyboard", category_id: 3, subcategory_id: 30, serial_required: false, share_percent: 2, sort_order: 2 },
    { id: 14, name: "Mouse", category_id: 3, subcategory_id: 31, serial_required: false, share_percent: 2, sort_order: 3 },
  ],
};

const item = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, category_id: 1, subcategory_id: 10, serial_required: true, bundle_id: null, default_brand_id: null,
  default_warranty_years: null, is_active: true, map_count: 1, ...over,
});
const ITEMS = [item(1, "Desktop", { bundle_id: 1 }), item(2, "Cable"), item(3, "Network Switch")];

const ROW = {
  po_code: 1133610106, po_number: "SPO/012994/26-27", po_date: "2026-09-18", company_id: 1, company_code: "CKSPL",
  delivery_location: "CKSPL-WH-TAJNAGAR", vendor_id: 7, vendor_name: "Vansh Enterprises", line_count: 1, net_amount: 165200,
  erp_vendor_code: "11338", erp_vendor_name: "VANSH ENTERPRISES", vendor_linked: true, undecided_item_count: 0,
  readiness: "READY", problems: [],
};
const UNMATCHED_ROW = {
  ...ROW, po_code: 5001, po_number: "SPO/BS/5001", vendor_id: null, vendor_name: "BLUE STAR LTD (MP)", erp_vendor_code: "BS2",
  erp_vendor_name: "BLUE STAR LTD (MP)", vendor_linked: false, undecided_item_count: 2, readiness: "NEEDS_INPUT",
  problems: [{ kind: "VENDOR_UNMATCHED", message: "Vendor needs matching." }, { kind: "ITEMS_UNDECIDED", count: 2, message: "2 items need a decision." }],
};
const FRESH = { configured: true, copied: true, available: true, data_as_of_text: "13-10-2026 11:14 am", refresh_failed: false, message: null };

function line(over: Partial<DraftLine> = {}): DraftLine {
  return {
    item_code: "CT324973", description: "DELL DESKTOP REFURB/i3", barcode: "CT324973", quantity: 7, rate: 20000, amount: 140000,
    tax_percent: 18, hsn: "84732900", warranty_years: 1, brand_id: null, model: null,
    item_id: 1, item_name: "Desktop", matched_by: "ARTICLE", category_name: "Computers", subcategory_name: "CPU",
    bundle_id: 1, bundle_name: "Desktop", erp_description: "DELL DESKTOP REFURB/i3 · HARSHIT INFOSOLUTION", erp_name: "DELL DESKTOP REFURB/i3",
    article_key: "02-I3 CORE[IT-01]", article_name: "02-I3 CORE[IT-01]", section: "IT EQUIPMENTS", department: "FA_CE_DESKTOP",
    name_key: "dell desktop refurb i3", warnings: [],
    resolution: { state: "MATCHED", item_id: 1, item_name: "Desktop", via: "ARTICLE" },
    suggested_item_id: null, suggested_item_name: null, suggestion_score: null, suggested_scope: "ARTICLE", ...over,
  };
}

/** A line whose ERP code has no Item yet (an exception), with the server's suggestion. */
function switchLine(over: Partial<DraftLine> = {}): DraftLine {
  return line({
    item_code: "CT500001", description: "48 PORT SWITCH", barcode: "CT500001", quantity: 2, rate: 9000, item_id: null, item_name: null,
    matched_by: null, category_name: null, subcategory_name: null, bundle_id: null, bundle_name: null, erp_description: "48 PORT SWITCH · BLUE STAR",
    erp_name: "48 PORT SWITCH", article_key: "FA_IT_OTHERS", article_name: "FA_IT_OTHERS", department: "FA_IT_OTHERS", name_key: "48 port switch",
    warnings: [], resolution: { state: "NEEDS_ITEM", item_id: null, item_name: null, via: null },
    suggested_item_id: 3, suggested_item_name: "Network Switch", suggestion_score: 0.5, suggested_scope: "NAME", ...over,
  });
}

function draft(over: Partial<Draft> = {}, lines: DraftLine[] = [line()]): Draft {
  return {
    erp_po_code: 1133610106, po_number: "SPO/012994/26-27", po_date: "2026-09-18", company_id: 1, company_code: "CKSPL",
    company_name: "CITYKART STORES PVT. LTD.", cost_center_id: 5, vendor_id: 7, vendor_name: "VANSH ENTERPRISES",
    warehouse_code: "CKSPL-WH-TAJNAGAR", warehouse: "WH-TAJNAGAR", delivery_asset_user_id: 9,
    delivery_candidates: [{ id: 9, name: "WH Tajnagar Stores" }], already_created_id: null, status: "OPEN", warnings: [], lines,
    vendor: { id: 7, name: "Vansh Enterprises" }, vendor_linked: true, erp_vendor: { code: "11338", name: "VANSH ENTERPRISES", gstin: null },
    vendor_suggestions: [], vendor_registrations: [], ...over,
  };
}

/** The draft of a PO whose ERP supplier is not matched to a vendor yet. */
const unmatchedDraft = (lines: DraftLine[] = [line()]) => draft({
  vendor_id: null, vendor: null, vendor_linked: false, vendor_name: "BLUE STAR LTD (MP)",
  erp_vendor: { code: "BS2", name: "BLUE STAR LTD (MP)", gstin: "23AAACB4487D1Z0", pan: "AAACB4487D", group_key: "CKSPL:AAACB4487D" },
  vendor_suggestions: [{ vendor_id: 31, name: "Blue Star Limited", gstin: null, reason: "PAN" }, { vendor_id: 32, name: "Blue Star MP Office", gstin: "23AAACB4487D1Z0", reason: "GSTIN" }],
  vendor_registrations: [
    { erp_code: "BS1", name: "BLUE STAR LIMITED", gstin: "09AAACB4487D1Z0", linked: true, linked_vendor_id: 31, linked_vendor_name: "Blue Star Limited" },
    { erp_code: "BS2", name: "BLUE STAR LTD (MP)", gstin: "23AAACB4487D1Z0", linked: false, linked_vendor_id: null, linked_vendor_name: null },
    { erp_code: "BS3", name: "Blue Star Limited-KOLKATA", gstin: "19AAACB4487D1ZX", linked: false, linked_vendor_id: null, linked_vendor_name: null },
  ],
}, lines);

interface MockOpts {
  configured?: boolean;
  rows?: unknown[];
  posError?: Error | null;
  d?: Draft;
  freshness?: Record<string, unknown>;
  counts?: Record<string, number>;
  companies?: { id: number; name: string }[];
}

function mockApi({ configured = true, rows = [ROW] as unknown[], posError = null, d = draft(), freshness = FRESH, counts, companies = [{ id: 1, name: "Citykart Stores Pvt Ltd" }] }: MockOpts = {}) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/capabilities") return Promise.resolve(useAuthStore.getState().isPrimaryOwner ? HEAD_OFFICE : ADMIN_BOTH);
    if (path.startsWith("/stock-rooms?company_id=")) {
      return Promise.resolve([{ id: 9, name: "WH Tajnagar Stores", asset_user_type: "STOCK_POINT", location_name: "WH-TAJNAGAR", company_code: "CKSPL" }]);
    }
    if (path === "/erp/status") return Promise.resolve({ configured });
    if (path.startsWith("/erp/pos?")) {
      if (posError) return Promise.reject(posError);
      const ready = rows.filter((r: any) => r.readiness === "READY").length;
      return Promise.resolve({
        pos: rows, freshness,
        counts: counts ?? { all: rows.length, ready, needs_input: rows.length - ready },
      });
    }
    if (path.startsWith("/erp/pos/") && path.endsWith("/draft")) return Promise.resolve(d);
    if (path === "/bundles") return Promise.resolve([DESKTOP_BUNDLE]);
    if (path === "/items?work_area=mine") return Promise.resolve(ITEMS);
    if (path === "/asset-users/me/companies") return Promise.resolve(companies);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 7, name: "Vansh Enterprises" }, { id: 31, name: "Blue Star Limited" }, { id: 40, name: "Jagannath Enterprises" }]);
    if (path === "/masters/categories") return Promise.resolve([{ id: 1, name: "Computers" }]);
    if (path === "/masters/subcategories") return Promise.resolve([{ id: 10, category_id: 1, name: "CPU" }]);
    if (path === "/masters/brands") return Promise.resolve([{ id: 4, name: "Dell" }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 5, name: "CKSPL" }]);
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockImplementation((path: string) => {
    if (path === "/erp/pos/create") return Promise.resolve({ po_id: 42, po_number: "SPO/012994/26-27", lines_created: 4, units_created: 28 });
    return Promise.resolve({});
  });
}

function renderScreen(path = "/purchase-orders/from-erp") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

async function openDraft(poNumber = "SPO/012994/26-27") {
  fireEvent.click(await screen.findByRole("button", { name: `Review ${poNumber}` }));
  return await screen.findByRole("button", { name: /create this purchase order/i });
}

// An option reads "label" or "label · detail" (Items show their Category › Sub-category).
async function choose(trigger: HTMLElement, name: string) {
  fireEvent.click(trigger);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${escaped}( ?· .*)?$`) }));
}
const byId = (id: string) => document.getElementById(id)!;
const posted = (path: string) => (apiClient.post as any).mock.calls.find((c: unknown[]) => c[0] === path)?.[1];
const ID = "SPO/012994/26-27-line-0";

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5 });
});
afterEach(() => useAuthStore.getState().logout());

// ---------------------------------------------------------------------------
// The picker: every open ERP PO, with a plain readiness.
// ---------------------------------------------------------------------------
describe("Pick from ERP: every open PO, nothing hidden", () => {
  it("lists ready and needs-input POs (an unmatched supplier's PO too) with the server's sentences and counts", async () => {
    mockApi({ rows: [ROW, UNMATCHED_ROW] });
    renderScreen();
    expect(await screen.findByText("SPO/012994/26-27")).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/pos?envelope=true"));
    const unmatched = screen.getByText("SPO/BS/5001").closest("tr")!;
    expect(within(unmatched).getByText("Needs your input")).toBeInTheDocument();
    expect(within(unmatched).getByText("Vendor needs matching. 2 items need a decision.")).toBeInTheDocument();
    expect(within(unmatched).getByText("(ERP supplier)")).toBeInTheDocument();
    expect(within(unmatched).getByRole("button", { name: "Review SPO/BS/5001" })).not.toBeDisabled();
    expect(within(screen.getByText("SPO/012994/26-27").closest("tr")!).getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Ready (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs your input (1)" })).toBeInTheDocument();
  });

  it("the readiness chips ask the server for that list", async () => {
    mockApi({ rows: [ROW, UNMATCHED_ROW] });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Needs your input (1)" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/pos?envelope=true&readiness=NEEDS_INPUT"));
    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/pos?envelope=true&readiness=READY"));
  });

  it("searches on the server (PO No, ERP supplier or vendor), after typing stops", async () => {
    mockApi({ rows: [ROW] });
    renderScreen();
    await screen.findByText("SPO/012994/26-27");
    fireEvent.change(screen.getByLabelText("Search ERP purchase orders"), { target: { value: "blue star" } });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/pos?envelope=true&q=blue+star"));
  });

  it("filters by company when the person works in more than one", async () => {
    mockApi({ companies: [{ id: 1, name: "Citykart Stores" }, { id: 2, name: "Citykart Ventures" }] });
    renderScreen();
    await screen.findByText("SPO/012994/26-27");
    await choose(screen.getByRole("combobox", { name: "Company" }), "Citykart Ventures");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/pos?envelope=true&company_id=2"));
  });

  it("says when the ERP data is from, and calmly when it could not refresh (never blocking)", async () => {
    mockApi();
    renderScreen();
    expect(await screen.findByLabelText("ERP data freshness")).toHaveTextContent("ERP data as of 13-10-2026 11:14 am");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed refresh is one calm line, and the list still works", async () => {
    mockApi({ freshness: { ...FRESH, refresh_failed: true, message: "ERP data could not refresh. Using data from 13-10-2026 11:14 am." } });
    renderScreen();
    const line = await screen.findByLabelText("ERP data freshness");
    expect(line).toHaveTextContent("ERP data could not refresh. Using data from 13-10-2026 11:14 am.");
    expect(line).not.toHaveAttribute("role", "alert");
    expect(await screen.findByRole("button", { name: "Review SPO/012994/26-27" })).toBeInTheDocument();
  });

  it("an ERP that cannot be read gives its sentence and an empty list, not an error", async () => {
    mockApi({ rows: [], freshness: { configured: true, available: false, message: "ERP data could not be read. The ERP database is down." } });
    renderScreen();
    expect(await screen.findByText("ERP data could not be read. The ERP database is down.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("builds the list address from the filters", () => {
    expect(erpPosPath({ readiness: "ALL", q: "", companyId: "" })).toBe("/erp/pos?envelope=true");
    expect(erpPosPath({ readiness: "NEEDS_INPUT", q: " SPO/1 ", companyId: "2" })).toBe("/erp/pos?envelope=true&readiness=NEEDS_INPUT&q=SPO%2F1&company_id=2");
  });

  it("says so when the ERP connection is not set up", async () => {
    mockApi({ configured: false });
    renderScreen();
    expect(await screen.findByText("The ERP connection is not set up on this server.")).toBeInTheDocument();
    expect(screen.getByText("Ask the head-office admin.")).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/erp\/pos\?/));
  });

  it("shows the server's own message when the ERP cannot be reached", async () => {
    mockApi({ posError: new Error("The ERP database could not be reached (OSError).") });
    renderScreen();
    expect(await screen.findByText(/could not be reached/)).toBeInTheDocument();
  });

  it("explains an empty list", async () => {
    mockApi({ rows: [] });
    renderScreen();
    expect(await screen.findByText("No open purchase orders to bring in.")).toBeInTheDocument();
  });

  it("shows what a PO has beyond the lines CKAM tracks", async () => {
    mockApi({ rows: [{ ...ROW, tracked_line_count: 1, untracked_line_count: 3 }] });
    renderScreen();
    expect(await screen.findByText("1 (+3 not tracked)")).toBeInTheDocument();
  });

  it("the Purchase Orders list links to this screen", async () => {
    mockApi();
    renderScreen("/purchase-orders");
    expect(await screen.findByRole("link", { name: "Pick from ERP" })).toHaveAttribute("href", "/purchase-orders/from-erp");
  });
});

// ---------------------------------------------------------------------------
// The review: exceptions only.
// ---------------------------------------------------------------------------
describe("ERP review: matched lines folded, exceptions open", () => {
  it("a matched line is one tidy row; Details opens its fields; the header is one summary with Change", async () => {
    mockApi();
    renderScreen();
    await openDraft();
    const row = screen.getByLabelText("Line 1");
    expect(within(row).getByText("Desktop")).toBeInTheDocument();
    expect(within(row).getByText("7 × 20,000.00")).toBeInTheDocument();
    expect(within(row).getByText("matched by ERP group")).toBeInTheDocument();
    expect(within(row).getByText(/Set: 4 lines, 28 units waiting/)).toBeInTheDocument();
    expect(byId(`${ID}-quantity`)).toBeNull();
    expect(screen.queryByLabelText(/^remember$/i)).not.toBeInTheDocument();

    const summary = screen.getByLabelText("Purchase order summary");
    expect(summary).toHaveTextContent("SPO/012994/26-27 · 2026-09-18");
    expect(summary).toHaveTextContent("CITYKART STORES PVT. LTD.");
    expect(summary).toHaveTextContent("₹1,40,000.00");
    await waitFor(() => expect(summary).toHaveTextContent("Vansh Enterprises"));
    await waitFor(() => expect(summary).toHaveTextContent("WH Tajnagar Stores"));
    expect(screen.getByLabelText("What is left")).toHaveTextContent("Everything is ready: check and create the PO.");

    fireEvent.click(within(row).getByRole("button", { name: "Line 1: details" }));
    expect(byId(`${ID}-quantity`)).toHaveValue(7);
    expect(screen.getByText(/Desktop is a set: becomes 4 lines, 28 units \(7 of each part\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Line 1 amount for CPU")).toHaveValue(14000);
    expect(byId(`${ID}-item`)).toHaveTextContent("Desktop");

    expect(screen.queryByLabelText(/^po no/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText(/^po no/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^po date/i)).toHaveAttribute("readonly");
  });

  it("creates the PO for an unchanged matched line without a new rule and with the vendor already linked", async () => {
    mockApi();
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/pos/create", {
        erp_po_code: 1133610106, company_id: 1, po_number: "SPO/012994/26-27", po_date: "2026-09-18", vendor_id: 7, cost_center_id: 5,
        delivery_asset_user_id: 9, warehouse_code: "CKSPL-WH-TAJNAGAR",
        lines: [{
          item_code: "CT324973", description: "DELL DESKTOP REFURB/i3", barcode: "CT324973", quantity: 7, rate: 20000, tax_percent: 18,
          warranty_years: 1, item_id: 1, brand_id: null, model: null,
          bundle_parts: [{ part_id: 11, amount: 14000 }, { part_id: 12, amount: 5200 }, { part_id: 13, amount: 400 }, { part_id: 14, amount: 400 }],
          remember: false, map_scope: null, article_key: null, article_name: null, section: null, department: null, name_key: null,
        }],
      }),
    );
    expect(posted("/erp/pos/create")).not.toHaveProperty("vendor_choice");
    expect(await screen.findByRole("link", { name: "Open SPO/012994/26-27" })).toHaveAttribute("href", "/purchase-orders/42");
    expect(screen.getByText(/PO created: 4 lines, 28 units waiting\./)).toBeInTheDocument();
  });

  it("S4: the created banner uses the server's lines_created (lines) and units_created (units)", async () => {
    mockApi();
    (apiClient.post as any).mockImplementation((path: string) =>
      Promise.resolve(path === "/erp/pos/create" ? { po_id: 42, po_number: "SPO/012994/26-27", lines_created: 5, units_created: 30 } : {}));
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    expect(await screen.findByText(/PO created: 5 lines, 30 units waiting\./)).toBeInTheDocument();
  });

  it("S4: an older server (lines_created only, holding the units) still reads right: lines from the draft", async () => {
    mockApi();
    (apiClient.post as any).mockImplementation((path: string) =>
      Promise.resolve(path === "/erp/pos/create" ? { po_id: 42, po_number: "SPO/012994/26-27", lines_created: 28 } : {}));
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    expect(await screen.findByText(/PO created: 4 lines, 28 units waiting\./)).toBeInTheDocument();
  });

  it("an exception line is open: ERP words, the suggestion in one click, Remember defaulting to the server's reach", async () => {
    mockApi({ d: draft({}, [line(), switchLine()]) });
    renderScreen();
    const create = await openDraft();
    const row = screen.getByLabelText("Line 2");
    expect(within(row).getByText("Needs an Item")).toBeInTheDocument();
    expect(within(row).getByText(/48 PORT SWITCH · BLUE STAR/)).toBeInTheDocument();
    expect(within(row).getByText(/IT EQUIPMENTS › FA_IT_OTHERS › FA_IT_OTHERS/)).toBeInTheDocument();
    // S7 P1-3: honest words, never "% match".
    expect(within(row).getByText(/Similar name \(50%\)/)).toBeInTheDocument();
    expect(within(row).queryByText(/% match/)).not.toBeInTheDocument();
    expect(within(row).getByLabelText(/^remember$/i)).toHaveTextContent("Use this Item for this product name");
    // The matched line stays folded.
    expect(within(screen.getByLabelText("Line 1")).queryByLabelText(/^remember$/i)).not.toBeInTheDocument();

    expect(screen.getByLabelText("What is left")).toHaveTextContent("1 line needs an Item, then you can create the PO.");
    expect(create).toBeDisabled();
    expect(screen.getByText("Create is not available yet: 1 line needs an Item.")).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: /use the suggestion network switch/i }));
    // S7 fix 2 (N1): only a similar name -> asked first, naming the Item, the product name and the reach
    const ask = await screen.findByRole("alertdialog", { name: "Use the suggestion?" });
    expect(ask).toHaveTextContent("Use Network Switch for every code named “48 PORT SWITCH”? This is remembered for everyone.");
    fireEvent.click(within(ask).getByRole("button", { name: "Use it" }));
    await waitFor(() => expect(create).not.toBeDisabled());
    expect(within(row).getByText("Item chosen")).toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    // The suggested reach is the server's default: remember, no explicit scope.
    expect(posted("/erp/pos/create").lines[1]).toMatchObject({ item_code: "CT500001", item_id: 3, remember: true, map_scope: null });
  });

  it("Remember can be narrowed to this code only, widened to the ERP group, or switched off", async () => {
    mockApi({ d: draft({}, [switchLine()]) });
    // Refused each time, so the review stays open and the next choice can be sent too.
    (apiClient.post as any).mockRejectedValue(new Error("no"));
    renderScreen();
    const create = await openDraft();
    await choose(byId(`${ID}-item`), "Cable");
    await choose(byId(`${ID}-scope`), "Use this Item for this code only");
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    expect(posted("/erp/pos/create").lines[0]).toMatchObject({ item_id: 2, remember: true, map_scope: "CODE" });

    (apiClient.post as any).mockClear();
    await choose(byId(`${ID}-scope`), "Use this Item for every code in this ERP group");
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    expect(posted("/erp/pos/create").lines[0]).toMatchObject({ remember: true, map_scope: "ARTICLE" });

    (apiClient.post as any).mockClear();
    await choose(byId(`${ID}-scope`), "Don't remember");
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    expect(posted("/erp/pos/create").lines[0]).toMatchObject({ remember: false, map_scope: null });
  });

  it("changing a matched line's Item: anyone but the head-office admin remembers it for this code only", async () => {
    mockApi();
    renderScreen();
    const create = await openDraft();
    fireEvent.click(screen.getByRole("button", { name: "Line 1: details" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await choose(byId(`${ID}-item`), "Cable");
    expect(byId(`${ID}-scope`)).toHaveTextContent("Use this Item for this code only");
    expect(screen.getByLabelText(/^brand$/i)).toBeInTheDocument();     // no longer a set: brand and model apply
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    expect(posted("/erp/pos/create").lines[0]).toMatchObject({ item_id: 2, remember: true, map_scope: "CODE", bundle_parts: null });
  });

  it("the head-office admin re-points the rule that matched it", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false, assetUserId: 5 });
    mockApi();
    renderScreen();
    await openDraft();
    fireEvent.click(screen.getByRole("button", { name: "Line 1: details" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    await choose(byId(`${ID}-item`), "Cable");
    expect(byId(`${ID}-scope`)).toHaveTextContent("Use this Item for every code in this ERP group");
  });

  it("a refused re-point offers 'this code only' right under the line", async () => {
    mockApi({ d: draft({}, [switchLine()]) });
    renderScreen();
    const create = await openDraft();
    fireEvent.click(screen.getByRole("button", { name: /use the suggestion/i }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Use it" }));
    const sentence = "Line 1 (CT500001): the whole Article FA_IT_OTHERS is already linked to Desktop. Remember this choice for this code only, or ask the head-office admin to change it.";
    (apiClient.post as any).mockRejectedValueOnce(new Error(sentence));
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    expect(await screen.findByRole("alert", { name: "Line 1 refused" })).toHaveTextContent(sentence);
    fireEvent.click(screen.getByRole("button", { name: "Remember for this code only" }));
    expect(byId(`${ID}-scope`)).toHaveTextContent("Use this Item for this code only");
  });

  it("shows warnings, and blocks a PO that was already created (and says why)", async () => {
    mockApi({ d: draft({ already_created_id: 3, warnings: ["Purchase order SPO/012994/26-27 was already created here; it cannot be created again."] }) });
    renderScreen();
    const create = await openDraft();
    expect(await screen.findByLabelText("Things to check")).toHaveTextContent("already created here");
    expect(create).toBeDisabled();
    expect(screen.getAllByText("This purchase order was already created here.").length).toBeGreaterThan(0);
  });
});

describe("Not tracked from the review (ADMIN and OPERATOR)", () => {
  const CABLE = switchLine({
    item_code: "CT166452", description: "CABLE CAT-6", barcode: "CT166452", quantity: 2, rate: 4000, erp_description: "CABLE CAT-6 · DLINK",
    erp_name: "CABLE CAT-6", article_key: "FA_CE_CAMERA", article_name: "FA_CE_CAMERA", section: "IT EQUIPMENTS", department: "FA_CE_CCTV",
    division: "FIXED ASSETS", name_key: "cable cat 6", suggested_item_id: null, suggested_item_name: null, suggestion_score: null, suggested_scope: "ARTICLE",
  });

  it("an ordinary admin marks a line not tracked through the PO, and it leaves the review", async () => {
    mockApi({ d: draft({}, [line(), CABLE]) });
    (apiClient.post as any).mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/not-tracked")
        ? { po_code: 1133610106, readiness: "READY", lines: [{ item_code: "CT166452", resolution: { state: "NOT_TRACKED", via: "CODE" } }] }
        : {}),
    );
    renderScreen();
    await openDraft();
    await choose(screen.getByLabelText("Line 2: how far this reaches"), "This ERP code only");
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/pos/1133610106/not-tracked", { icode: "CT166452", scope: "CODE" }));
    expect(apiClient.post).not.toHaveBeenCalledWith("/items/maps", expect.anything());
    expect(await screen.findByText("1 line left out: not tracked in CKAM")).toBeInTheDocument();
    expect(screen.queryByLabelText("Line 2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("1 line left out: not tracked in CKAM"));
    expect(screen.getByText(/CABLE CAT-6/, { selector: "li" })).toHaveTextContent("2 × 4,000.00");
    expect(screen.getByLabelText("What is left")).toHaveTextContent("Everything is ready");
  });

  it("code, product name and ERP group for everyone; whole Departments / Sections / Divisions only for the head-office admin", async () => {
    mockApi({ d: draft({}, [line(), CABLE]) });
    renderScreen();
    await openDraft();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    fireEvent.click(screen.getByLabelText("Line 2: how far this reaches"));
    expect(await screen.findByRole("option", { name: "This ERP code only" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "This product name" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Every code in this ERP group" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /The whole Department/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /The whole Division/ })).not.toBeInTheDocument();
  });

  it("the head-office admin can also reach a whole Division", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false, assetUserId: 5 });
    mockApi({ d: draft({}, [line(), CABLE]) });
    renderScreen();
    await openDraft();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getByLabelText("Line 2: how far this reaches"));
    expect(await screen.findByRole("option", { name: "The whole Department FA_CE_CCTV" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "The whole Section IT EQUIPMENTS" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "The whole Division FIXED ASSETS" }));
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    // S7 P2-9: a group-wide rule is confirmed first.
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("This will leave every code in the whole Division FIXED ASSETS out of CKAM for everyone in CKSPL");
    fireEvent.click(within(confirm).getByRole("button", { name: "Leave them out" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/pos/1133610106/not-tracked", { icode: "CT166452", scope: "DIVISION" }));
  });

  it("S7 P2-9: operators start at the narrowest reach and see it in words; a whole ERP group asks first, Cancel saves nothing", async () => {
    mockApi({ d: draft({}, [line(), CABLE]) });
    renderScreen();
    await openDraft();
    expect(screen.getByLabelText("Line 2: how far this reaches")).toHaveTextContent("This product name");
    expect(screen.getByLabelText("Line 2: what not tracked covers")).toHaveTextContent("Leaves every code named “CABLE CAT-6” out of CKAM for everyone in CKSPL.");
    await choose(screen.getByLabelText("Line 2: how far this reaches"), "Every code in this ERP group");
    expect(screen.getByLabelText("Line 2: what not tracked covers")).toHaveTextContent("Leaves every code in the ERP group FA_CE_CAMERA out of CKAM");
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("This will leave every code in the ERP group FA_CE_CAMERA out of CKAM for everyone in CKSPL");
    expect(confirm).toHaveTextContent("Continue?");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalledWith("/erp/pos/1133610106/not-tracked", expect.anything());
  });

  it("S7 P2-9: after saving, an operator is told who can undo it; the head-office admin gets Undo (when the server names the rule)", async () => {
    mockApi({ d: draft({}, [line(), CABLE]) });
    (apiClient.post as any).mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/not-tracked")
        ? { po_code: 1133610106, map_id: 77, lines: [{ item_code: "CT166452", resolution: { state: "NOT_TRACKED", via: "NAME" } }] }
        : {}));
    renderScreen();
    await openDraft();
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    const saved = await screen.findByLabelText("Not tracked saved");
    expect(saved).toHaveTextContent("Saved: every code named “CABLE CAT-6” is now left out of CKAM.");
    expect(saved).toHaveTextContent("Only the head-office admin can undo this");
    expect(within(saved).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("S7 P2-9: the head-office admin undoes the rule right here and the line comes back", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false, assetUserId: 5 });
    mockApi({ d: draft({}, [line(), CABLE]) });
    (apiClient.post as any).mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/not-tracked")
        ? { po_code: 1133610106, map_id: 77, lines: [{ item_code: "CT166452", resolution: { state: "NOT_TRACKED", via: "CODE" } }] }
        : {}));
    (apiClient.delete as any).mockResolvedValue(undefined);
    renderScreen();
    await openDraft();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    await choose(screen.getByLabelText("Line 2: how far this reaches"), "This ERP code only");
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    const saved = await screen.findByLabelText("Not tracked saved");
    fireEvent.click(within(saved).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/items/maps/77"));
    expect(await screen.findByLabelText("Line 2")).toBeInTheDocument();
    expect(screen.queryByText(/line left out/)).not.toBeInTheDocument();
  });

  it("S7 fix 2 (N1b): the server's can_undo decides the Undo button", async () => {
    // the head-office admin, but the server says this rule cannot be undone by them: no Undo, the sentence instead
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false, assetUserId: 5 });
    mockApi({ d: draft({}, [line(), CABLE]) });
    (apiClient.post as any).mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/not-tracked")
        ? { po_code: 1133610106, map_id: 78, can_undo: false, lines: [{ item_code: "CT166452", resolution: { state: "NOT_TRACKED", via: "CODE" } }] }
        : {}));
    renderScreen();
    await openDraft();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    await choose(screen.getByLabelText("Line 2: how far this reaches"), "This ERP code only");
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    const saved = await screen.findByLabelText("Not tracked saved");
    expect(within(saved).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(saved).toHaveTextContent("To undo it, open Settings › ERP Mapping.");
  });

  it("a matched line never offers 'not tracked'; the server's refusal is shown as written", async () => {
    mockApi({ d: draft({}, [line(), CABLE]) });
    (apiClient.post as any).mockRejectedValue(new Error("This line is already linked to the Item Desktop. Ask the head-office admin to change it."));
    renderScreen();
    await openDraft();
    expect(screen.queryByRole("button", { name: "Line 1: not tracked" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Line 2: not tracked" }));
    expect(await screen.findByText("This line is already linked to the Item Desktop. Ask the head-office admin to change it.")).toBeInTheDocument();
  });
});

describe("Unmatched vendor: matched inside the review, never a separate step", () => {
  it("shows the ERP supplier, one-click suggestions with the reason, and blocks Create until a choice is made", async () => {
    mockApi({ rows: [UNMATCHED_ROW], d: unmatchedDraft() });
    renderScreen();
    const create = await openDraft("SPO/BS/5001");
    const panel = screen.getByRole("region", { name: "Vendor needs matching" });
    expect(panel).toHaveTextContent("BLUE STAR LTD (MP)");
    expect(panel).toHaveTextContent("GSTIN 23AAACB4487D1Z0");
    expect(within(panel).getByRole("button", { name: "Link to Blue Star Limited (same company PAN)" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Link to Blue Star MP Office (same GSTIN)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Purchase order summary")).toHaveTextContent("BLUE STAR LTD (MP) · needs matching");
    expect(screen.getByLabelText("What is left")).toHaveTextContent("Match the vendor, then you can create the PO.");
    expect(create).toBeDisabled();
    expect(screen.getByText("Create is not available yet: match the vendor.")).toBeInTheDocument();
  });

  it("link to a suggestion, also linking the other registrations of the same PAN, all in the create call", async () => {
    mockApi({ rows: [UNMATCHED_ROW], d: unmatchedDraft() });
    renderScreen();
    const create = await openDraft("SPO/BS/5001");
    const panel = screen.getByRole("region", { name: "Vendor needs matching" });
    fireEvent.click(within(panel).getByRole("button", { name: /Link to Blue Star Limited/ }));
    expect(within(panel).getByRole("status", { name: "Vendor choice" })).toHaveTextContent("Will be linked to Blue Star Limited when the PO is created.");
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Also link the other 1 registrations" }));
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    const body = posted("/erp/pos/create");
    expect(body.vendor_choice).toEqual({ action: "LINK", vendor_id: 31, also_link_codes: ["BS3"] });
    expect(body).not.toHaveProperty("vendor_id");
    // No separate vendor call: the link is made with the PO.
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it("create a new vendor from the ERP supplier (the server makes the code)", async () => {
    mockApi({ rows: [UNMATCHED_ROW], d: unmatchedDraft() });
    renderScreen();
    const create = await openDraft("SPO/BS/5001");
    fireEvent.click(screen.getByRole("button", { name: "Create new vendor" }));
    expect(screen.getByRole("status", { name: "Vendor choice" })).toHaveTextContent("A new vendor is made from the ERP supplier");
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    expect(posted("/erp/pos/create").vendor_choice).toEqual({ action: "CREATE", also_link_codes: [] });
  });

  it("any other vendor can be picked; a choice can be changed", async () => {
    mockApi({ rows: [UNMATCHED_ROW], d: unmatchedDraft() });
    renderScreen();
    const create = await openDraft("SPO/BS/5001");
    await choose(screen.getByRole("combobox", { name: "Link to another vendor" }), "Jagannath Enterprises");
    expect(screen.getByRole("status", { name: "Vendor choice" })).toHaveTextContent("Will be linked to Jagannath Enterprises");
    fireEvent.click(within(screen.getByRole("status", { name: "Vendor choice" })).getByRole("button", { name: "Change" }));
    expect(screen.getByRole("button", { name: "Create new vendor" })).toBeInTheDocument();
    expect(create).toBeDisabled();
  });

  it("the server's refusal (a GSTIN twin) is shown verbatim in the vendor panel", async () => {
    mockApi({ rows: [UNMATCHED_ROW], d: unmatchedDraft() });
    const sentence = "BLUE STAR LTD (MP) is already a vendor here (same GSTIN as Blue Star MP Office). Link it instead.";
    (apiClient.post as any).mockRejectedValueOnce(new Error(sentence));
    renderScreen();
    const create = await openDraft("SPO/BS/5001");
    fireEvent.click(screen.getByRole("button", { name: "Create new vendor" }));
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    const panel = screen.getByRole("region", { name: "Vendor needs matching" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent(sentence);
  });

  it("an operator can match the vendor too", async () => {
    mockApi({ rows: [UNMATCHED_ROW], d: unmatchedDraft() });
    (apiClient.get as any).mockImplementation(withCapabilities(OPERATOR_IT, (apiClient.get as any).getMockImplementation()));
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5 });
    renderScreen();
    await openDraft("SPO/BS/5001");
    expect(screen.getByRole("button", { name: /Link to Blue Star Limited/ })).toBeInTheDocument();
    expect(screen.queryByText(/Ask the head-office admin to link it/)).not.toBeInTheDocument();
  });
});

describe("S0 contract: the ERP decides number, date, vendor, open quantity and rate", () => {
  const CABLE_LINE = () => line({
    item_code: "CT900001", description: "HDMI CABLE", barcode: "CT900001", quantity: 10, rate: 100, item_id: 2, item_name: "Cable",
    matched_by: "CODE", bundle_id: null, bundle_name: null, resolution: { state: "MATCHED", item_id: 2, item_name: "Cable", via: "CODE" },
  });
  const QTY = `${ID}-quantity`;

  async function openCableDraft(over: Partial<Draft> = {}) {
    mockApi({ d: draft(over, [CABLE_LINE()]) });
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Line 1: details" }));
    return create;
  }

  it("PO No and PO Date are read-only, and erp_po_code is always sent", async () => {
    const create = await openCableDraft();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText(/^po no/i)).toHaveValue("SPO/012994/26-27");
    expect(screen.getByLabelText(/^po date/i)).toHaveValue("2026-09-18");
    expect(screen.getAllByText("From the ERP.").length).toBe(2);
    expect(screen.queryByText("New Vendor…")).not.toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/pos/create", expect.objectContaining({
      erp_po_code: 1133610106, po_number: "SPO/012994/26-27", po_date: "2026-09-18", vendor_id: 7,
    })));
  });

  it("Item, description, barcode, brand, model, tax, warranty and FEWER units stay editable", async () => {
    const create = await openCableDraft();
    for (const field of ["description", "barcode", "tax", "warranty", "model"]) {
      expect(byId(`${ID}-${field}`)).not.toHaveAttribute("readonly");
      expect(byId(`${ID}-${field}`)).not.toBeDisabled();
    }
    fireEvent.change(byId(QTY), { target: { value: "4" } });
    fireEvent.change(byId(`${ID}-description`), { target: { value: "HDMI CABLE 2m" } });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect((apiClient.post as any).mock.calls[0][1].lines[0]).toMatchObject({ quantity: 4, description: "HDMI CABLE 2m", rate: 100 });
  });

  it("shows how many the ERP has open, and blocks more than that (and 0), keeping the line open", async () => {
    const create = await openCableDraft();
    const qty = byId(QTY);
    expect(qty).toHaveAttribute("max", "10");
    expect(screen.getByText("The ERP has 10 open: 1 to 10.")).toBeInTheDocument();
    fireEvent.change(qty, { target: { value: "11" } });
    expect(await screen.findByText(/Line 1: quantity cannot be more than the 10 the ERP still has open\./)).toBeInTheDocument();
    expect(create).toBeDisabled();
    expect(screen.getByLabelText("What is left")).toHaveTextContent("Fix 1 line marked in red, then you can create the PO.");
    // Closing Details does not hide a line with a problem.
    fireEvent.click(screen.getByRole("button", { name: "Line 1: details" }));
    expect(byId(QTY)).not.toBeNull();
    fireEvent.change(byId(QTY), { target: { value: "0" } });
    expect(await screen.findByText(/Line 1: quantity must be a whole number, at least 1\./)).toBeInTheDocument();
    fireEvent.change(byId(QTY), { target: { value: "10" } });
    await waitFor(() => expect(create).not.toBeDisabled());
  });

  it("S6: two lines of one code share the ERP's open units: each is capped at open − the other lines, and says 'ERP has N open'", async () => {
    mockApi({ d: draft({}, [
      { ...CABLE_LINE(), quantity: 7, open_units: 9, max_units: 7 },
      { ...CABLE_LINE(), quantity: 2, open_units: 9, max_units: 2 },
    ]) });
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Line 1: details" }));
    fireEvent.click(screen.getByRole("button", { name: "Line 2: details" }));
    const first = byId(QTY);
    const second = byId("SPO/012994/26-27-line-1-quantity");
    expect(first).toHaveAttribute("max", "7");
    expect(second).toHaveAttribute("max", "2");
    expect(screen.getByText("The ERP has 9 open: 1 to 7. (2 on the other lines of this code)")).toBeInTheDocument();
    // Moving a unit from line 2 to line 1 is allowed...
    fireEvent.change(second, { target: { value: "1" } });
    await waitFor(() => expect(byId(QTY)).toHaveAttribute("max", "8"));
    fireEvent.change(byId(QTY), { target: { value: "8" } });
    await waitFor(() => expect(create).not.toBeDisabled());
    // ...asking more than is open in total is not.
    fireEvent.change(byId(QTY), { target: { value: "9" } });
    expect(await screen.findByText(/Line 1: quantity cannot be more than 8: the ERP has 9 open for this code and the other lines ask 1\./)).toBeInTheDocument();
    expect(create).toBeDisabled();
  });

  it("S6: max_units caps a single line even without open_units", async () => {
    mockApi({ d: draft({}, [{ ...CABLE_LINE(), quantity: 10, max_units: 6 }]) });
    renderScreen();
    await openDraft();
    expect(await screen.findByText(/Line 1: quantity cannot be more than the 6 the ERP still has open\./)).toBeInTheDocument();
    expect(byId(QTY)).toHaveAttribute("max", "6");
  });

  it("a line the ERP has more than 1,000 of cannot be sent above 1,000", async () => {
    mockApi({ d: draft({}, [{ ...CABLE_LINE(), quantity: 5000 }]) });
    renderScreen();
    const create = await openDraft();
    // A problem opens the line by itself.
    expect(await screen.findByText(/Line 1: quantity can be at most 1,000 on one line\./)).toBeInTheDocument();
    expect(screen.getByText(/Whole number, 1 to 1,000\. The ERP has 5,000 open\./)).toBeInTheDocument();
    expect(create).toBeDisabled();
    fireEvent.change(byId(QTY), { target: { value: "1000" } });
    await waitFor(() => expect(create).not.toBeDisabled());
  });

  it("blocks a cost outside half to double the ERP rate, and says the range", async () => {
    const create = await openCableDraft();
    const rate = byId(`${ID}-rate`);
    expect(screen.getByText(/ERP rate 100\.00; keep within half to double\./)).toBeInTheDocument();
    fireEvent.change(rate, { target: { value: "0.0001" } });
    expect(await screen.findByText(/Line 1: cost must be between 50\.00 and 200\.00 \(half to double the ERP rate of 100\.00\)\./)).toBeInTheDocument();
    expect(create).toBeDisabled();
    fireEvent.change(byId(`${ID}-rate`), { target: { value: "250" } });
    await waitFor(() => expect(create).toBeDisabled());
    fireEvent.change(byId(`${ID}-rate`), { target: { value: "90" } });
    await waitFor(() => expect(create).not.toBeDisabled());
  });

  it("shows the server's 'units asked' refusal under the offending line, not only at the bottom", async () => {
    const create = await openCableDraft();
    (apiClient.post as any).mockRejectedValueOnce(new Error("CT900001: 12 units asked, but the ERP purchase order has only 10 open."));
    fireEvent.click(create);
    const inline = await screen.findByRole("alert", { name: "Line 1 refused" });
    expect(inline).toHaveTextContent("CT900001: 12 units asked, but the ERP purchase order has only 10 open.");
    expect(screen.getByText(/The purchase order was not created\. Fix line 1 marked in red above/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Line 1")).getByRole("alert")).toBe(inline);
  });

  it("an order-level refusal is shown once at the bottom, as the server wrote it", async () => {
    const create = await openCableDraft();
    const sentence = "This ERP purchase order belongs to the ERP company CKSPL, not to Other Co.";
    (apiClient.post as any).mockRejectedValueOnce(new Error(sentence));
    fireEvent.click(create);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "Line 1 refused" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// S3b-1 (kept): Cost Centre, stock room, Item and Brand can be added right here.
// ---------------------------------------------------------------------------
describe("S3b-1: inline creation in the ERP review", () => {
  const SWITCH_MATCHED = () => line({
    item_id: 3, item_name: "Network Switch", bundle_id: null, bundle_name: null, matched_by: "CODE",
    resolution: { state: "MATCHED", item_id: 3, item_name: "Network Switch", via: "CODE" },
  });

  function withCaps(caps: Capabilities) {
    const base = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation(withCapabilities(caps, base));
  }

  async function offered(trigger: HTMLElement, entry: RegExp): Promise<boolean> {
    fireEvent.click(trigger);
    await screen.findAllByRole("option");
    const found = screen.queryByRole("option", { name: entry }) !== null;
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument());
    return found;
  }

  it.each(KINDS)("%s: Cost Centre, Received Into, Item and Brand offer \"+ New …\" as allowed", async (_kind, caps) => {
    mockApi({ d: draft({}, [SWITCH_MATCHED()]) });
    withCaps(caps);
    renderScreen();
    await openDraft();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Line 1: details" }));
    expect(await offered(screen.getByLabelText(/^cost centre/i), /new cost centre/i)).toBe(caps.can_create.cost_centre === true);
    expect(await offered(screen.getByLabelText(/^received into/i), /new stock room/i)).toBe(caps.can_create.stock_room === true);
    expect(await offered(byId(`${ID}-item`), /new item/i)).toBe(caps.can_create.item === true);
    expect(await offered(screen.getByLabelText(/^brand$/i), /new brand/i)).toBe(caps.can_create.brand === true);
    expect(screen.queryByText(/new vendor…/i)).not.toBeInTheDocument();
  });

  it("an exception line offers + New Item next to Choose Item", async () => {
    mockApi({ d: draft({}, [switchLine()]) });
    withCaps(OPERATOR_IT);
    renderScreen();
    await openDraft();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    expect(await offered(byId(`${ID}-item`), /new item/i)).toBe(true);
  });

  it("Received Into lists the company's stock rooms from /stock-rooms", async () => {
    mockApi({ d: draft({ delivery_asset_user_id: null }, [SWITCH_MATCHED()]) });
    withCaps(OPERATOR_IT);
    renderScreen();
    await openDraft();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/stock-rooms?company_id=1"));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByLabelText(/^received into/i));
    expect(await screen.findByRole("option", { name: /^WH Tajnagar Stores\s?· WH-TAJNAGAR · CKSPL$/ })).toBeInTheDocument();
  });

  it("where the ERP gave no Cost Centre or stock room, the header opens and the ones used last are chosen", async () => {
    window.localStorage.setItem("ckam:last-used:5:1", JSON.stringify({ cost_centre: "5", stock_room: "9" }));
    mockApi({ d: draft({ cost_center_id: null, delivery_asset_user_id: null }, [SWITCH_MATCHED()]) });
    withCaps(OPERATOR_IT);
    renderScreen();
    await openDraft();
    await waitFor(() => expect(screen.getByLabelText(/^cost centre/i)).toHaveTextContent("CKSPL"));
    await waitFor(() => expect(screen.getByLabelText(/^received into/i)).toHaveTextContent("WH Tajnagar Stores"));
  });

  it("a missing Cost Centre is named in what is left", async () => {
    mockApi({ d: draft({ cost_center_id: null }, [SWITCH_MATCHED()]) });
    (apiClient.get as any).mockImplementation(((base) => (path: string) => (path.startsWith("/masters/cost-centers") ? Promise.resolve([]) : base(path)))((apiClient.get as any).getMockImplementation()));
    renderScreen();
    const create = await openDraft();
    expect(screen.getByLabelText("What is left")).toHaveTextContent("Choose the Cost Centre, then you can create the PO.");
    expect(create).toBeDisabled();
  });
});

describe("S7 fixes in the ERP review", () => {
  it("P1-2: a double activation of Create sends ONE request, with an Idempotency-Key", async () => {
    mockApi();
    const keys: (string | null)[] = [];
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/erp/pos/create") {
        keys.push(currentIdempotencyKey());
        return new Promise(() => {});
      }
      return Promise.resolve({});
    });
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    act(() => {
      create.click();
      create.click();
    });
    await waitFor(() => expect(keys).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect((apiClient.post as any).mock.calls.filter((c: unknown[]) => c[0] === "/erp/pos/create")).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("Final review: the barcode is optional on every line (none is sent as null)", async () => {
    mockApi({ d: draft({}, [line({ barcode: "" })]) });
    renderScreen();
    const create = await openDraft();
    await waitFor(() => expect(create).not.toBeDisabled());
    expect(screen.queryByText(/barcode is required/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Line 1: details" }));
    expect(screen.getByText("Barcode").closest("label")).not.toHaveTextContent("*");
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    expect(posted("/erp/pos/create").lines[0].barcode).toBeNull();
  });

  it("P2-11: a matched line keeps the ERP's own words visible beside the Item", async () => {
    mockApi();
    renderScreen();
    await openDraft();
    expect(screen.getByLabelText("Line 1 in the ERP")).toHaveTextContent("In the ERP: DELL DESKTOP REFURB/i3 · HARSHIT INFOSOLUTION · CT324973");
  });

  it("P1-3: 'Same name' only when the server says so; no suggestion -> nothing shown", async () => {
    mockApi({ d: draft({}, [switchLine({ suggestion_score: 1, suggestion_reason: "same name", suggestion_reason_code: "SAME_NAME" })]) });
    renderScreen();
    await openDraft();
    const row = screen.getByLabelText("Line 1");
    expect(within(row).getByText(/Same name/)).toBeInTheDocument();
    expect(within(row).queryByText(/100%/)).not.toBeInTheDocument();
    // Never chosen for the person.
    expect(within(row).getByText("Needs an Item")).toBeInTheDocument();
  });

  it("S7 fix 2: a same-name suggestion for one product name is one click", async () => {
    mockApi({ d: draft({}, [switchLine({ suggestion_score: 1, suggestion_reason: "same name", suggestion_reason_code: "SAME_NAME", suggestion_scope: "NAME" })]) });
    renderScreen();
    const create = await openDraft();
    fireEvent.click(screen.getByRole("button", { name: /use the suggestion network switch/i }));
    await waitFor(() => expect(create).not.toBeDisabled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    expect(posted("/erp/pos/create").lines[0]).toMatchObject({ item_id: 3, remember: true, map_scope: null });
  });

  it("S7 fix 2: a whole ERP group is asked first even for the same name; Cancel chooses nothing", async () => {
    mockApi({ d: draft({}, [switchLine({ suggestion_score: 1, suggestion_reason: "same name", suggestion_reason_code: "SAME_NAME",
      suggested_scope: "ARTICLE", suggestion_scope: "ARTICLE" })]) });
    renderScreen();
    const create = await openDraft();
    fireEvent.click(screen.getByRole("button", { name: /use the suggestion network switch/i }));
    const ask = await screen.findByRole("alertdialog", { name: "Use the suggestion?" });
    expect(ask).toHaveTextContent("Use Network Switch for every code in group FA_IT_OTHERS? This is remembered for everyone. It is saved when you create the purchase order.");
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(within(screen.getByLabelText("Line 1")).getByText("Needs an Item")).toBeInTheDocument();
    expect(create).toBeDisabled();
  });

  it("S7 fix 2: a mixed ERP group's suggestion is remembered for its product name, not the whole group", async () => {
    // TABLE_OFFICE: the server's default reach is the whole group, but it judged the chair only for its own name
    mockApi({ d: draft({}, [switchLine({ suggestion_score: 1, suggestion_reason: "same name", suggestion_reason_code: "SAME_NAME",
      suggested_scope: "ARTICLE", suggestion_scope: "NAME" })]) });
    renderScreen();
    const create = await openDraft();
    expect(byId(`${ID}-scope`)).toHaveTextContent("Use this Item for every code in this ERP group");
    fireEvent.click(screen.getByRole("button", { name: /use the suggestion network switch/i }));
    await waitFor(() => expect(create).not.toBeDisabled());
    expect(byId(`${ID}-scope`)).toHaveTextContent("Use this Item for this product name");
    fireEvent.click(create);
    await waitFor(() => expect(posted("/erp/pos/create")).toBeDefined());
    expect(posted("/erp/pos/create").lines[0]).toMatchObject({ item_id: 3, remember: true, map_scope: "NAME" });
  });

  it("P1-3: a line without a suggestion shows no 'Suggested'", async () => {
    mockApi({ d: draft({}, [switchLine({ suggested_item_id: null, suggested_item_name: null, suggestion_score: null })]) });
    renderScreen();
    await openDraft();
    expect(within(screen.getByLabelText("Line 1")).queryByText(/Suggested/)).not.toBeInTheDocument();
  });

  it("P3-1: 'ERP data as of' is said once when the sync line already says it", async () => {
    mockApi();
    const base = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/erp/sync") {
        const run = { status: "success", trigger: "schedule", started_at: "2026-10-13T06:00:00Z", finished_at: "2026-10-13T06:00:05Z", source_stamp: "2026-10-13T05:44:00Z", message: null, po_lines_new: 0, po_lines_changed: 0, po_lines_gone: 0 };
        return Promise.resolve({ configured: true, last: run, last_success: run });
      }
      return base(path);
    });
    renderScreen();
    await screen.findByText("SPO/012994/26-27");
    await waitFor(() => expect(screen.getAllByText(/ERP data as of/)).toHaveLength(1));
  });
});
