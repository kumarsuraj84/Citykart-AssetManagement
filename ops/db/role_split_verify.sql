-- =====================================================================================================================
-- CKAM role split verification (security IF-05 / IF-06 / EXT-07). READ-ONLY: it changes nothing.
--
-- Run after ops/db/role_split.sql (and again after every deploy that ran migrations), with the same names:
--
--   psql -X -v ON_ERROR_STOP=1 -d <ckam database> -v db_name=<ckam database> \
--        -v owner_role=<owner> -v migrator_role=<migrator> -v runtime_role=<runtime> [-v schema_name=public] \
--        -f ops/db/role_split_verify.sql
--
-- Prints two tables of check | result | detail: first the general least-privilege checks
-- (ops/db/check_least_privilege.sql), then the checks specific to the three-role design. Every row must be PASS.
-- Needs PostgreSQL 16 or newer (pg_has_role ... 'SET'); production runs 18, the dev stack 17.
-- =====================================================================================================================

\set ON_ERROR_STOP on
\if :{?db_name}
\else
  \echo 'role_split_verify.sql: missing -v db_name=<ckam database>'
  \quit
\endif
\if :{?migrator_role}
\else
  \echo 'role_split_verify.sql: missing -v migrator_role=<migrator role>'
  \quit
\endif
\if :{?owner_role}
\else
  \echo 'role_split_verify.sql: missing -v owner_role=<owner role>'
  \quit
\endif

\echo '== General least-privilege checks =='
\ir check_least_privilege.sql

SELECT set_config('ckam_check.db_name', :'db_name', false) AS _d,
       set_config('ckam_check.migrator_role', :'migrator_role', false) AS _m \gset

\echo '== Role split checks =='
-- >>> VERIFY BODY (plain SQL; backend/tests/security/test_least_privilege_role_split.py runs exactly this part)
WITH s AS (
    SELECT current_setting('ckam_check.runtime_role') AS rt, current_setting('ckam_check.owner_role') AS own,
           current_setting('ckam_check.migrator_role') AS mig, current_setting('ckam_check.db_name') AS db,
           current_setting('ckam_check.schema_name') AS sch
), defacl AS (
    SELECT a.privilege_type, d.defaclobjtype, pg_get_userbyid(a.grantee) AS grantee
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, s,
         LATERAL aclexplode(d.defaclacl) a
    WHERE pg_get_userbyid(d.defaclrole) = s.own AND n.nspname = s.sch
), checks(n, check_name, result, detail) AS (
    SELECT 1, 'connected to the CKAM database', CASE WHEN current_database() = s.db THEN 'PASS' ELSE 'FAIL' END,
           current_database() FROM s
    UNION ALL
    SELECT 2, 'owner role cannot sign in and has no special attributes',
           CASE WHEN NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
                THEN 'PASS' ELSE 'FAIL' END,
           format('login=%s super=%s', r.rolcanlogin, r.rolsuper)
    FROM s LEFT JOIN pg_roles r ON r.rolname = s.own
    UNION ALL
    SELECT 3, 'migrator role: can sign in, no special attributes, NOINHERIT',
           CASE WHEN r.rolcanlogin AND NOT r.rolinherit
                 AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
                THEN 'PASS' ELSE 'FAIL' END,
           format('login=%s inherit=%s super=%s', r.rolcanlogin, r.rolinherit, r.rolsuper)
    FROM s LEFT JOIN pg_roles r ON r.rolname = s.mig
    UNION ALL
    SELECT 4, 'migrator may act as the owner (SET ROLE)',
           CASE WHEN pg_has_role(s.mig, s.own, 'SET') THEN 'PASS' ELSE 'FAIL' END, s.mig || ' -> ' || s.own FROM s
    UNION ALL
    SELECT 5, 'migrator sessions in this database start as the owner (role setting)',
           CASE WHEN EXISTS (SELECT 1 FROM pg_db_role_setting rs
                             WHERE rs.setrole = (SELECT oid FROM pg_roles WHERE rolname = s.mig)
                               AND rs.setdatabase = (SELECT oid FROM pg_database WHERE datname = s.db)
                               AND ('role=' || s.own) = ANY (rs.setconfig)) THEN 'PASS' ELSE 'FAIL' END,
           coalesce((SELECT string_agg(array_to_string(rs.setconfig, ' '), '; ') FROM pg_db_role_setting rs
                     WHERE rs.setrole = (SELECT oid FROM pg_roles WHERE rolname = s.mig)
                       AND rs.setdatabase = (SELECT oid FROM pg_database WHERE datname = s.db)), 'no setting')
    FROM s
    UNION ALL
    SELECT 6, 'migrator owns nothing and cannot create anything without becoming the owner',
           CASE WHEN (SELECT count(*) FROM pg_class c WHERE pg_get_userbyid(c.relowner) = s.mig) = 0
                 AND NOT has_schema_privilege(s.mig, s.sch, 'CREATE')
                 AND NOT has_database_privilege(s.mig, s.db, 'CREATE') THEN 'PASS' ELSE 'FAIL' END,
           format('schema create=%s', has_schema_privilege(s.mig, s.sch, 'CREATE'))
    FROM s
    UNION ALL
    SELECT 7, 'runtime role is not a member of the owner or the migrator',
           CASE WHEN NOT pg_has_role(s.rt, s.own, 'MEMBER') AND NOT pg_has_role(s.rt, s.mig, 'MEMBER')
                THEN 'PASS' ELSE 'FAIL' END, s.rt FROM s
    UNION ALL
    SELECT 8, 'database owned by the owner role',
           CASE WHEN pg_get_userbyid(d.datdba) = s.own THEN 'PASS' ELSE 'FAIL' END, 'owner=' || pg_get_userbyid(d.datdba)
    FROM s JOIN pg_database d ON d.datname = s.db
    UNION ALL
    SELECT 9, 'PUBLIC cannot connect to the database',
           CASE WHEN NOT has_database_privilege('public', s.db, 'CONNECT') THEN 'PASS' ELSE 'FAIL' END, s.db FROM s
    UNION ALL
    SELECT 10, 'future tables: runtime role gets SELECT/INSERT/UPDATE/DELETE by default',
           CASE WHEN (SELECT count(DISTINCT privilege_type) FROM defacl, s s2
                      WHERE defaclobjtype = 'r' AND grantee = s2.rt
                        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) = 4
                 AND NOT EXISTS (SELECT 1 FROM defacl, s s2 WHERE defaclobjtype = 'r' AND grantee = s2.rt
                                 AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES'))
                THEN 'PASS' ELSE 'FAIL' END,
           coalesce((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM defacl, s s2
                     WHERE defaclobjtype = 'r' AND grantee = s2.rt), 'none')
    FROM s
    UNION ALL
    SELECT 11, 'future sequences: runtime role gets USAGE by default',
           CASE WHEN EXISTS (SELECT 1 FROM defacl, s s2 WHERE defaclobjtype = 'S' AND grantee = s2.rt AND privilege_type = 'USAGE')
                THEN 'PASS' ELSE 'FAIL' END,
           coalesce((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM defacl, s s2
                     WHERE defaclobjtype = 'S' AND grantee = s2.rt), 'none')
    FROM s
)
SELECT check_name AS "check", result, detail FROM checks ORDER BY n;
-- <<< VERIFY BODY
