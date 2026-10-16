import { req, API, login, cookieHeader, refreshFrom, sleep } from './lib.mjs';
import { sign } from './forge.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const R = {};
const out = { cases: [], artifacts: {} };
const refresh = (cookie) => req(API, 'POST', '/api/auth/refresh', { cookie: cookieHeader(cookie) });
const caps = (access) => req(API, 'GET', '/api/auth/capabilities', { token: access });
const rec = (id, desc, pass, detail) => { out.cases.push({ id, desc, pass, detail }); console.log(pass ? 'PASS' : 'FAIL', id, desc, '|', JSON.stringify(detail)); };

// ---- main reuse flow (CL2RU1) ----
const l1 = await login('CL2RU1', creds.CL2RU1.temp);
const R1 = l1.refresh, A1 = l1.access;
out.artifacts.R1_fragment = R1.slice(-24); // store a fragment to grep for leakage later
await sleep(200);
const r2 = await refresh(R1);                 // rotate: R1 -> R2
const R2 = refreshFrom(r2.setCookie), A2 = r2.json && r2.json.access_token;
rec('CL2-SE-T01', 'first refresh rotates (new Set-Cookie)', r2.status === 200 && !!R2 && R2 !== R1, { status: r2.status, gotCookie: !!R2 });

await sleep(16000);                            // past the 10s grace window
const reuse = await refresh(R1);               // replay OLD cookie R1 -> REUSE
rec('CL2-SE-T02', 'replay of old cookie past grace -> 401', reuse.status === 401, { status: reuse.status, detail: reuse.json && reuse.json.detail });
// after reuse, ALL that person's sessions dead:
const r2dead = await refresh(R2);
rec('CL2-SE-T03', 'newer cookie R2 also dead after reuse', r2dead.status === 401, { status: r2dead.status });
const a2dead = await caps(A2);
rec('CL2-SE-T04', 'access token A2 dead after reuse (401, not 200/403)', a2dead.status === 401, { status: a2dead.status });
const a1dead = await caps(A1);
rec('CL2-SE-T05', 'original access token A1 dead after reuse', a1dead.status === 401, { status: a1dead.status });

// ---- other users unaffected (control) ----
const other = await login('CL2OTHER', creds.CL2OTHER.temp);
const oref = await refresh(other.refresh);
rec('CL2-SE-T06', 'different user session unaffected by the reuse', oref.status === 200, { status: oref.status });

// ---- grace: replay the immediately-previous cookie within a couple seconds ----
const g = await login('CL2RU1', creds.CL2RU1.temp);
await sleep(200);
const grot = await refresh(g.refresh);         // Rg -> Rg2
const Rg = g.refresh, Rg2 = refreshFrom(grot.setCookie);
await sleep(1500);                              // within 10s grace
const dup = await refresh(Rg);                  // replay just-replaced cookie Rg
const dupSetCookie = (dup.setCookie || []).length;
rec('CL2-SE-T07', 'grace replay -> access token only, NO Set-Cookie', dup.status === 200 && dupSetCookie === 0 && !!(dup.json && dup.json.access_token), { status: dup.status, setCookies: dupSetCookie });
const rg2ok = await refresh(Rg2);               // the winner's newer cookie still valid, rotates
rec('CL2-SE-T08', 'winner cookie Rg2 still valid after a grace duplicate', rg2ok.status === 200 && !!refreshFrom(rg2ok.setCookie), { status: rg2ok.status });

// ---- two sign-ins = two independent sessions ----
const s1 = await login('CL2RU1', creds.CL2RU1.temp);
await sleep(200);
const s2 = await login('CL2RU1', creds.CL2RU1.temp);
await sleep(200);
const s1r = await refresh(s1.refresh);
const s2r = await refresh(s2.refresh);
rec('CL2-SE-T09', 'two sign-ins = two independent live sessions (both refresh 200)', s1r.status === 200 && s2r.status === 200 && s1.refresh !== s2.refresh, { s1: s1r.status, s2: s2r.status });

// ---- legacy-style cookie (crafted with the known test secret: no sid) ----
const now = Math.floor(Date.now() / 1000);
const legacy = sign({ sub: String(creds.CL2RU1.id), type: 'refresh', tv: 0, jti: 'legacyjti-cl2-001', iat: now, exp: now + 3600 });
const leg1 = await refresh(legacy);             // first use -> becomes a session, rotates
const legSet = refreshFrom(leg1.setCookie);
rec('CL2-SE-T10', 'legacy cookie (no sid) first use accepted + rotated', leg1.status === 200 && !!legSet, { status: leg1.status, gotCookie: !!legSet });
await sleep(16000);
const leg2 = await refresh(legacy);             // reuse of the legacy token past grace -> reuse
rec('CL2-SE-T11', 'legacy cookie replay past grace -> 401 reuse', leg2.status === 401, { status: leg2.status, detail: leg2.json && leg2.json.detail });

// ---- expired session (set auth_session.expires_at in the past is done out-of-band; here: forged expired JWT) ----
const expired = sign({ sub: String(creds.CL2RU1.id), type: 'refresh', tv: 0, jti: 'expjti', sid: 999999, iat: now - 100000, exp: now - 10 });
const exp = await refresh(expired);
rec('CL2-SE-T12', 'expired refresh JWT -> 401', exp.status === 401, { status: exp.status, detail: exp.json && exp.json.detail });

const RAW = 'D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/';
writeFileSync(RAW + 'a1_refresh.json', JSON.stringify(out, null, 2));
console.log('\nSUMMARY', out.cases.filter(c=>c.pass).length, '/', out.cases.length, 'passed');
console.log('R1_fragment_for_grep', out.artifacts.R1_fragment);
