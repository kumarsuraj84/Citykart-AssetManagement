-- IF-T append-only / privilege tests. EVERYTHING runs inside ONE transaction that is ROLLED BACK at the end.
-- psql's ON_ERROR_ROLLBACK wraps every statement in an implicit savepoint so an expected error does not abort the rest.
-- Run: psql -U ckam -d ckam -X -v ON_ERROR_STOP=0 -f db_03_append_only_privilege_tests.sql
\set ON_ERROR_ROLLBACK on
\set ON_ERROR_STOP off
BEGIN;
SELECT count(*) AS audit_rows_before FROM audit_log;
SELECT count(*) AS event_rows_before FROM asset_event;

\echo '### A. as the stack''s app role `ckam` (SUPERUSER + owner, exactly what the Docker stacks run as)'
\echo 'A1 UPDATE audit_log (expect trigger error)'
UPDATE audit_log SET summary = 'tampered' WHERE id = (SELECT max(id) FROM audit_log);
\echo 'A2 DELETE audit_log (expect trigger error)'
DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log);
\echo 'A3 UPDATE asset_event (expect trigger error)'
UPDATE asset_event SET remarks = 'tampered' WHERE id = (SELECT max(id) FROM asset_event);
\echo 'A4 DELETE master_audit / asset_field_change (expect trigger error)'
DELETE FROM master_audit WHERE id = (SELECT max(id) FROM master_audit);
DELETE FROM asset_field_change WHERE id = (SELECT max(id) FROM asset_field_change);
\echo 'A5 UPDATE asset.asset_code (expect immutability trigger error)'
UPDATE asset SET asset_code = asset_code || 'X' WHERE id = (SELECT min(id) FROM asset);
\echo 'A6 session flag bypass: SET LOCAL ckam.allow_audit_purge=on then DELETE the NEWEST audit row (no date limit)'
SET LOCAL ckam.allow_audit_purge = 'on';
WITH d AS (DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log) RETURNING id) SELECT count(*) AS a6_deleted_recent_audit_rows FROM d;
RESET ckam.allow_audit_purge;
\echo 'A7 TRUNCATE audit_log / master_audit / asset_field_change (row triggers do not fire on TRUNCATE)'
TRUNCATE audit_log;
SELECT count(*) AS a7_audit_rows_after_truncate FROM audit_log;
TRUNCATE master_audit;
TRUNCATE asset_field_change;
\echo 'A8 owner disables the append-only trigger, then rewrites history'
ALTER TABLE asset_event DISABLE TRIGGER trg_asset_event_no_update;
WITH u AS (UPDATE asset_event SET remarks = 'rewritten' WHERE id = (SELECT max(id) FROM asset_event) RETURNING id) SELECT count(*) AS a8_events_rewritten FROM u;
ALTER TABLE asset_event ENABLE TRIGGER trg_asset_event_no_update;
\echo 'A9 direct write of Asset.status outside apply_event (no DB-level guard)'
WITH u AS (UPDATE asset SET status = status WHERE id = (SELECT min(id) FROM asset) RETURNING id) SELECT count(*) AS a9_status_writable FROM u;

\echo '### B. least-privilege runtime role simulation (role created INSIDE this transaction, rolled back)'
CREATE ROLE ifsec_runtime NOLOGIN;
GRANT USAGE ON SCHEMA public TO ifsec_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ifsec_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ifsec_runtime;
SET LOCAL ROLE ifsec_runtime;
SELECT current_user AS b_role;
\echo 'B1 TRUNCATE audit_log (expect permission denied)'
TRUNCATE audit_log;
\echo 'B2 ALTER TABLE ... DISABLE TRIGGER (expect must be owner)'
ALTER TABLE asset_event DISABLE TRIGGER trg_asset_event_no_update;
\echo 'B3 DROP TABLE audit_log (expect must be owner)'
DROP TABLE audit_log;
\echo 'B4 CREATE TABLE in public (PG15+ default: denied for non-owner)'
CREATE TABLE ifsec_probe(x int);
\echo 'B5 execute ckam_purge_audit_log (expect permission denied: EXECUTE revoked from PUBLIC)'
SELECT ckam_purge_audit_log(now() - interval '2 days');
\echo 'B6 session flag bypass still works for a role holding plain DELETE on audit_log'
SET LOCAL ckam.allow_audit_purge = 'on';
WITH d AS (DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log) RETURNING id) SELECT count(*) AS b6_deleted FROM d;
RESET ckam.allow_audit_purge;
\echo 'B7 UPDATE audit_log (expect trigger error)'
UPDATE audit_log SET summary = 'x' WHERE id = (SELECT max(id) FROM audit_log);
RESET ROLE;

\echo '### C. non-superuser OWNER simulation (production runs alembic AND the app as ckassetapp = owner)'
CREATE ROLE ifsec_owner NOLOGIN;
ALTER TABLE audit_log OWNER TO ifsec_owner;
ALTER TABLE asset_event OWNER TO ifsec_owner;
SET LOCAL ROLE ifsec_owner;
\echo 'C1 owner TRUNCATE audit_log (expect success)'
TRUNCATE audit_log;
\echo 'C2 owner disables the asset_event append-only trigger (expect success)'
ALTER TABLE asset_event DISABLE TRIGGER trg_asset_event_no_delete;
\echo 'C3 owner DROPs the trigger (expect success)'
DROP TRIGGER trg_asset_event_no_update ON asset_event;
RESET ROLE;

SELECT count(*) AS audit_rows_end_of_txn FROM audit_log;
ROLLBACK;
SELECT count(*) AS audit_rows_after_rollback FROM audit_log;
SELECT count(*) AS event_rows_after_rollback FROM asset_event;
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'asset_event'::regclass AND NOT tgisinternal;
SELECT rolname FROM pg_roles WHERE rolname LIKE 'ifsec_%';
