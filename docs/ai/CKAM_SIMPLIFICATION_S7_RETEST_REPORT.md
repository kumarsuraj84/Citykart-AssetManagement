# CKAM Simplification — S7 re-test after the fix round

| | |
|---|---|
| Date | 2026-10-13 |
| Code under test | worktree `ckam-build`, HEAD `881e878` (test(e2e): follow the fix round …), on top of `81804f6` (api fix round) and `9cf5e6b` (web fix round) |
| Environment | throw-away UAT stack `ckam-uat`: web `http://localhost:3311` (bundle `index-BaQYbPtu.js`, contains the fix-round strings "Similar name", `Idempotency-Key`, "Move to Stock Room"), api `http://localhost:8100`, database freshly cloned from dev, Alembic head `d2e4f6a8b0c2`, partial unique index `uq_purchase_order_company_number_active` present. Personas UATOWNER, UATADMIN, UATIT, UATNONIT, UATPO, UATVIEW (+ UATSELF created in this run). Leftover `E2E-*` companies/assets from an earlier e2e run are ignored. |
| Method | Real Chromium (Playwright, headless) per persona with the first UAT's action counter (`lib.mjs`); direct API calls as the personas (Node `fetch`, two requests launched in the same tick, 0.2–0.3 ms apart); read-only SQL in `ckam-uat`. Business data created through the UI except where a step says "API". No file in `frontend/` or `backend/` was changed; no git command that changes anything was run (one read-only `git log -1` / `git status` at the start to confirm HEAD). Production, the dev stack and other docker projects were not touched; inside `ckam-uat` only the api container's `/tmp` was used to build the import workbook. |
| Scripts / raw output | `…/scratchpad/uat-s7/retest/` (`p1_1.mjs`, `p1_3.mjs`, `sugg_api*.mjs`, `dbl_api.mjs`, `two_tabs.mjs`, `j_d.mjs`, `j_erp.mjs`, `j_receive.mjs`, `j_add_assets.mjs`, `j_move.mjs`, `p2a.mjs`, `p2b.mjs`, `wizard2.mjs`, `extras_api.mjs`, `serial_pending.mjs`, `import2.mjs`, `regress*.mjs`, `visual.mjs`, `integrity_rt.sql`; outputs `*_out.txt`, `journeys.jsonl`, `perf.jsonl`, `visual.jsonl`, `integrity_out.txt`; screenshots in `shots/`) |
| Evidence kept in repo | `docs/ai/s7-screens/retest_*.png` (10 files, each < 150 KB) |

## 0. Verdict

**P0 remaining: 0, P1 remaining: 0, P2 remaining: 1, P3 remaining: 10.**

All three P1s are fixed as reported: Home shows the ERP rows for every persona and no PO page logs a 503; a same-tick double submit (UI, API with a key, API without a key where a business rule applies, two tabs) never produced a second PO / batch / receipt / ledger event; the two named wrong suggestions are gone, nothing is preselected and the wording is "Same name" / "Similar name (n%)". All 13 P2s are fixed (P2-3 with one sub-point left open as a P3). Every in-scope P3 is fixed.

What is still wrong: the item-suggestion scoring still proposes the wrong Item at "Similar name (95%)" for about 1 in 5 suggested ERP groups, and one group is labelled "Same name" for a group that also holds a different product (**N1, P2**). Four small new P3s (N2–N5) and six out-of-scope P3s from the first register remain.

## 1. Defect register: status after the fix round

