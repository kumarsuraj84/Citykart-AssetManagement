// RETEST2 ACCESS input spot-re-run + business-logic. SQLi payload classes on search/filter/sort/limit params;
// formula injection in an export; lifecycle terminal-state, cross-company move, duplicate PO, receive-cancelled.
import { req, tok } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const secho = await tok('SECHO');
const out = [];
const rec = (id, desc, status, verdict, note) => { out.push({ id, desc, status, verdict, note }); console.log(verdict, id, status, '-', desc, note?('| '+note):''); };

// ---------- SQL injection on list params (must be 200 normal / 422, never 500 or cross-table leak) ----------
const SQLI = ["' OR '1'='1", "'; DROP TABLE asset;--", "1) OR (1=1", "x' UNION SELECT null--",
  "1;SELECT pg_sleep(5)", "\\'", "%27%20OR%201=1"];
let sqliBad = 0, sqli500 = 0;
for (const p of SQLI) {
  const qp = encodeURIComponent(p);
  for (const param of ['q','status','sort_by','sort_dir']) {
    const r = await req('GET', `/api/assets?${param}=${qp}`, { token: secho });
    if (r.status === 500) { sqli500++; }
    if (![200,422,400].includes(r.status)) sqliBad++;
  }
}
rec('CL2-AC-SQLI-assets', `assets list q/status/sort_by/sort_dir x ${SQLI.length} payloads`,
    `${SQLI.length*4} calls`, sqli500===0 && sqliBad===0 ? 'PASS' : 'FAIL', `500s=${sqli500} unexpected=${sqliBad}`);

// limit/offset abuse
for (const [k,v] of [['limit','-1'],['limit','999999999'],['offset','-5'],['limit',"1;--"],['sort_dir','nonsense']]) {
  const r = await req('GET', `/api/assets?${k}=${encodeURIComponent(v)}`, { token: secho });
  rec('CL2-AC-SQLI-limit', `assets ${k}=${v}`, r.status, [200,422,400].includes(r.status) ? 'PASS':'FAIL', '');
}
// SQLi on other list endpoints + the admin log search
for (const ep of ['/api/masters/vendors','/api/items','/api/purchase-orders','/api/erp/pos','/api/admin/logs/audit']) {
  const r = await req('GET', `${ep}?q=${encodeURIComponent("' OR 1=1--")}&sort_by=${encodeURIComponent("id;drop")}&order=${encodeURIComponent("'x")}&limit=${encodeURIComponent('-1')}&offset=${encodeURIComponent('abc')}`, { token: secho });
  rec('CL2-AC-SQLI-list', `SQLi on ${ep}`, r.status, r.status!==500 ? 'PASS':'FAIL', r.status===500?r.raw.slice(0,80):'');
}

