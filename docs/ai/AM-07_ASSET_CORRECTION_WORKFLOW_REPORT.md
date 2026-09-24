# AM-07 — Controlled Asset Classification + Purchase-Date Correction — Report

## 1. Executive summary

AM-07 closes the largest confirmed functional gap carried since AM-02:
`category_id`, `subcategory_id`, and `purchase_date` had no correction path
after asset creation. Rather than adding these fields to the generic
`AssetUpdateIn`/Asset 360 Edit form (explicitly rejected — see the
authorization's Primary Principle), a dedicated, role-gated (ADMIN/IT_TEAM),
reason-required correction workflow was built: a new
`POST /api/assets/{id}/corrections` endpoint, backed by a new
`app/assets/correction_service.py`, surfaced in Asset 360 as a separate
"Correct Classification" action. Asset Code, company, cost centre,
lifecycle status, current holder, and historical `asset_event` rows are all
provably unchanged by a correction — provable by construction (the
correction service never imports the numbering service or calls
`apply_event`), not merely by a runtime check. The audit trail reuses the
existing `asset_field_change` table (one small additive migration adding a
nullable `reason` column) rather than a third audit system. One
pre-existing DB trigger (`trg_asset_no_identity_change`) was investigated in
depth and confirmed to need zero changes. 30 new backend tests, 10 new
frontend tests, and a new E2E spec were added; all pre-existing suites stay
green. Two real correction transactions were exercised live in the browser
against a freshly created, safe UAT asset, confirmed via the Overview,
Procurement, Changes, and History tabs. Three low-risk verification sweeps
deferred from AM-06 (`/reports` Responsive, `/change-password` Security/
Responsive, remaining `MasterCrudScreen` spot-checks) were also completed
this stage, per the authorization's §41-43. Two pre-existing, out-of-scope
UI bugs were found during this stage's own browser UAT and documented (not
fixed): Add Asset's Cost Centre/Category dropdowns are not company-scoped
(backend independently and correctly rejects a mismatch), and Add Holder
sends `location_id=0` instead of omitting a blank Location, causing an
unhandled 500.

**Verdict: PASS.**

## 2. Git preflight

Before any code was written, the branch was verified against the AM-06
report's stated REPORT CONTENT HEAD (`73719dd`):

- `git log 73719dd..HEAD` (at session start) showed zero commits — the
  branch was exactly at `73719dd`, matching the AM-06 report exactly.
- `git status` was clean (no uncommitted changes, no untracked files).
- No `pull`/`push`/`merge`/`rebase`/`reset`/branch-switch/`clean`/delete was
  performed at any point in this stage. `git log --oneline` was used
  repeatedly to confirm the commit sequence stayed linear and exactly as
  expected: `767609d` → `73b1842` → `9a5e7fc`, each authored directly on
  `worktree-ckam-build`.
- Working tree confirmed clean again immediately before writing this
  report (`git status` → "nothing to commit, working tree clean").

## 3. Starting AM-07 HEAD

