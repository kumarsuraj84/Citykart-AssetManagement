import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { HEAD_OFFICE, ADMIN_BOTH } from "../../test-capabilities";
import { itemEntries, type Inbox, type InboxItemGroup } from "./ErpInbox";

vi.mock("../../lib/api-client");

const SWITCH_GROUP: InboxItemGroup = {
  company_id: 1, company_code: "CKSPL", article_key: "FA_IT_OTHERS", article_name: "FA_IT_OTHERS", department: "FA_IT_OTHERS",
  section: "IT EQUIPMENTS", division: "FIXED ASSETS", suggested_scope: "ARTICLE",
  codes: [
    { icode: "CT500001", name: "48 PORT SWITCH", units: 7, po_numbers: ["SPO/BS/5001", "SPO/BS/5002"], scopes: ["CODE", "NAME", "ARTICLE"] },
    { icode: "CT500003", name: "48 PORT SWITCH", units: 1, po_numbers: ["SPO/BS/5003"], scopes: ["CODE", "NAME", "ARTICLE"] },
    { icode: "CT500004", name: "24 PORT SWITCH", units: 2, po_numbers: ["SPO/BS/5003"], scopes: ["CODE", "NAME", "ARTICLE"] },
  ],
  suggested_item_id: 44, suggested_item_name: "Network Switch", suggestion_score: 0.5, seen_on_pos: ["SPO/BS/5001"], po_count: 2,
};
const RACK_GROUP: InboxItemGroup = {
  ...SWITCH_GROUP, article_key: "FA_RACKS", article_name: "FA_RACKS", suggested_scope: "NAME",
  codes: [{ icode: "CT600001", name: "6U RACK", units: 4, po_numbers: ["SPO/BS/5001"], scopes: ["CODE", "NAME", "ARTICLE"] }],
  suggested_item_id: 45, suggested_item_name: "Server Rack", suggestion_score: 0.8,
};
const NO_ARTICLE: InboxItemGroup = {
  ...SWITCH_GROUP, article_key: null, article_name: null, suggested_scope: "CODE",
  codes: [{ icode: "CT777", name: "MYSTERY CODE", units: 1, po_numbers: ["SPO/9"], scopes: ["CODE"] }],
  suggested_item_id: null, suggested_item_name: null, suggestion_score: null,
};

const INBOX: Inbox = {
  counts: { items: 2, vendors: 1, stores: 14, item_codes: 4, vendor_registrations: 2 },
  items: [SWITCH_GROUP, RACK_GROUP],
  vendors: [{
    company_id: 1, company_code: "CKSPL", group_key: "CKSPL:AAACB4487D", pan: "AAACB4487D", name: "BLUE STAR LIMITED",
    registrations: [
      { erp_code: "BS1", name: "BLUE STAR LIMITED", gstin: "09AAACB4487D1Z0", open_pos: 1 },
      { erp_code: "BS3", name: "Blue Star Limited-KOLKATA", gstin: "19AAACB4487D1ZX", open_pos: 0 },
    ],
    suggested_vendor_id: 31, suggested_vendor_name: "Blue Star Limited", suggestion_reason: "NAME",
  }],
  stores: Array.from({ length: 14 }, (_, i) => ({ code: `S${String(i + 1).padStart(2, "0")}`, name: `Store ${i + 1}`, company_id: 1, selectable: true })),
};
const EMPTY: Inbox = { counts: { items: 0, vendors: 0, stores: 0 }, items: [], vendors: [], stores: [] };

const DASHBOARD = {
  status_counts: {}, stock_by_location: [], warranty_alerts: [], long_allocation_alerts: [], exception_counts: {},
  recent_activity: [], pending_po_summary: { count: 0, value: 0 }, open_purchase_orders: [],
};

let attentionFails = false;

