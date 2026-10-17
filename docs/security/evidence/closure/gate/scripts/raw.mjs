// Raw HTTP GET with the path sent exactly as given (like curl --path-as-is) and the raw header list kept.
import http from "node:http";
export function rawGet(port, path, headers = {}) {
  if (port < 4111 || port > 4130) throw new Error("refusing non-gate port");
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, raw: res.rawHeaders, headers: res.headers, buf: Buffer.concat(chunks), body: Buffer.concat(chunks).toString("latin1") }));
    });
    req.on("error", (e) => resolve({ status: "ERR " + e.code, raw: [], headers: {}, buf: Buffer.alloc(0), body: "" }));
    req.end();
  });
}
export function headerCounts(raw) {
  const m = {};
  for (let i = 0; i < raw.length; i += 2) {
    const k = raw[i].toLowerCase();
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}