`73719dd` (`fix(my-assets): AM-06 -- drop the Category column, found broken
during UAT` — the AM-06 report's own REPORT CONTENT HEAD, confirming no
drift between the AM-06 report's claim and the actual branch state).

## 4. Starting database state

Verified independently before any AM-07 migration work, against the live
`ckam` database:

- Alembic head: `370399c6380e` (the AM-05 `CustomField.company_id`
  migration), matching the AM-06 report's stated baseline exactly.
- `trg_asset_no_identity_change`'s live definition was queried directly via
  `pg_proc.prosrc` and confirmed to protect only `asset_code`, `company_id`,
  `cost_center_id` — this finding (§11 below) shaped the entire correction
  architecture and was established from the live database, not assumed
  from migration source alone.
- `asset_field_change`'s append-only triggers
  (`trg_asset_field_change_no_update`/`trg_asset_field_change_no_delete`,
  from migration `a409768dc2cf`) confirmed present and, per their own
  definitions, guarding only UPDATE/DELETE — never INSERT, meaning a new
  additive column on this table would not require any trigger change
  either.

## 5. Starting test baseline

Independently re-run (not assumed from the AM-06 report) immediately before
any AM-07 change:

- Backend: 258/258 passing.
- Frontend: 133/133 passing (25 files), `npx tsc -b` clean.
- E2E: 3/3 passing.

All three baselines matched the AM-06 report's own stated numbers exactly.

## 6. Current invariants audit

Before writing any correction code, the following were read in full (not
assumed): `app/assets/models.py` (`Asset`), `app/assets/schemas.py`
(`AssetUpdateIn`), `app/assets/service.py` (`procure_assets`,
`compute_tax`), `app/numbering/service.py` (`build_code_tokens`,
`generate_code`, `get_active_rule`), the `code_rule`/`code_counter` models,
`app/lifecycle/service.py::apply_event`, the original identity-trigger
migration (`0003_assets_and_events.py`), `app/assets/audit_service.py`
(existing `AUDITED_SCALAR_FIELDS`/`record_field_changes`), `app/assets/
router.py` (`_get_scoped_asset`, `update_asset`), the Asset Register/
Reports/Import code paths that read `category_id`/`subcategory_id`/
`purchase_date`, and every migration touching the `asset` table. Resulting
invariant table:

| Field | Current mutability | Used by numbering | Used by lifecycle | DB protected | Historical risk | Correction requirement |
|---|---|---|---|---|---|---|
| `category_id` | Set once, at creation, via `procure_assets`/`commit_import` | Yes — `build_code_tokens` can read `category.code` as a token | No | No (confirmed — see §11) | Low: no event/report keys off historical category value | Must stay active, authorization must cover the asset, reason mandatory, must not orphan `subcategory_id` |
| `subcategory_id` | Set once, at creation, optional | Yes, if the active `CodeRule` template references `{subcategory.code}` | No | No | Low, same reasoning | Must belong to the effective category (new or existing), may be cleared if optional |
| `purchase_date` | Set once, at creation | Not used as a code token in the current active rule set, but the schema permits it | Not itself an `asset_event`, but `apply_event` enforces event-date ordering relative to prior events | No | Medium — a later purchase_date than reality could make lifecycle history look impossible (e.g., "procured" appearing to happen before purchase) | Must not be in the future; must not be later than the asset's earliest recorded `asset_event.event_date` |

None of the three fields were found to be DB-trigger-protected, DB-CHECK-
constrained, or referenced by `apply_event`'s own status/holder-writing
logic. This audit is the basis for every rule adopted in §16-18 below.

## 7. Category usage analysis

`category_id` is read in: `app/numbering/service.py::build_code_tokens`
(as a possible `{category.code}` token — read-only, at creation time only),
`app/assets/router.py`'s list/detail/export endpoints (display only), and
`app/reports/export_service.py` (Asset Register export column, and the
Category filter on that export). Nowhere is `category_id` read by
`apply_event`, by any lifecycle-status transition rule, or by any DB
trigger. The only invariant an asset's `category_id` must satisfy at any
time is: the referenced `AssetCategory` row exists and (for a *write*, not
merely for continuing to exist) is active. A correction changing
`category_id` therefore only needs to validate the new category and
resolve any resulting `subcategory_id` conflict (§8/§16) — it has no
numbering side effect after creation (numbering only runs at creation, see
§10) and no lifecycle side effect at all.

## 8. Subcategory usage analysis

`subcategory_id` is read in the same places as `category_id`, plus the
`AssetSubcategory.category_id` foreign key itself, which is the source of
the one real invariant: a subcategory must belong to its asset's category.
Pre-AM-07, this relationship was only ever established once, at creation,
and was never revisited — there was no code path where `category_id` could
change while `subcategory_id` stayed fixed, so the "orphaned subcategory"
case literally could not occur before AM-07. Introducing a category
correction reintroduces exactly this risk, which is why §16/§17 (the
category/subcategory joint-validation rule) exists: the correction service
re-validates the *effective* pairing (new category if supplied, else the
asset's current category; new subcategory if supplied, else the asset's
current subcategory) on every request that touches either field, not just
requests that touch both.

## 9. Purchase Date usage analysis

`purchase_date` is read in: the Asset Register/export columns (display),
Import's row validation (`_parse_purchase_date`, at import time only), and
is *not* read by `build_code_tokens` in the currently active `CodeRule`
templates (`{category.code}`, `{subcategory.code}`, `{sequence}` are the
tokens actually configured; a future rule *could* reference a purchase-date
token, but none currently does — checked by reading every seeded/test
`CodeRule.template_string` and the token-resolution code itself, which
supports arbitrary tokens generically). The one real invariant, absent
before AM-07 (because `purchase_date` was immutable after creation), is
chronological: `apply_event` already enforces, for every lifecycle event,
that its `event_date` is not in the future and not earlier than the
asset's previous event. AM-07's Purchase Date correction adopts the same
two rules, applied to the correction itself: the corrected value must not
be in the future, and must not be later than the asset's *earliest*
recorded `asset_event.event_date` (the "Procured" event date, in every
case observed) — i.e., the corrected purchase date must still make sense
as *preceding* the asset's own recorded history. This invariant was
reliably determinable from existing, evidenced code (§10 of the
authorization's fallback — stopping the Purchase Date part entirely — was
therefore not needed).

## 10. Asset Code immutability decision

Confirmed via static analysis of the entire codebase (not a runtime
assertion alone): `app/numbering/service.py`'s three functions
(`build_code_tokens`, `generate_code`, `get_active_rule`) are imported and
called from exactly two places — `app/assets/service.py::procure_assets`
and `app/imports/asset_import_service.py::commit_import` — both
asset-*creation* paths. `app/assets/correction_service.py` (the new AM-07
file) imports neither the `app.numbering` module nor any of its functions,
and its `correct_asset` function never touches `asset.asset_code`. This
means Asset Code immutability across a correction holds by construction: a
future maintainer would have to *add* a new import and a new call to make a
correction regenerate a code — it cannot happen by accident inside the
existing correction code path. `code_counter` is likewise untouched: it is
only ever incremented inside `generate_code`, never called from
correction-related code.

## 11. Existing DB-trigger analysis

`trg_asset_no_identity_change` (function `forbid_asset_identity_change()`,
defined in migration `0003_assets_and_events.py`) was the single most
important thing to get right before writing any correction code, per the
authorization's explicit "do NOT weaken the trigger" instruction. Verified
by three independent methods:

1. Read the original migration source directly — the function body only
   references `OLD.asset_code`, `OLD.company_id`, `OLD.cost_center_id`
   against their `NEW.*` counterparts.
2. Grepped every later migration file (`backend/app/alembic/versions/*.py`)
   for any redefinition of `forbid_asset_identity_change` or
   `trg_asset_no_identity_change` — none found; the function has never been
   changed since its original definition.
3. Queried the live `ckam` database directly (`SELECT prosrc FROM pg_proc
   WHERE proname = 'forbid_asset_identity_change'`) and confirmed the
   deployed function body matches the migration source exactly.

Conclusion: the trigger never protected `category_id`, `subcategory_id`, or
`purchase_date` in the first place. AM-07 required **zero** changes to this
trigger, its function, or any other DB-level protection — the narrowest
possible outcome, and the one explicitly preferred by the authorization.

## 12. Correction architecture

A **correction** is modeled as a distinct kind of write from an ordinary
edit: its own request schema (`AssetCorrectionIn`), its own service
function (`correct_asset`, in a new file rather than folded into
`app/assets/service.py`'s existing `procure_assets`/`update_asset`
functions), its own router endpoint, and its own audit-recording function
(`record_correction_changes`, alongside but separate from the existing
`record_field_changes`). This separation means a future change to ordinary
Edit-mode behavior cannot accidentally alter correction behavior, and vice
versa — the two code paths share only the `_get_scoped_asset` authorization
helper (deliberately, so their scoping semantics can never drift apart) and
the `AssetFieldChange` table itself (deliberately, so the audit trail stays
unified into one readable timeline).

## 13. Correction API

`POST /api/assets/{id}/corrections`, request body `AssetCorrectionIn`:

```python
class AssetCorrectionIn(BaseModel):
    category_id: int | None = None
    subcategory_id: int | None = None
    purchase_date: date | None = None
    reason: str
```

The router reads `body.model_fields_set` (FastAPI/Pydantic's set of field
names actually present in the submitted JSON) to distinguish "this field
was not part of the request at all" (leave the asset's current value
untouched) from "this field was explicitly set to `null`" (meaningful only
for `subcategory_id`, the one field that can legitimately be cleared). This
is implemented via a private `UNSET` sentinel object translated at the
router boundary — `correct_asset` itself never sees Pydantic's
field-presence machinery, keeping the service function's signature and
testability clean. `PUT /api/assets/{id}` (`AssetUpdateIn`) was **not**
extended or overloaded — confirmed by a dedicated regression test (§29,
`TestRegression`) that a normal PUT still cannot move any of these three
fields.

