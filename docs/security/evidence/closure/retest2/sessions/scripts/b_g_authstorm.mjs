import { req, API, login, cookieHeader, sleep } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const sec = await login('SECHO'); const admin = sec.access;
const id = creds.CL2RU1.id;
const hist = (arr) => arr.reduce((h, s) => (h[s] = (h[s] || 0) + 1, h), {});

// establish an earlier session to prove it dies
await sleep(4000);
const early = await login('CL2RU1', creds.CL2RU1.temp);
const caps = (a) => req(API, 'GET', '/api/auth/capabilities', { token: a });
const refresh = (c) => req(API, 'POST', '/api/auth/refresh', { cookie: cookieHeader(c) });

// concurrent storm: logins + admin resets + issue-passwords + logout, all at once
const ops = [
  () => login('CL2RU1', creds.CL2RU1.temp).then(r => 'login:' + r.status),
  () => login('CL2RU1', creds.CL2RU1.temp).then(r => 'login:' + r.status),
  () => login('CL2RU1', creds.CL2RU1.temp).then(r => 'login:' + r.status),
  () => req(API, 'POST', `/api/asset-users/${id}/reset-password`, { token: admin }).then(r => 'reset:' + r.status),
  () => req(API, 'POST', `/api/asset-users/${id}/reset-password`, { token: admin }).then(r => 'reset:' + r.status),
  () => req(API, 'POST', '/api/asset-users/issue-passwords', { token: admin, body: { asset_user_ids: [id], only_without_password: false } }).then(r => 'issue:' + r.status),
  () => req(API, 'POST', '/api/asset-users/issue-passwords', { token: admin, body: { asset_user_ids: [id], only_without_password: false } }).then(r => 'issue:' + r.status),
  () => req(API, 'POST', '/api/auth/logout', { cookie: cookieHeader(early.refresh) }).then(r => 'logout:' + r.status),
];
const raw = await Promise.all(ops.map(f => f().catch(e => 'ERR')));
console.log('storm outcomes:', JSON.stringify(hist(raw)), raw);

// earlier session must be dead
const earlyAccess = await caps(early.access);
const earlyRefresh = await refresh(early.refresh);
const out = { storm: hist(raw), raw, earlyAccessAfter: earlyAccess.status, earlyRefreshAfter: earlyRefresh.status };
writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/b_g_authstorm.json', JSON.stringify(out, null, 2));
console.log('earlier session access/refresh after storm:', earlyAccess.status, earlyRefresh.status);
