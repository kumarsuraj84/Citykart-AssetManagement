import { req, API, login, cookieHeader, refreshFrom, sleep } from './lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const today = new Date().toISOString().slice(0, 10);
const REF = { company_id: 1, cost_center_id: 1, vendor_id: 1, item_serial: 1, item_noserial: 2, stock_room: 3, category_it: 1, subcat: 1, brand: 1, holderA: 3, holderB: 5 };

const sec = await login('SECHO');
if (sec.status !== 200) { console.error('SECHO login failed', sec.status); process.exit(1); }
const T = sec.access;
const A = (method, path, body, headers) => req(API, method, path, { token: T, body, headers });
const hist = (arr) => arr.reduce((h, s) => (h[s] = (h[s] || 0) + 1, h), {});
async function burst(n, fn) { return hist(await Promise.all(Array.from({ length: n }, (_, i) => fn(i).then(r => r.status).catch(() => 'ERR')))); }
const results = {};
const log = (k, v) => { results[k] = v; console.log('\n### ' + k, JSON.stringify(v)); };

// ---------- (a) same PO number x20 ----------
try {
  const body = () => ({ company_id: REF.company_id, po_number: 'CL2-PO-DUP-1', po_date: today, cost_center_id: REF.cost_center_id, vendor_id: REF.vendor_id });
  const h = await burst(20, () => A('POST', '/api/purchase-orders', body()));
  log('a_same_po_number', { histogram: h });
} catch (e) { log('a_same_po_number', { error: String(e) }); }

// ---------- (b) same PO line receive x20 (qty 6) ----------
try {
  const po = await A('POST', '/api/purchase-orders/with-lines', { company_id: REF.company_id, po_number: 'CL2-PO-RCV-1', po_date: today, cost_center_id: REF.cost_center_id, vendor_id: REF.vendor_id, lines: [{ item_id: REF.item_noserial, quantity: 6, purchase_cost: 100 }] });
  const poId = po.json && po.json.id;
  const lineNo = po.json && po.json.lines && po.json.lines[0] && (po.json.lines[0].line_no ?? po.json.lines[0].lineNo ?? 1);
  console.log('b setup po', po.status, 'id', poId, 'line', lineNo, 'keys', po.json && Object.keys(po.json));
  const h = await burst(20, () => A('POST', `/api/purchase-orders/${poId}/receive`, { lines: [{ line_no: lineNo ?? 1, quantity: 1, serial_mode: 'NO_SERIAL' }] }));
  log('b_receive_race', { poId, lineNo, histogram: h });
} catch (e) { log('b_receive_race', { error: String(e) }); }

// ---------- (b2) same receive with ONE Idempotency-Key x20 ----------
try {
  const po = await A('POST', '/api/purchase-orders/with-lines', { company_id: REF.company_id, po_number: 'CL2-PO-RCV-IDEM', po_date: today, cost_center_id: REF.cost_center_id, vendor_id: REF.vendor_id, lines: [{ item_id: REF.item_noserial, quantity: 6, purchase_cost: 100 }] });
  const poId = po.json && po.json.id;
  const lineNo = (po.json.lines[0].line_no ?? 1);
  const key = 'CL2-IDEM-RCV-' + Date.now();
  const h = await burst(20, () => A('POST', `/api/purchase-orders/${poId}/receive`, { lines: [{ line_no: lineNo, quantity: 1, serial_mode: 'NO_SERIAL' }] }, { 'Idempotency-Key': key }));
  log('b2_receive_one_idem_key', { poId, histogram: h });
} catch (e) { log('b2_receive_one_idem_key', { error: String(e) }); }

// ---------- (c) same serial on 20 parallel asset creates ----------
try {
  const body = () => ({ company_id: REF.company_id, cost_center_id: REF.cost_center_id, item_id: REF.item_serial, serial_number: 'CL2-SER-DUP-1', description: 'CL2 dup serial', vendor_id: REF.vendor_id, initial_asset_user_id: REF.stock_room, warranty_years: 0 });
  const h = await burst(20, () => A('POST', '/api/assets', body()));
  log('c_same_serial', { histogram: h });
} catch (e) { log('c_same_serial', { error: String(e) }); }

// ---------- (d) batch create x20 same Idempotency-Key ----------
try {
  const key = 'CL2-IDEM-BATCH-' + Date.now();
  const body = { item_id: REF.item_noserial, quantity: 3, received_into_asset_user_id: REF.stock_room, cost_center_id: REF.cost_center_id, company_id: REF.company_id, serial_mode: 'NO_SERIAL', vendor_id: REF.vendor_id, description: 'CL2 idem batch' };
  const h = await burst(20, () => A('POST', '/api/assets/batch', body, { 'Idempotency-Key': key }));
  log('d_batch_one_idem_key', { histogram: h });
  // ---------- (d2) batch x10 WITHOUT key -> 10 distinct batches ----------
  const h2 = await burst(10, () => A('POST', '/api/assets/batch', { item_id: REF.item_noserial, quantity: 2, received_into_asset_user_id: REF.stock_room, cost_center_id: REF.cost_center_id, company_id: REF.company_id, serial_mode: 'NO_SERIAL', vendor_id: REF.vendor_id, description: 'CL2 nokey batch' }));
  log('d2_batch_no_key', { histogram: h2 });
} catch (e) { log('d_batch', { error: String(e) }); }

