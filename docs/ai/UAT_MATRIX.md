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

**AM-09 (2026-09-24) was the Release Candidate full-system audit, verdict
RELEASE READY** — not a redesign pass. Every route below was re-verified at
all 6 RC-required breakpoints (1920×1080/1440×900/1366×768/1024×768/
768×1024/375×812), confirming zero page-level horizontal overflow anywhere
(48 checks, all clean); the full role matrix (ADMIN/IT_TEAM/VIEWER/HOLDER)
was re-verified via direct API calls, not inferred from the frontend, for
every write/read path; company and HOLDER data isolation were verified
directly; deep-link refresh was verified live on `/assets/$id` and
`/setup/holders`. Four evidenced P1 defects were found and fixed (Excel
formula injection across all three `/reports` exports, a naive-datetime
crash on lifecycle events, duplicate-`code` 500s on masters and Holders) —
see `AM-09_RC_FULL_AUDIT_REPORT.md` and `RC_ISSUES.md` for full detail.
Numbering concurrency (`/assets/new` → `/setup/code-rule`'s counter) was
proven race-safe under 20 genuine parallel requests. No route/UI change was
made this stage.

Legend: ✅ verified this session · 🟡 spot-checked only (not full UAT) · ⬜ not yet checked · N/A not applicable

Functional = backend/frontend tests pass. Design = real-browser visual check.
Security = authz/scoping verified. Responsive = checked at 1440/768/375.

| Route | Functional | Design | Security | Responsive | Notes |
|---|---|---|---|---|---|
| `/login` | ✅ | ✅ | ✅ | ✅ | Full UAT: keyboard nav, Enter-submit, validation errors, failed-login banner, all 3 breakpoints, real login verified with owner account |
| `/change-password` | ✅ | ✅ | ✅ | ✅ | AM-07 verification sweep: confirmed no horizontal overflow at 1440/768/375 (`document.body.scrollWidth === window.innerWidth` at all three); confirmed empty-form submit is blocked client-side with no network request fired; confirmed fields are keyboard-focusable; route requires an authenticated session (backend-regression-only, no new endpoint). AM-08: Design closed — visually compared against Login at 1440/768/375, same centered-card layout, logo, spacing, labeled fields, and dark navy submit action; no redesign needed |
| `/dashboard` | ✅ | ✅ | ✅ | ✅ | AM-03: migrated to shared foundation, fixed the stuck-on-Loading-forever bug (now shows a real error state with retry); verified in-browser at 1440/1024/768/375 with real live data. AM-08: Security closed — the dashboard's own reports endpoints (`require_role(*STAFF_ROLES)`) were exercised live via direct API calls as VIEWER/HOLDER during the route-security sweep, no over-permission found (see `REVIEW_FINDINGS.md`). AM-12: added an "Exceptions" card (UNDER_REPAIR/LOST/DISPOSED/SOLD/SCRAPPED, each linking to a pre-filtered Asset Register) and a "Recent Activity" card (latest 5 company-scoped lifecycle events, snapshot-correct labeling); verified live at 1440×900/1024×768/768×1024/375×812 with real IN_STOCK/ALLOTTED/UNDER_REPAIR/LOST/DISPOSED UAT assets — correct counts, correct click-through, correct company scoping (confirmed via direct network-response inspection for a non-ADMIN role), no horizontal overflow at any breakpoint |
| `/assets` (register) | ✅ | ✅ | ✅ | ✅ | AM-03: migrated to shared foundation; row click now uses the SPA router (confirmed via network log — no document reload); checkbox click confirmed not to trigger row navigation; verified in-browser at 1440/1024/768/375 — table uses intentional horizontal scroll at 375, no clipped content. AM-08: Security closed — `GET /api/assets` exercised live as VIEWER (200, company-scoped) and HOLDER (200, pinned to their own held assets only, confirmed against `list_assets`' actual scoping code, not just the response) during the route-security sweep. AM-11: fixed a genuine Phase-1 usability gap found during the ADMIN walkthrough — the table gained Holder and Company columns (page-scoped batch lookup, never a per-row join) and the search box now also matches Description; verified live (searching "latitude" now finds "UAT - Dell Latitude Laptop" by description; the new columns show real resolved names, e.g. "UAT AM11 Employee Holder" / "UAT AM11 UX Walkthrough Co") |
| `/assets/new` (Add Asset) | ✅ | ✅ | ✅ | ✅ | AM-04: full sectioned redesign; verified in-browser at 1920/1440/1366/1024/768/375 with real created data; required-UDF error and server-validation-error both confirmed live. AM-05: Custom Fields section filters to Global + this asset's company only, verified live + E2E + 9 backend + 1 frontend regression test. AM-08: fixed the Cost Centre company-scoping bug found in AM-07 (verified live: only the current company's own cost centre now appears, plus a new dedicated E2E journey); Security closed — `POST /api/assets` exercised live as VIEWER and HOLDER (both 403) during the route-security sweep |
| `/assets/$id` (Asset Detail → Asset 360) | ✅ | ✅ | ✅ | ✅ | AM-04: full redesign, `return null` loading bug fixed; verified in-browser at all 6 breakpoints; Edit mode exercised end-to-end. AM-05: Edit mode's Custom Field controls apply the Global+own-company filter, verified by a dedicated frontend regression test. AM-07: "Correct Classification" action verified live end-to-end (two real corrections against `AM04UAT/2`, Impact Summary, Changes-tab distinct rendering, History byte-identical before/after, ordinary Edit mode confirmed to expose none of the three fields); dialog verified with no overflow at 1440/1024/768/375. AM-08: Security closed — `POST /api/assets/1/corrections` exercised live as VIEWER (403) during the route-security sweep, alongside the 30 AM-07 backend authorization tests |
| `/my-assets` | ✅ | ✅ | ✅ | ✅ | AM-06: migrated to shared foundation; real loading skeleton and error+retry added; hardcoded link color replaced. A Category column was tried, then removed after live UAT caught it showing a raw numeric id for a deactivated category. AM-08: Security closed — `/my-assets` reuses `GET /api/assets` with a HOLDER's `holder_id` pinned server-side to their own id (same code path exercised live as HOLDER during the route-security sweep, confirmed against the actual scoping code, not assumed) |
| `/import` | ✅ | ✅ | ✅ | ✅ | AM-06: full redesign — 4-step hierarchy (template/choose+preview/review/result) on the shared foundation; verified in-browser (template download succeeded live, full preview→commit→Asset-360 journey proven by a new E2E spec using a real generated fixture); verified no overflow at 375px and 768px; security verified by 19 new backend tests (procurement/UDF/quantity/cross-company rejection) plus the existing company-scope-on-commit tests, unchanged |
| `/reports` | ✅ | ✅ | ✅ | ✅ | AM-06: added a third card (Field Change Audit) and Status/Category filters on the Asset Register export; every download now goes through `AsyncButton`; verified in-browser — all three exports (Asset Register, Movement Log, Field Change Audit) downloaded successfully live; security verified by 8 new backend tests (field-change export company scoping, HOLDER role denied) plus the pre-existing asset/movement export scoping tests, unchanged. AM-07: closed the AM-06 Responsive gap — verified no horizontal overflow at 1440/768/375 (`document.body.scrollWidth === window.innerWidth` at all three; cards stack correctly and buttons stay full-width at 375), no redesign needed. AM-09: found and fixed a real P1 security defect — a value beginning with `=`/`+`/`-`/`@` in any export's user-controlled cell (Description, Brand, Vendor name, Custom Field value, correction Reason, movement remarks) was auto-flagged as a live Excel formula by openpyxl; now sanitized to safe literal text across all three exports, verified by 3 new backend tests and a live reproduction against a real created asset. Re-verified clean at all 6 RC breakpoints |
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
`multi-company-udf`, `import journey`, `asset correction journey`, and
AM-08's `Add Asset company-scoped Cost Centre journey` specs are all
unchanged and still green. AM-09 added no new permanent E2E spec (its own
diagnostic Playwright reproduction of a backend-outage scenario,
`am09_diag_network_failure.spec.ts`, was deliberately throwaway — deleted
after use since an equivalent permanent unit test,
`AssetRegister.test.tsx`'s error-state test, already covers the same
scenario). All five specs clean up everything they create.

**Backend:** 312/312 passing (was 307/307 at AM-11, 305/305 at
AM-09/AM-10, 297/297 at AM-08, 288/288 at AM-07, 258/258 at AM-06,
231/231 at AM-05, 199/199 at AM-04, 184/184 at AM-03, 170/170 at AM-01,
163/163 at AM-00 — +5 new AM-12 tests: exception counts cover all 5
statuses, zero counts stay explicit, exception counts are company-scoped
across ADMIN/IT_TEAM/VIEWER, recent-activity ordering/limit/scoping,
recent-activity point-in-time holder-name snapshots — see
`AM-12_DASHBOARD_OPERATIONAL_CONTROL_REPORT.md` §21).
**Frontend:** 154/154 passing (25 files, up from 149 at AM-11 — +5 new
AM-12 tests: exception statuses shown explicitly at 0, exception counts
link to the correct Asset Register filter, recent activity renders
asset/action/time/actor, empty recent-activity state, recent-activity
actor em-dash fallback), `npx tsc -b` clean.

**AM-09 additional RC evidence (not table-shaped, not repeated per-row
above):** numbering concurrency proven race-safe under 20 genuine parallel
requests (no code change needed); a real backup executed and a real
restore into a disposable database verified byte-for-byte against the
pre-backup baseline; a fresh, disposable, genuinely empty database migrated
cleanly from zero to Alembic head; a read-only DB integrity audit (14
checks) and a trigger/index source-vs-live audit both found zero
violations; a production frontend build succeeded cleanly and deep-link
refresh was verified live on two authenticated routes plus one unknown
route; a controlled Playwright reproduction of a persistent backend 502
proved the frontend's error-handling is correct (`ErrorState` + working
retry, exactly 4 requests, matching React Query's own default retry
config). Full detail: `AM-09_RC_FULL_AUDIT_REPORT.md`.

