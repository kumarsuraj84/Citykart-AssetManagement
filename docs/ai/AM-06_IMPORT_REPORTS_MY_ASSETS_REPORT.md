# AM-06 — Import + Export/Reports + My Assets — Report

## 1. Executive summary

AM-06 closed the last major gap between manual Add Asset and bulk
Import/Export: both now speak the same V1 asset data model, including
every procurement field, Quantity multi-create, and company-scoped Custom
Fields. Export gained the same field set plus a new, separate field-
change-audit report. Import, Reports, and My Assets — the last three
screens outside the shared UI foundation — all moved onto it. No database
migration was needed. Verdict: **PASS**.

## 2. Git preflight

Before any change: verified absolute repo path
(`D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build`),
branch (`worktree-ckam-build`), current `HEAD` (`0548789c85063a5a0a6f01e8
4dc399e3d349d159`), `git status` (clean), `git log --oneline -15`, `git log
ababf5e..HEAD` (showed only the AM-05 report/governance commit `0548789`,
confirming no unrelated commits landed after AM-05's E2E commit), and
configured remotes (`origin` only, matching `CLAUDE.md`). All matched the
AM-05 report's stated Backend (`5ae800e`)/Frontend (`9ce9239`)/E2E
(`ababf5e`) commits exactly. No STOP condition was triggered.

## 3. Starting AM-06 HEAD

`0548789c85063a5a0a6f01e84dc399e3d349d159` (the AM-05 report/governance
commit).

## 4. Starting database state

Verified independently (not assumed from the AM-05 report): `alembic
heads` → `370399c6380e (head)`; `ckam_test` current → `370399c6380e
(head)`; live `ckam` current → `370399c6380e (head)`. Matched the expected
baseline exactly.

## 5. Starting test baseline

Verified independently: full backend suite → 231/231 passing; `npx tsc -b`
→ clean; full frontend unit suite → 121/121 passing; full E2E suite →
2/2 passing. All matched the expected baseline exactly.

## 6. Import before-state architecture

Read in full before any change: `backend/app/imports/
asset_import_service.py`, `router.py`, `schemas.py`, and
`frontend/src/features/imports/ImportScreen.tsx`. Findings:

- Template was a fixed 8-column workbook (`legacy_asset_code`,
  `company_code`, `cost_center_code`, `category_code`, `subcategory_code`,
  `description`, `purchase_date`, `holder_emp_code`), parsed
  **positionally** (`legacy_code, company_code, cc_code, cat_code, sub_code,
  description, purchase_date, holder_code = row`) — no procurement field, no
  Custom Field, no Quantity.
- Master lookups were already by business code (`Company.code`,
  `CostCenter.code` scoped to the row's resolved company,
  `AssetCategory.code`, `AssetSubcategory.code` scoped to the row's
  resolved category, `Holder.emp_code` scoped to the row's resolved
  company) — this part needed no change.
- `preview_import`'s `valid_rows` entries only ever carried
  `row`/`legacy_asset_code`/`description` — no company/holder/quantity
  context for the user to verify before committing.
- `commit_import` already used the exact numbering path Add Asset uses
  (`build_code_tokens`/`generate_code`/`get_active_rule` from
  `app.numbering.service`) and already wrapped each row in its own
  `session.begin_nested()` savepoint.
- The frontend used only shadcn `Card`/`Table` primitives — no
  `PageHeader`, no `DataTable`, no `AsyncButton`.

## 7. Import field matrix

| Business Field | Pre-AM-06 Template | Pre-AM-06 Parser | Pre-AM-06 Preview | Pre-AM-06 Commit | AM-06 Target |
|---|---|---|---|---|---|
| Company | `company_code` | positional, by code | not shown | writes `company_id` | `Company Code`, by-name lookup |
| Cost Centre | `cost_center_code` | positional, scoped by company | not shown | writes `cost_center_id` | `Cost Centre Code`, unchanged scoping |
| Category | `category_code` | positional, by code | not shown | writes `category_id` | `Category Code`, unchanged |
| Subcategory | `subcategory_code` | positional, required | not shown | writes `subcategory_id` | `Subcategory Code`, now **optional** |
| Description | `description` | positional, required | shown | writes `description` | unchanged, required |
| Purchase Date | `purchase_date` | positional, required | not shown | writes `purchase_date` | `Purchase Date`, unchanged, required |
| Initial Holder | `holder_emp_code` | positional, scoped by company | not shown | writes `current_holder_id` | `Initial Holder Code`, unchanged |
| Quantity | absent | absent (always 1) | absent | always 1 asset/row | new, optional, default 1, multi-create |
| Vendor | absent | absent | absent | absent | `Vendor Code`, optional |
| PO Number/Date | absent | absent | absent | absent | `PO Number`/`PO Date`, optional |
| Invoice Number/Date | absent | absent | absent | absent | `Invoice Number`/`Invoice Date`, optional |
| PI Number/Date | absent | absent | absent | absent | `PI Number`/`PI Date`, optional |
| Purchase Cost/Tax % | absent | absent | absent | absent | optional, default 0 |
| Brand/Model/Serial | absent | absent | absent | absent | optional |
| Warranty Upto | absent | absent | absent | absent | optional |
| Legacy Asset Code | `legacy_asset_code` | positional, optional | shown | writes `legacy_asset_code` | `Legacy Asset Code`, unchanged |
| Custom Fields | absent | absent | absent | absent | new, `Custom:<field_key>` columns |

## 8. Existing import transaction semantics

Documented, then preserved exactly: **VALID-ROWS-ONLY per row**, confirmed
by reading `commit_import`'s `async with session.begin_nested():` wrapping
each row's insert + `apply_event` call, with `except (LifecycleError,
ValueError)` catching a row-level failure into `errors` without aborting
sibling rows. The **one exception, also preserved**: a company-scope
violation anywhere in the file (`ImportScopeError`) refuses the entire
file with 403 before any row is even attempted, since it's an
authorization boundary, not a data-quality one. AM-06 extends this
unchanged model for Quantity: every unit of one row's Quantity shares that
row's single savepoint, so a mid-row failure discards every unit the row
would have created, never a partial batch — documented and tested (see
§35's `test_a_quantity_rows_lifecycle_failure_rolls_back_every_unit_of_
that_row`).

A note on §17's investigation: the AM-02 report's §13 claimed "duplicate
handling" was already covered by the existing test suite. Reading the
actual code and tests found **no duplicate-detection logic anywhere** and
no test exercising it — this claim did not match reality. AM-06 does not
add duplicate detection (§14 of the authorization explicitly forbids
inventing a uniqueness rule without business evidence), but the
discrepancy is now documented in `REVIEW_FINDINGS.md` and `DECISIONS.md`
rather than left to recur.

## 9. Final template contract

See `DECISIONS.md`'s AM-06 entry #1 for the full column table
(`backend/app/imports/asset_import_service.py::TEMPLATE_COLUMNS`).
Headers are human-readable business names, resolved by name from the
workbook's own header row (`_read_header`), never positionally — so
column order in an uploaded file never matters, and a genuinely missing
*required* column produces one file-level error
(`ImportTemplateError`, mapped to a 422 naming the missing column(s))
rather than nonsense per-row noise.

## 10. Procurement import support

Every field `procure_assets` (manual Add Asset) writes is now also
writable via Import: `vendor_id` (by `Vendor.code`), `po_number`/`po_date`,
`invoice_number`/`invoice_date`, `pi_number`/`pi_date`, `purchase_cost`/
`tax_percent` (tax computed via the shared `compute_tax` from
`app.assets.service` — the identical math Add Asset uses, not a
reimplementation), `brand`/`model`/`serial_number`, `warranty_upto`. All
optional, matching Add Asset's own optionality.

## 11. PI Number import behavior

`PI Number`/`PI Date` columns map directly to `Asset.pi_number`/
`pi_date`, same as every other procurement field — no special-casing
needed since PI Number was already a first-class `Asset` column since
AM-01/AM-02. Verified round-trip: imported via a fixture with `PI-COL1`,
confirmed present on the resulting `Asset` row directly, and (E2E) visible
on Asset 360's Procurement tab.

## 12. Custom Field spreadsheet convention

`Custom:<field_key>` — e.g. `Custom:warranty_card` — chosen over a
label-based alternative specifically because `field_key` is already this
codebase's stable identifier for a Custom Field everywhere else
(`Asset.custom_fields` itself is keyed by it), while a `label` can be
renamed at any time (AM-05). No prior convention existed to preserve
compatibility with. The same convention drives export column headers, so
an exported file can be edited and re-imported without semantic ambiguity
(§21 of the authorization). See `DECISIONS.md` entry #3 for the full
reasoning.

## 13. Company-scoped UDF import behavior

Reuses `app.assets.custom_field_values.{applicable_custom_fields,
validate_custom_field_values}` directly — no parallel import-only rules
engine (§10 of the authorization, followed literally). Per row: the row's
Company is resolved first (already true pre-AM-06); a `Custom:` column
whose key isn't in that company's applicable set (Global + own company,
active only) is a row error if it has a non-blank value, and silently
ignored if blank; `validate_custom_field_values(..., enforce_required=
True)` is called once per row with the row's collected custom values,
which both re-validates type correctness and enforces that every
applicable required field (Global or same-company) has a value — a
required field belonging only to a different company is never in the
applicable set at all, so it can never block. Verified by 9 of the 19 new
import tests (Global/same-company import, other-company rejected,
required-Global/required-same-company/required-other-company behavior,
type validation, unknown-key rejection, inactive-field rejection).

## 14. Master lookup behavior

Unchanged and reconfirmed: every master is resolved by its stable business
code/identifier (`Company.code`, `CostCenter.code`, `AssetCategory.code`,
`AssetSubcategory.code`, `Holder.emp_code`), never a numeric database id —
already true pre-AM-06 for the original 6 fields, extended identically to
the new `Vendor.code` lookup. A missing/inactive/wrong-company/wrong-parent
reference is always a clear row error naming the actual column and value
(e.g. `"unknown Cost Centre Code 'X'"`), never a silent guess. Two new
tests (§35) specifically prove cross-company Holder codes and a
subcategory belonging to the wrong category are both rejected.

## 15. Preview/validation architecture

Preview remains mandatory — there is no direct upload-to-commit path, the
frontend always calls `/preview` first and only enables Commit once
`valid_rows.length > 0`. `preview_import`'s response now carries richer
per-row context (`company`, `category`, `subcategory`, `description`,
`holder`, `quantity` — human-readable names, not raw ids) so the new
frontend can show a genuinely useful "ready to import" table, not just a
row number. Every error dict now optionally carries a `field` naming the
specific column at fault, shown in its own table column.

## 16. Commit/atomicity behavior

Unchanged VALID-ROWS-ONLY per-row semantics (§8 above), extended so a
Quantity>1 row's several units share one savepoint. Verified by dedicated
tests: a full row succeeds, a row with a lifecycle-rejecting date at
Quantity=3 produces zero assets and one row error (not a partial 2-of-3),
and preview alone never mutates the database (`test_preview_never_
writes_to_the_database`).

## 17. Duplicate handling

No new duplicate detection added — confirmed absent both before and after
AM-06 (§8/§14 above). A new test
(`test_two_rows_with_identical_data_both_import_unchanged_duplicate_
behavior`) locks in that two rows with an identical Legacy Asset Code and
Serial Number both import successfully as two separate assets, proving
this is deliberate current behavior, not an oversight.

## 18. Asset Code/numbering behavior

Unchanged: Import continues to call the exact same
`get_active_rule`/`build_code_tokens`/`generate_code` path Add Asset uses,
per-company-cached within a single commit call (unchanged from before
AM-06, which already fixed the "first row's company rule applied to
every row" bug). No user-entered Asset Code is ever accepted or generated
client-side. Quantity's multi-create calls `generate_code` once per unit,
same atomic UPSERT-based counter, so N units of one row get N sequential,
race-safe codes exactly like an N-quantity manual Add Asset would.

## 19. Import UI redesign

`ImportScreen` moved onto `PageHeader`/`DataTable`/`AsyncButton`/
`FormField` with an explicit 4-step hierarchy: 1. Download Template
(with an inline note explaining the `Custom:<field_key>` convention and
where to find a field's key), 2. Choose File + Preview, 3. Review (two
separate `DataTable`s — rows ready to import, rows needing attention —
rather than only ever surfacing errors), 4. Result. Every async action
(template download, preview, commit) uses `AsyncButton`'s pending state.

## 20. Import browser UAT

Logged in as the session's UAT ADMIN account; opened `/import` live —
confirmed the 2-step layout renders, the Custom Field convention note
displays correctly, Preview is disabled until a file is chosen. Clicked
Download Template live — confirmed a real 200 OK response
(`GET /api/imports/assets/template`) via the network log. The full
upload→preview→commit→Asset-360 interaction was verified end-to-end by
the new Playwright E2E spec (`e2e/import.spec.ts`), which drives a real
browser against the real backend with a real generated Excel fixture —
functionally equivalent real-browser coverage to a manual file-upload
walkthrough, and more reliable/repeatable.

## 21. Asset Register export architecture

`assets_to_xlsx` now takes `(assets, labels, custom_field_keys)` instead
of just `assets` — `labels` is a set of batch id→name maps
(`_export_label_maps`, one query per small master table, never a per-row
query even at the 50,000-row export cap) and `custom_field_keys` is the
already-computed column set (§22 below). Company/holder scoping on which
*assets* are exported is completely unchanged (`search_assets` with the
same `scoped_company_ids`/HOLDER-pinning branches as `GET /api/assets`).

## 22. Asset export column contract

New columns, human-readable throughout (never a bare FK id when a label
exists): Company, Cost Centre, Category, Subcategory, Current Holder,
Holder Type, Location, Vendor, PO Number/Date, Invoice Number/Date, PI
Number/Date, Brand, Model, Serial Number, Warranty Upto — alongside the
pre-existing Asset Code/Legacy Code/Description/Status/Purchase Date/
Purchase Cost/Tax Amount/Total Cost (Tax % also added). Verified live and
by 3 new backend tests (procurement+PI Number+labels present, Custom
Field columns present, a retired Custom Field's stored value still
exported).

## 23. Custom Field export behavior

`Custom:<field_key>` columns — the exact same header convention as
Import, so an export can be edited and re-imported without ambiguity
(§21 of the authorization). The column set
(`_export_custom_field_keys`) is the union of every active field
applicable to any company actually represented in the exported
population, **plus** every `field_key` that literally appears in any
exported asset's stored `custom_fields` — the second half is what keeps a
retired-or-rescoped-away definition's already-recorded value from being
silently dropped, verified by
`test_a_retired_custom_fields_stored_value_is_still_exported`. A field not
applicable to a given row's company is left blank for that row, never
fabricated. Verified company-scoped correctly: a company-specific field
from a different company is absent from both the column set and the data
for a non-ADMIN, company-scoped export
(`test_other_companys_custom_field_column_and_data_are_absent_from_a_
scoped_export`, using IT_TEAM rather than ADMIN specifically because
ADMIN is globally unrestricted and would prove nothing — the same trap
`test_export.py`'s own existing comment already documents).

## 24. Movement Log export

**Unchanged.** No code in `export_movements`/`movements_to_xlsx` was
touched. A new regression test
(`test_movement_export_still_uses_point_in_time_holder_snapshots`)
confirms the AM-01 point-in-time holder-name snapshot behavior still
holds: renaming a holder after a MOVED event does not retroactively change
the exported "To Holder" value.

## 25. Field Change Audit export

New: `GET /api/reports/export/field-changes` (`field_changes_to_xlsx`),
built from `AssetFieldChange` (AM-04's append-only edit trail), joined to
`Asset` for the asset code and to `Holder` (aliased) for the actor's
name. Columns: Asset Code, Field, Old Value, New Value, Actor, Changed
At, Request ID. Staff-only (`require_role(*STAFF_ROLES)` — a HOLDER gets
403, same as the movement log), company-scoped via `scoped_company_ids`
exactly like every other export here. Optional `from_date`/`to_date`
filters. Deliberately never flattened into the asset register or the
movement log — a separate canonical dataset, per §19 of the authorization
and now locked in `DECISIONS.md`.

## 26. Reports screen redesign

`ReportsScreen` gains a third card (Field Change Audit, matching the new
endpoint) and Status/Category filters on the Asset Register card (reusing
`AssetRegister`'s own filter components verbatim), all still `Card`-based
(matching the authorization's "restrained list" allowance, not a
decorative dashboard) with a new `PageHeader`. Every download button is
now `AsyncButton` instead of a hand-rolled `useState` pending/error pair.

## 27. Reports authorization/scoping

No authorization code changed. Every export endpoint's existing scoping
(`scoped_company_ids`, the HOLDER-pinning branch on the asset export, the
staff-only gate on movements and the new field-change export) is
unmodified — AM-06 only added new query params (`status`, `category_id`
on the asset export, already-existing params) and one new endpoint that
reuses the identical scoping pattern. Filters narrow within a caller's
already-enforced scope; they can never broaden it, since `scoped_company_
ids`/HOLDER-pinning is applied unconditionally regardless of what the
frontend sends.

## 28. My Assets before-state

Read `frontend/src/features/my-assets/MyAssets.tsx` in full before
changing it. Findings: reused `GET /api/assets` with no query params,
relying entirely on the backend's existing HOLDER-role auto-pin
(`holder_id = holder.id` when `holder.role == "HOLDER"`); a single `Card`
with a 3-column `Table` (Code/Description/Status); the Code link used a
hardcoded `text-blue-600` class; `useQuery`'s destructure never pulled
`isLoading`/`isError`/`error`, so a failed fetch silently rendered an
empty table indistinguishable from "you truly have zero assets"; no
loading skeleton; 1 existing test.

## 29. My Assets final UI

Moved onto `PageHeader`/`DataTable`/`StatusBadge`/`EmptyState`/
`ErrorState`, with a real loading skeleton (`DataTable`'s built-in one)
and `ErrorState`+retry. The Code column is now a real `<Link>` (same
unstyled treatment Asset Register's own Code column uses) rather than a
hardcoded-color anchor. A Category column was added, then **removed**
after this stage's own live browser UAT caught it showing a raw numeric
id for an asset whose category had since been soft-deactivated
(`/masters/categories` only returns active rows, and this list view has
no Asset-360-style live point-lookup-by-id available) — Asset Register
itself has no Category column either, so dropping it keeps My Assets
consistent and correct rather than fragile. See `DECISIONS.md` entry #10.

## 30. My Assets business behavior

**Unchanged, confirmed not silently changed** per §27 of the
authorization: still literally `GET /api/assets` with the same
HOLDER-pinning branch; a non-HOLDER role (ADMIN/IT_TEAM/VIEWER) still sees
their normal `scoped_company_ids`-scoped register at this route, exactly
as before — this was true pre-AM-06 and is documented, not newly
introduced, in `DECISIONS.md` entry #9.

## 31. Security verification

**Import:** only `ADMIN`/`IT_TEAM` can preview/commit/download the
template (unchanged `require_role` gates); company scoping on commit
remains all-or-nothing (`ImportScopeError` → 403, nothing written) — 
reconfirmed by the pre-existing `test_it_team_cannot_import_into_another_
company` test, still green; no cross-company Cost Centre/Holder/Custom
Field acceptance (3 new dedicated tests: cross-company Holder rejected,
subcategory/category mismatch rejected, other-company Custom Field
rejected); the template response itself contains no master data at all
(a static column-header workbook).

**Export:** asset export scoping unchanged (HOLDER-pinning/
`scoped_company_ids`, reconfirmed by the pre-existing
`test_export_assets_and_movements_scope_by_company` and
`test_export_assets_pins_holder_to_only_their_own_held_asset` tests,
still green); new Status/Category filters narrow within, never widen,
that scope (they're plain `WHERE` clauses layered onto the already-scoped
query, same as every existing filter on `search_assets`); field-change
export is staff-only and company-scoped (2 new dedicated tests: company
scoping, HOLDER gets 403).

**My Assets:** no scoping logic changed at all (§30); a HOLDER still only
ever sees `Asset.current_holder_id == their own id`, server-side, exactly
as before.

## 32. Exact files changed

**Backend (commit `80812ed`):** `app/imports/asset_import_service.py`
(full rewrite), `app/imports/router.py`, `app/reports/export_service.py`,
`app/reports/router.py`, `tests/imports/{test_asset_import,
test_asset_import_round1_fixes,test_import_tokens_and_scope}.py` (header
rows updated to the new column names), `tests/imports/
test_am06_import_full_field_support.py` (new), `tests/reports/
test_am06_export_full_field_support.py` (new).

**Frontend (commit `2002d8a`):** `features/imports/ImportScreen.tsx` +
test, `features/reports/ReportsScreen.tsx` + test, `features/my-assets/
MyAssets.tsx` + test.

**E2E (commit `eb9e76a`):** `backend/scripts/build_e2e_import_fixture.py`
(new), `frontend/e2e/import.spec.ts` (new).

**Bugfix found during UAT (commit `73719dd`):** `features/my-assets/
MyAssets.tsx` + test (Category column removed).

**Governance (this commit):** `docs/ai/{UAT_MATRIX,REVIEW_FINDINGS,
DESIGN_SYSTEM,DECISIONS,CURRENT_STAGE}.md`,
`docs/ai/AM-06_IMPORT_REPORTS_MY_ASSETS_REPORT.md` (new, this file).

## 33. Backend tests

258/258 passing (was 231/231 at AM-05). New: 19 in
`tests/imports/test_am06_import_full_field_support.py` (procurement,
Quantity/atomicity, Custom Field applicability/authorization/type-
checking, cross-company master rejection); 8 in `tests/reports/
test_am06_export_full_field_support.py` (asset-export columns/labels/
Custom Fields/retained-value/company-scoping, field-change-audit
correctness/scoping/role-gate, movement-export-unchanged regression). 3
existing import test files had their fixture header rows renamed to match
the new human-readable columns (no test *behavior* changed, confirmed by
running them unmodified first and seeing them pass against the new
header-name-based parser using the old header text — they only needed
updating because the columns are being renamed, not because parsing logic
broke).

## 34. Frontend tests

133/133 passing (was 121/121 at AM-05), 25 files. New: `ImportScreen.
test.tsx` grew from 3 to 9 tests (layout, Preview-disabled-until-file,
preview showing both ready/error tables, Commit-disabled-with-no-valid-
rows, preview-request-failure, commit-success-with-row-errors, commit-
request-failure, plus the 2 pre-existing template-download tests kept);
`ReportsScreen.test.tsx` grew from 3 to 6 (page-header+3-cards render,
default-date-range+asset-export unchanged, movement-log unchanged,
asset-export-with-status/category-filters, field-change-audit-download,
export-failure unchanged); `MyAssets.test.tsx` grew from 1 to 4 (loading
skeleton, real-link-not-hardcoded-color, empty state, error+retry).

## 35. Typecheck

`npx tsc -b` clean throughout every stage of this work.

## 36. E2E

3/3 passing: the existing `full custody journey` and `multi-company-udf`
specs untouched and green; new `import.spec.ts` (fixture file → preview →
commit → find the asset via the real Asset Register search → PI Number
and a company-scoped Custom Field both confirmed on Asset 360). The
fixture is built through a new `backend/scripts/
build_e2e_import_fixture.py`, which reuses the real
`TEMPLATE_COLUMNS` contract via a one-row `openpyxl` workbook and prints
base64 on stdout — the same "shell out to a real backend script via
`docker compose exec`" pattern `fixtures.ts::runSeedAdmin` already
established, chosen specifically to avoid adding an xlsx-writing
dependency to the frontend for one test and to guarantee the fixture can
never silently drift from what the app actually parses. All three specs'
teardown was re-verified to leave no active leftover `SEEDADMIN` rows.

## 37. Browser UAT

Performed live against the running stack as the session's UAT ADMIN
account: `/import` (layout, Download Template succeeded live via network
log); `/reports` (all 3 cards render, all 3 exports — Asset Register,
Movement Log, Field Change Audit — downloaded successfully live via
network log); `/my-assets` (list renders, clicked an asset code through to
Asset 360 successfully) — this last check is what caught the Category-
column bug (§29), fixed live in the same session before this report was
written.

## 38. Responsive UAT

Checked at 375×812 and 768×1024 via `document.body.scrollWidth` vs.
`window.innerWidth` (not screenshot-only, since the Browser-pane
screenshot tool has a documented stale-frame quirk after repeated
`resize_window` calls — `CLAUDE.md` already notes this): `/import`,
`/reports`, and `/my-assets` all show `overflow: false` at both widths.
The AM-04 `SidebarInset min-w-0` fix was not touched and remains in
place. Desktop-width UAT (the screenshots above) covers the remaining
breakpoints implicitly since none of AM-06's layout uses anything
narrower-hostile than the shared `DataTable`/`Card`/`FormField`
primitives already proven at every breakpoint in prior stages.

## 39. Accessibility

Verified via the accessibility tree (`read_page`), not just visually: the
Import file input has a real accessible name ("File"), Preview/Download
Template/Commit are real `<button>` elements with clear names, no
unlabeled controls anywhere on any of the three redesigned screens. Every
new form control goes through `FormField` (Reports' Status/Category
Selects, Import's file input) with a matching `aria-label`. Status is
always shown as text via `StatusBadge`, never color alone. No new
clickable non-semantic `<div>` was introduced anywhere in this stage —
every interactive element is a real `<button>`, `<a>`/`Link`, `Select`, or
`Input`.

## 40. UAT_MATRIX changes

`/my-assets`, `/import`, and `/reports` rows all moved from ⬜/🟡 to ✅
Functional/Design/Security, with Responsive marked ✅ for Import/My Assets
(explicitly checked at 375/768 this session) and ⬜ for Reports (desktop-
verified only, not re-checked at every breakpoint — stated honestly, not
inflated). Added an AM-06 summary paragraph and updated the Backend/
Frontend/E2E counts at the bottom.

## 41. REVIEW_FINDINGS resolved/narrowed

The entire "Design / UX (open)" section (7 items: `DataTable`/`PageHeader`
missing on My Assets/Import, loading/empty/error gaps, missing skeletons,
My Assets heading gap, duplicated async-state plumbing, the hardcoded
`text-blue-600`) is now empty — every item is resolved and moved to
"Resolved this session" with AM-06 attribution. The Import/Export
procurement-column-gap finding (previously item 10) is resolved and
moved. `holder_company_access`, the closed-value CHECK-constraint gap,
and the category/subcategory/purchase_date edit-path gap were **not**
removed — reconfirmed still open, renumbered. A new item documents the
real (not invented) absence of import-side duplicate detection, since a
prior report's claim about it didn't match the actual code.

## 42. DESIGN_SYSTEM changes

Updated the "Shared components" section to state every screen now uses
the foundation. Added three new pattern sections: Import workflow
(numbered-section hierarchy, dual ready/error preview tables), the
validation-summary pattern (plain-language counts, never a raw backend
exception string), and the report/download action pattern (`AsyncButton`
everywhere, filters-then-action row layout). "Known gaps" now reads
"None." No new color/token was introduced.

## 43. DECISIONS changes

New "AM-06 scope locked" section (11 numbered decisions): the exact
Import column contract (full table), Subcategory now optional, the
`Custom:<field_key>` convention and why it was chosen, the company-scoped
UDF import rule (reusing AM-05 directly), the three-separate-canonical-
datasets rule for asset/movement/field-change exports, the confirmed-
unchanged VALID-ROWS-ONLY atomicity model plus its Quantity extension, no
new duplicate detection, no database migration, My Assets' unchanged
business meaning, the Category-column removal and why, and
`holder_company_access` staying untouched.

## 44. CURRENT_STAGE changes

Stage marked AM-06 complete, PASS. Added a "What's actually done as of
AM-06" section (exact test counts, import/export contract summary,
My Assets migration, the Category-column bug-and-fix). "Deferred" section
updated: the Import/Export-column-gap item and the shared-foundation-gap
item are both removed (resolved); `holder_company_access`, the
category/subcategory/purchase_date edit-path gap, and the rejected-scope
Custom-Field-category-scoping item remain, renumbered; a new item notes
the confirmed absence of import duplicate detection.

## 45. Deviations from approved scope

None. Every change maps directly to an explicit section of the AM-06
authorization. The only judgment calls made, both disclosed in
`DECISIONS.md`: making Subcategory optional on import (directly serves
§7's "support the same core fields Add Asset supports," and Add Asset's
own Sub-Category is optional) and adding Status/Category filters to the
Asset Register export card (the backend already supported both params;
§26 explicitly allows this "where clearly useful and low-risk").

## 46. Issues discovered but not changed

- The AM-02 report's claim that import "duplicate handling" was already
  covered by tests did not match the actual code (no such logic exists).
  Documented in `REVIEW_FINDINGS.md`/`DECISIONS.md` rather than silently
  left to be re-discovered by a future stage. Not fixed (no business
  evidence a uniqueness rule is wanted, and adding one wasn't authorized).
- `My Assets`' Category column: discovered broken during this stage's own
  UAT (raw numeric id for a deactivated category) and fixed within this
  same stage (removed), not left as a known issue — noted here per §46's
  intent to surface anything found along the way, even though it was
  actually resolved before this report was written.

## 47. Remaining risks

- Import still has no duplicate detection — a genuine, evidenced gap if
  CityKart's real-world legacy data turns out to contain accidental
  duplicate rows, but building one without a confirmed business rule for
  what "duplicate" means (legacy code? serial number? some combination?)
  risks rejecting legitimate data.
- The `Custom:<field_key>` convention requires an operator to know a
  field's key, not just its label — mitigated by `CustomFieldsScreen`
  already showing `field_key` in a `<code>` column and the Import screen's
  inline pointer to it, but there's no in-template documentation sheet
  (deliberately not built — §18 of the authorization allows skipping it
  "only if the existing Excel-generation library makes it clean," judged
  not worth the added complexity for one column-naming convention).
- Reports wasn't re-checked at every responsive breakpoint this session
  (desktop-verified only) — low risk, since it reuses the exact same
  `Card`/`FormField`/`AsyncButton` primitives already proven responsive
  elsewhere, but stated honestly rather than assumed.

## 48. Recommended AM-07

In rough priority order: (1) a decision on `holder_company_access` (needed
vs. dormant) before any further work assumes either answer; (2) a
dedicated category/subcategory/purchase_date correction-workflow design
(now the single largest remaining "known gap," deferred since AM-02); (3)
if CityKart's real import data shows genuine duplicate rows in practice,
revisit import-side duplicate detection with an actual business rule in
hand, not a guessed one.

## 49. REPORT CONTENT HEAD

`73719dd` (the last commit before this report/governance commit —
`fix(my-assets): AM-06 -- drop the Category column, found broken during
UAT`).

## 50. REPORT COMMIT

TO BE FILLED IN CHAT AFTER COMMIT.

## 51. Final verdict

**PASS.** All items in the AM-06 completion gate are satisfied: git
baseline verified; existing import behavior audited before modification;
field matrix completed; procurement/PI-Number/UDF/Quantity import
implemented with company-scoped applicability and required-field behavior
preserved correctly; preview remains mandatory with clear row-level
errors; transaction/partial-failure semantics preserved and tested; Asset
Code numbering stays server-side/race-safe; Import migrated to the shared
UI; Asset Register export expanded with Custom Field support; movement
export stays separate and unchanged; field-change audit export created;
Reports migrated with `AsyncButton` everywhere; My Assets migrated with
its hardcoded color removed and real SPA navigation confirmed; security
scoping verified on every changed surface; backend/frontend/typecheck/
existing-and-new E2E all green; browser/responsive/accessibility UAT
performed (and one real bug found and fixed along the way); governance
docs updated honestly; this report written following the no-self-
reference convention; no push; AM-07 not started. Stopping here per §54 —
waiting for explicit approval.
