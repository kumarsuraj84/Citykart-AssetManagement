# CKAM — Open Review Findings

Findings not yet fixed, from the AM-00 audit and the earlier full-app UI/UX
audit. Remove an item when it's actually fixed (move the fact into a commit
message / `DECISIONS.md`, don't just leave it checked off here).

## Design / UX (open)

1. **`DataTable` exists now but is only used on 2 of ~11 tabular screens.**
   AM-03 built `components/shared/DataTable.tsx` and migrated Dashboard's 3
   sub-tables and Asset Register. My Assets, Holders, Import preview, and all
   8 master screens (`MasterCrudScreen`) still hand-roll their own
   header/row/empty-row markup. Target for AM-04+ (a dedicated Asset 360/
   Masters/Holders stage) — migrating them wasn't authorized in AM-03.
2. **`PageHeader` exists now but is only used on 2 screens.** AM-03 built
   `components/shared/PageHeader.tsx` and migrated Dashboard and Asset
   Register. Every other screen still has its own ad hoc title block. Target
   for AM-04+.
3. **Loading/empty/error states are still inconsistent outside Dashboard and
   Asset Register.** Both of those now have full loading/empty/error
   coverage via `DataTable`/`EmptyState`/`ErrorState` (AM-03) — `AssetDetail`
   still shows nothing (`return null`) while loading, and the 8 master
   screens and Holders still show no empty-table message or error state.
4. **No skeleton loaders outside Dashboard and Asset Register** — `DataTable`
   (AM-03) shows skeleton rows while loading on those two screens only.
5. **Heading-size drift outside Dashboard and Asset Register.** Both of
   those now render their `<h1>` through the shared `PageHeader` (AM-03,
   fixed at `text-lg`) — every other screen still sets its own heading
   markup/size with no shared rule; Asset Detail and My Assets still have no
   page-level heading at all.
6. **Duplicated async-state plumbing in Imports/Reports.** AM-03 built the
   shared `AsyncButton` primitive and used it in Asset Register's bulk-move
   Confirm button, but Imports/Reports themselves weren't touched (out of
   scope for AM-03) and still hand-roll their own pending/error `useState`
   pairs for their blob-download buttons.
7. **One hardcoded non-token color**: `text-blue-600` in `MyAssets.tsx`'s
   asset-code link (every other equivalent link elsewhere is unstyled).
8. **`MasterCrudScreen` supports Create + Deactivate only, not Edit** —
   unlike Holders, which has its own bespoke Edit. If a future shared
   row-actions pattern makes "Edit" visually obvious to add here, that's new
   functionality, not a reskin — needs an explicit decision, not a silent add.

## Technical (open)

9. **`scoped_company_ids` doesn't incorporate `HolderCompanyAccess` grants**
    yet — an IT_TEAM/VIEWER holder with assigned cross-company access is
    currently under-scoped (sees only their own company). Under-granting,
    not over-granting — safe direction to be wrong in. AM-01 documented this
    fully (`AM-01_DATA_INTEGRITY_REPORT.md` §9) without resolving it: it's
    genuinely either "needed for a shared multi-company asset team" or
    "dormant scaffolding," and that call needs a business answer, not a
    technical guess. Still open as of AM-03 — explicitly out of scope there too.
10. **`get_active_rule`'s per-metric/company-specific vs. global-fallback
    ordering** has no dedicated unit test beyond integration coverage.
11. **5 closed-value columns still have no DB-level CHECK/ENUM** —
    `asset.status`, `asset_event.event_type`, `asset_event.status_after` are
    deliberately left unconstrained (they're the surface most likely to gain
    a new legal value if a future stage adds an approval workflow —
    reasoned, not oversight, per the AM-02 migration's docstring);
    `asset_document.doc_type` was simply out of AM-02's scope (only
    `holder.holder_type`/`holder.role`/`custom_field.field_type` were
    confirmed-gap items from AM-01). All plain VARCHAR at the DB level.
12. **Import template and export column list have no procurement/custom-field
    columns** — the API fully supports them (AM-02), but neither the import
    preview/commit path nor `assets_to_xlsx` includes vendor/PO/invoice/PI/
    brand/model/serial/warranty/custom-field columns. Deliberately deferred
    (AM-02 §13/§14), not a brittle stopgap.
13. **`category_id`, `subcategory_id`, `purchase_date` have no edit path**
    after asset creation (AM-02 §17) — a real, evidenced gap (what if a
    category was picked wrong at creation?), deliberately left open since
    safely exposing it needs more design than AM-02's scope.
14. **No generic field-change audit for editable descriptive fields** —
    `PUT /api/assets/{id}` (AM-02) updates `updated_by`/`updated_at` only,
    no before/after value log the way `asset_event` provides for lifecycle
    changes. Flag if procurement-edit traceability becomes a real
    requirement.

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
