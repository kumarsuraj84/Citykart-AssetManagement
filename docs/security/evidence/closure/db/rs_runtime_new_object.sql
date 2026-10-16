-- WP-B local simulation, part (4) continued: the RUNTIME role uses the migrator's new table at once, but cannot
-- truncate or drop it. Run as the runtime role after rs_migrator_new_object.sql:
--   psql -X -e -U ckam_rs_app -d ckam_rs -f rs_runtime_new_object.sql
\set ON_ERROR_STOP off
\pset pager off
\echo '[NEW-01] runtime role inserts into the new table'
INSERT INTO wpb_probe (note) VALUES ('written by the runtime role') RETURNING id, note;
\echo '[NEW-02] runtime role reads it'
SELECT count(*) FROM wpb_probe;
\echo '[NEW-03] runtime role cannot TRUNCATE it'
TRUNCATE wpb_probe;
\echo '[NEW-04] runtime role cannot DROP it'
DROP TABLE wpb_probe;
