import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { useAuthStore } from "../../lib/auth-store";
import { apiClient } from "../../lib/api-client";
import { HEAD_OFFICE } from "../../test-capabilities";
import { NO_FILTERS, assetReportParams } from "./ReportsScreen";

vi.mock("../../lib/api-client");

const COLUMNS = ["Asset Code", "Company", "Item", "Status", "Custom:tag_no"];
const row = (i: number) => ({ "Asset Code": `FA/IT/${i}`, Company: "Citykart Stores", Item: "Laptop", Status: "In Stock", "Custom:tag_no": `T${i}` });

function preview(total: number, offset = 0) {
  const n = Math.max(0, Math.min(50, total - offset));
  return {
    total,
    columns: COLUMNS,
    rows: Array.from({ length: n }, (_, i) => row(offset + i + 1)),
    asset_ids: Array.from({ length: n }, (_, i) => 1000 + offset + i + 1),
    summary: {
      by_status: [{ status: "IN_STOCK", status_label: "In stock", count: 70 }, { status: "ALLOTTED", status_label: "With an employee or store", count: 30 }],
      by_category: [{ category_id: 3, category_name: "Computers", count: 90 }],
      by_item: [{ item_id: 45, item_name: "Laptop", count: 60 }, { item_id: null, item_name: null, count: 5 }],
    },
  };
}

let assetsTotal = 120;
let failPreview: string | null = null;

function mockApi() {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/capabilities") return Promise.resolve({ ...HEAD_OFFICE, companies: [{ id: 1, code: "CKS", name: "Citykart Stores" }, { id: 2, code: "CKV", name: "Citykart Ventures" }] });
    if (path.startsWith("/reports/assets/preview")) {
      if (failPreview) return Promise.reject(new Error(failPreview));
      const offset = Number(new URL(path, "http://x").searchParams.get("offset") ?? 0);
      return Promise.resolve(preview(assetsTotal, offset));
    }
    if (path.startsWith("/reports/movements/preview")) {
      return Promise.resolve({ total: 2, columns: ["Date", "Asset Code", "Event"], rows: [{ Date: "01-10-2026", "Asset Code": "FA/IT/1", Event: "MOVED" }, { Date: "02-10-2026", "Asset Code": "FA/IT/2", Event: "MOVED" }] });
    }
    if (path === "/masters/categories") return Promise.resolve([{ id: 3, name: "Computers", asset_domain: "IT" }]);
    if (path.startsWith("/items")) return Promise.resolve([{ id: 45, name: "Laptop", category_id: 3, subcategory_id: null }]);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 7, name: "Acme Traders", gstin: null }]);
    if (path === "/asset-users") return Promise.resolve([{ id: 9, code: "E9", name: "Ravi Kumar", asset_user_type: "EMPLOYEE", company_id: 1, location_id: null }]);
    return Promise.resolve([]);
  });
}

function renderReports() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/reports"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

const fetchMock = vi.fn();
const previewCalls = () => (apiClient.get as any).mock.calls.map((c: unknown[]) => String(c[0])).filter((p: string) => p.startsWith("/reports/assets/preview"));
const lastPreview = () => new URL(previewCalls().at(-1)!, "http://x").searchParams;

async function pick(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
  // Let the popover close before the next pick (two pickers opened back to back can swallow a choice).
  await waitFor(() => expect(screen.getByRole("combobox", { name: label })).toHaveAttribute("aria-expanded", "false"));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  assetsTotal = 120;
  failPreview = null;
  useAuthStore.getState().setAuth({ accessToken: "test-token", role: "ADMIN", companyId: null, isPrimaryOwner: true, mustChangePassword: false });
  mockApi();
  fetchMock.mockReset().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["xlsx-bytes"])) });
  window.fetch = fetchMock as any;
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
  window.URL.revokeObjectURL = vi.fn();
});
afterEach(() => useAuthStore.getState().logout());

