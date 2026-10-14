import { describe, it, expect } from "vitest";
import { REMOVED, isSensitiveKey, redactDeep, redactText } from "./redact";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl";

describe("S8 redaction before a report leaves the browser", () => {
  it("replaces JWTs, Bearer headers and password=… pairs inside text", () => {
    expect(redactText(`token ${JWT} here`)).toBe(`token ${REMOVED} here`);
    expect(redactText("Authorization: Bearer abc.def-123")).toBe(`Authorization: Bearer ${REMOVED}`);
    expect(redactText("login?password=hunter2&x=1")).toBe(`login?password=${REMOVED}&x=1`);
    expect(redactText('{"password": "hunter2"}')).toBe(`{"password": "${REMOVED}"}`);
    expect(redactText("Nothing secret here.")).toBe("Nothing secret here.");
  });

  it("drops values under sensitive keys at any depth, keeps the rest", () => {
    const out = redactDeep({
      message: `failed with ${JWT}`,
      password: "hunter2",
      nested: { access_token: "x", refreshToken: "y", Authorization: "z", label: "Save", list: [{ api_key: "k", text: "ok" }] },
      footprint: "kept",
    });
    expect(out).toEqual({
      message: `failed with ${REMOVED}`,
      nested: { label: "Save", list: [{ text: "ok" }] },
      footprint: "kept",
    });
  });

  it("knows the sensitive key names", () => {
    for (const k of ["password", "new_password", "token", "accessToken", "secret", "cookie", "api-key", "pass", "otp"]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
    for (const k of ["message", "path", "requestId", "footprint", "passage_count", "label"]) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });

  it("survives cycles", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(redactDeep(a)).toEqual({ name: "a", self: REMOVED });
  });
});
