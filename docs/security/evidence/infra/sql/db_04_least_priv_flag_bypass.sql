-- IF-T: least-privilege runtime role (SELECT/INSERT/UPDATE/DELETE only, no ownership) vs the audit_log
-- "purge flag": can it delete RECENT audit rows by setting the custom GUC itself? Rolled back.
\set ON_ERROR_ROLLBACK on
\set ON_ERROR_STOP off
BEGIN;
SELECT count(*) AS audit_rows, max(id) AS newest_id, max(at) AS newest_at FROM audit_log;
SELECT count(*) AS master_audit_rows FROM master_audit;
SELECT count(*) AS asset_field_change_rows FROM asset_field_change;
CREATE ROLE ifsec_runtime2 NOLOGIN;
GRANT USAGE ON SCHEMA public TO ifsec_runtime2;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ifsec_runtime2;
SET LOCAL ROLE ifsec_runtime2;
\echo 'D1 DELETE newest audit row without flag (expect trigger error)'
DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log);
\echo 'D2 SET LOCAL ckam.allow_audit_purge=on, then DELETE the 10 newest audit rows (any role can set a custom GUC)'
SET LOCAL ckam.allow_audit_purge = 'on';
WITH d AS (DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT 10) RETURNING id, at)
SELECT count(*) AS d2_deleted, min(at) AS oldest_deleted_at, max(at) AS newest_deleted_at FROM d;
\echo 'D3 same flag does NOT open asset_event (expect trigger error)'
DELETE FROM asset_event WHERE id = (SELECT max(id) FROM asset_event);
RESET ckam.allow_audit_purge;
RESET ROLE;
ROLLBACK;
SELECT count(*) AS audit_rows_after_rollback FROM audit_log;
SELECT rolname FROM pg_roles WHERE rolname LIKE 'ifsec_%';
