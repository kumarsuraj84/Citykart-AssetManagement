import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  failureForMessage, newRequestId, notifyApiFailure, onApiFailure, pathTemplate, recentRequests, recordRequest,
  rememberFailure, resetRequestLog, responseRequestId,
} from "./request-log";

beforeEach(() => resetRequestLog());
afterEach(() => vi.useRealTimers());

describe("S8 request log", () => {
  it("path templates drop ids and query values (a search can hold typed text)", () => {
    expect(pathTemplate("/assets/12/events")).toBe("/assets/{id}/events");
    expect(pathTemplate("/admin/logs/request/affb82df5c604737a04a411f3475238e")).toBe("/admin/logs/request/{id}");
    expect(pathTemplate("/assets?q=secret%20laptop&status=LOST&q=x")).toBe("/assets?q=&status=");
    expect(pathTemplate("/masters/vendors")).toBe("/masters/vendors");
  });

  it("keeps only the last 50 calls, oldest first", () => {
    for (let i = 0; i < 60; i++) {
      recordRequest({ at: `t${i}`, method: "GET", path: `/x/${i}`, status: 200, ms: i, requestId: `r${i}` });
    }
    const all = recentRequests();
    expect(all).toHaveLength(50);
    expect(all[0].requestId).toBe("r10");
    expect(all[49].requestId).toBe("r59");
    expect(recentRequests(10).map((r) => r.requestId)).toEqual(["r50", "r51", "r52", "r53", "r54", "r55", "r56", "r57", "r58", "r59"]);
  });

  it("remembers a failure's reference by its sentence for ten minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    rememberFailure("A vendor with this name already exists.", "req-1", 409);
    rememberFailure("A vendor with this name already exists.", "req-2", 409);
    expect(failureForMessage("A vendor with this name already exists.")).toEqual({ requestId: "req-2", status: 409 });
    expect(failureForMessage("Something else.")).toBeNull();
    vi.setSystemTime(new Date("2026-10-14T10:11:00Z"));
    expect(failureForMessage("A vendor with this name already exists.")).toBeNull();
  });

  it("failure listeners hear 5xx / unanswered calls; a broken listener never breaks the call", () => {
    const heard = vi.fn();
    onApiFailure(() => { throw new Error("listener bug"); });
    const stop = onApiFailure(heard);
    const failure = { at: "t", method: "GET", path: "/x", status: 500, ms: 3, requestId: "r", message: "500 GET /x" };
    expect(() => notifyApiFailure(failure)).not.toThrow();
    expect(heard).toHaveBeenCalledWith(failure);
    stop();
    notifyApiFailure(failure);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("new request ids are 32 hex characters and differ", () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newRequestId()).not.toBe(a);
  });

  it("reads X-Request-ID tolerantly (test doubles without headers)", () => {
    expect(responseRequestId(new Response(null, { headers: { "X-Request-ID": "abc" } }))).toBe("abc");
    expect(responseRequestId({} as never)).toBeNull();
    expect(responseRequestId(null)).toBeNull();
  });
});
