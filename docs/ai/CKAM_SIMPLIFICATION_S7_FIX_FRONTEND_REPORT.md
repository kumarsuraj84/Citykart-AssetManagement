# CKAM Simplification — S7 fix round, FRONTEND

| | |
|---|---|
| Date | 2026-10-13 |
| Starting point | brief: `32a72fa`; worktree HEAD when work began: `073c75b` (docs only on top); the backend fix round was committed meanwhile as `81804f6` and its §15 contract is wired here |
| Scope | `frontend/` only (plus this report). No git command that changes anything was run; nothing committed. No backend, docker, server or Playwright run. |
| Checks | `npx tsc -b` clean · `npx vitest run` **78 files, 1,114 tests, all green** (baseline 75 files / 1,040) — the full suite was run 4 times green in a row after the last code change · `npm run build` OK |

## 1. Per item

### A. P1-2 double submits — one key per intent + a synchronous guard
* **`lib/submit-key.ts`** (new): `useKeyedMutation()` = `useMutation` whose returned `mutate` is refused while the previous submit of the same form is running (a `useRef` flag set **before the first await**), and whose request carries an `Idempotency-Key`. `SubmitKey` ties the key to the payload: same payload after a failure → same key (a retry of the same intent); changed payload → new key (a corrected retry is a new intent); success → new key. `sendKeyed()` handles the server's answers: **409 "already being processed"** → asks again with the SAME key after 0.3/0.6/1/1.5 s (the replay then returns the stored result) and, if still running, ends **silently** (`SubmitStillRunning`, filtered out of `error`/`onError`); **422 "key already used for a different request"** → new key, sent once more. Also `useSubmitGuard()` for a handler without a mutation.
* **`lib/request-key.ts`** (new) + **`lib/api-client.ts`**: the key is handed to the request synchronously (`runWithIdempotencyKey(key, () => apiClient.post(...))`; `send()` reads it before its first await and sets the `Idempotency-Key` header; never on GET). Kept out of `api-client.ts` on purpose: every screen test auto-mocks that module, and all existing `toHaveBeenCalledWith(path, body)` assertions stay valid.
* Wired on: Add Assets (`/assets/batch`), Manual PO (`/purchase-orders/with-lines`), Receive (`…/receive`), ERP PO create (`/erp/pos/create`), Move (`/assets/bulk-action`), Asset 360 correction and edit, Add Employee (`/people/employees`), Add Store (`/people/stores`, guard + key without a mutation), Edit person, every quick-create dialog (New Stock Room / Install Point / Vendor / Brand / Cost Centre / Category / Sub-category — the server ignores the header where it is not listed), Link assets to Items (`/assets/link-items`). Buttons were already disabled while pending (`AsyncButton`); the ERP review's Create is also off while a "Not tracked" save runs.
* Tests: `lib/submit-key.test.tsx` (header only inside the key scope, never on GET; UUID; payload/renew rules; 409 → same key → stored result; 422 → new key; two clicks in one tick → ONE request (verified to FAIL without the guard); success → new key, same data after failure → same key, corrected data → new key; still-running is silent). Per screen "two activations in the same tick send ONE request with a key": New PO, Receive, Add Assets, ERP Create, Move, Add Employee, Link assets.

### B. P1-1 ERP resilience
* `features/erp/DeliveryReminders.tsx`: one `useErpReminders()` (used by the PO list card, the PO banner — only for an ERP-made PO, as before — and the Receive queue) calls `/erp/reminders?envelope=true`, reads `{available, message, items}` or an older bare list; `available:false` or an older server's 503 = "no information": nothing shown, nothing thrown.
* `features/dashboard/Dashboard.tsx`: every ERP figure that came is shown, whatever `erp_available` says (a null figure — listed in the new `erp_unavailable` — simply has no row). Type gained `erp_unavailable`.
* `features/erp/ErpPiDialog.tsx` + `InvoicesCard.tsx`: `available:false` → the server's sentence ("The ERP does not provide purchase invoices yet.") as a calm note (`role="note"`, not an alert) with **"Type it in"**, which switches the Record PI dialog to typing; an older server's error is shown the same calm way.
* Tests: reminders envelope / `available:false` silent; Home shows the other ERP rows when one is null (component + pure); PI 200 `available:false` sentence, no alert, "Type it in" opens the typed form.

