import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetDetail } from "./AssetDetail";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("AssetDetail", () => {
  it("only shows actions valid for the current status and posts the chosen action", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/assets/1") return Promise.resolve({ id: 1, asset_code: "FA/HO01/IT/LAP/CK_1", description: "Laptop", status: "IN_STOCK" });
      if (path === "/assets/1/events") return Promise.resolve([]);
      if (path.startsWith("/holders")) return Promise.resolve([{ id: 5, name: "Ankur" }]);
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockResolvedValue({ id: 99, status_after: "ALLOTTED" });

    renderWithClient(<AssetDetail assetId={1} />);

    await waitFor(() => expect(screen.getByText("FA/HO01/IT/LAP/CK_1")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /move \/ allot/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /receive from repair/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /move \/ allot/i }));
    fireEvent.change(screen.getByLabelText(/holder/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/assets/1/events", expect.objectContaining({
      event_type: "MOVED", to_holder_id: 5,
    })));
  });
});
