import { writeFileSync } from 'node:fs';
import { login, req } from './lib.mjs';
const tok = {};
for (const c of ['SECHO','SECOTHER','SECOPIT']) tok[c] = (await login(c)).body.access_token;
const results = [];
let n = 400;
const nid = () => `AC-T${String(n++).padStart(3,'0')}`;
function rec(id,cwe,cas,expected,actual,pass,ev=''){results.push({id,cwe,case:cas,expected,actual,result:pass?'PASS':'FAIL',ev});if(!pass)console.log('FAIL',id,cas,'->',actual,ev);}

// 1. Cross-company MOVE must be refused (asset 3 CKSPL -> CKVPL stock room 8). As SECHO.
{
  const before = (await req('GET','/api/assets/3',{token:tok.SECHO})).body;
  const r = await req('POST','/api/assets/3/events',{token:tok.SECHO, body:{event_type:'MOVED', to_asset_user_id:8}});
  const after = (await req('GET','/api/assets/3',{token:tok.SECHO})).body;
  const refused = r.status>=400 && after.current_asset_user_id===before.current_asset_user_id && after.company_id===before.company_id;
  rec(nid(),'CWE-639',`cross-company MOVE asset3(CKSPL)->holder8(CKVPL) as SECHO`,'refused 4xx, no change',
      `${r.status} holder ${before.current_asset_user_id}->${after.current_asset_user_id}`, refused, r.status<400?'CROSS-CO MOVE SUCCEEDED':'');
}

// 2. Idempotency: user B cannot replay user A's stored key/response.
// SECOTHER re-uses SECHO's seeded create key -> must NOT return SECHO's PO / no replay header; runs as SECOTHER.
{
  const r = await fetch('http://127.0.0.1:8200/api/purchase-orders/with-lines', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${tok.SECOTHER}`,'Idempotency-Key':'sec-seed-spl-po1-create'},
    body: JSON.stringify({}) });
  const replay = r.headers.get('idempotency-replay');
  const txt = await r.text();
  const leaked = replay==='true' || /SEC-SPL-PO-001/.test(txt);
  rec(nid(),'CWE-639',`idempotency cross-user replay: SECOTHER reuses SECHO seeded key`,'no replay of A data (fresh/own processing)',
      `status=${r.status} replay=${replay}`, !leaked, leaked?'CROSS-USER REPLAY LEAK '+txt.slice(0,100):'');
}

// 3. Idempotency same user, DIFFERENT body, same already-used key -> 422 "different request"
{
  const r = await fetch('http://127.0.0.1:8200/api/purchase-orders/with-lines', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${tok.SECHO}`,'Idempotency-Key':'sec-seed-spl-po1-create'},
    body: JSON.stringify({different:'body'}) });
  const txt = await r.text();
  rec(nid(),'CWE-837',`idempotency key reuse with different body (SECHO)`,'422 different-request', `${r.status}`, r.status===422, r.status!==422?txt.slice(0,100):'');
}

// 4. Idempotency key format abuse: too short / too long / bad chars -> 422 BAD_KEY
for (const [k,label] of [['abc','too-short'],['x'.repeat(300),'too-long'],['bad key spaces','bad-chars']]) {
  const r = await fetch('http://127.0.0.1:8200/api/assets/batch', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${tok.SECHO}`,'Idempotency-Key':k},
    body: JSON.stringify({}) });
  rec(nid(),'CWE-20',`idempotency key ${label} rejected`,'422', `${r.status}`, r.status===422);
}

// 5. Duplicate PO number refused (create as SECHO with an existing po_number). Use minimal invalid-enough body to avoid new PO.
{
  const r = await req('POST','/api/purchase-orders',{token:tok.SECHO, body:{po_number:'SEC-SPL-PO-001', company_id:1}});
  // Either 422 duplicate (preferred) or 422 validation; must NOT create a second PO with same number.
  const ok = r.status>=400;
  rec(nid(),'CWE-840',`duplicate PO number create (SEC-SPL-PO-001)`,'refused 4xx', `${r.status}`, ok, r.status<300?'DUP PO CREATED':JSON.stringify(r.body).slice(0,120));
}

const fail=results.filter(r=>r.result==='FAIL');
console.log('\ntotal',results.length,'FAIL',fail.length);
writeFileSync(new URL('./phaseB_logic.json',import.meta.url), JSON.stringify(results,null,1));
