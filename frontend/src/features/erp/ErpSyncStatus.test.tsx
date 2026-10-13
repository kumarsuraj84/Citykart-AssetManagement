import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { ErpSyncStatus, refreshResultSentence } from "./ErpSyncStatus";

vi.mock("../../lib/api-client");

const RUN = {
  status: "success", trigger: "schedule", started_at: "2026-10-13T06:00:00+00:00", finished_at: "2026-10-13T06:00:05+00:00",
  source_stamp: "2026-10-13T05:44:00+00:00", message: null, po_lines_new: 0, po_lines_changed: 2, po_lines_gone: 0,
};

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ErpSyncStatus /></QueryClientProvider>);
}

function asOwner(isPrimaryOwner: boolean) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner, mustChangePassword: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  asOwner(false);
  (apiClient.get as any).mockResolvedValue({ configured: true, last: RUN, last_success: RUN });
  (apiClient.post as any).mockResolvedValue(RUN);
});
afterEach(() => useAuthStore.getState().logout());

describe("ERP data freshness", () => {
  it("says when the ERP data was copied, and gives ordinary users no button", async () => {
    renderIt();
    expect(await screen.findByText(/ERP data as of/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh now/i })).not.toBeInTheDocument();
  });

  it("says so when nothing has been copied yet", async () => {
    (apiClient.get as any).mockResolvedValue({ configured: true, last: null, last_success: null });
    renderIt();
    expect(await screen.findByText("The ERP data has not been copied yet.")).toBeInTheDocument();
  });

  it("shows nothing when this server has no ERP connection", async () => {
    (apiClient.get as any).mockResolvedValue({ configured: false, last: null, last_success: null });
    renderIt();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/sync"));
    expect(screen.queryByLabelText("ERP data freshness")).not.toBeInTheDocument();
  });

  it("shows nothing when the user may not see it", async () => {
    (apiClient.get as any).mockRejectedValue(new Error("forbidden"));
    renderIt();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/erp/sync"));
    expect(screen.queryByLabelText("ERP data freshness")).not.toBeInTheDocument();
  });

  it("lets the Primary Owner copy the data now", async () => {
    asOwner(true);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /refresh now/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/erp/sync", {}));
  });

  it("says when the last refresh did not work, while still showing the data's age", async () => {
    const failed = { ...RUN, status: "failed", message: "The ERP database could not be reached (OSError)." };
    (apiClient.get as any).mockResolvedValue({ configured: true, last: failed, last_success: RUN });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent("The last refresh did not work: The ERP database could not be reached");
    expect(screen.getByText(/ERP data as of/)).toBeInTheDocument();
  });

  it("S7 P3-6: Refresh now says what it did, in a visible line", async () => {
    asOwner(true);
    (apiClient.post as any).mockResolvedValue({ ...RUN, trigger: "manual", po_lines_new: 3, po_lines_changed: 1 });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /refresh now/i }));
    const line = await screen.findByRole("status", { name: "Refresh result" });
    expect(line).toHaveTextContent(/^Checked just now \(.+\): copied 3 new PO lines, 1 changed PO line\.$/);
  });

  it("S7 P3-6: a refresh with nothing newer says so", () => {
    expect(refreshResultSentence({ ...RUN, status: "skipped" } as never)).toMatch(/the ERP had nothing newer to copy\.$/);
    expect(refreshResultSentence({ ...RUN, po_lines_changed: 0 } as never)).toMatch(/nothing newer/);
    expect(refreshResultSentence({ ...RUN, status: "running", finished_at: null } as never)).toMatch(/already running/);
  });

  it("shows a failed manual refresh's message", async () => {
    asOwner(true);
    (apiClient.post as any).mockResolvedValue({ ...RUN, status: "failed", message: "Another copy of the ERP data is already running." });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /refresh now/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already running");
  });
});
