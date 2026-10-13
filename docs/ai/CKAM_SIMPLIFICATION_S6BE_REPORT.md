# CKAM Simplification — Stage S6-be report (remaining small backend asks)

| | |
|---|---|
| Starting HEAD | `2c4d574` (feat(assets): S5 backend …), Alembic head `c1d3e5f7a9b0` |
| Scope | Brief items 1–12: dated / referenced batch Move, `?ids=` up to 1,000, `masked` on check-serials, ERP draft open quantity, Item + set in one call, Item `is_set` / `bundle_name`, group Item counts + deactivation refusal, `GET /api/setup/status`, PO header edit, one-area admin vs wider users, `GET /api/home/attention`, cleanups |
| Frontend | not touched (another agent owns `frontend/`) |
| Database | **no schema change, no migration** — still exactly one head `c1d3e5f7a9b0` (`alembic heads`) |
| Commit | none (the controller commits) |
| Tests | backend **1199 → 1266 passed**, 0 failed (`docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q`) |

## 1. What changed, by item

| # | Item | What was done | Status |
|---|---|---|---|
| 1 | Move with date and reference | `POST /api/assets/bulk-move` and `/bulk-action` take optional `event_date` and `reference_no` (one value for the batch), passed to the same `apply_event` the single endpoint uses. A future date or a date before an asset's last movement fails **that asset** with the ledger's sentence; the rest of the batch goes on. Without them: unchanged | done |
| 2 | `GET /api/assets?ids=` | up to **1,000** ids; `limit` up to 1,000 **only** when `ids` is given; ordinary paging keeps its 200 cap (now a plain 422 "At most 200 assets can be listed per page.") | done |
| 3 | check-serials | additive `masked: true` on a conflict whose asset is outside the caller's companies / work area (`asset_code` keeps the old wording) | done |
| 4 | ERP draft | every draft line gains `open_units` and `max_units` (§2.4); the create check (S0.8) now uses the very same helper `erp_open_units` | done |
| 5 | Item + set in one call | `POST/PUT /api/items` accept `set_parts`; the set is created / updated through `app.bundles.service` (`create_bundle` / `update_bundle`) inside the Item's transaction (`app/items/sets.py`); ADMIN / OPERATOR may create such an Item in their own work area; `/api/bundles` create / edit / delete stay head-office only | done |
| 6 | Items rows, group counts, deactivation | Item rows gain `is_set`, `bundle_name`; `GET /api/masters/categories` and `/subcategories` rows gain `item_count` (one aggregate query); deactivating a Category with active Sub-categories / Items, or a Sub-category with active Items, is **refused** (it used to succeed silently) | done |
| 7 | `GET /api/setup/status` | ADMIN and head-office admin; counts + 7 steps from one SELECT | done |
| 8 | PO header edit | `PUT /api/purchase-orders/{id}` (`app/purchase_orders/header.py`): vendor, cost centre, delivery place, PO date, PO number; audited in `master_audit` | done (safe subset, §4.4) |
| 9 | One-area admin vs wider users | refuse (403) changing login / access level / work area of someone whose current work area is wider than the editor's own | done |
| 10 | `GET /api/home/attention` | one call for Home's counters; CKAM figures from two aggregate queries; ERP figures through the existing ERP functions | done (ERP part not a single aggregate, §4.6) |
| 11 | Cleanups | `app/core/app_settings.py` removed (nothing imported it); `AppSetting` model kept (table stays) and marked unused; `primary_asset_domain` **kept** (the frontend sends and shows it) and documented as read by no rule | done |
| 12 | Tests | 67 new tests in 8 files; 3 existing tests updated for the two deliberate behaviour changes | done |

## 2. API changes (with example payloads)

All additive except: (a) a Category / Sub-category deactivation that used to be allowed is now refused when something active is still in it; (b) a one-area ADMIN can no longer narrow / switch off a wider user (S2 had allowed narrowing); (c) the `?ids=` refusal message and limit.

