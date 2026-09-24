import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter, createRootRoute, createRoute } from "@tanstack/react-router";
import { MyAssets } from "./MyAssets";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

const CATEGORY = { id: 1, name: "IT Equipment" };
const ASSET = { id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "ALLOTTED", category_id: 1 };

function mockGets(items: unknown[] = [ASSET]) {
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/assets") return Promise.resolve({ items, total: items.length });
    if (path === "/masters/categories") return Promise.resolve([CATEGORY]);
    return Promise.resolve([]);
  });
}

// MyAssets renders a real <Link>, which needs a router context -- build a
// minimal one-route tree around it rather than mocking @tanstack/react-router.
function renderWithClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <MyAssets /> });
  const assetRoute = createRoute({ getParentRoute: () => rootRoute, path: "/assets/$id", component: () => null });
  const routeTree = rootRoute.addChildren([assetRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("MyAssets", () => {
  it("shows a loading skeleton, then lists only the caller's own assets with no action buttons", async () => {
    let resolveAssets: (v: unknown) => void = () => {};
    // A single shared, lazily-created promise: React Query may call the
    // queryFn more than once (e.g. a second render pass) -- mockImplementation
    // returning a FRESH unresolved promise per call would silently orphan the
    // first one when that happens, leaving the second (never-resolved) promise
    // as the one actually awaited.
    const assetsPromise = new Promise((res) => (resolveAssets = res));
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets") return assetsPromise;
      if (path === "/masters/categories") return Promise.resolve([CATEGORY]);
      return Promise.resolve([]);
    });

    renderWithClient();
    expect(screen.queryByText("FA/HO01/IT/LAP/CK_1")).not.toBeInTheDocument();

    resolveAssets({ items: [ASSET], total: 1 });
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("IT Equipment")).toBeInTheDocument();
    expect(screen.getByText("ALLOTTED")).toBeInTheDocument();
  });

  it("renders the asset code as a real link to Asset 360, not a hardcoded color", async () => {
    mockGets();
    renderWithClient();

    const link = await screen.findByRole("link", { name: "FA/HO01/IT/LAP/CK_1" });
    expect(link).toHaveAttribute("href", "/assets/1");
    expect(link.className).not.toMatch(/text-blue-600/);
  });

  it("shows an empty state when the caller holds no assets", async () => {
    mockGets([]);
    renderWithClient();

    await waitFor(() => expect(screen.getByText(/no assets in your custody/i)).toBeInTheDocument());
  });

  it("shows an error state with a retry that refetches", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets") return Promise.reject(new Error("assets down"));
      if (path === "/masters/categories") return Promise.resolve([CATEGORY]);
      return Promise.resolve([]);
    });
    renderWithClient();

    expect(await screen.findByRole("alert")).toHaveTextContent("assets down");

    mockGets();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
  });
});
