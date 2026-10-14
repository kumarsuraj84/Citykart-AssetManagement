# CKAM Simplification — S7 fix round 2 (final small round)

| | |
|---|---|
| Date | 2026-10-14 |
| Starting HEAD | `881e878` (the controller then committed the re-test report as `9738963`, docs only) |
| Source of the work | `CKAM_SIMPLIFICATION_S7_RETEST_REPORT.md` §3: N1 (P2), N2–N5 (P3), plus N1b (Undo in the PO review) |
| Scope | `backend/` then `frontend/` (incl. e2e static strings: none needed) and this report. Nothing committed. No migration. Playwright not run. Production, the dev stack's ports and the `ckam-uat` project untouched (only read-only Python in the `ckam-uat` api container's memory, see §3). |
| Backend | full suite **1,387 passed, 0 failed** (was 1,364) · exactly one Alembic head (`d2e4f6a8b0c2`, unchanged) |
| Frontend | `npx tsc -b` clean · `npx vitest run` **78 files, 1,127 tests, all green** (was 1,114) · `npm run build` OK |

## 1. Per item

### N1 (P2) — wrong suggestions at "Similar name (95%)", one-click group-wide save

**Root cause (verified in `app/items/suggest.py` at 881e878).**
1. Only the Item's words were compared. After the generic words were dropped, CAMERA BOX PVC was just `camera` and CABLE MANAGER just `manager`, so any text with that one word was "every distinctive word found" = 0.95. Words the *text* had and the Item lacked (INDOOR) never counted, nor did the Item's own generic words (BOX, CABLE, STAND) that say what it is.
2. The "a text whose last word is BOX/STAND is a box/stand" rule looked only at the text's last word, never at the Item's: a barcode printer matched BARCODE_PRINTER_STAND (every distinctive word present) and the longer-name tie-break then beat BARCODE PRINTER.
3. Ties were broken by name length (a coin flip): UPS SMALL won over UPS BIG for "UPS(1000 APC VA)", and that is how rule 15 (FA_CE_UPS → UPS SMALL) was saved in the re-test.
4. The ERP inbox scored a group by the best of ALL its texts: one code named OFFICE CHAIR made the group FA_FF_TABLE_OFFICE (a table + a chair) "Office Chair · Same name", and the default reach was the whole Article.
5. ERP code prefixes were words: `FA_IT_*` made "it" generic, so IT RACK was just `rack` (PALLETS in FA_FF_DC RACK → IT RACK 95%).

