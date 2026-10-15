// Classifies the retest matrix with the SAME intended-bucket model as the original analyze.mjs, writes
// authz_matrix_retest.csv (same columns as access/authz_matrix.csv) and diffs it cell by cell.
// usage: node analyze_retest.mjs <old authz_matrix.csv>
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync(new URL('./matrix_raw_retest.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
const PERSONAS = raw[0].split(',').slice(3);
const rows = raw.slice(1).map(l => { const p = l.split(','); return { method: p[0], path: p[1], cells: p.slice(3) }; });
const ROLE = { SECSELF: 'SELF', SECVIEW: 'VIEWER', SECOPIT: 'OP', SECOPNIT: 'OP', SECFAIT: 'ADMIN', SECFANIT: 'ADMIN', SECFABOTH: 'ADMIN', SECOTHER: 'OP', SECHO: 'ADMIN', NONE: 'NONE', MALFORMED: 'NONE' };
const IS_PO = { SECHO: true };

// --- bucket(): verbatim from access/analyze.mjs (the intended model of the ORIGINAL test)
function bucket(m, p) {
  if (p === '/api/health') return 'PUBLIC';
  if (p === '/api/auth/companies' && m === 'GET') return 'PUBLIC';
  if (p === '/api/auth/login' || p === '/api/auth/refresh' || p === '/api/auth/logout') return 'PUBLIC';
  if (p === '/assets/{file_path}' || p === '/{full_path}') return 'PUBLIC';
  if (p === '/api/auth/capabilities' || p === '/api/auth/change-password') return 'AUTH';
  if (p === '/api/asset-users/me/companies') return 'AUTH';
  if (p === '/api/client-reports' && m === 'POST') return 'AUTH';
  if (p === '/api/asset-users' && m === 'GET') return 'READ';
  if (p.startsWith('/api/asset-users')) { if (/\/primary-owner$/.test(p)) return 'PRIMARY_OWNER'; return 'ADMIN'; }
  if (p === '/api/stock-rooms' && m === 'POST') return 'SMALL_CREATE';
  if (p === '/api/stock-rooms' && m === 'GET') return 'WRITE';
  if (p === '/api/people' && m === 'GET') return 'READ';
  if (p === '/api/people/stores/ensure-rooms') return 'PRIMARY_OWNER';
  if (p.startsWith('/api/people/')) return 'DOMAIN_ADMIN';
  if (p.startsWith('/api/masters/')) {
    if (m === 'GET' && /\/(export|import\/template)$/.test(p)) return 'PRIMARY_OWNER';
    if (m === 'POST' && /\/import\/(preview|commit)$/.test(p)) return 'PRIMARY_OWNER';
    if (m === 'GET') return 'AUTH';
    if (/\/cost-centers/.test(p) || /\/brands/.test(p) || /\/vendors/.test(p)) return m === 'POST' && !/\{/.test(p) ? 'SMALL_CREATE' : 'PRIMARY_OWNER';
    if (/\/categories/.test(p) || /\/subcategories/.test(p)) return 'DOMAIN_ADMIN';
    if (/\/custom-fields/.test(p)) return 'PRIMARY_OWNER';
    return 'PRIMARY_OWNER';
  }
  if (p === '/api/code-rules' && m === 'GET') return 'AUTH';
  if (p === '/api/code-rules/preview') return 'AUTH';
  if (p.startsWith('/api/code-rules')) return 'PRIMARY_OWNER';
  if (p === '/api/assets/pick') return 'WRITE';
  if (p === '/api/assets/unlinked-items' || p === '/api/assets/link-items') return 'DOMAIN_ADMIN';
  if (p === '/api/assets/{asset_id}' && m === 'DELETE') return 'ADMIN';
  if (p.startsWith('/api/assets')) {
    const writePaths = m === 'POST' && (p === '/api/assets' || p === '/api/assets/batch' || p === '/api/assets/bulk-move' || p === '/api/assets/bulk-action' || /\/(corrections|events|documents)$/.test(p));
    if (writePaths || m === 'PUT') return 'WRITE';
    return 'AUTH';
  }
  if (p === '/api/documents/{doc_id}/download') return 'AUTH';
  if (p === '/api/reports/dashboard') return 'READ';
  if (p === '/api/reports/export/assets' || p === '/api/reports/assets/preview') return 'AUTH';
  if (p.startsWith('/api/reports/')) return 'READ';
  if (p.startsWith('/api/imports/')) return 'PRIMARY_OWNER';
  if (p.startsWith('/api/purchase-orders')) return 'WRITE';
  if (p === '/api/bundles' && m === 'GET') return 'AUTH';
  if (p.startsWith('/api/bundles')) return 'PRIMARY_OWNER';
  if (p.startsWith('/api/erp/')) {
    if (p === '/api/erp/status' || p === '/api/erp/sync' && m === 'GET') return 'WRITE';
    if (p === '/api/erp/sync' && m === 'POST') return 'PRIMARY_OWNER';
    if (p === '/api/erp/stores' || p === '/api/erp/stores/create') return 'PRIMARY_OWNER';
    if (p === '/api/erp/vendors' && m === 'GET') return 'PRIMARY_OWNER';
    if (/\/vendors\/import/.test(p) && m === 'POST') return 'SMALL_CREATE';
    if (/\/vendors\/\{vendor_id\}\/link/.test(p)) return m === 'DELETE' ? 'PRIMARY_OWNER' : 'SMALL_CREATE';
    if (p.startsWith('/api/erp/inbox')) return 'PRIMARY_OWNER';
    return 'WRITE';
  }
  if (p === '/api/items' && m === 'GET') return 'WRITE';
  if (p === '/api/items' && m === 'POST') return 'SMALL_CREATE';
  if (p === '/api/items/{item_id}') return 'DOMAIN_ADMIN';
  if (p === '/api/items/seed-from-subcategories') return 'PRIMARY_OWNER';
  if (p.startsWith('/api/items/articles') || p === '/api/items/codes' || p.startsWith('/api/items/maps')) return 'PRIMARY_OWNER';
  if (p.startsWith('/api/items')) return 'WRITE';
  if (p === '/api/setup/status') return 'ADMIN';
  if (p === '/api/home/attention') return 'READ';
  if (p.startsWith('/api/admin/')) return 'PRIMARY_OWNER';
  return 'UNKNOWN';
}
function expectAllow(b, persona) {
  const role = ROLE[persona], po = !!IS_PO[persona];
  if (role === 'NONE') return b === 'PUBLIC';
  switch (b) {
    case 'PUBLIC': case 'AUTH': return true;
    case 'READ': return ['VIEWER', 'OP', 'ADMIN'].includes(role);
    case 'WRITE': case 'SMALL_CREATE': return ['OP', 'ADMIN'].includes(role);
    case 'ADMIN': case 'DOMAIN_ADMIN': return role === 'ADMIN';
    case 'PRIMARY_OWNER': return po;
    default: return null;
  }
}
const denied = s => s === '401' || s === '403';
const out = [], escalations = [], brokenAuth = [];
for (const r of rows) {
  const b = bucket(r.method, r.path);
  const line = { method: r.method, path: r.path, bucket: b };
  PERSONAS.forEach((persona, i) => {
    const s = r.cells[i]; line[persona] = s;
    if (s === 'skip') return;
    const exp = expectAllow(b, persona);
    if (exp === false && !denied(s)) escalations.push(`${persona} ${r.method} ${r.path} [${b}] -> ${s}`);
    if (exp === true && denied(s) && b !== 'AUTH') brokenAuth.push(`${persona} ${r.method} ${r.path} [${b}] -> ${s}`);
  });
  out.push(line);
}
const COLS = { NONE: 'no_token', MALFORMED: 'malformed_token' };
const hdr = ['method', 'path', 'intended', ...PERSONAS.map(p => COLS[p] || p)];
const lines = [hdr.join(',')];
for (const l of out) lines.push([l.method, l.path, l.bucket, ...PERSONAS.map(p => l[p])].join(','));
writeFileSync(new URL('./authz_matrix_retest.csv', import.meta.url), lines.join('\n') + '\n');

const old = readFileSync(process.argv[2], 'utf8').trim().split(/\r?\n/);
const oh = old[0].split(',');
const oldMap = new Map(old.slice(1).map(l => { const p = l.split(','); return [`${p[0]} ${p[1]}`, p]; }));
const diffs = [];
for (const l of lines.slice(1)) {
  const p = l.split(','); const o = oldMap.get(`${p[0]} ${p[1]}`);
  if (!o) { diffs.push(`NEW-ROUTE ${p[0]} ${p[1]}`); continue; }
  for (let i = 3; i < hdr.length; i++) { const ov = o[oh.indexOf(hdr[i])]; if (ov !== p[i]) diffs.push([p[0], p[1], p[2], hdr[i], ov, p[i]].join(',')); }
}
writeFileSync(new URL('./authz_matrix_diff.csv', import.meta.url), ['method,path,intended,persona,old,new', ...diffs].join('\n') + '\n');
console.log('ESCALATIONS', escalations.length); escalations.forEach(e => console.log('  ', e));
console.log('ROLE-DENIED where role should pass', brokenAuth.length); brokenAuth.forEach(e => console.log('  ', e));
console.log('CHANGED CELLS', diffs.length); diffs.forEach(d => console.log('  ', d));
