// RETEST AU-05/06/07 session revocation, the Primary-Owner login clash and a valid-body mass-assignment probe.
// Throw-away accounts only (RT-*), created as SECHO and soft-deactivated at the end. Passwords are random,
// in memory only, never printed. Logins paced (LOGIN_PACE_MS, default here 6000 ms).
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { API, tok, rawLogin, refreshWith, req, sleep } from './lib.mjs';

const results = [];
const log = [];
let n = 700;
const nid = () => `RT-AC-T${String(n++).padStart(3, '0')}`;
function rec(cwe, cas, expected, actual, pass, ev = '') {
  results.push({ id: nid(), cwe, case: cas, expected, actual, result: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL', ev });
  log.push(`${pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL'} | ${cas} | ${actual}`);
  if (pass === false) console.log('FAIL', cas, '->', actual, ev);
}
const strongPw = () => 'Rt!' + randomBytes(12).toString('base64url') + '9q';
const SECHO = await tok('SECHO');
const BYSTANDER = await tok('SECOP2IT');
const stamp = Date.now().toString().slice(-6);

async function caps(access) { return (await req('GET', '/api/auth/capabilities', { token: access })).status; }
async function probe(label, s, expectAlive) {
  const a = await caps(s.access);
  const r = await refreshWith(s.refresh);
  const other = await caps(BYSTANDER), me = await caps(SECHO);
  const ok = expectAlive ? (a === 200 && r.status === 200) : (a === 401 && r.status === 401);
  rec('CWE-613', `${label}: OLD access token / OLD refresh cookie`, expectAlive ? '200 / 200' : '401 / 401',
    `${a} / ${r.status}${a === 401 ? ' detail=' + JSON.stringify((await req('GET', '/api/auth/capabilities', { token: s.access })).body?.detail) : ''}`, ok);
  rec('CWE-613', `${label}: other users' sessions unaffected (SECOP2IT, SECHO)`, '200 / 200', `${other} / ${me}`, other === 200 && me === 200);
  return r;
}
async function login(code, pw) {
  const r = await rawLogin(code, pw);
  if (r.status !== 200) throw new Error(`login ${code} -> ${r.status} ${r.raw}`);
  return { access: r.body.access_token, refresh: r.refresh, body: r.body };
}
async function makeUser(code, name, role, area) {
  const r = await req('POST', '/api/people/employees', { token: SECHO, body: {
    name, company_id: 1, location_id: 1, code, login: { enabled: true, role, work_area: area } } });
  if (r.status !== 201) throw new Error(`create ${code} -> ${r.status} ${r.raw}`);
  const id = r.body.id;
  const iss = await req('POST', '/api/asset-users/issue-passwords', { token: SECHO, body: { asset_user_ids: [id] } });
  if (iss.status !== 200 || !iss.body?.[0]?.temp_password) throw new Error(`issue ${code} -> ${iss.status}`);
  return { id, code, temp: iss.body[0].temp_password };
}
async function changePw(access, oldPw, newPw) {
  const r = await fetch(`${API}/api/auth/change-password`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ old_password: oldPw, new_password: newPw }) });
  const sc = r.headers.getSetCookie(); const m = sc.map(c => /refresh_token=([^;]*)/.exec(c)).find(Boolean);
  return { status: r.status, refresh: m ? m[1] : null, text: (await r.text()).slice(0, 200) };
}

