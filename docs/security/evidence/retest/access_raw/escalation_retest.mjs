import { writeFileSync } from 'node:fs';
import { tok as getTok, req } from './lib.mjs';

const CODES = ['SECFAIT','SECFANIT','SECFABOTH','SECOPIT','SECHO','SECMUST'];
const tok = {};
for (const c of CODES) { tok[c] = await getTok(c); }

const results = [];
function rec(id, cwe, cas, expected, actual, pass, ev='') {
  results.push({ id, cwe, case: cas, expected, actual, result: pass?'PASS':'FAIL', ev });
  if(!pass) console.log('FAIL', id, cas, '->', actual, ev);
}
let n = 300;
const nid = () => `RT-AC-T${String(n++).padStart(3,'0')}`;

// ---------- 1. SECMUST (must_change_password) blocked on every route but change-password ----------
{
  const r = await req('GET','/api/assets',{token:tok.SECMUST});
  rec(nid(),'CWE-287',`SECMUST (must-change-pw) GET /api/assets`,'403', `${r.status}`, r.status===403, r.status!==403?JSON.stringify(r.body).slice(0,80):'');
  const r2 = await req('GET','/api/auth/capabilities',{token:tok.SECMUST});
  rec(nid(),'CWE-287',`SECMUST GET /api/auth/capabilities`,'403', `${r2.status}`, r2.status===403);
}

// ---------- 2. Mass assignment on user create: is_primary_owner / role / extra fields ----------
// SECFABOTH (ADMIN both areas) attempts to mint a Primary Owner + set protected fields.
let createdUserId = null;
{
  const body = {
    company_id:1, code:'SEC-MASS-'+Date.now().toString().slice(-6), name:'Sec Mass Assign Probe',
    asset_user_type:'EMPLOYEE', location_id:1, email:null, phone:null,
    role:'ADMIN', login_enabled:true, allowed_asset_domains:'BOTH', primary_asset_domain:'BOTH',
    // forbidden / extra fields that must be ignored:
    is_primary_owner:true, must_change_password:false, password_hash:'x', failed_login_count:0,
    locked_until:null, id:999999, is_active:true, created_by:1,
  };
  const r = await req('POST','/api/asset-users',{token:tok.SECFABOTH, body});
  if (r.status===201) {
    createdUserId = r.body.id;
    const po = r.body.is_primary_owner;
    rec(nid(),'CWE-915',`user create as SECFABOTH with is_primary_owner=true in body`,'created, is_primary_owner=false', `201 po=${po} id=${r.body.id}`, po===false, po?'MINTED PRIMARY OWNER':'');
  } else {
    rec(nid(),'CWE-915',`user create as SECFABOTH w/ forbidden fields`,'201 (fields ignored)', `${r.status}`, false, JSON.stringify(r.body).slice(0,120));
  }
}

// ---------- 3. SECFAIT (IT-only admin) may NOT grant a wider work area than its own ----------
{
  const body = { company_id:1, code:'SEC-WIDE-'+Date.now().toString().slice(-6), name:'Sec Wide Area Probe',
    asset_user_type:'EMPLOYEE', location_id:1, role:'OPERATOR', login_enabled:true, allowed_asset_domains:'BOTH' };
  const r = await req('POST','/api/asset-users',{token:tok.SECFAIT, body});
  rec(nid(),'CWE-269',`SECFAIT (IT) creates OPERATOR w/ allowed_asset_domains=BOTH`,'403 wider work area', `${r.status}`, r.status===403, r.status===201?'WIDENED id='+r.body.id:'');
  if (r.status===201) { await req('DELETE',`/api/asset-users/${r.body.id}`,{token:tok.SECHO}); }
}
// SECFANIT (NON_IT) creating an IT operator
{
  const body = { company_id:1, code:'SEC-WIDE2-'+Date.now().toString().slice(-6), name:'Sec Wide Area Probe2',
    asset_user_type:'EMPLOYEE', location_id:1, role:'OPERATOR', login_enabled:true, allowed_asset_domains:'IT' };
  const r = await req('POST','/api/asset-users',{token:tok.SECFANIT, body});
  rec(nid(),'CWE-269',`SECFANIT (NON_IT) creates OPERATOR w/ allowed_asset_domains=IT`,'403 wider work area', `${r.status}`, r.status===403, r.status===201?'WIDENED id='+r.body.id:'');
  if (r.status===201) { await req('DELETE',`/api/asset-users/${r.body.id}`,{token:tok.SECHO}); }
}

