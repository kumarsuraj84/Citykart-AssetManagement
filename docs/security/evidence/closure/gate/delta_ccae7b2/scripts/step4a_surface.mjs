// GT step 4a: production-mode surface of the PACKAGE on 127.0.0.1:<port>: health, docs closed, unknown /api,
// security headers exactly once, no Server header, CSP without Google hosts, and the IF-01 attack list
// (adapted from docs/security/evidence/closure/windows/attack.mjs to the Linux container layout
// /srv/ckam/{releases/ccae7b2/frontend-dist, shared/.env, shared/nas.pw}). Bodies are only scanned for the FAKE canaries.
import fs from "node:fs";
import { rawGet, headerCounts } from "./raw.mjs";
import { Cases, GATE } from "./lib.mjs";
const port = Number(process.argv[2] || 4111);
const tag = process.argv[3] || "pkg";
const C = new Cases(`${GATE}/out/cases_step4a_${tag}.csv`);
const log = [];
const JS = "index-Cp5JgQR-.js", CSS = "index-Bj21ou3B.css";
const ROOT_FWD = "%2fsrv%2fckam";

// 1. health / docs / unknown api
const h = await rawGet(port, "/api/health");
C.add("GT-040", "4", "GET /api/health", "200 {\"status\":\"ok\"}", `${h.status} ${h.body}`, h.status === 200 && h.body.includes('"ok"'));
let n = 41;
for (const p of ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"]) {
  const r = await rawGet(port, p);
  const isJson = (r.headers["content-type"] || "").includes("application/json");
  C.add(`GT-0${n++}`, "4", `GET ${p} (API docs closed, AU-11/IF-14)`, "404 JSON (no Swagger/ReDoc/OpenAPI)", `${r.status} ${r.headers["content-type"]} ${r.body.slice(0, 90)}`,
    r.status === 404 && isJson && !/swagger|redoc|"openapi"/i.test(r.body));
}
for (const p of ["/api/nope", "/api/does-not-exist/deeper", "/api/assets/abc/nothing"]) {
  const r = await rawGet(port, p);
  let j = null; try { j = JSON.parse(r.body); } catch {}
  C.add(`GT-0${n++}`, "4", `GET ${p} (unknown /api, N6)`, "404 JSON envelope with request_id, not HTML", `${r.status} ${r.body.slice(0, 120)}`,
    r.status === 404 && j && JSON.stringify(j).includes("request_id") && !r.body.includes("<html"));
}
// 2. headers exactly once on several response kinds
const once = ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "x-request-id"];
for (const p of ["/api/health", "/", "/login", `/assets/${JS}`, "/assets/1", "/api/nope", "/assets/..%2f..%2fx", "/favicon.svg"]) {
  const r = await rawGet(port, p);
  const c = headerCounts(r.raw);
  const bad = once.filter((k) => c[k] !== 1).map((k) => `${k}=${c[k] || 0}`);
  const dup = Object.entries(c).filter(([, v]) => v > 1).map(([k, v]) => `${k}x${v}`);
  const server = c["server"] || 0;
  const csp = r.headers["content-security-policy"] || "";
  const google = /google|gstatic/i.test(csp);
  const cc = r.headers["cache-control"] || "";
  const ccOk = p.startsWith("/api/") ? cc === "no-store" : true;
  log.push(`HEADERS ${p} -> ${r.status} ${JSON.stringify(r.raw.filter((_, i) => i % 2 === 0))}`);
  C.add(`GT-0${n++}`, "4", `security headers on ${p}`, "each security header exactly once, no Server header, CSP has no Google host" + (p.startsWith("/api/") ? ", Cache-Control no-store" : ""),
    `${r.status} missing/dup=[${bad.join(",")}] dups=[${dup.join(",")}] server=${server} googleInCsp=${google} cache-control=${cc}`,
    bad.length === 0 && dup.length === 0 && server === 0 && !google && ccOk);
}
const cspFull = (await rawGet(port, "/")).headers["content-security-policy"];
log.push("CSP " + cspFull);

