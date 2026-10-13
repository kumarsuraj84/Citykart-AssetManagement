# CKAM Simplification — Stage S3a-2 report (ERP exceptions, vendor matching, in-flow resolution, ERP inbox, one-screen manual PO)

## Backend

| | |
|---|---|
| Starting HEAD | `bdd3256` (feat(masters): S3a-1 in-flow creation …), Alembic head `c1d3e5f7a9b0` |
| Scope | Brief items 1–8 (PO list of every supplier with readiness, draft for an unmatched vendor, create with in-flow vendor match + remembered Item choices, "not tracked" in review, vendor matching GSTIN → PAN → name stem + link-many / import-group, ERP inbox) **plus** the coordinator's addition: `POST /api/purchase-orders/with-lines` (one-screen manual PO) |
| Frontend | not touched (other agents own `frontend/`) |
| Database | **no schema change, no migration** (still exactly one head `c1d3e5f7a9b0`) |
| Commit | none (the controller commits) |
| Tests | backend **942 → 1022 passed**, 0 failed (`docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q`) |

### 1. What changed, by item

| # | Item | What was done | Status |
|---|---|---|---|
| 1 | ERP PO list visibility | `GET /api/erp/pos` lists the OPEN POs of **every** supplier of the caller's companies (not only linked ones), not yet created here; each row gains `readiness`, `problems`, `erp_vendor_code/name`, `vendor_linked`, `undecided_item_count`, `tracked_line_count`, `untracked_line_count`; filters `readiness`, `q`, `company_id`; optional `envelope=true` → `{pos, counts, freshness}` (data-as-of, `refresh_failed` + plain message; an unreadable ERP gives an empty list + message, never a 503). One pass: POs + lines in one read, ERP items in one read, rules and links once | done |
| 2 | Draft for an unmatched vendor | `GET /api/erp/pos/{po_code}/draft` additively carries `vendor` (`{id,name}` or null), `vendor_linked`, `erp_vendor` `{code,name,gstin,pan,group_key}`, `vendor_suggestions` (GSTIN / PAN / NAME, max 5, siblings' vendor first), `vendor_registrations` (same PAN, same company, with link state), `readiness`, `problems`, `undecided_item_count`; every line `resolution`, `suggested_item_id/name`, `suggestion_score`, `suggested_scope`; not-tracked lines keep being left out (they now also carry `resolution`) | done |
| 3 | Create with in-flow resolution | `POST /api/erp/pos/create` accepts `vendor_choice` `{action: LINK, vendor_id}` / `{action: CREATE, name?}` + `also_link_codes`; the link / new vendor is made inside the PO's transaction (all-or-nothing); GSTIN twin, company scope, active vendor, same-PAN checks; without a choice → "… Match the vendor first (Link to an existing vendor or Create a new one)."; lines accept `remember: true` (no `map_scope` → the line's suggested reach); remembered Article / product name now come from the ERP item master, not the browser; a non-owner cannot **re-point** a decision already in force | done |
| 4 | Not tracked in review | new `POST /api/erp/pos/{po_code}/not-tracked {icode, scope}` (ADMIN/OPERATOR, PO's company): CODE / NAME / ARTICLE via the existing `upsert_map` (actor recorded); DEPARTMENT / SECTION / DIVISION → 403 "Ask the head-office admin to mark whole departments as not tracked." (owner allowed); a line that already has an Item → 422 for non-owners; undo stays `DELETE /api/items/maps/{id}` (owner) | done |
| 5 | Vendor matching | `pan_of` (chars 3–12 of a valid GSTIN, PAN pattern checked), `name_stem` (case, punctuation, LTD/LIMITED/PVT/PRIVATE/P/CO/COMPANY/INC/LLP/CORP suffixes, "M/S"/"THE" prefixes, trailing "(MP)" / "-KOLKATA" / ": UP" / "_DEL" qualifiers), `suggest_vendors` GSTIN → PAN → name/stem; `GET /api/erp/vendors` rows gain `pan`, `group_key`, `group_size`, `group_linked_to_vendor_id`, `suggestion_reason` may be `"pan"`; new `POST /api/erp/vendors/{id}/link-many` and `POST /api/erp/vendors/import-group` (ADMIN/OPERATOR, company scope, all-or-nothing). Nothing links without an explicit request | done |
| 6 | ERP inbox | new `GET /api/erp/inbox[?company_id]`, `POST /api/erp/inbox/items/resolve`, `POST /api/erp/inbox/vendors/resolve` (Primary Owner only), reusing `upsert_map`, `create_item`, `link_codes`, `create_vendor_for_codes`, `list_erp_stores`; one transaction per entry | done |
| 7 | Keep | `/api/items/articles|codes|articles/codes|articles/groups|maps` and their owner-only rules unchanged; `GET /api/erp/vendors` stays owner-only; single import / link / unlink unchanged | done |
| 8 | Tests | 80 new tests in 7 files (+ shared world), 2 existing tests updated for the intended visibility change | done |
| + | One-screen manual PO | new `POST /api/purchase-orders/with-lines`: header + lines + sets in ONE transaction through `create_purchase_order`, `add_pending_asset_line` (incl. `next_line_no`) and `add_bundle_lines`; defaults from the Item; barcode optional (NULL path verified through delivery, line groups and label/QR images) | done |

### 2. API changes (with example payloads)

All changes are additive (new fields, new optional body fields, new endpoints) except the deliberate visibility change of `GET /api/erp/pos` (POs of unlinked suppliers are now listed — that is the point of the stage).

**`GET /api/erp/pos`** (ADMIN, OPERATOR; company-scoped) — new query params `readiness` (`READY` | `NEEDS_INPUT`, any case; else 422 "Choose ready or needs input."), `q` (≤ 200 chars; PO number, ERP supplier name or CKAM vendor name; plain substring, `%`/`_` are literal), `company_id` (outside scope → `[]`), `envelope` (bool). Bare list (default, unchanged shape + new fields):
```json
[{"po_code": 5001, "po_number": "SPO/BS/5001", "po_date": "2026-09-18", "company_id": 1, "company_code": "CKSPL",
  "delivery_location": "CKSPL-WH-TAJNAGAR", "vendor_id": null, "vendor_name": "BLUE STAR LTD (MP)",
  "line_count": 1, "net_amount": 165200.0, "tracked_lines": 1, "untracked_lines": 0,
  "erp_vendor_code": "BS2", "erp_vendor_name": "BLUE STAR LTD (MP)", "vendor_linked": false,
  "undecided_item_count": 1, "tracked_line_count": 1, "untracked_line_count": 0, "readiness": "NEEDS_INPUT",
  "problems": [{"kind": "VENDOR_UNMATCHED", "message": "Vendor needs matching."},
               {"kind": "ITEMS_UNDECIDED", "count": 1, "message": "1 item needs a decision."}]}]
```
* `vendor_name` = the CKAM vendor's name when linked, else the ERP supplier's name. `undecided_item_count` = distinct ERP item codes on live lines (ordered − cancelled > 0) with neither an Item nor "not tracked" (a code missing from the ERP item master counts as undecided). A PO made **only** of not-tracked lines is still left out (owner's existing rule).
* `envelope=true`:
```json
{"pos": [...], "counts": {"all": 12, "ready": 9, "needs_input": 3},
 "freshness": {"configured": true, "copied": true, "available": true, "data_as_of": "2026-10-13T05:44:00+00:00",
               "data_as_of_text": "13-10-2026 11:14 am", "last_attempt_at": "2026-10-13T09:00:05+00:00",
               "refresh_failed": true, "message": "ERP data could not refresh. Using data from 13-10-2026 11:14 am."}}
```
  `counts` are before the readiness filter. `data_as_of` = the last successful copy's warehouse stamp (else its finish time); `refresh_failed` = the latest sync run failed after the last good one; text times are India time. If the ERP cannot be read at all: `{"pos": [], "freshness": {…, "available": false, "message": "ERP data could not be read. <reason>"}}` with 200. Without `envelope` an unreadable ERP is still 503 (old behaviour).

**`GET /api/erp/pos/{po_code}/draft`** (ADMIN, OPERATOR) — additive top level:
```json
{"vendor": null, "vendor_linked": false,
 "erp_vendor": {"code": "BS2", "name": "BLUE STAR LTD (MP)", "gstin": "23AAACB4487D1Z0", "pan": "AAACB4487D", "group_key": "CKSPL:AAACB4487D"},
 "vendor_suggestions": [{"vendor_id": 31, "name": "Blue Star Limited", "gstin": null, "reason": "PAN"},
                        {"vendor_id": 32, "name": "Blue Star MP Office", "gstin": "23AAACB4487D1Z0", "reason": "GSTIN"}],
 "vendor_registrations": [{"erp_code": "BS1", "name": "BLUE STAR LIMITED", "gstin": "09AAACB4487D1Z0", "linked": true,
                           "linked_vendor_id": 31, "linked_vendor_name": "Blue Star Limited"},
                          {"erp_code": "BS3", "name": "Blue Star Limited-KOLKATA", "gstin": "19AAACB4487D1ZX", "linked": false,
                           "linked_vendor_id": null, "linked_vendor_name": null}],
 "undecided_item_count": 1, "readiness": "NEEDS_INPUT", "problems": [...], "...existing fields": "..."}
```
each line additively:
```json
{"resolution": {"state": "NEEDS_ITEM", "item_id": null, "item_name": null, "via": null},
 "suggested_item_id": 44, "suggested_item_name": "Network Switch", "suggestion_score": 0.5, "suggested_scope": "ARTICLE"}
```
`resolution.state` = `MATCHED` (`via` CODE/NAME/ARTICLE) or `NEEDS_ITEM`; `untracked_lines[]` entries gain `resolution` `{state: "NOT_TRACKED", via: <level>, why}`. The vendor warning now reads "The vendor X is not linked to a CKAM vendor for <company>. Link it to an existing vendor or create a new one." When the PO's company is not one the caller works in, `vendor_suggestions` / `vendor_registrations` are `[]` and `erp_vendor.gstin` is null (no other company's supplier data leaks).

**`POST /api/erp/pos/create`** (ADMIN, OPERATOR) — body additions:
```json
{"vendor_choice": {"action": "LINK", "vendor_id": 31, "also_link_codes": ["BS1", "BS3"]},
 "lines": [{"item_code": "CT500001", "item_id": 44, "remember": true, "...": "..."}]}
```
or `{"vendor_choice": {"action": "CREATE", "name": "Blue Star"}}` (name optional → the ERP supplier's name; GSTIN and contact from the ERP; code made from the name, S3a-1 rule, e.g. `BLUESTARLTDMP`). Refusals (422, nothing created, the vendor/link rolled back with the PO): no choice and unlinked → "The vendor BLUE STAR LTD (MP) is not linked to a CKAM vendor for Citykart Stores Pvt Ltd. Match the vendor first (Link to an existing vendor or Create a new one)."; GSTIN twin on CREATE → "BLUE STAR LTD (MP) is already a vendor here (same GSTIN as Blue Star MP Office). Link it instead."; LINK to a vendor other than the GSTIN's holder → "BLUE STAR LTD (MP) has the same GSTIN as Blue Star MP Office, which is already a vendor here. Link it to Blue Star MP Office instead."; inactive vendor → "The vendor Old Company is no longer active; choose another."; LINK without `vendor_id` → "Choose the vendor to link to."; `also_link_codes` of another PAN → "JAGANNATH ENTERPRISES is not a registration of the same supplier (its PAN is different), so it is not linked here."; supplier already linked to another vendor + LINK → "The ERP supplier … is already matched to the vendor Vansh Enterprises.". Company outside scope → 403 (unchanged S0 rule).
Remembering: `map_scope` (CODE/NAME/ARTICLE) as before, or `remember: true` without `map_scope` → the server's `suggested_scope`. The rule's Article / product name / section / department are taken from the ERP item master (browser values ignored when the master knows the code). A non-owner whose choice would **change** a decision already in force for that company (the company's own rule, else the every-company rule, whose Item is active or which is "not tracked") → 422 "Line 1 (CT324973): the whole Article 02-I3 CORE[IT-01] is already linked to Desktop. Remember this choice for this code only, or ask the head-office admin to change it." Adding a narrower rule (e.g. CODE) is allowed; the head-office admin may re-point.

**`POST /api/erp/pos/{po_code}/not-tracked`** (new; ADMIN, OPERATOR, owner) `{"icode": "CT500002", "scope": "CODE"}` (`NAME`, `ARTICLE`; `DEPARTMENT`/`SECTION`/`DIVISION` owner only) →
```json
{"po_code": 5001, "po_number": "SPO/BS/5001", "undecided_item_count": 1, "vendor_linked": true, "readiness": "NEEDS_INPUT", "problems": [...],
 "lines": [{"line_key": "2", "item_code": "CT500002", "description": "6U RACK", "quantity": 4,
            "resolution": {"state": "NOT_TRACKED", "item_id": null, "item_name": null, "via": "CODE", "why": "Code"}}]}
```
403 "Ask the head-office admin to mark whole departments as not tracked." / "You can only work on purchase orders of your own company. Ask the head-office admin."; 404 unknown PO; 422 "The ERP item code X is not on the purchase order …", "This line is already linked to the Item Desktop. Ask the head-office admin to change it.", "This code has no product name in the ERP; …". Marking a line that is already not tracked changes nothing (200 with the states).

**`GET /api/erp/vendors?company_id=`** (owner, unchanged access) — each row gains `"pan": "AAACB4487D", "group_key": "CKSPL:AAACB4487D", "group_size": 3, "group_linked_to_vendor_id": 31`; `suggestion_reason` ∈ `gstin` | `pan` | `name` (when the other registrations are linked to one vendor, that vendor is the suggestion with reason `pan`). No-PAN suppliers: `group_key` `"CKSPL:#2264"`, `group_size` 1.

**`POST /api/erp/vendors/{vendor_id}/link-many`** (new; ADMIN, OPERATOR in company scope) `{"company_id": 1, "erp_vendor_codes": ["BS1","BS2","BS3"]}` (1–50, duplicates ignored) → 200
```json
{"vendor": {"id": 31, "code": "BLUESTARLIMITED", "name": "Blue Star Limited", "gstin": "09AAACB4487D1Z0", "erp_links": [...]},
 "linked": ["BS1", "BS2", "BS3"], "already_linked": []}
```
All-or-nothing: unknown code → 422 "The ERP supplier NOPE was not found in the ERP of …"; code linked elsewhere → 422 "… is already linked to the vendor …"; GSTIN of another vendor → 422 (sentence above); inactive vendor 422; unknown vendor 404; other company 403. An empty vendor GSTIN is filled from the first registration (same as a single link).

**`POST /api/erp/vendors/import-group`** (new; ADMIN, OPERATOR in company scope) `{"company_id": 1, "erp_vendor_codes": ["BS4","BS1","BS2"], "name": null}` → 201 `VendorOut` (name = first registration's or `name`, GSTIN = first non-empty, contact = first's, auto code, a link per code). Refused: a code already linked ("… is already a vendor here (already linked). Link the others to that vendor instead."), a GSTIN twin ("… is already a vendor here (same GSTIN as …). Link it instead.").

**`GET /api/erp/inbox?company_id=`** (new; owner only; `company_id` optional = every active company; unknown → 404) →
```json
{"counts": {"items": 1, "vendors": 1, "stores": 212, "item_codes": 2, "vendor_registrations": 3},
 "items": [{"company_id": 1, "company_code": "CKSPL", "article_key": "FA_IT_OTHERS", "article_name": "FA_IT_OTHERS",
            "department": "FA_IT_OTHERS", "section": "IT EQUIPMENTS", "division": "FIXED ASSETS", "suggested_scope": "ARTICLE",
            "codes": [{"icode": "CT500001", "name": "48 PORT SWITCH", "units": 7.0, "po_numbers": ["SPO/BS/5001", "SPO/BS/5002"],
                       "scopes": ["CODE", "NAME", "ARTICLE"]}],
            "suggested_item_id": 44, "suggested_item_name": "Network Switch", "suggestion_score": 0.5,
            "seen_on_pos": ["SPO/BS/5001", "SPO/BS/5002"], "po_count": 2}],
 "vendors": [{"company_id": 1, "company_code": "CKSPL", "group_key": "CKSPL:AAACB4487D", "pan": "AAACB4487D", "name": "BLUE STAR LIMITED",
              "registrations": [{"erp_code": "BS1", "name": "BLUE STAR LIMITED", "gstin": "09AAACB4487D1Z0", "open_pos": 1},
                                {"erp_code": "BS3", "name": "Blue Star Limited-KOLKATA", "gstin": "19AAACB4487D1ZX", "open_pos": 0}],
              "suggested_vendor_id": 31, "suggested_vendor_name": "Blue Star Limited", "suggestion_reason": "NAME"}],
 "stores": [{"code": "LAM", "name": "…", "group": "READY", "selectable": true, "email": "sm.lam@citykartstores.com", "company_id": 1, "...": "existing store row"}]}
```
`counts.items`/`vendors` count groups; `item_codes`/`vendor_registrations` count members. A code without an ERP item record is grouped under `article_key: null` (`suggested_scope: "CODE"`).

**`POST /api/erp/inbox/items/resolve`** (owner) body (1–200 entries):
```json
[{"company_id": 1, "article_key": "FA_IT_OTHERS", "scope": "ARTICLE", "item_id": 44},
 {"company_id": 1, "icode": "CT500002", "scope": "NAME", "create_item": {"name": "Server Rack", "subcategory_id": 7, "serial_mode": "NO_SERIAL"}},
 {"company_id": 1, "icode": "CT777", "scope": "CODE", "not_tracked": true}]
```
→ `[{"ok": true, "message": "Every code of the Article FA_IT_OTHERS is now Network Switch.", "map_id": 12, "item_id": 44}, {"ok": false, "message": "…"}, …]` in order. Exactly one of `item_id` / `create_item` / `not_tracked`. `serial_mode` HAS_SERIAL (default) / NO_SERIAL / SERIAL_LATER. Note: entries carry `company_id` (rules are per company).

**`POST /api/erp/inbox/vendors/resolve`** (owner) `[{"company_id": 1, "erp_vendor_codes": ["BS1","BS2","BS3"], "action": "LINK", "vendor_id": 31}, {"company_id": 1, "erp_vendor_codes": ["2264"], "action": "CREATE", "name": "Jagannath"}]` → `[{"ok": true, "message": "Linked 3 ERP suppliers to Blue Star Limited.", "vendor_id": 31}, {"ok": true, "message": "Vendor Jagannath created and linked to 1 ERP supplier.", "vendor_id": 52}]`.

**`POST /api/purchase-orders/with-lines`** (new; ADMIN, OPERATOR; company scope + work area):
```json
{"company_id": 1, "po_number": "MAN-1", "po_date": "2026-01-01", "vendor_id": 3, "cost_center_id": 2, "delivery_asset_user_id": 9,
 "lines": [{"item_id": 12, "quantity": 2, "purchase_cost": 50000, "tax_percent": 18},
           {"item_id": 12, "quantity": 1, "purchase_cost": 60000, "brand_id": 4, "model": "Latitude 5440", "warranty_years": 1, "barcode": ""}],
 "sets":  [{"bundle_id": 5, "quantity": 2, "price_per_set": 1000, "tax_percent": 18, "part_amounts": [{"part_id": 8, "amount": 800}, {"part_id": 9, "amount": 200}]}]}
```
→ 201 = the `GET /api/purchase-orders/{id}` shape (incl. `company_name`, `vendor_name`, `ordered_units`, `status`, …) + `"lines_created": 4, "units_created": 7`.
* Defaults (same as the ERP draft): description blank → Item name (+ the brand and model **sent on the line**: "Laptop Dell Latitude 5440"); brand not sent → Item's default brand (ignored if that brand is retired); warranty not sent → Item's default warranty, else 0; category / sub-category / work area / serial mode (serial_required / serial_later) from the Item; barcode optional (blank → NULL). Set: description blank → the set's name; barcode optional; parts = `"<description> - <part>"`.
* Line numbers: lines in the order sent (1..n), then each set's parts (one number per part).
* Limits: quantity 1–1000 per line/set, at most 100 lines + sets per request ("A purchase order can have at most 100 lines and sets at a time."), at least one ("Add at least one line or set."), purchase_cost 0–9,999,999,999, tax 0–100, warranty 0–100.
* One transaction: any refusal → nothing created; message names the entry: "Line 2: The Item Old Printer is no longer active; choose another.", "Line 2: The brand Gone Brand is no longer active; choose another.", "Set 1: The set you chose does not exist or is no longer active.", 403 "Line 2: Office Chair: This is Non-IT work, which is outside your work area. …". Header refusals unchanged (inactive cost centre / vendor / delivery place, duplicate PO number, other company 403).

### 3. DB changes

None. No migration, no `create_all`, no data rewritten. `alembic heads` → `c1d3e5f7a9b0` (single head). New ERP-copy reads are plain SELECTs (`LocalErpSource.open_pos_with_lines`, `article_product_names`).

### 4. Security / permission table (new or changed endpoints)

| Endpoint | Head-office admin | ADMIN | OPERATOR | VIEWER / SELF_SERVICE | Scope rules |
|---|---|---|---|---|---|
| `GET /api/erp/pos` (+ new params/fields) | yes | yes | yes | 403 | only the caller's companies (`company_id` outside → `[]`) |
| `GET /api/erp/pos/{code}/draft` (+ new fields) | yes | yes | yes | 403 | supplier/registration details only when the PO's company is in scope |
| `POST /api/erp/pos/create` with `vendor_choice` / `remember` | yes | yes | yes | 403 | company scope (403); work area of each Item (403); vendor active; GSTIN twin; same-PAN for `also_link_codes`; non-owner cannot re-point a decision in force |
| `POST /api/erp/pos/{code}/not-tracked` CODE/NAME/ARTICLE | yes | yes | yes | 403 | PO's company in scope (403); line must be undecided for non-owners |
| … DEPARTMENT/SECTION/DIVISION | yes | 403 | 403 | 403 | — |
| `DELETE /api/items/maps/{id}` (undo) | yes | 403 | 403 | 403 | unchanged |
| `GET /api/erp/vendors` (+ new fields) | yes | 403 | 403 | 403 | unchanged |
| `POST /api/erp/vendors/{id}/link-many` | yes | yes | yes (own companies) | 403 | `ensure_company_for_create`; all-or-nothing |
| `POST /api/erp/vendors/import-group` | yes | yes | yes (own companies) | 403 | same |
| `GET /api/erp/inbox`, `POST /api/erp/inbox/items/resolve`, `POST /api/erp/inbox/vendors/resolve` | yes | 403 "Only the head-office admin can do this." | 403 | 403 | owner sees every company |
| `POST /api/purchase-orders/with-lines` | yes | yes | yes | 403 | `ensure_company_in_scope` (403); work area per line (403); S0/S2/S3a-1 validation and inactive-record rules |

Every write records the actor (`created_by` / `updated_by` on rules, vendors, links, POs and units). The ERP is never written (the copy is only read).

### 5. Performance

| Dataset | Endpoint | Time | Queries |
|---|---|---|---|
| Real dev ERP copy (`ckam`, read-only connection): 18,361 lines, 648 open POs listed (4 ready, 644 need input, 525 of an unmatched supplier) | `erp_po_rows` (= `GET /api/erp/pos`) | 92–94 ms | 10 |
| same | inbox CKSPL (95 Article groups / 319 codes, 47 vendor groups / 88 registrations, 212 ready stores) | 110 ms | 23 |
| same | inbox CKVPL (37 groups / 123 codes, 34 vendor groups) | 27 ms | 23 |
| Test fixture (ckam_test): 18,000 lines, 120 open POs × 30 lines among 1,440 closed POs | `GET /api/erp/pos?envelope=true` (incl. login checks) | 107–239 ms | 14 |
| same | `GET /api/erp/inbox` | 142–226 ms | — |

`test_the_number_of_queries_does_not_grow_with_the_number_of_pos` asserts the same query count for 3 POs × 2 lines and 150 POs × 12 lines (+50 closed POs). Before S3a-2 the list ran one supplier-filtered header read + one line read + one rule load **per company** and only for linked suppliers.

### 6. Tests

| | count |
|---|---|
| Backend before (HEAD `bdd3256`) | 942 passed |
| Backend after | **1022 passed, 0 failed** |
| New tests | **80** in 7 files + shared world `tests/erp/s3a2_world.py` |

* `tests/erp/test_s3a2_vendor_matching.py` (29): PAN extraction (8 cases), 9 name spellings → one stem, real words not cut, suggestion order GSTIN → PAN → NAME, `/erp/vendors` group fields and sibling suggestion, PAN suggestion, link-many (actor recorded, duplicates, already linked), all-or-nothing (unknown code, linked elsewhere), GSTIN twin, scope / roles / inactive vendor, import-group (naming, first GSTIN, auto code, links), refusals create nothing, single import/link/unlink unchanged.
* `tests/erp/test_s3a2_po_list.py` (10): unmatched supplier listed with both problems, undecided counted per code / not-tracked apart / cancelled ignored, all-untracked PO still out, readiness / q (literal) / company filters + 422, company scope per login, envelope counts + freshness, `refresh_failed` sentence with India time, unreadable ERP never blocks the envelope (bare list keeps 503), created PO disappears, fallback for older sources.
* `tests/erp/test_s3a2_draft_create.py` (15): draft vendor block (suggestions incl. siblings' vendor first, registrations with link state), line resolution / suggestion / scope, NAME default for a catch-all Article, linked supplier has no suggestions, other company's supplier details hidden, create with LINK + `also_link_codes`, CREATE (code, GSTIN, actor; next PO matched by itself), atomic rollback of new vendor and link on a later failure, GSTIN twin / other PAN / wrong-vendor link refusals, plain sentence without a choice, scope (OPV 403), inactive vendor, missing vendor_id, already-matched supplier, remember → suggested scope ARTICLE (browser values ignored), remember → NAME in a catch-all Article, operator / admin / IT operator remember CODE / NAME / ARTICLE, re-point refused for operator (exact sentence, nothing created), CODE narrowing allowed, owner may re-point.
* `tests/erp/test_s3a2_not_tracked.py` (7): operator CODE (case-insensitive code, actor, draft leaves the line out), NAME + ARTICLE by ADMIN / IT operator, DEPARTMENT/SECTION/DIVISION refused with the exact sentence (owner allowed), undo owner-only, refusals (decided line, code not on PO, other company, viewer, unknown PO, bad scope, idempotent), **precedence regression** (CODE > NAME > ARTICLE > DEPARTMENT; Item beats broader not-tracked), company rule beats every-company rule and never reaches the other company.
* `tests/erp/test_s3a2_inbox.py` (9): owner-only (OPR / ADM / VWR 403 on all three), 404 company; only undecided codes on open POs grouped by Article (closed PO, cancelled line, decided code, created PO, not-tracked code excluded); vendor PAN groups with unlinked siblings + suggestion, then sibling-linked suggestion by PAN; ready stores not created; every company; item batch with mixed success/failure and per-entry transactions (incl. create Item with serial mode); whole-Article not tracked hides the PO made only of it; vendor batch (GSTIN refusal, LINK / CREATE / missing vendor).
* `tests/erp/test_s3a2_performance.py` (3): query count independent of PO count (through the real `LocalErpSource`), copy reads (`open_pos_with_lines`, `article_product_names`), 18k-line timing (< 5 s asserted; ~0.1–0.2 s measured).
* `tests/purchase_orders/test_s3a2_po_with_lines.py` (7): defaults from Item (description incl. brand/model, brand, warranty, serial_later, no-serial), line numbers lines → set parts, set without barcode + edited part amounts, atomic rollback naming the line / set, retired default brand ignored, company / work-area / inactive header / viewer / duplicate refusals, limits (1001 units, 101 entries, empty, 100 allowed), NULL barcode through delivery (incl. serial later), Asset 360, label.png (barcode + QR) and qr.png, line groups.

Existing tests changed (intended visibility change only): `tests/erp/test_erp_api.py` (`FakeErp` gains `open_pos_with_lines`; `test_only_open_pos_of_linked_vendors_are_offered` → `…_and_an_unlinked_vendors_po_is_shown_as_needing_input`), `tests/erp/test_vendor_links.py` (the picker test now also expects the two unmatched POs with `vendor_id: null`).

### 7. Files changed

New: `backend/app/erp/readiness.py` (readiness, problems, suggested scope, freshness, one-read helpers), `backend/app/erp/inbox.py`, `backend/app/purchase_orders/with_lines.py`, `backend/tests/erp/s3a2_world.py`, the 7 test files above, this report.
Changed: `backend/app/erp/{service,router,schemas,vendors,local_source,source}.py`, `backend/app/items/service.py` (`suggest_item`, `find_rule`, `active_rule_sets` factored out of existing code — same logic), `backend/app/bundles/service.py` (`barcode_optional` flag, default off), `backend/app/purchase_orders/{router,schemas}.py`, the 2 existing tests above.

### 8. Decisions taken where the brief was open

1. **Suggested reach rule**: ARTICLE when the Article has ≤ 5 distinct product names (the ERP item's own name — first non-placeholder CAT — normalised) among the codes the PO's company bought in it, counting the line's own name; else NAME if the code has a product name; else CODE. A code missing from the ERP item master → CODE. Read from the copy in one query (`article_product_names`).
2. **Undecided count** is per distinct ERP item code (a decision is per code), not per line.
3. **Envelope** instead of changing the list's shape: `envelope=true` returns `{pos, counts, freshness}`; the bare list stays backward compatible (and keeps its 503 when the ERP is unreadable).
4. **Remembered rule content comes from the ERP item master**, not from the browser (same S0.8 principle); the browser's Article fields are used only when the master has no record, and then only CODE can be remembered.
5. **No re-pointing by non-owners**: remembering or "not tracked" may only ADD a decision for an undecided key; changing a decision in force (company or every-company rule) is rule management → head-office admin. A narrower rule (e.g. CODE inside a linked Article) is allowed (the engine's precedence makes it win for that code only).
6. **GSTIN twin rules in the new link paths**: linking a supplier whose GSTIN belongs to another vendor is refused (link it to that vendor). The pre-existing single `POST /vendors/{id}/link` is unchanged (no new refusal) for compatibility.
7. **`vendor_choice` when the supplier is already linked**: CREATE is ignored (the existing link is used), LINK to a different vendor is refused, LINK to the same vendor is fine; `also_link_codes` must share the PO supplier's PAN in the same company.
8. **New vendor code** (CREATE / import-group): made from the name like any vendor added in the flow (S3a-1 `unique_code`, 30 chars); the old single import keeps the ERP-code rule. The duplicate-name rule of the masters screen is not applied (ERP paths keep their GSTIN rule, as in S3a-1).
9. **Inbox scope**: codes / suppliers only from OPEN ERP POs **not yet created in CKAM** (a created PO no longer waits for anything); the vendor groups also list the unlinked registrations of the same PAN that have no open PO (`open_pos: 0`) so "link all" covers them. Inbox resolve entries carry `company_id` (rules are per company). One commit per entry; a refused entry is rolled back alone.
10. **Not tracked on an already-not-tracked line** is a no-op (no second rule).
11. **with-lines**: the default description adds only the brand/model *sent on the line* (not the Item's default brand); sets are numbered after the lines; a blank set description defaults to the set's name.
12. **Freshness** times in words are India time (UTC+05:30, fixed offset).

### 9. Observations (not changed)

* `GET /api/erp/pos` is company-scoped but not work-area-filtered (an undecided line has no work area yet); a one-area operator sees POs of the other team and is stopped at create (403 per Item). Consider filtering READY POs by the resolved Items' area later.
* An ERP PO whose ERP company is not set up in CKAM (no `erp_company_code` match) is still not listed anywhere (needs Setup > Companies); the draft warns.
* The single `POST /api/erp/vendors/{id}/link` still has no GSTIN-twin refusal (kept for compatibility).
* `known_gstins` reads the ERP **copy** (`erp_vendor`); before the first copy (live source) the "GSTIN of a linked supplier" route to a vendor is unavailable — PAN/name and the explicit sibling rule still work.
* The inbox `stores` list reuses `list_erp_stores` unchanged (CKSPL dev: 212 ready stores — the inbox will be dominated by them until stores are created).
* The draft endpoint still answers (with a warning, no supplier details) for a PO of a company outside the caller's scope (pre-existing behaviour).
* 525 of the 648 open dev POs are of unmatched suppliers — after this stage they are visible as "needs input"; the inbox's vendor groups (47 CKSPL + 34 CKVPL) are the quickest way to clear them.

### 10. Frontend changes the controller must handle

1. **Pick from ERP** (`PoFromErp`): call `GET /api/erp/pos?envelope=true[&readiness=&q=&company_id=]`; show chips "Ready (counts.ready) · Needs your input (counts.needs_input)"; per row the `problems[].message` sentences (never the `kind`); `vendor_name` is the ERP supplier's when `vendor_linked` is false; header "ERP data as of `freshness.data_as_of_text`" and, when `freshness.refresh_failed`, the `freshness.message` banner; `freshness.available=false` → show its message instead of an error. Server-side search replaces client filtering.
2. **Review (PoDraftCard)** for an unmatched supplier (`vendor_linked=false`): a vendor block with `erp_vendor` (name, GSTIN), `vendor_suggestions` ("Link to <name>" buttons; reason in words: same GSTIN / same PAN (another registration) / similar name), "Create new vendor" (optional name), and when `vendor_registrations` has unlinked rows "also link the other N registrations" (→ `also_link_codes`). Send the choice as `vendor_choice` in the create call (no separate vendor call needed). Do not send `vendor_id` for an unmatched supplier.
3. **Review lines**: use `resolution.state` (MATCHED collapsed with "matched by code/product name/Article"; NEEDS_ITEM open), preselect `suggested_item_id` ("Suggested: Network Switch"), "Remember" **on by default** → send `remember: true` (omit `map_scope`) or the reach the user picked; word the default from `suggested_scope` ("for every code in this ERP group" / "for this product name" / "for this code only"). Handle the 422 "… is already linked to … Remember this choice for this code only, or ask the head-office admin …" by offering CODE.
4. **"Not an asset"** on a NEEDS_ITEM line → `POST /api/erp/pos/{po_code}/not-tracked {icode, scope}` (CODE / NAME / ARTICLE for everyone; Department/Section/Division only when `capabilities.is_head_office_admin`); refresh the line states from the response (`lines[].resolution`, `readiness`).
5. **Vendors > Add from ERP** (owner screen): show `pan`, group the rows by `group_key` (`group_size`), "Link all N registrations" → `POST /api/erp/vendors/{id}/link-many`, "Create one vendor for these registrations" → `POST /api/erp/vendors/import-group`; `suggestion_reason` may now be `pan`. Both new endpoints also work for ADMIN/OPERATOR (in-flow).
6. **ERP inbox** (head-office admin; show when `capabilities.is_head_office_admin`): `GET /api/erp/inbox[?company_id]` → three counters (`counts.items`, `counts.vendors`, `counts.stores`) and sections; items by Article with "Use suggestion / Pick another / + New Item / Not an asset" → `POST /api/erp/inbox/items/resolve` (batch; show each `{ok, message}`); vendors by PAN group → `POST /api/erp/inbox/vendors/resolve`; stores → existing `POST /api/erp/stores/create`. Settings > ERP > Advanced mapping keeps the existing Codes/Articles/Groups screens (endpoints unchanged).
7. **One-screen manual PO** (`NewPurchaseOrderForm`): one Save → `POST /api/purchase-orders/with-lines` with `lines[]` (Item, quantity, cost, tax; description / barcode / brand / model / warranty optional — leave blank to take the Item's defaults; barcode may stay empty) and `sets[]` (`bundle_id`, `quantity`, `price_per_set`, optional `part_amounts`); show the 422/403 `detail` as is (it names "Line N" / "Set N"); the response is the PO row (+ `lines_created`, `units_created` for "PO created: N lines, M units waiting"). The old header-then-lines calls keep working.
8. All new `detail` / `message` values are plain sentences — show them as they are.
