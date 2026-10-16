-- WP-B local simulation, BEFORE the split: the runtime role still owns every table (like ckassetapp in production
-- today), so it can switch the guards off. Everything inside one transaction that is ROLLED BACK.
--   psql -X -e -U ckam_rs_app -d ckam_rs -f rs_presplit_residual.sql
\set ON_ERROR_STOP off
\pset pager off
BEGIN;
\echo '[PRE-01] owner disables the TRUNCATE guard on audit_log (IF-05 residual, RT-AU-T9817)'
ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_no_truncate;
\echo '[PRE-02] ... and empties the audit trail'
TRUNCATE audit_log;
SELECT count(*) AS audit_rows_inside_the_transaction FROM audit_log;
\echo '[PRE-03] owner creates objects in schema public'
CREATE TABLE public.wpb_presplit_probe (id integer);
ROLLBACK;
SELECT count(*) AS audit_rows_after_rollback FROM audit_log;
