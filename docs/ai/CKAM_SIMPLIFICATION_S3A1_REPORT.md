# CKAM Simplification — Stage S3a-1 report (in-flow creation of small masters, work-area ownership, capabilities, stock rooms)

## Backend

| | |
|---|---|
| Starting HEAD | `6e63150` (feat(po): S2 backend exact PO line identity …), Alembic head `b8d0f2a4c6e8` |
| Scope | Brief items 1–7: vendor / brand / cost-centre creation for ADMIN + OPERATOR (optional code), Item creation in the flow and work-area ownership of Category / Sub-category / Item, work-area change with confirmation + audit, stock-room create/list, `GET /api/auth/capabilities`, ERP vendor import/link for ADMIN + OPERATOR, plain 403 sentences |
| Frontend | not touched (other agents own `frontend/`) |
| Database | **one additive migration** `c1d3e5f7a9b0_master_audit` (see §4) |
| Commit | none (the controller commits) |
| Tests | backend **813 → 942 passed**, 0 failed (`docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q`) |

### 1. What changed, by item

| # | Item | What was done | Status |
|---|---|---|---|
| 1 | Vendor / Brand / Cost centre | `POST /api/masters/vendors|brands|cost-centers` open to ADMIN + OPERATOR (cost centre: caller's companies only); `code` optional (made from the name when left out or `null`); new vendor/brand refused when an **active** one has the same name; PUT/DELETE head-office admin only, with a plain 403 | done |
| 2 | Item | `POST /api/items` for ADMIN + OPERATOR in their own work area; `PUT`/`DELETE` for an ADMIN of the Item's work area (and the head-office admin); cross-area move needs both areas + confirmation; every edit / deactivation audited; list rows gain `work_area`, `category_name`, `subcategory_name`; seed / maps / articles / codes unchanged (head-office admin) | done |
| 3 | Category / Sub-category | create / edit / deactivate for the head-office admin and any ADMIN inside their work area; operators, viewers, self-service: 403; a sub-category only under a category of the caller's area; moving a category to the other area: both-area ADMIN or head-office admin + `confirm_domain_change: true`; name / work-area / deactivation audited | done |
| 4 | Stock room | new `POST /api/stock-rooms` (ADMIN + OPERATOR, company scope; Location reused or created from `location_name`; code `STK-…`; idempotent by company + name) and `GET /api/stock-rooms` (writers) | done |
| 5 | Capabilities | new `GET /api/auth/capabilities`, built from `app/core/capabilities.py` — the same functions every S3a-1 endpoint enforces with | done |
| 6 | ERP vendor import / link | `POST /api/erp/vendors/import` and `POST /api/erp/vendors/{id}/link` open to ADMIN + OPERATOR inside their company scope (link keeps `created_by`); `DELETE …/link` and `GET /api/erp/vendors` stay head-office admin | done |
| 7 | Messages | every new refusal is a plain sentence that says who can do it (§3) | done |

### 2. API changes (with example payloads)

All changes are additive except the deliberate permission widening. No response shape lost a field.

**`POST /api/masters/vendors`** (ADMIN, OPERATOR, head-office admin) — `code` now optional:
```json
{"name": "Vansh Enterprises Pvt. Ltd.", "gstin": "07AAAAA0000A1Z5"}
→ 201 {"id": 31, "code": "VANSHENTERPRISESPVTLTD", "name": "Vansh Enterprises Pvt. Ltd.", "gstin": "07AAAAA0000A1Z5", "erp_links": [], ...}
```
* Code made from the name: upper-case letters and digits only, cut to 30 characters for a vendor (column allows 100; kept readable), 20 for brand and cost centre; a clash (ignoring case and spaces, against active **and** deactivated rows of the scope, since the unique key covers both) gets a number: `HP` → `HP2` → `HP3`; a name with no letters/digits → `VENDOR` / `BRAND` / `CC`. Cost-centre codes are unique per company.
* A code that **is** sent works exactly as before (trimmed; blank → 422 "Code cannot be blank."; case-insensitive duplicate → 422 "A record with the code X already exists.").
* New vendor / brand with the same name as an active one (trimmed, any case) → 422 "A vendor with this name already exists." / "A brand with this name already exists.". Existing rows are never checked against each other or changed.
* Refusals: VIEWER / SELF_SERVICE → 403 "Your access does not allow adding a vendor. Ask an admin or the head-office admin."

**`POST /api/masters/brands`** — same, e.g. `{"name": "Lenovo India"}` → `"code": "LENOVOINDIA"`.

**`POST /api/masters/cost-centers`** — same, plus company scope: `{"name": "Farukhnagar W/H", "company_id": 1}` → `"code": "FARUKHNAGARWH"`; an OPERATOR aiming at another company → 403 "You can only add a cost centre for your own company. Ask the head-office admin to add it for another company." (an ADMIN works in every company, as before).

**`PUT` / `DELETE /api/masters/vendors|brands|cost-centers/{id}`** — unchanged (head-office admin); the 403 now reads "Only the head-office admin can change vendors. Ask the head-office admin to do it." / "… can remove vendors …".

**`POST /api/masters/categories`** — head-office admin, or an ADMIN whose work area includes `asset_domain`:
```json
{"code": "ELEC", "name": "Electricals", "asset_domain": "NON_IT"}
```
IT-only ADMIN → 403 "This belongs to the Admin / Non-IT team; you can only work with IT items. Ask someone in the Admin / Non-IT team or the head-office admin."; OPERATOR → 403 "Only an admin can add or change categories and sub-categories. Ask an admin or the head-office admin."

**`PUT /api/masters/categories/{id}`** — body gains optional `confirm_domain_change` (default `false`):
```json
{"name": "Computers", "asset_domain": "NON_IT", "confirm_domain_change": true}
```
* Own work area only (the category's current one).
* Changing `asset_domain`: needs both areas (both-area ADMIN or head-office admin) → else 403 "Only someone who handles both IT and Non-IT, or the head-office admin, can move a category to the other team. Ask the head-office admin."; without the confirmation → 422 "Moving Computers from the IT team to the Admin / Non-IT team also moves its 3 sub-categories and 5 Items, and the Admin / Non-IT team will handle the assets added under it from now on (assets already in the register keep their work area). Confirm the change to go ahead." **This also applies to the head-office admin** (the confirmation is part of the rule).
* Audit rows: `name`, `work_area` ("IT" / "Non-IT").

**`DELETE /api/masters/categories/{id}`** — own work area; audit row `active` yes → no.

**`POST / PUT / DELETE /api/masters/subcategories`** — same people as categories, judged by the parent category's work area (create: the chosen `category_id`'s area — no sub-category under the other team's category). Audit rows `name`, `active`.

**`POST /api/items`** (ADMIN, OPERATOR, head-office admin):
```json
{"name": "Cassette AC", "category_id": 4, "subcategory_id": 19, "serial_required": true}
→ 201 {..., "work_area": "NON_IT", "category_name": "Air Conditioning", "subcategory_name": "Cassette"}
```
Both the Category's and the Sub-category's own Category's work area must be the caller's (an Item can't be slipped under a sub-category of the other team: 403, not just the 422 mismatch). VIEWER / SELF_SERVICE → 403 "Your access does not allow adding Items. …".

**`PUT /api/items/{id}`** — ADMIN of the Item's current work area and of the target Category's (head-office admin always); body gains optional `confirm_domain_change`; moving to a Category of the other work area → both areas + confirmation (422 "Moving Laptop from the IT team to the Admin / Non-IT team changes who handles it: … Confirm the change to go ahead."). OPERATOR → 403 "Only an admin can change or remove Items. Ask an admin or the head-office admin." Audit: one row per changed field (`name`, `category`, `subcategory`, `work_area`, `serial_required`, `serial_later`, `bundle`, `default_brand`, `default_warranty_years`) with names, not ids. 404 text now "This Item was not found."; duplicate name "An Item with this name already exists."

**`DELETE /api/items/{id}`** — same people as PUT; audit row `active`.

**`GET /api/items`** — unchanged access (ADMIN, OPERATOR); each row gains `work_area` (`"IT"`/`"NON_IT"`), `category_name`, `subcategory_name` (two extra lookups per list, not per row). Not filtered by work area (the screen can filter on `work_area`).

**`POST /api/stock-rooms`** (new; ADMIN, OPERATOR, head-office admin):
```json
{"name": "Farukhnagar Stock", "company_id": 1, "location_name": "Farukhnagar Warehouse"}
→ 201 {"id": 88, "company_id": 1, "code": "STK-FARUKHNAGARSTOCK", "name": "Farukhnagar Stock",
       "asset_user_type": "STOCK_POINT", "location_id": 41, "login_enabled": false, "role": "SELF_SERVICE",
       "location_name": "Farukhnagar Warehouse", "company_code": "CKSPL", ... same shape as GET /api/asset-users}
```
* `location_id` (an active Location of that company) **or** `location_name` (an active Location of that company with that name, any case, is reused; otherwise one is created with a code made from the name, unique per company, e.g. `TAJNAGARWAREHOUSE`, clash → `PATNA-2`). Neither → 422 "Choose where the stock room is, or type the name of the place."; a Location of another company → 422 "The location must belong to the same company as the stock room."
* Code `STK-` + name letters/digits, at most 20 characters, unique per company ignoring case (`STK-MAIN`, `STK-MAIN-2`). `login_enabled=false`.
* Same company + same name (trimmed, any case) as an active stock room → **200** with the existing row (nothing created). A concurrent duplicate insert also falls back to the existing row.
* Company outside the caller's scope → 403 "You can only add a stock room for your own company. …"; inactive company → 422.

**`GET /api/stock-rooms?company_id=`** (new; ADMIN, OPERATOR) → active STOCK_POINT rows of the caller's companies, ordered by name, same shape (with `location_name`, `company_code`); a company outside the caller's scope → `[]`.

**`GET /api/auth/capabilities`** (new; any logged-in user):
```json
{"role": "OPERATOR", "role_label": "Can Add & Move Assets", "is_head_office_admin": false,
 "work_areas": ["IT"], "work_area_label": "IT",
 "can_create": {"vendor": true, "brand": true, "cost_centre": true, "stock_room": true, "item": true,
                "category": false, "sub_category": false},
 "item_create_work_areas": ["IT"], "domain_manage_work_areas": [],
 "can_manage": {"vendor": false, "brand": false, "cost_centre": false, "category": false, "sub_category": false,
                "item": false, "change_work_area": false, "erp_vendor_link": true, "erp_vendor_unlink": false,
                "users": false, "company": false, "location": false, "department": false, "custom_field": false,
                "bundle": false, "code_rule": false, "item_rules": false, "erp_setup": false, "imports": false},
 "company_ids": [1]}
```
`role_label`: Head-office Admin / Full Admin / Can Add & Move Assets / View Only / Own Assets Only. `work_area_label`: "IT", "Non-IT", "IT and Non-IT", or "Own assets only" (self-service). `company_ids`: the caller's scoped companies (an unrestricted ADMIN / head-office admin: every active company). `can_manage.category|sub_category|item` mean "within `domain_manage_work_areas`".

**`POST /api/erp/vendors/import`**, **`POST /api/erp/vendors/{id}/link`** — now ADMIN + OPERATOR (+ head-office admin) for a `company_id` in the caller's scope; another company → 403 "You can only add a vendor link for your own company. …"; all earlier safeguards unchanged (GSTIN twin → "Link it instead", code already linked, supplier not in that company's ERP). `DELETE …/link` and `GET /api/erp/vendors` unchanged (head-office admin).

### 3. Permission matrix (role × action, server-enforced)

ADMIN-both = ADMIN with work area unset / BOTH. "own" = only within the login's work area; "scope" = only for the login's companies (an ADMIN's scope is every company).

| Action | Head-office admin | ADMIN-both | ADMIN-IT | ADMIN-Non-IT | OPERATOR-IT | OPERATOR-Non-IT | VIEWER | SELF_SERVICE |
|---|---|---|---|---|---|---|---|---|
| Add vendor | yes | yes | yes | yes | yes | yes | no | no |
| Add brand | yes | yes | yes | yes | yes | yes | no | no |
| Add cost centre | yes | yes | yes | yes | yes (scope) | yes (scope) | no | no |
| Add stock room (+ its Location) | yes | yes | yes | yes | yes (scope) | yes (scope) | no | no |
| List stock rooms | yes | yes | yes | yes | yes (scope) | yes (scope) | no | no |
| Add / link vendor from ERP supplier | yes | yes | yes | yes | yes (scope) | yes (scope) | no | no |
| Unlink ERP supplier, list ERP suppliers | yes | no | no | no | no | no | no | no |
| Edit / deactivate vendor, brand, cost centre | yes | no | no | no | no | no | no | no |
| Add Item — IT | yes | yes | yes | no | yes | no | no | no |
| Add Item — Non-IT | yes | yes | no | yes | no | yes | no | no |
| Edit / deactivate Item — IT | yes | yes | yes | no | no | no | no | no |
| Edit / deactivate Item — Non-IT | yes | yes | no | yes | no | no | no | no |
| Add / edit / deactivate Category or Sub-category — IT | yes | yes | yes | no | no | no | no | no |
| … — Non-IT | yes | yes | no | yes | no | no | no | no |
| Move Category / Item to the other work area (with confirmation) | yes | yes | no | no | no | no | no | no |
| Companies, Locations (direct), Departments, Custom fields, Bundles, Code rules, Item rules (`/items/maps*`, seed, articles, codes), ERP sync / stores, imports | yes | no | no | no | no | no | no | no |
| `GET /api/auth/capabilities` | yes | yes | yes | yes | yes | yes | yes | yes |

The in-flow ERP review keeps using `map_scope` inside `POST /api/erp/pos/create` (unchanged, ADMIN + OPERATOR).

### 4. DB change

* Migration **`c1d3e5f7a9b0_master_audit`** ("Append-only audit of work-area-owned masters"), down-revision `b8d0f2a4c6e8`. Additive only: table `master_audit (id BIGINT PK, entity VARCHAR(30), entity_id BIGINT, field VARCHAR(100), old_value VARCHAR(1000), new_value VARCHAR(1000), actor_id BIGINT FK asset_user, changed_at TIMESTAMPTZ default now())`, index `ix_master_audit_entity (entity, entity_id, changed_at, id)`, function `forbid_master_audit_write()` and triggers `trg_master_audit_no_update` / `trg_master_audit_no_delete` (same pattern as `asset_field_change`). Downgrade drops triggers, function, index, table.
* Model `app.masters.models.MasterAudit`; writer `app.masters.audit.record` (adds rows to the request's session; committed with the change; a refused change leaves no row). Entities: `category`, `subcategory`, `item`. Written for **every** edit/deactivation of these three (head-office admin included), not only ADMIN ones.
* Verified: dev `ckam` and `ckam_test` upgraded to `c1d3e5f7a9b0`; a fresh empty scratch database went zero → head; on it an inserted row could not be updated or deleted ("master_audit rows are append-only"); `downgrade -1` removed table and function, `upgrade head` restored them; the same downgrade/upgrade on `ckam_test`; scratch database dropped. **Exactly one head** (`alembic heads` → `c1d3e5f7a9b0`; also asserted by a test).

### 5. Security changes and decisions taken

1. **One source of truth** — `app/core/capabilities.py` holds the decisions (`can_create_small_master`, `item_create_areas`, `domain_manage_areas`, `can_change_work_area`, `can_manage_heavy_setup`, `work_areas`) and the enforcement helpers (`require_small_create`, `require_head_office`, `require_domain_admin` dependencies; `ensure_item_create`, `ensure_domain_manage`, `ensure_work_area_change`, `ensure_company_for_create`). The endpoints and `GET /api/auth/capabilities` both call them; a parametrised test asks the capabilities endpoint for every login kind and then tries every action against the server.
2. **Role gate before the body** — the new gates are FastAPI dependencies (like `require_role`), so a viewer / self-service login gets 403 even with an invalid body; work-area checks run once the record is known.
3. **Work area semantics reuse S0** — `allowed_asset_domains` (NULL/BOTH ADMIN = both; head-office admin = both; OPERATOR/VIEWER default BOTH). An OPERATOR with BOTH may add Items in both areas.
4. **Nested cross-area creation** — Item create/edit checks the Category's area **and** the Sub-category's own Category's area; sub-category create checks the parent category's area. Such attempts are 403 (not the 422 mismatch) for a one-area login.
5. **Item edit** needs authority over the Item's current area **and** the target area; moving areas additionally needs both areas + `confirm_domain_change`.
6. **Confirmation also binds the head-office admin** — the brief makes the confirmation part of the rule; a head-office admin's category/Item PUT that changes the work area now needs `confirm_domain_change: true` (behaviour change; no existing test changed a work area, so none needed updating).
7. **Duplicate names** — only against **active** vendors/brands (a deactivated record can't be chosen or reactivated, so refusing would dead-end the user); only for new records via the API; Excel imports (head-office only) unchanged; ERP import keeps its own GSTIN rule and does not apply the name rule.
8. **Blank code** — leaving `code` out or `null` = make one; an explicit blank string is still refused (unchanged behaviour, so a client bug never silently auto-codes).
9. **Vendor auto-code length 30** (column 100) for readability.
10. **Stock room idempotency** is by company + name only (a repeat with a different place returns the existing room unchanged). Its Location is a side-effect create (allowed by the brief); creating Locations directly stays head-office only.
11. **ERP vendor link** by an operator may fill a vendor's empty GSTIN from the ERP (existing behaviour of linking, now reachable by ADMIN/OPERATOR); no other vendor field changes.
12. **Bundle on an Item** — an ADMIN/OPERATOR creating an Item may point it at an existing bundle (choosing an existing set); creating/changing bundles stays head-office only.
13. Category / Sub-category / Item deactivation has no "in use" check (pre-existing; unchanged).

### 6. Tests

| | count |
|---|---|
| Backend before (HEAD `6e63150`) | 813 passed |
| Backend after | **942 passed, 0 failed** |
| New tests | **129** in 7 files + shared world `tests/core/s3a1_world.py` |

New files: `tests/masters/test_s3a1_small_masters.py` (42: 8 roles × 3 masters create; 8 roles edit/remove; message wording; auto code from name, case-insensitive clash incl. deactivated rows, column length, per-company cost-centre codes; explicit code unchanged; duplicate active name refused, deactivated name reusable, legacy duplicates untouched; cost-centre company scope; inactive company), `tests/masters/test_s3a1_domain_masters.py` (24: 8 roles × IT/Non-IT create/edit/deactivate category + sub-category; plain cross-team message; domain change needs confirmation (exact sentence) and is audited; only both-area admin / owner may move; existing assets keep their snapshot; name/deactivation audit, no-change writes nothing; audit rows cannot be UPDATEd/DELETEd; refused change writes no audit; owner flows unchanged), `tests/items/test_s3a1_items.py` (24: 8 roles × IT/Non-IT add/edit/remove; nested cross-area refused; IT admin can't move an Item out; move needs both + confirm and is audited; field-by-field audit; refused edit not audited; list fields; maps/seed/articles/codes still head-office; inactive category refused), `tests/auth/test_s3a1_capabilities.py` (17: capabilities for 8 login kinds; 401 without login; 8 agreement tests asking then trying ~25 actions each), `tests/asset_users/test_s3a1_stock_rooms.py` (14: 8 roles; shape equals people list; idempotency; per-company; location reuse/creation and code clash; code clash/length; company scope and location checks; picker), `tests/erp/test_s3a1_erp_vendor_links.py` (6: operator import/link with `created_by`; other company refused; ADMIN every company but no unlink; viewer refused, owner unchanged; GSTIN-twin / already-linked safeguards), `tests/core/test_s3a1_master_audit_migration.py` (2: single head, triggers present).

Existing tests changed (intended permission change only): `tests/erp/test_erp_api.py` (operator may now import/link; list and unlink still 403; viewer 403), `tests/items/test_items.py` (operator may add an Item; viewer may not; edit/delete still 403), `tests/masters/test_company_scoped_writes.py` (operator adds a cost centre in own company, not another; ordinary ADMIN adds cost centre and category, still cannot remove or create a company), `tests/masters/test_serial_rule.py` (operator may add an Item but not change its rule), `tests/purchase_orders/test_s2_line_numbers.py` (single-head test now asserts one head that includes `b8d0f2a4c6e8`).

Red-before-green: not re-run against an image of HEAD this time (the new tests import `MasterAudit` / `app.core.capabilities`, which do not exist at HEAD); the five intentionally changed existing tests are the before/after evidence for the permission change.

### 7. Files changed

New: `backend/app/core/capabilities.py`, `backend/app/core/codes.py`, `backend/app/masters/audit.py`, `backend/app/asset_users/stock_rooms.py`, `backend/app/alembic/versions/c1d3e5f7a9b0_master_audit.py`, `backend/tests/core/s3a1_world.py`, the 7 test files above, this report.
Changed: `backend/app/main.py` (stock-rooms router), `backend/app/auth/router.py` (capabilities), `backend/app/masters/{models,schemas,router}.py` (MasterAudit, optional codes, `confirm_domain_change`, `MasterPolicy` per master), `backend/app/items/{router,schemas,service}.py`, `backend/app/erp/router.py`, the 5 existing tests listed in §6.

### 8. Observations (not changed)

* `GET /api/erp/vendors` (supplier list with suggestions) stays head-office-only, so an operator resolving an unmatched vendor in a PO review needs the supplier code/name from the ERP draft (which carries it) — if the next stage wants the suggestion list, open that GET to writers within company scope.
* There is no read endpoint for `master_audit` yet (rows are written and protected); a head-office "history" view would need `GET /api/masters/audit?entity=&entity_id=`.
* `GET /api/items` is not filtered by work area (rows carry `work_area`); a one-area operator still sees the other team's Items in pickers unless the screen filters.
* Category / Sub-category / Item deactivation still has no "in use" check; an ADMIN of one area can now deactivate a category that has many Items.
* Location creation as a stock-room side effect is not audited beyond `created_by`.
* Excel master imports still require `code` and do not apply the duplicate-name rule (head-office only).
* The masters list endpoints remain unpaginated.

### 9. Frontend changes the controller must handle

1. **Use `GET /api/auth/capabilities`** (once after login / refresh; cache with the session) to show or hide every "Add vendor / brand / cost centre / stock room / Item / category" and "Edit / Deactivate" control; use `item_create_work_areas` / `domain_manage_work_areas` to limit the Category choices in the Item / sub-category forms; use `role_label` / `work_area_label` for the plain role text. Never treat it as security (server stays authoritative).
2. **Inline create in flows** (PO create, ERP PO review, receive, Add Asset): vendor, brand, cost centre, Item, stock room can now be created by ADMIN/OPERATOR. Send no `code` (or `null`) for vendor/brand/cost centre to get a generated one — do **not** send an empty string (still 422). Show the 422 "A vendor/brand with this name already exists." and offer to pick the existing one.
3. **Stock room inline create** → `POST /api/stock-rooms {name, company_id, location_id | location_name}`; a 200 means "already existed — selected it"; use `GET /api/stock-rooms?company_id=` for received-into / delivery-location pickers.
4. **Category / Item work-area change**: when the PUT answers 422 starting "Moving …", show the sentence in a confirm dialog and resend with `"confirm_domain_change": true`. Applies to the head-office admin too.
5. **Items screen**: show `work_area`, `category_name`, `subcategory_name` from the list; Edit/Deactivate only when `can_manage.item` and the Item's `work_area` is in `domain_manage_work_areas`; OPERATOR sees Add only.
6. **Settings > Categories / Sub-categories**: ADMINs now manage their own area; hide the other area's Edit/Deactivate; restrict the "who handles it" choice on create to `domain_manage_work_areas`.
7. **Vendors / Brands / Cost centres screens**: Add for ADMIN/OPERATOR, Edit/Deactivate only for `can_manage.vendor` etc. (head-office admin).
8. **ERP PO review — unmatched vendor**: ADMIN/OPERATOR may call `POST /api/erp/vendors/import` (new vendor from the ERP supplier) or `POST /api/erp/vendors/{id}/link` for the PO's company; hide Unlink unless `can_manage.erp_vendor_unlink`.
9. All new 403/422 `detail` values are plain sentences — show them as they are.
