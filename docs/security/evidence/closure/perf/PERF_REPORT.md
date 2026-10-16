# CKAM security closure — did the hardening make normal work slower?

Date: 2026-10-16, 11:40–11:55 IST, one machine, both systems measured side by side in the same minutes.
Scope: local disposable test stacks only. No production host, ERP, NAS or other 10.x address was contacted.

## Verdict in one paragraph

No. Every everyday operation is within the threshold (new ≤ old + 25 % or + 50 ms, whichever is larger), and
most are within noise (ratio 0.95–1.05). Three items are measurably slower and all three are explained:

- **Refused sign-in (unknown login id): 6 ms → 39 ms (+33 ms).** By design (AU-01). The server now does a
  real Argon2 check against a dummy hash, so "no such account" takes as long as a wrong password and the
  response time no longer shows which login ids exist. A normal, successful sign-in is unchanged: 43 → 46–48 ms
  (+3–5 ms, ratio 1.05–1.11), and the same with the rate limiter switched on (43.7 → 47.7 ms, no 429).
- **Bulk Move of 50 assets: 159–168 ms → 183–202 ms (+23 to +34 ms, ratio 1.15–1.20).** Within the threshold
  (the 50 ms allowance applies). Cause, measured: the OBS-STATUS lifecycle marker
  (`SELECT set_config('ckam.lifecycle_writer', …, true)`) is sent twice per asset, i.e. **+100 SQL statements**
  per 50-asset move (408 → 508), each a database round trip. The guard trigger itself costs nothing measurable
  (bulk move with the trigger enabled 190 ms vs disabled 198 ms, same stack, alternating). A single Move pays
  +2 statements (19 → 21), +0.5 to +2 ms.
- **Token refresh: 2.3 → 3.6 ms (+1.3 ms, ratio 1.5–1.6).** The ratio looks large only because the base is
  tiny. The refresh now reads and updates a server-side session record (AU-06 reuse detection). Not
  noticeable to a person.

## Method

| Item | Detail |
|---|---|
| Old system | `ckam-pf-old`: `git archive 4ba4e94` (the commit before the security programme), built from that export's own `docker-compose.yml` (no edge network), web 3811 / api 8800 / db 25482, Alembic to its own head `e6f8a0b2c4d6` |
| New system | `ckam-pf-new`: the working tree at HEAD `734fd19`, web 3911 / api 8900 / db 25492, `CKAM_EDGE_SUBNET=172.31.215.0/28`, `CKAM_WEB_IP=172.31.215.10`, Alembic head `c6e8a0b2d4f6` |
| Settings both | Own env file with throw-away values, all `PO_SOURCE_*` empty (no ERP link), `ENVIRONMENT_NAME=uat`, identical PostgreSQL command line (`postgres:17`, 17.11) plus `pg_stat_statements` (`track=top` while timing). Same Python packages in both images (FastAPI 0.141.1, Starlette 1.7.0, SQLAlchemy 2.1.1, asyncpg 0.31.0, uvicorn 0.54.0, argon2-cffi 25.1.0, pydantic 2.13.5) |
| Rate limiting | New stack: `RATE_LIMIT_ENABLED=false` for the throughput runs (like `scratchpad/sec/uat-override.yml`); one extra run with it **on** for single-user sign-in (row 2) |
| Path measured | Every API call goes **through each stack's nginx** (web port), exactly like a browser, except rows 28–31 which call uvicorn directly to isolate one control |
| Client | Node 24 built-in `fetch` (keep-alive), on the same host; a sample = request sent → full response body read |
| Order | Per operation: warm-up on both stacks first (1–3 calls each), then samples **alternating** old/new, with the first stack alternating each round, so drift of the machine hits both equally |
| Samples | 15–30 per small operation, 8 for the big ones (bulk move 50, receive 50/100, batch 200); a **repeat run** of all non-receive operations (big ones with 15 samples) a few minutes later |
| Statistic | median and p95 (nearest-rank) in ms; ratio = new / old; verdict OK if new − old ≤ max(25 % of old, 50 ms) |
| Host | Intel Core i9-14900KS (32 logical CPUs), 64 GB, Windows 11 Pro, Docker Desktop 29.8.0 on WSL2 (kernel 6.6.87.2). Other local stacks (`ckam-build`, `ckam-sec`, supabase, ckgv) were running but idle and were not touched |

