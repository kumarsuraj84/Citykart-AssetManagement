import { req, API, WEB, sleep } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const out = { cases: [] };
const rec = (id, desc, pass, detail) => { out.cases.push({ id, desc, pass, detail }); console.log(pass?'PASS':'FAIL', id, desc, '|', JSON.stringify(detail)); };
const loginTo = (base, id, xff) => req(base, 'POST', '/api/auth/login', { body: { login_id: id, password: 'nope' }, headers: xff ? { 'X-Forwarded-For': xff } : {} });

// 1. per-login-id limit via nginx (same id) -> 429 at ~11th
await sleep(62000);
let first429 = null, seq = [];
for (let i = 0; i < 13; i++) {
  const r = await loginTo(WEB, 'ratelimit-sameid', null);
  seq.push(r.status);
  if (r.status === 429 && !first429) first429 = { at: i + 1, retryAfter: r.headers.get('retry-after'), detail: r.json && r.json.detail };
}
rec('CL2-SE-T30', 'per-login-id limit via nginx -> 429 with Retry-After + plain message', !!first429 && first429.at <= 11 && !!first429.retryAfter, { firstAt: first429 && first429.at, retryAfter: first429 && first429.retryAfter, detail: first429 && first429.detail, seq });

// 2. per-IP limit via nginx, DISTINCT ids + DISTINCT forged XFF -> still 429 at ~21 (XFF overwritten by nginx)
await sleep(62000);
first429 = null; seq = [];
for (let i = 0; i < 24; i++) {
  const r = await loginTo(WEB, 'rl-ip-' + i, '203.0.113.' + i); // distinct forged XFF each time
  seq.push(r.status);
  if (r.status === 429 && !first429) first429 = { at: i + 1, retryAfter: r.headers.get('retry-after'), detail: r.json && r.json.detail };
}
rec('CL2-SE-T31', 'per-IP limit via nginx despite distinct forged XFF -> 429 ~21 (spoof ignored, one bucket)', !!first429 && first429.at >= 20 && first429.at <= 22, { firstAt: first429 && first429.at, retryAfter: first429 && first429.retryAfter, seq });

// 3. per-IP limit DIRECT :8200 with distinct forged XFF -> 429 ~21 (XFF not believed from untrusted peer)
await sleep(62000);
first429 = null; seq = [];
for (let i = 0; i < 24; i++) {
  const r = await loginTo(API, 'rl-direct-' + i, '198.51.100.' + i);
  seq.push(r.status);
  if (r.status === 429 && !first429) first429 = { at: i + 1, retryAfter: r.headers.get('retry-after'), detail: r.json && r.json.detail };
}
rec('CL2-SE-T32', 'per-IP limit direct :8200 despite forged XFF -> 429 ~21', !!first429 && first429.at >= 20 && first429.at <= 22, { firstAt: first429 && first429.at, retryAfter: first429 && first429.retryAfter, seq });
out.directSaturatedAt = Date.now();

writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/a3_ratelimit.json', JSON.stringify(out,null,2));
console.log('\nSUMMARY', out.cases.filter(c=>c.pass).length, '/', out.cases.length, '-- DIRECT :8200 bucket now saturated for the second-source test');