### C. P1-3 suggestion wording
* `features/items/suggestion-words.ts` (new): "Same name" only for `suggestion_reason_code SAME_NAME` (or reason "same name"); otherwise "Similar name (72%)" (capped at 99 %); no suggestion fields → nothing. Used by the ERP review (`PoDraftCard`) and the ERP Inbox. Suggestions are never pre-chosen or applied (the review starts with no Item for an undecided line, as before; verified by test).
* Tests: unit, review ("Similar name (50%)", "Same name" without "100%", none → no "Suggested"), inbox.

### D. P2-1 SearchableSelect "+ New …" when nothing matches, with the typed name
* `components/shared/SearchableSelect.tsx`: the create entry's **group** is `forceMount` too (cmdk hid the whole group when no item matched — verified: the new test fails without it); the search text is controlled and `onCreateNew(typed)` receives it; the entry shows the typed text (`New Vendor… “ABC”`); search resets on close.
* `QuickCreateProps.initialName` (all wrappers pass `...props`, so every wrapper accepts it) → the Name field starts with it, plus anything suggested from the name (a Code). `ItemFormDialog` already had `initialName`. Callers updated: New PO (vendor, cost centre, Item, brand), Add Assets (Item, cost centre, vendor, brand), ERP review (Item, brand, cost centre), PO Add Line / Edit line (Item, brand), Asset 360 edit (brand, vendor), StockRoomSelect (every "Received Into"), Move's "New Stock Room…", New Sub-category › New Category.
* Tests: SearchableSelect (No results + entry + typed text; empty typed; search resets), PO form vendor prefill, Add Assets Item prefill.

### E. P2-2 Move layout
* `features/assets/AssetMovement.tsx`: the scan box has its own section and the whole row (`flex-1`, visible label on one line); "Only in stock" and **Qty** (shorter helper) sit on the row below; Add by Item and Currently With stay as their own cards (every capability kept); the **Apply button lives in a sticky bottom bar** (as on Receive) with the reason line. Measured in a real browser at 1366×768: scan box 1,184 px wide (was ~25 px), label 14 px high (one line), Apply visible at the bottom of the viewport.
* Test: scan box in its own region, Qty not in its row, Apply inside the sticky bar.

### F. P2-3 Set up CKAM per company
* `setup-progress.ts`: `useSetupProgress(enabled, companyId)` → `/setup/status?company_id=`; `useDefaultSetupCompany()` = the company the person works in, else their first; `companyLabel` from the answer.
* `SetupWizard.tsx`: "Company being set up" picker (only with more than one company; note that groups / Items / vendors are shared); counts read "x of 7 done for CKSPL"; step 7's example comes from the server preview **with that company's id** ("Next Asset Code in CKSPL"; the rule saved stays the global one); **Finish** ends on a summary ("CKAM is set up for CKSPL." + Add the first assets / Go to Settings, or "2 of 7 … Still to do: …" + Continue with the first open step).
* `CodeRuleScreen.tsx`: optional `exampleCompany` prop (preview body carries its id; also asked for a viewer of the guide).
* `SetupHomeRow.tsx`: follows the default company (and names it when the person has several).
* Tests: default company → `?company_id=2`, preview with `company_id 2`, switching → `?company_id=3` + preview 3, Finish summary both ways; Home row per company; existing wizard tests unchanged in intent (Finish now opens the summary).

### G. P2-4 small screens
* Home: the two-card grid is `grid-cols-1` (= `minmax(0,1fr)`) with `min-w-0` cards, so a wide table scrolls inside its card.
* Manual PO: the lines table is now one responsive grid — a card per line below `lg` (small visible field names), a single row at `lg` and up; no sideways scrolling container.
* ERP Inbox: action rows stack below `sm` (pickers full width), long names/lists wrap.
* **Every dialog**: `DialogFooter` is sticky at the bottom of the dialog's own scroll area (edge to edge on the card colour; mobile buttons get a gap). Add Employee at 390×844 (login fields open, dialog content 916 px in a 758 px box): "Add Employee" fully visible without scrolling.
* Measured with a throw-away server (production build + mocked API, kept in the session scratchpad, not in the repo; Browser pane, `scrollWidth` vs `innerWidth`): **no page-level horizontal scroll** on Home, Manual PO, ERP Inbox, Move, Add Assets, Receive at 390 and 768 (Home's/Receive's tables scroll inside their own box), and 1366. ERP Inbox at 390 is ~10,000 px tall with 45 groups/30 suppliers of 100 POs each (UAT: 73,724 px).
* Tests: dialog footer classes, Home grid, PO lines without a table/overflow container.

