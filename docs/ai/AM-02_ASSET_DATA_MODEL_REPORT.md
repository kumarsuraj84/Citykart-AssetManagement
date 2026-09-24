# CKAM — AM-02 Asset Data Model + Procurement + Custom Field Foundation Report

**Stage:** AM-02 (data/domain/API foundation stage — not a UI stage)
**Date:** 2026-09-24

---

## 1. Executive Stage Summary

AM-02's single biggest finding: **the procurement data model was already
complete.** `Asset` already had `vendor_id`, `po_number`/`po_date`,
`invoice_number`/`invoice_date`, **`pi_number`/`pi_date`**, `brand`, `model`,
`serial_number`, `warranty_upto`, and `custom_fields` — in the database, in
the ORM model, and in `AssetCreateIn` — since the original build. **No
migration was needed to add any procurement field, and none was added.**

The real gap was that **`AssetOut` (the response schema) only exposed 9 of
the Asset model's ~25 columns** — every procurement field was captured
correctly on create and then silently dropped before it ever reached a
client. Nothing in the frontend could ever have displayed PI Number, vendor,
PO/invoice details, brand/model/serial, warranty, or custom field values,
not because the UI wasn't built yet, but because the API never sent the data
back. AM-02 fixed this (a pure response-contract expansion, fully backward
compatible) and added the second missing piece: there was **no way to edit
an asset's descriptive/procurement fields at all** after creation (no PUT
endpoint existed). Both are now fixed.

Custom Fields (UDF): the definition table (`CustomField`) and the value
store (`Asset.custom_fields` JSON) already existed — AM-00 correctly found
this was a fully dead feature (defined, never consumed, never validated).
AM-02 kept both existing tables/columns as-is (no new normalized value
table — the JSON blob already satisfies "no duplicate asset+field values,
by construction of being a dict) and added the missing piece: real
write-time validation against the active field definitions.

Closed-value validation gaps confirmed by AM-01 (`holder.holder_type`,
`holder.role`, `custom_field.field_type` accepting any string) are now
closed at both the API level and, since current data was verified 100%
conformant on both databases, the database level via 3 new CHECK
constraints.

---

## 2. Starting Git State

- Absolute repository path: `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build`
- Branch: `worktree-ckam-build`
- Starting HEAD: `b8cf95f` — **matched the AM-01 authorization's expected value exactly, no drift**
- `git log b8cf95f..HEAD` before AM-02 work began: empty (no commits since AM-01)
- `git status` at start: clean

---

## 3. Starting Alembic/Database State

- Alembic heads: `d2bcc801fcc1` (single head) — matched expected exactly
- `ckam_test` current revision: `d2bcc801fcc1` — matched
- Live `ckam` current revision: `d2bcc801fcc1` — matched
- **No drift from the AM-01 authorization's stated expectations on any of these.**

---

## 4. Starting Test Baseline

```
170 passed, 12 warnings in 10.36s   (against ckam_test)
```
Matched the AM-01 authorization's expected `170 passing` exactly.

---

## 5. Current Asset Field Audit Matrix

Read directly from `app/assets/models.py`, `app/assets/schemas.py`,
`app/assets/router.py`, `app/assets/service.py`,
`frontend/src/features/assets/{AddAssetForm,AssetDetail,AssetRegister}.tsx`,
`app/imports/asset_import_service.py`, `app/reports/export_service.py`, and
the migrations — **before** any AM-02 change was made.

