# CKAM — Final UAT record (Level-3 simplification programme)

Date: 2026-10-14. Environment: throw-away UAT copy of the dev database (web 3311, API 8100, docker project `ckam-uat`), never production. Personas: Head-office Admin, Full Admin, IT Team operator, Admin/Non-IT operator, purchase/delivery user (both areas), View Only, and a self-service login created through the UI during the test. Detail lives in the four source reports; this page is the consolidated result.

| Source report | What it covers |
|---|---|
| `CKAM_SIMPLIFICATION_S7_REPORT.md` | First persona UAT on HEAD `c656f33`: 16 journeys, navigation and guards, performance, visual matrix (17 screens × 4 viewports), 17 integrity checks, defect register (3 P1, 13 P2, 16 P3) |
| `CKAM_SIMPLIFICATION_S7_E2E_REPORT.md` | Permanent Playwright suite: 9 specs ported to the new rules, 3 new journeys, 12 of 12 passing |
| `CKAM_SIMPLIFICATION_S7_FIX_BACKEND_REPORT.md`, `…S7_FIX_FRONTEND_REPORT.md` | The fix round for the first register |
| `CKAM_SIMPLIFICATION_S7_RETEST_REPORT.md` | Retest of every defect on the fixed build: P0 0 · P1 0 · P2 1 · P3 10 |
| `CKAM_SIMPLIFICATION_S7_FIX2_REPORT.md` | Closing of the last P2 and four P3 |
| `CKAM_SIMPLIFICATION_S8_REPORT.md` | Audit trail, logs, diagnostics (built after the retest; verified by tests, e2e and a live browser check, see below) |

## 1. Measured journeys (real browser as the persona; "before" = audit measurements)

| Task | Before | Measured now |
|---|---|---|
| ERP PO, everything mapped | 3 screens, 3 clicks | 2 screens, 3 clicks, ≈ 4 s |
| ERP PO, one unknown item (operator) | 6 clicks and a dead end | 4 clicks, resolved in the same screen, no dead end |
| ERP PO of an unmatched vendor | PO invisible; 4 screens, ≈ 8 clicks | listed as "Vendor needs matching"; link in the review, 4 clicks |
| ERP PO: new vendor and new Item created inside the review | dead end | 10 clicks, 3 typed, PO of 500 units created |
| Manual PO (vendor and Items created inline; 10 laptops + 5 ACs) | 2 screens, ≈ 24 clicks, ≈ 18 typed | 1 screen, 15 clicks, 10 typed, ≈ 59 s |
| Receive 10 serial laptops | ≈ 14 clicks | 2 clicks, 4 fields (one serial box), ≈ 50 s with scanning |
| **Receive 50 non-serial units** | **≈ 53 clicks** | **2 clicks, 2 typed fields, no per-unit control** |
| Receive 10 serial-later, then enter serials | ≈ 24 clicks | 5 clicks + one paste |
| Receive 100 mixed units (3 lines) | a 6,453 px page of 104 rows | 3 line rows, 0 unit rows, API 109 ms |
| **Add 20 identical assets** | **≈ 200 clicks, 20 forms** | **8 clicks, 2 typed, ≈ 20 s** |
| Add 10 serial assets (pasted) | – | 9 clicks, 3 typed |
| Move 20 assets to a store ("take N of Item") | ≈ 24 clicks | 10 clicks, API 74 ms |
| Create a vendor | 4 clicks, 6 fields, owner only | 2 clicks, 2 fields (inline for operators too) |
| Create Employee / Store / Stock Room / Install Point | store needed 3 records, ≈ 26 clicks | 4–7 clicks each; a store makes its own Stock Room and Install Point |
| Find an asset (serial, code, ERP code, Item, PO, vendor, person) | by Item or ERP code impossible | 1 box, under 0.7 s for every kind |
| First setup of a new company | 10 screens, ≈ 70 clicks | one wizard, 37 clicks, per-company progress |
| Non-IT: 20 gondolas → warehouse → 10 to a store → install 5 | ≈ 80 clicks, 3 holders per store by hand | 35 clicks, store rooms automatic |
| IT lifecycle: receive → stock → give → return → reassign | ≈ 45 clicks | 18 clicks |

