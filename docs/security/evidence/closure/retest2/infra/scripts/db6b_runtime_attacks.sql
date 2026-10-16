-- CL2-IF item 6(b): connect as the RUNTIME role r2c_app (after ops/db/role_split.sql) and try to break out.
-- Every test is its own transaction and is ROLLED BACK. Section A: must FAIL. Section N: normal app work, must WORK.
--   PGPW=<throw-away> bash run_sql.sh ckam-sec-db-1 r2c_app ckam_r2c_rs db6b_runtime_attacks.sql <out>
\set ON_ERROR_STOP 0
\pset pager off
\echo '== who am I'
SELECT current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
       current_setting('ckam.lifecycle_writer', true) AS marker_default;

\echo '== A01 TRUNCATE the four ledgers and an ordinary table'
BEGIN; TRUNCATE audit_log; ROLLBACK;
BEGIN; TRUNCATE asset_event CASCADE; ROLLBACK;
BEGIN; TRUNCATE master_audit; ROLLBACK;
BEGIN; TRUNCATE asset_field_change; ROLLBACK;
BEGIN; TRUNCATE vendor CASCADE; ROLLBACK;
\echo '== A02 ALTER TABLE (add column, owner, disable triggers)'
BEGIN; ALTER TABLE asset ADD COLUMN r2c int; ROLLBACK;
BEGIN; ALTER TABLE audit_log OWNER TO r2c_app; ROLLBACK;
BEGIN; ALTER TABLE audit_log DISABLE TRIGGER ALL; ROLLBACK;
BEGIN; ALTER TABLE asset DISABLE TRIGGER trg_asset_lifecycle_fields_guard; ROLLBACK;
BEGIN; ALTER TABLE asset_event ENABLE REPLICA TRIGGER trg_asset_event_no_update; ROLLBACK;
\echo '== A03 DROP trigger / function / table'
BEGIN; DROP TRIGGER trg_audit_log_no_delete ON audit_log; ROLLBACK;
BEGIN; DROP FUNCTION forbid_audit_log_write() CASCADE; ROLLBACK;
BEGIN; DROP TABLE audit_log; ROLLBACK;
BEGIN; DROP TABLE vendor CASCADE; ROLLBACK;
\echo '== A04 replace a guard function / create objects'
BEGIN; CREATE OR REPLACE FUNCTION forbid_audit_log_write() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN OLD; END $f$; ROLLBACK;
BEGIN; CREATE TABLE r2c_evil (x int); ROLLBACK;
BEGIN; CREATE TEMP TABLE r2c_evil_tmp (x int); ROLLBACK;
BEGIN; CREATE SCHEMA r2c_evil; ROLLBACK;
BEGIN; CREATE FUNCTION public.r2c_evil() RETURNS int LANGUAGE sql AS 'SELECT 1'; ROLLBACK;
BEGIN; CREATE TRIGGER r2c_evil BEFORE UPDATE ON asset FOR EACH ROW EXECUTE FUNCTION forbid_asset_lifecycle_write(); ROLLBACK;
BEGIN; CREATE VIEW r2c_v AS SELECT 1; ROLLBACK;
BEGIN; COMMENT ON TABLE audit_log IS 'x'; ROLLBACK;
\echo '== A05 session_replication_role (would skip every guard trigger)'
BEGIN; SET LOCAL session_replication_role = replica; ROLLBACK;
BEGIN; SET session_replication_role = replica; ROLLBACK;
\echo '== A06 become the owner or the migrator'
BEGIN; SET ROLE r2c_owner; ROLLBACK;
BEGIN; SET ROLE r2c_migrator; ROLLBACK;
BEGIN; SET SESSION AUTHORIZATION r2c_owner; ROLLBACK;
BEGIN; GRANT r2c_owner TO r2c_app; ROLLBACK;
BEGIN; ALTER ROLE r2c_app SUPERUSER; ROLLBACK;
BEGIN; ALTER ROLE r2c_app CREATEROLE; ROLLBACK;
BEGIN; ALTER ROLE r2c_app BYPASSRLS; ROLLBACK;
\echo '== A07 purge function (with and without the flag)'
BEGIN; SELECT ckam_purge_audit_log(now() - interval '6 years'); ROLLBACK;
BEGIN; SET LOCAL ckam.allow_audit_purge = on; SELECT ckam_purge_audit_log(now() - interval '6 years'); ROLLBACK;
\echo '== A08 UPDATE / DELETE ledger rows (also with the purge flag)'
BEGIN; UPDATE audit_log SET summary = 'forged' WHERE id = (SELECT max(id) FROM audit_log); ROLLBACK;
BEGIN; DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log); ROLLBACK;
BEGIN; SET LOCAL ckam.allow_audit_purge = on; DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log); ROLLBACK;
BEGIN; UPDATE asset_event SET status_after = 'LOST' WHERE id = (SELECT max(id) FROM asset_event); ROLLBACK;
BEGIN; DELETE FROM asset_event WHERE id = (SELECT max(id) FROM asset_event); ROLLBACK;
BEGIN; INSERT INTO master_audit (entity, entity_id, field, old_value, new_value, actor_id) VALUES ('r2c_probe', 1, 'name', 'a', 'b', 2); UPDATE master_audit SET new_value = 'forged' WHERE entity = 'r2c_probe'; ROLLBACK;
BEGIN; INSERT INTO master_audit (entity, entity_id, field, old_value, new_value, actor_id) VALUES ('r2c_probe', 1, 'name', 'a', 'b', 2); DELETE FROM master_audit WHERE entity = 'r2c_probe'; ROLLBACK;
BEGIN; UPDATE asset_field_change SET new_value = 'forged' WHERE id = (SELECT max(id) FROM asset_field_change); ROLLBACK;
BEGIN; DELETE FROM asset_field_change WHERE id = (SELECT max(id) FROM asset_field_change); ROLLBACK;
BEGIN; MERGE INTO audit_log a USING (SELECT max(id) AS id FROM audit_log) s ON a.id = s.id WHEN MATCHED THEN DELETE; ROLLBACK;
\echo '== A09 change asset status / holder / date directly (no marker)'
BEGIN; UPDATE asset SET status = 'LOST' WHERE id = 3; ROLLBACK;
BEGIN; UPDATE asset SET current_asset_user_id = 21, status_since = DATE '2001-01-01' WHERE id = 3; ROLLBACK;
BEGIN; UPDATE asset SET asset_code = 'R2C-X' WHERE id = 3; ROLLBACK;
BEGIN; DELETE FROM asset WHERE id = 3; ROLLBACK;
\echo '== A10 write alembic_version'
BEGIN; UPDATE alembic_version SET version_num = 'r2c'; ROLLBACK;
BEGIN; INSERT INTO alembic_version VALUES ('r2c'); ROLLBACK;
BEGIN; DELETE FROM alembic_version; ROLLBACK;
\echo '== A11 server files and programs'
BEGIN; COPY (SELECT 1) TO PROGRAM 'id'; ROLLBACK;
BEGIN; COPY audit_log FROM PROGRAM 'true'; ROLLBACK;
BEGIN; COPY (SELECT 1) TO '/tmp/r2c_x.txt'; ROLLBACK;
BEGIN; COPY audit_log FROM '/etc/passwd'; ROLLBACK;
BEGIN; SELECT pg_read_file('/etc/passwd'); ROLLBACK;
BEGIN; SELECT pg_ls_dir('.'); ROLLBACK;
BEGIN; SELECT lo_import('/etc/passwd'); ROLLBACK;
BEGIN; SELECT pg_read_binary_file('/var/lib/postgresql/data/pg_hba.conf'); ROLLBACK;
BEGIN; LOAD 'plpgsql'; ROLLBACK;
\echo '== A12 roles, databases, extensions, replication'
BEGIN; CREATE ROLE r2c_evil LOGIN SUPERUSER; ROLLBACK;
BEGIN; CREATE ROLE r2c_evil2; ROLLBACK;
CREATE DATABASE r2c_evil;
BEGIN; CREATE EXTENSION dblink; ROLLBACK;
BEGIN; CREATE EXTENSION plpython3u; ROLLBACK;
BEGIN; CREATE EXTENSION pgcrypto; ROLLBACK;
BEGIN; CREATE PUBLICATION r2c_pub FOR TABLE audit_log; ROLLBACK;
BEGIN; ALTER DATABASE ckam_r2c_rs SET session_replication_role = replica; ROLLBACK;
BEGIN; ALTER DATABASE ckam_r2c_rs OWNER TO r2c_app; ROLLBACK;
BEGIN; ALTER SCHEMA public OWNER TO r2c_app; ROLLBACK;
BEGIN; GRANT CREATE ON SCHEMA public TO r2c_app; ROLLBACK;
BEGIN; GRANT UPDATE ON audit_log TO r2c_app; ROLLBACK;
\echo '== A13 catalogs with secrets'
BEGIN; SELECT rolname, rolpassword FROM pg_authid LIMIT 1; ROLLBACK;
BEGIN; SELECT count(*) FROM pg_shadow; ROLLBACK;
\echo '== A14 owner-only maintenance on a ledger'
BEGIN; LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE; ROLLBACK;
VACUUM FULL audit_log;
BEGIN; REINDEX TABLE audit_log; ROLLBACK;
BEGIN; CLUSTER audit_log USING audit_log_pkey; ROLLBACK;
\echo '== A15 sequences: runtime may use them; can it rewind / exhaust a LEDGER sequence? (setval needs UPDATE)'
BEGIN; SELECT pg_get_serial_sequence('audit_log', 'id') AS seq, has_sequence_privilege('r2c_app', pg_get_serial_sequence('audit_log', 'id'), 'UPDATE') AS can_setval; ROLLBACK;
BEGIN; SELECT setval(pg_get_serial_sequence('audit_log', 'id'), 9223372036854775807); INSERT INTO audit_log (category, action, outcome, summary) VALUES ('SECURITY', 'R2C_PROBE', 'OK', 'after exhausting the sequence'); ROLLBACK;
BEGIN; SELECT setval(pg_get_serial_sequence('asset_event', 'id'), 1); INSERT INTO asset_event (asset_id, event_type, event_date, status_after, recorded_by) VALUES (3, 'CORRECTION', now(), 'IN_STOCK', 2); ROLLBACK;
BEGIN; ALTER SEQUENCE audit_log_id_seq MAXVALUE 10; ROLLBACK;

