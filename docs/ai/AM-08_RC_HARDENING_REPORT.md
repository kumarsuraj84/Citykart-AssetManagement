# AM-08 — Known-Issue Remediation + RC Hardening — Report

## 1. Executive summary

AM-08 fixed the three concrete defects AM-07's own mandatory browser UAT
discovered, then performed release-candidate hardening verification. Add
Asset's Cost Centre selector is now scoped to the asset's own company via a
new, opt-in `company_id` filter on the generic master list endpoint;
investigation against the actual schema (not the bug report's framing)
confirmed Category and Vendor are genuinely global masters with no
`company_id` column at all, so their unfiltered behavior was correctly left
unchanged rather than "fixed" against a fabricated assumption. Add Holder no
longer sends a `0` sentinel for an unselected Location: investigation
confirmed `Holder.location_id` is a required (`NOT NULL`) foreign key — it
was never actually optional, contrary to the original bug's framing — so the
frontend now correctly requires it, and the backend independently validates
company/location/department existence before insert, turning what used to
be an unhandled `IntegrityError`/500 into a controlled 422. Edit
Subcategory's dialog now shows its parent Category by name, via a small,
reusable `format` callback added to `MasterCrudScreen`'s read-only field
rendering — the same defect was found and fixed on Cost Centre's parent
Company too, the only other master with an immutable relational field. 9 new
backend tests, 5 new frontend tests, and 1 new E2E spec were added; every
pre-existing suite stays green (297/297 backend, 148/148 frontend, 5/5 E2E).
A live route-security sweep across ADMIN/IT_TEAM/VIEWER/HOLDER combinations
found no over-permission. A read-only database health snapshot found zero
integrity violations. Every remaining responsive/design evidence gap
(Locations/Departments/Cost Centres/Categories/Subcategories/Code Rule
responsive, Change Password design) was closed. No database migration was
needed. **CKAM V1 now enters feature freeze** — the next authorized stage is
a Release Candidate full-system audit, not a new feature build.

**Verdict: PASS.**

## 2. Git preflight

- Absolute repository/worktree path:
  `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build`.
- Current branch (at session start): `worktree-ckam-build`.
- Current HEAD (at session start): `a45fcb22daec3a98df6dcca6455c9f63a0a9e43b`.
- `git status` (at session start): clean, nothing to commit.
- `git log --oneline -15` (at session start): a linear history ending
  `a45fcb2` (AM-07 governance/report) → `9a5e7fc` (AM-07 E2E) → `73b1842`
  (AM-07 frontend) → `767609d` (AM-07 backend) → `c32d56a` (AM-06
  governance/report) → ... — matched the AM-07 report's own stated history
  exactly.
- `git log 9a5e7fc..HEAD` (at session start): exactly one commit,
  `a45fcb2` — the AM-07 governance/report commit itself, confirming no
  commits occurred after AM-07.
- Configured remotes: `origin` →
  `https://github.com/kumarsuraj84/Citykart-AssetManagement.git`. This
  worktree branch has never been pushed to it.
- Exact AM-07 report/governance commit: `a45fcb2`.
- Whether any commits occurred after AM-07: no.
- AM-07's three documented implementation commits were independently
  verified present in the log: Backend `767609d` ✓, Frontend `73b1842` ✓,
  E2E `9a5e7fc` ✓.

No unexpected commits, no dirty files. No `pull`/`push`/`merge`/`rebase`/
`reset`/branch-switch/`clean`/delete was performed at any point in this
stage.

## 3. Starting HEAD

`a45fcb22daec3a98df6dcca6455c9f63a0a9e43b` (`docs(ai): AM-07 report +
governance updates`).

## 4. Starting database state

Verified independently before any AM-08 change:

- `alembic heads` (inside the `api` container): `f28b6a913dce (head)` —
  matches the AM-07 report's stated baseline exactly.
- `ckam_test` current: `f28b6a913dce (head)`.
- Live `ckam` current: `f28b6a913dce (head)`.

## 5. Starting regression baseline

Independently re-run (not assumed from the AM-07 report) immediately before
any AM-08 change:

- Backend: 288/288 passing.
- Frontend: 143/143 passing (25 files), `npx tsc -b` clean.
- E2E: 4/4 passing.

All three matched the AM-07 report's stated baseline exactly.

## 6. Known issues accepted into AM-08

The three defects named in the authorization, each evidenced live during
AM-07's own mandatory browser UAT and recorded in `REVIEW_FINDINGS.md`
before this stage began:

1. Add Asset's Cost Centre (and, per the AM-07 report's own framing at the
   time, Category) selectors were not company-scoped.
