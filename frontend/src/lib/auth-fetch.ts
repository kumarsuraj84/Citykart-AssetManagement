import { useAuthStore } from "./auth-store";

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
  company_id: number;
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
  if (next.startsWith("/login") || next.startsWith("/change-password")) return undefined;
  return next;
}

export function applySession(data: SessionPayload): void {
  useAuthStore.getState().setAuth({
    accessToken: data.access_token,
    role: data.role,
    companyId: data.company_id,
    mustChangePassword: data.must_change_password,
  });
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token (POST /auth/refresh).
 * Concurrent callers share one in-flight request, so a page firing several queries
 * at once after the access token expires refreshes exactly once.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" });
        if (!res.ok) return false;
        applySession((await res.json()) as SessionPayload);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
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

/** Session is over: clear local auth state and go to /login, remembering where we were. */
export function redirectToLogin(): void {
  useAuthStore.getState().logout();
  if (window.location.pathname.startsWith("/login")) return;
  const next = safeNextPath(currentPath());
  navigation.assign(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
}

function redirectToChangePassword(): void {
  const state = useAuthStore.getState();
  if (state.accessToken && state.role !== null && state.companyId !== null) {
    state.setAuth({ accessToken: state.accessToken, role: state.role, companyId: state.companyId, mustChangePassword: true });
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
    if (await refreshAccessToken()) {
      res = await send();
    }
    if (res.status === 401) redirectToLogin();
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
    throw new Error(message.startsWith(failureLabel) ? message : `${failureLabel}: ${message}`);
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

/** Log out: clear the server-side refresh cookie as well as local state. */
export async function logoutSession(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    // Offline or server down: still clear local state below.
  }
  useAuthStore.getState().logout();
}
