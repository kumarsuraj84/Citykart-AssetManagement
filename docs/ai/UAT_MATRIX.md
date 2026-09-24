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

Legend: ✅ verified this session · 🟡 spot-checked only (not full UAT) · ⬜ not yet checked · N/A not applicable

Functional = backend/frontend tests pass. Design = real-browser visual check.
Security = authz/scoping verified. Responsive = checked at 1440/768/375.

| Route | Functional | Design | Security | Responsive | Notes |
|---|---|---|---|---|---|
| `/login` | ✅ | ✅ | ✅ | ✅ | Full UAT: keyboard nav, Enter-submit, validation errors, failed-login banner, all 3 breakpoints, real login verified with owner account |
| `/change-password` | ✅ | 🟡 | ✅ | ✅ | AM-07 verification sweep: confirmed no horizontal overflow at 1440/768/375 (`document.body.scrollWidth === window.innerWidth` at all three); confirmed empty-form submit is blocked client-side with no network request fired; confirmed fields are keyboard-focusable; route requires an authenticated session (backend-regression-only, no new endpoint). Not redesigned — verification only, per AM-07 §42 |
| `/dashboard` | ✅ | ✅ | 🟡 | ✅ | AM-03: migrated to shared foundation, fixed the stuck-on-Loading-forever bug (now shows a real error state with retry); verified in-browser at 1440/1024/768/375 with real live data; security is backend-regression-only (no new endpoint/authz surface), not a dedicated browser authz check |
| `/assets` (register) | ✅ | ✅ | 🟡 | ✅ | AM-03: migrated to shared foundation; row click now uses the SPA router (confirmed via network log — no document reload); checkbox click confirmed not to trigger row navigation; verified in-browser at 1440/1024/768/375 — table uses intentional horizontal scroll at 375, no clipped content; security is backend-regression-only, same caveat as Dashboard |
| `/assets/new` (Add Asset) | ✅ | ✅ | 🟡 | ✅ | AM-04: full sectioned redesign; verified in-browser at 1920/1440/1366/1024/768/375 with real created data (a full asset was actually saved through the form); required-UDF error and server-validation-error both confirmed live; security is backend-regression-only (role-gating covered by tests, not a dedicated browser authz walkthrough). AM-05: Custom Fields section now filters to Global + this asset's company only, verified live (created a Global field, confirmed it rendered) and by a dedicated E2E journey + 9 backend + 1 frontend regression test proving another company's required field never blocks Save |
| `/assets/$id` (Asset Detail → Asset 360) | ✅ | ✅ | 🟡 | ✅ | AM-04: full redesign, `return null` loading bug fixed; verified in-browser at all 6 breakpoints; Procurement/Custody/Custom-Fields/Changes tabs all confirmed showing real data; Edit mode exercised end-to-end (changed Brand, saved, confirmed refreshed display AND a new Changes-tab audit row); found and fixed 2 real responsive bugs during this UAT (see note above); security is backend-regression-only, same caveat as Add Asset. AM-05: Edit mode's Custom Field controls apply the same Global+own-company filter; a stored value under a now-other-company-scoped key remains visible read-only and is preserved (not dropped) on an unrelated save, verified by a dedicated frontend regression test. AM-07: new "Correct Classification" action verified live end-to-end on a real created UAT asset (`AM04UAT/2`) — button visible next to Edit for ADMIN, dialog prefilled with current Category/Sub-Category/Purchase Date, Asset Code shown read-only with "Asset Code will not change", Sub-Category options reacted correctly to a Category change, Impact Summary rendered accurately, Confirm Correction stayed disabled until Reason + an actual change were both present, two separate corrections both succeeded (200) and refreshed Overview/Procurement immediately, Changes tab showed a distinct "Correction" pill + reason for each field, History tab's event count and text were byte-identical before and after both corrections, ordinary Edit mode confirmed to expose no Category/Sub-Category/Purchase Date controls at all; dialog verified with no overflow at 1440/1024/768/375 (375 renders as a full-width stacked sheet); Escape and keyboard focus verified; security is backend-test-regression (30 new AM-07 tests: authorization, category/subcategory rules, Purchase Date chronology, audit, regression), not a dedicated per-role browser walkthrough (ADMIN visibility confirmed live; VIEWER/HOLDER omission confirmed by frontend unit tests, not re-driven in the browser this session) |
| `/my-assets` | ✅ | ✅ | 🟡 | ✅ | AM-06: migrated to shared foundation (PageHeader/DataTable/StatusBadge/EmptyState/ErrorState); real loading skeleton and error+retry added (previously none); hardcoded `text-blue-600` link replaced with the same unstyled SPA `<Link>` Asset Register uses; verified in-browser (clicked through to Asset 360) and at 375px (no overflow, confirmed via `document.body.scrollWidth`). A Category column was tried, then removed after live UAT caught it showing a raw numeric id for an asset whose category had since been deactivated (Asset Register itself has no Category column either — kept consistent); security is backend-regression-only, no scoping logic changed |
| `/import` | ✅ | ✅ | ✅ | ✅ | AM-06: full redesign — 4-step hierarchy (template/choose+preview/review/result) on the shared foundation; verified in-browser (template download succeeded live, full preview→commit→Asset-360 journey proven by a new E2E spec using a real generated fixture); verified no overflow at 375px and 768px; security verified by 19 new backend tests (procurement/UDF/quantity/cross-company rejection) plus the existing company-scope-on-commit tests, unchanged |
| `/reports` | ✅ | ✅ | ✅ | ✅ | AM-06: added a third card (Field Change Audit) and Status/Category filters on the Asset Register export; every download now goes through `AsyncButton`; verified in-browser — all three exports (Asset Register, Movement Log, Field Change Audit) downloaded successfully live; security verified by 8 new backend tests (field-change export company scoping, HOLDER role denied) plus the pre-existing asset/movement export scoping tests, unchanged. AM-07: closed the AM-06 Responsive gap — verified no horizontal overflow at 1440/768/375 (`document.body.scrollWidth === window.innerWidth` at all three; cards stack correctly and buttons stay full-width at 375), no redesign needed |
| `/setup/companies` | ✅ | ✅ | 🟡 | ✅ | AM-05: `MasterCrudScreen` on shared foundation; Edit dialog verified live (immutable Code shown read-only with explanatory text, Name editable), Deactivate confirmation verified (named the record, cancelled without side effect); security is backend-test-regression (15 new AM-05 authz tests), not a dedicated browser walkthrough per role |
| `/setup/locations` | ✅ | ✅ | 🟡 | 🟡 | AM-07: opened live — list renders correctly, Edit dialog opens with immutable Code shown read-only ("Not editable after creation."), Name editable; same `MasterCrudScreen` as Companies/Categories/etc, `editFields: [name, address]` |
| `/setup/departments` | ✅ | ✅ | 🟡 | 🟡 | AM-07: opened live — list renders correctly (`editFields: [name]`) |
| `/setup/cost-centers` | ✅ | ✅ | 🟡 | 🟡 | AM-07: opened and used live (Add Cost Centre exercised to create a safe UAT cost centre); `editFields: [name]`; company relationship immutable, verified via `test_company_scoped_writes.py` |
| `/setup/categories` | ✅ | ✅ | 🟡 | 🟡 | AM-07: opened and used live (Category dropdown exercised repeatedly during correction-flow UAT); `editFields: [name]` |
| `/setup/subcategories` | ✅ | ✅ | 🟡 | 🟡 | AM-07: opened live — list renders correctly, category relationship immutable and correctly enforced; found and documented (not fixed, out of scope) a cosmetic bug where the Edit dialog shows the parent Category as a raw numeric id instead of its name — see `REVIEW_FINDINGS.md`; `editFields: [name]` |
| `/setup/vendors` | ✅ | ✅ | 🟡 | ✅ | AM-05: opened live — Edit dialog verified (Code read-only, Name/GSTIN/Contact Name/Phone/Email editable — the last three newly surfaced in the UI, already existed on the backend schema unused); Deactivate confirmation dialog verified with correct destructive styling |
| `/setup/custom-fields` | ✅ | ✅ | ✅ | ✅ | AM-05: new bespoke screen opened live — created a Global text field, verified Scope column shows "Global"/company name correctly, verified the optional→required confirmation dialog text ("This is a Global field. Making it required means EVERY company must fill it in..."), verified the new field appeared under Add Asset's Custom Fields section, verified no horizontal overflow at 375px via `getBoundingClientRect`; security verified by 15 backend tests (scope creation/mutation authorization, immutability) |
| `/setup/holders` | ✅ | ✅ | 🟡 | ✅ | AM-05: bespoke component, opened live — Edit dialog verified, Role field's "Current role: X" helper text and the change-warning ("Changing role from ADMIN to VIEWER will immediately change this person's access") both verified live by actually selecting a different role; Deactivate action (previously missing entirely) now present and confirmed; security is backend-test-regression (new IT_TEAM-cannot-update/deactivate/reset-password tests), not a dedicated browser walkthrough. AM-07: Add User exercised live to create a safe UAT IT_STOCK holder; found and documented (not fixed, out of scope) a real bug where leaving Location blank sends `location_id=0` instead of omitting it, causing an unhandled 500 — see `REVIEW_FINDINGS.md` |
| `/setup/code-rule` | ✅ | ✅ | N/A | 🟡 | AM-05: added loading skeleton + error/retry state without changing numbering semantics; opened live at desktop width, form/preview render correctly; `get_active_rule` ordering gap closed with 5 new dedicated backend tests |
| App shell (sidebar/header) | ✅ | ✅ | N/A | ✅ | Verified expanded, collapsed-to-icons, and mobile drawer; role-gated nav content covered by `router.test.tsx` |