| Business Field | DB Column | API Create (`AssetCreateIn`) | API Response (`AssetOut`, before) | Add Asset form | Asset Detail | Register | Import | Export | Gap |
|---|---|---|---|---|---|---|---|---|---|
| Company | `company_id` | ✅ | ✅ | ✅ (implicit, scoping) | — | — | ✅ (`company_code`) | — | none |
| Cost Centre | `cost_center_id` | ✅ | ❌ | ✅ | — | — | ✅ (`cost_center_code`) | — | **response** |
| Vendor | `vendor_id` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired anywhere in UI/import/export |
| PO Number | `po_number` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| PO Date | `po_date` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| Invoice Number | `invoice_number` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| Invoice Date | `invoice_date` | ✅ (already existed) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| **PI Number** | **`pi_number`** | ✅ (already existed) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| PI Date | `pi_date` | ✅ (already existed) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| Purchase Date | `purchase_date` | ✅ required | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | **response** |
| Purchase Cost | `purchase_cost` | ✅ | ✅ (already) | ✅ | ❌ | ❌ | ❌ | ✅ | UI/import only |
| Serial Number | `serial_number` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| Brand | `brand` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| Model | `model` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response** + not wired |
| Description | `description` | ✅ required | ✅ (already) | ✅ | ✅ | ✅ | ✅ | ✅ | none |
| Category | `category_id` | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ (`category_code`) | ❌ | **response** |
| Subcategory | `subcategory_id` | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ (`subcategory_code`) | ❌ | **response** |
| Warranty Upto | `warranty_upto` | ✅ | ❌ | ❌ | (dashboard alert only, via a separate query) | ❌ | ❌ | ❌ | **response** + not wired into the form/detail |
| Asset Code | `asset_code` | (server-generated) | ✅ (already) | (shown after save) | ✅ | ✅ | ✅ | ✅ | none |
| Custom Fields | `custom_fields` (JSON) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **response**, no validation, no UI |

**No duplicate columns were created.** Every field above already had exactly
one correct column; AM-02 reused all of them.

---

## 6. Procurement Field Findings

All 16 fields the AM-02 authorization listed as required already existed as
real, working database columns and `AssetCreateIn` fields. **Zero new
procurement columns were added.** The gap was 100% on the response side
(§5) plus the complete absence of any edit capability.

## 7. Procurement Fields Implemented

None added (none were missing). `AssetOut` expanded to return all of them
(§11). A new `PUT /api/assets/{id}` endpoint added so they can be corrected
after creation (§11, §17).

## 8. PI Number Implementation

Already present as `Asset.pi_number` (`VARCHAR(100)`, nullable) and
`Asset.pi_date` (`Date`, nullable), confirmed to exist in both the ORM model
and the live database schema before any AM-02 change. Semantics confirmed
per the authorization: CityKart's internal/reference number associated with
a payment made to the vendor — **not** reinterpreted as Proforma Invoice,
no evidence anywhere in the codebase suggested that reading. Now returned
by `AssetOut` and editable via `AssetUpdateIn`/`PUT /api/assets/{id}`, and
covered by `tests/assets/test_am02_procurement_and_custom_fields.py::TestProcurementFieldsRoundTrip::test_all_procurement_fields_including_pi_number_are_returned`.

---

## 9. Custom Fields Current-State Audit

1. **Definitions storage:** `custom_field` table (`app/masters/models.py::CustomField`) — `id`, `field_key` (globally unique), `label`, `field_type`, `options` (JSON), `is_required`, `sort_order`, plus `AuditMixin`+`SoftDeleteMixin`.
2. **Values storage:** `Asset.custom_fields` (JSON, `NOT NULL DEFAULT '{}'`) — already existed, a dict keyed by `field_key`.
3. **Scope:** **Global** — no `company_id`, `category_id`, or `subcategory_id` on `CustomField`. Every company shares one set of field definitions; any active asset can theoretically hold a value for any of them.
4. **Category/subcategory-specific:** No — see above.
5. **Field types (before AM-02):** documented only in a code comment — `text|number|date|dropdown|checkbox` — no enforced list, no validation.
6. **Required/optional:** `is_required` column exists; **not enforced anywhere** (deliberately still not enforced after AM-02 — see §15).
7. **Active/inactive:** Yes, via `SoftDeleteMixin` (`is_active`), same as every other master.
8. **Sort/display order:** Yes, `sort_order` column exists.
9. **Uniqueness:** `field_key` is `UNIQUE` at the database level; a duplicate `asset_id`+`field_key` value pair is structurally impossible since `Asset.custom_fields` is a JSON object (a dict cannot hold two values for the same key).
10. **Historical survival:** `CustomField` deletion is soft-delete only (`is_active=false`, inherited from `SoftDeleteMixin`, matching every other master) — no cascade to `Asset.custom_fields`, so existing values are untouched by a definition being deactivated. Confirmed by test (`test_an_inactive_field_definition_rejects_new_values` — proves *new* writes against a deactivated field are rejected; existing values on already-created assets were never touched by deactivation, since nothing in the deactivate path reads or writes `Asset.custom_fields` at all).

