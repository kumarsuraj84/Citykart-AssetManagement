import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  accessToken: string | null;
  role: string | null;
  companyId: number | null;
  mustChangePassword: boolean;
  setAuth: (a: { accessToken: string; role: string; companyId: number; mustChangePassword: boolean }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      role: null,
      companyId: null,
      mustChangePassword: false,
      setAuth: (a) => set({ ...a }),
      logout: () => set({ accessToken: null, role: null, companyId: null, mustChangePassword: false }),
    }),
    { name: "ckam-auth", storage: { getItem: (k) => JSON.parse(sessionStorage.getItem(k) ?? "null"), setItem: (k, v) => sessionStorage.setItem(k, JSON.stringify(v)), removeItem: (k) => sessionStorage.removeItem(k) } }
  )
);
