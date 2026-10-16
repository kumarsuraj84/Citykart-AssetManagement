import { req, API, login } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const today = new Date().toISOString().slice(0, 10);
const REF = { company_id: 1, cost_center_id: 1, vendor_id: 1, item_noserial: 2, stock_room: 3, holderA: 3, holderB: 5 };
const sec = await login('SECHO'); const T = sec.access;
const A = (m, p, b, h) => req(API, m, p, { token: T, body: b, headers: h });
const hist = (arr) => arr.reduce((h, s) => (h[s] = (h[s] || 0) + 1, h), {});
async function burst(n, fn) { return hist(await Promise.all(Array.from({ length: n }, (_, i) => fn(i).then(r => r.status).catch(() => 'ERR')))); }
const inv = { received_into_asset_user_id: REF.stock_room, invoice_number: 'CL2-INV', invoice_date: today, invoice_amount: 100 };
const results = JSON.parse(readFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/b_concurrency.json'));
const log = (k, v) => { results[k] = v; console.log('\n### ' + k, JSON.stringify(v)); };

async function newPO(poNum, qty) {
  const po = await A('POST', '/api/purchase-orders/with-lines', { company_id: REF.company_id, po_number: poNum, po_date: today, cost_center_id: REF.cost_center_id, vendor_id: REF.vendor_id, lines: [{ item_id: REF.item_noserial, quantity: qty, purchase_cost: 100 }] });
  return po.json && po.json.id;
}

// (b) receive race qty6 -> exactly 6 succeed
try {
  const poId = await newPO('CL2-PO-RCV-2', 6);
  const h = await burst(20, () => A('POST', `/api/purchase-orders/${poId}/receive`, { ...inv, lines: [{ line_no: 1, quantity: 1, serial_mode: 'NO_SERIAL' }] }));
  log('b_receive_race', { poId, expected_success: 6, histogram: h });
} catch (e) { log('b_receive_race', { error: String(e) }); }

// (b2) receive with ONE idempotency key x20 -> exactly 1 unit
try {
  const poId = await newPO('CL2-PO-RCV-IDEM2', 6);
  const key = 'CL2-IDEM-RCV-' + Date.now();
  const raw = await Promise.all(Array.from({ length: 20 }, () => A('POST', `/api/purchase-orders/${poId}/receive`, { ...inv, lines: [{ line_no: 1, quantity: 1, serial_mode: 'NO_SERIAL' }] }, { 'Idempotency-Key': key }).catch(() => ({ status: 'ERR', headers: new Map() }))));
  const replays = raw.filter(r => r.headers && r.headers.get && r.headers.get('idempotency-replay')).length;
  log('b2_receive_one_idem_key', { poId, histogram: hist(raw.map(r => r.status)), idempotency_replays: replays });
} catch (e) { log('b2_receive_one_idem_key', { error: String(e) }); }

// (e) sold twice + moved two holders
try {
  const batch = await A('POST', '/api/assets/batch', { item_id: REF.item_noserial, quantity: 3, received_into_asset_user_id: REF.stock_room, cost_center_id: REF.cost_center_id, company_id: REF.company_id, serial_mode: 'NO_SERIAL', vendor_id: REF.vendor_id, description: 'CL2 terminal test' });
  const ids = (batch.json.assets || []).map(a => a.asset_id);
  const soldAsset = ids[0], moveAsset = ids[1];
  const hs = await burst(20, () => A('POST', `/api/assets/${soldAsset}/events`, { event_type: 'SOLD', remarks: 'CL2 race sold' }));
  log('e_sold_twice', { soldAsset, expected_success: 1, histogram: hs });
  const hm = await burst(20, (i) => A('POST', `/api/assets/${moveAsset}/events`, { event_type: 'MOVED', to_asset_user_id: (i % 2 === 0 ? REF.holderA : REF.holderB), remarks: 'CL2 race move' }));
  log('e_moved_two_holders', { moveAsset, histogram: hm });
} catch (e) { log('e_terminal', { error: String(e) }); }

// (i) parallel create+deactivate+receive on same PO
try {
  const poId = await newPO('CL2-PO-MIX-2', 4);
  const ops = [
    () => A('POST', `/api/purchase-orders/${poId}/receive`, { ...inv, lines: [{ line_no: 1, quantity: 1, serial_mode: 'NO_SERIAL' }] }),
    () => A('DELETE', `/api/purchase-orders/${poId}`),
  ];
  const raw = await Promise.all(Array.from({ length: 12 }, (_, i) => ops[i % ops.length]().then(r => r.status).catch(() => 'ERR')));
  log('i_po_create_deactivate_receive', { poId, histogram: hist(raw) });
} catch (e) { log('i_po_mix', { error: String(e) }); }

writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/b_concurrency.json', JSON.stringify(results, null, 2));
console.log('\n=== B FIX DONE ===');
