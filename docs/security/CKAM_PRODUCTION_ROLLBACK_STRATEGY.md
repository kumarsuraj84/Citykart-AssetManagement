# CKAM Production Rollback Strategy — security release `<RELEASE-SHA>` (roll forward first)

| | |
|---|---|
| Status | **PREPARED — OWNER APPROVAL PENDING.** Nothing here has been run. Every command is `NOT EXECUTED`. No rollback, downgrade or restore is authorised by this document |
| Date | 2026-10-17; **(updated 2026-10-17, security release)** with the gate rehearsal results (`docs/security/evidence/closure/gate/GATE_REHEARSAL.md`, findings GT-F01, GT-F04, GT-F05) and the package rebuild |
| Applies to | The deploy of `<RELEASE-SHA>` (package SHA-256 `<ZIP-SHA256>`, `<ZIP-SIZE>` bytes; the lead fills both from the rebuilt package) to 10.0.1.98, replacing `3b5e842`, with database `ckassetmanagement` on 10.0.0.205 going from Alembic `e6f8a0b2c4d6` to `c6e8a0b2d4f6`. The earlier candidate `eed3de1` (SHA-256 `be3209af…`) is superseded; the gate rehearsal ran on it, with the same application code |
| Steps referred to | A–N of `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` |
| Scripts | `ops\windows\rollback_release.ps1.template` switches the release folder only and never touches the database. `deploy_ckam.ps1.template`: the old version **restarted the previous release automatically** after a late failure; that is being removed in the rebuilt package. **Until the operator has read the fixed template, rely on no automatic rollback** (§6) |

## 1. In plain words

Going back is **not** as simple as "put the old program back". The new release changes the database in four
small ways. The last change adds a guard that the **old** program does not know about. With that guard in place the
old program can still record a **receipt** (new assets), but it can no longer record a **move, a repair, a sale or
a scrap**. Worse, the user only sees "Some of the values could not be saved. Check them and try again.", which
sounds like their own typing mistake; the real reason is only in the server log (GT-F01). The old program also
still has the file-read hole. So if something goes wrong after the database change, the first choice is to **fix forward**:
keep CKAM stopped, find the problem, and start the new release again. Going back is possible in two ways, and both
are decisions for the owner. Nothing goes back automatically.

Example: you fitted a new lock and a new key at the same time. If the new key sticks, you do not put the old key
back, because it no longer fits the new lock. You fix the new key while the door stays shut.

## 2. What is safe and what is not

| Code running | Database at | Works? | IF-01 | Verdict |
|---|---|---|---|---|
| `<RELEASE-SHA>` | `c6e8a0b2d4f6` | yes (target) | closed | **target state** |
| `3b5e842` | `e6f8a0b2c4d6` | yes (as before the window) | **open** | the state before the deploy; only a temporary fallback when the database was never changed (case 1) |
| `3b5e842` | `f9a1c3e5b7d2` … `b5d7f9a1c3e5` (first 1–3 migrations only) | yes for `b5d7f9a1c3e5`: the gate rehearsal (option (b), `downgrade -1`) ran receive, move and sale on it with the old code. 1–2 only: expected yes, not tested | **open** | cannot happen after a failed upgrade (all four roll back together, §3); only after a deliberate `downgrade -1` (option 1a) |
| `3b5e842` | **`c6e8a0b2d4f6`** | **PARTLY (GT-F01, measured).** **Receives still work** (new asset rows are inserted already in their final state, so the `BEFORE UPDATE OF …` trigger never fires). **Every move, send for repair, back from repair, lost, found, dispose, sell, scrap and bulk move/action is refused** by `trg_asset_lifecycle_fields_guard`, because it updates `asset.status` / `current_asset_user_id` / `status_since` without the marker. Users see a **misleading** HTTP 422 "Some of the values could not be saved. Check them and try again."; the real reason is only in `error.jsonl` (`DBAPIError`: "asset status, holder and status date can only change through a recorded asset movement (asset_event)"). Nothing is half-written. Reads and sign-in work | **open** | **UNSAFE — never as a "quick rollback"** |
| `<RELEASE-SHA>` | `e6f8a0b2c4d6` | **NO, and it hides it (GT-F05, measured).** `/api/health` 200, the app page loads, a bare `verify_release.ps1` passes, but **every sign-in fails** with the same misleading 422 (server log: `column asset_user.token_version does not exist`). Caught only by `alembic current` ≠ `alembic heads`, the startup `system_event` `migration / head_mismatch` WARNING, and a real sign-in | closed | **UNSAFE — this is why the migrations run before the new code starts, and why H2/H3/H13 are mandatory** |
| `<RELEASE-SHA>` | `b5d7f9a1c3e5` (only the trigger migration downgraded) | yes. The DB-level lifecycle guard (OBS-STATUS, defence in depth) is gone; diagnostics report a migration mismatch | closed | acceptable **temporarily**, by owner decision only (option 1a, §5) |

