import { clearPoDraft } from "@/features/purchase-orders/po-draft";
import { useAuthStore } from "./auth-store";
import { addBreadcrumb } from "./breadcrumbs";
import { queryClient } from "./query-client";
import { notifyApiFailure, pathTemplate, recordRequest, rememberFailure, responseRequestId } from "./request-log";

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "/api";

// Must match backend app.core.deps.PASSWORD_CHANGE_REQUIRED_DETAIL.
export const PASSWORD_CHANGE_REQUIRED_DETAIL = "Password change required before using the app";

// Endpoints that must never trigger the refresh-and-retry dance: a 401 from
// /auth/login means "wrong password", and /auth/refresh failing is the very
// signal that the session is over.
const NO_REFRESH_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout", "/auth/companies"];

export interface SessionPayload {
  access_token: string;
  must_change_password: boolean;
  role: string;
  company_id: number | null;
  is_primary_owner: boolean;
  /** Not sent by the server yet (backend request); when absent the id is read
   * from the access token's `sub` claim instead. */
  asset_user_id?: number | null;
}

/**
 * Only same-origin, in-app paths are allowed as a post-login destination -- a bare
 * `?next=` value is attacker-controllable (it arrives via a URL, e.g. a QR label), so
 * anything absolute or protocol-relative ("//evil.example") is rejected (open redirect).
 */
export function safeNextPath(next: unknown): string | undefined {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return undefined;
  }
  // A browser drops tabs/newlines while parsing a URL ("/\t/evil.example" becomes "//evil.example"), so
  // control characters are refused outright, and the final word is the URL parser's own: same origin only.
  if (/[\u0000-\u001f\u007f]/.test(next)) return undefined;
  try {
    const origin = window.location.origin;
    if (new URL(next, origin).origin !== origin) return undefined;
  } catch {
    return undefined;
  }
  if (next.startsWith("/login") || next.startsWith("/change-password")) return undefined;
  return next;
}

/** sessionStorage key for the one-line notice the sign-in screen shows after a session ended on its own. */
export const LOGIN_NOTICE_KEY = "ckam-login-notice";
export const SESSION_ENDED_NOTICE = "Your session has ended. Please sign in again.";

/**
 * Forgets everything this tab knows about the signed-in person: the auth state (and its sessionStorage
 * entry `ckam-auth`), every cached server answer, and an unsaved manual PO draft -- so the next person to
 * sign in on this tab never sees any of it.
 */
export function clearLocalSession(): void {
  useAuthStore.getState().logout();
  try {
    useAuthStore.persist.clearStorage();
  } catch {
    // storage blocked: the state itself is already empty
  }
  clearPoDraft();
  queryClient.clear();
}

export function applySession(data: SessionPayload): void {
  useAuthStore.getState().setAuth({
    accessToken: data.access_token,
    role: data.role,
    companyId: data.company_id,
    isPrimaryOwner: data.is_primary_owner,
    mustChangePassword: data.must_change_password,
    assetUserId: data.asset_user_id ?? null,
  });
}

/** "renewed": a new access token is in place. "ended": the server refused the refresh cookie -- the session
 * is over. "unavailable": no verdict (too many requests 429, a server fault, or no answer) -- the session may
 * well still be valid, so the person is NOT signed out for it. */
export type RefreshOutcome = "renewed" | "ended" | "unavailable";

/**
 * After a successful POST /auth/change-password: the forced-change flag is cleared. The endpoint answers 204
 * today; when it answers with a fresh session instead (the server ending the old tokens on a password change)
 * that new access token -- and whatever else the session carries -- replaces the old one. A body without an
 * `access_token` keeps the current token.
 */
