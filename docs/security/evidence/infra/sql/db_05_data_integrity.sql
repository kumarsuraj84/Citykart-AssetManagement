-- IF-T data-integrity checks (read-only SELECTs). Each check prints `check | violations | sample ids`.
-- A non-zero `violations` is a finding to investigate (some are INFO by design: see the note on each line).
-- Run: psql -U ckam -d ckam -X -f db_05_data_integrity.sql
\pset pager off
WITH latest_event AS (
  SELECT DISTINCT ON (asset_id) asset_id, id, event_type, status_after, to_asset_user_id, event_date, recorded_at
  FROM asset_event ORDER BY asset_id, id DESC
), checks AS (
  -- I01 asset cost centre belongs to another company
  SELECT 'I01 asset.cost_center company <> asset.company' AS chk, a.id::text AS sample
  FROM asset a JOIN cost_center cc ON cc.id = a.cost_center_id WHERE cc.company_id <> a.company_id
  UNION ALL
  -- I02 asset holder (current_asset_user) of another company (INFO: cross-company allotment is an owner decision 2026-10-13)
  SELECT 'I02 asset holder company <> asset.company (INFO by design?)', a.id::text
  FROM asset a JOIN asset_user u ON u.id = a.current_asset_user_id WHERE u.company_id <> a.company_id
  UNION ALL
  -- I03 asset work area differs from its category's work area
  SELECT 'I03 asset.asset_domain <> category.asset_domain', a.id::text
  FROM asset a JOIN asset_category c ON c.id = a.category_id
  WHERE c.asset_domain IS NOT NULL AND a.asset_domain IS DISTINCT FROM c.asset_domain
  UNION ALL
  SELECT 'I04 asset.subcategory not under asset.category', a.id::text
  FROM asset a JOIN asset_subcategory s ON s.id = a.subcategory_id WHERE s.category_id <> a.category_id
  UNION ALL
  SELECT 'I05 asset.item category <> asset.category', a.id::text
  FROM asset a JOIN item i ON i.id = a.item_id WHERE i.category_id IS NOT NULL AND i.category_id <> a.category_id
  UNION ALL
  SELECT 'I06 asset with NO ledger event', a.id::text
  FROM asset a WHERE NOT EXISTS (SELECT 1 FROM asset_event e WHERE e.asset_id = a.id)
  UNION ALL
  SELECT 'I07 asset.status <> latest event status_after', a.id::text
  FROM asset a JOIN latest_event le ON le.asset_id = a.id WHERE a.status IS DISTINCT FROM le.status_after
  UNION ALL
  SELECT 'I08 asset.current_asset_user_id <> latest event to_asset_user_id', a.id::text
  FROM asset a JOIN latest_event le ON le.asset_id = a.id
  WHERE le.event_type IN ('MOVED','ALLOTTED','RETURNED','INSTALLED') AND a.current_asset_user_id IS DISTINCT FROM le.to_asset_user_id
  UNION ALL
  SELECT 'I09 asset event holder (to_asset_user) of another company than asset (INFO)', e.id::text
  FROM asset_event e JOIN asset a ON a.id = e.asset_id JOIN asset_user u ON u.id = e.to_asset_user_id WHERE u.company_id <> a.company_id
  UNION ALL
  SELECT 'I10 pending_asset company <> its purchase_order company', p.id::text
  FROM pending_asset p JOIN purchase_order po ON po.id = p.purchase_order_id WHERE p.company_id <> po.company_id
  UNION ALL
  SELECT 'I11 pending_asset DELIVERED without delivered_asset_id', p.id::text
  FROM pending_asset p WHERE p.status = 'DELIVERED' AND p.delivered_asset_id IS NULL
  UNION ALL
  SELECT 'I12 pending_asset NOT delivered but has delivered_asset_id', p.id::text
  FROM pending_asset p WHERE p.status <> 'DELIVERED' AND p.delivered_asset_id IS NOT NULL
  UNION ALL
  SELECT 'I13 delivered asset company <> pending_asset company', p.id::text
  FROM pending_asset p JOIN asset a ON a.id = p.delivered_asset_id WHERE a.company_id <> p.company_id
  UNION ALL
  SELECT 'I14 same asset delivered by two pending lines', a_id::text
  FROM (SELECT delivered_asset_id a_id FROM pending_asset WHERE delivered_asset_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x
  UNION ALL
  SELECT 'I15 purchase_order cost_center of another company', po.id::text
  FROM purchase_order po JOIN cost_center cc ON cc.id = po.cost_center_id WHERE cc.company_id <> po.company_id
  UNION ALL
  SELECT 'I16 purchase_order delivery holder of another company (INFO?)', po.id::text
  FROM purchase_order po JOIN asset_user u ON u.id = po.delivery_asset_user_id WHERE u.company_id <> po.company_id
  UNION ALL
  SELECT 'I17 pending_asset cost_center of another company', p.id::text
  FROM pending_asset p JOIN cost_center cc ON cc.id = p.cost_center_id WHERE cc.company_id <> p.company_id
  UNION ALL
  SELECT 'I18 pending_asset domain <> category domain', p.id::text
  FROM pending_asset p JOIN asset_category c ON c.id = p.category_id
  WHERE c.asset_domain IS NOT NULL AND p.asset_domain IS DISTINCT FROM c.asset_domain
  UNION ALL
  -- serial uniqueness: case / whitespace variants among assets (the CI unique index should make this 0)
  SELECT 'I19 asset serial duplicate (case/trim-insensitive)', min(id)::text
  FROM asset WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '' AND lower(btrim(serial_number)) <> 'n/a' AND deleted_at IS NULL
  GROUP BY lower(btrim(serial_number)) HAVING count(*) > 1
  UNION ALL
  -- inner whitespace / dash variants are NOT covered by the index
  SELECT 'I20 asset serial duplicate ignoring ALL whitespace/dashes (not covered by index)', min(id)::text
  FROM asset WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '' AND lower(btrim(serial_number)) <> 'n/a' AND deleted_at IS NULL
  GROUP BY lower(regexp_replace(serial_number, '[\s\-_]', '', 'g')) HAVING count(*) > 1
  UNION ALL
  SELECT 'I21 open (PENDING) pending_asset serial already on an asset', p.id::text
  FROM pending_asset p JOIN asset a ON lower(btrim(a.serial_number)) = lower(btrim(p.serial_number))
  WHERE p.status = 'PENDING' AND p.serial_number IS NOT NULL AND btrim(p.serial_number) <> ''
  UNION ALL
  SELECT 'I22 two open pending_asset rows with the same serial', min(id)::text
  FROM pending_asset WHERE status = 'PENDING' AND serial_number IS NOT NULL AND btrim(serial_number) <> ''
  GROUP BY lower(btrim(serial_number)) HAVING count(*) > 1
  UNION ALL
  SELECT 'I23 asset_code duplicate case/trim-insensitive (unique index is case-SENSITIVE)', min(id)::text
  FROM asset GROUP BY lower(btrim(asset_code)) HAVING count(*) > 1
  UNION ALL
  SELECT 'I24 asset_code with leading/trailing whitespace or lowercase', id::text
  FROM asset WHERE asset_code <> btrim(asset_code) OR asset_code <> upper(asset_code)
  UNION ALL
  SELECT 'I25 live PO number duplicate within company (case/trim)', min(id)::text
  FROM purchase_order WHERE is_active GROUP BY company_id, lower(btrim(po_number)) HAVING count(*) > 1
  UNION ALL
  SELECT 'I26 PO erp_po_code whose ERP line company <> PO company', po.id::text
  FROM purchase_order po JOIN company c ON c.id = po.company_id
  JOIN erp_po_line l ON l.po_code = po.erp_po_code
  WHERE upper(l.company_code) <> upper(coalesce(c.erp_company_code, c.code))
  UNION ALL
  SELECT 'I27 vendor_erp_link points at an ERP vendor code that does not exist for that company', v.id::text
  FROM vendor_erp_link v JOIN company c ON c.id = v.company_id
  WHERE NOT EXISTS (SELECT 1 FROM erp_vendor e WHERE upper(e.company_code) = upper(coalesce(c.erp_company_code, c.code))
                                               AND e.vendor_code = v.erp_vendor_code)
  UNION ALL
  SELECT 'I28 same ERP vendor code linked to two CKAM vendors in one company', min(id)::text
  FROM vendor_erp_link GROUP BY company_id, btrim(erp_vendor_code) HAVING count(DISTINCT vendor_id) > 1
  UNION ALL
  SELECT 'I29 ERP vendor code with whitespace/case variants in links', id::text
  FROM vendor_erp_link WHERE erp_vendor_code <> btrim(erp_vendor_code)
  UNION ALL
  SELECT 'I30 item_map pointing at an inactive item (active map)', m.id::text
  FROM item_map m JOIN item i ON i.id = m.item_id WHERE m.is_active AND NOT i.is_active
  UNION ALL
  SELECT 'I31 asset_user company_access to an inactive company', (x.asset_user_id||'/'||x.company_id)
  FROM asset_user_company_access x JOIN company c ON c.id = x.company_id WHERE NOT c.is_active
  UNION ALL
  SELECT 'I32 login-enabled user in an inactive company', u.id::text
  FROM asset_user u JOIN company c ON c.id = u.company_id WHERE u.login_enabled AND u.is_active AND NOT c.is_active
  UNION ALL
  SELECT 'I33 more than one primary owner', string_agg(id::text, ',')
  FROM asset_user WHERE is_primary_owner AND is_active HAVING count(*) > 1
  UNION ALL
  SELECT 'I34 login-enabled ACTIVE user without password and not must_change (dormant open login)', u.id::text
  FROM asset_user u WHERE u.login_enabled AND u.is_active AND u.password_hash IS NULL AND NOT u.must_change_password
  UNION ALL
  SELECT 'I35 password_hash not argon2id', u.id::text
  FROM asset_user u WHERE u.password_hash IS NOT NULL AND u.password_hash NOT LIKE '$argon2id$%'
  UNION ALL
  SELECT 'I36 asset_document stored_path contains .. or is absolute outside uploads', d.id::text
  FROM asset_document d WHERE d.stored_path LIKE '%..%' OR (d.stored_path LIKE '/%' AND d.stored_path NOT LIKE '/data/uploads/%')
  UNION ALL
  SELECT 'I37 asset_event recorded_by NULL (actor unknown)', e.id::text
  FROM asset_event e WHERE e.recorded_by IS NULL
  UNION ALL
  SELECT 'I38 asset_event dated in the future', e.id::text
  FROM asset_event e WHERE e.event_date > current_date + 1
  UNION ALL
  SELECT 'I39 asset negative/zero cost or quantity-like values', a.id::text
  FROM asset a WHERE a.purchase_cost < 0 OR a.total_cost < 0 OR a.tax_percent < 0 OR a.tax_percent > 100
  UNION ALL
  SELECT 'I40 audit_log row with no actor and no source (unattributable)', l.id::text
  FROM audit_log l WHERE l.actor_id IS NULL AND l.actor_code IS NULL AND coalesce(l.source,'') = ''
  UNION ALL
  -- audit completeness: an asset whose id / code never appears in any audit row (CREATE, RECEIVE, BATCH_ADD, IMPORT...)
  SELECT 'I41 asset with no audit_log trace at all (id or code)', a.id::text
  FROM asset a WHERE NOT EXISTS (
     SELECT 1 FROM audit_log l WHERE (l.entity = 'asset' AND l.entity_id = a.id::text)
        OR (jsonb_typeof(l.changes) = 'object' AND l.changes->'ids' @> to_jsonb(a.id)) OR l.changes::text LIKE '%' || a.asset_code || '%' OR l.summary LIKE '%' || a.asset_code || '%')
  UNION ALL
  SELECT 'I42 purchase_order with no audit_log row', po.id::text
  FROM purchase_order po WHERE NOT EXISTS (SELECT 1 FROM audit_log l WHERE l.entity = 'purchase_order' AND l.entity_id = po.id::text)
  UNION ALL
  SELECT 'I43 asset_user with no audit_log CREATE row', u.id::text
  FROM asset_user u WHERE NOT EXISTS (SELECT 1 FROM audit_log l WHERE l.entity = 'asset_user' AND l.entity_id = u.id::text AND l.action IN ('CREATE','IMPORT','BATCH_ADD'))
  UNION ALL
  SELECT 'I44 asset_event with no audit_log row for the asset (MOVE etc.)', e.id::text
  FROM asset_event e WHERE e.event_type <> 'PROCURED' AND NOT EXISTS (
     SELECT 1 FROM audit_log l WHERE l.entity = 'asset' AND (l.entity_id = e.asset_id::text OR l.changes::text LIKE '%' || e.asset_id || '%') AND l.category = 'LIFECYCLE')
)
SELECT chk AS check, count(sample) AS violations, string_agg(sample, ',' ORDER BY sample) FILTER (WHERE sample IS NOT NULL) AS sample_ids
FROM checks GROUP BY chk ORDER BY chk;