| ID | Defect (first UAT) | Status | Evidence (this re-test) |
|---|---|---|---|
| **P1-1** | Home lost the ERP rows; PO pages logged 503 `/erp/reminders` | **FIXED** | Home: UATOWNER "656 ERP purchase orders need your input" + the head-office **ERP Inbox** block (132 items / 81 vendors / 212 stores); UATPO and UATIT "561 ERP purchase orders need your input"; UATNONIT 560 (`j01_out.txt`, `retest_home_owner_erp_rows.png`). PO list + 6 PO pages per persona (UATOWNER, UATPO, UATIT; incl. ERP-made PO 8): every `/api/erp/reminders?envelope=true` answers **200** with `X-ERP-Available: false`; **0 console errors, 0 failed calls** (`p1_1_out.txt`). PI dialog on an ERP PO (22, after receiving 1 unit): calm note (`role=note`, 0 alerts) "The ERP does not provide purchase invoices yet." + **Type it in** → PI "PI-RT-0001 · 2026-10-13" recorded (`pi2_out.txt`, `retest_pi_dialog_calm_note.png`). |
| **P1-2** | Near-simultaneous double submit wrote duplicates | **FIXED** | See §2. UI same-tick double activation sent **1** request on Save PO, Add 20 assets, Receive 10/50/100, ERP Create (×2 POs), Send to Store (20), Send for Repair. API: same key ×2 → **201 + 409** ("This request is already being processed.") on PO, batch, receive, bulk-action, ERP create; replay → same status + `Idempotency-Replay: true`; same key + other payload → **422**; malformed key → 422. Without a key: PO → 201 + 422 "already exists"; ERP create → 201 + 422 "already created here"; repair → second answers `done 0, failed: under repair` (row lock); receive with the same serial → 422. Two tabs saving the same manual PO → 201 + 422 (one PO). SQL: 0 duplicate active PO numbers, 0 duplicate ledger events, keyed batch = 2 assets. |
| **P1-3** | ERP suggestions "AI BOX (100%)" for GANG BOX / HOP BOX | **FIXED as reported** (residual class → **N1**, P2) | Inbox: GANG BOX PVC 4 X 4 → "CAMERA BOX PVC · Similar name (95%)" (not AI BOX); R-51 HOP BOX → "HOPBOX · Similar name (95%)". PO review (UATPO): no line preselected ("Choose Item" on every undecided line), wording "Same name" / "Similar name (95%)"; no "% match" or "100%" anywhere on inbox page 1 (`p1_3_out.txt`, `retest_inbox_suggestions_gang_box.png`). But see N1 and N2. |
| P2-1 | Typed name hides "New Vendor/Item…" | **FIXED** | "New Vendor… “ABC”" / "New Item… “Split AC 1.5 Ton”" / "New Stock Room… “RT New Room”" offered after a non-matching search; each dialog prefilled with the typed text (`j_d_out.txt`, `p2a_out.txt`, `retest_new_vendor_typed_name.png`). |
| P2-2 | Move scan box ~25 px, Apply below fold | **FIXED** | 1366×768: scan box **943 px** wide, label 14 px (one line), Apply in a sticky bar at y 718–758 of 768 (`p2a_out2.txt`, `retest_move_1366.png`). |
| P2-3 | Setup progress global, not per company | **FIXED** (sub-point → N4) | New company UAT-RT: wizard "**4 of 7 done for UATRT**" (Stock Room, Cost Centre, People "To do"); `GET /setup/status?company_id=263` → done 4; unknown company 404; operator 403; Finish → "4 of 7 steps done for UATRT. Still to do: Stock Room / Places, Cost Centre, People / Stores." (`p2a_out3.txt`, `wizard2_out.txt`, `extras_api_out.txt`, `retest_wizard_new_company.png`). Step 7 example is still a generic sample (N4); a company added in step 1 is missing from the picker until reload (N3). |
| P2-4 | Horizontal overflow on small screens | **FIXED** | 17 screens × 1366/1920/768/390: **no page-level overflow anywhere**, 0 console errors (Home, Manual PO, ERP Inbox, Move, Add Assets, Receive included). Add Employee dialog submit in view at 390×844 (`visual_out.txt`). |
| P2-5 | ERP Inbox 33,000–74,000 px | **FIXED** | 20 groups + 20 suppliers per page ("Showing 1–20 of 132 groups", Page 1 of 7, Previous/Next → 21–40), search over titles/codes/PO numbers ("GANG" → 3 groups, "SPO/012247" → 2), PO lists truncated "… and 17 more". Page height **4,344 px @1366, 6,690 px @390** (was 33,772 / 73,724). API 160–248 ms. |
| P2-6 | Non-IT operator's PO Item picker lists IT Items | **FIXED** | UATNONIT: PO line picker asks `/api/items?work_area=mine` → 3 Items (Gondola Rack, Office Chair, Split AC) + New Item…; 0 IT Items; "+ New Item" types list only Store Fixtures (Non-IT). |
| P2-7 | Give to Employee: no way forward for a new joiner | **FIXED** (guidance) | UATIT: "Not in the list? Ask a Full Admin to add the employee (People & Places > Employees)."; UATADMIN: "Not in the list? **+ Add employee**" (link to Employees). No inline creation (as designed). |
| P2-8 | Sell/Scrap/Dispose without confirmation | **FIXED** | Sell → "Sell 1 asset? … This is final and cannot be undone …" Cancel → 0 requests; Scrap → confirm → 1 request, "1 asset scrapped." (`retest_sell_confirm.png`). |
| P2-9 | "Not tracked" defaulted to the whole ERP group, no confirmation | **FIXED** | UATPO review SPO/008709/26-27: default reach **This product name**, sentence "Leaves every code named “HANGER SOLUTION” out of CKAM for everyone in CKSPL."; choosing "Every code in this ERP group" asks "Leave a whole group out of CKAM? …Continue?", Cancel → 0 requests; code-only save → "Saved: the ERP code CT177292 is now left out of CKAM. Only the head-office admin can undo this (Settings › ERP Mapping)." (rule 16, created_by UATPO) (`retest_not_tracked_group_confirm.png`). |
| P2-10 | Asset import: no Item column, Vendor Code required, old heading | **FIXED** | Template headers include **Item** and **Received Into Code**. Workbook built with openpyxl in the api container (row 1: Item "Office Chair", no category, no vendor, qty 2; row 2: Item "Flux Capacitor"): preview "1 row ready, 1 row with errors" with Item and "Type of asset" columns and the sentence "There is no active Item named 'Flux Capacitor'…"; Commit 1 Row → "Imported 2 assets" → CHAIR/CKAM78–79, item_id 152, NON_IT, vendor null, event IMPORTED. |
| P2-11 | Matched ERP lines hid the ERP description | **FIXED** | Matched lines show "In the ERP: HIKVISION … · SMART SOLUTIONS · CT178080", "In the ERP: AHUJA MIC (AWM-495V1) … · CT222432". |
| P2-12 | Reload loses a typed manual PO without warning | **FIXED** | In-app navigation from Manual PO / Add Assets / Receive asks "What you typed here is not saved yet. Leave this page and lose it?" (Cancel stays); reload fires `beforeunload`, then "The purchase order you were typing before the page reloaded is back." with PO No and quantity restored; **Start again** clears it. |
| P2-13 | Send to Store vs store stock room unclear | **FIXED** (wording) | Choices "Move to Stock Room" / "Send to Store" with "Send to Store: the assets are with the store itself. Move to Stock Room: they are kept in a stock room (a store's own stock room, STK-…, is in that list too)." Behaviour unchanged by design. |
| P3-1 | "ERP data as of" twice | **FIXED** | Pick from ERP shows it once. |
| P3-2 | PROCURED at 05:30:00 | NOT IN SCOPE (still seen) | Home "Recent changes" for UATIT/UATPO still shows "09/10/2026, 05:30:00". |
| P3-3 | "Warranty 0 years · until today" | **FIXED** | Asset 360 of a chair without warranty: "Warranty —". |
| P3-4 | Duplicate text, old holder prefix, column name | **FIXED** | Register: Description "—" when it repeats the Item; "With: WH Stores Farukhnagar · Stock Room" (no "Stock Point - "); Serial Pending column "Type of asset", Item not printed twice. |
| P3-5 | Mark Found reason only in a tooltip; grammar | **FIXED** | Visible "Not possible now: Mark Found (only an admin can do this)."; mixed batch: "Not possible now: Give to Employee, …, Dispose (not possible for every asset in this batch); Mark Found (only an admin can do this)." |
| P3-6 | Refresh now silent; PI fetch sentence technical | **FIXED** | "Checked just now (11:30 pm): the ERP had nothing newer to copy."; PI: "The ERP does not provide purchase invoices yet." |
| P3-7 | Cancelled PO "Ordered 0" + Receive all waiting | **FIXED** | PO UAT-RT-NK: "Ordered units 2 · Cancelled units 2", line "2 · 2 cancelled", list "2 (2 cancelled)", status Cancelled, no "Receive all waiting". (Value shows 0.00 = value still ordered, as defined.) |
| P3-8 | GSTIN checksum | NOT IN SCOPE (not re-tested) | |
| P3-9 | Self-service 200 on reports; /dashboard "no access" | **FIXED** | UATSELF: `/reports/assets/preview` and `/reports/export/assets` → **403** "Reports are for staff. The assets you hold are listed under My Assets."; `/dashboard` → redirected to `/my-assets`; menu = My Assets only; `/reports` guarded. |
| P3-10 | Ordinary ADMIN may create categories | NOT IN SCOPE (decision; not re-tested) | Full Admin now has Add Group on Asset Groups (own work area), consistent with the S6 rule. |
| P3-11 | Desktop example leaves part Items empty | NOT IN SCOPE (still seen) | "Use the Desktop example" fills CPU/TFT/Keyboard/Mouse names; all 4 Item pickers still "Choose the Item" (4 extra picks). |
| P3-12 | Serial Pending newest first | **FIXED** | List asks `sort_by=purchase_date&sort_dir=asc`; 3 serial-later assets (1 then 2, separate batches): preview row 1 = CKAM1; SQL: CKAM1 = "…-FIRST", CKAM2 = "…-SECOND", CKAM3 = "…-THIRD" (`retest_serial_pending_oldest_first.png`). |
| P3-13 | Single Cost Centre not preselected | **FIXED** | Manual PO opens with "CKSPL · CKSPL" chosen (no pick needed in journey D). |
| P3-14 | QR base URL = dev port | NOT IN SCOPE (environment, unchanged) | `_asset_detail_url(368)` = `http://localhost:3211/assets/368`. |
| P3-15 | Admin menu lacks "Users & access" | FIXED (by the fix round, though not in scope) | UATADMIN menu: People & Places › … › **Users & Access**; page opens. |
| P3-16 | All-"Not tracked" ERP PO stays in "Needs your input" | NOT IN SCOPE (not re-tested) | |