// =============== A. operator account: logout, own password change, role / work-area / company-access change, reset
const A = await makeUser(`RT-SESS-A-${stamp}`, 'RT Session Probe A', 'OPERATOR', 'IT');
log.push(`created throw-away operator id=${A.id} code=${A.code}`);
const pwA1 = strongPw(), pwA2 = strongPw();
{ // first sign-in with the issued password, then the forced change
  const s0 = await login(A.code, A.temp);
  rec('CWE-620', 'A first sign-in with issued password -> must_change_password', 'true', `${s0.body.must_change_password}`, s0.body.must_change_password === true);
  const cp = await changePw(s0.access, A.temp, pwA1);
  rec('CWE-620', 'A forced change-password', '204 + new refresh cookie', `${cp.status} cookie=${cp.refresh ? 'yes' : 'no'}`, cp.status === 204 && !!cp.refresh);
  const a0 = await caps(s0.access); const r0 = await refreshWith(s0.refresh); const rc = await refreshWith(cp.refresh);
  rec('CWE-613', 'AU-05 forced change-password: OLD must-change access / OLD refresh / NEW cookie', '401 / 401 / 200', `${a0} / ${r0.status} / ${rc.status}`, a0 === 401 && r0.status === 401 && rc.status === 200);
}
{ // logout
  const s = await login(A.code, pwA1);
  await probe('AU-05 control before logout', s, true);
  const lo = await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: { Cookie: `refresh_token=${s.refresh}` } });
  rec('CWE-613', 'AU-05 logout with own refresh cookie', '204', `${lo.status}`, lo.status === 204);
  await probe('AU-05 after logout', s, false);
}
{ // logout attempt WITHOUT the cookie but with the victim's bearer: must not end anything (and cannot sign others out)
  const s = await login(A.code, pwA1);
  const lo = await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${s.access}` } });
  rec('CWE-613', 'logout with bearer only (no cookie) is a no-op for sessions', '204, session still alive', `${lo.status} caps=${await caps(s.access)}`, lo.status === 204 && (await caps(s.access)) === 200);
  // own password change
  const cp = await changePw(s.access, pwA1, pwA2);
  rec('CWE-620', 'AU-05 self change-password', '204', `${cp.status}`, cp.status === 204);
  await probe('AU-05 after own password change', s, false);
  const rn = await refreshWith(cp.refresh);
  rec('CWE-613', 'AU-05 the NEW cookie from change-password keeps the person signed in', '200', `${rn.status}`, rn.status === 200);
  const old = await rawLogin(A.code, pwA1);
  rec('CWE-620', 'old password no longer signs in', '401', `${old.status}`, old.status === 401);
}
{ // role change by head office
  const s = await login(A.code, pwA2);
  const u = await req('PUT', `/api/asset-users/${A.id}`, { token: SECHO, body: { role: 'VIEWER' } });
  rec('CWE-613', 'AU-07 SECHO changes role OPERATOR->VIEWER', '200', `${u.status}`, u.status === 200);
  await probe('AU-07 after role change', s, false);
}
let sV;
{ // new sign-in gets the new role; an unrelated edit does not end the session
  sV = await login(A.code, pwA2);
  rec('CWE-269', 'AU-07 sign-in after role change carries the NEW role', 'VIEWER', sV.body.role, sV.body.role === 'VIEWER');
  const u = await req('PUT', `/api/asset-users/${A.id}`, { token: SECHO, body: { phone: '9999900001' } });
  rec('CWE-613', 'unrelated edit (phone) by SECHO', '200', `${u.status}`, u.status === 200);
  await probe('no over-revocation: after a phone-only edit', sV, true);
}
{ // work area change
  const s = await login(A.code, pwA2);
  const u = await req('PUT', `/api/asset-users/${A.id}`, { token: SECHO, body: { allowed_asset_domains: 'BOTH' } });
  rec('CWE-613', 'AU-07 SECHO changes work area IT->BOTH', '200', `${u.status} ${u.status !== 200 ? u.raw.slice(0, 120) : ''}`, u.status === 200);
  await probe('AU-07 after work-area change', s, false);
}
{ // company access change
  const s = await login(A.code, pwA2);
  const u = await req('POST', `/api/asset-users/${A.id}/company-access`, { token: SECHO, body: { company_ids: [1, 2] } });
  rec('CWE-613', 'AU-07 SECHO grants company access CKVPL', '204', `${u.status} ${u.status !== 204 ? u.raw.slice(0, 120) : ''}`, u.status === 204);
  await probe('AU-07 after company-access change', s, false);
}
{ // password reset by head office
  const s = await login(A.code, pwA2);
  const u = await req('POST', `/api/asset-users/${A.id}/reset-password`, { token: SECHO });
  rec('CWE-640', 'AU-05 SECHO resets the password', '200 (temp password returned once)', `${u.status}`, u.status === 200);
  await probe('AU-05 after password reset', s, false);
  const old = await rawLogin(A.code, pwA2);
  rec('CWE-640', 'pre-reset password no longer signs in', '401', `${old.status}`, old.status === 401);
}
{
  const d = await req('DELETE', `/api/asset-users/${A.id}`, { token: SECHO });
  rec('CWE-613', `cleanup: soft-deactivate throw-away A (id ${A.id})`, '204', `${d.status}`, d.status === 204);
}

// =============== B. self-service login: sign-in switched off (AU-07, immediate) and deactivation (AU-05)
const B = await makeUser(`RT-SESS-B-${stamp}`, 'RT Session Probe B', 'SELF_SERVICE', null);
log.push(`created throw-away self-service id=${B.id} code=${B.code}`);
const pwB = strongPw();
{
  const s0 = await login(B.code, B.temp);
  const cp = await changePw(s0.access, B.temp, pwB);
  rec('CWE-620', 'B forced change-password', '204', `${cp.status}`, cp.status === 204);
  const s = await login(B.code, pwB);
  const u = await req('PUT', `/api/asset-users/${B.id}`, { token: SECHO, body: { login_enabled: false } });
  rec('CWE-613', 'AU-07 SECHO switches sign-in off', '200', `${u.status}`, u.status === 200);
  await probe('AU-07 after sign-in switched off (immediate, not after 15 min)', s, false);
  const l = await rawLogin(B.code, pwB);
  rec('CWE-613', 'sign-in while switched off', '401', `${l.status}`, l.status === 401);
  const u2 = await req('PUT', `/api/asset-users/${B.id}`, { token: SECHO, body: { login_enabled: true } });
  rec('CWE-613', 'SECHO switches sign-in back on', '200', `${u2.status}`, u2.status === 200);
  const s2 = await login(B.code, pwB);
  rec('CWE-613', 'sign-in after re-enable gives a fresh working session', '200', `${await caps(s2.access)}`, (await caps(s2.access)) === 200);
  rec('CWE-613', 'the session from BEFORE the switch-off stays dead after re-enable', '401', `${await caps(s.access)}`, (await caps(s.access)) === 401);
  const d = await req('DELETE', `/api/asset-users/${B.id}`, { token: SECHO });
  rec('CWE-613', `AU-05 SECHO soft-deactivates throw-away B (id ${B.id})`, '204', `${d.status}`, d.status === 204);
  await probe('AU-05 after deactivation', s2, false);
  const l2 = await rawLogin(B.code, pwB);
  rec('CWE-613', 'sign-in after deactivation', '401', `${l2.status}`, l2.status === 401);
}

// =============== C. Primary-Owner login clash: an employee coded like the head-office admin's NAME
{
  const po = await req('GET', '/api/asset-users/2', { token: SECHO });
  log.push(`SECHO row: name=${po.body?.name} code=${po.body?.code} company_id=${po.body?.company_id} is_primary_owner=${po.body?.is_primary_owner}`);
  const C = await makeUser('SECHO', 'RT Clash Employee', 'SELF_SERVICE', null);   // code == SECHO's name
  log.push(`created clash employee id=${C.id} code=SECHO company 1 with a password (so it matches the company-scoped login query)`);
  rec('CWE-287', 'SECHO can create an employee whose code equals the Primary Owner name (setup)', '201 (allowed: codes are per company)', `id=${C.id}`, null);
  const l1 = await rawLogin('SECHO');
  rec('CWE-287', 'clash: SECHO signs in with login id "SECHO" while an employee coded SECHO with a password exists',
    '200 as the Primary Owner (id 2)', `${l1.status} asset_user_id=${l1.body?.asset_user_id} is_primary_owner=${l1.body?.is_primary_owner}`,
    l1.status === 200 && l1.body?.asset_user_id === 2 && l1.body?.is_primary_owner === true);
  const l2 = await rawLogin('secho');
  rec('CWE-287', 'clash: lower-case "secho" also resolves to the Primary Owner', '200 id 2', `${l2.status} id=${l2.body?.asset_user_id}`, l2.status === 200 && l2.body?.asset_user_id === 2);
  const l3 = await rawLogin('SECHO', C.temp);
  rec('CWE-287', 'clash: the employee\'s own password with login id "SECHO" does NOT open the employee nor SECHO', '401', `${l3.status}`, l3.status === 401,
    'functional side effect: that employee cannot sign in by code; one failed attempt is counted on SECHO');
  const l4 = await rawLogin('SECHO');      // resets SECHO's failure counter
  rec('CWE-287', 'SECHO signs in again (counter reset)', '200 id 2', `${l4.status} id=${l4.body?.asset_user_id}`, l4.status === 200 && l4.body?.asset_user_id === 2);
  const d = await req('DELETE', `/api/asset-users/${C.id}`, { token: SECHO });
  rec('CWE-287', `cleanup: soft-deactivate clash employee (id ${C.id})`, '204', `${d.status}`, d.status === 204);
}

// =============== D. mass assignment on user create with a VALID body (replaces the invalid RT-AC-T302 probe)
{
  const fab = await tok('SECFABOTH');
  const body = { company_id: 1, code: `RT-MASS-${stamp}`, name: 'RT Mass Assign Probe', asset_user_type: 'EMPLOYEE', location_id: 1,
    role: 'OPERATOR', login_enabled: true, allowed_asset_domains: 'BOTH',
    is_primary_owner: true, must_change_password: false, password_hash: 'x', failed_login_count: 0, token_version: 99,
    locked_until: null, id: 999999, is_active: true, created_by: 1 };
  const r = await req('POST', '/api/asset-users', { token: fab, body });
  rec('CWE-915', 'mass-assign on POST /api/asset-users as SECFABOTH (is_primary_owner, token_version, password_hash, id in body)',
    '201 with is_primary_owner=false, id auto', `${r.status} id=${r.body?.id} is_primary_owner=${r.body?.is_primary_owner}`,
    r.status === 201 && r.body?.is_primary_owner === false && r.body?.id !== 999999);
  if (r.body?.id) { const d = await req('DELETE', `/api/asset-users/${r.body.id}`, { token: SECHO }); log.push(`cleanup mass-assign user ${r.body.id} -> ${d.status}`); }
}

writeFileSync(new URL('./sessions.json', import.meta.url), JSON.stringify(results, null, 1));
writeFileSync(new URL('./sessions_transcript.txt', import.meta.url), log.join('\n'));
console.log('total', results.length, 'FAIL', results.filter(r => r.result === 'FAIL').length);