// ---------- 4. Full Admin may NOT edit / deactivate / reset / change-company-access the Primary Owner ----------
// Primary Owner rows: Admin=1, SECHO=2. Use SECHO (id 2) as target, actor SECFAIT (ordinary ADMIN).
for (const targetId of [1,2]) {
  const r1 = await req('PUT',`/api/asset-users/${targetId}`,{token:tok.SECFAIT, body:{ name:'HIJACK ATTEMPT' }});
  rec(nid(),'CWE-269',`SECFAIT PUT primary-owner ${targetId}`,'403', `${r1.status}`, r1.status===403, r1.status<400?'EDITED PO':'');
  const r2 = await req('POST',`/api/asset-users/${targetId}/reset-password`,{token:tok.SECFAIT});
  rec(nid(),'CWE-640',`SECFAIT reset-password primary-owner ${targetId}`,'403', `${r2.status}`, r2.status===403, r2.status<400?'RESET PO PW':'');
  const r3 = await req('DELETE',`/api/asset-users/${targetId}`,{token:tok.SECFAIT});
  rec(nid(),'CWE-269',`SECFAIT deactivate primary-owner ${targetId}`,'403', `${r3.status}`, r3.status===403, r3.status<400?'DEACTIVATED PO':'');
  const r4 = await req('POST',`/api/asset-users/${targetId}/company-access`,{token:tok.SECFAIT, body:{company_ids:[1,2]}});
  rec(nid(),'CWE-269',`SECFAIT set company-access primary-owner ${targetId}`,'403', `${r4.status}`, r4.status===403, r4.status<400?'CHANGED PO ACCESS':'');
  const r5 = await req('POST',`/api/asset-users/${targetId}/primary-owner`,{token:tok.SECFAIT});
  rec(nid(),'CWE-269',`SECFAIT grant primary-owner to ${targetId}`,'403 (not primary owner)', `${r5.status}`, r5.status===403, r5.status<400?'GRANTED':'');
}

// ---------- 5. Mass-assignment on ASSET update: forbidden fields must be ignored (no status/company/holder/domain change) ----------
// Target asset 3 (CKSPL IT, IN_STOCK). As SECHO. Keep description identical, send forbidden extras, verify unchanged.
{
  const before = (await req('GET','/api/assets/3',{token:tok.SECHO})).body;
  const body = {
    description: before.description ?? 'x',
    // forbidden / lifecycle / identity fields:
    status:'SCRAPPED', current_asset_user_id:4, status_since:'2020-01-01', company_id:2,
    asset_code:'HACK/CODE/9999', asset_domain:'NON_IT', cost_center_id:2, is_active:false,
    category_id:2, subcategory_id:2, created_by:1, id:999,
  };
  const r = await req('PUT','/api/assets/3',{token:tok.SECHO, body});
  const after = (await req('GET','/api/assets/3',{token:tok.SECHO})).body;
  const unchanged = r.status===200 &&
    after.status===before.status && after.company_id===before.company_id &&
    after.current_asset_user_id===before.current_asset_user_id && after.asset_domain===before.asset_domain &&
    after.asset_code===before.asset_code && after.cost_center_id===before.cost_center_id &&
    after.is_active===before.is_active && after.category_id===before.category_id;
  rec(nid(),'CWE-915',`asset PUT mass-assign status/holder/company/domain/code (SECHO, asset 3)`,
      'all protected fields unchanged', `put=${r.status} status=${after.status} co=${after.company_id} holder=${after.current_asset_user_id} dom=${after.asset_domain} code=${after.asset_code} active=${after.is_active}`,
      unchanged, unchanged?'':'PROTECTED FIELD CHANGED');
}

// ---------- 6. Cross-company WRITE of company-owned master (cost centre) by scoped operator ----------
// SECOPIT (CKSPL) tries to create a cost centre for CKVPL (company_id 2) -> 403 ensure_company_for_create
{
  const r = await req('POST','/api/masters/cost-centers',{token:tok.SECOPIT, body:{ company_id:2, code:'SEC-XC-'+Date.now().toString().slice(-5), name:'cross company cc' }});
  rec(nid(),'CWE-639',`SECOPIT create cost-centre for CKVPL (co2)`,'403 out-of-scope company', `${r.status}`, r.status===403, r.status===201?'CREATED CROSS-CO id='+r.body?.id:'');
  if (r.status===201 && r.body?.id) await req('DELETE',`/api/masters/cost-centers/${r.body.id}`,{token:tok.SECHO});
}

// cleanup throwaway user from test 2
if (createdUserId) { const d = await req('DELETE',`/api/asset-users/${createdUserId}`,{token:tok.SECHO}); console.log('cleanup user', createdUserId, d.status); }

const fail = results.filter(r=>r.result==='FAIL');
console.log('\ntotal', results.length, 'FAIL', fail.length);
writeFileSync(new URL('./escalation_retest.json', import.meta.url), JSON.stringify(results,null,1));