2. Add Holder's Location `Select`, described as optional, sent `location_id:
   0` when left blank, causing an unhandled `ForeignKeyViolationError`/500.
3. Edit Subcategory's dialog showed the parent Category as a raw numeric id
   instead of its name.

Per §6-7 of the authorization, all three were re-investigated against the
actual schema and code before any fix was written, rather than accepted at
face value — see §7 and §11 below for where that investigation diverged
from the original framing.

## 7. Add Asset lookup/scoping audit

Read in full before any change: `AddAssetForm.tsx`, `app/masters/
models.py`, `app/masters/router.py` (`build_master_router`'s generic list/
create/update/delete), `app/masters/service.py` (`MasterCRUDService.
list_active`), `app/holders/router.py`'s `list_holders` (the existing
company-filter precedent), and every relevant model's actual columns.

| Add Asset lookup | Company-specific by schema? | Current frontend filtering (pre-AM-08) | Backend protection | AM-08 action |
|---|---|---|---|---|
| Company | N/A — fixed from login (`useAuthStore.companyId`); no selector exists in Add Asset at all | N/A | Login identity resolution | None |
| Cost Centre | **Yes** — `cost_center.company_id` (FK, `UniqueConstraint("company_id", "code")`) | None — `/masters/cost-centers` returned every company's rows | Write-path only (`ensure_company_in_scope`); asset creation independently rejects a mismatch (422) | **Fixed** |
| Category | **No** — `asset_category` has no `company_id` column at all; genuinely global | None (correct as-is) | N/A | None — confirmed correct, not fixed |
| Subcategory | No — scoped to `category_id`, not company | Already filtered to the selected Category | N/A | None |
| Vendor | **No** — `vendor` has no `company_id` column at all; genuinely global | None (correct as-is) | N/A | None — confirmed correct |
| Initial Holder | Yes — `holder.company_id` | Already filtered via `?holder_type=IT_STOCK&company_id=` | `_get_scoped_asset`/holder creation scoping | None — already correct |
| Custom Fields | Mixed (Global/company, AM-05) | Already filtered (`company_id === null \|\| company_id === companyId`) | `applicable_custom_fields` | None — already correct |

The authorization's own framing (§6-7) anticipated exactly this outcome and
explicitly instructed against fabricating Category scoping if the schema
didn't support it — that instruction is why only Cost Centre was changed.

## 8. Add Asset fix

`app/masters/service.py::MasterCRUDService.list_active` now accepts
optional `**filters` (`stmt.where(getattr(model, key) == value)` per
key), backward-compatible (the two existing call sites —
`build_master_router`'s own list endpoint and `custom_fields_router`'s
list endpoint — were unaffected since no caller previously passed
filters). `build_master_router`'s generic `GET` endpoint gained an
optional `company_id: int | None = Query(None)` parameter, applied as a
filter only when `company_scope == SCOPE_COMPANY_ID` and the parameter is
present — a `company_id` passed against a global master (Category, Vendor,
Location, Department) is silently ignored (no such column to filter on),
confirmed by a dedicated test. `AddAssetForm.tsx`'s `costCentersQ` now
queries `/masters/cost-centers?company_id=${companyId}` (the query key
includes `companyId` too). No other Add Asset lookup's query was changed.

## 9. Company-change dependent-field behavior

Investigated per §8 of the authorization and found not to apply: `routes/
assets/new.tsx` reads `companyId` once from `useAuthStore` and passes it to
`AddAssetForm` as a fixed prop — there is no Company `Select` anywhere in
the Add Asset form for a user to change. This holds for every role,
including ADMIN (who is otherwise company-unrestricted for reads/writes,
but still creates an asset only for their own logged-in company through this
form). No "clear the now-invalid dependent field" logic was therefore
needed or added. This is recorded as a durable decision in `DECISIONS.md`
so a future stage that *does* add a Company switcher to Add Asset knows the
clearing logic still needs to be designed then.

## 10. Add Asset backend security regression

Confirmed via the existing test suite (unchanged, all still passing) and
a live route-security sweep (§30): `ensure_company_in_scope` still rejects
a cross-company Cost Centre on `POST /api/assets` for a non-ADMIN caller;
`_get_scoped_asset`'s Holder/company checks are untouched; the
category/subcategory relationship validation used by both asset creation
and the AM-07 correction endpoint is untouched; `applicable_custom_fields`'
company-scoping rule is untouched. The AM-08 fix is read-side UX only — no
write-path authorization code was modified.

## 11. Holder Location root cause

Read in full: `app/holders/models.py::Holder` (`location_id: Mapped[int]`,
no `| None`), the original migration `0001_masters_and_holders.py`
(`sa.Column('location_id', sa.BigInteger(), nullable=False)`), `app/
holders/schemas.py::HolderIn` (`location_id: int`, no default — `
department_id: int | None = None` by contrast), and `HoldersScreen.tsx`'s
`buildPayload` (`location_id: Number(draft.location_id)`, where
`Number("")` evaluates to `0`).

**Root cause, confirmed from the schema, not assumed**: `location_id` is,
and always has been, a required field — the bug was never "the backend
doesn't accept a blank Location," it was "the frontend doesn't actually
require it despite the schema requiring it," letting an unselected
`Select` submit the numeric-coercion artifact `0` instead of being blocked.
This is the opposite of the authorization's own framing ("Location is
optional. This must be fixed.") — followed per its own explicit
instruction to resolve from actual schema/domain evidence over the
assumption baked into the bug description (§11: "Determine the canonical
representation of 'no Location': omitted field or null. Use the existing
backend schema contract."). The existing backend schema contract's answer
is: there is no legitimate "no Location" state for a Holder at all.

## 12. Holder frontend fix

`HoldersScreen.tsx`: Location's `FormField` gained `required` (matching
Company/Emp Code/Name/Type, which were also silently un-marked despite
being required by the same schema — fixed alongside, since leaving them
unmarked while marking only Location would have been visually
inconsistent and wouldn't have addressed the underlying "nothing actually
blocks Save" gap). A new `canSave` gate (`company_id !== "" && emp_code
non-blank && name non-blank && holder_type !== "" && location_id !== ""`)
disables the `AsyncButton` and short-circuits `handleSave` until satisfied
— the same pattern `AddAssetForm.tsx` already established. Department
remains genuinely optional (`department_id: int | None`) and was not
marked required. A `saveError` display (`createMutation.error ??
updateMutation.error`, `role="alert"`) was added — previously a failed
create/update had no visible error at all.

## 13. Holder backend defensive validation

New `_validate_holder_references` (`app/holders/router.py`), called from
both `create_holder` and `update_holder` before `HolderService.create`/
`update` ever touches the session: `session.get(Company, company_id)` and
`session.get(Location, location_id)` must both resolve to an active row
(422 `"company not found or inactive"` / `"location not found or
inactive"` otherwise); if `department_id` is provided (not `None`), it
must likewise resolve to an active `Department` (422 `"department not
found or inactive"`). Mirrors the existing `_validate_holder_fields`
pattern (validate before the service layer, never let a raw `DBAPIError`
reach the response) rather than catching the exception after the fact —
consistent with the guardrail against leaking database errors in API
responses. Verified live via a direct `fetch` call bypassing the frontend
entirely (`location_id: 0`): the API now returns `422 {"detail":"location
not found or inactive"}`, never a 500.

