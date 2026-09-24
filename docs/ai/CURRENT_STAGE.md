# CKAM — Current Stage

**Stage:** AM-02 (asset data model + procurement + custom field foundation) — complete, PASS.
**Next:** awaiting explicit go-ahead on AM-03 or any other further work — do
not start anything automatically, including UI redesign.

Full AM-02 evidence: `docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md`.
Full AM-01 evidence: `docs/ai/AM-01_DATA_INTEGRITY_REPORT.md`.

## Locked V1 business decisions (from the AM-01 authorization — see `DECISIONS.md` for full detail)

No approval workflow in V1. Single current-holder/custody concept (no
custodian/user split). No AMC/insurance. No depreciation/accounting. No
physical verification (but QR/barcode stays forward-compatible). Lost/Damaged
tracks lifecycle state + reason + audit only, no recovery/write-off
accounting. Custom Fields are **required** long-term but not wired into any
screen yet — do not remove the master. Procurement traceability (including PI
Number) is a locked target requirement. Auto-generated Asset Code stays
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

## Deferred from AM-01/AM-02, awaiting your decision (not blockers, not failures)

1. **`holder_company_access`**: written to, never read by authorization.
   Classified as either "needed for multi-company asset-team access" or
   "dormant/obsolete" — genuinely depends on whether CityKart's asset team is
   organizationally shared across companies. No behavioral change made in
   AM-01 or AM-02.
2. **Import/Export column extension**: the import template and export column
   list still don't include any procurement or custom-field columns, even
   though the API now fully supports them. Deliberately deferred (AM-02
   §13/§14) — not a brittle dynamic-column hack, a real future stage's work.
3. **`category_id`/`subcategory_id`/`purchase_date` have no edit path** —
   deliberately excluded from `AssetUpdateIn` this stage (AM-02 §17):
   changing them safely needs more design than this stage's scope (code-
   generation tokens and event-ordering invariants both depend on them).
4. **No generic field-change audit** for the newly-editable descriptive
   fields — `updated_by`/`updated_at` only, no before/after value log (AM-02
   §28). Judged sufficient for this stage; flag if procurement-edit
   traceability becomes a real requirement.

None of AM-03 through AM-16 (shared DataTable/PageHeader/etc., Dashboard,
Asset Register, Asset Detail, Add Asset, Holders, Setup/masters, Import,
Reports, My Assets, responsive/accessibility passes, security regression,
full UAT) have been started as dedicated stages yet — see
`REVIEW_FINDINGS.md` for what's still open on each of those screens.

## Branch / remote state

Working on `worktree-ckam-build` (local worktree). This branch has **never
been pushed to `origin`** — only `claude/brave-euler-07879a` exists on the
remote (a small, unrelated test-DB-safety-guard commit). Pushing is a
decision for the user, not this session, to make explicitly.
