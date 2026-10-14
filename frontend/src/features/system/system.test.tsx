import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { HEAD_OFFICE, ADMIN_BOTH } from "../../test-capabilities";
import { localDate } from "./logs-api";
import { BUNDLE_EXPLANATION } from "./BundleActions";
import VendorsSetup from "../../routes/setup/vendors";
import { RecordHistoryButton } from "./RecordHistory";
import { useReportProblem } from "../support/report-problem-store";

vi.mock("../../lib/api-client");

const REQ = "affb82df5c604737a04a411f3475238e";

const AUDIT_ROW = {
  id: 36, at: "2026-10-14T04:20:40.577229+00:00", request_id: REQ, source: "api",
  actor_id: 1, actor_code: "S0OWN", actor_name: "Head Office Admin", actor_role: "ADMIN", is_head_office_admin: true,
  company_id: 1, ip: "127.0.0.1", category: "DATA", action: "UPDATE", entity: "vendor", entity_id: "1",
  summary: "Vendor 'ARIHANT INFOCOM LLP' updated: name, gstin.",
  changes: { name: { old: "Good Vendor", new: "ARIHANT INFOCOM LLP" }, gstin: { old: null, new: "27AAPFU0939F1ZV" } },
  outcome: "OK",
};
const SECURITY_ROW = {
  ...AUDIT_ROW, id: 40, category: "SECURITY", action: "LOGIN_FAILED", entity: "asset_user", entity_id: "7",
  summary: "Failed sign-in for 'ravi' (wrong password, attempt 2).", changes: { attempt: 2 }, outcome: "FAILED", request_id: "sec-1",
};
const GROUP = {
  fingerprint: "fp1", exception_type: "KeyError", message: "'vendor_id'", level: "ERROR", kind: "exception", count: 3,
  first_seen: "2026-10-14T04:18:00+00:00", last_seen: "2026-10-14T04:20:00+00:00", last_request_id: "err-0", sample_route: "/api/purchase-orders/{po_id}/receive",
};
const ERROR_ROW = {
  id: 5, at: "2026-10-14T04:20:00+00:00", request_id: "err-0", level: "ERROR", source: "api", kind: "exception",
  exception_type: "KeyError", message: "'vendor_id'", stack: "Traceback (most recent call last):\n  File \"app/purchase_orders/router.py\", line 10, in receive\nKeyError: 'vendor_id'",
  route: "/api/purchase-orders/{po_id}/receive", method: "POST", status_code: 500, actor_id: 1, actor_code: "S0OWN", ip: "127.0.0.1",
  user_agent: "Mozilla/5.0", context: { path_params: { po_id: "40" } }, fingerprint: "fp1",
};
const SYSTEM_ROW = {
  id: 3, at: "2026-10-14T04:00:00+00:00", level: "INFO", component: "erp_sync", event: "sync_success",
  message: "ERP data copied: 1 new, 0 changed, 0 gone PO lines; 0 vendors, 0 items.", details: { new: 1 }, request_id: "job-erp_sync-3fa0c1d2e4b5",
};
const REPORT_ROW = {
  id: 1, at: "2026-10-14T04:21:00+00:00", request_id: REQ, reference: "f6a4c678705041df91534b785bdea61e", actor_id: 9, actor_code: "EMP09",
  route: "/purchase-orders/40", app_version: "8231308", user_agent: "Mozilla/5.0", kind: "USER_REPORT", message: "Reported by the person using the app",
  stack: null, note: "Receive did nothing.",
  breadcrumbs: [{ at: "2026-10-14T04:20:30Z", type: "nav", text: "Opened /purchase-orders/40" }, { at: "2026-10-14T04:20:39Z", type: "click", text: "Clicked “Receive”" }],
  recent_requests: [{ at: "2026-10-14T04:20:40Z", method: "POST", path: "/purchase-orders/{id}/receive", status: 500, ms: 81, requestId: REQ }],
  status: "NEW", fingerprint: "x", reviewed_by: null, reviewed_at: null,
};
const CORRELATION = {
  request_id: REQ, found: true,
  audit: [AUDIT_ROW], security: [], errors: [{ ...ERROR_ROW, at: "2026-10-14T04:20:40.600+00:00", request_id: REQ }], system: [],
  client_reports: [REPORT_ROW],
  access_log: [{ ts: "2026-10-14T04:20:40.587+00:00", kind: "access", request_id: REQ, actor_id: 1, role: "ADMIN", ip: "127.0.0.1",
    method: "PUT", route: "/api/masters/vendors/{item_id}", path: "/api/masters/vendors/1", status: 200, duration_ms: 44.2, sql_count: 7 }],
};
const HEALTH = {
  status: "degraded", version: "8231308", environment: "development", checked_at: "2026-10-14T04:20:41+00:00",
  checks: {
    database: { ok: true, latency_ms: 1.0 }, log_dir: { ok: true, path: "/data/logs", problem: null },
    migrations: { ok: true, code_head: "e6f8", db_head: "e6f8", matches: true, pending: false },
    erp_sync: { ok: false, configured: true, minutes_since_last_success: null },
    table_counts: { asset: 0, audit_log: 44, error_log: 0 },
  },
};
const DB = {
  connected: true, latency_ms: 0.9, server_version: "17.11 (Debian)", database: [{ name: "ckam", size: "12 MB" }],
  connections_by_state: [{ state: "active", connections: 1 }, { state: "idle", connections: 4 }],
  long_running_queries: [], lock_waits: "not permitted", largest_tables: [{ table: "audit_log", size: "1 MB", live_rows: 44 }],
  logging_settings: [], slow_statement_logging_on: true,
};
const BUNDLE = { markdown: "# CKAM diagnostics bundle (2026-10-14)\n- Version: `8231308`", generated_at: "2026-10-14T04:20:41Z", period_hours: 24 };