## 14. Holder company/location relationship findings

Investigated per §14 of the authorization: `Location` has no `company_id`
column at all — it is a genuinely global master, exactly like Category and
Vendor (§7). There is therefore no domain concept of "a Location belonging
to a Company" to validate against, and no such validation was implemented
— implementing one would have invented a business rule the schema doesn't
support, which the authorization explicitly warned against ("Do not invent
cross-company behavior without schema/domain evidence"). This was
confirmed live too: opening the Location dropdown for a Citykart-Stores
holder correctly lists every company's Locations (e.g. "Seed HO" ×8 plus
"Head Office"), matching the same global-master pattern already documented
for Category/Vendor.

## 15. Subcategory raw-id root cause

Read in full: `frontend/src/routes/setup/subcategories.tsx` (the
`category_id` `formFields` entry had no `format`, while the list `columns`
entry did — `format: categoryName`), and `MasterCrudScreen.tsx`'s
read-only-fields render block (`String((editRow as Record<string,
unknown>)[f.key] ?? "")` — always the raw value, with no way to plug in a
formatter at all). The root cause is that `FormField` (the `master-crud`
type, distinct from the shared `components/shared/FormField`) never had a
`format` property, unlike `Column`, which already had one and was already
correctly used for the list table's own Category column.

## 16. Subcategory presentation fix

`FormField` (`components/master-crud/types.ts`) gained an optional
`format?: (value: unknown, row: Record<string, unknown>) => string`,
mirroring `Column.format` exactly. `MasterCrudScreen.tsx`'s read-only
block now calls `f.format ? f.format(raw, row) : String(raw ?? "")`.
`subcategories.tsx`'s `category_id` `formFields` entry now passes
`format: categoryName` — the exact same function its `columns` entry
already used, no duplicated lookup logic. Category remains non-editable
(still absent from `editFields`), the underlying relationship and its
immutability are completely unchanged — this is presentation only.

## 17. Reusable immutable-reference presentation

Per §16 of the authorization, `MasterCrudScreen`'s generic mechanism was
checked before writing any Subcategory-specific code, and was extended
generically rather than worked around locally. The same defect exists on
exactly one other master: Cost Centre's `company_id` (its `formFields`
entry, like Subcategory's, had no `format` while its `columns` entry did)
— fixed identically, `cost-centers.tsx`'s `company_id` `formFields` entry
now passes `format: companyName`. No other master's `formFields` contains
an immutable relational field (Locations/Departments/Categories/Vendors
have no FK fields in their configs at all), so no further screens needed
the change. No generic metadata framework was built — the fix is one
optional callback property, reusing each screen's own already-existing
lookup function.

