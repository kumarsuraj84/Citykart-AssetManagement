# CKAM — Open Review Findings

Findings not yet fixed, from the AM-00 audit and the earlier full-app UI/UX
audit. Remove an item when it's actually fixed (move the fact into a commit
message / `DECISIONS.md`, don't just leave it checked off here).

## Design / UX (open)

None outstanding as of AM-06 — every item previously listed here (shared-
component adoption on every screen, skeleton loaders, heading-size
consistency, `AsyncButton` everywhere, the hardcoded My Assets link color)
is resolved; see "Resolved this session" below for AM-05/AM-06's fixes.

## Technical (open)

1. **`scoped_company_ids` doesn't incorporate `HolderCompanyAccess` grants**
    yet — an IT_TEAM/VIEWER holder with assigned cross-company access is
    currently under-scoped (sees only their own company). Under-granting,
    not over-granting — safe direction to be wrong in. AM-01 documented this
    fully (`AM-01_DATA_INTEGRITY_REPORT.md` §9) without resolving it: it's
    genuinely either "needed for a shared multi-company asset team" or
    "dormant scaffolding," and that call needs a business answer, not a
    technical guess. Still open as of AM-09 (confirmed a non-release-blocker
    by the AM-09 RC audit, `RC_ISSUES.md`'s "Carried forward" section).
2. **5 closed-value columns still have no DB-level CHECK/ENUM** —
    `asset.status`, `asset_event.event_type`, `asset_event.status_after` are
    deliberately left unconstrained (they're the surface most likely to gain
    a new legal value if a future stage adds an approval workflow —
    reasoned, not oversight, per the AM-02 migration's docstring);
    `asset_document.doc_type` was simply out of AM-02's scope (only
    `holder.holder_type`/`holder.role`/`custom_field.field_type` were
    confirmed-gap items from AM-01). All plain VARCHAR at the DB level.
    AM-09's read-only DB integrity audit re-confirmed every current live
    value is within the recognized set (zero violations) — still open,
    still not release-blocking.
3. **No import-side duplicate detection** (legacy code, serial number, PO/
    invoice/PI number) — confirmed still absent in AM-06, AM-07, AM-08, and
    AM-09 (it was never present; a prior report's claim that "duplicate
    handling" was covered by the existing test suite did not match the
    actual code or tests, see `AM-06_IMPORT_REPORTS_MY_ASSETS_REPORT.md`
    §17). Not added without business evidence that any of these fields is
    meant to be unique — Asset Code remains the only system-enforced-unique
    identifier. Still open as of AM-09 (explicitly out of scope there too,
    per the AM-09 authorization's own instruction not to add it).
4. **No security response headers** (`X-Content-Type-Options`,
    `X-Frame-Options`/frame-ancestors, `Referrer-Policy`) on either `web`
    (nginx) or `api` (uvicorn) responses — found during AM-09's security-
    header review (`RC_ISSUES.md` AM09-05, P2). Not evidenced as
    exploitable in the current LAN-only, HTTP-only deployment model; a
    broader header-policy change was deliberately not made automatically
    under AM-09's narrow-fix-only policy.
5. **No `Cache-Control` guidance on authenticated API JSON responses**
    (`RC_ISSUES.md` AM09-06, P3) — low practical risk for a direct
    browser-to-server LAN deployment with no shared forward proxy in the
    documented architecture.
6. **No active alerting for a failed nightly backup** beyond the
    `/var/log/ckam-backup.log` file inside the `backup` container
    (`RC_ISSUES.md` AM09-09, P2) — an operator must check manually;
    documented in `CKAM_RELEASE_RUNBOOK.md` rather than built out, per the
    AM-09 authorization's own instruction not to construct alerting
    infrastructure in that stage.

## Resolved this session (kept here for traceability, remove once stale)

- **Excel formula injection across all three exports (Asset Register,
  Movement Log, Field Change Audit)** — fixed (AM-09): every user-
  controlled free-text data cell is now sanitized (a leading-apostrophe
  prefix for any value starting with `=`,`+`,`-`,`@`) before being written
  by openpyxl; header rows (fixed literals) are untouched. Found via the
  AM-09 authorization's own explicit instruction to check for this. See
  `AM-09_RC_FULL_AUDIT_REPORT.md` §28, `RC_ISSUES.md` AM09-01.
- **A naive (timezone-less) `event_date` on a lifecycle event crashed with
  an unhandled `TypeError`/500** — fixed (AM-09): normalized to UTC before
  the future/ordering comparisons in `apply_event`. `RC_ISSUES.md`
  AM09-02.
- **A duplicate `code` on any master's create/update crashed with an
  unhandled 500** instead of a controlled 422 — fixed (AM-09): the generic
  `build_master_router`'s create/update endpoints now catch
  `IntegrityError` and roll back to a clean 422. `RC_ISSUES.md` AM09-03.
- **A duplicate `emp_code` within a company on Holder create/update
  crashed with an unhandled 500** — fixed (AM-09): the identical pattern
  applied to the Holders router. `RC_ISSUES.md` AM09-04.
- **Numbering concurrency safety was previously asserted, never proven
  under genuine parallel load** — closed (AM-09, no code change needed): a
  real 20-way concurrent `POST /api/assets` reproduction against the live
  database confirmed the existing atomic UPSERT counter allocation is
  already race-safe. Now a permanent regression test,
  `tests/numbering/test_am09_numbering_concurrency.py`.
- **Backup/restore capability was previously documented but never
  actually exercised end-to-end in a session** — closed (AM-09): a real
  backup was executed and a real restore into a disposable database
  (`ckam_restore_test`) was verified to match the pre-backup baseline
  exactly (row counts, Alembic revision, triggers, indexes), without
  touching the live `ckam` database. See `AM-09_RC_FULL_AUDIT_REPORT.md`
  §36-38.

- **Add Asset's Cost Centre selector was not company-scoped** — fixed
  (AM-08): confirmed against the actual schema that only Cost Centre is
  genuinely company-owned (`cost_center.company_id`) — Category and Vendor
  have no `company_id` column at all and were correctly left unfiltered,
  not "fixed" against a fabricated assumption. The master list endpoint
  gained an optional, opt-in `company_id` query filter; Add Asset now
  passes its own company id. No Company selector exists inside Add Asset
  to clear dependent fields on (company is fixed from login), so that part
  of the original framing didn't apply. See `DECISIONS.md`.
- **Add Holder sent `location_id=0` instead of omitting a blank Location,
  causing an unhandled 500** — fixed (AM-08): `Holder.location_id` was
  confirmed to be a required (NOT NULL) foreign key, never actually
  optional as the form implied — the frontend now correctly requires it
  (Save disabled until set, matching every other required field's
  pattern), and the backend independently validates
  company/location/department existence before insert, returning a
  controlled 422 instead of a raw database error for any malformed
  request, not only the one the frontend used to produce. See
  `DECISIONS.md`.
- **Edit Subcategory dialog showed the parent Category as a raw numeric
  id** — fixed (AM-08): `MasterCrudScreen`'s read-only Edit-dialog fields
  gained an optional `format` callback (mirroring the existing list-column
  `format`), applied to both Subcategory's parent Category and Cost
  Centre's parent Company (the same defect, same root cause, found on a
  second master during the fix). Presentation only — the immutable
  relationship itself is unchanged.
- **AM-08 route-security sweep found no over-permission.** Two results
  that looked surprising on first read — a HOLDER-role account getting
  `200` from both `GET /api/assets` and `GET /api/reports/export/assets`
  — were verified against the actual source (`app/assets/router.py::
  list_assets`, `app/reports/router.py::export_assets`) to be deliberately,
  correctly scoped: a HOLDER's `holder_id` is pinned server-side to their
  own id regardless of any value they pass, so both endpoints only ever
  return the assets they currently hold — this is the same mechanism "My
  Assets" itself relies on, not a gap. No authorization change was made.
- **`category_id`/`subcategory_id`/`purchase_date` had no edit path** — fixed
  (AM-07): a dedicated, role-gated (ADMIN/IT_TEAM) correction workflow (`POST
  /api/assets/{id}/corrections`, Asset 360's "Correct Classification"
  action), deliberately separate from ordinary Edit mode, with a mandatory
  reason, category/subcategory relationship enforcement, a chronology
  invariant for Purchase Date, and human-readable audit entries via
  `asset_field_change`. Asset Code, lifecycle status, current Holder,
  company, and cost centre are all confirmed unchanged by a correction — see
  `DECISIONS.md` for the full rule set.
- Login company selector removed; identity resolution hardened (see
  `DECISIONS.md`).
- Change Password redesigned (was raw unstyled HTML).
- Sidebar shell replaces the flat top nav.
- Design tokens promoted to a navy identity; all shared form primitives
  bumped to the 44px target height.
- Logo file's baked-in near-white background plate removed (was invisible
  on white, visible as a halo on any tint).
