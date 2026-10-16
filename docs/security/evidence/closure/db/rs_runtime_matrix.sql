-- WP-B local simulation: what the RUNTIME role can and cannot do after the role split.
-- Run as the runtime role (throw-away database ckam_rs, role ckam_rs_app), autocommit, ON_ERROR_STOP off:
--   psql -X -e -U ckam_rs_app -d ckam_rs -f rs_runtime_matrix.sql
-- Every CANNOT line must end in an ERROR; every CAN line must succeed.
\set ON_ERROR_STOP off
\pset pager off

\echo '==================== CAN (what the application needs) ===================='
\echo '[CAN-01] who am I'
SELECT current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser;
\echo '[CAN-02] read ordinary tables, ledgers and alembic_version'
SELECT (SELECT count(*) FROM asset) AS assets, (SELECT count(*) FROM asset_event) AS events,
       (SELECT count(*) FROM audit_log) AS audit_rows, (SELECT version_num FROM alembic_version) AS head;
\echo '[CAN-03] add an audit row (append-only tables: INSERT allowed)'
INSERT INTO audit_log (source, category, action, summary, outcome, is_head_office_admin)
VALUES ('api', 'DATA', 'UPDATE', 'WP-B matrix: runtime role adds an audit row', 'OK', false) RETURNING id;
\echo '[CAN-04] edit an ordinary asset column'
UPDATE asset SET description = description || ' (matrix)' WHERE id = (SELECT min(id) FROM asset) RETURNING id, description;
\echo '[CAN-05] delete from an ordinary table (expired sign-in sessions)'
DELETE FROM auth_session WHERE revoked_at IS NOT NULL;
\echo '[CAN-06] use a sequence'
SELECT nextval(pg_get_serial_sequence('vendor', 'id')) > 0 AS sequence_ok;
\echo '[CAN-07] HONEST LIMIT: the runtime role can also set the OBS-STATUS marker (defence in depth, not a barrier)'
BEGIN;
SELECT set_config('ckam.lifecycle_writer', 'on', true);
UPDATE asset SET status = 'LOST' WHERE id = (SELECT min(id) FROM asset) RETURNING id, status;
ROLLBACK;

