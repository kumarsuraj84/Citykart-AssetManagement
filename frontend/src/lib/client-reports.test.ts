import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { useAuthStore } from "./auth-store";
import { addBreadcrumb, clearBreadcrumbs } from "./breadcrumbs";
import { notifyApiFailure, recordRequest, resetRequestLog } from "./request-log";
import {
  BACKOFF_MS, MAX_AUTO_REPORTS, installErrorCapture, reportJsError, resetClientReports, sendAutomaticReport, sendUserReport,
} from "./client-reports";
import { APP_VERSION } from "./app-version";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl";

let fetchMock: ReturnType<typeof vi.fn>;
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body)));

function signIn() {
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
}

beforeEach(() => {
  resetClientReports();
  resetRequestLog();
  clearBreadcrumbs();
  fetchMock = vi.fn().mockResolvedValue(answer(201, { id: 1, reference: "ref-1", duplicate: false }));
  window.fetch = fetchMock as never;
  signIn();
});
afterEach(() => {
  resetClientReports();
  useAuthStore.getState().logout();
  vi.useRealTimers();
});

describe("S8 automatic problem reports", () => {
  it("nothing is sent until switched on (unit tests and screens never report by accident)", async () => {
    expect(await reportJsError(new Error("boom"))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a window error is sent as JS_ERROR with route, version, last 30 breadcrumbs, last 10 requests and a cut stack", async () => {
    installErrorCapture();
    for (let i = 0; i < 40; i++) addBreadcrumb("click", `Clicked “B${i}”`);
    for (let i = 0; i < 15; i++) recordRequest({ at: "t", method: "GET", path: "/x", status: 200, ms: 1, requestId: `r${i}` });
    const err = new Error("Cannot read properties of undefined");
    err.stack = `Error: Cannot read properties of undefined\n    at Thing (src/a.tsx:1:1)\n${"x".repeat(20000)}`;
    window.dispatchEvent(new ErrorEvent("error", { error: err, message: err.message }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/client-reports");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = sentBodies()[0];
    expect(body.kind).toBe("JS_ERROR");
    expect(body.message).toBe("Error: Cannot read properties of undefined");
    expect(body.route).toBe(window.location.pathname);
    expect(body.app_version).toBe(APP_VERSION);
    // 30 breadcrumbs: the last one is the error itself, recorded just before sending.
    expect(body.breadcrumbs).toHaveLength(30);
    expect(body.breadcrumbs[29].type).toBe("error");
    expect(body.recent_requests).toHaveLength(10);
    expect(body.recent_requests[9].requestId).toBe("r14");
    expect(body.stack.length).toBeLessThan(9000);
    expect(body.stack).toContain("more characters cut");
  });

  it("an unhandled promise rejection is reported; an ordinary 4xx refusal is not", async () => {
    installErrorCapture();
    const refusal = Object.assign(new Error("Name is required."), { status: 422 });
    expect(await reportJsError(refusal)).toBeNull();
    const ev = new Event("unhandledrejection") as Event & { reason?: unknown };
    ev.reason = new Error("async boom");
    window.dispatchEvent(ev);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0].message).toBe("Error: async boom");
  });

  it("is never sent when nobody is signed in", async () => {
    installErrorCapture();
    useAuthStore.getState().logout();
    expect(await reportJsError(new Error("boom"))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the same error within 60 s is sent once (and gives the same reference)", async () => {
    installErrorCapture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const e1 = new Error("boom");
    e1.stack = "Error: boom\n    at A (a.tsx:1:1)";
    const e2 = new Error("boom");
    e2.stack = "Error: boom\n    at A (a.tsx:1:1)";
    expect(await reportJsError(e1)).toBe("ref-1");
    expect(await reportJsError(e2)).toBe("ref-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-14T10:01:01Z"));
    await reportJsError(e2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it(`sends at most ${MAX_AUTO_REPORTS} automatic reports per session`, async () => {
    installErrorCapture();
    for (let i = 0; i < 15; i++) await reportJsError(new Error(`boom ${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(MAX_AUTO_REPORTS);
  });

  it("a 429 stops automatic reports for 5 minutes", async () => {
    installErrorCapture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    fetchMock.mockResolvedValueOnce(answer(429, { detail: "Too many." }));
    expect(await reportJsError(new Error("one"))).toBeNull();
    await reportJsError(new Error("two"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.parse("2026-10-14T10:00:00Z") + BACKOFF_MS + 1000));
    await reportJsError(new Error("three"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a failure while reporting is swallowed (no second error, no loop)", async () => {
    installErrorCapture();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(reportJsError(new Error("boom"))).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a failed call (5xx / no answer) becomes an API_ERROR with its request id", async () => {
    installErrorCapture();
    notifyApiFailure({ at: "t", method: "PUT", path: "/masters/vendors/{id}", status: 500, ms: 9, requestId: "affb82", message: "500 PUT /masters/vendors/{id}" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0]).toMatchObject({ kind: "API_ERROR", message: "500 PUT /masters/vendors/{id}", request_id: "affb82" });
  });

  it("removes tokens and password-looking values before sending", async () => {
    installErrorCapture();
    addBreadcrumb("click", `Clicked “${JWT}”`);
    await sendAutomaticReport({ kind: "JS_ERROR", message: `failed: Bearer abc.def password=hunter2 ${JWT}` });
    const raw = String(fetchMock.mock.calls[0][1].body);
    expect(raw).not.toContain(JWT);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("abc.def");
  });
});

describe("S8 Report a problem (USER_REPORT)", () => {
  it("sends the note with the attachments and answers the reference", async () => {
    addBreadcrumb("nav", "Opened /purchase-orders/40");
    const result = await sendUserReport({ note: "  Save did nothing on the PO.  ", requestId: "req-9" });
    expect(result).toEqual({ id: 1, reference: "ref-1", duplicate: false });
    const body = sentBodies()[0];
    expect(body).toMatchObject({ kind: "USER_REPORT", note: "Save did nothing on the PO.", request_id: "req-9", app_version: APP_VERSION });
    expect(body.breadcrumbs[0].text).toBe("Opened /purchase-orders/40");
  });

  it("explains a 429 and refuses when not signed in", async () => {
    fetchMock.mockResolvedValueOnce(answer(429, { detail: "x" }));
    await expect(sendUserReport({ note: "x" })).rejects.toThrow(/many problem reports/);
    useAuthStore.getState().logout();
    await expect(sendUserReport({ note: "x" })).rejects.toThrow(/Sign in/);
  });
});