- Missing indexes on `asset.{status,current_holder_id,company_id,category_id}`
  and `asset_event.{asset_id+event_date, event_date}` — added (AM-01).
- Historical event display used to live-join the current Holder row for
  from/to names, so a rename retroactively changed how past events read —
  fixed via point-in-time name snapshots, in both the in-app timeline and
  the movement-log export (AM-01).
- Company/cost-centre cross-company mismatch — confirmed already prevented
  on both the Add Asset and Import paths; the Import path lacked test
  coverage for it, now added (AM-01).
- `holder.holder_type`, `holder.role`, `custom_field.field_type` had no
  validation at all — fixed at both the API (422 on unrecognized value) and
  database (CHECK constraint, migration `3a44505b6b10`) levels (AM-02).
- Procurement fields (vendor, PO, invoice, PI Number/date, brand, model,
  serial number, warranty, custom fields) existed in the database and on
  create but were never returned by `AssetOut` — fixed; also added the
  first general asset-edit endpoint (`PUT /api/assets/{id}`) (AM-02).
- `AssetRegister`'s row click did a full `window.location.href` reload
  instead of client-side router navigation — fixed via `useNavigate`
  (AM-03); confirmed via network log that clicking a row no longer requests
  `index.html`/JS bundle, and that clicking the row's checkbox still does
  not navigate.