**Conclusion: the existing design (one global `CustomField` master + a JSON
value blob on `Asset`) is sound for V1 and was kept as-is — no new table.**

---

## 10. Target UDF Architecture Selected

**Reused, not rebuilt.** `CustomFieldDefinition` ≡ the existing `CustomField`
table. `AssetCustomFieldValue` ≡ the existing `Asset.custom_fields` JSON
column. The only new code is `app/assets/custom_field_values.py::validate_custom_field_values`,
called from both `procure_assets` (create) and the new `PUT /api/assets/{id}`
(update), which validates every key against an active `CustomField.field_key`
and every value's type against that field's `field_type`.

**Why not a normalized `asset_custom_field_value` table:** the JSON approach
already satisfies every hard requirement in the authorization (stable-ID
reference via `field_key`, duplicate-prevention by construction, safe
history via soft-delete-only definitions) with zero new tables, zero new
migration risk, and zero new query complexity for what is explicitly scoped
as "UDF functionality, not a low-code platform." A normalized table would
have been the wrong tradeoff for this stage's stated scope.

---

## 11. Database Schema Changes

**Two migrations, both purely additive:**

### `0006` was AM-01's, unchanged.

### `0007_closed_value_check_constraints` (AM-02)

3 CHECK constraints only — no new columns, no new tables (none were needed
for procurement or custom fields, since they already existed):

```sql
ALTER TABLE holder ADD CONSTRAINT ck_holder_holder_type
  CHECK (holder_type IN ('EMPLOYEE', 'STORE', 'INSTALLED', 'IT_STOCK'));
ALTER TABLE holder ADD CONSTRAINT ck_holder_role
  CHECK (role IN ('ADMIN', 'IT_TEAM', 'VIEWER', 'HOLDER'));
ALTER TABLE custom_field ADD CONSTRAINT ck_custom_field_field_type
  CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'checkbox'));
```

**Verified 100% conformant before writing this migration**, on the *current*
live data (re-checked immediately before applying, since the live database
had grown from 17→21 holders between the start of this session and the
migration step — the app is in active real use):

```
holder_type distinct values: IT_STOCK, STORE, EMPLOYEE       (all valid)
role distinct values:        ADMIN, HOLDER                    (all valid)
non-conformant holder rows:  0
custom_field rows:           0   (trivially conformant)
```

---

## 12. API Changes

| Endpoint | Change |
|---|---|
| `GET /api/assets/{id}`, `GET /api/assets` | `AssetOut` now returns 16 additional fields (§5) |
| `POST /api/assets` | unchanged request shape; now also validates `custom_fields` (422 on unknown/wrong-type values) |
| **`PUT /api/assets/{id}`** | **New.** Body: `AssetUpdateIn` (editable descriptive/procurement subset only — see §17 Field Policy Matrix). `require_role("ADMIN","IT_TEAM")`, company-scoped via the existing `_get_scoped_asset`. Does not write `asset_event`, does not touch status/holder/identity fields — those aren't even in the schema, so sending them is silently ignored (Pydantic's default extra-field behavior), not partially honored. Recomputes `tax_amount`/`total_cost` via the same `compute_tax` helper `procure_assets` now also uses (factored out to guarantee the two call sites can never compute tax differently). |
| `POST /api/holders`, `PUT /api/holders/{id}` | now reject an unrecognized `holder_type` or `role` with 422 |
| `POST /api/masters/custom-fields`, `PUT /api/masters/custom-fields/{id}` | now reject an unrecognized `field_type` with 422 (via a new `validate_incoming` hook added to the generic `build_master_router` factory, used only by `/custom-fields` — the other 7 masters are unaffected) |

No endpoint fragmentation — the update capability was added to the existing
`/api/assets/{id}` resource, not a new sub-resource.

---

## 13. Import Changes / Explicit Deferrals