## 18. Database migration

**NONE.** All three fixes are frontend/API-validation/presentation
changes against existing structures — no schema was touched. Confirmed via
`alembic heads` before and after this stage's work: `f28b6a913dce (head)`,
unchanged.

## 19. Exact files changed

**Fixes + unit tests (commit `6107170`):**
- `backend/app/holders/router.py` (new `_validate_holder_references`,
  wired into `create_holder`/`update_holder`)
- `backend/app/masters/router.py` (`list_items` gained optional
  `company_id` query filter)
- `backend/app/masters/service.py` (`list_active` gained optional
  `**filters`)
- `backend/tests/holders/test_am08_location_validation.py` (new, 6 tests)
- `backend/tests/masters/test_am08_cost_center_scoping.py` (new, 3 tests)
- `frontend/src/components/master-crud/types.ts` (`FormField.format`)
- `frontend/src/components/master-crud/MasterCrudScreen.tsx` (read-only
  field rendering uses `format` when present)
- `frontend/src/components/master-crud/MasterCrudScreen.test.tsx`
  (extended, 1 new test)
- `frontend/src/features/assets/AddAssetForm.tsx` (Cost Centre query
  scoped by `company_id`, empty-state message)
- `frontend/src/features/assets/AddAssetForm.test.tsx` (extended, 2 new
  tests)
- `frontend/src/features/holders/HoldersScreen.tsx` (required markers,
  `canSave` gate, error display)
- `frontend/src/features/holders/HoldersScreen.test.tsx` (extended, 2 new
  tests)
- `frontend/src/routes/setup/cost-centers.tsx` (`format: companyName`)
- `frontend/src/routes/setup/subcategories.tsx` (`format: categoryName`)

**E2E (commit `ee53b5a`):**
- `frontend/e2e/add-asset-company-scoping.spec.ts` (new, 1 spec)

**Governance (this commit):**
- `docs/ai/DECISIONS.md`, `docs/ai/REVIEW_FINDINGS.md`,
  `docs/ai/UAT_MATRIX.md`, `docs/ai/CURRENT_STAGE.md`,
  `docs/ai/DESIGN_SYSTEM.md`,
  `docs/ai/AM-08_RC_HARDENING_REPORT.md` (this file)

No other file was touched. In particular, `app/assets/router.py`,
`app/assets/correction_service.py`, `app/lifecycle/service.py`,
`app/numbering/service.py`, `app/imports/asset_import_service.py`,
`app/reports/export_service.py`, and every migration are byte-for-byte
unchanged (confirmed via `git diff a45fcb2..HEAD -- <path>`, empty output
for each).

## 20. Backend tests

