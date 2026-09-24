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

Legend: ✅ verified this session · 🟡 spot-checked only (not full UAT) · ⬜ not yet checked · N/A not applicable

Functional = backend/frontend tests pass. Design = real-browser visual check.
Security = authz/scoping verified. Responsive = checked at 1440/768/375.

| Route | Functional | Design | Security | Responsive | Notes |
|---|---|---|---|---|---|
| `/login` | ✅ | ✅ | ✅ | ✅ | Full UAT: keyboard nav, Enter-submit, validation errors, failed-login banner, all 3 breakpoints, real login verified with owner account |
| `/change-password` | ✅ | 🟡 | ⬜ | ⬜ | Component tests pass; visually redesigned but not device-by-device checked |
| `/dashboard` | ✅ | ✅ | 🟡 | ✅ | AM-03: migrated to shared foundation, fixed the stuck-on-Loading-forever bug (now shows a real error state with retry); verified in-browser at 1440/1024/768/375 with real live data; security is backend-regression-only (no new endpoint/authz surface), not a dedicated browser authz check |
| `/assets` (register) | ✅ | ✅ | 🟡 | ✅ | AM-03: migrated to shared foundation; row click now uses the SPA router (confirmed via network log — no document reload); checkbox click confirmed not to trigger row navigation; verified in-browser at 1440/1024/768/375 — table uses intentional horizontal scroll at 375, no clipped content; security is backend-regression-only, same caveat as Dashboard |
| `/assets/new` (Add Asset) | ✅ | ✅ | 🟡 | ✅ | AM-04: full sectioned redesign; verified in-browser at 1920/1440/1366/1024/768/375 with real created data (a full asset was actually saved through the form); required-UDF error and server-validation-error both confirmed live; security is backend-regression-only (role-gating covered by tests, not a dedicated browser authz walkthrough). AM-05: Custom Fields section now filters to Global + this asset's company only, verified live (created a Global field, confirmed it rendered) and by a dedicated E2E journey + 9 backend + 1 frontend regression test proving another company's required field never blocks Save |
| `/assets/$id` (Asset Detail → Asset 360) | ✅ | ✅ | 🟡 | ✅ | AM-04: full redesign, `return null` loading bug fixed; verified in-browser at all 6 breakpoints; Procurement/Custody/Custom-Fields/Changes tabs all confirmed showing real data; Edit mode exercised end-to-end (changed Brand, saved, confirmed refreshed display AND a new Changes-tab audit row); found and fixed 2 real responsive bugs during this UAT (see note above); security is backend-regression-only, same caveat as Add Asset. AM-05: Edit mode's Custom Field controls apply the same Global+own-company filter; a stored value under a now-other-company-scoped key remains visible read-only and is preserved (not dropped) on an unrelated save, verified by a dedicated frontend regression test |
| `/my-assets` | ✅ | ✅ | 🟡 | ✅ | AM-06: migrated to shared foundation (PageHeader/DataTable/StatusBadge/EmptyState/ErrorState); real loading skeleton and error+retry added (previously none); hardcoded `text-blue-600` link replaced with the same unstyled SPA `<Link>` Asset Register uses; verified in-browser (clicked through to Asset 360) and at 375px (no overflow, confirmed via `document.body.scrollWidth`). A Category column was tried, then removed after live UAT caught it showing a raw numeric id for an asset whose category had since been deactivated (Asset Register itself has no Category column either — kept consistent); security is backend-regression-only, no scoping logic changed |
| `/import` | ✅ | ✅ | ✅ | ✅ | AM-06: full redesign — 4-step hierarchy (template/choose+preview/review/result) on the shared foundation; verified in-browser (template download succeeded live, full preview→commit→Asset-360 journey proven by a new E2E spec using a real generated fixture); verified no overflow at 375px and 768px; security verified by 19 new backend tests (procurement/UDF/quantity/cross-company rejection) plus the existing company-scope-on-commit tests, unchanged |
| `/reports` | ✅ | ✅ | ✅ | ⬜ | AM-06: added a third card (Field Change Audit) and Status/Category filters on the Asset Register export; every download now goes through `AsyncButton`; verified in-browser — all three exports (Asset Register, Movement Log, Field Change Audit) downloaded successfully live; security verified by 8 new backend tests (field-change export company scoping, HOLDER role denied) plus the pre-existing asset/movement export scoping tests, unchanged; not re-checked at every breakpoint this session (desktop-verified only) |
| `/setup/companies` | ✅ | ✅ | 🟡 | ✅ | AM-05: `MasterCrudScreen` on shared foundation; Edit dialog verified live (immutable Code shown read-only with explanatory text, Name editable), Deactivate confirmation verified (named the record, cancelled without side effect); security is backend-test-regression (15 new AM-05 authz tests), not a dedicated browser walkthrough per role |
| `/setup/locations` | ✅ | 🟡 | 🟡 | 🟡 | Same `MasterCrudScreen` component as Companies/Categories/etc, not opened individually this session — Edit/Deactivate behavior identical and config-verified (`editFields: [name, address]`) |
| `/setup/departments` | ✅ | 🟡 | 🟡 | 🟡 | ″ (`editFields: [name]`) |
| `/setup/cost-centers` | ✅ | 🟡 | 🟡 | 🟡 | ″ (`editFields: [name]`; company relationship immutable, verified via `test_company_scoped_writes.py`) |
| `/setup/categories` | ✅ | 🟡 | 🟡 | 🟡 | ″ (`editFields: [name]`) |
| `/setup/subcategories` | ✅ | 🟡 | 🟡 | 🟡 | ″ (`editFields: [name]`; category relationship immutable) |
| `/setup/vendors` | ✅ | ✅ | 🟡 | ✅ | AM-05: opened live — Edit dialog verified (Code read-only, Name/GSTIN/Contact Name/Phone/Email editable — the last three newly surfaced in the UI, already existed on the backend schema unused); Deactivate confirmation dialog verified with correct destructive styling |
| `/setup/custom-fields` | ✅ | ✅ | ✅ | ✅ | AM-05: new bespoke screen opened live — created a Global text field, verified Scope column shows "Global"/company name correctly, verified the optional→required confirmation dialog text ("This is a Global field. Making it required means EVERY company must fill it in..."), verified the new field appeared under Add Asset's Custom Fields section, verified no horizontal overflow at 375px via `getBoundingClientRect`; security verified by 15 backend tests (scope creation/mutation authorization, immutability) |
| `/setup/holders` | ✅ | ✅ | 🟡 | ✅ | AM-05: bespoke component, opened live — Edit dialog verified, Role field's "Current role: X" helper text and the change-warning ("Changing role from ADMIN to VIEWER will immediately change this person's access") both verified live by actually selecting a different role; Deactivate action (previously missing entirely) now present and confirmed; security is backend-test-regression (new IT_TEAM-cannot-update/deactivate/reset-password tests), not a dedicated browser walkthrough |
| `/setup/code-rule` | ✅ | ✅ | N/A | 🟡 | AM-05: added loading skeleton + error/retry state without changing numbering semantics; opened live at desktop width, form/preview render correctly; `get_active_rule` ordering gap closed with 5 new dedicated backend tests |
| App shell (sidebar/header) | ✅ | ✅ | N/A | ✅ | Verified expanded, collapsed-to-icons, and mobile drawer; role-gated nav content covered by `router.test.tsx` |

**E2E (Playwright):** 3/3 passing — the existing `full custody journey` and
`multi-company-udf` specs are untouched and still green, plus a new
`import journey: fixture file -> preview -> commit -> find the asset ->
PI Number and a company-scoped custom field show on Asset 360`
(`e2e/import.spec.ts`): seeds a real company, creates a company-scoped
Custom Field, builds a one-row Excel fixture through a new backend script
(`build_e2e_import_fixture.py`, reusing the real column contract rather
than hand-crafting bytes or depending on Excel desktop software), then
drives the browser through Preview → Commit → finds the created asset via
the real Asset Register search → confirms PI Number and the custom field
value both render on Asset 360. All three specs clean up everything they
create.

**Backend:** 258/258 passing (was 231/231 at AM-05, 199/199 at AM-04,
184/184 at AM-03, 170/170 at AM-01, 163/163 at AM-00 — +27 new AM-06
tests: 19 import full-field-support, 8 export/reports full-field-support).
**Frontend:** 133/133 passing (25 files, up from 121 at AM-05 — +12 new
tests: 6 Import, 3 Reports, 3 My Assets), `npx tsc -b` clean.
