import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { ErpPiDialog } from "./ErpPiDialog";
import { DeliveryReminderBanner } from "./DeliveryReminders";

vi.mock("../../lib/api-client");

const REMINDER = {
  po_id: 42, po_number: "SPO/012994/26-27", vendor_name: "Vansh Enterprises", to_deliver: 3, last_received: "2026-09-25",
  items: [{ item_code: "CT324973", description: "DELL DESKTOP (Desktop)", erp_received: 7, delivered: 4, ordered: 7, to_deliver: 3, last_received: "2026-09-25", grc_numbers: ["GRC-1", "GRC-2"] }],
};

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});

describe("delivery reminders", () => {
  function renderList(reminders: unknown, configured = true, fail = false) {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/erp/status") return Promise.resolve({ configured });
      if (path === "/erp/reminders") return fail ? Promise.reject(new Error("The ERP database could not be reached.")) : Promise.resolve(reminders);
      return Promise.resolve([]);
    });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/purchase-orders"] }));
    render(<QueryClientProvider client={client()}><RouterProvider router={router} /></QueryClientProvider>);
  }

  it("the Purchase Orders list says which POs have goods received in the ERP but not delivered here", async () => {
    renderList([REMINDER]);
    const card = await screen.findByLabelText("Delivery reminders");
    expect(card).toHaveTextContent("on 1 purchase order that are not marked delivered here");
    expect(screen.getByRole("link", { name: "SPO/012994/26-27" })).toHaveAttribute("href", "/purchase-orders/42");
    expect(card).toHaveTextContent("3 to deliver");
    expect(card).toHaveTextContent("never done automatically");
  });

  it("shows nothing when there are no reminders", async () => {
    renderList([]);
    await screen.findByRole("link", { name: "Pick from ERP" });
    expect(screen.queryByLabelText("Delivery reminders")).not.toBeInTheDocument();
  });

  it("is silent when the ERP is not configured (no reminder request is even made)", async () => {
    renderList([REMINDER], false);
    await screen.findByRole("link", { name: "Pick from ERP" });
    expect(screen.queryByLabelText("Delivery reminders")).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith("/erp/reminders");
  });

  it("is silent when the ERP cannot be reached", async () => {
    renderList([], true, true);
    await screen.findByRole("link", { name: "Pick from ERP" });
    expect(screen.queryByLabelText("Delivery reminders")).not.toBeInTheDocument();
  });

  it("a PO's banner lists what the ERP received against what was delivered here", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/erp/status") return Promise.resolve({ configured: true });
      if (path === "/erp/reminders?po_id=42") return Promise.resolve([REMINDER]);
      return Promise.resolve([]);
    });
    render(<QueryClientProvider client={client()}><DeliveryReminderBanner poId={42} fromErp /></QueryClientProvider>);
    const banner = await screen.findByLabelText("Delivery reminder");
    expect(banner).toHaveTextContent("3 to deliver");
    expect(banner).toHaveTextContent("ERP received 7, delivered here 4 of 7");
    expect(banner).toHaveTextContent("GRC-1, GRC-2, 2026-09-25");
  });

  it("a PO that did not come from the ERP gets no banner and makes no request", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    render(<QueryClientProvider client={client()}><DeliveryReminderBanner poId={5} fromErp={false} /></QueryClientProvider>);
    expect(screen.queryByLabelText("Delivery reminder")).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

describe("PI from the ERP", () => {
  const ROW = {
    pi_number: "PI-100", pi_date: "2026-09-28", pi_amount: 165200, vendor_invoice_no: "INV/1", vendor_invoice_date: "2026-09-20",
    ckam_invoice_number: "INV-1", match: "invoice", assets: 8, recorded: 0, status: "ready",
  };
  const preview = (rows: unknown[], extra = {}) => ({ po_id: 42, po_number: "SPO/1", rows, not_booked: 0, ckam_invoices: ["INV-1"], delivered_assets: 8, ...extra });

  function open(previewData: unknown, error?: Error) {
    (apiClient.get as any).mockImplementation(() => (error ? Promise.reject(error) : Promise.resolve(previewData)));
    (apiClient.post as any).mockResolvedValue([{ invoice_number: "INV-1", updated: ["A1", "A2"], skipped: [] }]);
    render(<QueryClientProvider client={client()}><ErpPiDialog poId={42} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Fetch PI from ERP" }));
  }

  it("shows a ready PI ticked, and records it on confirm", async () => {
    open(preview([ROW]));
    expect(await screen.findByText(/PI PI-100 · 2026-09-28/)).toBeInTheDocument();
    expect(screen.getByText("Ready to record")).toBeInTheDocument();
    expect(screen.getByText(/delivered here as INV-1 \(8 assets\)/)).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: "Record PI PI-100" });
    expect(box).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /^record 1 pi$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/42/pi/apply", {
        items: [{ pi_number: "PI-100", ckam_invoice_number: "INV-1", overwrite: false }],
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Recorded. 2 asset(s) updated");
  });

  it("a PI that does not match any delivered invoice cannot be ticked", async () => {
    open(preview([{ ...ROW, pi_number: "PI-200", ckam_invoice_number: null, match: "none", assets: 0, status: "no_match" }]));
    expect(await screen.findByText("No matching invoice delivered here")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Record PI PI-200" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^record\s*pi$/i })).toBeDisabled();
  });

  it("an already-recorded PI is shown as done and a different one needs 'replace' to overwrite", async () => {
    open(preview([
      { ...ROW, pi_number: "PI-100", status: "done", recorded: 8 },
      { ...ROW, pi_number: "PI-101", ckam_invoice_number: "INV-2", status: "different", recorded: 8 },
    ]));
    expect(await screen.findByText("Already recorded")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Record PI PI-100" })).toBeDisabled();
    const diff = screen.getByRole("checkbox", { name: "Record PI PI-101" });
    expect(diff).not.toBeDisabled();
    fireEvent.click(diff);
    fireEvent.click(screen.getByRole("checkbox", { name: "Replace the PI already recorded for INV-2" }));
    fireEvent.click(screen.getByRole("button", { name: /^record 1 pi$/i }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/erp/purchase-orders/42/pi/apply", {
        items: [{ pi_number: "PI-101", ckam_invoice_number: "INV-2", overwrite: true }],
      }),
    );
  });

  it("says so when the ERP has no PI yet", async () => {
    open(preview([], { not_booked: 1 }));
    expect(await screen.findByText(/The ERP has no PI for this purchase order yet \(1 invoice\(s\) are not booked\)/)).toBeInTheDocument();
  });

  it("shows the server's message when the ERP cannot be read", async () => {
    open(null, new Error("The ERP view this screen reads does not exist yet."));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not exist yet");
  });
});
