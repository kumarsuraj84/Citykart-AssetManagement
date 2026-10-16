// RETEST2 ACCESS IDOR/BOLA battery (non-destructive). Cross-company, work-area, custody and cross-actor.
// CKSPL ids vs CKVPL ids from the fixture. Writes use FAKE ids so nothing real is deleted.
import { req, tok } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const T = {};
for (const c of ['SECOPIT','SECOTHER','SECSELF','SPA','SECVIEW','SECHO','SECOPX','SECFAIT']) T[c] = await tok(c);
const out = [];
const rec = (id, who, route, status, expect, note) => { out.push({ id, who, route, status, expect, verdict: (''+status===''+expect||(Array.isArray(expect)&&expect.map(String).includes(''+status))) ? 'PASS' : 'CHECK', note }); };

async function g(who, route) { const r = await req('GET', route, { token: T[who] }); return r; }
const arr = b => Array.isArray(b) ? b : (b && Array.isArray(b.items) ? b.items : []);

// --- PO reads: po 1 = CKSPL, po 5 = CKVPL ---
for (const [who, poOwn, poOther] of [['SECOPIT','1','5'],['SECOTHER','5','1']]) {
  let r = await g(who, `/api/purchase-orders/${poOwn}`);  rec('CL2-AC-IDOR-po-own', who, `GET po ${poOwn}`, r.status, 200, 'own company PO');
  r = await g(who, `/api/purchase-orders/${poOther}`);    rec('CL2-AC-IDOR-po-cross', who, `GET po ${poOther}`, r.status, 404, 'other company PO must be 404');
  for (const sub of ['lines','receive-info','invoices','line-groups']) {
    r = await g(who, `/api/purchase-orders/${poOther}/${sub}`); rec('CL2-AC-IDOR-po-sub-cross', who, `GET po ${poOther}/${sub}`, r.status, [403,404], 'other company PO sub-route');
  }
}

// --- ERP PO draft: 9001001 CKSPL, 9002001 CKVPL ---
let r = await g('SECOPIT','/api/erp/pos/9002001/draft'); rec('CL2-AC-IDOR-erp-cross', 'SECOPIT', 'GET erp draft 9002001 (CKVPL)', r.status, 404, 'IF-03 cross-company ERP');
r = await g('SECOPIT','/api/erp/pos/9001001/draft');     rec('CL2-AC-IDOR-erp-own', 'SECOPIT', 'GET erp draft 9001001 (CKSPL)', r.status, 200, 'own');
r = await g('SECOTHER','/api/erp/pos/9001001/draft');    rec('CL2-AC-IDOR-erp-cross2', 'SECOTHER', 'GET erp draft 9001001 (CKSPL)', r.status, 404, 'IF-03 cross-company');
r = await g('SECOPX','/api/erp/pos/9002001/draft');      rec('CL2-AC-IDOR-erp-grant', 'SECOPX', 'GET erp draft 9002001 (CKVPL, granted)', r.status, 200, 'cross-company grant works');

// --- custom fields list: AC-2 company filtering ---
r = await g('SECOPIT','/api/masters/custom-fields');
const cf1 = arr(r.body).map(x=>({id:x.id, companies:x.company_ids}));
rec('CL2-AC-IDOR-cf-filter', 'SECOPIT', 'GET custom-fields company_ids', r.status, 200, JSON.stringify(cf1));
r = await g('SECOTHER','/api/masters/custom-fields');
const cf2 = arr(r.body).map(x=>({id:x.id, companies:x.company_ids}));
rec('CL2-AC-IDOR-cf-filter2', 'SECOTHER', 'GET custom-fields company_ids', r.status, 200, JSON.stringify(cf2));
// ?company_id=2 must not widen SECOPIT (CKSPL) view
r = await g('SECOPIT','/api/masters/custom-fields?company_id=2');
rec('CL2-AC-IDOR-cf-widen', 'SECOPIT', 'GET custom-fields?company_id=2', r.status, 200, JSON.stringify(arr(r.body).map(x=>x.company_ids)));

// --- custom field write cross-company (operator should be denied; fake id avoids any delete) ---
r = await req('PUT','/api/masters/custom-fields/2',{ token: T.SECOPIT, body: {} });
rec('CL2-AC-IDOR-cf-write', 'SECOPIT', 'PUT custom-field 2 (CKVPL)', r.status, [403,404,422], 'operator cross-company custom-field write');
r = await req('DELETE','/api/items/maps/999',{ token: T.SECOPIT });
rec('CL2-AC-IDOR-map-del-fake', 'SECOPIT', 'DELETE items/maps/999 (fake)', r.status, [403,404], 'mapping delete guard');

// --- item maps list company filtering ---
r = await g('SECOPIT','/api/items/maps'); rec('CL2-AC-IDOR-maps-list', 'SECOPIT', 'GET items/maps', r.status, 200, JSON.stringify(arr(r.body).map(x=>({id:x.id,company_id:x.company_id}))));
r = await g('SECOTHER','/api/items/maps'); rec('CL2-AC-IDOR-maps-list2', 'SECOTHER', 'GET items/maps', r.status, 200, JSON.stringify(arr(r.body).map(x=>({id:x.id,company_id:x.company_id}))));

// --- custody / BOLA on assets ---
r = await g('SECSELF','/api/assets/1');  rec('CL2-AC-BOLA-self-own', 'SECSELF', 'GET asset 1 (owns)', r.status, 200, 'custody');
r = await g('SECSELF','/api/assets/2');  rec('CL2-AC-BOLA-self-notown', 'SECSELF', 'GET asset 2 (same co/domain, not held)', r.status, 404, 'self-service only own');
r = await g('SECSELF','/api/assets/9');  rec('CL2-AC-BOLA-self-cross', 'SECSELF', 'GET asset 9 (CKVPL)', r.status, 404, 'cross-company');
r = await g('SPA','/api/assets/6');      rec('CL2-AC-BOLA-store-own', 'SPA', 'GET asset 6 (store holds)', r.status, 200, 'store custody');
r = await g('SPA','/api/assets/1');      rec('CL2-AC-BOLA-store-notown', 'SPA', 'GET asset 1 (not held)', r.status, 404, 'store only own');
r = await g('SECSELFV' in T ? 'SECSELFV' : 'SECSELF','/api/assets/9'); // SECSELFV not loaded; skip gracefully

// --- cross-actor idempotency replay: SECOPIT reuses SECHO's seed key ---
r = await req('POST','/api/purchase-orders/with-lines',{ token: T.SECOPIT,
  headers: { 'Idempotency-Key': 'sec-seed-spl-po1-create' }, body: {} });
const replayHdr = r.headers.get('idempotency-replay');
rec('CL2-AC-IDOR-idem-xactor', 'SECOPIT', 'POST with-lines reusing SECHO seed idem key', r.status, [422,403,201],
    `Idempotency-Replay=${replayHdr||'absent'} (must be absent: per-actor keys)`);

// --- asset-user company-access read cross (ADMIN-only route) ---
r = await g('SECOPIT','/api/asset-users/26/company-access'); rec('CL2-AC-IDOR-au-ca-op', 'SECOPIT', 'GET asset-user 26 company-access', r.status, 403, 'operator denied');

writeFileSync(new URL('../raw/idor.json', import.meta.url), JSON.stringify(out, null, 1));
const checks = out.filter(x=>x.verdict==='CHECK');
console.log('IDOR cases:', out.length, 'CHECK(need review):', checks.length);
for (const x of out) console.log(x.verdict, x.id, x.who, '|', x.route, '->', x.status, '(exp', JSON.stringify(x.expect)+')', x.note||'');
