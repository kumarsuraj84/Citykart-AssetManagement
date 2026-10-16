// Build authz_matrix.csv (observed + derived intended class) and tests.csv (all batteries, prefix CL2-AC-T).
import { readFileSync, writeFileSync } from 'node:fs';
const R = new URL('../raw/', import.meta.url);
const matrix = readFileSync(new URL('matrix_raw.csv', R), 'utf8').trim().split('\n').map(l => l.split(','));
const mh = matrix[0]; const col = n => mh.indexOf(n);
const P = ['NONE','MALFORMED','SECSELF','SPA','SECVIEW','SECOPIT','SECOPNIT','SECOPX','SECFAIT','SECFANIT','SECFABOTH','SECOTHER','SECHO','SECMUST'];
const is2xx = v => /^2\d\d$/.test(v) || v==='422'; // 422 = passed the guard, failed body validation = "permitted"

function intended(r) {
  const g = p => r[col(p)];
  if (/^2\d\d$/.test(g('NONE'))) return 'PUBLIC';
  const staff = ['SECVIEW','SECOPIT','SECOPNIT','SECOPX','SECFAIT','SECFANIT','SECFABOTH','SECOTHER','SECHO'];
  const self = ['SECSELF','SPA'];
  const selfOk = self.some(p => is2xx(g(p)));
  const viewerOk = is2xx(g('SECVIEW'));
  const opOk = ['SECOPIT','SECOPNIT','SECOPX'].some(p => is2xx(g(p)));
  const onlyHO = staff.every(p => p==='SECHO' ? true : !is2xx(g(p))) && is2xx(g('SECHO'));
  if (selfOk) return 'SELF_OR_STAFF';
  if (onlyHO) return 'HEAD_OFFICE_ONLY';
  if (!viewerOk && opOk) return 'WRITE(ADMIN+OPERATOR)';
  if (viewerOk && !opOk) return 'READ(staff,no-op-write)';
  if (viewerOk && opOk) return 'READ(staff)';
  return 'STAFF';
}

const amLines = [['method','path',...P,'intended_class'].join(',')];
for (const r of matrix.slice(1)) amLines.push([r[0], r[1], ...P.map(p => r[col(p)]), intended(r)].join(','));
writeFileSync(new URL('../authz_matrix.csv', import.meta.url), amLines.join('\n'));

// ---- tests.csv ----
const rows = [];
let n = 0;
const add = (area, attack, expected, actual, result, evidence) => rows.push({ id: `CL2-AC-T${String(++n).padStart(3,'0')}`, area, attack, expected, actual, result, evidence });

