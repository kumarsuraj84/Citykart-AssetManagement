import { req, API, login, cookieHeader, sleep } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const caps = (a) => req(API, 'GET', '/api/auth/capabilities', { token: a });
const refresh = (c) => req(API, 'POST', '/api/auth/refresh', { cookie: cookieHeader(c) });
const sec = await login('SECHO'); const admin = sec.access;
await sleep(4000);
const l = await login('CL2RROLE', creds.CL2RROLE.temp);
const base = await caps(l.access);
// current allowed_asset_domains is IT -> change to NON_IT (real work-area change)
const put = await req(API, 'PUT', `/api/asset-users/${creds.CL2RROLE.id}`, { token: admin, body: { allowed_asset_domains: 'NON_IT' } });
const a = await caps(l.access); const r = await refresh(l.refresh);
const pass = a.status===401 && r.status===401 && base.status===403;
const out = { cases: [{ id:'CL2-SE-T25', desc:'CL2RROLE: work-area change (allowed_asset_domains IT->NON_IT) -> old access AND refresh dead', pass, detail:{ baseAlive: base.status, put: put.status, accessAfter: a.status, refreshAfter: r.status } }] };
console.log(pass?'PASS':'FAIL', 'CL2-SE-T25', JSON.stringify(out.cases[0].detail));
writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/a2b_workarea.json', JSON.stringify(out,null,2));