**Fix — the one shared scorer (`app/items/suggest.py`, used by the PO review, the ERP inbox, the Articles screen and Link assets):**
* ERP texts are cleaned of code prefixes first (`FA_CE_HOPBOX` → `HOPBOX`, `FIXED ASSETS-IT EQUIPMENST-FA_IT_LAPTOP` → `LAPTOP`, `[IT-01]` dropped); Item names never are. `it` is now a real word.
* Three kinds of word: **filler** (with/for, units and sizes mm/inch/kva/tr/gb, ERP prefixes, numbers) count for nothing; **weak** (box, cable, stand, set, small, big, pvc, steel, colours …) never suffice alone but are Item words; **distinctive** = the rest. Words are weighed by rarity among the Item names (as before).
* **(a) both names compared:** `item_cover` = weight of the Item's words found / all its words (an Item that ADDS words scores lower); `text_cover` = weight of the text's distinctive words that some Item uses and this Item covers / all such words (an Item that MISSES words the text has scores lower; brand/model words no Item uses — HIKVISION, GK420T — do not count against). `fit = item_cover × √text_cover`. CAMERA BOX PVC vs INDOOR CAMERA @POE: 0.31 × 0.71 → **0.19 × 0.85 = no suggestion** (INDOOR CAMERA: 1.0 → 0.85).
* **(b)** every non-exact suggestion = `0.85 × fit` (cap 0.85); a fit found only in the ERP group's name/department × 0.9; below 0.6 none (unchanged).
* **(c) "Same name"** only when a PRODUCT name equals the Item name (normalised); an Article/department name never is. An ERP group with **several distinct product names** is judged jointly (`best_for_group`): the mean fit over the distinct names, or the group's own name/department, × 0.9, never "same name". TABLE_OFFICE → **none**.
* **(d)** when the best two Items are within 0.1 → **no suggestion** (UPS SMALL/BIG, GANGBOX vs CAMERA BOX PVC for the gang box filed under "CAMERA PVC BOX", HARDWARE PACKET vs IT RACK for "IT RACK_HARDWARE PACKET").
* The text-side "thing-word" rule (LAPTOP STAND is a stand) and the generic-only last resort ("Cable" at 0.6) are kept.
* **One ERP entry point** `ItemMatcher.for_erp(own_names, group_names, context, reach, product_reach)` returns the suggestion AND the reach it was judged for (new additive field `suggestion_scope`): with a group-wide default reach (ARTICLE) the Item must fit the whole ERP group (the code's name + the names bought in that Article); if no Item fits the whole group, the product's own name is judged and the reach becomes **NAME** (or CODE). So in TABLE_OFFICE the chair line says "Office Chair · Same name" *for its product name only*, the table line nothing, the inbox group nothing.

**Frontend (`ErpInbox.tsx`, `PoDraftCard.tsx`, shared `suggestion-words.ts`):**
* "Use suggestion" asks first when the suggestion is only a similar name OR the reach is a whole ERP group: *"Use Indoor Camera for every code in group FA_CE_CAMERA? This is remembered for everyone."* (NAME: *"… for every code named “R-51 HOP BOX”? …"*, CODE: *"… for the ERP code CT99609? …"*; the review adds *"It is saved when you create the purchase order."*). Cancel saves/chooses nothing. A same-name suggestion at product-name or code reach stays one click.
* The reach used is the person's own "How far"/"Remember" choice if they made one, else the server's `suggestion_scope`, else the default reach. Inbox "Use the suggestions (n)" asks once for all when any of them needs it.

**Tests.** Backend `tests/erp/test_s7_fix2_suggestions.py` (17): the 64 Items of the UAT copy as fixture — INDOOR CAMERA vs CAMERA BOX PVC (and without the INDOOR CAMERA Item: still not the box), HIKVISION dome → none, QUEUE MANAGER / Q MANAGER group vs CABLE MANAGER, BARCODE PRINTER vs BARCODE_PRINTER_STAND (and the stand still found for a stand), TABLE_OFFICE (group none, chair line same name at NAME, table none), GANG BOX never AI BOX and never a coin flip (GANGBOX when no camera-box Item), R-51 HOP BOX → HOPBOX 0.85, exact names 1.0, cap, ties (UPS, HARDWEAR PKT), joint groups (RAM similar < 0.85, mice none, catch-all none), racks/pallets ≠ IT RACK, the right UAT suggestions kept (laptop, HHT scanner, switch, server, document printer, outdoor camera), prefix cleaning, Article name never "same name"; through the API: review and inbox give identical fields for the same code (HOPBOX, INDOOR CAMERA), TABLE_OFFICE review/inbox, Articles screen. Frontend: `suggestion-words.test.ts` (+3), `erp-inbox.test.tsx` (+2, 2 updated: confirm), `PoFromErp.test.tsx` (+3, 2 updated: confirm).

### N2 (P3) — "Same name" in the review, "Similar name (95%)" in the inbox for the same code
**Root cause.** Different texts: the review scored `[article, department, ERP product name, PO line description]` (the PO line of CT99609 says `HOPBOX` → exact → "Same name"), the inbox scored `[article, department, product names]` (`R-51 HOP BOX` → 95%). The review showed the article/product name while claiming "same name" from a text it did not show.
**Fix.** Both call `ItemMatcher.for_erp` with the same inputs: the ERP item master's product name (the PO line's own text only when the ERP has no record — as the inbox already did), the Article name + department as context, the names bought in that Article (`article_names`, the same call in both screens) and the same default reach. Result for CT99609 on both screens: **HOPBOX · Similar name (85%) · reach ARTICLE**. (Line descriptions are no longer scored: in the UAT copy they often contradict the item master — e.g. an APFC panel code's line says "AUTOMATION CAMERA BACKUP DEVICE", a forklift's says "…Camera System…", both were "CAMERA BOX PVC 95%".)
**Tests.** `test_the_po_review_and_the_inbox_give_one_answer_for_one_code` (all six suggestion fields equal).

### N1b — Undo of a "Not tracked" decision in the PO review
**Fix.** `POST /api/erp/pos/{po_code}/not-tracked` now also answers `map_id` (the rule it saved) and `can_undo` (true for the head-office admin, who alone may `DELETE /api/items/maps/{id}`); when the code was already not tracked nothing is saved and both are `null`/`false`. The review shows **Undo** when `map_id` is set and `can_undo` is true (an older server without `can_undo`: head-office admin, as before), otherwise the existing sentence.
**Tests.** `tests/erp/test_s7_fix2_not_tracked_undo.py` (3: owner gets id + can_undo and undoes it, the line comes back; operator gets id, can_undo false, DELETE 403; repeat → nothing to undo). Frontend `PoFromErp.test.tsx` (+1: `can_undo:false` → no Undo even for the head-office admin; the existing head-office Undo test still passes).

