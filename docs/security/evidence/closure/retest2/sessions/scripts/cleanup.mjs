import { req, API, login } from './lib.mjs';
import { readFileSync } from 'node:fs';
const creds = JSON.parse(readFileSync(new URL('./creds.json', import.meta.url)));
const sec = await login('SECHO'); const T = sec.access;
const A = (m, p) => req(API, m, p, { token: T });
const done = [];

// soft-deactivate throw-away employees (ids 48-60)
for (const code of Object.keys(creds)) {
  const id = creds[code].id;
  const r = await A('DELETE', `/api/asset-users/${id}`);
  done.push(['employee', code, id, r.status]);
}
// soft-deactivate CL2- masters + POs found by name/number
async function deactivateByList(listPath, match, delPathFn, label) {
  const l = await A('GET', listPath);
  const rows = (l.json || []).filter(match);
  for (const row of rows) { const r = await A('DELETE', delPathFn(row.id)); done.push([label, row.name || row.po_number || row.id, row.id, r.status]); }
}
await deactivateByList('/api/masters/vendors', v => (v.name || '').startsWith('CL2'), id => `/api/masters/vendors/${id}`, 'vendor');
await deactivateByList('/api/masters/brands', v => (v.name || '').startsWith('CL2'), id => `/api/masters/brands/${id}`, 'brand');
await deactivateByList('/api/masters/categories', v => (v.name || '').startsWith('CL2'), id => `/api/masters/categories/${id}`, 'category');
await deactivateByList('/api/items', v => (v.name || '').startsWith('CL2'), id => `/api/items/${id}`, 'item');
await deactivateByList('/api/purchase-orders?limit=200', v => (v.po_number || '').startsWith('CL2-PO'), id => `/api/purchase-orders/${id}`, 'po');

console.log(JSON.stringify(done, null, 0));
console.log('cleanup rows:', done.length, '| note: burst-created CL2 assets are left in place on the throw-away stack (deactivating every asset via the lifecycle is out of scope and the stack is rebuilt).');
