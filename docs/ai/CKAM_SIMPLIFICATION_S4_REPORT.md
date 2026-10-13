# CKAM Simplification — Stage S4 report (Receive by line, one fast asset engine, bulk serials)

## Backend

| | |
|---|---|
| Starting HEAD | `5e5bc8b` (feat(erp): S3a-2 …), Alembic head `c1d3e5f7a9b0` (worktree HEAD `4ee293d` adds only frontend) |
| Scope | Brief items 1–7: `GET /receive-info`, `POST /receive` (pre-validated, all-or-nothing), the batch asset engine (old `/deliver` on it), `PUT /api/assets/serials`, invoices summary / `delivered_asset_code` / PO search by invoice + PI / ERP create counts, work area on the ERP PO list |
| Frontend | not touched (another agent owns `frontend/`) |
| Database | **no schema change, no migration** (still exactly one head `c1d3e5f7a9b0`) |
| Commit | none (the controller commits) |
| Tests | backend **1022 → 1107 passed**, 0 failed (`docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q`) |

### 1. What changed, by item

| # | Item | What was done | Status |
|---|---|---|---|
| 1 | Receive info | `GET /api/purchase-orders/{id}/receive-info`: header, lines (caller's work area) with ordered / received before / waiting / serial rule / work area / rate, default received-into (PO delivery place when still usable), the PO company's **required** extra fields, `blockers` in words | done |
| 2 | Receive | `POST /api/purchase-orders/{id}/receive`: common fields once, quantity per line, server picks the **oldest** waiting units (by id, locked `FOR UPDATE`), serial rule per line (override allowed), line + per-unit extra fields; whole receipt checked first → 422 with `problems` and nothing written; then one transaction | done |
| 3 | Performance | `procure_assets` split into `build_procure_context` (once per receipt) + `prepare_unit` (per unit, no query) + `write_units` (batch: one serial query, one counter update per code prefix, one INSERT of assets, one ledger INSERT); ledger batch entry point `apply_events`; old `/deliver` on the same path; measured below | done |
| 4 | Bulk serials | `PUT /api/assets/serials` (≤ 1000 entries): validate all, then write all, same audit as the single PUT | done |
| 5 | Small asks | `GET /{id}/invoices`; `delivered_asset_code` on unit rows; PO list `q` matches invoice + PI numbers; ERP create answers `lines_created` + `units_created` | done |
| 6 | ERP list work area | one-area logins don't see ERP POs whose lines are all decided and all of the other area | done |
| 7 | Tests | 85 new tests in 7 files + shared world | done |

### 2. API changes (with example payloads)

All additive except: (a) `POST /api/erp/pos/create` → `lines_created` now means **lines** (it used to hold the unit count; units are in the new `units_created`), (b) the ERP PO list hides other-area POs for one-area logins (item 6).

**`GET /api/purchase-orders/{po_id}/receive-info`** (ADMIN/OPERATOR; company + work-area scope like every PO read; 404 outside scope; works on a deleted PO):
```json
{"po_id": 12, "po_number": "SPO/012247", "po_date": "2026-01-01", "is_active": true,
 "company_id": 1, "company_name": "Citykart Stores Pvt Ltd", "company_code": "CKSPL",
 "vendor_id": 3, "vendor_name": "Harshit Infosolution",
 "received_into_asset_user_id": 9, "received_into_name": "Farukhnagar stock room",
 "ordered_units": 104, "received_units": 0, "waiting_units": 104,
 "lines": [{"line_no": 1, "item_id": 44, "item_name": "Indoor Camera", "description": "Indoor Camera",
            "ordered": 50, "received_before": 0, "waiting": 50, "cancelled": 0, "serial_mode": "HAS_SERIAL",
            "work_area": "IT", "rate": 2500.0, "tax_percent": 18.0, "unit_total": 2950.0, "erp_item_code": "CT600123",
            "brand_name": null, "model": null, "bundle_label": null, "status": "WAITING"}],
 "required_custom_fields": [{"id": 4, "key": "warranty_card", "label": "Warranty card number", "type": "text",
                             "options": null, "sort_order": 1}],
 "blockers": []}
```
* `received_into_*` is null when the PO has no delivery place, or it is inactive / of another company.
* `blockers` (plain sentences, empty when receiving is possible): "This purchase order has been deleted, so nothing new can be recorded on it.", "Nothing on this purchase order is still waiting.", and the code-rule sentence ("No code rule (asset code format) is set up for this company yet. …").
* `required_custom_fields`: active, `is_required`, global or the PO company's own; ordered by `sort_order`, label.

**`POST /api/purchase-orders/{po_id}/receive`** (ADMIN/OPERATOR; company scope 404; viewer 403):
```json
{"received_into_asset_user_id": 9, "invoice_number": "HI/771", "invoice_date": "2026-02-01", "invoice_amount": 312700,
 "lines": [
   {"line_no": 1, "quantity": 50, "serial_numbers": ["CAM-0001", "…", "CAM-0050"]},
   {"line_no": 2, "quantity": 50},
   {"line_no": 3, "quantity": 4, "serial_mode": "SERIAL_LATER",
    "custom_fields": {"warranty_card": "WC-ALL"}, "unit_custom_fields": [null, {"warranty_card": "WC-2"}]}]}
```
→ 200
```json
{"po_id": 12, "invoice_number": "HI/771", "assets_created": 104, "serial_pending": 4,
 "assets": [{"asset_id": 501, "asset_code": "FA/CKSPL/IT/0001", "line_no": 1, "serial_number": "CAM-0001", "serial_pending": false}, "…"],
 "label_asset_ids": [501, 502, "…"], "po_status": "RECEIVED", "waiting_units": 0}
```
* `received_into_asset_user_id` optional → the PO's delivery place. It must exist, be active, belong to the PO's company and be a **stock room** (`STOCK_POINT`) or the PO's own delivery place.
* Per line: `quantity` 1..1000 (≤ waiting); the **oldest** waiting units (lowest id) are taken. `serial_mode` (any case) defaults to the line's own rule (`line-groups.serial_mode`): `HAS_SERIAL` needs exactly `quantity` serials (entries trimmed, blank entries ignored; "N/A" allowed and never a duplicate); `NO_SERIAL` → serial "N/A"; `SERIAL_LATER` → serial pending. Serials typed on a NO_SERIAL / SERIAL_LATER line are refused (not silently dropped). Serial i goes to the i-th oldest unit; `unit_custom_fields[i]` to the same unit and wins over `custom_fields`.
* A receipt holds at most 1,000 units in total.
* Refused (nothing written) → **422**:
```json
{"detail": "Nothing was received: 3 problems need fixing. Invoice number cannot be blank.",
 "errors": ["Invoice number cannot be blank.", "Line 1: 2 serial numbers are needed, 1 was typed.",
            "Line 3: Serial number ABC-9 is typed more than once (on line 1 and line 3)."],
 "problems": [{"line_no": null, "message": "Invoice number cannot be blank."},
              {"line_no": 1, "message": "2 serial numbers are needed, 1 was typed."},
              {"line_no": 3, "unit_index": 1, "serial": "ABC-9",
               "message": "Serial number ABC-9 is typed more than once (on line 1 and line 3)."}]}
```
  `detail` is always a string (one problem → that sentence, prefixed "Line N: " when it concerns a line); `errors` = the sentences; `problems` = structured (max 200, then "… and N more." in `errors`), sorted common fields first, then by the line order sent, then unit. `unit_index` = the unit's position in this receipt's line (1-based, = the serial's position); a message every unit of a line shares is reported once for the line. Messages: invoice blank / amount required / negative / date required / future / before PO date (dd-mm-yyyy); place: "Choose where the goods are received into.", "… does not exist.", "… must belong to the purchase order's company.", "<name> is no longer active, so goods cannot be received there.", "<name> is not a stock room. Choose a stock room (or the purchase order's delivery place)."; lines: "This line was not found on this purchase order.", "This line appears twice in the receipt; enter it once.", "Nothing on this line is still waiting.", "Only 3 are still waiting, so 4 cannot be received.", "N serial numbers are needed, M were typed.", "This line is set to no serial number, so leave its serial numbers empty (or set it to has a serial number).", "Choose the serial rule: …", "Serial number X is typed more than once (on this line | on line a and line b).", "Serial number X is already used by asset FA/… ." (or "… by an asset outside your companies or work area" when the caller may not see it), extra fields "<Label> is required." / "<Label> must be a number|text|yes or no|a valid date|one of: A, B." / "The extra field k is not used for this company." / "Extra-field values were given for 2 units, but 1 is being received.", and every asset-engine sentence (e.g. the code-rule one).
* Other answers: deleted PO → 422 with `problems: [{line_no: null, message: "This purchase order has been deleted, …"}]`; a line of the other work area → **403** "Line 2: This is Non-IT work, which is outside your work area. …"; schema problems (missing `lines`, quantity 0 / > 1000) → the usual 422 `{detail, errors}` ("Add at least one line.", "Line 1: Quantity must be at least 1."); a serial race lost at the database unique index → 409 (existing handler).

**`PUT /api/assets/serials`** (ADMIN/OPERATOR; viewer 403) — registered before `PUT /{asset_id}`:
```json
{"entries": [{"asset_id": 501, "serial_number": "AMP-1"}, {"asset_id": 502, "no_serial": true}]}
→ 200 {"updated": 2, "results": [{"asset_id": 501, "asset_code": "FA/…/0001", "serial_number": "AMP-1"},
                                  {"asset_id": 502, "asset_code": "FA/…/0002", "serial_number": "N/A"}]}
```
1–1000 entries. Checked first (all or nothing): asset reachable (company + work area, not deleted; else "This asset was not found."), not twice, serial pending ("The serial number of X is not waiting to be entered."), non-blank ("Enter the serial number of X, or choose no serial number."), unique inside the batch (any case; N/A exempt; "Serial number X is typed more than once (entries 1 and 3).") and in CKAM (one query; code masked outside scope). 422 → `{detail, errors: ["Entry 3: …"], problems: [{entry_index, asset_id, serial?, message}]}`. Writes one `asset_field_change` row per asset (`serial_number`, old NULL → new), own `request_id` each — exactly like `PUT /{id}/serial`.

**`GET /api/purchase-orders/{po_id}/invoices`** (ADMIN/OPERATOR, scoped; caller's work area) → in receipt order:
```json
[{"invoice_number": "INV-A", "invoice_date": "2026-02-01", "invoice_amount": 2360.0, "units": 2,
  "asset_ids": [501, 502], "asset_count": 2, "asset_ids_truncated": false,
  "pi_number": "PI-9", "pi_date": "2026-03-05", "pi_status": "RECORDED"}]
```
`asset_ids` ≤ 200 (`asset_count` = all live assets, `asset_ids_truncated`); date/amount = the latest receipt of that invoice number; `pi_status` PENDING (any asset without PI) / RECORDED (`pi_number`/`pi_date` only when all share one). One query.

**`PendingAssetOut.delivered_asset_code`** (additive) on `GET /{id}/lines`, `GET /{id}/line-groups/{n}/units`, `POST /{id}/deliver` (one lookup per list; null while waiting / cancelled; add-line/edit/cancel responses keep null).

**`GET /api/purchase-orders?q=`** also matches an invoice number received under the PO and a PI number recorded on one of its assets (plain substring, `%`/`_` literal).

**`POST /api/erp/pos/create`** → `{"po_id", "po_number", "lines_created": 5, "units_created": 11}` — lines = PO line numbers made (a set counts one per part), same meaning as `POST /purchase-orders/with-lines`.

**`POST /api/purchase-orders/{id}/deliver`** — contract unchanged; now all-or-nothing on the batch engine (it effectively was), units locked for the transaction, one read for the response instead of one refresh per unit, rows gain `delivered_asset_code`.

### 3. Atomicity decision (documented)

**Pre-validate everything, then write everything in one transaction.** Before any write, `receive_goods` checks with shared lookups: common fields; place; each line exists / not twice / caller's work area (403); the units (oldest waiting, locked `SELECT … FOR UPDATE` so two simultaneous receipts can never turn one unit into two assets — the second sees fewer waiting and gets a 422); quantity vs waiting; serial rule and serial counts; in-receipt duplicates (case-insensitive, N/A ignored); serials already used (one query); then the asset engine's own per-unit checks through the **same** `build_procure_context` + `prepare_unit` the writer uses (masters, received-into, code-format tokens, extra fields with friendly wording). Any problem → 422 listing all of them and nothing written (not even a code counter). Otherwise the writer (`deliver_units` → `procure_units` → `apply_events`) runs in the request's single transaction; the router commits only at the end, and any late failure (`ValueError`, `LifecycleError`, a DB error, anything) rolls the whole receipt back — tested with an injected failure after assets and events were written: 0 assets, 0 events, counters untouched, then the same receipt succeeds with codes starting at 001 (no gap). There is **no partial receipt**. (The journeys sketch "the rest are saved" was superseded by the brief's all-or-nothing rule.)

### 4. Performance

Measured in the dev container against `ckam_test` (in-process ASGI client, one PO line of serial items; statements = every SQL statement sent, incl. login check and response reads). "Before" = HEAD `5e5bc8b` image built from `git archive` and measured with the same harness.

| Units | `/receive` statements | `/receive` time | `/deliver` (S4) statements | `/deliver` (S4) time | `/deliver` before S4 statements | before time |
|---|---|---|---|---|---|---|
| 1 | 27 | 0.023 s | 22 | 0.013 s | 22 | 0.027 s |
| 10 | 27 | 0.029 s | 22 | 0.017 s | 193 | 0.083 s |
| 50 | 27 | 0.029 s | 22 | 0.025 s | 953 | 0.429 s |
| 100 | 27 | 0.042 s | 22 | 0.038 s | 1,903 | 0.751 s |

Constant work per receipt: login 1, PO 1, line groups 2, place 1, locked units 1, serials 1, context ≈ 9 (company, rule, places, cost centres, categories, sub-categories, vendors, brands when any, locations, extra-field definitions), writer ≈ 7 (serial backstop, one counter upsert per code prefix, assets INSERT, last events, holders, events INSERT, unit UPDATE executemany), PO status 2. Asserted by tests: 100 units < 60 statements and ≤ 5 more than 1 unit, for both `/receive` and `/deliver`; a mixed 100-unit 3-line receipt < 60; 59-asset `apply_events` ≤ 6 statements; 100-unit requests < 10 s.

Code numbers: `generate_codes` reserves one block per distinct prefix with one `INSERT … ON CONFLICT DO UPDATE SET next_value = next_value + n RETURNING`; prefixes taken in sorted order (no deadlock between receipts); the counter moves inside the receipt's transaction (rolled back with it → gap-free). Test: 5 parallel receipts × 20 units → 100 unique codes exactly 1..100, each receipt one consecutive block.

### 5. DB changes

None. No migration, no `create_all`, no data rewritten. `alembic heads` → `c1d3e5f7a9b0`. Asset rows are inserted with the ORM bulk INSERT … RETURNING (one statement); the `asset_event` / `asset_field_change` append-only triggers and the serial unique index are unchanged.

### 6. Security

* Every new endpoint: `require_role(ADMIN, OPERATOR)`; PO endpoints through `_get_scoped_po` (company + S0.3 visibility, 404); receive enforces each line's work area (403) and each picked unit's; the received-into place must be the PO company's; serial conflicts outside the caller's scope never reveal the asset code (receive and bulk serials); bulk serials scope every asset (company + work area, not deleted).
* `apply_event` stays the single-asset door and is now literally `apply_events` for one asset: both live in `lifecycle/service.py`, which remains the **only** writer of `Asset.status` / `current_asset_user_id` / `status_since` and of `asset_event`. The batch applies the same future-date, no-destination, last-event-date (incl. same-day adjustment, per asset), destination exists / active / same-company and state-machine (incl. ADMIN-only FOUND/CORRECTION) rules and the same name snapshots; it refuses a duplicate asset and writes nothing if any asset fails. New assets are still inserted IN_STOCK (documented exception) and then moved by the ledger.
* No hard deletes; the S0 inactive rule is kept (a received line's masters deactivated since ordering do not block; the received-into place must be active).
* The old `/deliver` now locks its units (`FOR UPDATE`): two simultaneous deliveries of one unit → one asset, the other 422 "… is already delivered …" (tested).

### 7. Tests

| | count |
|---|---|
| Backend before (HEAD `5e5bc8b` backend) | 1022 passed |
| Backend after | **1107 passed, 0 failed** |
| New tests | **85** in 7 files + `tests/purchase_orders/s4_world.py` |

* `tests/purchase_orders/test_s4_receive.py` (45): 1 serial asset with every common field + ledger + unit traceability (vendor, PO no/date, invoice no/date/amount, cost centre, company, work area, stock room, Item, ERP code, PROCURED with names, status_since); 10 serial (order, codes); 50 no-serial (N/A); 10 serial-later (pending list); 100-unit 3-line mixed (no orphans); per-line override; partial → PARTLY_RECEIVED then RECEIVED; default / other stock room; duplicate on a line, across lines in another case, already in CKAM (named / masked); N/A + blanks; serial counts; serials on no-serial lines (×2); unknown rule; refused receipt lists every problem and writes nothing (no counter); injected late failure rolls back and leaves no code gap; extra fields absent / per line / per unit / unknown / other company's; invoice rules (×7); place rules (×4); no delivery place; line problems; empty / impossible quantity (×3); 1,000-unit cap; other work area 403 (both directions); company scope / viewer / owner / deleted PO; inactive Item + vendor don't block; no code rule.
* `tests/purchase_orders/test_s4_po_reads.py` (8): receive-info content; required fields (only required, own company, active, ordered); blockers; work area + scope; invoices (two receipts, PI recorded/pending, ids); invoices work area + 200-id cap; `delivered_asset_code` on units / lines / deliver; PO search by invoice and PI number.
* `tests/purchase_orders/test_s4_engine_performance.py` (7): old `/deliver` == new `/receive` (34 asset fields, 10 event fields, unit rows); straight-to-a-person allotment through the ledger (Add Asset + deliver); statement counts and times 1/10/50/100 (prints the table above); mixed 100-unit budget; 5 parallel receipts → unique gap-free codes; two simultaneous receipts of the same units → one wins; two simultaneous old deliveries of one unit → one asset.
* `tests/lifecycle/test_s4_batch_events.py` (13): batch == single (events and asset state, three destination types); constant queries; 7 refusals each writing nothing; one illegal asset refuses the batch; last-event-date rules per asset; role rules + correction note; empty batch.
* `tests/numbering/test_s4_batch_codes.py` (2): one statement per prefix, order kept, counters; single and batch share the counter.
* `tests/assets/test_s4_serial_bulk.py` (7): fill + audit by an operator; in-batch duplicate refuses all; already used; N/A repeats; every problem listed; scope / work area / viewer; size limits.
* `tests/erp/test_s4_erp_work_area.py` (3): one-area visibility (IT, Non-IT, both, owner, mixed, undecided); not-tracked lines don't decide the area; ERP create `lines_created`/`units_created`.

Existing tests changed (intended only): `tests/purchase_orders/test_s0_po_integrity.py` (the injected LifecycleError now patches `procure_units`, the engine `/deliver` calls), `tests/erp/test_erp_api.py` (`(lines_created, units_created) == (4, 28)` — a Desktop set is 4 lines), `tests/erp/test_s0_erp_create_revalidation.py` (`(1, 3)`).

### 8. Files changed

New: `backend/app/purchase_orders/receive.py`; the 7 test files above and `tests/purchase_orders/s4_world.py`; this report.
Changed: `app/assets/service.py` (engine: `ProcureContext`, `build_procure_context`, `prepare_unit`, `write_units`, `procure_units`, `check_batch_serials`, `serial_key`; `procure_assets` now a door into it), `app/assets/custom_field_values.py` (`check_custom_field_values` pure twin, `custom_field_problems` in words), `app/assets/router.py` + `schemas.py` (`PUT /serials`), `app/lifecycle/service.py` (`apply_events`; `apply_event` delegates), `app/numbering/service.py` (`generate_codes`, `reserve_codes`; `generate_code` uses them), `app/purchase_orders/service.py` (`deliver_units`, `delivery_unit_spec`, `attach_asset_codes`, `invoice_summaries`, list `q`), `router.py` (3 endpoints, deliver locking/response), `schemas.py`, `models.py` (non-column `delivered_asset_code`), `app/erp/service.py` (work area in `erp_po_rows`, create counts); the 3 tests above.

### 9. Decisions taken where the brief was open

1. **All-or-nothing** (§3). No savepoints, no partial success.
2. **Oldest waiting units** = lowest `pending_asset.id` of the line (creation order); locked for the transaction.
3. **Serial rule per line**: the line's template unit's (`line-groups` rule); an override applies to every unit of that line in this receipt; serials typed on a no-serial / later line are refused rather than dropped.
4. **Received-into**: a stock room of the PO's company, or the PO's own delivery place (whatever its type); defaults to the delivery place.
5. **Inactive masters**: S0 decision 9 kept — only the received-into place must be active; an Item / vendor / category deactivated after ordering does not block the receipt.
6. **Work area**: a line (or a picked unit) of the other area is a 403 security refusal (as on every PO write), not a `problems` entry.
7. **`problems` shape**: `detail` (string) + `errors` (sentences, the S0 convention) + `problems` (structured). Common-field problems carry `line_no: null`; per-unit messages shared by every unit of the line collapse to one line problem.
8. **Extra fields**: line `custom_fields` apply to every unit; `unit_custom_fields[i]` (may be shorter; nulls allowed) wins per unit; validated with the same rules as Add Asset, worded with labels.
9. **ERP list work area**: hidden only when **every** live line is decided (Item or not tracked), at least one has an Item, and **none** of those Items' categories is in the caller's area. Undecided lines keep a PO visible; not-tracked lines never decide the area; a both-area operator / unrestricted admin / owner sees everything. `counts` follow the same rule.
10. **ERP create `lines_created`** = lines (was units) for consistency with with-lines; `units_created` added.
11. **`apply_event` delegates to `apply_events`** rather than keeping two copies of the rules, so equivalence holds by construction (and is tested).
12. **Bulk serial audit**: one `request_id` per asset (same as the single PUT), not one per batch.

### 10. Observations (not changed)

* Excel asset import (`imports/asset_import_service._commit_add`) still creates assets row by row with its own IMPORTED path (head-office only, unchanged by this stage); it could move onto `procure_units` later (it would need an `event_type` parameter).
* `POST /bulk-move` / `/bulk-action` still apply events one asset at a time with partial success; `apply_events` could serve an all-or-nothing variant if wanted.
* `check_serial_number_unique` on Add Asset / Asset 360 edit still names a conflicting asset outside the caller's scope (S0 §8); Receive and bulk serials now mask it.
* `invoice_amount` is still the invoice total copied onto every asset of the receipt (pre-existing meaning).
* The ERP draft endpoint still answers for a PO the list now hides from a one-area login (create would refuse its Items with 403 anyway).

### 11. Frontend changes the controller must handle

1. **Receive screen**: load `GET /api/purchase-orders/{id}/receive-info`; show `blockers` next to the disabled Receive button; pre-fill Received into from `received_into_asset_user_id` (picker = `GET /api/stock-rooms?company_id=`); one quantity per line (default = `waiting`); serial box only for `HAS_SERIAL` lines (rule switch per line → send `serial_mode`); required extra fields from `required_custom_fields` (line values → `custom_fields`, per-unit → `unit_custom_fields`). Submit `POST /api/purchase-orders/{id}/receive`; on 422 show `problems` grouped by `line_no` (common ones at the top), highlighting `unit_index` / `serial` in the serial box; nothing was saved. On 200 offer labels for `label_asset_ids`, show `assets_created` / `serial_pending`, refresh the PO (`po_status`).
2. **PO page**: the invoices card → `GET /{id}/invoices` (no more `GET /lines` just for invoices / labels); unit rows → link text `delivered_asset_code`.
3. **PO list / Receive queue search**: `q` now finds invoice and PI numbers server-side (drop the client-side PI fallback).
4. **ERP create banner (PoDraftCard)**: use `units_created` for units and `lines_created` for lines — `lines_created` is **no longer** the unit count.
5. **Serial Pending screen**: "save all" → `PUT /api/assets/serials {entries: [{asset_id, serial_number | no_serial}]}`; show `problems` by `entry_index`.
6. **ERP PO list**: a one-area login now sees fewer POs (other team's decided POs); nothing to change unless counts are cached.
7. The old Mark Delivery Done dialog keeps working unchanged (now faster); it can be retired once Receive replaces it.

## Frontend