297/297 passing (288 baseline + 9 new, independently re-run this session).
New tests:
- `test_am08_cost_center_scoping.py` (3): cost centres filtered by a
  requested `company_id`; unfiltered when no `company_id` is given (the
  Setup screen's own usage, proving the default is unchanged); Category's
  endpoint silently ignores an irrelevant `company_id` param.
- `test_am08_location_validation.py` (6): `location_id: 0` rejected with a
  controlled 422 (the exact defect found live); a nonexistent
  `location_id` rejected likewise; `company_id: 0` rejected the same way
  (the identical sentinel risk on the other required FK); a nonexistent
  `department_id` rejected; a valid Location with `department_id: null`
  (genuinely optional) succeeds with `201`; the same validation applies to
  `PUT` — an invalid `location_id` on update is rejected and the holder's
  row is confirmed unchanged.

## 21. Frontend tests

148/148 passing (25 files; 143 baseline + 5 new, independently re-run this
session), `npx tsc -b` clean. New tests:
- `AddAssetForm.test.tsx` (2): Cost Centre options are requested scoped to
  the asset's own company (`/masters/cost-centers?company_id=1`); a company
  with zero active cost centres shows the new empty-state message and
  blocks Save with no `POST` fired.
- `HoldersScreen.test.tsx` (2): leaving Location blank keeps Save disabled
  and fires no `POST` even if clicked; a backend's controlled validation
  error (e.g. "location not found or inactive") renders inside the still-
  open dialog, not a crash or a silent failure.
- `MasterCrudScreen.test.tsx` (1): a read-only field with a `format`
  callback shows its human-readable label in the Edit dialog, not the raw
  stored id.

## 22. Typecheck

`npx tsc -b` — clean, zero errors, independently re-run this session.

## 23. E2E

5/5 passing (4 baseline + 1 new), independently re-run via `npx playwright
test`:
- `add-asset-company-scoping.spec.ts` — new: seeds one company (with its
  own Cost Centre, Category, Subcategory, IT_STOCK holder), creates a
  second, unrelated company plus its own Cost Centre purely to prove it
  never appears as an option, logs in as the first company's admin,
  confirms the Cost Centre dropdown shows only the first company's own
  option and not the second company's, selects it, completes the rest of
  the form (Category/Sub-Category/Goes Into — the seeded company's
  `CodeRule` template references `{subcategory.code}`, so Sub-Category had
  to be selected too, the same lesson AM-06's import E2E already
  documented), saves, and confirms the asset was created and its
  description renders on the new Asset 360 page.
- `asset-correction.spec.ts`, `asset-lifecycle.spec.ts`, `import.spec.ts`,
  `multi-company-udf.spec.ts` — all four pre-existing specs untouched and
  still green.

## 24. Browser UAT — Add Asset

Performed live as `UATADMIN` (ADMIN, Citykart Stores) against the existing
safe UAT masters from AM-07. Opened the Cost Centre dropdown on `/assets/
new`: before this stage's fix it listed 5 cost centres across 4 different
companies (confirmed in AM-07's own UAT); after the fix it shows exactly
one option, "UAT Cost Centre" — Citykart Stores' own, and only, cost
centre. Selected it without incident; Category's dropdown was re-checked
and confirmed to still list every company's categories (correct, unchanged
— global master).

## 25. Browser UAT — Holders

Performed live on `/setup/holders`. Opened Add User: Company/Emp Code/
Name/Type/Location all now show the required red asterisk, and Save starts
disabled (previously it started enabled with every field blank). Filled
Emp Code/Name/Company/Type, deliberately left Location unselected, and
confirmed Save stayed disabled; clicking it anyway produced no `POST
/api/holders` request in the network log (only pre-existing `GET`
requests). Selected a Location, clicked Save, and confirmed a real `201
Created` with the holder correctly persisted. Separately, via a direct
browser `fetch` call bypassing the UI entirely (reusing the session's own
token), confirmed `POST /api/holders` with `location_id: 0` now returns
`422 {"detail":"location not found or inactive"}` — never a raw 500.

## 26. Browser UAT — Subcategories

Performed live on `/setup/subcategories`. Opened the Edit dialog for the
existing "AM04 Test Subcategory" row: the read-only block now shows
"Category: AM04 Test Category" (previously the raw id "11"), with "Code:
AM4SUB" alongside it — Category remains non-editable ("Not editable after
creation."). Saved a no-op edit (clicked Save without changing the Name)
to confirm the save path still works (`PUT /api/masters/subcategories/11
→ 200`). Separately confirmed the identical fix on `/setup/cost-centers`'
Edit dialog: "Company: Citykart Stores" now shown, not a raw id.

## 27. Error-handling verification

Verified for all three affected flows that no ordinary user-input path
produces a raw/unhandled 500, `ForeignKeyViolationError`, `IntegrityError`,
or traceback text: Add Asset's Cost Centre change is purely additive (a
new, narrower option list) and introduces no new error path. Add Holder's
blank-Location submission is now blocked entirely client-side (no request
at all), and a direct API bypass with an invalid `location_id`/
`company_id`/`department_id` now returns a plain-language 4xx
(`"location not found or inactive"`, etc.) instead of a raw database
error, confirmed live. Edit Subcategory's fix is read-only presentation
and introduces no new error path at all. No server error was globally
masked — only the three specific, evidenced Holder foreign-key cases gained
narrow pre-validation, exactly as the authorization's §13 scoped it.

## 28. Responsive verification

All checked live at 1440×900, 768×1024, and 375×812 (`document.body.
scrollWidth === window.innerWidth` at every width, plus a visual
screenshot pass on the three AM-08-changed surfaces):

- **Add Asset**: clean at all 4 breakpoints (1440/1024/768/375); the new
  Cost Centre empty-state message wraps correctly at 375px.
- **Holders (Add User dialog)**: clean at 375px — required asterisks
  legible, Save (disabled) renders full-width.
- **Subcategories (Edit dialog)**: clean at 375px — "Category: AM04 Test
  Category" wraps correctly, no overflow.
- **Locations, Departments, Cost Centers, Categories, Code Rule**
  (previously 🟡 Responsive from AM-07): all confirmed clean at
  1440/768/375 — closing the AM-07-deferred gap.
- Mobile sidebar behavior was not touched by any AM-08 change and was not
  re-verified beyond confirming no page-level overflow appeared on any of
  the above routes.

## 29. Accessibility

Verified by construction — every AM-08 change reused an existing,
already-accessible pattern rather than introducing a new one: the newly
`required` Holder fields use the same shared `FormField` `required` prop
(a red asterisk plus a proper `<Label htmlFor>` association) every other
required field in the app already uses; the new error messages use
`role="alert"`, matching `AddAssetForm.tsx`'s own existing convention; the
Cost Centre/Location `Select` triggers keep their existing `aria-label`;
the Subcategory/Cost-Centre read-only Category/Company text remains a
plain, non-interactive row (unchanged from before AM-08 — only its
*content* changed, not its semantics), so it is not focus-confusing and
introduces no new clickable non-semantic element. No new accessibility
regression is possible from a diff this narrow, and none was observed
live.

