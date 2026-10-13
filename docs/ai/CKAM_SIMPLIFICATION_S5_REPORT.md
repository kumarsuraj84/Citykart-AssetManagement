# CKAM Simplification — Stage S5 report (batch Add Assets, People & Places, Register search, link to Items, report previews)

## Backend

| | |
|---|---|
| Starting HEAD | `3ff8233` (feat(receive): S4 backend …), Alembic head `c1d3e5f7a9b0`. The worktree HEAD moved to `a7a718b` during the stage (frontend-only S5a commit); the backend is unchanged by it |
| Scope | Brief items 1–10: `POST /api/assets/batch`; People & Places (employees, stores with their two rooms, install points, list, ensure-rooms, ERP store create gives rooms); `POST /api/asset-users/issue-passwords`; richer register rows; one register search box + filters; `GET /api/assets/pick`; link existing assets to Items; report previews; frontend asks (a)–(i) |
| Frontend | not touched (other agents own `frontend/`) |
| Database | **no schema change, no migration** — measured, see §5 (still exactly one head `c1d3e5f7a9b0`) |
| Commit | none (the controller commits) |
| Tests | backend **1107 → 1199 passed**, 0 failed (`docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q`) |

### 1. What changed, by item

| # | Item | What was done | Status |
|---|---|---|---|
| 1 | Batch Add Assets | `POST /api/assets/batch` (1–1000 units of one Item): pre-validates everything, 422 `{detail, errors, problems}` with nothing written, else one transaction through the **same** engine (`build_procure_context` → `prepare_unit` → `procure_units` → `write_units` → `apply_events`), one PROCURED event per asset. `POST /api/assets` (single) unchanged | done |
| 2 | People & Places | new router `/api/people`: `POST /employees` (optional login: role, work area, extra companies), `POST /stores` (store + `STK-<code>` + `INS-<code>`, idempotent), `POST /install-points`, `POST /stores/ensure-rooms` (head-office backfill), `GET ""` (one list, `kind` filter, search, paging). `POST /api/erp/stores/create` now gives every created **and** every already-existing store of the request its two rooms | done |
| 3 | Store logins | stores stay login-enabled with no password; new `POST /api/asset-users/issue-passwords` (≤ 500, owners and the caller excluded, passwords only in the answer; a test scans captured logs, stdout/stderr, audit tables and hashes) | done |
| 4 | List / detail fields | `item_id`, `item_name`, `holder_type`, `holder_kind_label`, `holder_name`, `holder_code`, `holder_location_name`, `vendor_name`, `po_number`, `company_code`, `company_name`, `work_area`, `work_area_label`, `erp_item_code` on every register row and on Asset 360 — from **one** label query per page (`app/assets/labels.py`; replaces ~10 per-master lookups) | done |
| 5 | Register search | `q` also matches ERP item code, Item / vendor / brand names and the holder's name and code; ranking exact → starts-with → contains (explicit sort still wins, `exact` kept, ERP code joins the exact set); new filters `holder_type`, `vendor_id`, `po_number`, `holder_id`, `work_area`; all in SQL. Index measurement → no migration (§5) | done |
| 6 | Pick | `GET /api/assets/pick?item_id=&asset_user_id=&quantity=` → oldest N in-stock assets of that Item at that stock room (`X-Total-Count` = how many there are) | done |
| 7 | Link to Items | `GET /api/assets/unlinked-items` (suggestions ERP_CODE / DESCRIPTION / GROUP, never applied) and `POST /api/assets/link-items` (≤ 500, all or nothing, one `asset_field_change` row `item_id` per asset) | done |
| 8 | Report previews | `GET /api/reports/assets/preview` and `GET /api/reports/movements/preview`; the export query builders and row builders are now shared (`_asset_report_args` + `build_asset_query` + `asset_export_values`; `_movements_query` + `movement_export_values`) | done |
| 9 | Frontend asks (a)–(i) | all nine (§2.9) | done |
| 10 | Tests | 92 new tests in 8 files; 1 existing test updated for the additive `created` field | done |

### 2. API changes (with example payloads)

All changes are additive except the deliberately wider register search (§9.1) and the with-lines multi-problem `detail` (§2.9a).

