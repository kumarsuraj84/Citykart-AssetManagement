import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportProblemDialog, ATTACHED_LINE } from "./ReportProblemDialog";
import { useReportProblem } from "./report-problem-store";
import { useAuthStore } from "@/lib/auth-store";
import { addBreadcrumb, clearBreadcrumbs } from "@/lib/breadcrumbs";
import { recordRequest, resetRequestLog } from "@/lib/request-log";
import { NOTE_MAX } from "@/lib/client-reports";

let fetchMock: ReturnType<typeof vi.fn>;
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  resetRequestLog();
  clearBreadcrumbs();
  fetchMock = vi.fn().mockResolvedValue(answer(201, { id: 7, reference: "f6a4c678705041df91534b785bdea61e", duplicate: false }));
  window.fetch = fetchMock as never;
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "VIEWER", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => {
  act(() => useReportProblem.getState().close());
  useAuthStore.getState().logout();
});

function openDialog(context: Parameters<ReturnType<typeof useReportProblem.getState>["openReport"]>[0] = null) {
  render(<ReportProblemDialog />);
  act(() => useReportProblem.getState().openReport(context));
}

describe("S8 Report a problem", () => {
  it("needs a note, says what is attached, sends a USER_REPORT and shows the reference to quote", async () => {
    addBreadcrumb("nav", "Opened /purchase-orders/40");
    recordRequest({ at: "t", method: "POST", path: "/purchase-orders/{id}/receive", status: 500, ms: 80, requestId: "rq-1" });
    openDialog();
    const dialog = await screen.findByRole("dialog", { name: "Report a problem" });
    expect(dialog).toHaveTextContent(ATTACHED_LINE);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What were you doing and what went wrong/), { target: { value: "Receive failed twice on PO 40." } });
    fireEvent.click(send);
    expect(await screen.findByText(/Thank you\./)).toBeInTheDocument();
    expect(screen.getByText("f6a4c678705041df91534b785bdea61e")).toBeInTheDocument();
    expect(screen.getByText(/Quote this reference/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/client-reports");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ kind: "USER_REPORT", note: "Receive failed twice on PO 40." });
    expect(body.breadcrumbs.map((b: { text: string }) => b.text)).toContain("Opened /purchase-orders/40");
    expect(body.recent_requests[0]).toMatchObject({ path: "/purchase-orders/{id}/receive", status: 500, requestId: "rq-1" });
  });

  it("opened from an error, it carries that error's reference", async () => {
    openDialog({ requestId: "r500", message: "500 POST /x" });
    expect(await screen.findByRole("dialog")).toHaveTextContent("About reference r500");
    fireEvent.change(screen.getByLabelText(/What were you doing/), { target: { value: "It broke." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/Thank you\./);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ request_id: "r500", message: "500 POST /x" });
  });

  it(`refuses a note over ${NOTE_MAX} characters`, async () => {
    openDialog();
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/What were you doing/), { target: { value: "x".repeat(NOTE_MAX + 1) } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/please shorten it/)).toBeInTheDocument();
  });

  it("a refused send shows the reason and keeps the note", async () => {
    fetchMock.mockResolvedValueOnce(answer(429, { detail: "Too many." }));
    openDialog();
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/What were you doing/), { target: { value: "Again." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/many problem reports/));
    expect(screen.getByLabelText(/What were you doing/)).toHaveValue("Again.");
  });
});