## 14. Authorization model

`require_role("ADMIN", "IT_TEAM")` is the endpoint's dependency — VIEWER
and HOLDER receive `403` before any asset lookup or scoping check even
runs. Company/asset scoping reuses `_get_scoped_asset` exactly as
`update_asset` does: HOLDER is pinned to their own asset only (moot here,
since HOLDER can never reach the endpoint at all, but the shared helper
keeps this guarantee structurally identical rather than re-implemented);
ADMIN is unrestricted (global); IT_TEAM is scoped to their own company,
fail-closed to `404` (not `403`) for an out-of-scope asset id, so an
IT_TEAM user cannot distinguish "doesn't exist" from "exists in another
company" by response code. `holder_company_access`/`scoped_company_ids`
were not touched — an ADMIN in these tests still returns `None`
(unrestricted), so every cross-company-denial test explicitly uses an
IT_TEAM holder rather than ADMIN, avoiding the "ADMIN proves nothing"
scoping trap documented in earlier stages' test comments.

## 15. Reason requirement

`reason: str` is required by the schema itself (no default, so a request
omitting it entirely is rejected by Pydantic before the service function
ever runs). Inside `correct_asset`, the value is additionally
`.strip()`-checked for non-blank content (rejecting an all-whitespace
string, which Pydantic's own `str` type would otherwise accept) and capped
at `REASON_MAX_LENGTH = 500` characters — matching the new
`asset_field_change.reason` column's own `VARCHAR(500)` width, so a
rejected-for-length request can never even reach the database layer. No
separate reason-code master table was introduced, per the authorization's
explicit "no complex reason master" instruction — reason is free text.

## 16. Category correction rules

A supplied `category_id` must resolve to an existing, **active**
`AssetCategory` row (checked via `session.get` + `.is_active`), or the
request is rejected with a 422 naming the problem ("category is not
active" / "category not found"). If the category is changing (whether
explicitly supplied or, transitively, because a subsequent subcategory
requires it), the service re-validates the asset's *effective* subcategory
(§17) against the new category before committing anything — the two fields
are validated together, never independently, so a request can never
succeed with the asset left in an invalid category/subcategory pair. Asset
Code, lifecycle status, current holder, company, and cost centre are
provably untouched (§10, §19).

## 17. Subcategory correction rules

A supplied, non-null `subcategory_id` must resolve to an existing, active
`AssetSubcategory` whose `category_id` equals the *effective* category
(the newly-supplied one if this request also changes category, otherwise
the asset's current category). Two distinct rejection messages were
implemented depending on which side of the mismatch is at fault: (a) an
*explicitly supplied* subcategory that simply doesn't belong to the
resulting category gets a generic "subcategory does not belong to the
selected category" 422; (b) a category change where the asset's *existing*
subcategory (not re-supplied in this request, i.e. auto-carried-forward)
no longer belongs to the new category gets a more specific, actionable
422 — "the asset's current subcategory does not belong to the new
category; supply a valid subcategory_id for the new category, or set
subcategory_id to null" — since this is the scenario the authorization
specifically flagged as needing a clear, actionable instruction rather
than a generic error. `subcategory_id: null` is honored as "clear the
subcategory" (legal, since Sub-Category is optional on the asset itself),
distinguished from "field not present" via the `UNSET` sentinel (§13). No
arbitrary cross-category assignment is possible — every path re-validates
the pairing before commit.

## 18. Purchase Date chronology rule

`corrected_purchase_date` is rejected if it is in the future
(`datetime.combine(value, time.min).replace(tzinfo=timezone.utc) > now`) or
if it is later than the asset's earliest recorded `asset_event.event_date`
(queried via `select(AssetEvent).where(AssetEvent.asset_id == asset.id)
.order_by(AssetEvent.event_date.asc(), AssetEvent.id.asc()).limit(1)`).
This mirrors `apply_event`'s own two pre-existing rules (§9), applied in
the historical direction: a corrected purchase date must still precede
every event the asset has actually gone through. No historical
`asset_event` row is ever rewritten, and no new `asset_event` row is
inserted by a correction — only `asset.purchase_date` itself changes.
Verified live in the browser (§34): correcting Purchase Date from
`2025-06-01` to `2025-05-28` (still earlier than the asset's one recorded
`Procured` event, which itself uses the asset's purchase date as its
initial `event_date`) succeeded and left the History tab's event count and
displayed timestamp completely unchanged.

## 19. Lifecycle-history preservation

`correct_asset` never calls `apply_event`, never inserts into
`asset_event`, and never assigns `asset.status`/`asset.current_holder_id`/
`asset.status_since` — the three fields `apply_event` is the sole writer
of, per the project's second guardrail. This was confirmed by code
inspection (no import of `app.lifecycle.service` in
`app/assets/correction_service.py`) and confirmed live: the UAT asset's
History tab showed exactly one "Procured into IT Stock - UAT" event with
an unchanged timestamp both before and after two separate live corrections
(one changing only Category, one changing Sub-Category and Purchase Date
together).

## 20. Field-change audit integration

Corrections are recorded in the existing `asset_field_change` table via a
new `record_correction_changes` function, deliberately kept separate from
the existing `record_field_changes` (used by ordinary `PUT` edits) via a
dedicated `CORRECTION_FIELDS = ("category_id", "subcategory_id",
"purchase_date")` tuple — distinct from the existing
`AUDITED_SCALAR_FIELDS` tuple used by ordinary edits, so the two field sets
can never accidentally overlap or cross-contaminate each other's audit
rows. This was the authorization's explicitly preferred architecture (reuse
`asset_field_change` rather than build a third audit system), confirmed
appropriate because a correction is, at its core, a controlled change to
asset master data — the same *kind* of fact `asset_field_change` already
exists to record — not a lifecycle movement, so it was never considered
for `asset_event` (which remains lifecycle-only, unchanged).

## 21. Audit reason/context implementation

`asset_field_change.reason` (new, nullable `VARCHAR(500)` column, migration
`f28b6a913dce`) is the field that carries the correction's mandatory reason
into the audit row. `reason IS NOT NULL` is the sole discriminator between
a correction row and an ordinary Edit-mode row — deliberately, no separate
`change_type`/`row_type` column was added, keeping the migration minimal
and the discriminator self-evidently correct (an ordinary edit's
`record_field_changes` call never passes a `reason`, so its rows are always
`NULL` there). All rows written by one correction request share a single
`request_id` (a UUID generated once per `correct_asset` call), the same
correlation-id pattern `record_field_changes` already used for ordinary
edits — so a correction touching two or three fields at once is visibly
one event in the Changes tab, not several unrelated-looking rows.

## 22. Human-readable old/new values

For `category_id`/`subcategory_id`, two new helpers
(`_describe_category`/`_describe_subcategory` in `app/assets/
audit_service.py`) render `"{code} - {name} (#{id})"` — matching the
existing `_describe_vendor` pattern already used for ordinary edits — so
the audit row is legible even if the category/subcategory is later
renamed or deactivated (`"unknown category (#{id})"` is the explicit
fallback if a referenced id can no longer be resolved at all, e.g. a hard
delete — which this project's guardrails forbid, but the fallback exists
defensively regardless). `purchase_date` is stored as its normalized ISO
date string (`YYYY-MM-DD`) via the existing generic `_serialize` helper,
not a locale-dependent format. Verified live: the Changes tab showed
`"AM4CAT - AM04 Test Category (#11) → E2Emue2zivu - E2E IT 1790166623322
(#1)"` for the category correction and `"2025-06-01 → 2025-05-28"` for the
Purchase Date correction — never a bare id-to-id diff.

## 23. Database migration

One small, additive migration was required and applied:
`backend/app/alembic/versions/f28b6a913dce_asset_field_change_correction_
reason.py` (`down_revision = '370399c6380e'`), adding a single nullable
`reason VARCHAR(500)` column to `asset_field_change`. Written directly via
the Write tool (the project's documented workaround for the container not
live-mounting source — `alembic revision` run inside the container does
not persist the generated file to the host). No other schema change was
needed — every other AM-07 requirement (Asset Code protection, chronology
enforcement, category/subcategory validation) is enforced entirely in the
service layer against existing structures. Applied and verified on both
the `ckam_test` database (via the full backend suite, 288/288 passing) and
the live `ckam` database (verified via a direct schema query confirming the
column exists with the correct nullable `VARCHAR(500)` type, followed by
the two live correction transactions performed during browser UAT, §34).
No downgrade was exercised against production data (the column is
purely additive and nullable, so a downgrade — dropping the column — was
assessed as safe but not actually run against the live database, since no
rollback was needed).

## 24. Trigger preservation

`trg_asset_no_identity_change`, `trg_asset_event_no_update`,
`trg_asset_event_no_delete`, `trg_asset_field_change_no_update`, and
`trg_asset_field_change_no_delete` were all left completely unmodified.
The new `reason` column on `asset_field_change` is covered by the existing
append-only UPDATE/DELETE triggers automatically (they guard the whole row,
not a fixed column list) — confirmed by the existing
`test_field_change_append_only_protection_still_holds` test (extended in
AM-07 to also attempt a raw-SQL `UPDATE` against a correction row
specifically, still correctly raising `IntegrityError`/trigger exception).
No generic `UPDATE`/`INSERT` statement gained any new permission to mutate
a protected identity field — the correction service assigns
`category_id`/`subcategory_id`/`purchase_date` directly via the ORM inside
a normal, trigger-checked `UPDATE` on `asset`, which
`trg_asset_no_identity_change` still runs against on every write, just as
it always has (it simply never included these three columns in its
protected set).

## 25. Asset 360 correction UX

A new "Correct Classification" `Button` (`variant="outline"`, `size="sm"`)
appears in `PageHeader`'s actions, immediately next to the existing "Edit"
button, inside the same `canEdit && !editing` conditional (ADMIN/IT_TEAM
only — the same role check Edit mode already uses). Clicking it opens a
`Dialog` (`Correct Classification / Purchase Date`) showing, in order: an
Asset Code block (`bg-muted` panel) with "Asset Code will not change."; a
Category `Select` (current category preselected); a Sub-Category `Select`
whose option list is filtered to the *currently selected* Category (reacts
live as Category changes, clearing a now-invalid selection); a Purchase
Date `Input type="date"` (current value preselected); a conditionally
rendered "Impact Summary" panel (only once at least one field actually
differs from its current value) listing each changed field as `old → new`
plus `Asset Code: {code} — unchanged`; a required `Textarea` for Reason;
and a `DialogFooter` with Cancel and an `AsyncButton` "Confirm Correction",
disabled unless both a real change exists and Reason is non-blank. All of
this was verified live in the browser, not merely by component tests —
see §34.

## 26. Generic Edit separation

Verified twice: once by reading `AssetDetail.tsx`'s existing Edit-mode form
(no Category/Sub-Category/Purchase Date field ever rendered there, before
or after AM-07), and once live in the browser — opening Edit mode on the
same corrected UAT asset and confirming, via both a screenshot and a full
`get_page_text` dump of the Edit form, that Description, Brand, Model,
Serial Number, Legacy Asset Code, Vendor, Warranty Upto, PO/Invoice/PI
Number+Date, Purchase Cost, and Tax % are present — and Category,
Sub-Category, and Purchase Date are not, anywhere in the form. `PUT
/api/assets/{id}`'s `AssetUpdateIn` schema itself was not modified at all
in AM-07 (confirmed by `git diff` on `app/assets/schemas.py` showing only
the new `AssetCorrectionIn` class added, `AssetUpdateIn` untouched), and a
dedicated regression test (§29) asserts a normal PUT payload including
these three fields does not move them.

## 27. Export behavior

Asset Register export (`GET /api/reports/export/assets`) reads the asset's
*current* `category_id`/`subcategory_id`/`purchase_date` at export time, no
different from any other asset field — a correction is simply a write to
those columns like any other, so the export automatically reflects
corrected values with zero export-code changes needed (confirmed by
inspecting `app/reports/export_service.py::assets_to_xlsx`, which was not
touched in AM-07 at all). The Field Change Audit export (`GET
/api/reports/export/field-changes`) reads `asset_field_change` rows
directly, including the new `reason` column — confirmed by inspecting
`field_changes_to_xlsx`, which iterates every column already present on
the model and therefore picks up `reason` automatically once the migration
lands, again with zero export-code changes needed. Movement Log export
(`asset_event`-sourced) is completely unaffected, since corrections never
write to `asset_event`. No export code file was modified in AM-07 — this
was a deliberate finding, not an oversight: both exports already generically
reflect whatever is in their source tables/columns.

## 28. Import behavior

Import (`commit_import`) continues to create assets with their initial
`category_id`/`subcategory_id`/`purchase_date` values exactly as before —
`app/imports/asset_import_service.py` was not touched in AM-07 at all
(confirmed via `git diff` — zero changes to this file across all three
AM-07 commits). The correction API is never called from the import path,
and there is no "update existing asset" spreadsheet behavior — a
duplicate/re-imported row still creates a new asset via the same
`procure_assets`-backed path it always has, unrelated to corrections. This
matches the authorization's explicit §23 instruction exactly.

## 29. Exact files changed

**Backend (commit `767609d`):**
- `backend/app/alembic/versions/f28b6a913dce_asset_field_change_correction_reason.py` (new)
- `backend/app/assets/models.py` (added `AssetFieldChange.reason`)
- `backend/app/assets/audit_service.py` (added `_describe_category`,
  `_describe_subcategory`, `CORRECTION_FIELDS`,
  `record_correction_changes`)
- `backend/app/assets/correction_service.py` (new — `UNSET`,
  `REASON_MAX_LENGTH`, `correct_asset`)
- `backend/app/assets/schemas.py` (added `AssetFieldChangeOut.reason`,
  `AssetCorrectionIn`)
- `backend/app/assets/router.py` (new `POST /{asset_id}/corrections`
  endpoint)
- `backend/tests/assets/test_am07_asset_correction.py` (new, 30 tests)

**Frontend (commit `73b1842`):**
- `frontend/src/features/assets/AssetDetail.tsx` (added `FieldChange.reason`,
  `MasterOption` interface, "Type"/"Reason" Changes-tab columns, correction
  dialog state/queries/handlers, "Correct Classification" button, the new
  `Dialog` block)
- `frontend/src/features/assets/AssetDetail.test.tsx` (extended fixtures,
  new `describe("AssetDetail -- AM-07 asset correction", ...)` block, 10
  tests)

**E2E (commit `9a5e7fc`):**
- `frontend/e2e/asset-correction.spec.ts` (new, 1 spec)

**Governance (this commit):**
- `docs/ai/DECISIONS.md`, `docs/ai/REVIEW_FINDINGS.md`,
  `docs/ai/UAT_MATRIX.md`, `docs/ai/CURRENT_STAGE.md`,
  `docs/ai/DESIGN_SYSTEM.md`,
  `docs/ai/AM-07_ASSET_CORRECTION_WORKFLOW_REPORT.md` (this file)

No other file was touched in AM-07 — in particular, `app/assets/service.py`
(`procure_assets`), `app/imports/asset_import_service.py`,
`app/reports/export_service.py`, `app/lifecycle/service.py`,
`app/numbering/service.py`, and every migration prior to `f28b6a913dce`
are byte-for-byte unchanged (confirmed via `git diff 73719dd..9a5e7fc --
<path>` on each, empty output).

## 30. Backend tests

288/288 passing (258 baseline + 30 new, independently re-run against
`ckam_test` this session — not assumed from an earlier run). New tests in
`test_am07_asset_correction.py`, across 7 classes:
`TestAuthorization` (5: ADMIN may correct, IT_TEAM may correct in-scope,
VIEWER denied, HOLDER denied, cross-company IT_TEAM denied);
`TestCategoryCorrection` (3: valid correction, inactive rejected, invalid
rejected — Asset Code/lifecycle/holder all confirmed unchanged in the same
tests); `TestSubcategoryCorrection` (7: valid same-category, wrong-category
rejected, clear-if-optional, category-change-with-valid-replacement,
category-change-with-invalid-old-subcategory-cannot-leave-invalid-pair,
plus 2 more edge cases); `TestPurchaseDateCorrection` (4: valid, chronology
enforced, future/after-earliest-event rejected, Asset Code/no historical
event timestamps changed); `TestRequestValidation` (4: reason required,
whitespace-only rejected, no-op rejected, at-least-one-changed-field
required); `TestAudit` (5: one entry per actual changed field, correct
old/new values, human-readable category/subcategory context, actor and
reason captured, and a raw-SQL append-only-trigger re-confirmation test);
`TestRegression` (2: normal PUT still cannot modify these 3 fields, normal
Add Asset/lifecycle/numbering/company-cost-centre-integrity unchanged).

## 31. Frontend tests

143/143 passing (25 files; 133 baseline + 10 new, independently re-run this
session), `npx tsc -b` clean. New tests in `AssetDetail.test.tsx`'s
`"AssetDetail -- AM-07 asset correction"` block: correction-action role
visibility (ADMIN sees it, VIEWER does not), dialog opens with current
values prefilled (Category/Sub-Category `Select` text, wrapped in
`waitFor` since the categories/subcategories queries resolve
asynchronously), Asset Code shown read-only, ordinary Edit mode confirmed
to never show Category/Sub-Category/Purchase Date controls, Category
change updates Sub-Category options and clears an invalid old selection,
Confirm Correction stays disabled until both a real change and a non-blank
reason are present, Impact Summary text is accurate, successful submission
sends only the changed fields in the POST body (explicitly asserts
`purchase_date` is not a key in the payload when untouched) and refreshes
Asset 360, a server validation error is shown inside the dialog without
closing it, and the Changes tab shows a "Correction" pill + reason distinct
from a plain "Edit" row.

## 32. Typecheck

`npx tsc -b` — clean, zero errors, independently re-run this session.

## 33. E2E

4/4 passing (3 baseline + 1 new), independently re-run this session via
`npx playwright test`:
- `asset-correction.spec.ts` — new (§7 of the authorization's E2E
  requirement): seeds a company, creates a second Category/Subcategory to
  correct into, creates one asset via a direct API call, logs in as the
  seeded admin through the real browser, opens Asset 360, confirms History
  shows exactly 1 event, opens "Correct Classification", verifies Asset
  Code + "will not change" text, corrects Category, Sub-Category, and
  Purchase Date together in one request, verifies the Impact Summary text
  for both Category and Purchase Date, confirms, verifies the dialog
  closes and the Asset Code heading is unchanged, verifies Overview shows
  the new Category/Sub-Category names, verifies Procurement shows the new
  Purchase Date, verifies the Changes tab shows "Correction" + the reason +
  all three field names, and verifies History still shows exactly 1 event
  with unchanged text. Passed on first run, and again on this session's
  independent re-run.
- `asset-lifecycle.spec.ts`, `import.spec.ts`, `multi-company-udf.spec.ts`
  — all three pre-existing specs untouched and still green.

## 34. Browser UAT

Performed live, in the built-in browser, against a freshly created safe
UAT asset (never a genuine business asset), logged in as `UATADMIN`
(ADMIN, company "Citykart Stores"). Because this company had zero holders
of a type eligible for "Goes Into" and zero cost centres of its own (a
pre-existing environment gap, not an AM-07 defect), a safe UAT holder
(`STK-UAT07`, IT_STOCK type) and a safe UAT cost centre (`CC-UAT`) were
created first, purely to unblock asset creation — both company-scoped to
Citykart Stores, neither touching any genuine business record. Asset
`AM04UAT/2` ("AM07 UAT Correction Test Laptop") was then created via the
real Add Asset form.

On its Asset 360 page:
- Confirmed "Correct Classification" button visible next to Edit for
  ADMIN.
- Opened the dialog: confirmed Asset Code shown read-only with "Asset Code
  will not change.", Category/Sub-Category/Purchase Date all prefilled
  with the asset's actual current values.
- **Correction 1**: changed Category only (`AM04 Test Category` →
  `E2E IT 1790166623322`). Impact Summary correctly showed `Category: AM04
  Test Category → E2E IT 1790166623322` and `Asset Code: AM04UAT/2 —
  unchanged`. Confirm Correction was disabled until Reason was filled, then
  enabled. Submitted — `POST /api/assets/34/corrections` returned `200`.
  Dialog closed; Overview tab immediately showed the new Category.
- **Correction 2**: reopened the dialog, confirmed it now prefilled with
  the *already-corrected* Category, and that Sub-Category's option list
  was correctly filtered to only the subcategory belonging to that new
  Category (`E2E Laptop 1790166623322` — the one and only valid option
  shown). Selected it, and changed Purchase Date from `2025-06-01` to
  `2025-05-28`. Impact Summary correctly showed both changes plus the
  unchanged Asset Code line. Submitted — `200`. Overview immediately showed
  the new Sub-Category; Procurement tab immediately showed the new
  Purchase Date (`2025-05-28`).
- **Changes tab**: showed all three correction rows (`category_id`,
  `subcategory_id`, `purchase_date`), each tagged with a distinct blue
  "Correction" pill (vs. plain text for an ordinary edit), each with its
  own reason, actor ("UAT Admin"), and timestamp, and human-readable
  old/new values (e.g. `"AM4CAT - AM04 Test Category (#11) → E2Emue2zivu -
  E2E IT 1790166623322 (#1)"`) — never a bare id diff.
- **History tab**: confirmed exactly 1 event ("Procured into IT Stock -
  UAT", `6/1/2025, 5:30:00 AM`) both before and after both corrections —
  byte-identical text, same original timestamp, confirming the Purchase
  Date correction did not retroactively alter or duplicate any lifecycle
  event.
- **Ordinary Edit mode**: opened separately, confirmed via a full
  `get_page_text` dump that Category/Sub-Category/Purchase Date are absent
  from the form entirely.

## 35. Responsive UAT

The correction dialog was checked at all four required breakpoints:
- **1440×900**: clean, no overflow, all fields comfortably laid out.
- **1024×768**: clean, no overflow.
- **768×1024**: clean, dialog well-centered, no overflow.
- **375×812**: dialog renders as a full-width stacked sheet (Confirm
  Correction and Cancel both full-width, Confirm above Cancel for
  thumb-friendly primary-action placement), Reason textarea and all
  `Select` controls remain fully usable, no horizontal page overflow.

`/reports` (§38) and `/change-password` (§39) were also checked at
1440/768/375 — see those sections. `SidebarInset`'s `min-w-0` (the AM-04
fix) was not touched and was not observed to regress at any breakpoint
checked this session.

## 36. Accessibility

"Correct Classification" is a real `<button>` element (confirmed via the
accessibility tree, not a styled `<div>`), reachable and clickable via the
normal focus order. Opening the dialog moves focus to its first focusable
control (the Category `Select`), confirmed via `document.activeElement`
immediately after open — standard accessible-dialog behavior. Every field
has an associated `label` (confirmed via the accessibility tree's
`label "Category"` / `label "Sub-Category"` / `label "Purchase Date"` /
`label "Reason"` entries, each paired with its control). The Reason
`Textarea` carries `required` semantics reflected in the disabled state of
Confirm Correction (not merely a color cue) and the visible helper text
"Required. Explain why this correction is needed." Confirm Correction is
explicitly labeled "Confirm Correction" (not a generic "Save"/"OK"),
satisfying the "clearly named" requirement. The Impact Summary is rendered
as readable text lines (`Field: old → new`), not conveyed by color alone.
Escape-key dismissal was exercised; the dialog closed correctly in the
browser (confirmed visually and via `get_page_text` showing the underlying
Overview page), though a stale/lingering `role="dialog"` DOM node was
observed via direct JS query immediately afterward — assessed as the same
documented Radix-style unmount-after-transition behavior noted for other
dropdowns throughout this session (§ Deviations, below), not a functional
accessibility defect, since the page's actual rendered state and all
subsequent interactions were correct.

## 37. Security verification

Server-side enforcement (not frontend-only) confirmed for: asset scope
(`_get_scoped_asset`, same helper as `update_asset`), company scope
(`scoped_company_ids`, IT_TEAM correctly denied cross-company in a
dedicated test using IT_TEAM rather than ADMIN, avoiding the
"ADMIN-proves-nothing" trap), role (`require_role("ADMIN", "IT_TEAM")`,
VIEWER/HOLDER both denied by dedicated tests), master validity (inactive
category/subcategory rejected), relationship validity (mismatched
category/subcategory pair rejected in both directions, §17). No mass
assignment is possible: `AssetCorrectionIn` only accepts
`category_id`/`subcategory_id`/`purchase_date`/`reason` — no other `Asset`
field can be set through this endpoint, and Pydantic rejects unknown extra
fields by the project's existing global model configuration (unchanged in
AM-07). A generic `PUT /api/assets/{id}` cannot be used to bypass
correction validation — confirmed by the regression test showing `PUT`
still cannot move these three fields at all, let alone bypass their
validation rules. No unrestricted/generic "correction object" is exposed —
the schema is a closed, purpose-built shape.

