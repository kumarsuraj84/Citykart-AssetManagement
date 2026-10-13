# CKAM Simplification S5a: Asset 360, one Move screen, one label action (frontend)

Starting HEAD: `a741faf`. Frontend only (`./frontend`); no backend, no git operations, nothing deployed.
Not committed: the controller commits.

## 1. Scope delivered

| Part | What changed |
|---|---|
| A. Asset 360 | 7 tabs replaced by a summary strip and 4 sections. Company and Work area are shown (neither was shown before). There is a "← Assets" breadcrumb. Lifecycle actions open the Move screen. Viewers see no action buttons. |
| B. Move | One screen titled **Move**. A segmented list of 11 plain-word choices replaces the "Action" dropdown. The destination picker shows only the matching kind. Choices that don't fit every asset in the batch are turned off, with a one-line reason. The page can be opened pre-filled with `?ids=&choice=`. The scan box keeps the cursor. Date, reference number and remarks are under "More". All label controls are in one "Label settings" disclosure. The result panel has [Print labels] and [Move more]. |
| C. Labels | One `PrintLabelsAction`, one `LabelSettingsDisclosure` and one `useScanLabelPrefs` hook. They are used by the Register, Asset 360, the Move result, the delivery banner and the /print-labels page. Move's print-as-you-scan uses the same disclosure. Labels now print without the page around them. |
| D. Register | The selection bar has "Print labels (n)" (the shared action) and "Move (n)", which opens Move pre-filled. The bulk-move dialog is removed. |
| E. Wording | No raw codes, "With" for the person or place, status words from `lib/labels.ts`, and "Purchase Invoice (PI)". |
| F. Tests | 861 → **906** tests (+45 net). Existing tests were rewritten for the intended changes. No coverage of a capability that still exists was dropped. |

## 2. Files changed

New
- `frontend/src/features/labels/PrintLabelsAction.tsx`: `PrintLabelsAction` (button, dialog with settings, preview and Print), `LabelSheet`, `fetchAssetsByIds` (200 ids per request, keeps the requested order), `parseIdList`, `labelsWord`.
- `frontend/src/features/labels/LabelSettingsDisclosure.tsx`: the one label-settings UI. When closed it shows a summary line ("Barcode + QR · 70 × 20 mm"). It optionally takes the Move scan toggles.
- `frontend/src/features/labels/useScanLabelPrefs.ts`: print-as-I-scan and confirm-by-scan. Uses the same localStorage key as before (`ckam.movement.prefs`).
- `frontend/src/features/labels/PrintLabelsAction.test.tsx`

Changed
- `frontend/src/features/assets/actionRules.ts`: now the **single source** of lifecycle choices: `allowedEvents`, `MOVE_CHOICES`, `choicesFor(status, {isAdmin})`, `choiceAvailability(statuses, {isAdmin})`, `isChoiceAllowed`, `moveChoice`. The old `actionsFor` and `targetLabelFor` are removed.
- `frontend/src/features/assets/AssetDetail.tsx`: restructured (section 3).
- `frontend/src/features/assets/AssetMovement.tsx`: rewritten around the choices (section 4).
- `frontend/src/features/assets/AssetRegister.tsx`: selection bar; bulk-move dialog removed.
- `frontend/src/features/assets/PrintLabels.tsx`: now a queue page built on the shared disclosure and label sheet.
- `frontend/src/features/purchase-orders/PurchaseOrderDetail.tsx`: "Print their labels now" and "Print labels for the received units" use the shared action.
- `frontend/src/components/labels/AssetLabel.tsx`: `PrintNow` now mounts its sheet and the print-only stylesheet on `<body>` (through a portal), and only while printing. Added `SYMBOL_WORDS` and the `summary` returned by `useLabelSettings`.
- `frontend/src/router.tsx`, `frontend/src/routes/asset-movement.tsx`: `/asset-movement` accepts `?ids=` and `?choice=`. A shared `searchText()` helper also accepts a number that the router read back from an id list, and `/print-labels?assets=` uses it too. The `/dispatch` redirect is kept.
- Tests: `actionRules.test.ts`, `AssetDetail.test.tsx`, `AssetMovement.test.tsx`, `MoveDispatchLabels.test.tsx`, `AssetRegister.test.tsx`, `PrintLabels.test.tsx`, `PurchaseOrderDetail.test.tsx`.
- e2e static strings (not run): `asset-lifecycle.spec.ts` (moves now go through Asset 360 → Move…), `asset-correction.spec.ts`, `add-asset-company-scoping.spec.ts`, `purchase-order-delivery-journey.spec.ts`, `rbac-responsibility-journey.spec.ts`, `import.spec.ts`.

