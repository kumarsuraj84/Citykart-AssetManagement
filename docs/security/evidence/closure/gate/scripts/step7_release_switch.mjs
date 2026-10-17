// GT step 7: the documented release switch back (FRONTEND_DIST_DIR -> releases/3b5e842/frontend-dist, backend 3b5e842)
// while the database stays migrated (c6e8a0b2d4f6). Old release on 127.0.0.1:4112. The old dist is a STUB index.html
// (the real 3b5e842 frontend build is not on this PC); what is shown is the OLD BACKEND's behaviour.
// The IF-01 probes double as the POSITIVE CONTROL for step 4: the same FAKE canaries leak from the old release.
import fs from "node:fs";
import { rawGet } from "./raw.mjs";
import { Cases, GATE } from "./lib.mjs";
const port = 4112;
const C = new Cases(`${GATE}/out/cases_step7.csv`);
const log = [];
for (const [i, p] of ["/assets/1", "/assets/17", "/assets/new"].entries()) {
  const r = await rawGet(port, p);
  log.push(`${p} -> ${r.status} ${r.headers["content-type"]} ${r.body.slice(0, 100)}`);
  C.add(`GT-70${i}`, "7", `[old release, after switch-back] QR / Asset 360 deep link ${p}`, "documented consequence: 404 JSON again (CL2-IF-04 not in 3b5e842), the app does not open",
    `${r.status} ${r.headers["content-type"]} ${r.body.slice(0, 80)}`, r.status === 404 && (r.headers["content-type"] || "").includes("json"));
}
const sp = await rawGet(port, "/dashboard");
C.add("GT-703", "7", "[old release] other app address /dashboard", "200 shell from the old dist", `${sp.status} ${sp.body.slice(0, 60)}`, sp.status === 200 && sp.body.includes("OLD-RELEASE-STUB"));
const P = [
  ["fwd-slash x4 -> shared/.env", "/assets/..%2f..%2f..%2f..%2fshared%2f.env"],
  ["fwd-slash x4 -> nas.pw", "/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw"],
  ["encoded dots", "/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fshared%2f.env"],
  ["absolute path", "/assets/%2fsrv%2fckam%2fshared%2f.env"],
  ["/etc/passwd", "/assets/%2fetc%2fpasswd"],
];
let leaks = 0;
for (const [name, p] of P) {
  const r = await rawGet(port, p);
  const leaked = /FAKE-CANARY|root:x:0:0/.test(r.body);
  if (leaked) leaks++;
  log.push(`${leaked ? "LEAK" : "ok  "} ${r.status} ${name} :: ${p}`);
}
C.add("GT-704", "7", "[old release] POSITIVE CONTROL: the step-4 IF-01 probes against 3b5e842 on the same layout", "the FAKE canaries leak (proves the canary layout of step 4 was reachable)",
  `${leaks} of ${P.length} probes leaked a FAKE canary`, leaks > 0);
for (const [i, p] of ["/docs", "/openapi.json"].entries()) {
  const r = await rawGet(port, p);
  log.push(`${p} -> ${r.status} ${r.headers["content-type"]}`);
  C.add(`GT-70${5 + i}`, "7", `[old release] ${p}`, "observe (old release behaviour)", `${r.status} ${r.headers["content-type"]}`, true);
}
const u = await rawGet(port, "/api/nope");
C.add("GT-707", "7", "[old release] unknown /api/nope", "observe", `${u.status} ${u.headers["content-type"]} ${u.body.slice(0, 60)}`, true);
const hs = await rawGet(port, "/api/health");
C.add("GT-708", "7", "[old release] headers", "observe: CSP / Permissions-Policy present?", `csp=${!!hs.headers["content-security-policy"]} permissions-policy=${!!hs.headers["permissions-policy"]} server=${hs.headers["server"] || "none"}`, true);
fs.writeFileSync(`${GATE}/out/step7_raw.txt`, log.join("\n") + "\n");
C.save();