let pages: Record<string, { data: unknown[]; total: number | null }>;

function mockApi() {
  pages = {
    audit: { data: [AUDIT_ROW], total: 120 },
    security: { data: [SECURITY_ROW], total: 1 },
    groups: { data: [GROUP], total: 1 },
    errors: { data: [ERROR_ROW], total: 3 },
    system: { data: [SYSTEM_ROW], total: 1 },
    reports: { data: [REPORT_ROW], total: 1 },
  };
  (apiClient.getPage as any).mockImplementation((path: string) => {
    if (path.startsWith("/admin/logs/audit")) return Promise.resolve(path.includes("category=SECURITY") || path.includes("category=ACCESS") ? pages.security : pages.audit);
    if (path.startsWith("/admin/logs/errors")) return Promise.resolve(path.includes("group=true") ? pages.groups : pages.errors);
    if (path.startsWith("/admin/logs/system")) return Promise.resolve(pages.system);
    if (path.startsWith("/admin/logs/client-reports")) return Promise.resolve(pages.reports);
    return Promise.resolve({ data: [], total: 0 });
  });
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/capabilities") return Promise.resolve(useAuthStore.getState().isPrimaryOwner ? HEAD_OFFICE : ADMIN_BOTH);
    if (path.startsWith("/admin/logs/request/")) {
      return path.endsWith(REQ) ? Promise.resolve(CORRELATION) : Promise.resolve({ request_id: "x", found: false, audit: [], security: [], errors: [], system: [], client_reports: [], access_log: [] });
    }
    if (path.startsWith("/admin/logs/entity/")) return Promise.resolve([AUDIT_ROW]);
    if (path === "/admin/diagnostics/health") return Promise.resolve(HEALTH);
    if (path === "/admin/diagnostics/db") return Promise.resolve(DB);
    if (path.startsWith("/admin/diagnostics/bundle")) return Promise.resolve(BUNDLE);
    if (path === "/asset-users") return Promise.resolve([{ id: 1, code: "S0OWN", name: "Head Office Admin", login_enabled: true }]);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 1, code: "V1", name: "ARIHANT INFOCOM LLP", gstin: null, contact_name: null, contact_phone: null, contact_email: null, erp_links: [] }]);
    return Promise.resolve([]);
  });
  (apiClient.patch as any).mockImplementation((_p: string, body: { status: string }) => Promise.resolve({ ...REPORT_ROW, status: body.status, reviewed_at: "2026-10-14T05:00:00Z" }));
}

function loginAs(owner: boolean) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: owner, mustChangePassword: false });
}

