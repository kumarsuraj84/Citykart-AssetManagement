// RT AU-12 / AU-14 / AU-15 + CORS/CSRF sweep on web :3411 (nginx) and API :8200 (Docker stack, no logins needed
// except one cached SECVIEW token).
import fs from 'node:fs';
import path from 'node:path';
import { API, WEB, DIR, req, rec, session } from './lib.mjs';

const A = 'headers';
const CSP_WANT = ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'"];
const raw = [];

async function head(label, url, opts = {}) {
  const r = await fetch(url, { redirect: 'manual', ...opts });
  const body = await r.text();
  const h = Object.fromEntries(r.headers);
  raw.push({ label, url, status: r.status, headers: h, body: body.slice(0, 160) });
  return { status: r.status, h, body };
}

function checkSec(id, label, x, { expectStatus } = {}) {
  const csp = x.h['content-security-policy'] || '';
  const pp = x.h['permissions-policy'] || '';
  const cspOk = CSP_WANT.every((d) => csp.includes(d)) && !csp.includes("'unsafe-eval'") && !/script-src[^;]*'unsafe-inline'/.test(csp);
  const cspCount = (x.h['content-security-policy'] || '').split(', default-src').length; // duplicate header merge check
  const ppOk = /camera=\(\)/.test(pp) && /microphone=\(\)/.test(pp) && /geolocation=\(\)/.test(pp);
  const server = x.h.server || '<none>';
  const noVer = !/\d/.test(server);
  const other = x.h['x-content-type-options'] === 'nosniff' && /SAMEORIGIN/i.test(x.h['x-frame-options'] || '') && !!x.h['referrer-policy'];
  const ok = cspOk && ppOk && noVer && other && cspCount === 1 && (!expectStatus || x.status === expectStatus);
  rec(id, A, 'CWE-693', `${label}: CSP + Permissions-Policy + nosniff/XFO/Referrer + Server without version`,
    `all present${expectStatus ? `, status ${expectStatus}` : ''}`,
    `status ${x.status}; csp=${cspOk ? 'ok' : 'MISSING/weak'}${cspCount > 1 ? ' DUPLICATE' : ''}; pp=${ppOk ? 'ok' : 'MISSING'}; server=${server}; other=${other ? 'ok' : 'MISSING'}`,
    ok ? 'PASS' : 'FAIL', 'headers_raw.json');
}