**AM-13 (2026-09-28) was a UI density/professionalization pass, not a
route-shaped feature — no Functional/Security/Responsive-column marks
change below, only real-browser Design evidence, so it is recorded here
rather than by rewriting all 20 route rows.** Root-caused the "oversized/
loose" complaint to three shared primitives, not per-page CSS: `Card`
(`CardHeader`/`CardContent`/`CardFooter`) defaulted to shadcn's unmodified
`p-6` (24px) and was used for every Dashboard section, doubling to 48px+ of
stacked padding per card; every form control (`Input`/`Select`/`Button`/
`Textarea`) was `h-11` (44px); and `Dialog`/`AlertDialog` had no
`max-height`/`overflow-y-auto` at all, so a long dialog (verified live:
Holders' "Add User") could grow past the viewport with Cancel/Save
unreachable and no scrollbar — a real defect, not a density preference.
Fixed at the primitive level (`Card`→`p-4`, controls→`h-10`/40px,
`Dialog`/`AlertDialog`→`max-h-[85vh] overflow-y-auto`), which cascades to
every consumer without a single per-page override. Verified live at
1366×768: the Holders "Add User" dialog now measurably scrolls internally
(`scrollHeight` 820px vs `clientHeight` 651px, Cancel/Save reachable by
scrolling the dialog itself) instead of the old unbounded, capped-nowhere
growth. Dashboard's `Exceptions`/`Stock by Location` cards (previously two
separate full-width rows) now pair side-by-side at `lg:` width, same
pattern as the existing Warranty/Allotted pair — more of the Dashboard
visible before scrolling at 1366×768, verified live. Add Asset's form
width (`max-w-3xl`→`max-w-4xl`) and its Vendor field (now full-width alone)
fixed a real pairing-offset bug where PO Number/PO Date, Invoice Number/
Invoice Date, and PI Number/PI Date were drifting out of alignment by one
grid slot because Vendor (no date partner) sat in the first slot of the
same 2-column grid — verified live, the three Number/Date pairs now align
correctly. Global `body`/`h1`/`h2`/`h3` base styles in `styles.css`
(leftover generic-starter-kit values — `body` was 15.5px/1.55 line-height,
`h1` up to a `clamp(2rem,3.2vw,2.75rem)`) were normalized to 14px/1.5 and a
restrained heading fallback scale; confirmed by grep that no actual heading
in the app relies on the old values (every real heading already carries
its own explicit Tailwind `text-*` class), so this is defensive
normalization, not a rendering change. Verified live (real browser,
authenticated as a throwaway ADMIN, soft-deactivated afterward) at
1366×768 and 375×812: Dashboard, Add Asset, Asset Register, Asset 360,
Holders' Add User dialog, Import, Reports, Custom Fields — no horizontal
overflow, no missing scroll, no clipped controls at either width.
**Incidentally found and fixed, unrelated to the density work itself: the
running dev database was one migration behind code head** (`6c882ef3b225`
vs `278437eb710e`, the Serial Number uniqueness migration from the prior
PO stage — applied to `ckam_test` but never to the live dev `ckam`
database) — applied `alembic upgrade head`; not a code defect. **Also
found:** the `web` container's nginx does not send cache-busting headers
on `index.html`, so a browser tab open across a redeploy can keep running
a stale JS/CSS bundle referencing deleted asset hashes until a hard
reload — documented as a recommendation, not fixed (infra/ops scope, not
UI visual scope). No database migration was authored this stage (the one
applied already existed). No backend file changed. Backend: 341/341
(unchanged — AM-13 touched frontend files only). Frontend: 176/176
(unchanged — no test file added; a Tailwind-class/token change doesn't
need its own test per this stage's own testing guidance).
`npx tsc -b` clean. E2E: 5/5 (was transiently failing due to unrelated
test-data pollution from earlier ad-hoc `seed_admin` verification accounts
left active across companies, causing the login endpoint's own
more-than-one-active-match ambiguity guard to correctly refuse login with
a generic 401 — root-caused, the 7 stale accounts soft-deactivated,
re-verified 5/5 clean; not a regression from this stage's own changes).
Production build: clean. Full detail:
`AM-13_UI_DENSITY_PROFESSIONALIZATION_REPORT.md`.

**AM-14 (2026-09-28) was a complete visual-design/UX-composition pass —
also not route-shaped, recorded here for the same reason AM-13's own
entry gives.** Performed a real visual audit before any code change
(`AM-14_VISUAL_AUDIT.md`) and extracted structural principles (never
colors/code/branding) from the read-only CitykartDesk reference app.
Fixed three shared primitives beyond what AM-13 touched: `Card` moved to
border-as-structure (`rounded-md`/`shadow-sm`, was `rounded-xl`/`shadow`);
`Input`/`Select`/`Textarea` moved from a plain bordered box to a quiet
filled field (`bg-muted/50` at rest, firms up on focus) — the single
biggest fix for the "looks like default shadcn" complaint; `Badge` (and
therefore every `StatusBadge`/`LineStatusBadge`) is now pill-shaped. New
shared `SectionHeading` component replaced a bare heading + separate
`Separator` in Add Asset's 7 sections and Import's 4 steps. Asset
Register's search/filters and Columns picker now share one toolbar band.
Sidebar group labels gained the same uppercase/tracking-wide treatment as
every other section label. **Purchase Orders — flagged by AM-13's own
report as not individually verified, and the audit's only "C" grade —
got a real redesign**: the list gained a Cost Centre column (reading an
already-returned API field, zero backend change) and whole-row
click-to-navigate; the detail page gained a 4-tile KPI summary row
(Total Lines/Pending/Delivered/Value, computed from already-fetched data,
zero extra requests), Vendor in the header, and its permanently-open Add
Line form is now collapsed behind a toggle (same fields/mutation/
validation — a visibility state only, verified via DOM inspection after
the Browser-pane tool's own click-compositing proved unreliable
mid-session, a tooling artifact not an app defect). The Delivery Done
dialog was reviewed and found **already compliant** with a fixed-header/
scrollable-body/fixed-footer structure (built during the prior PO stage)
— verified live, not rebuilt. **Cache-busting nginx fix** (AM-13 found
this, out of that stage's visual scope; AM-14 fixed it narrowly): a new
`location = /index.html` block sends `Cache-Control: no-cache`; verified
via real response headers that hashed `/assets/*` files are unaffected.
Verified live at 1366×768 and 375×812 on every screen this stage actually
changed (Dashboard, Asset Register, Add Asset, Purchase Orders list and
detail, Holders' Add User dialog re-verified for the AM-13 scroll fix);
did **not** independently re-check 1920/1440/1024/768 or re-screenshot
routes that only inherited primitive-level fixes (Asset 360, Import,
Reports, Custom Fields, Code Rule, Login, the 7 simple masters, every
lifecycle/correction/master dialog individually) — stated as an honest
scope boundary, not claimed as full coverage. Purchase Orders list's
Pending/Delivered/Value columns were deliberately left off (would need a
backend aggregation change, out of this visual-only stage's scope) rather
than approximated. No database migration. No backend file changed. No
business logic, schema, or authorization changed. Backend: 341/341
(unchanged). Frontend: 176/176 (2 tests updated for the Add Line toggle's
genuine new interaction, not for styling). `npx tsc -b` clean. E2E: 5/5
(transiently broke twice on the same SEEDADMIN-ambiguity root cause AM-13
already documented — this stage's own new throwaway account plus more
interrupted-run leftovers; root-caused each time, cleaned up,
re-verified). Production build: clean. Full detail:
`AM-14_COMPLETE_VISUAL_REDESIGN_REPORT.md`.
