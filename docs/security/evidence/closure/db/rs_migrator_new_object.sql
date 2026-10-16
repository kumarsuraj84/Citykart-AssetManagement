-- WP-B local simulation, part (4): a new object created by the MIGRATOR belongs to the OWNER role and the runtime
-- role receives the default privileges at once. Run as the migrator (throw-away database ckam_rs):
--   psql -X -e -U ckam_rs_migrator -d ckam_rs -f rs_migrator_new_object.sql
\set ON_ERROR_STOP off
\pset pager off

\echo '[MIG-01] the migrator session starts as the owner (role setting written by role_split.sql)'
SELECT current_user, session_user;
\echo '[MIG-02] a "new migration" creates a table with a sequence'
CREATE TABLE wpb_probe (id bigserial PRIMARY KEY, note text NOT NULL);
\echo '[MIG-03] owner of the new table and its sequence'
SELECT relname, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname IN ('wpb_probe', 'wpb_probe_id_seq') ORDER BY 1;
\echo '[MIG-04] the runtime role got SELECT/INSERT/UPDATE/DELETE + sequence USAGE by default, and no TRUNCATE'
SELECT has_table_privilege('ckam_rs_app', 'wpb_probe', 'SELECT,INSERT,UPDATE,DELETE') AS crud,
       has_table_privilege('ckam_rs_app', 'wpb_probe', 'TRUNCATE') AS truncate,
       has_table_privilege('ckam_rs_app', 'wpb_probe', 'TRIGGER') AS trigger,
       has_sequence_privilege('ckam_rs_app', 'wpb_probe_id_seq', 'USAGE') AS sequence_usage;
\echo '[MIG-05] belt and braces: without the owner role the migrator itself can create nothing'
\echo '         (SET ROLE NONE = act as the session user; RESET ROLE would go back to the owner role setting)'
SET ROLE NONE;
SELECT current_user;
CREATE TABLE wpb_probe_as_migrator (id integer);
SET ROLE ckam_rs_owner;
SELECT current_user;
