# CKAM Simplification — S7 fix round, backend

| | |
|---|---|
| Date | 2026-10-13 |
| Starting HEAD | `32a72fa` (test(e2e): S7 specs …), Alembic head `c1d3e5f7a9b0` |
| Scope | backend only (`backend/`) + this report. Defects from `CKAM_SIMPLIFICATION_S7_REPORT.md` §11: P1-1, P1-2, P1-3, P2-3, P2-10, P3-7, P3-9, plus "store rooms everywhere". Nothing committed (the controller commits). |
| Database | **one additive migration `d2e4f6a8b0c2`** (revises `c1d3e5f7a9b0`): new table `idempotency_key`, new partial unique index `uq_purchase_order_company_number_active` (made only when no duplicate exists). Exactly one head. |
| Tests | full backend suite **1,364 passed, 0 failed** (final run after the last change, 341 s) (was 1,266 at the start). **98 new tests** in 9 new files; 8 existing tests updated for intended changes (listed in §11). |

## 1. Summary per defect

| # | Defect | Root cause (verified in source) | Fix |
|---|---|---|---|
| P1-1 | Home lost every ERP row; every PO page logged `503 /api/erp/reminders` | `home/service.py::_erp_figures` read changed POs, goods arrived and POs needing input inside ONE `try`; the goods-arrived read needs `gold_ckam.po_receipt_line`, which does not exist (in production either), so the `ErpUnavailable` from it nulled all three and `erp_available=false` also suppressed the head-office inbox counts. `/api/erp/reminders` and `/api/erp/purchase-orders/{id}/pi` turned the same exception into 503. | Each figure is read on its own (`_one_erp_figure`); a failing one is null and listed in the new `erp_unavailable`; `erp_available` = at least one figure readable; inbox counts read independently. A missing ERP view now raises `ErpViewMissing` (subclass of `ErpUnavailable`, so every old `except` still works). Reminders and PI lookup answer **200** with "not available" instead of 503. |
| P1-2 | Near-simultaneous double submits wrote duplicates (2 POs "UAT-D-TXZPT", 4 chairs for 2, SENT_FOR_REPAIR twice) | (a) no request-level de-duplication; (b) `lifecycle/service.apply_events` read the asset (often from the session's identity map, i.e. stale) and checked the transition **without a row lock** — the second UPDATE just waited and then overwrote, so `UNDER_REPAIR → SENT_FOR_REPAIR` passed on stale `IN_STOCK`; bulk moves locked nothing; (c) the PO-number check is application-level only (no unique index, no lock). | (a) `Idempotency-Key` header (§3) on every create / receive / move request; (b) `apply_events` flushes, then `SELECT … FOR UPDATE` on all its assets **in id order** with `populate_existing`, and checks the transition/date against the locked, current row; bulk-move / bulk-action pre-lock all chosen assets in id order; (c) transaction-scoped advisory lock on (company, normalised PO number) before the duplicate check on create (manual, with-lines, ERP create, PO Excel import — all go through `create_purchase_order`) and on header renumbering, plus the partial unique index. |
| P1-3 | ERP suggestion "AI BOX (100% match)" for GANG BOX PVC 4X4 and R-51 HOP BOX; HOPBOX never found | `items/service.suggest_item` = share of the Item name's 3+-letter words found in the texts. "AI BOX" → {box} → any text with BOX = 1.0. "HOP BOX" ≠ "hopbox" as words. Threshold 0.5. Four call sites (PO review draft, ERP inbox, Articles screen, Link assets to Items — the last with its own copy of the formula). | ONE scoring module `app/items/suggest.py` (`ItemMatcher`) used by all four (§5). |
| P2-3 | "Set up CKAM" said 7/7 for a brand-new company | `setup_status` counted across all companies the caller may see | optional `company_id` (§6) |
| — | Stores made through the general form / Excel had no Stock Room / Install Point | only `/api/people/stores` and the ERP store creation called `ensure_store_rooms` | the same shared function now runs on `POST /api/asset-users` (type STORE), `PUT` that turns a record into a STORE, and the people Excel import (§7) |
| P3-9 | Self-service got 200 from the asset report preview/export | `_asset_report_args` pinned self-service to its own assets instead of refusing | 403 with a sentence (§8) |
| P2-10 | Asset Excel import: no Item, Vendor Code required, heading "Initial AssetUser Code" | add-mode row engine had no Item lookup | optional `Item` column through the same row engine (§9) |
| P3-7 | Cancelled PO showed "Ordered 0" | `ordered = received + waiting` by design | definition kept (the quantity edit is defined on it); additive `originally_ordered_units` / `originally_ordered` / `cancelled_value` (§10) |

## 2. P1-1 — Home and the PO pages' ERP calls

* `app/home/service.py` — `_erp_figures` computes `erp_changed_pos`, `erp_arrived_pos`, `erp_pos_needing_input` independently; `home_attention` reads the head-office `inbox` counts independently. New response field **`erp_unavailable: list[str]`** (additive) names the figures that could not be read this time, e.g. `["erp_arrived_pos"]` in production today. `erp_available` is `true` when at least one ERP figure (or the inbox) could be read — the local ERP copy is enough.
* `app/erp/source.py` — `ErpViewMissing(ErpUnavailable)` raised for `UndefinedTableError` ("the view this screen reads does not exist yet").
* `GET /api/erp/reminders` — never 503 for an ERP read problem: `200 []` plus headers `X-ERP-Available: false` and `X-ERP-Message: <sentence>`; when it works `X-ERP-Available: true`. Additive `?envelope=true` answers `{"available": bool, "message": str|null, "items": [...]}`. Message for the missing view: *"The ERP does not provide goods receipts yet, so goods-arrived reminders are not available."*; a down ERP gives its own sentence.
* `GET /api/erp/purchase-orders/{id}/pi` — additive `available` / `message` on every answer. ERP cannot give invoices → `200 {"po_id", "po_number", "rows": [], "not_booked": 0, "ckam_invoices": [], "delivered_assets": 0, "available": false, "message": "The ERP does not provide purchase invoices yet."}` (a down ERP: its own sentence). A PO not made from the ERP keeps its 422. `POST …/pi/apply` keeps 503 (a write) but with the same plain sentence.
* Tests (`tests/reports/test_s7_home_erp_resilience.py`, 14): every figure fails alone (goods-arrived via a missing view, changed POs, POs needing input, inbox) and only that one is null; operator variant; only the inbox readable; reminders 200 empty + headers + envelope, working reminders say `true`, role check kept; PI missing view 200 `available:false` + apply 503 sentence; PI working `available:true`; non-ERP PO 422 kept; `PgReadOnly._fetch` maps `UndefinedTableError` to `ErpViewMissing`.

## 3. P1-2 (a) — the `Idempotency-Key` contract

Module `app/core/idempotency.py` (pure ASGI middleware, registered in `app/main.py` inside the security-headers middleware so replays get `Cache-Control: no-store` etc.).

**Requests that honour it** (POST only): `/api/assets`, `/api/assets/batch`, `/api/assets/bulk-action`, `/api/assets/bulk-move`, `/api/assets/link-items`, `/api/assets/{id}/events`, `/api/purchase-orders`, `/api/purchase-orders/with-lines`, `/api/purchase-orders/{id}/receive`, `/api/purchase-orders/{id}/deliver`, `/api/erp/pos/create`, `/api/people/*` (employees, stores, stores/ensure-rooms, install-points), `/api/stock-rooms`. Any other request, and any request **without** the header (or without a valid login), behaves exactly as before.

**Header**: `Idempotency-Key: <a new random key per user action>` (8–200 characters of `A–Z a–z 0–9 . _ : -`; a UUID is ideal). The client sends the SAME key when it retries / double-fires the same action, and a NEW key for the next action.

| Situation | Answer |
|---|---|
| first request with the key | runs normally; a 2xx answer (status + JSON body) is stored |
| same key + same request (method, path, query and body; JSON compared by meaning, key order / spacing ignored) after it finished | the stored answer again, **same status code and body**, header `Idempotency-Replay: true`; nothing is done again |
| same key while the first is still running | `409 {"detail": "This request is already being processed."}` |
| same key, different request | `422 {"detail": "This request key was already used for a different request."}` |
| the first request failed (any 4xx / 5xx or an unexpected error) | key released (row removed), so the corrected request can be sent with the same key |
| key older than 24 h | expired: removed whenever a key is next claimed; the request is treated as new |
| malformed key (e.g. `x`) | `422 {"detail": "The request key is not valid. Send a new random key (for example a UUID) with each action."}` |
| no / invalid login | the header is ignored; the request's own 401 |

Keys are per user (`UNIQUE(actor_id, key)`). Claiming the key is its own committed statement (`INSERT … ON CONFLICT DO NOTHING`) before the request runs, so two simultaneous requests can never both run.

Example:

```
POST /api/assets/batch
Authorization: Bearer …
Idempotency-Key: 8d0f4c4e-3b5a-4a59-9e3e-1f0d7f2a6b11
{"item_id": 41, "quantity": 2, "received_into_asset_user_id": 7, "cost_center_id": 3}
→ 201 {"assets_created": 2, "serial_pending": 0, "assets": [...], "label_asset_ids": [1601, 1602]}

(the same again, 15 ms later)          → 409 {"detail": "This request is already being processed."}
(the same again, after the first ended) → 201 Idempotency-Replay: true  {…the identical body…}
(same key, quantity 3)                 → 422 {"detail": "This request key was already used for a different request."}
```

Table `idempotency_key`: `id, key varchar(200), actor_id → asset_user, method, path, request_hash (sha256), status_code, response_json jsonb, created_at, completed_at`; `UNIQUE(actor_id, key)`, index on `created_at`. Technical bookkeeping, not a business record: releasing a failed key and purging expired ones is the contract.

Known limit: if the process dies after the business transaction committed but before the key row was completed, that key answers 409 until it expires (24 h); the user's next action uses a new key, so nothing is blocked.

Tests (`tests/core/test_s7_idempotency.py`, 20): no header → unchanged (two batches, no rows); replay same status/body + header; JSON key order irrelevant; two simultaneous identical batches → one 201 + one 409 → 2 assets, later replay; different payload (and different path) 422; refused request releases the key; unexpected exception releases it; expiry after 24 h; purge of old keys; per-user keys; malformed key 422; no / bad login → 401 and no row; unlisted request (`PUT /purchase-orders/{id}`) ignores it; listed routes; hash rules; two identical receipts with one key → 5 units once and replay; without a key two partial receipts stay two receipts (unchanged); two identical with-lines POs → one PO; an event repeated with its key → one ledger row; replay keeps the security headers.

## 4. P1-2 (b, c) — row locks and the PO number

* `app/lifecycle/service.py::apply_events` (and so `apply_event`, the only writer of status / holder / status_since — unchanged in that role): after `session.flush()`, `SELECT asset … WHERE id IN (…) ORDER BY id FOR UPDATE` with `populate_existing`; the transition, the destination checks and the "not before the last movement" date check all run on the locked rows. One extra statement per batch (constant).
* `app/assets/router.py::_bulk_apply_event` (bulk-move, bulk-action): locks every chosen asset row up front in id order (no deadlock between overlapping batches in opposite orders); each asset is then applied in its own savepoint as before.
* `app/purchase_orders/service.py::lock_po_number` — `pg_advisory_xact_lock(hashtextextended('ckam:purchase_order_number:<company>:<lower(trim(number))>', 0))`, called in `create_purchase_order` (covers `POST /purchase-orders`, `/with-lines`, `/api/erp/pos/create` and the PO Excel import) and in `purchase_orders/header.py` when the number changes. The second save waits, then sees the first and gets the existing sentence *"Purchase order X already exists for this company."* (422).
* Index `uq_purchase_order_company_number_active` on `purchase_order (company_id, lower(btrim(po_number))) WHERE is_active`; a violation (should never be reached through the app) maps to 409 *"A purchase order with this PO number already exists for this company."* (`core/errors.py`, `CONSTRAINT_MESSAGES`).
* Tests (`tests/lifecycle/test_s7_row_locks.py`, 15): stale-read second repair refused (the exact UAT case); the second writer blocks until the first commits and is then refused; goes ahead when the first rolls back; two simultaneous HTTP repair requests → 201 + 422 and ONE ledger row; two simultaneous bulk-actions → each asset once; overlapping bulk-moves in opposite order finish (no deadlock) with 12 moves; a batch is all-or-nothing against the locked state; PO: second save of the same number (trimmed / other case) waits and is refused; another company not held up; simultaneous with-lines saves → 201 + 422 + one PO; three simultaneous header saves → one PO; the database refuses a second live duplicate but allows a deactivated one and another company's; index present; index violation sentence; renaming to a used number still refused.

## 5. P1-3 — one suggestion scoring (`app/items/suggest.py`)

Each text (Article name, department, product name, line description, asset description) is compared on its own:

* normalised compare: lower case, all spaces / hyphens / dots / underscores removed — HOPBOX = HOP BOX = Hop-Box;
* **1.0 "same name"** only for an exact normalised match;
* **0.95 "similar name"**: the whole Item name inside the text as consecutive words (R-51 HOP BOX ⊃ HOPBOX), or every distinctive word of the Item present in any order (of two such Items the longer name wins: "Dell Desktop" before "Desktop");
* otherwise **0.9 × weight share** of the distinctive words found, each word weighed by its rarity among the Item names (IDF, `1 + ln((N+1)/(df+1))`); at least one distinctive word must match;
* generic words count for nothing: box, cable, stand, set, pro, with, for, small, big, size, pvc, cat, wire, mm, inch, sizes/units, colours, materials, ERP prefixes (fa, ce, it …) and number-like tokens (4, 48, 4x4, 6u, 12mm);
* "what a product IS is its last word": a text whose last real word (trailing sizes, counts and colours skipped) is a thing-word (box, stand, cable, cover, case, sleeve, mount, holder, bracket, tray, adapter, charger, kit …) that the Item's name lacks does not suggest that Item (CAMERA PVC BOX is not a CAMERA; LAPTOP SLEEVE 14 INCH is not a LAPTOP);
* an Item named only with generic words (e.g. "Cable") is suggested at 0.6 only when its whole name is in a text AND nothing else matched;
* **no suggestion below 0.6** (`SUGGESTION_THRESHOLD`, was 0.5).

Call sites (all now use `ItemMatcher`, built once per screen): `erp/service.build_draft` (PO review lines), `erp/inbox.build_inbox`, `items/service.article_overview` (Articles screen), `assets/linking.suggestions_for` (Link assets to Items, DESCRIPTION reason; still capped at 0.95). `items/service.suggest_item(items, texts)` kept as a thin wrapper for older callers. The rule engine (CODE > NAME > ARTICLE > levels) is untouched; suggestions are still only for undecided codes.

Additive fields on PO-review lines and inbox item groups: `suggestion_reason` ("same name" / "similar name") and `suggestion_reason_code` (SAME_NAME / SIMILAR_NAME); the Articles screen also gains `suggestion_score` and `suggestion_reason`. Existing `suggested_item_id / _name / suggestion_score` unchanged in shape.

UAT fixtures: GANG BOX PVC 4X4 (Article FA_CE_CAMERA PVC BOX) → **no suggestion** (was AI BOX 100%); R-51 HOP BOX (Article FA_CE_HOPBOX) → **HOPBOX 95% similar name**; "AI BOX" → AI BOX 100% same name.

Tests (`tests/erp/test_s7_item_suggestions.py` 16, `tests/assets/test_s7_link_suggestions.py` 2): the two UAT fixtures; written-apart / hyphen = same name; only exact = 100%; generic-only texts suggest nothing; head-noun rule; half match (48 PORT SWITCH vs Network Switch) is no suggestion; rarity (ZEBRA GK420T → Zebra Printer among six printers; THERMAL PRINTER → none); longer full match wins; generic-only Item as last resort; threshold; old entry point; PO review draft, ERP inbox, Articles screen and Link assets through the API; a decided code still resolves by its rule (precedence unchanged) and gets no suggestion.

## 6. P2-3 — `GET /api/setup/status?company_id=`

Optional `company_id` (ADMIN / head-office admin as before; unknown company → 404 "This company was not found."). With it: company step = that company active; places, stock rooms, cost centres, employees and stores counted for that company only; asset code format = an active rule of that company **or** one for every company; Asset Groups / Items and Vendors stay global (shared by all companies). Additive response fields `company_id`, `company_name`, `company_code` (null without the parameter = the old global answer, unchanged).

Example: a brand-new company → `{"company_id": 9, "company_code": "NEWCO", "steps": [company ✓, stock-room ✗, cost-centre ✗, catalogue ✓, vendors ✓, people ✗, code-format ✓ (the global rule)], "done_count": 4}`.

Tests (in `tests/reports/test_s7_setup_and_reports.py`): new company not done; old global answer unchanged; steps fill in; own-or-global code rule; other companies' records never count; 404 + role; ≤ 3 statements.

## 7. Store rooms everywhere

`POST /api/asset-users` with `asset_user_type: "STORE"`, `PUT /api/asset-users/{id}` that changes a record to STORE, and `POST /api/asset-users/import/commit` rows of type STORE now call the one shared `app.asset_users.store_rooms.ensure_store_rooms` in the same transaction (existing rooms reused, nothing existing changed). A room code taken by another record → 422 with the existing sentence (*"The code STK-AGR is already used by Agra Person, so the stock room of store AGR was not made."*) and nothing saved; in the Excel import that row is undone and reported, the other rows go in (`masters/bulk_import_export.commit_import` gained an optional `after_create` hook; ValueError → row error). A store code too long for `STK-<code>` (column is 50) → plain sentence instead of a database error. Additive response field `rooms_created: ["stock_room", "install_point"]` on `AssetUserOut` (POST / PUT). `AssetUserService.create/update` gained `commit=False` (default unchanged).

Tests (`tests/asset_users/test_s7_store_rooms_everywhere.py`, 9).

## 8. P3-9 — reports for self-service

`GET /api/reports/assets/preview` and `GET /api/reports/export/assets` → `403 {"detail": "Reports are for staff. The assets you hold are listed under My Assets."}` for SELF_SERVICE (like the movement log). My Assets (`GET /api/assets`) unchanged. Tests in `test_s7_setup_and_reports.py` (2) + updated `test_export.py` / `test_s5_previews.py`.

## 9. P2-10 — asset Excel import (add mode)

Same row engine (`imports/asset_import_service._validate_add_rows` / `_commit_add`), no second creation engine:
* optional **`Item`** column: active Item by name, case-insensitive and trimmed; it sets `item_id` and decides Category, Sub-category and work area (the asset's `asset_domain` = the Item's category's); Category / Subcategory Code may be empty, and when filled must be the Item's own (else a sentence naming the Item's category); Description may be empty (= Item name + brand + model, as Add Assets); the Item's default brand (if active) and default warranty apply when those cells are empty; an Item outside the caller's work area is a row error (the import is head-office only today, so this never triggers in practice).
* **Vendor Code** optional (a filled one must exist and be active).
* heading **"Received Into Code"** (template); the old "Initial AssetUser Code" still read (errors then name the old heading).
* required columns: Company Code, Cost Centre Code, Serial Number, Received Into Code (or the old one), and — when there is no Item column — Category Code, Subcategory Code, Description.
* preview rows gain `item` (the Item's name or null); row errors in plain words, e.g. *"There is no active Item named 'Flux Capacitor'. Check the name, or add the Item under Settings > Items first."*, *"Give the Item (or the Category Code and Subcategory Code)"*.

Template columns now: Company Code, Cost Centre Code, **Item**, Category Code, Subcategory Code, Description, Legacy Asset Code, Vendor Code, PO Number, PO Date, Invoice Number, Invoice Date, Invoice Amount, PI Number, PI Date, Purchase Cost, Tax %, Brand Code, Model, Serial Number, Warranty Years, **Received Into Code**, Quantity.

Tests (`tests/imports/test_s7_import_items.py`, 10).

## 10. P3-7 — cancelled units in the PO aggregates

Decision: **keep** `ordered_units` (PO) and `ordered` (line) = received + waiting — the line edit's `quantity` is defined as the new ordered total and cancels / adds waiting units against it; redefining it would change that contract. Instead, additive: PO list / detail `originally_ordered_units` (= received + waiting + cancelled); line groups `originally_ordered` and `cancelled_value` (`line_value` stays the value of what is still ordered). `cancelled_units` / `cancelled` were already there. A fully cancelled PO of 15 → `ordered_units 0, cancelled_units 15, originally_ordered_units 15, status CANCELLED`. Tests (`tests/purchase_orders/test_s7_cancelled_totals.py`, 3).

## 11. Existing tests changed (intended behaviour changes only)

| Test | Why |
|---|---|
| `core/test_s3a1_master_audit_migration.py::test_the_master_audit_migration_is_the_only_head` | head is now `d2e4f6a8b0c2` (on top of `c1d3e5f7a9b0`) |
| `erp/test_erp_followup.py::test_reminders_…_a_down_erp` | down ERP → 200 [] + `X-ERP-Available: false` (was 503) |
| `erp/test_erp_followup.py::test_pi_needs_…_a_reachable_erp` | down ERP → 200 `available:false` (was 503) |
| `erp/test_s3a2_draft_create.py::test_each_draft_line_says_its_decision_suggestion_and_default_reach` | "48 PORT SWITCH" vs "Network Switch" (one of two words) is no longer a suggestion |
| `erp/test_s3a2_inbox.py::test_new_items_are_only_undecided_codes_on_open_pos_grouped_by_article` | same |
| `reports/test_export.py::test_export_assets_pins_asset_user_to_only_their_own_held_asset` | self-service → 403 (My Assets still shows only the own asset) |
| `reports/test_s5_previews.py::test_the_preview_follows_company_work_area_and_custody` | self-service preview → 403 |
| `reports/test_s6_home_and_setup.py::test_an_unreadable_erp_only_hides_the_erp_figures` | figures that need no ERP read (no ERP-made PO yet → 0 changed / 0 arrived) are now given; only `erp_pos_needing_input` and `inbox` are null |

## 12. Migration `d2e4f6a8b0c2` and its verification

* Additive only: `idempotency_key` table + index; the partial unique index on `purchase_order`, created **only if** no (company, lower(btrim(po_number))) has more than one live PO. If duplicates exist the index is skipped with an Alembic WARNING and a PostgreSQL NOTICE listing them (company, number, ids); no row is rewritten or deleted; the advisory lock still blocks new duplicates. Downgrade drops the index if present and the table.
* `ckam` (dev): no duplicates → index created; `downgrade -1` then `upgrade head` OK; at head `d2e4f6a8b0c2`.
* `ckam_test`: upgraded to head (index present — asserted by a test); `downgrade -1` then `upgrade head` OK.
* fresh scratch database `ckam_s7_scratch`: zero → head OK (table + index); `downgrade -1` removed both; two live POs "UAT-D-TXZPT" / " uat-d-txzpt" in one company inserted, `upgrade head` → table created, index **skipped** with the warning, both POs untouched; `downgrade -1`, one PO deactivated by hand, `upgrade head` → index created. Scratch database dropped.
* `alembic heads` → `d2e4f6a8b0c2` (single head; also asserted by two tests).
* The UAT copy (`ckam-uat`) was not touched; its two "UAT-D-TXZPT" POs mean the index will be skipped there until one is deactivated — expected and documented.

## 13. Decisions

1. Idempotency is opt-in by header and limited to the listed create / receive / move requests; everything else unchanged. Failed requests are never stored.
2. Locking: row locks in `apply_events` (the single ledger writer) rather than per endpoint, so every path (receive, Add Assets, import, moves, repairs) is covered; ordered by id.
3. PO number: advisory lock + partial unique index; the index is skipped (never data rewritten) where duplicates already exist.
4. Suggestion threshold 0.6; a one-of-two-words match (50%) is no longer suggested — fewer but safer suggestions, since one click saves a group-wide rule.
5. `ordered` keeps its meaning; the cancelled part is explicit in new fields.
6. `erp_available` means "at least one ERP figure could be read"; per-figure availability is in `erp_unavailable`.

## 14. Observations (not fixed here)

* Reminders / PI are computed from the live warehouse (receipts and invoices are not in CKAM's ERP copy). In production they will keep answering "not provided yet" until the ERP team creates `gold_ckam.po_receipt_line` / `po_invoice`.
* The head-noun rule is a heuristic for English product names with a fixed list of thing-words; an Item named after what a thing is FOR, in a text whose last word is not on that list (e.g. "CAMERA PVC ENCLOSURE"), can still be suggested at 95%. The suggestion remains only a suggestion; P2-9 (confirm before saving a group-wide rule) is the frontend's safety net.
* `idempotency_key` keeps only the JSON body and status of a success, not its headers (none of the listed endpoints sets a meaningful one).
* The asset import is head-office only, so its new work-area check for Items is defensive.

## 15. What the frontend must handle (controller)

1. **Idempotency-Key** on the listed POSTs: one new key per user action (create it when the action starts, reuse it for any retry / double-fire of that action, drop it after a definite answer). On `409 "This request is already being processed."` keep the button busy (or poll / retry the same request with the same key after a moment — it then gets the stored answer with `Idempotency-Replay: true`). Treat a replayed 2xx exactly like the first success.
2. **Home**: read `erp_unavailable` and show each ERP row whose number is not null even when another is null; the goods-arrived row disappears quietly when `erp_arrived_pos` is null. The head-office inbox row uses `inbox` (now present whenever readable).
3. **PO list / detail reminders**: `GET /api/erp/reminders` no longer fails; use `X-ERP-Available` (or `?envelope=true` → `{available, message, items}`) to show nothing / a calm note instead of logging an error.
4. **PI "Fetch from ERP" dialog**: `GET /api/erp/purchase-orders/{id}/pi` → when `available` is false show `message` ("The ERP does not provide purchase invoices yet.") and offer "Type it in".
5. **Suggestions**: show `suggestion_reason` ("same name" / "similar name") and the score; "100%" only appears for a same-name match now. Lines / groups with no safe suggestion have all suggestion fields null.
6. **Set up CKAM**: call `GET /api/setup/status?company_id=<chosen company>` for the wizard and the Home "finish setting up" row; show `company_name`.
7. **Stores**: a store made on the general Asset User form / Excel now gets its rooms; `rooms_created` can be shown ("Stock Room and Install Point were made").
8. **Reports**: hide the Reports entry for self-service (the API now answers 403 with a sentence).
9. **Bulk Import**: template has `Item` and `Received Into Code`; Vendor Code optional; show the preview's `item` per row.
10. **Cancelled PO**: show `originally_ordered_units` ("15 ordered · 15 cancelled") and hide "Receive all waiting" when `waiting_units` is 0; line cards can use `originally_ordered` / `cancelled_value`.

## 16. Files

New: `backend/app/core/idempotency.py`, `backend/app/items/suggest.py`, `backend/app/alembic/versions/d2e4f6a8b0c2_s7_idempotency_and_po_number_index.py`, tests `backend/tests/core/test_s7_idempotency.py`, `backend/tests/lifecycle/test_s7_row_locks.py`, `backend/tests/reports/test_s7_home_erp_resilience.py`, `backend/tests/reports/test_s7_setup_and_reports.py`, `backend/tests/erp/test_s7_item_suggestions.py`, `backend/tests/assets/test_s7_link_suggestions.py`, `backend/tests/asset_users/test_s7_store_rooms_everywhere.py`, `backend/tests/imports/test_s7_import_items.py`, `backend/tests/purchase_orders/test_s7_cancelled_totals.py`, this report.

Changed: `app/main.py`, `app/alembic/env.py`, `app/core/errors.py`, `app/lifecycle/service.py`, `app/assets/router.py`, `app/assets/linking.py`, `app/purchase_orders/{service,header,schemas}.py`, `app/home/{service,router}.py`, `app/erp/{source,router,service,inbox}.py`, `app/items/service.py`, `app/reports/router.py`, `app/asset_users/{router,schemas,service,store_rooms}.py`, `app/masters/bulk_import_export.py`, `app/imports/{asset_import_service,router}.py`, and the 8 tests in §11.
