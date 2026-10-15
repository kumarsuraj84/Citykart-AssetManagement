\echo == duplicate asset codes ==
SELECT asset_code, count(*) FROM asset GROUP BY asset_code HAVING count(*)>1;
\echo == duplicate active serials (not N/A) ==
SELECT serial_number, count(*) FROM asset WHERE serial_number IS NOT NULL AND serial_number<>'N/A' AND deleted_at IS NULL GROUP BY serial_number HAVING count(*)>1;
\echo == asset status vs last event consistency (sample mismatches) ==
SELECT a.id, a.status, e.event_type FROM asset a
  LEFT JOIN LATERAL (SELECT event_type FROM asset_event WHERE asset_id=a.id ORDER BY event_date DESC, id DESC LIMIT 1) e ON true
  WHERE a.id IN (1,2,3,4,5,6,7,8,9,10,11,12);
\echo == cross-company holder (asset.company vs holder.company) ==
SELECT a.id, a.company_id, au.company_id AS holder_company FROM asset a JOIN asset_user au ON au.id=a.current_asset_user_id WHERE a.current_asset_user_id IS NOT NULL AND au.company_id<>a.company_id;
\echo == stray throwaway users left active (SEC-MASS / SEC-WIDE) ==
SELECT id, code, name, is_active, is_primary_owner, role FROM asset_user WHERE code LIKE 'SEC-MASS%' OR code LIKE 'SEC-WIDE%' OR name LIKE '%Probe%';
\echo == primary owner count ==
SELECT count(*) FROM asset_user WHERE is_primary_owner=true;
\echo == asset 3 current state (mass-assign target) ==
SELECT id, asset_code, status, company_id, asset_domain, current_asset_user_id, is_active, cost_center_id FROM asset WHERE id=3;
\echo == po numbers duplicate check ==
SELECT po_number, count(*) FROM purchase_order GROUP BY po_number HAVING count(*)>1;
\echo == idempotency rows from my tests (actor_id of SECOTHER=26) ==
SELECT actor_id, key, path, status_code FROM idempotency_key WHERE actor_id IN (26) OR key LIKE 'sec-seed%' ORDER BY actor_id;