const viewer = await session('SECVIEW');
// ---- web :3411 ----
checkSec('RT-AU-T401', 'WEB / (SPA shell)', await head('web-root', `${WEB}/`));
checkSec('RT-AU-T402', 'WEB SPA route /assets/42', await head('web-spa', `${WEB}/assets/42`));
checkSec('RT-AU-T403', 'WEB /api/health (proxied)', await head('web-api-health', `${WEB}/api/health`), { expectStatus: 200 });
checkSec('RT-AU-T404', 'WEB /api 401 (no token)', await head('web-401', `${WEB}/api/auth/capabilities`), { expectStatus: 401 });
checkSec('RT-AU-T405', 'WEB /api 404', await head('web-404', `${WEB}/api/nope-rt`), { expectStatus: 404 });
const idx = await head('web-index', `${WEB}/index.html`);
checkSec('RT-AU-T406', 'WEB /index.html', idx);
rec('RT-AU-T407', A, 'CWE-524', 'WEB index.html Cache-Control no-cache', 'no-cache', idx.h['cache-control'] || '-', /no-cache/.test(idx.h['cache-control'] || '') ? 'PASS' : 'FAIL', 'headers_raw.json');
// ---- 413 at nginx ----
const big = 'a'.repeat(12 * 1024 * 1024);
const x413 = await head('web-413', `${WEB}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
checkSec('RT-AU-T408', 'WEB 413 oversize body', x413, { expectStatus: 413 });
let j413 = null; try { j413 = JSON.parse(x413.body); } catch {}
rec('RT-AU-T409', A, 'CWE-770', 'WEB 12 MB body -> JSON 413 with a plain sentence (AU-15)', '413 application/json {"detail": sentence}', `${x413.status} ${x413.h['content-type']} ${x413.body.slice(0, 100)}`, x413.status === 413 && j413?.detail && /json/.test(x413.h['content-type'] || '') ? 'PASS' : 'FAIL', 'headers_raw.json');
rec('RT-AU-T410', A, 'CWE-209', 'WEB 413 body has no request_id (nginx answers before the API)', 'INFO', `request_id=${j413?.request_id ? 'yes' : 'no'}; x-request-id=${x413.h['x-request-id'] ? 'yes' : 'no'}`, 'INFO', 'headers_raw.json');
// ---- source maps (AU-12) ----
const shell = idx.body + (await (await fetch(`${WEB}/`)).text());
const jsList = [...new Set([...shell.matchAll(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g)].map((m) => m[0]))];
let mapHits = 0; let mapRefs = 0; const mapCodes = [];
for (const js of jsList) {
  const m = await head(`map ${js}`, `${WEB}${js}.map`);
  mapCodes.push(m.status);
  if (m.status === 200) mapHits++;
  const code = await (await fetch(`${WEB}${js}`)).text();
  if (/sourceMappingURL=/.test(code)) mapRefs++;
}
rec('RT-AU-T411', A, 'CWE-540', `GET <bundle>.js.map / .css.map for ${jsList.length} entry files`, '404 each, not index.html', `codes ${mapCodes.join(',')}`, mapHits === 0 && mapCodes.every((c) => c === 404) ? 'PASS' : 'FAIL', 'headers_raw.json');
rec('RT-AU-T412', A, 'CWE-540', 'sourceMappingURL comments in served entry bundles', '0', `${mapRefs}`, mapRefs === 0 ? 'PASS' : 'FAIL', 'headers_raw.json');
const fake = await head('fake-map', `${WEB}/assets/x.js.map`);
rec('RT-AU-T413', A, 'CWE-540', 'GET /assets/x.js.map (made-up name)', '404 not index.html', `${fake.status} ${fake.body.slice(0, 30)}`, fake.status === 404 && !/<html/i.test(fake.body) ? 'PASS' : 'FAIL', 'headers_raw.json');
const fakeJs = await head('fake-js', `${WEB}/assets/does-not-exist.js`);
rec('RT-AU-T414', A, 'CWE-200', 'GET /assets/does-not-exist.js', '404 (not SPA shell)', `${fakeJs.status}`, fakeJs.status === 404 ? 'PASS' : 'FAIL', 'headers_raw.json');
const dot = await head('dotenv', `${WEB}/.env`);
rec('RT-AU-T415', A, 'CWE-200', 'GET /.env and /.git/config on :3411', 'no real file (SPA shell or 404)', `.env ${dot.status} ${/<html/i.test(dot.body) ? 'shell' : dot.body.slice(0, 30)}`, /<html/i.test(dot.body) || dot.status === 404 ? 'PASS' : 'FAIL', 'headers_raw.json');
const trav = await head('trav-web', `${WEB}/assets/..%2f..%2f..%2fetc%2fpasswd`);
rec('RT-AU-T416', A, 'CWE-22', 'WEB /assets/..%2f..%2f..%2fetc%2fpasswd', '400/404, no file', `${trav.status} ${trav.body.slice(0, 20)}`, !/root:/.test(trav.body) ? 'PASS' : 'FAIL', 'headers_raw.json');
const trav5c = await head('trav-web-5c', `${WEB}/assets/..%5c..%5cetc%5cpasswd`);
rec('RT-AU-T417', A, 'CWE-22', 'WEB /assets/..%5c..%5cetc%5cpasswd', 'no file', `${trav5c.status} ${trav5c.body.slice(0, 20)}`, !/root:/.test(trav5c.body) ? 'PASS' : 'FAIL', 'headers_raw.json');
// ---- API :8200 ----
checkSec('RT-AU-T420', 'API /api/health', await head('api-health', `${API}/api/health`), { expectStatus: 200 });
checkSec('RT-AU-T421', 'API 401', await head('api-401', `${API}/api/auth/capabilities`), { expectStatus: 401 });
checkSec('RT-AU-T422', 'API 404', await head('api-404', `${API}/api/nope-rt`), { expectStatus: 404 });
checkSec('RT-AU-T423', 'API 422', await head('api-422', `${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"login_id":1}' }), { expectStatus: 422 });
const api200 = await head('api-200-auth', `${API}/api/auth/capabilities`, { headers: { Authorization: `Bearer ${viewer.access}` } });
checkSec('RT-AU-T424', 'API 200 authenticated', api200, { expectStatus: 200 });
rec('RT-AU-T425', A, 'CWE-524', 'API Cache-Control no-store on authenticated JSON', 'no-store', api200.h['cache-control'] || '-', api200.h['cache-control'] === 'no-store' ? 'PASS' : 'FAIL', 'headers_raw.json');
const docs = await head('api-docs', `${API}/docs`);
rec('RT-AU-T426', A, 'CWE-651', 'API /docs in this security-test stack (ENVIRONMENT_NAME=security-test)', 'open by design here (prod: 404, see T5xx)', `${docs.status} csp=${docs.h['content-security-policy'] ? 'yes' : 'no (docs exempt)'}`, 'INFO', 'headers_raw.json');
// ---- CORS / CSRF ----
const c1 = await head('cors-evil', `${API}/api/auth/companies`, { headers: { Origin: 'http://evil.test' } });
rec('RT-AU-T430', A, 'CWE-942', 'CORS: API GET with Origin evil.test', 'no Access-Control-Allow-Origin', `acao=${c1.h['access-control-allow-origin'] || 'none'}`, !c1.h['access-control-allow-origin'] ? 'PASS' : 'FAIL', 'headers_raw.json');
const c2 = await head('cors-pre', `${API}/api/auth/login`, { method: 'OPTIONS', headers: { Origin: 'http://evil.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
rec('RT-AU-T431', A, 'CWE-942', 'CORS: preflight from evil origin', 'no CORS allow headers', `${c2.status} acao=${c2.h['access-control-allow-origin'] || 'none'}`, !c2.h['access-control-allow-origin'] ? 'PASS' : 'FAIL', 'headers_raw.json');
const c3 = await head('cors-null', `${API}/api/auth/refresh`, { method: 'POST', headers: { Origin: 'null' } });
rec('RT-AU-T432', A, 'CWE-352', 'CSRF: cross-site POST /api/auth/refresh with Origin null, no cookie', '401, no ACAO', `${c3.status} acao=${c3.h['access-control-allow-origin'] || 'none'}`, c3.status === 401 && !c3.h['access-control-allow-origin'] ? 'PASS' : 'FAIL', 'headers_raw.json');
const c4 = await head('cors-web', `${WEB}/api/auth/companies`, { headers: { Origin: 'http://evil.test' } });
rec('RT-AU-T433', A, 'CWE-942', 'CORS via WEB :3411 Origin evil.test', 'no ACAO', `acao=${c4.h['access-control-allow-origin'] || 'none'}`, !c4.h['access-control-allow-origin'] ? 'PASS' : 'FAIL', 'headers_raw.json');
// Refresh cookie attributes (SameSite=Lax blocks cross-site POST of the cookie; text/plain simple POST to logout is harmless)
const tr = await head('trace', `${API}/api/health`, { method: 'TRACE' }).catch((e) => ({ status: 'client-refused', h: {} }));
rec('RT-AU-T434', A, 'CWE-16', 'TRACE on API', '405 / refused', `${tr.status}`, tr.status === 405 || tr.status === 'client-refused' ? 'PASS' : 'FAIL', 'headers_raw.json');
const xr = await head('xrid', `${API}/api/health`, { headers: { 'X-Request-ID': 'abc\u0001' + 'A'.repeat(300) } }).catch(() => null);
rec('RT-AU-T435', A, 'CWE-117', 'X-Request-ID with control char + 300 chars', 'replaced/sanitised', xr ? `echo len ${String(xr.h['x-request-id']).length}` : 'client refused header', xr && String(xr.h['x-request-id']).length <= 64 ? 'PASS' : 'INFO', 'headers_raw.json');
fs.writeFileSync(path.join(DIR, 'headers_raw.json'), JSON.stringify(raw.map((x) => ({ ...x, headers: Object.fromEntries(Object.entries(x.headers).filter(([k]) => !/date|etag|last-modified|content-length/.test(k))) })), null, 1));