## 30. Route-security evidence sweep

Performed as a live, direct-API battery (not merely reading tests) against
two freshly-created, temporary UAT accounts (one VIEWER, one HOLDER, both
in Citykart Stores, deactivated again immediately after the sweep) plus the
existing ADMIN session, covering:

| Check | Result |
|---|---|
| `GET /api/assets` (register) as VIEWER | 200 (scoped by `scoped_company_ids`) |
| `GET /api/assets` (register) as HOLDER | 200 (`holder_id` pinned server-side to own id — confirmed by reading `list_assets`, not assumed from the status code alone) |
| `POST /api/assets` (create) as VIEWER / HOLDER | 403 / 403 |
| `GET /api/holders` (list) as VIEWER | 200 (VIEWER is in `STAFF_ROLES`, an existing, already-tested design choice) |
| `GET /api/holders` (list) as HOLDER | 403 |
| `POST /api/holders` (create) as VIEWER | 403 |
| `DELETE /api/masters/companies/{id}` as VIEWER | 403 |
| `POST /api/masters/cost-centers` as VIEWER / HOLDER | 403 / 403 |
| `GET /api/reports/export/assets` as HOLDER | 200 (same `holder_id`-pinning as the register — confirmed against `export_assets`'s own docstring and code) |
| `GET /api/reports/export/assets` as VIEWER | 200 (company-scoped, correct for VIEWER's documented reports access) |
| `POST /api/assets/{id}/corrections` as VIEWER | 403 |
| `GET /api/masters/companies` as HOLDER / VIEWER | 200 / 200 (a global-read master list, unrestricted by design for any authenticated user — pre-existing, unrelated to AM-08) |

**No true over-permission was found.** The two results that looked
surprising at first glance — a HOLDER getting `200` on the Asset Register
and Reports-export endpoints — were verified, by reading the actual
scoping code in both `app/assets/router.py::list_assets` and `app/
reports/router.py::export_assets`, to be deliberately and correctly
scoped: a HOLDER's `holder_id` is pinned server-side to their own id
regardless of any value they pass, so both endpoints only ever return the
assets they currently hold — the exact mechanism My Assets itself is built
on, not a gap. No authorization code was changed as a result of this
sweep. `POST /api/masters/cost-centers`/`companies` writes, tested
representatively, share the identical `build_master_router`/
`require_role("ADMIN", "IT_TEAM")` code path with every other master
(Locations, Departments, Categories, Subcategories, Vendors) — a defect in
one would be a defect in all, since it is the same function, not
per-master duplicated logic.

## 31. DB health snapshot

Read-only verification against the live `ckam` database:

- Alembic head/current: `f28b6a913dce` (both match).
- Core table row counts: `company` 75, `holder` 232, `asset` 53,
  `asset_event` 116, `asset_field_change` 22, `cost_center` 61,
  `asset_category` 62, `asset_subcategory` 62, `location` 61, `department`
  61, `vendor` 1, `custom_field` 23.
- Duplicate Asset Codes: **0**.
- Cross-company `asset.company_id` vs. `cost_center.company_id` mismatch:
  **0**.
- Invalid `asset.category_id`/`subcategory_id` pairing (a subcategory not
  belonging to its asset's category): **0**.
- Orphaned `asset.current_holder_id` (referencing a nonexistent holder):
  **0**.
- Orphaned `asset_event.asset_id`: **0**.
- Orphaned `asset_field_change.asset_id`: **0**.

No integrity defect was found. No data was modified during this snapshot.

## 32. Closed-value DB observation

Verification only, per the authorization's explicit "do NOT add new CHECK/
ENUM constraints in AM-08." Distinct live values queried directly:
`asset.status` → `{ALLOTTED, IN_STOCK}`; `asset_event.event_type` →
`{IMPORTED, MOVED, PROCURED}`; `asset_event.status_after` → `{ALLOTTED,
IN_STOCK}`; `asset_document.doc_type` → (table currently empty, 0 distinct
values). Every value present is within the currently-recognized set for
its column — no unexpected/invalid value exists in the live data today.
This finding is recorded, not acted on; the 5-column gap remains open in
`REVIEW_FINDINGS.md` exactly as before.

## 33. Performance/network observations

The Cost Centre company-scoping change adds no new request pattern — it is
the same single `GET /masters/cost-centers` request Add Asset already made,
now with one additional query parameter; no per-option request, no
refetch loop, no new cascading query was introduced (confirmed by reading
the diff: `costCentersQ`'s `queryFn` and `queryKey` changed, its
invocation count did not). The Holder form's new `canSave` gate is a pure
client-side boolean computed from already-held `draft` state — no
additional network call. The `MasterCrudScreen` `format` callback change
adds no network call at all (it operates on data already in memory from
the existing list query). No performance regression is possible from a
diff this narrow, and none was observed during live browser UAT.

## 34. UAT_MATRIX changes

Updated: added the AM-08 summary paragraph. Security upgraded from 🟡 to
✅ for `/dashboard`, `/assets`, `/assets/new`, `/assets/$id`, `/my-assets`,
`/setup/companies`, `/setup/locations`, `/setup/departments`, `/setup/
cost-centers`, `/setup/categories`, `/setup/subcategories`, `/setup/
vendors`, `/setup/holders`, each with a specific note on what was directly
exercised or why the shared code path extends the evidence. Responsive
upgraded from 🟡 to ✅ for `/setup/locations`, `/setup/departments`,
`/setup/cost-centers`, `/setup/categories`, `/setup/subcategories`,
`/setup/code-rule`. Design upgraded from 🟡 to ✅ for `/change-password`.
E2E/Backend/Frontend summary counts updated to 5/5, 297/297, 148/148.

## 35. REVIEW_FINDINGS resolved

Removed from open Technical findings, moved to "Resolved this session":
Add Asset's Cost Centre company-scoping gap (with the corrected finding
that Category was never actually broken), the Add Holder `location_id=0`/
500 bug (with the corrected finding that Location was never actually
optional), and the Edit Subcategory raw-parent-id display bug (fixed on
both Subcategory and Cost Centre). A new entry records the route-security
sweep's outcome (no over-permission found, with the specific reasoning for
the two results that needed a closer look) for traceability.

## 36. REVIEW_FINDINGS still open

Kept open, unchanged in substance, only their "still open as of" stage
reference advanced to AM-08: `scoped_company_ids` not incorporating
`HolderCompanyAccess` grants (item 1), the 5 unconstrained closed-value DB
columns (item 2, now additionally carrying this stage's health-snapshot
evidence that current live values are all valid), and no import-side
duplicate detection (item 3).

## 37. DECISIONS changes

A new, dated top section ("2026-09-24 — AM-08 scope locked...") was added
with 7 numbered durable decisions: the schema-evidenced company-scoping
rule for Add Asset's dependent masters, the "no Company selector exists"
finding, the schema-evidenced Holder-Location-is-required correction, the
new defensive backend validation, the reusable read-only `format`
mechanism, the feature-freeze declaration, and the explicit list of
business decisions that remain deferred and untouched. See §7-17 above for
the full reasoning behind each.

## 38. DESIGN_SYSTEM changes

Two new sections replaced the AM-07 "Known gaps" list (all three of its
items are now fixed): "Read-only immutable relational fields in
MasterCrudScreen (AM-08)" documents the `format`-callback pattern and
instructs reusing a screen's existing list-column lookup function rather
than duplicating it; "Company-scoped vs. global master lookups (AM-08)"
documents which masters are genuinely company-owned by schema (Cost
Centre, Custom Field) versus genuinely global (Category, Subcategory,
Location, Department, Vendor), so a future screen doesn't need to
re-derive this from scratch or guess from observed UX.

## 39. CURRENT_STAGE / Feature Freeze

Stage line advanced to "AM-08 (Known-Issue Remediation + RC Hardening) —
complete, PASS," with an explicit **FEATURE FREEZE ACTIVE** line. Next
line advanced to "AM-09 — Release Candidate full-system UAT / security /
database / backup-recovery / deployment-readiness audit, awaiting explicit
authorization," with the full list of out-of-scope items repeated
verbatim so a future session cannot start any of them "automatically." A
new "What's actually done as of AM-08" section mirrors the existing
per-stage sections for AM-01 through AM-07.

## 40. Deviations from approved scope

None. Every implementation decision traces to an explicit authorization
section. The two places where investigation diverged from the
authorization's own framing (Category needing company-scoping; Location
being optional) were exactly the kind of evidence-over-assumption
resolution the authorization itself explicitly instructed for in §7 and
§11 — not a deviation from scope, a fulfillment of it. Two small, safe,
reversible pieces of test setup (one temporary VIEWER holder, one
temporary HOLDER holder, both in `UATADMIN`'s own company, both
deactivated again immediately after the route-security sweep) were created
purely to exercise the live API battery in §30 — environment preparation,
not a scope change, touching no genuine business data.

