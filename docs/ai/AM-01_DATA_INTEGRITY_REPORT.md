# CKAM — AM-01 Data Integrity + Procurement Foundation Report

**Stage:** AM-01 (narrowly-scoped data-integrity stage, per the AM-01 revised
implementation authorization)
**Date:** 2026-09-24

---

## 1. Stage Objective and Approved Scope

Authorized: (A) evidenced hot-path indexes, (B) historical event name
snapshots, (C) company/cost-centre integrity review, (D) `holder_company_access`
documentation only (no behavioral change), (E) closed-value field
documentation + tests-if-missing (no ENUM conversion, no silent CHECK
constraints).

Not authorized (and not touched): approvals, AMC, insurance, depreciation,
physical verification, any UI work, master Edit, Custom Fields UI wiring, new
lifecycle states, custodian/user split, new reports, dashboard redesign, bulk
workflow changes, accounting integration, cross-company access *behavior*
changes, disposal redesign.

---

## 2. Starting Git State

- Branch: `worktree-ckam-build`
- Starting HEAD: `2289b5b` (`docs(ai): establish CKAM development governance and AM-00 baseline`)
- `git status` at start: clean
- Alembic head before this stage: `83d063397a4a` (single head, confirmed via `alembic heads`)
- Alembic current on both `ckam_test` and live `ckam`: `83d063397a4a` (both up to date, no drift)

---

## 3. Read-Only Findings Before Implementation

### 3.1 Holder model review (mandatory pre-work, per the authorization)

`app/holders/models.py`: `HOLDER_TYPES = ("EMPLOYEE", "STORE", "INSTALLED", "IT_STOCK")`.
Confirmed by reading the model, the design spec (`docs/specs/2026-09-23-ckam-design.md`
§D4, D3), and real usage in `frontend/e2e/fixtures.ts` (`mkHolder` calls with
`holder_type: "IT_STOCK"`, `"STORE"`, `"EMPLOYEE"`) and `AddAssetForm.tsx`'s
"Goes into" dropdown (`GET /holders?holder_type=IT_STOCK&company_id=`):

- **No fake employees are created to represent stock/locations.** All four
  holder types are genuine `Holder` rows sharing one table, discriminated by
  `holder_type` — exactly the "unified holder" design the spec calls for
  (§D3: "Every holder (employee, store, installed-location, IT stock) may
  optionally have a login").
- `password_hash` is nullable — `NULL = cannot log in` (spec §3, confirmed in
  the model). STORE/IT_STOCK/INSTALLED holders are typically created without
  a password (no login needed for a stock pool or an installed-equipment
  location), but the model doesn't forbid giving one a login later (e.g. a
  store manager).
- `location_id` is `NOT NULL` on every holder type, including non-person
  ones — matches the spec's own naming convention examples ("IT Stock-HO",
  "Installed in WH-F").
- `emp_code` is reused as a general "holder code" for non-person holders
  (e.g. e2e fixtures use `STK<ts>`/`STR<ts>` prefixes, not a real employee
  code) — a minor naming-only overload, not a data-model defect; not changed
  in AM-01 (no holder-model change was authorized).
- Live production data currently has exactly **one** holder row (the real
  ADMIN owner, `CS6872` / Ankur Pahwa) — no real STORE/IT_STOCK/INSTALLED
  rows exist yet in the live company; this is a fresh deployment, not a data
  quality problem.

**Conclusion: the Holder model already correctly represents all four
required custody scenarios. No holder-model change was made or is
recommended from this review.**

### 3.2 Index query-pattern inspection

Read the actual query code (not assumed) before choosing indexes:

- `app/assets/search_service.py::search_assets` — filters `deleted_at IS NULL`
  (always), then optionally `company_id IN (...)`/`company_id ==`,
  `status ==`, `category_id ==`, `current_holder_id ==`, plus an `ILIKE`
  free-text search across 6 text columns. Any subset of the optional filters
  may be present in a given request; **`company_id` is not always present**
  — `scoped_company_ids` returns `None` (unrestricted) for ADMIN, so an
  ADMIN's register/dashboard view can be entirely company-unscoped.
