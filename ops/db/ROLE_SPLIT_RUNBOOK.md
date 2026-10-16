# CKAM database role split — DBA runbook (EXT-07)

Status: **LOCAL SIMULATION PASSED — PRODUCTION STILL REQUIRES A DBA (EXT-07).** Nothing in this folder has been run
on 10.0.0.205 or any other real server. Evidence of the local simulation:
`docs/security/evidence/closure/db/` (`WPB_RESULTS.md`).

Closes the residual of IF-05 / IF-06 (and OBS-DOCKER-SU once the dev stack follows): today the production
application role `ckassetapp` **owns** every CKAM table, so it can `DISABLE TRIGGER`, `DROP TRIGGER`, `TRUNCATE`
the audit tables after that, or rewrite the purge function. The guard triggers stop every role **except** the owner
and a superuser. After the split the running application is no longer the owner.

## 1. The three roles

| Role (proposal; names are a management decision, SD-11) | Login | Owns | Used by |
|---|---|---|---|
| `ckasset_owner` | no | the database, every CKAM table, sequence, function, trigger | nobody directly |
| `ckasset_migrator` | yes | nothing; member of the owner (NOINHERIT); every session in the CKAM database starts as the owner | `alembic upgrade head` during a deploy, nothing else |
| `ckassetapp` (unchanged name and password) | yes | nothing | the running app (`DATABASE_URL` in `shared\.env`) |

Do **not** call the runtime role `ckam_app`: that is the retired role on 10.0.1.12 and must stay dead there.
The scripts take every name as a psql variable; nothing is hard-coded.

What the runtime role can and cannot do afterwards (proven locally, see `WPB_RESULTS.md`):

- CAN: connect; SELECT/INSERT/UPDATE/DELETE on ordinary tables; take the next id from every sequence (`USAGE`,
  `SELECT`: `nextval`, `currval`); SELECT+INSERT on `asset_event`, `asset_field_change`, `master_audit`,
  `audit_log`; SELECT `alembic_version`.
- CANNOT: TRUNCATE anything; UPDATE/DELETE the four ledgers (also not with `ckam.allow_audit_purge = on`);
  ALTER/DROP any table; DISABLE/ENABLE/DROP a trigger; replace a trigger function; CREATE in the schema, create
  schemas, temporary tables, roles, databases or extensions; `SET session_replication_role`; run
  `ckam_purge_audit_log`; write `alembic_version`; `SET ROLE` to the owner or the migrator; **`setval` or
  `ALTER SEQUENCE`** on any sequence (CL2-IF-01: the runtime role has no `UPDATE` on sequences, so it cannot
  exhaust `audit_log_id_seq` — which silently stopped every audit row — or rewind `asset_event_id_seq` — which
  made every movement fail; `setval` is not undone by a rollback).
- CAN, and PostgreSQL cannot forbid it (CL2-IF-02): store its own session defaults with
  `ALTER ROLE ckassetapp [IN DATABASE ...] SET <parameter> = ...` (for example `default_transaction_read_only =
  on`, which makes every later write fail, also after a restart). `role_split.sql` ends with `RESET ALL` for the
  runtime role and both check scripts FAIL while any such default exists. Incident response: section 9.

## 2. Files

| File | What | Changes anything? |
|---|---|---|
| `role_split.sql` | Creates/adjusts the three roles, moves ownership of CKAM's objects (this database and schema only, one object at a time, never `REASSIGN OWNED`), sets the grants and the default privileges. One transaction, idempotent | yes |
| `role_split_verify.sql` | Every requirement as a PASS/FAIL row (includes `check_least_privilege.sql`) | no |
| `check_least_privilege.sql` | The general least-privilege checks for any CKAM database and runtime role (also usable today, before the split: it shows what is still wrong) | no |

Requirements: psql 10+ (for `\if`), PostgreSQL 16+ (production runs 18). Run from a machine that has psql and
can reach the database server, as a **superuser**, typing the superuser password yourself.

## 3. Before the window

