#!/usr/bin/env node
// Security AU-12 / AU-15 / N5 / FONTS live check of frontend/nginx.conf (not part of `vitest run`: it needs Docker).
//
// What it does, on THIS machine only, with a throw-away container that is always removed again:
//   1. `nginx -t` of nginx.conf in the nginx image the web container is built from (default nginx:alpine).
//   2. Starts that image on a free 127.0.0.1 port with the built dist/ and nginx.conf mounted read-only. There is
//      no API behind it (`api` points at 127.0.0.1 inside the container), so /api/ answers 502 -- enough to check
//      nginx's own headers there.
//   3. Asserts: GET /assets/nothing.js.map -> 404, GET /assets/nothing.js -> 404, GET /assets/nothing.woff2 -> 404,
//      an SPA route -> 200 app shell, the real bundle -> 200, index.html -> Cache-Control no-cache, an oversized
//      /api upload -> 413 JSON, the Server header carries no version, and on every one of those answers each
//      security header (CSP, Permissions-Policy, X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
//      appears EXACTLY once and the CSP names no Google host.
//
// Usage (from frontend/, after `npm run build`, Docker running):
//   npm run check:nginx-live
//   node scripts/check-nginx-live.mjs [distDir] [nginx.conf]      (env NGINX_IMAGE to use another image)
// Exit code 0 = all checks passed, 1 = a check failed, 2 = could not run (no Docker, no build, ...).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(process.argv[2] || path.join(here, "..", "dist"));
const confPath = path.resolve(process.argv[3] || path.join(here, "..", "nginx.conf"));
const IMAGE = process.env.NGINX_IMAGE || "nginx:alpine";
const NAME = `ckam-nginx-check-${process.pid}-${Date.now()}`;
const SECURITY_HEADERS = ["content-security-policy", "permissions-policy", "x-content-type-options", "x-frame-options", "referrer-policy"];

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf-8", ...opts });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
function request(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const counts = {};
        const values = {};
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          const k = res.rawHeaders[i].toLowerCase();
          counts[k] = (counts[k] || 0) + 1;
          values[k] = res.rawHeaders[i + 1];
        }
        resolve({ status: res.statusCode, counts, values, body: Buffer.concat(chunks).toString("utf-8") });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mount = (src, dst) => ["--mount", `type=bind,source=${src},target=${dst},readonly`];

async function main() {
  if (!fs.existsSync(path.join(distDir, "index.html"))) { console.error(`no build at ${distDir} (run npm run build first)`); return 2; }
  if (!fs.existsSync(confPath)) { console.error(`no nginx.conf at ${confPath}`); return 2; }
  if (docker(["version", "--format", "{{.Server.Version}}"]).status !== 0) { console.error("Docker is not available"); return 2; }

  const common = [...mount(distDir, "/usr/share/nginx/html"), ...mount(confPath, "/etc/nginx/conf.d/default.conf"), "--add-host", "api:127.0.0.1"];
  const t = docker(["run", "--rm", ...common, IMAGE, "nginx", "-t"]);
  const tOut = `${t.stdout}${t.stderr}`.trim();
  console.log(`nginx -t (${IMAGE}): ${tOut.split("\n").join(" | ")}`);
  if (t.status !== 0) { console.error("FAIL nginx -t"); return 1; }

  const port = await freePort();
  const run = docker(["run", "-d", "--rm", "--name", NAME, "-p", `127.0.0.1:${port}:80`, ...common, IMAGE]);
  if (run.status !== 0) { console.error(`could not start nginx: ${run.stderr}`); return 2; }
  const failures = [];
  const results = [];
  try {
    for (let i = 0; i < 50; i++) {
      try { await request(port, "GET", "/"); break; } catch { await sleep(200); }
    }
    const html = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
    const bundle = (html.match(/\/assets\/[^"']+\.js/) || [])[0];
    const checks = [
      { label: "source map", method: "GET", path: "/assets/nothing.js.map", status: 404 },
      { label: "missing script", method: "GET", path: "/assets/nothing.js", status: 404 },
      { label: "missing font", method: "GET", path: "/assets/nothing.woff2", status: 404 },
      { label: "SPA route", method: "GET", path: "/settings/system/logs", status: 200, shell: true },
      { label: "SPA route with a number", method: "GET", path: "/assets/42", status: 200, shell: true },
      { label: "root", method: "GET", path: "/", status: 200, shell: true, cache: "no-cache" },
      ...(bundle ? [{ label: "real bundle", method: "GET", path: bundle, status: 200 }] : []),
      { label: "API without upstream", method: "GET", path: "/api/health", status: 502, cache: "no-store" },
      {
        label: "oversized upload", method: "POST", path: "/api/documents", status: 413, json: true, cache: "no-store",
        headers: { "content-type": "application/octet-stream", "content-length": String(12 * 1024 * 1024) }, body: "x",
      },
    ];
    for (const c of checks) {
      let r;
      try { r = await request(port, c.method, c.path, { headers: c.headers, body: c.body }); }
      catch (e) { failures.push(`${c.label}: request failed (${e.message})`); continue; }
      const row = { label: c.label, path: c.path, status: r.status, headerCounts: Object.fromEntries(SECURITY_HEADERS.map((h) => [h, r.counts[h] || 0])) };
      results.push(row);
      if (r.status !== c.status) failures.push(`${c.label} ${c.path}: status ${r.status}, expected ${c.status}`);
      for (const h of SECURITY_HEADERS) if ((r.counts[h] || 0) !== 1) failures.push(`${c.label} ${c.path}: ${h} appears ${r.counts[h] || 0} times, expected exactly 1`);
      if (/googleapis|gstatic/i.test(r.values["content-security-policy"] || "")) failures.push(`${c.label}: CSP still names a Google host`);
      if ((r.values.server || "") !== "nginx") failures.push(`${c.label}: Server header is "${r.values.server}", expected plain "nginx"`);
      if (c.shell && !r.body.includes('<div id="root">')) failures.push(`${c.label} ${c.path}: not the app shell`);
      if (!c.shell && r.status === 404 && r.body.includes('<div id="root">')) failures.push(`${c.label} ${c.path}: 404 carries the app shell`);
      if (c.cache && (r.values["cache-control"] || "") !== c.cache) failures.push(`${c.label}: Cache-Control "${r.values["cache-control"]}", expected "${c.cache}"`);
      if (c.cache && (r.counts["cache-control"] || 0) !== 1) failures.push(`${c.label}: Cache-Control appears ${r.counts["cache-control"] || 0} times`);
      if (c.json) {
        try { if (!JSON.parse(r.body).detail) failures.push(`${c.label}: JSON without detail`); }
        catch { failures.push(`${c.label}: body is not JSON: ${r.body.slice(0, 80)}`); }
      }
    }
  } finally {
    docker(["rm", "-f", NAME]);
  }
  for (const r of results) console.log(`${String(r.status).padEnd(4)} ${r.path.padEnd(28)} ${r.label.padEnd(24)} ${JSON.stringify(r.headerCounts)}`);
  if (failures.length) {
    console.error(`check:nginx-live FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`check:nginx-live OK: ${results.length} requests, every security header exactly once, container ${NAME} removed.`);
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); docker(["rm", "-f", NAME]); process.exit(2); });
