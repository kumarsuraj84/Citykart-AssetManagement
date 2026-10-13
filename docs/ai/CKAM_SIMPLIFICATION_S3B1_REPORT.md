# CKAM Simplification — Stage S3b-1 report (frontend: in-flow creation of small masters, stock-room pickers, smart defaults)

| | |
|---|---|
| Starting HEAD | `bdeb2ac` (feat(web): S2 PO page by line …) |
| Scope | Frontend only (`frontend/src`, `frontend/e2e`) plus this report. No backend, database, API or deployment change. Not committed (the controller commits). A backend agent was editing `backend/` at the same time (S3a-2 files); nothing there was touched. |
| Contract consumed | `docs/ai/CKAM_SIMPLIFICATION_S3A1_REPORT.md` §2–§3, §9 (`GET /api/auth/capabilities`, `POST|GET /api/stock-rooms`, optional `code` on vendor / brand / cost centre, work-area sentences) |
| Tests | `npx tsc -b` clean · `npx vitest run` **707 → 810 passed** (63 → 67 files, 0 failed) · `npm run build` succeeds (the existing >500 kB chunk warning only) · e2e specs type-checked, Playwright not run |

## 1. What changed, by brief item

| # | Item | What was done |
|---|---|---|
| 1 | One capabilities source | New `src/lib/capabilities.ts`: `useCapabilities()` (React Query, `GET /api/auth/capabilities`, `staleTime: Infinity`, key = person + the token's tail, so it is asked again on every login and token refresh; a refresh for the same person keeps the last answer meanwhile, so nothing blinks; another person never sees the previous answer), `useCanCreate(kind)`, `useCanManage(key)`, pure helpers (`parseCapabilities`, `canCreate`, `canManage`, `itemCreateAreas`, `domainManageAreas`, `inAreas`) and the "ask someone" sentences (`ASK_TO_ADD`). While loading → no create control; on failure or an odd answer → no create control (the server stays the authority). **`useCanCreateMasters()` is deleted**; every former use now reads a specific flag (table in §3). Route guards from S1 unchanged. |
| 2 | Quick-create dialogs | `QuickCreateDialog` gained a collapsed **More** section, conditional fields, an optional custom "can save" rule, a note line, and **"Use the existing “X”"** after a duplicate-name refusal; it already never closed on error. Wrappers (`components/quick-create/masters.tsx`): **Vendor** = Name* + GSTIN (optional) + More: contact person / phone / email; **never sends `code`** (blank optional fields sent as `null`). **Brand** = Name only (`{name}`). **Cost Centre** = Name only, company from the task (`{company_id, name}`). **New `NewStockRoomDialog`** = Name* + Place (pick a Place of that company or "A new place (type its name)"; a company with no Place asks for the name straight away) → `POST /api/stock-rooms {name, company_id, location_id | location_name}`; company implied by the task, a Company field only where the task has none (Move), with a single allowed company pre-chosen; a 200 "already exists" answer is simply picked (note in the dialog says so). **Category** = Name + Work area limited to `domain_manage_work_areas` (one area → already chosen) + Code under More (suggested from the name, S6a rule; the server still requires it). **Sub-category** = Category (only the person's own work areas; "New Category…" only with `can_create.category`) + Name + Code under More. |
| 2 | Item form | The shared `ItemFormDialog`: the "Type of asset" list shows only types of `item_create_work_areas` (an edit: `domain_manage_work_areas` + the Item's current type); **New type…** only with `can_create.sub_category` (and only inside the person's areas, via the Sub-category dialog); otherwise a calm note "The type you need is not listed? Ask the head-office admin to add this type of asset." (a group without a Sub-category says "… Ask the head-office admin to add this type of asset."); New Brand… by `can_create.brand`; a part's New Item… by `can_create.item`; **"Comes as a set"**: only the head-office admin (`can_manage.bundle`) makes or changes a set — anyone else may only point the Item at an existing set ("The set it comes as", no `/bundles` call). Server sentences (work area, duplicate name) shown in the dialog verbatim; the dialog stays open. |
| 3 | Applied where a missing master blocks a task | Add Asset (Vendor, Brand, Item, Cost Centre, Received Into); New PO (Vendor, Cost Centre, Received Into); PO page Add Line + Edit line (Item, Brand); Receive (delivery) dialog (Received Into); ERP review header + lines (Cost Centre, Received Into, Item, Brand — **no vendor creation**, the vendor stays the ERP supplier's linked vendor); Move ("Move To" gets **New Stock Room…**; people and stores are never created inline); Asset 360 Edit (Brand, Vendor); Item form brand / part Item; Bundles screen part Item; ERP Mapping screens' New Item. Dead-end texts replaced (§4). |
| 4 | Stock-room pickers | New `StockRoomSelect` + `useStockRooms` (`components/quick-create/StockRoomSelect.tsx`): `GET /api/stock-rooms?company_id=` (Move's source: `GET /api/stock-rooms`, every company of the person), option "**Name · Place · Company code**" through the central `stockRoomOptions(…, {showCompany: true})`, "+ New Stock Room…" for whoever may, and a calm line when the company has none. Used by Add Asset, New PO, ERP review, Receive dialog; Move's "Currently in stock at" uses the rows directly. No picker filters asset users by type any more. |
| 5 | Remembered defaults | New `src/lib/remembered-defaults.ts`: last-used Cost Centre and Received Into stock room per person (asset-user id) and company in `localStorage` (`ckam:last-used:<user>:<company>`), every read/write guarded. Saved only after the task succeeded (Add Asset save, PO create, ERP create, Receive). Pre-chosen on Add Asset / New PO / ERP review / Receive when nothing is chosen yet and the record is still in the loaded list; the ERP draft's own values and the PO's delivery place always win; a vanished record is silently forgotten. A single allowed company stays pre-chosen as before (Add Asset, New PO) and now also in the stock-room dialog. |
| 6 | Refusals | Every quick-create keeps the dialog open with the server's sentence (duplicate name, work area, company scope); a duplicate vendor / brand / cost centre offers the existing active record with the same name. |
| 7 | Tests | §5. |

## 2. Files

New: `src/lib/capabilities.ts`, `src/lib/remembered-defaults.ts`, `src/components/quick-create/StockRoomSelect.tsx`, `src/test-capabilities.ts` (fixtures for head-office admin, ADMIN both, ADMIN IT-only, OPERATOR IT, VIEWER + `withCapabilities` mock helper); tests `src/lib/capabilities.test.tsx`, `src/lib/remembered-defaults.test.tsx`, `src/lib/no-owner-gate.test.ts`, `src/components/quick-create/quick-create.test.tsx`.

Changed: `components/quick-create/{QuickCreateDialog,masters}.tsx`; `features/assets/{AddAssetForm,AssetDetail,AssetMovement}.tsx`; `features/purchase-orders/{NewPurchaseOrderForm,PoDraftCard,PurchaseOrderDetail,LineEditDialog,DeliveryDoneDialog,AddBundleDialog}.tsx`; `features/items/{ItemFormDialog,ErpCodesView,CodeDecisionRows,ArticleMapScreen}.tsx`; `features/bundles/BundlesScreen.tsx`; `features/asset-users/AssetUsersScreen.tsx`; `test-setup.ts` (clears `localStorage` after each test).

Tests changed: `AddAssetForm.test.tsx`, `NewPurchaseOrderForm.test.tsx`, `PurchaseOrderDetail.test.tsx`, `PoFromErp.test.tsx`, `AddBundleDialog.test.tsx`, `AssetDetail.test.tsx`, `AssetMovement.test.tsx`, `MoveDispatchLabels.test.tsx`, `AssetUsersScreen.test.tsx`, `BundlesScreen.test.tsx`, `item-form.test.tsx`, `items-screens.test.tsx` (mocks answer `/auth/capabilities` and `/stock-rooms`; Code now under More; owner-only expectations rewritten to capability expectations).

e2e (static only, type-checked, not run): `e2e/inline-create.spec.ts` opens **More** before typing the Category / Sub-category codes (`#qc-cat-code`, `#qc-code` unchanged), comment updated. Other specs pick "Received Into" by the stock room's name through `optionMatcher`, which accepts the new "· Place · Company" suffix — no change needed. No fixture assumed owner-only quick-create.

## 3. Owner-only gate → capability flag

| Where | Before | After |
|---|---|---|
| Vendor "+ New" (Add Asset, New PO, Asset 360 Edit) | `isPrimaryOwner` | `can_create.vendor` |
| Brand "+ New" (Add Asset, PO Add Line / Edit line, ERP lines, Item form, Asset 360 Edit) | `isPrimaryOwner` | `can_create.brand` |
| Cost Centre "+ New" (Add Asset, New PO, ERP header) | `isPrimaryOwner` | `can_create.cost_centre` |
| Stock room "+ New" (Received Into everywhere, Move To) | did not exist | `can_create.stock_room` |
| Item "+ New" (Add Asset, PO lines, ERP lines, set parts, Bundles, ERP Mapping screens) | `isPrimaryOwner` | `can_create.item`; type list by `item_create_work_areas` |
| New type… / New Category… | `isPrimaryOwner` | `can_create.sub_category` / `.category`, areas `domain_manage_work_areas` |
| Make / change a set in the Item form | anyone who saw the form | `can_manage.bundle` |
| ERP "Not tracked" | `isPrimaryOwner` | `can_manage.item_rules` |
| People & Places: New Place / New Department / Stores from ERP | `isPrimaryOwner` | `can_manage.location` / `.department` / `.erp_setup` |

Grep: `useCanCreateMasters` occurs nowhere (asserted by `no-owner-gate.test.ts`, which also asserts no `onCreateNew`/`onNewItem` line uses the owner flag).

## 4. UX before → after (dead ends)

| Where | Before | After |
|---|---|---|
| Add Asset, company without a cost centre | "No active cost centres are configured for this company. Ask the head-office admin to add one under Settings › Organisation › Cost Centres." (red) | "+ New Cost Centre…" in the list; note "This company has no cost centre yet. Add one with “New Cost Centre…” in the list." — or, for someone who may not, "… Ask an admin or the head-office admin to add a cost centre." |
| Add Asset, company without a stock room | "No Stock Room found for this company. An admin can add one under People & Places › Stock Rooms." (red; operators cannot open it) | "+ New Stock Room…" (name + place), picked at once |
| Any vendor / brand / Item missing (operator, ordinary admin) | no "+ New" at all (head-office only) → leave the task | "+ New Vendor / Brand / Item…" in the picker; created, picked, back on the same task |
| Item form, type of asset missing | "Ask the head-office admin to add one (Settings › Catalogue › Asset Groups)." for everyone but the head-office admin | ADMIN creates the type inside their own work area ("New type…"); an operator sees "Ask the head-office admin to add this type of asset." |
| ERP review, supplier not linked | "Add or link it in Vendors first." (Vendors is head-office Settings) | head-office admin: "Add or link it in Settings › Vendors first."; others: "Ask the head-office admin to link it to a vendor." |
| Add Set, no sets yet | "The head-office admin can make one on an Item (Settings › …)" | head-office: "Make one on an Item (Settings › Catalogue › Items, “Comes as a set”)."; others: "Ask the head-office admin to make one (an Item that “Comes as a set”)." |
| Received Into lists | people filtered by type (`/asset-users?asset_user_type=STOCK_POINT` or all users filtered client-side); delivery dialog listed every person/store | `/stock-rooms`, "Name · Place · Company code" |
| Each Add Asset / PO / Receive | Cost Centre and stock room chosen every time | the last ones used (per person, per company) are already chosen |
| Vendor / Brand / Cost Centre quick-create | Name + Code (Code suggested, required) | Name only (vendor: + GSTIN, More: contacts); the server makes the code |

Visual identity unchanged: same compact dialogs, muted notes (`text-xs text-muted-foreground`), the existing "+ …" entry at the foot of each searchable list.

## 5. Tests (707 → 810, +103; 0 failing)

| File | Tests | What |
|---|---|---|
| `lib/capabilities.test.tsx` (new) | 13 | parse / odd answers; per-kind item / type areas (5 kinds); `inAreas`; sentences; hook: nothing while loading, exact flags after, hidden on failure, asked once, again after token refresh without blinking, other person never sees previous answer, not asked when signed out |
| `lib/remembered-defaults.test.tsx` (new) | 7 | per person / company / kind; nothing without person / company / value; broken or blocked storage; applies only a still-valid id, never overrides a choice, waits for the list |
| `components/quick-create/quick-create.test.tsx` (new) | 17 | vendor body without `code` (+ contacts under More, GSTIN null); duplicate vendor / brand → sentence + "Use the existing"; brand `{name}`; cost centre `{company_id, name}`; cost-centre company refusal; stock room by `location_id`, by `location_name`, company with no place, company chooser (single company pre-chosen), 200-existing picked, refusal keeps dialog; Category areas for IT-only admin (pre-chosen, code under More, body) and head-office; Sub-category categories by area + New Category…; work-area sentence verbatim |
| `lib/no-owner-gate.test.ts` (new) | 5 | `useCanCreateMasters` gone; no "+ New" decided by the owner flag; dialogs read capabilities; old dead-end sentences gone |
| `AddAssetForm.test.tsx` | 24 → 34 | 5 kinds × (Vendor, Brand, Item, Cost Centre, Received Into); new vendor no code + auto-select + form kept; new stock room in new place + auto-select; who-to-ask sentences; remembered defaults round trip; stale remembered ignored; stock rooms from `/stock-rooms?company_id=1` with place + company code |
| `NewPurchaseOrderForm.test.tsx` | 6 → 14 | 5 kinds × (Vendor, Cost Centre, Received Into); new cost centre `{company_id, name}` picked; stock-room labels / endpoint; remembered defaults sent |
| `PurchaseOrderDetail.test.tsx` | 49 → 62 | 5 kinds × Add Line (Item, Brand); 5 kinds × Edit line; Receive: `/stock-rooms`, add a stock room inside Receive and stay; viewer gets none; remembered stock room used and saved |
| `PoFromErp.test.tsx` | 24 → 33 | 5 kinds × (Cost Centre, Received Into, Item, Brand) and never a new vendor; stock-room endpoint + labels; unlinked-supplier sentence for others vs head-office; remembered defaults only where the ERP gave none |
| `AssetMovement.test.tsx` | 16 → 23 | source from `/stock-rooms` (no create on the source); 5 kinds × Move To New Stock Room (never a new person); company pre-chosen in the dialog and body |
| `AssetDetail.test.tsx` | 49 → 55 | 5 kinds × Edit (Brand, Vendor); brand added in Edit is picked and saved |
| `item-form.test.tsx` | 18 → 26 | 5 kinds × (type list by area, New type…, calm note, New Brand…); operator adds an IT Item; work-area refusal verbatim; non-head-office may only use an existing set |

## 6. Decisions taken where the brief was open

1. **Who-to-ask sentences** follow the server's rule: small masters "Ask an admin or the head-office admin to add a vendor / brand / cost centre / stock room / the Item." (an ADMIN can add them too); types "Ask the head-office admin to add this type of asset." (brief wording). Shown only once the capabilities answer is in (or failed), never as a flash.
2. **Category / Sub-category Code** stays (the server requires it, B9 still open) but is hidden under More, suggested from the name with the S6a rule, and opens by itself only if no suggestion could be made.
3. **Receive dialog's Received Into** now lists the PO company's stock rooms (was every person / store / stock room); the PO's own delivery place stays choosable when it is not a stock room, so no older PO loses its default.
4. **Move**: "Currently in stock at" (Add by Item source) lists stock rooms but never offers to create one (a new room holds nothing); "Move To" (mixed people / stores / stock rooms) offers only **New Stock Room…**; the dialog asks for the company because Move has none.
5. **Sets**: making / changing a set is head-office (`can_manage.bundle`, server rule); others may point a new Item at an existing set only.
6. **Stock-room option label** always shows the company code (brief: "Name · Place · Company code"), even when the list has one company.
7. **Capabilities query key** uses the token's last 24 characters, not the token itself; `retry: 1`; it is not cleared on logout (the next person's key differs).
8. **Remembered defaults** are saved only after success, applied once per screen and company, and never override a value that is already there (ERP draft, PO delivery place, a choice made).
9. **"Use the existing …"** after a duplicate refusal is offered only when that active record is in the list the screen already has.
10. **ERP vendor** is not created in the ERP review (a later stage matches vendors); the review only says whom to ask.

## 7. Deferred / not done

- ERP vendor matching / creation inside the ERP review (later stage, as briefed).
- Item pickers still list every Item (other team's too); `GET /items` rows carry `work_area`, but filtering existing Items was not in this brief (see request a).
- Settings › Vendors / Brands / Cost Centres / Items / Asset Groups screens keep their head-office route guards; opening them to ADMIN/OPERATOR (S3A1 §9.5–9.7) is a later stage. Nothing was removed.
- Category / Item work-area move with `confirm_domain_change` (S3A1 §9.4) is not used by any in-flow dialog (create only); the Asset Groups screen's confirmation still sends the old body.
- Header role words still come from the auth store (`roleLabel`), not `role_label` (same words).
- No browser / visual pass (docker not touched). Recommended after `docker compose up -d --build web`: Add Asset as an operator (New Vendor, New Stock Room with a new place), Receive dialog with "+ New Stock Room…", Item form as an IT-only admin (type list, New type…), Move To "New Stock Room…".
- Playwright not run; `inline-create.spec.ts` updated statically.

## 8. Backend requests

| # | Request | Why |
|---|---|---|
| a | `GET /api/items?work_area=mine` (or filter by the caller's areas) | Item pickers show the other team's Items to a one-area user; the screen could filter on `work_area`, but a server filter keeps every client consistent. |
| b | Say whether `POST /api/stock-rooms` created or reused (e.g. `"created": false`) | `apiClient` hands back only the body; the dialog can only say beforehand "if it exists, that one is picked". |
| c | Optional Category / Sub-category codes (server generates; B9) | The dialog still has to send a suggested code. |
| d | Company names in `GET /auth/capabilities` (`companies: [{id, code, name}]`) | The stock-room dialog's company chooser reads `/asset-users/me/companies` separately. |
| e | Let ADMIN/OPERATOR create a set (bundle) together with an Item (B6 + permission) | Today only the head-office admin can make sets, so an operator's "Comes as a set" can only reuse an existing set. |
| f | `GET /api/erp/vendors` (supplier suggestions) for writers within company scope | Needed for the later in-review vendor matching (S3A1 §8). |