Removed
- `frontend/src/components/labels/LabelSettingsFields.tsx`. It is replaced by `LabelSettingsDisclosure`, so only one settings UI remains.

## 3. Asset 360: before and after

Before: a header (code, description, status, QR, Print Label which printed the whole page through `window.print()`, Correct Classification, Edit), a "With …" line, one lifecycle button per allowed action, then **7 tabs**: Overview, Procurement, Custody, Custom Fields, History, Changes, Documents. Some facts appeared twice: status, Item, With, place and work area. Company was not shown at all. There was no way back to the register.

After:
- **← Assets** breadcrumb.
- **Summary strip**:
  - Asset Code (large, h1), QR image, Status badge and Work area chip
  - Item; With (name, its kind in plain words, and its place); Company
  - For Admin and Operator only: **Move…** · **Print Label** (the shared action) · **Edit** · **⋯ More actions**. The ⋯ menu lists every valid choice for this status, then Correct Classification.
- **4 sections** (each a named region):
  1. **Identity**: Serial Number ("Pending: still to be added" or "None (N/A)" where they apply), Barcode, ERP Item Code, Brand, Model, Warranty ("3 years · until 2027-06-01"), Description.
  2. **Procurement**: Vendor, PO (number · date), Invoice (number · date), Invoice Amount, Purchase Invoice (PI) (number · date), Purchase Date, Cost, Tax (% · amount), Total, Cost Centre.
  3. **Where it is & history**: "Status and place since" and Department, plus the timeline, always visible (no tab).
  4. **More** (small tabs): Documents · Field changes (readable field names, corrections marked) · Custom fields (retired fields kept) · Advanced (Legacy Asset Code, Category, Sub-category).
- Each fact appears once. A test checks this for the serial, barcode, vendor, model, brand, With, company, Item, ERP code, status, work area, PO, invoice and PI.
- Edit and the Correct Classification dialog keep their behaviour. The S0F serial rules are unchanged: the serial is sent only when changed, never blank, and N/A uses the checkbox.
- The lifecycle action dialog is **removed** from Asset 360. Every choice opens `/asset-movement?ids=<id>&choice=<key>`, and Move… opens it without a choice. Move now covers date, reference and remarks (section 4).

## 4. Move: before and after

| Before (`Move Assets`) | After (`Move`) |
|---|---|
| "Action" dropdown with 8 entries ("Move / Allot / Transfer", …), defaulting to Move | Segmented radio list "What do you want to do?" with 11 entries: Give to Employee · Return to Stock Room · Send to Store · Install · Send for Repair · Receive from Repair · Report Lost · Mark Found · Sell · Scrap · Dispose. Nothing is pre-selected unless `?choice=` is given. |
| One "Move To" / "Received Into" picker listing every person and place | The picker lists only the matching kind: Employee / Stock Room / Store / Install Point. Mark Found lists Stock Rooms only (server rule). Receive from Repair lists everyone, with each entry's kind in its detail ("Received into"). The picker is hidden for choices with no destination. "+ New Stock Room…" appears for Stock Room pickers when capabilities allow. A destination that doesn't fit the new choice is cleared. |
| Eligibility checked per asset only; all actions always offered | Choices come from `choiceAvailability(queue statuses)`: a choice is on only if it is valid for every queued asset. A mixed batch shows one line, for example "This batch has assets that are With Employee / Store, Under Repair: only what is possible for all of them is offered." Disabled choices have a title giving the reason. Mark Found is off for anyone who is not an admin ("Only an admin can do this."). |
| Remarks always visible; no date or reference | **More** (closed): Date (defaults to today, no future dates), Reference number, Remarks |
| Labels box (2 checkboxes + Label Contains + Label Size) shown for any Move | Shown only for **Send to Store**: the visible "Print labels as I scan" toggle plus a closed **Label settings** disclosure (confirm-by-scan, contents, size), with a summary line. Defaults and remembered choices are unchanged. |
| Result: "N asset(s) updated", failures as "Asset #id: reason", "Start a new batch" | Result: "N assets <done words>" (for example "2 assets sent to the store."), failures named by **asset code** with the server's sentence, then **[Print labels (n)]** (the shared action, for the assets that moved) and **[Move more]** |
| Scan box autofocus on load only | Focused on load and again after every add: scan, pick list, by Item, browse, or a repeat scan. Enter adds. |
| Apply button `Apply "Move / Allot / Transfer" to N assets` | `<Choice> (N assets)`, with a hint beside it when disabled ("Choose the store.") |