#### 2.1 `POST /api/assets/batch` (ADMIN, OPERATOR; head-office admin)
```json
{"item_id": 44, "quantity": 20, "received_into_asset_user_id": 9, "cost_center_id": 2,
 "serial_numbers": ["CAM-0001", "…", "CAM-0020"],
 "vendor_id": 3, "po_number": "PO-77", "po_date": "2026-01-01", "invoice_number": "INV-9", "invoice_date": "2026-02-01",
 "invoice_amount": 59000, "purchase_cost": 2500, "tax_percent": 18,
 "custom_fields": {"warranty_card": "WC-ALL"}, "unit_custom_fields": [null, {"warranty_card": "WC-2"}]}
```
Optional: `company_id` (must equal the cost centre's company), `serial_mode` (`HAS_SERIAL` / `NO_SERIAL` / `SERIAL_LATER`, any case; default = the Item's rule), `brand_id` (default the Item's default brand when still active), `model`, `warranty_years` (default the Item's, else 0), `description` (default "Item name + brand + model"), `barcode` (blank → NULL), `legacy_asset_code` (only when quantity is 1), `custom_fields` (every unit), `unit_custom_fields` (per unit, wins).
→ **201**
```json
{"assets_created": 20, "serial_pending": 0,
 "assets": [{"asset_id": 501, "asset_code": "FA/CKSPL/IT/0001", "serial_number": "CAM-0001", "serial_pending": false}, "…"],
 "label_asset_ids": [501, "…"]}
```
→ **422** (nothing written, not even a code counter)
```json
{"detail": "Nothing was added: 2 problems need fixing. 3 serial numbers are needed, 2 were typed.",
 "errors": ["3 serial numbers are needed, 2 were typed.", "Unit 2: Serial number OLD-1 is already used by asset FA/CKSPL/IT/0007."],
 "problems": [{"message": "3 serial numbers are needed, 2 were typed."},
              {"unit_index": 2, "serial": "OLD-1", "message": "Serial number OLD-1 is already used by asset FA/CKSPL/IT/0007."}]}
```
Messages: Item missing / no longer active; cost centre missing / of another company than `company_id`; PO or invoice date in the future; invoice before PO date (dd-mm-yyyy); old asset code with quantity > 1; serial rule unknown; N serials needed / M typed; serial too long (unit); typed twice "(units a and b)"; already used (asset named, or "an asset outside your companies or work area"); serials on a NO_SERIAL / SERIAL_LATER batch; too many unit extra-field values; extra fields "<Label> is required." / "must be a number" … (collapsed to one line when every unit has it); and every engine sentence (inactive cost centre / vendor / brand / company, received-into missing / inactive / other company, code-format). **403**: Item of another work area ("This is Non-IT work, which is outside your work area. …"), company outside the caller's ("You can only add assets for your own companies. Ask the head-office admin."), viewer / self-service. Schema 422: quantity 0 / > 1000 ("Quantity must be at most 1,000."), NUL characters.

#### 2.2 People & Places (`/api/people`)
* **`GET /api/people?kind=employees|stores|stock-rooms|install-points&company_id=&q=&limit=200(≤1000)&offset=`** (ADMIN, OPERATOR, VIEWER; company-scoped like `GET /api/asset-users`; another company → `[]`; `X-Total-Count`):
```json
[{"id": 77, "kind": "STORE", "kind_label": "Store", "code": "LAM", "name": "Lucknow Aminabad",
  "company_id": 1, "company_code": "CKSPL", "company_name": "Citykart Stores Pvt Ltd",
  "location_id": 41, "location_name": "Lucknow Aminabad", "department_id": null, "department_name": null,
  "email": "sm.lam@citykartstores.com", "phone": null, "role": "SELF_SERVICE", "role_label": "Own Assets Only",
  "work_area": null, "work_area_label": null, "login_enabled": true, "has_password": false,
  "must_change_password": true, "is_primary_owner": false, "is_active": true}]
```
  Active rows of the four kinds only, ordered by name; `q` = code / name / email / phone / place name. `role_label` only for someone who can sign in (head-office admin → "Head-office Admin"); `work_area` (IT / NON_IT / BOTH) only for a staff login. Bad `kind` → 422 "Choose what to list: employees, stores, stock rooms or install points."
* **`POST /api/people/employees`** (ADMIN, head-office admin) → 201 = a list row:
```json
{"code": "E200", "name": "Mohit", "company_id": 1, "location_name": "HO", "department_id": 3, "phone": "…", "email": "mohit@example.com",
 "login": {"enabled": true, "role": "OPERATOR", "work_area": "IT", "extra_company_ids": [2]}}
```
  `location_id` or `location_name` (existing place of the company with that name, else created). Role any case of ADMIN / OPERATOR / VIEWER / SELF_SERVICE (default SELF_SERVICE); work area IT / NON_IT / BOTH. No password is set (issue one). Refusals: "Choose an access level: …", "Choose a work area: IT, Non-IT or both.", "A work area and extra companies can only be given to someone who can log in.", "Choose where the employee sits, or type the name of the place.", "The location must belong to the same company as the employee.", inactive company / department, bad email, "A person or place with the code X already exists in this company.", 403 "You handle only IT work, so you cannot give anyone a wider work area than your own. …".
