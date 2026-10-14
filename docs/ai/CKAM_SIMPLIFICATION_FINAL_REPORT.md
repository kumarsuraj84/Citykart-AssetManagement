# CKAM Simplification Programme — Final Report

**Verdict: CKAM SIMPLIFICATION READY WITH NON-BLOCKING OBSERVATIONS** (section 43).
Local, development / UAT only. Not pushed. Not deployed. Production not touched.

## 1. Executive summary

CKAM was strong underneath and too hard on top. The audit of 2026-10-13 found that a normal employee could not do the daily job without understanding how CKAM is built: a PO of three lines was a 104-row page, receiving 50 chairs took about 53 clicks, a purchase operator who needed a missing vendor, Item or stock room hit a dead end, ERP POs from unmatched vendors were invisible, the menu mixed daily work with setup, and a handful of security and integrity holes existed in the API.
The approved Level-3 programme (new screens and information architecture, a few orchestration endpoints, security fixes; no rebuild, ledgers and model preserved) is implemented in 31 local commits. Headline results measured in a real browser as each kind of user: **receive 50 non-serial units = 2 clicks (was ≈ 53); add 20 identical assets = 8 clicks (was ≈ 200); receiving 100 units takes 0.1 s and never renders a unit list; manual PO with new vendor and Item created inline = 15 clicks, about a minute; every kind of asset is found in under a second**. The user test found 0 P0, 3 P1 and 13 P2; all P1 and P2 are fixed. At the user's request a complete audit trail, logging and diagnostics system (S8) was added so any error can be traced and shared. Final automated results: backend 1577, frontend 1222, Playwright 12 of 12, one Alembic head.

## 2. Starting HEAD
`fc5bda4` (Items → ERP links), then `6607757` (audit documents) at the start of implementation.

## 3. Final local HEAD
The commit that contains this report (`git log -1`); the last product commit is `b74011c` (S8 web).

## 4. Original problems
Raw complexity: unit-row PO page; 53-click receipt; one form per asset; 5 places to decide an ERP code with 850 undecided codes; owner-only creation of vendor / brand / Item / stock room / cost centre; unmatched-vendor POs hidden; 24 sidebar entries with setup mixed into daily work; technical words on screen; three records per store by hand; no work-area field for operators; Move with 4 paths; labels in 5 places.
Defects found by an API sweep: a Full Admin could take over the head-office admin; one request could exhaust memory; work-area limits not enforced on POs, receipts or exports; blank / negative values accepted; moves could change custody; bare 500s; deactivated records accepted; delivery onto a deleted PO.

## 5. Security fixes (S0 and S7)
Head-office-admin account protected from other admins; quantity 1–1,000 and list caps; IT / Non-IT enforced on every PO, receipt, asset-create, ERP, PI and export path (an Admin can now be limited to one work area); lifecycle destination integrity and `status_since`; request validation; deactivated masters and deleted POs refused for new work; friendly errors with no bare 500; ERP create revalidated against CKAM's copy of the ERP; code rule validated on save and head-office only; format checks; moving a group between work areas needs confirmation; PO delete can never remove received assets. S7: idempotency keys, row locks on lifecycle events, PO-number uniqueness, honest ERP suggestions.

## 6. Navigation
Home · Work (Assets, Purchase Orders, Receive, Move) · People & Places (Employees, Stores, Stock Rooms, Install Points) · Reports · Settings (one collapsed group: Organisation, Catalogue, Vendors, Users & Access, ERP, Advanced, System). Role menus: Head-office Admin everything; Full Admin the operator menu plus People & Places and a Catalogue group; operator 6 entries; viewer 3; self-service 1. Frontend route guards show "You don't have access to this area." Old addresses redirect.

## 7. Home
Role-based quick actions (Create PO, Receive Delivery, Add Assets, Move Assets, Find Asset) and a "Needs attention" list from one call (waiting POs, serial-pending assets, assets without an Item, ERP POs needing input / changed, ERP Inbox counts, under repair, lost, errors and user reports for the head-office admin); recent changes, stock by place, a collapsed watch list.

## 8. Item model
Unchanged and central: the Item decides group, work area, serial behaviour (Has serial / No serial / Serial later), brand and warranty defaults and "comes as a set". Simple Item form: name + "type of asset" + serial choice. Sets are saved with the Item in one call. Serial behaviour lives only on the Item and every creation path obeys it.

## 9. Vendor flow
Name + GSTIN, code generated. ERP suppliers are grouped by company PAN ("Blue Star — 12 registrations") with "add one vendor and link all". Operators can create or link a vendor inside the PO review; suggestions by GSTIN / PAN / name are never applied automatically.

## 10. ERP mapping
The `item_map` engine and its precedence are unchanged. Decisions are asked only for codes on a real PO, remembered, and a one-time confirmation is shown before any group-wide rule is saved. Suggestions come from one shared scorer (rare words weigh more, generic words ignored, no coin-flip ties, "Same name" only for an exact name). Advanced rules (code / name / Article / Department / Section / Division, Not tracked, Undo) remain under Settings › ERP › Mapping.

