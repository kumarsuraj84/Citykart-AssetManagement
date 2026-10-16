// CL2-IF item 7: python-jose advisories re-evaluated against real behaviour. The API pins algorithms=["HS256"]
// (backend/app/core/security.py). Forged tokens with other algorithms / no signature must all be 401.
// usage: node jwt_alg_probe.mjs <api-base>
import crypto from "node:crypto";
const base = process.argv[2] || "http://127.0.0.1:8200";
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const payload = { sub: "2", role: "ADMIN", type: "access", exp: Math.floor(Date.now() / 1000) + 600 };
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pubDer = publicKey.export({ type: "spki", format: "der" });
const cases = {
  "alg none, no signature": `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`,
  "alg None (case)": `${b64({ alg: "None", typ: "JWT" })}.${b64(payload)}.`,
  "HS256 keyed with an attacker DER public key (PYSEC-2026-4298 pattern)": (() => {
    const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
    return `${h}.${crypto.createHmac("sha256", pubDer).update(h).digest("base64url")}`;
  })(),
  "HS512 keyed with an attacker DER public key": (() => {
    const h = `${b64({ alg: "HS512", typ: "JWT" })}.${b64(payload)}`;
    return `${h}.${crypto.createHmac("sha512", pubDer).update(h).digest("base64url")}`;
  })(),
  "ES256 signed with an attacker key": (() => {
    const h = `${b64({ alg: "ES256", typ: "JWT" })}.${b64(payload)}`;
    return `${h}.${crypto.sign("sha256", Buffer.from(h), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  })(),
  "HS256 with an empty key": (() => {
    const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
    return `${h}.${crypto.createHmac("sha256", "").update(h).digest("base64url")}`;
  })(),
};
for (const [name, tok] of Object.entries(cases)) {
  const r = await fetch(base + "/api/auth/capabilities", { headers: { Authorization: "Bearer " + tok } });
  console.log(`${r.status}  ${name}  ${(await r.text()).slice(0, 60)}`);
}
