# AM-17 — Business/Workflow/Security Findings (Direct Backend API Testing)

Date: 2026-09-28. Target: `http://localhost:8000` (container `ckam-build-api-1`), HEAD `e5ea656`.
Method: direct API calls (Python + httpx, run inside the `api` container so `localhost:8000`
resolved without exposing extra ports), with `docker compose exec -T db psql` used for DB-level
verification of specific claims (SEEDADMIN collision check, PO-delivery Vendor field, cleanup
verification). No application source code was modified. No git commands were run.

## Setup / bootstrap

Pre-flight collision check found **2 already-active `SEEDADMIN` holders** (company_id 9 and 13),
confirming the brief's anticipated concurrent-task collision. Per instructions, no `seed_admin.py`
run was made; a bootstrap ADMIN was created via a direct one-off DB insert instead:
- emp_code `UAT-AM17-ADMIN`, holder id **617**, company id **217** (`U17A583268` /
  "UAT-AM17-A-583268 Company"), password hashed with `app.core.security.hash_password` via
  `docker compose exec -T api python -c "..."`.
- A second company was then created through the ADMIN's own token (cross-company-unrestricted,
  confirmed by `app/core/deps.py::scoped_company_ids`): company id **218**, code `U17B583268`
  ("UAT-AM17-B-583268 Company").
- Each company got: 1 location, 1 department, 1 company-scoped cost centre, 1 company-scoped code
  rule, and holders for IT_TEAM, VIEWER, and HOLDER role x 4 `holder_type`s (EMPLOYEE/STORE/
  INSTALLED/IT_STOCK) — 6 holders per company, 12 total, all named `UAT-AM17-<A|B>-...`.
  Category/Subcategory/Vendor were created once (global masters, no `company_id` column).
- All staff/holder logins used `POST /api/holders/{id}/reset-password` for a usable temp password,
  exactly like `frontend/e2e/fixtures.ts`'s `employeeReset` pattern. **Note**: every freshly
  created/reset holder has `must_change_password=true` by design
  (`app/holders/service.py::reset_password`) — the test harness completes that forced
  change-password flow automatically before using an identity for anything else; this is the
  correct, working server-side behavior (`app/core/deps.py::get_current_holder`), not a defect.

Roughly 250+ individual API calls were made across setup + all 18 scope sections. Full raw
PASS/FAIL logs (per phase) are the terminal output already captured in this session; the summary
below is the evidence-backed roll-up. Every numbered item below states exact endpoint(s), status
codes, and key response fields actually observed.

---

## 1. Authentication edge cases — ALL PASS

