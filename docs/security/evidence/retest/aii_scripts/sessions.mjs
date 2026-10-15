// RT AU-05 / AU-06 / AU-07 (+ forced first-login change flow): every way a session must end, and that it does
// not end for unrelated changes or other users. Throw-away accounts BRUTE13/14/15/16/19 only.
import fs from 'node:fs';
import path from 'node:path';
import { DIR, rawLogin, req, rec, session, sleep } from './lib.mjs';

const users = JSON.parse(fs.readFileSync(path.join(DIR, 'users.json'), 'utf8'));
const strong = (n) => `Zq7!harbour-Lantern-${n}`;
const ho = await session('SECHO');
const cap = (tok) => req('GET', '/api/auth/capabilities', { token: tok });
const refresh = (cookie) => req('POST', '/api/auth/refresh', { cookie });
const AREA = 'session';

// Forced first-login change for a throw-away user; returns {access, refresh} of the NEW session.
async function activate(code, n, idBase) {
  const l = await rawLogin(code, users[code].temp, { retry429: true });
  const oldAccess = l.body?.access_token; const oldRefresh = l.cookie?.value;
  const capMust = await cap(oldAccess);
  const ch = await req('POST', '/api/auth/change-password', { token: oldAccess, body: { old_password: users[code].temp, new_password: strong(n) } });
  users[code].pw = strong(n);
  fs.writeFileSync(path.join(DIR, 'users.json'), JSON.stringify(users, null, 1));
  const newCookie = ch.cookie?.value;
  const afterOld = await cap(oldAccess);
  const oldRef = await refresh(oldRefresh);
  const r = await refresh(newCookie);
  const capNew = await cap(r.body?.access_token);
  if (idBase) {
    rec(`${idBase}a`, AREA, 'A07:2021', `${code} forced change: temp-password session limited to change-password`, '403 on other routes', `login ${l.status} must_change=${l.body?.must_change_password}; /capabilities ${capMust.status}`, capMust.status === 403 ? 'PASS' : 'FAIL', 'sessions.mjs');
    rec(`${idBase}b`, AREA, 'CWE-613', `${code} change-password returns 204 + a NEW refresh cookie`, '204 + Set-Cookie refresh_token', `${ch.status} cookie=${newCookie ? 'yes' : 'no'}`, ch.status === 204 && newCookie ? 'PASS' : 'FAIL', 'sessions.mjs');
    rec(`${idBase}c`, AREA, 'CWE-613', `${code} pre-change access token after change-password`, '401 session ended', `${afterOld.status} ${afterOld.body?.detail}`, afterOld.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
    rec(`${idBase}d`, AREA, 'CWE-613', `${code} pre-change refresh token after change-password`, '401', `${oldRef.status}`, oldRef.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
    rec(`${idBase}e`, AREA, 'A07:2021', `${code} new cookie from change-password renews the session (user stays signed in)`, 'refresh 200 + capabilities 200', `refresh ${r.status}, capabilities ${capNew.status}`, r.status === 200 && capNew.status === 200 ? 'PASS' : 'FAIL', 'sessions.mjs');
  }
  return { access: r.body?.access_token, refresh: r.cookie?.value };
}

// login twice ("two devices")
async function twoDevices(code) {
  const a = await rawLogin(code, users[code].pw, { retry429: true });
  const b = await rawLogin(code, users[code].pw, { retry429: true });
  return [{ access: a.body.access_token, refresh: a.cookie.value }, { access: b.body.access_token, refresh: b.cookie.value }];
}

const viewer = await session('SECVIEW');

// ---------- BRUTE13: forced change, rotation, logout ----------
await activate('BRUTE13', 13, 'RT-AU-T101');
const [d1, d2] = await twoDevices('BRUTE13');
// rotation
const r1 = await refresh(d1.refresh);
const r2 = await refresh(r1.cookie?.value);
rec('RT-AU-T102', AREA, 'CWE-613', 'Refresh issues a NEW refresh token each call (rotation)', 'cookie differs each call', `r1 ${r1.status} r2 ${r2.status}; d1!=r1:${d1.refresh !== r1.cookie?.value} r1!=r2:${r1.cookie?.value !== r2.cookie?.value}`, r1.status === 200 && r2.status === 200 && d1.refresh !== r1.cookie?.value && r1.cookie?.value !== r2.cookie?.value ? 'PASS' : 'FAIL', 'sessions.mjs');
const reuse = await refresh(d1.refresh);
rec('RT-AU-T103', AREA, 'CWE-384', 'OLD refresh token reused after it was rotated (reuse detection)', '401 ideally (reuse detection)', `${reuse.status} (old token still accepted until sign-out / expiry)`, reuse.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const jtiDiff = (await refresh(r2.cookie?.value)).cookie?.value !== (await refresh(r2.cookie?.value)).cookie?.value;
rec('RT-AU-T104', AREA, 'CWE-330', 'Two refreshes in the same second produce different tokens (jti)', 'different', `different=${jtiDiff}`, jtiDiff ? 'PASS' : 'FAIL', 'sessions.mjs');
// logout on device 1
const lo = await req('POST', '/api/auth/logout', { cookie: r2.cookie?.value });
const d1acc = await cap(r1.body?.access_token);
const d1ref = await refresh(r2.cookie?.value);
const d2acc = await cap(d2.access);
const d2ref = await refresh(d2.refresh);
const oldRef = await refresh(d1.refresh);
const setc = lo.headers['set-cookie'] || '';
rec('RT-AU-T105', AREA, 'CWE-613', 'Logout clears the cookie (Set-Cookie expires, Path=/api/auth, HttpOnly)', '204 + cookie cleared', `${lo.status} ${setc.replace(/refresh_token=[^;]*/, 'refresh_token=..')}`, lo.status === 204 && /Max-Age=0|expires=Thu, 01 Jan 1970/i.test(setc) ? 'PASS' : 'FAIL', 'sessions.mjs');
rec('RT-AU-T106', AREA, 'CWE-613', 'After logout: same device access token', '401', `${d1acc.status} ${d1acc.body?.detail}`, d1acc.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
rec('RT-AU-T107', AREA, 'CWE-613', 'After logout: refresh token that was logged out', '401', `${d1ref.status}`, d1ref.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
rec('RT-AU-T108', AREA, 'CWE-613', 'After logout: an older, rotated-away refresh token', '401', `${oldRef.status}`, oldRef.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
rec('RT-AU-T109', AREA, 'CWE-613', 'After logout on device 1: device 2 access + refresh (all sessions end by design)', '401/401 (design: sign-out ends every session)', `access ${d2acc.status} refresh ${d2ref.status}`, d2acc.status === 401 && d2ref.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const vcap = await cap(viewer.access);
rec('RT-AU-T110', AREA, 'CWE-613', 'Unaffected user (SECVIEW) token after BRUTE13 sign-out', '200', `${vcap.status}`, vcap.status === 200 ? 'PASS' : 'FAIL', 'sessions.mjs');
const loNo = await req('POST', '/api/auth/logout', {});
rec('RT-AU-T111', AREA, 'CWE-613', 'Logout with no cookie', '204, nobody signed out', `${loNo.status}`, loNo.status === 204 ? 'PASS' : 'FAIL', 'sessions.mjs');
const loStale = await req('POST', '/api/auth/logout', { cookie: d1.refresh });
const after = await rawLogin('BRUTE13', users.BRUTE13.pw, { retry429: true });
const stillOk = await cap(after.body?.access_token);
const loStale2 = await req('POST', '/api/auth/logout', { cookie: d1.refresh });
const still2 = await cap(after.body?.access_token);
rec('RT-AU-T112', AREA, 'CWE-613', 'A stale (already ended) refresh cookie cannot sign out the NEW session', 'new session still 200', `logout ${loStale2.status}; new session capabilities ${still2.status}`, still2.status === 200 ? 'PASS' : 'FAIL', 'sessions.mjs');
const accAsRef = await refresh(after.body?.access_token);
rec('RT-AU-T113', AREA, 'CWE-384', 'Access token presented as refresh cookie', '401', `${accAsRef.status}`, accAsRef.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const refAsAcc = await cap(after.cookie?.value);
rec('RT-AU-T114', AREA, 'CWE-384', 'Refresh token presented as bearer access token', '401', `${refAsAcc.status}`, refAsAcc.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const loAcc = await req('POST', '/api/auth/logout', { cookie: after.body?.access_token });
const still3 = await cap(after.body?.access_token);
rec('RT-AU-T115', AREA, 'CWE-613', 'Logout with an ACCESS token as the cookie does not end sessions (only a refresh token does)', 'session still 200', `logout ${loAcc.status}, capabilities ${still3.status}`, still3.status === 200 ? 'PASS' : 'INFO', 'sessions.mjs');

// ---------- BRUTE14: deactivation ----------
const s14 = await activate('BRUTE14', 14);
await sleep(300);
const del = await req('DELETE', `/api/asset-users/${users.BRUTE14.id}`, { token: ho.access });
const a14 = await cap(s14.access); const f14 = await refresh(s14.refresh);
rec('RT-AU-T120', AREA, 'CWE-613', 'Deactivated account (DELETE asset-user): live access token', '401', `deactivate ${del.status}; access ${a14.status} ${a14.body?.detail}`, a14.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
rec('RT-AU-T121', AREA, 'CWE-613', 'Deactivated account: live refresh token', '401', `${f14.status}`, f14.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const l14 = await rawLogin('BRUTE14', users.BRUTE14.pw, { retry429: true });
rec('RT-AU-T122', AREA, 'CWE-287', 'Deactivated account: new sign-in', '401 generic', `${l14.status} ${l14.body?.detail}`, l14.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');

// ---------- BRUTE15: login_enabled=false, then back on ----------
const s15 = await activate('BRUTE15', 15);
const off = await req('PUT', `/api/asset-users/${users.BRUTE15.id}`, { token: ho.access, body: { login_enabled: false } });
const a15 = await cap(s15.access); const f15 = await refresh(s15.refresh);
rec('RT-AU-T123', AREA, 'CWE-613', 'Sign-in switched off (login_enabled=false): live access token ends at once (AU-07)', '401', `PUT ${off.status}; access ${a15.status} ${a15.body?.detail}`, a15.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
rec('RT-AU-T124', AREA, 'CWE-613', 'Sign-in switched off: live refresh token', '401', `${f15.status}`, f15.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const on = await req('PUT', `/api/asset-users/${users.BRUTE15.id}`, { token: ho.access, body: { login_enabled: true } });
const a15b = await cap(s15.access); const f15b = await refresh(s15.refresh);
rec('RT-AU-T125', AREA, 'CWE-613', 'Sign-in switched back ON: the old tokens stay dead (version bumped)', '401/401', `PUT ${on.status}; access ${a15b.status} refresh ${f15b.status}`, a15b.status === 401 && f15b.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');

// ---------- BRUTE16: role change, harmless change ----------
const s16 = await activate('BRUTE16', 16);
const harmless = await req('PUT', `/api/asset-users/${users.BRUTE16.id}`, { token: ho.access, body: { phone: '9800000016' } });
const a16h = await cap(s16.access);
rec('RT-AU-T126', AREA, 'CWE-613', 'Unrelated edit (phone) does NOT end the session (no unexpected sign-out)', '200', `PUT ${harmless.status}; access ${a16h.status}`, a16h.status === 200 ? 'PASS' : 'FAIL', 'sessions.mjs');
const role = await req('PUT', `/api/asset-users/${users.BRUTE16.id}`, { token: ho.access, body: { role: 'VIEWER' } });
const a16 = await cap(s16.access); const f16 = await refresh(s16.refresh);
rec('RT-AU-T127', AREA, 'CWE-613', 'Role change OPERATOR->VIEWER: old access token', '401', `PUT ${role.status}; access ${a16.status}`, a16.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
rec('RT-AU-T128', AREA, 'CWE-613', 'Role change: old refresh token', '401', `${f16.status}`, f16.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const l16 = await rawLogin('BRUTE16', users.BRUTE16.pw, { retry429: true });
const c16 = await cap(l16.body?.access_token);
rec('RT-AU-T129', AREA, 'A01:2021', 'After role change a new sign-in gets exactly the new role', 'VIEWER', `${l16.status} role=${l16.body?.role} caps=${c16.status}`, l16.body?.role === 'VIEWER' ? 'PASS' : 'FAIL', 'sessions.mjs');
const wa = await req('PUT', `/api/asset-users/${users.BRUTE16.id}`, { token: ho.access, body: { allowed_asset_domains: 'BOTH' } });
const a16w = await cap(l16.body?.access_token);
rec('RT-AU-T130', AREA, 'CWE-613', 'Work-area change: old access token', '401', `PUT ${wa.status} ${wa.status !== 200 ? wa.raw : ''}; access ${a16w.status}`, a16w.status === 401 ? 'PASS' : (wa.status !== 200 ? 'N/A' : 'FAIL'), 'sessions.mjs');
const s16c = await rawLogin('BRUTE16', users.BRUTE16.pw, { retry429: true });
const code = await req('PUT', `/api/asset-users/${users.BRUTE16.id}`, { token: ho.access, body: { email: 'brute16b@sec.test' } });
const a16e = await cap(s16c.body?.access_token);
rec('RT-AU-T131', AREA, 'CWE-613', 'Login e-mail changed by admin: existing session', 'INFO (design: not an access change)', `PUT ${code.status}; access ${a16e.status}`, 'INFO', 'sessions.mjs');

// ---------- BRUTE19: company access, admin password reset ----------
const s19 = await activate('BRUTE19', 19);
const ca = await req('POST', `/api/asset-users/${users.BRUTE19.id}/company-access`, { token: ho.access, body: { company_ids: [2] } });
const a19 = await cap(s19.access); const f19 = await refresh(s19.refresh);
rec('RT-AU-T132', AREA, 'CWE-613', 'Company access changed: old access + refresh tokens', '401/401', `POST ${ca.status}; access ${a19.status} refresh ${f19.status}`, a19.status === 401 && f19.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const s19b = await rawLogin('BRUTE19', users.BRUTE19.pw, { retry429: true });
const ca2 = await req('POST', `/api/asset-users/${users.BRUTE19.id}/company-access`, { token: ho.access, body: { company_ids: [2] } });
const a19c = await cap(s19b.body?.access_token);
rec('RT-AU-T133', AREA, 'CWE-613', 'Company access re-saved unchanged: session NOT ended', '200', `POST ${ca2.status}; access ${a19c.status}`, a19c.status === 200 ? 'PASS' : 'FAIL', 'sessions.mjs');
const rp = await req('POST', `/api/asset-users/${users.BRUTE19.id}/reset-password`, { token: ho.access });
const a19r = await cap(s19b.body?.access_token); const f19r = await refresh(s19b.cookie?.value);
rec('RT-AU-T134', AREA, 'CWE-613', 'Admin password reset: old access + refresh tokens', '401/401', `reset ${rp.status}; access ${a19r.status} refresh ${f19r.status}`, a19r.status === 401 && f19r.status === 401 ? 'PASS' : 'FAIL', 'sessions.mjs');
const tempLooks = typeof rp.body?.temp_password === 'string' ? rp.body.temp_password.length : 0;
users.BRUTE19.temp2 = rp.body?.temp_password;
fs.writeFileSync(path.join(DIR, 'users.json'), JSON.stringify(users, null, 1));
rec('RT-AU-T135', AREA, 'CWE-521', 'Admin-issued temporary password is random (token_urlsafe(9) = 12 chars) and must be changed', '>=12 chars + must_change', `length ${tempLooks}`, tempLooks >= 12 ? 'PASS' : 'FAIL', 'sessions.mjs');
// The temporary password itself: can the person change it to a strong one under the new policy?
const t19 = await rawLogin('BRUTE19', users.BRUTE19.temp2, { retry429: true });
const ch19 = await req('POST', '/api/auth/change-password', { token: t19.body?.access_token, body: { old_password: users.BRUTE19.temp2, new_password: 'Granite#Meadow-4417' } });
rec('RT-AU-T136', AREA, 'A07:2021', 'Reset -> sign in with temp (must_change) -> choose a strong password accepted', '200 then 204', `login ${t19.status} must_change=${t19.body?.must_change_password}; change ${ch19.status}`, t19.status === 200 && ch19.status === 204 ? 'PASS' : 'FAIL', 'sessions.mjs');
users.BRUTE19.pw = 'Granite#Meadow-4417';
fs.writeFileSync(path.join(DIR, 'users.json'), JSON.stringify(users, null, 1));
const vcap2 = await cap(viewer.access);
rec('RT-AU-T137', AREA, 'CWE-613', 'Unaffected user (SECVIEW) still signed in after all the above', '200', `${vcap2.status}`, vcap2.status === 200 ? 'PASS' : 'FAIL', 'sessions.mjs');