## 38. Reports responsive verification

Per the authorization's §41 (an AM-06-deferred cleanup, verification only):
`/reports` was checked at 1440, 768, and 375px. At every width,
`document.body.scrollWidth === window.innerWidth` (no horizontal overflow),
confirmed via direct JS evaluation rather than trusting a screenshot alone.
At 375px specifically, the Asset Register/Movement Log/Field Change Audit
cards stack vertically and their download buttons render full-width — no
clipped content, no design defect found. `UAT_MATRIX.md`'s `/reports` row
Responsive column is now ✅ with this evidence; no redesign was performed
(none was needed).

## 39. Change Password verification

Per the authorization's §42 (an AM-06-deferred cleanup, verification only):
`/change-password` was checked at 1440, 768, and 375px — no horizontal
overflow at any width (confirmed via `document.body.scrollWidth`). All
three password fields and the submit button are keyboard-focusable
(confirmed via direct `.focus()` + `document.activeElement` check).
Submitting the form with all three fields blank produced no network
request at all (confirmed via the network log) — client-side validation
correctly blocks an empty submission before any request reaches the
server. The route itself requires an authenticated session (unchanged,
backend-regression-only — no new endpoint or authorization surface was
introduced by AM-07). `UAT_MATRIX.md`'s `/change-password` row Security and
Responsive columns are now ✅ with this evidence; no redesign was performed
(none was needed, and none was found to be warranted).

