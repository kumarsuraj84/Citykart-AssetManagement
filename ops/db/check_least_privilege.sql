-- =====================================================================================================================
-- CKAM least-privilege check (security IF-05 / IF-06 / OBS-STATUS / EXT-07). READ-ONLY: it changes nothing.
--
-- Prints one row per check: check | result (PASS / FAIL / INFO) | detail. Every PASS/FAIL row must be PASS.
-- Run by a DBA (superuser or any role that can read the catalogs) against ANY CKAM database, with psql (10+),
-- PostgreSQL 15 or newer:
--
--   psql -X -v ON_ERROR_STOP=1 -d <ckam database> -v runtime_role=<role in DATABASE_URL> \
--        [-v owner_role=<owner role>] [-v schema_name=public] -f ops/db/check_least_privilege.sql
--
-- Production example: -d ckassetmanagement -v runtime_role=ckassetapp -v owner_role=ckasset_owner
-- Without owner_role the owner check is INFO (it lists who owns what). Today (before EXT-07) production is
-- expected to FAIL the ownership checks: ckassetapp owns every table. That is exactly what EXT-07 fixes.
-- =====================================================================================================================

\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \echo 'check_least_privilege.sql: missing -v runtime_role=<runtime role>'
  \quit
\endif
\if :{?owner_role}
\else
  \set owner_role ''
\endif
\if :{?schema_name}
\else
  \set schema_name public
\endif

SELECT set_config('ckam_check.runtime_role', :'runtime_role', false) AS _r,
       set_config('ckam_check.owner_role', :'owner_role', false) AS _o,
       set_config('ckam_check.schema_name', :'schema_name', false) AS _s \gset

DO $check$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_setting('ckam_check.runtime_role')) THEN
        RAISE EXCEPTION 'check_least_privilege: role % does not exist on this server', current_setting('ckam_check.runtime_role');
    END IF;
END
$check$;

