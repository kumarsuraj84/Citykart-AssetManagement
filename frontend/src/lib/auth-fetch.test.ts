import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authFetch, navigation, safeNextPath, PASSWORD_CHANGE_REQUIRED_DETAIL } from "./auth-fetch";
import { useAuthStore } from "./auth-store";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SESSION = { access_token: "new-token", must_change_password: false, role: "ADMIN", company_id: 2 };

describe("authFetch", () => {
  let assignSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useAuthStore.getState().setAuth({ accessToken: "old-token", role: "ADMIN", companyId: 2, mustChangePassword: false });
    assignSpy = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    window.history.replaceState(null, "", "/assets/42?tab=history");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.getState().logout();
  });

  it("refreshes once on a 401 and retries the original request with the new token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: "Invalid or expired token" }))
      .mockResolvedValueOnce(jsonResponse(200, SESSION))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await authFetch("/assets/42");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer old-token" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/refresh");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(fetchMock.mock.calls[2][1].headers).toEqual({ Authorization: "Bearer new-token" });
    expect(useAuthStore.getState().accessToken).toBe("new-token");
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("clears auth and redirects to /login?next=<current page> when the refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(401, { detail: "expired" }))
        .mockResolvedValueOnce(jsonResponse(401, { detail: "Invalid or expired refresh token" })),
    );

    const res = await authFetch("/assets/42");

    expect(res.status).toBe(401);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(assignSpy).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/assets/42?tab=history")}`);
  });

  it("redirects to /login if the retried request still 401s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(401, {}))
        .mockResolvedValueOnce(jsonResponse(200, SESSION))
        .mockResolvedValueOnce(jsonResponse(401, {})),
    );
    await authFetch("/assets/42");
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("never tries to refresh for a failed login", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(401, { detail: "Invalid credentials" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await authFetch("/auth/login", { method: "POST" });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("shares a single refresh between concurrent 401s", async () => {
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      if (url === "/api/auth/refresh") return Promise.resolve(jsonResponse(200, SESSION));
      const auth = (init.headers as Record<string, string>).Authorization;
      return Promise.resolve(auth === "Bearer new-token" ? jsonResponse(200, {}) : jsonResponse(401, {}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all([authFetch("/a"), authFetch("/b"), authFetch("/c")]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/auth/refresh")).toHaveLength(1);
  });

  it("routes to the change-password screen when the server says a password change is required", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(403, { detail: PASSWORD_CHANGE_REQUIRED_DETAIL })));
    const res = await authFetch("/assets");
    expect(res.status).toBe(403);
    expect(useAuthStore.getState().mustChangePassword).toBe(true);
    expect(assignSpy).toHaveBeenCalledWith(`/change-password?next=${encodeURIComponent("/assets/42?tab=history")}`);
  });

  it("leaves an ordinary 403 alone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(403, { detail: "Not permitted for this action" })));
    await authFetch("/holders");
    expect(assignSpy).not.toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBe("old-token");
  });
});

describe("safeNextPath", () => {
  it("accepts in-app paths and rejects anything that could leave the app", () => {
    expect(safeNextPath("/assets/123")).toBe("/assets/123");
    expect(safeNextPath("/assets?q=CK_1")).toBe("/assets?q=CK_1");
    expect(safeNextPath("//evil.example/x")).toBeUndefined();
    expect(safeNextPath("/\\evil.example")).toBeUndefined();
    expect(safeNextPath("https://evil.example")).toBeUndefined();
    expect(safeNextPath("javascript:alert(1)")).toBeUndefined();
    expect(safeNextPath("/login")).toBeUndefined();
    expect(safeNextPath(undefined)).toBeUndefined();
  });
});
