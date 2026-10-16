-- CL2-IF item 6(a): the new database guards are live on ckam-sec (Alembic head c6e8a0b2d4f6).
-- Run as the app role `ckam` -- which in this Docker stack is a SUPERUSER, so this proves the TRIGGERS, not the
-- privilege model (that is item 6(b)). EVERY test runs in its own transaction that is ROLLED BACK: nothing changes.
--   docker exec -i ckam-sec-db-1 psql -U ckam -d ckam -X -v ON_ERROR_STOP=0 < db6a_guards_sec.sql
\set ON_ERROR_STOP 0
\pset pager off
\echo '== context'
SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
       (SELECT version_num FROM alembic_version) AS alembic_head;
SELECT id, status, current_asset_user_id, status_since FROM asset WHERE id IN (1, 3) ORDER BY id;

\echo '== T1 UPDATE asset.status without the marker (expect: refused)'
BEGIN; UPDATE asset SET status = 'LOST' WHERE id = 3; ROLLBACK;
\echo '== T2 UPDATE asset.current_asset_user_id without the marker (expect: refused)'
BEGIN; UPDATE asset SET current_asset_user_id = 21 WHERE id = 3; ROLLBACK;
\echo '== T3 UPDATE asset.status_since without the marker (expect: refused)'
BEGIN; UPDATE asset SET status_since = DATE '2000-01-01' WHERE id = 3; ROLLBACK;
\echo '== T4 bulk UPDATE of status on every asset (expect: refused, 0 rows changed)'
BEGIN; UPDATE asset SET status = 'DISPOSED'; ROLLBACK;
\echo '== T5 upsert path: INSERT .. ON CONFLICT DO UPDATE SET status (expect: refused)'
BEGIN; INSERT INTO asset SELECT * FROM asset WHERE id = 3 ON CONFLICT (id) DO UPDATE SET status = 'LOST'; ROLLBACK;
\echo '== T6 marker set to a wrong value (expect: refused)'
BEGIN; SELECT set_config('ckam.lifecycle_writer', 'ON ', true); UPDATE asset SET status = 'LOST' WHERE id = 3; ROLLBACK;
\echo '== T7 same value written back / ordinary column (expect: allowed, 1 row each)'
BEGIN; UPDATE asset SET status = status WHERE id = 3; UPDATE asset SET description = description || ' (r2c)' WHERE id = 3; ROLLBACK;
\echo '== T8 identity guard: asset_code / company change (expect: refused)'
BEGIN; UPDATE asset SET asset_code = asset_code || '-X' WHERE id = 3; ROLLBACK;
BEGIN; UPDATE asset SET company_id = 2 WHERE id = 3; ROLLBACK;
\echo '== T9 hard delete of an asset with ledger rows (expect: refused by FK or guard)'
BEGIN; DELETE FROM asset WHERE id = 3; ROLLBACK;

