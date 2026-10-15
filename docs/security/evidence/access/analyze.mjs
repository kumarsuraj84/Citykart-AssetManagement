import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync(new URL('./matrix_raw.csv', import.meta.url), 'utf8').trim().split('\n');
const header = raw[0].split(',');
const PERSONAS = header.slice(3);
const rows = raw.slice(1).map(l => {
  const parts = l.split(',');
  return { method: parts[0], path: parts[1], hasBody: parts[2], cells: parts.slice(3) };
});

// persona role model
const ROLE = { SECSELF: 'SELF', SECVIEW: 'VIEWER', SECOPIT: 'OP', SECOPNIT: 'OP', SECFAIT: 'ADMIN', SECFANIT: 'ADMIN', SECFABOTH: 'ADMIN', SECOTHER: 'OP', SECHO: 'ADMIN', NONE: 'NONE', MALFORMED: 'NONE' };
const IS_PO = { SECHO: true };

// intended bucket per route
function bucket(method, path) {
  const m = method, p = path;
  const is = (mm, re) => m === mm && re.test(p);
  // PUBLIC
  if (p === '/api/health') return 'PUBLIC';
  if (p === '/api/auth/companies' && m === 'GET') return 'PUBLIC';
  if (p === '/api/auth/login' || p === '/api/auth/refresh' || p === '/api/auth/logout') return 'PUBLIC';
  if (p === '/assets/{file_path}' || p === '/{full_path}') return 'PUBLIC';
  // AUTH
  if (p === '/api/auth/capabilities' || p === '/api/auth/change-password') return 'AUTH';
  if (p === '/api/asset-users/me/companies') return 'AUTH';
  if (p === '/api/client-reports' && m === 'POST') return 'AUTH';
  // asset-users
  if (p === '/api/asset-users' && m === 'GET') return 'READ';
  if (p.startsWith('/api/asset-users')) {
    if (/\/primary-owner$/.test(p)) return 'PRIMARY_OWNER';
    return 'ADMIN'; // export/import/create/update/delete/issue-passwords/reset-password/company-access
  }
  // stock-rooms
  if (p === '/api/stock-rooms' && m === 'POST') return 'SMALL_CREATE';
  if (p === '/api/stock-rooms' && m === 'GET') return 'WRITE';
  // people
  if (p === '/api/people' && m === 'GET') return 'READ';
  if (p === '/api/people/stores/ensure-rooms') return 'PRIMARY_OWNER';
  if (p.startsWith('/api/people/')) return 'DOMAIN_ADMIN';
  // masters
  if (p.startsWith('/api/masters/')) {
    if (m === 'GET' && /\/(export|import\/template)$/.test(p)) return 'PRIMARY_OWNER';
    if (m === 'POST' && /\/import\/(preview|commit)$/.test(p)) return 'PRIMARY_OWNER';
    if (m === 'GET') return 'AUTH'; // list
    // write (POST create / PUT / DELETE)
    if (/\/cost-centers/.test(p) || /\/brands/.test(p) || /\/vendors/.test(p)) {
      return m === 'POST' && !/\{/.test(p) ? 'SMALL_CREATE' : 'PRIMARY_OWNER';
    }
    if (/\/categories/.test(p) || /\/subcategories/.test(p)) return 'DOMAIN_ADMIN';
    if (/\/custom-fields/.test(p)) return 'PRIMARY_OWNER';
    // companies / locations / departments
    return 'PRIMARY_OWNER';
  }
  // code-rules
  if (p === '/api/code-rules' && m === 'GET') return 'AUTH';
  if (p === '/api/code-rules/preview') return 'AUTH';
  if (p.startsWith('/api/code-rules')) return 'PRIMARY_OWNER';
  // assets
  if (p === '/api/assets/pick') return 'WRITE';
  if (p === '/api/assets/unlinked-items' || p === '/api/assets/link-items') return 'DOMAIN_ADMIN';
  if (p === '/api/assets/{asset_id}' && m === 'DELETE') return 'ADMIN';
  if (p.startsWith('/api/assets')) {
    const writePaths = m === 'POST' && (p === '/api/assets' || p === '/api/assets/batch' || p === '/api/assets/bulk-move' || p === '/api/assets/bulk-action' || /\/(corrections|events|documents)$/.test(p));
    const writePut = m === 'PUT';
    if (writePaths || writePut) return 'WRITE';
    return 'AUTH'; // GET list/detail/changes/qr/label/events/documents
  }
  if (p === '/api/documents/{doc_id}/download') return 'AUTH';
  // reports
  if (p === '/api/reports/dashboard') return 'READ';
  if (p === '/api/reports/export/assets' || p === '/api/reports/assets/preview') return 'AUTH';
  if (p.startsWith('/api/reports/')) return 'READ';
  // imports
  if (p.startsWith('/api/imports/')) return 'PRIMARY_OWNER';
  // purchase-orders -> all WRITE
  if (p.startsWith('/api/purchase-orders')) return 'WRITE';
  // bundles
  if (p === '/api/bundles' && m === 'GET') return 'AUTH';
  if (p.startsWith('/api/bundles')) return 'PRIMARY_OWNER';
  // erp
  if (p.startsWith('/api/erp/')) {
    if (p === '/api/erp/status' || p === '/api/erp/sync' && m === 'GET') return 'WRITE';
    if (p === '/api/erp/sync' && m === 'POST') return 'PRIMARY_OWNER';
    if (p === '/api/erp/stores' || p === '/api/erp/stores/create') return 'PRIMARY_OWNER';
    if (p === '/api/erp/vendors' && m === 'GET') return 'PRIMARY_OWNER';
    if (/\/vendors\/import/.test(p) && m === 'POST') return 'SMALL_CREATE';
    if (/\/vendors\/\{vendor_id\}\/link/.test(p)) return m === 'DELETE' ? 'PRIMARY_OWNER' : 'SMALL_CREATE';
    if (p.startsWith('/api/erp/inbox')) return 'PRIMARY_OWNER';
    if (p === '/api/erp/reminders' || p === '/api/erp/changes/summary') return 'WRITE';
    if (/\/purchase-orders\//.test(p)) return 'WRITE';
    if (p.startsWith('/api/erp/pos')) return 'WRITE';
    return 'WRITE';
  }
  // items
  if (p === '/api/items' && m === 'GET') return 'WRITE';
  if (p === '/api/items' && m === 'POST') return 'SMALL_CREATE';
  if (p === '/api/items/{item_id}') return 'DOMAIN_ADMIN';
  if (p === '/api/items/seed-from-subcategories') return 'PRIMARY_OWNER';
  if (p.startsWith('/api/items/articles') || p === '/api/items/codes' || p.startsWith('/api/items/maps')) return 'PRIMARY_OWNER';
  if (p.startsWith('/api/items')) return 'WRITE';
  // setup/home
  if (p === '/api/setup/status') return 'ADMIN';
  if (p === '/api/home/attention') return 'READ';
  // admin
  if (p.startsWith('/api/admin/')) return 'PRIMARY_OWNER';
  return 'UNKNOWN';
}

// expected ALLOW (guard passes) at role-guard level
function expectAllow(b, persona) {
  const role = ROLE[persona];
  const po = !!IS_PO[persona];
  if (role === 'NONE') return b === 'PUBLIC';
  switch (b) {
    case 'PUBLIC': return true;
    case 'AUTH': return true;
    case 'READ': return ['VIEWER', 'OP', 'ADMIN'].includes(role);
    case 'WRITE': return ['OP', 'ADMIN'].includes(role);
    case 'SMALL_CREATE': return ['OP', 'ADMIN'].includes(role);
    case 'ADMIN': return role === 'ADMIN';
    case 'DOMAIN_ADMIN': return role === 'ADMIN';
    case 'PRIMARY_OWNER': return po;
    default: return null;
  }
}

const denied = s => s === '401' || s === '403';
const out = [];
const escalations = [];
const brokenAuth = [];
for (const r of rows) {
  const b = bucket(r.method, r.path);
  const line = { method: r.method, path: r.path, bucket: b };
  for (let i = 0; i < PERSONAS.length; i++) {
    const persona = PERSONAS[i];
    const s = r.cells[i];
    line[persona] = s;
    if (s === 'skip') continue;
    const exp = expectAllow(b, persona);
    if (exp === false && !denied(s)) {
      // underprivileged persona was ALLOWED past the guard -> potential escalation
      escalations.push({ method: r.method, path: r.path, bucket: b, persona, status: s });
    }
    if (exp === true && denied(s) && b !== 'AUTH') {
      // persona that should be allowed by role was denied at guard level
      // (AUTH excluded: scope-filtered reads legitimately 403/404 per resource)
      brokenAuth.push({ method: r.method, path: r.path, bucket: b, persona, status: s });
    }
  }
  out.push(line);
}

// write annotated matrix
const hdr = ['method', 'path', 'bucket', ...PERSONAS];
const lines = [hdr.join(',')];
for (const l of out) lines.push(hdr.map(h => l[h]).join(','));
writeFileSync(new URL('./authz_matrix.csv', import.meta.url), lines.join('\n'));

console.log('=== ESCALATIONS (underprivileged allowed past guard) ===', escalations.length);
for (const e of escalations) console.log(`  ${e.persona} ${e.method} ${e.path} [${e.bucket}] -> ${e.status}`);
console.log('\n=== ROLE-DENIED where role should pass (non-AUTH) ===', brokenAuth.length);
for (const e of brokenAuth) console.log(`  ${e.persona} ${e.method} ${e.path} [${e.bucket}] -> ${e.status}`);
console.log('\nUNKNOWN buckets:');
for (const l of out) if (l.bucket === 'UNKNOWN') console.log('  ', l.method, l.path);
