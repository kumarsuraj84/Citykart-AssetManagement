// Throw-away static server (WP-C fonts check): serves a built frontend dist with the CSP / Permissions-Policy
// read from the given nginx.conf, SPA fallback, 404 for missing static files, and proxies /api to the ckam-sec API.
// Usage: node server.mjs <distDir> <port> <nginx.conf> [apiHost:port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [distDir, portArg, confPath, apiArg = "127.0.0.1:8200"] = process.argv.slice(2);
const PORT = Number(portArg || 3498);
const [API_HOST, API_PORT] = apiArg.split(":");
const nginx = fs.readFileSync(confPath, "utf-8");
const CSP = nginx.match(/map \$host \$ckam_csp \{\s*default "([^"]+)";/)[1];
const PP = nginx.match(/map \$host \$ckam_permissions_policy \{\s*default "([^"]+)";/)[1];
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff",
};
const root = path.resolve(distDir);

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    const up = http.request({ host: API_HOST, port: API_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` } }, (r) => {
      const h = { ...r.headers };
      delete h["content-security-policy"];
      delete h["permissions-policy"];
      res.writeHead(r.statusCode, { ...h, "content-security-policy": CSP, "permissions-policy": PP });
      r.pipe(res);
    });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
    return;
  }
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let file = path.resolve(path.join(root, urlPath));
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Permissions-Policy", PP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (!file.startsWith(root)) { res.writeHead(400); return res.end(); }
  if (/\.map$/i.test(urlPath)) { res.writeHead(404); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (/\.[a-z0-9]+$/i.test(urlPath)) { res.writeHead(404); return res.end(); }
    file = path.join(root, "index.html");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`server on http://127.0.0.1:${PORT} CSP=${CSP}`));