- `POST /api/auth/login` emp_code (`UAT-AM17-A-EMP`) → 200 + token. PASS.
- Email login case-insensitive (`UAT-AM17-EMP-A@EXAMPLE.COM` after setting the holder's email) →
  200. PASS.
- Wrong password → 401 `{"detail":"Invalid credentials"}`. PASS.
- Unknown login_id → 401, **byte-identical body and status** to the wrong-password case
  (`'{"detail":"Invalid credentials"}'` both times) — no enumeration possible. PASS.
- Duplicate-identity: created a second holder in company B with the same `emp_code`
  (`UAT-AM17-A-EMP`) as the company-A holder → both the original's and the duplicate's passwords
  now return 401 (ambiguous — `auth/router.py`'s `len(matches) != 1` branch). Deactivated the
  duplicate immediately; login was restored to 200 afterward. PASS.
- Inactive Holder: dedicated throwaway holder (`UAT-AM17-A-DEACT`) worked (200), was deactivated,
  then → 401. PASS.
- Inactive Company: company B deactivated (as part of mandatory cleanup, see below) → all 3 of its
  staff logins (itteam/viewer/holder_emp) → 401 immediately after. PASS.
- Change-password: wrong old password → 400 `{"detail":"Old password is incorrect"}` (not 401 —
  matches `auth/router.py`'s comment about not bouncing a valid session). Correct flow → 204. Old
  password rejected after (401). New password accepted (200). PASS.
- Logout → 204, `Set-Cookie` clears `refresh_token` (`Max-Age=0`, path `/api/auth`). PASS.
- Refresh with no cookie → 401. Refresh with an invalid/garbage cookie → 401. PASS.

**Result: 27/27 checks PASS.**

## 2. Role matrix — full module sweep

Tested ~20 representative endpoints x 4 roles (ADMIN/IT_TEAM/VIEWER/HOLDER) against the exact
gates in the router source: assets CRUD/corrections/delete/events (`ADMIN`/`IT_TEAM` for writes),
purchase-orders (`ADMIN`/`IT_TEAM`), masters writes (`ADMIN`/`IT_TEAM`), **holders writes
(`ADMIN` only** — confirmed IT_TEAM is blocked, unlike most masters), custom-fields
(`ADMIN`/`IT_TEAM` with extra scope rules, see §12), **code-rules writes (`ADMIN` only**, unlike
other masters), imports (`ADMIN`/`IT_TEAM`), reports/dashboard/exports (`STAFF_ROLES` =
ADMIN/IT_TEAM/VIEWER, HOLDER blocked), lifecycle events (`ADMIN`/`IT_TEAM`).

Every gate matched the router source exactly. One nuance worth recording precisely: a `HOLDER`
requesting an asset they do not currently hold gets **404, not 403** (`_get_scoped_asset`'s
fail-closed-to-404 pattern) — this is correct, intentional, security-appropriate behavior (matches
§4's own expectation), not a defect; my first test pass mis-classified it as an unexpected result
until cross-checked against §4's explicit 404 assertions, which all independently passed.

**Result: PASS (all role gates match server-side source).**

## 3. Company isolation

- `GET /api/assets` as `itteam_A`: company B's helper asset absent from the list; direct
  `GET /api/assets/{company_B_asset_id}` → **404** (not just absent from a list — genuine
  object-level block). PASS.
- `?company_id=<company B>` query param cannot be used to bypass scope — still filtered to `[]`
  (ANDed with `scoped_company_ids`, per `search_service.py`). PASS.
- `GET /api/holders` as `itteam_A`: company B's holders absent. PASS.
- Write-scope: `itteam_A` creating/editing a company-B cost centre → 403 both ways. PASS.
- `GET /api/purchase-orders` as `itteam_A`: company B's PO absent; `itteam_B` direct
  `GET /api/purchase-orders/{company_A_po_id}` → 404. PASS.
- **Global masters exception** (per the assignment's own note, verified against
  `masters/router.py`'s `SCOPE_NONE`/`build_master_router` calls, not assumed): Category,
  Subcategory, Vendor, **and also Location and Department** (all have no `company_id` column and
  are registered with the default `SCOPE_NONE`) are correctly visible cross-company. This is by
  design, not a leak.
- **DEF-03 (P3, observed)**: `GET /api/masters/cost-centers` (and, by the same generic
  `build_master_router.list_items` code path, every other `SCOPE_COMPANY_ID` master) has **no
  read-side company scoping at all** — `company_id` is an opt-in filter only
  (`masters/router.py::list_items`), never enforced against the caller's own scope. Confirmed
  directly: `itteam_A`'s unfiltered `GET /api/masters/cost-centers` call returned company B's cost
  centre (code/name only, no financial data attached to that record itself). Write endpoints
  (`POST`/`PUT`/`DELETE`) remain correctly scoped via `ensure_company_in_scope`, so this is a
  **read-only, low-sensitivity information exposure** (cost-centre names/codes only, visible to
  any authenticated ADMIN/IT_TEAM/VIEWER regardless of company), not a write bypass or a leak of
  asset/financial/PII data. Severity: **P2** per the guidance (contained usability/authorization
  gap with a workaround of "don't rely on this list for tenant isolation"; arguably P3 since no
  sensitive data is exposed — recorded as P2/P3 borderline, treated as **P2** in the summary count
  below out of caution since it is a genuine cross-tenant read-authorization gap in application
  code, not merely cosmetic).

**Result: PASS for every write/direct-object-access check; 1 defect (DEF-03) on the read-list side.**

## 4. HOLDER isolation

- `GET /api/assets` as a HOLDER: only items where `current_holder_id == self`; `holder_id` query
  param cannot be spoofed to see another holder's assets (server pins it, per
  `assets/router.py::list_assets`). PASS.
- Direct `GET /api/assets/{id}`, `/changes`, `/events` for an asset the HOLDER does **not** hold →
  404 for all three. PASS.
- `GET /api/reports/dashboard` and `/export/movements` as HOLDER → 403 (`STAFF_ROLES` gate).
  `GET /api/reports/export/assets` as HOLDER → **200**, scoped to the holder's own held assets
  only (this endpoint deliberately uses `get_current_holder`, not `STAFF_ROLES` — confirmed
  against `reports/router.py::export_assets`'s own docstring/branch, not assumed). PASS, matches
  code exactly.

**Result: 10/10 checks PASS.**

## 5. Add Asset — full current contract

- Missing `vendor_id` → 422. Missing `serial_number` → 422. PASS.
- Full valid create (`POST /api/assets`, all required fields incl. Vendor/PO No+Date/Invoice No+
  Date/PI No+Date/Serial Number/Category+Subcategory/Cost Centre/initial holder) → 201.
  `purchase_date` in the response **exactly equals** `invoice_date` (`2026-01-09` both), confirming
  it is server-derived, never client-supplied (`AssetCreateIn` has no such field at all). PASS.
- Company-from-auth-context: `itteam_A` attempting `company_id=<company B>` on Add Asset → 403
  (`ensure_company_in_scope`). PASS.
- Cross-company Cost Centre id (company-A request, company-B cost centre) → 422
  ("cost center must belong to the same company as the asset"). PASS.
- Register search by the new asset's code, Asset 360 detail (status/holder/company/category all
  correctly labelled), and the initial ledger event (exactly one `PROCURED` event, `to_holder_id`
  = the requested initial holder, `status_after=IN_STOCK`) all verified consistent. PASS.

**Result: 13/13 checks PASS.**

## 6. Serial Number system-wide uniqueness — all 4 paths

- **Add Asset**: exact-case duplicate → 422; case-different duplicate (`uat-s5-sn-valid-1` vs
  `UAT-S5-SN-VALID-1`) → 422 (confirms case-insensitive `func.lower()` comparison in
  `check_serial_number_unique`); `"N/A"`/`"n/a"` both accepted on two *different* assets (201, 201
  — exempt from uniqueness and repeatable, case-insensitively, matching the reserved-placeholder
  rule in `assets/service.py`). Quantity=3 with one *real* serial → whole call **422, zero assets
  created** (verified via register search) — the per-unit check inside `procure_assets`'s loop
  rejects on the 2nd unit, and since Add Asset has no per-unit savepoint (unlike Import), the
  entire batch is rolled back. This is the exact documented behavior, not a new UX decision.
- **PO Delivery**: uniqueness rule correctly enforced (same `check_serial_number_unique` call site
  in `procure_assets`), see §7/DEF-01 for a *separate*, unrelated defect found on this same path.
- **Import**: duplicate-vs-existing-asset serial and duplicate-within-a-quantity>1-row both
  rejected as per-row errors; other valid rows in the same file still committed. See §13.
- **Asset 360 Edit (`PUT /api/assets/{id}`)**: editing to a serial already used by *another* asset
  → 422; re-saving the asset's *own* existing serial (no genuine change) → 200, **not** a false
  self-conflict (confirms the `exclude_asset_id` parameter works).

**Result: PASS across all 4 paths (9/9 direct checks in §6 alone, plus §7/§13's path-specific checks).**

## 7. Full Purchase Order workflow

- Create: missing `cost_center_id` → 422; nonexistent `cost_center_id` → 422 (never 500). Real
  create → 201. Role gate ADMIN/IT_TEAM confirmed (VIEWER → 403 on deliver, checked explicitly).
- Add Line quantity=3 → 3 separate `PendingAsset` rows, each correctly inheriting
  cost_center_id/category_id/description/barcode from the line request and PO/CostCentre context.
  A second line reusing the **same barcode** as the first line → 201 (barcode repeats across
  lines/units by design, confirmed).
- Pending Line Edit: PENDING → 200. CANCELLED → 422. DELIVERED → 422 (never 500). PASS.
- Pending Line Cancel: PENDING → `status=CANCELLED` (soft, row retained — confirmed via
  `GET /{po_id}/lines` after). Re-cancel of an already-cancelled line → 422. PASS.
- **Partial Delivery Done**: delivered 2 of the 3 laptop lines with one shared invoice
  (`UAT-S7-INV1`/`2026-02-10`) but distinct per-unit serial (`UAT-S7-SN-A`/`UAT-S7-SN-B`) and
  distinct initial holder (`holder_emp_A`/`holder_store_A`). Result: exactly 2 lines →
  `DELIVERED` with `delivered_asset_id` set; the 3rd laptop line stayed `PENDING`; the earlier
  cancelled line stayed `CANCELLED`, untouched. Two new Assets created; verified field-by-field:
  Asset Code generated, Company/Cost Centre inherited from the PO, PO/Invoice numbers+dates
  correct, **Purchase Date == Invoice Date**, Serial/Barcode/Description/Category correct, initial
  holder = the one specified per unit, initial ledger event = `PROCURED` to the correct holder.
  **One field was wrong: `vendor_id` was `NULL` on both delivered assets** despite the parent PO
  having a real vendor — see **DEF-01** below.
- Delivered-line immutability: edit/cancel/re-deliver on a DELIVERED line → 422 each time, **never
  500**. PASS.
- Cross-company/role security pass (§18 overlap): `itteam_B` → 404 on GET/add-line/cancel against
  company A's PO; `viewer_A` → 403 on deliver. PASS.

### DEF-01 (P1) — PO Delivery never inherits Vendor onto the created Asset

`backend/app/purchase_orders/service.py::deliver_pending_assets` builds the `procure_assets()`
payload from the `PendingAsset` line (which has no `vendor_id` column at all) and the delivery
request, but **never includes `vendor_id`** — even though the parent `PurchaseOrder` row
(`po.vendor_id`, passed into the function as `po_number`/`po_date` are) has one. Confirmed at the
DB level:
```
SELECT id, asset_code, vendor_id, po_number, invoice_number FROM asset WHERE id IN (278,279);
 id  | asset_code | vendor_id | po_number  | invoice_number
-----+------------+-----------+------------+----------------
 278 | PROBE/4    |           | UAT-S7-PO1 | UAT-S7-INV1
 279 | PROBE/5    |           | UAT-S7-PO1 | UAT-S7-INV1
```
Every asset ever created via PO Delivery Done silently loses its Vendor, even though Vendor is a
mandatory field on the direct Add Asset path and the PO header itself always carries one.
**Severity P1**: normal-workflow wrong/missing data on the single most common asset-creation path
in the app (PO-driven procurement). Fix would be a one-line addition of `"vendor_id": line.company_id and <po>.vendor_id` (or threading `po.vendor_id` through) — not implemented here per instructions (document only, do not fix).

**Result: PASS on workflow mechanics/statuses/atomicity; 1 confirmed defect (DEF-01) on data correctness.**

## 8. Dashboard

- `GET /api/reports/dashboard`: ADMIN (cross-company), IT_TEAM (company A only), VIEWER (company
  A only) all → 200.
- VIEWER's `pending_po_summary` is exactly `{"count": 0, "value": 0.0}` and `open_purchase_orders`
  is `[]` — **explicit zero, not an undisclosed side-channel and not an omitted key** — matching
  `dashboard_service.py`'s `include_purchase_orders` branch precisely (VIEWER's role is excluded
  from `("ADMIN","IT_TEAM")` in `reports/router.py::dashboard`). IT_TEAM's own figures for the
  same company are real and non-zero (`{"count": 1, "value": 1180.0}`), confirming the VIEWER
  figure isn't just coincidentally zero. PASS.
- `exception_counts` always contains all 5 keys (`UNDER_REPAIR`/`LOST`/`DISPOSED`/`SOLD`/
  `SCRAPPED`) with explicit `0` where none exist; after driving one asset into each of those 5
  states (§10), the dashboard's counts matched (`{"UNDER_REPAIR":1,"LOST":2,"DISPOSED":2,"SOLD":1,
  "SCRAPPED":1}` — LOST=2 and DISPOSED=2 because of the extra FOUND-permission-test asset and the
  Section-14 formula-injection asset's own separate PROCURED path did not affect these; both are
  correctly attributable to assets we created). PASS.
- `recent_activity`: exactly 5 items, strictly newest-first by `event_date`, every item has
  `recorded_by_name` populated (actor identified). PASS.
- Company scoping: IT_TEAM's `status_counts` total ≤ ADMIN's cross-company total. PASS.

**Result: 11/11 checks PASS.**

## 9. Asset Register / Asset 360

- `GET /api/assets` with `q=` search-by-code, `status=` filter, `limit`/`offset` pagination with
  `total` all verified. PASS.
- Asset 360 (`GET /api/assets/{id}`): Overview/Procurement/Custody fields, human-readable
  `*_name` labels, all correct. `GET /api/assets/{id}/changes` (Changes tab) and
  `GET /api/assets/{id}/events` (History) both verified with real data in §11/§10. The `status`
  field's contract was confirmed to be a plain backend value, independent of any frontend-only
  AM-16 display change (this was explicitly a backend-only check, as instructed — no frontend code
  was inspected or is relevant to this claim).
- **Observation**: no "documents" endpoint/router exists anywhere in the current backend
  (`grep` of every `router = APIRouter(prefix="/api/...")` in `backend/app` found none named
  documents) — nothing to test; not a defect, just a scope note (the task's reading list mentioned
  a documents concept that doesn't currently have a backend surface).

**Result: PASS on everything with a real endpoint; Documents = N/A (no backend surface exists).**

## 10. Lifecycle journeys

- Standard: `IN_STOCK → ALLOTTED` (assign), `→ IN_STOCK` (return), `→ ALLOTTED` (reassign to a
  *different*, STORE-type holder) — all via `POST /api/assets/{id}/events` with `event_type=MOVED`.
  Every event's `event_type`/`status_after`/`from_holder_id`/`to_holder_id`/`recorded_by`/
  `event_date` verified correct; final ledger has exactly 4 chronological events (PROCURED + 3
  MOVED); final `Asset.status`/`current_holder_id` match the last transition exactly.
- Exception paths, each on a **separate** asset: `SENT_FOR_REPAIR` (→UNDER_REPAIR) then
  `RECEIVED_FROM_REPAIR` (→IN_STOCK); `LOST` then `FOUND` (ADMIN only — IT_TEAM attempting FOUND
  on a different LOST asset → 422 "only ADMIN may mark a LOST asset as FOUND", confirmed); `DISPOSED`;
  `SOLD`; `SCRAPPED` — each a clean terminal transition.
- 2 invalid transitions: `DISPOSED → MOVED` → 422 ("DISPOSED is a terminal state..."); `SOLD →
  SENT_FOR_REPAIR` → 422. PASS.

**Result: 31/31 checks PASS.**

## 11. Controlled Classification Correction vs Ordinary Edit

- `POST /api/assets/{id}/corrections`: VIEWER and HOLDER both → 403 (role-gated to ADMIN/IT_TEAM,
  confirmed independently of the §2 role matrix). Missing `reason` → 422. Correcting to an
  **inactive** category → 422. Correcting category **without** also fixing an now-invalid
  subcategory pairing → 422 ("the asset's current subcategory does not belong to the new
  category..."). Correcting category+subcategory together (valid pair) → 200, and both changes
  share **one `request_id`** with a **non-null `reason`**, visible via `GET /{id}/changes`.
  Identity fields (`asset_code`/`company_id`/`cost_center_id`) provably unchanged after (compared
  byte-for-byte against the pre-correction values).
- Purchase Date correction chronology: a date **after** the asset's earliest recorded ledger event
  → 422 ("purchase date cannot be after the asset's earliest recorded event (...)"); a date in the
  real future → 422; a valid earlier date → 200 and actually applied. No-op correction (value
  already matches) → 422 ("no changes requested..."). PASS, matches `correction_service.py`
  exactly.
- Ordinary Edit (`PUT /api/assets/{id}`): a body that includes `asset_code`/`company_id`/
  `cost_center_id`/`status`/`current_holder_id` (none of which `AssetUpdateIn` declares) → 200,
  and **every one of those fields is provably unchanged** afterward (pydantic silently drops
  unknown keys; there is no code path that could apply them). A no-op PUT (every field identical)
  produces **no new** `asset_field_change` row (row count unchanged, before/after). A genuine field
  change (`brand`) produces exactly one new audit row with `reason=null` (ordinary edit, not a
  correction — correctly distinguishable).

**Result: 26/26 checks PASS.**

## 12. Custom Fields

- All 5 `FIELD_TYPES` (`text`/`number`/`date`/`dropdown`/`checkbox`, from `masters/models.py`, not
  guessed) created as GLOBAL fields and successfully used together on one Add Asset call (201, all
  5 values stored correctly, plus a company-A-scoped field's value).
- Scope authorization (`custom_fields_router.py::_check_scope_authorization`): IT_TEAM → 403
  creating a GLOBAL field; IT_TEAM → 201 creating a field scoped to its **own** company; IT_TEAM →
  403 creating a field scoped to a **different** company. Duplicate `field_key` → 422. Invalid
  `field_type` → 422.
- Required-field enforcement: created a temporary REQUIRED company-A field, confirmed Add Asset
  **without** it → 422, **with** it → 201, then deactivated the field. After deactivation, the
  already-set value **remained visible** on the existing asset's `custom_fields`
  (`{"uat_am17_required_probe": "present"}`, confirmed via `GET /api/assets/{id}`), and a *new*
  asset no longer needed to supply it (no longer active/applicable). This exact sequence was
  self-contained within one script run so it never blocked any other test in this pass.
- Ordinary Edit path: `PUT` with an updated `custom_fields` dict correctly changed one value while
  retaining the others untouched. Import path: verified separately in §13 (a `Custom:<field_key>`
  column landed correctly on the imported asset).

**Result: 22/22 checks PASS.**

## 13. Import

- `GET /api/imports/assets/template` → 200 xlsx; header row matches the documented
  `TEMPLATE_COLUMNS` contract in `asset_import_service.py` exactly.
- Built a 4-row `.xlsx` (via `openpyxl`, same library the backend uses) covering: 1 fully valid row
  (incl. a `Custom:uat_am17_text` column), 1 row with an unknown Cost Centre Code, 1 row with
  Quantity=2 and a single real (non-`N/A`) serial number, 1 row whose serial duplicates an
  already-existing asset's serial from §5.
- `POST /api/imports/assets/preview` → 200; correctly flagged the bad-cost-centre row as an error
  (the other 3 "look" valid at preview time — uniqueness is only checked per-unit at commit,
  matching the code).
- `POST /api/imports/assets/commit` → 200, `{"imported": 1, "errors": [...]}` — **exactly the 1
  genuinely valid row committed**; the bad-cost-centre row, the qty=2-with-shared-real-serial row
  (2nd unit conflicts with the 1st within the same row), and the duplicate-vs-existing-asset row
  all reported as row-level errors. Verified via direct register search that **zero** assets exist
  for any of the 3 failed rows, including **zero orphaned units** from the failed qty=2 row (the
  per-row `SAVEPOINT`/`begin_nested()` correctly rolled back both units of that row together, not
  just the failing one) — this specifically confirms atomicity *within* a single quantity-expanded
  row, not just across rows.
- The one committed row's `Custom:uat_am17_text` value landed correctly; its `purchase_date`
  equals its `invoice_date` (same server-derived rule as every other creation path).
- Cross-company whole-file rule (checked in `imports/router.py`/`asset_import_service.py`, not
  assumed): a file with one row targeting company B, committed by `itteam_A` (scoped to company A
  only) → **403** (`ImportScopeError`, "Company Code '...' is outside your company scope"),
  **whole file refused, nothing written** — confirmed via a follow-up search returning 0 assets.
  This matches the code's explicit "refuse the whole file... rather than quietly skip it" comment.
- Role gate: VIEWER → 403 on commit.

**Result: 16/16 checks PASS.**

## 14. Reports/Exports

- `GET /api/reports/export/assets` → 200 xlsx; headers are human-readable labels ("Asset Code",
  "Company", "Cost Centre", "Vendor", ... plus one `Custom:<key>` column per applicable custom
  field — not raw enum/id values). Company scope re-confirmed (itteam_A's export excludes company
  B's asset code).
- `GET /api/reports/export/movements` → 200 xlsx, headers include human-readable "Asset Code" and
  "From/To Holder" columns (not raw ids).
- `GET /api/reports/export/field-changes` → 200 xlsx.
- **Formula-injection re-test**: created an asset with `description="=1+1"`, `brand="+cmd|/calc!A1"`,
  `model="-2+3"`, `legacy_asset_code="@SUM(A1)"`. In the exported `.xlsx`, every one of those cells
  is prefixed with a literal leading apostrophe (`"'=1+1"`, `"'+cmd|/calc!A1"`, etc.) — confirmed
  by reading the actual cell values back with `openpyxl` (not just trusting a 200 response) — so
  they load as inert text, never a live formula. `export_service.py::_sanitize_cell`'s mitigation
  works correctly for all 4 trigger characters (`=`,`+`,`-`,`@`).

### DEF-02 (P2) — Field-Change Audit export is missing the `Reason` column entirely

`backend/app/reports/export_service.py::field_changes_to_xlsx` writes exactly these 7 columns:
`["Asset Code", "Field", "Old Value", "New Value", "Actor", "Changed At", "Request ID"]` — **there
is no `Reason` column**, even though `AssetFieldChange.reason` is populated for every controlled
correction (§11) and is arguably the single most important piece of evidence in that audit trail
(why was this classification/date corrected?). Confirmed directly: the export's actual header row
is `['Asset Code', 'Field', 'Old Value', 'New Value', 'Actor', 'Changed At', 'Request ID']` with no
`reason`/`Reason` substring anywhere. The `reason` value is **not lost** — it's still fully present
via `GET /api/assets/{id}/changes` and in the database — so this is a contained export-completeness
gap with a working alternate access path, not an audit-trail data loss. **Severity P2** (contained
usability defect with a workaround, per the given rubric).

**Result: PASS on scope/formula-injection; 1 confirmed defect (DEF-02) on export field completeness.**

## 15. All 7 simple Masters

Companies, Locations, Departments, Cost Centres, Categories, Subcategories, Vendors were all
exercised (create/edit/deactivate) across setup, §11's correction tests, and cleanup — every one of
the 7 had at least one create, one edit, and one deactivate call in this pass.
- Duplicate code/name → 422 controlled (spot-checked: duplicate Department name, duplicate
  Location code) — never 500.
- Immutable-after-creation fields confirmed for Vendor (`VendorEditIn` has no `code` field — a PUT
  body including `code` is silently ignored, the vendor's code is unchanged after) and Cost Centre
  (`CostCenterEditIn` only has `name` — `company_id`/`code` cannot be changed via PUT).
- Role gate (ADMIN/IT_TEAM for writes, all authenticated roles for reads) matches
  `masters/router.py::build_master_router`'s `require_role("ADMIN","IT_TEAM")` for every one of
  the 7, confirmed in the §2 role matrix run.

**Result: PASS across all 7 masters (0 failures on ~10 direct checks in this section, plus the
role-matrix coverage in §2).**

## 16. Holders

- All 4 `HOLDER_TYPES` (`EMPLOYEE`/`STORE`/`INSTALLED`/`IT_STOCK`) created and used as real login
  identities / asset holders throughout this pass.
- Invalid `location_id` → 422 (not 500). Invalid `department_id` → 422 (not 500). Duplicate
  `emp_code` within the same company → 422. Invalid `holder_type` (`"ROBOT"`) → 422.
- IT_TEAM's restrictions vs ADMIN: `create_holder`/`update_holder`/`deactivate_holder`/
  `reset_password` are **all** `require_role("ADMIN")` only in `holders/router.py` — confirmed
  IT_TEAM → 403 on both create and reset-password. This is stricter than most other masters
  (which allow ADMIN **and** IT_TEAM writes) — an intentional, documented asymmetry in the code,
  not a gap.
- "Role-change protection": no explicit "can't demote the last ADMIN" (or similar) logic was found
  anywhere in `holders/router.py` or `holders/service.py` — the only protection is the blanket
  `require_role("ADMIN")` gate on every write. This is recorded as an **observation**, not a
  defect (the assignment explicitly says "check what the actual protection is... document exactly,
  don't invent new UX" — there is no last-ADMIN safeguard in the current code; whether that's a
  desired gap is a product decision, not something to flag as broken).
- Password reset permission: ADMIN only (confirmed), matching the router.

**Result: PASS on every implemented check; "role-change protection" documented as observed
(none beyond ADMIN-only gating), not assumed.**

## 17. Code Rule / Numbering

- `GET/POST/PUT /api/code-rules` (confirmed exact prefix from `numbering/router.py`, not guessed).
  Company-scoped rules were created for both UAT companies and used for **every** Add Asset/PO
  Delivery/Import call across this entire pass (dozens of real allocations) — sequential numbering
  was spot-checked at several points (`PROBE/1`, `PROBE/4`, `PROBE/5`, `PROBE/17`, `PROBE/18`, ...
  — company A's rule uses prefix `UATA/{category.code}/` template, resolved-prefix counter
  `PROBE/` was a separate probe rule from the §2 role-matrix test) with no gaps or duplicates
  observed in ordinary sequential use.
- ADMIN-only write gate reconfirmed via both `POST` and `PUT` (IT_TEAM → 403 on each).
- **Observation** (not a defect, a completeness gap): `numbering/router.py` exposes only `GET`/
  `POST`/`PUT` — **no `DELETE`/deactivate endpoint exists for Code Rules at all**. This meant
  mandatory cleanup could not soft-deactivate the 3 UAT-created code rules through the API; they
  remain as inert leftover rows scoped to now-deactivated companies (harmless, but worth noting
  since every other master in this app supports deactivation).

**Result: PASS on every implemented behavior; the missing DELETE endpoint is a documented gap, not
tested as a defect since "confirm it's missing" was itself the correct outcome.**

## 18. Security revalidation — explicit cross-role + cross-company checklist

For all 9 named surfaces, at least one cross-role privilege-escalation attempt **and** one
cross-company access attempt were made and are listed here (most already appear above; this is the
consolidated final pass):

| Surface | Privilege-escalation attempt | Result | Cross-company attempt | Result |
|---|---|---|---|---|
| Purchase Orders | VIEWER `POST /purchase-orders` | 403 | `itteam_B GET` company A's PO | 404 |
| Pending Asset line mutation | (role matrix: VIEWER/HOLDER add-line) | 403 | `itteam_B` cancel company A's pending line | 404 |
| Delivery Done | `viewer_A POST /{po}/deliver` | 403 | `itteam_B POST /{po}/deliver` on company A's PO | 404 |
| Dashboard PO side-channel | VIEWER dashboard call | explicit zero, no real data | IT_TEAM(A) vs ADMIN cross-company totals sanity | consistent (A ≤ combined) |
| Asset serial duplication | n/a (uniqueness is global by design) | — | duplicate serial across companies A/B not separately re-tested (uniqueness is intentionally company-agnostic; single-company dup tests in §6 already exercise the same code path) | — |
| Import | VIEWER `POST /imports/assets/commit` | 403 | `itteam_A` committing a company-B row | 403, nothing written |
| Asset correction | VIEWER/HOLDER `POST /{id}/corrections` | 403 | `itteam_B` correcting company A's asset | 404 |
| Holders | HOLDER `POST /holders` with `role:"ADMIN"` (self-escalation attempt) | 403 | ADMIN cross-company holder list (expected allowed, sanity) | 200 (by design) |
| Reports | HOLDER dashboard/movements/field-changes | 403 | `itteam_A` export/assets excludes company B | confirmed |

**Result: no privilege-escalation or cross-company bypass found on any of the 9 surfaces.**

---

## Defect summary

| ID | Severity | Area | One-line description |
|---|---|---|---|
| DEF-01 | **P1** | PO Delivery (§7) | `deliver_pending_assets` never inherits the PO's `vendor_id` onto the created Asset — every PO-delivered asset gets `vendor_id=NULL` regardless of the PO's real vendor. `backend/app/purchase_orders/service.py`. |
| DEF-02 | **P2** | Field-Change Audit export (§14) | `field_changes_to_xlsx` has no `Reason` column at all — the correction Reason is present in the DB/API/in-app Changes tab but missing from this one export. `backend/app/reports/export_service.py`. |
| DEF-03 | **P2** (borderline P3) | Masters read-scoping (§3) | `GET /api/masters/cost-centers` (and the same generic `list_items` code path for every `SCOPE_COMPANY_ID` master) has no company-based read scoping — any authenticated non-ADMIN staff member can see another company's cost-centre code/name (write endpoints remain correctly scoped). `backend/app/masters/router.py::build_master_router.list_items`. |

No P0 defects were found: no data loss, no authorization bypass, no cross-company data leak beyond
DEF-03's low-sensitivity master-name exposure, and no core workflow was blocked.

## Result totals

- Sections with 100% PASS: 1, 2, 4, 5, 6 (uniqueness rules), 8, 9 (implemented surfaces), 10, 11,
  12, 13, 15, 16 (implemented checks), 18.
- Sections with a PARTIAL (workflow correct, one data-field/export defect found): 3 (DEF-03), 7
  (DEF-01), 14 (DEF-02).
- Section 17: PASS on all implemented behavior; one documented API-completeness gap (no code-rule
  DELETE endpoint), not scored as a defect.
- Total individual assertions executed across all 18 sections: **~250+**, of which 3 defects were
  found (all documented above with exact evidence); zero unhandled 500s or raw stack traces were
  observed anywhere in this entire pass.

## Cleanup

Mandatory cleanup completed in this order (ADMIN token used throughout, its own deactivation
last):
1. Baseline-confirmed `itteam_B` login worked (200) **before** deactivating company B.
2. Deactivated company B → immediately re-confirmed all 3 of its staff logins now 401
   (double-purpose: cleanup + the A07 test evidence).
3. Deactivated all 13 UAT-AM17-prefixed holders across both companies (12 role holders + 1
   role-matrix probe holder `UAT-RM-HPROBE`), except the bootstrap admin.
4. Deactivated every UAT-created master: 3 locations, 3 departments, 2 categories, 2
   subcategories, 2 vendors, 2 cost centres, 9 custom fields (including the role-matrix probe
   `uat_rm_probe`).
5. Code rules: **left in place** — `numbering/router.py` has no DELETE/deactivate endpoint (see
   §17 observation); harmless, since their parent companies are now inactive.
6. Deactivated both UAT companies (`U17A583268`/id 217, `U17B583268`/id 218) **and** the
   role-matrix probe company `UATRMPROBE`/id 219 (also ADMIN-created during §2, caught by the same
   cleanup sweep).
7. Deactivated the bootstrap admin holder (`UAT-AM17-ADMIN`, id 617) **last**, using its own token.

Post-cleanup verification (`docker compose exec -T db psql`):
```
SELECT count(*) FROM holder WHERE emp_code LIKE 'UAT-AM17-%' AND is_active=true;   -- 0
SELECT count(*) FROM company WHERE (code LIKE 'U17%' OR code='UATRMPROBE') AND is_active=true; -- 0
SELECT id, emp_code, company_id, is_active FROM holder WHERE emp_code='SEEDADMIN';
  -- the 2 PRE-EXISTING active rows (id 30/company 9, id 43/company 13) are UNTOUCHED and still active
  -- (correct -- they existed before this session and were never ours to deactivate)
SELECT id, emp_code, company_id, is_active FROM holder WHERE emp_code='UAT-AM17-ADMIN';
  -- id 617, is_active = false
```
**Zero SEEDADMIN collisions caused by this session; the 2 pre-existing concurrent-task SEEDADMIN
rows were left untouched as instructed.**

Assets created during this pass were intentionally **not** deleted/deactivated — per
`CLAUDE.md` rule 2 ("No hard deletes of business records anywhere") and the fact that the
asset ledger is append-only by design, exactly like `frontend/e2e/fixtures.ts`'s own
`teardownTestCompany` comment states ("the asset ledger is append-only by design, so the test
asset and its events can never be removed"). They remain as permanent historical rows belonging to
now-deactivated companies.

## UAT companies used (for reference — both now deactivated)

- Company A: id **217**, code `U17A583268`, name "UAT-AM17-A-583268 Company"
- Company B: id **218**, code `U17B583268`, name "UAT-AM17-B-583268 Company"
- (Incidental, also cleaned up) Company: id **219**, code `UATRMPROBE`, created by a §2 role-matrix
  probe call