- Shared `PageHeader`/`DataTable`/`StatusBadge`/`EmptyState`/`ErrorState`/
  `AsyncButton` built and proven on Dashboard + Asset Register (AM-03) —
  see items 1-6 above for what's still outstanding on the other screens.
- Dashboard could get stuck on "Loading…" forever if the fetch failed
  (`isLoading || !data` never distinguished "still loading" from "failed") —
  fixed with a real `isError`/`ErrorState`/retry path (AM-03).
- **No generic field-change audit for editable descriptive fields** — fixed
  (AM-04): a new append-only `asset_field_change` table (migration
  `a409768dc2cf`, same DB-trigger-enforced append-only pattern as
  `asset_event`) records one row per genuinely-changed field on every
  `PUT /api/assets/{id}`, in the same transaction as the edit, readable via
  `GET /api/assets/{id}/changes` and shown in Asset 360's own "Changes" tab,
  kept visually distinct from lifecycle History.
- **`AssetDetail` used to `return null` while loading, with no error or
  not-found state at all** — fixed (AM-04): a real skeleton while loading, a
  distinct not-found treatment for a 404, and `ErrorState`+retry for any
  other failure.
- **Add Asset only exposed the original 9-field subset even though the API
  has supported full procurement/UDF data since AM-02** — fixed (AM-04):
  redesigned onto the shared UI foundation with all procurement fields
  (including PI Number), asset details, commercial fields, and dynamically-
  rendered active Custom Fields, sectioned and grouped rather than one flat
  form.
- **`CustomField.is_required` had no enforcement anywhere** — fixed (AM-04):
  enforced server-side on create (always) and on edit only when the edit
  itself replaces `custom_fields` (so an old asset predating a newly-required
  field is never blocked from an unrelated edit) — see `DECISIONS.md`.