* **`POST /api/people/stores`** (ADMIN) `{"code": "lam", "name": "Lucknow Aminabad", "company_id": 1, "location_id"?: …, "location_name"?: …}` → **201** when anything was created, **200** when everything existed:
```json
{"store": {…row…}, "stock_room": {…"code": "STK-LAM", "name": "Lucknow Aminabad Stock Room"…},
 "install_point": {…"code": "INS-LAM", "name": "Lucknow Aminabad Install Point"…},
 "created": ["store", "stock_room", "install_point"], "reused": [], "problems": []}
```
  Code: 3 letters + optional letter or digit (stored upper case; "A store code has three letters and at most one more letter or digit (for example LAM or SPR2)."). Email from the store email rule; login enabled, no password. Place: given, else the company's Location with the store's code, else a new one named after the store. The rooms sit at the store's place. A code used by a non-store, or the email used by someone else → 422; a room code taken by something of another kind → 422 naming it and **nothing** is kept.
* **`POST /api/people/install-points`** (ADMIN) `{"name": "HO Server Room", "company_id": 1, "location_id" | "location_name"}` → 201 row + `"created": true` (code `INS-HOSERVERROOM`); same name in the same company → 200 with the existing one, `"created": false`.
* **`POST /api/people/stores/ensure-rooms[?company_id=]`** (head-office admin) →
```json
{"stores_checked": 212, "stores_completed": 212, "already_complete": 0, "stock_rooms_created": 212,
 "install_points_created": 212, "problems": [{"store_code": "CCC", "company_code": "CKSPL",
 "message": "The code INS-CCC is already used by Wrong kind, so the install point of store CCC was not made."}]}
```
* **`POST /api/erp/stores/create`** — answer gains `rooms: [{code, stock_room_code, stock_room_created, install_point_code, install_point_created, problems}]`, `stock_rooms_created`, `install_points_created`. Existing `created` / `skipped` unchanged; a store skipped because it already exists as a store gets its missing rooms too; a room clash is reported in `rooms[].problems` and does not stop the store.

#### 2.3 `POST /api/asset-users/issue-passwords` (ADMIN, head-office admin)
```json
{"kind": "stores", "company_id": 1, "only_without_password": true}            // or {"asset_user_ids": [77, 78]}
→ 200 [{"asset_user_id": 77, "code": "LAM", "name": "Lucknow Aminabad", "email": "sm.lam@citykartstores.com", "temp_password": "q8Xb…"}]
```
Only active, login-enabled accounts; never a head-office admin, never the caller; `only_without_password` default true; ids + kind + company narrow each other. Each: new argon2 hash, `must_change_password=true`, failed count / lock cleared — same as Reset Password. Nothing chosen → 422 "Choose whose passwords to issue: pick the accounts, or choose stores or employees."; bad kind → "Choose stores or employees."; more than 500 matching → 422 "That is 501 accounts; at most 500 can be given a password at a time. Choose a company, or pick the accounts." (nothing issued); more than 500 ids → schema 422. Ineligible ids are simply left out of the answer.

#### 2.4 Register rows (`GET /api/assets`, `GET /api/assets/{id}`, and every endpoint returning `AssetDetailOut`)
Additive per row: `holder_type`, `holder_kind_label`, `holder_name`, `holder_code`, `holder_location_name`, `company_code`, `work_area`, `work_area_label` (the existing `item_id`, `item_name`, `erp_item_code`, `vendor_name`, `po_number`, `company_name`, `current_asset_user_*` keep their meaning). One label query per page / asset.

