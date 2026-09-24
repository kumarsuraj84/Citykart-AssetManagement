# CKAM — UAT Matrix

**AM-01 (2026-09-24) was a backend-only data-integrity stage** — indexes,
historical event name snapshots, company/cost-centre integrity test
coverage. No screen, route, or UI behavior changed, so the per-route rows
below are unchanged from AM-00 except the Asset Detail row's timeline
display (still functionally ✅, now additionally backed by snapshot-correct
history — no new UAT category needed, this is a backend truthfulness fix,
not a visible UI change). See `AM-01_DATA_INTEGRITY_REPORT.md` for the full
backend verification evidence (170/170 tests, migration + trigger + index
verification on both databases).

**AM-02 (2026-09-24) was also a backend-only stage** — expanded `AssetOut`,
a new `PUT /api/assets/{id}` endpoint, custom-field value validation, and
closed-value validation/CHECK constraints. No UI redesign, no frontend file
touched at all (confirmed — see `AM-02_ASSET_DATA_MODEL_REPORT.md` §24), so
the per-route rows below are unchanged from AM-01. The Add Asset, Asset
Detail, and Register screens still only render the original field subset —
the newly-exposed procurement/custom-field data has no UI consumer yet by
design (AM-02 explicitly deferred UI wiring). Full backend verification:
184/184 tests, migration + trigger verification on both databases.

**AM-03 (2026-09-24) migrated Dashboard and Asset Register to the new shared
UI foundation** (`PageHeader`/`DataTable`/`StatusBadge`/`EmptyState`/
`ErrorState`/`AsyncButton`) and fixed Asset Register's row navigation to use
the SPA router instead of `window.location.href`. No backend change, no
migration. Only these two rows change below; every other route is
unchanged from AM-02 and still needs its own UAT pass in a future stage.

