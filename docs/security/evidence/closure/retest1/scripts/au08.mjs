// CL1 AU-08 password policy, LIVE via POST /api/auth/change-password. Creates a throw-away employee (BRUTE21) as
// SECHO, issues a temp password, sets a known strong one, then tries weak / personal / strong-passphrase candidates.
// change-password is 10/min per IP -> paced >= 7 s. Rejected candidates do not change the password (token stays
// valid); accepted ones end the session, so we re-login. The brute account is deactivated at the end.
import fs from 'node:fs';
const API = 'http://127.0.0.1:8200';
const DIR = 'C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/cl1';
const PW = 'Sec#Test2026ok';
const SECHO = fs.readFileSync(`${DIR}/secho.tok`, 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };

async function j(method, path, { token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
}

// paced login with one 429 wait
async function login(loginId, password) {
  await sleep(7000);
  let r = await j('POST', '/api/auth/login', { body: { login_id: loginId, password } });
  if (r.status === 429) { await sleep(31000); r = await j('POST', '/api/auth/login', { body: { login_id: loginId, password } }); }
  return r;
}

async function changePw(token, oldp, newp) {
  await sleep(7000);
  let r = await j('POST', '/api/auth/change-password', { token, body: { old_password: oldp, new_password: newp } });
  if (r.status === 429) { await sleep(31000); r = await j('POST', '/api/auth/change-password', { token, body: { old_password: oldp, new_password: newp } }); }
  return r;
}

async function main() {
  // 1. create BRUTE21 employee (CKSPL, operator, both work areas)
  const emp = await j('POST', '/api/people/employees', { token: SECHO, body: {
    name: 'Bruteforce Tester', company_id: 1, location_id: 1, code: 'BRUTE21', department_id: 1,
    email: 'brute21@sec.test', login: { enabled: true, role: 'OPERATOR', work_area: 'BOTH' } } });
  log({ step: 'create-employee', status: emp.status, id: emp.body?.id, detail: emp.body?.detail });
  const uid = emp.body?.id;
  if (!uid) { fs.writeFileSync(`${DIR}/au08/au08_results.json`, JSON.stringify(out, null, 2)); return; }

  // 2. issue temp password
  const iss = await j('POST', '/api/asset-users/issue-passwords', { token: SECHO, body: { asset_user_ids: [uid] } });
  const temp = iss.body?.[0]?.temp_password;
  log({ step: 'issue-password', status: iss.status, gotTemp: !!temp });

  // 3. login with temp -> set a known strong password
  let r = await login('BRUTE21', temp);
  log({ step: 'login-temp', status: r.status, mustChange: r.body?.must_change_password });
  let tok = r.body?.access_token;
  const STRONG1 = 'Zephyr-Cliff-Jolt-7291';
  r = await changePw(tok, temp, STRONG1);
  log({ step: 'set-strong1', status: r.status, detail: r.body?.detail });
  r = await login('BRUTE21', STRONG1);
  tok = r.body?.access_token;
  log({ step: 'login-strong1', status: r.status });

  // 4. reject candidates (expect 422 policy). old=STRONG1, password not changed on reject.
  const rejects = [
    'Password@2026', 'Welcome@2026', 'Adm1n#123', 'P@ssw0rd99', 'Admin@2026', 'Qwerty@123',
    'Citykart2026', 'CKAM2026', 'password', 'password1', '12345678', 'aaaaaaaa', 'abcdefgh', 'qwertyui',
    'Brute21#99', 'bruteforce-7', 'Tester@2026', 'BRUTE21xy', 'brute21ABC',
  ];
  for (const cand of rejects) {
    const c = await changePw(tok, STRONG1, cand);
    log({ step: 'reject-candidate', candidate: cand, status: c.status, detail: (c.body?.detail || '').slice(0, 90) });
  }

  // 5. accept candidates (expect 204). each changes the password + ends the session -> re-login.
  const accepts = ['Blue-Sky-Over-Hills-42', 'purple tractor eats 7 mangoes'];
  let cur = STRONG1;
  for (const cand of accepts) {
    const c = await changePw(tok, cur, cand);
    log({ step: 'accept-candidate', candidate: cand, status: c.status, detail: (c.body?.detail || '').slice(0, 90) });
    if (c.status === 204) {
      cur = cand;
      r = await login('BRUTE21', cur);
      tok = r.body?.access_token;
      log({ step: 'relogin-after-accept', status: r.status });
    }
  }

  // 6. cleanup: deactivate BRUTE21
  const del = await j('DELETE', `/api/asset-users/${uid}`, { token: SECHO });
  log({ step: 'deactivate-brute21', status: del.status, id: uid });

  fs.writeFileSync(`${DIR}/au08/au08_results.json`, JSON.stringify(out, null, 2));
}
await main();