#### 2.5 Register search `GET /api/assets`
`q` (≤ 200, `%`/`_`/`\` literal) matches asset code, old code, serial, barcode, ERP item code, PO / invoice / PI number, description, model, Item name, vendor name, brand name, holder name, holder code. No `sort_by` → exact (code or its last segment, old code, serial, barcode, ERP code, PO/invoice/PI equal) first, then starts-with on any of those columns, then contains; newest first inside each group. `exact=true` unchanged (+ ERP code). New query params: `holder_type` (EMPLOYEE / STORE / STOCK_POINT / INSTALLED or the words "stock room", "install point", any case; else 422 "Choose who holds it: an employee, a store, a stock room or an install point."), `holder_id` (= `asset_user_id`), `vendor_id`, `po_number` (whole number, trimmed, any case), `work_area` (IT / NON_IT / "Non-IT"; else 422 "Choose a work area: IT or Non-IT."; outside the caller's area it is ignored like `domain`). Self-service stays pinned to what it holds.

#### 2.6 `GET /api/assets/pick?item_id=&asset_user_id=&quantity=` (ADMIN, OPERATOR)
→ `[{"asset_id": 502, "asset_code": "…/0002", "serial_number": "PK-0002"}, …]` (≤ quantity, oldest = lowest id first; IN_STOCK, not deleted, caller's companies and work area), header `X-Total-Count`. A place outside the caller's companies → 404 "This stock room was not found."; quantity 1–1000.

#### 2.7 Link to Items (ADMIN, head-office admin; others 403 "Only an admin can link assets to Items. …")
* `GET /api/assets/unlinked-items?q=&limit=50(≤200)&offset=` (`X-Total-Count`):
```json
[{"asset_id": 12, "asset_code": "FA/…/0012", "description": "Indoor camera at the gate", "model": null, "serial_number": "OLD-CAM",
  "erp_item_code": null, "status": "IN_STOCK", "company_id": 1, "company_code": "CKSPL", "category_id": 3, "category_name": "Computers",
  "subcategory_id": 7, "subcategory_name": "Laptop", "brand_name": null, "holder_name": "Main Stock", "holder_kind_label": "Stock Room",
  "work_area": "IT", "work_area_label": "IT",
  "suggestions": [{"item_id": 44, "item_name": "Indoor Camera", "score": 0.95, "reason": "DESCRIPTION"},
                  {"item_id": 45, "item_name": "Gang Box", "score": 0.2, "reason": "GROUP"}]}]
```
  ERP_CODE = 1.0 (item rules for the asset's company; an unreadable ERP only means CODE rules alone), DESCRIPTION = word share ≥ 0.5 (capped 0.95), GROUP = 0.4 (the only Item of the sub-category) / 0.2 (2–3 Items); max 5, only Items the asset may be linked to.
* `POST /api/assets/link-items` `[{"asset_id": 12, "item_id": 44}, …]` (1–500) → `{"linked": 1, "unchanged": 0, "results": [{"asset_id": 12, "asset_code": "…", "item_id": 44, "item_name": "Indoor Camera", "changed": true}]}`; 422 `{detail, errors, problems: [{entry_index, asset_id, item_id, message}]}` with nothing changed: "This Item belongs to a different asset group; use Correct Classification first.", "This asset appears more than once; enter it once.", "This asset was not found.", "The Item X is no longer active; choose another.", "The Item you chose does not exist.", other work area sentence, "FA/…/0012 is already linked to the Item Indoor Camera." (the same Item again = `changed: false`).

#### 2.8 Report previews
* `GET /api/reports/assets/preview?status=&category_id=&work_area=&company_id=&item_id=&vendor_id=&po_number=&holder_id=&purchase_from=&purchase_to=&q=&exact=&limit=50(≤200)&offset=0` (any logged-in user, scoped exactly like the export; self-service sees what it holds):
```json
{"total": 9, "columns": ["Asset Code", "Company", "…", "Custom:tag_no"],
 "rows": [{"Asset Code": "S0/S0IT/009", "Company": "S0 Company A", "…": "…"}], "asset_ids": [9, 8, "…"],
 "summary": {"by_status": [{"status": "IN_STOCK", "status_label": "In stock", "count": 8}],
             "by_category": [{"category_id": 3, "category_name": "Computers", "count": 7}],
             "by_item": [{"item_id": 45, "item_name": "Gang Box", "count": 4}]}}
```
  `rows` are exactly the Excel rows (same builder) of that page; `columns` = the file's headings (custom-field columns computed over everything matched, not just the page); `by_item` = top 10 (an unlinked bucket has `item_id: null`). Dates `to` < `from` → 422 "The 'to' date cannot be before the 'from' date.".
* `GET /api/reports/export/assets` accepts the same new filters (`work_area`, `item_id`, `vendor_id`, `po_number`, `holder_id`, `purchase_from`, `purchase_to`) — additive.
* `GET /api/reports/movements/preview?from_date=&to_date=&limit=&offset=` (ADMIN, OPERATOR, VIEWER) → `{"total", "columns", "rows"}`, same rows as the movement export.

#### 2.9 Frontend asks
* (a) `POST /api/purchase-orders/with-lines`: every line and set is tried (own savepoint); 422 `{detail, errors, problems: [{line_index | set_index, message}]}` and nothing created. One problem → `detail` is the old sentence ("Line 2: The Item you chose does not exist."); several → "Nothing was created: 3 problems need fixing. Line 2: …"; header problems → `problems: [{message}]` (no index). Another work area is still a straight 403.
* (b) `GET /api/erp/inbox/counts[?company_id]` (head-office admin) → `{"items": 1, "vendors": 2, "stores": 212}` (same numbers as `GET /api/erp/inbox` `counts.items|vendors|stores`, without its lists and suggestions).
* (c) `POST /api/erp/pos/create`: line `barcode` optional (left out / blank → NULL), sets too.
* (d) `GET /api/erp/pos` rows: `"suggested_vendor": {"vendor_id": 32, "name": "Blue Star MP Office", "reason": "GSTIN", "reason_label": "same GSTIN"}` for an unmatched supplier (GSTIN → PAN → NAME, strongest), `null` when linked or nothing fits.
* (e) `GET /api/erp/vendors?company_id=&q=&limit=&offset=`: `X-Total-Count` always; **no paging params = the whole list as before**; `q` or `offset` without `limit` → 200 per page; `limit` 1–1000.
* (f) `GET /api/items?work_area=IT|NON_IT|mine` (`mine` = the caller's work areas); else 422 "Choose a work area: IT, Non-IT or mine."; left out = every Item (unchanged).
* (g) `POST /api/stock-rooms` answer gains `"created": true|false`.
* (h) `GET /api/auth/capabilities` gains `"companies": [{"id": 1, "code": "CKSPL", "name": "Citykart Stores Pvt Ltd"}]` (same set and order as `company_ids`).
* (i) `POST /api/masters/categories` and `/subcategories`: `code` may be left out / null → made from the name (`ELECTRICALFITTINGS`, clash → `…2`; sub-category codes unique inside their category); an explicit blank is still 422 "Code cannot be blank.".

### 3. Atomicity

Batch add and link-items follow the S4 Receive contract: **check everything, then write everything in one transaction**. Batch add pre-runs the engine's own pure checks (`prepare_unit`, `custom_field_problems`) on every unit with one shared context, so the writer cannot meet a problem the check missed; a late failure (tested by injecting one after the assets and events were written) rolls the whole request back — 0 assets, 0 events, no code counter, and the next batch starts at 001. Issue-passwords commits once for all accounts. People/store creation commits once (a room clash rolls the store back). ERP store create keeps its per-store savepoints (one store's failure never blocks the others, as before).

### 4. DB changes

None. No migration, no `create_all`, no data rewritten. `alembic heads` → `c1d3e5f7a9b0` (single head, asserted by existing tests). The stores' rooms are ordinary `asset_user` rows (STOCK_POINT / INSTALLED); the link audit uses the existing append-only `asset_field_change`.

### 5. Performance

**Batch add** (dev container, `ckam_test`, in-process client; statements = every SQL statement incl. login check):

| Units | Statements | Time |
|---|---|---|
| 1 (no serial) | 17 | 11 ms |
| 50 | 17 | 25 ms |
| 1,000 | 17 | 175 ms |
| 100 with serials vs 1 with a serial | ≤ 1-unit count + 2 (asserted) | — |

**Register search** — measured on a generated scratch database (`ckam_perf`, migrated to head, 2,000 holders, 150 vendors, 60 Items, assets via `generate_series`; dropped afterwards). Time = the whole `search_assets` (count + ranked first page of 50), best of 5:

| Search | 20,000 assets, no extra index | 20,000 + pg_trgm GIN (6 columns) + 2 `lower()` btree | 5,000 assets, no extra index |
|---|---|---|---|
| serial (exact) | 164 ms | 125 ms | 34 ms |
| asset code | 197 ms | 132 ms | 36 ms |
| ERP code | 154 ms | 124 ms | 34 ms |
| common word "laptop" (5,333 hits) | 140 ms | 121 ms | 34 ms |
| holder name | 139 ms | 118 ms | 33 ms |
| vendor name | 153 ms | 145 ms | 39 ms |
| PO number | 123 ms | 125 ms | 35 ms |
| no match | 119 ms | 119 ms | 34 ms |
| no search (newest first) | 6 ms | 4 ms | 24 ms (cold) |

The plan is the same with and without the indexes (merge join on the holder, row-by-row OR filter across the 15 columns of 5 tables); the count alone is 53 ms in SQL either way. The indexes gave no measurable gain beyond noise, so **no migration** (and no `pg_trgm` dependency on the production server). Register page labels: one query, statement count identical for 5 and 105 rows (asserted), and for a search page of 3 or 123 rows (asserted).

### 6. Security (permission table, server-enforced)

| Endpoint | Head-office admin | ADMIN | OPERATOR | VIEWER | SELF_SERVICE | Scope rules |
|---|---|---|---|---|---|---|
| `POST /api/assets/batch` | yes | yes | yes | 403 | 403 | company of the cost centre in scope (403); Item's work area (403); S0 inactive / validation / limits |
| `GET /api/assets/pick` | yes | yes | yes | 403 | 403 | place in caller's companies (404); assets filtered by company + work area |
| `GET /api/assets/unlinked-items` | yes | yes | 403 | 403 | 403 | assets of caller's companies + work area |
| `POST /api/assets/link-items` | yes | yes | 403 | 403 | 403 | asset reachable (company + work area), Item of caller's work area, same group |
| `GET /api/people` | yes | yes | yes | yes | 403 | company-scoped like `GET /api/asset-users` |
| `POST /api/people/employees` | yes | yes | 403 | 403 | 403 | S0/S2 account rules; one-area ADMIN cannot grant a wider area (403) |
| `POST /api/people/stores`, `/install-points` | yes | yes | 403 | 403 | 403 | active company, place of the same company |
| `POST /api/people/stores/ensure-rooms` | yes | 403 | 403 | 403 | 403 | — |
| `POST /api/asset-users/issue-passwords` | yes | yes | 403 | 403 | 403 | never head-office admins, never the caller; ≤ 500 |
| `GET /api/reports/assets/preview` | yes | yes | yes | yes | own custody only | same as the export |
| `GET /api/reports/movements/preview` | yes | yes | yes | yes | 403 | company + work area |
| `GET /api/erp/inbox/counts` | yes | 403 | 403 | 403 | 403 | — |
| changed: `GET /api/erp/pos`, `/erp/vendors`, `/items`, `/stock-rooms`, capabilities, masters categories | unchanged access | | | | | |

* `apply_event` / `apply_events` remain the only writers of `Asset.status` / `current_asset_user_id` / `status_since`; batch add inserts IN_STOCK and moves through the ledger (an Employee / Store / Install Point destination becomes ALLOTTED / INSTALLED there, as on Add Asset). Link-items never touches status, holder or category (asserted). No hard deletes; ledgers append-only; serial uniqueness unchanged (pre-check + DB index).
* Temporary passwords exist only in the response body: not logged (the test turns SQLAlchemy statement logging on and scans every captured record, stdout and stderr), not in `asset_field_change` / `master_audit`, not equal to any stored hash. Hashing runs on ≤ 4 worker threads (argon2, slow on purpose) so the event loop is never blocked.
* Serial conflicts outside the caller's scope never reveal the asset code (batch add). `has_password` is a yes/no, the hash is never returned.

### 7. Tests

| | count |
|---|---|
| Backend before (HEAD `3ff8233`) | 1107 passed |
| Backend after | **1199 passed, 0 failed** |
| New tests | **92** in 8 files |

* `tests/assets/test_s5_batch_add.py` (19): 5 pasted serials (order, codes, every field, PROCURED events with names), 50 no-serial (N/A), 10 serial-later (pending list), Item defaults (brand, warranty, description, retired default brand ignored, company from cost centre), serial-rule override, typed twice (exact unit + nothing written + no counter), already used (named / masked), count mismatch + serials on no-serial, every problem at once, injected late failure → full rollback and no code gap, work area / company / viewer, inactive and missing records in words, required extra fields (once / per unit / too many), equivalence with single Add Asset (all 30+ columns and event fields, straight to a person), blank barcode + limits, statements/timing for 1 / 50 / 1000 (parametrised, prints the table), 1 vs 100 serial statements.
* `tests/assets/test_s5_register.py` (10): row fields in words (stock room, employee, Non-IT, older names kept) + Asset 360, flat statement count 5 vs 105 rows, every searchable field, exact → prefix → contains ranking + sort + exact, wildcard escaping + 200-char limit, new filters + 422s, scope (company, work area, self-service), pick (oldest, header, other Item / room / not in stock), pick scope / roles / limits, fixed paths vs `{asset_id}`.
* `tests/asset_users/test_s5_people.py` (14): employee without / with login (role, work area, extra company, then issue + sign in), role / area / place / email / duplicate refusals, one-area admin cannot widen, only admins (3 roles × 3 endpoints), store = 3 records, idempotent re-run, rooms reused and clash refused (nothing kept), store code / login checks, ERP create gives rooms and re-run adds only what is new, pre-S5 ERP store gets rooms, backfill counts + second run + owner only, install point once per name, list (kind, search, paging, labels, owner row, scope, viewer, bad kind, no hash).
* `tests/asset_users/test_s5_issue_passwords.py` (5): stores get passwords + sign in + must change, only-without-password / ids / company / exclusions, owners / inactive / non-login left out by id, choices + roles + 500 cap (nothing issued), **no password in logs, console, audit tables or hashes**.
* `tests/assets/test_s5_link_items.py` (6): suggestions (DESCRIPTION 0.95, GROUP, ERP_CODE via CODE rule, never another group, nothing applied), unreadable ERP, link sets only the Item + audit rows + `changes` history + no events, one bad entry refuses all (exact sentences), already linked / same Item / work area, roles + paging + search + limits.
* `tests/reports/test_s5_previews.py` (6): first page == Excel rows (+ second page), summary, 9 filter combinations equal to the export, scope (IT operator, viewer, self-service) + limit, movement preview == movement file + scope + 422, self-service 403.
* `tests/erp/test_s5_small_asks.py` (11): with-lines problems (3 at once / single sentence kept / header / 403 / set alone), inbox counts = inbox numbers (+ company, roles, 404), ERP create without barcode (plain line and Desktop set), suggested vendor, supplier list paging / search / old answer, Items by work area, stock-room `created`, capabilities companies (operator, owner, viewer), category / sub-category codes from names.
* `tests/assets/test_s5_edges.py` (21): batch to an Install Point, long serial / later mode / matching company, head-office vs one-area admin vs self-service, full admin for both areas, inactive company / department / wrong places, list of all kinds, issuing unlocks + company filter, ids × kind, holder-kind + exact ERP / code-ending search, store holder label, link-tool group / no-sub-category, one-area admin and a corrected asset, flat search statements, NUL characters, ERP store room clash reported, backfill per company, pick skips deleted, paging past the end, capabilities skip inactive companies, old register filters kept, preview custom columns + `q`.

Existing test changed (intended additive change only): `tests/asset_users/test_s3a1_stock_rooms.py::test_a_new_stock_room_looks_like_a_row_of_the_people_and_places_list` — the stock-room answer now has one more key (`created`).

### 8. Files changed

New: `backend/app/assets/batch.py` (batch add), `backend/app/assets/labels.py` (one-query labels), `backend/app/assets/linking.py` (unlinked list + link), `backend/app/assets/tools_router.py` (batch, pick, unlinked-items, link-items; mounted before the assets router), `backend/app/asset_users/people.py` (People & Places router), `backend/app/asset_users/store_rooms.py` (a store's two rooms), `backend/app/asset_users/kinds.py` (Employee / Store / Stock Room / Install Point words), `backend/app/core/problems.py` (`Refused` 422 shape shared by batch, link, with-lines); the 8 test files above; this report.
Changed: `app/main.py` (2 routers); `app/assets/router.py` (labels, filters, detail), `schemas.py` (`AssetBatchIn`, label fields, `with_labels`), `search_service.py` (`build_asset_query`, wider search, ranking, filters); `app/asset_users/router.py` (issue-passwords), `schemas.py`, `service.py` (`issue_passwords`), `stock_rooms.py` (`resolve_location`, `created`); `app/erp/stores.py` (rooms), `inbox.py` (`inbox_counts`, shared steps), `router.py` (counts, supplier paging), `service.py` (barcode optional, `suggested_vendor`), `schemas.py`; `app/reports/router.py` (shared args / query, previews), `export_service.py` (shared row builders); `app/purchase_orders/with_lines.py`, `router.py` (problems); `app/items/router.py` (work-area filter); `app/core/capabilities.py` (companies), `validation.py` (`parse_work_area`); `app/masters/router.py`, `schemas.py` (optional codes); `tests/asset_users/test_s3a1_stock_rooms.py`.

### 9. Decisions taken where the brief was open

1. **Search breadth**: the search box now also matches Item / vendor / brand / holder names and holder codes, so a word can find more assets than before (e.g. "Dell" now finds assets of brand Dell). Old code / invoice / PI numbers stay searchable. Ranking exact → starts-with → contains; an explicit sort wins.
2. **Received-into on batch add**: any active place of the company (stock room, person, store, install point), exactly like single Add Asset (equivalence test); the ledger sets ALLOTTED / INSTALLED. Receive (S4) keeps its stock-room rule.
3. **Batch description default** = Item name + the batch's effective brand (chosen or the Item's default) + model ("Indoor Camera Dell Latitude"); with-lines keeps its S3a-2 rule (brand typed on the line only).
4. **Old asset code** only when adding one asset (a legacy code identifies one old asset).
5. **Store rooms**: name "<store name> Stock Room" / "… Install Point", at the store's own place, codes `STK-<code>` / `INS-<code>`; reused only when an active record of the right kind has that code; anything else with that code is a reported problem (never renamed or reactivated). `POST /people/stores` refuses the whole store on a clash; ERP create and the backfill report it and carry on.
6. **Store place default** (no place given): the company's Location with the store's code, else a new one — the same as ERP-made stores.
7. **Employee login**: role default SELF_SERVICE ("sees own assets") when a login is enabled without a role; a disabled login always stores SELF_SERVICE; work area / extra companies without a login are refused.
8. **Issue passwords** returns a bare list (the brief's shape); accounts that are not eligible are silently left out; the caller's own account is never included (it would force their own password change); more than 500 matching → refused, not truncated.
9. **Pick order** = oldest first by id (creation order), as S4 "oldest waiting units".
10. **Link tool**: "active assets" = not deleted (any status — a disposed asset can still be classified); an asset already linked to a different Item is refused (changing an Item is not this tool's job); the same Item again is a no-op (`changed: false`). Suggestions only for Items the asset could be linked to. DESCRIPTION capped at 0.95 so an ERP-rule hit (1.0) always ranks first.
11. **Preview rows** are dicts keyed by the file's headings (plus `columns` and a parallel `asset_ids` list) so the rows stay byte-for-byte the export's; the preview's label maps are page-scoped (same values as the export's full maps).
12. **ERP supplier paging**: no `limit` / `offset` / `q` = the whole list as before (existing callers unchanged); any of them → paged, 200 by default.
13. **Items `work_area=mine`** = the caller's work areas (`capabilities.work_areas`).
14. **with-lines** tries every line in its own savepoint to list all problems; the PO is still all-or-nothing.
15. **No index migration** (§5).

### 10. Observations (not changed)

* An ADMIN limited to one work area can still issue / reset passwords of any non-owner account (pre-existing Reset Password rule; account RBAC D6 still open).
* `GET /api/people` (like `GET /api/asset-users`) shows emails and phones to OPERATOR / VIEWER of the same companies.
* Excel asset import still creates assets row by row with its own IMPORTED path (S4 observation stands).
* `POST /api/assets` (single) still accepts category + sub-category without an Item, so unlinked assets can still be made there; the link tool cleans them up afterwards.
* The register search at 20,000 assets is ~120–200 ms per keystroke-page (count + ranked page); if the register grows far beyond the 20k target, a single concatenated search column (generated column + trigram index) would be the next step — not needed now.
* The movement export / preview still show the raw event type ("MOVED") in the Event column (pre-existing export content; the preview mirrors the file by design).
* `POST /api/erp/stores/create` reports room clashes but the head-office admin has no screen yet to fix such a record (rename / deactivate the clashing record, then run ensure-rooms).

### 11. Frontend changes the controller must handle

1. **Add assets screen** → `POST /api/assets/batch` (Item, quantity, received into, cost centre; serial box only when the effective serial rule is HAS_SERIAL — paste one per line; "no serial" / "add later" → `serial_mode`; optional purchase block and advanced block). On 422 show `problems` (common ones on top, `unit_index` / `serial` highlighted in the serial box); on 201 offer labels for `label_asset_ids`, show `assets_created` / `serial_pending`. Keep `POST /api/assets` only if a one-off form is still wanted.
2. **People & Places** menu: lists via `GET /api/people?kind=…` (paging with `X-Total-Count`; show `kind_label`, `role_label`, `work_area_label`, `has_password`); "Add employee" → `POST /api/people/employees` (login toggle: role in words, work area, extra companies); "Add store" → `POST /api/people/stores` (show what was created / reused); "Add install point" → `POST /api/people/install-points`; stock rooms keep `POST /api/stock-rooms` (use `created`). Head-office: a one-off "Give every store its stock room and install point" → `POST /api/people/stores/ensure-rooms` (show counts and `problems`).
3. **Store logins**: "Issue passwords" (stores without one / chosen accounts) → `POST /api/asset-users/issue-passwords`; show the list once (copy / print), warn it will not be shown again; never store it.
4. **ERP stores create** result: show `stock_rooms_created` / `install_points_created` and any `rooms[].problems`.
5. **Register**: use the new row fields (Item column, "With" = `holder_kind_label` + `holder_name` · `holder_location_name`, company code, work area label); one search box → `q` (server ranks; drop client re-ranking); "More filters" → `holder_type`, `vendor_id`, `po_number`, `holder_id`, `work_area`.
6. **Move** "Add N of Item from stock room" → `GET /api/assets/pick` (show "only X in stock" from `X-Total-Count`).
7. **Settings › Link assets to Items** (ADMIN / head-office): `GET /api/assets/unlinked-items` (suggestions with reason words: ERP code / description / same group; "Use suggestion" per row, tick many, one Item for many) → `POST /api/assets/link-items`; show `problems` by `entry_index`.
8. **Reports**: preview table from `GET /api/reports/assets/preview` (headings = `columns`, rows keyed by them, row click → `asset_ids[i]`; summary chips from `summary`) and `GET /api/reports/movements/preview`; the Download button keeps calling the exports with the same filters (they accept the new ones).
9. **One-screen manual PO**: show `problems` per line / set (`line_index` / `set_index`) instead of only `detail`.
10. **Home** (head-office): ERP inbox tile → `GET /api/erp/inbox/counts`.
11. **ERP review**: the line barcode may be left empty; the ERP PO list can show `suggested_vendor` ("Suggested: Blue Star MP Office — same GSTIN").
12. **Vendors › Add from ERP**: may page / search with `q`, `limit`, `offset` (`X-Total-Count`).
13. **Item pickers**: `GET /api/items?work_area=mine` instead of client-side filtering.
14. **Company pickers**: `capabilities.companies` (no extra companies call).
15. **Category / sub-category quick-create**: the code field can be dropped (send no `code`).

## Frontend

