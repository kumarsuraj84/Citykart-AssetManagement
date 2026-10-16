-- =====================================================================================================================
-- CKAM database role split (security IF-05 / IF-06 / OBS-DOCKER-SU / EXT-07)
--
-- Three roles instead of one:
--   owner_role     NOLOGIN. Owns the database, every CKAM table, sequence, function and trigger.
--   migrator_role  LOGIN. Owns nothing. Member of owner_role; every session switches to owner_role
--                  (ALTER ROLE ... IN DATABASE ... SET role, plus ALEMBIC_SET_ROLE in backend/app/alembic/env.py),
--                  so objects created by Alembic belong to owner_role. Used ONLY for `alembic upgrade head`.
--   runtime_role   LOGIN. Owns nothing. The running application (DATABASE_URL). SELECT/INSERT/UPDATE/DELETE on
--                  ordinary tables; SELECT/INSERT only on the four append-only ledgers; SELECT only on
--                  alembic_version; USAGE/SELECT only on sequences (no UPDATE, so no setval: CL2-IF-01);
--                  no TRUNCATE / TRIGGER / CREATE anywhere; cannot run ckam_purge_audit_log;
--                  cannot ALTER, DROP or DISABLE anything (only the owner can); no stored session defaults
--                  (ALTER ROLE ... RESET ALL at the end: CL2-IF-02).
--
-- Run as a SUPERUSER, connected to the CKAM database, with psql (version 10 or newer):
--
--   psql -X -v ON_ERROR_STOP=1 -d <ckam database> \
--        -v db_name=<ckam database> -v owner_role=<owner> -v migrator_role=<migrator> -v runtime_role=<runtime> \
--        [-v current_owner=<role that owns the CKAM objects today; default = runtime_role>] \
--        [-v schema_name=public] \
--        -f ops/db/role_split.sql
--
-- Production example (names are a management decision, SD-11; these are only the proposal):
--   -v db_name=ckassetmanagement -v owner_role=ckasset_owner -v migrator_role=ckasset_migrator
--   -v runtime_role=ckassetapp   (ckassetapp keeps its password and becomes the non-owner runtime role)
--
-- PASSWORDS ARE NEVER IN THIS FILE. New LOGIN roles are created WITHOUT a password (they cannot sign in until the
-- DBA sets one). Afterwards the DBA types it at the psql prompt:   \password <migrator_role>
-- (\password sends only a SCRAM hash; nothing readable reaches the server log). For automated throw-away tests
-- only, -v migrator_password=... / -v runtime_password=... are accepted at run time.
--
-- Idempotent: running it twice gives the same result. Everything between BEGIN and COMMIT is one transaction:
-- if any step fails, nothing is changed. Read ops/db/ROLE_SPLIT_RUNBOOK.md first.
-- Touches ONLY the named database and the three named roles. It never uses REASSIGN OWNED (which would also move
-- databases and objects of that role elsewhere on a shared server).
-- =====================================================================================================================

\set ON_ERROR_STOP on

\if :{?db_name}
\else
  \echo 'role_split.sql: missing -v db_name=<ckam database>'
  \quit
\endif
\if :{?owner_role}
\else
  \echo 'role_split.sql: missing -v owner_role=<owner role>'
  \quit
\endif
\if :{?migrator_role}
\else
  \echo 'role_split.sql: missing -v migrator_role=<migrator role>'
  \quit
\endif
\if :{?runtime_role}
\else
  \echo 'role_split.sql: missing -v runtime_role=<runtime role>'
  \quit
\endif
\if :{?current_owner}
\else
  \set current_owner :runtime_role
\endif
\if :{?schema_name}
\else
  \set schema_name public
\endif

BEGIN;

-- psql variables are not expanded inside $$ bodies, so they are handed to the body as transaction-local settings.
SELECT set_config('ckam_split.db_name', :'db_name', true),
       set_config('ckam_split.schema_name', :'schema_name', true),
       set_config('ckam_split.owner_role', :'owner_role', true),
       set_config('ckam_split.migrator_role', :'migrator_role', true),
       set_config('ckam_split.runtime_role', :'runtime_role', true),
       set_config('ckam_split.current_owner', :'current_owner', true) AS _settings \gset

-- >>> ROLE SPLIT BODY (plain SQL; backend/tests/security/test_least_privilege_role_split.py runs exactly this part)

-- 1. Pre-checks: right database, a superuser session, three different roles, never the session's own role.
DO $split$
DECLARE
    db  text := current_setting('ckam_split.db_name');
    o   text := current_setting('ckam_split.owner_role');
    m   text := current_setting('ckam_split.migrator_role');
    r   text := current_setting('ckam_split.runtime_role');
    sch text := current_setting('ckam_split.schema_name');