### N3 (P3) — Set up CKAM: a company added in step 1 missing from the picker until reload
**Root cause.** The picker reads the capabilities' company list (or `/asset-users/me/companies`); adding a company invalidated only `["masters","companies"]`.
**Fix.** `MasterCrudScreen` gained an optional `onCreated(row)`; `CompaniesSetup` passes it; the wizard adds the new company to the picker at once, **chooses it**, and asks again for `["auth","capabilities"]`, `["asset_users","me","companies"]` and `["masters","companies"]`.
**Tests.** `settings.test.tsx` (+1: new company → "2 of 7 done for UATRT2", `/setup/status?company_id=9`, listed in the picker, companies asked again); one existing test's mock now also answers `/setup/status?company_id=…` (the new company is chosen after it is added).

### N4 (P3) — step 7 "Next Asset Code" the same for every company
**Root cause.** The server's example used fixed sample values for location (`HO`) and cost centre (`CC01`) whatever company was given; only `{company.code}` followed it, and UAT's format does not use it.
**Fix.** `numbering.service.company_example_tokens(session, company_id)`: that company's code, first active location and first active cost centre; the generic sample for anything it does not have (and for the Asset Group / sub-category, shared by all companies). `POST /api/code-rules/preview?company_id=` and `GET /api/code-rules?company_id=` (optional, unknown → 404 "This company was not found."); without the query the preview uses the rule's own `company_id` (as before), a company rule's listed example always uses its own company. Frontend `CodeRuleScreen`: the rule body stays global (`company_id: null`); the example is asked for the guide's company (`exampleCompany`) or, on the plain Asset Code Format screen, the company the person works in.
**Tests.** Backend `tests/numbering/test_s7_fix2_code_example.py` (3: two companies give their own values, inactive cost centre skipped, no company = generic sample, rule company without query, query beats body, brand-new company = code + sample, 404, list follows the company, a viewer may preview). Frontend `CodeRuleScreen.test.tsx` (+2), `settings.test.tsx` (2 expectations moved from body `company_id` to `?company_id=`).

### N5 (P3) — PO "Edit line": Barcode marked required, empty saves anyway
**Fix.** The server never required it (`LineGroupUpdateIn` / `PendingAssetLineUpdateIn`: `barcode: str | None`), so the UI now matches: no required mark, helper "Optional.", no client check; an emptied barcode is sent as `null`.
**Tests.** `PurchaseOrderDetail.test.tsx` (+1).

## 2. API changes (all additive)

| Endpoint | Change |
|---|---|
| `GET /api/erp/pos/{po}/draft` lines, `GET /api/erp/inbox` item groups | new `suggestion_scope` (`ARTICLE` / `NAME` / `CODE` / null): the reach the suggestion was judged for. Scores/reasons follow §1 (non-exact ≤ 0.85). |
| `GET /api/items/articles` | `suggestion_reason_code` added; the Article is judged as a group (several names → never "same name"). |
| `POST /api/erp/pos/{po}/not-tracked` | `map_id` (rule saved, or null) and `can_undo` (bool). |
| `POST /api/code-rules/preview`, `GET /api/code-rules` | optional `?company_id=` (404 if unknown): the example in that company's values. |
| Python | `ItemMatcher.best(texts, items=None, context=None)`, `best_for_group`, `for_erp`; `suggest.clean_erp_text`, `word_kind`; `items.service.suggestion_fields(found, scope)`; `numbering.service.company_example_tokens`; `render_example(..., tokens=)`. |

## 3. Suggestions on the UAT copy, before / after

