// Retest (AUTH/INPUT/INFRA) helpers for the ckam-sec stack. Logins are paced (>= 3.5 s apart across all scripts of
// this agent, via a timestamp file) and a 429 is waited out once (Retry-After) -- never a login loop.
import fs from 'node:fs';
import path from 'node:path';

export const API = 'http://127.0.0.1:8200';
export const WEB = 'http://localhost:3411';
export const PW = 'Sec#Test2026ok';
export const DIR = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/rt_aii';
const PACE_FILE = path.join(DIR, '.last_login');
const TOK_FILE = path.join(DIR, 'tokens.json');
export const RESULTS = path.join(DIR, 'results.jsonl');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pace(ms = 3500) {
  let last = 0;
  try { last = Number(fs.readFileSync(PACE_FILE, 'utf8')) || 0; } catch {}
  const wait = last + ms - Date.now();
  if (wait > 0) await sleep(wait);
  fs.writeFileSync(PACE_FILE, String(Date.now()));
}

export function cookieFrom(res, name = 'refresh_token') {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of all) if (c.startsWith(name + '=')) return { value: c.split(';')[0].slice(name.length + 1), raw: c };
  return null;
}

// Raw login (paced). Returns {status, body, ms, cookie, headers}
export async function rawLogin(loginId, password, { base = API, headers = {}, noPace = false, retry429 = false } = {}) {
  if (!noPace) await pace();
  const t = performance.now();
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ login_id: loginId, password }),
  });
  const txt = await r.text();
  const ms = performance.now() - t;
  let body = null; try { body = JSON.parse(txt); } catch {}
  const out = { status: r.status, body, raw: txt.slice(0, 400), ms, cookie: cookieFrom(r), headers: Object.fromEntries(r.headers) };
  if (r.status === 429 && retry429) {
    const ra = Number(r.headers.get('retry-after') || 30);
    await sleep((ra + 1) * 1000);
    return rawLogin(loginId, password, { base, headers, noPace, retry429: false });
  }
  return out;
}

// Cached session (access token + refresh cookie). Re-login only if missing/older than 12 min or forced.
export async function session(code, password = PW, { force = false } = {}) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(TOK_FILE, 'utf8')); } catch {}
  const c = cache[code];
  if (!force && c && Date.now() - c.at < 12 * 60 * 1000) return c;
  const r = await rawLogin(code, password, { retry429: true });
  if (r.status !== 200) throw new Error(`login ${code} -> ${r.status} ${r.raw}`);
  const s = { at: Date.now(), access: r.body.access_token, refresh: r.cookie?.value, id: r.body.asset_user_id };
  cache[code] = s;
  fs.writeFileSync(TOK_FILE, JSON.stringify(cache));
  return s;
}

export function forget(code) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(TOK_FILE, 'utf8')); } catch {}
  delete cache[code];
  fs.writeFileSync(TOK_FILE, JSON.stringify(cache));
}

export async function req(method, p, { token, body, headers = {}, base = API, cookie, form } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = `refresh_token=${cookie}`;
  const opts = { method, headers: h };
  if (form) opts.body = form;
  else if (body !== undefined) { h['Content-Type'] = h['Content-Type'] || 'application/json'; opts.body = typeof body === 'string' ? body : JSON.stringify(body); }
  const r = await fetch(`${base}${p}`, opts);
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, body: j, raw: txt.slice(0, 500), headers: Object.fromEntries(r.headers), cookie: cookieFrom(r) };
}

// Record one test case row.
export function rec(id, area, cwe, kase, expected, actual, result, evidence) {
  const row = { id, area, cwe, case: kase, expected, actual: String(actual).replace(/\s+/g, ' ').slice(0, 300), result, evidence };
  fs.appendFileSync(RESULTS, JSON.stringify(row) + '\n');
  console.log(`${result}\t${id}\t${kase} -> ${row.actual}`);
  return row;
}

export const redact = (s) => String(s).replace(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, '<JWT>');
