\pset pager off
\echo ===ROLE PRIVS (app connects as ckam)===
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname='ckam';
\echo ===BRUTE ACCOUNT STATE===
SELECT id, code, failed_login_count, (locked_until IS NOT NULL) AS locked, left(password_hash,14) AS hash_prefix, length(password_hash) AS hash_len FROM asset_user WHERE id IN (32,33,34,35) ORDER BY id;
\echo ===PASSWORD HASH ALGO sample===
SELECT distinct left(password_hash,10) AS algo FROM asset_user WHERE password_hash IS NOT NULL;
\echo ===PLAINTEXT TEST PW SCAN (expect 0 everywhere)===
SELECT 'audit_log.changes' AS loc, count(*) AS hits FROM audit_log WHERE changes::text ILIKE '%Sec#Test2026ok%' OR changes::text LIKE '%E7jV9Jr084un%' OR changes::text LIKE '%e4RGKb99JktE%';
SELECT 'error_log' AS loc, count(*) AS hits FROM error_log WHERE coalesce(context::text,'')||coalesce(stack,'')||coalesce(message,'') LIKE '%Sec#Test2026ok%';
SELECT 'system_event.details' AS loc, count(*) AS hits FROM system_event WHERE details::text ILIKE '%Sec#Test2026ok%';
SELECT 'client_report' AS loc, count(*) AS hits FROM client_report WHERE coalesce(message,'')||coalesce(note,'')||coalesce(breadcrumbs::text,'') ILIKE '%Sec#Test2026ok%';
SELECT 'idempotency.response_json' AS loc, count(*) AS hits FROM idempotency_key WHERE response_json::text ILIKE '%password%';
\echo ===AUDIT APPEND-ONLY: can app role UPDATE/DELETE audit_log? (rolled back)===
BEGIN;
UPDATE audit_log SET summary = summary WHERE id = (SELECT min(id) FROM audit_log);
\echo rowcount above = UPDATE allowed count
DELETE FROM audit_log WHERE id = (SELECT min(id) FROM audit_log);
\echo rowcount above = DELETE allowed count
ROLLBACK;
\echo ===LIFECYCLE LEDGER append-only: can app role UPDATE/DELETE asset_event? (rolled back)===
BEGIN;
UPDATE asset_event SET id = id WHERE id = (SELECT min(id) FROM asset_event);
ROLLBACK;
\echo ===can app role TRUNCATE audit_log? (rolled back)===
BEGIN;
TRUNCATE audit_log;
\echo TRUNCATE succeeded (rolled back)
ROLLBACK;