export function applyPasswordChangeResult(result: unknown): void {
  const s = useAuthStore.getState();
  const fresh =
    result && typeof result === "object" && typeof (result as { access_token?: unknown }).access_token === "string"
      ? (result as Partial<SessionPayload> & { access_token: string })
      : null;
  const accessToken = fresh?.access_token ?? s.accessToken;
  const role = typeof fresh?.role === "string" ? fresh.role : s.role;
  if (!accessToken || role === null) return;
  s.setAuth({
    accessToken,
    role,
    companyId: fresh && fresh.company_id !== undefined ? fresh.company_id : s.companyId,
    isPrimaryOwner: typeof fresh?.is_primary_owner === "boolean" ? fresh.is_primary_owner : s.isPrimaryOwner,
    mustChangePassword: false,
    assetUserId: fresh?.asset_user_id ?? (fresh ? null : s.assetUserId),
  });
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token (POST /auth/refresh).
 * Concurrent callers share one in-flight request, so a page firing several queries
 * at once after the access token expires refreshes exactly once.
 */
export function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<RefreshOutcome> => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" });
        if (res.status === 429 || res.status >= 500) return "unavailable";
        if (!res.ok) return "ended";
        applySession((await res.json()) as SessionPayload);
        return "renewed";
      } catch {
        return "unavailable";
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** true when a new access token is in place (see refreshSession for the full outcome). */
export async function refreshAccessToken(): Promise<boolean> {
  return (await refreshSession()) === "renewed";
}

/** Full-page navigations, behind an object so tests can observe them (jsdom can't navigate). */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Session is over: clear local auth state and go to /login, remembering where we were. The sign-in screen
 * then says so in one line (instead of the person landing on it, or on a blank page, with no reason given). */
export function redirectToLogin(): void {
  clearLocalSession();
  if (window.location.pathname.startsWith("/login")) return;
  try {
    window.sessionStorage.setItem(LOGIN_NOTICE_KEY, "expired");
  } catch {
    // storage blocked: the sign-in screen just shows no notice
  }
  const next = safeNextPath(currentPath());
  navigation.assign(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
}

function redirectToChangePassword(): void {
  const state = useAuthStore.getState();
  if (state.accessToken && state.role !== null) {
    state.setAuth({
      accessToken: state.accessToken, role: state.role, companyId: state.companyId,
      isPrimaryOwner: state.isPrimaryOwner, mustChangePassword: true,
    });
  }
  if (window.location.pathname.startsWith("/change-password")) return;
  const next = safeNextPath(currentPath());
  navigation.assign(next ? `/change-password?next=${encodeURIComponent(next)}` : "/change-password");
}

/**
 * fetch() for this app's API with the bearer token attached. Every authenticated
 * request -- JSON (api-client.ts), uploads, and blob downloads (exports, documents,
 * QR images, the import template) -- goes through here, because a plain <a href> or
 * <img src> never carries the Authorization header and would just 401.
 *
 * On a 401 it tries ONE token refresh and, if that works, retries the original
 * request once; if the refresh fails (or the retry still 401s) the session is over
 * and the user is sent to /login?next=<current page>.
 */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // S8: every call is remembered (method, path template, status, time, request id) in memory, and a
  // 5xx or a call that got no answer is announced to the automatic problem reports (when switched on).
  const started = Date.now();
  const method = (init.method ?? "GET").toUpperCase();
  const sentId = ((init.headers as Record<string, string> | undefined) ?? {})["X-Request-ID"] ?? null;
  const template = pathTemplate(path);
  // The problem report's own call never reports itself (no loops).
  const reportable = !path.startsWith("/client-reports");
  try {
    const res = await authFetchInner(path, init);
    const requestId = responseRequestId(res) ?? sentId;
    const status = typeof res?.status === "number" ? res.status : 0;
    const entry = { at: new Date(started).toISOString(), method, path: template, status, ms: Date.now() - started, requestId };
    recordRequest(entry);
    if (reportable) addBreadcrumb("api", `${method} ${template} → ${status}`, { status, requestId });
    if (status >= 500 && reportable) notifyApiFailure({ ...entry, message: `${status} ${method} ${template}` });
    return res;
  } catch (e) {
    const entry = { at: new Date(started).toISOString(), method, path: template, status: 0, ms: Date.now() - started, requestId: sentId };
    recordRequest(entry);
    if (reportable) addBreadcrumb("api", `${method} ${template} → no answer`, { status: 0, requestId: sentId });
    if (reportable) notifyApiFailure({ ...entry, message: `No answer from the server: ${method} ${template}` });
    if (e && typeof e === "object") {
      try {
        Object.assign(e, { isNetworkError: true, requestId: sentId });
      } catch {
        // a frozen error: leave it as it is
      }
    }
    throw e;
  }
}

async function authFetchInner(path: string, init: RequestInit): Promise<Response> {
  const send = () => {
    const token = useAuthStore.getState().accessToken;
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  };

  let res = await send();
  const refreshable = !NO_REFRESH_PATHS.some((p) => path.startsWith(p));

  if (res.status === 401 && refreshable) {
    const outcome = await refreshSession();
    if (outcome === "renewed") {
      res = await send();
    }
    // A refresh that could not be answered (429 / 5xx / offline) is not proof the session is over: the 401
    // goes back to the screen as an ordinary error, and the next call tries again -- no loop, no sign-out.
    if (res.status === 401 && outcome !== "unavailable") redirectToLogin();
  } else if (res.status === 403 && refreshable) {
    // The server enforces the forced first-login password change on every route
    // (403 + this exact detail) -- e.g. an admin reset this user's password mid-session.
    const detail = await res.clone().json().then((d) => d?.detail, () => undefined);
    if (detail === PASSWORD_CHANGE_REQUIRED_DETAIL) redirectToChangePassword();
  }
  return res;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
  } catch {
    // not JSON (or a test double without .json) -- use the fallback below
  }
  return `${fallback}: ${res.status}`;
}

/** Fetches an authenticated file and hands it to the browser as a download. */
export async function downloadFile(path: string, filename: string, failureLabel = "Download failed"): Promise<void> {
  const res = await authFetch(path);
  if (!res.ok) {
    const message = await errorMessage(res, failureLabel);
    const error = new Error(message.startsWith(failureLabel) ? message : `${failureLabel}: ${message}`);
    // S8: the reference of the failed download, shown under the sentence.
    const requestId = responseRequestId(res);
    Object.assign(error, { status: res.status, requestId });
    rememberFailure(error.message, requestId, res.status);
    throw error;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** How long signing out waits for the server before clearing this tab anyway. */
export const LOGOUT_TIMEOUT_MS = 4000;

/**
 * Log out: tell the server first (POST /auth/logout clears the refresh cookie and ends the person's
 * sessions), then clear local state. Best effort: a failure, an error status or a slow server never keeps
 * the person signed in on this tab -- local state is cleared regardless, after at most LOGOUT_TIMEOUT_MS.
 * The access token goes along (when there is one) so the server knows who is signing out even without the
 * cookie; the endpoint does not require it.
 */
export async function logoutSession(): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS) : null;
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch {
    // Offline, server down or too slow: still clear local state below.
  } finally {
    if (timer) clearTimeout(timer);
  }
  clearLocalSession();
}