\echo '== T10 TRUNCATE each ledger (expect: refused x4, also for a superuser)'
BEGIN; TRUNCATE audit_log; ROLLBACK;
BEGIN; TRUNCATE asset_event CASCADE; ROLLBACK;
BEGIN; TRUNCATE master_audit; ROLLBACK;
BEGIN; TRUNCATE asset_field_change; ROLLBACK;
\echo '== T11 UPDATE each ledger (expect: refused x4)'
BEGIN; UPDATE audit_log SET outcome = 'X' WHERE id = (SELECT max(id) FROM audit_log); ROLLBACK;
BEGIN; UPDATE asset_event SET remarks = 'x' WHERE id = (SELECT max(id) FROM asset_event); ROLLBACK;
BEGIN; INSERT INTO master_audit (entity, entity_id, field, old_value, new_value, actor_id) VALUES ('r2c_probe', 1, 'name', 'a', 'b', 2); UPDATE master_audit SET new_value = 'forged' WHERE entity = 'r2c_probe'; ROLLBACK;
BEGIN; UPDATE asset_field_change SET field_name = field_name WHERE id = (SELECT max(id) FROM asset_field_change); ROLLBACK;
\echo '== T12 DELETE from each ledger (expect: refused x4)'
BEGIN; DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log); ROLLBACK;
BEGIN; DELETE FROM asset_event WHERE id = (SELECT max(id) FROM asset_event); ROLLBACK;
BEGIN; INSERT INTO master_audit (entity, entity_id, field, old_value, new_value, actor_id) VALUES ('r2c_probe', 1, 'name', 'a', 'b', 2); DELETE FROM master_audit WHERE entity = 'r2c_probe'; ROLLBACK;
BEGIN; DELETE FROM asset_field_change WHERE id = (SELECT max(id) FROM asset_field_change); ROLLBACK;
\echo '== T13 purge flag on, fresh audit row (expect: refused, no deletion)'
BEGIN; SET LOCAL ckam.allow_audit_purge = on; DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log); ROLLBACK;
BEGIN; SET LOCAL ckam.allow_audit_purge = on; DELETE FROM audit_log WHERE at > now() - interval '1 day'; ROLLBACK;
\echo '== T14 purge function with a recent cut-off (expect: refused)'
BEGIN; SET LOCAL ckam.allow_audit_purge = on; SELECT ckam_purge_audit_log(now()); ROLLBACK;
\echo '== T15 purge function with a legal cut-off (expect: allowed but 0 rows: no row is 5 years old)'
BEGIN; SET LOCAL ckam.allow_audit_purge = on; SELECT ckam_purge_audit_log(now() - interval '6 years') AS removed; ROLLBACK;
\echo '== T16 purge function without the flag (expect: refused)'
BEGIN; SELECT ckam_purge_audit_log(now() - interval '6 years'); ROLLBACK;
\echo '== T17 N9 residual: backdated insert then purge it (expect, documented: only the forged row goes)'
BEGIN;
INSERT INTO audit_log (at, category, action, outcome, summary) VALUES (now() - interval '6 years', 'SECURITY', 'R2C_PROBE', 'OK', 'cl2-if backdated probe');
SET LOCAL ckam.allow_audit_purge = on;
SELECT ckam_purge_audit_log(now() - interval '5 years 1 day') AS removed_only_forged_row;
ROLLBACK;

\echo '== LIMITS a superuser (or the table owner) still has -- expected to SUCCEED here, shown for honesty'
\echo '== L1 marker set by hand, then status change (documented limit of OBS-STATUS)'
BEGIN; SELECT set_config('ckam.lifecycle_writer', 'on', true); UPDATE asset SET status = 'LOST' WHERE id = 3; ROLLBACK;
\echo '== L2 superuser: session_replication_role = replica, then UPDATE a ledger row'
BEGIN; SET LOCAL session_replication_role = replica; UPDATE audit_log SET outcome = outcome WHERE id = (SELECT max(id) FROM audit_log); ROLLBACK;
\echo '== L3 owner/superuser: DISABLE TRIGGER then DELETE'
BEGIN; INSERT INTO master_audit (entity, entity_id, field, old_value, new_value, actor_id) VALUES ('r2c_probe', 1, 'name', 'a', 'b', 2); ALTER TABLE master_audit DISABLE TRIGGER trg_master_audit_no_delete; DELETE FROM master_audit WHERE entity = 'r2c_probe'; ROLLBACK;
\echo '== after: nothing changed'
SELECT id, status, current_asset_user_id, status_since, asset_code, company_id FROM asset WHERE id IN (1, 3) ORDER BY id;
SELECT (SELECT count(*) FROM audit_log) AS audit_rows, (SELECT count(*) FROM asset_event) AS events,
       (SELECT count(*) FROM master_audit) AS master_audit_rows, (SELECT count(*) FROM asset_field_change) AS field_changes;
SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal ORDER BY 1, 2;
