import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LOGIN_NOTICE_KEY,
  LOGOUT_TIMEOUT_MS,
  applyPasswordChangeResult,
  authFetch,
  logoutSession,
  navigation,
  safeNextPath,
} from "./auth-fetch";
import { useAuthStore } from "./auth-store";
import { queryClient } from "./query-client";
import { errorMessageFrom } from "./api-client";
import { PO_DRAFT_KEY } from "@/features/purchase-orders/po-draft";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function signIn(token = "old-token") {
  useAuthStore.getState().setAuth({ accessToken: token, role: "ADMIN", companyId: 2, isPrimaryOwner: false, mustChangePassword: false });
}

describe("sign-out (security remediation 3a)", () => {
  beforeEach(() => signIn());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAuthStore.getState().logout();
    window.sessionStorage.clear();
  });

  it("calls POST /api/auth/logout with the session BEFORE clearing local state", async () => {
    let tokenWhenServerAsked: string | null = "unset";
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => {
      tokenWhenServerAsked = useAuthStore.getState().accessToken;
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await logoutSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/logout");
    expect(init).toMatchObject({ method: "POST", credentials: "include", headers: { Authorization: "Bearer old-token" } });
    expect(tokenWhenServerAsked).toBe("old-token");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("still signs out locally when the server call fails or answers with an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")));
    await logoutSession();
    expect(useAuthStore.getState().accessToken).toBeNull();

    signIn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(500, { detail: "boom" })));
    await logoutSession();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("never waits on a hanging server for longer than the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const done = logoutSession();
    await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS + 1);
    await done;
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("removes ckam-auth from sessionStorage, empties the query cache and drops an unsaved PO draft", async () => {
    expect(window.sessionStorage.getItem("ckam-auth")).toContain("old-token");
    window.sessionStorage.setItem(PO_DRAFT_KEY, JSON.stringify({ v: 1, lines: [], sets: [] }));
    queryClient.setQueryData(["assets"], [{ id: 1, description: "someone else's laptop" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })));

    await logoutSession();

    expect(window.sessionStorage.getItem("ckam-auth")).toBeNull();
    expect(window.sessionStorage.getItem(PO_DRAFT_KEY)).toBeNull();
    expect(queryClient.getQueryData(["assets"])).toBeUndefined();
    // Nothing about the session is ever written to localStorage.
    for (let i = 0; i < window.localStorage.length; i++) {
      expect(window.localStorage.getItem(window.localStorage.key(i)!)).not.toContain("old-token");
    }
  });
});

describe("a 401 after the refresh failed (3e) and a rate-limited refresh (3b)", () => {
  let assignSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    signIn();
    assignSpy = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    window.history.replaceState(null, "", "/assets/42");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAuthStore.getState().logout();
    window.sessionStorage.clear();
  });

  it("ends on the sign-in screen with a one-line notice, and clears the session and cache", async () => {
    queryClient.setQueryData(["assets", 42], { id: 42 });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: "expired" }))
      .mockResolvedValueOnce(jsonResponse(401, { detail: "Invalid or expired refresh token" })));

    await authFetch("/assets/42");

    expect(assignSpy).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/assets/42")}`);
    expect(window.sessionStorage.getItem(LOGIN_NOTICE_KEY)).toBe("expired");
    expect(window.sessionStorage.getItem("ckam-auth")).toBeNull();
    expect(queryClient.getQueryData(["assets", 42])).toBeUndefined();
  });

  it("does not sign out or loop when the refresh itself is rate-limited (429)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: "expired" }))
      .mockResolvedValueOnce(jsonResponse(429, { detail: "Too many requests" }, { "Retry-After": "60" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await authFetch("/assets/42");

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2); // the call and one refresh -- no retry storm
    expect(assignSpy).not.toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBe("old-token");
  });

  it("a 429 on sign-in itself is handed back as is: no refresh, no redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(429, { detail: "Too many sign-in attempts. Wait a minute and try again." }, { "Retry-After": "60" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await authFetch("/auth/login", { method: "POST" });
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("a 429 without a sentence of its own still reads as plain words", () => {
    expect(errorMessageFrom(null, 429)).toBe("Too many requests. Wait a minute and try again.");
    expect(errorMessageFrom({ detail: "Too many sign-in attempts. Wait a minute and try again." }, 429))
      .toBe("Too many sign-in attempts. Wait a minute and try again.");
  });
});

describe("change-password result (3d)", () => {
  afterEach(() => {
    useAuthStore.getState().logout();
    window.sessionStorage.clear();
  });

  it("a 204 keeps the current token and clears the forced-change flag", () => {
    useAuthStore.getState().setAuth({ accessToken: "t1", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: true });
    applyPasswordChangeResult(undefined);
    expect(useAuthStore.getState()).toMatchObject({ accessToken: "t1", role: "OPERATOR", mustChangePassword: false });
  });

  it("a fresh session in the answer replaces the old token", () => {
    useAuthStore.getState().setAuth({ accessToken: "t1", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: true });
    applyPasswordChangeResult({ access_token: "t2", role: "OPERATOR", company_id: 1, is_primary_owner: false, must_change_password: false });
    expect(useAuthStore.getState()).toMatchObject({ accessToken: "t2", mustChangePassword: false });
  });
});

describe("safeNextPath (open redirect)", () => {
  it("refuses control characters a browser would strip into a protocol-relative URL", () => {
    expect(safeNextPath("/\t/evil.test")).toBeUndefined();
    expect(safeNextPath("/\n/evil.test")).toBeUndefined();
    expect(safeNextPath("//evil.test")).toBeUndefined();
    expect(safeNextPath("/assets/1?q=a%2Fb")).toBe("/assets/1?q=a%2Fb");
  });
});