## 2. P1-2 detail (double submits)

| Request | Same key, ×2 in one tick | Replay after finish | Same key, other payload | No key, ×2 in one tick | UI double activation |
|---|---|---|---|---|---|
| `POST /purchase-orders/with-lines` | 409 + 201 (twice, 2 pairs) | 201, `Idempotency-Replay: true` | 422 "This request key was already used for a different request." | 422 "Purchase order … already exists for this company." + 201 | 1 POST (key sent) → 201 |
| `POST /assets/batch` (2 chairs) | 409 + 201 → **2 assets** | 201, replay true | 422 | 201 + 201 → 4 assets (documented contract: no key = unchanged) | Add 20: 1 POST → 20 assets |
| `POST /purchase-orders/20/receive` (2 serial ACs) | 200 + 409 → 2 assets | 200, replay true | – | same serial: 200 + 422 "Serial number … is already used" | Receive 10 / 50 / 100: 1 POST each |
| `POST /assets/bulk-action` SENT_FOR_REPAIR | 409 + 200 → 1 event | 200 `{"done":1}`, replay true | – | 200 `done 1` + 200 `done 0, "This asset is under repair, so it cannot be sent for repair."` → 1 event | Repair by scan: 1 POST, 1 event |
| `POST /erp/pos/create` | 409 + 201 | 201, replay true, byte-identical body | – | 422 "This purchase order was already created here." + 201 | 2 ERP POs: 1 POST each |
| Two tabs, same manual PO | – | – | – | – | 201 + 422; tab 2 shows "Purchase order UAT-RT-TABS-Z58LY already exists for this company." |
| Malformed key `x` | 422 "The request key is not valid. Send a new random key …" | | | | |

