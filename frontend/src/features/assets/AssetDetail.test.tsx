import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetDetail } from "./AssetDetail";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");
vi.mock("../../lib/auth-store");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// The QR image fetches /assets/{id}/qr.png with the bearer token itself (same reason
// as ReportsScreen's exports: a plain <img src="/api/..."> never carries the
// Authorization header this app relies on everywhere else, so it would just 401).
// Stub it to a harmless failed response by default so the two pre-existing tests
// below don't trip an unmocked window.fetch; the QR-specific test overrides it.
beforeEach(() => {
  (useAuthStore as any).getState = vi.fn().mockReturnValue({ accessToken: null });
  window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any;
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-qr");
  window.URL.revokeObjectURL = vi.fn();
});

// Same click-based interaction as AddAssetForm.test.tsx (Task 17) and HoldersScreen's own tests
// (Task 10) use for a real shadcn/ui Select: it's a Radix combobox trigger + listbox, not a
// native <select>, so it must be driven by clicking the trigger then the option -- a plain
// fireEvent.change on it is a no-op.
async function pickSelectOption(label: RegExp | string, optionName: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

describe("AssetDetail", () => {
  it("only shows actions valid for the current status and posts the chosen action", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/1") {
        return Promise.resolve({
          id: 1,
          asset_code: "FA/HO01/IT/LAP/CK_1",
          description: "Laptop",
          status: "IN_STOCK",
          company_id: 1,
        });
      }
      if (path === "/assets/1/events") return Promise.resolve([]);
      if (path.startsWith("/holders")) return Promise.resolve([{ id: 5, name: "Ankur" }]);
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockResolvedValue({ id: 99, status_after: "ALLOTTED" });

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /move \/ allot/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /receive from repair/i })).not.toBeInTheDocument();

    // Holders are scoped to the asset's own company, not fetched unscoped -- matches the
    // Initial Holder select's scoping in AddAssetForm.tsx.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/holders?company_id=1"));

    fireEvent.click(screen.getByRole("button", { name: /move \/ allot/i }));
    await pickSelectOption(/holder/i, "Ankur");
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/1/events", expect.objectContaining({
      event_type: "MOVED", to_holder_id: 5,
    })));
  });

  it("hides all action buttons for HOLDER-role viewers", async () => {
    (useAuthStore as any).mockImplementation((selector: any) => {
      const state = { role: "HOLDER", accessToken: null, companyId: null, mustChangePassword: false };
      return selector ? selector(state) : state;
    });
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/1") {
        return Promise.resolve({
          id: 1,
          asset_code: "FA/HO01/IT/LAP/CK_1",
          description: "Laptop",
          status: "IN_STOCK",
          company_id: 1,
        });
      }
      if (path === "/assets/1/events") return Promise.resolve([]);
      if (path.startsWith("/holders")) return Promise.resolve([{ id: 5, name: "Ankur" }]);
      return Promise.resolve([]);
    });

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /move \/ allot/i })).not.toBeInTheDocument();
    // Still zero *lifecycle action* buttons for a HOLDER -- but Print Label (Task 24) is
    // a read-only label/QR action available to every role, not gated behind
    // `actionsFor`, so it's the one button a HOLDER does see.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /print label/i })).toBeInTheDocument();
  });

  it("shows a QR code image and a working Print Label button", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/1") {
        return Promise.resolve({
          id: 1,
          asset_code: "FA/HO01/IT/LAP/CK_1",
          description: "Laptop",
          status: "IN_STOCK",
          company_id: 1,
        });
      }
      if (path === "/assets/1/events") return Promise.resolve([]);
      if (path.startsWith("/holders")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    (useAuthStore as any).getState = vi.fn().mockReturnValue({ accessToken: "test-token" });
    const qrBlob = new Blob(["fake-png-bytes"]);
    window.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(qrBlob) }) as any;
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());

    // The image is fetched with the bearer token (not a bare <img src="/api/...">,
    // which would 401) and rendered from the resulting blob's object URL.
    await waitFor(() => expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/assets/1/qr.png"),
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    ));
    await waitFor(() => expect(screen.getByAltText(/asset qr code/i)).toHaveAttribute("src", "blob:mock-qr"));

    fireEvent.click(screen.getByRole("button", { name: /print label/i }));
    expect(printSpy).toHaveBeenCalled();
  });
});
