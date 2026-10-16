// RETEST2 ACCESS bootstrap: log in every matrix persona ONCE (cached, paced >=4s), and verify the
// locked / deactivated / login-disabled sign-in outcomes. Tokens cached in scratchpad tokens.json.
import { rawLogin, tok, req, sleep, getCache } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const MATRIX = ['SECSELF','SPA','SECVIEW','SECOPIT','SECOPNIT','SECOPX','SECFAIT','SECFANIT','SECFABOTH','SECOTHER','SECHO','SECMUST'];
const out = { logins: {}, negative: {} };

for (const c of MATRIX) {
  try { const t = await tok(c); out.logins[c] = { ok: true, len: t.length }; }
  catch (e) { out.logins[c] = { ok: false, err: String(e).slice(0,120) }; }
  console.error('login', c, out.logins[c].ok);
}

// Negative sign-in states (these ARE login attempts, paced by rawLogin)
for (const [code, expect] of [['SECLOCK',423],['SECDIS',401],['SECNOLOGIN',401]]) {
  const r = await rawLogin(code);
  out.negative[code] = { status: r.status, expect, detail: (r.body && r.body.detail) || r.raw.slice(0,80) };
  console.error('neg', code, r.status, 'expect', expect);
}

// sanity: capabilities for each live token (SECMUST should 403 everywhere)
for (const c of MATRIX) {
  const t = getCache()[c]; if (!t || !t.access) { out.logins[c].cap = 'no-token'; continue; }
  const r = await req('GET','/api/auth/capabilities',{ token: t.access });
  out.logins[c].cap = r.status;
}

writeFileSync(new URL('../raw/bootstrap.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
