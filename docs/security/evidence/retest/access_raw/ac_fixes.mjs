// RETEST AC-1 (self-service setup lists), AC-2 (custom fields company scope), IF-03 (ERP draft across companies).
import { writeFileSync } from 'node:fs';
import { tok, req } from './lib.mjs';

const results = [];
const transcript = [];
let n = 600;
const nid = () => `RT-AC-T${String(n++).padStart(3, '0')}`;
function rec(cwe, cas, expected, actual, pass, ev = '') {
  results.push({ id: nid(), cwe, case: cas, expected, actual, result: pass ? 'PASS' : 'FAIL', ev });
  if (!pass) console.log('FAIL', cas, '->', actual, ev);
}
const LISTS = ['/api/masters/vendors', '/api/masters/companies', '/api/masters/departments', '/api/masters/categories',
  '/api/masters/subcategories', '/api/masters/brands', '/api/masters/cost-centers', '/api/masters/custom-fields',
  '/api/masters/locations', '/api/code-rules', '/api/bundles'];

// ---- AC-1: self-service logins (employee holder + store login, both companies) must be refused every setup list
for (const p of ['SECSELF', 'SECSELFV', 'SPA', 'VPA']) {
  const t = await tok(p);
  for (const path of LISTS) {
    const r = await req('GET', path, { token: t });
    transcript.push(`${p} GET ${path} -> ${r.status} ${r.raw.slice(0, 120)}`);
    rec('CWE-863', `AC-1 self-service ${p} GET ${path}`, '403', `${r.status}`, r.status === 403,
      r.status === 200 ? `rows=${Array.isArray(r.body) ? r.body.length : '?'}` : '');
  }
}
// ---- AC-1 no-regression: staff roles keep their lists
for (const p of ['SECVIEW', 'SECOPIT', 'SECOTHER', 'SECFAIT', 'SECHO']) {
  const t = await tok(p);
  for (const path of LISTS) {
    const r = await req('GET', path, { token: t });
    rec('CWE-863', `AC-1 no-regression staff ${p} GET ${path}`, '200', `${r.status}`, r.status === 200);
  }
}
// ---- AC-1 what a self-service login still legitimately has (own asset, capabilities)
{
  const t = await tok('SECSELF');
  const a = await req('GET', '/api/assets/1', { token: t });
  rec('CWE-863', 'AC-1 self-service SECSELF still reads own asset 1', '200', `${a.status}`, a.status === 200);
  const c = await req('GET', '/api/auth/capabilities', { token: t });
  rec('CWE-863', 'AC-1 self-service SECSELF capabilities', '200', `${c.status}`, c.status === 200);
  const pv = await req('POST', '/api/code-rules/preview', { token: t, body: {} });
  transcript.push(`SECSELF POST /api/code-rules/preview {} -> ${pv.status} ${pv.raw.slice(0, 160)}`);
  rec('CWE-863', 'AC-1 adjacent: self-service SECSELF POST /api/code-rules/preview (not in the fixed list)', 'INFO: record', `${pv.status}`, true, 'INFO');
}

// ---- AC-2: custom fields visible per persona (global + own companies; ADMIN/head office all)
const CF = {
  SECOPIT: [1], SECVIEW: [1], SECOPNIT: [1], SECOTHER: [2], SECVIEWV: [2], SECOPITV: [2], SECOPX: [1, 2],
  SECFAIT: null, SECFABOTH: null, SECHO: null,
};
for (const [p, allowed] of Object.entries(CF)) {
  const t = await tok(p);
  const r = await req('GET', '/api/masters/custom-fields', { token: t });
  const cos = Array.isArray(r.body) ? [...new Set(r.body.map(x => x.company_id))].sort() : [];
  transcript.push(`${p} GET /api/masters/custom-fields -> ${r.status} company_ids=${JSON.stringify(cos)}`);
  const leak = allowed ? cos.filter(c => c !== null && !allowed.includes(c)) : [];
  const complete = allowed ? allowed.every(c => cos.includes(c)) : (cos.includes(1) && cos.includes(2));
  rec('CWE-639', `AC-2 GET /api/masters/custom-fields as ${p} (expected companies ${allowed ? JSON.stringify(allowed) : 'all'})`,
    `200, company_ids subset of ${allowed ? JSON.stringify(allowed) + '+null' : 'all'}`, `${r.status} company_ids=${JSON.stringify(cos)}`,
    r.status === 200 && leak.length === 0 && complete, leak.length ? `LEAK ${leak}` : '');
}
// company_id query parameter cannot widen it
{
  const r = await req('GET', '/api/masters/custom-fields?company_id=2', { token: await tok('SECOPIT') });
  const cos = Array.isArray(r.body) ? [...new Set(r.body.map(x => x.company_id))] : [];
  rec('CWE-639', 'AC-2 SECOPIT GET /api/masters/custom-fields?company_id=2 (parameter tampering)', 'no company 2 rows',
    `${r.status} company_ids=${JSON.stringify(cos)}`, !cos.includes(2));
}