function renderAt(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const pageCalls = (prefix: string) => (apiClient.getPage as any).mock.calls.map(([p]: [string]) => p).filter((p: string) => p.startsWith(prefix));
const lastCall = (prefix: string) => {
  const calls = pageCalls(prefix);
  return new URLSearchParams(calls[calls.length - 1].split("?")[1]);
};

beforeEach(() => {
  vi.clearAllMocks();
  useReportProblem.getState().close();
  mockApi();
  loginAs(true);
});
afterEach(() => useAuthStore.getState().logout());

describe("S8 Settings › System: head-office admin only", () => {
  it.each(["/settings/system/logs", "/settings/system/diagnostics", `/settings/system/logs/request/${REQ}`])(
    "%s says 'no access' to a Full Admin and asks the server nothing", async (url) => {
      loginAs(false);
      renderAt(url);
      expect(await screen.findByRole("heading", { name: /don't have access/i })).toBeInTheDocument();
      expect(apiClient.getPage).not.toHaveBeenCalled();
      expect((apiClient.get as any).mock.calls.filter(([p]: [string]) => p.startsWith("/admin/"))).toEqual([]);
    },
  );

  it("the Settings landing page lists System › Logs and Diagnostics", async () => {
    renderAt("/settings");
    const system = await screen.findByRole("region", { name: "System" });
    expect(within(system).getByRole("link", { name: "Logs" })).toHaveAttribute("href", "/settings/system/logs");
    expect(within(system).getByRole("link", { name: "Diagnostics" })).toHaveAttribute("href", "/settings/system/diagnostics");
  });
});

describe("S8 Logs › Audit trail", () => {
  it("asks for the last 7 days, 50 at a time, and shows plain words (never raw codes)", async () => {
    renderAt("/settings/system/logs");
    expect(await screen.findByText("Vendor 'ARIHANT INFOCOM LLP' updated: name, gstin.")).toBeInTheDocument();
    const p = lastCall("/admin/logs/audit");
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    expect(p.get("from")).toBe(localDate(weekAgo));
    expect(p.get("to")).toBe(localDate());
    expect(p.get("limit")).toBe("50");
    expect(p.get("offset")).toBe("0");
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Data change · Changed");
    expect(table).toHaveTextContent("Vendor 1");
    expect(table).toHaveTextContent("Done");
    expect(table).toHaveTextContent("Head Office Admin (S0OWN)");
    expect(table).not.toHaveTextContent("UPDATE");
    expect(table).not.toHaveTextContent("DATA");
  });

  it("filters become request parameters (search, reference, period chips, outcome)", async () => {
    renderAt("/settings/system/logs");
    await screen.findByText(/ARIHANT INFOCOM LLP' updated/);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "gstin" } });
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("q")).toBe("gstin"));
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: REQ } });
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("request_id")).toBe(REQ));
    fireEvent.click(screen.getByRole("button", { name: "Last hour" }));
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("from")).toMatch(/^\d{4}-\d{2}-\d{2}T/));
    expect(lastCall("/admin/logs/audit").get("to")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Any time" }));
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("from")).toBeNull());
    fireEvent.click(screen.getByRole("combobox", { name: "Outcome" }));
    fireEvent.click(await screen.findByRole("option", { name: "Refused" }));
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("outcome")).toBe("DENIED"));
    fireEvent.click(screen.getByRole("combobox", { name: "Record type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Vendor" }));
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("entity")).toBe("vendor"));
  });

  it("pages with X-Total-Count: 50 at a time", async () => {
    renderAt("/settings/system/logs");
    expect(await screen.findByText("Showing 1–1 of 120 entries")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("offset")).toBe("50"));
  });

  it("a row opens its details: the sentence, before / after, the reference link and the raw codes", async () => {
    renderAt("/settings/system/logs");
    fireEvent.click(await screen.findByText(/ARIHANT INFOCOM LLP' updated/));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Changed" })).toBeInTheDocument();
    const changes = within(sheet).getByRole("table", { name: "Changes" });
    expect(within(changes).getByRole("row", { name: /Name Good Vendor ARIHANT INFOCOM LLP/ })).toBeInTheDocument();
    expect(within(changes).getByRole("row", { name: /Gstin — 27AAPFU0939F1ZV/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: REQ })).toHaveAttribute("href", `/settings/system/logs/request/${REQ}`);
    expect(within(sheet).getByText("127.0.0.1")).toBeInTheDocument();
    expect(within(sheet).getByTestId("tech-line")).toHaveTextContent("category=DATA · action=UPDATE · entity=vendor");
  });

  it("export downloads the chosen period as CSV / JSONL with the auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"])) });
    window.fetch = fetchMock as never;
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
    window.URL.revokeObjectURL = vi.fn();
    renderAt("/settings/system/logs");
    await screen.findByText(/ARIHANT INFOCOM LLP' updated/);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    const p = new URLSearchParams(String(url).split("?")[1]);
    expect(String(url)).toMatch(/^\/api\/admin\/logs\/export\?/);
    expect(p.get("kind")).toBe("audit");
    expect(p.get("format")).toBe("csv");
    expect(p.get("to")).toBe(localDate());
    expect(init.headers.Authorization).toBe("Bearer tok");
    fireEvent.click(screen.getByRole("button", { name: "Export JSONL" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain("format=jsonl");
  });
});

