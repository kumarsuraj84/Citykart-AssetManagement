# AM-05 — Masters + Holders + Company-Scoped Custom Fields — Report

> **Final Git State convention (new from this stage on — see `DECISIONS.md`):**
> this report intentionally does NOT try to record its own final commit hash.
> **REPORT CONTENT HEAD: `ababf5e`** (the last commit before this report/
> governance commit — `test(e2e): AM-05 -- multi-company custom field
> journey`). **REPORT COMMIT: TO BE FILLED IN CHAT AFTER COMMIT.** The real
> report-commit hash and the true final `HEAD` are stated only in the chat
> response that delivers this report, never edited back into this file.

## 1. Executive summary

AM-05 turned CKAM's setup/admin area from a mostly read-only surface
(Create + Deactivate only, no Edit anywhere except Holders) into a coherent
operational management surface: every master gained Edit, Holders gained
the Deactivate action it was missing, and Custom Fields gained the
company-scoping AM-04's own browser UAT had proven was operationally
necessary — a required field created for one company used to block asset
creation in every company. All of that is now closed, tested at the
backend (32 new tests), frontend (20 new tests), and a dedicated E2E
journey, with the existing custody-journey E2E test kept untouched and
green. Verdict: **PASS**.

## 2. Git preflight (§1) and the AM-04 report's Final-Git-State correction

