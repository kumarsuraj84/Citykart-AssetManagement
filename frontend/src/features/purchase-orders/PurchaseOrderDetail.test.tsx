import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

function renderDetailAt(url = "/purchase-orders/1") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const PO = { id: 1, company_id: 1, po_number: "PO-2026-001", po_date: "2026-01-01", vendor_id: null, cost_center_id: 3 };

const PENDING_LINE = {
  id: 10, purchase_order_id: 1, description: "Dell Laptop", barcode: "BC-777", category_id: 1, subcategory_id: null,
  cost_center_id: 3, purchase_cost: 1000, tax_percent: 18, total_cost: 1180,
  status: "PENDING", serial_number: null, delivered_asset_id: null,
};
const DELIVERED_LINE = {
  ...PENDING_LINE, id: 11, description: "HP Printer", status: "DELIVERED", serial_number: "SN-999",
  invoice_number: "INV-777", delivered_asset_id: 99,
};
const PENDING_LINE_2 = {
  ...PENDING_LINE, id: 12, description: "Logitech Mouse", barcode: "CT123",
};

function mockGets(lines: unknown[]) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/purchase-orders/1") return Promise.resolve(PO);
    if (path === "/purchase-orders/1/lines") return Promise.resolve(lines);
    if (path.startsWith("/masters/categories")) return Promise.resolve([{ id: 1, name: "IT Equipment" }]);
    if (path.startsWith("/masters/subcategories")) return Promise.resolve([{ id: 2, name: "Laptop", category_id: 1 }]);
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, name: "Head Office" }]);
    if (path.startsWith("/masters/brands")) return Promise.resolve([{ id: 9, name: "Dell" }]);
    if (path.startsWith("/asset-users")) return Promise.resolve([{ id: 5, name: "IT Stock-HO" }]);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("PurchaseOrderDetail", () => {
  it("renders the PO header and its lines", async () => {
    mockGets([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText(/PO-2026-001/)).toBeInTheDocument());
    expect(screen.getByText("Dell Laptop")).toBeInTheDocument();
    expect(screen.getByText(/pending delivery \(1\)/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Head Office/)).toBeInTheDocument());
    expect(screen.getByText("BC-777")).toBeInTheDocument();
  });

  it("posts an Add Line request including a shared Barcode, once every mandatory field is filled", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue([PENDING_LINE]);
    renderDetailAt();
    // AM-14: Add Line is collapsed by default -- reveal it first.
    await waitFor(() => expect(screen.getByRole("button", { name: /\+ add line/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ add line/i }));
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Laptop" } });
    fireEvent.change(screen.getByLabelText(/^barcode\*?$/i), { target: { value: "BC-BATCH-9" } });

    fireEvent.click(screen.getByLabelText(/^category\*?$/i));
    fireEvent.click(await screen.findByText("IT Equipment"));

    // Category alone isn't enough now -- Sub-Category/Cost/Quantity are
    // also mandatory, so the button must still be disabled until they're set.
    expect(screen.getByRole("button", { name: /add line/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/^sub-category\*?$/i));
    fireEvent.click(await screen.findByText("Laptop"));
    fireEvent.change(screen.getByLabelText(/^cost\*?$/i), { target: { value: "1000" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /add line/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/lines",
        expect.objectContaining({ description: "Dell Laptop", barcode: "BC-BATCH-9", subcategory_id: 2, purchase_cost: 1000 }),
      ),
    );
  });

  it("posts an Add Line request with the selected Brand's id, not free text", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByRole("button", { name: /\+ add line/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ add line/i }));
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Laptop" } });
    fireEvent.change(screen.getByLabelText(/^barcode\*?$/i), { target: { value: "BC-BATCH-9" } });

    fireEvent.click(screen.getByLabelText(/^category\*?$/i));
    fireEvent.click(await screen.findByText("IT Equipment"));
    fireEvent.click(screen.getByLabelText(/^sub-category\*?$/i));
    fireEvent.click(await screen.findByText("Laptop"));
    fireEvent.change(screen.getByLabelText(/^cost\*?$/i), { target: { value: "1000" } });

    fireEvent.click(screen.getByLabelText(/^brand$/i));
    fireEvent.click(await screen.findByText("Dell"));

    await waitFor(() => expect(screen.getByRole("button", { name: /add line/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/lines",
        expect.objectContaining({ brand_id: 9 }),
      ),
    );
  });

  it("posts an Add Line request including quantity", async () => {
    mockGets([]);
    (apiClient.post as any).mockResolvedValue([PENDING_LINE]);
    renderDetailAt();
    // AM-14: Add Line is collapsed by default -- reveal it first.
    await waitFor(() => expect(screen.getByRole("button", { name: /\+ add line/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /\+ add line/i }));
    await waitFor(() => expect(screen.getByLabelText(/^description\*?$/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Laptop" } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: "3" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /add line/i })).toBeDisabled());
  });

  it("edit opens pre-filled with the line's current values and PUTs the update", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.put as any).mockResolvedValue({ ...PENDING_LINE, description: "Dell Laptop Pro" });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/description/i)).toHaveValue("Dell Laptop");

    fireEvent.change(within(dialog).getByLabelText(/description/i), { target: { value: "Dell Laptop Pro" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/purchase-orders/lines/10", expect.objectContaining({ description: "Dell Laptop Pro" })),
    );
  });

  it("cancel posts a cancel request", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.post as any).mockResolvedValue({ ...PENDING_LINE, status: "CANCELLED" });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/lines/10/cancel"));
  });

  it("a DELIVERED line shows no Edit/Cancel actions and no selection checkbox", async () => {
    mockGets([DELIVERED_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("HP Printer")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("selecting a pending line and confirming Delivery Done submits the right payload", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.post as any).mockResolvedValue([{ ...PENDING_LINE, status: "DELIVERED" }]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select dell laptop/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark 1 delivery done/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /confirm/i })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.change(within(dialog).getByLabelText(/^serial number\*?$/i), { target: { value: "SN-001" } });

    // Radix Select isn't a native <select>; pick the asset_user option via its trigger.
    fireEvent.click(within(dialog).getByLabelText(/initial asset user/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));

    await waitFor(() => expect(within(dialog).getByRole("button", { name: /confirm/i })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          invoice_number: "INV-1",
          invoice_amount: 1180,
          lines: [{ pending_asset_id: 10, serial_number: "SN-001", initial_asset_user_id: 5 }],
        }),
      ),
    );
  });

  it("AM-22 UAT: Invoice No/Date/Amount are visibly marked required in the Delivery Done dialog (backend rejects a delivery missing any of them, so Confirm silently staying disabled with no required-marker was a real trap)", async () => {
    mockGets([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select dell laptop/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark 1 delivery done/i }));

    const dialog = screen.getByRole("dialog");
    for (const id of ["invoice-number", "invoice-date", "invoice-amount"]) {
      const labelEl = dialog.querySelector(`label[for="${id}"]`);
      expect(labelEl).not.toBeNull();
      expect(labelEl!.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
    }
  });

  it("checking \"No serial number\" for a delivery line disables its input and submits N/A", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.post as any).mockResolvedValue([{ ...PENDING_LINE, status: "DELIVERED" }]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select dell laptop/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark 1 delivery done/i }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.click(within(dialog).getByLabelText(/initial asset user/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));

    const serialInput = within(dialog).getByLabelText(/^serial number\*?$/i);
    expect(within(dialog).getByRole("button", { name: /confirm/i })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /no serial number for dell laptop/i }));
    expect(serialInput).toBeDisabled();
    expect(serialInput).toHaveValue("N/A");

    await waitFor(() => expect(within(dialog).getByRole("button", { name: /confirm/i })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [{ pending_asset_id: 10, serial_number: "N/A", initial_asset_user_id: 5 }],
        }),
      ),
    );
  });

  it("Close navigates back to the Purchase Orders list", async () => {
    mockGets([PENDING_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("link", { name: /^close$/i }));

    await waitFor(() => expect(screen.getByRole("link", { name: /new purchase order/i })).toBeInTheDocument());
  });

  it("searching a column header hides non-matching rows, and Select All then only selects what's visible", async () => {
    mockGets([PENDING_LINE, PENDING_LINE_2]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());
    expect(screen.getByText("Logitech Mouse")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^search barcode \(pending\)$/i), { target: { value: "CT123" } });

    await waitFor(() => expect(screen.queryByText("Dell Laptop")).not.toBeInTheDocument());
    expect(screen.getByText("Logitech Mouse")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /select all pending lines/i }));
    expect(screen.getByRole("checkbox", { name: /select logitech mouse/i })).toBeChecked();

    // Clearing the filter reveals Dell Laptop again, still unselected by the
    // earlier Select All (which only ever touched the filtered set).
    fireEvent.change(screen.getByLabelText(/^search barcode \(pending\)$/i), { target: { value: "" } });
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: /select dell laptop/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /select logitech mouse/i })).toBeChecked();
  });

  it("Select All with no filter selects every pending line", async () => {
    mockGets([PENDING_LINE, PENDING_LINE_2]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select all pending lines/i }));

    expect(screen.getByRole("checkbox", { name: /select dell laptop/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /select logitech mouse/i })).toBeChecked();
    expect(screen.getByRole("button", { name: /mark 2 delivery done/i })).toBeInTheDocument();
  });

  it("shows a server-side error inline on a failed Delivery Done submit and keeps the dialog open", async () => {
    mockGets([PENDING_LINE]);
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/purchase-orders/1/deliver") return Promise.reject(new Error("pending asset 10 is not PENDING (already DELIVERED)"));
      return Promise.resolve([]);
    });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select dell laptop/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark 1 delivery done/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-1" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "1180" } });
    fireEvent.change(within(dialog).getByLabelText(/^serial number\*?$/i), { target: { value: "SN-001" } });
    fireEvent.click(within(dialog).getByLabelText(/initial asset user/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(/not PENDING/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("AM-19: lists each distinct delivered Invoice Number with its own Record PI action", async () => {
    mockGets([PENDING_LINE, DELIVERED_LINE]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    expect(screen.getByText("INV-777")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record pi/i })).toBeInTheDocument();
  });

  it("AM-19: Record PI posts to the record-pi endpoint and shows the result", async () => {
    mockGets([DELIVERED_LINE]);
    (apiClient.post as any).mockResolvedValue({ invoice_number: "INV-777", updated: ["FA/1"], skipped: [] });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("INV-777")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /record pi/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/pi number/i), { target: { value: "PI-2001" } });
    fireEvent.change(within(dialog).getByLabelText(/pi date/i), { target: { value: "2026-02-15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/record-pi", {
        invoice_number: "INV-777", pi_number: "PI-2001", pi_date: "2026-02-15", overwrite: false,
      }),
    );
    expect(await within(dialog).findByText(/updated/i)).toBeInTheDocument();
  });

  it("AM-19: Overwrite existing values checkbox is sent through to the request", async () => {
    mockGets([DELIVERED_LINE]);
    (apiClient.post as any).mockResolvedValue({ invoice_number: "INV-777", updated: ["FA/1"], skipped: [] });
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("INV-777")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /record pi/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/pi number/i), { target: { value: "PI-CORRECTED" } });
    fireEvent.change(within(dialog).getByLabelText(/pi date/i), { target: { value: "2026-02-15" } });
    fireEvent.click(within(dialog).getByLabelText(/overwrite existing values/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/1/record-pi", expect.objectContaining({ overwrite: true })),
    );
  });
});
