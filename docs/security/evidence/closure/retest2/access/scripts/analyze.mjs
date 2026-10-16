// RETEST2 ACCESS matrix analysis:
//  (1) escalation scan - a lower-privilege identity must never get 2xx on a route a denied higher one got 403/404;
//  (2) SELF_SERVICE (SECSELF/SPA) and VIEWER (SECVIEW) and must-change (SECMUST) negative expectations;
//  (3) diff every common cell against the previous retest matrix and explain each change.
import { readFileSync, writeFileSync } from 'node:fs';

const mine = readFileSync(new URL('../raw/matrix_raw.csv', import.meta.url), 'utf8').trim().split('\n').map(l => l.split(','));
const mh = mine[0]; const mrows = mine.slice(1);
const col = name => mh.indexOf(name);
const P = ['NONE','MALFORMED','SECSELF','SPA','SECVIEW','SECOPIT','SECOPNIT','SECOPX','SECFAIT','SECFANIT','SECFABOTH','SECOTHER','SECHO','SECMUST'];

const is2xx = v => /^2\d\d$/.test(v);
const isDenied = v => v==='401' || v==='403' || v==='404';

const findings = [];

// (1) Role-tier escalation: SELF_SERVICE < VIEWER < OPERATOR < ADMIN(SECHO). On a given route, a strictly
// lower tier getting 2xx while the compared higher tier is denied is an escalation. We compare same-company
// CKSPL identities to avoid company-scope noise.
const tier = { SECSELF:0, SPA:0, SECVIEW:1, SECOPIT:2, SECOPNIT:2, SECOPX:2, SECFAIT:3, SECFANIT:3, SECFABOTH:3, SECHO:4 };
const ladder = ['SECSELF','SPA','SECVIEW','SECOPIT','SECOPNIT','SECFABOTH','SECHO'];
for (const r of mrows) {
  const [method, path] = r;
  const g = p => r[col(p)];
  for (let i=0;i<ladder.length;i++) for (let j=i+1;j<ladder.length;j++){
    const lo=ladder[i], hi=ladder[j];
    if (tier[lo] < tier[hi] && is2xx(g(lo)) && isDenied(g(hi))) {
      // ignore self-service reading its OWN asset (asset 1 held by SECSELF): that is legitimate, higher staff
      // see it too, so hi would also be 2xx. A real escalation is lo=2xx & hi=denied.
      findings.push({ kind:'ESCALATION', method, path, lo, loStatus:g(lo), hi, hiStatus:g(hi) });
    }
  }
}

// (2) SECMUST must be denied (403) on every authenticated route. Public routes (no auth dep) are the exception.
const PUBLIC = new Set(['GET /api/auth/companies','POST /api/auth/login','POST /api/auth/refresh','POST /api/auth/logout']);
const mustViolations = [];
for (const r of mrows) {
  const key = `${r[0]} ${r[1]}`; const v = r[col('SECMUST')];
  if (v==='skip') continue;
  if (PUBLIC.has(key)) continue;
  // 403 expected; 401 acceptable only if NONE is also 401 (unauthenticated route). Anything 2xx is a violation.
  if (is2xx(v)) mustViolations.push({ method:r[0], path:r[1], status:v });
  else if (v!=='403') { // note non-403 denies for review (e.g. 401/404/422 ordering)
    mustViolations.push({ method:r[0], path:r[1], status:v, note:'non-403 deny' });
  }
}

// (3) SELF_SERVICE must not read staff master lists (AC-1). Spot the master/list GETs.
const selfServiceLeaks = [];
for (const r of mrows) {
  if (r[0] !== 'GET') continue;
  const path = r[1];
  const staffOnly = /^\/api\/(masters|code-rules|bundles|items|purchase-orders|reports|admin|erp|asset-users)\b/.test(path)
    && !/\{/.test(path); // list endpoints
  for (const who of ['SECSELF','SPA']) {
    if (staffOnly && is2xx(r[col(who)])) selfServiceLeaks.push({ who, path, status:r[col(who)] });
  }
}

// ---- diff vs previous retest matrix ----
let diff = [];
try {
  const prev = readFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/retest/authz_matrix_retest.csv','utf8').trim().split('\n').map(l=>l.split(','));
  const ph = prev[0];
  const pidx = {}; prev.slice(1).forEach(r => pidx[`${r[0]} ${r[1]}`] = r);
  const common = ['no_token','malformed_token','SECSELF','SECVIEW','SECOPIT','SECOPNIT','SECFAIT','SECFANIT','SECFABOTH','SECOTHER','SECHO'];
  const mineMap = { no_token:'NONE', malformed_token:'MALFORMED' };
  for (const r of mrows) {
    const key = `${r[0]} ${r[1]}`; const pr = pidx[key];
    if (!pr) { diff.push({ key, note:'route not in previous matrix (NEW)' }); continue; }
    for (const c of common) {
      const mineCol = mineMap[c] || c;
      const nv = r[col(mineCol)]; const ov = pr[ph.indexOf(c)];
      if (nv==='skip') continue;
      if (String(nv) !== String(ov)) diff.push({ key, persona:c, old:ov, new:nv });
    }
  }
  // routes in previous not in mine
  const mineKeys = new Set(mrows.map(r=>`${r[0]} ${r[1]}`));
  for (const k in pidx) if (!mineKeys.has(k)) diff.push({ key:k, note:'route in previous matrix but NOT in mine (REMOVED)' });
} catch(e) { diff = [{ error: String(e) }]; }

const result = {
  routes: mrows.length,
  escalations: findings,
  mustChangeViolations: mustViolations,
  selfServiceListLeaks: selfServiceLeaks,
  diffVsPrevious: diff,
};
writeFileSync(new URL('../raw/matrix_analysis.json', import.meta.url), JSON.stringify(result, null, 1));
console.log('routes:', mrows.length);
console.log('ESCALATIONS:', findings.length);
console.log('SECMUST non-403/2xx cells:', mustViolations.length);
console.log('  ', JSON.stringify(mustViolations.slice(0,30)));
console.log('SELF_SERVICE list leaks:', selfServiceLeaks.length, JSON.stringify(selfServiceLeaks.slice(0,20)));
console.log('DIFF vs previous (cells+notes):', diff.length);
console.log(JSON.stringify(diff, null, 1));