### 2.1 Batch Move with a date and a reference
```json
POST /api/assets/bulk-action
{"asset_ids": [501, 502], "event_type": "MOVED", "to_asset_user_id": 9,
 "event_date": "2026-03-01T00:00:00Z", "reference_no": "GP-77", "remarks": "to store"}
→ 200 {"done": 1, "failed": [{"asset_id": 502, "reason": "The date cannot be before the asset's last recorded movement (01-04-2026)."}]}
```
`POST /api/assets/bulk-move` takes the same two optional fields (`{"asset_ids", "to_asset_user_id", "event_date", "reference_no"}` → `{"moved", "failed"}`). Rules are exactly the single event's (`apply_event`): a future date → "The date cannot be in the future." per asset; today's date without a time on an asset moved earlier today is recorded at that movement's time; a date with no time zone is read as UTC; `reference_no` ≤ 100 characters (schema 422). Out-of-scope ids stay `{"reason": "not found"}`.

### 2.2 `GET /api/assets?ids=…&limit=1000`
* `ids` ≤ 1,000 (more → 422 "You can open at most 1,000 assets at a time.").
* `limit` 1–1,000 is accepted only with `ids`; without `ids` anything above 200 → 422 "At most 200 assets can be listed per page." Default `limit` stays 50 (with or without `ids`). Company / work-area / self-service scope unchanged (ids never widen it).

### 2.3 check-serials
```json
POST /api/purchase-orders/check-serials {"serials": ["LAP-1", "CHAIR-1"]}
→ {"conflicts": [{"serial": "LAP-1", "asset_code": "S0/S0IT/001", "masked": false},
                 {"serial": "CHAIR-1", "asset_code": "an asset outside your companies or work area", "masked": true}]}
```

### 2.4 ERP draft lines (`GET /api/erp/pos/{po_code}/draft`)
Each `lines[]` entry gains:
* `open_units` — the ERP's open units for the line's item code over the whole PO (ordered − cancelled, all lines of that code, whole units). This is exactly the total the create (S0.8) allows for that code.
* `max_units` — the most this line may ask while the other lines of the same code keep their drafted quantities: `min(open_units − others' quantities, 1000)`.
```json
{"item_code": "CT324973", "quantity": 7, "open_units": 9, "max_units": 7, "…": "…"},
{"item_code": "CT324973", "quantity": 2, "open_units": 9, "max_units": 2, "…": "…"}
```
To let a reviewer move units between two lines of one code, the screen caps each line at `open_units − (sum of the other lines' current values)`.