**AM-04 (2026-09-24) redesigned Add Asset and Asset Detail (now "Asset
360")** onto the shared foundation, wired procurement/PI Number/UDF fields
into both, added the field-change audit ("Changes" tab), and added a
role-gated Edit mode. One new backend table + migration
(`asset_field_change`, `a409768dc2cf`). Real-browser UAT surfaced and fixed
two genuine layout bugs (see `AM-04_ASSET_ENTRY_360_REPORT.md` §14/§32):
Asset 360's `TabsList` had no horizontal-scroll container of its own, and
the app shell's `SidebarInset`/`<main>` had no `min-w-0`, so content dense
enough (Asset 360's header actions row) could force the whole page wider
than the viewport at 768px specifically (sidebar docked, narrow width) —
fixed in the shared `components/ui/sidebar.tsx`, verified not to regress
Dashboard/Asset Register/Add Asset at the same width.

**AM-05 (2026-09-24) turned the setup/admin area into an operational
surface**: every simple master (`MasterCrudScreen`) gained Edit (previously
Create+Deactivate only) on the shared PageHeader/DataTable/EmptyState/
ErrorState/AsyncButton/FormField foundation, with immutable fields (`code`,
a company/category relationship) shown read-only rather than silently
omitted; Deactivate now confirms and names the record. Custom Fields moved
off the generic pattern onto its own screen with a Global/company Scope
selector, immutable field_key/field_type, and a stronger confirmation
before flipping a field required (naming every company for a Global field,
the one company for a scoped field). Holders gained the Deactivate action
it previously lacked and a visible role-change warning. Code Rule gained a
loading/error state. `CustomField.company_id` (migration `370399c6380e`)
closes the AM-04-discovered risk where a required field created for one
company blocked asset creation in every company — Add Asset/Asset 360 now
only ever see Global + their own company's definitions.

**AM-06 (2026-09-24) closed the gap between manual Add Asset and Excel
Import/Export** so both use the same V1 asset data model: Import now
supports every procurement field (Vendor, PO/Invoice/PI Number+Date,
Purchase Cost/Tax %, Brand/Model/Serial/Warranty), Quantity (multi-create
per row), and company-scoped Custom Fields via a `Custom:<field_key>`
column, all reusing AM-05's applicable_custom_fields/
validate_custom_field_values rather than a parallel rules engine. The
asset register export gained the same full field set plus Custom Field
columns with human-readable labels throughout; a new, separate field-
change-audit export was added; the movement log export is unchanged.
Import, Reports, and My Assets all moved onto the shared PageHeader/
DataTable/EmptyState/ErrorState/AsyncButton/FormField foundation — the
last three routes outside it. My Assets' hardcoded `text-blue-600` link
color is gone, and it now has real loading/error/empty states (previously
none at all — a failed fetch silently rendered an empty table
indistinguishable from "you truly have zero assets"). No database
migration (procurement fields and Custom Fields already existed).

**AM-07 (2026-09-24) added a controlled Category/Subcategory/Purchase-Date
correction workflow to Asset 360** — a dedicated "Correct Classification"
action (ADMIN/IT_TEAM only), separate from ordinary Edit mode, with a
mandatory Reason, an Impact Summary before Confirm, and Asset Code shown
read-only. One additive migration (`f28b6a913dce`, nullable
`asset_field_change.reason`). Also performed the AM-06-deferred verification
sweep: `/reports` responsive, `/change-password` security/responsive, and a
fresh spot-check of the remaining `MasterCrudScreen` routes — no redesign,
evidence only, two minor pre-existing UI bugs found and documented (not
fixed, out of AM-07 scope) — see `REVIEW_FINDINGS.md`.

**AM-08 (2026-09-24) fixed the three known defects AM-07's own UAT
discovered** (Add Asset's Cost Centre not company-scoped, Add Holder's
blank-Location `0` sentinel, Edit Subcategory's raw parent-Category id) and
performed RC-hardening verification: a live API route-security sweep across
representative ADMIN/IT_TEAM/VIEWER/HOLDER role combinations (no
over-permission found — see `REVIEW_FINDINGS.md`), a full responsive sweep
of every remaining `MasterCrudScreen` route plus Code Rule at
1440/768/375, a Change Password visual-consistency check against Login, and
a read-only RC database health snapshot (zero integrity violations across
duplicate-Asset-Code, cross-company cost-centre/holder, category/subcategory
pairing, and orphan-FK checks). CKAM V1 enters feature freeze after this
stage — see `CURRENT_STAGE.md`.

Legend: ✅ verified this session · 🟡 spot-checked only (not full UAT) · ⬜ not yet checked · N/A not applicable

Functional = backend/frontend tests pass. Design = real-browser visual check.
Security = authz/scoping verified. Responsive = checked at 1440/768/375.

| Route | Functional | Design | Security | Responsive | Notes |
|---|---|---|---|---|---|
| `/login` | ✅ | ✅ | ✅ | ✅ | Full UAT: keyboard nav, Enter-submit, validation errors, failed-login banner, all 3 breakpoints, real login verified with owner account |
| `/change-password` | ✅ | ✅ | ✅ | ✅ | AM-07 verification sweep: confirmed no horizontal overflow at 1440/768/375 (`document.body.scrollWidth === window.innerWidth` at all three); confirmed empty-form submit is blocked client-side with no network request fired; confirmed fields are keyboard-focusable; route requires an authenticated session (backend-regression-only, no new endpoint). AM-08: Design closed — visually compared against Login at 1440/768/375, same centered-card layout, logo, spacing, labeled fields, and dark navy submit action; no redesign needed |
| `/dashboard` | ✅ | ✅ | ✅ | ✅ | AM-03: migrated to shared foundation, fixed the stuck-on-Loading-forever bug (now shows a real error state with retry); verified in-browser at 1440/1024/768/375 with real live data. AM-08: Security closed — the dashboard's own reports endpoints (`require_role(*STAFF_ROLES)`) were exercised live via direct API calls as VIEWER/HOLDER during the route-security sweep, no over-permission found (see `REVIEW_FINDINGS.md`) |
| `/assets` (register) | ✅ | ✅ | ✅ | ✅ | AM-03: migrated to shared foundation; row click now uses the SPA router (confirmed via network log — no document reload); checkbox click confirmed not to trigger row navigation; verified in-browser at 1440/1024/768/375 — table uses intentional horizontal scroll at 375, no clipped content. AM-08: Security closed — `GET /api/assets` exercised live as VIEWER (200, company-scoped) and HOLDER (200, pinned to their own held assets only, confirmed against `list_assets`' actual scoping code, not just the response) during the route-security sweep |
| `/assets/new` (Add Asset) | ✅ | ✅ | ✅ | ✅ | AM-04: full sectioned redesign; verified in-browser at 1920/1440/1366/1024/768/375 with real created data; required-UDF error and server-validation-error both confirmed live. AM-05: Custom Fields section filters to Global + this asset's company only, verified live + E2E + 9 backend + 1 frontend regression test. AM-08: fixed the Cost Centre company-scoping bug found in AM-07 (verified live: only the current company's own cost centre now appears, plus a new dedicated E2E journey); Security closed — `POST /api/assets` exercised live as VIEWER and HOLDER (both 403) during the route-security sweep |
| `/assets/$id` (Asset Detail → Asset 360) | ✅ | ✅ | ✅ | ✅ | AM-04: full redesign, `return null` loading bug fixed; verified in-browser at all 6 breakpoints; Edit mode exercised end-to-end. AM-05: Edit mode's Custom Field controls apply the Global+own-company filter, verified by a dedicated frontend regression test. AM-07: "Correct Classification" action verified live end-to-end (two real corrections against `AM04UAT/2`, Impact Summary, Changes-tab distinct rendering, History byte-identical before/after, ordinary Edit mode confirmed to expose none of the three fields); dialog verified with no overflow at 1440/1024/768/375. AM-08: Security closed — `POST /api/assets/1/corrections` exercised live as VIEWER (403) during the route-security sweep, alongside the 30 AM-07 backend authorization tests |
| `/my-assets` | ✅ | ✅ | ✅ | ✅ | AM-06: migrated to shared foundation; real loading skeleton and error+retry added; hardcoded link color replaced. A Category column was tried, then removed after live UAT caught it showing a raw numeric id for a deactivated category. AM-08: Security closed — `/my-assets` reuses `GET /api/assets` with a HOLDER's `holder_id` pinned server-side to their own id (same code path exercised live as HOLDER during the route-security sweep, confirmed against the actual scoping code, not assumed) |
| `/import` | ✅ | ✅ | ✅ | ✅ | AM-06: full redesign — 4-step hierarchy (template/choose+preview/review/result) on the shared foundation; verified in-browser (template download succeeded live, full preview→commit→Asset-360 journey proven by a new E2E spec using a real generated fixture); verified no overflow at 375px and 768px; security verified by 19 new backend tests (procurement/UDF/quantity/cross-company rejection) plus the existing company-scope-on-commit tests, unchanged |
| `/reports` | ✅ | ✅ | ✅ | ✅ | AM-06: added a third card (Field Change Audit) and Status/Category filters on the Asset Register export; every download now goes through `AsyncButton`; verified in-browser — all three exports (Asset Register, Movement Log, Field Change Audit) downloaded successfully live; security verified by 8 new backend tests (field-change export company scoping, HOLDER role denied) plus the pre-existing asset/movement export scoping tests, unchanged. AM-07: closed the AM-06 Responsive gap — verified no horizontal overflow at 1440/768/375 (`document.body.scrollWidth === window.innerWidth` at all three; cards stack correctly and buttons stay full-width at 375), no redesign needed |
| `/setup/companies` | ✅ | ✅ | ✅ | ✅ | AM-05: `MasterCrudScreen` on shared foundation; Edit dialog verified live (immutable Code shown read-only, Name editable), Deactivate confirmation verified. AM-08: Security closed — `DELETE /api/masters/companies/2` exercised live as VIEWER (403) during the route-security sweep, matching the 15 AM-05 authz tests; Responsive: 1440/768/375 all clean (`scrollWidth === innerWidth`) |
| `/setup/locations` | ✅ | ✅ | ✅ | ✅ | AM-07: opened live — list renders correctly, Edit dialog shows immutable Code read-only, Name editable; same `MasterCrudScreen` as Companies/Categories/etc, `editFields: [name, address]`. AM-08: Responsive closed — 1440/768/375 all clean; Security closed — `Location` is a global master (`SCOPE_NONE`, same `build_master_router` write-gating code path as Categories/Departments/Vendors, exercised representatively via Cost Centers/Companies in the route-security sweep — VIEWER/HOLDER denied 403 on every write) |
| `/setup/departments` | ✅ | ✅ | ✅ | ✅ | AM-07: opened live — list renders correctly (`editFields: [name]`). AM-08: Responsive closed — 1440/768/375 all clean; Security closed, same reasoning as Locations (global master, shared write-gating code) |
| `/setup/cost-centers` | ✅ | ✅ | ✅ | ✅ | AM-07: opened and used live (Add Cost Centre exercised to create a safe UAT cost centre); company relationship immutable, verified via `test_company_scoped_writes.py`. AM-08: Responsive closed — 1440/768/375 all clean; Security closed — `POST /api/masters/cost-centers` exercised live as VIEWER and HOLDER (both 403) during the route-security sweep; the read-only Edit dialog's Company field now shows its name, not a raw id (fixed alongside Subcategory's identical defect, see `REVIEW_FINDINGS.md`) |
| `/setup/categories` | ✅ | ✅ | ✅ | ✅ | AM-07: opened and used live (Category dropdown exercised repeatedly during correction-flow UAT). AM-08: Responsive closed — 1440/768/375 all clean; Security closed, same reasoning as Locations (global master, shared write-gating code) |
| `/setup/subcategories` | ✅ | ✅ | ✅ | ✅ | AM-07: opened live — category relationship immutable and correctly enforced; found (not fixed there) the Edit dialog's raw-parent-id display bug. AM-08: fixed — the Edit dialog now shows "AM04 Test Category" instead of "11" (verified live at 1440/1024/768/375, all clean); Security closed, same reasoning as Locations |
| `/setup/vendors` | ✅ | ✅ | ✅ | ✅ | AM-05: opened live — Edit dialog verified (Code read-only, Name/GSTIN/Contact Name/Phone/Email editable). AM-08: Security closed, same reasoning as Locations (global master, shared write-gating code) |
| `/setup/custom-fields` | ✅ | ✅ | ✅ | ✅ | AM-05: new bespoke screen opened live — created a Global text field, verified Scope/required-confirmation behavior, no horizontal overflow at 375px; security verified by 15 backend tests |
| `/setup/holders` | ✅ | ✅ | ✅ | ✅ | AM-05: bespoke component, opened live — Edit dialog, Role warning, Deactivate all verified; IT_TEAM confirmed unable to update/deactivate/reset-password. AM-07: Add User exercised live; found (not fixed there) the blank-Location `0`-sentinel 500. AM-08: fixed — Location is now a required field (Save disabled until set, verified live: filling every other field and leaving Location blank kept Save disabled and fired no request), and a direct API call with `location_id: 0` now returns a controlled `422` instead of a 500 (verified live via direct fetch); Security closed — `POST /api/holders` exercised live as VIEWER (403) during the route-security sweep |
| `/setup/code-rule` | ✅ | ✅ | N/A | ✅ | AM-05: added loading skeleton + error/retry state without changing numbering semantics; `get_active_rule` ordering gap closed with 5 new dedicated backend tests. AM-08: Responsive closed — verified live at 1440/768/375, form/preview/template text/buttons all render correctly, no overflow at any width |
| App shell (sidebar/header) | ✅ | ✅ | N/A | ✅ | Verified expanded, collapsed-to-icons, and mobile drawer; role-gated nav content covered by `router.test.tsx` |

**E2E (Playwright):** 5/5 passing — the existing `full custody journey`,
`multi-company-udf`, `import journey`, and `asset correction journey` specs
are untouched and still green, plus a new AM-08 `Add Asset company-scoped
Cost Centre journey` (`e2e/add-asset-company-scoping.spec.ts`): seeds a
company, creates a second unrelated company purely to prove its cost
centre never appears as an Add Asset option for the first company's ADMIN,
then completes a real asset creation end to end through the
now-correctly-scoped form. All five specs clean up everything they create.

**Backend:** 297/297 passing (was 288/288 at AM-07, 258/258 at AM-06,
231/231 at AM-05, 199/199 at AM-04, 184/184 at AM-03, 170/170 at AM-01,
163/163 at AM-00 — +9 new AM-08 tests: Cost Centre company-id list
filtering, Holder location/company/department reference validation — see
`AM-08_RC_HARDENING_REPORT.md` §20-21).
**Frontend:** 148/148 passing (25 files, up from 143 at AM-07 — +5 new
AM-08 tests: Add Asset company-scoped Cost Centre + empty state, Holder
blank-Location block + controlled-error display, MasterCrudScreen
read-only `format` rendering), `npx tsc -b` clean.