describe("S8 Logs › Errors, Security, System events, User reports", () => {
  it("Errors: grouped by default; Open shows every occurrence; one opens with its stack trace", async () => {
    renderAt("/settings/system/logs?tab=errors");
    const open = await screen.findByRole("button", { name: "Open 'vendor_id'" });
    expect(lastCall("/admin/logs/errors").get("group")).toBe("true");
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Unexpected error · KeyError");
    expect(within(table).getByText("3")).toBeInTheDocument();
    fireEvent.click(open);
    await waitFor(() => expect(lastCall("/admin/logs/errors").get("fingerprint")).toBe("fp1"));
    expect(lastCall("/admin/logs/errors").get("group")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Every time this happened");
    fireEvent.click(await screen.findByText("POST /api/purchase-orders/{po_id}/receive"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Stack trace")).toHaveTextContent("KeyError: 'vendor_id'");
    expect(within(sheet).getByRole("link", { name: "err-0" })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Context")).toHaveTextContent('"po_id": "40"');
  });

  it("Errors: the ungrouped list on request", async () => {
    renderAt("/settings/system/logs?tab=errors");
    await screen.findByRole("button", { name: "Open 'vendor_id'" });
    fireEvent.click(screen.getByRole("button", { name: "Every occurrence" }));
    await waitFor(() => expect(lastCall("/admin/logs/errors").get("group")).toBeNull());
    expect(await screen.findByText("S0OWN")).toBeInTheDocument();
  });

  it("Security: only security events; Refused / Failed chips; Access events apart", async () => {
    renderAt("/settings/system/logs?tab=security");
    expect(await screen.findByText(/Failed sign-in for 'ravi'/)).toBeInTheDocument();
    expect(lastCall("/admin/logs/audit").get("category")).toBe("SECURITY");
    expect(screen.getByRole("table")).toHaveTextContent("Security · Failed sign-in");
    fireEvent.click(screen.getByRole("button", { name: "Refused" }));
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("outcome")).toBe("DENIED"));
    fireEvent.click(screen.getByRole("button", { name: "Access" }));
    await waitFor(() => expect(lastCall("/admin/logs/audit").get("category")).toBe("ACCESS"));
  });

  it("System events: plain words and level chips", async () => {
    renderAt("/settings/system/logs?tab=system");
    expect(await screen.findByText("ERP data copy · Copy finished")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Warning" }));
    await waitFor(() => expect(lastCall("/admin/logs/system").get("level")).toBe("WARNING"));
  });

  it("User reports: NEW first; the details read as words; Mark reviewed", async () => {
    renderAt("/settings/system/logs?tab=reports");
    fireEvent.click(await screen.findByText("Receive did nothing."));
    expect(lastCall("/admin/logs/client-reports").get("status")).toBe("NEW");
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("list", { name: "Last actions" })).toHaveTextContent("Clicked “Receive”");
    expect(within(sheet).getByRole("table", { name: "Last requests" })).toHaveTextContent("/purchase-orders/{id}/receive");
    expect(within(sheet).getAllByRole("link", { name: REQ }).length).toBeGreaterThan(0);
    fireEvent.click(within(sheet).getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/admin/logs/client-reports/1", { status: "REVIEWED" }));
    await waitFor(() => expect(within(sheet).queryByRole("button", { name: "Mark reviewed" })).not.toBeInTheDocument());
  });
});

describe("S8 Everything for one request", () => {
  it("the search box takes a pasted reference and opens everything for it, in time order", async () => {
    const router = renderAt("/settings/system/logs");
    await screen.findByText(/ARIHANT INFOCOM LLP' updated/);
    fireEvent.change(screen.getByRole("textbox", { name: "Reference to find" }), { target: { value: `Reference: ${REQ}` } });
    fireEvent.click(screen.getByRole("button", { name: "Find everything" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/settings/system/logs/request/${REQ}`));
    const list = await screen.findByRole("list", { name: "Everything for this request" });
    expect(apiClient.get).toHaveBeenCalledWith(`/admin/logs/request/${REQ}`);
    const kinds = Array.from(list.querySelectorAll(":scope > li")).map((li) => li.getAttribute("data-entry"));
    expect(kinds).toEqual(["audit", "access", "error", "report"]);
    expect(list).toHaveTextContent("PUT /api/masters/vendors/{item_id} → 200 in 44 ms · 7 database queries");
    expect(list).toHaveTextContent("Reported by a person: Receive did nothing.");
  });

  it("refuses something that is not a reference", async () => {
    renderAt("/settings/system/logs");
    await screen.findByText(/ARIHANT INFOCOM LLP' updated/);
    fireEvent.change(screen.getByRole("textbox", { name: "Reference to find" }), { target: { value: "not a reference!" } });
    fireEvent.click(screen.getByRole("button", { name: "Find everything" }));
    expect(await screen.findByText(/Paste the reference exactly/)).toBeInTheDocument();
  });

  it("says calmly when nothing is found", async () => {
    renderAt("/settings/system/logs/request/unknown-ref");
    expect(await screen.findByText("Nothing was found for this reference.")).toBeInTheDocument();
  });

  it("offers the support bundle for this request", async () => {
    Object.defineProperty(document, "execCommand", { value: vi.fn().mockReturnValue(true), configurable: true });
    renderAt(`/settings/system/logs/request/${REQ}`);
    fireEvent.click(await screen.findByRole("button", { name: /Copy diagnostics for support/ }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(`/admin/diagnostics/bundle?hours=24&request_id=${REQ}`));
    expect(await screen.findByText("Copied. Paste it into the chat.")).toBeInTheDocument();
  });
});

describe("S8 Diagnostics", () => {
  it("shows health and database figures; 'not permitted' parts are said calmly", async () => {
    renderAt("/settings/system/diagnostics");
    const checks = await screen.findByRole("list", { name: "Health checks" });
    expect(checks).toHaveTextContent("Database · answers in 1 ms");
    expect(checks).toHaveTextContent("Log folder · writable (/data/logs)");
    expect(checks).toHaveTextContent("Database version · up to date");
    expect(checks).toHaveTextContent("ERP data copy · last good copy never");
    expect(screen.getByText("Something needs a look.")).toBeInTheDocument();
    expect(await screen.findByText("Connected · 0.9 ms · PostgreSQL 17.11")).toBeInTheDocument();
    expect(screen.getByText("Active: 1 · Idle: 4")).toBeInTheDocument();
    expect(screen.getByText("None right now.")).toBeInTheDocument();
    expect(screen.getByText("Not visible to the app's database account.")).toBeInTheDocument();
    expect(screen.getByText(/^On — statements slower/)).toBeInTheDocument();
    expect(screen.getByText(BUNDLE_EXPLANATION)).toBeInTheDocument();
  });

  it("Copy diagnostics for support copies the markdown (hours chosen, optional reference)", async () => {
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    renderAt("/settings/system/diagnostics");
    await screen.findByRole("list", { name: "Health checks" });
    fireEvent.click(screen.getByRole("button", { name: "6 h" }));
    fireEvent.change(screen.getByLabelText("Reference (optional)"), { target: { value: "abc123" } });
    fireEvent.click(screen.getByRole("button", { name: /Copy diagnostics for support/ }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/admin/diagnostics/bundle?hours=6&request_id=abc123"));
    expect(await screen.findByText("Copied. Paste it into the chat.")).toBeInTheDocument();
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("when the browser cannot copy, the markdown is shown selected to copy by hand", async () => {
    Object.defineProperty(document, "execCommand", { value: vi.fn().mockReturnValue(false), configurable: true });
    renderAt("/settings/system/diagnostics");
    await screen.findByRole("list", { name: "Health checks" });
    fireEvent.click(screen.getByRole("button", { name: /Copy diagnostics for support/ }));
    const area = await screen.findByLabelText(/cannot copy by itself/);
    expect(area).toHaveValue(BUNDLE.markdown);
    await waitFor(() => expect(document.activeElement).toBe(area));
  });

  it("Download bundle (JSON) saves the answer as a file", async () => {
    const createUrl = vi.fn().mockReturnValue("blob:bundle");
    window.URL.createObjectURL = createUrl;
    window.URL.revokeObjectURL = vi.fn();
    renderAt("/settings/system/diagnostics");
    await screen.findByRole("list", { name: "Health checks" });
    fireEvent.click(screen.getByRole("button", { name: "Download bundle (JSON)" }));
    await waitFor(() => expect(createUrl).toHaveBeenCalled());
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toMatchObject({ markdown: BUNDLE.markdown });
  });
});

describe("S8 Home hint", () => {
  it("shows 'N errors · N user reports need a look → Logs' to the head-office admin", async () => {
    renderAt("/dashboard");
    const row = await screen.findByRole("region", { name: "Logs" });
    expect(row).toHaveTextContent("1 error · 1 user report need a look");
    expect(within(row).getByRole("link", { name: "Logs" })).toHaveAttribute("href", "/settings/system/logs?tab=errors");
    const errorsCall = pageCalls("/admin/logs/errors")[0];
    expect(errorsCall).toContain("group=true");
    expect(errorsCall).toContain("limit=1");
    expect(pageCalls("/admin/logs/client-reports")[0]).toContain("status=NEW");
  });

  it("shows nothing when both are 0, on failure, or for anyone else", async () => {
    pages.groups = { data: [], total: 0 };
    pages.reports = { data: [], total: 0 };
    renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Home" });
    await waitFor(() => expect(pageCalls("/admin/logs/client-reports").length).toBeGreaterThan(0));
    expect(screen.queryByRole("region", { name: "Logs" })).not.toBeInTheDocument();
  });

  it("a failing call is tolerated silently", async () => {
    (apiClient.getPage as any).mockRejectedValue(new Error("Request failed: 500"));
    renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Home" });
    await waitFor(() => expect(pageCalls("/admin/logs/errors").length).toBeGreaterThan(0));
    expect(screen.queryByRole("region", { name: "Logs" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it("a Full Admin's Home never asks", async () => {
    loginAs(false);
    renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Home" });
    expect(pageCalls("/admin/")).toEqual([]);
  });
});

describe("S8 Report a problem, from the header, for any signed-in person", () => {
  it("a View Only person opens it from the header", async () => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "VIEWER", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
    renderAt("/dashboard");
    fireEvent.click(await screen.findByRole("button", { name: "Report a problem" }));
    const dialog = await screen.findByRole("dialog", { name: "Report a problem" });
    expect(within(dialog).getByLabelText(/What were you doing and what went wrong/)).toBeInTheDocument();
    expect(within(dialog).getByTestId("report-attached")).toHaveTextContent("no passwords or typed values");
  });
});

describe("S8 History (record audit trail), head-office admin only", () => {
  function renderVendors() {
    renderAt("/settings/vendors");
  }

  it("Vendor screen renders standalone too (no router needed until History is opened)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><VendorsSetup /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Edit ARIHANT INFOCOM LLP" }));
    expect(await screen.findByRole("button", { name: "History of ARIHANT INFOCOM LLP" })).toBeInTheDocument();
  });

  it("Vendor: the Edit dialog offers History, listing who changed what", async () => {
    renderVendors();
    fireEvent.click(await screen.findByRole("button", { name: "Edit ARIHANT INFOCOM LLP" }));
    fireEvent.click(await screen.findByRole("button", { name: "History of ARIHANT INFOCOM LLP" }));
    const list = await screen.findByRole("list", { name: "History" });
    expect(apiClient.get).toHaveBeenCalledWith("/admin/logs/entity/vendor/1");
    expect(list).toHaveTextContent("Vendor 'ARIHANT INFOCOM LLP' updated: name, gstin.");
    expect(list).toHaveTextContent("Head Office Admin (S0OWN) · Changed");
  });

  it("Vendor: nobody else sees History", async () => {
    loginAs(false);
    // (the Vendors route itself is head-office only; the screen is also embedded in Set up CKAM)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><VendorsSetup /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Edit ARIHANT INFOCOM LLP" }));
    await screen.findByRole("dialog", { name: "Edit Vendor" });
    expect(screen.queryByRole("button", { name: /History/ })).not.toBeInTheDocument();
  });

  it("the button itself: owner only, and nothing without a record id", () => {
    const qc = new QueryClient();
    const { rerender } = render(<QueryClientProvider client={qc}><RecordHistoryButton entity="asset" entityId={9} name="FA/1" /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "History of FA/1" })).toBeInTheDocument();
    rerender(<QueryClientProvider client={qc}><RecordHistoryButton entity="asset" entityId={null} name="FA/1" /></QueryClientProvider>);
    expect(screen.queryByRole("button", { name: /History/ })).not.toBeInTheDocument();
    loginAs(false);
    rerender(<QueryClientProvider client={qc}><RecordHistoryButton entity="asset" entityId={9} name="FA/1" /></QueryClientProvider>);
    expect(screen.queryByRole("button", { name: /History/ })).not.toBeInTheDocument();
  });
});
