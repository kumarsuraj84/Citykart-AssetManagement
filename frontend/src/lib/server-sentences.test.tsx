import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../router";
import { AssetUsersScreen } from "../features/asset-users/AssetUsersScreen";
import { authFetch } from "./auth-fetch";
import { useAuthStore } from "./auth-store";

// Only the network is replaced: the REAL api-client turns the server's answer into the
// Error every screen shows, so these tests cover the whole path from a 4xx/5xx body to the page.
vi.mock("./auth-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-fetch")>();
  return { ...actual, authFetch: vi.fn() };
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function renderApp(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("the server's sentence reaches the screen (real api-client)", () => {
  it("New purchase order: a validation 422 (detail string + errors list) shows the readable sentence, not 'Request failed: 422'", async () => {
    (authFetch as any).mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "POST" && path === "/purchase-orders/with-lines") {
        return Promise.resolve(json(422, {
          detail: "PO number is required. Cost centre is required.",
          errors: ["PO number is required.", "Cost centre is required."],
        }));
      }
      if (path.startsWith("/masters/cost-centers")) return Promise.resolve(json(200, [{ id: 3, name: "Head Office" }]));
      if (path === "/items") {
        return Promise.resolve(json(200, [{
          id: 12, name: "Laptop", category_id: 1, subcategory_id: null, serial_required: true, serial_later: false, bundle_id: null,
          default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0,
        }]));
      }
      return Promise.resolve(json(200, []));
    });
    renderApp("/purchase-orders/new");
    await waitFor(() => expect(screen.getByLabelText(/po no/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/po no/i), { target: { value: "PO-1" } });
    fireEvent.click(screen.getByLabelText(/cost centre/i));
    fireEvent.click(await screen.findByText("Head Office"));
    fireEvent.click(screen.getByLabelText("Line 1 Item"));
    fireEvent.click(await screen.findByRole("option", { name: /^Laptop/ }));
    fireEvent.change(screen.getByLabelText("Line 1 Unit Cost"), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: /save po/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PO number is required. Cost centre is required.");
    expect(alert.textContent).not.toMatch(/Request failed/);
  });

  it("People & Places: a refused deactivation shows 'still holds N assets' from a real 422", async () => {
    (authFetch as any).mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(json(422, {
          detail: "Ravi Kumar still holds 3 assets. Move them to someone else or back to a stock room first, then deactivate.",
        }));
      }
      if (path === "/asset-users") {
        return Promise.resolve(json(200, [{
          id: 4, company_id: 1, code: "E4", name: "Ravi Kumar", asset_user_type: "EMPLOYEE", location_id: 1, department_id: null,
          email: null, phone: null, role: "SELF_SERVICE", login_enabled: false, is_primary_owner: false, is_active: true,
        }]));
      }
      return Promise.resolve(json(200, []));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AssetUsersScreen fixedType="EMPLOYEE" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^deactivate ravi kumar$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^deactivate$/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ravi Kumar still holds 3 assets.");
  });

  it("409, foreign-key 422 and 503 answers are shown as the server worded them", async () => {
    for (const [status, detail] of [
      [409, "A record with this code already exists."],
      [422, "The vendor you chose does not exist."],
      [503, "The database could not be reached. Try again in a moment."],
    ] as const) {
      (authFetch as any).mockResolvedValue(json(status, { detail }));
      const { apiClient } = await import("./api-client");
      await expect(apiClient.post("/x", {})).rejects.toThrow(detail);
    }
  });
});
