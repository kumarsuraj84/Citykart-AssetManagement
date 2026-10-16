import { login, req, API, sleep } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
console.log('draining login rate-limit window (62s)...');
await sleep(62000);
const l = await login('CL2PWPOL', creds.CL2PWPOL.temp);
if (l.status !== 200 || !l.access) { console.error('LOGIN FAILED', l.status, l.json && l.json.detail); process.exit(1); }
const temp = creds.CL2PWPOL.temp;
const cp = (newpw) => req(API, 'POST', '/api/auth/change-password', { token: l.access, body: { old_password: temp, new_password: newpw } });

// each must be REFUSED (422) with a plain message; old password stays `temp` so we can keep trying
const reject = [
  'Password@2026','Welcome@2026','Admin@2026','Qwerty@123','Citykart2026','CKAM2026','password1',
  'aaaaaaaa','12345678','abcdefgh','87654321',
  'CL2PWPOL-river',           // contains login code
  'the-throwaway-key',        // contains a word of the name
];
const out = { rejected: [], accepted: null };
for (const pw of reject) {
  const r = await cp(pw);
  out.rejected.push({ pw, status: r.status, detail: r.json && r.json.detail });
  console.log(r.status === 422 ? 'REJECT-OK' : 'UNEXPECTED', r.status, JSON.stringify(pw), '->', r.json && r.json.detail);
  await sleep(7000); // stay under 10/min change-password limit
}
// a long passphrase must be ACCEPTED (204). This ends the session + rotates the cookie.
const ok = await cp('copper lantern harbor meadow');
out.accepted = { pw: 'copper lantern harbor meadow', status: ok.status };
console.log(ok.status === 204 ? 'ACCEPT-OK' : 'UNEXPECTED-ACCEPT', ok.status);
writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/a5_password.json', JSON.stringify(out,null,2));
const bad = out.rejected.filter(r=>r.status!==422);
console.log('\nSUMMARY rejected', out.rejected.length - bad.length, '/', out.rejected.length, 'as 422; accepted passphrase =', out.accepted.status===204);
if (bad.length) console.log('NOT-422:', JSON.stringify(bad));
