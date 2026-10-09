import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { AddBundleDialog, splitAmounts } from "./AddBundleDialog";

vi.mock("../../lib/api-client");

const part = (id: number, name: string, share: number, serial: boolean) => ({
  id, name, category_id: id, subcategory_id: null, serial_required: serial, share_percent: share, sort_order: id,
});
const DESKTOP = {
  id: 1, name: "Desktop", is_active: true,
  parts: [part(11, "CPU", 70, true), part(12, "TFT", 26, true), part(13, "Keyboard", 2, false), part(14, "Mouse", 2, false)],
};

function renderDialog(onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AddBundleDialog poId={7} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.get as any).mockImplementation((path: string) => Promise.resolve(path === "/bundles" ? [DESKTOP] : []));
  (apiClient.post as any).mockResolvedValue([]);
});

async function fillDesktop(price = "20000") {
  fireEvent.click(await screen.findByLabelText(/^bundle\*?$/i));
  fireEvent.click(await screen.findByText("Desktop"));
  fireEvent.change(screen.getByLabelText(/^description\*?$/i), { target: { value: "Dell Desktop i3" } });
  fireEvent.change(screen.getByLabelText(/^barcode\*?$/i), { target: { value: "CT324973" } });
  fireEvent.change(screen.getByLabelText(/^quantity\*?$/i), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText(/price per bundle/i), { target: { value: price } });
}

describe("splitAmounts", () => {
  it("splits by share and always adds up to the price exactly", () => {
    expect(splitAmounts(20000, [70, 26, 2, 2])).toEqual([14000, 5200, 400, 400]);
    expect(splitAmounts(16000, [70, 26, 2, 2])).toEqual([11200, 4160, 320, 320]);
    for (const price of [10001, 12345.67, 999.99, 0.05]) {
      const total = splitAmounts(price, [70, 26, 2, 2]).reduce((a, b) => a + Math.round(b * 100), 0);
      expect(total).toBe(Math.round(price * 100));
    }
  });
});

describe("AddBundleDialog", () => {
  it("proposes each part's amount from the bundle's shares, with totals before and after tax", async () => {
    renderDialog();
    await fillDesktop("20000");

    expect(screen.getByLabelText("Amount for CPU")).toHaveValue(14000);
    expect(screen.getByLabelText("Amount for TFT")).toHaveValue(5200);
    expect(screen.getByLabelText("Amount for Keyboard")).toHaveValue(400);
    expect(screen.getByLabelText("Amount for Mouse")).toHaveValue(400);
    expect(screen.getByRole("status")).toHaveTextContent("20,000.00 (matches the price)");
    expect(screen.getByText("23,600.00", { selector: "td" })).toBeInTheDocument(); // 20,000 + 18% tax
    expect(screen.getByText(/This will add 16 lines: 4 CPU, 4 TFT, 4 Keyboard, 4 Mouse\./)).toBeInTheDocument();
    expect(screen.getAllByText("No serial")).toHaveLength(2);
  });

  it("blocks Add until the edited amounts add up to the price again", async () => {
    renderDialog();
    await fillDesktop("16000");
    const add = screen.getByRole("button", { name: /^add bundle$/i });
    expect(add).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText("Amount for CPU"), { target: { value: "11000" } });
    expect(screen.getByRole("status")).toHaveTextContent("must equal 16,000.00");
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Amount for TFT"), { target: { value: "4500" } });
    fireEvent.change(screen.getByLabelText("Amount for Keyboard"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Amount for Mouse"), { target: { value: "250" } });
    await waitFor(() => expect(add).not.toBeDisabled());
  });

  it("sends the bundle, quantity, price, tax and every part's amount, then closes", async () => {
    const onOpenChange = renderDialog();
    await fillDesktop("16000");
    fireEvent.change(screen.getByLabelText(/^warranty years/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /^add bundle$/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders/7/bundle-lines", {
        bundle_id: 1, description: "Dell Desktop i3", barcode: "CT324973", quantity: 4, price: 16000,
        tax_percent: 18, warranty_years: 1,
        parts: [
          { part_id: 11, amount: 11200 }, { part_id: 12, amount: 4160 },
          { part_id: 13, amount: 320 }, { part_id: 14, amount: 320 },
        ],
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("needs a bundle, description, barcode and price before Add is enabled", async () => {
    renderDialog();
    const add = await screen.findByRole("button", { name: /^add bundle$/i });
    expect(add).toBeDisabled();
    await fillDesktop("1000");
    expect(add).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^barcode\*?$/i), { target: { value: "  " } });
    expect(add).toBeDisabled();
  });

  it("explains when no bundle exists yet", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText(/No bundles are set up yet/)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByLabelText(/^description/i)).not.toBeInTheDocument();
  });
});