1. Management decision on the names and the date (decision paper item 8, SD-11).
2. Read-only check of today's state (changes nothing):
   ```
   psql -X -h 10.0.0.205 -U postgres -d ckassetmanagement -v runtime_role=ckassetapp -f ops/db/check_least_privilege.sql
   ```
   Expected today: FAIL on "runtime role owns nothing", "table owners are not the runtime role", "does not own the
   database", schema CREATE, the append-only rows and "no UPDATE on any sequence" (the owner has every
   privilege). Keep the output. Two rows need a closer look before the window:
   - "id sequences: next id above the highest id ..." must already be PASS. A FAIL means a sequence was rewound,
     nearly exhausted or jumped (CL2-IF-01 damage): do **not** split until a DBA has repaired it
     (`SELECT setval('<seq>', (SELECT max(id) FROM <table>));` as superuser, after checking why).
   - "runtime role has no stored session defaults": a FAIL lists every `ALTER ROLE ckassetapp ... SET` value.
     CKAM needs none; `role_split.sql` clears them all. If one was set on purpose, write it down and decide first.
3. Check that `ckassetapp` owns nothing outside `ckassetmanagement` (the script never touches other databases, but
   you should know):
   ```
   SELECT datname FROM pg_database WHERE pg_get_userbyid(datdba) = 'ckassetapp';
   ```
4. Find out who else connects to `ckassetmanagement` (the split removes CONNECT from PUBLIC, so only the CKAM
   roles and superusers can connect afterwards): `SELECT DISTINCT usename FROM pg_stat_activity WHERE datname =
   'ckassetmanagement';` and the role used by the CKAM backup task. A non-superuser backup role needs
   `GRANT CONNECT ON DATABASE ckassetmanagement TO <it>` plus SELECT rights after the split.
5. **Back up** `ckassetmanagement` (normal deploy backup, `docs/ai/PRODUCTION_INFRASTRUCTURE.md`), and keep the
   output of `\dp` and `\l+ ckassetmanagement` for rollback.
6. The release that is deployed must contain `backend/app/alembic/env.py` with `ALEMBIC_SET_ROLE` support
   (security closure WP-B) and must already be at Alembic head (deploy first, split second, or split in the same
   window right after `alembic upgrade head`).

## 4. In the window (exact order)

1. Stop the app: disable/stop the `CKAM-Web` task on 10.0.1.98 (no session may hold locks while ownership moves).
2. Run the split as superuser on the database server, connected to `ckassetmanagement`:
   ```
   psql -X -v ON_ERROR_STOP=1 -h 10.0.0.205 -U postgres -d ckassetmanagement ^
        -v db_name=ckassetmanagement -v owner_role=ckasset_owner -v migrator_role=ckasset_migrator ^
        -v runtime_role=ckassetapp -f ops/db/role_split.sql
   ```
   (`current_owner` defaults to the runtime role, which is who owns the objects today.)
   Any error = nothing changed (one transaction). Read the message, fix, run again.
3. Give the migrator a password, at the psql prompt (never on the command line, never in a file):
   ```
   psql -X -h 10.0.0.205 -U postgres -d ckassetmanagement
   \password ckasset_migrator
   ```
   `ckassetapp` keeps its existing password (rotate it as part of EXT-02 if not yet done).
4. `pg_hba.conf` on 10.0.0.205: allow `ckasset_migrator` exactly like `ckassetapp` (only from `10.0.1.98/32`,
   `scram-sha-256`, database `ckassetmanagement`), then `SELECT pg_reload_conf();`. The owner role is NOLOGIN and
   needs no line.
5. Verify (every row PASS):
   ```
   psql -X -h 10.0.0.205 -U postgres -d ckassetmanagement -v db_name=ckassetmanagement ^
        -v owner_role=ckasset_owner -v migrator_role=ckasset_migrator -v runtime_role=ckassetapp ^
        -f ops/db/role_split_verify.sql
   ```