Method: read-only. `docker compose -p ckam-uat exec -T api python -` with a script piped on stdin: it built the inbox groups exactly as `build_inbox` does (open ERP POs not created yet, undecided codes, the Articles' bought names) and the 64 active Items, and dumped them; the same data was then scored by the container's code (before) and by this round's `suggest.py` loaded **in memory** (after) — no file in the container changed, nothing written to its database. "Inbox" = the group suggestion of `GET /api/erp/inbox`; "review" = the line suggestion of the PO review for each undecided code.

| | Before (881e878) | After |
|---|---|---|
| ERP groups (inbox) | 129 | 129 |
| groups with a suggestion | 29 | **19** |
| … "Same name" | 3 (Office Chair for TABLE_OFFICE, CABLE MANAGER for FA_IT_OTHERS, RAM) | **0** |
| … "Similar name" | 26 (all at 95% but two at 60%) | 19 (85% or 77%) |
| codes (review lines) | 437 | 437 |
| codes with a suggestion | 80 (6 same / 74 similar) | 56 (2 same / 54 similar) |

Ten examples that changed (inbox unless marked "review"):

| ERP group / code | Before | After |
|---|---|---|
| FA_OE_CCTV_INDOOR · INDOOR CAMERA @POE | CAMERA BOX PVC 95% | **INDOOR CAMERA 85%** |
| FA_FF_Q MANAGER (queue managers, vendor-named codes) | CABLE MANAGER 95% | none |
| FA_CE_PRINTER_BARCODE · PRINTER BARCODE GODEX G-500 | BARCODE_PRINTER_STAND 95% | **BARCODE PRINTER 77%** |
| FA_FF_TABLE_OFFICE · TABLE 4*2 + OFFICE CHAIR | Office Chair · Same name | none (review: chair line Office Chair · Same name, reach *this product name*; table line none) |
| FIXED ASSETS-IT EQUIPMENST-FA_IT_OTHERS (catch-all) | CABLE MANAGER · Same name | none |
| FIXED ASSETS-…-NEW DEPARTMENT · HIKVISION DOME CAMERA | CAMERA BOX PVC 95% | none |
| FA_CE_UPS · UPS(1000 APC VA) | UPS SMALL 95% (coin flip vs UPS BIG) | none |
| FA_FF_DC RACK · PALLETS / FA_FF_RACKS · heavy-duty racks | IT RACK 95% | none |
| 01-MOUSE[IT-01] · wired + wireless mice | MOUSE_WIRELESS 95% | none (review: WIRELESS MOUSE line → MOUSE_WIRELESS 85%) |
| review: CV2155 Lenovo ThinkPad E14 G7 / CV1165 Thinkbook 14 (laptop) | CAMERA BOX PVC 95% | **LAPTOP** 77% / 85% |

Also gone: CT270625 APFC panel and CV2085 forklift → CAMERA BOX PVC (their PO line text mentioned "camera"); BULLET CAMERA → CAMERA BOX PVC; MONITOR Samsung → TFT (it came only from the line text "… TFT"); R-51 HOP BOX and HARDWEAR PKT review lines were "Same name" only because of their PO line text.

Lost (correct before, none now — the price of "better none than a coin flip"): HARDWEAR PKT → HARDWARE PACKET (group name "IT RACK_HARDWARE PACKET" fits IT RACK almost as well), FA_OE_CCTV_OUTDOOR group → OUTDOOR CAMERA (its BULLET CAMERA code does not say outdoor; the OUTDOOR CAMERA @POE line still gets it in the review), FOOTFALL SENSOR DEVICE for a "3D PEOPLE COUNTIND SENSOR MOUNTING KIT" (a kit; was 62%).

## 4. Other wrong-suggestion patterns noticed (not fixed; observations)

* **Product words no Item uses cannot count against.** LAPTOP MEMORY (a RAM stick) → LAPTOP 85%; "LENOVO-THINK BOOK 14-IMLU BATTERY" → LAPTOP 77% (from its group name). MEMORY/BATTERY are no Item's words, so the scorer cannot know they change the thing. Adding them as thing-words (head nouns) or creating Items (RAM exists: "memory" is a synonym) would fix these.
* **Group-name-only suggestions in mixed groups.** In FA_IT_DESKTOP the codes TEST, TEST-1 … TEST-10 get DESKTOP 77% from the department alone; in FA_PM_AC_SPLIT the vendor-named codes DAIKIN / BLUE STAR get "Split AC 1.5 Ton" 77%. Defensible, but they are judged only by where the ERP filed them.
* **"DUCT SPLIT AC DOUBLE CIRCUIT" → Split AC 1.5 Ton 85%**: a ducted unit; the Item's 1.5 Ton is filler (sizes do not decide the Item).
* **ERP data**: several codes' PO line text contradicts their item master (APFC panel ↔ "AUTOMATION CAMERA BACKUP DEVICE"; genset parts ↔ "UPASANA APPRELS S"; a servo stabiliser ↔ "TRACK LIGHT WARM_30 WATT"). This is why line texts are no longer scored (N2), and worth reporting to the ERP team.

## 5. Decisions

1. **Line descriptions are not scored** when the ERP item master has the code (both screens): they were the cause of N2 and of several wrong 95% suggestions; the review still shows them.
2. **Context (group name / department) is never "same name"** and counts × 0.9 for one product; a group of several product names × 0.9 and never "same name".
3. **The reach is part of the suggestion** (`suggestion_scope`): a suggestion offered for a whole ERP group must fit the whole group; otherwise it is offered for the product name only. The person's own reach choice always wins.
4. **Confirm** = only a similar name or a whole-group reach; exact name at product-name/code reach stays one click (as the brief says).
5. **Ties within 0.1 → none**, measured against every candidate that fit at all (not only those above 0.6).
6. **Code example**: location/cost centre = the company's first active ones (by id); Asset Group / sub-category stay the generic sample (shared by all companies). The number stays the rule's start number (the GET example is "the first code of the rule" since S0.9; the counter's real next number is not shown).
7. `can_undo` mirrors the server's own DELETE rule (head-office admin) rather than the frontend guessing.

## 6. Existing tests changed (intended behaviour only)

| Test | Why |
|---|---|
| `tests/erp/test_s7_item_suggestions.py` — r51 hop box, "APC UPS 1KVA", old entry point, PO review / Articles screen HOPBOX | non-exact cap 0.95 → **0.85**; the Article name is passed as context (it is never "same name") |
| same file — `test_rare_words_count_more_than_common_ones` | (a): "ZEBRA GK420T" lacks PRINTER, so Zebra Printer scores 0.59 (< 0.6) — the rare word still scores far above the common one; "ZEBRA GK420T LABEL PRINTER" → Zebra Printer |
| `tests/assets/test_s7_link_suggestions.py`, `test_s5_edges.py`, `test_s5_link_items.py` (one assertion each) | Link assets: a non-exact name 0.95 → 0.85 |
| `erp-inbox.test.tsx` (2), `PoFromErp.test.tsx` (2) | "Use suggestion" with a similar name now confirms first |
| `settings.test.tsx` (2 + mock) | preview asked with `?company_id=`; the new company is chosen after being added |

## 7. Files

Backend changed: `app/items/suggest.py` (rewritten scorer), `app/items/service.py` (`suggestion_fields`, Articles screen as a group), `app/erp/inbox.py`, `app/erp/service.py` (draft via `for_erp`; not-tracked `map_id`/`can_undo`), `app/numbering/service.py`, `app/numbering/router.py`; tests above. New tests: `backend/tests/erp/test_s7_fix2_suggestions.py`, `backend/tests/erp/test_s7_fix2_not_tracked_undo.py`, `backend/tests/numbering/test_s7_fix2_code_example.py`.
Frontend changed: `src/features/items/suggestion-words.ts`, `src/features/erp/ErpInbox.tsx`, `src/features/purchase-orders/PoDraftCard.tsx`, `src/features/purchase-orders/LineEditDialog.tsx`, `src/features/numbering/CodeRuleScreen.tsx`, `src/features/settings/SetupWizard.tsx`, `src/routes/setup/companies.tsx`, `src/components/master-crud/MasterCrudScreen.tsx` + their tests.
(`backend/scripts/seed_uat_personas.py` was already untracked before this round; not touched.)

## 8. Test runs

* Backend: `docker compose up -d --build api`, then `docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q` → **1,387 passed, 0 failed** (364 s; was 1,364: +23 new tests) · `alembic heads` → `d2e4f6a8b0c2 (head)` (one head, no migration).
* Note: two earlier full runs showed DB deadlocks/errors because another `python -m pytest -q` (not started by this session) was running in the same api container against `ckam_test` at the same time; it was left alone, and the run above was made after it ended.
* Frontend (`frontend/`): `npx tsc -b` clean; `npx vitest run` → 78 files, **1,127 passed**; `npm run build` → built (the usual >500 kB chunk warning only).

## 9. e2e strings

None changed. Checked: no spec uses "Use suggestion", the ERP inbox, the PO review's suggestion, the Edit-line Barcode, the wizard's company picker or `/code-rules/preview`; the "Barcode" labels the specs fill (Add Line / Add set / manual PO) are unchanged. Behaviour the controller may meet: a similar-name "Use suggestion" (inbox or review) opens a "Use the suggestion?" dialog with **Use it** / Cancel.
