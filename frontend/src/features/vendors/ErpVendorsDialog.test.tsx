import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { ErpVendorsDialog } from "./ErpVendorsDialog";

vi.mock("../../lib/api-client");

const ROWS = [
  { erp_code: "11338", name: "VANSH ENTERPRISES", gstin: "07AAAAA0000A1Z5", is_active: true, linked_vendor_id: 3, linked_vendor_name: "Vansh Enterprises", suggested_vendor_id: null, suggested_vendor_name: null },
  { erp_code: "555", name: "Harshit Infosolution", gstin: null, is_active: true, linked_vendor_id: null, linked_vendor_name: null, suggested_vendor_id: 8, suggested_vendor_name: "Harshit Infosolution" },
  { erp_code: "2264", name: "JAGANNATH ENTERPRISES", gstin: null, is_active: true, linked_vendor_id: null, linked_vendor_name: null, suggested_vendor_id: null, suggested_vendor_name: null },
];

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ErpVendorsDialog /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Add from ERP" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.get as any).mockResolvedValue(ROWS);
  (apiClient.post as any).mockResolvedValue({});
  (apiClient.delete as any).mockResolvedValue({});
});

describe("Add from ERP (vendors)", () => {
  it("shows linked, suggested and new ERP vendors", async () => {
    renderDialog();
    expect(await screen.findByText("Linked to Vansh Enterprises")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link Harshit Infosolution to Harshit Infosolution" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add JAGANNATH ENTERPRISES as a vendor" })).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/erp/vendors");
  });

  it("adds an ERP vendor", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Add JAGANNATH ENTERPRISES as a vendor" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/vendors/import", { erp_vendor_code: "2264" }));
  });

  it("links the suggested existing vendor", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Link Harshit Infosolution to Harshit Infosolution" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/vendors/8/link", { erp_vendor_code: "555" }));
  });

  it("unlinks a linked vendor", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Unlink VANSH ENTERPRISES" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/erp/vendors/3/link"));
  });

  it("searches by name, ERP code or GSTIN", async () => {
    renderDialog();
    await screen.findByText("JAGANNATH ENTERPRISES");
    fireEvent.change(screen.getByLabelText("Search ERP vendors"), { target: { value: "07aaaaa" } });
    expect(screen.queryByText("JAGANNATH ENTERPRISES")).not.toBeInTheDocument();
    expect(screen.getByText("VANSH ENTERPRISES")).toBeInTheDocument();
  });

  it("shows the server's message when the ERP cannot be read", async () => {
    (apiClient.get as any).mockRejectedValue(new Error("CKAM is not allowed to read the ERP view (a database grant is missing)."));
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
