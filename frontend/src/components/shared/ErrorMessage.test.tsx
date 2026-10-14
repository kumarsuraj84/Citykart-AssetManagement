import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ErrorMessage, errorInfo } from "./ErrorMessage";
import { ErrorState } from "./ErrorState";
import { DataTable } from "./DataTable";
import { rememberFailure, resetRequestLog } from "@/lib/request-log";
import { useAuthStore } from "@/lib/auth-store";
import { useReportProblem } from "@/features/support/report-problem-store";

const apiError = (message: string, status: number, requestId: string | null) => Object.assign(new Error(message), { status, requestId });

beforeEach(() => {
  resetRequestLog();
  useReportProblem.getState().close();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => {
  useAuthStore.getState().logout();
  vi.restoreAllMocks();
});

describe("S8 ErrorMessage: the sentence, then a quiet reference", () => {
  it("shows the server's sentence and 'Reference: <id> [Copy]' for a refusal", () => {
    render(<ErrorMessage error={apiError("A vendor with this name already exists.", 409, "affb82df5c604737a04a411f3475238e")} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("A vendor with this name already exists.");
    expect(alert).toHaveTextContent("Reference: affb82df5c604737a04a411f3475238e");
    expect(screen.getByRole("button", { name: /copy the reference/i })).toBeInTheDocument();
    // A refusal is the person's to fix: no "tell the administrator", no Report a problem.
    expect(alert).not.toHaveTextContent(/administrator/);
    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
  });

  it("a 5xx: 'Something went wrong. Please try again; if it keeps happening, tell the administrator this reference'", () => {
    render(<ErrorMessage error={apiError("Something went wrong on the server. Nothing more was saved. Quote the reference to the administrator.", 500, "r500")} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again; if it keeps happening, tell the administrator this reference: r500");
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(useReportProblem.getState()).toMatchObject({ open: true, context: { requestId: "r500" } });
  });

  it("no answer at all (network) reads the same way, with the id the app sent", () => {
    const net = Object.assign(new TypeError("Failed to fetch"), { isNetworkError: true, requestId: "sent-1" });
    expect(errorInfo(net)).toEqual({ text: "Something went wrong.", requestId: "sent-1", status: null, serious: true });
    expect(errorInfo(apiError("Request failed: 502", 502, null)).text).toBe("Something went wrong.");
    // A specific 503 sentence is kept, with the try-again line.
    expect(errorInfo(apiError("The ERP could not be reached.", 503, "x")).text).toBe("The ERP could not be reached.");
  });

  it("finds the reference of a sentence a screen kept only as text", () => {
    rememberFailure("Serial number B is typed more than once.", "req-77", 422);
    render(<ErrorMessage message="Serial number B is typed more than once." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Reference: req-77");
  });

  it("shows nothing extra when there is no reference (local checks)", () => {
    render(<ErrorMessage message="Pick a vendor first." />);
    expect(screen.getByRole("alert").textContent).toBe("Pick a vendor first.");
  });

  it("Copy copies the full id (old way on plain http) and says so", async () => {
    Object.defineProperty(document, "execCommand", { value: vi.fn().mockReturnValue(true), configurable: true });
    render(<ErrorMessage error={apiError("Nope.", 409, "full-id-123")} />);
    fireEvent.click(screen.getByRole("button", { name: /copy the reference/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /copy the reference/i })).toHaveTextContent("Copied"));
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("when copying is impossible the id is selected to copy by hand", async () => {
    Object.defineProperty(document, "execCommand", { value: vi.fn().mockReturnValue(false), configurable: true });
    render(<ErrorMessage error={apiError("Nope.", 409, "full-id-123")} />);
    fireEvent.click(screen.getByRole("button", { name: /copy the reference/i }));
    expect(await screen.findByText(/press Ctrl\+C/)).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe("full-id-123");
  });

  it("is not offered 'Report a problem' when signed out", () => {
    useAuthStore.getState().logout();
    render(<ErrorMessage error={apiError("x", 500, "r")} />);
    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
  });
});

describe("S8 ErrorState and DataTable show the reference too", () => {
  it("ErrorState keeps its own message and adds the reference of the error behind it", () => {
    render(<ErrorState message="Couldn't load this asset." error={apiError("Request failed: 500", 500, "r-asset")} onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this asset.");
    expect(alert).toHaveTextContent("tell the administrator this reference: r-asset");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("DataTable passes the error through", () => {
    render(
      <DataTable
        columns={[{ key: "a", header: "A", cell: () => null }]} rows={[]} rowKey={() => 1}
        isError errorMessage="Couldn't load the list." error={apiError("x", 404, "r-404")} emptyState={null}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Reference: r-404");
  });
});
