// WP-F live check of CL2-IF-03 (X-Request-ID exactly once on every answer of frontend/nginx.conf).
// Throw-away only: its own docker network, a stand-in "api" (nginx answering with its own X-Request-ID) and the
// nginx under test on a free 127.0.0.1 port; everything is removed at the end.
// Usage: node xrid_live.mjs <distDir> <nginx.conf> <fakeapi.conf>
import { spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const [distDir, confPath, fakeConf] = process.argv.slice(2).map((p) => path.resolve(p));
const tag = `ckam-wpf-xrid-${process.pid}`;
const NET = `${tag}-net`, API = `${tag}-api`, WEB = `${tag}-web`;
const docker = (args) => spawnSync("docker", args, { encoding: "utf-8" });
const mount = (src, dst) => ["--mount", `type=bind,source=${src},target=${dst},readonly`];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
function request(port, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const ids = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) if (res.rawHeaders[i].toLowerCase() === "x-request-id") ids.push(res.rawHeaders[i + 1]);
        resolve({ status: res.statusCode, ids });
      });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

const failures = [];
async function run() {
  docker(["network", "create", NET]);
  let r = docker(["run", "-d", "--rm", "--name", API, "--network", NET, "--network-alias", "api", ...mount(fakeConf, "/etc/nginx/conf.d/default.conf"), "nginx:alpine"]);
  if (r.status) throw new Error(r.stderr);
  const port = await freePort();
  r = docker(["run", "-d", "--rm", "--name", WEB, "--network", NET, "-p", `127.0.0.1:${port}:80`, ...mount(distDir, "/usr/share/nginx/html"), ...mount(confPath, "/etc/nginx/conf.d/default.conf"), "nginx:alpine"]);
  if (r.status) throw new Error(r.stderr);
  for (let i = 0; i < 50; i++) { try { await request(port, "GET", "/"); break; } catch { await sleep(200); } }
  const cases = [
    ["root (shell)", "GET", "/", 200, "nginx"], ["SPA route", "GET", "/settings/system/logs", 200, "nginx"],
    ["Asset 360 address", "GET", "/assets/42", 200, "nginx"], ["missing script", "GET", "/assets/nothing.js", 404, "nginx"],
    ["source map", "GET", "/assets/x.js.map", 404, "nginx"], ["favicon", "GET", "/favicon.svg", 200, "nginx"],
    ["API answer (passed through)", "GET", "/api/health", 200, "app-request-id-0001"],
    ["API 404 (passed through)", "GET", "/api/nope", 404, "app-request-id-0404"],
    ["client-sent id is not adopted", "GET", "/api/health", 200, "app-request-id-0001", { "X-Request-ID": "evil-client-id" }],
    ["oversized upload (413)", "POST", "/api/documents", 413, "nginx", { "content-type": "application/octet-stream", "content-length": String(12 * 1024 * 1024) }, "x"],
  ];
  for (const [label, method, p, status, want, headers, body] of cases) {
    const res = await request(port, method, p, headers, body);
    const ok = res.status === status && res.ids.length === 1 && (want === "nginx" ? /^[0-9a-f]{32}$/.test(res.ids[0]) : res.ids[0] === want);
    console.log(`${ok ? "PASS" : "FAIL"} ${String(res.status).padEnd(4)} ${p.padEnd(24)} ${label.padEnd(30)} X-Request-ID x${res.ids.length}: ${res.ids.join(" | ")}`);
    if (!ok) failures.push(label);
  }
  docker(["rm", "-f", API]);                    // API down: nginx's own 502 gets nginx's id, once
  await sleep(500);
  const down = await request(port, "GET", "/api/health");
  const ok = down.status >= 500 && down.ids.length === 1 && /^[0-9a-f]{32}$/.test(down.ids[0]);
  console.log(`${ok ? "PASS" : "FAIL"} ${String(down.status).padEnd(4)} ${"/api/health".padEnd(24)} ${"API down (nginx's own 5xx)".padEnd(30)} X-Request-ID x${down.ids.length}: ${down.ids.join(" | ")}`);
  if (!ok) failures.push("api down");
}
try { await run(); } catch (e) { console.error(e); failures.push(String(e)); }
finally {
  docker(["rm", "-f", WEB]); docker(["rm", "-f", API]); docker(["network", "rm", NET]);
  const left = docker(["ps", "-a", "--filter", `name=${tag}`, "--format", "{{.Names}}"]).stdout.trim();
  const leftNet = docker(["network", "ls", "--filter", `name=${tag}`, "--format", "{{.Name}}"]).stdout.trim();
  console.log(`cleanup: containers left [${left}], networks left [${leftNet}]`);
}
console.log(failures.length ? `X-Request-ID live check FAILED: ${failures.join(", ")}` : "X-Request-ID live check OK: exactly one id on every answer");
process.exit(failures.length ? 1 : 0);