## 41. Issues discovered but not changed

None newly discovered this stage. The route-security sweep (§30) and DB
health snapshot (§31) both came back clean — no new defect to document.

## 42. Remaining business decisions

Unchanged from AM-07, still requiring CityKart's own answer, not a
technical one: (1) `holder_company_access` — is the asset/IT team
organizationally shared across companies, or is this dormant scaffolding?
(2) Import-side duplicate detection — is there an actual business
definition of "duplicate" (legacy code? serial number? PO/invoice/PI
number?) worth enforcing? (3) Whether the 5 unconstrained closed-value
columns should ever gain a DB-level CHECK/ENUM, likely tied to whether a
future stage adds an approval workflow that needs new legal values.

## 43. Recommended AM-09 scope

The authorization's own instruction: AM-09 is the Release Candidate
full-system UAT / security / database / backup-recovery / deployment-
readiness audit — not a new feature stage. In rough priority order for
that audit: (1) exercise the actual backup/restore cron (`docker-compose`'s
`backup` service) end to end at least once, since AM-08's DB health
snapshot only verified current-state integrity, not recovery; (2) a wider
role-matrix security pass than AM-08's representative sweep, potentially
scripted for repeatability; (3) a deployment-configuration review
(`JWT_SECRET`, `COOKIE_SECURE`, container resource limits) against a real
LAN deployment target, not just the dev stack.

