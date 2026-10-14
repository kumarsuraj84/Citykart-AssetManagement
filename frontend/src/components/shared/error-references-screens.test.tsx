import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import VendorsSetup from "../../routes/setup/vendors";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), getPage: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: true, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("S8: representative screens show the reference under a server error", () => {
  it("a dialog's refusal (Add Vendor): the sentence, then Reference + Copy", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    (apiClient.post as any).mockRejectedValue(new ApiError("A vendor with this name already exists.", 409, { detail: "x" }, "ref-vendor-409"));
    renderWithQuery(<VendorsSetup />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Vendor" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add Vendor" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Arihant" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("A vendor with this name already exists.");
    expect(alert).toHaveTextContent("Reference: ref-vendor-409");
    expect(within(alert).getByRole("button", { name: "Copy the reference ref-vendor-409" })).toBeInTheDocument();
  });

  it("a list that could not load (table error state): 5xx wording with the reference", async () => {
    (apiClient.get as any).mockRejectedValue(new ApiError("Request failed: 500", 500, null, "ref-500"));
    renderWithQuery(<VendorsSetup />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again; if it keeps happening, tell the administrator this reference: ref-500",
    ));
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
  });
});
