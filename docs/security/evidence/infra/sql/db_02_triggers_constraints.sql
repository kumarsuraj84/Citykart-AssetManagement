-- IF-T DB security inspection (read-only): append-only triggers, constraints, unique indexes.
\echo '== all non-internal triggers'
SELECT c.relname AS table_name, t.tgname, t.tgenabled,
       CASE WHEN t.tgtype & 1 = 1 THEN 'ROW' ELSE 'STATEMENT' END AS level,
       concat_ws(',', CASE WHEN t.tgtype & 4 = 4 THEN 'INSERT' END, CASE WHEN t.tgtype & 8 = 8 THEN 'DELETE' END,
                 CASE WHEN t.tgtype & 16 = 16 THEN 'UPDATE' END, CASE WHEN t.tgtype & 32 = 32 THEN 'TRUNCATE' END) AS events,
       CASE WHEN t.tgtype & 2 = 2 THEN 'BEFORE' WHEN t.tgtype & 64 = 64 THEN 'INSTEAD' ELSE 'AFTER' END AS timing,
       p.proname
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal ORDER BY 1,2;
\echo '== event triggers'
SELECT evtname, evtevent, evtenabled, evtfoid::regproc FROM pg_event_trigger;
\echo '== unique indexes / constraints on key business identifiers'
SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%UNIQUE%'
  AND tablename IN ('asset','pending_asset','purchase_order','purchase_order_line','idempotency_key','asset_user','vendor',
                    'erp_vendor','erp_po_line','erp_item','item','item_map','company','category','numbering_rule','asset_code_counter',
                    'vendor_erp_link','asset_event','location','stock_room','cost_center')
ORDER BY 1,2;
\echo '== check constraints (count per table) and list for asset/pending_asset/purchase_order'
SELECT conrelid::regclass AS tbl, count(*) FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace GROUP BY 1 ORDER BY 1;
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE contype='c' AND conrelid::regclass::text IN ('asset','pending_asset','purchase_order','purchase_order_line','asset_event','audit_log')
ORDER BY 1,2;
\echo '== FK count per table; tables without any FK but with *_id columns'
SELECT conrelid::regclass AS tbl, count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace GROUP BY 1 ORDER BY 1;
SELECT c.table_name, c.column_name FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name LIKE '%\_id' ESCAPE '\' AND c.column_name <> 'id'
  AND NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum = ANY(k.conkey)
                  WHERE k.contype='f' AND k.conrelid=(quote_ident(c.table_name))::regclass AND a.attname=c.column_name)
ORDER BY 1,2;
\echo '== audit purge function definition'
SELECT p.proname, pg_get_userbyid(p.proowner) owner, p.prosecdef, p.proacl FROM pg_proc p WHERE p.proname ILIKE '%purge%' OR p.proname ILIKE '%append%' OR p.proname ILIKE '%immutable%' OR p.proname ILIKE '%audit%';
