import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { piLabel } from "../purchase-orders/PurchaseOrdersList";
import type { PiCandidate, PiWorkRow, PiWorklist } from "./PiReady";

vi.mock("../../lib/api-client");

const CAND: PiCandidate = {
  pi_code: 5001, pi_number: "SPI/001704/26-27", pi_date: "2026-11-11", pi_amount: 1000, vendor_invoice_no: "HS/1008/26-27",
  erp_vendor_name: "VANSH ENTERPRISES", posted: true, amount_check: "matches", vendor_note: null, status: "ready",
};

const row = (over: Partial<PiWorkRow> = {}): PiWorkRow => ({
  po_id: 42, po_number: "SPO/013000/26-27", company_code: "CKSPL", vendor_name: "Vansh Enterprises", invoice_number: "HS/1008/26-27",
  invoice_date: "2026-11-05", invoice_amount: 1000, assets: 4, recorded: 0, candidates: [CAND], state: "ready", ...over,
});

const worklist = (rows: PiWorkRow[], counts = {}): PiWorklist => ({
  copied: true, counts: { ready: rows.filter((r) => r.state === "ready").length, not_posted: rows.filter((r) => r.state === "not_posted").length, waiting: 0, ready_pos: 1, ...counts },
  rows,
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderList(data: unknown) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/erp/pi/ready") return Promise.resolve(data);
    if (path === "/erp/status") return Promise.resolve({ configured: true });
    return Promise.resolve([]);
  });
  (apiClient.post as any).mockResolvedValue([{ po_id: 42, invoice_number: "HS/1008/26-27", pi_number: CAND.pi_number, ok: true, updated: 4, message: null }]);
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/purchase-orders"] }));
  render(<QueryClientProvider client={client()}><RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});