## 3. Facts the decisions depend on

- **All four migrations run in one database transaction.** `app/alembic/env.py` wraps `run_migrations()` in a
  single `begin_transaction()` and does not set `transaction_per_migration`, and PostgreSQL has transactional DDL.
  So `alembic upgrade head` either applies all four or none. After a failed upgrade the database is still at
  **`e6f8a0b2c4d6`**, not "at the previous revision": nothing of migrations 1–3 is kept (GT-F04; fault-injected
  in the gate rehearsal: migration 4 forced to fail, the whole run rolled back). Always confirm it with
  `alembic current` or `SELECT version_num FROM alembic_version;`.
- **The old code's behaviour on the fully migrated schema is measured (GT-F01):** receive works; move, repair,
  lost/found, dispose, sell, scrap and bulk actions are refused with a misleading 422. See §2.
- **The new code's behaviour on the un-migrated schema is measured (GT-F05):** it looks healthy but nobody can sign
  in. See §2.
- **Migration 4 (`c6e8a0b2d4f6`) only adds a trigger and its function.** It changes no row. Its downgrade drops
  both.
- **Migrations 1–3 are additive** (a column with default 0, TRUNCATE triggers plus a stricter purge function, a new
  table). Their downgrades drop what they added (details in §5 option 1).
- **The downgrade scripts exist only in the new release** (`releases\<RELEASE-SHA>\backend\app\alembic\versions\`). A
  downgrade must be run from `releases\<RELEASE-SHA>\backend`, with the `.env` values loaded.
- **`3b5e842` was installed without `constraints.txt`.** After step F2 the shared venv holds the `<RELEASE-SHA>` pinned
  versions (including the newly pinned `colorama`). Gate rehearsal (Linux container whose packages equal the 43
  runtime pins exactly): `3b5e842`'s backend ran in production mode on those versions, signed in, received, moved
  and sold (steps 2, 6a, 6b). **On the Windows venv this is not tested** (`TO BE FILLED BY LEAD` if a Windows run is
  added). `rollback_release.ps1 -ReinstallBackend` reinstalls `3b5e842`'s backend, but it does not downgrade
  packages that already satisfy its loose requirements.
- **While CKAM is stopped, IF-01 cannot be used** (nothing answers on 3211). Keeping CKAM down is a protection, at
  the cost of availability.

## 4. Decision tree by failure point

```
Where did it fail?
│
├─ Before F1 (steps A–E: records, logs, precheck, backup, copy)  ──> CASE 0: nothing changed in CKAM. Abort = do nothing.
│
├─ F1–F4, and alembic current shows e6f8a0b2c4d6  ──────────────> CASE 1: SAFE ABORT (database unchanged)
│
├─ F4 succeeded (c6e8a0b2d4f6), new app does not start (G)  ────> CASE 2: keep CKAM stopped, fix forward
│
├─ New app runs, security checks pass, a functional smoke check fails (H13–H19)  ──> CASE 3
│
├─ An IF-01 probe or another security check fails (H4–H9, H11, H12)  ──> CASE 4: stop CKAM, fix forward
│
└─ After rotation (I/J) something breaks  ──────────────────────> CASE 5: fix the one secret, service first
```

### CASE 0 — failure before F1 (A–E)

- **Situation:** CKAM `3b5e842` is still running; nothing in CKAM changed. Production is exactly as vulnerable as
  before.
- **Do:** stop the change. Record why. Keep the evidence (B) and the dump (D). Leave `releases\<RELEASE-SHA>` in place if
  it was expanded (delete nothing). Re-plan.
- **Safe:** yes. **Who decides to re-plan:** APPROVER.

### CASE 1 — failure in F1–F4 with the database still at `e6f8a0b2c4d6` (SAFE ABORT)

Typical causes: the pip install failed (package index, wheel), the settings switch is wrong, `alembic upgrade`
failed (lock wait, permission, unexpected schema).

1. **Do not start `<RELEASE-SHA>`.** It cannot sign anyone in on the old schema, and it would hide that: health and the
   app page look fine (GT-F05). A failed `alembic upgrade head` leaves **all four** migrations unapplied (GT-F04).
2. Confirm the database revision (`NOT EXECUTED`):
   `& "$root\shared\venv\Scripts\python.exe" -m alembic current` (from `releases\<RELEASE-SHA>\backend`, `.env` loaded),
   or ask the DBA for `SELECT version_num FROM alembic_version;`. It must be `e6f8a0b2c4d6`. If it is anything
   else, this is **not** case 1: go to case 2.
3. The owner chooses one of two:
   - **1-A (restore service, IF-01 stays open):** switch back to `3b5e842`:
     `rollback_release.ps1 -ToSha 3b5e842 -ReinstallBackend` (`NOT EXECUTED`), or by hand: restore
     `FRONTEND_DIST_DIR`/`APP_VERSION` from the copy made in D5, then `pip install -e <ROOT>\releases\3b5e842\backend`,
     then start. Then smoke-test sign-in and one read, because of the package-version caveat in §3. **Production is
     then back where it was this morning: still vulnerable.** Re-plan the deploy urgently.
   - **1-B (stay down):** keep `CKAM-Web` stopped until the cause is fixed and the deploy is repeated.
4. Never `alembic downgrade` here (nothing to downgrade) and never restore the dump (nothing to restore).

### CASE 2 — migrations done (`c6e8a0b2d4f6`), new app does not start (G)

Typical causes: `Refusing to start` (JWT secret rule), `DATABASE_URL` missing or wrong (the dev fallback
`localhost:5432` gives a connection error), an import error or missing package (pip), port 3211 still taken, a
launcher error (path, quoting, flags), a log folder that cannot be written.

1. **Keep CKAM stopped. Do NOT start `3b5e842`.** On this schema it can still receive but cannot move, repair,
   sell or scrap (misleading 422 for the users, GT-F01), and it reopens IF-01. If any script restarted it
   automatically, stop `CKAM-Web` again at once.
2. Read `logs\ckam-web_*.err.log`, the launcher log, and the last `system_event` lines in `logs\app\app.jsonl`.
3. Fix the cause and start again. Examples: correct the `JWT_SECRET` value (C3 check), restore the missing
   `DATABASE_URL` line from the D5 copy, rerun F2, free the port (CKAM's own process only), fix the launcher.
4. **Time box:** if it is not fixed within `TO BE FILLED BY LEAD (owner's maximum downtime; the gate rehearsal
   gives no Windows start-up time)`, the owner chooses between staying down longer (the recommended choice) and the options in §5.

### CASE 3 — new app runs, security checks pass, a functional smoke check fails (H13–H19)

IF-01 is closed while `<RELEASE-SHA>` runs. **Running `<RELEASE-SHA>` with a functional fault is safer than running `3b5e842`
with the hole.**

| Failing check | Recommended response (owner confirms) |
|---|---|
| Sign-in fails for everyone (H13), often as a 422 "Some of the values could not be saved…" while `/api/health` is ok | **First suspect GT-F05: the migrations did not run** (or ran against another database). Check `alembic current` vs `alembic heads`, the `head_mismatch` event and `error.jsonl` (`token_version does not exist` / `auth_session` missing). If the database is at `e6f8a0b2c4d6`: stop CKAM, this is really case 1 (run F4, then start again). Otherwise stop CKAM and diagnose like case 2 (DB connection, clock). Fix forward |
| Asset list / PO screens fail (H14, H15) | Keep CKAM running if sign-in works; capture the request id from the error, the `error_log` row and the diagnostics bundle; fix forward with a corrected release |
| Move refused (H17) — users see 422 "Some of the values could not be saved…"; `error.jsonl` says "asset status, holder and status date can only change through a recorded asset movement" | First check that the **new** code is really serving (H2/H11/H12): the **old** code gives exactly this on the migrated schema (GT-F01), and a successful receive (H16) does not tell them apart. If the new code is serving, the lifecycle trigger is refusing a write of the new code. **Owner decision:** keep the new code and downgrade **only** the trigger migration (option 1a, §5), or stay down until a fix is released. Do not switch to `3b5e842` (its moves are refused by the same trigger) |
| ERP copy fails (H18) | Not a blocker: the ERP screens say "not set up" or show stale data, and it fails safe. Re-check after a minute (a past deploy saw a one-minute network blip to 10.0.1.69). Continue the gate if everything else passes; open a follow-up |
| Upload/download fails (H19) | Usually the NAS mapping (launcher log). Fix `nas.pw` / mapping; the rest of CKAM works. Continue the gate only if the owner accepts it |
| QR direct link fails (H10) | Check that `<RELEASE-SHA>` is really serving (H2/H11). If it is, this is a defect in the CL2-IF-04 fix: keep running (IF-01 is closed) and fix forward |

### CASE 4 — an IF-01 probe or another security check fails (H4–H9, H11, H12)

A probe returning anything other than `404` (especially `200`), Swagger or OpenAPI being served, a duplicated
header, `server: uvicorn`, or a forged `X-Forwarded-For` being believed.

1. **Stop `CKAM-Web` at once** if any traversal probe returns `200` or a body other than the plain 404. The hole may
   still be open.
2. Check that the right code is running before you suspect the fix: H2 (`app_started` with `<RELEASE-SHA>`), H11 (bundle
   `<BUNDLE-JS>`), H12 (launcher log `releases\<RELEASE-SHA>`), the process command line (G3). Common causes: the
   launcher still pointing at an old folder, or a second listener. On the LAN run: a proxy in between, or the wrong
   host.
3. `400` instead of `404` on a probe is reported as WARN by `verify_release.ps1`. Analyse it before deciding: it is
   a refusal, but it is not the expected answer.
4. **Do not rotate any secret** (step I must wait). **Do not switch to `3b5e842`**: it is vulnerable by definition.
5. Fix forward (a corrected launcher or release), then repeat G and H. While CKAM is down, the hole cannot be used.
   How long CKAM may stay down is the owner's decision.

### CASE 5 — after a rotation (I/J) something breaks

| Secret | Symptom | Response |
|---|---|---|
| JWT | the app refuses to start (`Refusing to start`) | the new value is too weak or has a quote or space: fix it and restart. Do not go back to the old value (it may have been copied) |
| DB password (`ckassetapp`) | the app cannot connect; `database.ok` false; launcher/err log shows an authentication error; or the nightly backup fails | check that the `DATABASE_URL` password part is URL-safe (see `CKAM_SECRET_ROTATION_CHECKLISTS.md` §2) and typed correctly; the DBA can set the password again with `\password`. Re-setting the **old** password is a last resort for service only, followed by an immediate second rotation |
| NAS (`ckappuser` or the new CKAM-only account) | uploads/downloads fail; the launcher's NAS mapping line fails | fix `shared\nas.pw` / the stored credential / the stale mapping; CKAM itself keeps working |
| ERP (`PO_SOURCE_PASSWORD`) | `sync_failed`; ERP screens "not set up" | fails safe; ERP-OWNER and IT fix the value together |

In every case: **service first, then re-rotate**. Never paste a value into chat or a ticket.

## 5. The two owner-decision options for going BACK after the migrations

Use these only when fixing forward is not possible within the owner's tolerance. **Who decides:** the APPROVER (CKAM
owner / management), after hearing IT and the DBA, recorded in the change record with the time and the words used.
**Who executes:** the DBA (database) and IT (app server); the owner types the database passwords. **Before either:**
take a **fresh** dump of the current database (it contains everything written since D), and export the audit rows
written since D (`GET /api/admin/logs/export?kind=audit&from=<D time>&format=jsonl`, if the app can run;
otherwise the DBA exports `audit_log WHERE at >= <D time>` read-only).

### Option 1 — migration downgrade, one revision at a time

Run from `releases\<RELEASE-SHA>\backend` with the `.env` values loaded (`NOT EXECUTED`):
`& "$root\shared\venv\Scripts\python.exe" -m alembic downgrade <target revision>`, then `alembic current`.

| Target | Undoes | Consequence | Which code can run afterwards |
|---|---|---|---|
| **1a: `b5d7f9a1c3e5`** (undo migration 4 only) | drops `trg_asset_lifecycle_fields_guard` and `forbid_asset_lifecycle_write()` | no data change. The database no longer refuses lifecycle writes from outside the ledger (OBS-STATUS defence in depth lost). Diagnostics report a migration mismatch (`head_mismatch` WARNING event at start) | `<RELEASE-SHA>` (**IF-01 stays closed**, recommended if only the trigger is the problem) **or** `3b5e842` (IF-01 open) |
| 1b: `a3c5e7f9b1d4` (also undo 3) | drops `auth_session` | all server-side session records are gone. `<RELEASE-SHA>` can no longer sign anyone in | `3b5e842` only (IF-01 open) |
| 1c: `f9a1c3e5b7d2` (also undo 2) | drops the TRUNCATE guards; restores the old purge function (1-day floor) | the append-only tables can again be emptied by `TRUNCATE`, and recent audit rows can again be purged with the session flag (IF-05/IF-06 protections lost) | `3b5e842` only |
| 1d: `e6f8a0b2c4d6` (undo all four) | drops `asset_user.token_version` | session versions are lost (meaningless to the old code) | `3b5e842` only |

Business data (assets, events, POs, audit rows) is **not** removed by any of these downgrades. Only security
structures are. Going below 1a means running `3b5e842`, which means **IF-01 is open again**. The owner must then
decide about the interim exposure (§7).

**Gate rehearsal results (updated 2026-10-17, security release; Linux, PostgreSQL 17, package alembic, owning role):**
- **1a (`alembic downgrade -1`)**: exit 0 in 0.89 s; only the lifecycle guard removed; `auth_session`,
  `token_version`, the TRUNCATE guards and the 5-year purge floor kept; the old code then received, moved and sold
  correctly; a later `alembic upgrade head` re-added the guard and the new code worked again; ledger consistent.
  **This is the only downgrade the gate rehearsal recommends**, run from `releases\<RELEASE-SHA>\backend` (`3b5e842`'s
  alembic does not know these revisions), followed by `alembic upgrade head` before the fixed release starts again.
- **1d (`alembic downgrade e6f8a0b2c4d6`, all four)**: exit 0 in 0.78 s, the old code worked, re-upgrade worked,
  but every `auth_session` row (refresh-token reuse history) and every `token_version` value is lost, IF-05 (TRUNCATE)
  and IF-06 (purge without the 5-year floor) reopen, and whether a refresh token revoked before the downgrade becomes
  usable again after a re-upgrade was **not tested**. **Not recommended (never 1d).** 1b and 1c have the same kind of
  losses and were not rehearsed separately.
- A rollback to `3b5e842` reopens IF-01 in every variant (gate step 7: 5 of 5 probes leaked the fake canaries).

### Option 2 — restore the pre-deploy dump (taken in step D)

- **Consequence: everything written to `ckassetmanagement` after the backup time is LOST.** That includes receipts,
  moves, edits, new users, sign-in and security rows, and the audit rows of the deploy window itself (also the H16/H17
  smoke-test rows). `audit_log` is append-only by design, so a restore is the one action that removes audit rows.
  This is why they must be exported first.
- After the restore, the database is at `e6f8a0b2c4d6`, and only `3b5e842` can run: **IF-01 is open again.**
- It is destructive. The DBA runs it on 10.0.0.205 against `ckassetmanagement` only (never another app's database),
  with CKAM stopped. The method is the one documented for the backup script (for a custom-format dump typically
  `pg_restore --clean --if-exists -d ckassetmanagement <dump>`, `NOT EXECUTED`). Verify afterwards with
  `alembic_version` = `e6f8a0b2c4d6` and row counts against C7.
- Use it only if the database itself is damaged (not merely incompatible). In every other situation, option 1a or
  fixing forward loses less.

## 6. What must NOT happen automatically

- **No automatic `alembic downgrade`** and **no automatic restore**, by any script or person, without the owner's
  recorded decision.
- **No automatic start of `3b5e842` after a successful migration (updated 2026-10-17, security release).** The
  `deploy_ckam.ps1.template` shipped with the superseded `eed3de1` package did exactly that: its `Invoke-Rollback`
  restarted the previous release on a failure in its steps 6–9. After a failed **migration** that is harmless (the
  database is unchanged, GT-F04). After a **successful** migration it left `3b5e842` running on `c6e8a0b2d4f6`:
  receives still work, but moves, repairs, sales and scraps are refused with a misleading 422 (GT-F01), and IF-01
  is reopened. **The template is being fixed right now (another engineer) so that it no longer restarts the old
  release after the migrations.** Until the operator has **read the fixed template** in the rebuilt package
  (`Invoke-Rollback` and its callers) and written in the change record what it does on each failure, **nobody
  relies on any automatic rollback**: every failure is handled by hand with this document. If any log shows
  `database at head c6e8a0b2d4f6` and then `ROLLBACK:` (or `3b5e842` is running after F4 for any reason), the
  operator stops `CKAM-Web` immediately and continues with case 3 or 4.
- **No acceptance on health alone (GT-F05).** A deploy, an abort or a roll-forward is judged by `alembic current`
  vs `alembic heads`, the `app_started` event (no `head_mismatch`) and a real sign-in, never by `/api/health` or a
  bare `verify_release.ps1` run.
- **`rollback_release.ps1` is not run after F4** without the owner's decision. It switches the code only and warns
  that the schema stays.
- No deletion of a release folder, a dump, a log copy or an evidence file as part of a rollback.

## 7. Interim protection while a fix is prepared

- **Keeping CKAM stopped** keeps IF-01 unreachable. It is the default response in cases 2 and 4.
- If the owner decides that CKAM must run `3b5e842` again (case 1-A, or options 1b–1d / 2), production is
  vulnerable again. The owner **may later decide** to close or restrict the router forward of TCP 3211 (EXT-05 /
  SD-04) for that period. **This document does not authorise that change**. It is listed so that the decision is
  made consciously and recorded.
- No secret is rotated while any vulnerable code is reachable (rotation only after H passes).

## 8. How long things take

| Item | Duration |
|---|---|
| Stop CKAM (F1) | `TO BE FILLED BY LEAD` (not rehearsed: no Windows task in the gate rehearsal) |
| `pip install -c constraints.txt -e` on the server (F2) | `TO BE FILLED BY LEAD` (not rehearsed on Windows; depends on the package index) |
| `alembic upgrade head`, four migrations (F4) | **0.86 s wall** in the gate rehearsal (a few ms of DDL; metadata only, does not grow with table size; a lock wait is the only realistic delay) |
| Start until `/api/health` ok (G) | `TO BE FILLED BY LEAD` (not rehearsed on Windows) |
| Full H verification | `TO BE FILLED BY LEAD` (not rehearsed on Windows; includes a phone QR scan and a manual receive/move) |
| `rollback_release.ps1` switch-back (code only) | `TO BE FILLED BY LEAD` (the script was not run; the gate rehearsal switched by hand) |
| Option 1a downgrade (drop trigger) | **0.89 s wall** in the gate rehearsal |
| Option 1d downgrade (all four; not recommended) | 0.78 s wall in the gate rehearsal |
| Option 2 restore of the D dump | `TO BE FILLED BY LEAD` (not rehearsed: destructive; depends on the dump size; restore drill EXT-08) |
| Reference point | the scripted 2026-10-14 deploy of `3b5e842` took about 30 seconds of downtime (`docs/ai/PRODUCTION_INFRASTRUCTURE.md`) |

## 9. Evidence to keep for any rollback or abort

- The case number and the decision (who, when, words used, channel) in the change record.
- `alembic current` before and after any downgrade, and `SELECT version_num FROM alembic_version;` from the DBA.
- The fresh dump taken before a downgrade or restore (name, size, SHA-256) and the audit export since D (with its
  SHA-256).
- The err/launcher log lines that showed the failure; `verify_release.ps1` CSVs; probe CSVs.
- The `.env` allow-listed print before and after the switch (non-secret keys only).
- The `deploy_ckam_*.log` / `rollback_to_*.log` files written by the scripts, if they were used.
- An incident-record entry if the rollback reopened IF-01 (dates and times the old code was reachable again).
