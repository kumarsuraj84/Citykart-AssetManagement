# CKAM Simplification — Stage S7 end-user UAT report

| | |
|---|---|
| Date | 2026-10-13 |
| Code under test | worktree `ckam-build`, HEAD `c656f33` (feat(web): S5b-2 …) |
| Environment | throw-away UAT copy: web `http://localhost:3311`, api `http://localhost:8100`, docker project `ckam-uat` (copy of the dev DB; 2 active companies CKSPL id 2 / CKVPL id 3; ERP copy of both companies). A second agent ran the permanent e2e suite on the same stack at the same time (E2E-* companies, SEEDADMIN logins); their data shows up for the head-office admin and is ignored below. |
| Method | Real Chromium (Playwright, headless) driven as each persona, with an action counter (clicks, typed fields, dropdown selections, behaviour keys, distinct routes, wall-clock, app-wait time, visible alerts). Read-only SQL in `ckam-uat` for integrity. Business data was created only through the UI (and a few refused API probes as the personas). No file under `frontend/` or `backend/` was changed; no git command was used for changes. |
| Scripts / raw output | `…/scratchpad/uat-s7/` (`lib.mjs` = recorder, `j_*.mjs` = journeys, `visual.mjs`, `regress*.mjs`, `break.mjs`, `j_sec_*.mjs`, `integrity.sql`; raw rows in `journeys.jsonl`, `perf.jsonl`, `visual.jsonl`, `security.jsonl`, `regress.jsonl`, `break.jsonl`, `integrity_out.txt`; all screenshots in `shots/`) |
| Evidence kept in repo | `docs/ai/s7-screens/` (20 PNG, each < 200 KB) |

