# CKAM closure RETEST 2 — PART B: external concurrency burst (SESSIONS + CONCURRENCY area)

Independent second retest. Stack `ckam-sec` (web :3411, API :8200, Postgres :25442), rebuilt from HEAD 734fd19
(Alembic head c6e8a0b2d4f6). All bursts were **real**, run with Node `Promise.all` (10–30 truly parallel ordinary
HTTP requests) against our own local test stack — an explicitly authorised purpose. Throw-away objects tagged `CL2-`.
Actor for the write bursts: `SECHO` (head-office admin). Reference ids (from the security fixture): company CKSPL=1,
cost centre=1, vendor=1, item laptop(serial)=1, item chair(no-serial)=2, CKSPL stock room=3, SPA stock room=5.

Scripts: `scripts/b_concurrency.mjs`, `scripts/b_fix.mjs` (receive scenarios re-run with the required invoice fields),
`scripts/b_g_authstorm.mjs`. Raw histograms: `raw/b_concurrency.json`, `raw/b_g_authstorm.json`.
Integrity SQL: `scripts/integrity.sql`.

## Burst table

| # | Scenario | Requests | Outcome histogram | Integrity verdict |
|---|---|---|---|---|
| a | Same PO number ×20 | 20 parallel `POST /api/purchase-orders` (same company+po_number) | `201×1, 422×19` | PASS — exactly 1 live PO `CL2-PO-DUP-1`; 0 duplicate live po_number per company. Partial unique index `uq_purchase_order_company_number_active` + advisory lock. |
| b | PO line of 6, receive 1 unit ×20 | 20 parallel `POST /{id}/receive` qty 1 | `200×6, 422×14` | PASS — exactly 6 units `DELIVERED`, 0 remaining, never negative, no over-receipt. `SELECT … FOR UPDATE` on PENDING units + `quantity > len(waiting)` guard → 422. |
| b2 | Same receive, ONE Idempotency-Key ×20 | 20 parallel `POST /{id}/receive` same key | `200×1, 409×19` | PASS — exactly 1 unit `DELIVERED`, 5 still `PENDING`. One request ran; the other 19 got 409 "already being processed". No double receipt. |
| c | Same serial on 20 parallel asset creates | 20 parallel `POST /api/assets` same serial | `201×1, 409×13, 422×6` | PASS — exactly 1 asset with serial `CL2-SER-DUP-1`. Pre-check 422 after first commit; the concurrent losers hit the partial-unique CI index `ux_asset_serial_number_ci` → `IntegrityError` → controlled **409** (WARNING, not 500). |
| d | Batch create ×20 same Idempotency-Key | 20 parallel `POST /api/assets/batch` same key | `201×1, 409×19` | PASS — exactly one batch created (3 assets); 19 got 409. |
| d2 | Batch create ×10 WITHOUT key | 10 parallel `POST /api/assets/batch` | `201×10` | PASS — 10 distinct batches, 0 duplicate asset codes (atomic `CodeCounter` UPSERT serialises code reservation). |
| e1 | Asset sold twice ×20 | 20 parallel `POST /{id}/events` SOLD | `201×1, 422×19` | PASS — exactly 1 `SOLD` event; asset status `SOLD`; losers get plain 422 "…so nothing more can be recorded". Terminal guard `_TERMINAL_STATUSES` + `FOR UPDATE` re-read. |
| e2 | Asset moved to two holders ×20 | 20 parallel `POST /{id}/events` MOVED (holder A / holder B) | `201×20` | PASS — all 20 serialised by the row lock; asset ends with **one** holder (= last event's target), `status == last event`, 0 split-brain, 20 distinct MOVED rows (no double event per transition). MOVED is legitimately repeatable, so all succeed sequentially — the invariant is single-holder consistency, which holds. |
| f | Same name ×20: vendor / brand / item / category | 20 parallel `POST` each | vendor `201×1,422×19`; brand `201×1,422×19`; item `201×1,422×19`; category `201×3,422×17` | PASS/NOTE — **Vendor** and **Brand**: exactly 1 active row (app-level advisory-lock `_active_name_exists` on live rows). **Item**: exactly 1 — enforced at the application layer ("an Item named … already exists"), there is **no DB unique** on item name. **Category**: the DB allows duplicate **names** (no name uniqueness); dedup is only via the auto-generated **code**, and the concurrent code generation let **3** distinct codes through before the full unique index on `code` rejected the rest → 3 active rows with the same name. All refusals are 422; no 500. |
| g | Parallel sign-ins / logouts / resets / issue-passwords on one user | 8 parallel (3 login, 2 reset, 2 issue, 1 logout) | `login 200×3, reset 200×2, issue 200×2, logout 204×1` | PASS — `token_version` ended at a single consistent value (2 → **7**, i.e. +5 for the 5 session-ending ops, no lost update; OBS-TV atomic `token_version = token_version+1 RETURNING`). The session established before the storm was dead afterwards (access 401, refresh 401). No 500. |
| h | Parallel refresh of ONE cookie ×20 | 20 parallel `POST /api/auth/refresh` same cookie | `200×20`, Set-Cookie on **exactly 1** | PASS — exactly one `ROTATED` (one new cookie); the other 19 were grace `DUPLICATE` (200, access token only, **no** Set-Cookie). Never two valid current cookies; no reuse false-positive (all within the 10 s grace); no 500. |
| i | Parallel PO create + deactivate + receive on same PO | 12 parallel (receive / deactivate alternating) | `200×6, 422×6` | PASS — controlled only: the deactivation cancelled the 4 pending units (`CANCELLED`), the racing receives were refused 422. No 500, no over-receipt, no orphan units. |

## Read-only integrity checks (after the bursts)

All from `scripts/integrity.sql` (raw output in `raw/integrity_output.txt`):

- Duplicate asset codes: **0**
- Duplicate live serial numbers (excl. `N/A`): **0**
- Asset with the dup serial `CL2-SER-DUP-1`: **exactly 1**
- Duplicate live `po_number` per company: **0**; active POs named `CL2-PO-DUP-1`: **1**
- PO lines with `delivered > ordered` (negative remaining): **0**
- Terminal double-events: asset 72 has **exactly 1** `SOLD` event, status `SOLD`
- Moved asset 73: `current_asset_user_id` == last event's `to_asset_user_id` (0 mismatch), 20 MOVED rows, single holder
- Orphan `pending_asset` rows: **0**
- `error_log` (last 20 min): only **13× WARNING / 409 `IntegrityError` "This record already exists."** — these are the controlled serial-race losers from scenario (c). **No 500, no raw SQL error text returned to any client.**
- `docker compose logs api db` scan: **no deadlock, no serialization failure, no 500, no traceback** (only a harmless Starlette `HTTP_422_UNPROCESSABLE_ENTITY` deprecation warning).

## Verdict

Every failed request in every burst was a controlled 4xx/409 (or 429 where the login rate limiter applied). No 500,
no raw SQL error, no data corruption, no duplicate/negative/orphan rows, no split-brain holder, no lost `token_version`
update, and never two simultaneously-valid refresh cookies. **Part B: PASS.**
