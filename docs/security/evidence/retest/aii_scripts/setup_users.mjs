// Creates throw-away employees BRUTE11..BRUTE19 (CKSPL) as SECHO and issues temporary passwords.
// The temporary passwords go to users.json in the scratch folder only (throw-away accounts of this test stack).
import fs from 'node:fs';
import path from 'node:path';
import { session, req, DIR } from './lib.mjs';

const ho = await session('SECHO');
const out = {};
const names = {
  BRUTE11: 'Rt Race Target', BRUTE12: 'Rt Lock Target', BRUTE13: 'Rt Session Logout', BRUTE14: 'Rt Deactivate Me',
  BRUTE15: 'Rt Login Off', BRUTE16: 'Rt Role Change', BRUTE17: 'Rt Timing Wrongpw', BRUTE18: 'Ravikumar Sharma',
  BRUTE19: 'Rt Company Access',
};
for (const [code, name] of Object.entries(names)) {
  const r = await req('POST', '/api/people/employees', { token: ho.access, body: {
    code, name, company_id: 1, location_id: 1, department_id: 1, email: `${code.toLowerCase()}@sec.test`,
    login: { enabled: true, role: 'OPERATOR', work_area: 'IT' } } });
  if (r.status !== 200 && r.status !== 201) { console.log('create', code, r.status, r.raw); continue; }
  out[code] = { id: r.body.id };
}
const ids = Object.values(out).map((v) => v.id);
const iss = await req('POST', '/api/asset-users/issue-passwords', { token: ho.access, body: { asset_user_ids: ids } });
console.log('issue-passwords', iss.status);
for (const row of iss.body || []) {
  for (const [code, v] of Object.entries(out)) if (v.id === row.asset_user_id) v.temp = row.temp_password;
}
fs.writeFileSync(path.join(DIR, 'users.json'), JSON.stringify(out, null, 1));
console.log(Object.entries(out).map(([c, v]) => `${c}=${v.id}${v.temp ? ' temp-ok' : ' NO-TEMP'}`).join(' '));
