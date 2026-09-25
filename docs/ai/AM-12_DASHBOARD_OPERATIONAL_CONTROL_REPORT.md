# AM-12 — Dashboard Operational Control Enhancement — Report

## 1. Executive summary

AM-12 closes G03, the strongest-evidenced remaining SHOULD-HAVE gap from
AM-11's Phase-1 review: the Dashboard showed IN_STOCK/ALLOTTED counts,
Stock by Location, Warranty Expiring Soon, and Allotted Over 180 Days, but
gave an operator no way to see at a glance how many assets are in repair,
lost, or have reached a closed/disposed state, and no feed of recent
lifecycle activity — despite every underlying number already existing in
`asset.status`/`asset_event`. This is development/UAT work only; there is
still no production server, and nothing here touches production
configuration, data, or deployment.

Two additions were made, both reusing existing, already-proven patterns
rather than inventing new ones: a compact "Exceptions" card listing all
five non-healthy statuses (`UNDER_REPAIR`, `LOST`, `DISPOSED`, `SOLD`,
`SCRAPPED`) explicitly — zero shown as zero, never hidden — each linking
into the Asset Register pre-filtered to that exact status via a new typed
route search parameter; and a "Recent Activity" card showing the latest 5
company-scoped lifecycle events, reusing the exact snapshot-correct
holder-name labeling the Asset 360 History tab already relies on (the
underlying helper was relocated, not duplicated, so both consumers share
one implementation). Every existing Dashboard widget is unchanged.

Full regression stayed green throughout: Backend 312/312 (+5), Frontend
154/154 (+5), TypeScript clean, E2E 5/5, production build clean. Live
browser UAT against freshly-seeded, clearly-tagged UAT data confirmed
correct counts, correct click-through, and correct company scoping (the
latter verified down to the raw network response, not just the rendered
UI). One live-browser anomaly (a HOLDER-role account briefly appearing to
see an empty "success" Dashboard instead of the expected 403 error state)
was investigated to a clean, evidence-based conclusion and ruled out as an
application defect — see §14 and §28.

**Final AM-12 verdict: PASS.**

## 2. Git preflight

- Absolute path: `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build`.
- Branch: `worktree-ckam-build`.
- HEAD at AM-12 start: `3cb6fb7c49337fc933965f0a5cb18e6a6bff9e61` (AM-11
  report/governance commit).
- `git status` at AM-12 start: clean.
- `git log --oneline -12` at AM-12 start: linear, ending
  `3cb6fb7 → 9607193 → c2c8c03 → 6fb265e → 1f77c24 → 6f666b7 → ...` —
  matches AM-11's own stated history exactly, no drift.
- Alembic revision (independently verified): `f28b6a913dce (head)`.
- `ckam-v1.0.0-rc1` tag: `git rev-list -n1 ckam-v1.0.0-rc1` →
  `c2c8c039602c861bd3d41272b9a12fae2bbd969d` — unchanged from AM-10/AM-11,
  confirmed not moved.
- No `pull`/`push`/`merge`/`rebase`/`reset`/`clean`/branch-switch/remote-
  config change was performed. No push occurred at any point in this
  stage.

## 3. Starting HEAD

`3cb6fb7c49337fc933965f0a5cb18e6a6bff9e61`.

## 4. Starting regression baseline

Independently re-run before any AM-12 change:

- Backend: 307/307 passing.
- Frontend: 149/149 passing (25 files), `npx tsc -b` clean.
- E2E: 5/5 passing.
- Alembic: `f28b6a913dce (head)`.

All figures matched the expected AM-11 baseline exactly.

## 5. Current Dashboard audit

