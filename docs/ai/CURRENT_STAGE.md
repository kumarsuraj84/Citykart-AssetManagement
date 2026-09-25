# CKAM — Current Stage

**Stage:** Purchase Order / Pending Assets feature — implemented, live
browser UAT performed and passed, plus several same-day follow-ups the live
UAT and user feedback directly motivated: Cost Centre relocated from
per-line to the PO header, a new Dashboard "Purchase Orders" card
(ADMIN/IT_TEAM only), a new Barcode field (PO line → converted Asset), a
PO-screen UX pass (Close button, per-column search/select on the lines
table, a filter-aware Select All, a real bug fix for the Delivery Done
dialog growing past the viewport with unreachable Cancel/Confirm buttons on
a large selection), stricter mandatory-field enforcement on both the PO Add
Line/Delivery flow and — same request extended to the other procurement
path — **Add Asset**, where Purchase Date was also removed as a
user-fillable field there too (always = Invoice Date, mirroring the PO
delivery path's own original rule), and a new system-wide rule: **Serial
Number is now mandatory and globally unique everywhere an asset is
created** (Add Asset, PO Delivery, Import), with the reserved placeholder
`"N/A"` exempt for categories/units genuinely without one — see
`DECISIONS.md`. Backend and frontend regression clean throughout.
**Environment: DEVELOPMENT / UAT. Production deployment remains DEFERRED —
there is currently no production server.** AM-10's evidence, documents,
regression baselines, and the local `ckam-v1.0.0-rc1` tag are all
preserved unmoved; production deployment work resumes only once the user
supplies real production server details and issues a separate
production-deployment authorization.
**FEATURE FREEZE remains lifted for justified Phase-1 gap closure/
enhancement only** (established AM-11) — this feature was built directly
from the user's own detailed procurement-workflow description
(a genuine CityKart Phase-1 requirement), following the full brainstorm →
design spec → implementation plan process, not started speculatively; the
Cost Centre, Dashboard-card, and Barcode follow-ups were all direct,
explicit user requests made during/after live UAT, not speculative
additions.
**Next:** Await explicit user direction for the next development stage. Do
NOT automatically begin further enhancement work. Do not start
`holder_company_access`, import duplicate detection, bulk correction,
category/subcategory-scoped Custom Fields, approval workflow, AMC/
insurance, depreciation, physical verification, a company-wide audit
explorer, new lifecycle states, new master types, or the G04 ADMIN
Dashboard company selector/breakdown, without an explicit business
decision resolving the open items below first.

## What's actually done — Purchase Order / Pending Assets feature

- **A new, optional PO-tracked procurement path, built end-to-end**:
  raise a PO (PO No/Date/Vendor/**Cost Centre**) → add pending line items
  (Description/Category/Subcategory/Cost/Tax %, Quantity expands into
  that many individual trackable rows, each inheriting the PO's own Cost
  Centre) → select delivered lines within that PO → one popup captures
  Invoice No/Date/Amount (shared) plus Serial Number/Initial Holder (per
  unit) → converts into real, numbered Assets via the existing
  `procure_assets` path, unchanged. Full design:
  `docs/specs/2026-09-25-po-pending-assets-design.md`. Full plan:
  `docs/superpowers/plans/2026-09-25-po-pending-assets-implementation.md`.
- **Add Asset started as a completely separate, untouched second path** —
  and stayed that way through the PO feature's own build. It was later
  extended, same day, by an explicit separate user request unrelated to
  the PO mechanics themselves (mandatory-field tightening + Purchase Date
  auto-derivation — see the dedicated bullet list below and
  `DECISIONS.md`'s "Add Asset: mandatory procurement fields" entry).
- **Two new additive tables** (`purchase_order`, `pending_asset`), plus
  one same-day additive column (`purchase_order.cost_center_id`,
  migration `8c5638e1b65e`) — no change to `Asset`'s own schema. A
  `PendingAsset` never appears in the Asset Register until converted.
- **New role gate: ADMIN/IT_TEAM** on every `/api/purchase-orders*`
  endpoint, matching Add Asset's own gate — a new sidebar "Purchase
  Orders" link, gated the same way.
- **Live browser UAT performed and passed** (logged in as a real
  ADMIN UAT account, `UAT-AM12-ADM`): created a PO, added a line with
  Quantity 3 (3 individual PENDING rows, correct PO Value each),
  selected 2, Mark Delivery Done with distinct serials + an Initial
  Holder, confirmed both converted assets show correct sequential Asset
  Codes/Holder/Company/full Procurement tab (PO/Invoice/Purchase Date =
  Invoice Date) in the Asset Register while the 3rd line stayed PENDING.
  Confirmed a VIEWER gets no sidebar link and a backend-enforced 403 on
  direct URL access (no data leak). **Found and fixed one real gap
  during UAT**: the running dev database was missing the Purchase Orders
  migration (only the test DB had it) — applied `alembic upgrade head`;
  not a code defect.
- **Cost Centre relocated from per-line to the PO header** (user
  feedback during live UAT — see `DECISIONS.md` point 4): one PO is
  raised against one cost centre in practice. Also fixed, found in the
  same pass: `create_purchase_order`'s validation errors were not being
  translated to a 422 by the router (a 500 instead).
- **New Dashboard "Purchase Orders" card** (ADMIN/IT_TEAM only, see
  `DECISIONS.md` point 9): pending count/value KPI plus a small capped
  list of open POs, each linking into its own detail page. Explicitly
  gated at both the API (`include_purchase_orders`) and frontend layers
  so a VIEWER — who has dashboard access but no `/api/purchase-orders`
  access — never sees PO data through this side channel.
- **Backend: 337/337 passing** (was 312/312 before this feature).
  **Frontend: 169/169 passing** (was 154/154). TypeScript clean. **E2E:
  5/5** (unchanged, no new spec added — the existing suite doesn't touch
  these new screens). **Production build: clean.**
- **No database migration risk** — every migration this feature added is
  additive; every downgrade path drops cleanly with no data-migration
  step, since nothing pre-existing moves into the new tables/column.
- **New Barcode field** (CityKart's own internal tag, distinct from Serial
  Number): entered once per PO line (shared by every unit that line's
  Quantity creates, explicitly allowed to repeat across assets per user
  direction — see `DECISIONS.md`), carried through delivery onto the
  converted Asset, editable afterward via ordinary Asset 360 Edit mode.
  Additive migration `6c882ef3b225`. Verified live end-to-end: added a
  5-quantity line with a shared barcode, delivered 2 of the 5, confirmed
  the barcode landed on the converted Asset's Overview tab and Edit form,
  identical across both delivered units while the 3 remaining lines still
  carry it too.
- **PO screen UX pass** (user feedback after using the screen live):
  "Close" button next to Add Line (navigates back to the PO list — user's
  own words: "so it can go out of po and create new PO", not a PO status
  change); per-column search inputs built into the lines table's own
  header cells (Description/Barcode/Category/PO Value/Status/Serial No);
  a filter-aware "Select All" in the select column's own header — selects
  only the currently-*visible* PENDING rows, leaving any selection on
  filtered-out rows untouched, exactly the "search CT123 → Select All
  selects only the CT123 rows" behavior requested. **Real bug fixed**: the
  Delivery Done dialog had no height cap, so selecting many lines (e.g.
  10+) pushed the Cancel/Confirm buttons off-screen with no scrollbar —
  now capped to the viewport with only the per-line list scrolling, footer
  always reachable. Verified live with 10 lines selected at once.
- **Add Line/Edit line mandatory fields tightened** (user request):
  Description, Barcode, Category, Sub-Category, Cost, and Quantity are now
  all required to add a line (previously only Description/Category were);
  Serial Number/Initial Holder at Delivery Done gained a visible required
  marker (were already functionally required, just not visually marked).
- **Add Asset mandatory fields + Purchase Date auto-derivation** (separate
  user request, extending the same "Purchase Date = Invoice Date" rule
  from the PO path to Add Asset too — see `DECISIONS.md`): Category,
  Sub-Category, Description, Vendor, PO Number, PO Date, Invoice Number,
  Invoice Date, PI Number, PI Date are now all mandatory on `POST
  /api/assets`; Purchase Date is no longer a field on that endpoint or the
  Add Asset form at all — the router derives it as `= invoice_date`
  server-side. Verified live end-to-end: created a real asset with
  Invoice Date 2026-09-22, confirmed the resulting Asset 360 Procurement
  tab shows Purchase Date 2026-09-22 (identical, auto-derived, never
  entered). Deliberately does not touch `AssetUpdateIn`, the AM-07
  correction workflow, or the PO/Pending Asset entry path's own fields.
- **Serial Number: mandatory + globally unique + "N/A" exempt** (separate
  user request, working through a real ground-level problem — see
  `DECISIONS.md` for the full reasoning, including why validation is
  keyed to the *value* `"N/A"`, never to a per-category toggle). Enforced
  by a shared pre-check (`app.assets.service.check_serial_number_unique`,
  reused by `procure_assets` — covering Add Asset and PO Delivery —
  Import, and Asset 360 Edit) plus a partial case-insensitive unique DB
  index (migration `278437eb710e`) as the race-safe backstop. A "No
  serial number for this asset" checkbox in Add Asset, PO Delivery Done,
  and Asset 360 Edit writes the one canonical `"N/A"` automatically.
  Verified live end-to-end: a duplicate (even case-differing) serial is
  rejected with a 422 naming the conflicting asset code; the "No serial
  number" checkbox path creates the asset with `Serial Number: N/A`
  successfully.
- **Backend: 340/340 passing** (was 312/312 before this whole PO stage
  began). **Frontend: 176/176 passing** (was 154/154). TypeScript clean.
  **E2E: 5/5** (unchanged). **No production work of any kind.**

**Open Phase-1 business decisions (none are software defects):**
1. `holder_company_access` — still depends on whether CityKart's real
   Asset/IT team is organizationally shared across companies.
2. Import duplicate detection — a practical option was proposed (an
   optional, non-blocking warning on a repeated Serial Number within the
   same company) but needs CityKart's own confirmation before building.
3. G04 — whether ADMIN's Dashboard needs a per-company breakdown/selector
   — depends on how many real companies CityKart operates in Phase-1.
   AM-12 deliberately left this unresolved, per its own explicit scope
   boundary.

**AM-10's production go-live decisions remain open but deferred, not
resolved and not abandoned** (production data strategy, real `BASE_URL`/
`BACKUP_DIR`, the `UATADMIN` test-account disposition, push/PR strategy,
operational ownership) — see `docs/ai/CKAM_GO_LIVE_CHECKLIST.md` and
`docs/ai/AM-10_GO_LIVE_PREPARATION_REPORT.md`, both preserved as
historical, still-accurate evidence for when a production server exists.

Full AM-12 evidence: `docs/ai/AM-12_DASHBOARD_OPERATIONAL_CONTROL_REPORT.md`.
Full AM-11 evidence: `docs/ai/AM-11_PHASE1_GAP_REVIEW_REPORT.md`, gap
register `docs/ai/PHASE1_GAP_REGISTER.md`.
Full AM-10 evidence: `docs/ai/AM-10_GO_LIVE_PREPARATION_REPORT.md` (a
historical release-readiness checkpoint, not the current development
HEAD — see `docs/ai/CKAM_RELEASE_MANIFEST.md`'s own note on this), plus
`docs/ai/CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md`,
`docs/ai/CKAM_PRODUCTION_SERVER_CHECKLIST.md`,
`docs/ai/CKAM_INITIAL_SETUP_GUIDE.md`, `docs/ai/CKAM_RELEASE_MANIFEST.md`,
`docs/ai/CKAM_GO_LIVE_CHECKLIST.md`.
Full AM-09 evidence: `docs/ai/AM-09_RC_FULL_AUDIT_REPORT.md`, issue
register `docs/ai/RC_ISSUES.md`, deployment procedure
`docs/ai/CKAM_RELEASE_RUNBOOK.md`.
Full AM-08 evidence: `docs/ai/AM-08_RC_HARDENING_REPORT.md`.
Full AM-07 evidence: `docs/ai/AM-07_ASSET_CORRECTION_WORKFLOW_REPORT.md`.
Full AM-06 evidence: `docs/ai/AM-06_IMPORT_REPORTS_MY_ASSETS_REPORT.md`.
Full AM-05 evidence: `docs/ai/AM-05_MASTERS_HOLDERS_REPORT.md`.
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
on create, and (AM-05) may be Global or scoped to one company so a required
field never blocks a company it wasn't meant for. Procurement traceability (including PI Number) is a locked target
requirement, now fully reachable from Add Asset/Asset 360, and (AM-06) from
Import and the asset register export too. Auto-generated Asset Code stays
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

## What's actually done as of AM-05

- **Company-scoped Custom Fields (new business rule, closes an AM-04-
  discovered risk):** `CustomField.company_id` (migration `370399c6380e`,
  nullable, additive, reversible) — `NULL` = Global (every pre-AM-05 row
  keeps this meaning unchanged), a real id = scoped to one company. Add
  Asset and Asset 360 now only ever see Global + their own company's
  active definitions (`applicable_custom_fields`); a field scoped to a
  different company can never render, validate, or block creation for an
  asset outside its scope. `field_key`/`field_type` stay immutable for
  life; scope itself becomes immutable once any asset holds a value under
  that field_key. Custom Fields moved off the generic master pattern onto
  its own screen (`CustomFieldsScreen`) with a Scope selector (full for
  ADMIN, locked to their own company for IT_TEAM, who may never manage a
  Global field) and a stronger, scope-aware confirmation before flipping a
  field from optional to required.
- **Every master screen gained Edit** (previously Create+Deactivate only):
  `MasterCrudScreen` moved onto the shared PageHeader/DataTable/
  EmptyState/ErrorState/AsyncButton/FormField foundation, with a new
  `editFields` config (a strict subset of `formFields`) matching each
  master's new, narrower `*EditIn` backend schema — an immutable field
  (`code`, a company/category relationship) is shown read-only rather than
  silently omitted. Deactivate now confirms and names the record.
- **Holders gained Deactivate** (previously missing entirely), moved onto
  the same shared foundation, and Role edits now show the current role and
  an explicit warning before saving a change — role mutation itself stays
  ADMIN-only end to end (reconfirmed by 3 new backend tests: IT_TEAM cannot
  update, deactivate, or reset the password of any holder).
- **Code Rule gained a loading skeleton and error+retry state** without
  changing numbering semantics; `get_active_rule`'s company-beats-global
  ordering, previously untested beyond integration coverage, now has 5
  dedicated tests.
- Backend: 199 → 231 tests (+32: 15 Custom Field scope authorization/
  immutability/mutation-rules, 9 asset-side applicability regression, 5
  `get_active_rule` ordering, 3 Holder role-security). Frontend: 101 → 121
  tests (+20: `MasterCrudScreen`, the new `CustomFieldsScreen`, Holders
  deactivate/role-warning, Add Asset + Asset 360 company-scoping
  regression). Typecheck clean. E2E: 1 → 2 passing (existing custody
  journey untouched; new multi-company UDF journey proving a required
  field scoped to one company never blocks another company's asset
  creation). Real-browser UAT performed on the master/Custom Fields/
  Holders/Code Rule screens.

## What's actually done as of AM-06

- **Import supports the full V1 asset data model**: every procurement
  field Add Asset supports (Vendor, PO/Invoice/PI Number+Date, Purchase
  Cost/Tax %, Brand/Model/Serial/Warranty), Quantity (multi-create per row,
  sharing one savepoint per row so a mid-row lifecycle failure rolls back
  every unit of that row, never a partial batch), and company-scoped
  Custom Fields via a `Custom:<field_key>` column — reusing AM-05's
  `applicable_custom_fields`/`validate_custom_field_values` directly, no
  parallel rules engine. Column headers are now human-readable business
  names, resolved by name from the workbook's own header row (never
  positional). Subcategory is now optional, matching Add Asset. Existing
  behavior preserved and confirmed unchanged: VALID-ROWS-ONLY per-row
  atomicity, code/emp_code master lookups, and the pre-existing (real, now
  documented) lack of duplicate detection.
- **Export gains the same full field set** plus Custom Field columns
  (union of applicable + retained/retired values, human-readable labels
  throughout, batch id→name maps rather than per-row queries). A new,
  separate field-change-audit export
  (`GET /api/reports/export/field-changes`) was added — asset register,
  movement log, and field-change audit are three explicitly separate
  canonical datasets, never flattened together. Movement log itself is
  unchanged (still the AM-01 point-in-time holder-name snapshots).
- **Import, Reports, and My Assets all moved onto the shared UI
  foundation** — the last three screens outside it. My Assets' hardcoded
  `text-blue-600` link is gone (now the same unstyled SPA `<Link>` Asset
  Register uses) and it has real loading/error/empty states for the first
  time. A My Assets Category column was tried and removed after live UAT
  caught it showing a raw numeric id for a deactivated category — see
  `DECISIONS.md`.
- **No database migration** — confirmed unnecessary (every field already
  existed).
- Backend: 231 → 258 tests (+27: 19 import full-field-support, 8
  export/reports full-field-support). Frontend: 121 → 133 tests (+12: 6
  Import, 3 Reports, 3 My Assets). Typecheck clean. E2E: 2 → 3 passing
  (existing specs untouched; new Import journey using a real generated
  Excel fixture, template→preview→commit→Asset 360). Real-browser UAT
  performed on Import/Reports/My Assets, including the Category-column bug
  found and fixed live.

## What's actually done as of AM-07

- **Controlled Category/Subcategory/Purchase-Date correction workflow
  (new, closes the AM-02/AM-04/AM-05/AM-06-deferred gap):** a dedicated
  `POST /api/assets/{id}/corrections` endpoint (`app/assets/
  correction_service.py`), role-gated ADMIN/IT_TEAM (backend-enforced via
  the same `_get_scoped_asset` helper `update_asset` uses — never a
  frontend-only restriction), reason mandatory, at least one field must
  actually change. `AssetUpdateIn`/ordinary Edit mode were never touched —
  a normal `PUT /api/assets/{id}` still cannot move these three fields,
  confirmed by a regression test.
- **Asset Code, lifecycle status, current Holder, company, and cost centre
  are all provably unchanged by a correction**: the correction service
  never imports the numbering service and never calls `apply_event` —
  confirmed by reading the code, not by a runtime guard alone. Historical
  `asset_event` rows are never rewritten; a Purchase Date correction only
  ever changes `asset.purchase_date` itself.
- **`trg_asset_no_identity_change` needed zero changes** — confirmed by
  reading the original migration, grepping every later migration for a
  redefinition, and querying `pg_proc.prosrc` on the live database: the
  trigger only ever protected `asset_code`/`company_id`/`cost_center_id`,
  never the three correction fields.
- **Category/Subcategory relationship integrity enforced**: a corrected
  category must be active; a subcategory (explicit or carried-forward from
  before the correction) must belong to the *effective* category or the
  request is rejected with an actionable message, never left in an invalid
  pair.
- **Purchase Date chronology invariant**: a corrected Purchase Date cannot
  be in the future and cannot be later than the asset's earliest recorded
  lifecycle event — derived from `apply_event`'s own existing event-date
  rules, not invented.
- **Audit trail reuses `asset_field_change`** (one small additive migration,
  `f28b6a913dce`, adds a nullable `reason` column — the sole discriminator
  between a correction row and an ordinary edit row), with human-readable
  old/new snapshots (`"{code} - {name} (#{id})"` for Category/Subcategory,
  normalized ISO dates for Purchase Date) so a later master rename never
  makes old correction history unreadable.
- **Asset 360 gained a "Correct Classification" action**, separate from
  Edit, showing current values, Asset Code read-only with "will not
  change", an Impact Summary before Confirm, and a mandatory Reason. The
  Changes tab now visually distinguishes a "Correction" from an ordinary
  "Edit" and shows the Reason.
- **No bulk correction** — one asset per request, matching the
  authorization's explicit V1 scope.
- Also closed two AM-06-deferred verification gaps as low-risk evidence
  sweeps (no redesign): `/reports` now has documented Responsive evidence
  at 1440/768/375, and `/change-password` now has documented Security and
  Responsive evidence.
- Backend: 258 → 288 tests (+30). Frontend: 133 → 143 tests (+10). Typecheck
  clean. E2E: 3 → 4 passing. Real-browser UAT performed on the correction
  flow (two live corrections against a real created safe UAT asset) at all
  4 required breakpoints, plus a fresh spot-check of every remaining
  `MasterCrudScreen` route. Two pre-existing, out-of-scope bugs found and
  documented (not fixed): Add Asset's Cost Centre/Category dropdowns are
  not company-scoped (backend still correctly rejects a mismatch), and Add
  Holder sends `location_id=0` instead of omitting a blank Location
  (causes an unhandled 500) — see `REVIEW_FINDINGS.md`.

## What's actually done as of AM-08

- **Add Asset's Cost Centre options are now company-scoped**: the generic
  master list endpoint gained an optional, opt-in `company_id` filter
  (applied only to `SCOPE_COMPANY_ID` masters; every Setup screen's own
  unfiltered usage is unchanged), and Add Asset passes its own company id.
  Category and Vendor were confirmed genuinely global by schema (no
  `company_id` column) and were correctly left unfiltered — the AM-07
  finding's assumption that they needed the same fix did not hold up
  against the actual schema. There is no Company selector inside Add Asset
  to clear dependent fields on (company is fixed from login).
- **`Holder.location_id` is now correctly treated as required** (it always
  was, per the schema — `NOT NULL`) instead of silently defaulting an
  unselected Select to a `0` sentinel that used to reach the database
  unchecked. Save is disabled until Company/Emp Code/Name/Type/Location are
  all set, matching every other required field's pattern. The backend also
  gained defensive existence/active validation for
  company/location/department before insert, so a malformed direct API
  request gets a controlled 422, never a raw database error.
- **A read-only relational field in a `MasterCrudScreen` Edit dialog now
  renders its human-readable label**, not the raw stored id — fixed on
  both Subcategory's parent Category and Cost Centre's parent Company via
  a small, reusable `format` callback (mirroring the existing list-column
  pattern). Presentation only.
- **Route-security evidence sweep**: live API checks across
  ADMIN/IT_TEAM/VIEWER/HOLDER role combinations for asset writes, holder
  writes, master writes, corrections, and reports exports found no
  over-permission. Two results that looked surprising at first (a HOLDER
  getting 200 from the Asset Register and Reports-export endpoints) were
  confirmed, by reading the actual scoping code, to be a HOLDER's
  `holder_id` being pinned server-side to their own id — the same
  mechanism My Assets itself relies on, not a gap.
- **RC database health snapshot** (read-only): zero duplicate Asset Codes,
  zero cross-company cost-centre/holder mismatches, zero invalid
  category/subcategory pairings, zero orphaned `current_holder_id`/
  `asset_event`/`asset_field_change` rows. Every currently-unconstrained
  closed-value column (`asset.status`, `asset_event.event_type`,
  `asset_event.status_after`, `asset_document.doc_type`) holds only
  currently-recognized values in the live data — verification only, no new
  constraint added.
- **Responsive/Design evidence closed**: every remaining `MasterCrudScreen`
  route plus Code Rule verified at 1440/768/375 (previously 🟡); Change
  Password visually compared against Login and confirmed consistent
  (previously 🟡).
- Backend: 288 → 297 tests (+9). Frontend: 143 → 148 tests (+5). Typecheck
  clean. E2E: 4 → 5 passing (new Add Asset company-scoping journey). No
  database migration (confirmed unnecessary — every AM-08 fix is
  frontend/API-validation/presentation).
- **CKAM V1 enters feature freeze.** No further business feature work
  proceeds without new, explicit authorization.

## What's actually done as of AM-09

- **Release Candidate full-system audit, verdict RELEASE READY.** Not a
  feature stage — an aggressive, evidence-based audit of whether the AM-08
  build is genuinely deployable: full role matrix tested via direct API
  calls (not inferred from the frontend), company and HOLDER data
  isolation, database/migration/trigger/index integrity, a real backup and
  a real restore into a disposable database, deployment/secret/CORS
  configuration, numbering concurrency under genuine parallel load, Excel
  export safety, malformed-input robustness, import scale, performance
  sanity, a full responsive sweep, accessibility, and a controlled
  negative test of a backend outage. Full detail:
  `docs/ai/AM-09_RC_FULL_AUDIT_REPORT.md`.
- **Four evidenced P1 defects found and fixed** (commit `4cf98df`), none
  of them P0: (1) Excel formula injection across all three exports — a
  value beginning with `=`/`+`/`-`/`@` is now written as safe literal text,
  never a live formula; (2) a naive (no-timezone) `event_date` on a
  lifecycle event crashed with a raw 500 instead of being treated as UTC;
  (3) a duplicate `code` on any master's create/update crashed with a raw
  500 instead of a clean 422; (4) the same defect on Holders' `emp_code`.
  All four are ordinary-input robustness/security fixes, not business
  logic changes; full regression re-run clean afterward (Backend 305/305,
  Frontend 148/148, Typecheck clean, E2E 5/5).
- **Numbering concurrency confirmed race-safe** under 20 genuinely
  parallel asset-creation requests against the real database — no code
  change needed, the existing atomic UPSERT design was already correct.
  Flagged by the audit as its own key RC test; see the report §16.
- **Backup and restore both proven, not merely assumed**: a real backup
  was executed and a real restore into a disposable database
  (`ckam_restore_test`) reproduced an exact row-count/schema/trigger/index
  match — the live `ckam` database was never touched. See the report
  §36-38 and the new `docs/ai/CKAM_RELEASE_RUNBOOK.md`.
- **No database migration** — confirmed unnecessary; Alembic head remains
  `f28b6a913dce` throughout.
- **5 non-blocking observations documented, not fixed**, per this stage's
  own scope discipline (2× P2, 3× P3) — see `docs/ai/RC_ISSUES.md`
  AM09-05 through AM09-09. None is release-blocking for the current
  LAN-only, HTTP-only deployment model.
- **CKAM V1 feature freeze remains fully in effect.** No new feature work
  was started or authorized in AM-09.

## What's actually done as of AM-10

- **Production go-live preparation, verdict GO-LIVE PREPARED WITH
  DECISIONS REQUIRED.** Not a feature or code-fix stage — a full
  inventory-and-rehearsal pass to determine what remains before an actual
  production cutover. Full detail: `docs/ai/AM-10_GO_LIVE_PREPARATION_REPORT.md`.
- **Full, read-only inventory of the live `ckam` database found it is, in
  its entirety, a development/UAT database**: 98 of 99 companies, 299 of
  305 holders, and 158 of 159 assets are confirmed test data by direct
  evidence, not assumption; the one real company (Citykart Stores) has
  zero genuine business assets, and its only populated supporting masters
  (Cost Centre, Vendor, both active Code Rules) are themselves test
  artifacts. Recommendation: start production from a **fresh database**
  rather than promote the current one — see the report §13 for the full
  reasoning, and `docs/ai/CKAM_INITIAL_SETUP_GUIDE.md` for the correct
  bootstrap order this stage verified live.
- **Found (not fixed): an active ADMIN-role test account (`UATADMIN`)
  sitting inside the real production company** — a go-live blocker per
  data hygiene, not an authorization defect (every role/scope check
  remains correct; this is about which accounts exist, not what they can
  do). Not deactivated automatically, per this stage's own explicit
  instruction.
- **Resolved AM09-05 and AM09-06** (missing security headers, missing
  `Cache-Control`) with a narrow, HTTPS-independent nginx change (commit
  `1f77c24`) — the only code/config change made this stage. Full
  regression re-confirmed clean afterward (Backend 305/305, Frontend
  148/148, Typecheck clean, E2E 5/5).
- **Rehearsed, and proved safe, three previously-untested operational
  paths**: a fresh-production-database bootstrap (owner creation, forced
  password change, minimal master-data setup in dependency order, one
  asset, one export — all against a genuinely disposable database); a
  code-only rollback to the prior release commit (built and run in
  isolation, confirmed to work cleanly against the current schema); and a
  second, independent backup/restore cycle.
- **No database migration** — confirmed unnecessary; Alembic head remains
  `f28b6a913dce` throughout.
- **No deployment, no push, no database promotion, no test-data deletion**
  occurred. `worktree-ckam-build` still has no upstream tracking branch
  and has never been pushed. A local, unpushed release tag
  (`ckam-v1.0.0-rc1`) was created at the final AM-10 commit.
- **CKAM V1 feature freeze remains fully in effect.**

## Deferred, awaiting your decision (not blockers, not failures)

1. **`holder_company_access`**: written to, never read by authorization.
   Classified as either "needed for multi-company asset-team access" or
   "dormant/obsolete" — genuinely depends on whether CityKart's asset team is
   organizationally shared across companies. No behavioral change made in
   AM-01 through AM-08.
2. **Category/subcategory-scoped Custom Fields** were explicitly considered
   and rejected as AM-05 scope (deliberately simpler company-only scoping
   was chosen instead) — a future stage's decision if ever needed.
3. **No import-side duplicate detection** (legacy code, serial number,
   PO/invoice/PI number) — confirmed still absent in AM-08, not added
   without business evidence any of these fields is meant to be unique.
4. **No bulk correction workflow** — AM-07's correction endpoint and UI are
   deliberately single-asset only; a bulk-correction UI is a future stage's
   decision.
5. **5 closed-value DB columns remain unconstrained at the schema level**
   (`asset.status`, `asset_event.event_type`, `asset_event.status_after`,
   `asset_document.doc_type`) — deliberately left flexible for a future
   approval-workflow stage; AM-08's health snapshot confirmed current live
   values are all within the recognized set, but no CHECK/ENUM was added.

None of these business decisions were resolved in AM-09 — their mere
existence is not a release blocker, per the AM-09 authorization's own
instruction. None of `holder_company_access`, import duplicate detection,
approval workflow, AMC/insurance, depreciation, physical verification,
bulk correction, category/subcategory-scoped Custom Fields, a full
company-wide asset audit explorer, new lifecycle states, have been
started — see `REVIEW_FINDINGS.md` for what's still open. AM-11's own
legacy-ThreadERP comparison re-confirmed every one of these exclusions is
still correct for CKAM's actual, deliberately narrower scope — see
`docs/ai/PHASE1_GAP_REGISTER.md` G08-G13.

## What's actually done as of AM-11

- **Phase-1 gap review, verdict PHASE-1 READY WITH MINOR ENHANCEMENTS.**
  Not a production-deployment stage — production remains deferred, no
  production server exists yet. A full business-capability map, a
  read-only legacy ThreadERP comparison (a real, populated 12,862-asset
  production instance), and live browser walkthroughs as ADMIN/VIEWER/
  HOLDER. Full detail: `docs/ai/AM-11_PHASE1_GAP_REVIEW_REPORT.md`, gap
  register `docs/ai/PHASE1_GAP_REGISTER.md`.
- **Two evidenced MUST-HAVE gaps found and fixed** (commit `9607193`):
  the Asset Register could not show who currently holds an asset or which
  company it belongs to without opening every row individually — a direct
  conflict with CKAM's own stated core guarantee — now fixed with two new
  columns populated via a page-scoped batch lookup; and asset search did
  not cover the Description field, now fixed.
- **Legacy ThreadERP comparison confirmed, not challenged, CKAM's
  existing locked V1 scope** — ThreadERP's extensive AMC/Insurance/
  Depreciation/Market-Valuation/Approval-Workflow/Asset-Verification
  functionality is exactly the breadth CKAM's own governance already,
  deliberately excludes for a physical custody-lifecycle tracker, not a
  finance/accounting ERP module.
- **4 SHOULD-HAVE gaps documented, not implemented** — most notably the
  Dashboard's lack of Repair/Lost/Disposed exception visibility and a
  recent-activity feed (real, evidenced, but needs its own mini-gate
  cycle in a future stage rather than being folded into this one). See
  `PHASE1_GAP_REGISTER.md` G03-G07.
- **New development/UAT test-data naming convention established**
  (`DEVELOPMENT_GUARDRAILS.md`): company code `UAT-<stage>-<suffix>`,
  asset description prefix `"UAT - "`, holder emp_code prefix
  `UAT-<stage>-...`. Applied to this stage's own seed data as the first
  real example.
- **No database migration** — confirmed unnecessary; Alembic head remains
  `f28b6a913dce` throughout.
- **No production work, no push, no test-data deletion.** AM-10's
  `ckam-v1.0.0-rc1` tag is preserved unmoved. The existing DEV/UAT
  database's test data (including everything AM-10's own inventory
  found) remains untouched — it is acceptable for a development
  environment, and AM-11 was explicitly instructed not to clean it for
  that reason alone.

## What's actually done as of AM-12

- **Dashboard Operational Control Enhancement (G03), verdict PASS.**
  Closes AM-11's strongest-evidenced remaining SHOULD-HAVE gap: the
  Dashboard previously showed no Repair/Lost/Disposed exception counts and
  no recent-activity feed, despite the underlying data already existing in
  `asset.status`/`asset_event`. Full detail:
  `docs/ai/AM-12_DASHBOARD_OPERATIONAL_CONTROL_REPORT.md`.
- **New "Exceptions" card**: all 5 non-healthy statuses (`UNDER_REPAIR`,
  `LOST`, `DISPOSED`, `SOLD`, `SCRAPPED`) shown explicitly, defaulted to 0
  rather than hidden when empty, each linking straight into the Asset
  Register pre-filtered to that status (`/assets?status=<STATUS>`, a new
  typed route search-param). Reuses the existing `status_counts` query —
  no second database round trip for the counts themselves.
- **New "Recent Activity" card**: the latest 5 lifecycle events, company-
  scoped exactly like the rest of the Dashboard, reusing the exact same
  snapshot-correct holder-name labeling the Asset 360 History tab already
  uses (`with_labels`, relocated from `app.lifecycle.router` into
  `app.lifecycle.service` specifically so this stage could reuse it rather
  than duplicate it). A later holder rename does not retroactively change
  how a past event reads here, same AM-01 guarantee.
- **Both existing KPI cards, Stock by Location, Warranty Expiring Soon,
  and Allotted Over 180 Days are unchanged** — AM-12 extends the
  Dashboard, it does not replace or redesign it.
- **G04 (ADMIN per-company Dashboard breakdown) deliberately left
  unresolved** — explicitly out of scope for this stage, still needs a
  business decision on how many real companies CityKart operates in
  Phase-1.
- **Investigated and ruled out (not a code defect): a HOLDER-role account
  navigating directly to `/dashboard` briefly appeared to show an empty
  "success" Dashboard instead of the expected 403 ErrorState, in this
  session's own live browser.** Confirmed via direct `fetch()` from the
  browser console that the backend correctly returns `403` (unchanged
  HOLDER-cannot-see-dashboard behavior). An isolated unit test exercising
  the *real* `authFetch`/`api-client`/`useQuery` chain (not the mocked
  `apiClient` the permanent test suite uses) against a genuine `403`
  response correctly showed `ErrorState` — proving the application code
  handles this correctly. The live-browser anomaly is attributed to a
  browser-pane/session artifact from this session's own rapid, repeated
  account-switching within one long-lived tab (evidence: a stale,
  pre-rebuild JS bundle hash was observed loading for `/login` moments
  before the correct, current bundle loaded for `/dashboard` in the same
  navigation) — not reproducible in a clean tab or in the real-fetch-chain
  unit test, and not classified as an application defect. Same
  investigate-to-a-clean-conclusion discipline AM-09 §55 used for its own
  "stuck loading" anomaly.
- **No database migration** — confirmed unnecessary; Alembic head remains
  `f28b6a913dce` throughout.
- **No production work, no push, no test-data deletion.**

## Branch / remote state

Working on `worktree-ckam-build` (local worktree). This branch has **never
been pushed to `origin`** — only `claude/brave-euler-07879a` exists on the
remote (a small, unrelated test-DB-safety-guard commit). Pushing is a
decision for the user, not this session, to make explicitly.