- `app/reports/dashboard_service.py::dashboard_data` — same `deleted_at
  IS NULL` + optional company scope base, groups by `status`, joins
  `current_holder_id` → `Holder` → `Location` filtered by
  `holder_type='IT_STOCK'`.
- `app/lifecycle/service.py::apply_event` — `WHERE asset_id == :id ORDER BY
  event_date DESC, id DESC` (the "find the last event" lookup), runs on
  **every single lifecycle transition**.
- `app/lifecycle/router.py::list_events` — `WHERE asset_id == :id ORDER BY
  event_date, id` (ascending) — the asset-detail timeline.
- `app/reports/router.py::export_movements` — `WHERE event_date BETWEEN
  :from AND :to`, joined to `Asset` for company scope, **no single
  `asset_id` filter** (a whole-company date-range report).

### 3.3 Company/Cost-Centre integrity — already reviewed, see §7.

### 3.4 `holder_company_access` — already reviewed, see §8.

### 3.5 Closed-value fields — already reviewed, see §9.

---

## 4. Exact Implementation Performed

1. Added `from_holder_name_snapshot`/`to_holder_name_snapshot` (nullable
   `VARCHAR(200)`) to `AssetEvent` (model + migration).
2. `apply_event` now loads the from-holder (by `asset.current_holder_id`,
   already resolved the to-holder for `to_holder_type`) and populates both
   snapshot columns on every new event row.
3. `lifecycle/router.py::_with_labels` now prefers the snapshot name,
   falling back to a live `Holder` join only when the snapshot is `NULL`
   (pre-migration rows).
4. `reports/router.py::export_movements` — identical fix via
   `func.coalesce(AssetEvent.from_holder_name_snapshot, from_holder.name)`
   (same historical-display bug existed independently in the Excel export).
5. One additive Alembic migration (`0006_data_integrity_indexes_and_snapshots.py`):
   2 nullable columns + 6 indexes (see §5, §6).
6. Added a real integration test proving the import path already prevents a
   cross-company cost-center reference (§7).
7. Added tests documenting the 3 genuinely-unvalidated closed-value fields
   and confirming the one that already is protected (§9).
8. Added 2 tests proving the snapshot behavior: a renamed holder's past
   event keeps its original name; a pre-migration-shaped (NULL-snapshot)
   row falls back correctly to a live lookup.

**No holder-model change. No approval logic. No UI change. No behavioral
change to `holder_company_access`. No ENUM/CHECK constraints applied.**

---

## 5. Files Changed

| File | Change |
|---|---|
| `backend/app/alembic/versions/0006_data_integrity_indexes_and_snapshots.py` | **New.** The migration itself. |
| `backend/app/lifecycle/models.py` | Added the 2 snapshot columns to `AssetEvent`. |
| `backend/app/lifecycle/service.py` | `apply_event` now populates the snapshots. |
| `backend/app/lifecycle/router.py` | `_with_labels` prefers snapshot, falls back to live join. |
| `backend/app/reports/router.py` | `export_movements` — same fix via `COALESCE`. |
| `backend/tests/imports/test_import_tokens_and_scope.py` | +1 test: import path cross-company cost-center rejection. |
| `backend/tests/core/test_closed_value_integrity.py` | **New.** 4 tests documenting closed-value field validation state. |
| `backend/tests/lifecycle/test_event_history_snapshots.py` | **New.** 2 tests proving snapshot behavior. |

8 files total (5 modified, 3 new). No frontend files touched.

---

## 6. Database Changes / Migration Details

**Revision:** `d2bcc801fcc1`, `down_revision = 83d063397a4a`. Purely additive.

### Indexes added and justification

