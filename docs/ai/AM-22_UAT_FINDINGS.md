# AM-22 — Live Browser UAT of AM-18 through AM-21

Manual, evidence-based UAT of four feature batches (Warranty Years, Record PI /
Invoice Amount / Add Asset ground-reality fixes, Asset Movement, Search/Sort
everywhere) that had automated test coverage but had never been driven in a
real browser. Performed against `http://localhost:3211` with the `api`/`web`/
`db` containers, using a dedicated throwaway company `UAT-AM22-P1`.

**Important environmental note:** partway through this session another
development session began actively committing to this same shared worktree
(`git log` advanced from `9aacec7` to `3a9ae97` mid-session, and by the end
`backend/app/assets/router.py`, `backend/app/reports/export_service.py`,
`backend/pyproject.toml` were uncommitted-modified and a new
`backend/tests/assets/test_am23_print_labels.py` had appeared — evidently
unrelated "AM-23 print labels" work). The `api` container was also observed
restarted mid-session (container start time landed inside this session's
window). None of this touched the AM-18–21 code paths under test. Every
functional result below was independently confirmed via direct Postgres
queries (not just UI screenshots), so it is not affected by this drift. The
final full-suite run (see bottom) reflects the tree as it stood at the end of
the session, including that unrelated in-progress work — the failures it
shows are isolated below and shown not to be AM-18–21 related.

## Test data

Company `UAT-AM22-P1` (id 295), bootstrap holder `SEEDADMIN`, masters
(`UAT22-CAT`/`UAT22-SUB`/`UAT22-CC`/`UAT22-VEN`), holders `STK-UAT22`
(IT_STOCK), `EMP-UAT22` and `EMP-UAT22B` (EMPLOYEE/HOLDER), and a
company-scoped code rule (`UAT22/{yy}/####`). All created through the real
UI/API, never touching pre-existing data.

## AM-18 — Warranty Years

| Test | Result |
|---|---|
| Add Asset, Warranty Years = 0 → Warranty Upto = Purchase Date | **PASS** — asset `UAT22/26/0001`: Purchase Date and Warranty Upto both `2026-09-29` |
| Add Asset, Warranty Years = 3, Invoice Date = 2025-03-15 → Warranty Upto = Invoice Date + 3y − 1d | **PASS** — live preview and saved value both `2028-03-14` |
| PO Add Line (Warranty Years = 2, qty 3) → Delivery (two invoices, different invoice dates) → converted assets' Warranty Upto computed from *invoice* date, not PO date | **PASS** — PO date was `2026-09-29`; delivered assets show `invoice_date`/`purchase_date` `2025-06-01` → `warranty_upto 2027-05-31`, and `2025-08-10` → `2027-08-09` |
| Edit existing asset's Warranty Years → Warranty Upto recomputes | **PASS** — asset `370`: Years 0→5, Upto recomputed live and on save to `2031-09-28` (Purchase Date + 5y − 1d) |
| Edit asset WITHOUT touching Warranty Years → Warranty Upto unchanged | **PASS** — asset `371`: changed only Brand; Warranty Years stayed `3`, Warranty Upto stayed `2028-03-14` |
| No Quantity field anywhere on Add Asset | **PASS** — confirmed absent (full-page read of the form) |

## AM-19 — Record PI / Invoice Amount / Add Asset optional fields