\echo '== N01 normal: insert an audit row'
BEGIN; INSERT INTO audit_log (category, action, outcome, summary, ip) VALUES ('SECURITY', 'R2C_PROBE', 'OK', 'cl2-if runtime insert', '127.0.0.1') RETURNING id > 0 AS inserted; ROLLBACK;
\echo '== N02 normal: update an ordinary asset column'
BEGIN; UPDATE asset SET description = coalesce(description, '') || ' (r2c)' WHERE id = 3; ROLLBACK;
\echo '== N03 normal: sequences (nextval / currval)'
BEGIN; SELECT nextval(pg_get_serial_sequence('asset_event', 'id')) > 0 AS nextval_ok, currval(pg_get_serial_sequence('asset_event', 'id')) > 0 AS currval_ok; ROLLBACK;
\echo '== N04 normal: the apply_events path (marker + event + state change in one transaction)'
BEGIN;
SELECT set_config('ckam.lifecycle_writer', 'on', true);
INSERT INTO asset_event (asset_id, event_type, event_date, status_after, recorded_by, remarks) VALUES (3, 'MOVED', now(), 'LOST', 2, 'cl2-if probe');
UPDATE asset SET status = 'LOST', status_since = current_date WHERE id = 3;
SELECT set_config('ckam.lifecycle_writer', 'off', true);
UPDATE asset SET status = 'IN_STOCK' WHERE id = 3;
ROLLBACK;
\echo '== N05 normal: other inserts / updates / deletes the app does'
BEGIN; INSERT INTO asset_field_change (asset_id, field_name, old_value, new_value, actor_id, request_id) VALUES (3, 'description', 'a', 'b', 2, 'r2c'); ROLLBACK;
BEGIN; INSERT INTO master_audit (entity, entity_id, field, old_value, new_value, actor_id) VALUES ('vendor', 1, 'name', 'a', 'b', 2); ROLLBACK;
BEGIN; UPDATE asset_user SET failed_login_count = failed_login_count WHERE id = 16; ROLLBACK;
BEGIN; DELETE FROM error_log WHERE at < now() - interval '400 days'; DELETE FROM idempotency_key WHERE false; ROLLBACK;
BEGIN; SELECT version_num FROM alembic_version; SELECT count(*) AS audit_rows FROM audit_log; ROLLBACK;
\echo '== after: nothing changed'
SELECT id, status, current_asset_user_id, status_since, asset_code FROM asset WHERE id = 3;
SELECT (SELECT count(*) FROM audit_log) AS audit_rows, (SELECT count(*) FROM asset_event) AS events, (SELECT last_value FROM audit_log_id_seq) AS audit_seq;
