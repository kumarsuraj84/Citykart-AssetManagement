# AM-17 — E2E, Responsive, Accessibility, Failure-Path & Performance Findings

Date: 2026-09-28
Scope: Parts A–F of the AM-17 closing pass — a new permanent Playwright E2E
spec for Purchase Orders (Part A), a Serial Number E2E-coverage decision
(Part B), a responsive/functional smoke across 6 viewports (Part C), an
accessibility smoke (Part D), failure/error-path checks (Part E), and
performance sanity observations (Part F). No backend source code was
touched. `docs/ai/AM-17_WORKFLOW_ACCEPTANCE_MATRIX.md` rows E2E01/RS01/
AC01/FP01/PF01 are updated to match this document; no other row in that
file was touched.

---

## Part A — New permanent Playwright E2E spec: PO delivery journey — PASS

**New file:** `frontend/e2e/purchase-order-delivery-journey.spec.ts`

Read first: `frontend/e2e/fixtures.ts` (seed/teardown pattern),
`frontend/e2e/asset-lifecycle.spec.ts` and
`frontend/e2e/add-asset-company-scoping.spec.ts` (Playwright conventions
used in this repo), and the actual current UI source —
`frontend/src/features/purchase-orders/NewPurchaseOrderForm.tsx`,
`PurchaseOrdersList.tsx`, `PurchaseOrderDetail.tsx` — rather than guessing
selectors.

The spec drives the full journey against a fresh isolated seed
(`newSeedRegistry`/`seedTestCompany`/`teardownTestCompany`, same pattern as
every other spec — no hard-coded business data, nothing reused across
runs):

1. Seeds an isolated company + ADMIN, using the seed's own Vendor, Cost
   Centre, IT_STOCK holder (`ctx.stock`) and EMPLOYEE holder (`ctx.employee`)
   as the two distinct Initial Holders for delivery.
2. Logs in as the seeded ADMIN through the UI.
3. Creates a Purchase Order (`PO No` + `Cost Centre` required, `Vendor` set
   too) via `/purchase-orders/new`.
4. Adds one line with Quantity = 3 (Description/Barcode/Category/
   Sub-Category/Cost/Tax %).
5. Confirms 3 individual PENDING units now exist for that line (3 row
   checkboxes, 3 `PENDING` badges).
6. Selects exactly 2 of the 3 pending units.
7. Clicks the real button text, `Mark 2 Delivery Done`.
8. Fills the shared Invoice fields (`Invoice No`/`Invoice Date`/
   `Invoice Amount`) once.
9. Fills a **distinct** Serial Number and a **distinct** Initial Holder
   (`ctx.stock` for unit A, `ctx.employee` for unit B) for each of the 2
   selected units — proving the two units are not accidentally swapped or
   merged.
10. Confirms the delivery.
11. Verifies exactly 2 units now show `DELIVERED` and the 3rd still shows
    `PENDING`.
12. Verifies 2 new Assets exist, via the Asset Register (`PurchaseOrderDetail`
    has no link to the delivered asset in the current UI, so the register's
    own Search — which matches `serial_number` server-side, see
    `backend/app/assets/search_service.py`) is used to find each unit by its
    own unique Serial Number.