Gaps between the paired requests: 0.2–0.3 ms. Ledger after all of it: assets 338/339 have exactly one SENT_FOR_REPAIR each; `asset.status` equals the last event's `status_after` for every asset (0 mismatches). Replay bodies of PO, batch and receive are the same JSON with the keys in another order (stored as jsonb) — see observation O1.

## 3. New defects

| ID | Sev | Defect | Repro | Expected → actual | Evidence |
|---|---|---|---|---|---|
| **N1** | **P2** | **Wrong Item suggestions remain at "Similar name (95%)", and one group is "Same name" for a mixed group.** About 6 of the 29 suggested groups are wrong: an Item whose name has one distinctive word after the generic words are dropped (CAMERA BOX PVC → "camera"; CABLE MANAGER → "manager") matches any text with that word; the "what a product is" rule checks only the text's last word, not the Item's (a barcode printer gets BARCODE_PRINTER_STAND); the longer-name tie-break beats the right Item. The group-level "Same name" comes from one code while the suggested reach is the whole Article. In the PO review "Use suggestion" also saves a group-wide rule by default ("Remember: every code in this ERP group") without a confirmation (rule 15 FA_CE_UPS → UPS SMALL was saved by UATPO this way). | UATOWNER `/settings/erp/inbox`, search CCTV_INDOOR / NEW DEPARTMENT / Q MANAGER / PRINTER_BARCODE / TABLE_OFFICE; or `GET /api/erp/inbox` | INDOOR CAMERA @POE → INDOOR CAMERA (Item exists) → **CAMERA BOX PVC 95%**; HIKVISION DOME CAMERA → **CAMERA BOX PVC 95%**; Q MANAGER (queue-manager stands) → **CABLE MANAGER 95%**; PRINTER BARCODE GODEX G-500 → **BARCODE_PRINTER_STAND 95%**; FA_FF_TABLE_OFFICE (TABLE 4*2 + OFFICE CHAIR) → **Office Chair · Same name**, reach = Article, so one click maps the table to Office Chair; GANG BOX PVC 4 X 4 → CAMERA BOX PVC although Item GANGBOX exists (arguable). Nothing is preselected, so no harm without a click. | `sugg_api_out.txt`, `sugg_api2_out.txt`, `retest_N1_inbox_table_office_same_name.png`, `shots/N1_inbox_cctv_indoor.png` |
| N2 | P3 | The same ERP code shows "Same name" in the PO review but "Similar name (95%)" in the ERP Inbox | UATPO review GPO/001425/26-27 (line title "R-51 HOP BOX") vs Inbox group FA_CE_HOPBOX | One wording → review "HOPBOX · Same name" (it compares the ERP line text "HOPBOX") while it shows the article name "R-51 HOP BOX"; inbox "Similar name (95%)" | `p1_3_out.txt`, `sugg_api_out.txt` |
| N3 | P3 | Setup wizard: a company just added in step 1 does not appear in "Company being set up" until the page is reloaded | UATOWNER `/settings/setup?step=1` → Add Company UAT-RT2 → open "Company being set up" (also after 2 s) | New company listed → only the companies that existed before (reproduced twice: UAT-RT, UAT-RT2) | `p2a_out2.txt`, `wizard2_out.txt` |
| N4 | P3 | Step 7 "Next Asset Code in UATRT" shows a generic sample "FA/CC01/IT/LAP/CKAM1" for every company; the server's preview ignores `company_id` (same answer for null / 2 / 263). Remaining part of first-UAT P2-3. | wizard step 7 with UAT-RT chosen; `POST /api/code-rules/preview` with `company_id` 2 and 263 | That company's real codes (FA/CKSPL/ITHW/LAPTOP/…) → generic sample | `wizard2_out.txt`, `coderule_out.txt` |
| N5 | P3 | PO "Edit line" dialog marks Barcode as required ("Barcode*") though an empty barcode saves (line edited 5 → 4, barcode stays empty) | UATPO PO UAT-RD-YVMR0 › line 2 › Edit | "Optional." as in the ERP review → required marker | `regress3_out.txt`, SQL on `pending_asset` |

