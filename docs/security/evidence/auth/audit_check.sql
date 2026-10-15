\pset pager off
\echo === category/action distribution in audit_log ===
SELECT category, action, count(*) FROM audit_log GROUP BY 1,2 ORDER BY 1,2;
\echo === safety-net DATA/WRITE rows: which paths (routers with no explicit audit) ===
SELECT changes->>'path' AS path, count(*) FROM audit_log WHERE category='DATA' AND action='WRITE' GROUP BY 1 ORDER BY 2 DESC LIMIT 40;
\echo === explicit audit for recent BRUTE employee create + issue-passwords + login ===
SELECT action, outcome, left(summary,70) AS summary FROM audit_log WHERE entity_id IN ('32','33','34','35') OR summary ILIKE '%Brute%' ORDER BY id DESC LIMIT 12;
\echo === login audit rows present? ===
SELECT action, count(*) FROM audit_log WHERE category='SECURITY' GROUP BY 1 ORDER BY 1;
