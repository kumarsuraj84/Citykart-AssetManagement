// Native-Windows IF-01 / QR check against the RELEASE PACKAGE ccae7b2 running in production mode.
// usage: node winrel_attack.mjs <port>
import http from "node:http";

const port = Number(process.argv[2]);
const rootEnc = "C:%5cUsers%5cUser2%5cAppData%5cLocal%5cTemp%5cclaude%5cD--ANKUR-AI-PROJECTS-Asset-Management%5c33a6302e-4441-4084-94a5-472d20016684%5cscratchpad%5cwinrel";
const JS = "index-Cp5JgQR-.js";

const P = [
  ["backslash x4", "/assets/..%5c..%5c..%5c..%5cshared%5c.env"],
  ["encoded dotdot + backslash", "/assets/%2e%2e%5c%2e%2e%5c%2e%2e%5c%2e%2e%5cshared%5c.env"],
  ["forward slash x4 (encoded)", "/assets/..%2f..%2f..%2f..%2fshared%2f.env"],
  ["mixed slash/backslash", "/assets/..%5c../..%5c../shared/.env"],
  ["double encoded backslash", "/assets/..%255c..%255c..%255c..%255cshared%255c.env"],
  ["double encoded slash", "/assets/%252e%252e%252f%252e%252e%252f%252e%252e%252f%252e%252e%252fshared%252f.env"],
  ["one level up (index.html)", "/assets/..%5cindex.html"],
  ["nas.pw", "/assets/..%5c..%5c..%5c..%5cshared%5cnas.pw"],
  ["absolute drive path (backslash)", `/assets/${rootEnc}%5cshared%5c.env`],
  ["absolute drive path (forward)", `/assets/${rootEnc.replaceAll("%5c", "%2f")}%2fshared%2f.env`],
  ["drive in url, win.ini", "/assets/C:%2fWindows%2fwin.ini"],
  ["drive backslash, win.ini", "/assets/C:%5cWindows%5cwin.ini"],
  ["win.ini via leading slash", "/assets//C:/Windows/win.ini"],
  ["UNC-like backslashes", "/assets/%5c%5cserver%5cshare%5cx.txt"],
  ["UNC-like forward", "/assets//server/share/x.txt"],
  ["UNC admin share on localhost", "/assets/%5c%5clocalhost%5cC$%5cWindows%5cwin.ini"],
  ["drive-relative", "/assets/C:win.ini"],
  ["alternate data stream", `/assets/${JS}::$DATA`],
  ["alternate data stream (named)", `/assets/${JS}:stream`],
  ["trailing dot", `/assets/${JS}.`],
  ["trailing space", `/assets/${JS}%20`],
  ["reserved CON", "/assets/CON"],
  ["reserved nul.txt", "/assets/nul.txt"],
  ["reserved aux.js", "/assets/aux.js"],
  ["reserved sub/CON", "/assets/sub/CON"],
  ["8.3 short name", "/assets/INDEX-~1.JS"],
  ["NUL byte", `/assets/${JS}%00.txt`],
  ["long name", "/assets/" + "a".repeat(5000)],
  ["sibling prefix", "/assets/..%5cassets-evil%5cx"],
  ["missing map", `/assets/${JS}.map`],
  ["missing js", "/assets/nothing.js"],
  ["missing css", "/assets/nothing.css"],
];

function get(path, method = "GET") {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", (e) => resolve({ status: "ERR " + e.code, body: "", headers: {} }));
    req.end();
  });
}

const stripId = (s) => s.replace(/"request_id":"[0-9a-f]+"/, '"request_id":"-"');
let leaks = 0, fivexx = 0; const bodies = new Set();
for (const [name, path] of P) {
  const r = await get(path);
  const leaked = /FAKE-CANARY|\[fonts\]|\[extensions\]|for 16-bit app support/i.test(r.body);
  if (leaked) leaks++;
  if (typeof r.status === "number" && r.status >= 500) fivexx++;
  bodies.add(r.status + "|" + stripId(r.body).slice(0, 80));
  console.log(`${leaked ? "LEAK " : "ok   "} ${String(r.status).padEnd(4)} ${name}`);
}
const legit = await get(`/assets/${JS}`);
const shell = await get("/some/spa/route");
const qr = await get("/assets/1234");
const qrNew = await get("/assets/new");
const qrDeep = await get("/assets/1234/edit");
const docs = await Promise.all(["/docs", "/redoc", "/openapi.json"].map((p) => get(p)));
const unknownApi = await get("/api/nothing-here");
console.log(`legit hashed js: ${legit.status} bytes=${legit.body.length} content-type=${legit.headers["content-type"]}`);
console.log(`spa route: ${shell.status}; /assets/1234 (QR / Asset 360): ${qr.status} html=${/<div id="root"|<html/i.test(qr.body)}; /assets/new: ${qrNew.status}; /assets/1234/edit: ${qrDeep.status}`);
console.log(`docs/redoc/openapi: ${docs.map((d) => d.status).join("/")}; unknown /api: ${unknownApi.status} ${unknownApi.headers["content-type"]}`);
console.log(`server header: ${legit.headers["server"] ?? "(none)"}; csp-count: ${(legit.headers["content-security-policy"] ?? "").length > 0 ? 1 : 0}`);
console.log(`SUMMARY native-windows ccae7b2: payloads=${P.length} leaks=${leaks} 5xx=${fivexx} distinct_refusal_bodies_ignoring_request_id=${bodies.size}`);