describe("PI ready in the ERP: the Purchase Orders list card and its worklist", () => {
  it("says how many received invoices have a PI in the ERP, and what is still waiting", async () => {
    renderList(worklist([row()], { waiting: 3, not_posted: 1 }));
    const card = await screen.findByLabelText("PI ready in the ERP");
    expect(card).toHaveTextContent("The ERP has the PI for 1 received invoice on 1 purchase order");
    expect(card).toHaveTextContent("3 invoices still waiting for the ERP");
    expect(card).toHaveTextContent("1 PI started in the ERP but not posted yet");
  });

  it("shows nothing when no received invoice has a PI ready (and nothing breaks on an unexpected answer)", async () => {
    renderList(worklist([], { ready: 0 }));
    await screen.findByRole("link", { name: "Pick from ERP" });
    expect(screen.queryByLabelText("PI ready in the ERP")).not.toBeInTheDocument();
  });

  it("is silent when the read fails or is not a worklist", async () => {
    renderList([]);
    await screen.findByRole("link", { name: "Pick from ERP" });
    expect(screen.queryByLabelText("PI ready in the ERP")).not.toBeInTheDocument();
  });

  it("a clean row starts ticked and is added on confirm, naming the PO, the PI and the invoice", async () => {
    renderList(worklist([row()]));
    fireEvent.click(await screen.findByRole("button", { name: "Review and add" }));
    const dialog = await screen.findByRole("dialog", { name: "PI ready in the ERP" });
    expect(within(dialog).getByRole("link", { name: "SPO/013000/26-27" })).toHaveAttribute("href", "/purchase-orders/42");
    expect(within(dialog).getByText(/PI SPI\/001704\/26-27/)).toBeInTheDocument();
    expect(within(dialog).getByText(/amount matches/)).toBeInTheDocument();
    const box = within(dialog).getByRole("checkbox", { name: "Add the PI for invoice HS/1008/26-27 of SPO/013000/26-27" });
    expect(box).toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 PI" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/pi/apply", {
        items: [{ po_id: 42, pi_number: "SPI/001704/26-27", ckam_invoice_number: "HS/1008/26-27" }],
      }),
    );
    expect(await within(dialog).findByRole("status")).toHaveTextContent("1 PI added (4 assets updated)");
  });

  it("a row that needs a look (amount differs, or booked under OTHER) is not ticked until a person ticks it", async () => {
    const differs = row({ invoice_number: "A-1", candidates: [{ ...CAND, pi_number: "PI-A", amount_check: "differs" }] });
    const other = row({ invoice_number: "B-2", candidates: [{ ...CAND, pi_code: 2, pi_number: "PI-B", vendor_note: "Booked under the vendor OTHER in the ERP: check it is this vendor's bill." }] });
    renderList(worklist([differs, other]));
    fireEvent.click(await screen.findByRole("button", { name: "Review and add" }));
    const dialog = await screen.findByRole("dialog", { name: "PI ready in the ERP" });
    expect(within(dialog).getByText(/amount differs from the invoice: check it/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Booked under the vendor OTHER/)).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /invoice A-1/ })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /invoice B-2/ })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Add PI" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /invoice B-2/ }));
    expect(within(dialog).getByRole("button", { name: "Add 1 PI" })).toBeEnabled();
  });

  it("when one bill has two PIs the person chooses which one; nothing is chosen for them", async () => {
    const two = row({ candidates: [CAND, { ...CAND, pi_code: 5002, pi_number: "SPI/001705/26-27" }] });
    renderList(worklist([two]));
    fireEvent.click(await screen.findByRole("button", { name: "Review and add" }));
    const dialog = await screen.findByRole("dialog", { name: "PI ready in the ERP" });
    expect(within(dialog).getByRole("checkbox", { name: /invoice HS\/1008/ })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("radio", { name: "PI SPI/001705/26-27 for invoice HS/1008/26-27" }));
    expect(within(dialog).getByRole("checkbox", { name: /invoice HS\/1008/ })).toBeChecked();      // choosing a PI ticks the row
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 PI" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/pi/apply", {
        items: [{ po_id: 42, pi_number: "SPI/001705/26-27", ckam_invoice_number: "HS/1008/26-27" }],
      }),
    );
  });

  it("a PI started in the ERP but not posted is listed and can never be ticked", async () => {
    const draft = row({ invoice_number: "D-1", state: "not_posted", candidates: [{ ...CAND, pi_number: "PI-DRAFT", posted: false, status: "not_posted" }] });
    renderList(worklist([row(), draft]));
    fireEvent.click(await screen.findByRole("button", { name: "Review and add" }));
    const dialog = await screen.findByRole("dialog", { name: "PI ready in the ERP" });
    const note = within(dialog).getByLabelText("Not posted yet");
    expect(note).toHaveTextContent("PI-DRAFT");
    expect(within(dialog).queryByRole("checkbox", { name: /invoice D-1/ })).not.toBeInTheDocument();
  });

  it("an entry the server refuses is named, and the others still show as added", async () => {
    renderList(worklist([row()]));
    (apiClient.post as any).mockResolvedValue([
      { po_id: 42, invoice_number: "HS/1008/26-27", pi_number: CAND.pi_number, ok: false, updated: 0, message: "PI SPI/001704/26-27 is not posted in the ERP yet, so it cannot be recorded" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Review and add" }));
    const dialog = await screen.findByRole("dialog", { name: "PI ready in the ERP" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 PI" }));
    const status = await within(dialog).findByRole("status");
    expect(status).toHaveTextContent("0 PIs added");
    expect(status).toHaveTextContent("Invoice HS/1008/26-27: PI SPI/001704/26-27 is not posted in the ERP yet");
  });
});

describe("the PI column of the PO list", () => {
  it("reads 'PI ready in ERP' only for a pending PI the ERP has already posted", () => {
    expect(piLabel({ pi_status: "PENDING", pi_ready_invoices: 2 })).toBe("PI ready in ERP");
    expect(piLabel({ pi_status: "PENDING", pi_ready_invoices: 0 })).toBe("Pending");
    expect(piLabel({ pi_status: "PENDING" })).toBe("Pending");
    expect(piLabel({ pi_status: "RECORDED", pi_ready_invoices: 1 })).toBe("Recorded");
    expect(piLabel({ pi_status: "NOT_DELIVERED" })).toBe("—");
  });
});