function mockApi(inbox: Inbox = INBOX) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/capabilities") return Promise.resolve(useAuthStore.getState().isPrimaryOwner ? HEAD_OFFICE : ADMIN_BOTH);
    // S6: Home's one call carries the inbox counts for the head-office admin.
    if (path.startsWith("/home/attention")) {
      if (attentionFails) return Promise.reject(new Error("503"));
      return Promise.resolve({
        serial_pending: 0, under_repair: 0, lost: 0, unlinked_assets: 0, waiting_pos: 0, waiting_units: 0, erp_available: true,
        erp_changed_pos: 0, erp_arrived_pos: 0, erp_pos_needing_input: 0,
        inbox: useAuthStore.getState().isPrimaryOwner ? { items: inbox.counts.items, vendors: inbox.counts.vendors, stores: inbox.counts.stores } : null,
      });
    }
    if (path === "/erp/inbox/counts") return Promise.resolve({ items: inbox.counts.items, vendors: inbox.counts.vendors, stores: inbox.counts.stores });
    if (path.startsWith("/erp/inbox")) return Promise.resolve(inbox);
    if (path === "/masters/companies") return Promise.resolve([{ id: 1, code: "CKSPL", name: "Citykart Stores" }, { id: 2, code: "CKVPL", name: "Citykart Ventures" }]);
    if (path === "/items") return Promise.resolve([
      { id: 44, name: "Network Switch", category_id: 1, subcategory_id: null, is_active: true },
      { id: 45, name: "Server Rack", category_id: 1, subcategory_id: null, is_active: true },
      { id: 46, name: "Router", category_id: 1, subcategory_id: null, is_active: true },
    ]);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 31, name: "Blue Star Limited" }, { id: 3, name: "Vansh Enterprises" }]);
    if (path.startsWith("/erp/stores?company_id=")) return Promise.resolve({ company_id: 1, copied: true, summary: { READY: 0, UPCOMING: 0, INACTIVE: 0, ALREADY_CREATED: 0, NOT_A_STORE_CODE: 0 }, stores: [] });
    if (path === "/reports/dashboard") return Promise.resolve(DASHBOARD);
    return Promise.resolve([]);
  });
  (apiClient.getPage as any)?.mockResolvedValue?.({ data: [], total: 0 });
}

function asHeadOffice(yes = true) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: yes, mustChangePassword: false, assetUserId: 5 });
}

function renderAt(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

const body = (path: string) => (apiClient.post as any).mock.calls.find((c: unknown[]) => c[0] === path)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  attentionFails = false;
  asHeadOffice();
  mockApi();
  (apiClient.post as any).mockImplementation((_path: string, entries: unknown[]) =>
    Promise.resolve((entries ?? []).map(() => ({ ok: true, message: "Every code of the Article FA_IT_OTHERS is now Network Switch." }))));
});
afterEach(() => useAuthStore.getState().logout());

