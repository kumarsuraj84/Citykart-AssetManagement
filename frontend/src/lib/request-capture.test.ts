import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiClient, ApiError } from "./api-client";
import { authFetch, downloadFile } from "./auth-fetch";
import { useAuthStore } from "./auth-store";
import { clearBreadcrumbs, getBreadcrumbs } from "./breadcrumbs";
import { failureForMessage, onApiFailure, recentRequests, resetRequestLog } from "./request-log";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetRequestLog();
  clearBreadcrumbs();
  fetchMock = vi.fn();
  window.fetch = fetchMock as never;
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "ADMIN", companyId: 1, isPrimaryOwner: false, mustChangePassword: false });
});
afterEach(() => useAuthStore.getState().logout());

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a failure");
}

describe("S8 reference ids on every call", () => {
  it("sends its own X-Request-ID and records the call (method, path template, status, ms, the server's id)", async () => {
    fetchMock.mockResolvedValue(json(200, [{ id: 1 }], { "X-Request-ID": "srv-1" }));
    await apiClient.get("/assets/12?q=typed");
    const sent = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(sent["X-Request-ID"]).toMatch(/^[0-9a-f]{32}$/);
    expect(sent.Authorization).toBe("Bearer tok");
    const [rec] = recentRequests();
    expect(rec).toMatchObject({ method: "GET", path: "/assets/{id}?q=", status: 200, requestId: "srv-1" });
    expect(typeof rec.ms).toBe("number");
    expect(getBreadcrumbs().map((c) => c.text)).toEqual(["GET /assets/{id}?q= → 200"]);
  });

  it("an error carries the reference from the header, else the body's request_id, else the id it sent", async () => {
    fetchMock.mockResolvedValueOnce(json(409, { detail: "Already exists.", request_id: "body-id" }, { "X-Request-ID": "hdr-id" }));
    expect((await failure(apiClient.post("/masters/vendors", {}))).requestId).toBe("hdr-id");
    fetchMock.mockResolvedValueOnce(json(422, { detail: "Name is required.", request_id: "body-id" }));
    expect((await failure(apiClient.post("/masters/vendors", {}))).requestId).toBe("body-id");
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 502 }));
    const e = await failure(apiClient.post("/masters/vendors", {}));
    const sent = (fetchMock.mock.calls[2][1].headers as Record<string, string>)["X-Request-ID"];
    expect(e.requestId).toBe(sent);
    expect(e.status).toBe(502);
    // The sentence is remembered with its reference (screens that keep only the text still show it).
    expect(failureForMessage("Name is required.")).toEqual({ requestId: "body-id", status: 422 });
  });

  it("a 5xx or a call with no answer is announced to the problem reports; a 4xx is not", async () => {
    const heard = vi.fn();
    onApiFailure(heard);
    fetchMock.mockResolvedValueOnce(json(500, { detail: "x", request_id: "r500" }, { "X-Request-ID": "r500" }));
    await failure(apiClient.get("/purchase-orders/40"));
    fetchMock.mockResolvedValueOnce(json(404, { detail: "Not found." }));
    await failure(apiClient.get("/purchase-orders/41"));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const net = await failure(apiClient.get("/assets"));
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard.mock.calls[0][0]).toMatchObject({ status: 500, requestId: "r500", path: "/purchase-orders/{id}", message: "500 GET /purchase-orders/{id}" });
    expect(heard.mock.calls[1][0]).toMatchObject({ status: 0, path: "/assets" });
    expect((net as unknown as { isNetworkError: boolean }).isNetworkError).toBe(true);
    expect(typeof (net as unknown as { requestId: string }).requestId).toBe("string");
  });

  it("the problem report's own call is never announced (no loops)", async () => {
    const heard = vi.fn();
    onApiFailure(heard);
    fetchMock.mockResolvedValue(json(500, {}));
    await authFetch("/client-reports", { method: "POST" });
    expect(heard).not.toHaveBeenCalled();
  });

  it("a failed download carries its status and reference", async () => {
    fetchMock.mockResolvedValue(json(500, { detail: "Something went wrong on the server." }, { "X-Request-ID": "dl-1" }));
    let err: Error & { requestId?: string; status?: number } = new Error("none");
    try {
      await downloadFile("/reports/export/assets", "a.xlsx", "Export failed");
    } catch (e) {
      err = e as typeof err;
    }
    expect(err.message).toBe("Export failed: Something went wrong on the server.");
    expect(err.requestId).toBe("dl-1");
    expect(err.status).toBe(500);
  });
});
