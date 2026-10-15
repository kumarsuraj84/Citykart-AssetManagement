// One-off probe: what does a minimal batch create / PO-with-lines create need on this stack? (creates RT- data as SECHO)
import { tok, req } from './lib.mjs';
const T = await tok('SECHO');
const today = new Date().toISOString().slice(0, 10);
const b = await req('POST', '/api/assets/batch', { token: T, headers: { 'Idempotency-Key': `rt-probe-batch-${Date.now()}` }, body: {
  item_id: 2, quantity: 1, received_into_asset_user_id: 3, cost_center_id: 1, company_id: 1, vendor_id: 2,
  serial_mode: 'NO_SERIAL', purchase_cost: 100, invoice_number: 'RT-INV-PROBE', invoice_date: today, invoice_amount: 100,
  description: 'RT probe chair', po_number: 'RT-PO-PROBE', po_date: today } });
console.log('batch', b.status, b.raw.slice(0, 400));
const p = await req('POST', '/api/purchase-orders/with-lines', { token: T, headers: { 'Idempotency-Key': `rt-probe-po-${Date.now()}` }, body: {
  company_id: 1, po_number: `RT-PO-PROBE-${Date.now().toString().slice(-5)}`, po_date: today, vendor_id: 2, cost_center_id: 1,
  delivery_asset_user_id: 3, lines: [{ item_id: 2, quantity: 2, purchase_cost: 100 }] } });
console.log('po', p.status, p.raw.slice(0, 600));
