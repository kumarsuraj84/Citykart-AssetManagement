// GT release-gate rehearsal helpers. Talks ONLY to the throw-away ckam-gate-* containers on 127.0.0.1.
import fs from "node:fs";
import { createRequire } from "node:module";
const REPO = "D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build";
export const requireFE = createRequire(REPO + "/frontend/package.json");
export const GATE = "C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/gate";
export const PW = "Sec#Test2026ok"; // fixture password of the throw-away personas (not a real secret)

let lastLogin = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

export function assertLocal(base) {
  const u = new URL(base);
  if (u.hostname !== "127.0.0.1" || Number(u.port) < 4111 || Number(u.port) > 4130) throw new Error("refusing non-gate target " + base);
}

export async function call(base, method, path, { token, body, headers = {} } = {}) {
  assertLocal(base);
  const h = { ...headers };
  if (token) h.Authorization = "Bearer " + token;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: r.headers, text, json };
}

// Pace sign-ins >= 3.2 s apart (20/min per IP, 10/min per login id).
export async function login(base, loginId, password = PW) {
  const wait = lastLogin + 3200 - Date.now();
  if (wait > 0) await sleep(wait);
  lastLogin = Date.now();
  const r = await call(base, "POST", "/api/auth/login", { body: { login_id: loginId, password } });
  return { ...r, token: r.json?.access_token };
}

export class Cases {
  constructor(file) { this.file = file; this.rows = []; }
  add(id, step, what, expected, actual, pass, evidence = "") {
    this.rows.push({ id, step, what, expected, actual: String(actual), result: pass ? "PASS" : "FAIL", evidence });
    console.log(`${pass ? "PASS" : "FAIL"} ${id} [${step}] ${what} -> ${String(actual).slice(0, 220)}`);
  }
  save() {
    const esc = (s) => '"' + String(s).replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
    const lines = ["id,step,what,expected,actual,result,evidence", ...this.rows.map((r) => [r.id, r.step, r.what, r.expected, r.actual, r.result, r.evidence].map(esc).join(","))];
    fs.writeFileSync(this.file, lines.join("\n") + "\n");
    const p = this.rows.filter((r) => r.result === "PASS").length;
    console.log(`saved ${this.rows.length} cases (${p} PASS, ${this.rows.length - p} FAIL) to ${this.file}`);
  }
}

// Redact anything token-like before it goes into evidence.
export function redact(s) {
  return String(s).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<jwt-redacted>");
}