## 40. Remaining setup-route spot checks

Per the authorization's §43 (evidence-completion only, no redesign unless a
genuine bug is found): `/setup/locations`, `/setup/departments`,
`/setup/cost-centers`, `/setup/categories`, and `/setup/subcategories` were
each opened live this session. Locations: list renders correctly, Edit
dialog opens with Code shown read-only ("Not editable after creation.") and
Name editable. Departments: list renders correctly. Cost Centers: opened
and actively used (a real safe UAT cost centre was created through it,
§34). Categories: opened and actively used (the Category selector was
exercised repeatedly during correction-flow UAT). Subcategories: list
renders correctly, category relationship is correctly immutable — but a
genuine, pre-existing cosmetic bug was found here (§47) and documented, not
fixed, since it's outside AM-07's scope (a Sub-Categories master-screen
display bug, not a correction-workflow concern).

## 41. UAT_MATRIX updates

Updated: added the AM-07 summary paragraph; `/assets/$id` row extended with
the full correction-flow UAT evidence (§34-36); `/reports` Responsive
column ✅ (§38); `/change-password` Security and Responsive columns both ✅
(§39); all 5 remaining `MasterCrudScreen` rows' Design column upgraded from
🟡 to ✅ with fresh live-verification notes (§40); `/setup/holders` row
extended with the Add User UAT and the `location_id=0` bug found (§47);
E2E/Backend/Frontend summary counts updated to 4/4, 288/288, 143/143.

