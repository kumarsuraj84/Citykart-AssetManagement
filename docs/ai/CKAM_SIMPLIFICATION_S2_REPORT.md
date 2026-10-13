# CKAM Simplification — Stage S2 report (PO by line, PO list progress, PO delete safety)

## Backend

| | |
|---|---|
| Starting HEAD | `49fdec9` (fix(security): S0 head-office admin protection, …) |
| Scope | Plan §3 S2.1 (line-group API), S2.3 (PO list fields/filters), S2.4 (exact PO line identity), the owner's PO-delete safety rule, the S1 backend requests (a)–(d), and the S0 leftovers of `CKAM_SIMPLIFICATION_S0_REPORT.md` §8 |
| Frontend | not touched (another agent owns `frontend/`) |
| Database | **one additive migration** `b8d0f2a4c6e8_pending_asset_line_no` (see §3) |
| Commit | none (the controller commits) |
| Tests | backend **748 → 813 passed**, 0 failed (`docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q`) |

### 1. What changed, by item

| # | Item | What was done | Status |
|---|---|---|---|
| S2.4 | Exact PO line identity | `pending_asset.line_no` (nullable integer, 1..n per PO) + index `(purchase_order_id, line_no)`; deterministic backfill in the migration; one helper `purchase_orders.service.next_line_no` used by every creation path; `line_no` added to `PendingAssetOut`; an edited / cancelled unit keeps its number | done |
| S2.1 | Line-group API | `GET /{id}/line-groups`, `GET /{id}/line-groups/{line_no}/units`, `PUT /{id}/line-groups/{line_no}`, `POST /{id}/line-groups/{line_no}/cancel-waiting`, `POST /{id}/cancel-waiting`; SQL aggregation (2 queries per PO, constant however many units); S0 work area, company scope, deleted-PO and inactive-master rules; per-unit endpoints unchanged | done |
| S2.3 | PO list | additive `company_name`, `vendor_name`, `ordered_units`, `received_units`, `waiting_units`, `cancelled_units`, `status` on `GET /api/purchase-orders` (one aggregated query) and on `GET/POST /api/purchase-orders[/{id}]`; query params `status`, `waiting`, `q`, `limit` (default 200, max 500), `offset`; total in `X-Total-Count` | done |
| S2 | PO delete safety | `DELETE /api/purchase-orders/{id}` refused for **everyone** (head-office admin included) when any unit is delivered → 409 "… Cancel the waiting items instead."; no PO delete ever soft-deletes assets now (`deleted_assets` is always 0) | done |
| S1 (a) | Who is signed in | `asset_user_id` added to the login and refresh responses | done |
| S1 (b) | People list names | `GET /api/asset-users` rows gain `location_name`, `company_code` (two batched lookups per list) | done |
| S1 (c) | Edit keeps what is left out | `PUT /api/asset-users/{id}` now takes `AssetUserUpdateIn` (every field optional, exclude-unset merge over the stored row); explicit null / blank clears where legal; company, code, name, type, location cannot be cleared | done |
| S1 (d) | Movement template column | template column is now "Destination Code"; files with the old "Destination AssetUser Code" header are still read (messages name the header the file used) | done |
| S0 §8 | ERP reminders / changes on mixed POs | `GET /api/erp/reminders`, `GET /api/erp/changes/summary`, `GET /api/erp/purchase-orders/{id}/changes` show a one-area user only POs they may see and only their own area's items | done |
| S0 §8 | ERP apply on mixed POs | `POST /api/erp/purchase-orders/{id}/changes/apply` refuses (403) a per-item change whose units are not all in the caller's area (apply **and** keep), and applying the ERP's PO cancellation while units of the other area still wait | done |
| S0 §8 | Dashboard PO block | `pending_po_summary` and `open_purchase_orders` count only waiting units of the caller's work area (unit snapshot, else its Category's), on POs that are not deleted; the "My Responsibility" selector narrows them too | done |
| S0 §8 | Excel imports and inactive masters | assets (add: company, cost centre, category, sub-category, brand, initial holder, vendor; edit: a newly chosen vendor/brand), POs (company, vendor, cost centre, category, sub-category, brand), movements (destination), all 8 master imports and the asset-user import (any looked-up parent: company, category, location, department) refuse a deactivated record; an active record wins over a deactivated twin with the same code | done |
| S0 §8 | Work-area escalation | an ADMIN limited to IT or Non-IT cannot create or edit anyone into a wider work area than their own (403); editing other details of someone who already had a wider area is still allowed | done |