describe("Reports: filter, preview on screen, download the same", () => {
  it("shows the summary and the first 50 rows with the Excel's own columns, the code linking to Asset 360", async () => {
    renderReports();
    expect(await screen.findByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(await screen.findByTestId("report-total")).toHaveTextContent("120");
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByLabelText("By status")).toHaveTextContent("In stock 70");
    expect(within(summary).getByLabelText("Top asset groups")).toHaveTextContent("Computers 90");
    expect(within(summary).getByLabelText("Top Items")).toHaveTextContent("Laptop 60");
    expect(within(summary).getByLabelText("Top Items")).toHaveTextContent("No Item yet 5");
    const table = screen.getByRole("table", { name: "Asset register preview" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Asset Code", "Company", "Item", "Status", "tag_no"]);
    expect(within(table).getAllByRole("row")).toHaveLength(51);
    expect(within(table).getByRole("link", { name: "FA/IT/1" })).toHaveAttribute("href", "/assets/1001");
    expect(lastPreview().get("limit")).toBe("50");
    expect(lastPreview().get("offset")).toBe("0");
    expect(screen.getByRole("link", { name: /find a specific asset/i })).toHaveAttribute("href", "/assets");
  });

  it("pages through the preview 50 at a time", async () => {
    renderReports();
    await screen.findByTestId("report-total");
    expect(screen.getByText("Showing 1–50 of 120 assets")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastPreview().get("offset")).toBe("50"));
    expect(await screen.findByText("Showing 51–100 of 120 assets")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FA/IT/51" })).toHaveAttribute("href", "/assets/1051");
  });

  it("every filter goes to the preview, and Download Excel uses exactly the same filters", async () => {
    renderReports();
    await screen.findByTestId("report-total");
    await pick("Company", "Citykart Ventures");
    await pick("Work area", "IT Team");
    await pick("Status", "In Stock");
    await pick("Asset group", "Computers");
    await pick("Item", /^Laptop/);
    await pick("Vendor", /^Acme Traders/);
    await pick("Person / Place", /Ravi Kumar/);
    fireEvent.change(screen.getByLabelText("PO number"), { target: { value: "PO-77" } });
    fireEvent.change(screen.getByLabelText("Purchased from"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Purchased to"), { target: { value: "2026-03-31" } });
    await waitFor(() => expect(lastPreview().get("po_number")).toBe("PO-77"));
    const p = lastPreview();
    expect(Object.fromEntries([...p.entries()].filter(([k]) => k !== "limit" && k !== "offset"))).toEqual({
      company_id: "2", work_area: "IT", status: "IN_STOCK", category_id: "3", item_id: "45", vendor_id: "7",
      po_number: "PO-77", holder_id: "9", purchase_from: "2026-01-01", purchase_to: "2026-03-31",
    });

    fireEvent.click(screen.getByRole("button", { name: /download excel/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://x");
    expect(url.pathname.endsWith("/reports/export/assets")).toBe(true);
    const exportParams = Object.fromEntries(url.searchParams.entries());
    expect(exportParams).toEqual(Object.fromEntries([...p.entries()].filter(([k]) => k !== "limit" && k !== "offset")));
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }));
  });

  it("a 'to' date before the 'from' date is said in words and blocks the download", async () => {
    renderReports();
    await screen.findByTestId("report-total");
    fireEvent.change(screen.getByLabelText("Purchased from"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Purchased to"), { target: { value: "2026-01-01" } });
    expect(await screen.findByText("The 'to' date cannot be before the 'from' date.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download excel/i })).toBeDisabled();
  });

  it("an empty result says so; a refused preview shows the server's sentence", async () => {
    assetsTotal = 0;
    renderReports();
    expect(await screen.findByText("No assets match these filters.")).toBeInTheDocument();
    failPreview = "The 'to' date cannot be before the 'from' date.";
    await pick("Status", "Lost");
    expect(await screen.findByText(failPreview)).toBeInTheDocument();
  });

  it("a failed download shows the error", async () => {
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    renderReports();
    await screen.findByTestId("report-total");
    fireEvent.click(screen.getByRole("button", { name: /download excel/i }));
    expect(await screen.findByText(/export failed/i)).toBeInTheDocument();
  });

  it("assetReportParams leaves empty filters out", () => {
    expect(assetReportParams(NO_FILTERS)).toBe("");
    expect(assetReportParams({ ...NO_FILTERS, status: "LOST", poNumber: " PO-1 " })).toBe("status=LOST&po_number=PO-1");
  });
});

describe("Reports: Movements and Field change audit tabs", () => {
  async function openTab(name: string) {
    const tab = await screen.findByRole("tab", { name });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  }

  it("Movements: last year by default, preview of the dates, and the download with the same dates", async () => {
    renderReports();
    await openTab("Movements");
    const from = (await screen.findByLabelText("From")) as HTMLInputElement;
    const to = screen.getByLabelText("To") as HTMLInputElement;
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    expect(to.value).toBe(new Date().toISOString().slice(0, 10));
    expect(from.value).toBe(oneYearAgo.toISOString().slice(0, 10));
    fireEvent.change(from, { target: { value: "2026-01-01" } });
    fireEvent.change(to, { target: { value: "2026-02-01" } });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/reports/movements/preview?from_date=2026-01-01&to_date=2026-02-01&limit=50&offset=0"));
    expect(await screen.findByTestId("movements-total")).toHaveTextContent("2");
    expect(within(screen.getByRole("table", { name: "Movement log preview" })).getAllByRole("row")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /download excel/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/reports/export/movements?from_date=2026-01-01&to_date=2026-02-01"), expect.anything(),
    ));
  });

  it("Field change audit: download with the chosen dates", async () => {
    renderReports();
    await openTab("Field change audit");
    fireEvent.change(await screen.findByLabelText("Changes From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Changes To"), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: /download field change audit/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/reports/export/field-changes?from_date=2026-03-01&to_date=2026-04-01"), expect.anything(),
    ));
  });
});