describe("ERP Inbox (head-office admin)", () => {
  it("is the head-office admin's: anyone else gets no access and the inbox is never asked for", async () => {
    asHeadOffice(false);
    renderAt("/settings/erp/inbox");
    expect(await screen.findByText("You don't have access to this area.")).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/erp\/inbox/));
  });

  it("shows three sections with their counts", async () => {
    renderAt("/settings/erp/inbox");
    expect(await screen.findByRole("heading", { level: 1, name: "ERP Inbox" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Inbox counts")).toHaveTextContent("2 new items · 1 new vendor · 14 new stores");
    expect(screen.getByRole("region", { name: "New items from ERP" })).toHaveTextContent("(2)");
    expect(screen.getByRole("region", { name: "New vendors from ERP" })).toHaveTextContent("(1)");
    expect(screen.getByRole("region", { name: "New stores" })).toHaveTextContent("(14)");
    const group = screen.getByRole("listitem", { name: "ERP group FA_IT_OTHERS" });
    // S7 P2-5: folded to its counts and the suggestion; the codes open with Details.
    expect(within(group).getByLabelText("Counts for FA_IT_OTHERS")).toHaveTextContent("3 codes · 10 units · on 2 POs");
    // S7 P1-3: honest words, never "% match".
    expect(group).toHaveTextContent("Suggested: Network Switch · Similar name (50%)");
    expect(group).not.toHaveTextContent("CT500001");
    fireEvent.click(within(group).getByRole("button", { name: "Details for FA_IT_OTHERS" }));
    expect(group).toHaveTextContent("CT500001 48 PORT SWITCH · 7 units · on SPO/BS/5001, SPO/BS/5002");
    expect(within(group).getByRole("combobox", { name: "How far for FA_IT_OTHERS" })).toHaveTextContent("Every code in this ERP group");
    expect(screen.getByRole("link", { name: "Advanced mapping rules" })).toHaveAttribute("href", "/settings/erp/mapping");
  });

  it("empty: each section says nothing needs a decision", async () => {
    mockApi(EMPTY);
    renderAt("/settings/erp/inbox");
    expect(await screen.findAllByText("Nothing needs a decision.")).toHaveLength(3);
  });

  it("Use suggestion decides the whole ERP group (after a confirmation) and lists the server's answer", async () => {
    renderAt("/settings/erp/inbox");
    fireEvent.click(await screen.findByRole("button", { name: "Use suggestion for FA_IT_OTHERS" }));
    // S7 fix 2 (N1): a similar name for a whole ERP group is asked first
    const ask = await screen.findByRole("alertdialog", { name: "Use the suggestion?" });
    expect(ask).toHaveTextContent("Use Network Switch for every code in group FA_IT_OTHERS? This is remembered for everyone.");
    expect(apiClient.post).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Use it" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/inbox/items/resolve", [
      { company_id: 1, article_key: "FA_IT_OTHERS", scope: "ARTICLE", item_id: 44 },
    ]));
    expect(await screen.findByRole("status", { name: "Item decisions" })).toHaveTextContent("FA_IT_OTHERS: Every code of the Article FA_IT_OTHERS is now Network Switch.");
    await waitFor(() => expect((apiClient.get as any).mock.calls.filter((c: string[]) => c[0].startsWith("/erp/inbox")).length).toBeGreaterThan(1));
  });

  it("a narrower reach sends one entry per product name or per code; Not tracked marks them so", async () => {
    renderAt("/settings/erp/inbox");
    const group = await screen.findByRole("listitem", { name: "ERP group FA_IT_OTHERS" });
    fireEvent.click(within(group).getByRole("button", { name: "Details for FA_IT_OTHERS" }));
    fireEvent.click(within(group).getByRole("combobox", { name: "How far for FA_IT_OTHERS" }));
    fireEvent.click(await screen.findByRole("option", { name: "Each product name" }));
    fireEvent.click(within(group).getByRole("button", { name: "Not tracked: FA_IT_OTHERS" }));
    await waitFor(() => expect(body("/erp/inbox/items/resolve")).toEqual([
      { company_id: 1, icode: "CT500001", scope: "NAME", not_tracked: true },
      { company_id: 1, icode: "CT500004", scope: "NAME", not_tracked: true },
    ]));
  });

  it("Pick another links the group to the Item chosen", async () => {
    renderAt("/settings/erp/inbox");
    const group = await screen.findByRole("listitem", { name: "ERP group FA_RACKS" });
    fireEvent.click(within(group).getByRole("button", { name: "Details for FA_RACKS" }));
    fireEvent.click(within(group).getByRole("combobox", { name: "Pick another Item for FA_RACKS" }));
    fireEvent.click(await screen.findByRole("option", { name: /^Router/ }));
    fireEvent.click(within(group).getByRole("button", { name: "Link FA_RACKS to the picked Item" }));
    // The server suggested "product name" for this group: that is the default reach.
    await waitFor(() => expect(body("/erp/inbox/items/resolve")).toEqual([{ company_id: 1, icode: "CT600001", scope: "NAME", item_id: 46 }]));
  });

  it("several groups at once, with each entry's own result (one refused)", async () => {
    (apiClient.post as any).mockResolvedValueOnce([
      { ok: true, message: "Every code of the Article FA_IT_OTHERS is now Network Switch." },
      { ok: false, message: "The Item Server Rack is no longer active; choose another." },
    ]);
    renderAt("/settings/erp/inbox");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select FA_IT_OTHERS" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FA_RACKS" }));
    expect(screen.getByLabelText("Selected groups")).toHaveTextContent("2 groups selected");
    fireEvent.click(screen.getByRole("button", { name: "Use the suggestions (2)" }));
    const ask = await screen.findByRole("alertdialog", { name: "Use the suggestion?" });
    expect(ask).toHaveTextContent("Use the suggested Item for each of the 2 selected groups?");
    fireEvent.click(within(ask).getByRole("button", { name: "Use it" }));
    await waitFor(() => expect(body("/erp/inbox/items/resolve")).toEqual([
      { company_id: 1, article_key: "FA_IT_OTHERS", scope: "ARTICLE", item_id: 44 },
      { company_id: 1, icode: "CT600001", scope: "NAME", item_id: 45 },
    ]));
    const results = await screen.findByRole("status", { name: "Item decisions" });
    expect(results).toHaveTextContent("FA_IT_OTHERS: Every code of the Article FA_IT_OTHERS is now Network Switch.");
    expect(results).toHaveTextContent("FA_RACKS: Not done. The Item Server Rack is no longer active; choose another.");
  });

  it("vendors by PAN: link all registrations to the suggestion, or create one new vendor for all", async () => {
    (apiClient.post as any).mockResolvedValue([{ ok: true, message: "Linked 2 ERP suppliers to Blue Star Limited.", vendor_id: 31 }]);
    renderAt("/settings/erp/inbox");
    const supplier = await screen.findByRole("listitem", { name: "Supplier BLUE STAR LIMITED" });
    expect(supplier).toHaveTextContent("PAN AAACB4487D · 2 registrations");
    expect(supplier).toHaveTextContent("Blue Star Limited-KOLKATA · ERP code BS3 · GSTIN 19AAACB4487D1ZX · 0 open POs");
    fireEvent.click(within(supplier).getByRole("button", { name: "Link all 2 to Blue Star Limited (same name)" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/inbox/vendors/resolve", [
      { company_id: 1, erp_vendor_codes: ["BS1", "BS3"], action: "LINK", vendor_id: 31 },
    ]));
    expect(await screen.findByRole("status", { name: "Vendor decisions" })).toHaveTextContent("Linked 2 ERP suppliers to Blue Star Limited.");
    (apiClient.post as any).mockClear();
    fireEvent.click(within(supplier).getByRole("button", { name: "Create new vendor for BLUE STAR LIMITED" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/inbox/vendors/resolve", [
      { company_id: 1, erp_vendor_codes: ["BS1", "BS3"], action: "CREATE" },
    ]));
  });

  it("a refused vendor decision says so, in the server's words", async () => {
    (apiClient.post as any).mockResolvedValue([{ ok: false, message: "BLUE STAR LIMITED is already a vendor here (same GSTIN as Blue Star MP Office). Link it instead." }]);
    renderAt("/settings/erp/inbox");
    const supplier = await screen.findByRole("listitem", { name: "Supplier BLUE STAR LIMITED" });
    fireEvent.click(within(supplier).getByRole("button", { name: "Create new vendor for BLUE STAR LIMITED" }));
    expect(await screen.findByRole("status", { name: "Vendor decisions" })).toHaveTextContent("Not done. BLUE STAR LIMITED is already a vendor here (same GSTIN as Blue Star MP Office). Link it instead.");
  });

  it("new stores: a short list and the existing Stores-from-ERP dialog to create them", async () => {
    renderAt("/settings/erp/inbox");
    const stores = await screen.findByRole("region", { name: "New stores" });
    expect(stores).toHaveTextContent("S01, S02, S03, S04, S05, S06, S07, S08, S09, S10, S11, S12 and 2 more");
    fireEvent.click(within(stores).getByRole("button", { name: "Create stores…" }));
    expect(await screen.findByRole("dialog", { name: "Stores from the ERP" })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/stores?company_id=1"));
  });

  it("one company at a time", async () => {
    renderAt("/settings/erp/inbox");
    await screen.findByLabelText("Inbox counts");
    expect(apiClient.get).toHaveBeenCalledWith("/erp/inbox");
    fireEvent.click(screen.getByRole("combobox", { name: "Company" }));
    fireEvent.click(await screen.findByRole("option", { name: "Citykart Ventures" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/inbox?company_id=2"));
  });

  it("the resolve entries for a group", () => {
    expect(itemEntries(SWITCH_GROUP, "ARTICLE", { kind: "item", itemId: 44 })).toEqual([{ company_id: 1, article_key: "FA_IT_OTHERS", scope: "ARTICLE", item_id: 44 }]);
    expect(itemEntries(SWITCH_GROUP, "CODE", { kind: "not_tracked" })).toHaveLength(3);
    expect(itemEntries(NO_ARTICLE, "ARTICLE", { kind: "item", itemId: 1 })).toEqual([{ company_id: 1, icode: "CT777", scope: "CODE", item_id: 1 }]);
    expect(itemEntries(NO_ARTICLE, "NAME", { kind: "item", itemId: 1 })).toEqual([{ company_id: 1, icode: "CT777", scope: "CODE", item_id: 1 }]);
  });

  it("S7 P2-5: many groups are paged (20 a page), searchable, and a code's PO numbers stop after 5", async () => {
    const many: InboxItemGroup[] = Array.from({ length: 45 }, (_, i) => ({
      ...SWITCH_GROUP, article_key: `ART_${String(i + 1).padStart(2, "0")}`, article_name: `ART_${String(i + 1).padStart(2, "0")}`,
      codes: [{ icode: `C${i}`, name: i === 30 ? "HOP BOX" : `THING ${i}`, units: 1, po_numbers: Array.from({ length: 12 }, (_, k) => `PO/${i}/${k}`), scopes: ["CODE"] }],
      suggested_item_id: null, suggested_item_name: null, suggestion_score: null,
    }));
    mockApi({ ...INBOX, counts: { ...INBOX.counts, items: 45 }, items: many });
    renderAt("/settings/erp/inbox");
    expect(await screen.findByLabelText("ERP groups shown")).toHaveTextContent("Showing 1–20 of 45 groups");
    const region = screen.getByRole("region", { name: "New items from ERP" });
    expect(within(region).getAllByRole("listitem", { name: /^ERP group / })).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Next page of ERP groups" }));
    expect(screen.getByLabelText("ERP groups shown")).toHaveTextContent("Showing 21–40 of 45 groups");
    expect(screen.getByRole("listitem", { name: "ERP group ART_21" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search ERP groups" }), { target: { value: "hop box" } });
    expect(screen.getByLabelText("ERP groups shown")).toHaveTextContent("Showing 1–1 of 1 group");
    const hop = screen.getByRole("listitem", { name: "ERP group ART_31" });
    fireEvent.click(within(hop).getByRole("button", { name: "Details for ART_31" }));
    expect(hop).toHaveTextContent("on PO/30/0, PO/30/1, PO/30/2, PO/30/3, PO/30/4 and 7 more");
  });

  it("S7 P2-5: a selection made on one page is kept on the next, and 'Select every group on this page' ticks the page", async () => {
    const many: InboxItemGroup[] = Array.from({ length: 25 }, (_, i) => ({ ...SWITCH_GROUP, article_key: `G${i}`, article_name: `G${i}` }));
    mockApi({ ...INBOX, counts: { ...INBOX.counts, items: 25 }, items: many });
    renderAt("/settings/erp/inbox");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select every group on this page" }));
    expect(screen.getByLabelText("Selected groups")).toHaveTextContent("20 groups selected");
    fireEvent.click(screen.getByRole("button", { name: "Next page of ERP groups" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select G22" }));
    expect(screen.getByLabelText("Selected groups")).toHaveTextContent("21 groups selected");
  });

  it("S7 P1-3: 'Same name' only when the server says so; a group without a suggestion shows none", async () => {
    mockApi({
      ...INBOX,
      items: [{ ...RACK_GROUP, suggestion_score: 1, suggestion_reason: "same name", suggestion_reason_code: "SAME_NAME" }, NO_ARTICLE],
    });
    renderAt("/settings/erp/inbox");
    const rack = await screen.findByRole("listitem", { name: "ERP group FA_RACKS" });
    expect(rack).toHaveTextContent("Suggested: Server Rack · Same name");
    expect(rack).not.toHaveTextContent("100%");
    const mystery = screen.getByRole("listitem", { name: "ERP group MYSTERY CODE" });
    expect(mystery).not.toHaveTextContent("Suggested");
    expect(within(mystery).queryByRole("button", { name: /use suggestion/i })).not.toBeInTheDocument();
  });

  it("S7 fix 2: a same-name suggestion for one product name is one click; Cancel on a question sends nothing", async () => {
    const sameName = { ...RACK_GROUP, suggestion_score: 1, suggestion_reason: "same name", suggestion_reason_code: "SAME_NAME", suggestion_scope: "NAME" as const };
    mockApi({ ...INBOX, items: [SWITCH_GROUP, sameName] });
    renderAt("/settings/erp/inbox");
    fireEvent.click(await screen.findByRole("button", { name: "Use suggestion for FA_IT_OTHERS" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use suggestion for FA_RACKS" }));
    await waitFor(() => expect(body("/erp/inbox/items/resolve")).toEqual([{ company_id: 1, icode: "CT600001", scope: "NAME", item_id: 45 }]));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("S7 fix 2: the reach the server judged the suggestion for is the one saved (a mixed group: per product name)", async () => {
    const mixed: InboxItemGroup = {
      ...SWITCH_GROUP, article_key: "FA_FF_TABLE_OFFICE", article_name: "FA_FF_TABLE_OFFICE", suggested_scope: "ARTICLE",
      codes: [{ icode: "CV2054", name: "OFFICE CHAIR", units: 2, po_numbers: ["SPO/1"], scopes: ["CODE", "NAME", "ARTICLE"] }],
      suggested_item_id: 46, suggested_item_name: "Router", suggestion_score: 0.85, suggestion_reason: "similar name",
      suggestion_reason_code: "SIMILAR_NAME", suggestion_scope: "NAME",
    };
    mockApi({ ...INBOX, items: [mixed] });
    renderAt("/settings/erp/inbox");
    fireEvent.click(await screen.findByRole("button", { name: "Use suggestion for FA_FF_TABLE_OFFICE" }));
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("Use Router for every code named “OFFICE CHAIR”? This is remembered for everyone.");
    fireEvent.click(within(ask).getByRole("button", { name: "Use it" }));
    await waitFor(() => expect(body("/erp/inbox/items/resolve")).toEqual([{ company_id: 1, icode: "CV2054", scope: "NAME", item_id: 46 }]));
  });

  it("Settings › ERP Mapping points to the inbox", async () => {
    renderAt("/settings/erp/mapping");
    const note = await screen.findByRole("note");
    expect(within(note).getByRole("link", { name: "ERP Inbox" })).toHaveAttribute("href", "/settings/erp/inbox");
  });
});

describe("Home: the ERP decisions waiting (head-office admin)", () => {
  it("shows the three counts, each linking to its part of the inbox", async () => {
    renderAt("/dashboard");
    const row = await screen.findByRole("region", { name: "ERP Inbox" });
    expect(row).toHaveTextContent("2 new items from the ERP to link to an Item");
    expect(row).toHaveTextContent("1 new vendor from the ERP to match");
    expect(row).toHaveTextContent("14 stores from the ERP not created yet");
    expect(within(row).getByRole("link", { name: /decide/i })).toHaveAttribute("href", "/settings/erp/inbox?section=items");
    expect(within(row).getByRole("link", { name: /match/i })).toHaveAttribute("href", "/settings/erp/inbox?section=vendors");
    expect(within(row).getByRole("link", { name: /create/i })).toHaveAttribute("href", "/settings/erp/inbox?section=stores");
  });

  it("nothing for an ordinary admin, and nothing when nothing waits", async () => {
    asHeadOffice(false);
    renderAt("/dashboard");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "ERP Inbox" })).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/erp/inbox");
    expect(apiClient.get).not.toHaveBeenCalledWith("/erp/inbox/counts");
  });

  it("S6: the counts come with Home's one call -- the inbox itself is not read on Home", async () => {
    renderAt("/dashboard");
    await screen.findByRole("region", { name: "ERP Inbox" });
    expect(apiClient.get).toHaveBeenCalledWith("/home/attention");
    expect(apiClient.get).not.toHaveBeenCalledWith("/erp/inbox");
    expect(apiClient.get).not.toHaveBeenCalledWith("/erp/inbox/counts");
  });

  it("S6: when Home's call fails, the row asks the small counts endpoint itself", async () => {
    attentionFails = true;
    renderAt("/dashboard");
    const row = await screen.findByRole("region", { name: "ERP Inbox" });
    expect(row).toHaveTextContent("14 stores from the ERP not created yet");
    expect(apiClient.get).toHaveBeenCalledWith("/erp/inbox/counts");
  });

  it("all counts zero: no row", async () => {
    mockApi(EMPTY);
    renderAt("/dashboard");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/home/attention"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("region", { name: "ERP Inbox" })).not.toBeInTheDocument();
  });
});