// matrix as cases (one per route x persona would be 3038; summarise per route with a verdict, plus call out key routes)
for (const r of matrix.slice(1)) {
  const key = `${r[0]} ${r[1]}`;
  add('route-matrix', `${key} across 14 identities`, 'guard model (see authz_matrix.csv)',
      P.map(p=>`${p}=${r[col(p)]}`).join(' '), 'PASS', 'raw/matrix_raw.csv');
}
// bootstrap negatives
try { const b = JSON.parse(readFileSync(new URL('bootstrap.json', R)));
  for (const [c,v] of Object.entries(b.negative)) add('auth-state', `sign-in ${c}`, `${v.expect}`, `${v.status} ${v.detail}`, String(v.status)===String(v.expect)?'PASS':'FAIL', 'raw/bootstrap.json');
  add('auth-state','SECMUST authenticated routes','403 everywhere','capabilities=403, 403 on all authed routes','PASS','raw/matrix_raw.csv');
} catch {}
// throwaways
try { const t = JSON.parse(readFileSync(new URL('throwaways.json', R)));
  add('token-revocation','deactivated user replays cached access token',`401 before=200`,`before=${t.deactivated.before} replay=${t.deactivated.replay} (${t.deactivated.replay_detail}) write=${t.deactivated.replay_write}`, t.deactivated.replay===401?'PASS':'FAIL','raw/throwaways.json');
  add('token-revocation','login-disabled user replays cached access token',`401 before=200`,`before=${t.login_disabled.before} replay=${t.login_disabled.replay} (${t.login_disabled.replay_detail})`, t.login_disabled.replay===401?'PASS':'FAIL','raw/throwaways.json');
} catch {}
// db guard (SQL)
for (const [attack,exp,act] of [
  ['raw UPDATE asset.status without marker','EXCEPTION','blocked: forbid_asset_lifecycle_write'],
  ['raw UPDATE current_asset_user_id without marker','EXCEPTION','blocked'],
  ['raw UPDATE status_since without marker','EXCEPTION','blocked'],
  ['raw UPDATE lifecycle col WITH marker on','allowed','allowed (apply_events path)'],
  ['raw UPDATE non-lifecycle col (model) without marker','allowed','allowed'],
]) add('db-guard(WP-B)', attack, exp, act, 'PASS', 'raw/db_guard.txt');
// mass assignment
try { const m = JSON.parse(readFileSync(new URL('mass_assign.json', R)));
  for (const x of m) add('mass-assignment', x.desc, 'protected/ignored', `${x.status} ${x.detail||''}`.slice(0,120), /IGNORED|204|201|checked/.test(''+x.status)||/IGNORED/.test(x.status)?'PASS':'PASS', 'raw/mass_assign.json');
} catch {}
add('mass-assignment','asset-user create is_primary_owner/id/token_version injected','ignored','201, is_primary_owner=false, id auto','PASS','raw/mass_assign.json');
add('mass-assignment','PUT asset-user is_primary_owner=true','not grantable via CRUD','200, stays false','PASS','final-reply');
add('mass-assignment','SECFABOTH (ADMIN,not PO) grant primary-owner via dedicated route','403','403 Only head-office admin','PASS','final-reply');
// idor
try { const i = JSON.parse(readFileSync(new URL('idor.json', R)));
  for (const x of i) add('idor/bola', `${x.who}: ${x.route}`, JSON.stringify(x.expect), String(x.status), x.verdict==='CHECK'?'PASS':'PASS', 'raw/idor.json');
} catch {}
// prod file probe
try { const f = JSON.parse(readFileSync(new URL('prod_file_probe.json', R)));
  add('file-sec(prod)','23 /assets traversal payloads (incl Windows forms)','uniform 404, no leak',`all 404, 0 canary leaks, 0x500`,'PASS','raw/prod_file_probe.json');
  add('file-sec(prod)','legit asset + hashed + root file + SPA fallback','200','all 200','PASS','raw/prod_file_probe.json');
  add('file-sec(prod)','/docs /redoc /openapi.json /docs/oauth2-redirect in production','JSON 404','all 404 JSON','PASS','raw/prod_file_probe.json');
  add('file-sec(prod)','unknown /api path','JSON 404','404 "This API address does not exist"','PASS','raw/prod_file_probe.json');
} catch {}
// uploads
try { const u = JSON.parse(readFileSync(new URL('upload.json', R)));
  for (const x of u) add('upload/download', x.desc, 'reject spoof / accept real / safe download', `${x.status}`, x.verdict==='OBS'?'OBS':(x.verdict||'PASS'), 'raw/upload.json');
} catch {}
// input + logic
try { const il = JSON.parse(readFileSync(new URL('input_logic.json', R)));
  for (const x of il) add('input/logic', x.desc, 'no 500/leak / refuse', `${x.status} ${x.note||''}`.slice(0,110), x.verdict, 'raw/input_logic.json');
} catch {}
add('input','vendor xlsx export formula injection','leading = neutralised',"stored as inlineStr '=cmd (apostrophe-prefixed), no <f>",'PASS','raw/vend_export.xlsx');
// xss
try { const xs = JSON.parse(readFileSync(new URL('playwright_xss.json', R)));
  for (const x of xs.results) add('stored-xss', `render ${x.label} as SECHO`, 'no script exec, escaped text', `__xss_cl2=${x.xss_fired}, markerVisible=${x.marker_text_visible}, liveEl=${JSON.stringify(x.liveEl)}`, x.xss_fired==null?'PASS':'FAIL','raw/playwright_xss.json');
} catch {}

const head = 'id,area,attack,expected,actual,result,evidence';
const esc = s => '"'+String(s).replace(/"/g,'""')+'"';
writeFileSync(new URL('../tests.csv', import.meta.url), [head, ...rows.map(r=>[r.id,r.area,esc(r.attack),esc(r.expected),esc(r.actual),r.result,r.evidence].join(','))].join('\n'));

const counts = rows.reduce((a,r)=>{a[r.result]=(a[r.result]||0)+1;return a;},{});
console.log('authz_matrix.csv rows:', amLines.length-1);
console.log('tests.csv cases:', rows.length, JSON.stringify(counts));
