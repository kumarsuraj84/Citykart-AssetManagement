# CKAM — Open Review Findings

Findings not yet fixed, from the AM-00 audit and the earlier full-app UI/UX
audit. Remove an item when it's actually fixed (move the fact into a commit
message / `DECISIONS.md`, don't just leave it checked off here).

## Design / UX (open)

1. **`DataTable` is now used on every tabular screen except My Assets and
   Import preview.** AM-03 migrated Dashboard's 3 sub-tables and Asset
   Register; AM-04 added Asset 360's Changes tab; AM-05 migrated all 8
   master screens (`MasterCrudScreen`), the new Custom Fields screen, and
   Holders. My Assets and Import preview still hand-roll their own
   header/row/empty-row markup — a future stage's work.
2. **`PageHeader` is now used on every screen except My Assets and Import.**
   AM-03 migrated Dashboard and Asset Register; AM-04 added Add Asset and
   Asset 360; AM-05 added all 8 master screens, Custom Fields, Holders, and
   Code Rule.
3. **Loading/empty/error states are now consistent everywhere except My
   Assets and Import.** AM-05 closed the gap this finding originally
   flagged for the 8 master screens, Holders, and Code Rule — all now have
   full loading/empty/error coverage via the shared components.
4. **No skeleton loaders on My Assets or Import.** Every other screen now
   has one (AM-05 added Code Rule's and confirmed `DataTable`'s built-in
   skeleton rows cover every master/Holders screen).
5. **Heading-size drift only remains on My Assets**, which still has no
   page-level heading at all — every other screen now renders its `<h1>`
   through the shared `PageHeader` (fixed at `text-lg`).
6. **Duplicated async-state plumbing in Imports/Reports.** `AsyncButton` is
   now used in Asset Register's bulk-move Confirm, Add Asset's Save, Asset
   360's action/edit Save buttons, and (AM-05) every master/Custom
   Field/Holder/Code Rule Save button, but Imports/Reports themselves
   weren't touched (out of scope through AM-05) and still hand-roll their
   own pending/error `useState` pairs for their blob-download buttons.
7. **One hardcoded non-token color**: `text-blue-600` in `MyAssets.tsx`'s
   asset-code link (every other equivalent link elsewhere is unstyled).

## Technical (open)

8. **`scoped_company_ids` doesn't incorporate `HolderCompanyAccess` grants**
    yet — an IT_TEAM/VIEWER holder with assigned cross-company access is
    currently under-scoped (sees only their own company). Under-granting,
    not over-granting — safe direction to be wrong in. AM-01 documented this
    fully (`AM-01_DATA_INTEGRITY_REPORT.md` §9) without resolving it: it's
    genuinely either "needed for a shared multi-company asset team" or
    "dormant scaffolding," and that call needs a business answer, not a
    technical guess. Still open as of AM-05 (explicitly out of scope there
    too, per its §26 — `holder_company_access` itself was untouched).
9. **5 closed-value columns still have no DB-level CHECK/ENUM** —
    `asset.status`, `asset_event.event_type`, `asset_event.status_after` are
    deliberately left unconstrained (they're the surface most likely to gain
    a new legal value if a future stage adds an approval workflow —
    reasoned, not oversight, per the AM-02 migration's docstring);
    `asset_document.doc_type` was simply out of AM-02's scope (only
    `holder.holder_type`/`holder.role`/`custom_field.field_type` were
    confirmed-gap items from AM-01). All plain VARCHAR at the DB level.
10. **Import template and export column list have no procurement/custom-field
    columns** — the API fully supports them (AM-02), but neither the import
    preview/commit path nor `assets_to_xlsx` includes vendor/PO/invoice/PI/
    brand/model/serial/warranty/custom-field columns. Deliberately deferred
    (AM-02 §13/§14), not a brittle stopgap.
11. **`category_id`, `subcategory_id`, `purchase_date` still have no edit
    path** after asset creation — reconfirmed as deliberately out of scope in
    AM-04 too (§17 of that authorization): a real, evidenced gap (what if a
    category was picked wrong at creation?), but safely exposing it needs a
    dedicated correction-workflow design, not a silent add to the generic
    edit form. A future stage's work.

## Resolved this session (kept here for traceability, remove once stale)

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
