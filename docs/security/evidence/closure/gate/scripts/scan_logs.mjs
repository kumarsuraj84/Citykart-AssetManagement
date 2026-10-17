// GT: do the app's own log files (all gate runs) contain the throw-away JWT secret, the DB password, a bearer token,
// or a FAKE canary body? Prints counts only.
import fs from "node:fs";
import path from "node:path";
import { GATE } from "./lib.mjs";
const env = fs.readFileSync(`${GATE}/out/new.env`, "utf8");
const jwt = env.match(/^JWT_SECRET=(.*)$/m)[1].trim();
const needles = { jwt_secret: jwt, db_password: "gate_app_throwaway_pw", canary: "FAKE-CANARY" };
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(`${GATE}/applogs`);
const res = {};
let jwtLike = 0, lines = 0;
for (const f of files) {
  const t = fs.readFileSync(f, "utf8");
  lines += t.split("\n").length;
  for (const [k, v] of Object.entries(needles)) res[k] = (res[k] || 0) + t.split(v).length - 1;
  jwtLike += (t.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []).length;
}
console.log(`files=${files.length} lines=${lines} ${Object.entries(res).map(([k, v]) => `${k}=${v}`).join(" ")} bearer_tokens=${jwtLike}`);
console.log(files.map((f) => path.relative(`${GATE}/applogs`, f)).join(", "));
