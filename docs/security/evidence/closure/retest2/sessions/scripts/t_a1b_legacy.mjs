import { req, API, cookieHeader, refreshFrom, sleep } from './lib.mjs';
import { sign } from './forge.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const refresh = (cookie) => req(API, 'POST', '/api/auth/refresh', { cookie: cookieHeader(cookie) });
const out = { cases: [] };
const rec = (id, desc, pass, detail) => { out.cases.push({ id, desc, pass, detail }); console.log(pass?'PASS':'FAIL', id, desc, '|', JSON.stringify(detail)); };
const now = Math.floor(Date.now()/1000);
const TV = 1; // CL2OTHER current token_version
// legacy = refresh token WITH NO sid, tv matching the account's current version
const legacy = sign({ sub: String(creds.CL2OTHER.id), type:'refresh', tv: TV, jti:'legacyjti-cl2other-A', iat: now, exp: now+3600 });
const leg1 = await refresh(legacy);
const legSet = refreshFrom(leg1.setCookie);
rec('CL2-SE-T10', 'legacy cookie (no sid, correct tv) first use accepted + rotated', leg1.status===200 && !!legSet, { status: leg1.status, gotCookie: !!legSet });
await sleep(16000);
const leg2 = await refresh(legacy);
rec('CL2-SE-T11', 'legacy cookie replay past grace -> 401 reuse (sessions ended)', leg2.status===401, { status: leg2.status, detail: leg2.json && leg2.json.detail });
// after reuse the rotated legacy-derived cookie is also dead
const legDead = await refresh(legSet);
rec('CL2-SE-T11b', 'rotated cookie from legacy session dead after reuse', legDead.status===401, { status: legDead.status });
writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/a1b_legacy.json', JSON.stringify(out,null,2));
console.log('done');