Observations (not counted):
* **O1** Replayed answers carry the same JSON with keys in a different order (stored as jsonb), so they are equal by meaning, not byte-identical (the ERP create replay happened to be identical). Harmless for JSON clients; the backend report says "same body".
* **O2** A second browser tab is signed out (the session is per tab), so "two tabs" means two sign-ins of the same user; both were protected as shown.
* **O3** Bulk moves are slower with the row locks but still fast: Send to Store 20 assets 74 ms (first UAT 35 ms).

## 4. Headline journeys: before (first S7 UAT) vs now

Counting rule unchanged (screens · clicks · typed fields · selections · keys; human est. = 1.2 s per click/key + 3 s per typed field + 1 s per selection + measured app wait). The re-test fires the final submit as a same-tick double activation and then waits 2.5 s, so "app wait" and "human est." include ~2.5 s that a person would not see.

| Journey (persona) | First UAT | Re-test | Change |
|---|---|---|---|
| E Receive 10 serial laptops, serials pasted (UATPO) | 2 · 2 · 4 · 0 · 0; ≈ 17 s + scans; API 34 ms | **2 · 2 · 4 · 0 · 0**; ≈ 17 s + scans; API 37 ms; 0 unit rows | same |
| F Receive 50 non-serial in ONE receipt (UATNONIT) | 2 · 2 · 2 · 0; ≈ 11 s; API 42 ms | **2 · 2 · 2 · 0**; ≈ 10 s; API 47 ms; 0 checkboxes | same |
| Add 20 identical assets (UATNONIT, Office Chair) | 1 · 8 · 2 · 3; ≈ 20 s; API 20 ms | **1 · 8 · 2 · 3**; ≈ 20 s; API 25 ms; codes CHAIR/CKAM8–27 | same |
| D Manual PO: vendor ABC + AC Item created inline, 10 laptops + 5 ACs (UATPO) | 1 entry screen · 17 · 11 · 6 · **2 keys** (clear the search); ≈ 67 s | 1 entry screen · **15 · 10 · 5 · 0 keys**; ≈ 59 s (incl. 2.5 s wait) | **better**: typed name kept (no clearing, no retyping the AC name), Cost Centre preselected |
| B ERP PO with one exception resolved in the review (UATPO, SPO/003532/25-26, Use suggestion) | 2 · 4 · 1 · 0; ≈ 10 s | **2 · 4 · 1 · 0**; ≈ 12 s (incl. 2.5 s wait); "PO created: 2 lines, 4 units waiting" | same |
| C ERP PO of an unmatched vendor resolved in the review (UATPO, SPO/005013/26-27, Link to … same name) | 2 · 4 · 1 · 0; ≈ 10 s | **2 · 4 · 1 · 0**; ≈ 12 s (incl. 2.5 s wait); "PO created: 1 line, 5 units waiting" | same |
| Move 20 via Add by Item (Take N) → Send to Store (UATNONIT) | 1 · 10 · 3 · 3; ≈ 26 s; API 35 ms | **1 · 10 · 3 · 3**; ≈ 26 s; API 74 ms; oldest 20 taken | same (API +39 ms, row locks) |
| Find an asset by serial / partial serial / code / tail / ERP code / Item / PO / vendor / store / invoice (UATPO) | 1 · 1 · 1 each; 650–680 ms; API 14–18 ms | **1 · 1 · 1 each**; 648–680 ms; API 12–17 ms; all found | same |
| Receive 100 mixed units (30 serial + 50 + 20) (UATPO) | 2 · 2 · 3 + 1 paste; API **101 ms** | **2 · 2 · 3** (incl. the paste); API **109 ms**; 0 unit rows | same |
| Serial Pending: 3 serials pasted (UATIT) | (G: 10 serials, 3 · 5 · 3) | 1 · 3 · 2; oldest first | better (order) |
| Set-up masters: group 4·1·1, sub-category 2·1, Item 5·2·1, store 4·3·1, stock room 6·3·2, install point 6·3·2, employee with login 7·3·2 | same numbers | identical | same |

