# WP-B results — database (OBS-STATUS, IF-05 / IF-06 role split, least-privilege evidence)

Date: 2026-10-16. Starting HEAD `b401e9f`, Alembic head before: `b5d7f9a1c3e5`. Everything below ran on the dev
machine only: the dev Postgres 17 container (compose project `ckam-build`, service `db`), the test database
`ckam_test`, and throw-away databases/roles that were dropped afterwards. Nothing touched 10.0.0.205, 10.0.1.98, the
NAS, the ERP warehouse or 10.0.1.12. No git write commands were run (the lead commits).

## Status per item

| Item | Change | Tests | Result | Residual |
|---|---|---|---|---|
| **OBS-STATUS** | Migration `c6e8a0b2d4f6`: `BEFORE UPDATE OF status, current_asset_user_id, status_since ON asset` row trigger `trg_asset_lifecycle_fields_guard` (`WHEN … IS DISTINCT FROM …`) calling `forbid_asset_lifecycle_write()`: refuses the change with a plain error unless the transaction-local marker `ckam.lifecycle_writer = on`. `app/lifecycle/service.py::apply_events` (and so `apply_event`) switches the marker on right before its write and off right after its flush (`set_config(…, true)`). INSERT not affected | `tests/lifecycle/test_obs_status_guard.py` (13 cases); the whole lifecycle / import / PO / correction / bulk suite | **FIXED — code + permanent tests.** A stray ORM write or raw `UPDATE asset SET status/current_asset_user_id/status_since` is refused (also for a non-superuser role); `apply_event(s)`, receipts, bulk moves, imports, corrections and edits still work; the marker does not survive the transaction and is already off again after `apply_events` inside the same transaction; a marker set in a rolled-back savepoint is gone; `PUT /api/assets/{id}` with `status`/`current_asset_user_id`/`status_since` in the body changes none of them | **Honest limit:** any session that can run SQL as the app role can set the marker itself (shown in `rs_05` CAN-07). This is defence in depth against application bugs and stray writes, not a barrier against a malicious database user. The barrier against a database user is the role split (below), under which the runtime role cannot disable or drop this trigger (`rs_05` CANNOT-09…11). Strong form = follow-up design (section 6) |
| **IF-05 / IF-06 (EXT-07)** | `ops/db/role_split.sql`, `ops/db/role_split_verify.sql`, `ops/db/check_least_privilege.sql`, `ops/db/ROLE_SPLIT_RUNBOOK.md`; `backend/app/alembic/env.py` `ALEMBIC_SET_ROLE` | Local simulation `rs_01`…`rs_07`; permanent `tests/security/test_least_privilege_role_split.py` | **LOCAL SIMULATION PASSED — PRODUCTION STILL REQUIRES A DBA (EXT-07).** After the split the runtime role was refused all 40 attacks in the matrix (TRUNCATE, ALTER, DISABLE/ENABLE REPLICA/DROP TRIGGER, replace a trigger function, CREATE anything, `session_replication_role`, purge function, UPDATE/DELETE ledgers incl. with the purge flag, `alembic_version` writes, roles/extensions/databases, `SET ROLE`, COPY TO PROGRAM, OBS-STATUS writes) while the application worked end to end as that role (11/11 smoke steps) | Production still runs with `ckassetapp` as owner until a DBA runs the split (section 7). A superuser can always do anything |
| **OBS-DOCKER-SU** | Tools only. The dev/UAT app role `ckam` is still a superuser; the dev stack was **not** switched (needs the owner; `conftest.py` TRUNCATE clean-up needs `session_replication_role`) | `rs_08_dev_stack_check.out.txt` (read-only): 15 FAIL / 18 PASS / 1 INFO for `ckam` on `ckam_test` | **OPEN — tools ready, owner decision.** The least-privilege behaviour is now demonstrated by the throw-away simulation and by the permanent pytest instead | Switching dev/UAT needs a separate privileged test-cleanup role |
| **Least-privilege evidence (repeatable)** | `ops/db/check_least_privilege.sql`: 34 PASS/FAIL/INFO rows for any database + runtime role | Same pytest (runs the check body before the split: expected FAILs present; after: zero FAIL); negative control: with the append-only revoke removed from a copy of `role_split.sql`, the pytest fails | **DONE** | — |
| N9 (optional) | Not done (not in this task) | — | DEFER | As in the register |

