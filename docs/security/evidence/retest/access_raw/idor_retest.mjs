import { writeFileSync } from 'node:fs';
import { tok, req } from './lib.mjs';

const CODES = ['SECSELF','SECSELFV','SECVIEW','SECVIEWV','SECOPIT','SECOP2IT','SECOPNIT','SECOTHER','SECOPX','SECFAIT','SECFANIT','SECFABOTH','SECHO'];
const tokc = {};
for (const c of CODES) { tokc[c] = await tok(c); }

const results = [];
function rec(id, cwe, cas, expected, actual, pass, ev='') {
  results.push({ id, cwe, case: cas, expected, actual, result: pass ? 'PASS' : 'FAIL', ev });
}
const allow = s => !(s === 401 || s === 403 || s === 404);

// Asset facts: id -> {company:1|2, domain:IT|NON_IT, holder}
const ASSET = {
  1:{c:1,d:'IT',holder:'SECSELF'}, 3:{c:1,d:'IT'}, 4:{c:1,d:'NON_IT'},
  9:{c:2,d:'IT',holder:'SECSELFV'}, 11:{c:2,d:'IT'}, 12:{c:2,d:'NON_IT'},
};
// persona scope model: company set (null=all for ADMIN), domain set (null=all), self custody list
const SCOPE = {
  SECSELF:{co:[1],dom:null,self:[1]}, SECSELFV:{co:[2],dom:null,self:[9]},
  SECVIEW:{co:[1],dom:['IT','NON_IT']}, SECVIEWV:{co:[2],dom:['IT','NON_IT']},
  SECOPIT:{co:[1],dom:['IT']}, SECOP2IT:{co:[1],dom:['IT']}, SECOPNIT:{co:[1],dom:['NON_IT']},
  SECOTHER:{co:[2],dom:['IT','NON_IT']}, SECOPX:{co:[1,2],dom:['IT','NON_IT']},
  SECFAIT:{co:null,dom:['IT']}, SECFANIT:{co:null,dom:['NON_IT']}, SECFABOTH:{co:null,dom:null}, SECHO:{co:null,dom:null},
};
function shouldRead(persona, aid) {
  const s = SCOPE[persona], a = ASSET[aid];
  if (s.self) return s.self.includes(aid);
  if (s.co && !s.co.includes(a.c)) return false;
  if (s.dom && !s.dom.includes(a.d)) return false;
  return true;
}

// ---- A. GET /api/assets/{id} across boundaries
let n = 1;
for (const persona of CODES) {
  for (const aid of Object.keys(ASSET).map(Number)) {
    const r = await req('GET', `/api/assets/${aid}`, { token: tokc[persona] });
    const got = allow(r.status);
    const exp = shouldRead(persona, aid);
    rec(`RT-AC-T${String(n++).padStart(3,'0')}`, 'CWE-639', `GET asset ${aid} as ${persona} (co${ASSET[aid].c}/${ASSET[aid].d})`,
        exp?'read (2xx)':'blocked (403/404)', `${r.status}`, got===exp, got&&!exp?`LEAK ${JSON.stringify(r.body).slice(0,120)}`:'');
  }
}

// ---- B. Document download IDOR (doc 1 -> asset1 CKSPL/IT; doc 2 -> asset9 CKVPL/IT)
const DOC = {1:1, 2:9};
for (const persona of CODES) {
  for (const [doc, aid] of Object.entries(DOC)) {
    const r = await req('GET', `/api/documents/${doc}/download`, { token: tokc[persona] });
    const got = allow(r.status);
    const exp = shouldRead(persona, aid);
    rec(`RT-AC-T${String(n++).padStart(3,'0')}`, 'CWE-639', `download doc ${doc} (asset ${aid}) as ${persona}`,
        exp?'download (2xx)':'blocked', `${r.status}`, got===exp, got&&!exp?'DOC LEAK':'');
  }
}

// ---- C. events read
for (const persona of CODES) {
  for (const aid of [1,4,9,12]) {
    const r = await req('GET', `/api/assets/${aid}/events`, { token: tokc[persona] });
    const got = allow(r.status), exp = shouldRead(persona, aid);
    rec(`RT-AC-T${String(n++).padStart(3,'0')}`, 'CWE-639', `GET asset ${aid} events as ${persona}`,
        exp?'2xx':'blocked', `${r.status}`, got===exp, got&&!exp?'EVENTS LEAK':'');
  }
}

