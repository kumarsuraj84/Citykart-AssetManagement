// Shared helpers for ACCESS-area security tests against ckam-sec.
export const API = 'http://127.0.0.1:8200';
export const PW = 'Sec#Test2026ok';

export async function login(loginId, password = PW) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id: loginId, password }),
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, body: j, raw: txt };
}

// Personas used in the authz matrix (plus malformed/none handled specially).
export const MATRIX_PERSONAS = [
  'SECSELF', 'SECVIEW', 'SECOPIT', 'SECOPNIT', 'SECFAIT', 'SECFANIT', 'SECFABOTH', 'SECOTHER', 'SECHO',
];

export async function getTokens(codes) {
  const tokens = {};
  for (const c of codes) {
    const r = await login(c);
    if (r.status !== 200 || !r.body?.access_token) throw new Error(`login failed for ${c}: ${r.status} ${r.raw}`);
    tokens[c] = r.body.access_token;
  }
  return tokens;
}

export function authH(token) {
  const h = { 'Content-Type': 'application/json' };
  if (token === 'NONE') return { 'Content-Type': 'application/json' };
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
  return { status: r.status, body: j, raw: raw ? txt : txt.slice(0, 600) };
}
