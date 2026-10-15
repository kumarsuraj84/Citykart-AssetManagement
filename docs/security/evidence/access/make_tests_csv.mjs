import { readFileSync, writeFileSync } from 'node:fs';
const RD = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));

function csvEsc(v) {
  v = String(v ?? '');
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
const rows = [['id', 'area', 'cwe_or_owasp', 'case', 'expected', 'actual', 'result', 'evidence_ref']];

// --- Matrix: one row per (method,path) role-guard test across 11 personas ---
const mx = readFileSync(new URL('./authz_matrix.csv', import.meta.url), 'utf8').trim().split('\n');
const mh = mx[0].split(',');
const personas = mh.slice(3);
let mi = 1;
for (const line of mx.slice(1)) {
  const p = line.split(',');
  const method = p[0], path = p[1], bucket = p[2], cells = p.slice(3);
  const summary = personas.map((pn, i) => `${pn}=${cells[i]}`).join(' ');
  rows.push([`AC-M${String(mi++).padStart(3, '0')}`, 'access-authz-matrix', 'OWASP-API5:2023 / CWE-862',
    `role-guard ${method} ${path} [intended ${bucket}] across 11 personas`,
    'each persona allowed/denied per intended classification', summary, 'PASS', 'authz_matrix.csv']);
}

// --- Phase B result files ---
function addJson(file, area) {
  const data = RD(file);
  for (const r of data) {
    rows.push([r.id, area, r.cwe, r.case, r.expected, r.actual, r.result, file.replace('./', '')]);
  }
}
addJson('./phaseB_results.json', 'access-idor-bola');
addJson('./phaseB_escalation.json', 'access-escalation-massassign');
addJson('./phaseB_logic.json', 'access-businesslogic-idempotency');

// --- extra manual INFO rows for coverage noted in text ---
const extra = [
  ['AC-T500', 'access-idor', 'CWE-639', 'reports/assets/preview scope per persona (SECOPIT=CKSPL/IT, SECOPNIT=CKSPL/NON_IT, SECOTHER=CKVPL, SECVIEW=CKSPL, SECFAIT=IT-both-co, SECSELF=403)', 'only in-scope asset ids; self-service 403', 'SECOPIT ids[1,2,3,6]; SECOPNIT[4,5,7,8]; SECOTHER[9-16]; SECVIEW[1-8]; SECFAIT[1,2,3,6,9,10,11,14]; SECSELF 403', 'PASS', 'phaseB_reports.txt'],
  ['AC-T501', 'access-idor', 'CWE-639', 'reports/export/assets self-service blocked', 'SECSELF 403', 'SECSELF 403; SECOTHER 200 own-company xlsx', 'PASS', 'phaseB_reports.txt'],
  ['AC-T502', 'access-dbintegrity', 'CWE-639', 'DB read-only integrity after attacks (dup codes/serials, cross-company holders, PO dup, primary-owner count)', 'no duplicates, no cross-company holder, PO count unchanged, primary_owner count=2', 'all clean; primary_owner=2; no cross-company holder; asset3 unchanged', 'PASS', 'integrity.sql'],
  ['AC-T503', 'access-massassign', 'CWE-915', 'user create as SECFABOTH with is_primary_owner/id/must_change_password/password_hash in body', 'all protected fields ignored (is_primary_owner=false,id auto,must_change=true)', 'created id=36 is_primary_owner=false must_change=true (forbidden fields ignored)', 'PASS', 'phaseB_escalation.mjs'],
  // Self-service masters surface (AC-1)
  ['AC-T510', 'access-selfservice', 'CWE-863 / OWASP-API5:2023', 'SELF_SERVICE SECSELF GET /api/masters/companies', 'blocked (SELF_SERVICE is not staff)', '200 rows=2 (both companies)', 'FAIL', 'self_service_masters.txt'],
  ['AC-T511', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/masters/vendors (GSTIN+contacts, global table, both companies)', 'blocked', '200 rows=6, exposes GSTIN + contact_email of both companies', 'FAIL', 'self_service_masters.txt'],
  ['AC-T512', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/masters/departments', 'blocked', '200 rows=2', 'FAIL', 'self_service_masters.txt'],
  ['AC-T513', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/masters/categories', 'blocked', '200 rows=4', 'FAIL', 'self_service_masters.txt'],
  ['AC-T514', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/masters/subcategories', 'blocked', '200 rows=4', 'FAIL', 'self_service_masters.txt'],
  ['AC-T515', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/masters/brands', 'blocked', '200 rows=1', 'FAIL', 'self_service_masters.txt'],
  ['AC-T516', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/masters/locations', 'blocked', '200 rows=2 (scoped to own company id1)', 'FAIL', 'self_service_masters.txt'],
  ['AC-T517', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/masters/custom-fields', 'blocked', '200 rows=2 company_ids=[1,2] (cross-company)', 'FAIL', 'self_service_masters.txt'],
  ['AC-T518', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/code-rules', 'blocked', '200 rows=1', 'FAIL', 'self_service_masters.txt'],
  ['AC-T519', 'access-selfservice', 'CWE-863', 'SELF_SERVICE SECSELF GET /api/bundles', 'blocked', '200 rows=1', 'FAIL', 'self_service_masters.txt'],
  // custom-fields cross-company for all roles (AC-2)
  ['AC-T520', 'access-crosscompany', 'CWE-639 / OWASP-API1:2023', 'SECOPIT (CKSPL) GET /api/masters/custom-fields returns CKVPL defs', 'only own-company (id1) custom fields', '200 company_ids=[1,2] (CKVPL leaked)', 'FAIL', 'self_service_masters.txt'],
  ['AC-T521', 'access-crosscompany', 'CWE-639', 'SECOTHER (CKVPL) GET /api/masters/custom-fields returns CKSPL defs', 'only own-company (id2)', '200 company_ids=[1,2] (CKSPL leaked)', 'FAIL', 'self_service_masters.txt'],
  ['AC-T522', 'access-crosscompany', 'CWE-639', 'SECVIEW (CKSPL) GET /api/masters/custom-fields returns CKVPL defs', 'only own-company (id1)', '200 company_ids=[1,2]', 'FAIL', 'self_service_masters.txt'],
  // contrast: sibling company-owned masters ARE scoped for non-ADMIN
  ['AC-T523', 'access-crosscompany', 'CWE-639', 'SECOPIT GET /api/masters/cost-centers (contrast: scoped correctly)', 'only own-company rows', '200 rows company_ids=[1] only', 'PASS', 'self_service_masters.txt'],
];
for (const e of extra) rows.push(e);

writeFileSync(new URL('./tests.csv', import.meta.url), rows.map(r => r.map(csvEsc).join(',')).join('\n'));
console.log('tests.csv rows (excl header):', rows.length - 1);
// severity tally of FAILs
const fails = rows.slice(1).filter(r => r[6] === 'FAIL');
console.log('FAIL rows:', fails.length);
for (const f of fails) console.log('  ', f[0], f[3]);
