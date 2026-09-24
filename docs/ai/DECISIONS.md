# CKAM — Durable Product Decisions

Newest first. These override older spec/plan text where they conflict.

## 2026-09-24 — AM-04 scope locked (Add Asset + Asset 360 + procurement/UDF UI + edit audit)

0. **Operational risk worth flagging: Custom Fields are global across every
   company** (confirmed in AM-02, unchanged here) **and `is_required` now
   actually blocks asset creation everywhere it applies (new in AM-04).**
   An ADMIN in any one company marking a Custom Field required immediately
   affects every company's Add Asset flow, not just their own — discovered
   concretely during this stage's own browser UAT (a required field created
   to exercise the UI blocked the E2E suite's unrelated fixture company
   until deactivated again). This was already true architecturally since
   Custom Fields were made global, but had no practical consequence until
   `is_required` had real teeth. Not a bug — a genuine characteristic of the
   current single-global-Custom-Field-set design worth keeping in mind
   before anyone adds a required field in the live app; per-company or
   per-category-scoped Custom Fields were never in scope for any stage so
   far and would be a real, separate design decision if ever needed.
1. **Required-UDF enforcement rule.** On asset **create**, every active
   `CustomField.is_required=true` must have a valid value — enforced
   unconditionally, server-side (`procure_assets` always calls
   `validate_custom_field_values(..., enforce_required=True)`), never
   relying on frontend validation alone. On **edit**
   (`PUT /api/assets/{id}`), required-completeness is enforced **only when
   the edit itself includes `custom_fields`** — an existing asset that
   predates a newly-added required field must never be blocked from an
   unrelated edit (e.g. fixing a serial number) just because it has no value
   for that field yet. Since `AssetUpdateIn` is a full-replace PUT (see item
   2 below), Asset 360's Edit mode always submits the complete current
   `custom_fields` set, so every edit made through that UI does enforce
   completeness — which is the correct, intended behavior for a UI that
   shows and lets the user fix that value right there.
2. **`AssetUpdateIn`/`PUT /api/assets/{id}` is a full-replace PUT, not a
   merge-patch** — this predates AM-04 (AM-02's own schema docstring
   already said so) but is worth restating because it is a real, easy-to-miss
   gotcha: a field omitted from the request body is replaced with its schema
   default (usually `null`), not left untouched. Discovered concretely
   during AM-04's own backend test-writing (a test that PUT only
   `description`+`brand` silently wiped `purchase_cost`/`tax_percent` to
   null). **Any caller of this endpoint — UI or script — must prefill and
   resubmit the complete editable-field set**, never a partial diff. Asset
   360's Edit mode does this by construction (it always prefills every
   editable field from the current `GET` response before allowing Save).
3. **Field-change audit is a new, separate, append-only table
   (`asset_field_change`), never folded into `asset_event`.** A lifecycle
   move ("asset moved to Store X") and a descriptive-data edit ("PO Number
   changed from A to B") are different kinds of facts; conflating them would
   make the lifecycle ledger noisier and the field audit harder to reason
   about. One row per genuinely-changed field per edit (not one row per edit
   with a diff blob), written in the same transaction as the edit itself
   (both commit together or neither does), enforced append-only at the
   database level via the same trigger pattern `asset_event` already uses.
   For `vendor_id` specifically, the audit snapshots the vendor's name
   alongside its ID (`"Acme Traders (#7)"`) so a later vendor rename doesn't
   make old history unreadable — the same reasoning AM-01 already applied to
   `asset_event`'s holder names.
4. **Asset 360's Edit mode can only ever touch the AM-02-approved editable
   descriptive/procurement subset.** Identity fields (`asset_code`/
   `company_id`/`cost_center_id`), lifecycle fields (`status`/
   `current_holder_id`/`status_since`), and `category_id`/`subcategory_id`/
   `purchase_date` are not rendered as form controls anywhere in Edit mode —
   not merely disabled — reconfirming the Asset Field Policy Matrix from
   AM-02, not reopening it.
5. **`category_id`/`subcategory_id`/`purchase_date` remain non-editable
   after creation, reconfirmed.** They're displayed in Asset 360 but never
   get an edit control. Same reasoning as AM-02: category/subcategory can
   influence Asset Code semantics, and `purchase_date` feeds numbering
   tokens and the event-ordering invariant. A future stage may define a
   controlled correction workflow; AM-04 does not solve it silently.
6. **Add Asset's section structure**: Organization (Company/Cost Centre) →
   Asset Classification (Category/Sub-Category/Description) → Purchase/
   Procurement (Vendor/PO/Invoice/**PI Number**/Purchase Date) → Asset
   Details (Brand/Model/Serial/Warranty/Legacy Code) → Commercial (Cost/Tax,
   with a preview computed using the same rounding as the backend) →
   Initial Custody (Goes Into/Quantity) → Custom Fields (dynamic, active
   definitions only, `sort_order` respected). Restrained grouping via
   section headings + spacing, not a card per section.
7. **Asset 360's information architecture**: `PageHeader` (Code/
   Description/Status/current Holder+type+location) + lifecycle action
   buttons (unchanged, still `actionRules.ts`-driven) up top, then tabs:
   Overview, Procurement, Custody, Custom Fields, History (lifecycle
   Timeline, unchanged), **Changes** (new — the field-change audit, kept
   visually and structurally separate from History), Documents (unchanged).