// 3. IF-01 attack list
const P = [
  ["fwd-slash x4 encoded -> shared/.env", "/assets/..%2f..%2f..%2f..%2fshared%2f.env"],
  ["fwd-slash x4 encoded -> nas.pw", "/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw"],
  ["fwd-slash x4 encoded -> launcher", "/assets/..%2f..%2f..%2f..%2fshared%2frun_ckam_web.ps1"],
  ["fwd-slash x5 -> canary_root.txt", "/assets/..%2f..%2f..%2f..%2fcanary_root.txt"],
  ["plain ../ (unencoded) x4", "/assets/../../../../shared/.env"],
  ["encoded dots %2e%2e%2f", "/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fshared%2f.env"],
  ["backslash x4 (..%5c)", "/assets/..%5c..%5c..%5c..%5cshared%5c.env"],
  ["encoded dotdot + backslash (%2e%2e%5c)", "/assets/%2e%2e%5c%2e%2e%5c%2e%2e%5c%2e%2e%5cshared%5c.env"],
  ["mixed slash/backslash", "/assets/..%5c../..%5c../shared/.env"],
  ["mixed encoded", "/assets/..%2f..%5c..%2f..%5cshared%2f.env"],
  ["double encoded backslash", "/assets/..%255c..%255c..%255c..%255cshared%255c.env"],
  ["double encoded slash", "/assets/%252e%252e%252f%252e%252e%252f%252e%252e%252f%252e%252e%252fshared%252f.env"],
  ["overlong UTF-8 slash", "/assets/..%c0%af..%c0%af..%c0%af..%c0%afshared%c0%af.env"],
  ["sibling file in dist (one up)", "/assets/..%2findex.html"],
  ["sibling file in dist (backslash)", "/assets/..%5cindex.html"],
  ["sibling folder same prefix (assets-evil)", "/assets/..%2fassets-evil%2fx"],
  ["sibling folder same prefix (backslash)", "/assets/..%5cassets-evil%5cx"],
  ["absolute linux path encoded", `/assets/${ROOT_FWD}%2fshared%2f.env`],
  ["absolute linux path double slash", "/assets//srv/ckam/shared/.env"],
  ["/etc/passwd encoded", "/assets/%2fetc%2fpasswd"],
  ["/etc/passwd traversal", "/assets/..%2f..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd"],
  ["drive fwd C:%2fWindows%2fwin.ini", "/assets/C:%2fWindows%2fwin.ini"],
  ["drive back C:%5cWindows%5cwin.ini", "/assets/C:%5cWindows%5cwin.ini"],
  ["win.ini via leading slash", "/assets//C:/Windows/win.ini"],
  ["drive-relative C:win.ini", "/assets/C:win.ini"],
  ["UNC %5c%5cserver%5cshare", "/assets/%5c%5cserver%5cshare%5cx"],
  ["UNC forward //server/share", "/assets//server/share/x.txt"],
  ["UNC localhost admin share", "/assets/%5c%5clocalhost%5cC$%5cWindows%5cwin.ini"],
  ["ADS ::$DATA", `/assets/${JS}::$DATA`],
  ["ADS named stream", `/assets/${JS}:stream`],
  ["trailing dot", `/assets/${JS}.`],
  ["trailing space", `/assets/${JS}%20`],
  ["device CON", "/assets/CON"],
  ["device NUL", "/assets/NUL"],
  ["device nul.txt", "/assets/nul.txt"],
  ["device aux.js", "/assets/aux.js"],
  ["device COM1", "/assets/COM1"],
  ["8.3 short name", "/assets/INDEX-~1.JS"],
  ["NUL byte", `/assets/${JS}%00.txt`],
  ["NUL byte traversal", "/assets/..%2f..%2f..%2f..%2fshared%2f.env%00.js"],
  ["long name (5000)", "/assets/" + "a".repeat(5000)],
  ["dot segment", "/assets/./" + JS],
  ["hidden dotfile", "/assets/.env"],
  ["symlink file -> shared/.env", "/assets/link-env.txt"],
  ["symlinked dir -> shared/.env", "/assets/linkdir/.env"],
  ["symlinked dir -> nas.pw", "/assets/linkdir/nas.pw"],
  ["symlinked dir encoded", "/assets/linkdir%2f.env"],
];
let leaks = 0, fivexx = 0;
const bodies = new Map();
const canary = /FAKE-CANARY|root:x:0:0|\[fonts\]|for 16-bit app support/i;
for (const [name, path] of P) {
  const r = await rawGet(port, path);
  const leaked = canary.test(r.body);
  if (leaked) leaks++;
  if (typeof r.status === "number" && r.status >= 500) fivexx++;
  const key = `${r.status}|${r.headers["content-type"]}|${r.body.replace(/"request_id":"[0-9a-f]+"/, "\"request_id\":\"<id>\"")}`;
  bodies.set(key, (bodies.get(key) || 0) + 1);
  log.push(`${leaked ? "LEAK" : "ok  "} ${r.status} ${name} :: ${path.slice(0, 120)} :: ${r.body.slice(0, 60).replace(/\s+/g, " ")}`);
  C.add(`GT-1${String(P.findIndex((x) => x[1] === path)).padStart(2, "0")}`, "4", `IF-01 probe: ${name}`, "404, plain refusal, no canary", `${r.status} ${r.body.slice(0, 50)}`,
    r.status === 404 && !leaked);
}
const distinct = [...bodies.keys()];
log.push("DISTINCT REFUSAL ANSWERS: " + JSON.stringify(distinct.map((k) => k.slice(0, 120))));
C.add("GT-160", "4", "IF-01 summary", "0 leaks, 0 5xx, one identical refusal answer", `payloads=${P.length} leaks=${leaks} 5xx=${fivexx} distinct_answers=${distinct.length} :: ${distinct.map((k) => k.slice(0, 60)).join(" || ")}`,
  leaks === 0 && fivexx === 0 && distinct.length === 1);