### H. P2-5 ERP Inbox scale
* Groups collapsed by default: title, company, "3 codes · 10 units · on 2 POs", the suggestion with **Use suggestion**, and **Details** (codes, Pick another / Link / + New Item / Not tracked / How far). 20 groups (and 20 suppliers) per page with Previous/Next and "Showing 21–40 of 45 groups"; search over titles, codes, product names, PO numbers and the suggestion (suppliers: name, PAN, codes, GSTIN); PO numbers per code truncated to 5 + "and N more"; supplier registrations to 3 + "and N more"; selection survives paging; "Select every group on this page"; multi-select resolve unchanged.
* Tests: paging + search + truncation; selection across pages; existing tests open Details first.

### I. P2-6 Item pickers limited to the person's work areas
* `features/items/useMyItems.ts` (new, `GET /items?work_area=mine`, key `["items","mine"]`, refreshed with every `["items"]` invalidation): Manual PO lines, PO Add Line / Edit line, Move "Add by Item", ERP review pickers (Add Assets already used it). Settings screens and the head-office Inbox keep the full list.
* Tests: PO form asks `?work_area=mine` and never `/items`; mocks of the touched screens updated.

### J. P2-7 Give to Employee — employee not in the list
* Operator: "Not in the list? Ask a Full Admin to add the employee (People & Places > Employees)." Full Admin: "Not in the list? **+ Add employee**" → `/people/employees`. Test for both.

### K. P2-8 Sell / Scrap / Dispose confirmed
* `actionRules.isEndState()`; Apply opens "Sell 3 assets? — 3 assets will be sold. This is final and cannot be undone: they can no longer be moved or given to anyone." with Cancel / "Sell 3 assets". Other choices apply at once. Tests (cancel sends nothing; Send for Repair not asked; existing Sell/Scrap/Dispose tests confirm first).