## 11. ERP Inbox
Head-office admin only: new items (by ERP group), new vendors (by PAN), new stores; only codes on open POs; batch resolve with per-entry results; collapsible and paged.

## 12. Manual PO
One screen: header + lines (Item, quantity, cost, tax), "More details" per line from the Item, sets, totals, one atomic save (`with-lines`); inline creation of vendor / Item / stock room; draft restored after an accidental reload.

## 13. ERP PO
Every open ERP PO is listed as Ready or Needs your input (with the reason); the review shows only exceptions; unmatched vendor resolved in the review (link, create, link all registrations); not-tracked per code / name / group with confirmation; PO number and date come from the ERP.

## 14. PO detail
Shows lines (ordered / received / waiting / rate / value / status), not units; units are behind "View units" per line; edit, cancel waiting, header edit, invoices card with one Purchase Invoice entry point; Delete is allowed only when nothing was received. Exact line identity via `pending_asset.line_no`.

## 15. Receive
A first-class screen: common details once (Received Into, invoice no / date / amount), one quantity per line (default = all waiting), serial box only for lines that need it, per-line serial mode, required custom fields shown with a reason, "Why can't I receive?", Ctrl+Enter, sticky action bar on phones, 422 problems mapped to the exact line / serial. All-or-nothing: pre-validate everything, then one transaction.

## 16. Serial
Three plain behaviours on the Item; paste / scan with live count and duplicate warnings; serial-later creates Serial Pending assets; Serial Pending has bulk entry (oldest first) with preview.

## 17. Direct Add Assets
Batch form: Item, quantity, Received Into, Cost Centre; serial box by the Item's mode; purchase details and advanced options folded; one `assets/batch` call; the same asset engine as Receive.

## 18. People & Places
Employees, Stores, Stock Rooms, Install Points over one `asset_user` table with no type selector; plain role names and a work-area field (IT Team / Admin / Non-IT Team / Both); login toggle; bulk "Issue login passwords" with a one-time result; the word "Holder" is not used anywhere.

## 19. Store automation
Creating a store (screen, ERP import, generic API or Excel) also creates, once, its Stock Room and Install Point; `ensure-rooms` repairs older stores.

## 20. Asset Register
One universal search (asset code, serial, barcode, ERP code, Item, vendor, PO number, person; exact first), More filters with removable chips and URL state, Item / With / PO columns, "Mine" toggle, selection actions (Print labels, Move). Found in under a second.

## 21. Asset 360
Summary strip (code, Item, status, with whom and where, company, work area) and four sections: Identity, Procurement, Where it is & history, More. Company and work area now shown; each fact appears once.

## 22. Move
One screen with 11 plain-word choices; destination of the matching kind only; choices valid for the queued assets; scan / search / "Take N of Item from a Stock Room"; date, reference and remarks under More; confirmation for Sell / Scrap / Dispose. Asset 360 and the Register open it pre-filled.

## 23. Labels
One label component and one "Label settings" panel used by Receive, Add Assets, Register selection, Asset 360 and Move; the Print Labels page is only the queue.

## 24. Reports
On-screen preview with filters (company, work area, status, group, Item, vendor, PO, person, dates), summary strip and first 50 rows, Excel download with the same filters; movements tab; field-change audit kept.

## 25. Settings
Organisation (tabs), Catalogue (Items, Asset Groups with nested sub-categories, Brands, Link existing assets to Items), Vendors, Users & Access, ERP (Inbox, Mapping, Sync), Advanced (Custom Fields, Asset Code Format, Bulk Import), System (Logs, Diagnostics).

## 26. Setup wizard
Seven resumable steps with per-company completion from one call; reuses the normal forms; step 7 shows a live asset-code example for that company.

## 27. Role / access behaviour
Roles: Full Admin, Can Add & Move Assets, View Only, Own Assets Only; Head-office Admin above all. Full Admin and operators create vendor / brand / Item / stock room / cost centre in the flow (server-checked, company and work-area scope); edit / deactivate and heavy setup stay head-office. `GET /api/auth/capabilities` is the single source for what each person sees.

## 28. IT / Non-IT ownership
Work area is an authorization boundary: an IT-only admin manages IT groups / Items only and cannot touch the other area (also through nested creation); changing a group's work area needs a both-area admin or head-office admin, explicit confirmation and an audit row.

## 29. API orchestration added
`POST /purchase-orders/with-lines`, `GET /purchase-orders/{id}/receive-info`, `POST /purchase-orders/{id}/receive`, `POST /assets/batch`, `PUT /assets/serials`, `GET /assets/pick`, `POST /assets/link-items`, line-group endpoints, ERP readiness / draft / inbox / resolve / link-many / import-group, people and stock-room creation, `issue-passwords`, report previews, `home/attention`, `setup/status`, `Idempotency-Key` support, and the S8 log and diagnostics APIs. All older endpoints still work.