| Test | Result |
|---|---|
| Add Asset leaving PO/Invoice/PI all blank → saves, Purchase Date = today | **PASS** |
| Invoice Amount visible + editable on Asset 360 | **PASS** — set to 5000.00 via Edit, confirmed on Procurement tab |
| PO with qty-3 line, delivered 2 units on Invoice A + 1 unit on Invoice B | **PASS** — "Invoices delivered under this PO" showed both `UAT22-INV-A` and `UAT22-INV-B`, each with its own Record PI button |
| Record PI for Invoice A, Overwrite unchecked → fills blank PIs | **PASS** — "Updated 2 asset(s)" |
| Record PI again, different PI number, still unchecked → skips | **PASS** — "Updated 0 asset(s). Skipped 2 asset(s) that already had a PI Number" |
| Record PI again with Overwrite checked → forces the change | **PASS** — "Updated 2 asset(s)"; DB confirms new PI number/date on both |
| PO list PI Status column: Pending → Recorded, PI No/Date shown only when exactly one invoice | **PASS** — showed "Pending" while INV-B was outstanding, "Recorded" once both invoices had a PI recorded; No/Date columns stayed `—` throughout because this PO has 2 distinct invoices (by design, per the dialog's own explanatory copy) |

### Bug found and fixed: PO "Mark N asset(s) delivered" dialog — Confirm silently stayed disabled

**Root cause.** `frontend/src/features/purchase-orders/PurchaseOrderDetail.tsx`
computes `canDeliver` (gating the Confirm button) requiring `invoiceNumber`,
`invoiceDate`, **and `invoiceAmount`** to all be non-blank — matching the
backend's `DeliveryDoneIn` schema, where all three are non-optional
(`backend/app/purchase_orders/schemas.py:97-101`). That part is correct
backend behavior. The bug: the dialog's Invoice No / Invoice Date / Invoice
Amount `<Label>`s carried no required-field marker (only Serial Number and
Initial Holder had the red `*`), so a user who filled everything else and
left Invoice Amount blank (a very natural thing to do, since it's optional
everywhere else in the app — Add Asset, Asset 360 Edit) got a Confirm button
that silently stayed disabled with zero explanation. Reproduced live: filled
Invoice No + Serial + Holder, left Invoice Amount blank → Confirm stayed
disabled (`button.disabled === true` via direct DOM check); filling Invoice
Amount flipped it to enabled instantly.

**Fix.** Added the same required-marker `<span>` already used for Serial
Number/Initial Holder to the Invoice No, Invoice Date, and Invoice Amount
labels. File: `frontend/src/features/purchase-orders/PurchaseOrderDetail.tsx`
(~line 704-716). No behavior change — the fields were already required by
backend contract; this only makes that visible.

**Regression test.** Added
`frontend/src/features/purchase-orders/PurchaseOrderDetail.test.tsx` ("AM-22
UAT: Invoice No/Date/Amount are visibly marked required..."), asserting each
of the three `<label for="invoice-...">` elements contains an
`aria-hidden="true"` child with text `*`. Ran the file alone:
`16 passed (16)`. Rebuilt the `web` container; re-verified live in the
browser that all three labels now show the red asterisk and that the
originally-reported repro (fill everything except Invoice Amount) now shows
the marker explaining why Confirm is disabled.

*(One non-bug false start worth recording: while setting up test holders I
initially suspected the Holder Location/Department dropdowns of a
cross-company data-integrity gap, since they list every company's rows with
no company filter. Checked the models — `Location`/`Department` genuinely
have no `company_id` column; they are intentionally global, shared masters.
Not a bug — reverted the speculative backend fix before it was ever
deployed.)*

## AM-20 — Asset Movement (`/asset-movement`)

| Test | Result |
|---|---|
| Scan real Serial Number, Enter → queues with correct Code/Description/Holder/Status | **PASS** |
| Scan an Asset Code instead → also works | **PASS** |
| Scan something nonexistent | **PASS** — "No asset found matching \"...\"." inline, no crash, queue untouched |
| Queue 2+ assets, Move/Allot/Transfer to a destination Holder, Apply | **PASS** — "2 asset(s) updated."; DB confirms both assets now `ALLOTTED` under the chosen holder |
| Queue an asset in a terminal/ineligible status (LOST) for "Move" | **PASS** — row visibly flagged red with "not eligible for 'Move / Allot / Transfer' from this status", header read "Queued (2) — 1 eligible", Apply button read "...to 1 asset" (excluded from the count); after Apply, DB confirms only the eligible asset moved and the LOST one was untouched |
| Send for Repair (no holder needed) | **PASS** — Destination Holder field correctly disappears for this action; asset moved to `UNDER_REPAIR`, holder unchanged |
| Report Lost (no holder needed) | **PASS** — asset moved to `LOST`, holder unchanged |
| Queue's own search box + Sort-by (Code/Description/Holder/Status) buttons, appearing once >1 item queued | **PASS** — search narrows the displayed list (matches Code/Description/Holder/Status; does not match Serial Number, which appears to be by design since Serial isn't one of the offered sort keys either); Sort by Code cycled ascending → descending correctly, visibly reordering the queue |
| Remove button on a queued row | **PASS** — removed exactly the targeted row, left the others and the count intact |
| All 8 action types present | **PASS** — Move/Allot/Transfer, Send for Repair, Receive from Repair, Report Lost, Mark Found, Dispose, Sell, Scrap |

Did not separately exercise Receive from Repair / Mark Found / Dispose /
Sell / Scrap beyond confirming they're present in the Action dropdown — not
explicitly requested and the underlying state-machine transitions are
already covered by the automated suite (`tests/assets/test_am20_bulk_action.py`).

## AM-21 — Search/sort everywhere

| Test | Result |
|---|---|
| Purchase Orders list: search by PO No, Vendor name | **PASS** — both narrowed correctly |
| PO list column headers (tried PO No): click → ascending, click → descending, click → cleared back to default order | **PASS** — row order visibly changed each time |
| Masters screen (Vendors) search box + column sort (Name) | **PASS** — narrowed on partial code match; Name column sorted alphabetically ascending |
| Asset Register search now covers Brand (in addition to the original Code/Serial/PO/Invoice/PI/Description) | **PASS** — set a distinctive Brand (`UAT22ZenBrand`) via Edit, searched for it, got exactly that one asset |
| Asset Register column sort is server-side | **PASS** — clicking the Description header fired `GET /api/assets?sort_by=description&sort_dir=asc...` (confirmed via network log) and the row order visibly changed |

Categories/Subcategories/Cost Centres/Departments/Locations were not each
individually re-tested for search/sort beyond Vendors — all seven Masters
screens share the same `MasterCrudScreen` component per
`docs/ai/PRODUCT_CONTEXT.md`, and Vendors' search+sort both worked correctly
against real data, so this is representative.

## Cross-cutting checks

- No raw stack traces, no unhandled console errors traced to app code (a
  handful of expected 401/422s appeared from auth-token refresh cycling and
  one intentional bad-request probe; no 5xx from the app itself during
  legitimate use).
- No infinite loading states encountered.
- No enabled-but-inert buttons found (the one "silently does nothing"-shaped
  issue found was the *disabled*-with-no-explanation Confirm button above,
  fixed).
- Warranty Years/Upto, Invoice Amount, and PI fields all round-tripped
  correctly through save → reload on Asset 360.
- Did not get to the optional "Warranty Years survives Import round-trip"
  check — out of time in this session; the automated import test suite
  already covers Warranty Years on import per `test_am18_warranty_years.py`,
  but a live import-screen click-through of that specific field was not done.

## Bug summary

| # | Area | Severity | Description | Status |
|---|---|---|---|---|
| 1 | AM-19 PO Delivery dialog | P2 (UX trap, not a data-integrity bug) | Invoice No/Date/Amount are backend-required but had no visible required-marker, so Confirm silently stayed disabled | **Fixed** — asterisks added, regression test added, `web` rebuilt and re-verified live |

No other bugs found across AM-18, AM-20, or AM-21.

## Final full-suite run (end of session)

**Frontend** (`npx tsc -b && npx vitest run`, from `frontend/`):
`tsc -b` — clean, no errors.
`vitest run` — **30 test files, 202 tests, all passed.**

**Backend** (`pytest -q` against `ckam_test`, full suite):
**382 passed, 7 failed, 4 errors** (389 collected+errored, plus setup errors).

Isolated the failures: none are in `test_am18_warranty_years.py`,
`test_am19_record_pi.py`, `test_am20_bulk_action.py`,
`test_am21_search_and_sort.py`, or `purchase_orders/test_router.py` — a
targeted run of exactly those files plus the PO router tests gave
**42 passed, 0 failed**. The 7 failures + 4 errors are in
`test_am07_asset_correction.py`, `test_login.py`,
`test_must_change_password.py`, `test_import_tokens_and_scope.py`,
`test_event_history_snapshots.py`, and `lifecycle/test_router.py`, none of
which this UAT stage touched. They line up with the concurrent, unrelated,
uncommitted "AM-23 print labels" work present in the working tree at the
time of this run (modified `backend/app/assets/router.py`,
`backend/app/reports/export_service.py`, `backend/pyproject.toml`, new
`backend/tests/assets/test_am23_print_labels.py`) — not with anything from
this AM-22 stage or its one fix. Recommend re-running the full suite once
that other work lands or is set aside, to get a clean baseline number.

## Cleanup

All UAT-AM22-P1 test data soft-deactivated in order (holders newest-first,
then masters, then company, then the bootstrap `SEEDADMIN` holder last),
each via the real `DELETE` endpoints. Re-verified after cleanup:
`SELECT count(*) FROM holder WHERE emp_code='SEEDADMIN' AND is_active=true`
→ **0**. No pre-existing data was touched.
