# CKAM Simplification — Stage S7 report (permanent Playwright E2E regression)

| | |
|---|---|
| Starting HEAD | `c656f33` (feat(web): S5b-2 People & Places forms …) |
| Stack | throw-away UAT stack of the current code, docker project `ckam-uat` (web `http://localhost:3311`, api `:8100`) |
| Command | from `frontend/`: `COMPOSE_PROJECT_NAME=ckam-uat E2E_BASE_URL=http://localhost:3311 npx playwright test --reporter=line` |
| Before | 9 specs: **8 failed, 1 passed** |
| After | 12 specs: **12 passed** (`12 passed (1.3m)`) |
| Product code | **not changed** — no real product defect was found (see §3); no container rebuilt; backend / vitest suites not affected |
| Commit | none (the controller commits) |

## 1. Per spec: what failed, why, what changed

| Spec | Failure at `c656f33` | Cause | Change |
|---|---|---|---|
| `add-asset-company-scoping` | teardown: `DELETE /asset-users/{stock}` → 422 "… still holds 1 asset" | **stale test** — S0 refuses to deactivate a holder of assets (intended) | shared teardown fixed (§2) |
| `asset-correction` | same teardown 422 | stale test | §2 |
| `asset-lifecycle` | same teardown 422 (the test Store holds the asset) | stale test | §2 |
| `multi-company-udf` | same teardown 422 | stale test | §2 |
| `import` | strict-mode: two "E2E Import Journey Laptop" cells; also teardown 422 | **stale test (race)** — the register applies the search 300 ms after typing; the assertion ran on the unfiltered list, which holds earlier runs' imported assets with the same description | now waits for "Showing 1–1 of 1 asset" (the narrowed result) before using the row; §2 |
| `bundle-journey` | strict-mode: the same Item twice in the part picker | **test artefact, not a product bug** — the previous part's picker list stays mounted for its ~150 ms closing animation; opening the next picker at once shows both lists. Proven: waiting for the list to close (`toHaveCount(0)`) passes every time, and in the failing snapshot the open list holds the Item exactly once | pick helper waits for the list to close |
| `bundle-journey` (2nd) | `group /Line \d+: .*Mouse/` matched two lines; `.*Keyboard` matched none | **stale test** — since S4/S2 a line is named after its **Item** ("Line 4: E2E Mouse Item …"); the test uses one no-serial Item for both Keyboard and Mouse | lines found by the part's description ("… - Mouse"), with `toHaveCount(1)` on each; the CPU / Mouse rows on the PO page likewise |
| `bundle-journey` (3rd) | parts summary text matched two rows | test isolation — a bundle left by an earlier failed run | assertion scoped to the new bundle's row; teardown now also deactivates sets built from the run's Items |
| `purchase-order-delivery-journey` | "2 assets created" not shown | **stale test data** — the Receive screen showed the server's refusal "The invoice date cannot be before the PO date (13-10-2026)." (S0.5 rule): the PO date defaults to today, the test's invoice date is 2026-01-15 | the PO is dated 2026-01-10 on the New PO form; every original assertion kept |
| `rbac-responsibility-journey` | `mastersAttempt.status` 201 ≠ 403 | **stale test** — since S3a-1 an ordinary ADMIN may add categories in its work area (and vendor / brand / cost centre / stock room / Item) | rewritten to the S3a-1 matrix (below); the UI part kept and extended |
| `inline-create` | passed | — | — |

**`rbac-responsibility-journey` — new assertions (all through the real API):**
* ordinary (both-area) ADMIN **may** (201): add vendor and brand (code made from the name), cost centre, an IT and a Non-IT Asset Group, a sub-category, an Item, a stock room with a new place;
* ordinary ADMIN is **refused** (403): edit / deactivate a vendor, deactivate a cost centre, create company, location, department, custom field, bundle (set), code rule, the import template, ERP Item mapping (`POST /api/items/maps`), the ERP supplier list;
* IT-only ADMIN: IT Asset Group 201; Non-IT Asset Group, sub-category under a Non-IT group, Item under a Non-IT group, and deactivating a Non-IT Item → 403 (no cross-area creation);
* `GET /api/auth/capabilities` for the ordinary ADMIN agrees (`can_create` vendor/brand/cost_centre/stock_room/item/category true; `can_manage` vendor/company/location/department/custom_field/bundle/code_rule/imports false; not head-office);
* UI: no Import link, no Settings in the sidebar (kept), and `/settings` typed in shows "You don't have access to this area." (new).
* The ordinary account is now made by the shared `createTestLogin` fixture (same create + reset + forced change-password path as before).

## 2. Shared fixture changes (`frontend/e2e/fixtures.ts`)