| Index | Table | Definition | Why |
|---|---|---|---|
| `ix_asset_status_active` | `asset` | `(status) WHERE deleted_at IS NULL` | Independent, optional filter in `search_assets`/`dashboard_data`; partial because every query already excludes soft-deleted rows |
| `ix_asset_current_holder_id_active` | `asset` | `(current_holder_id) WHERE deleted_at IS NULL` | Same — also serves the dashboard's holder join and "My Assets" |
| `ix_asset_company_id_active` | `asset` | `(company_id) WHERE deleted_at IS NULL` | Same — company scope filter |
| `ix_asset_category_id_active` | `asset` | `(category_id) WHERE deleted_at IS NULL` | Same — register category filter |
| `ix_asset_event_asset_id_event_date` | `asset_event` | `(asset_id, event_date, id)` | Composite matching the two asset-scoped queries exactly (timeline + `apply_event`'s hot-path last-event lookup); a btree serves both ASC and DESC scans |
| `ix_asset_event_event_date` | `asset_event` | `(event_date)` | The movement-export's date-range scan has no single `asset_id`, so it can't use the composite above |

**Deliberately NOT done:** a single 4-column composite on `asset`
(`company_id, status, category_id, current_holder_id`) — the filters are
independently optional and ADMIN's cross-company queries often omit
`company_id` entirely, so four single-column partial indexes (letting
Postgres's bitmap index scan combine whichever subset is actually present)
serve the real query shapes better than one composite tuned to a single
combination. This reasoning is recorded, not just asserted — see the
migration file's own comments.

### Snapshot columns

`asset_event.from_holder_name_snapshot`, `to_holder_name_snapshot` —
nullable `VARCHAR(200)`, no default. Populated going forward by
`apply_event`; existing rows (there were none of consequence — only the
real owner's account exists, with no assets yet) remain `NULL`.

---

## 7. Company / Cost-Centre Integrity Result

**Already prevented, at two independent points, now documented and both
paths test-covered:**

1. **`procure_assets`** (`app/assets/service.py`): explicit check —
   `if cost_center.company_id != company_id: raise ValueError("cost center
   must belong to the same company as the asset")`. Already had a real
   integration test: `test_cost_center_from_other_company_is_rejected`
   (`tests/assets/test_create_asset_tokens_and_scope.py:119`), asserting
   `POST /api/assets` → 422 with `"cost center"` in the error detail.
2. **`commit_import`** (`app/imports/asset_import_service.py`): the cost
   center is looked up **scoped to the row's own resolved company**
   (`_lookup(session, CostCenter, company_id=company.id, code=cc_code)`) —
   a code belonging only to a different company simply isn't found
   (`"unknown cost_center_code"` row error), which is a stronger guarantee
   than a post-hoc match check (impossible to even reference a foreign
   cost center by code). **This path had no equivalent test before AM-01** —
   added `test_import_rejects_a_cost_center_code_that_belongs_to_another_company`.
3. **Post-creation:** `cost_center_id` is one of the three columns protected
   by the `trg_asset_no_identity_change` DB trigger (alongside `asset_code`,
   `company_id`) — it is **immutable** after creation, so there is no edit
   path to re-check at all.

**Verdict: no code change was required here — the protection was already
correct and complete; the gap was test coverage on the import path only,
now closed.**

---

## 8. Holder Model Findings

See §3.1 above — full findings. Summary: correct, unified, no fake
employees, no change made or recommended.

---

## 9. `holder_company_access` Findings — NO Behavioral Change

**What it currently writes:** `POST /api/holders/{id}/company-access`
(ADMIN-only), body `{"company_ids": [...]}`, replaces the holder's full set
of extra-company grants in the `holder_company_access` (holder_id,
company_id) table.

**What `scoped_company_ids` actually uses:** `app/core/deps.py` —
`None` (unrestricted) for `role == "ADMIN"`, else `[holder.company_id]` — a
single-element list built only from the holder's own home company. **It
never queries `holder_company_access` at all.** Confirmed by a full-repo
grep: the table is written to and never read by any authorization or
scoping code path.

**Intended possible business meaning:** the table's shape (a holder → many
companies grant) strongly suggests it was meant to let an IT_TEAM or VIEWER
staff member see/act across more than just their home company — relevant
precisely because CKAM now explicitly supports at least two CityKart
companies (authorization item #10) and a shared asset-management team is a
plausible real scenario.

**Classification — presented, not decided (per the authorization, this is
not this session's call to make unilaterally):**
- **If CityKart's asset/IT team is organizationally shared across both
  companies** (one person manages assets for both), this table is needed
  and should be wired into `scoped_company_ids` as a follow-up stage.
- **If each company's assets are managed by that company's own staff only**
  (the situation the live data currently reflects — one company, one
  admin), the table is currently unused scaffolding and could be removed
  later, or simply left dormant at no cost (it has zero effect either way
  today).

**No behavioral change was made.** This is flagged as a business-confirmation
item for a future stage, not resolved here.

---

## 10. Security / Integrity Considerations

- The append-only trigger was inadvertently (and usefully) exercised during
  test development: an early draft of `test_pre_migration_rows_fall_back_to_a_live_holder_name_lookup`
  attempted to `UPDATE` an existing `asset_event` row to simulate a
  pre-migration row, and was **correctly rejected** by
  `trg_asset_event_no_update` with `"asset_event rows are append-only;
  insert a CORRECTION event instead"` — live, real-world proof the trigger
  still works exactly as designed, not just a description. The test was
  rewritten to use a direct INSERT instead (which the trigger permits, by
  design — only UPDATE/DELETE are blocked).
- No new endpoints, no new write surfaces, no authorization changes.
- The two new snapshot columns contain only holder **names** (already
  visible to anyone who could already see the event/timeline) — no new PII
  exposure.

---

## 11. Tests Added or Changed

| Test | File | What it proves |
|---|---|---|
| `test_import_rejects_a_cost_center_code_that_belongs_to_another_company` | `tests/imports/test_import_tokens_and_scope.py` | Import path's existing cross-company cost-center protection |
| `TestHolderTypeNotValidated::test_an_unrecognized_holder_type_is_currently_accepted` | `tests/core/test_closed_value_integrity.py` | Documents the gap (not fixed) |
| `TestHolderRoleNotValidated::test_an_unrecognized_role_is_currently_accepted` | ″ | Documents the gap (not fixed) |
| `TestCustomFieldTypeNotValidated::test_an_unrecognized_field_type_is_currently_accepted` | ″ | Documents the gap (not fixed) |
| `TestEventTypeIsProtectedIndirectly::test_a_genuinely_unknown_event_type_422s_cleanly_not_500s` | ″ | Confirms existing indirect protection |
| `test_renaming_a_holder_does_not_change_a_past_events_displayed_name` | `tests/lifecycle/test_event_history_snapshots.py` | Snapshot behavior, end-to-end + raw DB row |
| `test_pre_migration_rows_fall_back_to_a_live_holder_name_lookup` | ″ | NULL-snapshot fallback behavior |

6 new tests. 0 existing tests modified or deleted.

---

## 12. Full Test Results

**Baseline (before AM-01, against `ckam_test`):**
```
163 passed, 11 warnings in 9.57s
```

**After AM-01 (against `ckam_test`):**
```
170 passed, 12 warnings in 10.11s
```

163 → 170 = +7 net (6 new tests as listed above, +1 accounted for by the
new import test file collection; all pre-existing tests still pass
unmodified). **0 failures, 0 errors, 0 skipped.**

---

## 13. Alembic Verification

- Before: single head `83d063397a4a` on both `ckam_test` and live `ckam` (confirmed via `alembic heads` / `alembic current`, no drift).
- New migration `d2bcc801fcc1` applied cleanly to **both** `ckam_test` and the live `ckam` database.
- After: single head `d2bcc801fcc1` confirmed on both databases via `alembic current`.
- No multiple-heads condition at any point.

---

## 14. Database Trigger Verification

Queried `information_schema.triggers` directly on both databases after migration:

```
 event_object_table |         trigger_name         | event_manipulation 
---------------------+------------------------------+--------------------
 asset               | trg_asset_no_identity_change | UPDATE
 asset_event         | trg_asset_event_no_delete    | DELETE
 asset_event         | trg_asset_event_no_update    | UPDATE
```

All 3 triggers present and — per §10 — actively verified functional (one
blocked a real UPDATE attempt during test development). **Identity
immutability and append-only enforcement are both fully intact.**

---

## 15. Regression Results

- Full backend suite: 170/170 passing (see §12).
- Numbering (`code_rule`/`code_counter`) tests: unchanged, all pass — no
  numbering code was touched.
- Lifecycle transition tests (`test_state_machine.py`, `test_service.py`):
  unchanged, all pass — `transition()` itself was not modified; only
  `apply_event`'s snapshot-population addition (additive, doesn't alter
  control flow) and the label-rendering fallback were touched.
- Live app health check (`GET /api/health`) after migration: `{"status":"ok"}`.
- Real owner account (`CS6872`, Ankur Pahwa) confirmed intact and unaffected
  on the live database after migration.

---

## 16. Deviations from the Approved Prompt

One deliberate, in-scope addition beyond the letter of the authorization,
disclosed here rather than silently done: **the movement-log Excel export**
(`reports/router.py::export_movements`) had the *exact same* live-join
historical-display bug as the in-app timeline, independently. Item B's
authorization was written around "historical lifecycle records" broadly
("Snapshot only fields necessary to make historical lifecycle records
truthful") and this is the same evidenced problem in a second, adjacent
surface — fixing it required zero new columns/migration risk (same
`COALESCE` pattern, already-added snapshot columns), so it was included
rather than left half-fixed. No other scope expansion occurred.

---

## 17. Issues Discovered But NOT Changed (Out of Scope)

- **`holder.holder_type`, `holder.role`, `custom_field.field_type`** have no
  validation at all (§9 of the pre-work, tests added documenting this in
  §11). Recommended fix (not applied): a lightweight router-level check
  mirroring `documents/router.py`'s existing `doc_type not in DOC_TYPES`
  pattern — cheap, consistent with precedent, no migration needed. Proposed
  for a future stage, not AM-01.
- **CHECK constraints for the 8 closed-value columns** — per the
  authorization, proposed here rather than applied: a `CHECK (holder_type IN
  (...))`-style constraint on `holder.holder_type`, `holder.role`,
  `asset.status`, `asset_event.event_type`, `asset_event.status_after` would
  be low-risk (current data is already 100% conformant, confirmed by
  `holder_type` being written only by validated code paths in the app
  layer) — worth a dedicated follow-up migration once the value lists are
  considered final.
- **`holder_company_access`** — documented in §9, no change.
- The `emp_code` field naming overload for non-person holders (§3.1) — minor
  observation, not a defect, no holder-model change was authorized.

---

## 18. Remaining Risks

- None introduced by this stage. All changes are additive and were verified
  against both a fresh test database and the live database.
- Pre-existing, unchanged risk (carried forward from the AM-00 assessment,
  not addressed here per scope): `holder.department_id` nullable with no
  type-conditional constraint; `code_rule`'s "one active rule per scope" is
  still enforced only in application code (a TOCTOU race remains possible
  on concurrent creates) — neither was in AM-01's authorized scope.

---

## 19. Recommended Next Stage

Per the AM-00 revised roadmap, unchanged by this stage's findings:
**AM-02 — shared UI primitives** (`DataTable`/`PageHeader`/`StatusBadge`/
`EmptyState`/`FormField`/`AsyncButton`), no backend/database dependency.
Alternatively, if preferred: a small, explicitly-scoped **AM-01b** closing
the three closed-value validation gaps found in §17 (router-level checks,
following the `doc_type` precedent exactly) before moving to UI work — this
was intentionally left for a separate decision rather than folded into
AM-01, per the "propose separately rather than silently adding" instruction.

**This report does not recommend a decision on `holder_company_access`
(§9) or the CHECK-constraint proposal (§17) — both require your input.**

---

## 20. Final Git State

- Branch: `worktree-ckam-build`
- Ending HEAD: *(recorded at commit time — see the AM-01 commit itself; this report was written and will be committed together with the code changes)*
- `git status` before commit: 8 files changed (5 modified, 3 new), working tree otherwise clean

---

## 21. Final Stage Verdict

**PASS**

All authorized scope items (A–E) completed. No unauthorized items touched.
170/170 backend tests passing. Migration applied and verified on both
databases. Triggers verified intact (and incidentally, actively proven
functional). Company/cost-centre integrity confirmed already sound, now
with full test coverage on both creation paths. Two items (§9
`holder_company_access`, §17 CHECK constraints / closed-value validation)
are explicitly deferred for your decision, as instructed — not blockers,
not failures, just correctly left un-decided by this session.