8. **A custom field's retained value survives its definition being
   deactivated, and is never silently hidden.** Asset 360's Custom Fields
   tab shows every key in `Asset.custom_fields`; if no active `CustomField`
   definition matches it anymore, it's shown labeled `"<key> (retired
   field)"` rather than dropped, since inactive definitions aren't currently
   exposed by any API this stage was authorized to change.
9. **`AssetDetailOut` (single-asset GET/PUT response only) adds
   human-readable labels** (vendor/category/subcategory/cost-centre/holder/
   location/department names) via a handful of point lookups by primary
   key — additive, never affecting `AssetOut`/the list endpoint, so the
   register doesn't pay for joins it doesn't display.
10. **No backend change beyond what AM-04 explicitly authorized** — one new
    table + its migration (`a409768dc2cf`), the required-UDF check, the
    audit-writing code, and the `AssetDetailOut` label enrichment. No change
    to `asset_event`, the lifecycle state machine, numbering, the Holder
    model, or `holder_company_access`.
11. **The app shell's `SidebarInset` (`components/ui/sidebar.tsx`) now has
    `min-w-0`.** Found via AM-04's mandatory 768px browser check: a flex
    child's default min-width is its content's intrinsic width, so once a
    page's content (Asset 360's PageHeader actions row: status badge + QR
    image + 2 buttons) was wide enough, the whole page silently overflowed
    its viewport at exactly 768px (where the sidebar is docked, not yet a
    drawer, per the existing `md` breakpoint behavior) instead of wrapping.
    Fixed at the shared shell level since this is a general flexbox
    footgun, not something specific to Asset 360 — re-verified Dashboard,
    Asset Register, and Add Asset at the same width show no regression.
    **Don't remove `min-w-0` from `SidebarInset` without re-testing every
    screen at 768px.**

Full evidence: `docs/ai/AM-04_ASSET_ENTRY_360_REPORT.md`.

## 2026-09-24 — AM-03 scope locked (UI foundation + Dashboard + Asset Register)

1. **Shared UI components own presentation/interaction, never business
   logic.** `DataTable` doesn't fetch data, sort, or filter — the page does,
   exactly as Asset Register already did before AM-03. `PageHeader` doesn't
   know about roles or lifecycle. This boundary is deliberate and should
   hold for every future screen migrated onto these primitives.
