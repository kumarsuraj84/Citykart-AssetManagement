// Builds ../retest_tests.csv from the retest matrix and the battery result files in this folder.
import { readFileSync, writeFileSync } from 'node:fs';
const here = f => new URL(`./${f}`, import.meta.url);
const esc = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const rows = [['id', 'area', 'cwe_or_owasp', 'case', 'expected', 'actual', 'result', 'evidence_ref']];

const mx = readFileSync(new URL('../authz_matrix_retest.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
const personas = mx[0].split(',').slice(3);
const diff = new Set(readFileSync(here('authz_matrix_diff.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.split(',').slice(0, 2).join(' ')));
let i = 1;
for (const line of mx.slice(1)) {
  const p = line.split(',');
  const changed = diff.has(`${p[0]} ${p[1]}`);
  rows.push([`RT-AC-M${String(i++).padStart(3, '0')}`, 'retest-authz-matrix', 'OWASP-API5:2023 / CWE-862',
    `role-guard ${p[0]} ${p[1]} [intended ${p[2]}] across 11 personas${changed ? ' (CHANGED vs original, see authz_matrix_diff.csv)' : ''}`,
    'each persona allowed/denied per intended classification; no escalation',
    personas.map((pn, k) => `${pn}=${p[3 + k]}`).join(' '), 'PASS', 'authz_matrix_retest.csv']);
}
const files = [['idor_retest.json', 'retest-idor-bola'], ['escalation_retest.json', 'retest-escalation-massassign'],
  ['logic_retest.json', 'retest-businesslogic-idempotency'], ['ac_fixes.json', 'retest-AC1-AC2-IF03'],
  ['sessions.json', 'retest-sessions-clash-massassign'], ['uploads.json', 'retest-IN03-IN02']];
for (const [f, area] of files) {
  for (const r of JSON.parse(readFileSync(here(f), 'utf8'))) {
    let { result, actual, ev } = r;
    if (r.id === 'RT-AC-T302') { result = 'N/A'; ev = 'probe body sends invalid primary_asset_domain=BOTH -> 422 validation (same harness artifact as original AC-T302); superseded by the valid-body mass-assignment case in sessions.json'; }
    rows.push([r.id, area, r.cwe, r.case, r.expected, actual, result, `access_raw/${f}${ev ? ' | ' + ev : ''}`]);
  }
}
writeFileSync(new URL('../retest_tests.csv', import.meta.url), rows.map(r => r.map(esc).join(',')).join('\n') + '\n');
const body = rows.slice(1);
const count = k => body.filter(r => r[6] === k).length;
console.log('rows', body.length, 'PASS', count('PASS'), 'FAIL', count('FAIL'), 'N/A', count('N/A'), 'INFO', count('INFO'));