## 42. REVIEW_FINDINGS updates

Item 3 ("`category_id`/`subcategory_id`/`purchase_date` have no edit path")
was **removed** from the open Technical findings and moved to "Resolved
this session," replaced with a summary pointing at `DECISIONS.md`'s new
AM-07 section for the full rule set. The `holder_company_access`,
5-closed-value-DB-constraint, and import-duplicate-detection findings were
**not** removed (they remain genuinely open and out of AM-07's authorized
scope, per §38-40 of the authorization) — only their "still open as of"
stage references were advanced to AM-07. Two new findings were added,
matching the two bugs discovered live during this stage's own UAT: the
Add Asset Cost Centre/Category company-scoping gap, and the Add Holder
`location_id=0` bug. A third new finding (the Edit Subcategory raw-id
display bug from §40) was also added.

## 43. DECISIONS updates

A new, dated top section ("2026-09-24 — AM-07 scope locked...") was added
with 11 numbered durable decisions: correction-vs-edit separation, Asset
Code immutability by construction, the correction endpoint's exact shape,
the category/subcategory relationship rule, the trigger investigation's
conclusion (no change needed), the Purchase Date chronology rule, the
audit-architecture choice (reuse `asset_field_change`, no third system),
the human-readable snapshot format, the Asset 360 UX shape, no-bulk-
correction, and the Changes-tab distinct-rendering rule. See §12-26 above
for the full reasoning behind each.

