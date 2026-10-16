-- CL3 IF-01/IF-02 runtime-role breakout matrix. Run AS r3_app against ckam_r3_rs (local socket, trust):
--   psql -X -e -U r3_app -d ckam_r3_rs -f r3_runtime_matrix.sql
-- Every CANNOT line must end in ERROR; every CAN line must succeed. setval / ALTER SEQUENCE is the CL2-IF-01 focus.
\set ON_ERROR_STOP off
\pset pager off
\echo '============ WHO AM I ============'
SELECT current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS super,
       current_setting('transaction_read_only') AS read_only;

\echo '============ CAN (the application needs these) ============'
\echo '[CAN-01] read tables + ledgers + alembic head'
SELECT (SELECT count(*) FROM asset) assets, (SELECT count(*) FROM audit_log) audit_rows,
       (SELECT version_num FROM alembic_version) head;
\echo '[CAN-02] INSERT an audit row (append-only INSERT allowed)'
INSERT INTO audit_log (source,category,action,summary,outcome,is_head_office_admin)
VALUES ('api','DATA','CREATE','CL3 matrix row','OK',false) RETURNING id;
\echo '[CAN-03] nextval on a ledger id sequence is ALLOWED (USAGE)'
SELECT nextval('audit_log_id_seq') > 0 AS audit_seq_nextval_ok;
SELECT nextval('asset_event_id_seq') > 0 AS event_seq_nextval_ok;
\echo '[CAN-04] nextval on an ordinary sequence'
SELECT nextval(pg_get_serial_sequence('vendor','id')) > 0 AS vendor_seq_ok;

\echo '============ CANNOT: CL2-IF-01 setval / ALTER SEQUENCE (ledger id sequences FIRST) ============'
\echo '[SEQ-01] setval audit_log_id_seq := 1 (would exhaust/collide; not undone by rollback)'
SELECT setval('audit_log_id_seq', 1);
\echo '[SEQ-02] setval asset_event_id_seq := 1 (would make every movement fail)'
SELECT setval('asset_event_id_seq', 1);
\echo '[SEQ-03] setval audit_log_id_seq := max bigint (exhaust)'
SELECT setval('audit_log_id_seq', 9223372036854775806);
\echo '[SEQ-04] setval master_audit_id_seq'
SELECT setval('master_audit_id_seq', 1);
\echo '[SEQ-05] setval asset_field_change_id_seq'
SELECT setval('asset_field_change_id_seq', 1);
\echo '[SEQ-06] ALTER SEQUENCE audit_log_id_seq RESTART'
ALTER SEQUENCE audit_log_id_seq RESTART WITH 1;
\echo '[SEQ-07] ALTER SEQUENCE asset_event_id_seq MAXVALUE'
ALTER SEQUENCE asset_event_id_seq MAXVALUE 100;
\echo '[SEQ-08] setval an ordinary sequence (vendor id)'
SELECT setval(pg_get_serial_sequence('vendor','id'), 1);
\echo '[SEQ-09] loop setval over EVERY sequence (expect every line permission denied)'
DO $$ DECLARE s record; BEGIN
  FOR s IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname LOOP
    BEGIN EXECUTE format('SELECT setval(%L,1)', s.relname);
          RAISE WARNING 'LEAK: setval succeeded on %', s.relname;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  RAISE NOTICE 'setval loop finished with no LEAK warnings = all denied';
END $$;

\echo '============ CANNOT: append-only ledgers (UPDATE/DELETE/TRUNCATE) ============'
\echo '[LED-01] UPDATE audit_log'
UPDATE audit_log SET summary='rewritten';
\echo '[LED-02] DELETE FROM audit_log'
DELETE FROM audit_log;
\echo '[LED-03] purge flag on, DELETE recent audit rows'
BEGIN; SET LOCAL ckam.allow_audit_purge='on'; DELETE FROM audit_log WHERE at > now()-interval '1 day'; ROLLBACK;
\echo '[LED-04] TRUNCATE audit_log'
TRUNCATE audit_log;
\echo '[LED-05] UPDATE asset_event'
UPDATE asset_event SET remarks='x';
\echo '[LED-06] DELETE asset_event'
DELETE FROM asset_event;
\echo '[LED-07] TRUNCATE asset_event'
TRUNCATE asset_event;
\echo '[LED-08] UPDATE master_audit'
UPDATE master_audit SET summary='x';
\echo '[LED-09] UPDATE asset_field_change'
UPDATE asset_field_change SET new_value='x';
\echo '[LED-10] TRUNCATE an ordinary table'
TRUNCATE asset CASCADE;

