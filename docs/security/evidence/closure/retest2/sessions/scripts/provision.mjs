import { req, API, login, PW } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const names = ['CL2RU1','CL2OTHER','CL2RLOGOUT','CL2RPWD','CL2RRESET','CL2RISSUE','CL2RROLE','CL2RDEACT','CL2RLOFF','BRUTE31','BRUTE32','CL2PWPOL','CL2TIM'];

const sec = await login('SECHO');
if (sec.status !== 200) { console.error('SECHO login failed', sec.status, sec.text); process.exit(1); }
const admin = sec.access;

const creds = {};
for (const code of names) {
  // create employee with login enabled OPERATOR / IT
  const c = await req(API, 'POST', '/api/people/employees', { token: admin, body: {
    name: code + ' throwaway', company_id: 1, location_name: 'IT', code,
    login: { enabled: true, role: 'OPERATOR', work_area: 'IT', extra_company_ids: [] } } });
  if (c.status !== 201) {
    // maybe already exists from a prior run: look it up
    const list = await req(API, 'GET', '/api/people?kind=employees&company_id=1&q=' + encodeURIComponent(code), { token: admin });
    const found = (list.json || []).find(p => p.code === code);
    if (!found) { console.error('create failed', code, c.status, c.text); continue; }
    creds[code] = { id: found.id };
    console.log('exists', code, found.id);
  } else {
    creds[code] = { id: c.json.id };
    console.log('created', code, c.json.id);
  }
  // issue a temp password
  const ip = await req(API, 'POST', '/api/asset-users/issue-passwords', { token: admin, body: { asset_user_ids: [creds[code].id] } });
  if (ip.status === 200 && ip.json && ip.json.length) {
    creds[code].temp = ip.json[0].temp_password;
  } else {
    // already had a password (only_without_password filters it out) -> reset to get a known temp
    const rp = await req(API, 'POST', `/api/asset-users/${creds[code].id}/reset-password`, { token: admin });
    if (rp.status === 200 && rp.json) creds[code].temp = rp.json.temp_password;
    else console.error('issue/reset failed', code, ip.status, rp.status);
  }
}
writeFileSync(new URL('./creds.json', import.meta.url), JSON.stringify(creds, null, 2));
console.log('provisioned', Object.keys(creds).length, 'users; temps captured:', Object.values(creds).filter(c=>c.temp).length);
