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

Legend: ✅ verified this session · 🟡 spot-checked only (not full UAT) · ⬜ not yet checked · N/A not applicable

Functional = backend/frontend tests pass. Design = real-browser visual check.
Security = authz/scoping verified. Responsive = checked at 1440/768/375.

| Route | Functional | Design | Security | Responsive | Notes |
|---|---|---|---|---|---|
| `/login` | ✅ | ✅ | ✅ | ✅ | Full UAT: keyboard nav, Enter-submit, validation errors, failed-login banner, all 3 breakpoints, real login verified with owner account |
| `/change-password` | ✅ | 🟡 | ⬜ | ⬜ | Component tests pass; visually redesigned but not device-by-device checked |
| `/dashboard` | ✅ | ✅ | 🟡 | ✅ | AM-03: migrated to shared foundation, fixed the stuck-on-Loading-forever bug (now shows a real error state with retry); verified in-browser at 1440/1024/768/375 with real live data; security is backend-regression-only (no new endpoint/authz surface), not a dedicated browser authz check |
| `/assets` (register) | ✅ | ✅ | 🟡 | ✅ | AM-03: migrated to shared foundation; row click now uses the SPA router (confirmed via network log — no document reload); checkbox click confirmed not to trigger row navigation; verified in-browser at 1440/1024/768/375 — table uses intentional horizontal scroll at 375, no clipped content; security is backend-regression-only, same caveat as Dashboard |
| `/assets/new` (Add Asset) | ✅ | ✅ | 🟡 | ✅ | AM-04: full sectioned redesign; verified in-browser at 1920/1440/1366/1024/768/375 with real created data (a full asset was actually saved through the form); required-UDF error and server-validation-error both confirmed live; security is backend-regression-only (role-gating covered by tests, not a dedicated browser authz walkthrough) |
| `/assets/$id` (Asset Detail → Asset 360) | ✅ | ✅ | 🟡 | ✅ | AM-04: full redesign, `return null` loading bug fixed; verified in-browser at all 6 breakpoints; Procurement/Custody/Custom-Fields/Changes tabs all confirmed showing real data; Edit mode exercised end-to-end (changed Brand, saved, confirmed refreshed display AND a new Changes-tab audit row); found and fixed 2 real responsive bugs during this UAT (see note above); security is backend-regression-only, same caveat as Add Asset |
| `/my-assets` | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session |
| `/import` | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session |
| `/reports` | ✅ | ⬜ | ⬜ | ⬜ | Not opened this session |
| `/setup/companies` | ✅ | 🟡 | ⬜ | ⬜ | Spot-checked at 1440 only (confirmed navy primary button rendering) |
| `/setup/locations` | ✅ | ⬜ | ⬜ | ⬜ | Same component as companies (`MasterCrudScreen`), not opened individually |
| `/setup/departments` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/cost-centers` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/categories` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/subcategories` | ✅ | ⬜ | ⬜ | ⬜ | ″ |
| `/setup/vendors` | ✅ | ⬜ | ⬜ | ⬜ | Opened this session only to create AM-04 UAT test data (functional use, not a design/responsive pass) |
| `/setup/custom-fields` | ✅ | ⬜ | ⬜ | ⬜ | Opened this session only to create AM-04 UAT test data (a required text field) — same caveat as Vendors |
| `/setup/holders` | ✅ | ⬜ | ⬜ | ⬜ | Bespoke component; opened this session only to create an AM-04 UAT IT_STOCK holder — same caveat |
| `/setup/code-rule` | ✅ | ⬜ | ⬜ | ⬜ | Opened this session only to set up an AM-04 UAT code rule — same caveat |
| App shell (sidebar/header) | ✅ | ✅ | N/A | ✅ | Verified expanded, collapsed-to-icons, and mobile drawer; role-gated nav content covered by `router.test.tsx` |

**E2E (Playwright):** 1/1 passing — `full custody journey: procure, allot,
return, allot again` covers login → add asset (now via the AM-04 redesigned
form) → search → lifecycle actions → QR/logout redirect → forced password
change → logout. Updated for AM-04's field-label changes ("Cost Centre" not
"Cost Center", "Goes Into" not "Initial Holder") and the new post-create
navigation straight to Asset 360. Confirmed the seeded test company is
cleanly torn down afterward.

**Backend:** 199/199 passing (was 184/184 at AM-03, 170/170 at AM-01,
163/163 at AM-00 — +15 new AM-04 tests: required-UDF enforcement,
field-change audit, audit API scoping). **Frontend:** 101/101 passing
(24 files, up from 81/23 at AM-03 — +20 new tests: `FormField`'s first real
tests plus rewrites of `AddAssetForm.test.tsx`/`AssetDetail.test.tsx` for
the redesigned screens), typecheck clean.