No regression in effort; journey D improved by 2 clicks, 1 typed field, 1 selection and 2 keys.

## 5. Regression sweep (one line each)

| Area | Result |
|---|---|
| Settings pages (18 addresses: landing, Organisation ×4 tabs, Asset Groups, Items, Brands, Vendors, Users & Access, ERP Mapping, ERP Data Sync, Custom Fields, Asset Code Format, Bulk Import, Print Labels, Serial Pending, Bundles) + ERP Inbox + Set up | PASS, all open with their heading, 0 errors |
| PO page actions | PASS: Edit line 2 ordered 5 → 4 (1 waiting unit cancelled, newest first); Edit details on a received PO locks PO No / date (by design), on PO 25 date changed to 2026-10-12; Cancel waiting items (P3-7); Record PI typed on a manual PO "PI PI-RT-MAN-1 · 2026-10-13" |
| ERP Mapping advanced screens | PASS: Codes (863 codes, filters Not decided 850 / Linked 7 / Not tracked 6), Articles, Groups… (Departments / Sections / Divisions) open without errors |
| Bundles / sets | PASS: Item "UAT Desktop Set" (comes as a set, Desktop example) saved; ordered 2 sets via Add set → "PO created: 4 lines, 8 units waiting", price split per part; `/setup/bundles` lists it |
| Documents upload (Asset 360) | PASS: `uat-doc.pdf` listed with Download |
| Asset correction | PASS (opened, not committed): More actions › Correct Classification (Category / Sub-category / Purchase Date / Reason*) |
| Company access dialog | PASS: lists the other companies incl. the new UAT-RT / UAT-RT2 |
| Labels | PASS: one print dialog with the single Label settings ("Barcode + QR · 70 × 20 mm" → Label Contains / Size) from Asset 360, Register selection ("3 selected · Print labels (3) · Move (3)") and the Receive result ("Print labels (2)"), each `window.print` ×1; Move has "Print labels as I scan" + Label settings and "Print Labels" opens `/print-labels` |
| QR deep link | PASS: signed-out phone at `/assets/368` → `/login?next=%2Fassets%2F368` → after sign-in Asset 360 of LAPTOP/CKAM1 |
| Reports | PASS: preview "415 assets match" with status/group summary; Download Excel `asset_register.xlsx` 43 KB in 229 ms |
| Role menus | PASS, unchanged except intended: UATADMIN gains Users & Access + a Settings group (Items, Asset Groups, Link Assets to Items); operators Home/Assets/PO/Receive/Move/Reports; viewer Home/Assets/Reports; self-service My Assets |
| Route guards | PASS: 31 addresses across UATADMIN/IT/NONIT/PO/VIEW/SELF show "You don't have access to this area." with 0 inputs; UATADMIN opens Items / Asset Groups / Link existing assets / Users & Access, and is refused Brands, Vendors, Organisation, ERP Mapping, ERP Inbox, Code Format, Import, Settings landing |
| Full Admin Catalogue (fix-round extra) | PASS: Items (New Item), Asset Groups (Add Group, + Sub-category), Link existing assets open for UATADMIN |
| Store via the generic API (fix-round extra) | PASS: `POST /api/asset-users` type STORE → 201 `rooms_created: ["stock_room","install_point"]`; STK-RTG9GP and INS-RTG9GP exist at the same place |
| Code-rule validation (fix-round extra) | PASS, unchanged: unknown token → 422 listing the allowed tokens; empty → 422 "needs a beginning…"; UATADMIN save → 403 "Only the head-office admin can do this." |
| Custom field required on receive | not re-run (unchanged code path; covered in the first UAT) |