13. Opens each new Asset's Asset 360 page.
14. Verifies on each: PO Number/PO Date (Procurement tab), Invoice Number/
    Invoice Date, Purchase Date == Invoice Date (both read the identical
    date string, asserted as `toHaveCount(2)` on that one string within the
    tab), Barcode (Overview tab — identical on both units, since Barcode is
    shared per line by design, see `test_barcode_is_shared_across_every_unit_a_quantity_line_creates`
    in `backend/tests/purchase_orders/test_service.py`), the unit's own
    Serial Number, its own Initial Holder (Custody tab), and a non-empty,
    server-generated Asset Code (`E2E/...` per the seed's code rule) —
    confirmed distinct between the two units.
15. Revisits the PO detail page and confirms the 3rd, undelivered unit is
    still `PENDING`.
16. (Part B, folded into the same spec — see below) attempts to deliver
    that 3rd unit reusing unit A's own real Serial Number; confirms the
    delivery is rejected with a visible, specific inline error inside the
    dialog, the dialog stays open, and the line remains `PENDING` after
    cancelling.
17. `test.afterEach` calls `teardownTestCompany`, deactivating everything
    the seed created (the 2 created assets are never removed — the ledger
    is append-only by design, same as every other existing spec already
    accepts).

All fixture values (PO number, line description, barcode, serial numbers,
invoice number) are timestamp-suffixed via the same `Date.now().toString(36)`
convention `fixtures.ts` already uses, so the spec is safe to re-run
repeatedly/concurrently.

**A real, pre-existing UI/testability defect was found and worked around
(not fixed) while writing this spec** — see "Notes on selectors" below.

### Run results

```
cd frontend
npx playwright test e2e/purchase-order-delivery-journey.spec.ts --reporter=line
# 1 passed (11.7s)

npx playwright test --reporter=line
# Running 6 tests using 1 worker
# [1/6] add-asset-company-scoping.spec.ts ... [6/6] purchase-order-delivery-journey.spec.ts
# 6 passed (42.9s)
```

Started at 5 permanent specs; now 6, all green, all in one worker
(`fullyParallel: false` per `playwright.config.ts`), none of the original 5
broken.

### Notes on selectors (testability finding, not fixed — out of scope)

`NewPurchaseOrderForm.tsx` and `PurchaseOrderDetail.tsx`'s "Add Line" form
build every **required** field's label through the shared `FormField`
component, which appends an `aria-hidden="true"` `*` marker *inside* the
`<label>` element (e.g. the DOM is `<label for="po-number">PO No<span
aria-hidden="true">*</span></label>`). Screen readers correctly compute the
accessible name as `"PO No"` (the accname algorithm excludes `aria-hidden`
content) — **this is not a real accessibility defect**, and is consistent
with Part D's own findings below.

However, unlike `AddAssetForm.tsx` (whose every input also sets an explicit
`aria-label="PO Number"` etc., overriding the association entirely),
`NewPurchaseOrderForm.tsx`'s and `PurchaseOrderDetail.tsx`'s own inputs
(`po-number`, `line-description`, `line-barcode`, `line-category`,
`line-subcategory`, `line-cost`, `line-quantity`) never set that override.
Playwright's `getByLabel(text, { exact: true })` matches on the `<label>`
element's raw `textContent` (`"PO No*"`), not the accname-stripped version,
so `page.getByLabel("PO No", { exact: true })` never resolves and the
action call hangs until the test timeout (confirmed by two full 120s
timeouts before this was diagnosed — see the DOM dump captured at
`getElementById('po-number').closest('div').querySelector('label').textContent
=== "PO No*"`). The new spec works around this by driving those specific
fields with `page.locator("#po-number")` etc. instead of `getByLabel`,
documented inline in the spec (`selectRadixById` helper and its comment).
This is a pure Playwright-automation quirk with no real user impact, so it
was not "fixed" in the app.

---

## Part B — Serial Number permanent E2E coverage — decision: extend, don't duplicate

**Decision:** did **not** add a separate Serial Number spec. Backend
coverage of Serial Number uniqueness is already thorough at the unit/
integration level, confirmed by:

- `backend/app/assets/service.py::check_serial_number_unique` — the single
  shared uniqueness check used by **every** creation/edit path (Add Asset,
  PO delivery via `procure_assets`, ordinary Edit), backed by a DB-level
  partial unique index (`ux_asset_serial_number_ci`, migration
  `278437eb710e`) as a race-safe backstop — confirmed present on a genuinely
  fresh DB in `docs/ai/AM-17_DB_VERIFICATION_FINDINGS.md` Task 1.
- `backend/tests/purchase_orders/test_delivery.py::test_deliver_pending_assets_creates_real_assets_with_distinct_serials`
  and `backend/tests/purchase_orders/test_service.py` (barcode-sharing vs.
  serial-per-unit tests) — PO-delivery-specific coverage.
- `backend/tests/imports/test_am06_import_full_field_support.py::test_duplicate_serial_number_is_rejected_on_the_second_row`
  — Import-path coverage.
- `backend/tests/assets/test_search.py::test_search_by_serial_and_scoped_bulk_move`
  — Register-search coverage.
- `docs/ai/AM-17_WORKFLOW_ACCEPTANCE_MATRIX.md` rows SN01–SN05 (all PASS,
  filled in by the earlier direct-API AM-17 pass): exact-duplicate,
  case-insensitive-duplicate, `N/A`-exemption, and the DB index itself all
  independently confirmed across every creation path including PO delivery
  (SN02).

Given that depth of backend coverage, a second, separate E2E spec would be
redundant test-count inflation. Instead, the new PO-delivery spec (Part A)
was extended with **one thin, full-stack proof** (step 16 above): deliver
the 3rd, still-PENDING unit reusing a real, already-used Serial Number
(not the exempt `"N/A"` placeholder) through the actual UI, and assert the
request is rejected with a visible error and no silent success. This is
exactly the "UI → API → DB" seam the backend suite cannot exercise on its
own, and it costs zero new fixture/teardown machinery since it reuses the
spec already in flight.

Live evidence of the underlying rejection: delivering a duplicate serial
via `POST /api/purchase-orders/{id}/deliver` surfaces
`app.assets.service.check_serial_number_unique`'s message —
`serial number "<value>" is already used by asset <code>` — as a 422,
rendered by `PurchaseOrderDetail.tsx`'s `deliverMutation.isError` block
(`role="alert"`, message text). The new spec asserts that alert becomes
visible and that the dialog/line state is unchanged afterward.

---

## Part C — Responsive/functional smoke — PASS (no functional defects)

Method: `mcp__Claude_Browser__preview_start` at `http://localhost:3211`,
logged in as a throwaway seeded ADMIN (`SMOKE01`/id 236, seeded with a
cost centre, category, sub-category, vendor, an IT_STOCK holder, an
EMPLOYEE holder, 5 assets, and a PO with 4 lines via direct API calls —
same shape as the Playwright fixtures, deactivated afterward). At each of
the 6 required widths (1920×1080, 1440×900, 1366×768, 1024×768, 768×1024,
375×812, set via `resize_window`) the following 10 screens were checked
via `javascript_tool` measurements (`document.documentElement.scrollWidth`
vs. `window.innerWidth`, and `getBoundingClientRect()` on dialogs/buttons)
— **not screenshots**, per the known Browser-pane screenshot-tool quirk
noted in `CLAUDE.md`:

Dashboard, Asset Register, Add Asset, an Asset 360 detail page, Purchase
Orders list, a PO detail page, the Delivery Done dialog, Import, Reports,
Holders.

**Result: zero page-level horizontal overflow** (`scrollWidth <=
innerWidth`, within a 1px rounding tolerance) at all 60 viewport×screen
combinations. Specifics:

- Asset Register's table: at 768px and 375px its own wrapper scrolls
  independently (`tableWrapScrolls: true`) while the page itself never
  widens — correctly contained.
- Delivery Done dialog: fits fully inside the viewport (`right <=
  innerWidth`, `bottom <= innerHeight`) at every width from 1920px down to
  1024px; at 768px and 375px it scales to `width: 100%` and its own inner
  list becomes the scroll container, with the `Confirm` button always
  reachable (`confirmButtonVisible: true`, spot-checked at 1920/1440/1366/
  1024/375). One negligible finding: at exactly 375px the dialog's own
  `getBoundingClientRect().right` measured `375.2` vs. an `innerWidth` of
  `375` — a 0.2px sub-pixel rounding artifact, not a real overflow (no
  scrollbar, no clipped content) — **not logged as a defect**.
- Primary action buttons (`Save`, `Create Purchase Order`, `Add Line`,
  `Mark N Delivery Done`, `Confirm`) all measured within the viewport at
  every width tested.

No functional defects found; this was explicitly not a redesign pass
(AM-13–AM-16 already covered visual design exhaustively) and none of the
above findings are style suggestions.

---

## Part D — Accessibility smoke — PASS

All checks done live in the browser (not just source-reading), via
`javascript_tool` + `computer` key actions:

1. **Keyboard-only login**: `Tab` → focuses `User ID` (visible focus ring —
   `box-shadow: ... 0px 0px 0px 3px` from Tailwind's `focus-visible:ring`
   utility) → type emp_code → `Tab` → focuses `Password` (`type=password`)
   → type password → `Enter` submits → lands on `/dashboard`. No mouse used
   at any step.
2. **Focus indicators**: confirmed present (a visible ring, not `outline:
   none` with nothing else) on the login form's first field; StatusBadge/
   LineStatusBadge/Button components use shadcn's standard
   `focus-visible:ring` utility throughout the codebase (source-verified),
   so this is not a one-off.
3. **Form labels**: every form field checked (login, Add Line, Delivery
   Done invoice/serial/holder fields, cost-centre Add dialog) uses a real
   `<label for=...>` (via the shared `FormField`/`Label` components), never
   placeholder-only text. (See Part A's note: the required-field asterisk
   is correctly `aria-hidden`, so labels read cleanly to a screen reader
   even though it tripped up Playwright's own `getByLabel`.)
4. **Dialog keyboard operability** (Delivery Done dialog, live-tested):
   opening it via `Enter`/click moves focus inside automatically; pressing
   `Tab` 20 times in a row keeps focus inside the dialog the entire time
   (`dlg.contains(document.activeElement) === true` after 20 tabs — Radix's
   focus trap is working); `Escape` closes the dialog
   (`document.querySelector('[role="dialog"]') === null` immediately
   after). Cancel/Confirm are both part of the normal tab order.
5. **Table row actions have accessible names, not just an icon**: every
   icon-only action button across `HoldersScreen.tsx`, `CustomFieldsScreen.tsx`,
   and the generic `MasterCrudScreen.tsx` (used by Companies/Locations/
   Departments/Cost Centres/Categories/Sub-Categories/Vendors) sets an
   explicit `aria-label` naming the row, e.g. `aria-label={`Edit
   ${h.name}`}`, `` `Deactivate ${h.name}` ``, `` `Reset password for
   ${h.name}` `` — source-verified across all three files, plus a `sr-only`
   "Actions" column header for the table itself.
6. **No color-alone status signal**: `StatusBadge`/`LineStatusBadge`
   (`frontend/src/components/shared/StatusBadge.tsx`,
   `PurchaseOrderDetail.tsx`) always render the status as visible text next
   to the color dot/pill — confirmed by source
   ("the status name itself is always shown as text, never color alone").

No accessibility defects found. This was explicitly a smoke pass, not a
redesign or full WCAG audit.

---

## Part E — Failure/error paths — PARTIAL (1 defect found: DEF-04)

| Check | Result | Evidence |
|---|---|---|
| 401 (expired/invalid token) → redirect to login | PASS | `frontend/e2e/asset-lifecycle.spec.ts` (part of the green 6-spec suite) exercises this exact scenario twice: a broken access token with a valid refresh cookie present triggers a transparent silent refresh-and-retry (no visible error, `sessionStorage`'s token value changes); a broken access token with cookies cleared redirects to `/login?next=<path>`. Live-verified independently: `fetch('/api/assets?limit=1', {Authorization:'Bearer totally.invalid.token'})` → clean `401 {"detail":"Invalid or expired token"}` JSON body, never a raw crash. |
| 403 → controlled message | PASS | Logged in as a real `HOLDER`-role account and navigated directly to `/setup/holders` (an ADMIN/IT_TEAM/VIEWER-only page per `STAFF_ROLES` in `backend/app/holders/router.py`). Confirmed via `read_network_requests`: `GET /api/holders → 403 Forbidden`. The page settles to `"Not permitted for this action"` with a `Try again` button (the shared `ErrorState` component) — no raw error, no data leak (table shows zero rows, not another company's/role's data). Note: the page's own `Add` button is still visible to the HOLDER role (frontend doesn't hide it), consistent with `CLAUDE.md`'s own stated design ("hiding a button... is UX, not security... every write path re-checks role... server-side") — not logged as a defect. |
| 404 (nonexistent asset id in URL) → controlled "not found" | PASS | `GET /assets/999999999` → `AssetDetail.tsx`'s 404 branch renders `"Asset not found." / "It may have been removed, or you may not have access to it."` — no crash, no blank page. |
| 422 (duplicate serial) → clear inline validation message | PASS | Covered live by the new spec (Part A/B): delivering a real duplicate Serial Number surfaces a specific `role="alert"` message inside the Delivery Done dialog; the dialog stays open and nothing is silently accepted. |
| **422 (duplicate master code) → clear inline validation message** | **FAIL — DEF-04** | See below. |
| API container stopped → "can't reach server" state, not infinite spinner/blank crash | PASS (with a timing note) | `docker compose stop api`, then navigated to `/dashboard`. `read_network_requests` confirmed nginx returned `502 Bad Gateway` immediately (fast, correct). The UI, however, stayed on its loading-skeleton shell for **~15–17 seconds** (TanStack Query's default retry/backoff exhausting its 3 attempts) before settling on `"Couldn't load the dashboard."` with a `Try again` button — never went blank, never hung indefinitely, and clicking `Try again` after `docker compose start api` recovered the page correctly (`ALLOTTED 49 / IN STOCK 229 / ...` real data rendered). The ~15–17s delay is not "infinite" so this passes the letter of the check, but is worth noting as a UX rough edge during a real outage — not logged as a defect (no code change made or suggested; this is TanStack Query's global default retry policy, an app-wide config decision, not a per-page bug). `docker compose start api` was run immediately after, and the container was confirmed healthy (`curl http://localhost:8000/api/auth/companies` → `200`) before continuing. |

### DEF-04 — Master-data Add/Edit dialogs (MasterCrudScreen) swallow API errors silently — no inline message, no stack trace, just nothing

**Where:** `frontend/src/components/master-crud/MasterCrudScreen.tsx`
(shared by `frontend/src/routes/setup/{companies,cost-centers,categories,
subcategories,vendors,departments,locations}.tsx` — 7 admin screens).

**Evidence:** `createMutation`/`updateMutation`/`deactivateMutation` are
defined (lines ~148–168) but their `.isError`/`.error` state is **never
read anywhere in the JSX** — no `role="alert"` paragraph, no toast, nothing
(compare with `AddAssetForm.tsx`, `PurchaseOrderDetail.tsx`, and
`NewPurchaseOrderForm.tsx`, which all render `{mutation.isError && <p
role="alert">{mutation.error.message}</p>}`). The `isError` variable used
in the JSX at line 240 is the **list query's** own `isError` (feeds
`ErrorState` for a failed `GET`), a different variable entirely.

Live-reproduced: logged in as ADMIN, opened Cost Centres → `Add Cost
Centre`, selected the seeded company, entered `Code = SMK01` (already in
use by another active cost centre in that company), `Name = Duplicate Code
Test`, clicked `Save`. `read_network_requests` confirmed `POST
/api/masters/cost-centers → 422 Unprocessable Content`. The dialog stayed
open (expected — no navigation happens on failure) but a DOM query for
`[role="alert"]` or any `destructive`-styled text inside the dialog
afterward found **nothing** (`alertPresent: false`, `destructiveEls: []`).
From the user's point of view, clicking `Save` on a duplicate code simply
does nothing visible — worse than a raw error, since there is no signal at
all that anything went wrong, let alone why.

**Severity: P2** (contained usability issue — every one of the 7 masters
screens' Add/Edit flow silently fails on any validation error, e.g.
duplicate code/name, but the workflow is not fully blocked: the admin can
still guess to change the value and retry, and no data is corrupted or
leaked). Not fixed, per this task's scope (pre-existing defect unrelated to
the new Part A/B spec, which uses different forms — `NewPurchaseOrderForm`/
`PurchaseOrderDetail` — that already handle their own mutation errors
correctly, which is exactly why the new spec's duplicate-serial assertion
works).

---

## Part F — Performance sanity (observations only, no thresholds)

All numbers below are from a **lightly-loaded local dev stack** — a few
hundred assets total across all companies (Dashboard showed `IN_STOCK 229`,
`ALLOTTED 49`, etc. at the time of measurement) — nowhere near the product
spec's 20,000-asset target, and running on the same machine as the
Playwright/vitest/build runs above. These are raw wall-clock observations
only; no SLA or pass/fail threshold is implied or invented.

| Screen / action | Measurement | Value |
|---|---|---|
| Dashboard load | `GET /api/reports/dashboard` resource timing (`performance.getEntriesByType('resource')`) | ~23 ms |
| Asset Register first page load | `GET /api/assets?limit=50&offset=0` resource timing | ~43 ms |
| PO detail page (4 lines) | `GET /api/purchase-orders/{id}` + `GET /api/purchase-orders/{id}/lines` resource timings | ~23 ms + ~26 ms |
| Import preview of 80 rows | `POST /api/imports/assets/preview` with an 80-row `.xlsx` (built via a one-off script using the real `TEMPLATE_COLUMNS` contract from `app.imports.asset_import_service`), measured with `curl -w '%{time_total}'` | ~340 ms (total client-measured round trip; server correctly parsed and row-validated all 80 rows, most flagged with an expected "unknown Initial Holder Code" validation error since the fixture used a placeholder code — irrelevant to the timing measurement itself) |

Client-side navigation (`domContentLoadedEventEnd`/`loadEventEnd`) for
in-app SPA route changes measured near-instantaneous (~10–15 ms) since
TanStack Router does not trigger a full document reload — the meaningful
number for each screen is its own API round trip, reported above.

---

## Environment notes

- `docker compose exec`/`docker cp` calls used `MSYS_NO_PATHCONV=1` where a
  Unix-style absolute path argument was involved, per `CLAUDE.md`.
- A throwaway smoke-test company (`SMOKE01`, company id 236) was seeded via
  direct API calls (mirroring `frontend/e2e/fixtures.ts`'s own pattern) for
  Parts C–F, and fully deactivated (holders, cost centre, category,
  sub-category, vendor, location, department, company, and the bootstrap
  `SEEDADMIN` holder itself) after use. Its 5+2 created assets were left in
  place — the asset ledger is append-only by design, same as every
  Playwright spec's own accepted leftover.
- While debugging the Part A selector issue, a few short-lived manual debug
  companies were also created directly via `scripts.seed_admin` outside the
  Playwright fixture flow, and were fully deactivated afterward — this
  surfaced (and self-resolved) an interesting operational fact about the
  shared dev database worth recording: `backend/app/auth/router.py`'s login
  endpoint deliberately matches `login_id` against **every active company**
  (not company-scoped), by design (see its own comment, "refusing to guess
  which one... would be a real account-takeover risk"). Since every seeded
  test company's bootstrap admin uses the literal, fixed `emp_code`
  `"SEEDADMIN"` (`frontend/e2e/fixtures.ts::newSeedRegistry`,
  `backend/scripts/seed_admin.py`), **any two simultaneously-active
  `SEEDADMIN` holders across different companies make every subsequent
  `SEEDADMIN` login attempt fail with a generic 401** (`len(matches) > 1`)
  — including a spec's own fresh seed and its own teardown. This is a
  correct, intentional security behavior on the backend's part, not a bug —
  but it means a Playwright run (or a manual `seed_admin.py` invocation)
  that crashes before its `teardownTestCompany`/cleanup step leaves an
  active `SEEDADMIN` behind that will silently break every later run's
  login until it is cleaned up. This was hit twice during this session
  (both self-inflicted by ad hoc debugging outside the Playwright fixture's
  own try/afterEach guarantees) and both times fully resolved by
  soft-deactivating the leftover company/holder rows directly. No code
  change is suggested — `teardownTestCompany`'s own `afterEach` already
  handles the normal case correctly, as proven by the clean 6/6 Playwright
  run with zero leftover active `SEEDADMIN` rows confirmed afterward.

---

## Final frontend regression (run after all of the above)

```
cd frontend
npx tsc -b                 # clean, no output, exit 0
npx vitest run              # Test Files  28 passed (28) | Tests  176 passed (176)
npx playwright test         # 6 passed (42.9s) — all 6 specs, including the new one
npm run build                # tsc -b && vite build — succeeded, dist/ generated
                              # (pre-existing >500kB single-chunk warning, unrelated to this task)
```

`api` container confirmed running and healthy at the end of this pass
(`docker compose ps api` → `Up`; `curl http://localhost:8000/api/auth/companies`
→ `200`).