The AM-05 authorization flagged that AM-04's report could not have
correctly recorded its own final commit hash — a documentation commit
necessarily happens after the content describing it is written. This was
already resolved in the immediately-preceding session (commit `68e92fd`,
"docs(ai): AM-04 preflight -- reconcile AM-04 report's Final Git State,
adopt the no-self-reference convention") before AM-05 implementation work
began: the AM-04 report's Final Git State was corrected to record the true
final chain, and the no-self-reference convention (this report's header
above, and the `DECISIONS.md` entry below) was adopted going forward so the
same correction loop can't recur. AM-05 started implementation work from a
clean worktree at that commit — `git status` confirmed no unrelated dirty
state before the first AM-05 commit.

## 3-4. Governance docs read before changing anything

Read in full before any code change: `PRODUCT_CONTEXT.md`,
`DESIGN_SYSTEM.md`, `DEVELOPMENT_GUARDRAILS.md`, `CURRENT_STAGE.md`,
`REVIEW_FINDINGS.md`, `DECISIONS.md`. All locked V1 decisions (no approval
workflow, unified Holder model, no AMC/insurance/depreciation, physical
verification future-only, full procurement traceability, PI Number
semantics, server-generated Asset Code, company/cost-centre integrity, no
login company selector, existing lifecycle state machine, append-only
`asset_event`/`asset_field_change`, Asset 360's field-edit policy,
category/subcategory/purchase_date non-editable, CKAM's navy/teal identity)
were treated as binding and none were reopened.

## 5. Primary objective — met

Administrators can now: see every master's active records; create records
(unchanged); edit the safe descriptive subset of an existing record, with
the immutable identifier shown but not editable; deactivate a record with a
confirmation naming it; manage Holders including deactivation and a
visibly-flagged role change; manage Custom Field definitions with an
explicit, human-readable scope and a confirmation before making a field
required. Nothing was reduced to generic uncontrolled CRUD — every master's
edit surface is a deliberately narrower schema than its create schema, not
the same schema reused.

## 6-7. Master inventory + field policy matrix

| Master | DB Model | Company Scope | Create API | Update API (AM-05) | Deactivate API | Immutable fields | Editable fields |
|---|---|---|---|---|---|---|---|
| Company | `masters/models.py::Company` | SCOPE_SELF | `POST /masters/companies` | `PUT .../{id}` (`CompanyEditIn`) | `DELETE .../{id}` | `code` | `name` |
| Location | `Location` | none (global) | `POST /masters/locations` | `PUT .../{id}` (`LocationEditIn`) | `DELETE .../{id}` | `code` | `name`, `address` |
| Department | `Department` | none (global) | `POST /masters/departments` | `PUT .../{id}` (`DepartmentEditIn`) | `DELETE .../{id}` | — (name is the identifier, safe to rename — Holder keys off `department_id`) | `name` |
| Cost Centre | `CostCenter` | SCOPE_COMPANY_ID | `POST /masters/cost-centers` | `PUT .../{id}` (`CostCenterEditIn`) | `DELETE .../{id}` | `code`, `company_id` | `name` |
| Category | `AssetCategory` | none (global) | `POST /masters/categories` | `PUT .../{id}` (`AssetCategoryEditIn`) | `DELETE .../{id}` | `code` | `name` |
| Subcategory | `AssetSubcategory` | none (global; parented by category) | `POST /masters/subcategories` | `PUT .../{id}` (`AssetSubcategoryEditIn`) | `DELETE .../{id}` | `code`, `category_id` | `name` |
| Vendor | `Vendor` | none (global) | `POST /masters/vendors` | `PUT .../{id}` (`VendorEditIn`) | `DELETE .../{id}` | `code` | `name`, `gstin`, `contact_name`, `contact_phone`, `contact_email` |
| Custom Field | `CustomField` | Global or company (new AM-05 column) | `POST /masters/custom-fields` (bespoke router) | `PUT .../{id}` (`CustomFieldEditIn`) | `DELETE .../{id}` | `field_key`, `field_type` | `label`, `options`, `is_required`, `sort_order`, `company_id` (only while no asset has a value for the key) |
| Code Rule | `CodeRule` | company or global | `POST /code-rules` | `PUT /code-rules/{id}` (unchanged, pre-AM-05) | n/a (deactivated via `make_sole_active_rule`) | numbering semantics | template fields |
| Holder | `Holder` | company | `POST /holders` | `PUT /holders/{id}` (unchanged, ADMIN-only, ADMIN-only) | `DELETE /holders/{id}` (unchanged) | `company_id` implicitly (no edit path changes it) | name, type, location, department, email, phone, role (ADMIN-only) |

Field classification used throughout: `code`/`field_key`/`field_type` are
IMMUTABLE IDENTIFIERS; `name`/`address`/`gstin`/contact fields/`label` are
SAFE DESCRIPTIVE EDITS; `company_id`/`category_id`/Custom Field `company_id`
are CONTROLLED RELATIONSHIPS (the last one conditionally editable);
`Holder.role` is SECURITY-SENSITIVE; nothing in this stage is
SYSTEM-COMPUTED besides Custom Field scope's conditional lock.

## 8. Safe master Edit — implementation

`build_master_router` (`backend/app/masters/router.py`) gained a
`schema_edit` parameter: `PUT` now validates against `schema_edit or
schema_in`, and `check_incoming`'s company-scope check only runs `if
"company_id" in data` — so a narrower edit schema that omits `company_id`
entirely makes the field un-settable by any role, not merely gated by
role. Every simple master now has a paired `*EditIn` Pydantic schema in
`backend/app/masters/schemas.py`, each with a one-line docstring stating
which field is deliberately absent and why.

## 9. Master change history

`asset_field_change` remains asset-only, not extended to masters (per
DEVELOPMENT_GUARDRAILS and the authorization's explicit instruction). The
existing `AuditMixin` (`created_by`/`updated_by`/`created_at`/`updated_at`)
is the standard for masters; nothing new was built here.

## 10-11. Shared master UI + row actions

`MasterCrudScreen<T>` (`frontend/src/components/master-crud/
MasterCrudScreen.tsx`) was rewritten onto `PageHeader`/`DataTable`/
`EmptyState`/`ErrorState`/`AsyncButton`/`FormField`. `MasterConfig<T>`
gained `editFields` (a strict subset of `formFields`) and an optional
`singular` (for dialog/button copy); `Column<T>` gained an optional
`format` callback so a foreign-key column (Cost Centre's Company,
Subcategory's Category) can render the referenced name instead of a raw
id. Row actions are two ghost icon buttons (`Pencil`/`Trash2`), each with
an explicit row-naming `aria-label` (e.g. "Edit Vendor One") rather than a
bare "Edit"/"Delete" — verified this matters in practice via the frontend
test that clicks `"^edit vendor one$"` specifically. Deactivate opens an
`AlertDialog` naming the record before calling the (unchanged)
soft-deactivate endpoint.

## 12. Deactivation safety

No change to deactivation's server-side behavior for any master — it was
already soft (`SoftDeleteMixin`) and safe. The only change is a UI-level
confirmation step. `GET /masters/{resource}` still only returns active
rows (`MasterCRUDService.list_active`); this was true before AM-05 and
remains true — AM-05 did not add an "include inactive" list mode, since
that was not explicitly authorized and would be new capability, not a
reskin.

## 13-16. Holders audit, migration, and security

**Before:** `HoldersScreen` already had Create + Edit + Reset Password
(bespoke, not on the shared foundation), but **no Deactivate action at
all** — confirmed by reading the component before touching it. The role
selector existed but gave no indication of the holder's current role or
any warning on change.

**After:** migrated onto `PageHeader`/`DataTable`/`EmptyState`/
`ErrorState`/`FormField`/`AsyncButton`, kept every existing Create/Edit
field and payload shape unchanged (verified by keeping the pre-existing
frontend tests passing with only an aria-label update), added a Deactivate
row action with a named confirmation, and added a Role `FormField` helper
text stating the current role plus an inline warning when the selected
value differs from it.

**Security:** `PUT /api/holders/{id}`, `DELETE /api/holders/{id}`, and
`POST /api/holders/{id}/reset-password` were already ADMIN-only
(`require_role("ADMIN")`, unchanged) — AM-05 added 3 dedicated backend
tests proving IT_TEAM gets 403 on all three, plus a positive test that
ADMIN's role change actually persists. No backend authorization code
changed for Holders; only test coverage was added, confirming existing
behavior was already correct.

## 17-26. Multi-company Custom Field risk — architecture and implementation

**Target architecture:** `CustomField.company_id: int | None`, nullable FK
to `company`, indexed. `NULL` = Global, a real id = scoped to that company.
Existing rows are unaffected (nullable + no backfill = they stay `NULL` =
Global, their exact prior meaning).

**Applicability algorithm** (`backend/app/assets/custom_field_values.py::
applicable_custom_fields`): for an asset in company X, applicable
definitions = active fields where `company_id IS NULL OR company_id = X`.
`validate_custom_field_values` now takes a required `company_id` keyword
and filters through this function instead of "every active field" —
closing the exact risk AM-04's UAT discovered.

**Requiredness:** evaluated only across the applicable set for `enforce_
required=True` (create, always; edit, only when `custom_fields` is part of
the request body — unchanged AM-04 convention). A field scoped to another
company is never counted, never rendered, never accepted as a key in the
submitted value dict (submitting it raises the same "unknown, inactive, or
not-applicable-to-this-company" 422 as an unknown key).

**Authorization** (`backend/app/masters/custom_fields_router.py::
_check_scope_authorization`): ADMIN unrestricted. IT_TEAM may create/
edit/deactivate only a field where `company_id == holder.company_id` —
never `None` (Global). VIEWER/HOLDER never reach the mutation routes at
all (`require_role("ADMIN", "IT_TEAM")` gate).

**Immutability:** `field_key`/`field_type` absent from `CustomFieldEditIn`
— permanently un-settable via PUT, same convention as `AssetUpdateIn`.
Scope (`company_id`) is present in the edit schema but the router only
honors an actual change to it when `any_asset_has_value_for(session,
field_key)` is false; otherwise 422, naming the field key.

**Required-flag safety:** the frontend's `CustomFieldsScreen` requires a
confirmation step (`AlertDialog`) before a PUT that flips
`is_required` from `false` to `true` fires — worded to name every company
for a Global field, the one specific company for a scoped field. Never a
row-checkbox toggle.

**Key generation:** evaluated auto-generating `field_key` from `label`
(§24) and deliberately did not implement it — the existing manual-entry +
client-side regex validation (`^[a-z][a-z0-9_]*$`, checked before the API
call) plus the backend's own duplicate-key 422 was judged sufficient and
lower-risk than guessing a slugification scheme; the immutability
helper-text makes the consequence of a typo clear before Save.

**Add Asset / Asset 360 integration:** both now filter their fetched
`CustomFieldDef[]` (`company_id === null || company_id === <asset's
company>`) before rendering, validating, or counting requiredness — the
minimal client-side mirror of the backend's own filter. A value already
stored under a key that falls outside the filtered set (e.g. re-scoped
after the value was recorded) is preserved by the existing "retain keys
`activeDefsByKey` doesn't cover" logic from AM-04, unchanged in mechanism,
now also covering the new "scoped to a different company" case in exactly
the same way it already covered "deactivated definition."

**Master lookup scoping:** reviewed while implementing; no over-granting
security defect found. `holder_company_access` confirmed untouched.

## 27-28. Presentation consistency + Code Rule

All 10 setup routes (8 simple masters via `MasterCrudScreen`, the new
`CustomFieldsScreen`, `HoldersScreen`, `CodeRuleScreen`) now share
`PageHeader`/loading-skeleton/`ErrorState`+retry/`EmptyState` patterns.
`CodeRuleScreen` gained a `PageHeader`, a loading skeleton, and an
`ErrorState`+retry for the initial fetch, without touching
`resolve_prefix`/`generate_code`/the atomic counter/`get_active_rule`'s
ordering. The previously-undocumented `get_active_rule` test gap (item 10
of `REVIEW_FINDINGS.md`) is closed with 5 dedicated tests.

## 29. Browser UAT (real browser, this session)

Logged in as a dedicated UAT ADMIN account created for this session
(`UATADMIN`, company "Citykart Stores"). Verified live:

- **Vendors** (`MasterCrudScreen`): list renders with Edit/Deactivate icon
  buttons; Edit dialog shows Code read-only with "Not editable after
  creation." note, Name/GSTIN/Contact fields editable; Deactivate opens a
  named confirmation dialog with correct destructive styling; cancelled
  without side effect.
- **Custom Fields** (`CustomFieldsScreen`): empty state renders correctly;
  created a Global text field ("Warranty Card", `warranty_card`) — list
  shows Scope="Global" correctly; opened Edit — Field Key/Field Type shown
  read-only, Scope/Required/Sort Order editable; toggled Required and hit
  Save — the stronger Global-field confirmation appeared verbatim as
  designed ("This is a Global field. Making it required means EVERY
  company must fill it in before a new asset can be created, and it will
  be enforced immediately."); cancelled without saving; deactivated the
  field afterward as UAT cleanup (via the app's own Deactivate flow).
- **Holders** (`HoldersScreen`): Edit dialog verified with prefilled data;
  changed Role from ADMIN to VIEWER in the form and confirmed the inline
  warning appeared ("Changing role from ADMIN to VIEWER will immediately
  change this person's access."); closed without saving (did not actually
  demote the UAT admin account).
- **Code Rule**: form/preview render correctly with the modernized
  `PageHeader`.
- **Add Asset**: confirmed the newly-created Global "Warranty Card" custom
  field rendered correctly under the "Custom Fields" section.

## 30. Responsive UAT

Verified `/setup/custom-fields` at 375×812 (mobile preset) via
`getBoundingClientRect`-equivalent JS (`document.body.scrollWidth` vs.
`window.innerWidth`) after the Browser-pane screenshot tool hit its
documented stale/cropped-frame quirk in this session (confirmed via a
fresh tab + the accessibility tree, per `CLAUDE.md`'s own noted
workaround, that the duplicated-looking screenshot was a rendering
artifact, not a real layout bug): `bodyScrollWidth === windowInner === 375`,
`hasHorizontalOverflow: false`. The shared `DataTable`'s own internal
horizontal scroll (not a page-level one) continues to hold at narrow
widths, exactly as it already did before AM-05 on Dashboard/Asset
Register. `SidebarInset`'s `min-w-0` (the AM-04 fix) was not touched and
remains in place.

## 31. Accessibility

Every dialog in this stage's new/changed screens is a real `Dialog`/
`AlertDialog` (Radix primitives, correct `role="dialog"`/`role="alertdialog"`
semantics, focus trapped and returned on close — unchanged library
behavior, not reimplemented). Every form control goes through `FormField`
or carries an explicit `aria-label` matching its visible label. Every icon
-only row action button has a row-specific `aria-label` (never a bare
icon with no accessible name). The Holder role-change warning and Custom
Field required-confirmation both convey their message as text, not color
alone (the role warning does use `text-warning`, but the sentence itself
states the change in full). No new clickable non-semantic `<div>` was
introduced anywhere in this stage — every interactive element is a real
`<button>`, `Select`, or `Checkbox`.

## 32. Security verification

**Master mutations:** `test_company_scoped_writes.py` (updated for the
new `*EditIn` schemas) and the pre-existing role-based `require_role`
gates confirm VIEWER/HOLDER get 403 on every master write, IT_TEAM is
company-scoped where the master has a company relationship, ADMIN is
unrestricted.

**Custom Field scope:** 15 new tests in
`test_am05_custom_field_scope.py` cover: ADMIN creates Global/company
fields; IT_TEAM cannot create Global, can create for its own company,
cannot create for another company; VIEWER cannot create at all; duplicate
`field_key` rejected; `field_key`/`field_type` immutable via edit;
label/required/sort_order editable; scope changeable while no asset has a
value, blocked (422, naming the key) once one does; IT_TEAM cannot move a
field to another company even when otherwise free to change scope; IT_TEAM
cannot manage a Global field at all (edit or deactivate, both 403); IT_TEAM
cannot manage another company's field.

**Asset-side applicability:** 9 new tests in
`test_am05_udf_applicability.py` cover: Global field applicable and
accepted; same-company field applicable and accepted; other-company field
rejected (422) if submitted; other-company required field does NOT block
creation; Global required field DOES block creation when absent;
same-company required field DOES block creation when absent; a retained
value under a field later re-scoped to another company stays visible on an
unrelated edit; an edit resubmitting `custom_fields` cannot set an
other-company field's value; the AM-04 inactive-field precedent (retained
value visible, new value rejected) still holds with the AM-05 scope filter
layered on top.

**Holders:** 3 new tests confirm IT_TEAM cannot update, deactivate, or
reset-password any holder; 1 confirms ADMIN's role change actually
persists.

No cross-company leakage was found in any of the above; every test that
checks isolation uses two genuinely separate, freshly-created companies.

## 33. Deviations from AM-05's explicit boundaries

None beyond the following minimal, in-scope UI completions, disclosed
here per the authorization's own "minimal regression fixes... must be
disclosed" instruction:

- **Vendor's Contact Name/Phone/Email were added to the UI** (create and
  edit) — these fields already existed on `VendorIn`/`VendorOut`/the
  database, were simply never exposed by `MasterCrudScreen`'s config. This
  directly serves AM-05's own §8 guidance ("Vendor: code immutable,
  name/contact fields editable") and required no backend or schema change.
- **Cost Centre's and Subcategory's list columns now show the referenced
  Company/Category name instead of a raw numeric id** (`Column<T>.format`,
  a new optional prop, additive to the existing type) — directly serves
  §5's "understand company scope" goal; no new backend field, no new
  endpoint.
- **A handful of leftover active `SEEDADMIN`/company pairs in the shared
  dev database, left behind by earlier interrupted E2E runs, were
  deactivated** (pure `is_active = false` via the app's own soft-deactivate
  semantics) after they were found to make every new login ambiguous
  (`/api/auth/login` resolves `login_id` across every active company with
  no company selector) — necessary to get the E2E suite green again, not
  a schema or business-data change.

Import, Reports, My Assets, Dashboard, Asset Register, the lifecycle state
machine, new lifecycle statuses, approval workflow, AMC/insurance,
depreciation/accounting, physical verification, `holder_company_access`,
category/subcategory/purchase_date correction workflows, and a company-wide
asset audit explorer were all left untouched, as authorized.

## 34. Backend tests

231/231 passing (was 199/199 at AM-04). New: 15 in
`tests/masters/test_am05_custom_field_scope.py`, 9 in
`tests/assets/test_am05_udf_applicability.py`, 5 in
`tests/numbering/test_get_active_rule_ordering.py`, 3 in
`tests/holders/test_crud.py`. One existing test
(`test_company_scoped_writes.py::test_it_team_cost_center_writes_are_
company_scoped`) had its assertions updated to reflect a legitimately
changed (stronger) behavior — documented inline in the test and in the
commit message, not silently patched to hide a regression.

## 35. Frontend tests

121/121 passing (was 101/101 at AM-04), 25 files. New:
`MasterCrudScreen.test.tsx` rewritten (loading skeleton, error+retry,
empty state, create, edit with immutable-code-shown-read-only, deactivate
confirmation — 6 tests, up from 1); `CustomFieldsScreen.test.tsx` (new, 9
tests: scope display, ADMIN Global create, field-key validation, IT_TEAM
scope constraint, action visibility by authorization, field_key/field_type
read-only in Edit, Global vs. company-specific required-confirmation
wording, deactivate confirmation); `HoldersScreen.test.tsx` (+4: loading
empty state, error+retry, deactivate confirmation, role-change-warning
behavior including "no warning on an unrelated field edit"); `AddAssetForm.
test.tsx` (+1: Global/own-company fields render, other-company required
field never blocks Save); `AssetDetail.test.tsx` (+1: same applicability
rule in Edit mode, retained other-company value stays visible and is
preserved on save); `CodeRuleScreen.test.tsx` (2 existing tests updated to
await the new loading state before interacting — a legitimate behavior
change, not a masked failure).

## 36. Typecheck and E2E

`npx tsc -b` clean. E2E 2/2 passing: the existing `full custody journey`
spec, untouched; a new `multi-company-udf.spec.ts` proving a required
Custom Field scoped to one company never blocks asset creation for a
different company, end to end in a real browser against the real backend.
Both specs' teardown was verified to leave no active leftover rows
(re-queried the database after the run).

## 37. UAT_MATRIX.md — updated

Added an AM-05 summary paragraph; updated every `/setup/*` row from ⬜/🟡
to ✅ Functional with either ✅ or 🟡 Design/Responsive depending on
whether that specific master was opened live this session (Companies,
Vendors, Custom Fields, Holders, Code Rule were; the other 5
`MasterCrudScreen`-identical masters are noted as config-verified rather
than individually screenshotted, since they share the exact same
component); updated Add Asset/Asset 360 rows with the new applicability
coverage; updated the Backend/Frontend/E2E counts at the bottom.

## 38. REVIEW_FINDINGS.md — updated

Items 1-5 (DataTable/PageHeader/loading-empty-error/skeletons/heading-drift
adoption) narrowed from "4 screens" to "every screen except My Assets and
Import." Item 8 (`MasterCrudScreen` missing Edit) and item 10
(`get_active_rule` test gap) moved to "Resolved this session" with the
fix's detail. A new resolved entry documents the global-Custom-Field-
requiredness risk and its fix. No unrelated finding was removed; items 6,
7, 9 (renumbered 8), 11-13 (renumbered 9-11) remain open as before.

## 39. DESIGN_SYSTEM.md — updated

Added four new sections: master list screens' shared pattern, destructive
confirmation dialogs, the Custom Field scope selector's role-shaped
behavior, security-sensitive Holder role editing, and table row actions'
shared shape/authorization-gated visibility. Updated the "Known gaps"
section to reflect that only My Assets/Import remain outside the shared
foundation. No new color/token was introduced.

## 40. DECISIONS.md — updated

A new "AM-05 scope locked" section (12 numbered decisions) documents the
Custom Field scope model, applicability rule, immutability rules,
authorization rules, the required-flag confirmation requirement, the safe
master-edit field policy, deactivation-stays-soft, Holder.role staying
ADMIN-only (reconfirmed), Master Change History staying asset-only,
`holder_company_access` staying untouched, and the backend-change boundary.
Also documents, as a durable process decision, the new "no self-reference
for a report's Final Git State" convention (§43 of the authorization) —
see this report's own header for the convention applied.

## 41. CURRENT_STAGE.md — updated

Stage marked AM-05 complete, PASS. Added a "What's actually done as of
AM-05" section (migration revision, exact test counts, master/Holders/
Custom-Fields coverage, UDF scope behavior). "Deferred" section updated:
items resolved by AM-05 removed/narrowed, a new item added noting
category/subcategory-scoped Custom Fields were explicitly considered and
rejected as out of scope for this stage.

## 42. Migration verification

`370399c6380e` (down-revision `a409768dc2cf`): additive
(`ALTER TABLE custom_field ADD COLUMN company_id BIGINT`), a foreign key to
`company(id)`, an index on the new column. Applied to `ckam_test` first,
full backend suite run and green, then applied to the live `ckam`
database. Post-migration verification on the live database: `\d
custom_field` shows the new column/FK/index; all 5 pre-existing DB
triggers (`trg_asset_event_no_update`, `trg_asset_event_no_delete`,
`trg_asset_field_change_no_update`, `trg_asset_field_change_no_delete`,
`trg_asset_no_identity_change`) still present and unaffected; the one
pre-existing live `custom_field` row confirmed still `company_id = NULL`
(Global, its unchanged meaning) after migration. `alembic current` reports
`370399c6380e (head)` on both `ckam_test` and `ckam`.

## 43. Files changed

**Backend (commit `5ae800e`):** `app/masters/models.py`,
`app/masters/router.py`, `app/masters/schemas.py`,
`app/masters/custom_fields_router.py` (new),
`app/assets/custom_field_values.py`, `app/assets/service.py`,
`app/assets/router.py`,
`app/alembic/versions/370399c6380e_custom_field_company_scope.py` (new),
`tests/masters/test_am05_custom_field_scope.py` (new),
`tests/assets/test_am05_udf_applicability.py` (new),
`tests/numbering/test_get_active_rule_ordering.py` (new),
`tests/holders/test_crud.py`, `tests/masters/test_company_scoped_writes.py`.

**Frontend (commit `9ce9239`):** `components/master-crud/MasterCrudScreen.
tsx`, `components/master-crud/types.ts`, `features/masters/
CustomFieldsScreen.tsx` (new), `features/masters/CustomFieldsScreen.test.
tsx` (new), `features/holders/HoldersScreen.tsx`,
`features/numbering/CodeRuleScreen.tsx`, `features/assets/AddAssetForm.tsx`,
`features/assets/AssetDetail.tsx`, plus their test files, plus all 7 simple
master route configs (`routes/setup/{companies,locations,departments,
cost-centers,categories,subcategories,vendors}.tsx`) and
`routes/setup/custom-fields.tsx`.

**E2E (commit `ababf5e`):** `frontend/e2e/multi-company-udf.spec.ts` (new).

**Governance (this commit):** `docs/ai/{UAT_MATRIX,REVIEW_FINDINGS,
DESIGN_SYSTEM,DECISIONS,CURRENT_STAGE}.md`,
`docs/ai/AM-05_MASTERS_HOLDERS_REPORT.md` (new, this file).

## 44. Issues discovered during this stage

- The shared dev database had accumulated several leftover active
  `SEEDADMIN`/company pairs from earlier, interrupted E2E runs (visible as
  duplicate active `SEEDADMIN` rows across companies), which made
  `/api/auth/login`'s login_id resolution genuinely ambiguous (401 on a
  perfectly valid login) once this session's own E2E work added more. Not
  a code defect — `login`'s "refuse to guess across companies" behavior
  (`DECISIONS.md`) is working exactly as designed — but a real environment-
  hygiene issue: an interrupted Playwright run (e.g. killed mid-test) can
  leave the shared dev database in a state that breaks the *next* run.
  Worth a future improvement (e.g. a `--cleanup-orphaned-seed-companies`
  script) but out of scope to build now.
- Discovered, while designing the E2E multi-company test, that `ADMIN` is
  genuinely globally unrestricted (`scoped_company_ids` returns `None`) —
  already documented as a known fact from AM-02/AM-04, but this is the
  first stage to lean on it directly (creating a second company through
  the first company's own ADMIN token) rather than just testing it.

## 45. Remaining risks / recommended AM-06

- My Assets and Import preview remain the only two screens outside the
  shared PageHeader/DataTable/EmptyState/ErrorState foundation.
- Import/Export still has no procurement/custom-field/field-change-audit
  columns (deferred since AM-02).
- `category_id`/`subcategory_id`/`purchase_date` still have no correction
  workflow (deferred since AM-02/AM-04).
- `holder_company_access` remains unwired (deferred since AM-01).
- A recommended AM-06 scope, in rough priority order: (1) Import/Export
  column extension now that procurement+UDF data is fully wired into the
  UI it was always missing from; (2) My Assets redesign onto the shared
  foundation; (3) a decision on `holder_company_access` (needed vs.
  dormant) before any further work assumes either answer.

## Final verdict

**PASS.** All items in §46's completion gate (git baseline reconciled,
master inventory + field-policy matrix complete, safe master Edit
implemented with protected codes/relationships, soft deactivation
preserved, all master screens + Holders migrated onto the shared
foundation, Holder role handled safely, `CustomField.company_id`
implemented with existing definitions preserved as Global, requiredness
scoped correctly and tested, cross-company isolation tested,
`field_key`/`field_type` immutable, unsafe scope changes prevented, Add
Asset/Asset 360 regression green, Code Rule test gap closed, backend/
frontend/typecheck/E2E all green, browser/responsive/accessibility/
security checks performed, governance docs updated, report written) are
satisfied. Stopping here per §47 — AM-06 not started.