// ---------- (e) sold/scrapped twice x20 + moved to two holders x20 ----------
try {
  // make fresh IN_STOCK chairs
  const batch = await A('POST', '/api/assets/batch', { item_id: REF.item_noserial, quantity: 3, received_into_asset_user_id: REF.stock_room, cost_center_id: REF.cost_center_id, company_id: REF.company_id, serial_mode: 'NO_SERIAL', vendor_id: REF.vendor_id, description: 'CL2 terminal test' });
  const created = (batch.json && (batch.json.created || batch.json.assets || batch.json)) || [];
  console.log('e batch status', batch.status, 'keys', batch.json && Object.keys(batch.json));
  const ids = Array.isArray(created) ? created.map(a => a.id).filter(Boolean) : [];
  const soldAsset = ids[0], moveAsset = ids[1];
  // sold twice x20 on one asset -> exactly one terminal event
  const hs = await burst(20, () => A('POST', `/api/assets/${soldAsset}/events`, { event_type: 'SOLD', remarks: 'CL2 race sold' }));
  log('e_sold_twice', { soldAsset, histogram: hs });
  // moved to two different holders x20 (10 to A, 10 to B)
  const hm = await burst(20, (i) => A('POST', `/api/assets/${moveAsset}/events`, { event_type: 'MOVED', to_asset_user_id: (i % 2 === 0 ? REF.holderA : REF.holderB), remarks: 'CL2 race move' }));
  log('e_moved_two_holders', { moveAsset, histogram: hm });
} catch (e) { log('e_terminal', { error: String(e) }); }

// ---------- (f) same name x20: vendor / brand / item / category ----------
try {
  const hv = await burst(20, () => A('POST', '/api/masters/vendors', { name: 'CL2 Dup Vendor' }));
  const hb = await burst(20, () => A('POST', '/api/masters/brands', { name: 'CL2 Dup Brand' }));
  const hi = await burst(20, () => A('POST', '/api/items', { name: 'CL2 Dup Item', category_id: REF.category_it, subcategory_id: REF.subcat }));
  const hc = await burst(20, () => A('POST', '/api/masters/categories', { name: 'CL2 Dup Category', asset_domain: 'IT' }));
  log('f_dup_names', { vendor: hv, brand: hb, item: hi, category: hc });
} catch (e) { log('f_dup_names', { error: String(e) }); }

// ---------- (h) parallel refresh of ONE refresh cookie x20 ----------
try {
  await sleep(4000);
  const u = await login('CL2OTHER', creds.CL2OTHER.temp);
  const cookie = cookieHeader(u.refresh);
  const raw = await Promise.all(Array.from({ length: 20 }, () => req(API, 'POST', '/api/auth/refresh', { cookie }).catch(() => ({ status: 'ERR', setCookie: [] }))));
  const h = hist(raw.map(r => r.status));
  const setCookieCount = raw.filter(r => (r.setCookie || []).length > 0).length;
  log('h_parallel_refresh', { histogram: h, rotations_with_set_cookie: setCookieCount });
} catch (e) { log('h_parallel_refresh', { error: String(e) }); }

// ---------- (i) parallel PO create + deactivate + receive on same PO ----------
try {
  const po = await A('POST', '/api/purchase-orders/with-lines', { company_id: REF.company_id, po_number: 'CL2-PO-MIX-1', po_date: today, cost_center_id: REF.cost_center_id, vendor_id: REF.vendor_id, lines: [{ item_id: REF.item_noserial, quantity: 4, purchase_cost: 100 }] });
  const poId = po.json && po.json.id;
  const lineNo = po.json.lines[0].line_no ?? 1;
  const ops = [
    () => A('POST', `/api/purchase-orders/${poId}/receive`, { lines: [{ line_no: lineNo, quantity: 1, serial_mode: 'NO_SERIAL' }] }),
    () => A('DELETE', `/api/purchase-orders/${poId}`),
    () => A('POST', `/api/purchase-orders/${poId}/receive`, { lines: [{ line_no: lineNo, quantity: 1, serial_mode: 'NO_SERIAL' }] }),
    () => A('DELETE', `/api/purchase-orders/${poId}`),
  ];
  const raw = await Promise.all(Array.from({ length: 12 }, (_, i) => ops[i % ops.length]().then(r => r.status).catch(() => 'ERR')));
  log('i_po_create_deactivate_receive', { poId, histogram: hist(raw) });
} catch (e) { log('i_po_mix', { error: String(e) }); }

writeFileSync('D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build/docs/security/evidence/closure/retest2/sessions/raw/b_concurrency.json', JSON.stringify(results, null, 2));
console.log('\n=== PART B DONE ===');
