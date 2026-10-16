// RETEST2 ACCESS mass-assignment battery. Core target: the WP-B database guard on asset status/holder/date.
// No API write path may change asset.status / current_asset_user_id / status_since except the events endpoints.
// We inject those (and other protected fields) on create / update / correction / bulk, in body AND query string,
// then read the asset back and assert the protected fields are UNCHANGED and there is no 500 (stray ORM write).
// Also re-checks privilege fields on asset-user create/update. All objects tagged CL2 and cleaned up.
import { req, tok } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const out = [];
const rec = (id, desc, status, detail) => { out.push({ id, desc, status, detail }); console.log(id, status, desc, detail||''); };
const secho = await tok('SECHO');

// ---- create a clean CL2 target asset (CKSPL/IT laptop) ----
// ONLY fields that must never be client-settable (status/holder/date + lifecycle/audit internals).
// company_id/cost_center_id are legitimate AssetCreateIn fields, so they are NOT injected here.
const inj = {
  status: 'DISPOSED', current_asset_user_id: 99, status_since: '2000-01-01',
  is_active: false, token_version: 999, id: 987654, created_by: 99, updated_by: 99,
  recorded_by: 99, audit_actor: 99, created_at: '2000-01-01T00:00:00Z', deleted_at: '2000-01-01T00:00:00Z',
};
const createBody = {
  company_id: 1, cost_center_id: 1, item_id: 1, category_id: 1, subcategory_id: 1,
  description: 'CL2 mass-assign target', vendor_id: 1, initial_asset_user_id: 3,
  serial_pending: true, ...inj,
};
let r = await req('POST', '/api/assets', { token: secho, body: createBody });
rec('CL2-MA-create', 'create asset with injected status/holder/domain/company/id/token_version', r.status,
    r.status >= 300 ? r.raw.slice(0,160) : '');
let assetId = null;
if (Array.isArray(r.body) && r.body[0]) assetId = r.body[0].id;
else if (r.body && r.body.id) assetId = r.body.id;
let created = null;
if (assetId) {
  const g = await req('GET', `/api/assets/${assetId}`, { token: secho });
  created = g.body;
  rec('CL2-MA-create-verify', 'created asset actual state', g.status,
      JSON.stringify({ id: created.id, status: created.status, holder: created.current_asset_user_id ?? created.holder_id,
        company_id: created.company_id, domain: created.asset_domain ?? created.domain, status_since: created.status_since }));
}

// ---- PUT update with injected lifecycle + protected fields (body) ----
if (assetId) {
  const before = created;
  r = await req('PUT', `/api/assets/${assetId}`, { token: secho, body: {
    description: 'CL2 edited', model: 'CL2-model', ...inj } });
  rec('CL2-MA-put-body', 'PUT asset with injected status/holder/date/company/domain/is_active in body', r.status,
      r.status>=300?r.raw.slice(0,160):'');
  const g = await req('GET', `/api/assets/${assetId}`, { token: secho }); const a = g.body;
  const unchanged = a.status===before.status && (a.current_asset_user_id??a.holder_id)===(before.current_asset_user_id??before.holder_id)
    && a.company_id===before.company_id && (a.asset_domain??a.domain)===(before.asset_domain??before.domain) && a.is_active!==false;
  rec('CL2-MA-put-verify', 'protected fields unchanged after PUT (status/holder/company/domain/is_active)',
      unchanged ? 'IGNORED(ok)' : 'CHANGED(FAIL)',
      JSON.stringify({ status:a.status, holder:a.current_asset_user_id??a.holder_id, company_id:a.company_id, domain:a.asset_domain??a.domain, is_active:a.is_active }));
}

// ---- PUT with injected fields in QUERY STRING ----
if (assetId) {
  const before = (await req('GET', `/api/assets/${assetId}`, { token: secho })).body;
  r = await req('PUT', `/api/assets/${assetId}?status=DISPOSED&current_asset_user_id=99&status_since=2000-01-01&company_id=2&asset_domain=NON_IT`,
    { token: secho, body: { description: 'CL2 qs edit' } });
  rec('CL2-MA-put-query', 'PUT asset with protected fields in QUERY STRING', r.status, r.status>=300?r.raw.slice(0,120):'');
  const a = (await req('GET', `/api/assets/${assetId}`, { token: secho })).body;
  const unchanged = a.status===before.status && (a.current_asset_user_id??a.holder_id)===(before.current_asset_user_id??before.holder_id) && a.company_id===before.company_id;
  rec('CL2-MA-put-query-verify', 'protected fields unchanged after query-string injection', unchanged?'IGNORED(ok)':'CHANGED(FAIL)',
      JSON.stringify({ status:a.status, holder:a.current_asset_user_id??a.holder_id, company_id:a.company_id }));
}