## 1. Files

Added:
- `backend/app/alembic/versions/c6e8a0b2d4f6_asset_lifecycle_fields_guard.py`
- `backend/tests/lifecycle/test_obs_status_guard.py`
- `backend/tests/lifecycle/fixture_marker.py` (fixture-only helper `allow_lifecycle_fixture_write`)
- `backend/tests/security/__init__.py`, `backend/tests/security/test_least_privilege_role_split.py`
- `ops/db/role_split.sql`, `ops/db/role_split_verify.sql`, `ops/db/check_least_privilege.sql`, `ops/db/ROLE_SPLIT_RUNBOOK.md`
- Evidence in this folder (below)

Changed:
- `backend/app/lifecycle/service.py` — marker on before the write, off after the flush; `LIFECYCLE_WRITER_SETTING`, `_set_lifecycle_writer`
- `backend/app/alembic/env.py` — `_set_migration_role`: with `ALEMBIC_SET_ROLE=<owner>` the session runs `SET ROLE <owner>`, checks `current_user`, commits, then migrates. Unset = unchanged behaviour

## 2. Existing tests / fixtures changed, and why

| File | Change | Why |
|---|---|---|
| `tests/reports/test_dashboard.py::test_dashboard_scopes_by_company_and_long_allocation_alert` | Calls `allow_lifecycle_fixture_write(session)` before backdating `old_asset.status_since` by 200 days, then flushes | The only fixture that wrote a lifecycle field directly (an "allotted 200 days ago" state the ledger cannot produce: a backdated event before PROCURED is refused). Intended: the database now refuses it without the marker |
| `tests/lifecycle/test_s4_batch_events.py::test_a_batch_takes_a_constant_number_of_queries` | Limit `<= 6` → `<= 7` (the "few vs many" assertion is unchanged) | +2 statements per batch, never per asset (marker on/off); 59 assets still take the same number of statements as 1 |
| `tests/core/test_s3a1_master_audit_migration.py`, `tests/observability/test_admin_api.py` (2 asserts), `tests/observability/test_system_events.py` (2 asserts) | Expected head `b5d7f9a1c3e5` → `c6e8a0b2d4f6`; chain assertion added | New head (intended change) |

Searched for other direct writers: `grep` of `backend/tests` for `.status =`, `status_since =`, `current_asset_user_id =`, `update(Asset)`, raw `UPDATE asset` — every other hit is an INSERT (constructor) or an `update(Asset)` of other columns (`erp_item_code`, `barcode`, `subcategory_id`, `asset_domain`), which stay allowed. The full suite confirms it. Application code: the only UPDATE writer is `apply_events`; the INSERT-time initial state in `assets/service.py` and `imports/asset_import_service.py` is unaffected.

## 3. Migration

- Revision `c6e8a0b2d4f6`, down-revision `b5d7f9a1c3e5`; `alembic heads` → `c6e8a0b2d4f6 (head)` (single head; `rs_06`).
- Touches no row. Data migrations that updated these columns are older revisions and run before the trigger exists.
- Verified: `ckam_test` upgraded `b5d7f9a1c3e5 → c6e8a0b2d4f6`; fresh database `upgrade head` from empty (permanent pytest, every run); downgrade −1 / upgrade head as the migrator (`rs_06`, and in the pytest).
- The dev database `ckam` was **not** upgraded (it is at `a3c5e7f9b1d4`; the running dev API process still has old code in memory). See section 8.

## 4. Local role-split simulation (Part 2) — evidence

