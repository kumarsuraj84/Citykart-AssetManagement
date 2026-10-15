// RT AU-08: password policy on POST /api/auth/change-password for throw-away BRUTE18 ("Ravikumar Sharma",
// email brute18@sec.test). Calls are spaced 7 s apart (change-password limit: 10/min per address).
import fs from 'node:fs';
import path from 'node:path';
import { DIR, rawLogin, req, rec, sleep } from './lib.mjs';

const users = JSON.parse(fs.readFileSync(path.join(DIR, 'users.json'), 'utf8'));
let current = users.BRUTE18.pw || users.BRUTE18.temp;
const l = await rawLogin('BRUTE18', current, { retry429: true });
let access = l.body.access_token;
const AREA = 'password-policy';

const cases = [
  // id, candidate, expectRefused, label
  ['T201', 'password123', true, 'common password'],
  ['T202', 'PassWord123', true, 'common password, other case'],
  ['T203', '12345678', true, 'common digits'],
  ['T204', '23456789', true, 'digit run'],
  ['T205', 'hgfedcba', true, 'reverse letter run'],
  ['T206', 'qwertyui', true, 'keyboard run'],
  ['T207', 'zzzzzzzzzz', true, 'same character'],
  ['T208', 'Citykart2026', true, 'brand + digits'],
  ['T209', 'ckam@123', true, 'app name + symbols/digits'],
  ['T210', 'CITYKART#2026!', true, 'brand upper + symbols'],
  ['T211', 'xBRUTE18-Lantern', true, 'contains own login code'],
  ['T212', 'Ravikumar99!x', true, 'contains own name word'],
  ['T213', 'Blue-Sharma-77', true, 'contains surname'],
  ['T214', 'Ab1!xy', true, 'too short (< 8) -> schema 422'],
  ['T215', 'a'.repeat(129), true, 'too long (> 128) -> schema 422'],
  ['T216', current, true, 'same as old password'],
  // Gap probes: common shapes not on the fixed list (expected by a stronger policy to be refused)
  ['T217', 'Password@2026', true, 'GAP probe: Password@year'],
  ['T218', 'Welcome@2026', true, 'GAP probe: Welcome@year'],
  ['T219', 'Citykart@Store1', false, 'brand + word (allowed by rule: not only digits/symbols)'],
  ['T220', 'Granite#Meadow-4418', false, 'strong passphrase accepted'],
];

for (const [id, cand, expectRefused, label] of cases) {
  await sleep(7000);
  const r = await req('POST', '/api/auth/change-password', { token: access, body: { old_password: current, new_password: cand } });
  const refused = r.status === 422 || r.status === 400;
  const detail = r.body?.detail ? (typeof r.body.detail === 'string' ? r.body.detail : JSON.stringify(r.body.detail).slice(0, 140)) : '';
  let result = refused === expectRefused ? 'PASS' : 'FAIL';
  if (id === 'T219') result = refused ? 'INFO' : 'INFO';
  rec(`RT-AU-${id}`, AREA, 'CWE-521', `change-password: ${label}`, expectRefused ? '422 plain sentence' : '204 accepted',
    `${r.status} ${detail}`, result, 'policy.mjs');
  if (r.status === 204) {
    current = cand;
    users.BRUTE18.pw = current;
    fs.writeFileSync(path.join(DIR, 'users.json'), JSON.stringify(users, null, 1));
    const rf = await req('POST', '/api/auth/refresh', { cookie: r.cookie?.value });
    access = rf.body?.access_token;
  }
  if (r.status === 429) { console.log('429 -> waiting'); await sleep(61000); }
}
// wrong old password -> 400 plain sentence (not 401: the user must not be bounced out)
await sleep(7000);
const w = await req('POST', '/api/auth/change-password', { token: access, body: { old_password: 'not-the-old-one', new_password: 'Granite#Meadow-9999' } });
rec('RT-AU-T221', AREA, 'CWE-620', 'change-password with wrong current password', '400 "Old password is incorrect"', `${w.status} ${w.body?.detail}`, w.status === 400 ? 'PASS' : 'FAIL', 'policy.mjs');
