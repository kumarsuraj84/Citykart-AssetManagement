import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MyAssets } from "./MyAssets";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("MyAssets", () => {
  it("lists only the caller's own assets with no action buttons", async () => {
    (apiClient.get as any).mockResolvedValue({ items: [{ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "ALLOTTED" }], total: 1 });
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><MyAssets /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