6. Start `CKAM-Web`. `DATABASE_URL` in `shared\.env` is unchanged (still `ckassetapp`).
7. Tests afterwards (section 7).

## 5. Running Alembic after the split (every future deploy)

The app's `DATABASE_URL` (runtime role) can no longer migrate: it cannot create or alter anything. Migrations
run as the migrator **in that one shell only**, switched to the owner:

```
REM on 10.0.1.98, in the release folder, in a new cmd window that is closed afterwards
set DATABASE_URL=postgresql+asyncpg://ckasset_migrator:<typed at run time>@10.0.0.205:5432/ckassetmanagement
set ALEMBIC_SET_ROLE=ckasset_owner
alembic upgrade head
```

- `ALEMBIC_SET_ROLE` makes `backend/app/alembic/env.py` run `SET ROLE ckasset_owner` before any migration and
  check that it worked. The role setting written by `role_split.sql`
  (`ALTER ROLE ckasset_migrator IN DATABASE ckassetmanagement SET role = ckasset_owner`) does the same at sign-in,
  so a forgotten variable still creates owner-owned objects. Belt and braces: the migrator alone (NOINHERIT) has
  no CREATE right anywhere, so a migration that somehow ran as the migrator itself fails instead of creating
  objects with the wrong owner.
- Avoid putting the password in the URL where it is logged; prefer setting `PGPASSWORD` in that shell or a
  `pgpass.conf` readable only by the deploying account, and delete it afterwards.
- **After every `alembic upgrade head`, run `role_split.sql` again (idempotent) and then `role_split_verify.sql`.**
  Why: new tables get the runtime grants automatically (default privileges for the owner role), but a new table
  that must be append-only would also get UPDATE/DELETE from the defaults until the split re-applies the
  append-only revokes; re-running also re-asserts every other rule.

### Rules for future migrations (developers)

1. Never assume the migration runs as the app role; never `GRANT ... TO ckassetapp` by name inside a migration
   (names differ per environment). Default privileges give the runtime role SELECT/INSERT/UPDATE/DELETE on new
   tables and USAGE/SELECT (never UPDATE, CL2-IF-01) on new sequences. The app must never call `setval` or
   `ALTER SEQUENCE`; a data migration that needs it runs as the owner (the migrator), which is allowed.
2. A new append-only table: add it to the `append_only` list in `role_split.sql` step 5 and to the `ao` list in
   `check_least_privilege.sql`, add its guard triggers to `expected_triggers`, and give it the same
   UPDATE/DELETE/TRUNCATE triggers as the existing ledgers.
3. A new SQL function the app must call: default `EXECUTE` to PUBLIC applies, nothing to do. A dangerous function
   (like `ckam_purge_audit_log`): `REVOKE ALL ON FUNCTION ... FROM PUBLIC` in the migration.
4. A new guard trigger: add it to `expected_triggers` in `check_least_privilege.sql`.

## 6. Rollback

Everything the script did is reversible by a superuser, without data loss:

```
BEGIN;
-- give everything back to the old owner (the runtime role), one object type at a time (same loop as step 3 of
-- role_split.sql with owner and current owner swapped) -- simplest: run role_split.sql's step 3 by hand, or:
ALTER DATABASE ckassetmanagement OWNER TO ckassetapp;
-- for each table:     ALTER TABLE public.<t> OWNER TO ckassetapp;
-- for each function:  ALTER ROUTINE public.<f>(...) OWNER TO ckassetapp;
GRANT CONNECT, TEMPORARY ON DATABASE ckassetmanagement TO PUBLIC;   -- only if it was granted before (\l+ output)
COMMIT;
```

Then `DROP OWNED BY ckasset_owner; DROP ROLE ckasset_owner;` and the same for the migrator **only after**
`check_least_privilege.sql` shows that `ckassetapp` owns everything again. The app needs no change (its
`DATABASE_URL` was never changed). Deploys then run Alembic as `ckassetapp` again (without `ALEMBIC_SET_ROLE`).