### 2.5 Item and its set in one call
```json
POST /api/items     (ADMIN or OPERATOR, the Item's and every part's work area must be the caller's)
{"name": "Desktop", "category_id": 3, "subcategory_id": 7, "serial_required": true,
 "set_parts": [{"name": "CPU", "item_id": 44, "share_percent": 70}, {"name": "TFT", "item_id": 45, "share_percent": 30}]}
→ 201 {"id": 90, "name": "Desktop", "bundle_id": 12, "is_set": true, "bundle_name": "Desktop", "…": "…"}
```
* A new set is named after the Item. `PUT /api/items/{id}` (ADMIN of the Item's work area, unchanged) with `set_parts` updates the Item's **own** set in place: parts matched by name (any case) keep their identity, parts left out are deactivated (never deleted), the set keeps its name; an Item without a set gets a new one. One `master_audit` row `set_parts` ("CPU 70%, TFT 30%" → "CPU 60%, Keyboard 40%").
* Leaving `set_parts` out = exactly the old behaviour (`bundle_id` decides).
* Refusals (422 unless noted), nothing saved — neither Item nor set:
  "Choose an existing set or list the set's parts, not both." (`bundle_id` other than the Item's own set + `set_parts`) · "A set needs at least one part." · "An Item cannot be a part of its own set." · "A set named X already exists. Choose it as this Item's set, or give the Item another name." · "The set Kit is also used by Kit B, so it cannot be changed from this Item. Ask the head-office admin to change it on the Sets screen." · the bundles service's own sentences (shares must add up to 100, part names must differ, "the Item for 'Old' was not found", "'Desktop' is itself a bundle; …", "has no sub-category") · any Item error (duplicate name …) rolls the new set back · **403** a part of another work area (same sentence as Item creation: "This belongs to the Admin / Non-IT team; you can only work with IT items. …").
* `/api/bundles` POST / PUT / DELETE: unchanged, head-office admin only.

### 2.6 Item rows, group counts, deactivating a group
* `GET /api/items` (and every Item answer): `"is_set": true|false, "bundle_name": "Desktop"|null`.
* `GET /api/masters/categories` / `GET /api/masters/subcategories` rows: `"item_count": 3` (active Items). POST / PUT answers of these two have `"item_count": null` (the count is a list figure).
* `DELETE /api/masters/categories/{id}` → 422 when it still has active Sub-categories or Items:
  "Computers cannot be deactivated because it still has 1 active sub-category (Laptop) and 1 active Item (Laptop). Deactivate them or move them to another group first. Assets already in the register keep their group."
* `DELETE /api/masters/subcategories/{id}` → 422 when it still has active Items: "Laptop cannot be deactivated because it still has 5 active Items (Keyboard, Laptop, Monitor and 2 more). Deactivate them or move them to another sub-category first. Assets already in the register keep their group."
* The work-area check (403) still comes first; a group with only inactive children is deactivated as before; assets keep their Category / Sub-category (history never changes).

### 2.7 `GET /api/setup/status` (ADMIN and head-office admin; others 403)
```json
{"company_count": 2, "place_count": 2, "stock_room_count": 3, "cost_centre_count": 2, "category_count": 2,
 "subcategory_count": 2, "item_count": 4, "vendor_count": 1, "people_count": 8, "store_count": 0,
 "code_rule_configured": true,
 "steps": [{"key": "company", "label": "Company", "done": true},
           {"key": "stock-room", "label": "Stock Room / Places", "done": true},
           {"key": "cost-centre", "label": "Cost Centre", "done": true},
           {"key": "catalogue", "label": "Asset Groups and first Items", "done": true},
           {"key": "vendors", "label": "Vendors", "done": true},
           {"key": "people", "label": "People / Stores", "done": true},
           {"key": "code-format", "label": "Asset Code Format", "done": true}],
 "done_count": 7, "total_steps": 7}
```
Active rows only; `people_count` = active Employees, `stock_room_count` / `store_count` = active Stock Rooms / Stores (head-office admins never counted); step rules = the frontend's `computeSetupSteps` (stock-room needs a place **and** a stock room; catalogue a group **and** an Item; people employees + stores > 0). Keys are the frontend's `SetupStepKey`s.

### 2.8 `PUT /api/purchase-orders/{id}` (ADMIN, OPERATOR; company scope; work area)
```json
{"vendor_id": 32, "cost_center_id": 5, "delivery_asset_user_id": 9, "po_date": "2026-01-15", "po_number": "PO-H2"}
→ 200  (same shape as GET /api/purchase-orders/{id})
```
Only the fields sent change (sending the stored values back writes nothing). Refusals (422): "Goods have already been received on this purchase order, so its vendor and PO number can no longer be changed (the received assets keep what they were received with). Only the delivery place can still be changed." · "This purchase order was made from the ERP, so its PO number and PO date are the ERP's and cannot be changed here." · "This purchase order was made from the ERP, so its vendor follows the ERP supplier. When the ERP moves it to another supplier, apply that from the ERP changes of this purchase order." · "Purchase order PO-B already exists for this company." · "PO number cannot be blank." · "Choose the PO date." · "Choose the cost centre." · "PO date cannot be in the future." · inactive / missing vendor or cost centre ("The vendor Closed Vendor is no longer active; choose another.") · "The cost centre must belong to the same company as the purchase order." · delivery place inactive / of another company · deleted PO ("This purchase order has been deleted, so nothing new can be recorded on it."). 403: a one-area user on a PO with a line of the other area; viewer. 404: another company's PO / a PO the caller cannot see. Audit: `master_audit` rows `entity="purchase_order"`, fields `vendor`, `cost_centre`, `delivery_place` (names), `po_number`, `po_date` (dd-mm-yyyy), actor; `purchase_order.updated_by` set. A new cost centre is also given to the PO's **waiting** units (they carry it to the asset on receipt).

### 2.9 Asset users (one-area admin)
`PUT /api/asset-users/{id}` by an ADMIN limited to IT (or Non-IT) on someone whose current work area is wider (a both-area admin / operator / viewer login) → 403 "Ravi Kumar works in a wider work area than yours (you handle only IT work), so you cannot change their login, access level or work area. Ask the head-office admin." when the request changes `login_enabled`, `role`, `allowed_asset_domains` (unset = BOTH) or `primary_asset_domain`. Phone, email, name, place … stay editable; resending stored values is fine.

### 2.10 `GET /api/home/attention?work_area=&include_erp=true` (ADMIN, OPERATOR, VIEWER; self-service 403)
```json
{"work_area": null, "serial_pending": 2, "under_repair": 1, "lost": 1, "unlinked_assets": 2,
 "waiting_pos": 1, "waiting_units": 5,
 "erp_available": true, "erp_changed_pos": 1, "erp_arrived_pos": 1, "erp_pos_needing_input": 3,
 "inbox": {"items": 1, "vendors": 2, "stores": 212}}
```
| Field | Who gets a number (else null) | Same as |
|---|---|---|
| `serial_pending`, `under_repair`, `lost` | everyone | dashboard `serial_pending_count`, `exception_counts` |
| `unlinked_assets` | ADMIN / head-office | `X-Total-Count` of `/api/assets/unlinked-items` |
| `waiting_pos`, `waiting_units` | ADMIN, OPERATOR | `X-Total-Count` of `/purchase-orders?waiting=true`, dashboard `pending_po_summary.count` |
| `erp_changed_pos`, `erp_arrived_pos`, `erp_pos_needing_input` | ADMIN, OPERATOR, when the ERP link is set up and readable (`erp_available`) | `len(/erp/changes/summary items)`, `len(/erp/reminders)`, `/erp/pos?envelope=true counts.needs_input` |
| `inbox` | head-office admin, ERP readable | `/erp/inbox/counts` |

Scoped by the caller's companies and work area; `work_area` (IT / Non-IT, any spelling) narrows the CKAM figures inside the caller's own area (outside it: ignored; bad value → 422 "Choose a work area: IT or Non-IT."); the ERP figures always use the caller's whole scope. `include_erp=false` skips them. An unreadable ERP never fails the call (`erp_available: false`).

## 3. DB changes

None. No migration, no `create_all`, no table dropped (`app_setting` stays), no data rewritten; single head `c1d3e5f7a9b0`. The PO header audit and the Item `set_parts` audit use the existing append-only `master_audit` table (entity values `purchase_order`, `item`).

## 4. Security and decisions

1. **Ledger**: batch Move passes the date / reference into `apply_event` (still the only writer of status / holder / `status_since`); no new write path.
2. **Item + set**: who may save the Item decides (ADMIN / OPERATOR create, ADMIN of the area edits); every part must be of the caller's work area (403); the set logic is the bundles service's (no copy). A new set never takes over an existing set's name; a set shared by other Items is not changed from one Item. Direct `/bundles` writes stay head-office-only (asserted).
3. **Group deactivation** refused (422) rather than cascading: nothing is deactivated behind the user's back; assets keep their group. Inactive children do not block.
4. **PO header (safe subset)**: the brief locked vendor and cost centre after a receipt; **PO number and PO date are locked too**, because received assets carry them (`asset.po_number`, `po_date`) and changing the PO would make the two disagree — the delivery place is the only header field editable after a receipt. A one-area user may edit the header only when every line is in their area (the header belongs to all lines — same rule as delete). ERP-made POs: cost centre and delivery place editable; number / date / vendor refused (vendor follows `POST /api/erp/purchase-orders/{id}/changes/apply`). Audit = `master_audit` (one row per changed field, names not ids) — simplest durable choice; `purchase_order_erp_change` stays for ERP changes only.
5. **One-area ADMIN vs wider users**: login / role / work area edits refused (403). Deactivation, reset password and company access of such users were **not** in the brief and are unchanged (observation §7).
6. **Home ERP figures** are not single SQL aggregates: they reuse `changes_summary`, `delivery_reminders`, `erp_po_rows`, `inbox_counts` unchanged (they compare CKAM with its ERP copy) so the numbers equal the screens'. CKAM figures: one asset aggregate + one waiting-unit aggregate (statement count asserted constant, ≤ 3 per call with `include_erp=false`).
7. **Setup status** is visible to every ADMIN (including a one-area admin): it shows counts only, across both work areas.
8. **`?ids=` limit**: `limit` above 200 only with `ids`, so ordinary paging cannot pull 1,000 rows.
9. **ERP draft**: `max_units` also respects the 1,000-per-line limit; `open_units` and the create check come from one helper (`erp_open_units`), so they cannot drift.

## 5. Tests

| | count |
|---|---|
| Backend before (HEAD `2c4d574`) | 1199 passed |
| Backend after | **1266 passed, 0 failed** |
| New tests | **67** in 8 files |

* `tests/assets/test_s6_bulk_dates_and_ids.py` (13): dated move on every asset, later-last-movement fails alone (exact sentence, nothing written), future date, unchanged default, bulk-action == single event (7 fields), same-day midnight, limits / scope / viewer, duplicate ids, naive date = UTC, 1,000-asset receipt opens in one request, 200 page cap + default page + 1,001 refused, ids never widen the work area.
* `tests/purchase_orders/test_s6_po_header_and_serials.py` (13): every field + audit names + waiting units' cost centre, only-sent / no-op, after-receipt lock (5 combinations) + delivery place allowed, operator audit actor, number unique per company, ERP-made PO rules, 11 plain refusals, refused edit changes nothing, roles / work area / mixed PO, other company 404 + deleted PO, assets received after an edit carry the new header, `masked` for work area and for another company.
* `tests/erp/test_s6_draft_open_units.py` (4): open units per code after cancellations, `max_units` with sibling lines and the 1,000 cap, draft API fields, create refusal uses the same number and `max_units` is accepted.
* `tests/items/test_s6_item_sets.py` (13): operator makes Item + set, plain Item unchanged, 4 bad sets save nothing, late Item failure rolls the set back, part work area 403 / viewer / both-area admin, nested set + taken set name + `bundle_id` with parts, admin edits own set in place (part identity, deactivation, audit row), Item becomes a set + own-part refusal, shared set refused, `/bundles` stays head-office-only, other-area admin 403, the new set orders on a PO, choosing an existing set by id unchanged.
* `tests/masters/test_s6_group_counts.py` (7): `item_count` on both lists (inactive not counted, row keys), one query for 2 vs 22 groups, category refusal sentence + nothing changed + no audit, sub-category refusal with "and 2 more" then allowed, assets keep their group, work-area 403 first, create / edit answers `item_count: null`.
* `tests/reports/test_s6_home_and_setup.py` (13): setup counts and steps, steps follow the data, roles + one query, Home numbers for the head-office admin, equal to the dashboard / PO list for 3 logins, work area and role, narrowing never widens + 422, other company not counted, unlinked == link tool total, self-service 403, constant statements, ERP figures equal the ERP screens (+ inbox head-office only, `include_erp=false`), unreadable ERP.
* `tests/asset_users/test_s6_wider_work_area.py` (3): 6 refused changes with the sentence, other details / same values allowed, own-area and wider editors unaffected + owner protection kept.
* `tests/core/test_s6_cleanups.py` (2): settings reader gone / table kept, `primary_asset_domain` round-trips and decides nothing.

Existing tests changed (deliberate behaviour changes only):
* `tests/asset_users/test_s2_backend_requests.py::test_an_admin_limited_to_one_work_area_cannot_widen_someone_but_can_edit_other_details` — narrowing a both-area operator by an IT-only admin is now 403 (item 9).
* `tests/assets/test_label_filters.py::test_assets_can_be_listed_for_one_item_and_for_a_known_set_of_ids` — 201 ids now accepted, 1,001 refused (item 2).
* `tests/masters/test_s3a1_domain_masters.py` (2 tests) — the world's Items are deactivated first (and the test's own new sub-category removed) before deactivating their group (item 6).

## 6. Files changed

New: `backend/app/home/__init__.py`, `backend/app/home/service.py`, `backend/app/home/router.py` (setup status, Home attention), `backend/app/items/sets.py` (Item + set), `backend/app/purchase_orders/header.py` (PO header edit), the 8 test files above, this report.
Changed: `app/main.py` (home router); `app/assets/router.py` (bulk date / reference, ids limit); `app/purchase_orders/router.py` (PUT header, `masked`), `schemas.py` (`PurchaseOrderUpdateIn`, `masked`); `app/erp/service.py` (`erp_open_units`, draft `open_units` / `max_units`, create check reuses it); `app/items/router.py`, `schemas.py`, `service.py` (`set_parts`, `is_set`, `bundle_name`); `app/masters/router.py` (list annotation hook, counts, deactivation refusal), `schemas.py` (`item_count`); `app/asset_users/router.py` (wider-user rule), `models.py` (comment); `app/core/models.py` (AppSetting marked unused). Removed: `app/core/app_settings.py`. Tests: the 3 files in §5.

## 7. Observations (not changed)

* A one-area ADMIN can still **deactivate**, reset the password of, or change the company access of a non-owner whose work area is wider (not in this brief; account RBAC decision D6 is still open).
* `GET /api/setup/status` and the `item_count` figures are shown to a one-area ADMIN for both work areas (counts only).
* The Home ERP figures cost what the ERP screens cost (they read CKAM's ERP copy and compare); `include_erp=false` gives the CKAM figures alone in ≤ 3 statements.
* A set made from an Item keeps its first name if the Item is renamed later (renaming the set is head-office work on the Sets screen).
* Still open from earlier frontend asks (not in this brief): `asset_user_id` / `allowed_asset_domains` in the login response (S1 B1, S6A B8, S0F B14), and a `bundle.item_id` link between a set and its Item (S6A B11).
* `primary_asset_domain` is stored, validated and echoed but read by no rule; dropping it needs a frontend change first, then a migration.

## 8. Frontend changes the controller must handle

1. **Move** (`AssetMovement` / Move screen): always one request — send `event_date` and `reference_no` on `POST /api/assets/bulk-action` (or `/bulk-move`) and drop the per-asset fallback; show `failed[].reason` per asset (date refusals now come back per asset).
2. **Labels / "Open assets"**: `GET /api/assets?ids=<up to 1000>&limit=1000` in one request (drop the 200-id chunking); Move's Qty / Add-by-Item can still page with ordinary `limit ≤ 200`, or use `GET /api/assets/pick` (S5).
3. **Delivery / Receive serial check**: use `conflicts[].masked` instead of recognising the "an …" wording.
4. **ERP review (PoDraftCard)**: cap each line's quantity with `max_units` (or `open_units − other lines of the same code`), and show "ERP has N open" from `open_units`.
5. **Item form "Comes as a set"**: send `set_parts` with the Item on `POST /api/items` / `PUT /api/items/{id}` (one call, drop the save-set-first workaround and its retry note); allow it for ADMIN / OPERATOR (gate on `capabilities.can_create.item` for create, `can_manage.item` for edit); show `is_set` / `bundle_name` on Item rows; show the 403/422 sentences as they are.
6. **Asset Groups**: use `item_count` from `/masters/categories` and `/masters/subcategories` (drop counting from `/items`); show the deactivation refusal sentence (B12 answered: refused while active Sub-categories / Items remain).
7. **Set up CKAM + Home head-office row**: `GET /api/setup/status` (`steps[]`, `done_count`, `total_steps`, counts for the status texts) instead of eight lists; keep invalidating it after saves on the Settings screens (new query key, e.g. `["setup","status"]`).
8. **PO detail**: "Edit PO" for vendor / cost centre / delivery place / PO date / PO number → `PUT /api/purchase-orders/{id}` (send only changed fields); after a receipt offer only the delivery place; for an ERP-made PO (`erp_po_code` set) make number / date / vendor read-only.
9. **People & Places (one-area ADMIN)**: hide or disable login / access level / work-area controls for a person whose work area is wider than the editor's (server answers 403 with the sentence); other fields stay editable.
10. **Home**: one `GET /api/home/attention?work_area=<filter>` replaces `/reports/dashboard` counters for "Needs attention", the PO waiting count, `/erp/changes/summary`, `/erp/reminders`, the ERP needing-input count and `/erp/inbox/counts` (head-office row from `inbox`); a null number = not for this login (hide the row); `erp_available: false` = hide ERP rows. The dashboard tables (stock by place, warranty, activity) still come from `/reports/dashboard`.
