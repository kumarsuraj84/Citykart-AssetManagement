// RT AU-02 / AU-04 / login state matrix / Primary-Owner clash / SQLi-ish ids (host address, paced logins).
import fs from 'node:fs';
import path from 'node:path';
import { DIR, PW, rawLogin, req, rec, session } from './lib.mjs';

const users = JSON.parse(fs.readFileSync(path.join(DIR, 'users.json'), 'utf8'));
const A = 'auth-login';
const s = (r) => `${r.status} ${r.body?.detail ?? ''}`.trim();

let r = await rawLogin('SECLOCK', PW, { retry429: true });
rec('RT-AU-T301', A, 'CWE-204', 'AU-02 locked account (SECLOCK) + RIGHT password', '423 (accepted LOW)', s(r), r.status === 423 ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin('SECLOCK', 'Wrong#Pass2026x', { retry429: true });
rec('RT-AU-T302', A, 'CWE-204', 'AU-02 locked account + WRONG password (lock is not a guessing oracle)', '423 same as right password', s(r), r.status === 423 ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin('SECDIS', PW, { retry429: true });
rec('RT-AU-T303', A, 'CWE-287', 'Deactivated (SECDIS) right password', '401 generic', s(r), r.status === 401 && r.body?.detail === 'Invalid credentials' ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin('SECNOLOGIN', PW, { retry429: true });
rec('RT-AU-T304', A, 'CWE-287', 'Sign-in off (SECNOLOGIN) right password', '401 generic', s(r), r.status === 401 && r.body?.detail === 'Invalid credentials' ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin('ghost-rt-zz91', PW, { retry429: true });
rec('RT-AU-T305', A, 'CWE-204', 'Non-existent id', '401 generic, same text', s(r), r.status === 401 && r.body?.detail === 'Invalid credentials' ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin('SECOP2IT', 'Wrong#Pass2026x', { retry429: true });
rec('RT-AU-T306', A, 'CWE-204', 'Existing id wrong password', '401 generic, same text', s(r), r.status === 401 && r.body?.detail === 'Invalid credentials' ? 'PASS' : 'FAIL', 'login_states.mjs');
// reset SECOP2IT counter with its right password (it is a shared persona: do not leave failures behind)
r = await rawLogin('SECOP2IT', PW, { retry429: true });
rec('RT-AU-T307', A, 'A07:2021', 'Right password resets the failure counter (SECOP2IT)', '200', s(r), r.status === 200 ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin('SECMUST', PW, { retry429: true });
const capMust = await req('GET', '/api/assets', { token: r.body?.access_token });
rec('RT-AU-T308', A, 'A07:2021', 'must_change_password (SECMUST): login 200 but every other route 403', '200 / 403', `${r.status} must_change=${r.body?.must_change_password} / assets ${capMust.status}`, r.status === 200 && capMust.status === 403 ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin("SECOPIT' OR '1'='1", PW, { retry429: true });
rec('RT-AU-T309', A, 'CWE-89', 'SQL-looking login id', '401', s(r), r.status === 401 ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin('secopit@SEC.TEST', PW, { retry429: true });
rec('RT-AU-T310', A, 'A07:2021', 'Login by e-mail, mixed case', '200', s(r), r.status === 200 ? 'PASS' : 'FAIL', 'login_states.mjs');
// Primary-Owner login clash: an employee whose CODE is "SECHO" exists (id 34, made by the access retest);
// signing in as SECHO must still reach the head-office admin (id 2).
r = await rawLogin('SECHO', PW, { retry429: true });
rec('RT-AU-T311', A, 'CWE-287', 'Primary-Owner clash: login "SECHO" while an employee with code SECHO exists', '200 as head-office admin id 2', `${r.status} id=${r.body?.asset_user_id} primary=${r.body?.is_primary_owner}`, r.status === 200 && r.body?.asset_user_id === 2 && r.body?.is_primary_owner ? 'PASS' : 'FAIL', 'login_states.mjs');
r = await rawLogin('secho', PW, { retry429: true });
rec('RT-AU-T312', A, 'CWE-287', 'Primary-Owner clash: lower-case "secho" (name match is case-insensitive)', '200 as id 2', `${r.status} id=${r.body?.asset_user_id}`, r.status === 200 && r.body?.asset_user_id === 2 ? 'PASS' : 'FAIL', 'login_states.mjs');
// A wrong password for "SECHO" must count against the head-office admin (id 2), not the clash employee.
const ho = await session('SECHO');
// AU-04: lock-out still possible with 5 guesses (throw-away BRUTE12): rate limit does not stop it
const codes = [];
for (let i = 0; i < 5; i++) codes.push((await rawLogin('BRUTE12', `Nope#${i}xyzq`, { retry429: true })).status);
r = await rawLogin('BRUTE12', users.BRUTE12.temp, { retry429: true });
rec('RT-AU-T313', 'bruteforce', 'CWE-645', 'AU-04 residual: 5 wrong guesses lock a real user; right password then 423', 'lock still possible (residual, accepted)', `guesses ${codes.join(',')} then right pw ${r.status}`, r.status === 423 ? 'INFO' : 'FAIL', 'login_states.mjs');
const db = await req('GET', `/api/asset-users?q=BRUTE12`, { token: ho.access });
rec('RT-AU-T314', 'bruteforce', 'CWE-307', 'Lock threshold still 5 (BRUTE12)', '401 x5 then 423', `${codes.join(',')}`, codes.every((c) => c === 401) ? 'PASS' : 'FAIL', 'login_states.mjs');
