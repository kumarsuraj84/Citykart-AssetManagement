import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

// Rendered through the real route tree: the screen has links (Move, Asset 360, Assets).
async function renderRepairs() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/repairs"] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Repairs" });
  return router;
}

const SUMMARY = {
  vendors: [
    { vendor_id: 7, vendor_name: "Fix It Services", assets: 2, oldest_days: 9 },
    { vendor_id: 8, vendor_name: "Quick Repairs", assets: 1, oldest_days: 0 },
  ],
  without_vendor: { assets: 3, oldest_days: 41 },
};
const FIXIT_ASSETS = [
  { asset_id: 3, asset_code: "FA/HO01/IT/PRN/CK_3", serial_number: "SN-003", description: "Printer", days: 9, origin_name: "Ankur", origin_active: true },
  { asset_id: 8, asset_code: "FA/HO01/IT/PRN/CK_8", serial_number: null, description: "Scanner", days: 2, origin_name: "Old Store", origin_active: false },
];

function mockGets(summary: unknown = SUMMARY) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/repairs") return Promise.resolve(summary);
    if (path === "/repairs/vendors/7/assets") return Promise.resolve(FIXIT_ASSETS);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

describe("Repairs (Release 3)", () => {
  it("lists each repair vendor with how many assets it holds and how long the oldest has been away", async () => {
    mockGets();
    await renderRepairs();
    expect(await screen.findByRole("button", { name: "Fix It Services: 2 assets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quick Repairs: 1 asset" })).toBeInTheDocument();
    expect(screen.getByText(/oldest away 9 days/)).toBeInTheDocument();
    expect(screen.getByText(/oldest away today/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("6 assets away for repair.");       // 2 + 1 + 3 with no vendor
  });

  it("opens a vendor to show its assets, where each was sent from, and links each to Asset 360", async () => {
    mockGets();
    await renderRepairs();
    fireEvent.click(await screen.findByRole("button", { name: "Fix It Services: 2 assets" }));
    expect(await screen.findByRole("link", { name: "FA/HO01/IT/PRN/CK_3" })).toHaveAttribute("href", "/assets/3");
    expect(screen.getByText(/sent from Ankur/)).toBeInTheDocument();
    expect(screen.getByText(/sent from Old Store \(no longer active\)/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/repairs/vendors/7/assets");
    fireEvent.click(screen.getByRole("button", { name: "Fix It Services: 2 assets" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "FA/HO01/IT/PRN/CK_3" })).not.toBeInTheDocument());
  });

  it("says how many were sent before vendors were recorded, and where to find them", async () => {
    mockGets();
    await renderRepairs();
    const note = await screen.findByRole("region", { name: "No vendor recorded" });
    expect(note).toHaveTextContent("No vendor recorded: 3 assets");
    expect(note).toHaveTextContent("the oldest 41 days ago");
    expect(screen.getByRole("link", { name: "See them in Assets" })).toHaveAttribute("href", expect.stringContaining("status=UNDER_REPAIR"));
  });

  it("offers Receive from Repair, which opens Move on that choice", async () => {
    mockGets();
    await renderRepairs();
    expect(await screen.findByRole("link", { name: "Receive from Repair" })).toHaveAttribute("href", expect.stringContaining("choice=from-repair"));
  });

  it("says so when nothing is away for repair", async () => {
    mockGets({ vendors: [], without_vendor: { assets: 0, oldest_days: null } });
    await renderRepairs();
    expect(await screen.findByText("Nothing is away for repair.", { selector: "p[role=status]" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Repair vendors" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "No vendor recorded" })).not.toBeInTheDocument();
  });

  it("a malformed answer shows nothing instead of crashing", async () => {
    mockGets([]);
    await renderRepairs();
    expect(screen.queryByRole("list", { name: "Repair vendors" })).not.toBeInTheDocument();
  });
});