### Dataset (identical on both, built through the real API)

`scripts/seed_perf.py`, the pattern of `scratchpad/sec/seed_security_fixture.py`: one direct insert of a
head-office admin `PERFHO` (Primary Owner), everything else through the HTTP API: 1 company, location, cost
centre, stock room, store, 2 categories, 2 Items (serial laptop, no-serial chair), 20 vendors, 60 employees,
**150 POs** (2 lines each: 4 serial laptops + 10 chairs) of which 140 received in full = **1,960 assets**, 300 of
them moved to employees (6 bulk moves), plus 92 dedicated unreceived POs that the receive timings use (one fresh
PO per sample), and 40 ERP-copy POs (80 lines) written straight into the local `erp_*` tables (there is no ERP
link). After seeding both databases had exactly the same counts: asset 1,960, asset_event 2,260,
purchase_order 236, vendor 20, asset_user 66, audit_log 718, erp_po_line 80; the seed output (all ids) was
byte-identical (`raw/seed_old.json` = `raw/seed_new.json` apart from the run time). During the timed run the
receives and batch adds grow both databases by the same ~3,400 assets.

## Results (main run; repeat-run ratio in the last column)

All times in milliseconds. `[x B / y B]` = response size old / new.

| # | Operation | n | Old median | Old p95 | New median | New p95 | Δ median (ms) | Ratio median | Ratio p95 | Verdict | Repeat run ratio (median) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Sign-in (correct password) | 20 | 43.1 | 46.8 | 47.8 | 59.2 | +4.7 | 1.11 | 1.26 | OK | 1.05 (43.6 → 45.9) |
| 2 | Sign-in, one user every 7 s, new stack WITH rate limiting on | 15 | 43.7 | 50.9 | 47.7 | 54.2 | +4.1 | 1.09 | 1.06 | OK | – |
| 3 | Refused sign-in, unknown login id (AU-01 dummy hash) | 20 | 6.3 | 7.7 | 39.2 | 57.1 | +32.9 | 6.20 | 7.41 | By design (AU-01) | 6.91 (5.9 → 40.6) |
| 4 | Token refresh (rotating cookie) | 20 | 2.3 | 2.6 | 3.6 | 4.9 | +1.4 | 1.60 | 1.84 | OK | 1.48 (2.8 → 4.2) |
| 5 | Asset search, universal term 'laptop' (page 1) | 20 | 21.2 | 24.3 | 20.4 | 22.4 | -0.8 | 0.96 | 0.92 | OK | 0.97 (36.6 → 35.7) |
| 6 | Asset search, partial serial 'PFL0077' | 20 | 18.1 | 19.3 | 17.8 | 19.7 | -0.3 | 0.98 | 1.02 | OK | 0.98 (34.6 → 33.8) |
| 7 | Asset list filtered IN_STOCK + NON_IT, page 1 | 20 | 7.6 | 10.1 | 7.4 | 9.5 | -0.3 | 0.96 | 0.94 | OK | 0.98 (8.6 → 8.4) |
| 8 | Asset list IN_STOCK, deep page (offset 1500) | 20 | 8.2 | 9.8 | 7.9 | 8.6 | -0.3 | 0.97 | 0.88 | OK | 0.95 (8.6 → 8.2) |
| 9 | Asset 360 (detail + events + documents + changes, parallel) | 20 | 10.0 | 12.3 | 10.3 | 11.6 | +0.2 | 1.02 | 0.94 | OK | 1.05 (10.0 → 10.5) |
| 10 | PO list (first 200) | 20 | 12.9 | 14.1 | 12.7 | 14.1 | -0.2 | 0.99 | 1.00 | OK | 1.01 (14.9 → 15.0) |
| 11 | PO detail (header + line groups + units, parallel) | 20 | 11.1 | 13.1 | 11.2 | 12.4 | +0.1 | 1.01 | 0.95 | OK | 1.01 (12.1 → 12.3) |
| 12 | ERP copy PO list `/api/erp/pos?envelope=true` (local copy, 40 POs, no ERP link) | 20 | 16.7 | 18.2 | 16.8 | 18.9 | +0.1 | 1.00 | 1.04 | OK | 1.01 (17.7 → 17.9) |
| 13 | Reports: asset preview (50 rows) | 20 | 14.1 | 16.0 | 14.0 | 15.9 | -0.1 | 0.99 | 0.99 | OK | 1.03 (17.0 → 17.6) |
| 14 | Logs: audit trail query (50 rows, head-office admin) | 20 | 8.3 | 8.9 | 8.4 | 9.7 | +0.1 | 1.01 | 1.09 | OK | 1.02 (9.1 → 9.3) |
| 15 | Vendor create | 20 | 7.9 | 8.8 | 8.4 | 9.8 | +0.6 | 1.07 | 1.12 | OK | n/a (see caveats) |
| 16 | Item create | 20 | 10.1 | 11.2 | 10.6 | 11.6 | +0.5 | 1.05 | 1.04 | OK | n/a (see caveats) |
| 17 | Move 1 asset (stock room → employee) | 15 | 9.7 | 12.3 | 10.2 | 12.4 | +0.5 | 1.05 | 1.00 | OK | 1.17 (12.3 → 14.4) |
| 18 | Bulk Move of 50 assets | 8 | 168.4 | 202.5 | 202.3 | 238.0 | +33.9 | 1.20 | 1.18 | OK (see below) | 1.15 (159.1 → 182.5, n=15) |
| 19 | Receive 1 unit (no-serial item) | 15 | 22.5 | 28.5 | 22.2 | 28.2 | -0.3 | 0.99 | 0.99 | OK | – |
| 20 | Receive 10 units (no-serial item) | 15 | 21.6 | 29.6 | 22.5 | 29.0 | +1.0 | 1.04 | 0.98 | OK | – |
| 21 | Receive 50 units (no-serial item) | 8 | 33.2 | 35.8 | 34.4 | 36.4 | +1.2 | 1.03 | 1.02 | OK | – |
| 22 | Receive 100 units (no-serial item) | 8 | 45.6 | 49.1 | 46.1 | 55.2 | +0.5 | 1.01 | 1.12 | OK | – |
| 23 | Receive 10 serial units | 15 | 23.9 | 27.7 | 24.8 | 29.1 | +1.0 | 1.04 | 1.05 | OK | – |
| 24 | Batch Add Assets ×20 | 15 | 17.8 | 20.0 | 19.2 | 22.2 | +1.4 | 1.08 | 1.11 | OK | 1.05 (20.2 → 21.2) |
| 25 | Batch Add Assets ×200 | 8 | 57.1 | 130.7 | 57.5 | 129.8 | +0.4 | 1.01 | 0.99 | OK | 1.05 (53.5 → 56.0, n=15) |
| 26 | Static index.html through nginx [796 B / 479 B] | 30 | 0.5 | 0.7 | 0.5 | 0.8 | +0.0 | 1.00 | 1.13 | OK | 1.02 (0.6 → 0.6) |
| 27 | Static main JS bundle through nginx, each stack's own build [1,372,252 B / 1,374,248 B] | 30 | 6.7 | 8.9 | 6.6 | 11.4 | -0.2 | 0.98 | 1.28 | OK | 0.99 (7.4 → 7.3) |
| 28 | uvicorn `/assets/<JS file>`, the SAME dist copied into both (IF-01 lexical + resolve check) | 30 | 7.4 | 9.9 | 7.4 | 10.7 | 0.0 | 1.00 | 1.07 | OK | 1.01 (8.3 → 8.4) |
| 29 | uvicorn `/assets/<missing file>` (404 path) | 30 | 1.0 | 1.3 | 1.1 | 1.4 | +0.1 | 1.12 | 1.09 | OK | 1.13 (1.5 → 1.7) |
| 30 | 4 MB JSON body straight to uvicorn (N1 body-limit middleware; vendor name too long → 422 in both) | 15 | 29.1 | 50.2 | 27.7 | 43.2 | -1.4 | 0.95 | 0.86 | OK | 1.11 (28.2 → 31.4) |
| 31 | Small JSON body, same route (1 KB name → 422) | 15 | 2.9 | 4.5 | 3.2 | 3.9 | +0.3 | 1.09 | 0.86 | OK | 1.01 (3.7 → 3.8) |

