import { req, API, login, cookieHeader, refreshFrom, sleep } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const caps = (access) => req(API, 'GET', '/api/auth/capabilities', { token: access });
const refresh = (cookie) => req(API, 'POST', '/api/auth/refresh', { cookie: cookieHeader(cookie) });
const out = { cases: [] };
const rec = (id, desc, pass, detail) => { out.cases.push({ id, desc, pass, detail }); console.log(pass?'PASS':'FAIL', id, desc, '|', JSON.stringify(detail)); };

const sec = await login('SECHO'); const admin = sec.access;
await sleep(4000);
// control session that must stay alive throughout
const ctl = await login('CL2OTHER', creds.CL2OTHER.temp);
const ctlAlive0 = await caps(ctl.access);   // 403 = alive under must_change

async function establish(code) {
  await sleep(4000);
  const l = await login(code, creds[code].temp);
  const base = await caps(l.access);          // expect 403 (alive, must_change)
  return { access: l.access, refresh: l.refresh, baseStatus: base.status };
}
async function verifyDead(id, code, sess, extra) {
  const a = await caps(sess.access);
  const r = await refresh(sess.refresh);
  const pass = a.status === 401 && r.status === 401 && sess.baseStatus === 403;
  rec(id, `${code}: ${extra} -> old access AND refresh dead`, pass, { baseAliveStatus: sess.baseStatus, accessAfter: a.status, refreshAfter: r.status });
}

// 1. logout (user ends all own sessions)
let s = await establish('CL2RLOGOUT');
await req(API, 'POST', '/api/auth/logout', { cookie: cookieHeader(s.refresh) });
await verifyDead('CL2-SE-T20', 'CL2RLOGOUT', s, 'logout');

// 2. password change (user)
s = await establish('CL2RPWD');
const pc = await req(API, 'POST', '/api/auth/change-password', { token: s.access, body: { old_password: creds.CL2RPWD.temp, new_password: 'violet-harbor-lantern-73' } });
const pcCookie = refreshFrom(pc.setCookie);
await verifyDead('CL2-SE-T21', 'CL2RPWD', s, `password change (204=${pc.status}, new cookie=${!!pcCookie})`);

// 3. admin reset-password
s = await establish('CL2RRESET');
await req(API, 'POST', `/api/asset-users/${creds.CL2RRESET.id}/reset-password`, { token: admin });
await verifyDead('CL2-SE-T22', 'CL2RRESET', s, 'admin Reset Password');

// 4. issue-passwords
s = await establish('CL2RISSUE');
await req(API, 'POST', '/api/asset-users/issue-passwords', { token: admin, body: { asset_user_ids: [creds.CL2RISSUE.id], only_without_password: false } });
await verifyDead('CL2-SE-T23', 'CL2RISSUE', s, 'issue-passwords');

// 5. role change (OPERATOR -> VIEWER)
s = await establish('CL2RROLE');
const rc = await req(API, 'PUT', `/api/asset-users/${creds.CL2RROLE.id}`, { token: admin, body: { role: 'VIEWER' } });
await verifyDead('CL2-SE-T24', 'CL2RROLE', s, `role change (put=${rc.status})`);

// 6. work-area change (IT -> NON_IT) uses CL2RDEACT's twin? reuse CL2RLOGOUT is dead; create via admin on CL2RISSUE already dead.
// Use company/work-area change on CL2OTHER-like fresh? We only have CL2RDEACT and CL2RLOFF left. Use CL2RDEACT for work-area, then deactivate separately needs its own. Reassign: do work-area on CL2RLOFF first (then it is dead), then login-off cannot reuse. So: dedicate deactivation+login-off, and fold work-area into role test target already dead. Instead test work-area with a re-login of CL2RROLE (now VIEWER, session dead). Re-establish:
await sleep(4000);
const wl = await login('CL2RROLE', creds.CL2RROLE.temp); // must_change still true, login ok
const wbase = await caps(wl.access);
const wc = await req(API, 'PUT', `/api/asset-users/${creds.CL2RROLE.id}`, { token: admin, body: { work_area: 'NON_IT' } });
const wa2 = await caps(wl.access); const wr2 = await refresh(wl.refresh);
rec('CL2-SE-T25', 'CL2RROLE: work-area change -> old access AND refresh dead', wa2.status===401 && wr2.status===401 && wbase.status===403, { baseAlive: wbase.status, put: wc.status, accessAfter: wa2.status, refreshAfter: wr2.status });

// 7. deactivation
s = await establish('CL2RDEACT');
const dc = await req(API, 'DELETE', `/api/asset-users/${creds.CL2RDEACT.id}`, { token: admin });
await verifyDead('CL2-SE-T26', 'CL2RDEACT', s, `deactivation (del=${dc.status})`);

// 8. login switched off
s = await establish('CL2RLOFF');
const lo = await req(API, 'PUT', `/api/asset-users/${creds.CL2RLOFF.id}`, { token: admin, body: { login_enabled: false } });
await verifyDead('CL2-SE-T27', 'CL2RLOFF', s, `login disabled (put=${lo.status})`);

// control still alive
const ctlAlive1 = await caps(ctl.access);
rec('CL2-SE-T28', 'control user (CL2OTHER) session unaffected by all triggers', ctlAlive0.status===403 && ctlAlive1.status===403, { before: ctlAlive0.status, after: ctlAlive1.status });

writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/a2_revocation.json', JSON.stringify(out,null,2));
console.log('\nSUMMARY', out.cases.filter(c=>c.pass).length,'/',out.cases.length);