## 44. CURRENT_STAGE updates

Stage line advanced to "AM-07 ... complete, PASS," Next line advanced to
"awaiting explicit go-ahead on AM-08." A new "What's actually done as of
AM-07" section was added (mirroring the existing per-stage sections for
AM-01 through AM-06), and the "Deferred, awaiting your decision" list was
updated: item 2 (the correction-workflow gap) was removed since it's now
resolved, item 4 (no bulk correction) and item 5 (the two out-of-scope UI
bugs found this session) were added.

## 45. DESIGN_SYSTEM update

A new "Sensitive-field correction pattern (AM-07)" section was added,
documenting the reusable shape the Asset 360 correction dialog establishes
(separate action button, immutable-identity-first layout, live-reacting
dependent fields, the Impact Summary block, the mandatory-reason +
real-change gate on the confirm control, and the Changes-tab distinct-
rendering convention) for any future correction workflow to follow. The
"Known gaps" section was also updated to list the three UI bugs found this
session (previously empty as of AM-06).

## 46. Deviations from authorized scope

None. Every implementation decision traces to an explicit authorization
section (§6-51 of the AM-07 authorization). The only judgment calls made
were the ones the authorization explicitly delegated to evidence-gathering
(§10's Purchase Date invariant, determined reliably from existing code
rather than triggering the fallback STOP condition; §24's trigger
investigation, concluding no change needed rather than guessing).
Additionally, two small, safe, reversible pieces of test-environment setup
(one Cost Centre, one IT_STOCK Holder, both scoped to `UATADMIN`'s own
company "Citykart Stores") were created purely to unblock the mandatory
live browser UAT, since that company had zero eligible holders/cost
centres to create an asset against — this is environment preparation, not
a scope change, and touches no genuine business data.

