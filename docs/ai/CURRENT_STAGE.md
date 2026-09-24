# CKAM — Current Stage

**Stage:** AM-04 (Add Asset + Asset 360 + procurement/UDF UI + edit audit) — complete, PASS.
**Next:** awaiting explicit go-ahead on AM-05 or any other further work — do
not start anything automatically, including Masters/Holders/Import/Reports/
My Assets redesign, or any category/subcategory/purchase-date correction
workflow.

Full AM-04 evidence: `docs/ai/AM-04_ASSET_ENTRY_360_REPORT.md`.
Full AM-03 evidence: `docs/ai/AM-03_UI_FOUNDATION_REPORT.md`.
Full AM-02 evidence: `docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md`.
Full AM-01 evidence: `docs/ai/AM-01_DATA_INTEGRITY_REPORT.md`.

## Locked V1 business decisions (from the AM-01 authorization — see `DECISIONS.md` for full detail)

No approval workflow in V1. Single current-holder/custody concept (no
custodian/user split). No AMC/insurance. No depreciation/accounting. No
physical verification (but QR/barcode stays forward-compatible). Lost/Damaged
tracks lifecycle state + reason + audit only, no recovery/write-off
accounting. Custom Fields are **required** long-term and are now wired into
Add Asset and Asset 360 (AM-04) with server-side required-field enforcement
on create. Procurement traceability (including PI Number) is a locked target
requirement, now fully reachable from Add Asset/Asset 360. Auto-generated Asset Code stays
mandatory, race-safe numbering preserved as-is. CKAM supports ≥2 companies;
Cost Centres must match their asset's company (already enforced, now
test-covered on both creation paths). No login company selector (already
shipped). Core V1 lifecycle: Procured → IT Stock → Assigned → Returned →
Reassigned, plus Repair/Lost-Found/Disposed-Sold-Scrapped.

## What's actually done as of AM-01

- Login: no company selector, fail-closed identity resolution across
  companies (backend + frontend), tested.
- Change Password: redesigned to match Login's visual language.
- App shell: sidebar navigation (grouped, icon-labeled, collapsible,
  mobile-drawer) replacing the old top nav + dropdown.
- Design system: navy-forward palette, 44px form-control sizing, two-layer
  focus states — applied globally via shared tokens/components.