// ---- POST corrections with injected status/holder ----
if (assetId) {
  const before = (await req('GET', `/api/assets/${assetId}`, { token: secho })).body;
  r = await req('POST', `/api/assets/${assetId}/corrections`, { token: secho, body: {
    reason: 'CL2 correction', status: 'ALLOTTED', current_asset_user_id: 21, status_since: '2000-01-01' } });
  rec('CL2-MA-correction', 'corrections with injected status/holder/date (no category/date change)', r.status, r.status>=300?r.raw.slice(0,140):'');
  const a = (await req('GET', `/api/assets/${assetId}`, { token: secho })).body;
  const unchanged = a.status===before.status && (a.current_asset_user_id??a.holder_id)===(before.current_asset_user_id??before.holder_id);
  rec('CL2-MA-correction-verify', 'status/holder unchanged after correction injection', unchanged?'IGNORED(ok)':'CHANGED(FAIL)',
      JSON.stringify({ status:a.status, holder:a.current_asset_user_id??a.holder_id }));
}

// ---- bulk-action / bulk-move with injected fields ----
if (assetId) {
  r = await req('POST', '/api/assets/bulk-action', { token: secho, body: {
    asset_ids: [assetId], event_type: 'MOVED', to_asset_user_id: 99999, status: 'DISPOSED',
    current_asset_user_id: 99, status_since: '2000-01-01' } });
  rec('CL2-MA-bulk-action', 'bulk-action with injected status/holder (invalid target) -> protected via schema', r.status, r.status>=300?r.raw.slice(0,140):'');
}

// ---- asset-user create: privilege-field mass assignment ----
r = await req('POST', '/api/asset-users', { token: secho, body: {
  company_id: 1, code: 'CL2MAUSER', name: 'CL2 MA User', asset_user_type: 'EMPLOYEE', location_id: 1,
  role: 'OPERATOR', login_enabled: true, allowed_asset_domains: 'IT',
  is_primary_owner: true, token_version: 777, password_hash: 'x', failed_login_count: 0,
  locked_until: null, must_change_password: false, id: 123456, is_active: true } });
rec('CL2-MA-user-create', 'asset-user create with is_primary_owner/token_version/password_hash/id injected', r.status, r.status>=300?r.raw.slice(0,140):'');
let uid = r.body && r.body.id;
if (uid) {
  const g = await req('GET', '/api/asset-users', { token: secho });
  const u = (g.body||[]).find(x=>x.id===uid);
  rec('CL2-MA-user-verify', 'created user is NOT primary owner, id auto-assigned', u ? 'checked' : 'not-found',
      JSON.stringify({ id: uid, injected_id: 123456, is_primary_owner: u ? u.is_primary_owner : '?' }));
  // try to escalate via PUT: role ADMIN + is_primary_owner + token_version
  r = await req('PUT', `/api/asset-users/${uid}`, { token: secho, body: { is_primary_owner: true, token_version: 5, role: 'ADMIN' } });
  rec('CL2-MA-user-escalate', 'PUT user is_primary_owner=true (role may change, PO flag must not via this route)', r.status,
      JSON.stringify({ is_primary_owner: r.body && r.body.is_primary_owner, role: r.body && r.body.role }));
  await req('DELETE', `/api/asset-users/${uid}`, { token: secho });
}

// ---- cleanup: soft-delete the CL2 asset (single PROCURED event -> deletable) ----
if (assetId) {
  const d = await req('DELETE', `/api/assets/${assetId}`, { token: secho });
  rec('CL2-MA-cleanup', 'soft-delete CL2 target asset', d.status, '');
}

writeFileSync(new URL('../raw/mass_assign.json', import.meta.url), JSON.stringify(out, null, 1));
