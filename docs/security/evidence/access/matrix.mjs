import { readFileSync, writeFileSync } from 'node:fs';
import { API, PW, login, req } from './lib.mjs';

const spec = JSON.parse(readFileSync(new URL('./openapi.json', import.meta.url)));

// Columns of the matrix
const PERSONAS = ['NONE', 'MALFORMED', 'SECSELF', 'SECVIEW', 'SECOPIT', 'SECOPNIT', 'SECFAIT', 'SECFANIT', 'SECFABOTH', 'SECOTHER', 'SECHO'];

// Real ids (existing fixture objects) for GET reads so an authorized read is 200.
const REAL = {
  asset_id: '2', po_id: '1', line_id: '6', line_no: '1', doc_id: '1', asset_user_id: '17',
  item_id: '1', rule_id: '1', bundle_id: '1', vendor_id: '1', map_id: '1', report_id: '1',
  po_code: '9001001', entity: 'asset', entity_id: '1', request_id: 'nonexistent-req-id',
  file_path: 'index.js', full_path: 'home',
};
// Non-existent ids for MUTATIONS so we never change fixtures; still preserves 401/403-vs-other signal.
const FAKE = {
  asset_id: '999001', po_id: '999001', line_id: '999001', line_no: '7', doc_id: '999001',
  asset_user_id: '999001', item_id: '999001', rule_id: '999001', bundle_id: '999001',
  vendor_id: '999001', map_id: '999001', report_id: '999001', po_code: '999999',
  entity: 'asset', entity_id: '999001', request_id: 'nonexistent-req-id',
  file_path: 'index.js', full_path: 'home',
};

function fillPath(tpl, ids) {
  return tpl.replace(/\{([^}]+)\}/g, (_, p) => ids[p] ?? '1');
}

function requiredQuery(op) {
  const qs = [];
  for (const p of op.parameters || []) {
    if (p.in === 'query' && p.required) {
      let v = '1';
      if (p.name === 'company_id') v = '1';
      else if (p.name === 'mode') v = 'assets';
      else if (p.schema?.type === 'string') v = 'x';
      qs.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(v)}`);
    }
  }
  return qs.length ? '?' + qs.join('&') : '';
}

const MUT = new Set(['post', 'put', 'patch', 'delete']);

async function main() {
  const tokens = { NONE: 'NONE', MALFORMED: 'MALFORMED' };
  for (const c of PERSONAS) {
    if (c === 'NONE' || c === 'MALFORMED') continue;
    const r = await login(c);
    tokens[c] = r.body.access_token;
  }

  const rows = [];
  const header = ['method', 'path', 'req_body', ...PERSONAS];
  const paths = Object.keys(spec.paths);
  for (const path of paths) {
    for (const [method, op] of Object.entries(spec.paths[path])) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      const mut = MUT.has(method);
      const ids = mut ? FAKE : REAL;
      const concrete = fillPath(path, ids) + requiredQuery(op);
      const hasBody = !!op.requestBody;
      // Bodyless, no-id mutating endpoints that would actually write if executed by a
      // privileged persona: run them for the deny-personas (expect 403) but skip the
      // SECHO execution to avoid mutating fixtures.
      const skipForPrivileged = (path === '/api/items/seed-from-subcategories' || path === '/api/erp/sync') && method === 'post';
      const cells = [];
      for (const c of PERSONAS) {
        if (skipForPrivileged && c === 'SECHO') { cells.push('skip'); continue; }
        let body;
        let headers;
        if (mut && hasBody) {
          // form uploads need multipart; send empty json otherwise
          const ct = op.requestBody.content || {};
          if (ct['multipart/form-data']) { body = undefined; } else { body = {}; }
        }
        const r = await req(method.toUpperCase(), concrete, { token: tokens[c], body, headers });
        cells.push(r.status);
      }
      rows.push({ method: method.toUpperCase(), path, hasBody, cells });
    }
  }

  // write CSV
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.method, r.path, r.hasBody ? 'Y' : '', ...r.cells].join(','));
  }
  writeFileSync(new URL('./matrix_raw.csv', import.meta.url), lines.join('\n'));
  console.log('rows:', rows.length);
  // quick summary: for each persona, count of 2xx and of 401/403
  for (let i = 0; i < PERSONAS.length; i++) {
    let ok = 0, denied = 0, other = 0;
    for (const r of rows) {
      const s = r.cells[i];
      if (s >= 200 && s < 300) ok++;
      else if (s === 401 || s === 403) denied++;
      else other++;
    }
    console.log(PERSONAS[i].padEnd(11), '2xx=' + ok, 'den=' + denied, 'other=' + other);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
