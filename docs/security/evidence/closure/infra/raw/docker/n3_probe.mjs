// WP-C N3 / N5 proof on the throw-away project ckam-nr (web 127.0.0.1:3511 -> nginx 172.31.219.10, api 127.0.0.1:8300).
// 1. header counts on /, an SPA route, a missing static file, /api/health, a 401, a 404, a 413 (through nginx)
// 2. the address the API records for: the host via nginx (with a forged X-Forwarded-For), a second container on
//    the edge network via nginx, the host straight to the API port with a forged X-Forwarded-For
// 3. sign-in rate limit: 21 failed sign-ins from the host via nginx -> 429; the second container is NOT blocked;
//    a forged X-Forwarded-For from the host does not buy a new bucket.
// Usage: node n3_probe.mjs <outFile.json>
import http from "node:http";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const WEB = { host: "127.0.0.1", port: 3511 };
const API = { host: "127.0.0.1", port: 8300 };
const EDGE_NET = "ckam-nr_edge";
const WEB_IP = "172.31.219.10";
const IMAGE = "ckam-nr-api";
const SEC = ["content-security-policy", "permissions-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "cache-control", "x-request-id", "server"];
const out = { headerCounts: [], addresses: {}, rateLimit: {} };

function req(target, method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...target, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const counts = {};
        for (let i = 0; i < res.rawHeaders.length; i += 2) { const k = res.rawHeaders[i].toLowerCase(); counts[k] = (counts[k] || 0) + 1; }
        resolve({ status: res.statusCode, counts, body: Buffer.concat(chunks).toString() });
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

// 1. header counts through nginx
const cases = [
  ["GET", "/", {}, null, "shell"],
  ["GET", "/assets/x", {}, null, "SPA route /assets/x"],
  ["GET", "/assets/nothing.js", {}, null, "missing static file"],
  ["GET", "/assets/nothing.js.map", {}, null, "source map"],
  ["GET", "/api/health", {}, null, "api health"],
  ["GET", "/api/auth/capabilities", {}, null, "401 (no token)"],
  ["GET", "/api/does-not-exist", {}, null, "404 api"],
  ["POST", "/api/documents", { "content-type": "application/octet-stream", "content-length": String(12 * 1024 * 1024) }, "x", "413 oversized"],
];
for (const [method, path, headers, body, label] of cases) {
  const r = await req(WEB, method, path, headers, body);
  out.headerCounts.push({ label, method, path, status: r.status, ...Object.fromEntries(SEC.map((h) => [h, r.counts[h] || 0])) });
}

// 2. addresses
const rid = (s) => `wpc-n3-${s}-${Date.now()}`;
const ids = { hostViaNginxForged: rid("host-nginx-forged"), containerViaNginx: rid("container-nginx"), hostDirectForged: rid("host-direct-forged") };
await req(WEB, "GET", "/api/health", { "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4", "x-request-id": ids.hostViaNginxForged });
const py = (code) => spawnSync("docker", ["run", "--rm", "--network", EDGE_NET, "--entrypoint", "python", IMAGE, "-c", code], { encoding: "utf-8" });
const c1 = py(`import urllib.request as u;r=u.Request("http://${WEB_IP}/api/health",headers={"X-Request-ID":"${ids.containerViaNginx}"});print(u.urlopen(r).status)`);
out.addresses.containerCall = (c1.stdout + c1.stderr).trim();
await req(API, "GET", "/api/health", { "x-forwarded-for": "1.2.3.4", "x-request-id": ids.hostDirectForged });
out.addresses.requestIds = ids;

// 3. rate limit (per client address: 20/min). Distinct login ids, so the per-login-id limit (10/min) is not what trips.
const login = (target, n, extra = {}) => req(target, "POST", "/api/auth/login", { "content-type": "application/json", ...extra }, JSON.stringify({ login_id: `nobody${n}`, password: "wrong-password-x" }));
const hostStatuses = [];
for (let i = 1; i <= 21; i++) hostStatuses.push((await login(WEB, i)).status);
out.rateLimit.host21 = hostStatuses;
out.rateLimit.hostForgedXffAfterLimit = (await login(WEB, 99, { "x-forwarded-for": "9.9.9.9" })).status;
const c2 = py(`import urllib.request as u,urllib.error as e,json
r=u.Request("http://${WEB_IP}/api/auth/login",data=json.dumps({"login_id":"othernobody1","password":"wrong-password-x"}).encode(),headers={"Content-Type":"application/json"})
try:
  print(u.urlopen(r).status)
except e.HTTPError as x:
  print(x.code)`);
out.rateLimit.secondContainerAfterHostBlocked = (c2.stdout + c2.stderr).trim();
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
console.table(out.headerCounts);
console.log(JSON.stringify({ addresses: out.addresses, rateLimit: out.rateLimit }, null, 1));
