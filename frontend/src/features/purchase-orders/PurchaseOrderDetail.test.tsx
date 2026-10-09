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
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
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

  it("the Delivery Done dialog asks for Initial Asset User once, above the invoice fields, and sends it with every selected line", async () => {
    mockGets([PENDING_LINE, PENDING_LINE_2]);
    (apiClient.post as any).mockResolvedValue([]);
    renderDetailAt();
    await waitFor(() => expect(screen.getByText("Dell Laptop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /select all pending lines/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark 2 delivery done/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByLabelText(/initial asset user/i)).toHaveLength(1);
    const assetUserLabel = dialog.querySelector('label[for="initial-asset-user"]')!;
    const invoiceLabel = dialog.querySelector('label[for="invoice-number"]')!;
    expect(assetUserLabel.compareDocumentPosition(invoiceLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-2" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "500" } });
    const serials = within(dialog).getAllByLabelText(/^serial number\*?$/i);
    fireEvent.change(serials[0], { target: { value: "SN-A" } });
    fireEvent.change(serials[1], { target: { value: "SN-B" } });

    // Every serial and invoice field is filled, but no asset user yet: still blocked.
    expect(within(dialog).getByRole("button", { name: /confirm/i })).toBeDisabled();

    fireEvent.click(within(dialog).getByLabelText(/initial asset user/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /confirm/i })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 10, serial_number: "SN-A", initial_asset_user_id: 5 },
            { pending_asset_id: 12, serial_number: "SN-B", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  // --- Bulk serial entry: identical units of one line item are grouped ---
  const LAPTOP_2 = { ...PENDING_LINE, id: 13 };
  const LAPTOP_3 = { ...PENDING_LINE, id: 14 };

  async function openDeliveryFor(pending: unknown[]) {
    mockGets(pending);
    (apiClient.post as any).mockResolvedValue([]);
    renderDetailAt();
    await waitFor(() => expect(screen.getAllByText("Dell Laptop").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("checkbox", { name: /select all pending lines/i }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`mark ${pending.length} delivery done`, "i") }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/invoice no/i), { target: { value: "INV-9" } });
    fireEvent.change(within(dialog).getByLabelText(/invoice amount/i), { target: { value: "900" } });
    fireEvent.click(within(dialog).getByLabelText(/initial asset user/i));
    fireEvent.click(await screen.findByText("IT Stock-HO"));
    return dialog;
  }
  const confirmBtn = (d: HTMLElement) => within(d).getByRole("button", { name: /confirm/i });

  it("units of the same line item share one block with one list box, and a pasted list is handed out in order", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2, LAPTOP_3]);

    expect(within(dialog).getByText("3 units")).toBeInTheDocument();
    const box = within(dialog).getByLabelText(/^serial numbers\*?$/i);
    expect(within(dialog).getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA")).toHaveLength(1);

    fireEvent.change(box, { target: { value: "SN-1\nSN-2\n" } });
    expect(within(dialog).getByText(/2 of 3 entered/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(box, { target: { value: "SN-1\r\nSN-2\r\n SN-3 \r\n\r\n" } });
    expect(within(dialog).getByText(/3 of 3 entered/)).toBeInTheDocument();
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 10, serial_number: "SN-1", initial_asset_user_id: 5 },
            { pending_asset_id: 13, serial_number: "SN-2", initial_asset_user_id: 5 },
            { pending_asset_id: 14, serial_number: "SN-3", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  it("No serial number on a multi-unit block sets N/A for every unit in it, while another block takes a list", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2, PENDING_LINE_2]);

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /no serial number for dell laptop/i }));
    expect(within(dialog).getByLabelText(/^serial numbers\*?$/i)).toBeDisabled();
    expect(confirmBtn(dialog)).toBeDisabled(); // the Logitech Mouse block still needs its serial
    fireEvent.change(within(dialog).getByLabelText(/^serial number\*?$/i), { target: { value: "MS-1" } });

    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 10, serial_number: "N/A", initial_asset_user_id: 5 },
            { pending_asset_id: 13, serial_number: "N/A", initial_asset_user_id: 5 },
            { pending_asset_id: 12, serial_number: "MS-1", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  it("too many serials or a duplicate (even across blocks, ignoring case) keeps Confirm disabled and says why", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2, PENDING_LINE_2]);
    const box = within(dialog).getByLabelText(/^serial numbers\*?$/i);
    const mouse = within(dialog).getByLabelText(/^serial number\*?$/i);

    fireEvent.change(box, { target: { value: "A1\nA2\nA3" } });
    expect(within(dialog).getByText(/3 of 2 entered -- 1 too many/)).toBeInTheDocument();
    fireEvent.change(mouse, { target: { value: "M1" } });
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(box, { target: { value: "A1\na1" } });
    expect(within(dialog).getByText(/duplicate: A1, a1|duplicate: A1/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(box, { target: { value: "A1\nA2" } });
    fireEvent.change(mouse, { target: { value: "a2" } });
    expect(within(dialog).getByText(/Duplicate serial: a2/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(mouse, { target: { value: "M1" } });
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
  });

  it("fewer serials than units: Confirm stays blocked until the user ticks 'leave the rest pending', then only the units with serials are sent", async () => {
    const units = [PENDING_LINE, LAPTOP_2, LAPTOP_3, { ...PENDING_LINE, id: 15 }, { ...PENDING_LINE, id: 16 }];
    const dialog = await openDeliveryFor(units);
    const box = within(dialog).getByLabelText(/^serial numbers\*?$/i);

    fireEvent.change(box, { target: { value: "S1\nS2\nS3\nS4" } });
    expect(within(dialog).getByText(/4 of 5 entered/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 unit has no serial yet/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /leave the remaining units pending/i }));
    expect(within(dialog).getByText(/1 will stay pending/)).toBeInTheDocument();
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
    fireEvent.click(confirmBtn(dialog));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders/1/deliver",
        expect.objectContaining({
          lines: [
            { pending_asset_id: 10, serial_number: "S1", initial_asset_user_id: 5 },
            { pending_asset_id: 13, serial_number: "S2", initial_asset_user_id: 5 },
            { pending_asset_id: 14, serial_number: "S3", initial_asset_user_id: 5 },
            { pending_asset_id: 15, serial_number: "S4", initial_asset_user_id: 5 },
          ],
        }),
      ),
    );
  });

  it("the 'leave pending' option never appears for a complete list, and an empty dialog cannot be confirmed even with it ticked", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2]);
    // Nothing entered yet: the notice offers the tick, but delivering zero units is not allowed.
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /leave the remaining units pending/i }));
    expect(confirmBtn(dialog)).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^serial numbers\*?$/i), { target: { value: "X1\nX2" } });
    expect(within(dialog).queryByRole("checkbox", { name: /leave the remaining units pending/i })).not.toBeInTheDocument();
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
  });

  it("serials CKAM already has are flagged as you type, naming the asset, and block Confirm until removed", async () => {
    const dialog = await openDeliveryFor([PENDING_LINE, LAPTOP_2]);
    (apiClient.post as any).mockImplementation((path: string, body: { serials?: string[] }) =>
      path === "/purchase-orders/check-serials"
        ? Promise.resolve({ conflicts: (body.serials ?? []).filter((s) => s === "111").map((s) => ({ serial: s, asset_code: "FA/CKSPL/ITSW/MSWINDOWS/CKAM1" })) })
        : Promise.resolve([]),
    );
    const box = within(dialog).getByLabelText(/^serial numbers\*?$/i);

    fireEvent.change(box, { target: { value: "111\n222" } });
    expect(await within(dialog).findByText(/Serial "111" is already used by asset FA\/CKSPL\/ITSW\/MSWINDOWS\/CKAM1/)).toBeInTheDocument();
    expect(confirmBtn(dialog)).toBeDisabled();
    expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/check-serials", { serials: ["111", "222"] });

    fireEvent.change(box, { target: { value: "333\n222" } });
    await waitFor(() => expect(within(dialog).queryByText(/is already used by asset/)).not.toBeInTheDocument());
    await waitFor(() => expect(confirmBtn(dialog)).not.toBeDisabled());
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