Teardown follows the server's rules instead of fighting them (nothing in the product was relaxed):
1. **Retire the company's assets first**, through the product's own legal moves (`POST /api/assets/bulk-action`, so `apply_event` writes every step and the ledger stays append-only): with a person / store / install point → moved back to the test stock room; in stock → disposed of; under repair → scrapped; lost / already terminal → nothing. Disposed / lost assets do not count as "held" (S0), so the holders can then be deactivated.
2. Test asset users.
3. **Sets (bundles)** whose parts belong to the run's Categories (a spec that failed before its own "deactivate the bundle" step no longer leaks a set).
4. **Every active Item under a registered Category** (also Items a spec made in the UI), then **every active Sub-category under a registered Category** — S6: a Sub-category with active Items, or a Category with active Sub-categories / Items, cannot be deactivated.
5. Remaining masters in reverse order, the company, the SEEDADMIN login (last).

Also new: `SeedRegistry.stockRoomId`; `createTestLogin()` (ordinary ADMIN / OPERATOR / VIEWER login, optional one work area, registered for teardown); `pick()` (open a picker, choose, wait until the list has closed).

## 3. Real product defects

**None found.** Every failure traced to an intended behaviour change (S0 holder rule, S0.5 date rule, S3a-1 permissions, S2/S4 line naming) or to test timing / isolation. Checked and not a defect:
* duplicate Item option — closing animation of the previous picker (the open list holds each Item once);
* register showing older rows — the 300 ms search debounce, the narrowed list arrives as designed;
* Receive refusing the invoice date — the server sentence is shown on the field and nothing is received ("Everything you typed is still here").

Observation (not changed, product judgement): the Receive / PO-page line title is the Item name only, so two lines of one set that use the **same** Item (possible only when a set lists one Item for two parts) read identically except for the line number; the part's description is shown under it.

## 4. New E2E coverage

| Spec | Journey |
|---|---|
| `operator-po-receive-journey.spec.ts` | (vi) an OPERATOR (IT) has no Settings in the sidebar; `/settings` and `/settings/catalogue/items` show "You don't have access to this area."; (iv) one-screen New PO: **New Vendor…** and **New Item…** (type of asset + "No serial number") created inline from the PO's own pickers, vendor verified to exist; (v) **3 lines / 104 units** → "PO created: 3 lines, 104 units waiting.", exactly 3 line rows with Ordered / Received / Waiting 50/0/50, 4/0/4, 50/0/50; (i) **50 no-serial units in one receipt**: one quantity box on the line, no textarea, no checkbox, no unit rows, no serial box anywhere → "50 assets created", line 3 Received 50 / Waiting 0, line 1 still 50 waiting, API: 50 assets with that PO number |
| `add-assets-batch.spec.ts` | (ii) Add Assets: no-serial Item, quantity 20, no serial box / no textarea → "Add 20 assets" → "20 assets created", 20 distinct `E2E/…` codes; register finds exactly 20 by the shared description; API: 20 assets of that Item, `IN_STOCK`, holder = the chosen stock room, serial `N/A` |
| `erp-unmatched-vendor.spec.ts` | (iii) read-only, on the stack's ERP copy: an open ERP PO whose supplier is not matched (`vendor_linked: false`) is picked **at run time** from `GET /api/erp/pos?envelope=true&readiness=NEEDS_INPUT` (which supplier is unmatched changes as people link vendors, so no PO number is hard-coded). Asserts the API row (`NEEDS_INPUT`, "Vendor needs matching."), the screen row ("(ERP supplier)", "Needs your input", "Vendor needs matching.") under All and under the "Needs your input" chip, and the review's "Vendor needs matching" section / "· needs matching". **Skips with a stated reason** if the ERP copy is not configured or every supplier is matched. On this stack it ran (not skipped). Nothing is created or linked. |

Every spec seeds and tears down its own company. The full suite takes about 1.3 minutes.

## 5. Final counts

* Playwright (UAT stack, one full run): **12 passed** (9 existing + 3 new), 0 failed, 0 skipped.
* Backend / frontend unit suites: not touched (no product code changed). The e2e files type-check under `tsc --strict` (`npx tsc --ignoreConfig --noEmit --strict --module esnext --moduleResolution bundler --target es2022 --skipLibCheck --types node e2e/*.ts`).

## 6. Data left on the UAT stack / still open

* Ten active `E2E-…` companies (ids 218–227, created 15:05–15:06) are leftovers of runs whose old teardown stopped at the holder rule; their SEEDADMIN logins are inactive (0 active SEEDADMIN after the final run), so they do not disturb logins. Not removed (the brief allows only the SEEDADMIN clean-up); the next runs ignore them.
* Two leftover sets from this stage's own intermediate runs ("E2E Desktop mv6tomms", "… mv6tqcgw") were deactivated in the UAT database (`update bundle set is_active=false where id in (1,2)`), before the bundle sweep was added to teardown.
* The assets of every E2E run end disposed of (ledger kept); assets and their events can never be removed, by design.
* `frontend/e2e/README.md`, referenced by a comment in `fixtures.ts`, does not exist (not created here).
* Nothing is still red.