Every sample of the main run returned the expected status (0 failures in `raw/main_samples.csv`).
The repeat run's search times are higher on BOTH stacks (21 → 36 ms) because by then both databases had grown
by the same ~3,400 assets from the receive and batch timings; the old/new ratio stayed the same.

**ERP endpoint, honestly:** `/api/erp/pos` answers from CKAM's own local copy of the ERP data. With no ERP link
it read the 40 fixture POs (80 lines) written into `erp_po_line`; no live ERP query was timed (none exists on
these stacks). A real ERP refresh is out of scope here.

## Cost of each new control, measured separately

| Control | How measured | Result |
|---|---|---|
| OBS-STATUS lifecycle guard **trigger** (`trg_asset_lifecycle_fields_guard`) | New stack, bulk Move of 50, trigger enabled vs disabled with `ALTER TABLE … DISABLE TRIGGER` on the disposable DB, alternating, 10 samples each (`raw/trigger_summary.json`; trigger re-enabled afterwards, state `O`) | enabled median 190.1 ms, disabled 198.0 ms: **no measurable cost** (the difference is noise, opposite sign). `pg_stat_statements` with `track=all` shows 0 nested statements: the trigger function runs no SQL |
| OBS-STATUS lifecycle **marker** (`SELECT set_config(...)`, 2 per `apply_events` call) | `pg_stat_statements` (`track=all`), reset, ONE request, then counted (`raw/statements_per_request.json`) | Bulk Move 50: **408 → 508 statements** (+100 = 2 per asset: `apply_events` is called per asset inside its own savepoint); DB execution time 8.7 → 10.1 ms. Move 1: 19 → 21 statements. The extra wall time (+23 to +34 ms per 50 assets, ≈0.3 ms per statement) is round-trip latency, not database work |
| Audit trail on a bulk Move | same statement count | ONE `INSERT INTO audit_log` per bulk move in both versions (unchanged). The new TRUNCATE guards (AU-10) are statement-level `TRUNCATE` triggers: they never fire on INSERT/UPDATE |
| N1 body-limit middleware | (a) end to end: 4 MB JSON straight to uvicorn, row 30; (b) in-process: 4 MB in 64 × 64 KB chunks through `BodyLimitMiddleware` to a no-op app (`raw/micro_new.json`) | (a) 29.1 → 27.7 ms (noise); (b) **+7.5 µs per 4 MB request** (7.7 µs → 15.2 µs) |
| IF-01 lexical static-path check (production single-uvicorn) | (a) row 28, same JS file from uvicorn in both; (b) in-process `timeit` | (a) 7.4 → 7.4 ms; (b) `is_safe_relative_name` **2.5 µs**, the full `safe_asset_path` (lexical + resolve + link check + is_file) 44.7 µs vs the old bare `is_file` 4.3 µs, i.e. **+40 µs per static file** |
| AU-01 dummy password hash on a refused sign-in | row 3 end to end; in-process `burn_password_check` | **+33 ms** per refused sign-in (6.3 → 39.2 ms); the Argon2 check itself is 28.8 ms here (`verify_password` of a real hash: 28.6 ms). The code comment says "~40 ms"; on this CPU it is ~29 ms in-process, ~33 ms end to end. Expected, by design |
| AU-03 rate limiter | row 2: one user signing in every 7 s with the limiter on vs old (no limiter) | 43.7 → 47.7 ms, the same +4 ms as with the limiter off (row 1); 15/15 answered 200, no 429 |
| AU-05/AU-06 session version + server-side refresh sessions | rows 1, 4 | sign-in +3 to +5 ms (session record written), refresh +1.3 ms; every other authenticated request: no extra query (the version check uses the account row that was already loaded) |