Unchanged on Move: scan by serial, asset code or description, and the label QR link. Also unchanged: exact-first lookup, the Qty multi-add, "Only assets currently in stock", "Add by Item + Quantity" (the same client-side paging), the "Currently With" browse, queue search and sort, per-row print and reprint, "print the labels not printed yet", scan-back confirmation, the 1,000 limit, and the `/dispatch` redirect.

**Payloads:** `POST /assets/bulk-action {asset_ids, event_type, to_asset_user_id, remarks}` is unchanged. That endpoint does not accept a date or a reference. When the person enters an earlier date or a reference number, Move records each asset through the existing `POST /assets/{id}/events` instead, with the same body Asset 360's dialog used to send: `{event_type, to_asset_user_id, event_date, reference_no, remarks}`. Failures are reported per asset in the same result panel. Neither endpoint's shape changed.

## 5. Label entry points: before and after

| Place | Before | After |
|---|---|---|
| Assets register selection | Link to `/print-labels?assets=…` (leaves the page) | **Print labels (n)** → shared dialog, prints in place |
| Asset 360 | "Print Label" = `window.print()` of the **whole page** | **Print Label** → shared dialog → prints **only the label** |
| Move | Inline Labels box + per-scan `PrintNow` | Per-scan `PrintNow` (unchanged behaviour), settings in the shared disclosure, and the result's **Print labels (n)** (the shared action) |
| Delivery banner ("Print their labels now") and "Print labels for the received units" | Links to `/print-labels` (first 200 only) | Shared action. The ids are loaded when the dialog opens, 200 per request, so a delivery of more than 200 is no longer cut off. |
| `/print-labels` page | Its own settings fields, a preview and Print | Queue page with the shared disclosure and the shared `LabelSheet`. The preview is the printed sheet and Print calls `window.print()` as before. The route and `?assets=` pre-load are kept. |

There is one settings UI (`LabelSettingsDisclosure`). Symbol and size are still remembered through `ckam.printLabels.symbol` and `ckam.printLabels.size`, and the scan preferences through `ckam.movement.prefs`. The QR and barcode options (Barcode + QR / Barcode / QR Code), all 5 size presets, Custom size and the 70 × 20 mm default are unchanged.

## 6. Tests

`npx tsc -b`: clean. `npx vitest run`: **70 files, 906 passed** (baseline 861). `npm run build`: succeeds; the chunk-size warning was already there before this work.

Added or rewritten (file: tests now):
- `actionRules.test.ts` (10): the state-machine mirror; the 11 choices mapped to event and destination kind; no raw words; the choices for each status; admin-only Mark Found; batch availability with reasons.
- `AssetDetail.test.tsx` (59):
  - layout: breadcrumb; 4 sections and no old tabs; summary shows company and work area; no repeated facts
  - section contents: Identity and Procurement; plain serial states; Advanced
  - actions: the menu equals `choicesFor(status)` for 5 statuses; an operator gets no Mark Found; a final status has no Move; Move… and a picked choice navigate with `?ids=&choice=`; viewer and self-service see no actions; Print Label prints only one label through the shared dialog
  - correction flows through the ⋯ menu; all Edit, serial and custom-field tests kept
