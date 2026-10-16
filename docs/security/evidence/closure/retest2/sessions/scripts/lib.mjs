// Shared helper for CKAM sessions+concurrency retest2. Plain HTTP, no deps.
export const API = process.env.CKAM_API || 'http://127.0.0.1:8200';
export const WEB = process.env.CKAM_WEB || 'http://localhost:3411';
export const PW = 'Sec#Test2026ok';

// Low-level request that exposes status, headers, set-cookie, and parsed/raw body.
export async function req(base, method, path, { token, body, headers = {}, cookie, raw } = {}) {
  const h = { ...headers };
  if (token) h['Authorization'] = 'Bearer ' + token;
  if (cookie) h['Cookie'] = cookie;
  let payload;
  if (raw !== undefined) { payload = raw; }
  else if (body !== undefined) { h['Content-Type'] = h['Content-Type'] || 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  // node fetch: multiple Set-Cookie joined; use getSetCookie
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return { status: res.status, headers: res.headers, setCookie, text, json };
}

// Extract refresh_token cookie value from set-cookie array
export function refreshFrom(setCookie) {
  for (const c of setCookie || []) {
    const m = /(?:^|;\s*)refresh_token=([^;]*)/.exec(c);
    if (m) return m[1];
  }
  return null;
}
export function cookieHeader(refresh) { return refresh ? ('refresh_token=' + refresh) : ''; }

export async function login(loginId, password = PW, base = API) {
  const r = await req(base, 'POST', '/api/auth/login', { body: { login_id: loginId, password } });
  return { ...r, refresh: refreshFrom(r.setCookie), access: r.json && r.json.access_token };
}
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
