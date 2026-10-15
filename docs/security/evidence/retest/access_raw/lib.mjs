// RETEST helpers for the ACCESS area against ckam-sec (HEAD ae706bb).
// Login is rate-limited (20/min per IP, 10/min per login id): every persona logs in ONCE, tokens are cached in
// tokens.json (scratchpad only, never copied to the repo) and renewed with the refresh cookie when older than 12 min.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
export const API = 'http://127.0.0.1:8200';
export const PW = 'Sec#Test2026ok';
const CACHE = new URL('./tokens.json', import.meta.url);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

let cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const save = () => writeFileSync(CACHE, JSON.stringify(cache, null, 1));
let lastLogin = 0;

function cookieFrom(r) {
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  for (const c of sc) { const m = /refresh_token=([^;]*)/.exec(c); if (m) return m[1]; }
  return null;
}

// Raw login, paced (>= 3.5 s since the previous login from this process). Max one retry after a 429 Retry-After.
export async function rawLogin(loginId, password = PW) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastLogin + Number(process.env.LOGIN_PACE_MS || 3500) - Date.now();
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
      console.error(`429 on login ${loginId}, waiting ${ra}s once`);
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
  if (e && Date.now() - e.t < 12 * 60 * 1000) return e.access;
  if (e && e.refresh) {
    const r = await refreshWith(e.refresh);
    if (r.status === 200) { cache[code] = { access: r.body.access_token, refresh: r.refresh || e.refresh, t: Date.now() }; save(); return cache[code].access; }
    console.error(`refresh failed for ${code}: ${r.status}; logging in again`);
  }
  const r = await rawLogin(code);
  if (r.status !== 200) throw new Error(`login failed for ${code}: ${r.status} ${r.raw}`);
  cache[code] = { access: r.body.access_token, refresh: r.refresh, t: Date.now() };
  save();
  return cache[code].access;
}
export async function toks(codes) { const o = {}; for (const c of codes) o[c] = await tok(c); return o; }

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