## 30. DB migrations
Four additive, all verified on dev, test, a fresh empty database and downgrade / upgrade: `b8d0f2a4c6e8` (PO line numbers, backfilled deterministically), `c1d3e5f7a9b0` (`master_audit`), `d2e4f6a8b0c2` (idempotency keys and unique live PO number; skipped with a notice if duplicates exist), `e6f8a0b2c4d6` (audit_log, error_log, system_event, client_report). Single head `e6f8a0b2c4d6`. No table dropped, no data rewritten.

## 31. Performance
Receive 1 / 10 / 50 / 100 units: 27 statements at any size, 33 / 34 / 42 / 109 ms (the old path used ≈ 1,900 statements and 0.75 s for 100). Add 1,000 assets 200 ms. ERP PO list of 565 POs 87–197 ms in one pass. Register search 14–18 ms. Auditing adds one statement per request.

## 32. Mobile
Receive, Add Assets, Manual PO (card layout), ERP Inbox, Add Employee and Move were fixed for 768 and 390 px (sticky action bars, no page-level horizontal scroll, long dialogs with a visible submit); checked in a real browser at 1920 / 1366 / 768 / 390.

## 33. UAT metrics before vs after
See `CKAM_FINAL_UAT.md` §1 (examples: 50 non-serial 53 → 2 clicks; 20 assets 200 → 8; manual PO 24 → 15; store setup 26 → 4; first company setup 70 → 37).

## 34. Backend tests
689 at the start → **1577 passed**, 0 failed.

## 35. Frontend tests
454 → **1222 passed** (89 files); `tsc -b` clean; `npm run build` succeeds.

## 36. E2E
Permanent Playwright suite: **12 of 12 passed** (9 specs ported, 3 new: operator PO + 50-unit receipt, 20-asset batch, unmatched-vendor PO).

## 37. Alembic
Dev, test and UAT copies at `e6f8a0b2c4d6`; one head; a fresh empty database reaches it.

## 38. Remaining P2 / P3
P2: none known. P3 (about 6): PROCURED events display 05:30; GSTIN checksum not validated; Desktop set example leaves part Items to pick; UAT QR base URL is an environment setting; no separate "Users & access" entry in the Full Admin menu; ERP POs made only of not-tracked lines stay "Needs your input"; plus two nested `<main>` landmarks (an accessibility nit). Not-built decisions: **cross-company allotment** (owner decision 2026-10-13) and owner decision D6 (limiting a Full Admin to chosen companies) are still open; the Excel asset import still has its own row-by-row path; an area-limited admin can still deactivate or reset the password of a wider-area non-owner account.

## 39. Deferred: depreciation
Not started; not part of this programme.

## 40. Deferred: repair transaction redesign
Repair stays a Move choice (send / receive back); a full repair transaction with vendor, cost and warranty claim is not redesigned.

## 41. Git status
All work committed locally in 31+ commits on `worktree-ckam-build`; the working tree is clean at the time of writing. Nothing pushed.

## 42. Production confirmation
No production server, database, NAS or the retired 10.0.1.12 was accessed. The UAT copy runs on this machine (ports 3311 / 8100) and is stopped or discarded at will (`docker compose -p ckam-uat down -v`).

## 43. Final verdict
**CKAM SIMPLIFICATION READY WITH NON-BLOCKING OBSERVATIONS.** Criteria for NOT READY were checked: no P0; no P1; no known security defect; no known work-area leakage; PO and Receive work at scale; a 50 non-serial receipt is one interaction; an operator no longer hits a dead end on the normal PO flow; asset history and audit did not regress (they gained an automatic audit trail); tests pass; the migration chain is sound. Observations that are not blockers: the open P3s and not-built decisions in §38; the ERP purchase-invoice and goods-arrived views do not exist so those paths could not be exercised with real data; the persona UAT was not repeated end to end after the last fix round and the logging stage (covered by tests, e2e and targeted live checks); printing and scanner hardware were simulated. Before any release: follow the checklist at the end of `CURRENT_STAGE.md` (run Playwright on the target machine, `alembic upgrade head` before starting the new code, set the logging environment variables, apply PostgreSQL logging settings on the production database server).

## Appendix — new documents
`CKAM_CURRENT_PRODUCT_ARCHITECTURE_2026.md`, `CKAM_COMPLEXITY_AND_FRICTION_AUDIT.md`, `CKAM_SIMPLIFIED_OPERATING_MODEL.md` (proposal), `CKAM_SIMPLIFIED_INFORMATION_ARCHITECTURE.md` (proposal), `CKAM_CURRENT_VS_SIMPLIFIED_JOURNEYS.md`, `CKAM_SIMPLIFICATION_IMPLEMENTATION_PLAN.md`, the stage reports `CKAM_SIMPLIFICATION_S0 … S8`, `CKAM_FINAL_OPERATING_MODEL.md`, `CKAM_FINAL_INFORMATION_ARCHITECTURE.md`, `CKAM_FINAL_UAT.md`, `LOGGING_AND_DIAGNOSTICS.md`.