## Anything slower than the threshold?

**Nothing exceeds the threshold.** The closest is the bulk Move of 50 (+34 ms in the main run, +23 ms in the repeat;
the allowance is 50 ms), fully explained by the +100 marker statements above. Not required, but if bulk moves of
hundreds of assets become common, a cheap improvement is available without weakening the control: switch the
marker on once per transaction in the bulk path (or skip the explicit "off" call, since `set_config(..., true)`
already ends with the transaction), which would remove most of the 100 extra round trips. This is a suggestion
for the lead, no code was changed.

The refused-sign-in increase (+33 ms) is deliberate (it closes the account-enumeration timing leak) and only
affects sign-ins that fail.

## Caveats

- Docker Desktop on WSL2 with a loopback client: absolute numbers are lower than over a LAN, the old/new ratios
  are what matters. Production runs uvicorn directly on Windows with PostgreSQL 18 on another host; there each
  extra SQL round trip costs more than here (LAN latency), so the bulk-move marker overhead would grow with the
  network round-trip time (100 × RTT per 50 assets). At 0.5 ms LAN RTT that is about +50 ms per 50 assets.
- The repeat run's Vendor/Item create rows are not valid: the repeat reused the first run's names and every
  call got "already exists" (422) on both stacks. The main-run rows (15, 16) are valid (all 201).