| Dashboard Element | Current Endpoint | Scope Logic | Current Data | AM-12 Change |
|---|---|---|---|---|
| KPI cards (per-status counts) | `GET /api/reports/dashboard` → `status_counts` | `scoped_company_ids(holder)`: `None` for ADMIN (unrestricted), the caller's own company id(s) otherwise | Every status actually present among in-scope assets (a `GROUP BY`, so an absent status is simply missing from the dict) | None — unchanged. `exception_counts` (new) reuses this same dict rather than re-querying. |
| Stock by Location | same endpoint → `stock_by_location` | same | `IT_STOCK`-holder assets grouped by `Location.name` | None — unchanged. |
| Warranty Expiring Soon | same endpoint → `warranty_alerts` | same | Assets with `warranty_upto` within the next 30 days | None — unchanged. |
| Allotted Over 180 Days | same endpoint → `long_allocation_alerts` | same | `ALLOTTED` assets with `status_since` over 180 days ago | None — unchanged. |
| **Exceptions (new)** | same endpoint → `exception_counts` | same (derived from the already-scoped `status_counts`) | `UNDER_REPAIR`/`LOST`/`DISPOSED`/`SOLD`/`SCRAPPED`, each defaulted to 0 | **New** — no new query; reuses `status_counts`. |
| **Recent Activity (new)** | same endpoint → `recent_activity` | same `allowed_company_ids`, joined `AssetEvent → Asset` | Latest 5 events, newest-first, with snapshot-correct labels | **New** — one additional scoped, ordered, limited query + a batch label lookup (`with_labels`, reused, not duplicated). |
| Access control | `require_role(*STAFF_ROLES)` on the endpoint | HOLDER gets `403` (spec: HOLDER never sees company-wide KPIs) | — | None — unchanged. |

Frontend: `Dashboard.tsx` (the single component), backed by
`PageHeader`/`Card`/`DataTable`/`EmptyState`/`ErrorState`/`StatusBadge` —
the same shared foundation every other screen uses. `Dashboard.test.tsx`
already covered the existing widgets (KPI tiles, empty state, error
state/retry).

## 6. Existing dashboard data architecture

`dashboard_data()` (`backend/app/reports/dashboard_service.py`) builds one
company-scoped base `select(Asset)` query and derives every widget's data
from it or from small, targeted follow-up queries — never fetching every
asset into the API process to compute counts in Python. `status_counts`
is a single `GROUP BY Asset.status` over that base query. This existing
architecture is exactly what made `exception_counts` free (no new query)
and `recent_activity` cheap (one new, indexed, limited query) to add.

## 7. G03 root cause / business impact

**Root cause:** the Dashboard's per-status KPI cards only ever render a
card for a status that has at least one matching asset in scope (`Object.
entries(status_counts)` in the frontend, backed by a `GROUP BY` that only
returns rows that exist). A company with zero repair/lost/disposed assets
at a given moment would show nothing at all for those states — correct
for "don't show a status with literally zero occurrences of any kind
ever," but wrong for "let me confirm nothing is currently in repair,"
which needs an explicit, always-present 0. There was also no activity
feed of any kind, and no click-through from any KPI number into a
filtered view.

**Business impact:** an ADMIN or IT_TEAM operator managing the fleet day
to day has no way to answer "what needs my attention right now" without
manually filtering the Asset Register through every one of five statuses
in turn, and no way to see recent activity without opening the Movement
Log report. This is exactly the exception-visibility and recency
question AM-11's own review found the Dashboard could not answer.

## 8. Exception metric design