Throw-away database `ckam_rs` and roles `ckam_rs_owner` (NOLOGIN), `ckam_rs_migrator`, `ckam_rs_app` inside the dev
Postgres; driver `rs_sim.sh` (phases A–H), seed `rs_seed.py`, API smoke `rs_smoke.py`. Passwords were throw-away and
are masked in the logs; the one-time admin password printed by an old seed migration is redacted.

| Step | Evidence | Result |
|---|---|---|
| Baseline `\du` / `\l` | `rs_01_setup_presplit.out.txt` | only role `ckam`; databases `ckam`, `ckam_test`, `postgres`, templates |
| Production-like start: `ckam_rs_app` owns `ckam_rs` and runs `alembic upgrade b5d7f9a1c3e5`; S0/S4 world seeded as that role | `rs_01` | OK |
| `check_least_privilege.sql` before the split | `rs_01` | FAIL on ownership (72 objects), database owner, schema CREATE, TEMP, the 4 ledgers, TRUNCATE everywhere, `alembic_version`, purge EXECUTE — the production situation today |
| IF-05 residual before the split (rolled back) | `rs_01`, `rs_presplit_residual.sql` | the owning runtime role DISABLEd `trg_audit_log_no_truncate` and TRUNCATEd `audit_log` (0 rows inside the transaction, 37 after the rollback) |
| `role_split.sql` as superuser; verify; second run (idempotent) | `rs_02_role_split.out.txt` | 44 PASS, 1 expected FAIL (`trg_asset_lifecycle_fields_guard` missing: not yet migrated); second run clean |
| (1) `alembic upgrade head` as the **migrator** with `ALEMBIC_SET_ROLE` | `rs_03_alembic_as_migrator.out.txt` | `b5d7f9a1c3e5 → c6e8a0b2d4f6`; the new function and every table/index/sequence owned by `ckam_rs_owner`; the runtime role's `alembic downgrade -1` fails "must be owner of relation asset"; re-run split + verify: **45/45 PASS** |
| (2) API smoke as the **runtime** role (throw-away uvicorn on 127.0.0.1:8790 inside the dev api container, ERP sync off, ERP host blank) | `rs_04_api_smoke_as_runtime.out.txt` | **11/11 PASS**: health, sign-in, PO with lines, receive (2 assets + PROCURED events), register, move (apply_event + marker), edit with a mass-assignment attempt (lifecycle fields unchanged, 7 field-change rows), refresh, report a problem, vendor create, sign-out. 45 audit rows, 3 asset events, 1 auth session written |
| (3)+(5) can / cannot matrix as the runtime role, OBS-STATUS trigger present | `rs_05_can_cannot_matrix.out.txt`, `rs_runtime_matrix.sql` | **7/7 CAN, 40/40 CANNOT refused**; counts unchanged afterwards |
| (4) new object by the migrator | `rs_05`, `rs_migrator_new_object.sql`, `rs_runtime_new_object.sql` | session `current_user = ckam_rs_owner`, `session_user = ckam_rs_migrator`; `wpb_probe` + sequence owned by the owner; runtime role: CRUD + sequence USAGE by default, no TRUNCATE/TRIGGER; it inserted a row, TRUNCATE/DROP refused; the migrator **as itself** (`SET ROLE NONE`) cannot create a table ("permission denied for schema public") |
| Downgrade / upgrade cycle as the migrator | `rs_06_downgrade_upgrade_cycle.out.txt` | trigger dropped then recreated, owned by the owner; single head |
| Cleanup + `\du` / `\l` | `rs_07_cleanup.out.txt` | database and three roles dropped; server back to the baseline (only `ckam`; `ckam`, `ckam_test`, `postgres`, templates) |
| Dev stack (read-only) | `rs_08_dev_stack_check.out.txt` | OBS-DOCKER-SU still visible: 15 FAIL for `ckam` |

### Can / cannot matrix (runtime role, after the split, trigger present)