## 47. Issues discovered but not changed

1. **Add Asset's Cost Centre/Category `Select` controls are not
   company-scoped** — list every company's rows, not just the current
   user's; a mismatched selection is still correctly rejected server-side
   (`422`), so there is no security impact, only a UX/discoverability gap.
   Out of AM-07 scope (an Add Asset/master-list frontend-filtering
   concern, not a correction-workflow concern).
2. **Add Holder sends `location_id=0` instead of omitting a blank
   Location**, causing an unhandled `500`
   (`ForeignKeyViolationError`) instead of creating the holder with no
   location. Worked around during UAT by always selecting a Location. Out
   of AM-07 scope (a Holders & Users form bug).
3. **Edit Subcategory's dialog shows the parent Category as a raw numeric
   id** instead of its name/code. Cosmetic only — the category
   relationship itself is correctly enforced and immutable. Out of AM-07
   scope (a Sub-Categories master-screen display bug).

All three are documented in `REVIEW_FINDINGS.md` for a future stage to
pick up; none were fixed in AM-07, consistent with the authorization's
tight scope discipline.

## 48. Remaining risks

- The three bugs in §47 remain live in the running application until a
  future stage fixes them. None are security-relevant (backend validation
  independently catches the consequences of #1; #2 and #3 are usability/
  cosmetic only).
- `holder_company_access`, the 5 unconstrained closed-value columns, and
  import-side duplicate detection remain open, unchanged, exactly as
  documented since earlier stages — no new risk introduced or resolved by
  AM-07 in these areas.
- No bulk correction exists — an organization needing to correct many
  assets at once must still do so one at a time through Asset 360, exactly
  as the authorization intended for V1.
- The correction endpoint's Purchase Date invariant is anchored to the
  asset's *earliest* recorded event; an asset with zero recorded events
  (should be structurally impossible, since `procure_assets` always writes
  an initial event) has no explicit test — considered acceptable since the
  invariant that guarantees at least one event always exists was not
  touched by AM-07 and is enforced elsewhere in the codebase.

## 49. Recommended AM-08

In rough priority order: (1) a decision on `holder_company_access` (needed
vs. dormant) — the same standing recommendation as AM-06, still unresolved;
(2) the two functional (not cosmetic) UI bugs found this session — Add
Asset's cost-centre/category company-scoping gap and Add Holder's
`location_id=0` crash — are both small, well-understood, and worth fixing
as a short, focused stage before they surprise a real user; (3) if
CityKart's real import data shows genuine duplicate rows in practice,
revisit import-side duplicate detection with an actual business rule in
hand, not a guessed one.

## 50. REPORT CONTENT HEAD

`9a5e7fc` (the last commit before this report/governance commit —
`test(e2e): AM-07 -- asset correction journey (Category/Subcategory/
Purchase Date)`).

## 51. REPORT COMMIT

TO BE FILLED IN CHAT AFTER COMMIT.

## 52. Final verdict

**PASS.** All items in the AM-07 completion gate are satisfied: git
baseline verified against the AM-06 report's stated head; invariants
audited from actual code before any implementation began; category and
subcategory correction implemented safely with the relationship rule
enforced in both directions; the Purchase Date chronology rule was
established from evidence (existing `apply_event` rules), not invented,
and implemented (not blocked); Asset Code is unchanged by construction
(the correction service cannot reach the numbering service), `code_counter`
unaffected, lifecycle state and every historical `asset_event` row
unchanged (proven live, twice); reason is mandatory and enforced
server-side; role and company scoping are enforced server-side using the
same helper as ordinary edits; the correction and its audit rows commit in
one transaction (a validation failure rolls back cleanly, confirmed by
existing transaction-boundary tests); audit entries carry historically-
understandable old/new values; a generic `PUT` still cannot move these
three fields (regression-tested); Asset 360's dedicated correction UX
works end-to-end, live, twice; ordinary Edit mode remains completely
separate, confirmed live; exports reflect corrected current values and the
field-change-audit export reflects the correction's reason, both with zero
export-code changes needed; Import is unchanged; all 288 backend + 143
frontend tests pass, typecheck is clean, all 4 E2E specs pass; browser,
responsive, accessibility, and security verification are all complete;
the `/reports` Responsive and `/change-password` Security/Responsive
evidence gaps carried from AM-06 are now closed; the remaining setup-route
spot-checks are complete; governance docs are updated; this report exists
and will be delivered as a downloadable file; no push was performed; AM-08
was not started.