2. **`DataTable`'s row-click and its selection/action columns are not made
   keyboard-operable via `role="button"`/`tabIndex`/`onKeyDown` on the
   `<tr>`.** A real, independently focusable `<Link>`/`<a>` in one column
   provides keyboard access; the row's own `onClick` is a mouse-only
   convenience. Nesting a synthetic interactive role on `<tr>` around a real
   `<a>` would be invalid ARIA (a widget shouldn't contain another widget),
   so this was a deliberate simplification, not an oversight.
3. **Asset Register's row click now uses the SPA router
   (`useNavigate`/`Link`) instead of `window.location.href`.** This is a
   genuine (if invisible) behavior change, explicitly authorized for AM-03:
   confirmed via network log that a row click no longer re-requests
   `index.html`/the JS bundle, and that the selection checkbox still does
   not trigger navigation.
4. **`StatusBadge`'s tone mapping is presentation-only** and never reads
   from or writes to `Asset.status` — IN_STOCK=info, ALLOTTED/INSTALLED=
   success, UNDER_REPAIR=warning, DISPOSED/SOLD/SCRAPPED=neutral, LOST=
   destructive. The status name is always shown as text, never conveyed by
   color alone. An unrecognized status still renders (neutral tone), it's
   never hidden or thrown on.
5. **`FormField` and part of `AsyncButton` are foundation-only in AM-03** —
   built for the data-entry stage that follows, not wired into any existing
   form. Only Asset Register's bulk-move Confirm button actually uses
   `AsyncButton` in this stage.
6. **No backend, schema, migration, or authorization change in AM-03** — a
   hard constraint, not just a preference; the entire stage is frontend
   presentation only. Backend test count stayed at 184/184 throughout.
7. **Only Dashboard and Asset Register are migrated onto the new
   components in AM-03.** Every other screen (Asset Detail, Add Asset,
   Holders, Import, Reports, My Assets, the 8 master screens) is unchanged
   and still needs its own migration in a future stage — not a silent
   scope expansion, an explicit boundary (AM-03 §9-§11/§19).

Full evidence: `docs/ai/AM-03_UI_FOUNDATION_REPORT.md`.

## 2026-09-24 — AM-02 scope locked (asset data model + procurement + custom fields)

1. **PI Number is CityKart's internal/reference number for a payment made to
   a vendor** — explicitly not Proforma Invoice, no evidence anywhere in the
   codebase or legacy data suggested that reading. Locked; do not
   reinterpret without new evidence.
2. **Procurement fields were already complete in the data model** — the real
   AM-02 gap was that `AssetOut` didn't return them, and no edit endpoint
   existed. Both fixed. No new procurement columns were needed or added.
3. **Custom Fields (UDF) reuse the existing `CustomField` table and
   `Asset.custom_fields` JSON column** — no new normalized value table. The
   JSON approach already satisfies duplicate-prevention (by construction)
   and safe history (definitions are soft-delete only). Supported types:
   `text`, `number`, `date`, `dropdown`, `checkbox`. `is_required` exists on
   the definition but is **not** enforced yet — deliberately deferred, since
   nothing writes custom field values through any UI yet.
4. **`holder.holder_type`, `holder.role`, `custom_field.field_type` are now
   closed-value at both the API (422) and database (CHECK constraint)
   levels.** `asset.status`/`asset_event.event_type`/`asset_event.status_after`
   deliberately do **not** get a CHECK constraint — they're the surface most
   likely to gain a new legal value if a future stage adds an approval
   workflow.
5. **`category_id`, `subcategory_id`, `purchase_date` are not yet editable**
   after asset creation — they feed code-generation tokens and lifecycle
   date invariants; exposing them safely is a future decision, not made now.
6. **No UI redesign in AM-02** — the frontend was not touched. The Add Asset
   form, Asset Detail, and Register all still render only the original field
   subset; wiring the newly-exposed fields into any screen is future work.
7. **`holder_company_access` stays untouched** — reconfirmed, no behavior
   change, same as AM-01.

Full evidence: `docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md`.

## 2026-09-24 — V1 scope locked (AM-01 authorization)

These decisions came directly from the user's review of the Product & Domain
Architecture Assessment and are now locked for V1. Do not re-open them in a
future session without an explicit new instruction — the assessment's own
"business confirmation required" list has been answered by this entry.

1. **No approval workflow in V1.** ADMIN/IT_TEAM may execute permitted
   lifecycle transitions directly; every transaction stays fully auditable
   via the existing append-only ledger. The architecture must not be built
   in a way that blocks adding optional approval later, but no approval
   engine work happens now. The lifecycle state machine itself is not
   altered to make room for this.
2. **Single current-holder/custody concept.** No split between "accountable
   custodian" and "physical user" in V1 — the existing `Holder`/
   `current_holder_id` model stays as one concept, provided its holder types
   (`EMPLOYEE`/`STORE`/`INSTALLED`/`IT_STOCK`) genuinely represent CityKart's
   real custody scenarios (confirmed true — see `AM-01_DATA_INTEGRITY_REPORT.md` §3.1/§8).
3. **AMC/Insurance are future capabilities, not V1.** Keep the existing basic
   warranty fields (`warranty_upto`) as-is; no contract-management module now.
4. **Depreciation/accounting are out of scope.** CKAM is an operational
   asset-management system, not a statutory fixed-asset accounting engine.
   ThreadERP's multi-book depreciation architecture is explicitly not to be
   copied.
5. **Physical verification is a future capability.** Not built now, but the
   QR/barcode architecture must remain suitable for it later (no design
   decision should foreclose this).
6. **Lost/Damaged tracking stays lifecycle-only in V1**: state, reason,
   remarks, and audit/history. No employee cost-recovery, insurance
   accounting, or write-off accounting workflows yet.
7. **Custom Fields are REQUIRED — do not remove the master.** The real
   problem is that it exists with zero consumers (confirmed in the AM-00
   assessment). Wiring it into Add Asset / Asset Detail / import-export is a
   future stage's work, not done in AM-01.
8. **Procurement traceability is a core requirement**, including: Company,
   Cost Centre, Vendor, PO Number, Invoice Number, Invoice Date, **PI
   Number** (the internal reference for a payment made to a vendor — must
   never be dropped from the data model or Asset 360), Purchase Date,
   Purchase Cost, Serial Number, Brand, Model, Description, Category,
   Subcategory, Warranty Upto, Asset Code. Not all fields need to be
   mandatory; exact requiredness is defined later.
9. **Auto-generated Asset Code stays mandatory.** The existing race-safe
   numbering architecture (`code_counter`'s atomic UPSERT) is preserved
   as-is unless a concrete defect is found — none was.
10. **CKAM supports at least two CityKart companies.** An asset's Cost Centre
    must belong to its own company — **confirmed already enforced** at both
    asset creation (`procure_assets`) and bulk import (`commit_import`), and
    structurally locked post-creation by the `trg_asset_no_identity_change`
    DB trigger. Now test-covered on both paths (AM-01).
11. **No login company selector** — already implemented (see the 2026-09-24
    login-identity-resolution entry below); reconfirmed as the correct,
    locked behavior, not reopened.
12. **Core V1 lifecycle stays the existing simple one:** Procured/Registered
    → IT Stock/Available → Assigned to User/Location → Returned to IT Stock
    → Reassigned, plus the existing controlled cases (Repair, Lost/Found,
    Disposed/Sold/Scrapped). Full chronological history must never be lost
    — reinforced by AM-01's historical-snapshot fix, which stops a holder
    rename from retroactively changing how that history displays.

## 2026-09-24 — Login has no company selector; identity resolution is fail-closed

**Decision:** The login screen asks only for User ID (Emp Code or email) and
Password. No Company dropdown.

**Why:** Requiring a company selector on every login was pure friction for a
single-company deployment, and added a step users had no way to get wrong
(there's exactly one real answer). The company-selector-based design was a
holdover from initial multi-tenant caution, not a real requirement.

**How it's actually resolved (this matters — it's not a naive fix):**
`emp_code` and `email` are only unique **per company**
(`UniqueConstraint(company_id, emp_code)` and the partial unique index from
migration `0005_holder_email_unique.py`), so `login_id` alone does not
uniquely identify a holder in the general case — it's possible, though
unlikely, for the same id to exist in two different companies.

The backend (`app/auth/router.py::login`) queries across every **active**
company for a holder matching `login_id`, and:
- exactly one match → proceed normally
- zero matches → 401 "Invalid credentials"
- **more than one match → 401 "Invalid credentials" (the same message as
  zero matches — no information leak) plus a server-side warning log**, so
  an admin can rename one of the colliding accounts. It never guesses, and
  it never silently picks the first row.

This is deliberately conservative: an account-takeover risk (silently
picking the wrong company's same-named account) is worse than a rare,
loud-in-the-logs "please disambiguate this" failure.

Company authorization/scoping after login is unaffected — the JWT still
carries the resolved `company_id`, and every downstream endpoint scopes by
it exactly as before.

**No migration was needed or applied** beyond the pre-existing
`0005_holder_email_unique.py` (already in place from an earlier stage) —
this stage only changed the login query, not the schema.

## 2026-09-24 — CKAM has its own visual identity

**Decision:** Deep navy primary + the existing brand teal as a secondary
accent, light canvas, no dark chrome (see `DESIGN_SYSTEM.md`). Other CityKart
applications (e.g. Citykart Desk) are used only as structural/UX references
— their exact colors, branding, and components are never copied.

**Why:** The user explicitly asked for CKAM's own identity, distinct from
sibling apps, after finding an earlier teal-only palette visually weak.

## 2026-09-24 — Sidebar shell replaces the flat top nav

**Decision:** Left sidebar (collapsible, grouped, icon-labeled) + light top
header, replacing the original single-row top nav + Setup dropdown.

**Why:** The flat nav didn't scale to CKAM's real number of screens (19),
and the Setup dropdown buried 10 of them behind a menu. Explicitly requested
by the user after seeing a reference app's sidebar pattern.

**Constraint that shaped this:** the header must stay **light**, not dark —
the logo is a transparent PNG with dark content and no light backing plate,
so a dark header makes it unreadable. This was discovered and fixed live
(see commit `feat(shell): replace the top nav with a collapsible CKAM
sidebar` and the follow-up header-color fix folded into it).

## Existing lifecycle/custody logic is preserved

**Decision:** The append-only event ledger, the lifecycle state machine, and
all existing scoping/authorization rules from the original 26-task SDD build
remain the source of truth. UI work does not get to quietly change them.

**Why:** Stated explicitly as a hard constraint for this stage of work; also
consistent with the original build's own design principles.