## 6. Data integrity (read-only SQL, `integrity_rt.sql` → `integrity_out.txt`)

| # | Check | Result |
|---|---|---|
| I1 | ordered = received + waiting + cancelled for the 12 POs made in this re-test (ids 20–31) | **PASS** (e.g. 20: 15 = 13 + 1 + 1; 31: 100 = 100 + 0 + 0) |
| I2 | delivered units without asset / waiting units with an asset | **PASS** 0 / 0 |
| I3 | 166 assets from re-test receipts: Item, vendor = PO vendor, PO number, invoice, cost centre, company, work area | **PASS** all 0 missing |
| I4 | status vs holder type (ALLOTTED→STORE, IN_STOCK/SCRAPPED/UNDER_REPAIR→stock room or store) | **PASS** |
| I5 | exactly one PROCURED per re-test asset (198; 2 IMPORTED by design), to-name snapshotted | **PASS** |
| I5b | assets without any event | **PASS** 0 |
| I6 | serial uniqueness | **PASS** 0 duplicates |
| I7 | asset code uniqueness | **PASS** |
| I8 | gap-free numbering per CKSPL prefix | **PASS** (CHAIR 1…129, LAPTOP 1…42, GONDOL 1…20, AC 1…3, HOPBOXADAPTOR 1…3, MIC 1, …) |
| I9 | orphans (Item / holder / vendor), units without line_no | **PASS** all 0 |
| I10 | asset work area = Item's group = own category | **PASS** 0 / 0 |
| I11 | item_map rules made today carry `created_by` | **PASS** (15 Article FA_CE_UPS and 16 code CT177292 by UATPO; 4–14 from the dev clone) |
| I12 | master_audit rows today have an actor | **PASS** (category 57, item 90, subcategory 90, purchase_order 1 — all with actor) |
| I13 | duplicates from double submits | **PASS**: 0 duplicate active PO numbers; 0 repeated ledger events (the 6 "same type within 2 s" pairs are E2E moves to two different people, different from/to); keyed batch 2 assets, no-key batch 4 (contract) |
| I14 | no hard deletes; ledger agrees with status | **PASS**: 0 soft-deleted assets, no delete path used; `asset.status` = last event's `status_after` for every asset (0 mismatches) |
| I15 | bulk serial order | **PASS**: first pasted serial on the oldest asset |
| I16 | imported assets have an Item | **PASS**: CHAIR/CKAM78–79 item 152, NON_IT, no vendor |
| I17 | ERP-made asset fields | **PASS**: MIC/CKAM1 erp_item_code = barcode = CT222432, description "AHUJA MIC", Item mic, brand 8, vendor 34 (ARIHANT, linked in the review) |