**E2E (Playwright):** 4/4 passing — the existing `full custody journey`,
`multi-company-udf`, and `import journey` specs are untouched and still
green, plus a new `asset correction journey: correct classification and
purchase date, Asset Code and History stay untouched`
(`e2e/asset-correction.spec.ts`): seeds a real company, creates a second
Category/Subcategory to correct into, creates one asset via a direct API
call, then drives the real browser through opening Asset 360, confirming
History shows exactly 1 event, opening "Correct Classification", verifying
Asset Code + "will not change" text, correcting Category/Subcategory/
Purchase Date together, verifying the Impact Summary text, confirming,
verifying Asset Code is unchanged and Overview/Procurement reflect the
correction, verifying the Changes tab shows the correction + reason, and
verifying History still shows exactly 1 event. All four specs clean up
everything they create.

**Backend:** 288/288 passing (was 258/258 at AM-06, 231/231 at AM-05,
199/199 at AM-04, 184/184 at AM-03, 170/170 at AM-01, 163/163 at AM-00 —
+30 new AM-07 tests: authorization, category/subcategory correction rules,
Purchase Date chronology, request validation, audit, regression — see
`AM-07_ASSET_CORRECTION_WORKFLOW_REPORT.md` §29).
**Frontend:** 143/143 passing (25 files, up from 133 at AM-06 — +10 new
AM-07 tests in `AssetDetail.test.tsx` covering the correction dialog),
`npx tsc -b` clean.
