import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

// S3b-2: registrations of one supplier (same company PAN) are one group.
describe("Add from ERP: grouped by company PAN", () => {
  const blue = (code: string, name: string, over: object = {}) => row({
    erp_code: code, name, gstin: `09AAACB4487D1Z${code.slice(-1)}`, pan: "AAACB4487D", group_key: "1:AAACB4487D", group_size: 3, ...over,
  });
  const BLUE_NEW = [blue("BS1", "BLUE STAR LIMITED"), blue("BS2", "BLUE STAR LTD (MP)"), blue("BS3", "Blue Star Limited-KOLKATA")];
  const BLUE_PART_LINKED = [
    blue("BS1", "BLUE STAR LIMITED", { linked_vendor_id: 31, linked_vendor_name: "Blue Star Limited", group_linked_to_vendor_id: 31 }),
    blue("BS2", "BLUE STAR LTD (MP)", { group_linked_to_vendor_id: 31, suggested_vendor_id: 31, suggested_vendor_name: "Blue Star Limited", suggestion_reason: "pan" }),
    blue("BS3", "Blue Star Limited-KOLKATA", { group_linked_to_vendor_id: 31, suggested_vendor_id: 31, suggested_vendor_name: "Blue Star Limited", suggestion_reason: "pan" }),
  ];

  function serve(rows: object[]) {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/masters/companies") return Promise.resolve(COMPANIES);
      if (path === "/masters/vendors") return Promise.resolve([{ id: 31, name: "Blue Star Limited" }, { id: 3, name: "Vansh Enterprises" }]);
      if (path === "/erp/vendors?company_id=1") return Promise.resolve(rows);
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
  }

  it("shows a group as one supplier with its registrations, and adds ONE vendor linking all of them", async () => {
    serve([...BLUE_NEW, ...SPL_ROWS]);
    renderDialog();
    const group = await screen.findByRole("listitem", { name: "BLUE STAR LIMITED group" });
    expect(group).toHaveTextContent("BLUE STAR LIMITED — 3 registrations");
    expect(group).toHaveTextContent("PAN AAACB4487D");
    expect(within(group).getByText("Blue Star Limited-KOLKATA")).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Add one vendor and link all 3" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/vendors/import-group", { company_id: 1, erp_vendor_codes: ["BS1", "BS2", "BS3"] }));
  });

  it("when part of the group is already linked, links the rest to that vendor (link-many), never a second vendor", async () => {
    serve(BLUE_PART_LINKED);
    renderDialog();
    const group = await screen.findByRole("listitem", { name: "BLUE STAR LIMITED group" });
    expect(group).toHaveTextContent("2 not linked yet");
    expect(within(group).queryByRole("button", { name: /add one vendor/i })).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Link all 2 to Blue Star Limited" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/vendors/31/link-many", { company_id: 1, erp_vendor_codes: ["BS2", "BS3"] }));
    // Single-supplier actions stay, with the PAN reason in words.
    expect(within(group).getAllByText("Link to Blue Star Limited (same company PAN)").length).toBe(2);
  });

  it("links a whole group to any other vendor", async () => {
    serve(BLUE_NEW);
    renderDialog();
    const group = await screen.findByRole("listitem", { name: "BLUE STAR LIMITED group" });
    fireEvent.click(within(group).getByRole("combobox", { name: "Link all of BLUE STAR LIMITED to another vendor" }));
    fireEvent.click(await screen.findByRole("option", { name: "Vansh Enterprises" }));
    fireEvent.click(within(group).getByRole("button", { name: "Link all 3 of BLUE STAR LIMITED to the chosen vendor" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/vendors/3/link-many", { company_id: 1, erp_vendor_codes: ["BS1", "BS2", "BS3"] }));
  });

  it("a GSTIN-twin refusal is shown as the server wrote it", async () => {
    serve(BLUE_NEW);
    const sentence = "BLUE STAR LTD (MP) has the same GSTIN as Blue Star MP Office, which is already a vendor here. Link it to Blue Star MP Office instead.";
    (apiClient.post as any).mockRejectedValue(new Error(sentence));
    renderDialog();
    const group = await screen.findByRole("listitem", { name: "BLUE STAR LIMITED group" });
    fireEvent.click(within(group).getByRole("button", { name: "Add one vendor and link all 3" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
  });

  it("every supplier is reachable: pages of groups instead of a 100-row cap, and search by PAN", async () => {
    const many = Array.from({ length: 146 }, (_, i) => row({ erp_code: String(1000 + i), name: `SUPPLIER ${String(i + 1).padStart(3, "0")}` }));
    serve(many);
    renderDialog();
    expect(await screen.findByText("SUPPLIER 001")).toBeInTheDocument();
    expect(screen.queryByText("SUPPLIER 026")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pages")).toHaveTextContent("146 suppliers in 146 groups · page 1 of 6");
    for (let p = 0; p < 5; p++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("SUPPLIER 146")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Search ERP vendors"), { target: { value: "supplier 077" } });
    expect(await screen.findByText("SUPPLIER 077")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pages")).not.toBeInTheDocument();
  });

  it("finds a group by its PAN", async () => {
    serve([...BLUE_NEW, ...SPL_ROWS]);
    renderDialog();
    await screen.findByText("JAGANNATH ENTERPRISES");
    fireEvent.change(screen.getByLabelText("Search ERP vendors"), { target: { value: "aaacb4487d" } });
    expect(screen.queryByText("JAGANNATH ENTERPRISES")).not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "BLUE STAR LIMITED group" })).toBeInTheDocument();
  });
});