### 2. API changes (with example payloads)

All changes are additive except the deliberate PO-delete change. Messages are plain sentences.

**`GET /api/purchase-orders/{po_id}/line-groups`** (ADMIN/OPERATOR, company + work-area scoped; works on a deleted PO) → `200 [LineGroupOut]`, in line order, counted over the units the caller may see:
```json
[{"line_no": 1, "item_id": 12, "item_name": "Laptop", "description": "Dell laptop", "barcode": "BC-9",
  "erp_item_code": null, "category_id": 3, "category_name": "Computers", "subcategory_id": 7,
  "subcategory_name": "Laptop", "work_area": "IT", "brand_id": 2, "brand_name": "Dell", "model": "Latitude",
  "warranty_years": 2, "rate": 1000.0, "tax_percent": 18.0, "unit_total": 1180.0,
  "ordered": 3, "received": 1, "waiting": 2, "cancelled": 0, "line_value": 3540.0,
  "status": "PARTLY_RECEIVED", "serial_mode": "HAS_SERIAL", "bundle_label": null, "waiting_unit_count": 2}]
```
* `ordered = received + waiting` (cancelled units are no longer ordered); `line_value` = sum of `total_cost` (incl. tax) of the ordered units, 2 dp; `unit_total` is additive (the template unit's cost incl. tax).
* `status`: everything cancelled → `CANCELLED`; nothing waiting → `RECEIVED`; received > 0 and waiting > 0 → `PARTLY_RECEIVED`; otherwise `WAITING`.
* `serial_mode`: `SERIAL_LATER` (unit's `serial_later`), else `NO_SERIAL` (`serial_required=false`), else `HAS_SERIAL`.
* The descriptive fields come from the line's template unit: the newest waiting unit, else the newest received, else the newest cancelled one.

**`GET /api/purchase-orders/{po_id}/line-groups/{line_no}/units?status=WAITING|RECEIVED|CANCELLED`** (also `PENDING`/`DELIVERED`, any case) → `200 [PendingAssetOut]` ordered by id; 404 "This PO line was not found." (including a line wholly in the other work area); 422 "Choose a status: waiting, received or cancelled."

**`PUT /api/purchase-orders/{po_id}/line-groups/{line_no}`** → `200 LineGroupOut`. Body `LineGroupUpdateIn` — every field optional, only the fields sent change:
```json
{"description": "Laptop 14 inch", "barcode": "BC-9", "item_id": 12, "category_id": 3, "subcategory_id": 7,
 "brand_id": 2, "model": "X1", "warranty_years": 2, "purchase_cost": 900, "tax_percent": 18, "quantity": 5}
```
* Descriptive/price fields: same limits and validation as `PUT /lines/{line_id}` (blank description, inactive brand/category/sub-category/Item, tax 0–100, warranty 0–100, cost ≥ 0, moving to the other work area → 403); applied to **every still-waiting unit** of the line; received and cancelled units never change.
* `quantity` (0–1000) = the new ORDERED total. Higher → units copied from the line (same `line_no`, the edited values, the line's serial snapshot / bundle label / ERP code). Lower → the surplus waiting units are cancelled, newest first. Refused: below what has been received ("2 of this line have already been received, so the quantity cannot be less than 2."), above 1000.
* 422 "Nothing was changed." (empty body); 422 "Nothing on this line is still waiting, so there is nothing to change." (fields sent, nothing waiting, no increase); 422 deleted PO; 404 unknown line.

**`POST /api/purchase-orders/{po_id}/line-groups/{line_no}/cancel-waiting`** body optional `{"quantity": 2}` (1–1000; omitted = all) → `200 LineGroupOut` after the change; cancels the most recently added waiting units first. 422 "Nothing on this line is still waiting." / "Only 3 of this line are still waiting."

**`POST /api/purchase-orders/{po_id}/cancel-waiting`** (no body) → `200 {"cancelled_units": 4, "status": "RECEIVED"}`; cancels every waiting unit of the PO **that the caller may see**; the PO stays active; `status` is the PO's status afterwards (`RECEIVED` if something was received, else `CANCELLED`). 422 "Nothing on this purchase order is still waiting."

**`GET /api/purchase-orders`** — new query params `status` (`WAITING|PARTLY_RECEIVED|RECEIVED|CANCELLED`, any case; else 422 "Choose a status: waiting, partly received, received or cancelled."), `waiting` (`true` = only POs with waiting units — the Receive queue; `false` = none waiting), `q` (PO number or vendor name, ≤ 200 chars, `%`/`_` literal), `limit` (1–500, default 200), `offset` (≥ 0). Header `X-Total-Count` = total before paging. Each row gains:
```json
{"company_name": "Citykart Stores Pvt Ltd", "vendor_name": "VANSH ENTERPRISES", "ordered_units": 47,
 "received_units": 0, "waiting_units": 47, "cancelled_units": 0, "status": "WAITING"}
```
A PO with no lines yet is `WAITING` with zero counts. Counts and status are over the caller's work area. `GET /{id}` and `POST ""` return the same additive fields.

**`DELETE /api/purchase-orders/{po_id}`** — changed: any delivered unit → **409** for everyone: "This purchase order already has received items, so it cannot be deleted; its received assets must stay in the register. Cancel the waiting items instead." (previously 403 for non-owners and 200 + soft-deleted assets for the head-office admin). No received unit → 200 `{"cancelled_lines": n, "deleted_assets": 0}` as before (work-area rule unchanged).

**`PendingAssetOut`** (every endpoint returning PO units) gains `"line_no": 1`.

**Auth** — `POST /api/auth/login`, `POST /api/auth/refresh` gain `"asset_user_id": 17`.

**Asset users** — `GET /api/asset-users` rows gain `"location_name": "HO"`, `"company_code": "CKSPL"`. `PUT /api/asset-users/{id}` accepts a partial body, e.g. `{"name": "Ravi K"}` keeps role, login, email, work area…; `{"allowed_asset_domains": null}` clears the work area (= both); `{"email": " "}` clears the email; `{"company_id": null}` → 422 "Choose the company." (also location / type / code / name / role). A full body works exactly as before. On an edit, the "work area only with login" rule applies to work-area values the request **sends**; a stored one left out stays (switching login off no longer fails or silently widens). New 403 (create and edit) for an ADMIN limited to one area: "You handle only IT work, so you cannot give anyone a wider work area than your own. Set their work area to IT, or ask the head-office admin."

**ERP** — reminders / changes summary / per-PO changes filtered by work area (see §1); apply → 403 "This change also affects Non-IT items of this purchase order, which are outside your work area. Ask someone who handles both, or the head-office admin."

**Imports** — new row error for deactivated records, e.g. "Vendor Code 'S0VX' (Closed Vendor) is no longer active; use another."; movement template header "Destination Code" (old header accepted).

**Dashboard** — `pending_po_summary` / `open_purchase_orders` now follow the work area and exclude deleted POs (shape unchanged).

### 3. DB change

* Migration **`b8d0f2a4c6e8_pending_asset_line_no`** ("PO lines get a number: pending_asset.line_no"), down-revision `f6b8d0e2a4c5`. Additive only: `pending_asset.line_no INTEGER NULL` + index `ix_pending_asset_po_line_no (purchase_order_id, line_no)`. Downgrade drops both.
* **Backfill rule** (inside the migration, `BACKFILL_SQL`): per purchase order, units are grouped by `(item_id, erp_item_code, description, barcode, category_id, subcategory_id, brand_id, model, warranty_years, purchase_cost, tax_percent, bundle_label)` — NULLs equal — and the groups are numbered 1..n by the smallest unit id of each group (`DENSE_RANK` over `MIN(id)`). Delivered and cancelled units are numbered like any other. Nothing else on any row changes. Running it twice gives the same numbers.
* Verified: dev `ckam` and test `ckam_test` upgraded to `b8d0f2a4c6e8` (dev: 217 units → 9 lines, 0 unnumbered, matching a GROUP BY of the natural key run beforehand); a fresh empty database migrated from zero to head; `downgrade -1` then `upgrade head` on a scratch database seeded with pre-S2 rows (numbering checked by hand) and on `ckam_test`; scratch database dropped. **Exactly one head** (`alembic heads` → `b8d0f2a4c6e8`; also asserted by a test).
* Forward-compat safety net: a unit written without a number (only possible outside the normal paths) gets one, by the same rule, after the PO's highest, the first time the PO's lines are read (`number_unnumbered_units`).

### 4. Security changes and decisions taken

1. **Line numbering** — `next_line_no` locks the PO row (`SELECT … FOR UPDATE`) so two people adding lines at once never share a number. Every creation path uses it via `add_pending_asset_line`: manual line (one number for the whole quantity), bundle (one per part, shared by that part's units of every bundle in the call), ERP create (one per draft line; per part for a bundle Item), Excel PO import (one per row). The ERP "add units" change adds to the existing line(s) (same numbers; bundle parts matched by part name) rather than opening new lines.
2. **A per-unit edit keeps the unit's line number** even if it now differs from its siblings; the line then shows the template unit's values (newest waiting). The whole-line PUT is the way to keep a line uniform.
3. **Quantity increase = new units** → the line's Item / category / brand must still be active (S0.6 "new work refuses deactivated masters"); keeping an existing choice on an edit is still allowed.
4. **Work area on mixed POs** — line groups, unit lists, line edits, quantity changes and both cancel-waiting endpoints see and touch only the caller's area; a line wholly in the other area is 404 (not revealed). The PO list counts and status are the caller's view (an IT user may see `RECEIVED` on a mixed PO whose Non-IT part still waits).
5. **PO delete** — 409 (state conflict) for everyone once anything was received; the check sits in the service so no caller can bypass it. The S0 work-area check (403) is evaluated first.
6. **ERP changes on mixed POs** — PO-level differences that do not alter units (header notes, vendor change, *keeping* the ERP's cancellation) stay available to anyone who sees the PO; *applying* the cancellation needs every still-waiting unit in the caller's area. Per-item differences whose units are all in the other area are hidden; a per-item difference with any (non-cancelled) unit outside the caller's area is refused for apply and keep. `NEW_ITEM` (no units yet) is shown to both.
7. **Work-area escalation** — "wider" is judged on the *effective* area (no login or self-service = none; unset/BOTH = both); refused only when the result is outside the actor's own area **and** grants something the target did not already have.
8. **Excel imports** — a deactivated vendor/brand already on an asset is not a new choice in edit mode, so it is accepted there.
9. `cancel-waiting` with nothing waiting is 422 (not a silent 200), so a double click shows a message; the frontend should disable the button when `waiting_units == 0`.

### 5. Tests

| | count |
|---|---|
| Backend before (HEAD `49fdec9`) | 748 passed |
| Backend after | **813 passed, 0 failed** |
| New regression tests | **65** in 8 files |

New files: `tests/purchase_orders/test_s2_line_numbers.py` (10: numbering on manual / bundle / ERP create / ERP add-units / Excel import paths, per-PO numbering, edit and cancel keep the number, migration backfill SQL run directly, safety net, single head), `tests/purchase_orders/test_s2_line_groups.py` (19: shape and names, status after partial delivery / cancel / completion, all-cancelled and received+cancelled, serial mode, units endpoint and filters, whole-line edit leaves received units and assets untouched, omitted fields kept, quantity up / up+edit / down / 0 / below received / > 1000, validation, nothing-waiting rules, line and PO cancel-waiting, work area on a mixed PO, company scope / roles / deleted PO, constant query count for 1 vs 480 units), `tests/purchase_orders/test_s2_po_list.py` (8), `tests/purchase_orders/test_s2_delete_safety.py` (4), `tests/asset_users/test_s2_backend_requests.py` (11), `tests/erp/test_s2_erp_work_area.py` (5), `tests/imports/test_s2_imports_refuse_inactive.py` (6), `tests/reports/test_s2_dashboard_po_work_area.py` (2).

Red-before-green evidence: the 65 new tests were also run against an image built from HEAD `49fdec9` (`git archive`, new tests copied in, run against `ckam_test`): **59 failed, 6 passed** — the 6 are deliberate controls (deleted POs left out of the list, a PO with nothing received can still be deleted, the delete work-area check, a full-body asset-user edit, an own-area ERP change, the viewer / deleted-PO dashboard block).

Existing tests changed (intended behaviour change only): `tests/purchase_orders/test_delete_po.py` — an operator deleting a PO with a delivered line now gets 409 (was 403); the head-office admin can no longer delete it and the asset stays (was 200 + soft-deleted asset); the moved-asset case still 409 with the new message.

### 6. Files changed

New: `backend/app/alembic/versions/b8d0f2a4c6e8_pending_asset_line_no.py`; the 8 test files above; this report.
Changed: `app/purchase_orders/{models,schemas,service,router}.py`; `app/bundles/service.py` (line numbers per part, `line_nos` for ERP add-units); `app/erp/{changes,reminders,router}.py`; `app/reports/dashboard_service.py`; `app/auth/{schemas,router}.py`; `app/asset_users/{schemas,router}.py`; `app/imports/{asset_import_service,po_import_service,movement_import_service}.py`; `app/masters/bulk_import_export.py`; `tests/purchase_orders/test_delete_po.py`.

### 7. Frontend contract follow-ups for the controller

1. **PO detail by line**: use `GET /{id}/line-groups` (counts, value, status, serial mode, names) and `GET /{id}/line-groups/{n}/units?status=WAITING` for the unit expander / receive selection; line Edit → `PUT /{id}/line-groups/{n}` (send only changed fields; `quantity` is the new ordered total); line Cancel → `POST /{id}/line-groups/{n}/cancel-waiting` (optional `quantity`).
2. **PO delete**: show the 409 message and offer **"Cancel waiting items"** → `POST /{id}/cancel-waiting`; hide/disable Delete when `received_units > 0`.
3. **PO list**: use the new `company_name`, `vendor_name`, `*_units`, `status`; the Receive queue = `?waiting=true`; search = `?q=`; the list is now paged (default 200) — use `limit`/`offset` and `X-Total-Count` if more are needed.
4. **Asset Users edit**: may now send only the changed fields; sending `null` clears. A limited ADMIN gets 403 when giving a wider work area — show the message.
5. **Login/refresh**: `asset_user_id` is available (e.g. to hide actions on one's own account).
6. **Movement import hint**: the column is "Destination Code" (the old header still works).
7. `PendingAssetOut.line_no` is present on every unit list (`/lines`, add line, bundle lines, deliver responses).

### 8. Observations (not changed)

* A per-unit edit can make units of one line differ; the line view shows the newest waiting unit's values. Consider steering the UI to whole-line edits only.
* `GET /api/purchase-orders` aggregates the whole `pending_asset` table in one subquery per call; fine at today's volumes (hundreds to low thousands of units); add a company filter inside the subquery if it grows large.
* `changes_summary` still reads each PO's lines one PO at a time (pre-existing pattern), now plus one category lookup per PO for one-area users.
* `check_serial_number_unique` still names the conflicting asset code outside the caller's scope on delivery / Add Asset (pre-existing, S0 §8).
* ERP create still does not refuse an ERP PO that is no longer OPEN (S0 §8).
* The Excel PO import's duplicate-PO-number check also matches deleted POs (pre-existing; `create_purchase_order` checks active POs only).

## Frontend

| | |
|---|---|
| Starting HEAD | `13e1354` (feat(web): S0F adapt frontend to S0 contract …) |
| Scope | S2 frontend: PO detail by LINE, after-create wording in lines + units, PO list with progress / status / server search + paging, Receive queue on `?waiting=true`, Home "POs waiting for goods" count, safe cancel / delete wording |
| Backend | not touched (requests in §F7) |
| Commit | none (the controller commits) |
| Tests | `npx tsc -b` clean · `npx vitest run` **682 → 707 passed** (63 files, 0 failed) · `npm run build` OK (the existing >500 kB chunk warning only) · Playwright not run (e2e strings updated) |

### F1. What changed

| # | Item | What was done |
|---|---|---|
| 1 | PO detail = lines | `/purchase-orders/$id` is built from `GET …/line-groups`: one row per line — #, Item (name; description + serial mode under it in muted text; set tag; work-area chip in central words), Ordered, Received, Waiting, Rate (+tax % under it), Value, Status (dot + plain word). Row actions: **Receive** (only when something waits), **Edit**, **Cancel waiting** (only when something waits), **View units**. The three per-unit tables ("Pending Delivery / Delivered / Cancelled"), the tick boxes, the column search boxes and the "Mark N Delivery Done" header button are gone as the primary presentation. |
| 1 | Receive (line / all) | **Receive** on a line fetches `GET …/line-groups/{n}/units?status=WAITING` and opens the *existing* Mark Delivery Done dialog with exactly those units (payload unchanged: one entry per waiting unit id). Header **Receive all waiting (N)** fetches `GET …/lines` and feeds every waiting unit. The dialog was moved unchanged into `DeliveryDoneDialog.tsx` (grouping now also keys on `line_no`; title "Receive N units"; "leave the rest waiting" wording). |
| 1 | Edit line | Dialog → `PUT …/line-groups/{n}` with **only the changed fields** (description, barcode, Item, brand, model, warranty, cost, tax) plus an editable **Ordered** quantity (0–1,000, not below Received; the same sentence the server uses). A line with nothing waiting can only have Ordered raised (other fields disabled until then). Per-field validation applies only to fields being sent. |
| 1 | Cancel waiting | Line: confirm dialog with "How many to cancel" (default = all waiting, 1…waiting) → `POST …/line-groups/{n}/cancel-waiting {quantity}`. Header **Cancel waiting items** → confirm → `POST …/cancel-waiting`. Both say received items are not affected; server refusals shown verbatim. |
| 1 | Delete PO | De-emphasised ghost "Delete PO" at the foot of the page, shown **only when received units = 0**; the red primary header button is gone. A 409 shows the server's sentence and offers **Cancel waiting items instead**. The old "only the head-office admin can delete…" / "will permanently remove N assets" branches are removed (the server no longer allows either). |
| 1 | Summary tiles | Lines · Ordered units · Received units · Waiting units · Value (counted by the server per line; "Total Lines" no longer counts units). |
| 1 | View units | Per-line expander, loaded lazily (`…/units?status=`), chips Waiting / Received / Cancelled with counts. Waiting: description, barcode, value + per-unit **Edit** (`PUT /lines/{id}`, unchanged payload) and **Cancel** (`POST /lines/{id}/cancel`). Received: serial, invoice, **link to Asset 360** ("Open asset", or the asset code once the server sends it). Never rendered for all lines by default. |
| 1 | Kept | ERP changes panel, delivery reminder banner, Add Line inline form, Add Set dialog, Item/Brand quick-create. Invoices card ("Invoices received under this PO") now holds Record PI per invoice, **Fetch PI from ERP** and **Print labels for the received units** in one place; "Purchase Invoice (PI)" spelled out once. "Print their labels now" after receiving kept. Arriving with `#po-lines` (from Receive) scrolls to the lines. |
| 2 | After-create wording | Add Line → "Line added: 1 line, 3 units waiting."; Add Set → "Set added: 4 lines, 8 units waiting." (lines = distinct `line_no` of the units returned); Add Set preview "This will add 4 lines, 8 units waiting: 2 CPU, …"; ERP create banner "PO created: 4 lines, 28 units waiting." (lines = draft lines, a set counting one per part; units = `lines_created`); ERP draft set note "becomes 4 lines, 28 units (7 of each part)". "Bundle" → "Set" in the PO flow (button, dialog, fields). |
| 3 | PO list | Columns PO No (+ ERP-changed badge), Vendor, Company, Date, Ordered, Received, Waiting, Status (plain word), Purchase Invoice (PI) (status + "PI No · Date" in one compact column; Cost Centre column dropped). Status chips All / Waiting / Partly Received / Received / Cancelled → server `status`. Search debounced (300 ms) → server `q`; a PI No typed in the box is still found among the loaded POs (AM-21 kept). Paged with `limit=200&offset=` via `useInfiniteQuery`, "Showing x of y purchase orders" from `X-Total-Count`, **Load more**. Rows open the PO. ERP sync line, ERP-changes card and delivery-reminders card are secondary: each renders only when there is something to act on, as a one-line `<details>` (open by default only when ≤ 3 POs). |
| 4 | Receive queue | Rebuilt on `GET /purchase-orders?waiting=true`: PO No, Vendor, Company, PO Date, Waiting, Ordered, Received, Status, (ERP "shows N units arrived" column only when the ERP has reminders), **Open** and **Receive** (→ PO page `#po-lines`). Search (`q`) and chips All waiting / Waiting / Partly Received; paging + Load more. The S1 "may not show here yet" note and the dashboard/PI-status guessing are removed. Kept self-contained in `features/receive/` for S4. |
| 5 | Home | "N purchase orders waiting for goods (M units)" from `GET /purchase-orders?waiting=true&limit=1` → `X-Total-Count`, used when Home is not narrowed to one work area; otherwise (or when no total) the S1 unit sentence is kept. Zero waiting POs = no row. |
| 6 | Units keep working | Per-unit endpoints and the delivery payload are unchanged; the dialog's grouping / serial / leave-waiting / check-serials logic is the same code, moved. |
| 7 | Words | Central `lib/labels.ts` gained `poStatusLabel` (Waiting / Partly Received / Received / Cancelled), `poUnitStatusLabel`, `serialModeLabel` (Has serial number / No serial number / Serial will be entered later), `PO_STATUSES`; work area via `workAreaLabel`. No raw enum reaches the screen. |

### F2. Files

New: `src/features/purchase-orders/{DeliveryDoneDialog,LineEditDialog,CancelWaitingDialog,PoLinesTable,PoStatusBadge}.tsx`, `po-detail-types.ts`, `po-list.ts` (PO list types, `poListPath`, `fetchPoPage`, `usePoPages`, `loadedAndTotal`, `useDebounced`, `linesAndUnitsSentence`).
Changed: `lib/api-client.ts` (+`apiClient.getPage` → `{data, total}` from `X-Total-Count`; errors unchanged), `lib/labels.ts`; `features/purchase-orders/{PurchaseOrderDetail,PurchaseOrdersList,AddBundleDialog,PoDraftCard,NewPurchaseOrderForm}.tsx`; `features/receive/ReceiveQueue.tsx`; `features/dashboard/Dashboard.tsx`; `features/erp/{DeliveryReminders,ErpChanges}.tsx` (compact `<details>`, "Receive"/"Add Set" wording).
Tests changed: `PurchaseOrderDetail.test.tsx` (rewritten around lines), `PurchaseOrdersList.test.tsx`, `ReceiveQueue.test.tsx`, `AddBundleDialog.test.tsx`, `PoFromErp.test.tsx`, `Dashboard.test.tsx`, `erp-changes.test.tsx` (list mock now `getPage`), `lib/labels.test.ts`, `lib/api-client.test.ts`. E2E strings: `e2e/purchase-order-delivery-journey.spec.ts`, `e2e/bundle-journey.spec.ts` (type-checked, not run).

### F3. UX before / after (measured example: 3 lines / 104 units)

| | Before (13e1354) | After |
|---|---|---|
| PO page for SPO with 50 cameras + 50 gang boxes + 4 access points | "Total Lines 104"; a "Pending Delivery (104)" table with **104 rows** (one per unit) and tick boxes; Delivered/Cancelled tables below | Tiles "Lines 3 · Ordered units 104 · Waiting units 104"; a lines table with **3 rows** (asserted: header + 3 rows, no unit table, no unit request) |
| Receive 50 cameras | Tick 50 boxes (or filter + Select all), "Mark 50 Delivery Done" | **Receive** on the line (1 click) → the same dialog with all 50 waiting units |
| Change quantity 50 → 40 | Cancel 10 units one by one | Edit line → Ordered 40 → Save (10 newest waiting units cancelled by the server) |
| After adding a line of 10 | Nothing said; 10 new rows | "Line added: 1 line, 10 units waiting." |
| ERP create of 3 lines / 104 units | "Created. 104 lines added." | "PO created: 3 lines, 104 units waiting." |
| Delete a PO with received items | Red primary button; non-owners told "only the head-office admin…", the owner could delete assets | No Delete button once anything is received; "Cancel waiting items" instead; a 409 race shows the server's sentence + the same way out |
| PO list | No progress; whole list fetched; client search | Ordered/Received/Waiting/Status; status chips; server search; 200 per page with "Showing x of y" + Load more |
| Receive queue | Guessed from PI status + dashboard; footnote "may not show here yet" | Exact `waiting=true` list with counts, search, chips, Receive → PO lines |

### F4. Tests added / updated (682 → 707)

* `PurchaseOrderDetail.test.tsx` 37 → 49: grouped rendering with plain words; **3 groups / 104 waiting units → exactly 3 line rows, no unit rows, no unit request**; partly received / received / cancelled counts, statuses and which actions show; **per-line Receive feeds the dialog with exactly that line's waiting ids** (payload ids `[20,21,22]`); Receive all waiting; nothing waiting; units-load error; Edit line payload = only changed fields + quantity; below-received / > 1,000 guard; server refusal; nothing-waiting line; barcode-less line quantity-only edit; Cancel waiting partial (`{quantity: 2}`), default all (`{quantity: 4}`) and server error; header Cancel waiting items; Delete shown only when nothing received; **409 sentence shown + "Cancel waiting items instead"**; units expander lazy loading, Waiting/Received chips, per-unit Edit/Cancel, Asset 360 link, hide; Add Line → "Line added: 1 line, 3 units waiting."; Add Set opens; every existing delivery-dialog behaviour test kept (serial lists, N/A, later, duplicates, check-serials, leave waiting, set parts, required markers, print labels, server error); PI tests kept (+ "PI spelled out once").
* `PurchaseOrdersList.test.tsx` 8 → 13 (+ helpers): columns and cells; rows open the PO; status chips → `status=`; debounced `q=`; PI No still found (AM-21); paging 250 POs → "Showing 200 of 250", Load more → `offset=200`; server error sentence; sort; `poListPath`; `linesAndUnitsSentence` / `distinctLines`.
* `ReceiveQueue.test.tsx` 4 → 6 (+4 People routes unchanged): waiting=true list and cells; Receive → `/purchase-orders/4#po-lines`; search + chips; ERP column; ERP down; empty.
* `Dashboard.test.tsx` +3: PO count from `X-Total-Count`; fallback on failure; `buildAttentionRows` with `waitingPos`.
* `AddBundleDialog.test.tsx` +1 (`onAdded` gets the units; wording "4 lines, 16 units waiting"); `PoFromErp.test.tsx` wording; `labels.test.ts` +1; `api-client.test.ts` +1 (`getPage`).

### F5. Decisions

1. **Receive all waiting uses `GET /{id}/lines`** (one request) filtered to waiting units; per-line Receive uses the units endpoint as specified. `GET /lines` is also still loaded once (never rendered) to list the invoices received and the received units' labels — see request (a).
2. **Line edit sends only changed fields**, so an unchanged field never trips "Nothing on this line is still waiting"; Save stays disabled until something changes.
3. **Cancel on a line always sends an explicit `quantity`** (the number shown), so a concurrent change can never make "all" cancel more than the person saw.
4. Header holds Close · Cancel waiting items · **Receive all waiting (N)**; **+ Add Line / + Add Set** sit on the Lines section header (next to the table they change) rather than crowding the page header.
5. "Bundle" is said **"Set"** on purchase orders (owner wording since S6a); the Settings › Bundles screen itself was not renamed in this stage.
6. The PO list drops the Cost Centre column (not in the S2 column list; still on the PO page). PI status / number / date are merged into one compact column.
7. Home uses the PO count only when its work-area filter is "All" (the list total is the person's whole work area).
8. ERP cards stay rendered only when there is something to act on (as before) and became one-line `<details>`, open when ≤ 3 POs.

### F6. Deferred / not done

* Real Receive screen (quantity per line, S4) — the queue's Receive opens the PO at its lines meanwhile.
* No browser check in this stage: the containers do not live-mount source and starting/rebuilding Docker was out of scope; verified by unit tests, type-check and production build only. E2E specs were updated but not run.
* The per-unit Edit can still make one unit of a line differ (backend §8 observation); the line view shows the template unit. Steering fully to whole-line edits is left for a later stage.

### F7. Backend requests

a. A small **invoices summary** for a PO (`GET /purchase-orders/{id}/invoices` → invoice numbers with their received asset ids / PI state) so the PO page no longer loads every unit (`GET /lines`) just for the invoices card and label printing.
b. **`delivered_asset_code`** on `PendingAssetOut` (received units), so the units list links show the asset code instead of "Open asset".
c. Server-side **PI number in `q`** of `GET /purchase-orders` (today a PI No is matched only among the POs already loaded).
d. A **line count** in the ERP create response (`lines_created` is a unit count; the client derives the lines from the draft today).
