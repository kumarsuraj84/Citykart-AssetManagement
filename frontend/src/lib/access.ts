/**
 * Who may open which area of the app -- the ONE place the sidebar, the route
 * guards and Home read. This is UX only: the server re-checks role, company
 * and work area on every request and stays the authority. Its job is that a
 * person never sees a working-looking screen that then fails with 403.
 */
import { useAuthStore } from "./auth-store";

export interface AccessState {
  role: string | null;
  isPrimaryOwner: boolean;
}

export type Area =
  /** Home, Assets list, Reports: everyone who is staff (not a self-service login). */
  | "staff"
  /** Purchase Orders, Receive, Add Assets, Move, Serial Pending, Print Labels. */
  | "work"
  /** People & Places (employees, stores, stock rooms, install points; logins). */
  | "people"
  /** Settings (companies, catalogue, vendors, ERP mapping, advanced, bulk import). */
  | "settings"
  /** The self-service "My Assets" page. */
  | "self";

const STAFF_ROLES = ["ADMIN", "OPERATOR", "VIEWER"];
const WORK_ROLES = ["ADMIN", "OPERATOR"];

export function canUse(area: Area, s: AccessState): boolean {
  const role = s.role;
  if (role === null) return false;
  switch (area) {
    case "staff":
      return STAFF_ROLES.includes(role);
    case "work":
      return WORK_ROLES.includes(role);
    case "people":
      return role === "ADMIN";
    case "settings":
      return role === "ADMIN" && s.isPrimaryOwner;
    case "self":
      return role === "SELF_SERVICE";
  }
}

/** Where a person lands after login (and from "/"). */
export function homePathFor(role: string | null): string {
  return role === "SELF_SERVICE" ? "/my-assets" : "/dashboard";
}

/** Reactive access helpers for components. */
export function useAccess() {
  const role = useAuthStore((s) => s.role);
  const isPrimaryOwner = useAuthStore((s) => s.isPrimaryOwner);
  const state: AccessState = { role, isPrimaryOwner };
  return {
    role,
    isPrimaryOwner,
    can: (area: Area) => canUse(area, state),
  };
}

/** Non-reactive read, for route `beforeLoad` checks. */
export function currentAccess(): AccessState {
  const { role, isPrimaryOwner } = useAuthStore.getState();
  return { role, isPrimaryOwner };
}
