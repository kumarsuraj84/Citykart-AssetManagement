import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { useAuthStore } from "@/lib/auth-store";
import { installErrorCapture, resetClientReports } from "@/lib/client-reports";
import { ReportProblemDialog } from "@/features/support/ReportProblemDialog";
import { useReportProblem } from "@/features/support/report-problem-store";

let fetchMock: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetClientReports();
  useReportProblem.getState().close();
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 4, reference: "crash-ref-1", duplicate: false }), { status: 201 }));
  window.fetch = fetchMock as never;
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
  // React logs caught render errors; keep the test output quiet.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  resetClientReports();
  useAuthStore.getState().logout();
  consoleError.mockRestore();
});

function Boom({ when }: { when: boolean }) {
  if (when) throw new Error("Cannot read properties of undefined (reading 'name')");
  return <p>All fine</p>;
}

function Harness() {
  const [broken, setBroken] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setBroken(false)}>fix it</button>
      <ErrorBoundary>
        <Boom when={broken} />
      </ErrorBoundary>
      <ReportProblemDialog />
    </>
  );
}

describe("S8 ErrorBoundary", () => {
  it("shows plain words, reports the crash once and shows its reference", async () => {
    installErrorCapture();
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "This screen had a problem." })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("crash-ref-1")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toMatchObject({ kind: "JS_ERROR", message: "Error: Cannot read properties of undefined (reading 'name')" });
    expect(body.stack).toContain("Boom");
  });

  it("Try again renders the screen again", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "fix it" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("All fine")).toBeInTheDocument();
  });

  it("Report this problem opens the dialog about this crash", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Report this problem" }));
    expect(await screen.findByRole("dialog", { name: "Report a problem" })).toBeInTheDocument();
    expect(useReportProblem.getState().context?.message).toContain("Cannot read properties of undefined");
  });
});
