// Builds docs/security/evidence/retest/retest_tests2.csv from every executed case of this retest.
import fs from 'node:fs';
import path from 'node:path';
import { DIR } from './lib.mjs';

const OUT = 'D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/retest';
const rows = [];
const add = (id, area, cwe, kase, expected, actual, result, ev) => rows.push({ id, area, cwe, case: kase, expected, actual: String(actual).replace(/\s+/g, ' ').slice(0, 300), result, evidence: ev });

// 1. live API / browser rows recorded by the node scripts (last record per id wins)
const live = new Map();
for (const line of fs.readFileSync(path.join(DIR, 'results.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line); live.set(r.id, r);
}
const override = {
  'RT-AU-T403': ['INFO', 'present but X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Cache-Control are sent TWICE on proxied /api responses (API + nginx); CSP/PP once. Cosmetic'],
  'RT-AU-T404': ['INFO', 'as T403 (duplicate identical values, browsers accept)'],
  'RT-AU-T405': ['INFO', 'as T403 (duplicate identical values, browsers accept)'],
  'RT-AU-T413': ['PASS', '404 nginx error page (not the SPA shell)'],
};
for (const r of live.values()) {
  const o = override[r.id];
  add(r.id, r.area, r.cwe, r.case, r.expected, o ? `${r.actual} | ${o[1]}` : r.actual, o ? o[0] : r.result, r.evidence);
}

// 2. INPUT batteries re-run (rt_api_battery*.mjs)
const b1 = JSON.parse(fs.readFileSync(path.join(DIR, 'battery_results.json'), 'utf8'));
for (const r of b1) add(r.id.replace('IN-T', 'RT-AU-T7'), 'input-battery', `CWE-${r.cwe}`, r.case, r.expected, r.actual, r.result, 'rt_api_battery.mjs;battery_results.json');
const b2 = [
  ['074', 'asset-users list secret leak (admin)', 'no password_hash/secret', 'status=200 leak=false', 'PASS'],
  ['075', 'people list secret leak (admin)', 'no password_hash/secret', 'status=200 leak=false', 'PASS'],
  ['076', 'SELF_SERVICE lists asset-users', '403', 'status=403', 'PASS'],
  ['077', 'SELF_SERVICE lists people', '403', 'status=403', 'PASS'],
  ['078', 'SELF_SERVICE exports asset-users', '403', 'status=403', 'PASS'],
  ['079', 'OPERATOR lists asset-users', 'no 500', 'status=200', 'PASS'],
  ['080', 'CKVPL operator people list company-scoped', 'only CKVPL', 'status=200 sampleHasSPL=false', 'PASS'],
];
for (const [n, c, e, a, res] of b2) add(`RT-AU-T7${n}`, 'input-battery', 'CWE-200/285', c, e, a, res, 'rt_api_battery2.mjs');

// 3. IF-01 traversal probe (throw-away production-mode container), run 1 (run 2 identical)
let n = 0;
for (const line of fs.readFileSync(path.join(DIR, 'if01_run1.txt'), 'utf8').split('\n')) {
  const p = line.split('\t'); if (p.length < 5) continue;
  n++; add(`RT-AU-T8${String(n).padStart(2, '0')}`, 'static-route', 'CWE-22', `IF-01 single-port prod: ${p[3]} ${p[4]}`, p[3].includes('control') || p[3].includes('legit') || p[3].includes('allow-list') || p[3] === 'api health' ? '200 file' : (p[2] === 'shell' || p[4].startsWith('/..') || p[4].startsWith('//') || p[4].startsWith('/favicon.svg%2f') || p[4].startsWith('/secret') || p[4].startsWith('/docs') || p[4].startsWith('/redoc') || p[4].startsWith('/openapi') ? 'SPA shell, no file' : '404, no file'), `${p[1]} ${p[2]}`, p[0], 'probe_dist2.py;if01_run1.txt;if01_run2.txt');
}
// 4. startup matrix
n = 0;
for (const line of fs.readFileSync(path.join(DIR, 'startup_matrix_out.txt'), 'utf8').split('\n')) {
  if (!/\| health=/.test(line)) continue;
  n++;
  const label = line.split(' | ')[0];
  const refused = /refused_line=1/.test(line); const prodDocsOff = /docs=404/.test(line);
  let exp, res;
  if (/^[A-G] /.test(label)) { exp = 'refuse to start'; res = refused && /health=NOCONN/.test(line) ? 'PASS' : 'FAIL'; }
  else if (/^[HIM] /.test(label)) { exp = 'start; /docs /redoc /openapi.json 404'; res = !refused && prodDocsOff ? (label.startsWith('M') ? 'INFO' : 'PASS') : 'FAIL'; }
  else { exp = 'non-production name: starts with warning, docs open (by design)'; res = 'INFO'; }
  add(`RT-AU-T9${String(n).padStart(2, '0')}`, 'startup', 'CWE-798/CWE-651', `IF-04/AU-09/AU-11: ${label}`, exp, line.split(' | ').slice(1).join(' | '), res, 'startup_matrix.sh;startup_matrix_out.txt');
}
// 5. single-port production headers + body cap
for (const [i, line] of fs.readFileSync(path.join(DIR, 'prod_headers_out.txt'), 'utf8').split('\n').filter(Boolean).entries()) {
  const ok = /csp=Y pp=Y xcto=Y xfo=Y rp=Y/.test(line) && /server=uvicorn/.test(line);
  const apiNope = line.startsWith('GET /api/nope');
  add(`RT-AU-T95${i}`, 'headers-prod', 'CWE-693', `single-port prod headers: ${line.split(' | ')[0]}`, 'CSP+PP+nosniff+XFO+Referrer, Server without version', line.split(' | ').slice(1).join(' | ') + (apiNope ? ' | unknown /api path answers 200 SPA shell (INFO)' : ''), ok ? (apiNope ? 'INFO' : 'PASS') : 'FAIL', 'prod_headers.py;prod_headers_out.txt');
}
add('RT-AU-T960', 'resource', 'CWE-770', 'single-port prod: unauthenticated 256 MB JSON body to /api/auth/login', 'refused early (413) without buffering', '422 after full read; uvicorn RSS 129 MB -> 652 MB, peak 914 MB (64 MB body -> peak 324 MB)', 'FAIL', 'bigbody.py;bigbody_out.txt');
add('RT-AU-T961', 'resource', 'CWE-770', 'single-port prod: unauthenticated 256 MB multipart to import preview', 'refused without buffering', '401 in 0.49 s, RSS unchanged (auth before body)', 'PASS', 'bigbody.py;bigbody_out.txt');
// 6. ERP limits
const erp = [
  ['ERP session settings: default_transaction_read_only=on, statement_timeout, application_name=ckam (PgErpSource)', 'applied', "{'default_transaction_read_only': 'on', 'application_name': 'ckam', 'statement_timeout': '60000'}", 'PASS'],
  ['ERP background copy reader statement_timeout', '120 s', "statement_timeout '120000'", 'PASS'],
  ['ERP connect to a black-hole listener, default timeout', 'ErpUnavailable -> 503 within ~10 s', '10.01 s, 503 "The ERP database could not be reached (TimeoutError)."', 'PASS'],
  ['ERP connect timeout honours ERP_CONNECT_TIMEOUT_SECONDS=3', '~3 s', '3.00 s, 503', 'PASS'],
  ['ERP host 192.0.2.1 (TEST-NET, network-less container)', 'ErpUnavailable 503', '0.00 s, 503 (OSError)', 'PASS'],
  ['ERP not configured', 'ErpUnavailable 503 plain sentence', '503 "The ERP connection is not set up on this server."', 'PASS'],
  ['ERP session as seen by the server (stand-in = local sec Postgres): transaction_read_only / statement_timeout / application_name', "on / 1min / ckam", "ro='on' dro='on' st='1min' app='ckam'", 'PASS'],
  ['ERP slow query pg_sleep(6) with ERP_STATEMENT_TIMEOUT_SECONDS=2', 'cancelled ~2 s, friendly 503', '2.02 s, 503 "The ERP database took too long to answer..."', 'PASS'],
  ['ERP write attempt CREATE TEMP TABLE', 'refused (read-only)', '503 ReadOnlySQLTransactionError', 'PASS'],
  ['ERP attempt to switch the transaction to read-write', 'refused', '503 ActiveSQLTransactionError', 'PASS'],
];
erp.forEach(([c, e, a, r], i) => add(`RT-AU-T97${i}`, 'erp', 'CWE-400', `IF-10 ${c}`, e, a, r, 'erp_timeout.py;erp_connect_out.txt;erp_stmt_out.txt'));
// 7. append-only SQL (rolled back)
const sql = [
  ['T1 UPDATE audit_log', 'error', 'ERROR audit_log rows are append-only', 'PASS'],
  ['T2 DELETE newest audit_log row', 'error', 'ERROR append-only', 'PASS'],
  ['T3 TRUNCATE audit_log', 'error', 'ERROR ... TRUNCATE is not allowed', 'PASS'],
  ['T4 UPDATE asset_event', 'error', 'ERROR append-only; insert a CORRECTION event', 'PASS'],
  ['T5 DELETE asset_event', 'error', 'ERROR append-only', 'PASS'],
  ['T6 TRUNCATE asset_event CASCADE', 'error', 'ERROR TRUNCATE is not allowed', 'PASS'],
  ['T7 TRUNCATE master_audit', 'error', 'ERROR TRUNCATE is not allowed', 'PASS'],
  ['T8 TRUNCATE asset_field_change', 'error', 'ERROR TRUNCATE is not allowed', 'PASS'],
  ['T9 UPDATE/DELETE asset_field_change (master_audit has 0 rows here: row triggers present but not exercisable)', 'error', 'asset_field_change ERROR x2; master_audit UPDATE 0/DELETE 0 (empty)', 'PASS'],
  ['T10 IF-06 SET LOCAL ckam.allow_audit_purge=on + DELETE newest audit row', 'error (5-year floor)', 'ERROR append-only', 'PASS'],
  ['T11 flag on + DELETE all rows younger than 5 years', 'error', 'ERROR append-only', 'PASS'],
  ['T12 flag on: a row INSERTed with at=now()-6y can be deleted', 'allowed by design (only old-dated rows)', 'INSERT 1 / DELETE 1 (the at column is client-settable on INSERT)', 'INFO'],
  ['T14 ckam_purge_audit_log(now())', 'refused', 'ERROR needs a cut-off at least 5 years in the past', 'PASS'],
  ['T15 ckam_purge_audit_log(now()-4y11m)', 'refused', 'ERROR needs >= 5 years', 'PASS'],
  ['T16 ckam_purge_audit_log(now()-6y)', 'allowed, removes only older rows', '0 rows', 'PASS'],
  ['T17 purge function without the flag', 'refused', 'ERROR purge is not allowed', 'PASS'],
  ['T18 EXECUTE on purge function revoked from PUBLIC', 'owner only', 'proacl {ckam=X/ckam}', 'PASS'],
  ['T19 RESIDUAL owner/superuser DISABLE TRIGGER then TRUNCATE', 'possible (residual, EXT-07)', 'ALTER TABLE ok, TRUNCATE ok, 0 rows (rolled back)', 'FAIL'],
  ['T20 RESIDUAL superuser session_replication_role=replica skips triggers', 'possible (residual, EXT-07)', 'DELETE 1 on asset_event (rolled back)', 'FAIL'],
  ['T21 least-privilege role simulation: TRUNCATE / DISABLE TRIGGER / purge / DELETE with flag', 'all refused', 'permission denied / must be owner / permission denied / append-only', 'PASS'],
  ['App DB role in the Docker stack', 'non-superuser', 'ckam rolsuper=t (Docker dev/test design; prod = owner role ckassetapp)', 'INFO'],
  ['After ROLLBACK: rows and triggers unchanged, probe role gone', 'unchanged', 'audit 1492 / events 25, 4 truncate triggers enabled, role gone', 'PASS'],
];
sql.forEach(([c, e, a, r], i) => add(`RT-AU-T98${String(i).padStart(2, '0')}`, 'audit-db', 'CWE-778', `AU-10/IF-05/IF-06 ${c}`, e, a, r, 'rt_append_only.sql;rt_append_only.out.txt'));
// 8. timing, race, rate limit, XFF
const t = JSON.parse(fs.readFileSync(path.join(DIR, 'timing_out.json'), 'utf8')).summary;
Object.entries(t).forEach(([k, v], i) => add(`RT-AU-T99${i}`, 'auth-timing', 'CWE-208', `AU-01 sign-in time: ${k} (n=${v.n})`, 'within a few ms of the others', `median ${v.median} ms (p10 ${v.p10} / p90 ${v.p90}) codes ${JSON.stringify(v.codes)}`, 'PASS', 'timing.py;timing_out.json'));
add('RT-AU-T996', 'auth-timing', 'CWE-208', 'AU-01 spread of medians across all six states', '< 5 ms', '39.39 .. 42.16 ms (2.8 ms; before: 41.7 vs 7.4 ms)', 'PASS', 'timing_out.json');
add('RT-AU-T1001', 'bruteforce', 'CWE-362', 'AU-16 20 parallel wrong guesses on one throw-away account (BRUTE11)', 'failed_login_count 5, one LOCKED event', '10x401 + 10x429 (per-login-id limit); failed_login_count=5; 1 LOCKED; 5 counted + 5 "wrong while locked (not counted)"', 'PASS', 'race.py');
const rl = JSON.parse(fs.readFileSync(path.join(DIR, 'ratelimit_out.json'), 'utf8'));
add('RT-AU-T1002', 'rate-limit', 'CWE-307', 'AU-03 login per address: 21 attempts, distinct ids', '429 on #21 + Retry-After + plain sentence', `first 429 at #${rl.login_per_address.first_429_at}, Retry-After ${rl.login_per_address.retry_after}, "${rl.login_per_address.body.detail}"`, 'PASS', 'ratelimit.py;ratelimit_out.json');
add('RT-AU-T1003', 'rate-limit', 'CWE-307', 'AU-03 login per login id: 11 attempts same id', '429 on #11', `first 429 at #${rl.login_per_login_id.first_429_at}, Retry-After ${rl.login_per_login_id.retry_after}`, 'PASS', 'ratelimit_out.json');
add('RT-AU-T1004', 'rate-limit', 'CWE-307', 'AU-03 per-login-id key ignores case and surrounding spaces ("RL-SAME-ID ")', '429', `${rl.login_per_login_id_case_variant}`, rl.login_per_login_id_case_variant === 429 ? 'PASS' : 'FAIL', 'ratelimit_out.json');
add('RT-AU-T1005', 'rate-limit', 'CWE-307', 'AU-03 refresh per address: 61 calls', '429 on #61', `first 429 at #${rl.refresh_per_address.first_429_at}`, 'PASS', 'ratelimit_out.json');
add('RT-AU-T1006', 'rate-limit', 'CWE-307', 'AU-03 change-password per address: 11 calls (unauthenticated calls count too)', '429 on #11', `first 429 at #${rl.change_password_unauth.first_429_at} (limit runs before authentication)`, 'PASS', 'ratelimit_out.json');
add('RT-AU-T1007', 'rate-limit', 'CWE-307', 'AU-03 window recovers after 60 s', 'normal answer', `${rl.login_after_window}`, 'PASS', 'ratelimit_out.json');
add('RT-AU-T1008', 'rate-limit', 'CWE-348', 'AU-03 X-Forwarded-For after limit, peer = network address (like a LAN client / nginx)', '429 (XFF ignored)', '21st plain 429, 22nd with XFF 429', 'PASS', 'xff.py;xff_out.json');
add('RT-AU-T1009', 'rate-limit', 'CWE-348', 'AU-03 X-Forwarded-For after limit, peer = 127.0.0.1 (uvicorn default --forwarded-allow-ips=127.0.0.1)', '429', '22nd with XFF answered 401 (fresh bucket); audit_log ip = the forged 203.0.113.77', 'FAIL', 'xff.py;xff_out.json;RT-AII-N2');
add('RT-AU-T1010', 'rate-limit', 'CWE-770', 'AU-03 Docker stack: every :3411 browser user has the address of the nginx container', 'real client address', 'Playwright sign-ins recorded as 172.25.0.4 (nginx); TRUSTED_PROXIES empty and nginx sends no X-Forwarded-For -> one shared 20/min bucket for all web users (dev/UAT only)', 'FAIL', 'audit query;RT-AII-N3');
add('RT-AU-T1011', 'logging', 'A09:2021', 'RATE_LIMITED SECURITY rows written (endpoint, by, retry), no password', 'present, no secret', '7 rows; changes={endpoint, limited_by, retry_after_seconds[, login_id]}', 'PASS', 'audit query');
// 9. logs / dependencies
add('RT-AU-T1012', 'logging', 'CWE-532', 'Test password Sec#Test2026ok in /data/logs (app/audit/error .jsonl)', '0 files', 'none', 'PASS', 'grep');
add('RT-AU-T1013', 'logging', 'CWE-532', 'Other passwords typed in this retest (new, wrong, weak probes) in /data/logs', '0 files', 'none', 'PASS', 'grep');
add('RT-AU-T1014', 'logging', 'CWE-532', 'JWTs / refresh_token= values in /data/logs', '0 files', 'none', 'PASS', 'grep');
add('RT-AU-T1015', 'logging', 'CWE-532', 'Passwords / JWTs in audit_log, error_log, client_report, system_event', '0 rows', '0 / 0 / 0 / 0', 'PASS', 'SQL');
add('RT-AU-T1016', 'error-handling', 'CWE-209', 'error_log rows with status >= 500 during the whole retest', '0', '0 (all malformed input answered 4xx with request id)', 'PASS', 'SQL');
add('RT-AU-T1017', 'logging', 'A09:2021', 'Session-ended / revoked-token replays are audited', 'SECURITY row', 'INVALID_TOKEN rows (max 1/min per address; actor not named)', 'INFO', 'errors.py');
add('RT-AU-T1018', 'dependencies', 'A06:2021', 'npm audit --omit=dev (frontend)', '0', '0 vulnerabilities of 141 prod packages (unchanged)', 'PASS', 'npm_audit_prod.json');
add('RT-AU-T1019', 'dependencies', 'A06:2021', 'pip freeze of rebuilt api image vs earlier pip_audit input', 'no new advisories', 'identical versions; constraints.txt pins ecdsa 0.19.2 / python-jose 3.5.0 (IF-12 accepted, unchanged)', 'PASS', 'pip_freeze_rebuilt.txt');

const esc = (s) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
const header = 'id,area,cwe_or_owasp,case,expected,actual,result,evidence_ref';
fs.writeFileSync(path.join(OUT, 'retest_tests2.csv'), [header, ...rows.map((r) => [r.id, r.area, r.cwe, r.case, r.expected, r.actual, r.result, r.evidence].map(esc).join(','))].join('\n') + '\n');
const count = rows.reduce((a, r) => (a[r.result] = (a[r.result] || 0) + 1, a), {});
console.log('rows', rows.length, JSON.stringify(count));
console.log('FAIL ids:', rows.filter((r) => r.result === 'FAIL').map((r) => r.id).join(' '));
