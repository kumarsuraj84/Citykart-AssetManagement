// RETEST2 ACCESS: full role-guard matrix over EVERY route in /openapi.json x 14 identities.
// GET/read routes use REAL ids (so per-persona scope shows as 200 vs 403/404); mutating routes use FAKE ids
// (999001) so no real row is ever changed. Empty bodies on writes (role guard answers before body validation
// for denied personas). Paced endpoints spaced; one retry on 429. Tokens come from the cache (no new logins).
import { readFileSync, writeFileSync } from 'node:fs';
import { req, toks, sleep } from './lib.mjs';

const spec = JSON.parse(readFileSync('C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/r2/openapi.json'));
const PERSONAS = ['NONE','MALFORMED','SECSELF','SPA','SECVIEW','SECOPIT','SECOPNIT','SECOPX','SECFAIT','SECFANIT','SECFABOTH','SECOTHER','SECHO','SECMUST'];

const REAL = {
  asset_id:'1', po_id:'1', line_id:'6', line_no:'1', doc_id:'1', asset_user_id:'17',
  item_id:'1', rule_id:'1', bundle_id:'1', vendor_id:'1', map_id:'1', report_id:'1',
  po_code:'9001001', entity:'asset', entity_id:'1', request_id:'nonexistent-req-id',
  file_path:'index.js', full_path:'home',
};
const FAKE = {
  asset_id:'999001', po_id:'999001', line_id:'999001', line_no:'7', doc_id:'999001',
  asset_user_id:'999001', item_id:'999001', rule_id:'999001', bundle_id:'999001',
  vendor_id:'999001', map_id:'999001', report_id:'999001', po_code:'999999',
  entity:'asset', entity_id:'999001', request_id:'nonexistent-req-id',
  file_path:'index.js', full_path:'home',
};
const fillPath = (tpl, ids) => tpl.replace(/\{([^}]+)\}/g, (_, p) => ids[p] ?? '1');
function requiredQuery(op) {
  const qs = [];
  for (const p of op.parameters || []) {
    if (p.in === 'query' && p.required) {
      let v = '1';
      if (p.name === 'company_id') v = '1';
      else if (p.name === 'mode') v = 'assets';
      else if (p.name === 'kind') v = 'employees';
      else if (p.name === 'erp_vendor_code') v = 'SUP-SPL-1';
      else if (p.name === 'article_key') v = 'x';
      else if (p.name === 'from_date' || p.name === 'to_date') v = '2026-01-01';
      else if (p.name === 'quantity') v = '1';
      else if (p.name === 'level') v = 'INFO';
      else if (p.schema?.type === 'string') v = 'x';
      qs.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(v)}`);
    }
  }
  return qs.length ? '?' + qs.join('&') : '';
}
const MUT = new Set(['post','put','patch','delete']);
const PACED = new Set(['POST /api/auth/change-password','POST /api/auth/refresh']);

const tokens = { NONE:'NONE', MALFORMED:'MALFORMED', ...(await toks(PERSONAS.filter(p => p!=='NONE' && p!=='MALFORMED'))) };
const rows = [];
let rateLimited = [];
for (const path of Object.keys(spec.paths)) {
  for (const [method, op] of Object.entries(spec.paths[path])) {
    if (!['get','post','put','delete','patch'].includes(method)) continue;
    const mut = MUT.has(method);
    const concrete = fillPath(path, mut ? FAKE : REAL) + requiredQuery(op);
    const hasBody = !!op.requestBody;
    // bulk/expensive privileged POSTs: don't actually run them for the admin personas
    const skipPrivileged = (path === '/api/items/seed-from-subcategories' || path === '/api/erp/sync') && method === 'post';
    const paced = PACED.has(`${method.toUpperCase()} ${path}`);
    const cells = [];
    for (const c of PERSONAS) {
      if (skipPrivileged && ['SECHO','SECFAIT','SECFANIT','SECFABOTH','SECOPIT','SECOPNIT','SECOPX','SECOTHER'].includes(c)) { cells.push('skip'); continue; }
      let body;
      if (mut && hasBody) { const ct = op.requestBody.content || {}; body = ct['multipart/form-data'] ? undefined : {}; }
      if (paced) await sleep(6500);
      let r = await req(method.toUpperCase(), concrete, { token: tokens[c], body });
      if (r.status === 429) {
        rateLimited.push(`${method} ${path} ${c}`);
        await sleep((Number(r.headers.get('retry-after') || 30) + 1) * 1000);
        r = await req(method.toUpperCase(), concrete, { token: tokens[c], body });
      }
      cells.push(r.status);
    }
    rows.push({ method: method.toUpperCase(), path, hasBody, cells });
  }
}
const lines = [['method','path','req_body',...PERSONAS].join(',')];
for (const r of rows) lines.push([r.method, r.path, r.hasBody?'Y':'', ...r.cells].join(','));
writeFileSync(new URL('../raw/matrix_raw.csv', import.meta.url), lines.join('\n'));
console.log('rows:', rows.length, 'rate-limited(retried):', rateLimited.length, rateLimited.slice(0,10));
// sanity: the matrix must not have ended any persona's session
for (const c of PERSONAS.slice(2)) {
  const r = await req('GET','/api/auth/capabilities',{ token: tokens[c] });
  console.log('post-matrix cap', c, r.status);
}
