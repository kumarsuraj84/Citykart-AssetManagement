\echo == (g) CL2RU1 token_version (single consistent integer, no lost update) ==
SELECT id, code, token_version FROM asset_user WHERE id=48;
\echo == INV1: duplicate asset codes (expect 0) ==
SELECT asset_code, count(*) FROM asset GROUP BY asset_code HAVING count(*)>1;
\echo == INV2: duplicate live serials excl N/A (expect 0) ==
SELECT lower(trim(serial_number)) s, count(*) FROM asset WHERE serial_number IS NOT NULL AND trim(serial_number)<>'' AND lower(trim(serial_number))<>'n/a' AND deleted_at IS NULL GROUP BY 1 HAVING count(*)>1;
\echo == (c) assets with the duplicate serial CL2-SER-DUP-1 (expect exactly 1) ==
SELECT count(*) FROM asset WHERE lower(serial_number)=lower('CL2-SER-DUP-1');
\echo == INV3: duplicate LIVE po_number per company (expect 0) ==
SELECT company_id, lower(btrim(po_number)) n, count(*) FROM purchase_order WHERE is_active GROUP BY 1,2 HAVING count(*)>1;
\echo == (a) active POs named CL2-PO-DUP-1 (expect 1) ==
SELECT count(*) FROM purchase_order WHERE po_number='CL2-PO-DUP-1' AND is_active;
\echo == (b) PO CL2-PO-RCV-2: delivered vs pending units (expect 6 delivered, 0 pending, none negative) ==
SELECT po.po_number, pa.status, count(*) FROM pending_asset pa JOIN purchase_order po ON po.id=pa.purchase_order_id WHERE po.po_number IN ('CL2-PO-RCV-2','CL2-PO-RCV-IDEM2','CL2-PO-MIX-2') GROUP BY 1,2 ORDER BY 1,2;
\echo == INV4: pending_asset negative remaining check -- any PO line with delivered>ordered (expect 0 rows) ==
SELECT purchase_order_id, line_no, count(*) FILTER (WHERE status='DELIVERED') delivered, count(*) total FROM pending_asset GROUP BY 1,2 HAVING count(*) FILTER (WHERE status='DELIVERED') > count(*);
\echo == INV5: double lifecycle events -- (e) sold asset terminal event count (expect exactly 1 SOLD) ==
SELECT a.id, a.status, count(*) FILTER (WHERE le.event_type='SOLD') sold_events, count(*) total_events FROM asset a LEFT JOIN asset_event le ON le.asset_id=a.id WHERE a.id IN (72,73) GROUP BY a.id, a.status ORDER BY a.id;
\echo == (e) moved asset: status consistent with last event, single holder ==
SELECT a.id, a.status, a.current_asset_user_id,
  (SELECT event_type FROM asset_event WHERE asset_id=a.id ORDER BY id DESC LIMIT 1) last_event,
  (SELECT to_asset_user_id FROM asset_event WHERE asset_id=a.id ORDER BY id DESC LIMIT 1) last_to
FROM asset a WHERE a.id=73;
\echo == INV6: asset status == last lifecycle event target across all CL2 assets created now (ids >= 61) ==
SELECT count(*) AS mismatches FROM asset a
WHERE a.id >= 61 AND a.deleted_at IS NULL
AND a.current_asset_user_id IS DISTINCT FROM (SELECT to_asset_user_id FROM asset_event WHERE asset_id=a.id ORDER BY id DESC LIMIT 1)
AND (SELECT event_type FROM asset_event WHERE asset_id=a.id ORDER BY id DESC LIMIT 1) IN ('MOVED','ALLOTTED','PROCURED','IMPORTED','RECEIVED_FROM_REPAIR');
\echo == (f) duplicate-name master rows (active): vendor/brand/item/category named 'CL2 Dup ...' ==
SELECT 'vendor' t, count(*) FROM vendor WHERE name='CL2 Dup Vendor' AND is_active
UNION ALL SELECT 'brand', count(*) FROM brand WHERE name='CL2 Dup Brand' AND is_active
UNION ALL SELECT 'item', count(*) FROM item WHERE name='CL2 Dup Item' AND is_active
UNION ALL SELECT 'category', count(*) FROM asset_category WHERE name='CL2 Dup Category' AND is_active;
\echo == INV7: orphan pending_asset rows pointing to no PO (expect 0) ==
SELECT count(*) FROM pending_asset pa LEFT JOIN purchase_order po ON po.id=pa.purchase_order_id WHERE po.id IS NULL;
\echo == error_log rows in the last 20 min (expect no 500 / SQL errors) ==
SELECT level, status_code, exception_type, left(coalesce(message,''),70) msg, count(*) FROM error_log WHERE at > now() - interval '20 min' GROUP BY 1,2,3,4 ORDER BY count DESC;