-- >>> CHECK BODY (plain SQL; backend/tests/security/test_least_privilege_role_split.py runs exactly this part)
WITH s AS (
    SELECT current_setting('ckam_check.runtime_role') AS rt,
           nullif(current_setting('ckam_check.owner_role'), '') AS own,
           current_setting('ckam_check.schema_name') AS sch
), role AS (
    SELECT r.* FROM pg_roles r, s WHERE r.rolname = s.rt
), rel AS (
    SELECT c.oid, c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, s
    WHERE n.nspname = s.sch AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
), tabs AS (
    SELECT * FROM rel WHERE relkind IN ('r', 'p')
), ao(relname) AS (
    VALUES ('asset_event'), ('asset_field_change'), ('master_audit'), ('audit_log')
), ordinary AS (
    SELECT t.* FROM tabs t WHERE t.relname NOT IN (SELECT relname FROM ao) AND t.relname <> 'alembic_version'
), expected_triggers(tbl, tg) AS (
    VALUES ('asset', 'trg_asset_no_identity_change'), ('asset', 'trg_asset_lifecycle_fields_guard'),
           ('asset_event', 'trg_asset_event_no_update'), ('asset_event', 'trg_asset_event_no_delete'),
           ('asset_event', 'trg_asset_event_no_truncate'),
           ('asset_field_change', 'trg_asset_field_change_no_update'),
           ('asset_field_change', 'trg_asset_field_change_no_delete'),
           ('asset_field_change', 'trg_asset_field_change_no_truncate'),
           ('master_audit', 'trg_master_audit_no_update'), ('master_audit', 'trg_master_audit_no_delete'),
           ('master_audit', 'trg_master_audit_no_truncate'),
           ('audit_log', 'trg_audit_log_no_update'), ('audit_log', 'trg_audit_log_no_delete'),
           ('audit_log', 'trg_audit_log_no_truncate')
), dangerous(rolname) AS (
    VALUES ('pg_write_all_data'), ('pg_read_all_data'), ('pg_read_server_files'), ('pg_write_server_files'),
           ('pg_execute_server_program'), ('pg_signal_backend'), ('pg_checkpoint'), ('pg_create_subscription'),
           ('pg_maintain')
), checks(n, check_name, result, detail) AS (
    SELECT 1, 'runtime role exists', CASE WHEN EXISTS (SELECT 1 FROM role) THEN 'PASS' ELSE 'FAIL' END,
           (SELECT rt FROM s)
    UNION ALL
    SELECT 2, 'runtime role: not superuser / createrole / createdb / replication / bypassrls',
           CASE WHEN NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls) THEN 'PASS' ELSE 'FAIL' END,
           format('super=%s createrole=%s createdb=%s replication=%s bypassrls=%s',
                  rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls)
    FROM role
    UNION ALL
    SELECT 3, 'runtime role is not a member of a superuser role or a powerful predefined role',
           CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, coalesce(string_agg(g.rolname, ', '), 'none')
    FROM pg_roles g, s
    WHERE g.rolname <> s.rt AND pg_has_role(s.rt, g.oid, 'MEMBER')
      AND (g.rolsuper OR g.rolname IN (SELECT rolname FROM dangerous))
    UNION ALL
    SELECT 4, 'runtime role owns nothing in this database (tables, sequences, views, functions, types, schemas)',
           CASE WHEN (SELECT count(*) FROM pg_class c, s WHERE pg_get_userbyid(c.relowner) = s.rt)
                   + (SELECT count(*) FROM pg_proc p, s WHERE pg_get_userbyid(p.proowner) = s.rt)
                   + (SELECT count(*) FROM pg_type t, s WHERE pg_get_userbyid(t.typowner) = s.rt)
                   + (SELECT count(*) FROM pg_namespace n, s WHERE pg_get_userbyid(n.nspowner) = s.rt) = 0
                THEN 'PASS' ELSE 'FAIL' END,
           format('relations (tables, indexes, sequences)=%s functions=%s',
                  (SELECT count(*) FROM pg_class c, s WHERE pg_get_userbyid(c.relowner) = s.rt),
                  (SELECT count(*) FROM pg_proc p, s WHERE pg_get_userbyid(p.proowner) = s.rt))
    UNION ALL
    SELECT 5, 'table owners are not the runtime role (nor a role it can become)',
           CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
           coalesce(string_agg(DISTINCT rel.owner, ', '), 'none') || CASE WHEN count(*) > 0 THEN format(' (%s objects)', count(*)) ELSE '' END
    FROM rel, s WHERE pg_has_role(s.rt, (SELECT oid FROM pg_roles WHERE rolname = rel.owner), 'MEMBER')
    UNION ALL
    SELECT 6, 'runtime role does not own the database',
           CASE WHEN NOT pg_has_role(s.rt, d.datdba, 'MEMBER') THEN 'PASS' ELSE 'FAIL' END,
           'owner=' || pg_get_userbyid(d.datdba)
    FROM pg_database d, s WHERE d.datname = current_database()
    UNION ALL
    SELECT 7, 'runtime role cannot CREATE in any schema',
           CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, coalesce(string_agg(n.nspname, ', '), 'none')
    FROM pg_namespace n, s
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp%' AND has_schema_privilege(s.rt, n.oid, 'CREATE')
    UNION ALL
    SELECT 8, 'runtime role cannot create schemas or temporary tables in the database',
           CASE WHEN NOT has_database_privilege(s.rt, current_database(), 'CREATE')
                 AND NOT has_database_privilege(s.rt, current_database(), 'TEMP') THEN 'PASS' ELSE 'FAIL' END,
           format('create=%s temp=%s', has_database_privilege(s.rt, current_database(), 'CREATE'),
                  has_database_privilege(s.rt, current_database(), 'TEMP'))
    FROM s
    UNION ALL
    SELECT 9, 'runtime role can CONNECT and USE the schema',
           CASE WHEN has_database_privilege(s.rt, current_database(), 'CONNECT')
                 AND has_schema_privilege(s.rt, s.sch, 'USAGE') THEN 'PASS' ELSE 'FAIL' END, s.sch
    FROM s
    UNION ALL
    SELECT 10, 'runtime role has SELECT/INSERT/UPDATE/DELETE on every ordinary table',
           CASE WHEN count(*) FILTER (WHERE NOT ok) = 0 AND count(*) > 0 THEN 'PASS' ELSE 'FAIL' END,
           format('%s tables', count(*)) || coalesce('; missing on: ' || string_agg(relname, ', ') FILTER (WHERE NOT ok), '')
    FROM (SELECT o.relname, has_table_privilege(s.rt, o.oid, 'SELECT') AND has_table_privilege(s.rt, o.oid, 'INSERT')
                 AND has_table_privilege(s.rt, o.oid, 'UPDATE') AND has_table_privilege(s.rt, o.oid, 'DELETE') AS ok
          FROM ordinary o, s) x
    UNION ALL
    SELECT 11 , 'append-only ' || ao.relname || ': SELECT+INSERT only (no UPDATE, DELETE, TRUNCATE)',
           CASE WHEN t.oid IS NULL THEN 'FAIL'
                WHEN has_table_privilege(s.rt, t.oid, 'SELECT') AND has_table_privilege(s.rt, t.oid, 'INSERT')
                     AND NOT has_table_privilege(s.rt, t.oid, 'UPDATE') AND NOT has_table_privilege(s.rt, t.oid, 'DELETE')
                     AND NOT has_table_privilege(s.rt, t.oid, 'TRUNCATE') THEN 'PASS' ELSE 'FAIL' END,
           CASE WHEN t.oid IS NULL THEN 'table not found'
                ELSE format('select=%s insert=%s update=%s delete=%s truncate=%s',
                            has_table_privilege(s.rt, t.oid, 'SELECT'), has_table_privilege(s.rt, t.oid, 'INSERT'),
                            has_table_privilege(s.rt, t.oid, 'UPDATE'), has_table_privilege(s.rt, t.oid, 'DELETE'),
                            has_table_privilege(s.rt, t.oid, 'TRUNCATE')) END
    FROM ao CROSS JOIN s LEFT JOIN tabs t ON t.relname = ao.relname
    UNION ALL
    SELECT 12, 'runtime role has no TRUNCATE, TRIGGER or REFERENCES privilege on any table',
           CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, coalesce(string_agg(t.relname, ', '), 'none')
    FROM tabs t, s
    WHERE has_table_privilege(s.rt, t.oid, 'TRUNCATE') OR has_table_privilege(s.rt, t.oid, 'TRIGGER')
       OR has_table_privilege(s.rt, t.oid, 'REFERENCES')
    UNION ALL
    SELECT 13, 'alembic_version: runtime role may only read it',
           CASE WHEN t.oid IS NULL THEN 'FAIL'
                WHEN has_table_privilege(s.rt, t.oid, 'SELECT') AND NOT has_table_privilege(s.rt, t.oid, 'INSERT')
                     AND NOT has_table_privilege(s.rt, t.oid, 'UPDATE') AND NOT has_table_privilege(s.rt, t.oid, 'DELETE')
                     AND NOT has_table_privilege(s.rt, t.oid, 'TRUNCATE') THEN 'PASS' ELSE 'FAIL' END,
           CASE WHEN t.oid IS NULL THEN 'table not found'
                ELSE format('select=%s insert=%s update=%s delete=%s', has_table_privilege(s.rt, t.oid, 'SELECT'),
                            has_table_privilege(s.rt, t.oid, 'INSERT'), has_table_privilege(s.rt, t.oid, 'UPDATE'),
                            has_table_privilege(s.rt, t.oid, 'DELETE')) END
    FROM s LEFT JOIN tabs t ON t.relname = 'alembic_version'
    UNION ALL
    SELECT 14, 'runtime role can use every sequence (needed to add rows)',
           CASE WHEN count(*) FILTER (WHERE NOT has_sequence_privilege(s.rt, r.oid, 'USAGE')) = 0 THEN 'PASS' ELSE 'FAIL' END,
           format('%s sequences', count(*)) || coalesce('; missing on: ' || string_agg(r.relname, ', ')
                  FILTER (WHERE NOT has_sequence_privilege(s.rt, r.oid, 'USAGE')), '')
    FROM rel r, s WHERE r.relkind = 'S'
    UNION ALL
    SELECT 15, 'ckam_purge_audit_log: no EXECUTE for the runtime role or PUBLIC',
           CASE WHEN f.oid IS NULL THEN 'FAIL'
                WHEN NOT has_function_privilege(s.rt, f.oid, 'EXECUTE') AND NOT has_function_privilege('public', f.oid, 'EXECUTE')
                THEN 'PASS' ELSE 'FAIL' END,
           CASE WHEN f.oid IS NULL THEN 'function not found'
                ELSE format('runtime=%s public=%s', has_function_privilege(s.rt, f.oid, 'EXECUTE'),
                            has_function_privilege('public', f.oid, 'EXECUTE')) END
    FROM s LEFT JOIN pg_proc f ON f.proname = 'ckam_purge_audit_log'
         AND f.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = s.sch)
    UNION ALL
    SELECT 16, 'runtime role cannot SET session_replication_role (would skip every guard trigger)',
           CASE WHEN NOT has_parameter_privilege(s.rt, 'session_replication_role', 'SET')
                 AND NOT (SELECT rolsuper FROM role) THEN 'PASS' ELSE 'FAIL' END,
           'has SET=' || has_parameter_privilege(s.rt, 'session_replication_role', 'SET')
    FROM s
    UNION ALL
    SELECT 17, 'trigger ' || e.tg || ' on ' || e.tbl || ' present and enabled',
           CASE WHEN tg.tgenabled IN ('O', 'A') THEN 'PASS' ELSE 'FAIL' END,
           CASE WHEN tg.oid IS NULL THEN 'missing'
                ELSE 'enabled=' || CASE tg.tgenabled WHEN 'O' THEN 'origin' WHEN 'A' THEN 'always'
                                                     WHEN 'R' THEN 'replica only' ELSE 'DISABLED' END END
    FROM expected_triggers e CROSS JOIN s
         LEFT JOIN tabs t ON t.relname = e.tbl
         LEFT JOIN pg_trigger tg ON tg.tgrelid = t.oid AND tg.tgname = e.tg AND NOT tg.tgisinternal
    UNION ALL
    SELECT 18, 'every CKAM table, sequence and function is owned by the owner role',
           CASE WHEN s.own IS NULL THEN 'INFO' WHEN count(*) FILTER (WHERE x.owner <> s.own) = 0 THEN 'PASS' ELSE 'FAIL' END,
           CASE WHEN s.own IS NULL THEN 'owners: ' || coalesce(string_agg(DISTINCT x.owner, ', '), 'none') || ' (no -v owner_role given)'
                ELSE coalesce('not owned by ' || s.own || ': ' || string_agg(x.name, ', ') FILTER (WHERE x.owner <> s.own),
                              format('%s objects, all owned by %s', count(*), s.own)) END
    FROM s LEFT JOIN (
        SELECT relname::text AS name, owner FROM rel
        UNION ALL
        SELECT p.oid::regprocedure::text, pg_get_userbyid(p.proowner)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, s s2 WHERE n.nspname = s2.sch
    ) x ON true
    GROUP BY s.own
)
SELECT check_name AS "check", result, detail FROM checks ORDER BY n, check_name;
-- <<< CHECK BODY