- Logo: fixed a real transparency defect (baked-in near-white plate).
- **Data integrity (AM-01):** 6 new indexes on evidenced hot-path columns
  (`asset.status/current_holder_id/company_id/category_id`,
  `asset_event.asset_id+event_date`, `asset_event.event_date`); historical
  event display now snapshots holder names at write time (a holder rename no
  longer rewrites past events' apparent custody); company/cost-centre
  cross-company protection confirmed already correct on both the Add Asset
  and Import paths, now test-covered on both; Holder model confirmed to
  correctly represent all 4 custody types with no fake-employee workaround.

## What's actually done as of AM-02

- **Procurement field visibility (AM-02):** `AssetOut` now returns all ~24
  procurement/descriptive fields (vendor, PO, invoice, **PI Number**/date,
  brand, model, serial number, warranty, custom fields, etc.) — all of these
  already existed in the database and on create, they just weren't being
  returned to any client. No new columns, no new migration for this part.
- **Asset edit capability (AM-02, new):** `PUT /api/assets/{id}` — the first
  general edit path for an asset's editable descriptive/procurement data.
  Cannot touch identity fields (DB-trigger-protected) or lifecycle fields
  (ledger-controlled) — see the Asset Field Policy Matrix in the AM-02
  report.
- **Custom Field (UDF) validation (AM-02, new):** values written to
  `Asset.custom_fields` are now validated against active `CustomField`
  definitions (type-checked per `field_type`) on both create and update.
  Reused the existing `CustomField` table and `Asset.custom_fields` JSON
  column — no new table.
- **Closed-value validation gaps closed (AM-02):** `holder.holder_type`,
  `holder.role`, `custom_field.field_type` now rejected with 422 if not a
  recognized value (API level), and enforced with a CHECK constraint at the
  database level too (migration `3a44505b6b10`, verified 100% conformant on
  live data immediately before applying).

## What's actually done as of AM-03

- **Shared UI foundation (new):** `components/shared/{PageHeader,DataTable,
  StatusBadge,EmptyState,ErrorState,AsyncButton,FormField}.tsx`. `DataTable`
  presents rows/loading-skeletons/empty/error states and an optional
  pagination footer consistently, but does not own fetching, query state,
  sorting, or filtering — the page still does, exactly as Asset Register
  already did. `FormField` is a foundation-only primitive for a future
  data-entry stage; nothing consumes it yet.
- **Dashboard migrated:** now uses `PageHeader`/`DataTable`/`StatusBadge`/
  `EmptyState`/`ErrorState`. Fixed a real bug: a failed fetch used to leave
  the screen stuck on "Loading…" forever (`isLoading || !data` never
  distinguished "still loading" from "failed") — now shows a real error
  state with a working retry button.
- **Asset Register migrated:** now uses the same shared components, plus a
  genuine, explicitly-authorized behavior change — row click now navigates
  via the SPA router (`useNavigate`) instead of `window.location.href`.
  Confirmed via network log that clicking a row no longer re-requests
  `index.html`/the JS bundle; confirmed the selection checkbox still does
  not trigger row navigation. Search/filters/pagination/bulk-move/role
  behavior/API contracts are all unchanged.
- **No backend change of any kind** — no migration, no schema change, no
  API contract change, no authorization change. Verified: backend suite
  stayed at 184/184 throughout.
- Frontend suite grew from 56 to 81 tests (23 files, +7 new test files for
  the shared components plus additions to Dashboard/AssetRegister tests),
  typecheck clean, E2E 1/1 passing, real-browser UAT performed at
  1440/1024/768/375 with live data (a throwaway seed company/admin created
  and soft-deactivated afterward, the same safe pattern E2E already uses).

## What's actually done as of AM-04

- **Add Asset redesigned:** sectioned (Organization / Asset Classification /
  Purchase-Procurement / Asset Details / Commercial / Initial Custody /
  Custom Fields), using the AM-03 shared foundation (`PageHeader`,
  `FormField`, `AsyncButton`, `ErrorState`). Every procurement field the API
  has supported since AM-02 (vendor, PO, invoice, **PI Number**, warranty,
  legacy asset code, brand/model/serial) is now actually reachable from the
  UI, plus dynamically-rendered active Custom Fields (respecting
  `sort_order`, one control per supported type). A tax/total-cost preview
  uses the same rounding as the backend, but the backend's own response
  after save remains authoritative.
- **Required Custom Fields now actually enforced (new business rule):** every
  active `CustomField.is_required=true` must have a valid value before a new
  asset can be created — enforced server-side (`validate_custom_field_values`,
  `enforce_required=True`), not just in the browser. On edit, this is only
  enforced when the edit itself replaces `custom_fields` — an existing asset
  predating a newly-required field is never blocked from an unrelated edit.
- **Successful single-asset creation navigates straight to the new asset's
  Asset 360 page** (Asset Code always server-generated, read back from the
  response, never guessed client-side). A multi-quantity ("buying 20 mice")
  create still lists every generated code, since there's no single
  destination to jump to for a batch.
- **Asset Detail became Asset 360:** real loading skeleton, `ErrorState`+
  retry, and a distinct not-found treatment (was `return null` with no
  states at all). `PageHeader` shows Asset Code/Description/Status/current
  Holder/Holder type/Location. Tabbed: Overview, Procurement, Custody,
  Custom Fields (including retained values for a deactivated definition —
  never silently hidden), History (unchanged lifecycle Timeline), Changes
  (new — see below), Documents (unchanged, preserved as-is). Lifecycle
  action buttons are unchanged, still driven only by the existing
  `actionRules.ts`/state machine.
- **Asset 360 Edit mode (new, role-gated ADMIN/IT_TEAM):** uses the existing
  AM-02 `PUT /api/assets/{id}`. Can only ever touch the same editable
  descriptive/procurement subset `AssetUpdateIn` already defined — identity
  fields (`asset_code`/`company_id`/`cost_center_id`), lifecycle fields
  (`status`/`current_holder_id`/`status_since`), and `category_id`/
  `subcategory_id`/`purchase_date` are never rendered as form controls at
  all, not merely disabled.
- **New field-change audit (`asset_field_change`, migration `a409768dc2cf`):**
  a lightweight, append-only (DB-trigger-enforced, same pattern as
  `asset_event`) table recording one row per genuinely-changed field per
  edit, written in the same transaction as the edit itself. Deliberately
  separate from `asset_event` — lifecycle moves and descriptive-field edits
  are different kinds of facts and are never merged. Readable via the new
  `GET /api/assets/{id}/changes` (scoped identically to viewing the asset)
  and shown in Asset 360's own "Changes" tab.
- **Asset 360 shows human-readable labels, not bare IDs**, for Vendor/
  Category/Sub-Category/Cost Centre/Holder/Location/Department — a small,
  additive `AssetDetailOut` response used only by the single-asset GET/PUT
  endpoints (the list endpoint's `AssetOut` is untouched, so the register
  doesn't pay for joins it doesn't display).
- **No Masters/Holders/Import/Reports/My Assets change.** No approval
  workflow, AMC/insurance, depreciation, or physical verification. No
  category/subcategory/purchase_date correction workflow (explicitly
  deferred, same reasoning as AM-02).
- Backend: 184 → 199 tests (+15). Frontend: 81 → 101 tests (+20, one new
  file for `FormField`'s first real consumer-driven tests). Typecheck clean,
  E2E 1/1 passing (updated for the redesigned Add Asset's field labels and
  the new post-create navigation), real-browser UAT performed.

## Deferred, awaiting your decision (not blockers, not failures)

1. **`holder_company_access`**: written to, never read by authorization.
   Classified as either "needed for multi-company asset-team access" or
   "dormant/obsolete" — genuinely depends on whether CityKart's asset team is
   organizationally shared across companies. No behavioral change made in
   AM-01, AM-02, AM-03 or AM-04.
2. **Import/Export column extension**: the import template and export column
   list still don't include any procurement, custom-field, or field-change-
   audit columns, even though the API now fully supports the first two.
   Deliberately deferred again in AM-04 (§32) — not a brittle dynamic-column
   hack, a real future stage's work.
3. **`category_id`/`subcategory_id`/`purchase_date` have no edit path** —
   deliberately excluded from `AssetUpdateIn`/Asset 360's Edit mode again in
   AM-04 (§17): changing them safely needs a dedicated correction-workflow
   design (code-generation tokens and event-ordering invariants both depend
   on them), not a silent add to the generic edit form.

4. **Shared UI foundation is now proven on 4 screens** (Dashboard, Asset
   Register, Add Asset, Asset 360) but Holders, Import preview, My Assets,
   and all 8 master screens still hand-roll their own markup. Migrating them
   is real, screen-by-screen work for a future stage.
5. **`AsyncButton` exists but Imports/Reports weren't touched** — they still
   hand-roll their own pending/error state for blob-download buttons.

None of AM-05 through AM-16 (Masters/Holders redesign, Import, Reports, My
Assets, full responsive/accessibility pass, security regression, full UAT)
have been started as dedicated stages yet — see `REVIEW_FINDINGS.md` for
what's still open on each of those screens.

## Branch / remote state

Working on `worktree-ckam-build` (local worktree). This branch has **never
been pushed to `origin`** — only `claude/brave-euler-07879a` exists on the
remote (a small, unrelated test-DB-safety-guard commit). Pushing is a
decision for the user, not this session, to make explicitly.