**Counting rule** (same as the journeys doc): a button/tick/link = 1 click; a dropdown pick = 2 clicks + 1 selection (+1 typed field when the picker's search box was used); a whole paste into one box = 1 typed field. "Human est." = 1.2 s per click/key + 3 s per typed field + 1 s per selection + measured app wait (KLM-style); scanning N serials adds ~3 s each.

## 1. Personas

| Login | Role shown in the header | Work area | Notes |
|---|---|---|---|
| UATOWNER | Head-office Admin (Primary Owner) | IT and Non-IT | all companies (incl. the e2e ones) |
| UATADMIN | Full Admin | both | ordinary ADMIN, company CKSPL |
| UATIT | Can Add & Move Assets | IT Team | |
| UATNONIT | Can Add & Move Assets | Admin / Non-IT Team | |
| UATPO | Can Add & Move Assets | Both (purchase/delivery user) | |
| UATVIEW | View Only | both | |
| **UATSELF** (created in this UAT) | Own Assets Only | – | made by UATOWNER: People & Places › Employees › Add Employee (Can sign in, Own Assets Only; 7 clicks, 3 typed, 2 selections) → ticked → "Issue login passwords…" (5 clicks; result shown once with Copy all / Download CSV) → first sign-in with the temporary password → forced "Set a new password" (3 fields) → lands on My Assets. Worked first time. |

No persona was locked during the run (`failed_login_count` 0 for all).

## 2. Journey metrics (before = audit, target = design, measured = this UAT)

| # | Journey (persona) | Before | Target | Measured: screens · clicks · typed · selections · keys | Time (automated / human est.) | Verdict |
|---|---|---|---|---|---|---|
| A | ERP PO fully mapped: PO › Pick from ERP › Review › Create (UATPO, SPO/012897/26-27) | 3 scr, 3 clk, 0 typed | 2 · 3 · 0 | **2 · 3 · 1 (search) · 0** | 4.1 s / ~8 s | EXCELLENT |
| B | ERP PO, 1 unmapped Item, "Use suggestion" (UATPO, SPO/003532/25-26, Harshit) | 3 · 6 · 0, 1 dead end | 2 · 6 · 0, 0 dead ends | **2 · 4 · 1 · 0**, 0 dead ends ("Created: 2 lines, 4 units waiting", 1 line left out as not tracked) | 4.9 s / ~10 s | EXCELLENT |
| C | ERP PO of an unmatched vendor: listed ("Vendor needs matching"), link to suggestion in the review (UATPO, SPO/005013/26-27 ARIHANT) | PO invisible, 4 scr, ~8 clk | 2 · 3 · 0 | **2 · 4 · 1 · 0** | 5.1 s / ~10 s | EXCELLENT |
| C2 | ERP PO: create the vendor + "+ New Item" (Non-IT, No serial) inside the review (UATPO, SPO/015138/26-27, 500 baskets) | dead end | in-flow | **2 · 10 · 3 · 2** — PO created, 500 units waiting | 7.4 s / ~30 s | ACCEPTABLE |
| D | Manual PO, one screen: vendor ABC created inline, 10 laptops + 5 ACs (AC Item created inline in Non-IT), Save (UATPO) | 2 scr, ~24 clk, ~18 typed, 3 dead ends | 1 scr, ~12 clk, ~9 typed, < 3 min | **1 entry screen · 17 · 11 (incl. 2 picker searches) · 6 · 2** (2 keys = clearing a search that hid "New Vendor…/New Item…", defect P2-1) | 9.4 s / **67 s** (≈ 2 min with real reading) | ACCEPTABLE (time met, clicks +5) |
| E | Receive 10 serialised laptops, serials pasted (UATPO, PO UAT-D-TXZPT line 1) | PO page + dialog, ~14 clk, 4 + 10 serials | Receive screen, ~8 clk, 3 + 10 serials, < 5 min | **2 · 2 · 4 (inv no, amount, line-2 qty 0, 1 serial box)** | 4.3 s / 17 s + 10 scans ≈ **50 s** | EXCELLENT |
| F | Receive 50 NON-serial chairs in ONE receipt (UATNONIT) | ~53 clk (UNUSABLE) | 1 scr, ~5 clk, 3 typed | **2 · 2 · 2 (inv no, amount) · 0 quantity entries** (default = all waiting); 0 checkboxes / unit rows on screen | 3.3 s / **11 s** | EXCELLENT |
| G | 10 serial-later units: receive (UATIT) + bulk serials on Serial Pending from the Home row | 2 scr, ~24 clk, 14 typed | 2 scr, ~12 clk, 14 typed | **3 · 5 · 3 + 1 paste of 10** (receive 2 clk; Serial Pending: Select all, paste, Save 10 serials; `PUT /assets/serials` 13 ms) | 6.9 s / ~25 s | EXCELLENT |
| H(rcv) | 100-unit mixed PO, 3 lines (30 laptops with serials, 50 chairs, 20 gondolas) (UATPO) | 104 unit rows | never ~100 rows | **2 · 2 · 3 + 1 paste**; 0 unit rows rendered; API 101 ms | 4.3 s / ~14 s + scans | EXCELLENT |
| Part. | Partial receipt 30 of 50 (UATNONIT) | – | remainder waiting, "Partly Received" | 2 · 2 · 3; "20 units still waiting"; list shows **Partly Received** 50/30/20 | 3.3 s | PASS |
| I/H | Add 20 identical assets, one batch (UATNONIT, Office Chair) | 20 forms, ~200 clk, ~180 typed | 1 form, ~14 clk, ~10 typed | **1 · 8 · 2 · 3** ("20 assets created", codes CKAM131–150, labels offered) | 2.9 s / **20 s** | EXCELLENT |
| I2 | Add 10 serial laptops with pasted serials (UATIT) | – | – | 1 · 9 · 3 · 3 | 4.1 s / 24 s | EXCELLENT |
| I3 | Add 5 serial-later assets (UATIT) | – | – | 1 · 8 · 2 · 3 (→ Serial Pending) | 2.9 s / 20 s | EXCELLENT |
| I(mv) | Move 20 chairs to a store via "Add by Item" (Take N of Item from Stock Room) (UATNONIT) | ~24 clk, 20 typed | ~8 clk | **1 · 10 · 3 · 3** (API 35 ms) | 5.2 s / 26 s | ACCEPTABLE |
| J | Create vendor — Settings › Vendors (UATOWNER) | 4 clk, 6 typed | 4 clk, 2 typed, < 1 min | **1 · 2 · 2 · 0** (code generated) | 2.2 s / 9 s | EXCELLENT |
| J' | Create vendor inline on a PO (UATPO, in D) | operator dead end | 3 clk inline | 2 clk + 1 typed (+1 key to clear the search, P2-1) | – | ACCEPTABLE |
| K | Asset group (Non-IT) + Sub-category + Item in Settings (UATOWNER) | ~8 clk, 3 of 8 fields | ~6 clk, 2 fields, < 1 min | group **4 · 1 · 1**; sub-category **2 · 1**; Item **5 · 2 · 1** | 2.0 / 1.2 / 2.4 s | EXCELLENT |
| K' | Item inline (+ New Item) on a PO line, IT (UATIT) and Non-IT (UATPO) | dead end | in-flow | 4 clk + 2 typed + 1 selection | – | EXCELLENT |
| L | Employee with login (UATOWNER) / Store with its rooms / Stock Room with a new place / Install Point (UATADMIN) | ~9 clk, 5 typed; store = 3 records ~26 clk | ~6 clk, 3 typed | employee **7 · 3 · 2**; store **4 · 3 · 1** (STK-/INS- rooms made; repeat says "already existed. Nothing new was added."); stock room **6 · 3 · 2**; install point **6 · 3 · 2** | 2.4–3.4 s each | EXCELLENT |
| M | Find an asset by serial, asset code, code tail, ERP code, Item, PO number, vendor, employee code/name, store, invoice (UATPO, Home › Find Asset) | 2 clk, by Item/ERP code impossible | 1 box, < 30 s | **1 · 1 · 0** for every kind; result 650–680 ms after typing (300 ms debounce + 14–18 ms API) | < 1 s | EXCELLENT |
| N | Set up CKAM for a NEW company UAT-NEW2 (company, stock room + new place, cost centre, group + sub + Item, vendor, person, code format) (UATOWNER) | 10 scr, ~70 clk, ~41 typed | 1 wizard, ~40 clk, ~28 typed | **1 wizard · 37 · 16 · 6**; first 3 assets in the new company then added: codes `FA/UATNEW2/UATNEW2E/FAN/CKAM1..3` | 25 s / ~110 s | ACCEPTABLE (numbers met, but progress is not per company — P2-3) |
| O | Non-IT: PO 20 gondolas → receive into WH Farukhnagar → send 10 to Store UZT → install 5 at its install point (UATNONIT) | ≈12 scr, ≈80 clk, ≈55 typed, 3 holders per store | ≈5 scr, ≈35 clk, ≈25 typed, 0 manual holders | **5 · 35 · 13 · 9**; store's rooms auto-made; DB: 5 INSTALLED at INS-UZT, 5 ALLOTTED to UZT, 10 in stock | 19.5 s / ~2 min | EXCELLENT |
| P | IT: receive laptop → HO stock → give to employee (with gate-pass ref) → return → reassign (UATIT) | 4 scr, ≈45 clk, 25 typed | 3 scr, ≈28 clk, 14 typed | **3 · 18 · 10 · 3 · 3** (receive 2/4 + give 6/3 + return 5/1 + reassign 5/2); employee must pre-exist (P2-7) | 15 s / ~60 s | EXCELLENT |
| R | Send for repair / back from repair / report lost / mark found (admin) / sell / scrap (scan, UATNONIT/UATADMIN) | scattered | same Move screen | 2–5 clk, 1 scan each; DB statuses correct | 1.2–3.3 s | PASS (no confirmation on Sell/Scrap — P2-8) |
| Nav | Sidebar + guards for 7 personas | – | §4 menus | see §3 | – | PASS |
| Home | Home per role | – | quick actions, needs-attention, < 2 s | network-idle 0.56–0.73 s; no raw enums; status counts as one small line | – | ACCEPTABLE (ERP rows missing — P1-1) |

**Headline numbers:** 50 non-serial units = **2 clicks + 2 typed fields** (was ~53 clicks) · 10 serial laptops = **2 clicks + 4 fields incl. one serial box, ≈ 50 s with scanning** (target < 5 min) · manual PO (2 lines, vendor + Item created inline) = **17 clicks, 11 typed, 6 selections, ≈ 67 s** (target < 3 min) · Add 20 identical assets = **8 clicks, 2 typed, 3 selections, ≈ 20 s** (was ~200 clicks).

## 3. Navigation and route guards

Sidebar as rendered (exact words):

| Persona | Sidebar | Designed (IA §4) | Match |
|---|---|---|---|
| UATOWNER | Home · WORK: Assets, Purchase Orders, Receive, Move · PEOPLE & PLACES: Employees, Stores, Stock Rooms, Install Points · Reports · Settings (collapsible: All Settings, Set up, Organisation, Items, Link Assets to Items, Asset Groups, Brands, Vendors, Users & Access, ERP Inbox/Mapping/Sync, Custom Fields, Asset Code Format, Bulk Import) | everything + Settings | yes |
| UATADMIN | Home · Assets, Purchase Orders, Receive, Move · Employees, Stores, Stock Rooms, Install Points · Reports | + People & Places + **Users & access** | yes, except "Users & access" (Settings-only; logins are managed on People & Places) — P3 |
| UATIT / UATNONIT / UATPO | Home · Assets, Purchase Orders, Receive, Move · Reports | operator: Home, Assets, PO, Receive, Move, Reports | yes (purchase user sees the same 6, by design "menu identical") |
| UATVIEW | Home · Assets · Reports | Home · Assets · Reports | yes |
| UATSELF | My Assets | My assets | yes |

Guards (every one showed "You don't have access to this area. If you need it for your work, ask the head-office admin." with 0 inputs and 0 action buttons; no failing API calls):

| Persona | Addresses tried | Result |
|---|---|---|
| UATIT | /settings, /settings/organisation, /import (→ /settings/advanced/import), /people/employees, /settings/advanced/code-format, /settings/erp/inbox | all guarded |
| UATNONIT | /settings, /people/employees | guarded |
| UATPO | /settings, /people/stores, /settings/erp/inbox | guarded |
| UATVIEW | /assets/new, /purchase-orders, /purchase-orders/new, /receive, /asset-movement, /serial-pending, /people/employees, /settings | guarded |
| UATADMIN | /settings, /settings/advanced/code-format, /settings/organisation, /import, /settings/erp/inbox | guarded; /people/employees opens (designed) |
| UATSELF | /assets, /dashboard, /purchase-orders, /receive, /settings, /people/employees, /reports, /assets/new | guarded ("Go to My Assets"); /dashboard could simply redirect to My Assets (P3) |

Home per role: quick actions — owner/admin/operators "Create PO · Receive Delivery · Add Assets · Move Assets · Find Asset", viewer "Find Asset" only. Needs attention rows seen: "N purchase orders waiting for goods (N units) → Receive", "N assets waiting for a serial number → Add serials", "N assets have no Item yet → Link to Items" (admins), and only for UATNONIT "560 ERP purchase orders need your input… → Review". The ERP rows and the head-office "ERP Inbox" row are missing for everyone else — see P1-1.

## 4. Performance (UATPO/UATNONIT/UATIT, real browser, local stack)

| Operation | Units | API time | UI time (click → result rendered) | Rows rendered |
|---|---|---|---|---|
| Receive (ERP PO, non-serial) | 1 | 33 ms | ≈ 290 ms | 0 unit rows |
| Receive 10 serial (pasted) | 10 | 34 ms | ≈ 290 ms | 0 |
| Receive 10 serial-later | 10 | 38 ms | ≈ 285 ms | 0 |
| Receive 20 / 30 / 50 non-serial | 20 / 30 / 50 | 35 / 34 / 42 ms | ≈ 290–300 ms | 0 |
| Receive 100 mixed (3 lines, 30 serials) | 100 | **101 ms** | ≈ 295 ms | 0 (3 line cards + 1 serial box) |
| Add Assets batch | 20 / 10 / 1,000 | 20 / 21 / **200 ms** | 299 / 278 / 238 ms | result shows the first codes only |
| Move bulk-action | 1 / 10 / 20 | 9–11 / 35 / 35 ms | ≈ 1.0 s (incl. result) | – |
| Bulk serials (Serial Pending) | 10 | 13 ms | – | – |
| Register search | – | 14–18 ms | 650–680 ms (incl. 300 ms debounce) | ≤ 50 rows/page |
| Pick from ERP list | 565 POs | 87–197 ms | – | all 565 rows on one page |
| ERP Inbox | 130 items, 80 vendors, 212 stores | 153 ms | ≈ 800 ms | one 33,000-px page (P2-5) |
| Home (`/home/attention` + `/reports/dashboard` [+ `/setup/status`]) | – | 80–200 ms | network-idle 0.56–0.73 s | – |
| Create ERP PO (`/erp/pos/create`) | 1–500 units | 71–148 ms | – | – |

Every screen in the visual sweep reached network-idle in ≈ 0.55 s (+ fixed 0.7 s settle in the script).

## 5. Visual matrix (UATOWNER, 4 viewports, `visual.jsonl`)

H = horizontal page overflow (`scrollWidth > innerWidth`); P = primary action visible without scrolling (S = sticky footer); E = console errors / failed API calls.

| Screen | 1366×768 | 1920×1080 | 768×1024 | 390×844 | Notes |
|---|---|---|---|---|---|
| Home | P ok | P ok | **H 840** | **H 576** | Recent changes table pushes the page wider (P2-4) |
| Assets | ok | ok | ok | ok | 56 small (< 24 px) tap targets (row checkboxes); Item and Description columns repeat the same text (P3) |
| Add Assets | P S | P S | P S | P S | Good: sticky "Add N assets" with "Why can't I add?" |
| Asset 360 | P ok | ok | ok | ok | "Warranty 0 years · until today" (P3); procured time 05:30 (P3) |
| Purchase Orders | P ok, **E** | E | E | E | every PO list/detail load: `503 GET /api/erp/reminders` in console (P1-1) |
| Manual PO | P ok | ok | ok | **H 482** | lines table cut at Unit Cost; Tax/Amount off-screen on a phone (P2-4) |
| ERP PO review | P below fold @1083 | ok | below fold | below fold | Create button at the end of the review; fine for 1–3 lines |
| Receive | P S | P S | P S | P S | Good: sticky footer + "Why can't I receive?" |
| Move | P below fold, **scan box ~25 px wide** | ok | below fold | below fold | P2-2 (squeezed scan field) |
| Employees / Stores / Stock Rooms | P ok | ok | ok | ok | Add Employee dialog at 390: submit hidden until the dialog is scrolled |
| Items / Vendors | ok | ok | ok | ok | |
| ERP Inbox | 33,772 px tall | 30,500 | 52,856 | **H 435**, 73,724 px | P2-5 |
| Settings landing | ok | ok | ok | ok | |
| Reports | P ok | ok | ok | below fold | |

Kept evidence: `vis_home@1366.png`, `vis_home@390.png`, `vis_manual-po@390.png`, `vis_modal_add_employee@390.png`, `vis_move@1366.png`, `vis_erp-po-review@1366.png`.
Design quality otherwise good: one heading per page, plain words, "Why can't I …?" explanations next to disabled primary buttons, consistent dialogs, no raw enums on Home, Asset 360 or lists.

## 6. Labels

* One shared print dialog everywhere: "Print N label(s) — One label per asset, at the size below. Only the labels print." with the **Label settings** disclosure ("Barcode + QR · 70 × 20 mm" → Label Contains / Label Size). Seen from **Asset 360** (Print Label), **Register selection** ("3 selected · Print labels (3) · Move (3)"), **Receive result** ("Print labels (2)") — each called `window.print` once. **Move** has "Print labels as I scan" + the same Label settings, and "Print Labels" opens the `/print-labels` queue page (kept as a page). Only one label UI exists.
* QR: the label's QR PNG encodes `<base>/assets/<id>` (`_asset_detail_url(343)`); `/assets/343` opens Asset 360 for a signed-in user. In this UAT copy the base is `http://localhost:3211` (the dev port, an env setting of the UAT stack — P3, environment).

## 7. ERP Inbox, mapping, Link assets, groups, sets (UATOWNER unless noted)

| Check | Result |
|---|---|
| Counts | "131 new items · 80 new vendors · 212 new stores" (API 153 ms) |
| Group item with suggestion (FA_CE_DOCUMENT PRINTER → DOCUMENT PRINTER) | 1 click; "Every code of the Article … is now DOCUMENT PRINTER"; rule saved (item_map 16, created_by UATOWNER) |
| Suggestion quality | **wrong at "100% match"**: GANG BOX PVC 4X4 (FA_CE_CAMERA PVC BOX) → "AI BOX (100%)"; R-51 HOP BOX (FA_CE_HOPBOX) → "AI BOX (100%)" although Item HOPBOX exists — P1-3 |
| Vendor group: "Link to … (same name)" | 1 click, "Linked 1 ERP supplier to UNMUKTI TECHNOLOGY PVT LTD" |
| Vendor group: "Create new vendor (links all 10)" (Godrej & Boyce, 10 GST registrations) | 1 click; vendors 79 → 78 |
| Stores: "Create stores…" → Untick all → tick LAM, PTS → "Create 2 stores" | 5 clicks; "2 already created" afterwards; rooms made |
| Settings › ERP › Advanced mapping (`/settings/erp/mapping`) | reachable, Codes/Articles/Groups… working list (863 codes) |
| Not tracked in the PO review (UATPO, cash roll, SPO/014402/26-27) | 1 click; scopes offered: This ERP code only / This product name / **Every code in this ERP group (default)**; saved a company-wide ARTICLE rule (item_map 17, created_by UATPO) with no confirmation (P2-9). The PO then says "keep at least one line CKAM tracks" and stays in the list. |
| Link existing assets to Items (from Home row) | "Use X" ×3 → "Review and link 3" → confirm dialog → "Linked 3 assets to their Items"; 63 → 60; `asset_field_change` rows `item_id: → MOUSE_WIRED (#37)` with actor UATOWNER |
| Asset Groups | nested screen; Add Group (work area "IT Team / Admin / Non-IT Team"), "+ Sub-category" in the group, codes suggested (SF, GONDOL, CHAIR, AC, SB); deactivate with a confirmation |
| Item "Comes as a set" | "UAT Desktop Set" with **Use the Desktop example** (CPU/TFT/Keyboard/Mouse, 100 %) — the example does not pre-pick the part Items (4 extra picks, P3) → saved in one call; ordered **2 sets** on a manual PO via **Add set** (Set, Quantity, Price per set) → "PO created: 4 lines, 8 units waiting", price split per part (42,000 / 15,600 / 1,200 / …) |

## 8. Security and scope (API probes as the personas + UI)

All refusals below created nothing (re-checked in SQL).

| Check | Result |
|---|---|
| UATIT sees only IT lines of mixed PO 22 (receive-info, PO detail, units) | PASS (LAPTOP only; units → 404) |
| UATIT receiving the Non-IT line 2 | PASS 403 "Line 2: This is Non-IT work, which is outside your work area. …" |
| UATIT POST /items in a Non-IT group | PASS 403 "This belongs to the Admin / Non-IT team; you can only work with IT items. …" — and the UI does not even offer Non-IT types in "+ New Item" |
| UATNONIT mirror (IT Item) | PASS 403; but the PO line Item picker still lists 61 IT Items, refused only on Save (P2-6, `SEC_nonit_it_line_refused.png`) |
| UATIT reading / moving a Non-IT asset | PASS (404; bulk-action → failed "not found") |
| UATPO creating a category | PASS 403 |
| UATADMIN reset password / issue password for the head-office admin | PASS 403 "Only a head-office admin can change a head-office admin account." / issue-passwords returns [] ; Employees row shows "Head-office admin only" |
| UATADMIN code rule POST/PUT, company, custom field | PASS 403 "Only the head-office admin can do this." |
| UATADMIN creating an asset **category** | **201 created** — allowed by the S6 "domain-owned category" rule (`can_create.category: true` for ADMIN) but contrary to Operating Model §8 ("category … stay with the head-office admin"); the e2e leftovers "Should Never Be Created" (code SHOULD-FAIL-*) were created the same way by an ordinary ADMIN. Decision to confirm (P3 / product). Test category deactivated afterwards via the UI. |
| Operator in-flow small masters (vendor, cost centre, brand, Item, stock room) | PASS (201) |
| Viewer | no action buttons on Assets / Asset 360 / Reports (only "Download Excel"); bulk-action and PO create 403 |
| Self-service | `/assets` returns only the own laptop; another asset 404; PO / people / movements / home 403; **`/reports/assets/preview` and `/reports/export/assets` answer 200** (scoped to the own asset — no leak, but inconsistent with the UI guard and with movements → P3) |

## 9. Regression sweep (existing capabilities)

| Capability | Result |
|---|---|
| ERP change reconciliation card on a PO | not testable: the ERP copy has no changes (`/erp/changes/summary` = []) |
| PI record (manual PO 22, "Type it in") | PASS "PI PI-UAT-0001 · 2026-10-13" |
| PI "Fetch from ERP" (ERP PO 13) | calm message, but technical: "The ERP view this screen reads does not exist yet." (ERP `po_invoice` view not created — P3 wording) |
| ERP sync status + Refresh now (`/settings/erp/sync`) | Refresh ran (manual sync success in 5.6 s, `/erp/sync` last = manual) but the page shows no confirmation — the "data as of" line is unchanged and nothing says "checked just now" (P3) |
| Bundles (`/setup/bundles`) | PASS, lists UAT Desktop Set |
| Not Tracked | PASS (see §7) |
| Bulk Import (assets, add mode) | template download PASS (22 columns); tiny xlsx built with openpyxl in the api container: preview → "Vendor Code is required" (optional on Add Assets) → with a code: "1 row ready" → Commit → "Imported 2 assets". Imported assets have **no Item** (no Item column) — P2-10 |
| Export / Reports | preview with filters + summary ("585 assets match", by status, groups) PASS; Download Excel `asset_register.xlsx` 57 KB in 268 ms |
| Custom field (required, Global) | created "UAT Gate Pass No"; Receive shows it and blocks: "Why can't I receive? UAT Gate Pass No is needed for every asset received."; filled → received; Add Assets also asks it; then **deactivated via the UI** |
| Documents upload on Asset 360 | PASS (uat-doc.pdf listed, Download link) |
| Serial Pending | PASS (bulk 10) |
| QR | see §6 |
| Asset correction | Asset 360 › More actions › Correct Classification dialog (Category / Sub-category / Purchase Date / Reason*) opens — not committed |
| Company access dialog | opens from the Employees row ("Company access for UAT Purchase Operator") — lists all companies incl. e2e ones |
| Self-service My Assets | PASS — shows FA/CKSPL/ITHW/LAPTOP/CKAM1 "With Employee 2026-10-13" |
| Settings pages | all 18 addresses load with their heading and no errors: landing, Organisation (4 tabs), Asset Groups, Items, Brands, Vendors, Users & Access, ERP Mapping, ERP Data Sync, Custom Fields, Asset Code Format, Bulk Import, Print Labels, Serial Pending, Bundles |
| Cancel waiting items (duplicate PO 21) | PASS, but the cancelled PO then shows "Ordered 0 · Value 0.00" and still offers "Receive all waiting" (P3) |

## 10. Data integrity (read-only SQL, `integrity.sql` → `integrity_out.txt`)

| # | Check | Result |
|---|---|---|
| I1 | ordered = received + waiting + cancelled for every UAT PO (13 POs incl. 13/14/15 ERP, 21/22 duplicate, 26–30, 32–35) | **PASS** (e.g. 28: 50 = 33 + 17 + 0; 22: 15 = 12 + 3) |
| I2 | delivered units without `delivered_asset_id` / waiting units with an asset | **PASS** 0 / 0 |
| I3 | 226 assets from UAT receipts: Item, vendor = PO vendor, PO number, invoice no/date/amount, cost centre, company, work area | **PASS** all 0 missing |
| I4 | current holder vs status (ALLOTTED→EMPLOYEE/STORE, INSTALLED→install point, IN_STOCK/SOLD/SCRAPPED/UNDER_REPAIR→stock room) | **PASS** |
| I5 | exactly one PROCURED event per asset created today, to-name snapshotted | **PASS** — the 7 exceptions are IMPORTED assets (2 mine, 5 e2e), by design |
| I5b | assets without any event | **PASS** 0 |
| I6 | serial uniqueness (case/trim-insensitive, excl. N/A) | **PASS** 0 duplicates (DB index + UI) |
| I7 | asset code uniqueness | **PASS** |
| I8 | gap-free numbering per prefix | **PASS** — e.g. `FA/CKSPL/SF/CHAIR/CKAM` 1…1163 (1,163 codes, no gap), LAPTOP 1…50, GONDOL 1…40, new company FAN 1…3 |
| I9 | orphans (asset → item / holder / vendor), units without `line_no` | **PASS** all 0 |
| I10 | asset work area = its Item's group work area; = its own category | **PASS** 0 / 0 |
| I11 | item_map rules made today carry `created_by` | **PASS** (UATPO 15, 17; UATOWNER 16) |
| I12 | master_audit for edits made | **PASS** item 132 name "Gondola Rack → Gondola Rack 4ft"; category 91 active yes → no (both UATOWNER) |
| I13 | duplicates from double submits | **FAIL** — 2 active POs "UAT-D-TXZPT" in company 2; asset CHAIR/CKAM40 has PROCURED, SENT_FOR_REPAIR, **SENT_FOR_REPAIR** (0.5 ms apart); 4 chairs instead of 2 from one Add (P1-2) |
| I14 | no hard deletes | **PASS** — counts only grew (assets 1,598, events 1,924, POs 34, units 867, items 200, vendors 87, people 296, item_map 16, field changes 78, master_audit 351); 0 soft-deleted assets |
| I15 | bulk serial order | first pasted serial went to the **first row shown** (CKAM10, the list is newest-first) — as the screen says, but against the user's likely expectation (P3) |
| I17 | ERP-made asset fields (PO 13) | erp_item_code/barcode CT324973, vendor set — but Item = "mic", brand AHUJA, description "DELL DESKTOP REFURB/i3…" (pre-existing code rule from the dev data; invisible in the collapsed review line, P2-11) |

## 11. Defect register

Severity: P0 blocks daily work / breaks security or integrity · P1 daily-work friction or wrong behaviour · P2 meaningful usability · P3 polish. **No P0 found.**

### P1

| ID | Defect | Repro (persona · URL · steps) | Expected | Actual | Evidence | Likely area |
|---|---|---|---|---|---|---|
| P1-1 | **Home loses every ERP row (ERP POs needing input, ERP-changed POs, goods arrived, head-office ERP Inbox row) for anyone whose scope contains an ERP-made PO**; every PO list/detail logs a 503. | UATOWNER/UATPO/UATIT · `/dashboard` · open Home. Compare UATNONIT (no ERP POs in scope) who does see "560 ERP purchase orders need your input". | ERP rows shown; a missing receipts view only hides the "goods arrived" row | `/api/home/attention` → `erp_available:false`; `/api/erp/reminders` → 503 "The ERP view this screen reads does not exist yet." (`gold_ckam.po_receipt_line` — per ERP_INTEGRATION.md not created in production either) | `j01_out.txt`, `api_probe` output, `visual.jsonl` (E column) | `backend/app/home/service.py::_erp_figures` (one try around three reads); `erp/reminders.py`; PO pages calling `/erp/reminders` unconditionally |
| P1-2 | **Near-simultaneous double submit writes duplicates**: two POs with the same number, two asset batches, two ledger events on one asset. A human double-click (≥ 80 ms apart, even with 400 ms simulated latency) was safe because the button re-renders; a < 20 ms double activation (double-tap, bouncing key, two tabs, client retry) is not. | UATPO `/purchase-orders/new` (fill, double-click "Save PO"); UATNONIT `/assets/new` (qty 2, double-click "Add 2 assets"); `/asset-movement` Send for Repair (double-click) | one record; second request refused (unique PO number per company, idempotency, state check under row lock) | PO ids 21 + 22 both "UAT-D-TXZPT"; 1,004 chairs instead of 1,002; CHAIR/CKAM40 SENT_FOR_REPAIR ×2 in the append-only ledger (state machine accepted UNDER_REPAIR → UNDER_REPAIR) | `j_d_out.txt`, `break_out.txt`, `integrity_out.txt` I13 | no unique index on `purchase_order(company_id, po_number)` (check is app-level); `/assets/batch`; `lifecycle/service.apply_event(s)` without `SELECT … FOR UPDATE`; submit handlers without an in-flight guard |
| P1-3 | **ERP item suggestions claim "100% match" for the wrong Item**, and one click saves a permanent group-wide rule (also offered to operators in the PO review). | UATOWNER `/settings/erp/inbox` → group FA_CE_CAMERA PVC BOX (GANG BOX PVC 4X4) and FA_CE_HOPBOX (R-51 HOP BOX) | HOPBOX / no confident suggestion | "Suggested: AI BOX (100% match)" for both | `ERP_inbox_owner.png`, `j_inbox_out.txt` | suggestion scoring in `backend/app/erp/inbox.py` / item matching (token "BOX" dominates) |

### P2

| ID | Defect | Repro | Expected → Actual | Evidence | Area |
|---|---|---|---|---|---|
| P2-1 | Typing a name that does not exist in any searchable picker hides "New Vendor… / New Item… / New Cost Centre… / New Stock Room…" ("No results found."); the New dialog also does not take the typed text. | UATPO `/purchase-orders/new` → Vendor → type "ABC" | "+ New Vendor "ABC"" offered → dead end until the search is cleared | `D_search_nomatch_vendor.png` | `components/shared/SearchableSelect.tsx` (+ quick-create prefill) |
| P2-2 | Move screen: the main "Scan or type…" input is squeezed to ~25 px at 1366 px (label wraps to 4 lines) because the Qty helper text takes the row; three ways to add assets (scan+Qty, Add by Item, Currently With) compete on one screen; the apply button is below the fold. | any operator `/asset-movement` at 1366×768 | full-width scan box first → tiny box | `vis_move@1366.png` | `features/assets/AssetMovement.tsx` |
| P2-3 | Set up CKAM progress is global, not per company: a brand-new company shows "7 of 7 done" (no Home "finish setting up" row) though it has no stock room / cost centre; step 7 is the single global code rule and its example ("FA/HO01/IT/LAP/CKAM1") is not the new company's; "Finish" stays on step 7. | UATOWNER `/settings/setup` after adding company UAT-NEW2 | per-company steps → always done | `N-setup-wizard_UATOWNER.png`, `j_n_out2.txt` | `home/service.setup_status`, `features/settings/SetupWizard.tsx` |
| P2-4 | Small screens: Home "Recent changes" overflows the page at 768 (840 px) and 390 (576 px); Manual PO lines table overflows at 390 (Unit Cost/Tax/Amount off-screen); ERP Inbox overflows at 390; Add Employee submit hidden at 390 until the dialog is scrolled. | `/dashboard`, `/purchase-orders/new`, `/settings/erp/inbox`, Add Employee at 390×844 | no page-level horizontal scroll → overflow | `vis_home@390.png`, `vis_manual-po@390.png`, `vis_modal_add_employee@390.png`, `visual.jsonl` | Dashboard table wrapper, PO lines table, inbox buttons, dialog footer not sticky |
| P2-5 | ERP Inbox is one page of 33,000–74,000 px (131 groups + 80 vendors, no paging/collapse); one line lists ~100 PO numbers. | UATOWNER `/settings/erp/inbox` | grouped/paged, "on 100 POs" → endless page | `visual.jsonl`, `ERP_inbox_owner.png` | `features/erp/ErpInbox*` |
| P2-6 | Non-IT operator's PO Item picker lists all 61 IT Items; refused only after Save (good sentence: "Line 1: LAPTOP: This is IT work, which is outside your work area…"). Mirror for IT is already filtered in "+ New Item". | UATNONIT `/purchase-orders/new` → Item | only own-area Items → 67 options, 61 IT | `SEC_nonit_it_line_refused.png` | PO line picker: filter by `capabilities.work_areas` |
| P2-7 | Give to Employee has no inline "+ new employee"; operators cannot open People & Places, so a new joiner blocks the IT hand-over until an admin acts (design P: "employee must pre-exist → inline"). | UATIT `/asset-movement` → Give to Employee → Employee picker | inline add → 7 existing people only | `j_p1_out.txt` | Move target picker |
| P2-8 | Sell / Scrap / Dispose apply on one click with no confirmation (end states). | UATNONIT Move → Sell → scan → "Sell (1 asset)" | confirm "Sell 1 asset? cannot be undone" → applied at once | `R5-sell`, `R6-scrap` rows | `AssetMovement.tsx` |
| P2-9 | "Not tracked" in the PO review defaults to "Every code in this ERP group" and silently saves a company-wide rule from an operator's single click (no confirmation, no undo on screen). | UATPO review SPO/014402/26-27 → Not tracked | confirm + clear scope → item_map 17 by UATPO | `j_not_tracked` output, I11 | `PoDraftCard.tsx` |
| P2-10 | Bulk Import of assets has no Item column (imported assets join the "no Item yet" queue) and requires Vendor Code (optional on Add Assets); template header says "Initial AssetUser Code". | UATOWNER Settings › Advanced › Bulk Import | Item column, same rules as Add Assets → item_id NULL | I16, `REG_import.png` (scratch) | `imports` service/template |
| P2-11 | ERP review collapses matched lines to the Item name only, so a wrong existing rule is invisible: SPO/012897/26-27 shows "mic 11 × 20,000 matched by ERP group" while the ERP line is a refurbished Dell desktop; receiving created Item "mic", brand AHUJA. | UATPO review SPO/012897/26-27 | ERP description visible on matched lines → hidden under Details | `vis_erp-po-review`, I17 | `PoDraftCard.tsx` (matched line summary) |
| P2-12 | Reload in the middle of a manual PO loses everything without a warning (no draft, no beforeunload). | `/purchase-orders/new`, fill, F5 | warn or keep → silently empty | `break_out.txt` | PO form |
| P2-13 | "Send to Store" allots to the store holder, not to the Stock Room that Add Store creates; the store's Stock Room stays empty and "keep 5 in the store stock room" has no obvious action. | UATNONIT Send to Store → UZT | wording/target clarified → ALLOTTED to UZT (STORE) | SQL (Gondola holders) | design of Store vs its rooms |

### P3

| ID | Item | Where |
|---|---|---|
| P3-1 | "ERP data as of" shown twice in two formats on Pick from ERP ("13 Oct 2026, 6:46 pm" and "13-10-2026 06:46 pm") | `/purchase-orders/from-erp` |
| P3-2 | PROCURED events shown at 05:30:00 (date-only stored as UTC midnight) before the real same-day moves; Home "Recent changes" shows the same | Asset 360 history, Home |
| P3-3 | "Warranty 0 years · until <today>" when there is no warranty | Asset 360 |
| P3-4 | Duplicate text: Assets "Item" + "Description" both "Gondola Rack"; Serial Pending prints the Item twice; "With" = "Stock Point - WH Stores Farukhnagar · Stock Room · WH Stores Farukhnagar"; Serial Pending column "Category › Sub-category" (IA word: type of asset); holder names still "Stock Point - …" | Assets, Serial Pending |
| P3-5 | "Mark Found" disabled for operators with the reason only in a hover title; "None of these assets can be: Sell." grammar | Move |
| P3-6 | Refresh now gives no visible confirmation; PI "Fetch from ERP" says "The ERP view this screen reads does not exist yet." | ERP Data Sync, Record PI |
| P3-7 | Cancelled PO shows "Ordered 0 · Value 0.00" (should keep 15 ordered / 15 cancelled) and still shows "Receive all waiting" | PO detail/list |
| P3-8 | GSTIN checksum not validated (07ABCDE1234F1Z9 accepted) | Vendor dialog |
| P3-9 | Self-service gets 200 from `/reports/assets/preview` and `/reports/export/assets` (own asset only); `/dashboard` shows "no access" instead of redirecting to My Assets | reports router, self-service routing |
| P3-10 | Ordinary ADMIN may create asset categories (S6 rule) — contradicts Operating Model §8; confirm the decision | capabilities / masters |
| P3-11 | Desktop example in "Comes as a set" leaves the 4 part Items to pick by hand | Item form |
| P3-12 | Serial Pending lists newest first, so the first pasted serial goes to the last-created asset | Serial Pending |
| P3-13 | Cost Centre not pre-selected on a PO even when the company has only one | Manual PO |
| P3-14 | UAT stack's QR base URL is the dev port 3211 (environment) | UAT `.env` |
| P3-15 | Admin menu lacks "Users & access" (IA §4) — logins handled on People & Places | sidebar |
| P3-16 | ERP PO whose lines are all "Not tracked" stays in "Needs your input" with no way to dismiss | Pick from ERP |

## 12. Could not test / limits

* **ERP change reconciliation card** — no ERP-side change exists in the copy (`/erp/changes/summary` empty).
* **PI Fetch from ERP** and the **"goods arrived" reminders** — the ERP views `po_invoice` / `po_receipt_line` are not created (also the root of P1-1).
* Physical printing (window.print stubbed) and QR image decoding (target URL verified from the server function instead); real handheld scanners (simulated with typing + Enter).
* Store logins (issue password for a store) — done for an employee only; downloaded Excel files were checked by size, not opened.
* Slow-network behaviour only simulated (400 ms injected); production latency/concurrency not measured.
* Concurrent e2e activity changed shared numbers (Home counts, company lists) for the head-office admin; all measured journeys used CKSPL data created in this run.

## 13. Data created in the UAT copy (for whoever resets it)

Company UAT-NEW / UAT-NEW2 (+ their place, stock room, cost centre, group "UAT-NEW(2) Electricals", Items UAT Ceiling Fan(2), vendor, employee); group "Store Fixtures" (Gondola, Chair, Air Conditioner, Shopping Basket); Items Gondola Rack 4ft, Office Chair, Split AC 1.5 Ton, Handheld Scanner Later, Shopping Basket Red, UAT Desktop Set; vendors ABC Traders UAT, UAT Vendor Settings Pvt Ltd, Godrej & Boyce (from ERP), H.K. Accessories (from ERP); employee UATSELF (password changed), store UZT (+STK-UZT, INS-UZT), stores LAM/PTS from ERP, stock room "UAT Ambala Warehouse Stock", install point "UAT HO Server Room"; POs 13–15, 21 (cancelled duplicate), 22, 26–30, 32–35 and SPO/015138/26-27; ≈ 1,550 assets (1,000 chairs in the Ambala stock room); custom field "UAT Gate Pass No" (deactivated); category "SEC admin category" (deactivated).
