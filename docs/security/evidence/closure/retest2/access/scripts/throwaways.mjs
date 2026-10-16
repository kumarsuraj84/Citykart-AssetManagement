// RETEST2 ACCESS: build two CL2 throwaway employees to test a STILL-CACHED access token after the account is
// (a) soft-deactivated and (b) login-disabled. One login per throwaway (temp pw), then change-password + refresh
// to get a clean non-must-change access token, then flip state as SECHO and replay. Deactivate both at the end.
import { tok, req, rawLogin, refreshWith, sleep } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const NEWPW = 'Vex9-Quartzmint-Harbor';   // strong passphrase, unrelated to code/name/email (AU-08)
const out = {};

async function buildToken(code, name) {
  const secho = await tok('SECHO');
  // 1. create employee
  const c = await req('POST','/api/people/employees',{ token: secho,
    body: { name, company_id: 1, code, location_id: 1, login: { enabled: true, role: 'OPERATOR', work_area: 'BOTH' } } });
  if (c.status !== 201) return { error: `create ${code} -> ${c.status} ${c.raw}` };
  const id = c.body.id;
  // 2. issue temp password
  const ip = await req('POST','/api/asset-users/issue-passwords',{ token: secho, body: { asset_user_ids: [id] } });
  if (ip.status !== 200 || !ip.body[0]) return { error: `issue ${code} -> ${ip.status} ${ip.raw}` };
  const temp = ip.body[0].temp_password;
  // 3. login with temp (LOGIN)
  const lg = await rawLogin(code, temp);
  if (lg.status !== 200) return { error: `login ${code} -> ${lg.status} ${lg.raw}` };
  // 4. change password using the login access token (must_change exempt path)
  const cp = await req('POST','/api/auth/change-password',{ token: lg.body.access_token,
    headers: { Cookie: `refresh_token=${lg.refresh}` },
    body: { old_password: temp, new_password: NEWPW } });
  if (cp.status !== 204) return { error: `change-pw ${code} -> ${cp.status} ${cp.raw}` };
  // the change-password sets a NEW refresh cookie; grab it to mint a clean access token
  const newRefresh = (cp.headers.getSetCookie ? cp.headers.getSetCookie() : [cp.headers.get('set-cookie')].filter(Boolean))
    .map(x => /refresh_token=([^;]*)/.exec(x)).filter(Boolean).map(m => m[1])[0];
  const rf = await refreshWith(newRefresh);
  if (rf.status !== 200) return { error: `refresh ${code} -> ${rf.status} ${rf.raw}` };
  return { id, access: rf.body.access_token };
}

// ---- (a) DEACTIVATED cached token ----
const a = await buildToken('CL2DEACT', 'CL2 Deact');
out.deactivated = { build: a.error || 'ok', id: a.id };
if (!a.error) {
  const live = await req('GET','/api/auth/capabilities',{ token: a.access });
  out.deactivated.before = live.status;                               // expect 200
  const del = await req('DELETE',`/api/asset-users/${a.id}`,{ token: await tok('SECHO') });
  out.deactivated.deactivate = del.status;                            // expect 204
  const replay = await req('GET','/api/auth/capabilities',{ token: a.access });
  out.deactivated.replay = replay.status;                             // expect 401
  out.deactivated.replay_detail = replay.body && replay.body.detail;
  // also replay a write path to be sure a dead token cannot write
  const w = await req('POST','/api/masters/vendors',{ token: a.access, body: { name:'x', company_id:1 } });
  out.deactivated.replay_write = w.status;                            // expect 401
}

// ---- (b) LOGIN-DISABLED cached token ----
const b = await buildToken('CL2DISABLE', 'CL2 Disable');
out.login_disabled = { build: b.error || 'ok', id: b.id };
if (!b.error) {
  const live = await req('GET','/api/auth/capabilities',{ token: b.access });
  out.login_disabled.before = live.status;                            // expect 200
  const upd = await req('PUT',`/api/asset-users/${b.id}`,{ token: await tok('SECHO'), body: { login_enabled: false } });
  out.login_disabled.disable = upd.status;                            // expect 200
  const replay = await req('GET','/api/auth/capabilities',{ token: b.access });
  out.login_disabled.replay = replay.status;                          // expect 401
  out.login_disabled.replay_detail = replay.body && replay.body.detail;
  // cleanup: deactivate this one too
  const del = await req('DELETE',`/api/asset-users/${b.id}`,{ token: await tok('SECHO') });
  out.login_disabled.cleanup_deactivate = del.status;
}

writeFileSync(new URL('../raw/throwaways.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
