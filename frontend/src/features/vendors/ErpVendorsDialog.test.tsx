import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { ErpVendorsDialog } from "./ErpVendorsDialog";

vi.mock("../../lib/api-client");

const COMPANIES = [
  { id: 1, code: "CKSPL", name: "Citykart Stores" },
  { id: 2, code: "CKVPL", name: "Citykart Ventures" },
];

const row = (over: object) => ({
  company_id: 1, erp_code: "", name: "", gstin: null, is_active: true, linked_vendor_id: null, linked_vendor_name: null,
  suggested_vendor_id: null, suggested_vendor_name: null, suggestion_reason: null, ...over,
});

const SPL_ROWS = [
  row({ erp_code: "11338", name: "VANSH ENTERPRISES", gstin: "07AAAAA0000A1Z5", linked_vendor_id: 3, linked_vendor_name: "Vansh Enterprises" }),
  row({ erp_code: "555", name: "Harshit Infosolution", suggested_vendor_id: 8, suggested_vendor_name: "Harshit Infosolution", suggestion_reason: "name" }),
  row({ erp_code: "2264", name: "JAGANNATH ENTERPRISES" }),
];
const VPL_ROWS = [
  row({ company_id: 2, erp_code: "61", name: "VANSH ENTERPRISES PVT LTD", gstin: "07AAAAA0000A1Z5", suggested_vendor_id: 3, suggested_vendor_name: "Vansh Enterprises", suggestion_reason: "gstin" }),
];

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ErpVendorsDialog /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Add from ERP" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/masters/companies") return Promise.resolve(COMPANIES);
    if (path === "/erp/vendors?company_id=1") return Promise.resolve(SPL_ROWS);
    if (path === "/erp/vendors?company_id=2") return Promise.resolve(VPL_ROWS);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.delete as any).mockResolvedValue({});
});

describe("Add from ERP (vendors)", () => {
  it("shows linked, suggested and new ERP vendors of the first company", async () => {
    renderDialog();
    expect(await screen.findByText("Linked to Vansh Enterprises")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link Harshit Infosolution to Harshit Infosolution" })).toBeInTheDocument();
    expect(screen.getByText("Link to Harshit Infosolution (same name)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add JAGANNATH ENTERPRISES as a vendor" })).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/erp/vendors?company_id=1");
  });

  it("adds an ERP vendor in the chosen company", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add JAGANNATH ENTERPRISES as a vendor" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/vendors/import", { company_id: 1, erp_vendor_code: "2264" }));
  });

  it("links the suggested existing vendor", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Link Harshit Infosolution to Harshit Infosolution" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/vendors/8/link", { company_id: 1, erp_vendor_code: "555" }));
  });

  it("unlinks only that company's link", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Unlink VANSH ENTERPRISES" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/erp/vendors/3/link?company_id=1&erp_vendor_code=11338"));
  });

  it("lists the other company's suppliers when the company is changed, with the GSTIN match as the reason", async () => {
    renderDialog();
    await screen.findByText("JAGANNATH ENTERPRISES");
    fireEvent.click(screen.getByRole("combobox", { name: "Company" }));
    fireEvent.click(await screen.findByRole("option", { name: "Citykart Ventures" }));
    expect(await screen.findByText("VANSH ENTERPRISES PVT LTD")).toBeInTheDocument();
    expect(screen.queryByText("JAGANNATH ENTERPRISES")).not.toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/erp/vendors?company_id=2");
    fireEvent.click(screen.getByRole("button", { name: "Link VANSH ENTERPRISES PVT LTD to Vansh Enterprises" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/vendors/3/link", { company_id: 2, erp_vendor_code: "61" }));
    expect(screen.getByText("Link to Vansh Enterprises (same GSTIN)")).toBeInTheDocument();
  });

  it("searches by name, ERP code or GSTIN", async () => {
    renderDialog();
    await screen.findByText("JAGANNATH ENTERPRISES");
    fireEvent.change(screen.getByLabelText("Search ERP vendors"), { target: { value: "07aaaaa" } });
    expect(screen.queryByText("JAGANNATH ENTERPRISES")).not.toBeInTheDocument();
    expect(screen.getByText("VANSH ENTERPRISES")).toBeInTheDocument();
  });

  it("shows the server's message when the ERP cannot be read", async () => {
    (apiClient.get as any).mockImplementation((path: string) =>
      path === "/masters/companies" ? Promise.resolve(COMPANIES)
        : Promise.reject(new Error("CKAM is not allowed to read the ERP view (a database grant is missing).")));
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("a database grant is missing");
  });

  it("shows the server's message when adding fails", async () => {
    (apiClient.post as any).mockRejectedValue(new Error("JAGANNATH ENTERPRISES is already a vendor here"));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add JAGANNATH ENTERPRISES as a vendor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already a vendor here");
  });
});
