import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useLabelSettings } from "@/components/labels/AssetLabel";
import { PrintLabelsAction, fetchAssetsByIds, parseIdList } from "./PrintLabelsAction";
import { LabelSettingsDisclosure } from "./LabelSettingsDisclosure";
import { useScanLabelPrefs } from "./useScanLabelPrefs";

vi.mock("../../lib/api-client");

const asset = (id: number) => ({ id, asset_code: `FA/IT/${id}`, serial_number: `SN-${id}`, description: "Laptop", item_name: "Laptop", erp_item_code: null });

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); } catch { /* no storage */ }
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;   // label pictures
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:x");
  window.URL.revokeObjectURL = vi.fn();
  window.print = vi.fn();
});

describe("PrintLabelsAction (the one 'print these labels' action)", () => {
  it("with the assets in hand: a dialog with the shared settings, a preview, and a print of only those labels", async () => {
    const printed: string[][] = [];
    window.print = vi.fn(() => {
      printed.push(Array.from(document.querySelectorAll(".print-labels-sheet .print-label")).map((l) => l.textContent ?? ""));
    });
    const onPrinted = vi.fn();
    wrap(<PrintLabelsAction assets={[asset(1), asset(2)]} onPrinted={onPrinted} />);
    fireEvent.click(screen.getByRole("button", { name: "Print labels (2)" }));
    const dialog = await screen.findByRole("dialog", { name: "Print 2 labels" });
    expect(within(dialog).getAllByTestId("label-settings")).toHaveLength(1);
    expect(within(dialog).getByTestId("label-preview").querySelectorAll(".print-label")).toHaveLength(2);
    // The preview is not the print sheet: nothing is printable until Print is pressed.
    expect(document.querySelector(".print-labels-sheet")).toBeNull();
    expect(apiClient.get).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Print 2 labels" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(printed).toHaveLength(1);
    expect(printed[0][0]).toContain("FA/IT/1");
    expect(printed[0][1]).toContain("FA/IT/2");
    await waitFor(() => expect(onPrinted).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.querySelector(".print-labels-sheet")).toBeNull();
  });

  it("with only ids (a delivery): loads their label details when opened, 200 per request, in the given order", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    (apiClient.get as any).mockImplementation((path: string) => {
      const wanted = decodeURIComponent(/ids=([^&]*)/.exec(path)![1]).split(",").map(Number);
      return Promise.resolve({ items: [...wanted].reverse().map(asset), total: wanted.length });
    });
    wrap(<PrintLabelsAction assetIds={ids}>Print their labels now</PrintLabelsAction>);
    expect(apiClient.get).not.toHaveBeenCalled();                   // nothing loaded until asked
    fireEvent.click(screen.getByRole("button", { name: "Print their labels now" }));
    const dialog = await screen.findByRole("dialog", { name: "Print 250 labels" });
    await waitFor(() => expect(within(dialog).getByTestId("label-preview").querySelectorAll(".print-label")).toHaveLength(250));
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    expect(apiClient.get).toHaveBeenNthCalledWith(1, `/assets?ids=${encodeURIComponent(ids.slice(0, 200).join(","))}&limit=200`);
    const codes = Array.from(within(dialog).getByTestId("label-preview").querySelectorAll(".print-label")).slice(0, 2).map((l) => l.textContent);
    expect(codes[0]).toContain("FA/IT/1");
    expect(codes[1]).toContain("FA/IT/2");
  });

  it("is disabled when there is nothing to print", () => {
    wrap(<PrintLabelsAction assetIds={[]} />);
    expect(screen.getByRole("button", { name: "Print labels (0)" })).toBeDisabled();
  });

  it("the label size chosen in its settings is the size that prints, and is remembered", async () => {
    const sizes: string[] = [];
    window.print = vi.fn(() => {
      const l = document.querySelector(".print-labels-sheet .print-label") as HTMLElement;
      sizes.push(`${l.style.width} x ${l.style.height}`);
    });
    wrap(<PrintLabelsAction assets={[asset(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Print labels (1)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /label settings/i }));
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Label Size" }));
    fireEvent.click(await screen.findByRole("option", { name: "50 × 25 mm" }));
    expect(within(dialog).getByRole("button", { name: /label settings/i })).toHaveTextContent("50 × 25 mm");
    fireEvent.click(within(dialog).getByRole("button", { name: "Print 1 label" }));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    expect(sizes).toEqual(["50mm x 25mm"]);
    expect(JSON.parse(window.localStorage.getItem("ckam.printLabels.size") ?? "{}")).toMatchObject({ sizeKey: "50x25" });
  });
});

describe("LabelSettingsDisclosure (the one label-settings UI)", () => {
  function Harness({ scan }: { scan?: boolean }) {
    const settings = useLabelSettings();
    const prefs = useScanLabelPrefs();
    return <LabelSettingsDisclosure settings={settings} scanPrefs={scan ? prefs : undefined} />;
  }

  it("is closed by default and says what will print; opening shows contents and size", () => {
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: /label settings/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Barcode + QR · 70 × 20 mm");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();       // no scan toggles outside Move
    fireEvent.click(toggle);
    expect(screen.getByRole("combobox", { name: "Label Contains" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Label Size" })).toBeInTheDocument();
  });

  it("on Move: 'Print labels as I scan' stays visible, 'confirm by scanning' is inside; both are remembered", () => {
    render(<Harness scan />);
    const auto = screen.getByRole("checkbox", { name: "Print labels as I scan" });
    expect(auto).toBeChecked();                                           // default on
    expect(screen.queryByRole("checkbox", { name: /confirm each label/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /label settings/i }));
    const verify = screen.getByRole("checkbox", { name: /confirm each label/i });
    expect(verify).not.toBeChecked();                                     // default off
    fireEvent.click(verify);
    fireEvent.click(auto);
    expect(JSON.parse(window.localStorage.getItem("ckam.movement.prefs") ?? "{}")).toEqual({ autoPrint: false, verify: true });
  });

  it("a custom size shows its millimetres in the summary", () => {
    window.localStorage.setItem("ckam.printLabels.size", JSON.stringify({ sizeKey: "custom", customWidthMm: 60, customHeightMm: 30 }));
    window.localStorage.setItem("ckam.printLabels.symbol", "qr");
    render(<Harness />);
    expect(screen.getByRole("button", { name: /label settings/i })).toHaveTextContent("QR Code · 60 × 30 mm");
  });
});

describe("helpers", () => {
  it("parseIdList keeps only whole positive numbers", () => {
    expect(parseIdList("1, 2,x,0,-3,4.5,7")).toEqual([1, 2, 7]);
    expect(parseIdList(undefined)).toEqual([]);
  });

  it("fetchAssetsByIds returns rows in the order asked, whatever order the server used", async () => {
    (apiClient.get as any).mockResolvedValue({ items: [asset(3), asset(1), asset(2)], total: 3 });
    expect((await fetchAssetsByIds([2, 3, 1])).map((a) => a.id)).toEqual([2, 3, 1]);
  });
});