// ---- D. PO reads cross-company (po 1 CKSPL, po 5 CKVPL). PO routes are WRITE_ROLES so VIEWER/SELF 403.
const PO = {1:1, 5:2};
for (const persona of ['SECOPIT','SECOPNIT','SECOTHER','SECOPX','SECFAIT','SECFANIT','SECVIEW','SECSELF','SECHO']) {
  for (const [po, co] of Object.entries(PO)) {
    const r = await req('GET', `/api/purchase-orders/${po}`, { token: tokc[persona] });
    const got = allow(r.status);
    const s = SCOPE[persona];
    let exp;
    if (persona==='SECVIEW'||persona==='SECSELF') exp=false; // not WRITE role
    else if (s.co===null) exp=true; // admin not company scoped
    else exp = s.co.includes(Number(co));
    rec(`RT-AC-T${String(n++).padStart(3,'0')}`, 'CWE-639', `GET PO ${po} (co${co}) as ${persona}`,
        exp?'2xx':'blocked', `${r.status}`, got===exp, got&&!exp?'PO LEAK':'');
  }
}

// ---- E. Write-scope: PUT /assets/{out-of-scope} with VALID body must 404 BEFORE writing
const WR = [
  ['SECOPIT',9],['SECOPIT',4],['SECOPNIT',1],['SECOTHER',1],['SECFAIT',4],['SECFANIT',1],
];
for (const [persona, aid] of WR) {
  const r = await req('PUT', `/api/assets/${aid}`, { token: tokc[persona], body: { description: 'sec-noop-should-not-apply' } });
  const blocked = (r.status===403||r.status===404);
  rec(`RT-AC-T${String(n++).padStart(3,'0')}`, 'CWE-285', `PUT asset ${aid} (out-of-scope) as ${persona}`,
      'blocked 403/404 before write', `${r.status}`, blocked, !blocked?`WRITE ALLOWED ${JSON.stringify(r.body).slice(0,120)}`:'');
}
// events write out-of-scope
for (const [persona, aid] of [['SECOPIT',9],['SECOPNIT',1],['SECOTHER',1]]) {
  const r = await req('POST', `/api/assets/${aid}/events`, { token: tokc[persona], body: { event_type:'MOVED', to_asset_user_id: 3 } });
  const blocked = (r.status===403||r.status===404);
  rec(`RT-AC-T${String(n++).padStart(3,'0')}`, 'CWE-285', `POST event asset ${aid} (out-of-scope) as ${persona}`,
      'blocked 403/404', `${r.status}`, blocked, !blocked?`EVENT ALLOWED ${JSON.stringify(r.body).slice(0,120)}`:'');
}

// ---- F. Self-service escape attempts
const selfEscape = [
  ['GET','/api/people'], ['GET','/api/asset-users'], ['GET','/api/purchase-orders'],
  ['GET','/api/reports/dashboard'], ['GET','/api/admin/logs/audit'], ['GET','/api/masters/cost-centers'],
  ['GET','/api/items'], ['GET','/api/erp/pos'],
];
for (const persona of ['SECSELF','SECSELFV']) {
  for (const [m,p] of selfEscape) {
    const r = await req(m, p, { token: tokc[persona] });
    const blocked = (r.status===401||r.status===403);
    rec(`RT-AC-T${String(n++).padStart(3,'0')}`, 'CWE-863', `self-service ${persona} ${m} ${p}`,
        'blocked 403', `${r.status}`, blocked, !blocked?`SELF ESCAPE ${JSON.stringify(r.body).slice(0,100)}`:'');
  }
}

// ---- G. List leak: GET /api/assets counts by company/domain
async function listAssets(persona) {
  const r = await req('GET', '/api/assets?limit=1000', { token: tokc[persona] });
  return r.body?.items || [];
}
const listChecks = {
  SECOPIT:{co:[1],dom:['IT']}, SECOPNIT:{co:[1],dom:['NON_IT']}, SECOTHER:{co:[2]},
  SECVIEW:{co:[1]}, SECOPX:{co:[1,2]}, SECSELF:{ids:[1]}, SECSELFV:{ids:[9]},
  SECFAIT:{dom:['IT']}, SECFANIT:{dom:['NON_IT']},
};
for (const [persona, chk] of Object.entries(listChecks)) {
  const items = await listAssets(persona);
  let bad = [];
  for (const a of items) {
    if (chk.ids && !chk.ids.includes(a.id)) bad.push(a.id);
    if (chk.co && !chk.co.includes(a.company_id)) bad.push(`co:${a.id}=${a.company_id}`);
    if (chk.dom && a.asset_domain && !chk.dom.includes(a.asset_domain)) bad.push(`dom:${a.id}=${a.asset_domain}`);
  }
  rec(`RT-AC-T${String(n++).padStart(3,'0')}`, 'CWE-639', `GET /api/assets list scope ${persona} (${items.length} rows)`,
      'only in-scope rows', bad.length?`LEAK ${bad.slice(0,8).join(',')}`:'clean', bad.length===0, bad.length?`rows=${items.length}`:'');
}

// summary
const fail = results.filter(r=>r.result==='FAIL');
console.log('total', results.length, 'FAIL', fail.length);
for (const f of fail) console.log('FAIL', f.id, f.case, '->', f.actual, f.ev);
writeFileSync(new URL('./idor_retest.json', import.meta.url), JSON.stringify(results,null,1));
