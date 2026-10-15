-- RT AU-10 / IF-05 / IF-06: append-only guards after migration a3c5e7f9b1d4. Everything runs in ONE transaction that
-- is ROLLED BACK at the end; ON_ERROR_ROLLBACK wraps each statement in a savepoint so a refused one does not abort it.
\set ON_ERROR_ROLLBACK on
\set ECHO none
\pset pager off
SELECT current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
       (SELECT version_num FROM alembic_version) AS alembic_head;
SELECT tgrelid::regclass AS tbl, tgname, tgenabled FROM pg_trigger
 WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('audit_log','asset_event','master_audit','asset_field_change')
 ORDER BY 1, 2;
BEGIN;
SELECT (SELECT count(*) FROM audit_log) AS audit_before, (SELECT count(*) FROM asset_event) AS events_before,
       (SELECT count(*) FROM master_audit) AS master_before, (SELECT count(*) FROM asset_field_change) AS afc_before;
\echo '### T1 UPDATE audit_log (expect append-only error)'
UPDATE audit_log SET summary = 'tampered' WHERE id = (SELECT max(id) FROM audit_log);
\echo '### T2 DELETE audit_log newest row (expect error)'
DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log);
\echo '### T3 TRUNCATE audit_log (expect TRUNCATE not allowed)'
TRUNCATE audit_log;
\echo '### T4 UPDATE asset_event (expect error)'
UPDATE asset_event SET remarks = 'tampered' WHERE id = (SELECT max(id) FROM asset_event);
\echo '### T5 DELETE asset_event (expect error)'
DELETE FROM asset_event WHERE id = (SELECT max(id) FROM asset_event);
\echo '### T6 TRUNCATE asset_event (expect error)'
TRUNCATE asset_event CASCADE;
\echo '### T7 TRUNCATE master_audit (expect error)'
TRUNCATE master_audit;
\echo '### T8 TRUNCATE asset_field_change (expect error)'
TRUNCATE asset_field_change;
\echo '### T9 UPDATE/DELETE master_audit + asset_field_change (row triggers; tables may be empty -> 0 rows)'
UPDATE master_audit SET id = id WHERE id = (SELECT max(id) FROM master_audit);
DELETE FROM master_audit WHERE id = (SELECT max(id) FROM master_audit);
UPDATE asset_field_change SET id = id WHERE id = (SELECT max(id) FROM asset_field_change);
DELETE FROM asset_field_change WHERE id = (SELECT max(id) FROM asset_field_change);
\echo '### T10 IF-06: SET LOCAL ckam.allow_audit_purge=on then DELETE the newest audit row (expect error: floor 5 y)'
SET LOCAL ckam.allow_audit_purge = on;
DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log);
\echo '### T11 same flag: DELETE all rows younger than 5 years (expect error)'
DELETE FROM audit_log WHERE at > now() - interval '5 years';
\echo '### T12 same flag: plant a 6-year-old row? (INSERT allowed; then DELETE it -> allowed by design)'
INSERT INTO audit_log (at, category, action, outcome, summary)
  SELECT now() - interval '6 years', category, action, outcome, 'RT probe old row' FROM audit_log ORDER BY id DESC LIMIT 1
  RETURNING id AS planted_old_id;
DELETE FROM audit_log WHERE summary = 'RT probe old row';
\echo '### T13 backdate: INSERT a row claiming at = now()-6y is accepted (no check on at) -> it could later be purged'
\echo '### T14 ckam_purge_audit_log with cut-off = now() (expect refused: needs >= 5 years)'
SELECT ckam_purge_audit_log(now());
\echo '### T15 ckam_purge_audit_log cut-off now()-4y11m (expect refused)'
SELECT ckam_purge_audit_log(now() - interval '4 years 11 months');
\echo '### T16 ckam_purge_audit_log cut-off now()-6y (allowed by design; removes only rows older than that)'
SELECT ckam_purge_audit_log(now() - interval '6 years') AS purged_old_rows;
\echo '### T17 ckam_purge_audit_log without the flag (expect refused)'
RESET ckam.allow_audit_purge;
SET LOCAL ckam.allow_audit_purge = off;
SELECT ckam_purge_audit_log(now() - interval '6 years');
\echo '### T18 EXECUTE privilege on purge function: PUBLIC revoked?'
SELECT p.proname, p.proacl FROM pg_proc p WHERE proname = 'ckam_purge_audit_log';
\echo '### T19 RESIDUAL: owner/superuser can disable the TRUNCATE trigger and then truncate (inside this rolled-back txn)'
ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_no_truncate;
TRUNCATE audit_log;
SELECT count(*) AS audit_rows_after_owner_bypass FROM audit_log;
\echo '### T20 RESIDUAL: superuser session_replication_role=replica skips the triggers'
SET LOCAL session_replication_role = replica;
DELETE FROM asset_event WHERE id = (SELECT max(id) FROM asset_event);
SET LOCAL session_replication_role = origin;
\echo '### T21 least-privilege runtime role simulation (created in this txn): TRUNCATE/DISABLE TRIGGER/DROP/purge'
CREATE ROLE rt_runtime_probe NOLOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log, asset_event, master_audit, asset_field_change TO rt_runtime_probe;
SET LOCAL ROLE rt_runtime_probe;
TRUNCATE asset_event;
ALTER TABLE asset_event DISABLE TRIGGER trg_asset_event_no_update;
SELECT ckam_purge_audit_log(now() - interval '6 years');
SET LOCAL ckam.allow_audit_purge = on;
DELETE FROM asset_event WHERE id = (SELECT max(id) FROM asset_event);
RESET ROLE;
ROLLBACK;
\echo '### after ROLLBACK'
SELECT (SELECT count(*) FROM audit_log) AS audit_after, (SELECT count(*) FROM asset_event) AS events_after,
       (SELECT count(*) FROM pg_roles WHERE rolname = 'rt_runtime_probe') AS probe_role_left,
       (SELECT count(*) FROM audit_log WHERE summary = 'RT probe old row') AS planted_left;
SELECT tgrelid::regclass AS tbl, tgname, tgenabled FROM pg_trigger
 WHERE NOT tgisinternal AND tgname LIKE '%truncate%' ORDER BY 1;