- The trigger on/off experiment and the statement-count step consumed stock-room assets on the stacks unevenly
  (new: 1,050 more moved), so in the repeat run the two stock rooms held different numbers of assets. Only Move
  timings take assets from there, and a Move's cost does not depend on how many other assets are in stock.
- Rows 26–27 compare each stack's own frontend build (the JS differs by 2 KB; index.html is smaller in the new
  build because the Google Fonts links are gone). Rows 28–29 use the same build in both to isolate the backend
  check.
- 8 samples (main) / 15 (repeat) for the big operations; p95 of 8 samples is effectively the maximum.
- `pg_stat_statements` was loaded on both databases throughout (`track=top` while timing, `all` only for the
  statement counts), identical on both sides.

## Files

- `raw/main_samples.csv`, `raw/main_summary.json`, `raw/main_console.txt` — main run (every sample: op, stack, ms, status, bytes)
- `raw/main_samples_repeat.csv`, `raw/main_summary_repeat.json`, `raw/repeat_console.txt` — repeat run
- `raw/rl_samples.csv`, `raw/rl_summary.json` — sign-in with the rate limiter on
- `raw/statements_per_request.json` — statement counts and the per-statement breakdown for bulk Move 50 and Move 1
- `raw/trigger_samples.csv`, `raw/trigger_summary.json` — trigger enabled vs disabled
- `raw/micro_new.json` — in-process micro-benchmarks (lexical check, Argon2, body-limit middleware)
- `raw/seed_old.json`, `raw/seed_new.json`, `raw/seed_*.log` — dataset ids and counts of both stacks
- `raw/smoke_*.{csv,json}` — the first read-only smoke run (not used for the table)
- `raw/summary_table.csv`, `raw/table.md` — the table above, machine-readable
- `scripts/seed_perf.py`, `scripts/bench.mjs`, `scripts/make_table.mjs`, `scripts/micro_new.py`,
  `scripts/*-override.yml`, `scripts/pf-stacks.env.example` (commands and settings; throw-away secrets omitted).
  `bench.mjs` reads `raw/seed_*.json` next to itself: to rerun, put the scripts and a `raw/` folder side by side.

## Clean-up

Both disposable projects were removed with `docker compose … down -v --rmi local`: afterwards 0 containers,
0 images, 0 volumes and 0 networks named `ckam-pf-*` remained (checked with `docker ps -a`, `docker images`,
`docker volume ls`, `docker network ls`). The scratch source export, its tar file and the copied frontend build
were deleted. `ckam-build`, `ckam-sec` and every other stack were not touched and are still running. No product
code was edited, no git command that writes was run, no pytest was run.
