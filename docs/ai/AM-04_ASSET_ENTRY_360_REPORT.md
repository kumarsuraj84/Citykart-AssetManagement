# CKAM — AM-04 Asset Data Entry + Asset 360 Report

**Stage:** AM-04 (Add Asset + Asset 360 + procurement/UDF UI + edit audit)
**Date:** 2026-09-24

---

## 1. Executive Summary

AM-04 made the asset data model AM-02 completed genuinely usable: Add Asset
was redesigned into a sectioned form exposing every procurement field the
API has supported since AM-02 — including PI Number — plus dynamically
rendered active Custom Fields, and Asset Detail became "Asset 360," a
tabbed, role-gated, editable view of an asset's full state. A new
lightweight, append-only field-change audit (`asset_field_change`, one new
table) now records every descriptive/procurement edit separately from the
lifecycle ledger. Required Custom Fields are enforced server-side for the
first time, with a compatibility rule that never blocks an existing asset's
unrelated edit.

Two real bugs were found and fixed via this stage's own mandatory browser
UAT, not just written down: a page-level horizontal-overflow bug at 768px
(the app shell's `SidebarInset` needed `min-w-0`) and Asset 360's 7-tab list
needing its own horizontal scroll container. A third issue was operational,
not code — a required Custom Field created during UAT is global by design
(confirmed in AM-02) and briefly blocked the E2E suite's unrelated fixture
company until deactivated; this is now documented as a real characteristic
of the current design in `DECISIONS.md`, not a defect.

No approval workflow, AMC/insurance, depreciation, or physical verification
was touched. No Masters/Holders/Import/Reports/My Assets screen was
touched. `category_id`/`subcategory_id`/`purchase_date` remain
non-editable, reconfirmed rather than silently solved.

---

## 2. Git Preflight

Performed before any AM-04 change:

- Absolute repository path: `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build`
- Branch: `worktree-ckam-build`
- HEAD at preflight time: `8c411eb` — the AM-03 authorization's own report
  flagged a possible inconsistency around this commit (see §3 below)
- `git status`: clean
- `git log --oneline -10` and `git log b84c170..HEAD`: confirmed `8c411eb`
  was the one and only commit after `b84c170`, and it was itself the
  "record the actual final commit hashes" follow-up correction commit —
  its own content is what needed fixing (see §3)
- Remotes: `origin → https://github.com/kumarsuraj84/Citykart-AssetManagement.git` — unchanged, not touched
- Alembic heads: `3a44505b6b10` (single head) — matched expected
- Alembic current on `ckam_test`: `3a44505b6b10` — matched
- Alembic current on live `ckam`: `3a44505b6b10` — matched

`backend/`, `frontend/`, `CLAUDE.md`, `docs/ai/` all confirmed present and
read before coding. No unrelated or unexpected work was found in the
worktree; no STOP condition was triggered.

## 3. AM-03 Final-HEAD Inconsistency Resolution

The AM-03 report's §34 had already been through one self-correction pass
(commit `8c411eb`, `docs(ai): AM-03 report -- record the actual final
commit hashes`), but that correction itself contained a copy-paste error:
its bolded **"Ending HEAD"** line still literally read `` `b84c170` `` —
one commit behind the real final state — while the surrounding prose
correctly described a later follow-up commit. This is exactly the
inconsistency the AM-04 authorization flagged and asked to be resolved
before proceeding.

Fixed by directly re-reading the committed file, confirming the real chain
(`683dacd` → `9b6167c` → `8c31688` → `b84c170` → `8c411eb`), and correcting
the bolded line to name `8c411eb` as the actual ending HEAD, with both
`b84c170` and `8c411eb` listed as separate, named commits. No AM-03
technical content was rewritten — this was a documentation-accuracy-only
correction, the same class of fix AM-03 itself made to AM-02's report.

## 4. Documentation Correction Commit

`e1e5520` — `docs(ai): AM-04 preflight -- fix AM-03 report's Ending HEAD (was still b84c170, not the actual follow-up commit)`

## 5. Starting AM-04 HEAD

`e1e5520` (the preflight correction commit itself).

## 6. Starting Test Baseline

Re-verified directly before any AM-04 code:

- Backend: **184/184 passing** — matched the AM-03 authorization's expected value.
- Frontend: `npx tsc -b` clean; `npx vitest run` **81/81 passing** (23 files) — matched.
- Alembic: `3a44505b6b10` on both databases — matched.
- E2E: not re-run at this exact checkpoint (already confirmed 1/1 passing at
  the close of AM-03 moments earlier with a clean, untouched working tree
  in between, so no drift was possible).

---

## 7. Add Asset Before-State Audit (read-only, before any change)

Read directly: `frontend/src/features/assets/AddAssetForm.tsx` and every
API it called (`/masters/categories`, `/masters/subcategories`,
`/masters/cost-centers`, `/holders?holder_type=IT_STOCK&company_id=…`,
`POST /assets`), and the backend contract (`AssetCreateIn`, confirmed in
AM-02).

| Field | Current UI (before) | API Field | Required by Backend | Master/Lookup | AM-04 Target |
|---|---|---|---|---|---|
| Company | implicit (prop, not a field) | `company_id` | required | — | unchanged (implicit) |
| Cost Centre | ✅ Select | `cost_center_id` | required | `/masters/cost-centers` | keep |
| Category | ✅ Select | `category_id` | required | `/masters/categories` | keep, now clears Sub-Category on change |
| Subcategory | ✅ Select (unfiltered) | `subcategory_id` | optional | `/masters/subcategories` | filter by selected Category |
| Description | ✅ Input | `description` | required | — | keep |
| Purchase Date | ✅ Input (date) | `purchase_date` | required | — | keep |
| Initial Holder | ✅ Select (IT_STOCK, scoped) | `initial_holder_id` | required | `/holders?...` | keep, relabel "Goes Into" |
| Quantity | ✅ Input (number) | `quantity` | default 1 | — | keep |
| Purchase Cost | ✅ Input (number) | `purchase_cost` | optional | — | keep |
| Tax % | ✅ Input (number) | `tax_percent` | optional | — | keep |
| Tax Amount / Total Cost | ✅ live-computed display | *(derived)* | n/a | — | keep, round like backend |
| Vendor | ❌ not rendered | `vendor_id` | optional | `/masters/vendors` | **add** |
| PO Number / PO Date | ❌ not rendered | `po_number`/`po_date` | optional | — | **add** |
| Invoice Number / Date | ❌ not rendered | `invoice_number`/`invoice_date` | optional | — | **add** |
| **PI Number / PI Date** | ❌ not rendered | `pi_number`/`pi_date` | optional | — | **add** |
| Brand / Model / Serial Number | ❌ not rendered | `brand`/`model`/`serial_number` | optional | — | **add** |
| Warranty Upto | ❌ not rendered | `warranty_upto` | optional | — | **add** |
| Legacy Asset Code | ❌ not rendered | `legacy_asset_code` | optional | — | **add** |
| Custom Fields | ❌ not rendered | `custom_fields` | conditionally required (new AM-04 rule) | `/masters/custom-fields` | **add**, dynamic |

No duplicate fields were created — every field above maps to exactly one
existing `AssetCreateIn` field, confirmed against `backend/app/assets/schemas.py`.

## 8. Asset Detail Before-State Audit (read-only, before any change)

Read directly: `frontend/src/features/assets/AssetDetail.tsx`.

- `if (!asset) return null;` — no loading state, no error state, no
  not-found state. A slow or failed fetch showed a completely blank page.
- Header: asset code, description, a plain `Badge` (not semantic) for
  status, QR image, Print Label button, lifecycle action buttons. No
  current-holder name, type, or location shown anywhere in the header.
- Tabs: Overview (just repeated the description text — no other field),
  History (real `Timeline`, already good), Documents (real `DocumentsTab`,
  already good).
- No Procurement, Custody, or Custom Fields content anywhere — none of the
  ~16 procurement/descriptive fields `AssetOut` has returned since AM-02
  were displayed.
- No edit capability of any kind — the AM-02 `PUT /api/assets/{id}` had no
  frontend consumer.
- No field-change history of any kind (none existed yet — this stage adds it).

---

## 9. Add Asset Field Matrix

The complete matrix is §7 above (audit-before-change and target-after-change
combined into one table, since every "Target" column entry was implemented
exactly as stated — no field was added and then not implemented).

## 10. Final Form Structure

Seven sections, restrained grouping (section heading + `grid gap-4
sm:grid-cols-2` + `Separator`, never a `Card` per section):

1. **Organization** — Cost Centre.
2. **Asset Classification** — Category, Sub-Category (filtered by Category),
   Description.
3. **Purchase / Procurement** — Vendor, Purchase Date, PO Number/Date,
   Invoice Number/Date, PI Number/Date.
4. **Asset Details** — Brand, Model, Serial Number, Warranty Upto, Legacy
   Asset Code.
5. **Commercial** — Purchase Cost, Tax %, a computed Tax Amount/Total Cost
   preview.
6. **Initial Custody** — Goes Into (Initial Holder), Quantity.
7. **Custom Fields** — dynamically rendered, only present if at least one
   active `CustomField` exists.

## 11. Procurement Fields Wired

Every field named "add" in §7's matrix now has a real `FormField`-wrapped
control in the form and is included in the `POST /assets` payload. Verified
by an automated test (`renders procurement fields (vendor, PO, invoice, PI
Number, warranty) and submits them`) asserting the exact POST body, and by
live browser UAT creating a real asset with every one of these fields
populated (§32).

## 12. PI Number UI Behavior

Rendered as a plain text `Input` with `FormField`'s `helperText` set to
"CityKart's internal reference for the payment made to the vendor" — the
same definition locked in `docs/ai/DECISIONS.md` since AM-01/AM-02, restated
here at the point of entry so an operator filling the form sees it, not
just a report. Optional (matches the backend, which has never required it).
Round-trips correctly: confirmed via live browser UAT (`PI-UAT-1` entered
on create, displayed unchanged in Asset 360's Procurement tab).

## 13. UDF Rendering Architecture

One rendering rule per `CustomField.field_type`, shared conceptually
between Add Asset (create) and Asset 360's Edit mode (update) — not two
independently-maintained implementations, though each screen owns its own
component-local state (no shared UDF-editing component was extracted,
since the two screens' surrounding state shapes differ enough that a shared
abstraction would need its own prop-plumbing layer for marginal benefit —
a deliberate "avoid over-abstraction" call, not an oversight):

- `text` → `Input`
- `number` → `Input type="number"`
- `date` → `Input type="date"`
- `dropdown` → `Select`, options from `field.options.choices`
- `checkbox` → `Checkbox` + `<label>` (not wrapped in `FormField`, since a
  checkbox has no separate helper/error slot in this pattern)

Only active (`is_active=true`) definitions are fetched (`GET
/masters/custom-fields` already filters this server-side, unchanged) and
rendered in `sort_order` ascending order. No field is ever rendered from an
unknown definition (the list itself is authoritative), no arbitrary HTML is
interpreted (every value is rendered as plain text/React children, never
`dangerouslySetInnerHTML`), no script execution is possible.

## 14. Required-UDF Enforcement Behavior

**On create:** every active `CustomField.is_required=true` must have a
valid value, enforced unconditionally server-side
(`validate_custom_field_values(..., enforce_required=True)` in
`procure_assets`) — never relying on the frontend alone. The frontend also
blocks Save and shows an inline `"<Label> is required."` error via
`FormField`'s `errorText`, for immediate feedback, but the backend check is
authoritative and independently tested.

**On edit:** required-completeness is enforced **only when the edit request
itself includes `custom_fields`** (`replacing_custom_fields = data.get
("custom_fields") is not None` in `update_asset`). Since `AssetUpdateIn` is
a full-replace PUT (see §15), Asset 360's Edit mode always submits the
complete current `custom_fields` set when Edit mode is used at all, so
every edit made through that specific UI does enforce completeness — which
is correct: if an operator opens the edit form and sees an empty required
field, saving without filling it in should fail, exactly as it does.

## 15. Existing-Asset Compatibility Rule

Documented in `docs/ai/DECISIONS.md` and restated here: an existing asset
that predates a newly-added required Custom Field must never be blocked
from an unrelated edit (e.g. correcting a serial number typo) merely
because it has no value for that field yet. This is why required-
completeness is conditioned on `custom_fields` being present in the edit
request, not checked unconditionally on every `PUT`.

A related, real gotcha surfaced while writing this stage's own backend
tests (not a new AM-04 behavior, but easy to miss): `AssetUpdateIn` is a
**full-replace** PUT (this was already documented in AM-02's schema
docstring). A test that sent only `description`+`brand` silently wiped
`purchase_cost`/`tax_percent` to `null`, because those fields simply
weren't in the request body and the schema default is `None`. Asset 360's
Edit mode is safe by construction — it always prefills every editable
field (including the full current `custom_fields`) from the latest `GET`
before allowing Save — but this is now called out explicitly in
`DECISIONS.md` as a rule any future caller of this endpoint must follow.

Both directions verified by dedicated backend tests: `test_old_asset_can_be
_edited_without_a_newly_required_missing_udf_blocking_it` and
`test_edit_that_explicitly_submits_custom_fields_enforces_required
_completeness`.

---

## 16. Asset 360 Information Architecture

`PageHeader` (Asset Code as title, Description as description; Status
badge, QR image, Print Label, and a role-gated Edit button in the actions
slot; a "Held by `<holder>` (`<type>`) · `<location>`" line and the
lifecycle action buttons below) + tabs:

- **Overview** — identity/classification (Asset Code, Legacy Asset Code,
  Description, Category, Sub-Category, Brand, Model, Serial Number).
- **Procurement** — Vendor, PO Number/Date, Invoice Number/Date, **PI
  Number/Date**, Purchase Date, Purchase Cost, Tax %, Tax Amount, Total
  Cost, Warranty Upto.
- **Custody** — current Holder, Holder Type, Location, Department, Cost
  Centre, Status (as `StatusBadge`), Status Since.
- **Custom Fields** — every key in `Asset.custom_fields`, labeled from the
  matching active `CustomField` definition when one exists, or `"<key>
  (retired field)"` when it doesn't (§18).
- **History** — the existing, unchanged lifecycle `Timeline`.
- **Changes** (new) — the field-change audit, via `DataTable`, kept
  structurally and visually separate from History (§22).
- **Documents** — the existing, unchanged `DocumentsTab`.

Read-only tab content uses a `<dl>`/`ReadField` label-value grid, not a
table, since each tab shows one asset's own attributes rather than rows of
many assets — an em-dash (`—`) for any empty value, never a blank cell.

## 17. Asset Edit-Mode Policy

A role-gated (`ADMIN`/`IT_TEAM`, checked client-side for UX and
independently enforced server-side by the existing AM-02
`require_role("ADMIN", "IT_TEAM")`) "Edit" button in `PageHeader`'s actions
slot swaps the tabbed read view for a single, un-tabbed edit panel with
Save (`AsyncButton`)/Cancel. Uses the existing `PUT /api/assets/{id}`
unchanged. Prefills every editable field (including the full current
`custom_fields`) from the asset already loaded — never a partial diff, per
§15.

## 18. Immutable/Lifecycle Field Protections

Verified two ways:

1. **By construction**: `asset_code`, `company_id`, `cost_center_id`,
   `status`, `current_holder_id`, `status_since`, `category_id`,
   `subcategory_id`, `purchase_date` are simply never rendered as form
   controls anywhere in Edit mode's JSX — not present in the DOM at all,
   not merely `disabled`. Confirmed live via `document.getElementById(...)`
   returning nothing for any of these field IDs while editing (§32), and by
   an automated test (`never renders an editable control for an
   immutable/lifecycle field while editing`) that checks the same thing
   plus asserts no input anywhere on the page carries the asset code as its
   value.
2. **Defense in depth, unchanged from AM-02**: even if a field were somehow
   included in a raw `PUT` request body, `AssetUpdateIn` doesn't declare
   those fields at all (extra JSON keys are silently ignored by Pydantic),
   and `trg_asset_no_identity_change` would reject `asset_code`/
   `company_id`/`cost_center_id` at the database level regardless.

Also true for a retained custom-field value whose definition is now
inactive: the "Custom Fields" tab of Asset 360 (read view) shows it
labeled `"<key> (retired field)"`, but Edit mode's dynamic UDF renderer
only iterates **active** definitions (§13) — so a retired field's stored
value is preserved and displayed but cannot be edited through this UI,
which is the correct, conservative behavior (nothing in this stage exposes
editing a field the master no longer considers valid).

---

## 19. Field-Change Audit Architecture

A new, separate, append-only table — never folded into `asset_event`. A
lifecycle move ("asset moved to Store X") and a descriptive-data edit ("PO
Number changed from A to B") are different kinds of facts; conflating them
would make the lifecycle ledger noisier and the field audit harder to
reason about (see `DECISIONS.md`).

One row per genuinely-changed field per edit (not one row per edit with a
diff blob), so a single field's history can be queried or displayed
without parsing JSON. `request_id` (a UUID generated once per `PUT` call)
groups every row written by the same edit together, so the UI can present
one edit's several changed fields as one logical event if a future stage
wants to.

Diffing happens in `app/assets/audit_service.py::record_field_changes`:
captures a `before` dict of every audited field immediately before mutating
the ORM object, an `after` dict immediately after, and writes one row per
key where `before != after`. Custom fields are diffed per-key (union of
keys present in either side), producing `field_name` values like
`custom_fields.asset_condition`, never one giant JSON diff blob.

For `vendor_id` specifically, the audit snapshots the vendor's name
alongside its ID (`"Acme Traders (#7)"`) via a point lookup at write time,
so a later vendor rename doesn't make old history unreadable — the same
reasoning AM-01 already applied to `asset_event`'s holder names. Verified
by test (`test_vendor_change_audit_snapshots_the_vendor_name_not_just_the
_id`) and live in the browser (§32).

## 20. Audit Database Model

`AssetFieldChange` (`backend/app/assets/models.py`), table
`asset_field_change`:

| Column | Type | Notes |
|---|---|---|
| `id` | BigInteger PK | |
| `asset_id` | BigInteger, FK → `asset.id` | |
| `field_name` | String(100) | e.g. `"brand"`, `"custom_fields.asset_tag"` |
| `old_value` | String(1000), nullable | serialized, `NULL` for a genuinely-`None` prior value |
| `new_value` | String(1000), nullable | serialized, `NULL` for a genuinely-`None` new value |
| `actor_id` | BigInteger, FK → `holder.id` | who made the edit |
| `request_id` | String(36) | UUID, groups rows from one `PUT` call |
| `created_at` | DateTime(timezone=True), server_default `now()` | |

Indexed on `(asset_id, created_at, id)` for the chronological per-asset read
the "Changes" tab needs. No `updated_at`/`updated_by` — this table is never
updated after insert (enforced at the database level, see §23/§24).

## 21. Audit API

`GET /api/assets/{id}/changes` (`backend/app/assets/router.py`). Scoped
**identically to viewing the asset** — routes through the same
`_get_scoped_asset` every other `/api/assets/{id}/...` endpoint uses, so a
`HOLDER` sees only their own currently-held asset's history, a
company-scoped `IT_TEAM`/`VIEWER` gets 404 for another company's asset
(same as every other asset endpoint — no information leak), and `ADMIN`
(globally unscoped by design, confirmed in AM-01/AM-02) sees everything.
Chronological, oldest-first (`ORDER BY created_at, id`), matching the
lifecycle Timeline's existing ordering convention. No pagination —
genuinely not needed at current scale (a handful of edits per asset over
its lifetime), and adding it speculatively would have been exactly the
"generic enterprise audit explorer" the authorization explicitly forbade.
Each row's `actor_name` is resolved via one batched query for all distinct
`actor_id`s in the result set (not N+1).

Verified by tests: authorized read returns the right rows with the right
actor name; a cross-company `IT_TEAM` gets 404, not leaked data;
chronological ordering holds across multiple edits.

## 22. Lifecycle-vs-Data-Change Separation

Enforced structurally, not just by convention: `apply_event` (the sole
writer of `asset_event`, unchanged) is never called from `update_asset`,
and `record_field_changes` (the sole writer of `asset_field_change`) is
never called from `apply_event` or the lifecycle event router. Verified by
test (`test_a_lifecycle_event_writes_to_asset_event_only_not_the_field
_change_audit`): posting a `MOVED` lifecycle event produces a new
`asset_event` row and **zero** `asset_field_change` rows. Asset 360
surfaces this separation visually too — "History" (lifecycle) and
"Changes" (field edits) are two different tabs, never merged, with
History's own empty-state copy explicitly pointing to "Changes" for the
other kind of history and vice versa.

---

## 23. Database Migration

Revision `a409768dc2cf`, `down_revision = '3a44505b6b10'`. Additive only:
creates `asset_field_change` (+ its index), plus the same append-only
trigger pattern `asset_event` already uses:

```sql
CREATE OR REPLACE FUNCTION forbid_asset_field_change_write() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'asset_field_change rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asset_field_change_no_update BEFORE UPDATE ON asset_field_change
  FOR EACH ROW EXECUTE FUNCTION forbid_asset_field_change_write();
CREATE TRIGGER trg_asset_field_change_no_delete BEFORE DELETE ON asset_field_change
  FOR EACH ROW EXECUTE FUNCTION forbid_asset_field_change_write();
```

Fully reversible (`downgrade()` drops the triggers, function, index, and
table, in that order). `alembic --autogenerate` also proposed dropping and
recreating several pre-existing partial/expression indexes on
`asset`/`asset_event`/`holder` — confirmed as false positives (a known
autogenerate limitation with partial/functional indexes it can't diff
cleanly) and removed from the migration by hand; nothing about those
indexes actually changes. No change to `asset_event`, lifecycle statuses,
numbering, the Holder model, or any existing snapshot column.

**Applied to `ckam_test` first**, full backend suite run (199/199 passing),
**then applied to live `ckam`** — no existing-data conformance check was
needed since this migration adds a new empty table, not a constraint on
existing rows. Post-migration, verified on live `ckam`: the table exists
with the expected columns/index, both triggers present, and — together
with the two pre-existing `asset_event` triggers and the one
`asset`-identity trigger — all 5 database triggers in the system are
intact.

## 24. Backend Changes

- `backend/app/assets/custom_field_values.py` — `validate_custom_field_values`
  gained an `enforce_required` keyword; now fetches all active `CustomField`
  rows (not just the submitted keys) so it can check completeness against
  fields the caller didn't even mention.
- `backend/app/assets/service.py` — `procure_assets` now calls
  `validate_custom_field_values(..., enforce_required=True)` unconditionally.
- `backend/app/assets/models.py` — new `AssetFieldChange` model.
- `backend/app/assets/audit_service.py` — new file, `record_field_changes`.
- `backend/app/assets/schemas.py` — new `AssetDetailOut` (extends `AssetOut`
  with 8 label fields) and `AssetFieldChangeOut`.
- `backend/app/assets/router.py` — `get_asset`/`update_asset` now return
  `AssetDetailOut` via a new `_to_detail_out` helper; `update_asset` now
  diffs before/after and writes audit rows in the same transaction as the
  edit, and conditions required-UDF enforcement on whether `custom_fields`
  was in the request; new `GET /{asset_id}/changes` endpoint.
- `backend/app/alembic/versions/a409768dc2cf_asset_field_change_audit.py` — new migration.

No change to `backend/app/lifecycle/`, `backend/app/numbering/`,
`backend/app/holders/` (beyond what AM-02 already did), or
`backend/app/masters/` (beyond what AM-02 already did).

## 25. Frontend Changes

- `frontend/src/features/assets/AddAssetForm.tsx` — full rewrite (§10-§13).
- `frontend/src/features/assets/AssetDetail.tsx` — full rewrite (§16-§18).
- `frontend/src/lib/api-client.ts` — new `ApiError` class (carries HTTP
  status), additive and backward-compatible with every existing
  `instanceof Error` check.
- `frontend/src/components/ui/sidebar.tsx` — `SidebarInset` gained
  `min-w-0` (§14 of §32's findings below; a real bug fix, not a redesign).
- `frontend/e2e/asset-lifecycle.spec.ts` — updated for Add Asset's new
  field labels ("Cost Centre"/"Goes Into") and the new post-create
  navigation straight to Asset 360.

No change to Dashboard, Asset Register (beyond what AM-03 already did),
Masters, Holders, Import, Reports, or My Assets.

## 26. Exact Files Changed

**Backend — new (3):** `backend/app/alembic/versions/a409768dc2cf_asset_field_change_audit.py`,
`backend/app/assets/audit_service.py`,
`backend/tests/assets/test_am04_udf_required_and_field_audit.py`.

**Backend — modified (5):** `backend/app/assets/custom_field_values.py`,
`backend/app/assets/models.py`, `backend/app/assets/router.py`,
`backend/app/assets/schemas.py`, `backend/app/assets/service.py`.

**Frontend — new (1):** `frontend/src/components/shared/FormField.test.tsx`.

**Frontend — rewritten (4, counted as modified):**
`frontend/src/features/assets/AddAssetForm.tsx` + `.test.tsx`,
`frontend/src/features/assets/AssetDetail.tsx` + `.test.tsx`.

**Frontend — modified (4):** `frontend/src/lib/api-client.ts`,
`frontend/src/components/ui/sidebar.tsx`, `frontend/e2e/asset-lifecycle.spec.ts`,
`frontend/src/router.test.tsx` (mock asset shape updated to match `AssetDetailOut`).

**Documentation — modified (5):** `docs/ai/CURRENT_STAGE.md`, `DECISIONS.md`,
`DESIGN_SYSTEM.md`, `REVIEW_FINDINGS.md`, `UAT_MATRIX.md`, plus this report
and the preflight correction to `AM-03_UI_FOUNDATION_REPORT.md` (§3/§4).

## 27. Tests Added/Changed

**Backend (`test_am04_udf_required_and_field_audit.py`, 15 tests):**
`TestRequiredUdfOnCreate` (3), `TestExistingAssetEditCompatibility` (2),
`TestFieldChangeAudit` (10: changed-field row, unchanged-field no-row,
multiple-fields-one-request-id, custom-field-per-key, vendor-name-snapshot,
failed-edit-leaves-no-rows, lifecycle-event-writes-only-to-asset_event,
viewer/holder-cannot-edit, cross-company-cannot-read, chronological-order).

**Frontend:**
- `FormField.test.tsx` (new, 3 tests): label association, required marker,
  helper-vs-error text.
- `AddAssetForm.test.tsx` (rewritten, 8 tests): procurement fields render
  and submit (incl. PI Number/vendor/invoice/warranty), dynamic UDFs render
  in `sort_order` with one control per type and submit correctly, required
  UDF blocks Save with an inline error, single-asset create navigates to
  Asset 360, server validation error displays, tax/total preview + bulk
  quantity behavior (pre-existing, re-verified), no-IT_STOCK-holder and
  multi-holder-blank-until-picked behavior (pre-existing, re-verified).
- `AssetDetail.test.tsx` (rewritten, 15 tests): loading skeleton, error+retry,
  404-not-found, procurement/PI-Number/custody displayed, custom fields
  displayed including a retired-definition value, lifecycle Timeline
  displayed, field-change audit displayed and distinct from History,
  Documents preserved, Edit role-gating, no immutable-field controls while
  editing, edit saves and refreshes displayed data, edit error displays,
  pre-existing lifecycle-action and QR/Print-Label tests (re-verified).
- `router.test.tsx`: mock `ASSET` object expanded to the full
  `AssetDetailOut` shape (needed once `AssetDetail` started reading fields
  the old mock didn't have); one assertion switched from `getByText` to
  `getByRole("heading", ...)` to disambiguate the asset code now appearing
  in both the page title and the Overview tab.

**Net: 184 → 199 backend (+15). 81 → 101 frontend (+20), 23 → 24 files.**

## 28. Backend Test Results

```
199 passed, 23 warnings in 14.62s
```

## 29. Frontend Test Results

```
npx vitest run  ->  101 passed (24 files)
```

## 30. Typecheck

```
npx tsc -b  ->  clean, no errors
```

## 31. E2E Result

```
1 passed (12.0s)  -- full custody journey: procure, allot, return, allot again
```

Two genuine failures were hit and fixed before this final green run (both
disclosed, neither swept under the rug):

1. The spec's field-label selectors (`"Cost Center"`, `"Initial Holder"`)
   didn't match the redesigned form's actual labels (`"Cost Centre"`,
   `"Goes Into"`) — updated the spec, and also fixed a genuine accessible-
   name inconsistency this caught: the "Goes Into" `SelectTrigger`'s
   `aria-label` had said `"Initial Holder"`, not matching its own visible
   `FormField` label.
2. A required Custom Field (`asset_tag_am04`) created during this stage's
   own manual browser UAT (§32) is global by design (confirmed in AM-02)
   and briefly blocked the E2E suite's unrelated fixture company from
   creating any asset at all, until deactivated again. Not a code defect —
   documented as a real operational characteristic in `DECISIONS.md`.

## 32. Browser UAT

Performed in the built-in browser against the real running app
(`docker compose up -d --build web`, then `http://localhost:3211`), using a
throwaway seeded account (`backend/scripts/seed_admin.py --company-code
AM04UAT`, the same safe pattern AM-01 E2E/AM-03 already established) plus
real master data created through the app's own Setup screens (a Cost
Centre, Category, Sub-Category, Vendor, one required text Custom Field, one
IT_STOCK Holder, and a Code Rule — all through the real UI, not seeded
directly into the database).

**Tooling note:** this session's synthetic mouse clicks (the `computer`
tool's `left_click`) stopped reliably reaching the page partway through
this stage's UAT — clicks reported success but produced no DOM/network
effect. Diagnosed as a click-dispatch issue specific to this browser
session (not a real click-target/z-index problem — `document.elementFromPoint`
confirmed the intended element was genuinely at the clicked coordinates
every time). Worked around by dispatching real `PointerEvent`/`MouseEvent`
sequences via `javascript_tool` for the remainder of this UAT pass — this
still exercises the actual application code paths (real event listeners,
real React state updates, real network requests), it only bypasses the
OS-level input-simulation layer. Every finding below was verified against
real DOM/network state, not assumed.

**What was verified, concretely:**

- **Add Asset**: the full sectioned form renders correctly (Organization →
  Asset Classification → Purchase/Procurement → Asset Details → Commercial
  → Initial Custody → Custom Fields), required markers and helper text
  render as designed, the required-Custom-Field inline error appears and
  clears correctly, Sub-Category options filter to the selected Category, a
  server validation error ("No active code rule configured…") displayed
  correctly instead of crashing.
- **Successful creation**: a real asset (`AM04UAT/1`) was created with every
  procurement field populated (Vendor, PO, Invoice, **PI Number**, Brand,
  Model, Serial Number, Warranty, Legacy Code, Purchase Cost/Tax with a
  correct 59000.00 total preview) and one Custom Field value — the browser
  navigated straight to its Asset 360 page immediately, exactly as designed.
- **Asset 360**: all 7 tabs verified with real data — Overview (identity
  fields), Procurement (all fields including PI Number, with the real
  Vendor **name**, not an ID), Custody (Holder name/type/location/cost
  centre, correct `StatusBadge`), Custom Fields (the entered value
  correctly labeled), History (unaffected, still the lifecycle Timeline),
  Changes (correctly empty before any edit), Documents (unaffected).
- **Edit mode**: clicked Edit, confirmed via direct DOM query that no
  `category`/`subcategory`/`cost-center`/`purchase-date`/`status` control
  exists anywhere in the edit panel, changed Brand from "Dell" to "HP",
  saved — the read view refreshed immediately showing "HP", and the
  Changes tab immediately showed a new row: `brand | Dell | HP | Seed Admin
  | <timestamp>` — the full field-change-audit path verified end-to-end
  through the real UI, not just via backend tests.
- **Cleanup**: the `AM04UAT` seed company and the UAT Custom Field were
  both deactivated afterward through the app's own normal "Remove" actions
  (confirmed via SQL: `is_active=false`, rows still present — soft-
  deactivate only, no hard delete, per `DEVELOPMENT_GUARDRAILS.md`).

## 33. Responsive Checks by Exact Viewport

All 6 viewports named in the authorization were literally set via the
browser's viewport-emulation control and screenshotted/measured — none
inferred:

| Viewport | Add Asset | Asset 360 |
|---|---|---|
| 1920×1080 | ✅ clean, form stays comfortably narrow (`max-w-3xl`), not stretched full-bleed | ✅ clean |
| 1440×900 | ✅ clean (this session's primary working size throughout) | ✅ clean |
| 1366×768 | ✅ clean | ✅ clean |
| 1024×768 | ✅ clean | ✅ clean, all 7 tabs fit on one line |
| 768×1024 | ✅ clean | **Found and fixed a real page-overflow bug** — see below |
| 375×812 | ✅ clean, single-column stacking, sidebar collapses to drawer | ✅ clean after the same fix; lifecycle buttons wrap to 2 rows, tabs get their own horizontal scroll |

**The 768px bug, concretely:** `document.body.scrollWidth` measured `960`
against an `innerWidth` of `768` on Asset 360 specifically (Add Asset,
Dashboard, and Asset Register were all already clean at 768px, confirmed
by the same measurement). Root-caused via DOM inspection (not guessed) to
`SidebarInset`'s (`components/ui/sidebar.tsx`, the shared `<main>` wrapper
every screen uses) missing `min-w-0`: a flex child's default min-width is
its own content's intrinsic width, so once Asset 360's header actions row
(status badge + QR image + 2 buttons) was wide enough, it silently forced
the entire page wider than the viewport at exactly 768px — the one width
where the sidebar is docked (not yet a mobile drawer, per the existing `md`
breakpoint) but the viewport is still narrow. Fixed by adding `min-w-0` to
`SidebarInset` (one shared file, benefits every screen); re-measured
`scrollWidth === innerWidth === 768` after the fix, and re-verified
Dashboard/Asset Register/Add Asset all still measured clean at the same
width (no regression). Asset 360's own 7-item `TabsList` was also given its
own `overflow-x-auto` wrapper alongside this fix, so the tab bar scrolls
within itself at narrow widths rather than depending on the page-level fix
alone.

## 34. Accessibility Checks

Checked via the browser's accessibility tree (`read_page`) on Asset 360:
every button has a real accessible name (`Print Label`, `Edit`, `Move /
Allot`, `Send for Repair`, `Dispose`, `Sell`, `Scrap`, `Report Lost`), the
7 tabs use real `tab`/`tablist`/`tabpanel` roles (not clickable `div`s),
and a `tabpanel` is present and correctly associated. `StatusBadge`
(unchanged from AM-03) always renders the status name as text, not color
alone. `ErrorState` (unchanged from AM-03) uses `role="alert"`. Edit mode's
Custom Field controls reuse `FormField` (verified by its own new dedicated
tests, §27) for label/required-marker/error-text association, and the
dropdown/checkbox controls are the same accessible shadcn/Radix primitives
already used everywhere else in the app (`Select`, `Checkbox`) — no new
custom interactive control was built. Not independently re-audited this
stage: a full keyboard-only click-through of every interactive element in
sequence, and color-contrast measurement of the `StatusBadge` tone tokens
(these predate AM-04, only their consumers are new in Asset 360).

## 35. UAT_MATRIX Changes

`docs/ai/UAT_MATRIX.md`: `/assets/new` and `/assets/$id` rows updated to ✅
Design and ✅ Responsive (both genuinely browser-verified this stage, per
§32/§33), Security left at 🟡 with an explicit note that verification was
backend-regression-only (role-gating is covered by tests, not a dedicated
browser-based authz walkthrough — no new authorization surface was
introduced beyond what the existing `require_role` checks already cover).
Every other route's row is unchanged. Backend/frontend test counts and the
E2E note updated to reflect this stage's real results.

## 36. REVIEW_FINDINGS Resolved

- No generic field-change audit for editable descriptive fields.
- `AssetDetail` used to `return null` while loading, with no error or
  not-found state.
- Add Asset only exposed the original 9-field subset.
- `CustomField.is_required` had no enforcement anywhere.
- No way to correct a mistyped procurement/descriptive field from the UI.
- Asset 360's page could overflow its viewport at 768px (found and fixed
  this stage, §33).
- Asset 360's 7-tab `TabsList` had no horizontal-scroll container of its own.

## 37. REVIEW_FINDINGS Still Open

`DataTable`/`PageHeader`/loading-empty-error/skeleton/heading-consistency
items are narrowed further (now 4 of ~11 screens covered: Dashboard, Asset
Register, Add Asset, Asset 360) but not claimed resolved beyond that —
Holders, Import preview, My Assets, and the 8 master screens are unchanged.
`AsyncButton` gained real consumers in Add Asset/Asset 360 but Imports/
Reports remain untouched. The hardcoded `text-blue-600` in `MyAssets.tsx`,
`MasterCrudScreen`'s Create+Deactivate-only pattern, `scoped_company_ids`/
`HolderCompanyAccess`, `get_active_rule`'s test coverage, the 5 remaining
closed-value columns with no DB CHECK, Import/export column extension, and
`category_id`/`subcategory_id`/`purchase_date`'s non-editability are all
unchanged/reconfirmed, not newly resolved.

## 38. DESIGN_SYSTEM Changes

Added: "Sectioned enterprise forms" (Add Asset's section-heading + grid +
`Separator` pattern, `FormField` usage rule), "Dynamic UDF (Custom Field)
controls" (the per-type rendering rule), "Asset 360 information hierarchy"
(header + 7-tab structure), "Edit mode" (role-gated, un-tabbed panel,
full-replace-PUT prefill rule). Updated: "Shared components" (now proven on
4 screens, not 2), "App shell" (documented `SidebarInset`'s new `min-w-0`
and why), "Known gaps" (narrowed to the same 4-of-11 screen count as
`REVIEW_FINDINGS.md`). No new color was introduced — `StatusBadge`'s
existing tone tokens are reused, not extended.

## 39. DECISIONS Changes

New "AM-04 scope locked" section recording: the required-UDF enforcement
rule (§14), the full-replace-PUT gotcha as a durable warning (§15), the
field-change-audit architecture and its deliberate separation from
`asset_event` (§19/§22), the edit-mode field-policy reconfirmation (§17/§18),
`category_id`/`subcategory_id`/`purchase_date`'s continued non-editability,
Add Asset's section structure (§10), Asset 360's information architecture
(§16), the retained-but-retired Custom Field display rule (§18), the
`AssetDetailOut` label-enrichment scope (single-asset GET/PUT only), the
"no backend change beyond what was authorized" confirmation, the new
`SidebarInset` `min-w-0` fix (§33) as a durable "don't remove this without
re-testing 768px" warning, and — flagged first, as item 0, since it's an
operational risk rather than a design choice — the fact that Custom Fields
are global across every company and `is_required` now has real,
system-wide effect (§32's second E2E failure is the concrete evidence).

## 40. CURRENT_STAGE Changes

Stage marked AM-04 complete/PASS. "What's actually done as of AM-04"
section added summarizing Add Asset, Asset 360, the required-UDF rule, the
field-change audit, and the label-enrichment `AssetDetailOut`. The "Locked
V1 business decisions" summary's Custom-Fields line updated from "not
wired into any screen yet" to reflect that it now is, with server-side
enforcement. Deferred-items list re-numbered and updated: `holder_company
_access`/import-export-columns/category-subcategory-purchase-date-edit
items reconfirmed as still deferred (now citing AM-04 §17/§31/§32 instead
of AM-02's), the two AM-03 "shared UI foundation only proven on 2 screens"
items updated to "4 screens" and renumbered. "Next" line updated to name
AM-05 and explicitly list what remains off-limits.

---

## 41. Deviations from Approved Scope

**Two, both disclosed:**

1. `components/ui/sidebar.tsx`'s `SidebarInset` gained `min-w-0` — not
   named in the AM-04 authorization's file list, but this is a one-line
   defensive CSS fix for a genuine responsive bug this stage's own
   mandatory 768px browser check surfaced (§33), directly required to
   satisfy the authorization's own explicit "no horizontal page overflow"
   requirement (§28). Fixing it at the shared-shell level (rather than
   working around it locally in `AssetDetail.tsx` alone) was a deliberate
   choice since the underlying flexbox behavior is a general footgun any
   future page-content addition could re-trigger; re-verified no regression
   on every other screen at the same width.
2. `frontend/src/router.test.tsx`'s mock `ASSET` object was expanded to the
   full `AssetDetailOut` shape — required because `AssetDetail` now reads
   fields the old mock didn't have; this is a test-fixture update, not a
   change to any production route-guard behavior the test itself verifies.

No other deviation. Masters/Holders/Import/Reports/My Assets, approval
workflow, AMC/insurance, depreciation, physical verification,
`holder_company_access` behavior, and any category/subcategory/purchase-date
correction workflow were all left exactly as scoped (untouched).

## 42. Issues Discovered But Not Changed

- **Custom Fields' global (not per-company) scope now has real teeth**
  (§32, §39 item 0) — not a defect, a genuine design characteristic worth
  remembering before anyone marks a field required in the live app. No
  per-company/per-category Custom Field scoping was in scope for AM-04 or
  any prior stage.
- **No generic field-change audit UI for bulk/at-a-glance review across
  assets** — the "Changes" tab is per-asset only, matching the scope
  ("not a full generic enterprise audit explorer"); a company-wide change
  log, if ever wanted, is a distinct future feature.
- **1920×1080 and 1366×768 keyboard/accessibility behavior wasn't
  separately re-audited** at those exact sizes (only visual/overflow
  checks were) — the accessibility tree check (§34) was performed once, at
  a single representative width, consistent with how AM-03 handled this.
- Every item already carried forward from AM-01/AM-02/AM-03's own "issues
  discovered but not changed" sections remains open and unrelated to this
  stage.

## 43. Remaining Risks

- **Operational**: an ADMIN in any company can silently affect every other
  company's Add Asset flow by marking a Custom Field required — no
  technical safeguard prevents this today (§39 item 0). Purely a process/
  training matter unless a future stage decides to scope Custom Fields.
- **No field-change-audit UI at scale**: if editing becomes frequent, the
  unpaginated "Changes" tab (§21) may eventually want pagination — not
  needed at current data volumes, flagged for future attention if usage
  grows.
- Every risk already carried forward from AM-01/AM-02/AM-03 (`holder
  _company_access`'s dormant-vs-needed status, `get_active_rule`'s test
  coverage gap, `department_id`'s nullable-with-no-type-conditional-
  constraint) remains open and unrelated to this stage.

## 44. Recommended AM-05 Scope

Given AM-04 completed the asset-entry/asset-360 pair, the natural next
stages (not a recommendation to start either — that decision is yours) are:
(a) migrating the remaining tabular/headed screens (My Assets, Holders, the
8 master screens, Import preview) onto the now-4-times-proven shared
foundation, comparatively low-risk repetition of an established pattern; or
(b) Import/Export column extension to finally surface the procurement/UDF/
field-change-audit data those paths still can't touch (`REVIEW_FINDINGS.md`
#12). A `category_id`/`subcategory_id`/`purchase_date` correction workflow
remains a real, evidenced gap but would need its own dedicated design pass
given the numbering/event-ordering invariants involved — not a small
addition to whatever stage picks it up.

---

## 45. Final Git State

- Branch: `worktree-ckam-build`
- Starting HEAD (pre-AM-04): `8c411eb`
- Preflight correction commit: `e1e5520` — `docs(ai): AM-04 preflight -- fix AM-03 report's Ending HEAD (was still b84c170, not the actual follow-up commit)`
- Backend implementation commit: `61aec38` — `feat(assets): AM-04 -- required-UDF enforcement + append-only field-change audit`
- Frontend implementation commit: `041c09b` — `feat(ui): AM-04 -- Add Asset + Asset 360 redesign, procurement/UDF wiring, edit mode`
- Governance/report commit: *(this report is committed together with the governance doc updates — see the immediate follow-up correction below, the same pattern used for AM-02/AM-03)*
- `git status` before the final commit: 5 governance docs modified, 1 new
  report file — otherwise clean.

## 46. Final Verdict

**PASS**

All completion-gate items satisfied: Git preflight verified before any
change; AM-03's actual final HEAD reconciled (a real copy-paste error, not
a false alarm); Add Asset and Asset 360 current-state audits completed
before any code was written; every procurement field including PI Number
wired into both screens; UDF UI wired with server-side required-field
enforcement and the existing-asset compatibility rule; Add Asset and Asset
360 both use the shared UI foundation; Asset 360 uses `PageHeader` and has
its `return null` loading bug fixed; Procurement/Custody/UDF/lifecycle
history/Documents all visible and correct in Asset 360; Edit mode works
end-to-end and cannot touch identity/lifecycle/category/subcategory/
purchase_date fields; the field-change audit is implemented, kept separate
from the lifecycle ledger, written transactionally, and read-scoped
identically to the asset; 199/199 backend, 101/101 frontend, clean
typecheck, 1/1 E2E, all green; browser UAT performed and found/fixed two
real bugs rather than rubber-stamping; responsive UAT performed at all 6
requested viewports, literally, not inferred; accessibility spot-checked;
UAT_MATRIX/REVIEW_FINDINGS/DESIGN_SYSTEM/DECISIONS/CURRENT_STAGE all
updated honestly, narrowing claims to exactly what was verified.
