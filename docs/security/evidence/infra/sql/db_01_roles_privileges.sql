-- IF-T DB security inspection (read-only). Run: psql -U ckam -d ckam -f db_01_roles_privileges.sql
\echo '== server / connection'
SELECT version();
SELECT current_user, session_user, current_database(), inet_server_addr(), inet_server_port();
SELECT name, setting FROM pg_settings WHERE name IN (
  'listen_addresses','ssl','password_encryption','log_connections','log_disconnections','log_statement',
  'log_min_duration_statement','log_lock_waits','log_line_prefix','statement_timeout','idle_in_transaction_session_timeout',
  'lock_timeout','max_connections','shared_preload_libraries','row_security','default_transaction_read_only',
  'log_destination','logging_collector','authentication_timeout','log_min_error_statement') ORDER BY name;
\echo '== pg_hba rules (needs superuser)'
SELECT line_number, type, database, user_name, address, netmask, auth_method FROM pg_hba_file_rules ORDER BY line_number;
\echo '== roles'
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit,
       (rolpassword IS NOT NULL) AS has_pw, left(coalesce(rolpassword,''),14) AS pw_scheme, rolvaliduntil
FROM pg_authid ORDER BY rolname;
SELECT r.rolname, m.rolname AS member_of FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.member JOIN pg_roles m ON m.oid=am.roleid ORDER BY 1;
\echo '== database / schema ownership and ACLs'
SELECT datname, pg_get_userbyid(datdba) AS owner, datacl FROM pg_database WHERE datname NOT IN ('template0','template1');
SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspacl FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';
\echo '== table owners (count by owner)'
SELECT pg_get_userbyid(c.relowner) AS owner, c.relkind, count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' GROUP BY 1,2 ORDER BY 1,2;
\echo '== PUBLIC grants on public-schema objects'
SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='PUBLIC' AND table_schema='public';
SELECT p.proname, p.proacl, pg_get_userbyid(p.proowner) AS owner, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1;
\echo '== default privileges'
SELECT pg_get_userbyid(defaclrole) AS role, defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl;
\echo '== extensions'
SELECT extname, extversion, pg_get_userbyid(extowner) FROM pg_extension;
\echo '== RLS'
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (relrowsecurity OR relforcerowsecurity);
\echo '== connections'
SELECT usename, application_name, client_addr, ssl, state FROM pg_stat_activity LEFT JOIN pg_stat_ssl USING (pid) WHERE datname='ckam';
