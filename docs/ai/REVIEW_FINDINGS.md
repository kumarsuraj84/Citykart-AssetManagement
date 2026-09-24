# CKAM — Open Review Findings

Findings not yet fixed, from the AM-00 audit and the earlier full-app UI/UX
audit. Remove an item when it's actually fixed (move the fact into a commit
message / `DECISIONS.md`, don't just leave it checked off here).

## Design / UX (open)

1. **No shared `DataTable` component.** Every table (Dashboard sub-tables,
   Asset Register, My Assets, Holders, Import preview, all 8 master screens)
   hand-rolls its own header/row/empty-row markup. `MasterCrudScreen` is the
   one exception. Target for AM-02.
2. **No shared `PageHeader` pattern.** No screen has a consistent
   title/description/search+filters/primary-action layout.
3. **Inconsistent loading/empty states.** Dashboard and Asset Register show
   explicit states; `AssetDetail` shows nothing (`return null`) while
   loading; the 8 master screens and Holders show no empty-table message.
4. **No skeleton loaders anywhere.**
5. **Heading-size drift.** Page `<h1>` uses `text-xl` on some screens,
   `text-lg` on others, with no documented rule; Asset Detail and My Assets
   have no page-level heading at all.
6. **Duplicated async-state plumbing.** Imports and Reports each hand-roll
   3+ parallel pending/error `useState` pairs for blob-download buttons
   instead of one shared pattern.
7. **One hardcoded non-token color**: `text-blue-600` in `MyAssets.tsx`'s
   asset-code link (every other equivalent link elsewhere is unstyled).
8. **`MasterCrudScreen` supports Create + Deactivate only, not Edit** —
   unlike Holders, which has its own bespoke Edit. If a future shared
   row-actions pattern makes "Edit" visually obvious to add here, that's new
   functionality, not a reskin — needs an explicit decision, not a silent add.

## Technical (open)

9. **`AssetRegister`'s row click does a full `window.location.href` reload**
   instead of client-side router navigation — works, but bypasses the SPA
   router every other screen uses. Fixing it is a real (if invisible)
   behavior change — call it out explicitly when touched, per
   `DEVELOPMENT_GUARDRAILS.md`.
10. **`scoped_company_ids` doesn't incorporate `HolderCompanyAccess` grants**
    yet — an IT_TEAM/VIEWER holder with assigned cross-company access is
    currently under-scoped (sees only their own company). Under-granting,
    not over-granting — safe direction to be wrong in, but a known gap if
    multi-company staff access is ever needed.
11. **`get_active_rule`'s per-metric/company-specific vs. global-fallback
    ordering** has no dedicated unit test beyond integration coverage.

## Resolved this session (kept here for traceability, remove once stale)

- Login company selector removed; identity resolution hardened (see
  `DECISIONS.md`).
- Change Password redesigned (was raw unstyled HTML).
- Sidebar shell replaces the flat top nav.
- Design tokens promoted to a navy identity; all shared form primitives
  bumped to the 44px target height.
- Logo file's baked-in near-white background plate removed (was invisible
  on white, visible as a halo on any tint).