The local simulation showed no reason to roll back: sign-in, PO with lines, receipt, move, edit, refresh,
report a problem, master create and sign-out all worked as the runtime role.

## 7. What to test afterwards

1. `role_split_verify.sql`: every row PASS.
2. As `ckassetapp` (psql, inside `BEGIN; ... ROLLBACK;`): `TRUNCATE audit_log` → permission denied;
   `ALTER TABLE asset_event DISABLE TRIGGER ALL` → must be owner; `SET session_replication_role = replica` →
   permission denied; `SELECT ckam_purge_audit_log(now() - interval '6 years')` → permission denied;
   `UPDATE asset SET status = 'LOST' WHERE id = (SELECT min(id) FROM asset)` → refused by
   `trg_asset_lifecycle_fields_guard`; `SELECT setval('audit_log_id_seq', 1)` → permission denied for sequence
   (CL2-IF-01; setval is not undone by ROLLBACK, so run it only after the split, when it must be refused). The full
   list the local simulation ran is `docs/security/evidence/closure/db/rs_runtime_matrix.sql`.
3. In the app: sign in, open the asset register, record a movement, edit an asset, create a PO with lines and
   receive it, sign out. `system_event app_started` shows the expected migration head.
4. Next deploy: Alembic as the migrator (section 5), then verify again.

## 8. What this does not cover

- A superuser can still do anything (by definition). Protect the superuser password; keep CKAM's runtime and
  migrator roles off it.
- The OBS-STATUS marker (`ckam.lifecycle_writer`) is settable by the runtime role: the asset-state trigger stops
  application bugs and stray writes, not a person who signs in as `ckassetapp` with psql. Column-level revoke of
  `asset.status/current_asset_user_id/status_since` plus a SECURITY DEFINER writer function is the documented
  follow-up design (WPB_RESULTS.md, "OBS-STATUS strong form"); it is deliberately not built now.
- Backups (EXT-08): a `pg_dump` taken as the runtime role still works (it can read every table and sequence),
  but the dump then records `ckasset_owner` as the owner; a restore must run as a superuser (or with
  `--no-owner` followed by `role_split.sql`). Check the backup task and the restore drill after the split.
- Stored session defaults of the runtime role (CL2-IF-02) cannot be prevented, only detected and reset
  (section 9). Run `check_least_privilege.sql` after every deploy and whenever CKAM suddenly fails every write.

## 9. Incident response: the runtime role's stored settings or a damaged id sequence

Symptoms: every save fails ("cannot execute ... in a read-only transaction", "canceling statement due to statement
timeout", tables "do not exist" after a `search_path` change), surviving restarts of `CKAM-Web`; or audit rows stop
appearing in Logs while the app works (the error log and the launcher's stderr show "CKAM logging: could not write
audit_log ... failures so far", repeated at most once a minute, plus a `system_event` `logging/write_failed` row
when the database still accepts it); or every asset movement fails with "A record with this id already exists".

1. Read-only diagnosis as superuser: `check_least_privilege.sql` with `-v runtime_role=ckassetapp`. Look at
   "runtime role has no stored session defaults" (lists the values) and "id sequences: next id above the highest
   id ..." (names the sequence and the problem). Keep the output for the incident record.
2. Stored settings (CL2-IF-02), as superuser:
   ```
   ALTER ROLE ckassetapp RESET ALL;
   ALTER ROLE ckassetapp IN DATABASE ckassetmanagement RESET ALL;
   ```
   (or simply re-run `role_split.sql`, which does both and checks every database). New connections are clean;
   restart `CKAM-Web` so the pooled connections pick it up.
3. A damaged sequence (CL2-IF-01), as superuser, for the sequence the check names:
   `SELECT setval('<seq>', (SELECT max(id) FROM <table>));` then re-run the check.
4. Either one means someone used the runtime credentials outside the app: treat it as a credential compromise
   (rotate the `ckassetapp` password, EXT-02; review `pg_stat_activity` and the server log for its origin).
5. `role_split_verify.sql` must be all PASS again before closing the incident.