## 44. RELEASE-CANDIDATE READINESS SUMMARY

**FUNCTIONAL:** READY. 297 backend + 148 frontend + 5 E2E all passing,
independently re-run this session; the three known defects are fixed and
verified live.

**DATA INTEGRITY:** READY. The AM-08 health snapshot found zero
duplicate-Asset-Code, cross-company, invalid-pairing, or orphaned-FK rows
across every checked relationship; append-only triggers on `asset_event`/
`asset_field_change` and the identity-protection trigger on `asset` remain
unmodified and were not touched by any AM-08 change.

**AUTHORIZATION:** READY. The AM-08 route-security sweep found no
over-permission across ADMIN/IT_TEAM/VIEWER/HOLDER on asset writes, holder
writes, master writes, corrections, and reports exports; the two results
that needed closer inspection were confirmed correct by reading the actual
scoping code, not by trusting the status code alone.

**UI/RESPONSIVE:** READY. Every route in `UAT_MATRIX.md` now carries ✅
Responsive evidence (Change Password's Design gap and the 6 remaining
Setup routes' Responsive gaps, both carried since AM-06/AM-07, are closed
this stage) except the routes marked N/A where responsive checking does
not apply.

**REGRESSION:** READY. All four pre-existing E2E specs remain green
unmodified; every pre-AM-08 backend and frontend test still passes; no
existing behavior was found to have changed as a side effect of any AM-08
fix.

**KNOWN RELEASE BLOCKERS:** NONE.

**DEFERRED NON-BLOCKERS:** `holder_company_access` unresolved (business
decision needed); no import-side duplicate detection (business decision
needed); 5 closed-value DB columns remain unconstrained at the schema
level (current live data confirmed clean, but the constraint itself is
deferred); no bulk correction workflow in V1 (by design).

## 45. REPORT CONTENT HEAD

`ee53b5a` (the last commit before this report/governance commit —
`test(e2e): AM-08 -- Add Asset company-scoped Cost Centre journey`).

## 46. REPORT COMMIT

TO BE FILLED IN CHAT AFTER COMMIT.

## 47. Final verdict

**PASS.** All items in the AM-08 completion gate are satisfied: git
baseline verified against the AM-07 report's stated head, with the actual
AM-07 report commit/current HEAD independently resolved from git (not
assumed); backend/frontend/E2E baseline independently re-verified before
any change; the Add Asset lookup scope was audited from the actual schema,
not the bug report's assumption, and only Cost Centre — the one lookup
genuinely needing it — was fixed; dependent-selection clearing on a
Company change was investigated and found not to apply (no such selector
exists); no invalid cross-company frontend selection can survive (Cost
Centre is now scoped, and the backend's write-path validation is
untouched and still authoritative); optional Holder Location no longer
sends a `0` sentinel — it is now correctly required, matching the schema
it was always bound by; an invalid Location/Company/Department now
produces a controlled 4xx, verified live via a direct API bypass, never a
raw 500; Holder authorization is unmodified and reconfirmed by the
route-security sweep; Subcategory's parent Category (and Cost Centre's
parent Company) now show a human-readable label, still immutable; no
database migration was needed or made; the backend suite (297), frontend
suite (148), and typecheck are all green; all four pre-existing E2E specs
plus one new focused E2E are green; real-browser UAT was performed live
for all three fixes; the full responsive evidence sweep, the Change
Password design check, and the Code Rule responsive check are all
complete; the security evidence sweep is complete and found no
over-permission; the RC database health snapshot is complete and clean;
`REVIEW_FINDINGS.md`, `UAT_MATRIX.md`, `DECISIONS.md`, and
`CURRENT_STAGE.md` are all updated honestly; Feature Freeze is recorded;
this report exists and will be delivered as a downloadable file; no push
was performed; AM-09 was not started.