// ---------- formula injection in an export: store a CSV-formula name, export, check it is neutralised ----------
const formula = '=cmd|calc!A1';
let vend = await req('POST','/api/masters/vendors',{ token: secho, body: { name: formula+' CL2', company_id: 1 } });
rec('CL2-AC-FORMULA-store', 'create vendor with =formula name', vend.status, vend.status===201?'PASS':'INFO', '');
if (vend.status === 201) {
  const vid = vend.body.id;
  const exp = await req('GET','/api/masters/vendors/export',{ token: secho, raw: true });
  const body = exp.raw || '';
  // CSV formula-injection defence neutralises a leading = + - @ (e.g. prefix with a quote/tab). We flag RAW leading '='.
  const lines = body.split(/\r?\n/).filter(l => l.includes('CL2'));
  const rawFormula = lines.some(l => /(^|,)"?=cmd/.test(l));
  rec('CL2-AC-FORMULA-export', 'vendor export neutralises leading = (no raw =cmd cell)', exp.status,
      rawFormula ? 'CHECK' : 'PASS', rawFormula ? 'raw =cmd present in export cell' : 'formula not raw-active; sample: '+(lines[0]||'').slice(0,60));
  // cleanup vendor (soft) - vendors delete route
  await req('DELETE',`/api/masters/vendors/${vid}`,{ token: secho });
}

// ---------- business logic: lifecycle terminal / cross-company move ----------
async function makeAsset(company, cc, item, cat, sub, holder) {
  const r = await req('POST','/api/assets',{ token: secho, body: {
    company_id: company, cost_center_id: cc, item_id: item, category_id: cat, subcategory_id: sub,
    description: 'CL2 logic asset', vendor_id: company===1?1:4, initial_asset_user_id: holder, serial_pending: true } });
  return (Array.isArray(r.body)&&r.body[0]) ? r.body[0].id : (r.body&&r.body.id) || null;
}
const aid = await makeAsset(1,1,1,1,1,3);  // CKSPL IT laptop into stock room 3
rec('CL2-AC-LOGIC-make', 'create CL2 lifecycle asset', aid?201:'fail', aid?'PASS':'FAIL', 'id '+aid);
if (aid) {
  let r = await req('POST',`/api/assets/${aid}/events`,{ token: secho, body: { event_type:'SCRAPPED', remarks:'CL2' } });
  rec('CL2-AC-LOGIC-scrap', 'SCRAP in_stock asset', r.status, r.status===200||r.status===201?'PASS':'CHECK', '');
  r = await req('POST',`/api/assets/${aid}/events`,{ token: secho, body: { event_type:'SCRAPPED', remarks:'CL2 double' } });
  rec('CL2-AC-LOGIC-double-scrap', 'SCRAP again (terminal) must be refused', r.status, r.status===422?'PASS':'FAIL', r.raw.slice(0,90));
  r = await req('POST',`/api/assets/${aid}/events`,{ token: secho, body: { event_type:'MOVED', to_asset_user_id:3, remarks:'CL2 move terminal' } });
  rec('CL2-AC-LOGIC-move-terminal', 'MOVE a terminal (scrapped) asset must be refused', r.status, r.status===422?'PASS':'FAIL', r.raw.slice(0,90));
}
// cross-company move: fresh CKSPL asset MOVED to a CKVPL holder (stock room 8)
const aid2 = await makeAsset(1,1,1,1,1,3);
if (aid2) {
  let r = await req('POST',`/api/assets/${aid2}/events`,{ token: secho, body: { event_type:'MOVED', to_asset_user_id:8, remarks:'CL2 xco' } });
  rec('CL2-AC-LOGIC-xco-move', 'MOVE CKSPL asset to CKVPL holder (stock room 8) must be refused', r.status, r.status===422?'PASS':'CHECK', r.raw.slice(0,100));
  // cleanup (delete if still single-event; if moved it won't delete)
  await req('DELETE',`/api/assets/${aid2}`,{ token: secho });
}

// ---------- duplicate PO number ----------
let r = await req('POST','/api/purchase-orders/with-lines',{ token: secho, body: {
  company_id:1, po_number:'SEC-SPL-PO-001', po_date:'2026-01-01', cost_center_id:1, vendor_id:1, lines:[] } });
rec('CL2-AC-LOGIC-dup-po', 'duplicate PO number SEC-SPL-PO-001 must be refused', r.status, [409,422].includes(r.status)?'PASS':'CHECK', r.raw.slice(0,100));

// ---------- receive a cancelled PO (po 3) ----------
r = await req('POST','/api/purchase-orders/3/receive',{ token: secho, body: { lines: [{ line_id: 8, quantity: 1 }] } });
rec('CL2-AC-LOGIC-receive-cancelled', 'receive CANCELLED po 3 must be refused', r.status, [409,422,400].includes(r.status)?'PASS':'CHECK', r.raw.slice(0,100));

// ---------- over-receive / negative qty on open PO 2 ----------
r = await req('POST','/api/purchase-orders/2/receive',{ token: secho, body: { lines: [{ line_id: 6, quantity: 999999 }] } });
rec('CL2-AC-LOGIC-over-receive', 'over-receive (qty 999999) must be refused', r.status, [409,422,400].includes(r.status)?'PASS':'CHECK', r.raw.slice(0,100));
r = await req('POST','/api/purchase-orders/2/receive',{ token: secho, body: { lines: [{ line_id: 6, quantity: -3 }] } });
rec('CL2-AC-LOGIC-neg-receive', 'negative qty receive must be refused', r.status, [409,422,400].includes(r.status)?'PASS':'CHECK', r.raw.slice(0,100));

writeFileSync(new URL('../raw/input_logic.json', import.meta.url), JSON.stringify(out, null, 1));
const bad = out.filter(x=>x.verdict==='FAIL'||x.verdict==='CHECK');
console.log('\\nTOTAL:', out.length, 'FAIL/CHECK:', bad.length);