\echo '==================== CANNOT ===================='
\echo '[CANNOT-01] TRUNCATE audit_log'
TRUNCATE audit_log;
\echo '[CANNOT-02] TRUNCATE asset_event'
TRUNCATE asset_event;
\echo '[CANNOT-03] TRUNCATE master_audit'
TRUNCATE master_audit;
\echo '[CANNOT-04] TRUNCATE asset_field_change'
TRUNCATE asset_field_change;
\echo '[CANNOT-05] TRUNCATE an ordinary table'
TRUNCATE asset CASCADE;
\echo '[CANNOT-06] ALTER TABLE (add a column)'
ALTER TABLE asset ADD COLUMN wpb_evil integer;
\echo '[CANNOT-07] DISABLE TRIGGER ALL on asset_event'
ALTER TABLE asset_event DISABLE TRIGGER ALL;
\echo '[CANNOT-08] DISABLE the audit_log delete guard'
ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_no_delete;
\echo '[CANNOT-09] DISABLE the OBS-STATUS asset guard'
ALTER TABLE asset DISABLE TRIGGER trg_asset_lifecycle_fields_guard;
\echo '[CANNOT-10] ENABLE REPLICA (= switch off in normal sessions) the OBS-STATUS asset guard'
ALTER TABLE asset ENABLE REPLICA TRIGGER trg_asset_lifecycle_fields_guard;
\echo '[CANNOT-11] DROP the OBS-STATUS asset guard'
DROP TRIGGER trg_asset_lifecycle_fields_guard ON asset;
\echo '[CANNOT-12] DROP the audit_log TRUNCATE guard'
DROP TRIGGER trg_audit_log_no_truncate ON audit_log;
\echo '[CANNOT-13] DROP TABLE audit_log'
DROP TABLE audit_log;
\echo '[CANNOT-14] replace a guard trigger function'
CREATE OR REPLACE FUNCTION forbid_audit_log_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$;
\echo '[CANNOT-15] add a trigger of its own'
CREATE TRIGGER wpb_evil BEFORE DELETE ON asset FOR EACH ROW EXECUTE FUNCTION forbid_asset_event_write();
\echo '[CANNOT-16] CREATE TABLE in schema public'
CREATE TABLE public.wpb_evil (id integer);
\echo '[CANNOT-17] CREATE SCHEMA'
CREATE SCHEMA wpb_evil;
\echo '[CANNOT-18] CREATE TEMP TABLE'
CREATE TEMP TABLE wpb_tmp (id integer);
\echo '[CANNOT-19] SET session_replication_role = replica (would skip every guard trigger)'
SET session_replication_role = replica;
\echo '[CANNOT-20] run the audit purge function'
SELECT ckam_purge_audit_log(now() - interval '6 years');
\echo '[CANNOT-21] UPDATE audit_log'
UPDATE audit_log SET summary = 'rewritten';
\echo '[CANNOT-22] DELETE FROM audit_log'
DELETE FROM audit_log;
\echo '[CANNOT-23] purge flag on, then DELETE fresh audit rows'
BEGIN;
SET LOCAL ckam.allow_audit_purge = 'on';
DELETE FROM audit_log WHERE at > now() - interval '1 day';
ROLLBACK;
\echo '[CANNOT-24] UPDATE asset_event'
UPDATE asset_event SET remarks = 'rewritten';
\echo '[CANNOT-25] DELETE FROM asset_event'
DELETE FROM asset_event;
\echo '[CANNOT-26] DELETE FROM master_audit'
DELETE FROM master_audit;
\echo '[CANNOT-27] UPDATE asset_field_change'
UPDATE asset_field_change SET new_value = 'rewritten';
\echo '[CANNOT-28] UPDATE alembic_version'
UPDATE alembic_version SET version_num = 'ffffffffffff';
\echo '[CANNOT-29] DELETE FROM alembic_version'
DELETE FROM alembic_version;
\echo '[CANNOT-30] INSERT INTO alembic_version'
INSERT INTO alembic_version VALUES ('ffffffffffff');
\echo '[CANNOT-31] CREATE ROLE'
CREATE ROLE wpb_evil;
\echo '[CANNOT-32] CREATE EXTENSION (pgcrypto is a "trusted" extension, still refused without CREATE on the database)'
CREATE EXTENSION pgcrypto;
\echo '[CANNOT-33] CREATE DATABASE'
CREATE DATABASE wpb_evil;
\echo '[CANNOT-34] SET ROLE to the owner'
SET ROLE ckam_rs_owner;
\echo '[CANNOT-35] SET ROLE to the migrator'
SET ROLE ckam_rs_migrator;
\echo '[CANNOT-36] take ownership of audit_log'
ALTER TABLE audit_log OWNER TO ckam_rs_app;
\echo '[CANNOT-37] make the purge function SECURITY DEFINER'
ALTER FUNCTION ckam_purge_audit_log(timestamptz) SECURITY DEFINER;
\echo '[CANNOT-38] COPY ... TO PROGRAM (run a shell command on the server)'
COPY (SELECT 1) TO PROGRAM 'id';
\echo '[CANNOT-39] OBS-STATUS: change an asset status without the ledger writer'
UPDATE asset SET status = 'LOST' WHERE id = (SELECT min(id) FROM asset);
\echo '[CANNOT-40] OBS-STATUS: change the holder without the ledger writer'
UPDATE asset SET current_asset_user_id = NULL WHERE id = (SELECT min(id) FROM asset);

\echo '==================== after the attempts: nothing changed ===================='
SELECT (SELECT count(*) FROM audit_log) AS audit_rows, (SELECT count(*) FROM asset_event) AS events,
       (SELECT count(*) FROM master_audit) AS master_audit_rows, (SELECT version_num FROM alembic_version) AS head,
       (SELECT string_agg(DISTINCT status, ',') FROM asset) AS asset_statuses;