// 4. legitimate files and app addresses
const legit = [[`/assets/${JS}`, "javascript"], [`/assets/${CSS}`, "text/css"], ["/favicon.svg", "svg"], ["/logo.png", "image/png"], ["/favicon.webp", "webp"], ["/icons.svg", "svg"]];
const fonts = fs.readdirSync(`${GATE}/root/releases/ccae7b2/frontend-dist/assets`).filter((f) => f.endsWith(".woff2"));
for (const f of fonts) legit.push([`/assets/${f}`, ""]); // any type: Python mimetypes on this Linux image has no woff2 entry (observation GT-F03)
let m = 61;
for (const [p, ct] of legit) {
  const r = await rawGet(port, p);
  C.add(`GT-1${m++}`, "4", `legitimate file ${p}`, `200 ${ct}`, `${r.status} ${r.headers["content-type"]} ${r.buf.length} bytes`, r.status === 200 && (r.headers["content-type"] || "").includes(ct) && r.buf.length > 0);
}
for (const p of ["/assets/1", "/assets/17", "/assets/new", "/assets/12345", "/purchase-orders/2", "/dashboard", "/some/spa/route"]) {
  const r = await rawGet(port, p);
  const shell = r.body.includes(`/assets/${JS}`);
  C.add(`GT-1${m++}`, "4", `app address ${p} (cold request)`, "200 SPA shell (index.html of the package)", `${r.status} ${r.headers["content-type"]} shell=${shell} cache-control=${r.headers["cache-control"]}`, r.status === 200 && shell);
}
fs.writeFileSync(`${GATE}/out/step4a_${tag}_raw.txt`, log.join("\n") + "\n");
C.save();
