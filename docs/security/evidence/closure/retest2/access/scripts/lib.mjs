// RETEST2 ACCESS helpers vs ckam-sec (HEAD 734fd19, alembic c6e8a0b2d4f6).
// Login is rate-limited (20/min per IP, 10/min per login id) and a second retest agent SHARES the IP.
// So: every persona logs in at most ONCE, tokens cached in scratchpad tokens.json (never committed),
// logins paced >= 4 s apart, one retry after a 429 Retry-After. Reads of the cache survive re-runs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
export const API = 'http://127.0.0.1:8200';
export const PW = 'Sec#Test2026ok';
// token cache lives in the scratchpad, NOT in the repo evidence folder
const CACHE = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/r2/tokens.json';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

let cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const save = () => writeFileSync(CACHE, JSON.stringify(cache, null, 1));
let lastLogin = 0;

export function cookieFrom(r) {
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  for (const c of sc) { const m = /refresh_token=([^;]*)/.exec(c); if (m) return m[1]; }
  return null;
}

export async function rawLogin(loginId, password = PW) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastLogin + Number(process.env.LOGIN_PACE_MS || 4000) - Date.now();
    if (wait > 0) await sleep(wait);
    lastLogin = Date.now();
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_id: loginId, password }),
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    if (r.status === 429 && attempt === 0) {
      const ra = Number(r.headers.get('retry-after') || 30);
      console.error(`429 on login ${loginId}, waiting ${ra + 1}s once`);
      await sleep((ra + 1) * 1000);
      continue;
    }
    return { status: r.status, body: j, raw: txt.slice(0, 300), refresh: cookieFrom(r) };
  }
}

export async function refreshWith(refresh) {
  const r = await fetch(`${API}/api/auth/refresh`, { method: 'POST', headers: { Cookie: `refresh_token=${refresh}` } });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, body: j, raw: txt.slice(0, 300), refresh: cookieFrom(r) };
}

// Cached token for a persona: login once, refresh after 12 min.
export async function tok(code) {
  const e = cache[code];
  if (e && e.access && Date.now() - e.t < 12 * 60 * 1000) return e.access;
  if (e && e.refresh) {
    const r = await refreshWith(e.refresh);
    if (r.status === 200) { cache[code] = { access: r.body.access_token, refresh: r.refresh || e.refresh, t: Date.now() }; save(); return cache[code].access; }
  }
  const r = await rawLogin(code);
  if (r.status !== 200) throw new Error(`login failed for ${code}: ${r.status} ${r.raw}`);
  cache[code] = { access: r.body.access_token, refresh: r.refresh, t: Date.now() };
  save();
  return cache[code].access;
}
export async function toks(codes) { const o = {}; for (const c of codes) o[c] = await tok(c); return o; }
export function getCache() { return cache; }
export function setCache(code, v) { cache[code] = v; save(); }

export function authH(token) {
  const h = { 'Content-Type': 'application/json' };
  if (!token || token === 'NONE') return h;
  if (token === 'MALFORMED') return { ...h, Authorization: 'Bearer not.a.valid.jwt' };
  return { ...h, Authorization: `Bearer ${token}` };
}

export async function req(method, path, { token, body, headers, raw } = {}) {
  const h = { ...authH(token), ...(headers || {}) };
  const opts = { method, headers: h };
  if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  const r = await fetch(`${API}${path}`, opts);
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, body: j, raw: raw ? txt : txt.slice(0, 600), headers: r.headers };
}
