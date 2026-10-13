import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  accessToken: string | null;
  role: string | null;
  companyId: number | null;
  isPrimaryOwner: boolean;
  mustChangePassword: boolean;
  /** The logged-in person's own asset-user id (the "Mine" filter in Assets).
   * Taken from the login/refresh response when the server sends it, else read
   * from the access token's `sub` claim (display/filter convenience only --
   * the server never trusts it from the client). */
  assetUserId: number | null;
  setAuth: (a: {
    accessToken: string;
    role: string;
    companyId: number | null;
    isPrimaryOwner: boolean;
    mustChangePassword: boolean;
    assetUserId?: number | null;
  }) => void;
  logout: () => void;
}

/** Reads the numeric `sub` claim of a JWT without verifying it (UX only). */
export function assetUserIdFromToken(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      role: null,
      companyId: null,
      isPrimaryOwner: false,
      mustChangePassword: false,
      assetUserId: null,
      setAuth: (a) => set({ ...a, assetUserId: a.assetUserId ?? assetUserIdFromToken(a.accessToken) }),
      logout: () => set({ accessToken: null, role: null, companyId: null, isPrimaryOwner: false, mustChangePassword: false, assetUserId: null }),
    }),
    { name: "ckam-auth", storage: { getItem: (k) => JSON.parse(sessionStorage.getItem(k) ?? "null"), setItem: (k, v) => sessionStorage.setItem(k, JSON.stringify(v)), removeItem: (k) => sessionStorage.removeItem(k) } }
  )
);

/** The current user's own asset-user id, or null (e.g. a session from before this field existed). */
export function useMyAssetUserId(): number | null {
  return useAuthStore((s) => s.assetUserId ?? assetUserIdFromToken(s.accessToken));
}