BEGIN
    IF current_database() <> db THEN
        RAISE EXCEPTION 'role split: connected to database %, but db_name is %', current_database(), db;
    END IF;
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'role split: run this as a superuser (session role is %)', current_user;
    END IF;
    IF o = m OR o = r OR m = r THEN
        RAISE EXCEPTION 'role split: owner, migrator and runtime roles must be three different roles';
    END IF;
    IF current_user IN (o, m, r) THEN
        RAISE EXCEPTION 'role split: the superuser running this (%) must not be one of the three CKAM roles', current_user;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch) THEN
        RAISE EXCEPTION 'role split: schema % does not exist in database %', sch, db;
    END IF;
END
$split$;

-- 2. Roles (created if missing; attributes forced to the least-privileged form if they exist).
DO $split$
DECLARE
    o text := current_setting('ckam_split.owner_role');
    m text := current_setting('ckam_split.migrator_role');
    r text := current_setting('ckam_split.runtime_role');
    db text := current_setting('ckam_split.db_name');
    limits constant text := ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = o) THEN
        EXECUTE format('CREATE ROLE %I NOLOGIN', o) || limits;
    ELSE
        EXECUTE format('ALTER ROLE %I NOLOGIN', o) || limits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = m) THEN
        EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT', m) || limits;
    ELSE
        EXECUTE format('ALTER ROLE %I LOGIN NOINHERIT', m) || limits;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('CREATE ROLE %I LOGIN', r) || limits;
    ELSE
        -- An existing runtime role (production: ckassetapp) keeps LOGIN and its password.
        EXECUTE format('ALTER ROLE %I', r) || limits;
    END IF;

    -- The migrator may act as the owner (SET ROLE); NOINHERIT: it has none of the owner's rights until it does.
    IF NOT pg_has_role(m, o, 'MEMBER') THEN
        EXECUTE format('GRANT %I TO %I', o, m);
    END IF;
    -- Every migrator session in this database starts as the owner, so a forgotten ALEMBIC_SET_ROLE still
    -- creates owner-owned objects.
    EXECUTE format('ALTER ROLE %I IN DATABASE %I SET role = %L', m, db, o);

    -- The runtime role must not be able to become the owner or the migrator.
    IF EXISTS (SELECT 1 FROM pg_auth_members am JOIN pg_roles g ON g.oid = am.roleid JOIN pg_roles u ON u.oid = am.member
               WHERE u.rolname = r AND g.rolname = o) THEN
        EXECUTE format('REVOKE %I FROM %I', o, r);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members am JOIN pg_roles g ON g.oid = am.roleid JOIN pg_roles u ON u.oid = am.member
               WHERE u.rolname = r AND g.rolname = m) THEN
        EXECUTE format('REVOKE %I FROM %I', m, r);
    END IF;
END
$split$;

-- 3. Ownership: every CKAM object in the schema that the current owner holds moves to the owner role. Only this
--    database and this schema; objects are moved one by one (never REASSIGN OWNED).
DO $split$
DECLARE
    o   text := current_setting('ckam_split.owner_role');
    cur text := current_setting('ckam_split.current_owner');
    sch text := current_setting('ckam_split.schema_name');
    db  text := current_setting('ckam_split.db_name');
    obj record;
BEGIN
    EXECUTE format('ALTER DATABASE %I OWNER TO %I', db, o);
    -- Schema `public` (PostgreSQL 15+) is owned by pg_database_owner, i.e. now by the owner role. Any other
    -- schema (or an old-style public owned by the current owner) is moved explicitly.
    IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = sch) = cur THEN
        EXECUTE format('ALTER SCHEMA %I OWNER TO %I', sch, o);
    END IF;
    IF cur = o THEN
        RETURN;
    END IF;
    -- Tables first: ALTER TABLE ... OWNER also moves their indexes, triggers and owned (serial/identity) sequences.
    FOR obj IN
        SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = sch AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND pg_get_userbyid(c.relowner) = cur
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER %s %I.%I OWNER TO %I',
                       CASE obj.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                                        WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
                       sch, obj.relname, o);
    END LOOP;
    -- Stand-alone sequences that no table owns.
    FOR obj IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = sch AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) = cur
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', sch, obj.relname, o);
    END LOOP;
    -- Functions and procedures (the append-only trigger functions, ckam_purge_audit_log, the asset guards).
    FOR obj IN
        SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = sch AND pg_get_userbyid(p.proowner) = cur AND p.prokind IN ('f', 'p')
    LOOP
        EXECUTE format('ALTER ROUTINE %s OWNER TO %I', obj.sig, o);
    END LOOP;
    -- Stand-alone types (enum, domain, range, multirange); table row types move with their table.
    FOR obj IN
        SELECT t.typname, t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = sch AND pg_get_userbyid(t.typowner) = cur AND t.typtype IN ('e', 'd', 'r')
    LOOP
        EXECUTE format('ALTER %s %I.%I OWNER TO %I', CASE obj.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END,
                       sch, obj.typname, o);
    END LOOP;
