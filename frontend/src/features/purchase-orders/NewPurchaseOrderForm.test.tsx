import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { KINDS, OPERATOR_IT, withCapabilities } from "../../test-capabilities";

vi.mock("../../lib/api-client");

function renderFormAt(url = "/purchase-orders/new") {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, name: "Head Office" }]);
    return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
  });
});
afterEach(() => useAuthStore.getState().logout());

describe("NewPurchaseOrderForm", () => {
  it("disables Create until PO No, PO Date and Cost Centre are filled", async () => {
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /create purchase order/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    expect(screen.getByRole("button", { name: /create purchase order/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    expect(screen.getByRole("button", { name: /create purchase order/i })).not.toBeDisabled();
  });

  it("creates a PO and navigates to its detail page", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 42 });
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders",
        expect.objectContaining({ company_id: 1, po_number: "PO-1", cost_center_id: 3 }),
      ),
    );
  });

  it("an optional delivery location (a stock room of the company, from /stock-rooms) is sent with the PO", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path.startsWith("/masters/cost-centers")) return Promise.resolve([{ id: 3, name: "Head Office" }]);
      if (path === "/stock-rooms?company_id=1") {
        return Promise.resolve([{ id: 7, name: "WH Tajnagar Stores", asset_user_type: "STOCK_POINT", location_name: "Tajnagar", company_code: "CKSPL" }]);
      }
      if (path.startsWith("/asset-users?company_id=")) {
        return Promise.resolve([{ id: 8, name: "A Person", asset_user_type: "EMPLOYEE" }]);
      }
      return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
    });
    (apiClient.post as any).mockResolvedValue({ id: 42 });
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-2" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    // The delivery location is labelled "Received Into", never "Initial Asset User".
    expect(screen.queryByText(/initial asset user|delivery location/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/received into/i));
    expect(screen.queryByText("A Person")).not.toBeInTheDocument();          // only stock points are offered
    fireEvent.click(await screen.findByText("WH Tajnagar Stores"));
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders",
        expect.objectContaining({ po_number: "PO-2", cost_center_id: 3, delivery_asset_user_id: 7 }),
      ),
    );
  });

  it("without a delivery location nothing about it is sent", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 42 });
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-3" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect((apiClient.post as any).mock.calls[0][1]).not.toHaveProperty("delivery_asset_user_id");
  });

  it("shows a server-side error inline", async () => {
    (apiClient.post as any).mockRejectedValue(new Error("PO number already used"));
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("PO number already used"));
  });

  it("AM-24: shows a Company picker when the caller has access to more than one, and submits the chosen company", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Company A" }, { id: 2, name: "Company B" }]);
      if (path === "/masters/cost-centers?company_id=1") return Promise.resolve([{ id: 3, name: "A Cost Centre" }]);
      if (path === "/masters/cost-centers?company_id=2") return Promise.resolve([{ id: 30, name: "B Cost Centre" }]);
      return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
    });
    (apiClient.post as any).mockResolvedValue({ id: 42 });
    renderFormAt();

    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText(/^company/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/^company/i));
    fireEvent.click(await screen.findByText("Company B"));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/masters/cost-centers?company_id=2"));

    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("B Cost Centre"));
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/purchase-orders",
        expect.objectContaining({ company_id: 2, cost_center_id: 30 }),
      ),
    );
  });
});

// S3b-1: Vendor, Cost Centre and the Received Into stock room can be added right here.
describe("S3b-1: inline creation on New Purchase Order", () => {
  function world(caps: Capabilities | null, costCentres: { id: number; code?: string; name: string }[] = [{ id: 3, name: "Head Office" }]) {
    (apiClient.get as any).mockImplementation(withCapabilities(caps, (path: string) => {
      if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Citykart Stores" }]);
      if (path.startsWith("/masters/cost-centers")) return Promise.resolve(costCentres);
      if (path === "/masters/vendors") return Promise.resolve([{ id: 9, name: "Acme Traders" }]);
      if (path === "/masters/locations?company_id=1") return Promise.resolve([{ id: 50, name: "Head Office" }]);
      if (path === "/stock-rooms?company_id=1") return Promise.resolve([
        { id: 7, name: "WH Tajnagar Stores", location_name: "Tajnagar", company_code: "CKSPL" },
        { id: 8, name: "HO Stock", location_name: "Head Office", company_code: "CKSPL" },
      ]);
      return Promise.resolve([]);
    }));
  }

  beforeEach(() => {
    useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5 });
  });

  it.each(KINDS)("%s: New Vendor / New Cost Centre / New Stock Room follow the capabilities", async (_kind, caps) => {
    world(caps);
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities"));
    await new Promise((r) => setTimeout(r, 20));
    const checks: [RegExp, RegExp, boolean][] = [
      [/^vendor$/i, /new vendor/i, caps.can_create.vendor === true],
      [/^cost centre/i, /new cost centre/i, caps.can_create.cost_centre === true],
      [/^received into$/i, /new stock room/i, caps.can_create.stock_room === true],
    ];
    for (const [label, entry, allowed] of checks) {
      const trigger = screen.getByLabelText(label);
      fireEvent.click(trigger);
      await screen.findAllByRole("option");
      if (allowed) expect(await screen.findByRole("option", { name: entry })).toBeInTheDocument();
      else expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument();
      fireEvent.click(trigger);
      await waitFor(() => expect(screen.queryByRole("option", { name: entry })).not.toBeInTheDocument());
    }
  });

  it("a new Cost Centre is made for the PO's company (no code) and picked", async () => {
    const centres = [{ id: 3, name: "Head Office" }];
    world(OPERATOR_IT, centres);
    (apiClient.post as any).mockImplementation((path: string, body: { name: string }) => {
      const row = { id: 44, ...body };
      if (path === "/masters/cost-centers") centres.push(row);
      return Promise.resolve(path === "/purchase-orders" ? { id: 42 } : row);
    });
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/^cost centre/i));
    fireEvent.click(await screen.findByRole("option", { name: /new cost centre/i }));
    const dialog = await screen.findByRole("dialog", { name: /new cost centre/i });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Farukhnagar W/H" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/cost-centers", { company_id: 1, name: "Farukhnagar W/H" }));
    await waitFor(() => expect(screen.getByLabelText(/^cost centre/i)).toHaveTextContent("Farukhnagar W/H"));
  });

  it("Received Into lists stock rooms as \"Name · Place · Company code\"", async () => {
    world(OPERATOR_IT);
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/^received into$/i));
    expect(await screen.findByRole("option", { name: /^HO Stock\s?· Head Office · CKSPL$/ })).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/asset-users\?company_id=/));
  });

  it("starts with the Cost Centre and stock room this person used last for this company", async () => {
    window.localStorage.setItem("ckam:last-used:5:1", JSON.stringify({ cost_centre: "3", stock_room: "8" }));
    world(OPERATOR_IT);
    (apiClient.post as any).mockResolvedValue({ id: 42 });
    renderFormAt();
    await waitFor(() => expect(screen.getByLabelText(/^cost centre/i)).toHaveTextContent("Head Office"));
    await waitFor(() => expect(screen.getByLabelText(/^received into$/i)).toHaveTextContent("HO Stock"));
    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-9" } });
    fireEvent.click(screen.getByRole("button", { name: /create purchase order/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/purchase-orders", expect.objectContaining({ cost_center_id: 3, delivery_asset_user_id: 8 })));
  });
});