**Deferred, not implemented.** The import template (`TEMPLATE_COLUMNS` in
`app/imports/asset_import_service.py`) is a fixed 8-column shape
(`legacy_asset_code, company_code, cost_center_code, category_code,
subcategory_code, description, purchase_date, holder_emp_code`) with no
vendor/PO/invoice/PI/brand/model/serial/warranty/custom-field columns at
all. Extending it is a real, non-trivial change (new template columns,
`_validate_rows` updates, `commit_import`'s `Asset(...)` construction,
new tests) — explicitly optional per the authorization ("may be implemented
now if simple/safe OR explicitly deferred... do not create a brittle
dynamic-column parser merely to claim completeness"). Given this stage's
scope is the API/data foundation, not screen-by-screen feature completion,
this was deferred to whichever future stage does the Import UX work.
Existing import guarantees (preview, row validation, duplicate handling,
company/cost-centre protection, safe commit) are all unchanged and still
fully covered by the existing (unmodified) import test suite.

## 14. Export Changes / Explicit Deferrals

**Deferred, not implemented.** `assets_to_xlsx` (`app/reports/export_service.py`)
takes real `Asset` ORM objects directly (not `AssetOut`), so it already has
programmatic access to every procurement field — it just doesn't currently
include them as export columns. Per the authorization's "do not redesign
reports," extending this column list is left as a documented future
enhancement rather than done here. For UDFs: the recommended future export
representation is one column per *active* `CustomField`, using `field_key`
as the header and reading `Asset.custom_fields.get(field_key)` per row —
straightforward once needed, not built now (no evidence any custom field is
in active use yet to justify it).

---

## 15. Closed-Value Validation Fixes

| Field | Before | After |
|---|---|---|
| `holder.holder_type` | any string accepted | 422 unless one of `HOLDER_TYPES` |
| `holder.role` | any string accepted | 422 unless one of `ROLES` |
| `custom_field.field_type` | any string accepted, no tuple even existed | 422 unless one of new `FIELD_TYPES = ("text","number","date","dropdown","checkbox")` |

All three closed via router-level checks (mirroring the existing
`documents/router.py::doc_type` pattern), not Pydantic `Literal` (keeps the
error message consistent with the rest of the codebase's 422 convention)
and not a DB ENUM (explicitly not authorized).

**Custom field *value* validation** (distinct from field *definition* type
validation above): unknown `field_key` → 422; wrong Python type for the
field's `field_type` → 422; a `dropdown` value outside its `options.choices`
(a new, previously-undefined convention — see `custom_field_values.py`'s
docstring) → 422; a value for an inactive field → 422. `is_required` is
**not** enforced — see §16.

---

## 16. CHECK-Constraint Decision

**Added** for `holder.holder_type`, `holder.role`, `custom_field.field_type`
— all three: current data 100% conformant (re-verified immediately before
migration), value lists stable, migration trivially reversible, and none of
the three relate to lifecycle evolution.

**Not added** for `asset.status`, `asset_event.event_type`,
`asset_event.status_after` — these are exactly the surface most likely to
gain a new legal value if a future stage adds e.g. an approval workflow
(explicitly named as a "future capability, not V1" in the locked decisions,
meaning it's a live possibility, not a closed question). Adding a CHECK now
would just have to be altered again later. Documented as a deliberate,
reasoned non-decision, not an oversight.

---

## 17. Asset Field Policy Matrix

| Field | Classification | Editable via generic edit? | How changed | Audit requirement |
|---|---|---|---|---|
| `asset_code` | IMMUTABLE IDENTITY | No | Never, after creation | N/A — DB trigger (`trg_asset_no_identity_change`) blocks it outright |
| `company_id` | IMMUTABLE IDENTITY | No | Never, after creation | N/A — same trigger |
| `cost_center_id` | IMMUTABLE IDENTITY | No | Never, after creation | N/A — same trigger |
| `status` | LIFECYCLE-CONTROLLED | No (not in `AssetUpdateIn`) | `POST /api/assets/{id}/events` only | Already audited — every change is an `asset_event` row |
| `current_holder_id` | LIFECYCLE-CONTROLLED | No | `apply_event` only | Already audited — same ledger |
| `status_since` | LIFECYCLE-CONTROLLED | No | `apply_event` only | Already audited — same ledger |
| `category_id` | CONTROLLED EDITABLE MASTER REFERENCE | **Not yet** (deliberately excluded from `AssetUpdateIn` this stage — see below) | — | Would need generic field-change audit if ever exposed |
| `subcategory_id` | CONTROLLED EDITABLE MASTER REFERENCE | **Not yet** (same reasoning) | — | Same |
| `purchase_date` | CONTROLLED (date used by numbering tokens and event-ordering checks) | **Not yet** | — | Same, if ever exposed |
| `brand`, `model`, `serial_number`, `description`, `legacy_asset_code` | EDITABLE DESCRIPTIVE DATA | **Yes**, AM-02 | `PUT /api/assets/{id}` | None yet — see §18 |
| `vendor_id`, `po_number`, `po_date`, `invoice_number`, `invoice_date`, `pi_number`, `pi_date` | EDITABLE DESCRIPTIVE DATA | **Yes**, AM-02 | `PUT /api/assets/{id}` | None yet — see §18 |
| `purchase_cost`, `tax_percent` | EDITABLE DESCRIPTIVE DATA (drives recomputed `tax_amount`/`total_cost`) | **Yes**, AM-02 | `PUT /api/assets/{id}` | None yet — see §18 |
| `warranty_upto` | EDITABLE DESCRIPTIVE DATA | **Yes**, AM-02 | `PUT /api/assets/{id}` | None yet — see §18 |
| `custom_fields` | EDITABLE DESCRIPTIVE DATA | **Yes**, AM-02 (validated against active definitions) | `PUT /api/assets/{id}` | None yet — see §18 |
| `tax_amount`, `total_cost` | DERIVED/COMPUTED | No (recomputed from `purchase_cost`+`tax_percent`, never directly settable) | Automatic | N/A |
| `id`, `deleted_at` | SYSTEM/INTERNAL | No | Internal only (`deleted_at` via the existing mistake-delete endpoint) | N/A |

**Why `category_id`/`subcategory_id`/`purchase_date` were deliberately left
out of `AssetUpdateIn` this stage** even though they're technically mutable
at the database level (no trigger protects them): changing category after
the fact could make the asset_code's own embedded category token
misleading, and `purchase_date` feeds both code-generation tokens and the
"event date can't be before purchase date" invariant in `apply_event`.
Exposing them safely would need more design work than this stage's scope —
flagged as a future decision (§28), not silently allowed or silently
foreclosed.

---

## 18. Security/Authorization Verification

`PUT /api/assets/{id}`:
- `require_role("ADMIN", "IT_TEAM")` — VIEWER/HOLDER get 403 (tested).
- Routed through the existing `_get_scoped_asset` — an IT_TEAM actor from
  a different company gets 404, not the asset (tested; had to use IT_TEAM
  specifically for this test, since ADMIN is a *global*, not
  company-scoped, role in this system by design — `scoped_company_ids`
  returns `None`/unrestricted for ADMIN, confirmed by reading
  `app/core/deps.py`, not assumed).
- Identity/lifecycle fields aren't in `AssetUpdateIn`'s schema at all, so
  no amount of extra JSON in the request body can touch them — verified by
  a test that deliberately sends `asset_code`/`company_id`/`status`/etc. in
  the body and confirms none of them changed.
- Custom field values are validated server-side regardless of what the
  (currently nonexistent) frontend UI would send — "do not trust the
  frontend" from the authorization is satisfied by construction, since no
  UI calls this endpoint yet at all.
- `POST /api/masters/custom-fields` write access unchanged
  (`require_role("ADMIN","IT_TEAM")`, inherited from the existing generic
  master router — not touched).

No new unauthenticated endpoint. No mass-assignment risk introduced —
`AssetUpdateIn` is an explicit allowlist, not `Asset.__dict__` merged
wholesale.

---

## 19. Exact Files Changed

| File | Change |
|---|---|
| `backend/app/alembic/versions/0007_closed_value_check_constraints.py` | **New** — the migration |
| `backend/app/assets/custom_field_values.py` | **New** — value validation |
| `backend/app/assets/schemas.py` | `AssetOut` expanded; `AssetUpdateIn` added |
| `backend/app/assets/router.py` | `PUT /api/assets/{id}` added |
| `backend/app/assets/service.py` | `compute_tax` factored out; `validate_custom_field_values` wired into `procure_assets` |
| `backend/app/holders/router.py` | `holder_type`/`role` validation added |
| `backend/app/masters/models.py` | `FIELD_TYPES` tuple added |
| `backend/app/masters/router.py` | `validate_incoming` hook added to `build_master_router`; wired for `/custom-fields` only |
| `backend/tests/core/test_closed_value_integrity.py` | Rewritten: the 3 "documents the gap" tests now confirm the fix instead |
| `backend/tests/assets/test_am02_procurement_and_custom_fields.py` | **New** — 12 tests (§22) |

10 files (7 modified, 3 new). **No frontend files touched** — the response
contract expansion is additive and required no frontend change to keep
compiling or passing (confirmed, §24).

---

## 20. Migration Revision/Details

- Revision: `3a44505b6b10`, `down_revision = d2bcc801fcc1`.
- Content: 3 `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` statements (§11).
- Reversible: yes, `downgrade()` drops all 3 constraints (`DROP CONSTRAINT IF EXISTS`).
- Applied to `ckam_test` first, tests run, then applied to live `ckam` only after (§23, §24).

---

## 21. Existing-Data Treatment

No data was modified, backfilled, or rewritten anywhere. The migration adds
constraints only — every existing row already satisfied them (verified,
§11). No `UPDATE` statement of any kind was run against `ckam` or
`ckam_test` outside the test suite's own isolated writes.

---

## 22. Tests Added

**`tests/core/test_closed_value_integrity.py`** (rewritten, 6 tests, was 4):
`TestHolderTypeValidated` (2), `TestHolderRoleValidated` (1),
`TestCustomFieldTypeValidated` (2), `TestEventTypeIsProtectedIndirectly` (1, unchanged from AM-01).

**`tests/assets/test_am02_procurement_and_custom_fields.py`** (new, 12 tests):
- `TestProcurementFieldsRoundTrip` (2): all procurement fields incl. PI Number returned by `AssetOut`/register listing; fields correctly optional.
- `TestAssetUpdate` (4): editable subset updates correctly and recomputes tax; identity/lifecycle fields cannot be changed via PUT; VIEWER is refused; cross-company IT_TEAM gets 404.
- `TestCustomFieldValueValidation` (6): all 5 supported types accepted when valid; unknown key rejected; wrong type rejected; dropdown value outside options rejected; inactive field rejected; PUT path also validates.

**Net: 184 → 6 (rewritten in place, not net-new) + 12 new = 172 → 184 tests total change from AM-01's 170.**

Duplicate asset+field-value prevention was **not** given a dedicated test —
it's structurally impossible to construct (a JSON object cannot hold two
values for one key at the language level), not a runtime check with a
failure path to exercise.

---

## 23. Full Backend Test Results

**Baseline (before AM-02):**
```
170 passed, 12 warnings in 10.36s
```

**After AM-02:**
```
184 passed, 20 warnings in 13.52s
```

170 → 184 = +14 net (6 rewritten-in-place + 12 new − 4 replaced originals... concretely: `test_closed_value_integrity.py` went from 4→6 tests, `test_am02_procurement_and_custom_fields.py` added 12 → 170 + 2 + 12 = 184, matches exactly). **0 failures, 0 errors, 0 skipped.**

---

## 24. Frontend Typecheck/Unit/E2E Results

```
npx tsc -b          -> clean, no errors
npx vitest run      -> 56 passed (17 files), unchanged from AM-01
npx playwright test -> 1 passed (full custody journey, 13.5s)
```

`GET /api/auth/companies` re-checked after the E2E run: only the real
"Citykart Stores" company visible — the test company was cleanly torn down,
no residue left in the live database.

**No frontend source file needed any change** — the local, narrow
TypeScript interfaces each screen already defines for what it currently
reads from `AssetOut` (e.g. `AssetDetail.tsx`'s own `interface Asset { id,
asset_code, description, status, company_id }`) are structurally typed;
additional fields on the actual response object are simply available and
unused by existing code, not a compile error.

---

## 25. Alembic Verification

- Before: single head `d2bcc801fcc1` on both databases (matched expected).
- New migration `3a44505b6b10` applied cleanly to `ckam_test` first, full
  suite run and passing, **then** applied to live `ckam`.
- After: single head `3a44505b6b10` confirmed via `alembic current` on both
  databases.
- No multiple-heads condition at any point.

---

## 26. Database Trigger Verification

Re-queried `information_schema.triggers` on the live database after
migration:

```
 event_object_table |         trigger_name         | event_manipulation 
---------------------+------------------------------+--------------------
 asset               | trg_asset_no_identity_change | UPDATE
 asset_event         | trg_asset_event_no_delete    | DELETE
 asset_event         | trg_asset_event_no_update    | UPDATE
```

All 3 present, unchanged from AM-01. `PUT /api/assets/{id}` was specifically
tested to prove it cannot touch `asset_code`/`company_id`/`cost_center_id`
even by attempting to — both because they're not in `AssetUpdateIn`'s
schema and, as defense in depth, because the trigger would reject it at the
database level regardless.

---

## 27. Deviations from Approved Scope

**One, disclosed:** `procure_assets`'s inline tax calculation was factored
out into a shared `compute_tax` helper (`app/assets/service.py`) so the new
`PUT` endpoint's tax recomputation can't drift from the create path's. This
is a small refactor of existing code, not new scope — done because writing
the same Decimal arithmetic twice, in two files, was a strictly worse and
riskier option than sharing it once. No behavior change to `procure_assets`
itself (confirmed: all its existing tests still pass unmodified).

No other deviation. Import/export extension, `category_id`/`subcategory_id`/
`purchase_date` editability, and `holder_company_access` were all left
exactly as scoped (deferred/untouched).

## 28. Issues Discovered But Not Changed (Out of Scope)

- **Import template has no procurement/custom-field columns** (§13) — future Import UX stage.
- **Export has no procurement/custom-field columns** (§14) — future Reports stage.
- **`category_id`/`subcategory_id`/`purchase_date` have no edit path at all** (§17) — a real, evidenced gap (what if a category was picked wrong at creation?), deliberately left open since safely exposing it needs more design than this stage's scope allows.
- **No generic field-change audit exists yet** for the newly-editable descriptive fields (§18) — every `PUT /api/assets/{id}` call updates `updated_by`/`updated_at` (inherited from `AuditMixin`) but there is no before/after value log the way `asset_event` provides for lifecycle changes. Not built here per the authorization's explicit "do not build the full generic field-change audit system in AM-02 unless it becomes necessary for safely implementing asset procurement edits" — it wasn't necessary; `updated_by`/`updated_at` alone was judged sufficient for this stage's scope. Flagged as a real future need if procurement-field edits turn out to need "who changed the PO number and when" traceability.
- **`holder_company_access`** — untouched, exactly as instructed.

## 29. Remaining Risks

- None introduced by this stage; all changes additive, all verified against
  both databases with real (non-test) data present on the live one.
- Carried forward, unchanged: `code_rule`'s one-active-rule-per-scope race
  (still application-code-only); `holder.department_id` nullable with no
  type-conditional constraint. Neither was in AM-02's scope.
- New, worth naming even though low-severity: `AssetUpdateIn`'s
  `purchase_cost`/`tax_percent` being independently editable from the
  now-fixed `category_id`/`purchase_date` means an admin could technically
  change an asset's cost basis after the fact with no audit trail beyond
  `updated_by`/`updated_at` (§28's finding). Not a data-integrity risk
  today (no accounting/depreciation consumes this data yet, per the locked
  V1 decisions), but worth remembering if that ever changes.

## 30. Recommended AM-03 Scope

Given AM-02 is done, the next logical stage per the original AM-00 roadmap
would be **AM-03: shared UI primitives** (DataTable/PageHeader/StatusBadge/
EmptyState/FormField/AsyncButton) — pure frontend foundation, no backend
dependency, sets up every subsequent screen redesign. This is not a
recommendation to *start* it; per the stop condition below, that decision
is yours.

---

## 31. Final Git State

- Branch: `worktree-ckam-build`
- Ending HEAD: *(recorded at commit time — see the two AM-02 commits; this report is committed together with them)*
- `git status` before commit: 10 files (7 modified, 3 new), working tree otherwise clean

---

## 32. Final Verdict

**PASS**

All completion-gate items satisfied: field audit done before any schema
change; every existing field reused, zero duplicates created; PI Number
(and the rest of the procurement model) confirmed already complete and now
actually returned to clients; UDF foundation completed by reusing existing
tables, with real write-time validation; both AM-01 closed-value gaps
closed at the API layer and, where safe, the database layer; lifecycle
architecture, numbering, and company/cost-centre integrity all
regression-verified untouched; 184/184 backend tests, 56/56 frontend tests,
clean typecheck, 1/1 E2E, all green; migration verified on both databases
with triggers and real live data confirmed intact throughout.
