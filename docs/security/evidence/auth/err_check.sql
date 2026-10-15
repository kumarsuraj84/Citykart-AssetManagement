\pset pager off
\echo === error_log: levels / kinds / statuses ===
SELECT level, kind, status_code, count(*) FROM error_log GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 20;
\echo === any 500 unhandled? request_id present and stack redacted? ===
SELECT id, status_code, exception_type, (request_id IS NOT NULL) AS has_rid, left(message,80) AS msg FROM error_log WHERE status_code>=500 ORDER BY id DESC LIMIT 5;
\echo === SUSPICIOUS_INPUT detail ===
SELECT left(summary,120) AS summary, changes FROM audit_log WHERE action='SUSPICIOUS_INPUT' LIMIT 3;
\echo === INVALID_TOKEN rows ===
SELECT left(summary,100) AS summary FROM audit_log WHERE action='INVALID_TOKEN' LIMIT 3;
\echo === any JWT secret / db pw leaked into error_log stacks? (expect 0) ===
SELECT count(*) AS secret_hits FROM error_log WHERE coalesce(stack,'')||coalesce(context::text,'') LIKE '%sec_test_pw%' OR coalesce(stack,'') LIKE '%P3ifIOxX%';
