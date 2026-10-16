// Native-Windows IF-01 attack list against a CKAM release started with the production layout.
// usage: node attack.mjs <port> <label>
import http from "node:http";

const port = Number(process.argv[2]);
const label = process.argv[3];
const root = "C:%5cUsers%5cUser2%5cAppData%5cLocal%5cTemp%5cclaude%5cD--ANKUR-AI-PROJECTS-Asset-Management%5c33a6302e-4441-4084-94a5-472d20016684%5cscratchpad%5cwinprod%5c" + label;

const P = [
  // relative traversal to <root>\shared\.env : assets -> frontend-dist -> test -> releases -> <root>
  ["backslash x4", "/assets/..%5c..%5c..%5c..%5cshared%5c.env"],
  ["encoded dotdot + backslash", "/assets/%2e%2e%5c%2e%2e%5c%2e%2e%5c%2e%2e%5cshared%5c.env"],
  ["forward slash x4 (encoded)", "/assets/..%2f..%2f..%2f..%2fshared%2f.env"],
  ["mixed slash/backslash", "/assets/..%5c../..%5c../shared/.env"],
  ["double encoded backslash", "/assets/..%255c..%255c..%255c..%255cshared%255c.env"],
  ["double encoded slash", "/assets/%252e%252e%252f%252e%252e%252f%252e%252e%252f%252e%252e%252fshared%252f.env"],
  ["sibling file in dist (one up)", "/assets/..%5cindex.html"],
  ["nas.pw", "/assets/..%5c..%5c..%5c..%5cshared%5cnas.pw"],
  ["absolute with drive (backslash)", `/assets/${root}%5cshared%5c.env`],
  ["absolute with drive (forward)", `/assets/${root.replaceAll("%5c", "%2f")}%2fshared%2f.env`],
  ["drive in url, win.ini", "/assets/C:%2fWindows%2fwin.ini"],
  ["drive backslash, win.ini", "/assets/C:%5cWindows%5cwin.ini"],
  ["win.ini via leading slash", "/assets//C:/Windows/win.ini"],
  ["UNC-like backslashes", "/assets/%5c%5cserver%5cshare%5cx.txt"],
  ["UNC-like forward", "/assets//server/share/x.txt"],
  ["UNC with localhost admin share", "/assets/%5c%5clocalhost%5cC$%5cWindows%5cwin.ini"],
  ["drive-relative", "/assets/C:win.ini"],
  ["alternate data stream", "/assets/ok.js::$DATA"],
  ["alternate data stream (named)", "/assets/ok.js:stream"],
  ["trailing dot", "/assets/ok.js."],
  ["trailing space", "/assets/ok.js%20"],
  ["reserved CON", "/assets/CON"],
  ["reserved nul.txt", "/assets/nul.txt"],
  ["reserved aux.js", "/assets/aux.js"],
  ["8.3 short name", "/assets/OK~1.JS"],
  ["NUL byte", "/assets/ok.js%00.txt"],
  ["long name", "/assets/" + "a".repeat(5000)],
  ["sibling prefix", "/assets/..%5cassets-evil%5cx"],
];

function get(path) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", (e) => resolve({ status: "ERR " + e.code, body: "" }));
    req.end();
  });
}

let leaks = 0, fivexx = 0;
const bodies = new Set();
for (const [name, path] of P) {
  const r = await get(path);
  const leaked = /FAKE-CANARY|\[fonts\]|\[extensions\]|for 16-bit app support/i.test(r.body);
  if (leaked) leaks++;
  if (typeof r.status === "number" && r.status >= 500) fivexx++;
  bodies.add(r.status + "|" + r.body.slice(0, 80));
  console.log(`${leaked ? "LEAK " : "ok   "} ${String(r.status).padEnd(4)} ${name}${leaked ? "  <<< " + r.body.slice(0, 60).replace(/\s+/g, " ") : ""}`);
}
const legit = await get("/assets/ok.js");
const shell = await get("/some/spa/route");
const unknownApi = await get("/api/nothing-here");
console.log(`legit asset: ${legit.status} ${JSON.stringify(legit.body.trim())}`);
console.log(`spa route: ${shell.status} ${JSON.stringify(shell.body.trim())}`);
console.log(`unknown /api: ${unknownApi.status} ${unknownApi.body.slice(0, 70)}`);
console.log(`SUMMARY ${label}: payloads=${P.length} leaks=${leaks} 5xx=${fivexx} distinct_refusal_bodies=${bodies.size}`);