\echo '============ CANNOT: DDL / triggers / replication / purge / SET ROLE ============'
\echo '[DDL-01] ALTER TABLE add column'
ALTER TABLE asset ADD COLUMN evil int;
\echo '[DDL-02] DISABLE TRIGGER ALL on asset_event'
ALTER TABLE asset_event DISABLE TRIGGER ALL;
\echo '[DDL-03] DISABLE the audit delete guard'
ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_no_delete;
\echo '[DDL-04] DROP the OBS-STATUS asset guard'
DROP TRIGGER trg_asset_lifecycle_fields_guard ON asset;
\echo '[DDL-05] ENABLE REPLICA on the asset guard (skip it in normal sessions)'
ALTER TABLE asset ENABLE REPLICA TRIGGER trg_asset_lifecycle_fields_guard;
\echo '[DDL-06] DROP TABLE audit_log'
DROP TABLE audit_log;
\echo '[DDL-07] CREATE OR REPLACE a guard trigger function'
CREATE OR REPLACE FUNCTION forbid_audit_log_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$;
\echo '[DDL-08] CREATE TABLE in public'
CREATE TABLE public.evil (id int);
\echo '[DDL-09] CREATE SCHEMA'
CREATE SCHEMA evil;
\echo '[DDL-10] CREATE TEMP TABLE'
CREATE TEMP TABLE t (id int);
\echo '[DDL-11] SET session_replication_role = replica'
SET session_replication_role = replica;
\echo '[DDL-12] run the purge function'
SELECT ckam_purge_audit_log(now()-interval '6 years');
\echo '[DDL-13] SET ROLE owner'
SET ROLE r3_owner;
\echo '[DDL-14] SET ROLE migrator'
SET ROLE r3_migrator;
\echo '[DDL-15] take ownership of audit_log'
ALTER TABLE audit_log OWNER TO r3_app;
\echo '[DDL-16] UPDATE alembic_version'
UPDATE alembic_version SET version_num='ffffffffffff';
\echo '[DDL-17] COPY TO PROGRAM (shell exec)'
COPY (SELECT 1) TO PROGRAM 'id';
\echo '[DDL-18] OBS-STATUS: change asset status directly (trigger must refuse)'
UPDATE asset SET status='LOST' WHERE id=(SELECT min(id) FROM asset);

\echo '============ CL2-IF-02 / HIDE DAMAGE: stored session defaults (allowed to set, must be DETECTED) ============'
\echo '[SET-01] ALTER ROLE self SET default_transaction_read_only = on (every later write fails)'
ALTER ROLE r3_app SET default_transaction_read_only = on;
\echo '[SET-02] ALTER ROLE self SET search_path = evil (hide tables)'
ALTER ROLE r3_app SET search_path = evil, public;
\echo '[SET-03] ALTER ROLE self IN DATABASE SET statement_timeout = 1ms'
ALTER ROLE r3_app IN DATABASE ckam_r3_rs SET statement_timeout = '1ms';
\echo '[SET-04] ALTER ROLE self SET role = owner (try to store a privilege escalation)'
ALTER ROLE r3_app SET role = r3_owner;
\echo '[SET-05] ALTER ROLE self SET session_replication_role = replica (superuser-only param)'
ALTER ROLE r3_app SET session_replication_role = replica;

\echo '============ AFTER: nothing changed in the ledgers / head / statuses ============'
SELECT (SELECT count(*) FROM audit_log) audit_rows, (SELECT count(*) FROM asset_event) events,
       (SELECT version_num FROM alembic_version) head,
       (SELECT coalesce(string_agg(DISTINCT status,','),'(none)') FROM asset) asset_statuses;