CAN (needed by the app): read every table and `alembic_version`; INSERT `audit_log`; UPDATE an ordinary column of
`asset`; DELETE from `auth_session`; use sequences; (CAN-07, honest limit) set the OBS-STATUS marker itself.

CANNOT (each refused with "permission denied …" / "must be owner …" / the OBS-STATUS message):

| # | Attempt | # | Attempt |
|---|---|---|---|
| 01–04 | TRUNCATE `audit_log`, `asset_event`, `master_audit`, `asset_field_change` | 21–22 | UPDATE / DELETE `audit_log` |
| 05 | TRUNCATE an ordinary table | 23 | `SET LOCAL ckam.allow_audit_purge = on` + DELETE fresh audit rows |
| 06 | ALTER TABLE (add column) | 24–27 | UPDATE/DELETE `asset_event`, DELETE `master_audit`, UPDATE `asset_field_change` |
| 07–08 | DISABLE TRIGGER ALL / a named ledger guard | 28–30 | UPDATE / DELETE / INSERT `alembic_version` |
| 09–10 | DISABLE / ENABLE REPLICA the OBS-STATUS trigger | 31–33 | CREATE ROLE / EXTENSION (trusted `pgcrypto`) / DATABASE |
| 11–12 | DROP the OBS-STATUS trigger / the audit TRUNCATE guard | 34–35 | SET ROLE owner / migrator |
| 13 | DROP TABLE `audit_log` | 36 | take ownership of `audit_log` |
| 14 | replace a guard trigger function | 37 | make the purge function SECURITY DEFINER |
| 15 | create its own trigger | 38 | COPY … TO PROGRAM |
| 16–18 | CREATE TABLE in public / CREATE SCHEMA / CREATE TEMP TABLE | 39–40 | change `asset.status` / holder without the ledger writer |
| 19 | `SET session_replication_role = replica` | 20 | `SELECT ckam_purge_audit_log(…)` |

## 5. Permanent tests added

- `backend/tests/lifecycle/test_obs_status_guard.py` — 8 functions, 13 cases: ORM write refused (3 fields); raw SQL
  refused (4 statements); a non-superuser role refused while an ordinary column still changes; `apply_event` moves
  the asset; other columns (description, cost, vendor) and no-op writes allowed; marker off after `apply_event` in
  the same transaction and absent in the next transaction on the same connection; marker gone after a rolled-back
  savepoint; `PUT /api/assets/{id}` cannot mass-assign the three fields. Existing row-lock tests
  (`test_s7_row_locks.py`) pass unchanged.
- `backend/tests/security/test_least_privilege_role_split.py` — 2 functions: (a) the ops/db bodies contain no psql
  meta-commands, no password literal, and the two check scripts contain no writing statement; (b) the full split on a
  uniquely named throw-away database (`ckam_lpt_<tag>`) with three throw-away roles: production-like start, check
  before (expected FAILs), split twice, every check PASS, 7 CAN + 35 CANNOT + CREATE DATABASE + 2× SET ROLE as the
  runtime role, runtime `alembic downgrade` refused, migrator downgrade/upgrade with `ALEMBIC_SET_ROLE`, new-object
  ownership and default privileges, migrator-alone CREATE refused, checks after the migrations; everything dropped in
  `finally` and a final assertion that no `ckam_lpt_<tag>` role or database is left. Abandoned leftovers of a killed
  run (databases nobody is connected to) are removed at the start. Negative control done: with the append-only
  revoke deleted from a copy of `role_split.sql` (via `CKAM_OPS_DB_DIR`), the test fails; afterwards `\du`/`\l`
  were clean.
  **It needs `ops/` inside the api container** (`docker compose cp ops api:/app/`) because the image holds only
  `backend/`; without it the module is **skipped** with that instruction (the skip count would show it).

## 6. OBS-STATUS strong form — follow-up design (deliberately NOT built)