- **No way to correct a mistyped procurement/descriptive field from the UI**
  (the AM-02 `PUT` endpoint existed but had no frontend consumer) — fixed
  (AM-04): Asset 360's role-gated (ADMIN/IT_TEAM) Edit mode, which can never
  touch identity or lifecycle fields (they're simply not in the edit form).
- **Asset 360's page could overflow its viewport at 768px** — found during
  AM-04's own mandatory browser UAT: the app shell's `SidebarInset` had no
  `min-w-0`, so a page with wide-enough content (Asset 360's header actions
  row) silently forced the whole page wider than 768px instead of wrapping.
  Fixed in the shared `components/ui/sidebar.tsx`, verified not to regress
  Dashboard/Asset Register/Add Asset at the same width — see `DECISIONS.md`.
- **Asset 360's 7-tab `TabsList` had no horizontal-scroll container of its
  own** — narrower than a page-overflow bug on its own, but fixed alongside
  the item above so the tab bar scrolls within itself at narrow widths
  instead of relying on the page-level fix alone.
- **`MasterCrudScreen` supported Create + Deactivate only, not Edit** —
  fixed (AM-05): migrated onto the shared foundation with a real Edit
  dialog per master, driven by a new `editFields` config array that's a
  strict subset of `formFields`; an immutable field is shown read-only
  rather than silently omitted, so the reason it can't be changed is
  visible. Deactivate now asks for confirmation naming the record.
- **`get_active_rule`'s company-specific-vs-global-fallback ordering had no
  dedicated unit test** — fixed (AM-05): 5 new tests in
  `tests/numbering/test_get_active_rule_ordering.py` cover company-beats-
  global, global-fallback, cross-company isolation, inactive-rule
  exclusion, and the no-rule-configured error.
- **A required Custom Field created for one company could block asset
  creation in every company** (discovered during AM-04, the risk AM-05 was
  explicitly authorized to close) — fixed: `CustomField.company_id`
  (migration `370399c6380e`, nullable, `NULL` = Global) makes a field either
  Global or scoped to one company; the applicable-definition set for an
  asset is Global + its own company only (`applicable_custom_fields`),
  never another company's fields. Covered by 15 backend authorization/
  immutability tests, 9 backend applicability-regression tests, 1 frontend
  regression test, and a dedicated E2E journey.
- **Holders had no Deactivate action at all** — fixed (AM-05): added,
  migrated onto the shared foundation, with a confirmation naming the
  holder. Role changes now show the current role and a visible warning
  before saving a change (never a silent reset), and IT_TEAM is confirmed
  (by 3 new backend tests) unable to update, deactivate, or reset the
  password of any holder — role remains ADMIN-only end to end.
- **Import template and export column list had no procurement/custom-field
  columns** — fixed (AM-06): Import now supports every procurement field,
  Quantity (multi-create per row), and company-scoped Custom Fields
  (`Custom:<field_key>` columns, reusing AM-05's applicability rule
  directly); the asset register export gained the same field set plus
  Custom Field columns with human-readable labels; a new, separate field-
  change-audit export was added. See `DECISIONS.md` for the exact column
  contract.
- **`DataTable`/`PageHeader`/loading-empty-error/skeletons were missing on
  My Assets and Import** (the last two screens outside the shared
  foundation) — fixed (AM-06): both migrated onto the shared components,
  and Reports (which had `Card`-based ad hoc markup, no `PageHeader`) moved
  onto `PageHeader` too. `AsyncButton` now covers every Import/Reports
  download button, closing the "duplicated async-state plumbing" finding.
- **`MyAssets.tsx`'s hardcoded `text-blue-600` asset-code link** — fixed
  (AM-06): replaced with the same unstyled SPA `<Link>` Asset Register's
  own Code column already uses.
- **My Assets had no loading, error, or empty state at all** — a failed
  fetch silently rendered an empty table indistinguishable from "you truly
  have zero assets" — fixed (AM-06): real skeleton, `ErrorState`+retry, and
  a distinct empty-state message, via the same `DataTable`/`EmptyState`
  pattern every other list screen now uses.