END
$split$;

-- 4. Database and schema access: nobody but the named roles may connect; nobody but the owner may create.
DO $split$
DECLARE
    o   text := current_setting('ckam_split.owner_role');
    m   text := current_setting('ckam_split.migrator_role');
    r   text := current_setting('ckam_split.runtime_role');
    sch text := current_setting('ckam_split.schema_name');
    db  text := current_setting('ckam_split.db_name');
BEGIN
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', db);
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM %I', db, r);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I, %I', db, m, r);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', sch);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', sch, r);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', sch, m);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', sch, r);
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', sch, o);
END
$split$;

-- 5. Runtime privileges on the existing objects (reset first, so a re-run removes anything extra).
DO $split$
DECLARE
    r   text := current_setting('ckam_split.runtime_role');
    m   text := current_setting('ckam_split.migrator_role');
    sch text := current_setting('ckam_split.schema_name');
    t   text;
    -- The append-only ledgers (migrations 0003, a409768dc2cf, master_audit, audit_log, a3c5e7f9b1d4). A future
    -- migration that adds an append-only table must add it here AND revoke UPDATE/DELETE/TRUNCATE in that migration.
    append_only constant text[] := ARRAY['asset_event', 'asset_field_change', 'master_audit', 'audit_log'];
BEGIN
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', sch, r);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', sch, r);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', sch, m);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', sch, m);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', sch, r);
    -- CL2-IF-01: USAGE (nextval, i.e. the id column defaults) and SELECT (currval / reading) only. NEVER UPDATE:
    -- UPDATE allows setval, which can exhaust audit_log's id sequence (every audit write fails) or rewind
    -- asset_event's (every movement fails with a duplicate id), and setval survives a ROLLBACK.
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', sch, r);
    FOREACH t IN ARRAY append_only LOOP
        IF to_regclass(format('%I.%I', sch, t)) IS NOT NULL THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.%I FROM %I', sch, t, r);
        END IF;
    END LOOP;
    -- Alembic's bookkeeping: the app only reads it (health/diagnostics show the migration head).
    IF to_regclass(format('%I.alembic_version', sch)) IS NOT NULL THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I.alembic_version FROM %I', sch, r);
    END IF;
    -- The guarded audit archive function stays owner-only (a3c5e7f9b1d4 already revoked it from PUBLIC).
    IF to_regprocedure(format('%I.ckam_purge_audit_log(timestamptz)', sch)) IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %I.ckam_purge_audit_log(timestamptz) FROM PUBLIC', sch);
        EXECUTE format('REVOKE ALL ON FUNCTION %I.ckam_purge_audit_log(timestamptz) FROM %I', sch, r);
    END IF;
END
$split$;

-- 6. Objects created by FUTURE migrations (run as the owner role) are usable by the runtime role at once.
DO $split$
DECLARE
    o   text := current_setting('ckam_split.owner_role');
    r   text := current_setting('ckam_split.runtime_role');
    sch text := current_setting('ckam_split.schema_name');
BEGIN
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
                   o, sch, r);
    -- CL2-IF-01: no UPDATE (setval) on future sequences either; the REVOKE removes it where an earlier version of
    -- this script granted it, so a re-run repairs such a database.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE UPDATE ON SEQUENCES FROM %I',
                   o, sch, r);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I',
                   o, sch, r);
END
$split$;

-- 7. CL2-IF-02: no stored session defaults for the runtime role. A role may `ALTER ROLE <itself> SET ...` for
--    user-settable parameters (default_transaction_read_only = on, a 1 ms statement_timeout, search_path ...),
--    which PostgreSQL cannot forbid and which survives restarts. CKAM needs none, so every stored default of the
--    runtime role (all databases and "all databases") is cleared here; the check scripts FAIL if one reappears.
DO $split$
DECLARE
    r  text := current_setting('ckam_split.runtime_role');
    db text := current_setting('ckam_split.db_name');
    d  record;
BEGIN
    EXECUTE format('ALTER ROLE %I RESET ALL', r);
    EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', r, db);
    FOR d IN
        SELECT db2.datname FROM pg_db_role_setting rs JOIN pg_database db2 ON db2.oid = rs.setdatabase
        WHERE rs.setrole = (SELECT oid FROM pg_roles WHERE rolname = r)
    LOOP
        EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', r, d.datname);
    END LOOP;
END
$split$;

-- <<< ROLE SPLIT BODY

COMMIT;

-- Optional, automated throw-away tests only: passwords given on the command line. In production use \password.
\if :{?migrator_password}
ALTER ROLE :"migrator_role" PASSWORD :'migrator_password';
\endif
\if :{?runtime_password}
ALTER ROLE :"runtime_role" PASSWORD :'runtime_password';
\endif

\echo 'role_split.sql: done. Now run ops/db/role_split_verify.sql with the same -v names (every row must be PASS).'