**17 of 17 pass.**

## 7. Could not test / limits

* ERP change reconciliation: PO 8 shows "Show what was done about ERP changes (1)"; applying a change was not exercised.
* Goods-arrived reminders and PI "Fetch from ERP" with real data: the ERP views `po_receipt_line` / `po_invoice` do not exist, so only the "not available" path was testable (it works).
* Head-office **Undo** of a "Not tracked" rule: the server does not return `map_id` yet (known limit in the frontend report), so only the operator path was seen.
* Physical printing (`window.print` stubbed), QR image decoding (target read from the server function), real handheld scanners (typing + Enter), slow networks.
* Concurrency only on one local stack: requests launched in the same tick from one machine; multi-process production timing not measured. The "process dies after commit" idempotency edge (key stays 409 for 24 h) was not provoked.
* Out-of-scope P3-8, P3-10, P3-16 not re-tested.

## 8. Data created in the UAT copy

Group "Store Fixtures" (Gondola, Chair, Air Conditioner, Shopping Basket); Items Gondola Rack, Office Chair, Split AC 1.5 Ton (inline), UAT Desktop Set; vendor ABC Traders UAT (inline); store UZT (+ STK-UZT, INS-UZT), store RTG9GP (generic API, + rooms), stock room "UAT Ambala Warehouse Stock", install point "UAT HO Server Room"; employee UATSELF (password changed); companies UAT-RT (UATRT) and UAT-RT2 (UATRT2); POs 20–31 (incl. ERP SPO/003532/25-26, SPO/005013/26-27, SPO/012247/26-27, GPO/001426/26-27); ≈ 200 assets (chairs, laptops, gondolas, ACs, mic, 3 HOPBOX ADAPTOR); item_map rules 15 (FA_CE_UPS → UPS SMALL) and 16 (CT177292 not tracked); 1 chair scrapped, 3 under repair, 20 at store UZT.
