import { describe, it, expect, afterEach } from "vitest";
import { canUse, homePathFor, type Area } from "./access";
import { assetUserIdFromToken, useAuthStore } from "./auth-store";
import { applySession } from "./auth-fetch";

const AREAS: Area[] = ["staff", "work", "people", "settings", "self"];

function allowed(role: string, isPrimaryOwner = false) {
  return AREAS.filter((a) => canUse(a, { role, isPrimaryOwner }));
}

describe("access: who may open which area (UX only; the server decides)", () => {
  it("matches the S1 role menus", () => {
    expect(allowed("ADMIN", true)).toEqual(["staff", "work", "people", "settings"]);
    expect(allowed("ADMIN")).toEqual(["staff", "work", "people"]);
    expect(allowed("OPERATOR")).toEqual(["staff", "work"]);
    expect(allowed("VIEWER")).toEqual(["staff"]);
    expect(allowed("SELF_SERVICE")).toEqual(["self"]);
    expect(AREAS.filter((a) => canUse(a, { role: null, isPrimaryOwner: false }))).toEqual([]);
  });

  it("lands self-service logins on My Assets and everyone else on Home", () => {
    expect(homePathFor("SELF_SERVICE")).toBe("/my-assets");
    expect(homePathFor("VIEWER")).toBe("/dashboard");
  });
});

describe("auth store: the person's own id for the Mine filter", () => {
  afterEach(() => useAuthStore.getState().logout());

  const jwt = (payload: object) =>
    `x.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.y`;

  it("reads the asset-user id from the access token when the server does not send it", () => {
    expect(assetUserIdFromToken(jwt({ sub: "42", role: "OPERATOR" }))).toBe(42);
    expect(assetUserIdFromToken("not-a-jwt")).toBeNull();
    expect(assetUserIdFromToken(jwt({ sub: "abc" }))).toBeNull();
    expect(assetUserIdFromToken(null)).toBeNull();

    applySession({ access_token: jwt({ sub: "7" }), must_change_password: false, role: "OPERATOR", company_id: 1, is_primary_owner: false });
    expect(useAuthStore.getState().assetUserId).toBe(7);
  });

  it("prefers the id the server sends in the login response", () => {
    applySession({
      access_token: jwt({ sub: "7" }), must_change_password: false, role: "OPERATOR", company_id: 1,
      is_primary_owner: false, asset_user_id: 9,
    });
    expect(useAuthStore.getState().assetUserId).toBe(9);
  });

  it("clears it on logout", () => {
    applySession({ access_token: jwt({ sub: "7" }), must_change_password: false, role: "OPERATOR", company_id: 1, is_primary_owner: false });
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().assetUserId).toBeNull();
  });
});
