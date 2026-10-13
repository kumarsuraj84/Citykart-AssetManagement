# CKAM Simplification — Stage S0F report (frontend adapts to the S0 backend contract)

| | |
|---|---|
| Starting HEAD | `9e84a00` (S6a) |
| Scope | Frontend only (`frontend/src`) plus this report. No backend, database, API or deployment change; no request shape changed except as listed in §4. Not committed (the controller commits). |
| Contract read | `docs/ai/CKAM_SIMPLIFICATION_S0_REPORT.md` §2 (API changes) and §7–§8; the backend files were read, never edited |
| Tests | vitest **587 -> 682 passed** (57 -> 63 files, +95 tests), `npx tsc -b` clean, `npm run build` succeeds (the existing >500 kB chunk warning only) |
| e2e | No label or selector used by the Playwright specs changed (checked by grep); nothing edited, Playwright not run |

## 1. What changed, by item

### 1. API client errors (`src/lib/api-client.ts`)
* New exported `errorMessageFrom(body, status)`. The Error message is, in order: `detail` when it is a string; the de-duplicated, joined `errors[]`; the old FastAPI array-of-objects `detail` (each item's `msg`, joined); `detail.message`; and only then `Request failed: <status>`.
* 409 "A record with this code already exists.", the foreign-key 422, the 503 "The database could not be reached…" and the 403 owner-only sentences arrive as the screen's message unchanged.
* Verified through the real client (only the network mocked) on New Purchase Order and the People & Places deactivation; every other mutation display (Add Asset, delivery, master forms, asset users, ERP create, Asset 360 edit/actions) already prints `error.message`, which is now the server's sentence.
* Fixed on the way: Asset 360's action dialog kept the previous attempt's refusal when reopened (now reset on open), and its error line is a proper `role="alert"`.

### 2. Asset Code Format screen (`features/numbering/CodeRuleScreen.tsx`)
* Only the head-office admin (role ADMIN and Primary Owner) sees Save and editable fields. Anyone else (ordinary Admin, Operator, Viewer) gets the current format **read-only** (all four inputs `readonly`, no Save) with the note "Only the head-office admin can change the asset code format."; the page text says so when there is no rule yet. The route guard from S1 still keeps the menu entry away from them.
* The owner's example now comes from the server: `POST /api/code-rules/preview` with the rule fields, **debounced 350 ms**, one request for the final text. The offline `renderPreview` stays as the instant fallback while the answer is on its way and when no answer can be had.
* The server's validation sentences are shown inline under the "Next Asset Code" box (and the box shows a dash, never a misleading example next to an error). A failed Save shows the server's sentence.
* A non-owner sees the saved rule's own `example` field; no preview request is made for them.
* Set up CKAM step 7 embeds this same screen, so the wizard gets all of it (tested).

### 3. People & Places (`features/asset-users/AssetUsersScreen.tsx`)
* Primary Owner rows are **not shown anywhere** in this screen (filtered out before S0F, kept). As defence in depth a new exported `canManageAccount(row, viewerIsPrimaryOwner)` decides whether a row gets Edit / Company access / Reset password / Deactivate; a head-office-admin row seen by anyone else would show "Head-office admin only" instead.
* A refused deactivation now **shows the server's sentence** ("X still holds 3 assets. Move them … first, then deactivate.") inside the confirmation dialog, which stays open until Cancel or success (before, the dialog closed and the refusal was invisible). A refused Reset password shows its sentence in a dismissible banner (also previously invisible). The bulk-deactivate list already printed the server message per row.
* **Work area field** (IT Team / Admin / Non-IT Team / Both) is in the form for every login-enabled person whose Access is Full Admin, Can Add & Move Assets or View Only (not Own Assets Only, which is custody-scoped on the server). It shows the stored value and defaults to Both.
* Payload: the stored `allowed_asset_domains` / `primary_asset_domain` are always sent back on an edit (so nothing resets), a changed work area is sent, and **for a record whose login is off neither field is sent** (the server refuses a work area on a non-login with "A work area can only be set for someone who can log in."; leaving it out keeps the stored value). A one-area Admin choosing a wider area gets the server's "You handle only IT work…" sentence in the form.

### 4. ERP PO review (`features/purchase-orders/PoDraftCard.tsx`, new `erp-create-errors.ts`)
* **PO No and PO Date are read-only** ("From the ERP."). `erp_po_code` is always sent; `po_number` / `po_date` are still sent (payload shape unchanged), the server replaces them.
* **Vendor is read-only**: the CKAM vendor linked to the ERP supplier (the server refuses any other `vendor_id`). When the draft's company has no linked vendor the card says "<supplier> is not linked to a CKAM vendor for this company yet. Add or link it in Vendors first." and Create stays disabled. If the person picks a different company than the draft's, no `vendor_id` is sent (the server resolves it). "New Vendor…" is gone from this card (it could only lead to a refusal).
* **Quantity**: the field's max is `min(1000, ERP open quantity)`, with the hint "The ERP has 10 open: 1 to 10." (or "Whole number, 1 to 1,000. The ERP has 5,000 open." above 1,000). Above the ERP's open quantity, above 1,000, blank, 0 or fractional: the line shows its problem sentence and Create is disabled.
* **Cost**: hint "ERP rate 100.00; keep within half to double."; outside 0.5-2x blocks Create with the range spelled out.
* **Server refusals appear under the offending line.** `lineIndexesForServerMessage` maps "Line 2 (CT…): the cost … is too far from the ERP rate …" to line 2 and "CT324973: 9 units asked, but the ERP purchase order has only 7 open." to every line with that ERP code; order-level sentences stay at the bottom as written. When a line is named, the bottom message only points to it.
* Still editable: Company (unchanged), Cost Centre, Received Into, Item, description, barcode, brand, model, tax, warranty, fewer units, cost within range.

### 5. check-serials masked conflicts (`purchase-orders/serial-conflict.ts`)
`Serial "111" is already used by an asset outside your companies or work area.` (the server's phrase as returned, no "asset" put in front of it); a normal code still reads `… by asset FA/CKSPL/IT/0007.` Confirm stays blocked for both.

### 6. Asset 360 Edit serial (`features/assets/AssetDetail.tsx`)
* `serial_number` is **sent only when the person changed it** (trimmed). Untouched = key omitted (the server keeps it); an asset that has no serial and is saved with the field empty also omits it.
* "No serial number" sends `N/A`.
* Emptying a serial that exists is stopped on the client with the server's exact sentence "The serial number cannot be removed. Type N/A if the asset has none." under the field, Save disabled, **nothing blank or null is ever sent**. If the server refuses anyway, its sentence shows in the existing save-error line.

### 7. Lifecycle / Move destinations
* The destination rule was already right in both places (`actionRules.ts` `needsAssetUser`, `BULK_ACTIONS`): **Move / Move-Allot-Transfer, Receive from Repair, Mark Found** show the picker ("Move To" / "Received Into") and need a choice; **Send for Repair, Report Lost, Dispose, Sell, Scrap** show no picker and send `to_asset_user_id: null`. S0F locks this with tests, including that a destination chosen earlier in Move is **not** sent after switching to a no-destination action.
* The pickers list only active people/places (`/asset-users` returns active rows), so an inactive destination is not offered; if it is refused anyway the server's sentence is shown (Asset 360 dialog `role="alert"`; Move's per-asset "Asset #n: <reason>" list and whole-request alert).

### 8. Quantity 1-1,000 (new `src/lib/limits.ts`: `MAX_QUANTITY`, `quantityProblem`, `quantityHint`, `MAX_BUNDLE_PARTS`)
| Place | Behaviour |
|---|---|
| PO detail, Add Line | max 1000, hint "Whole number, 1 to 1,000.", inline sentence ("Enter at least 1." / "At most 1,000 at a time." / "Enter a whole number." / "Enter how many (1 to 1,000)."), Add Line disabled; the old silent `|| 1` fallback is gone |
| Add Bundle dialog | same; the "This will add N lines" line is hidden while invalid |
| ERP draft line | `min(1000, ERP open quantity)` (see §4) |
| Move > Qty | same hint and sentences, Add and Enter blocked while invalid (the old silent `Math.max(1, …)` is gone) |
| Move > Add by Item "How many" | 1-1,000 (was max 200 not enforced); counts above the server's 200-per-request limit are read **page by page** (`&offset=`), the first request keeps its old exact URL |
| Move > Apply | more than 1,000 eligible assets queued: Apply disabled with "You can move at most 1,000 assets at a time. Remove N …" (the server refuses more than 1,000 ids) |
| Bundle parts editor | "+ Add part" disabled at 50 parts ("A set can have at most 50 parts.") |
| Add Asset | creates exactly one asset per save; there is no quantity input |

Fixed on the way: Move's Qty asked the server for `limit=500`, but `GET /assets` allows at most 200 (it would have answered 422 "Search failed"); the cap is now 200 and the existing "Added N of M requested" summary says how many were found.

### 9. Wording
Grep of `src` and `e2e` for Responsibility / Holder / Primary Owner / "domain" shows no user-visible leftover (remaining hits are code identifiers, the e2e spec file name, and code comments). No server message the UI quotes leaks a raw enum; the UI no longer builds a sentence out of a server code anywhere new.

## 2. Files

New: `src/lib/limits.ts`, `src/lib/limits.test.ts`, `src/lib/api-client.test.ts`, `src/lib/server-sentences.test.tsx`, `src/features/purchase-orders/erp-create-errors.ts` (+ `.test.ts`), `src/features/purchase-orders/serial-conflict.ts` (+ `.test.ts`), `src/features/bundles/BundlePartsEditor.test.tsx`.

Changed: `src/lib/api-client.ts`, `src/features/numbering/CodeRuleScreen.tsx`, `src/features/asset-users/AssetUsersScreen.tsx`, `src/features/purchase-orders/{PoDraftCard,PurchaseOrderDetail,AddBundleDialog}.tsx`, `src/features/assets/{AssetDetail,AssetMovement}.tsx`, `src/features/bundles/BundlePartsEditor.tsx`.

Tests changed/extended: `CodeRuleScreen.test.tsx` (rewritten around owner / non-owner), `AssetUsersScreen.test.tsx`, `PoFromErp.test.tsx`, `PurchaseOrderDetail.test.tsx`, `AddBundleDialog.test.tsx`, `AssetDetail.test.tsx`, `MoveDispatchLabels.test.tsx`, `settings.test.tsx`.

## 3. Tests added (vitest 587 -> 682)

* **api-client** (new file): detail string; 409 / FK 422 / 503 / 403 sentences; joined `errors`; old array-of-objects shape; status-code fallback only when nothing readable; odd shapes; success and 204 unchanged.
* **Real-client path** (`server-sentences.test.tsx`): New PO form shows the readable 422; deactivation refusal shows "still holds 3 assets"; 409 / FK / 503 messages.
* **Code rule**: owner sees Save and the server example; preview is debounced and sends the exact body; server validation sentence shown inline with a dash instead of an example; Save error sentence; non-owner (ordinary Admin, Operator, Viewer) sees read-only fields, the note, no Save and no preview or save request; no-rule message; wizard step 7 shows the server example (and an ordinary Admin never reaches the wizard).
* **People & Places**: `canManageAccount`; owner rows never listed; refused deactivation sentence kept in the dialog and cleared on Cancel; successful deactivation still closes; refused reset sentence; Work area offered for Full Admin / Can Add & Move / View Only and not for Own Assets Only; new Full Admin sends the chosen work area; edit shows and re-sends the stored value, and sends a changed one; login-off record sends no work area; one-area refusal and a validation 422 shown in the form.
* **ERP review**: read-only PO No / PO Date / Vendor with `erp_po_code` sent; unlinked vendor blocks; editable fields stay editable and fewer units are sent; open-quantity cap (above, 0, over 1,000, 5,000-open line); cost range; server refusals under line 1 (units asked and too-far-rate) and an order-level refusal at the bottom only; `lineIndexesForServerMessage` unit tests.
* **check-serials**: masked wording shown as returned and still blocks Confirm; `serialConflictSentence`.
* **Asset 360**: serial omitted when untouched, sent trimmed when changed, N/A, empty blocked with the sentence and Save disabled, no-serial asset omits the key, server refusal shown; no destination picker and `null` for Send for Repair / Dispose / Sell / Scrap / Report Lost; picker required and sent for Move, Receive from Repair, Mark Found; four server sentences shown in the dialog and cleared between attempts.
* **Move**: picker for Move / Receive from Repair / Mark Found; none for the other five and an earlier destination is not sent; per-asset and whole-request server sentences; Qty hint and every bad value blocks adding (and Enter); no `limit=500`; "How many" bounds; 450 assets read in three pages.
* **Quantity limits**: `limits.test.ts`; PO Add Line (hint, five bad values, 1000 accepted and sent, server sentence shown); Add Bundle; bundle parts at 50.

## 4. API / payload changes

None are new requests. Differences in what is sent, all within the S0 contract:
* Asset 360 Edit: `serial_number` is omitted unless changed (never null/blank).
* Asset users create/edit: `allowed_asset_domains` can now be chosen (IT / NON_IT / BOTH) for login-enabled staff roles; neither work-area field is sent for a record whose login is off.
* ERP create: `vendor_id` is the draft's linked vendor, or `null` when the person chose a different company than the draft's.
* `POST /api/code-rules/preview` is called (owner only, debounced).
* Add by Item may send extra `&offset=` page requests for counts above 200; Move's search `limit` is capped at 200.

## 5. Decisions taken where the brief was open

* **Blank serial with an existing serial** is stopped on the client with the server's own sentence (never sent), instead of sent-and-refused.
* **Vendor on the ERP card** is read-only and blocks Create when the supplier is unlinked, because the server refuses any other vendor and any unlinked supplier. Company on that card was left editable (not in the brief) and the server's company sentence shows at the bottom.
* **Work area for Own Assets Only** is not offered (the server ignores it for custody-only logins).
* **Cap on Move's Qty search** is the server's 200; the input still accepts 1-1,000 as briefed and the summary line says how many were found.
* **Debounce** for the code preview is 350 ms.
* A server refusal that names a line is shown **under that line** and the bottom message becomes a pointer; unnamed ones stay at the bottom.

## 6. Deferred / not done

* Client-side mirrors of the other S0 ranges (tax 0-100, warranty 0-100, amount under 9,999,999,999, no future dates, text lengths) were **not** added; the server's readable sentences now reach the screen, which was the brief.
* The ERP card checks quantity per line against that line's ERP open quantity; two lines of the same ERP code are checked together only by the server (its sentence then lands under both lines).
* A one-area Admin is not limited to their own areas in the Work area list (the auth state does not carry allowed areas, B8); the server's refusal sentence is shown.
* No browser/visual pass (docker was not touched). Recommended after `docker compose up -d --build web`: Asset Code Format as owner and as an ordinary Admin, the People & Places form's Work area, an ERP PO review with a too-large quantity, the Move screen with Qty 1001.

## 7. Backend requests

| # | Request | Why |
|---|---|---|
| B13 | Raise `GET /assets` `limit` (or add "take N in-stock assets of Item X at place Y" / bulk-action by Item and count) | Move's Qty and Add-by-Item accept up to 1,000 (the bulk limit) but one search returns at most 200; the frontend pages through `offset` for Add by Item only. |
| B14 | `allowed_asset_domains` in the login/refresh response (same as B8) | To offer a one-area Admin only their own work areas in the people form and to hide other-area groups in pickers. |
| B15 | Optional: `masked: true` on a `check-serials` conflict | The frontend recognises the masked wording by its leading "an"; a flag would be sturdier. |
| B16 | Optional: draft line field for the ERP open quantity per code (sum over lines of the same code) | Today the line's own `quantity` (= ordered - cancelled) is used as the cap. |

(B4 from S1 is resolved on the server: PUT now keeps omitted fields. The frontend still sends the stored work area, which is harmless and safe against older servers.)

## 8. Observations

* The Primary Owner is hidden from the People & Places lists by design (S1/earlier); `canManageAccount` is only a safety net.
* Before this stage an Employees "Deactivate" that the server refused closed the dialog silently; the same happened for Reset password. Both were invisible failures, now fixed.
* `GET /assets?...&limit=500` (Move Qty > 200) was already failing against the server's 200 maximum before S0.