### L. P2-9 "Not tracked" in the ERP review
* Default reach for everyone but the head-office admin: **This product name** when the line has one, else **This ERP code only** (head-office admin: the server's suggestion as before). Under the control: "Leaves every code named “CABLE CAT-6” out of CKAM for everyone in CKSPL." A whole ERP group / Department / Section / Division asks first: "This will leave every code in the ERP group X out of CKAM for everyone in CKSPL, on this and every later purchase order. Continue?" (Cancel saves nothing).
* After saving: "Saved: … is now left out of CKAM." + **Undo** for the head-office admin when the answer carries the rule id (`DELETE /items/maps/{id}`, the server's head-office-only rule; the lines come back), otherwise "Only the head-office admin can undo this (Settings › ERP Mapping)." (head-office admin without an id: "To undo it, open Settings › ERP Mapping.").
* Tests: default reach + words, group confirm + cancel, operator told who can undo, head-office Undo.

### M. P2-11 matched lines keep the ERP words
* A matched line shows a muted second line "In the ERP: DELL DESKTOP REFURB/i3 · HARSHIT INFOSOLUTION · CT324973". Test.

### N. P2-12 unsaved work
* `lib/unsaved-changes.ts` (new): `useUnsavedChangesWarning(dirty)` = the router blocker (one `confirm`; only an explicit Cancel keeps the person there) + its own `beforeunload` listener (works for every history type); `release()` before a successful navigation. Used by Manual PO, Add Assets, Receive (dirty = something the person typed; remembered defaults do not count).
* Manual PO draft in `sessionStorage` (`po-draft.ts`): written while dirty, restored after a reload with "The purchase order you were typing before the page reloaded is back. · Start again", cleared on save and on Start again.
* Tests: beforeunload only when dirty (PO, Receive, Add Assets), in-app navigation asks and stays on Cancel, draft restore / start again / cleared after save, `isAddInputDirty`.

### O. P2-13 Send to Store vs Stock Room
* "Return to Stock Room" is now **"Move to Stock Room"** (done word "moved to the stock room"); "Send to Store" unchanged. One sentence under the choices: "Send to Store: the assets are with the store itself. Move to Stock Room: they are kept in a stock room (a store's own stock room, STK-…, is in that list too)."; with Send to Store the destination says "The assets will be with this store." Events and behaviour unchanged.

### P. Final-review gaps
1. **ERP review barcode optional**: no "barcode is required" problem, no required marker ("Optional."), an empty barcode is sent as `null`. Test.
2. **Full Admin Catalogue**: `guardedCatalogue()` route guard for `/settings/catalogue/items` and `/asset-groups` (head-office admin always; a Full Admin when `can_manage.item` / `category` or `can_create.item`; everyone else no access). Sidebar for such an ADMIN: a "Settings" section with Items, Asset Groups, Link Assets to Items. Items screen: New Item by `can_create.item`; Edit/Deactivate per row only inside `domain_manage_work_areas`; ERP links column, ERP Mapping and "Create from Sub-categories" only with `item_rules` (head-office). Asset Groups: Add Group by `can_create.category`, work-area choices limited to the person's areas (changing a group's area needs `change_work_area`), edit / deactivate / + Sub-category / bulk tick only on their own area's groups ("Looked after by the Admin / Non-IT Team" on the others), Import/Export only with `imports`. Brands and Vendors stay head-office only. Tests (router guards with/without capabilities, sidebar, Asset Groups as ADMIN_IT).
3. **Users & Access for a Full Admin**: `/settings/users-access` now opens for every ADMIN (area "people", like the four lists) and is in their People & Places menu (the head-office admin keeps it under Settings). Tests.
4. P3 polish:
   * P3-1 Pick from ERP says "ERP data as of" once (the envelope line is shown only when the sync line is not shown, or for a problem). Test.
   * P3-3 Asset 360 warranty: nothing for 0 years (never "0 years · until <today>"). Test.
   * P3-4 Assets: Description shows "—" when it only repeats the Item; holder names drop the old auto-made "Stock Point - " prefix and a place equal to the name; Serial Pending: "Type of asset" column (without repeating the Item), description not printed twice. Tests.
   * P3-5 Move: the reasons choices are off are visible text ("Not possible now: Mark Found (only an admin can do this)."), the title stays; "None of these assets can be sold." Tests.
   * P3-6 ERP Data Sync "Refresh now" shows "Checked just now (6:46 pm): copied 3 new PO lines, 1 changed PO line." / "… the ERP had nothing newer to copy." Tests.
   * P3-12 Serial Pending asks `sort_by=purchase_date&sort_dir=asc` and sorts oldest first with the lower id first within a day, so the first pasted serial goes to CKAM1, not CKAM10. Test.
   * P3-13 a company with exactly one Cost Centre has it chosen already (Manual PO, Add Assets, ERP review — `useRememberedDefault`). Tests.
   * P3-9 a self-service login opening `/dashboard` is sent to `/my-assets`. Reports stay staff-only in the menu and route (the server now 403s). Test.
   * P3-7 cancelled PO: summary "Ordered units" includes cancelled (uses `originally_ordered` when sent) + a "Cancelled units" tile; the line table shows "15 · 15 cancelled"; the PO list shows "15 (15 cancelled)" (uses `originally_ordered_units`); no "Receive all waiting" once nothing is waiting. Tests.

### Backend §15 extras wired
* Bulk Import (add mode): help text names **Item** (decides Category / Sub-category / work area; codes and Description may stay empty), **Received Into Code**, Vendor Code optional; preview shows an **Item** column and "Type of asset". Test.
* Line types gained `originally_ordered` / `cancelled_value`; PO rows `originally_ordered_units`; Home `erp_unavailable`; setup `company_*`.

## 2. Files
New: `src/lib/submit-key.ts`, `src/lib/submit-key.test.tsx`, `src/lib/request-key.ts`, `src/lib/unsaved-changes.ts`, `src/features/items/useMyItems.ts`, `src/features/items/suggestion-words.ts`, `src/features/items/suggestion-words.test.ts`, `src/features/purchase-orders/po-draft.ts`, `src/components/ui/dialog.test.tsx`.
Changed (source): `lib/api-client.ts`, `lib/labels.ts`, `lib/remembered-defaults.ts`, `router.tsx`, `test-setup.ts`, `components/app-shell/{AppNav,RouteGuard}.tsx`, `components/ui/dialog.tsx`, `components/shared/SearchableSelect.tsx`, `components/quick-create/{QuickCreateDialog,StockRoomSelect,masters}.tsx`, `features/assets/{AddAssetsForm,AssetDetail,AssetMovement,AssetRegister,SerialPendingScreen,actionRules}`, `features/asset-groups/AssetGroupsScreen.tsx`, `features/dashboard/Dashboard.tsx`, `features/erp/{DeliveryReminders,ErpInbox,ErpPiDialog,ErpSyncStatus}.tsx`, `features/imports/ImportScreen.tsx`, `features/items/{ItemsScreen,LinkAssetsScreen}.tsx`, `features/numbering/CodeRuleScreen.tsx`, `features/people/{AddEmployeeDialog,AddStoreDialog,EditPersonDialog}.tsx`, `features/purchase-orders/{InvoicesCard,LineEditDialog,NewPurchaseOrderForm,PoDraftCard,PoFromErp,PoLinesTable,PurchaseOrderDetail,PurchaseOrdersList,po-detail-types,po-list}`, `features/receive/{ReceiveQueue,ReceiveScreen}.tsx`, `features/settings/{SetupHomeRow,SetupWizard,setup-progress}`.
Changed (tests): the matching `*.test.ts(x)` files listed by `git status` (intended changes only: "Return to Stock Room" → "Move to Stock Room"; `/items` → `/items?work_area=mine` mocks; reminders path `?envelope=true`; one Cost Centre is now preselected — tests that needed an empty Cost Centre got two; group Details opened before its controls; Finish opens a summary; "% match" → "Similar name (50%)"; Division "not tracked" confirmed; Sell/Scrap/Dispose confirmed; a PO with nothing waiting has no Receive-all button; self-service `/dashboard` redirect; `/settings/users-access` for ADMIN; nav for ADMIN has "Users & Access"; PI error shown as a note).

## 3. Decisions where the brief was open
1. Key handling by **payload fingerprint** (stable JSON): the same data after a failure keeps its key, any change gets a new one, a success always renews — no "dirty after failure" bookkeeping per screen. The backend releases a failed key, so a same-payload retry is safe.
2. 409 in flight: ask again with the same key a few times (≈3.4 s), then stay silent — the first submit shows its own result.
3. The key reaches the request through a synchronous ambient scope (not a 3rd `post()` argument), so ~150 existing exact-argument assertions stay untouched.
4. "Not tracked" default for non-head-office: **product name** when the line has one (narrow, but follows the same product to its other codes), else the code; confirmation only for group-wide reaches.
5. Move: "Return to Stock Room" renamed "Move to Stock Room" (the brief's word; moving to a store's own room is not a "return"). Add by Item / Currently With kept visible on their own rows (no collapse) to keep every capability one look away; Apply made sticky.
6. Dialog footers sticky globally (one change for every long dialog) rather than per dialog.
7. Test infrastructure: Testing Library `asyncUtilTimeout` 2.5 s (the suite grew to 77 files running in parallel; two runs showed timing-only `findBy` timeouts at ~1.1 s in the heavy Add Assets file before this; 4 consecutive full runs green after it). Also `useUnsavedChangesWarning` registers the router blocker once (a per-render re-registration had slowed typing-heavy tests).
8. Catalogue for a Full Admin is gated by capabilities (async); while they load the route shows "Loading…", never a flash of the screen.

## 4. Not done / limits
* **Undo of a "Not tracked" rule needs the rule id**: `POST /api/erp/pos/{po}/not-tracked` does not return `map_id` today, so the head-office admin sees "To undo it, open Settings › ERP Mapping." The Undo button appears as soon as the server adds `map_id` (backend request below).
* `rooms_created` from the general Asset User form is not shown (the store paths CKAM uses are `/people/stores`, which already shows its rooms).
* MasterCrudScreen's generic select `onCreateNew` and the ERP mapping screens' "New Item…" still open without the typed name (the ERP screens prefill the ERP product name already).
* `/api/assets/{id}/events` is not called by the frontend (Asset 360 moves go through Move's bulk-action), so nothing to wire there.
* The Manual PO page itself has no sticky footer (it is short at 1366; the brief asked for one on Move).

## 5. e2e strings touched (static strings only; Playwright not run)
* `e2e/asset-lifecycle.spec.ts`: "Return to Stock Room" → "Move to Stock Room".
* `e2e/bundle-journey.spec.ts`: after a full receipt the "Receive all waiting" button is **absent** (`toHaveCount(0)`) instead of disabled.
* Checked, unchanged: "New Vendor…/New Item…" picks without typing keep their exact names; PO detail `row` "Line N:" selectors (detail table unchanged); manual-PO fields keep their labels ("Line 1 Item", "Line 1 Quantity", …); "Barcode" labels.
* Behaviour the controller may meet in e2e: Sell/Scrap/Dispose on Move need a confirm click; a company with one Cost Centre starts with it chosen; the ERP review's Not tracked defaults to "This product name"; leaving a typed manual PO / Add Assets / Receive asks a `confirm` (Playwright dismisses dialogs by default → stays on the page unless the spec accepts it).

## 6. Backend requests
1. Return the saved rule id (`map_id`) from `POST /api/erp/pos/{po_code}/not-tracked`, so the head-office admin's **Undo** can appear right in the review.
2. `GET /api/assets?sort_by=…&sort_dir=asc` breaks ties by `id DESC`; with `asc` it should be `id ASC` (Serial Pending pages oldest first; the screen re-sorts per page, but across the 200-row page boundary the server's tie-break decides).
3. (Optional) `GET /api/erp/pos?envelope=true` freshness and `/erp/sync` say the same thing twice; the screen now shows one — a single source would remove the coordination.