// ---- IF-03: ERP PO draft across companies (local ERP copy is present on this stack)
const notFound = await req('GET', '/api/erp/pos/987654321/draft', { token: await tok('SECOPIT') });
transcript.push(`SECOPIT GET /api/erp/pos/987654321/draft (non-existent) -> ${notFound.status} ${notFound.raw.slice(0, 160)}`);
const DRAFT = [
  ['SECOPIT', 9002002, false], ['SECOPIT', 9002001, false], ['SECOTHER', 9001002, false], ['SECOTHER', 9001001, false],
  ['SECOPITV', 9001002, false], ['SECOPITV', 9001001, false],
  ['SECOPIT', 9001002, true], ['SECOTHER', 9002002, true], ['SECOPITV', 9002002, true],
  ['SECOPX', 9001002, true], ['SECOPX', 9002002, true], ['SECFAIT', 9002002, true], ['SECHO', 9001002, true],
];
for (const [p, code, allow] of DRAFT) {
  const r = await req('GET', `/api/erp/pos/${code}/draft`, { token: await tok(p) });
  transcript.push(`${p} GET /api/erp/pos/${code}/draft -> ${r.status} ${r.raw.slice(0, 200)}`);
  const sameAsMissing = r.status === 404 && r.body?.detail === notFound.body?.detail;
  if (allow) {
    rec('CWE-639', `IF-03 control: ${p} GET own/allowed ERP draft ${code}`, '200 (or a controlled 4xx for an already-created PO)', `${r.status}`, r.status === 200 || r.status === 409 || r.status === 422);
  } else {
    rec('CWE-639', `IF-03 ${p} GET other-company ERP draft ${code}`, '404 identical to a non-existent PO (no rates/supplier)',
      `${r.status} detail=${JSON.stringify(r.body?.detail)}`, sameAsMissing, sameAsMissing ? '' : `LEAK ${r.raw.slice(0, 120)}`);
  }
}
// adjacent ERP routes for another company's PO
for (const [m, path, body] of [
  ['GET', '/api/erp/pos/9002002/receipts'], ['GET', '/api/erp/pos/9002002/pi'],
  ['POST', '/api/erp/pos/create', { erp_po_code: 9002002 }],
]) {
  const r = await req(m, path, { token: await tok('SECOPIT'), body });
  transcript.push(`SECOPIT ${m} ${path} -> ${r.status} ${r.raw.slice(0, 200)}`);
  rec('CWE-639', `IF-03 adjacent: SECOPIT ${m} ${path} (CKVPL PO)`, 'refused 4xx, nothing created, no data', `${r.status}`, r.status >= 400 && r.status < 500);
}
// ERP PO list: no other company
{
  const r = await req('GET', '/api/erp/pos?envelope=true', { token: await tok('SECOPIT') });
  const codes = (r.body?.pos || []).map(x => x.po_code);
  rec('CWE-639', 'IF-03 adjacent: SECOPIT ERP PO list has no CKVPL PO', 'no 9002xxx', `${r.status} codes=${JSON.stringify(codes)}`, !codes.some(c => String(c).startsWith('9002')));
}

writeFileSync(new URL('./ac_fixes.json', import.meta.url), JSON.stringify(results, null, 1));
writeFileSync(new URL('./ac_fixes_transcript.txt', import.meta.url), transcript.join('\n'));
console.log('total', results.length, 'FAIL', results.filter(r => r.result === 'FAIL').length);