Column privileges would make the marker unnecessary as a barrier: grant the runtime role `UPDATE` on `asset` only
for every column **except** `status`, `current_asset_user_id`, `status_since`, and give it
`EXECUTE` on an owner-owned `SECURITY DEFINER` function `ckam_set_asset_state(asset_id, status, holder, since,
event_id)` that checks an `asset_event` row with that id exists for that asset in the current transaction and then
updates the three columns. Not built now because: (1) `apply_events` writes the three columns through the ORM in
one batched UPDATE and keeps the identity map consistent; replacing that with per-asset function calls (or an array
function) changes the core ledger path, its statement count and its savepoint behaviour in imports; (2) PostgreSQL
cannot subtract a column from a table-level UPDATE grant, so every future `asset` column would need its own column
grant in every migration (default privileges do not cover columns) — a silent breakage risk; (3) the role split
already removes the realistic bypass (the runtime role can no longer disable or drop the trigger). Revisit when the
role split is live in production.

The register originally proposed a deferred constraint trigger that requires an `asset_event` row in the same
transaction. Not used: the ORM flushes the asset UPDATE before the event INSERT (FK order), so the check must be
deferred to commit, and recognising "written in this transaction" needs `xmin` comparisons that break under the
per-row savepoints of the imports; the lead's task specified the marker design instead.

## 7. What a DBA must still do in production (EXT-07)

Follow `ops/db/ROLE_SPLIT_RUNBOOK.md`: management decision on names (proposal `ckasset_owner`, `ckasset_migrator`,
runtime stays `ckassetapp`; never reuse `ckam_app`) and window; run `check_least_privilege.sql` read-only first;
back up; stop `CKAM-Web`; run `role_split.sql` as superuser; `\password ckasset_migrator`; `pg_hba.conf` line for
the migrator from 10.0.1.98 only; `role_split_verify.sql` all PASS; start the app; from then on every deploy runs
Alembic as the migrator with `ALEMBIC_SET_ROLE=ckasset_owner`, followed by `role_split.sql` + verify. The deploy
that brings `c6e8a0b2d4f6` must start the new code right after the upgrade (old code without the marker cannot
record movements once the trigger exists; the normal deploy order — stop, upgrade, start — already guarantees it).

## 8. Notes for the lead

- Run `alembic upgrade head` on the dev `ckam` database only together with restarting/rebuilding the api container:
  the running dev uvicorn still has the pre-WP-B code in memory; with the trigger present, its moves would be refused.
  (`docker compose cp` already placed the new code in `/app/app`.)
- To run the role-split pytest in the dev container: `docker compose cp ops api:/app/` before pytest.
- Smoke label: the step "POST /api/masters/vendors (master write + master_audit)" passed (201), but the vendor create
  was recorded in `audit_log`, not `master_audit` (count 0) — label wording only; INSERT on `master_audit` is
  proven by the privilege checks.
- `rs_04`: the stop command's own process matched its search pattern and was terminated too (exit 143); the
  throw-away uvicorn shut down cleanly ("Application shutdown complete") and no process on port 8790 remained.
- `rs_05` first attempt used `RESET ROLE` for the migrator-alone check, which returns to the role setting (owner) and
  therefore created the table; corrected to `SET ROLE NONE`, the stray table dropped, phase re-run. Runbook note: a
  migrator session that runs `RESET ROLE` is still the owner — intended.

## 9. Full backend run

One complete run on `ckam_test` (after `docker compose cp` of `backend/app`, `backend/tests` and `ops` into the dev
api container), 2026-10-16:

`2484 passed, 2 skipped, 1303 warnings in 478.91s (0:07:58)`

= previous baseline 2464 + 5 added by the lead + 15 new WP-B cases (13 OBS-STATUS + 2 role split). The 2 skips are
the pre-existing ones in `tests/core/test_n2_forwarded_for.py` (Dockerfile / repository checkout not in the image);
the role-split test ran (not skipped). After the run `\du` showed only `ckam` and `\l` only `ckam`, `ckam_test`,
`postgres` and the templates.