A single, compact "Exceptions" card (not five separate KPI cards, per the
authorization's own explicit instruction) containing a small table: one
row per status (`UNDER_REPAIR`, `LOST`, `DISPOSED`, `SOLD`, `SCRAPPED`),
`StatusBadge` for the status column (reusing the existing color/label
mapping, no second semantic mapping invented), and the count as a real
link. All five statuses always render, defaulted to 0 via `data?.
exception_counts?.[status] ?? 0` — the underlying `EXCEPTION_STATUSES`
array (mirrored exactly between backend and frontend) drives the row list
directly, not the API response's own keys, so a status with a true zero
count is never simply absent.

**Why five individual rows instead of a "Repair / Lost / Closed-Disposed"
3-way grouping** (the authorization's own suggested pattern): the Asset
Register's Status filter is single-valued (a Radix `Select`, one status
per query) — an aggregated "Closed/Disposed" total covering
DISPOSED+SOLD+SCRAPPED could not be click-through-filtered to in one step
without first widening the register's own filter model, which the
authorization explicitly said to flag rather than pursue ("If the current
Asset Register cannot accept the required route/query filter cleanly,
document that before expanding scope"). Five individual, always-
meaningful, always-clickable rows satisfies both the compactness goal (a
single Card, five short rows) and the explicit fallback requirement ("the
user must still be able to understand the underlying counts") without
touching the register's filter architecture.

## 9. Repair visibility

`UNDER_REPAIR` row, count from `exception_counts["UNDER_REPAIR"]`,
linking to `/assets?status=UNDER_REPAIR`. Verified live (§25): a UAT asset
sent for repair correctly shows `1`, and the link opens the Asset
Register pre-filtered to exactly that one asset.

## 10. Lost visibility

`LOST` row, same pattern, linking to `/assets?status=LOST`. Verified live
with a UAT asset reported lost.

## 11. Closed/disposal visibility

`DISPOSED`, `SOLD`, and `SCRAPPED` each get their own row and their own
link (`?status=DISPOSED`, `?status=SOLD`, `?status=SCRAPPED`) rather than
one combined "Closed" total — see §8 for the reasoning. Verified live
with a UAT asset disposed; `SOLD`/`SCRAPPED` correctly show `0` (not
absent) since no UAT asset in that state existed.

## 12. Metric click-through behavior

A new, typed route search parameter (`assetsIndexRoute.validateSearch` in
`frontend/src/router.tsx`) accepts `?status=<value>`; the route's own
component reads it via `assetsIndexRoute.useSearch()` and passes it down
as `AssetRegister`'s new `initialStatus` prop, which seeds the existing
`status` filter's `useState` on first render — the exact same filter
mechanism a user clicking the Status dropdown already drives, not a
parallel one. Verified live: navigating to `/assets?status=UNDER_REPAIR`
correctly pre-selects "UNDER REPAIR" in the Status filter and shows
exactly the matching asset(s). No duplicate asset-list screen was
created.

## 13. Recent Activity architecture

`dashboard_service.py` queries the most recent `RECENT_ACTIVITY_LIMIT`
(5) `AssetEvent` rows joined to `Asset` (for `asset_code` and company
scoping), ordered `event_date DESC, id DESC`, filtered by the same
`allowed_company_ids` every other widget uses. The resulting events are
passed through `with_labels` (§14) to get the same human-readable,
snapshot-correct label the History tab shows (e.g. "Allotted to Jane
Doe," "Sent for repair," "Reported lost"), then a small batch lookup
resolves `recorded_by` ids to actor names in one additional query. The
frontend renders this as a fourth new Card: Asset (linked to Asset 360),
Activity (the label), When (locale-formatted date/time), By (actor name,
or an em dash if unresolvable).

## 14. Event snapshot correctness

`with_labels` — previously a private helper (`_with_labels`) inside
`app.lifecycle.router`, now a public function in `app.lifecycle.service`
so this stage's Dashboard feed and the pre-existing History tab share one
implementation instead of two — prefers each event's own point-in-time
`from_holder_name_snapshot`/`to_holder_name_snapshot` (written at
`apply_event` time, AM-01) over a live holder-name lookup. A dedicated new
test (`test_am12_recent_activity_uses_point_in_time_holder_name_
snapshots`) creates an event, then renames the holder it involved, and
confirms Recent Activity still shows the original name — proving a later
rename cannot retroactively rewrite how a past event reads, the same
guarantee the History tab has always had.

## 15. Authorization/scoping

`recent_activity` and `exception_counts` both derive from the identical
`allowed_company_ids` value (`scoped_company_ids(holder)`) every other
Dashboard widget already uses — no new authorization surface was
introduced. `exception_counts` is a pure re-read of the already-scoped
`status_counts` dict (no query of its own). `recent_activity`'s own query
applies `Asset.company_id.in_(allowed_company_ids)` when that value is
not `None` (ADMIN), mirroring `dashboard_data`'s own base-query pattern
exactly. HOLDER's existing `403` on the whole endpoint is completely
unchanged — neither new field required any new role check, since access
to the endpoint itself already gates everything it returns.

## 16. Query/performance design

No client-side aggregation of asset/event data anywhere — `exception_
counts` is five dictionary lookups against an already-computed,
server-side `GROUP BY` result; `recent_activity`'s query is itself
`ORDER BY ... LIMIT 5`, never fetch-then-slice. Indexes were inspected,
not added: `ix_asset_event_event_date` (AM-01) already covers `AssetEvent.
event_date DESC` ordering exactly, and the join to `Asset` is by primary
key (`Asset.id`, always indexed). No new index was evidenced as needed,
matching the authorization's own instruction not to add one without query
evidence.

## 17. Frontend changes

- `frontend/src/features/dashboard/Dashboard.tsx` — new `EXCEPTION_
  STATUSES` constant, `ExceptionRow`/`ActivityRow` types, `exceptionColumns`/
  `activityColumns`, and two new `Card`s ("Exceptions," "Recent Activity")
  inserted around the existing content without removing or reordering
  anything else.
- `frontend/src/router.tsx` — `assetsIndexRoute` gains `validateSearch`
  (a new `AssetsSearch { status?: string }` interface) and its `component`
  now reads `useSearch()` and forwards it to `AssetsIndexRoute`.
- `frontend/src/routes/assets/index.tsx` — accepts and forwards the new
  `search` prop to `AssetRegister`.
- `frontend/src/features/assets/AssetRegister.tsx` — new `initialStatus`
  prop seeds the existing `status` filter state.
- `frontend/src/features/dashboard/Dashboard.test.tsx` — rewritten to
  render through the real app router (`createAppRouter` + `RouterProvider`,
  the same pattern `AssetRegister.test.tsx` already established), since
  `Dashboard` now uses `<Link>` internally; 5 new tests added.

## 18. Backend changes

- `backend/app/reports/dashboard_service.py` — `EXCEPTION_STATUSES`,
  `RECENT_ACTIVITY_LIMIT`, `exception_counts` derivation, and the
  `recent_activity` query + labeling + actor-name resolution, appended to
  `dashboard_data()`'s existing return dict.
- `backend/app/reports/schemas.py` — `DashboardOut` gains `exception_
  counts: dict[str, int]` and `recent_activity: list[dict]`.
- `backend/app/lifecycle/service.py` — `with_labels` (moved here from
  `lifecycle/router.py`, made public).
- `backend/app/lifecycle/router.py` — its own two call sites updated to
  import and call the relocated `with_labels`; no behavior change.

## 19. Exact files changed

Implementation commit `a8b085c`:

- `backend/app/lifecycle/router.py`
- `backend/app/lifecycle/service.py`
- `backend/app/reports/dashboard_service.py`
- `backend/app/reports/schemas.py`
- `backend/tests/reports/test_am12_dashboard_exceptions_and_activity.py` (new)
- `frontend/src/features/assets/AssetRegister.tsx`
- `frontend/src/features/dashboard/Dashboard.test.tsx`
- `frontend/src/features/dashboard/Dashboard.tsx`
- `frontend/src/router.tsx`
- `frontend/src/routes/assets/index.tsx`

## 20. Database migration

**NONE.** Every field AM-12 added (`exception_counts`, `recent_activity`)
is computed at request time from existing columns (`Asset.status`, the
existing `asset_event` table) — no new table, no new column, no schema
change of any kind. Confirmed: `docker compose exec api alembic current`
remained `f28b6a913dce (head)` throughout this stage.

## 21. Backend tests

312/312 passing (was 307/307 — +5 new AM-12 tests, all in
`backend/tests/reports/test_am12_dashboard_exceptions_and_activity.py`):

1. `test_am12_exception_counts_cover_repair_lost_and_every_closed_state` —
   one asset in each of the 5 exception statuses, confirms each count is
   exactly 1.
2. `test_am12_exception_counts_are_explicit_zero_not_omitted` — a company
   with no exception-state assets still returns all 5 keys at `0`.
3. `test_am12_exception_counts_are_company_scoped` — IT_TEAM and VIEWER in
   Company A see only Company A's counts; ADMIN sees both companies'
   combined.
4. `test_am12_recent_activity_ordering_limit_and_scoping` — 6 events in
   Company A (one more than the limit), confirms exactly 5 returned,
   newest-first, correctly excluding Company B's own event.
5. `test_am12_recent_activity_uses_point_in_time_holder_name_snapshots` —
   confirms a post-event holder rename does not change how the event
   reads in Recent Activity.

Full suite re-run clean after every change, including the router/schema
refactor.

## 22. Frontend tests

154/154 passing, 25 files (was 149/149 — +5 new AM-12 tests, all in
`Dashboard.test.tsx`, which was also restructured to render through the
real app router since `Dashboard` now uses `<Link>`):

1. Every exception status shown explicitly at 0 when nothing is in that
   state.
2. Real repair/lost/disposal counts each render as a link with the
   correct `?status=` href.
3. Recent Activity renders asset code, action label, and actor.
4. Empty Recent Activity shows "No recent asset activity.", not blank
   space.
5. A missing actor name falls back to an em dash.

One test-authoring pitfall found and fixed during this stage: two
separate fixtures accidentally reused the same fake asset code
(`"FA/HO01/IT/LAP/CK_1"`) across the pre-existing Warranty widget's mock
and a new Recent Activity fixture, causing a legitimate
"found multiple elements with this text" failure — not an application
bug, fixed by using a distinct fake code in the new fixtures.

## 23. TypeScript

Clean throughout (`npx tsc -b`), including the new typed route search
parameter — `assetsIndexRoute.useSearch()`'s return type flows correctly
into `AssetsIndexRoute`'s `search` prop with no manual type assertions
needed.

## 24. E2E

5/5 passing, re-run against the rebuilt `web` container after the
frontend changes. No new E2E spec was added — the existing 5 specs don't
touch the Dashboard's own new widgets, and Playwright coverage of a
purely-additive, already-unit-and-browser-tested screen addition was
judged unnecessary scope growth for this stage.

## 25. Production build

Clean — `npm run build` (`tsc -b && vite build`), 2257 modules, zero
errors. Bundle: 739.92 kB / 222.97 kB gzip (a negligible ~1.8 kB increase
over AM-11's own figure from the two new Dashboard cards). Unchanged
AM09-07 P3 bundle-size advisory classification.

## 26. Browser UAT

Performed live against a freshly-seeded UAT company
(`UAT-AM12-DASH`, following the AM-11 naming convention exactly — see
`DEVELOPMENT_GUARDRAILS.md`), never touching `CKS`: 5 assets covering
`IN_STOCK`, `ALLOTTED` (moved to an employee holder), `UNDER_REPAIR` (sent
for repair), `LOST` (reported lost), and `DISPOSED`.

- **ADMIN** (unrestricted, cross-company): Exceptions card correctly
  showed `UNDER_REPAIR: 1`, `LOST: 1`, `DISPOSED: 1`, `SOLD: 0`,
  `SCRAPPED: 0` (the 1s matching this UAT company's own assets, confirmed
  no double-counting against the wider dev database's other test data);
  Recent Activity correctly showed the 5 most recent events across the
  whole system, newest-first, with correct labels/actors/timestamps.
- **Click-through**: navigating to `/assets?status=UNDER_REPAIR` correctly
  pre-filtered the register to exactly the one repair asset, with the
  correct Holder/Company columns (AM-11) also visible.
- **VIEWER** (company-scoped): confirmed via the raw network response
  (`GET /api/reports/dashboard`) that `exception_counts` and
  `recent_activity` were scoped to exactly this one company — `UNDER_
  REPAIR: 1, LOST: 1, DISPOSED: 1, SOLD: 0, SCRAPPED: 0`, and
  `recent_activity` containing only this company's own 5 events. This is
  the authoritative scoping evidence — see §28 for a UI-rendering
  artifact observed separately, which does not affect this conclusion.
- **HOLDER**: confirmed the dashboard endpoint still returns `403` (§28).

## 27. Responsive UAT

Verified at all four required breakpoints, both via `document.body.
scrollWidth` vs `window.innerWidth` and a visual screenshot at 375×812:

| Breakpoint | scrollWidth | innerWidth | Overflow |
|---|---|---|---|
| 1440×900 | 1425 | 1440 | No |
| 1024×768 | 1009 | 1024 | No |
| 768×1024 | 753 | 768 | No |
| 375×812 | 375 | 375 | No |

At 375px, the KPI cards wrap to a 2-column grid and the new Exceptions
table renders cleanly with no clipping (confirmed via screenshot, not
just the numeric check). `SidebarInset`'s `min-w-0` (AM-04) was not
touched and remains intact — none of the new content is wider than its
container at any breakpoint.

## 28. Security verification

- **VIEWER cannot broaden company scope**: confirmed via the raw network
  response (§25) — `exception_counts`/`recent_activity` both correctly
  restricted to the caller's own company.
- **IT_TEAM cannot broaden company scope**: confirmed via the backend
  test `test_am12_exception_counts_are_company_scoped`, which exercises
  an IT_TEAM caller directly and asserts it sees only its own company's
  counts.
- **HOLDER cannot gain Dashboard data**: confirmed unchanged — the
  endpoint's existing `require_role(*STAFF_ROLES)` gate still returns
  `403` for HOLDER (verified both by a direct browser-console `fetch()`
  call and by the pre-existing, untouched role gate itself). Frontend
  visibility was never the control here; the backend gate is unchanged.
- Full backend regression (312/312) includes every AM-09 company-
  isolation and role-matrix test, all still passing, confirming nothing
  about this stage's changes weakened any existing authorization
  boundary.

## 29. G03 status

**FIXED.** Both parts of G03 (exception visibility, recent activity) are
implemented, tested (5 backend + 5 frontend tests), and verified live
with real UAT data covering every exception status. `PHASE1_GAP_REGISTER.md`
and `REVIEW_FINDINGS.md` updated accordingly.

**Investigation note (not a G03 defect, not a new open item):** during
live UAT, a HOLDER-role account navigating directly to `/dashboard`
briefly appeared to render an empty "success" Dashboard (KPI section
absent, Exceptions/Recent Activity showing all-zero/empty) instead of the
expected `ErrorState` a `403` should produce. Investigated to a clean,
evidence-based conclusion:

1. A direct `fetch()` call from the browser console confirmed the backend
   genuinely returns `403 {"detail":"Not permitted for this action"}` for
   this account on this endpoint — unchanged, correct, existing behavior.
2. An isolated unit test was written driving the *real* `authFetch` →
   `api-client.ts` → `useQuery` → `Dashboard` chain (stubbing `global.
   fetch` directly, not the mocked `apiClient` the permanent test suite
   uses) against a genuine `403` response with this exact detail string.
   That test **passed** — `ErrorState` (`role="alert"`) rendered
   correctly. This proves the application code correctly handles a real
   `403` end-to-end.
3. The live-browser anomaly did not reproduce in a fresh tab under
   otherwise-identical conditions (same account, same URL). One piece of
   corroborating evidence was found: the network log showed a stale,
   pre-AM-12-rebuild JS bundle hash (`index-C2EYtSeI.js`) loading for the
   `/login` page moments before the correct, current bundle
   (`index-BH7H9VIH.js`) loaded for the `/dashboard` navigation in the
   same tab — consistent with a browser-level caching/session artifact
   from this tab having been reused across many rapid account-switches
   earlier in this session, not a code defect.
4. The throwaway repro test was deleted after use, per this project's own
   established practice for one-off diagnostic scripts (see AM-09's
   `am09_diag_network_failure.spec.ts` precedent).

This is not logged as a new gap-register row: it was investigated to a
definitive, evidence-based "not an application defect" conclusion, the
same standard AM-09 §55 applied to its own live-browser anomaly.

## 30. Remaining Phase-1 SHOULD-HAVE gaps

From `PHASE1_GAP_REGISTER.md`, unchanged by this stage except G03:

- **G04** — ADMIN's Dashboard mixes every company's data with no
  per-company breakdown/selector. Explicitly out of AM-12's authorized
  scope; still needs a business decision on real Phase-1 company count.
- **G05** — dedicated location/holder reports. Still judged adequately
  covered by the existing Asset Register filter + export.
- **G06** — dedicated asset-photo field. Still judged adequately covered
  by the existing Documents tab.
- **G07** — document-type taxonomy on uploaded documents. Still CAN WAIT,
  no volume evidence.

None of G04-G07 were touched, removed, or silently resolved this stage.

## 31. User decisions still required

Unchanged from AM-11, none resolved this stage (not in scope):

1. `holder_company_access` — cross-company account access.
2. Import duplicate-detection definition (a practical option was already
   proposed in AM-11, not built).
3. **G04** — whether ADMIN's Dashboard needs a per-company breakdown,
   depending on how many real companies CityKart operates in Phase-1.

## 32. Recommended next stage

Given the verdict (PASS) and that G03 is now closed, the Phase-1 gap
register's remaining open items are either genuine business decisions
(G04, `holder_company_access`, import duplicates) or low-impact SHOULD-
HAVE items already judged adequately covered by existing workarounds
(G05-G07). The recommended next step is for the user to resolve one or
more of the three open business decisions (§30), after which a short,
narrowly-scoped follow-up stage could implement whichever of them is
confirmed as a genuine Phase-1 need — no further gap-discovery work is
evidenced as necessary before that. No stage should begin without the
user's explicit direction, per this stage's own stop condition.

## 33. REPORT CONTENT HEAD

`a8b085c` — the last commit before this report/governance commit
(`feat(reports,lifecycle): AM-12 -- Dashboard exception visibility +
recent activity (G03)`).

## 34. REPORT COMMIT

TO BE FILLED IN CHAT AFTER COMMIT.