- `AssetMovement.test.tsx` (44): the 11 radios with none picked; destination filtering per choice (5 cases); Receive from Repair lists every kind; no picker for the 5 choices without a destination; destination cleared on a kind switch; mixed-status disabling with the reason line; Mark Found admin-only; pre-fill from `?ids=&choice=` (order kept, nothing auto-printed); unknown `?choice=` ignored; scan focus on load and after adding; More holds date, reference and remarks; remarks in the bulk payload; date and reference per asset with a partial failure; the result panel with Print labels and Move more; stock-room capabilities.
- `MoveDispatchLabels.test.tsx` (32): every label behaviour now under Send to Store; the print-as-I-scan preference remembered; the closed disclosure with its summary; confirm-by-scan inside the disclosure; failures named by code; the destination rules for all choices.
- `PrintLabelsAction.test.tsx` (9, new): dialog, preview and print of only these labels; ids loaded in 200-id chunks in order; disabled when empty; chosen size prints and is remembered; disclosure defaults and scan preferences; helpers.
- `AssetRegister.test.tsx`: Move (n) opens Move pre-filled (replaces the bulk-move dialog test); Print labels (n) uses the shared dialog; a viewer is offered neither.
- `PrintLabels.test.tsx`: uses the shared disclosure (plus every existing preview and format test).
- `PurchaseOrderDetail.test.tsx`: both delivery label buttons open the shared dialog and load the ids.

## 7. Decisions taken (inside the brief)

1. **The label controls on Move belong to "Send to Store" only.** Before, they appeared for any move. This follows the brief ("when the destination is a Store (existing behaviour)"). Any other move still offers labels through the result panel's Print labels, or the /print-labels page.
2. **No choice is pre-selected on Move.** The person picks it, or it comes from `?choice=`. A scan before picking just queues the asset.
3. **Assets handed over with `?ids=` are not auto-printed.** Nothing was scanned, so nothing is in hand yet. "Print N labels not printed yet" is there for them.
4. **Mark Found is admin-only in the UI** (disabled for others with a reason), matching the server rule. Its picker lists Stock Rooms only, because the server sends a found asset only to a stock room.
5. **Receive from Repair** keeps "anyone" as its destination, as today, and shows each entry's kind.
6. **A date other than today, or a reference number, makes Move record per asset** through the existing single-asset endpoint, because the batch endpoint does not take them. This only applies when those fields are used. The batch request is otherwise unchanged. It is noted under backend requests.
7. **Print Label on Asset 360 is hidden from viewers** with the other actions ("Viewers see no action buttons"). /print-labels was already limited to Admin and Operator.
8. **More is a set of small tabs** (Documents, Field changes, Custom fields, Advanced), not one long page. The facts people use daily (Identity, Procurement, history) are always visible.
9. Category and Sub-category moved to More › Advanced, next to the Legacy code: the Item in the summary now says what the asset is. Cost Centre sits in Procurement and Department in "Where it is & history".

## 8. Deferred

- Browser check: the web container was not rebuilt (the brief said not to start or stop docker). Run `docker compose up -d --build web` and check Asset 360, Move and the print dialog at desktop and 375 px before release.
- The register's search upgrade, Item column and filters, and holder-kind filtering (the heavy search work in a later package).
- The Timeline still uses its emoji icons. It was untouched here; a separate pass could make it fit the "no decoration" rule.
- The e2e specs were updated but not run (as the brief said).

## 9. Backend requests

1. **`POST /assets/bulk-action` to accept `event_date` and `reference_no`**, applied to every asset with the single-asset rules. The S4 `apply_events` already takes both. Move could then always send one request and drop its per-asset fallback.
2. **A filter by the kind of person or place.** The kind is already on asset rows (`current_asset_user_type` on `AssetOut`), but `/assets` cannot filter by it: there is no way to ask for "assets with any Store" (for example `?holder_type=STORE`) or "assets in any Stock Room". The register and Move's "Currently With" browse would use it.
3. **"Take N of <Item> from <Stock Room>" endpoint**, for example `GET /assets/take?item_id=&stock_room_id=&count=&exclude=`, returning exactly N free assets in one call. Move currently pages through the list 200 at a time on the client.
4. **`/assets?ids=` limit above 200**, or a POST body, so a large delivery's labels load in one request. The client now splits ids into chunks of 200.
5. Optional: `GET /assets/{id}` could return `company_code` beside `company_name`, for the summary chip on narrow screens.