Receive timing at the API (1 / 10 / 50 / 100 units): 33 / 34 / 42 / 109 ms. Add 1,000 assets in one batch: 200 ms.

## 2. Role behaviour (all as designed)

Menus per role matched the design (owner everything with a collapsed Settings group; Full Admin adds People & Places and a Catalogue group; operators 6 entries; viewer 3; self-service 1). Every blocked address ("/settings", "/import", "/people/…" for operators; create screens for a viewer; everything but My Assets for self-service) showed "You don't have access to this area." with no form and no failing request. The self-service login was created through Add Employee → Issue login passwords → first sign-in → forced password change, and worked first time.
Security probes: operators could not see or create the other work area's Items (the server refuses with a plain sentence); a Full Admin could not reset the head-office admin's password (row shows "Head-office admin only"); only the head-office admin can change the asset code format.

## 3. Defects: final status

| Level | Found | Final |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 3 (ERP rows hidden on Home plus a 503 on every PO page; double submits writing duplicate PO / assets / ledger events; wrong "100% match" ERP suggestions) | **0**: fixed and retested (double submits at < 20 ms now produce exactly one record; SQL shows no duplicate POs or ledger events) |
| P2 | 13 + 1 found in the retest (wrong suggestions still at 95%) | **0 known**: 12 retested fixed; the last was closed in fix round 2 and checked by unit tests, the e2e suite and before/after data on the UAT copy |
| P3 | 16 + 4 found in the retest | **about 6 open polish items**: PROCURED events show 05:30 (date-only stored as midnight UTC); GSTIN checksum not validated; the Desktop set example leaves its 4 part Items to pick by hand; the UAT copy's QR link points at the dev port (environment setting); Admin menu has no separate "Users & access" entry (People & Places covers it); an ERP PO whose lines are all "not tracked" stays in "Needs your input" with no dismiss. Also noticed in the last live check: two nested `<main>` elements on pages (accessibility nit); "Version unknown" in diagnostics on the UAT copy because the build argument `GIT_COMMIT` was not supplied |

Data integrity (17 read-only SQL checks after all journeys, rerun after the fixes): ordered = received + waiting + cancelled on every PO; every delivered unit has its asset and every such asset has Item, vendor, PO, invoice, cost centre, company, work area, a current stock room and exactly one PROCURED event; serials unique; asset codes unique and gap-free; no orphans; work area of each asset equals its Item's group; operator-made mapping rules carry their creator; audit rows exist for edits; nothing was hard-deleted. All passed after the fixes.

## 4. Automated checks at the end

| Check | Result |
|---|---|
| Backend full suite | 1577 passed, 0 failed (689 at the start of the programme) |
| Frontend full suite | 1222 passed in 89 files (454 at the start), `tsc -b` clean, `npm run build` succeeds |
| Playwright permanent specs | 12 of 12 passed on the final build |
| Alembic | single head `e6f8a0b2c4d6`; fresh empty database to head verified; dev and UAT copies at head |

## 5. S8 logging: live check on the final build

As the head-office admin in a real browser: "Report a problem" returned a reference; creating a vendor produced the audit line "Vendor '…' created" with the person and time; pasting the reference opened "Everything for this request" with the report and its recent requests; "Copy diagnostics for support" produced the support text (versions, health, database, ERP sync age) with no passwords in it; no console errors.

## 6. What was not tested, and why

* ERP change reconciliation on a PO, purchase-invoice fetch and "goods arrived" reminders with real data: the ERP views they read do not exist yet (and the UAT copy has no ERP changes to show).
* Physical label printing and real barcode scanners (printing was stubbed; scanning simulated by typing + Enter); the QR image was not decoded.
* Real production-scale concurrency (the double-submit protection was tested with two requests within milliseconds, not with many users).
* The head-office Undo of a "Not tracked" rule from the PO review was built and unit-tested after the last persona retest.
* The persona UAT was not repeated end to end after fix round 2 and S8; those were verified by their tests, the e2e suite and targeted checks.
* Cross-company allotment (owner decision of 2026-10-13) is not built; it was never part of this redesign.
