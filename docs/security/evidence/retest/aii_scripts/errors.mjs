// RT error-handling sweep: malformed input on auth + a few business routes -> no 5xx, no stack trace / SQL /
// file path in the body, every error carries a request id.
import { req, rec, session } from './lib.mjs';

const ho = await session('SECHO');
const op = await session('SECOPIT');
const LEAK = /Traceback|File "\/|sqlalchemy|asyncpg|psycopg|pydantic_core|line \d+, in|\/app\/app\//i;
const cases = [
  ['POST', '/api/auth/login', '{bad json', null],
  ['POST', '/api/auth/login', '{"login_id":"a","password":"b\\u0000c"}', null],
  ['POST', '/api/auth/login', '{"login_id":{"$ne":null},"password":"x"}', null],
  ['POST', '/api/auth/change-password', '{"old_password":1,"new_password":[1]}', 'op'],
  ['POST', '/api/auth/change-password', '{"old_password":"Sec#Test2026ok","new_password":"\\ud800\\udc00\\u0000abcdefgh"}', 'nocall'],
  ['GET', '/api/assets/99999999999999999999', null, 'ho'],
  ['GET', '/api/assets/-1', null, 'ho'],
  ['GET', '/api/assets/abc', null, 'ho'],
  ['GET', '/api/assets?limit=abc&sort_by=%00', null, 'ho'],
  ['GET', '/api/purchase-orders/1e309', null, 'ho'],
  ['PUT', '/api/asset-users/36', '{"role":"GOD"}', 'ho'],
  ['PUT', '/api/asset-users/36', '{"email":"not-an-email"}', 'ho'],
  ['POST', '/api/people/employees', '{"code":"' + 'X'.repeat(5000) + '","name":"y","company_id":1,"location_id":1}', 'ho'],
  ['POST', '/api/client-reports', '[]', 'op'],
  ['GET', '/api/admin/logs/audit?from=2026-13-45', null, 'ho'],
  ['GET', '/api/erp/pos/abc/draft', null, 'op'],
  ['GET', '/api/erp/pos/9002002/draft', null, 'op'],
  ['POST', '/api/documents/upload', 'x', 'op'],
];
let i = 0;
for (const [m, p, body, who] of cases) {
  i++;
  if (who === 'nocall') continue;
  const token = who === 'ho' ? ho.access : who === 'op' ? op.access : undefined;
  const r = await req(m, p, { token, body: body ?? undefined, headers: body ? { 'Content-Type': 'application/json' } : {} });
  const rid = r.body?.request_id || r.headers['x-request-id'];
  const leak = LEAK.test(r.raw);
  rec(`RT-AU-T5${String(i).padStart(2, '0')}`, 'error-handling', 'CWE-209', `${m} ${p.slice(0, 60)} malformed`, 'no 5xx, request id, no stack/SQL/path',
    `${r.status} rid=${rid ? 'yes' : 'no'} leak=${leak} ${String(r.body?.detail ?? '').slice(0, 80)}`, r.status < 500 && rid && !leak ? 'PASS' : 'FAIL', 'errors.mjs');
}
