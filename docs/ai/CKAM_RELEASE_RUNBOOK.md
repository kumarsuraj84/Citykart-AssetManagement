# CKAM — Release Runbook

> **Status (security IF-15, 2026-10-16): CODE/REFERENCE SIDE FIXED — LIVE LAUNCHER STILL REQUIRES EXT-13.**
> Production is **not** Docker. It is one uvicorn process on Windows (app server 10.0.1.98, task `CKAM-Web`,
> port 3211), described in `docs/ai/PRODUCTION_INFRASTRUCTURE.md`. The reviewed, secret-free reference scripts for
> it are in `ops/windows/` (launcher, release, verify, rollback; see its README). The live launcher and task on the
> server have not yet been compared with them (EXT-13). Sections 1–15 below describe the **Docker dev/UAT stack**
> only; for production follow section 0.

## 0. Windows production release (single port, no Docker)

Deploying is a separate step that needs the owner's explicit request. The owner types any superuser database or
NAS password on the servers himself; nothing secret goes into a script, a log, a report or chat.

1. **Dev PC.** All tests green (CLAUDE.md rule 4). Build the frontend with `VITE_APP_VERSION=<sha> npm run build`
   and run `npm run check:build` (no source maps, no external hosts). Rehearse the migrations on a scratch copy of
   the database. Package `backend\{app, alembic.ini, pyproject.toml, constraints.txt, scripts\create_owner.py,
   VERSION}` and `frontend\dist` (as `frontend-dist`) into `ckam-release-<sha>.zip`.
2. **Backup.** On 10.0.0.205 run task `CK_Backup_CKASSETMANAGEMENT` and confirm `backup.log` says OK.
3. **Deploy.** On 10.0.1.98, elevated Windows PowerShell 5.1, with the reviewed copy of
   `ops/windows/deploy_ckam.ps1.template`: first `-WhatIf`, then for real:
   `.\deploy_ckam.ps1 -Sha <sha> -PackagePath <zip> -BackupConfirmed`. It refuses to continue unless
   `ENVIRONMENT_NAME=production` and `JWT_SECRET` meets the production rules (checked without printing it), saves
   `shared\.env` as `.env.pre-<sha>`, stops `CKAM-Web`, installs the pinned packages (`pip install -c
   constraints.txt`), switches `FRONTEND_DIST_DIR` (the single release switch) and `APP_VERSION`, runs
   **`alembic upgrade head` before the start**, starts the task and runs the smoke test. On a failure the earlier
   template switched the settings back and restarted the previous release, even after the migrations had run; the
   database is never rolled back automatically. *(Updated 2026-10-17, security release: that automatic restart of
   the previous release after the migrations is being removed from the template. Until you have read the fixed
   template in the release package, rely on no automatic rollback; for the security release follow
   `docs/security/CKAM_PRODUCTION_ROLLBACK_STRATEGY.md`.)*
4. **Verify.** `ops/windows/verify_release.ps1 -BaseUrl http://127.0.0.1:3211 -ExpectedRelease <sha> -ReleaseDir
   <AppRoot>\releases\<sha> -LauncherLogDir <AppRoot>\logs` (read-only), then once more from a LAN PC against
   `http://10.0.1.98:3211`. Expected: no FAIL; every security header exactly once; `/api/does-not-exist` a JSON
   404; every traversal probe 404. Then the functional smoke test (sign in, Home, Asset Register, one asset).
   *(Updated 2026-10-17, security release: `verify_release.ps1` has no migration check, and new code on an
   un-migrated database still answers `/api/health`; also confirm `alembic current` = heads, diagnostics health
   (version, `production`, migrations ok) and a real sign-in. `/docs`, `/redoc`, `/openapi.json` are a JSON 404 in
   production.)*
5. **Rollback (code only).** `rollback_release.ps1 -ToSha <previous>` (first `-WhatIf`). If the release you leave
   added migrations, the old code may not work on the new schema: roll forward with a fix, or (owner's decision)
   restore the dump from step 2, which loses everything written since. Never `alembic downgrade` live data without
   a fresh backup. Release folders are never deleted by these scripts.

The launcher (`run_ckam_web.ps1.template`) starts `python -m uvicorn app.main:app --host 0.0.0.0 --port 3211 --no-proxy-headers --no-server-header`
(N2: never `--proxy-headers`; `TRUSTED_PROXIES` stays empty in production; `--no-server-header` added for
CL2-IF-OBS-05, *updated 2026-10-17, security release*). Settings keys added since 2026-10-14:
`LOG_DIR` (`<AppRoot>\logs\app`), `ENVIRONMENT_NAME=production`, `APP_VERSION=<sha>`.

---

This is the operational companion to `docs/deployment.md` (which remains the
full reference for first-time setup, backups, and restore — read it in
full before a real deployment). This runbook is the condensed,
step-ordered checklist an operator follows on release day, plus the
evidence trail this stage (AM-09) recorded to back every step. All
commands below are copied verbatim from the actual repository
(`docker-compose.yml`, `ops/*.sh`, `docs/deployment.md`) — nothing here is
invented.

## 1. Prerequisites

- Docker + Docker Compose v2 on the target server.
- Port 3211 (or your chosen `WEB_PORT`) open on the LAN — the only port
  other devices need. `db`/`api` are bound to `127.0.0.1` only by design
  (see `docs/deployment.md`, "Ports") — do not change this without a
  specific, understood reason.
- A destination for `BACKUP_DIR` on a **different disk** than the one
  holding Docker's volumes, itself copied off the server (NAS/external
  drive/file-server backup).

## 2. Required environment variables

Copy `.env.example` to `.env` and set:

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | Real, random value — never the `change_me` placeholder. |
| `JWT_SECRET` | Yes | `openssl rand -hex 32` (or equivalent). **Verify** `docker compose logs api` shows **no** `SECURITY WARNING` after startup — that warning means this is still a placeholder or under 32 characters and every token (including ADMIN) is forgeable by anyone who has read the source. |
| `BASE_URL` | Yes | The web app's address **as a phone on the LAN reaches it** (e.g. `http://assets.citykart.local:3211`), never `localhost` or the API's port 8000 — printed QR labels encode this and a wrong value produces labels that scan to nowhere. |
| `BACKUP_DIR` | Yes | Absolute path per §1 above. The default `./backups` (inside the repo checkout) is dev-only. |
| `COOKIE_SECURE` | Yes | `false` for plain HTTP (this deployment's documented model). Only `true` once the site is served over HTTPS — setting it `true` without HTTPS silently breaks session refresh (everyone logged out every 15 minutes, since a `Secure` cookie is never sent over plain HTTP). |
| `WEB_PORT`/`DB_PORT`/`API_PORT` | No | Only if the defaults collide with something already running on the host. |

## 3. Secrets that must be set

Only two secret-bearing values exist in this application: `POSTGRES_PASSWORD`
and `JWT_SECRET`, both above. AM-09's secret audit confirmed:

- `.env` is gitignored (`git ls-files | grep .env` returns only the
  placeholder-only `.env.example`) — no real secret is committed anywhere
  in the repository.
- `.env.example`'s placeholders (`change_me`, `change_me_too`) are exactly
  the values `app/core/config.py`'s `_KNOWN_INSECURE_JWT_SECRETS` set
  checks for, so leaving either in place triggers the loud startup
  `SECURITY WARNING` — check `docker compose logs api` after every deploy.
- Password hashing is Argon2id (`argon2-cffi`'s `PasswordHasher`) — no
  plaintext password is ever stored. `create_owner`'s and
  `reset-password`'s one-time temporary passwords print to stdout/the
  response body exactly once and must be relayed out-of-band; they are
  never logged to a persistent file by the application itself.

## 4. Database prerequisite

PostgreSQL 17 (matching `docker-compose.yml`'s `postgres:17` image for `db`
and `postgres:17-alpine` for `backup`, which ships version-matched
`pg_dump`/`psql` client tools). No separately-installed Postgres is
needed — `docker compose up -d` provisions it.

## 5. Backup before deployment

**Always take a fresh backup immediately before any deploy or migration**,
even a routine one:

```bash
docker compose exec backup sh /scripts/backup.sh
```

Two files land in `${BACKUP_DIR}`: `ckam_db_<timestamp>.sql.gz` (full
`pg_dump`) and `ckam_uploads_<timestamp>.tar.gz` (the uploads volume).
AM-09 ran this exact command live and confirmed both files are produced,
non-empty, and correctly timestamped (see §36 of
`AM-09_RC_FULL_AUDIT_REPORT.md`).

## 6. Migration procedure

Migrations **never** run automatically on container start — always run
this explicitly, and only after step 5's backup:

```bash
git pull
docker compose up -d --build
docker compose exec api alembic upgrade head
```

The third command is a no-op when there is nothing new — safe to run every
time. AM-09 verified the full migration chain applies cleanly to a
genuinely empty database (§30 of the audit report) and that the chain has
a single, linear head with no branch divergence (`alembic heads` returns
exactly one revision).

**Exception — restoring an existing dump onto a new server** (moving from
dev to production, or a disaster-recovery restore): do **not** run
`alembic upgrade head` *before* the restore — see §12 below and
`docs/deployment.md`'s "Moving from the dev machine to the production
server" for the full, exact procedure.

## 7. Application startup

```bash
docker compose up -d --build
```

Verify all four services report a healthy/running state:

```bash
docker compose ps
```

`db` should show `(healthy)` (its healthcheck is `pg_isready`); `api`,
`web`, and `backup` should show `Up`. AM-09 confirmed this exact command's
output shows all four services running cleanly on the current stack.

## 8. Health verification

```bash
curl http://localhost:8000/api/health   # -> {"status":"ok"}
```

Also check the startup log for the JWT secret warning (must be **absent**):

```bash
docker compose logs api | grep "SECURITY WARNING"   # must return nothing
```

AM-09 confirmed both checks pass on the current stack (`grep` returns zero
matches; `/api/health` returns `200 {"status":"ok"}`).

## 9. Smoke-test checklist (~10 minutes)

Run through this after every deploy, using a real account (not a
throwaway test one, unless this is a fresh install with no other data
yet):

- [ ] `GET /api/health` → `200 {"status":"ok"}`
- [ ] `docker compose exec api alembic current` → shows `(head)`
- [ ] Log in at `http://<server>:3211/` with a real account
- [ ] Dashboard loads with real numbers (not stuck on a loading skeleton,
      not blank)
- [ ] Asset Register (`/assets`) loads and a search/filter returns results
- [ ] Open one existing asset's Asset 360 page — Overview/Procurement/
      History/Changes tabs all render
- [ ] Holders & Users list (`/setup/holders`) loads
- [ ] Download one report (Asset Register export) from `/reports` and
      confirm the file opens correctly
- [ ] `docker compose exec backup sh /scripts/backup.sh` runs and reports
      "Backup complete" (confirms the backup mechanism itself, not just
      the API, is healthy)
- [ ] `docker compose logs api | grep "SECURITY WARNING"` → no output

## 10. Rollback conditions

Roll back if, after a deploy:

- Any smoke-test item above fails and cannot be fixed forward within a few
  minutes (e.g. a migration that fails partway, a container that won't
  start).
- `docker compose logs api` shows repeated tracebacks/`IntegrityError`s on
  ordinary requests (not the expected append-only-trigger rejections a
  test suite intentionally produces).
- The `SECURITY WARNING` for `JWT_SECRET` appears (this is a "fix the
  `.env` and restart" issue, not necessarily a full rollback, but treat it
  as release-blocking until resolved).

## 11. Rollback application procedure

If the deployed code itself is the problem (not the database — a code-only
rollback never needs a database restore):

```bash
git checkout <previous-known-good-commit-or-tag>
docker compose up -d --build
# Only if the previous commit's migrations differ, otherwise skip:
docker compose exec api alembic upgrade head
```

If the previous version needs an OLDER migration state than what's
currently applied, do not attempt an `alembic downgrade` against live
data without first taking a fresh backup (step 5) — prefer restoring the
step-5 backup instead (§12) over downgrading in place, since this app's
migrations are not routinely tested for downgrade safety against
production data.

## 12. Database restore procedure

**This is destructive** — restoring permanently overwrites the target
database. Full detail and every command: `docs/deployment.md`, "Restore".
Condensed:

1. Stop the API first: `docker compose stop api`. Ensure `backup` is up:
   `docker compose up -d db backup`.
2. Ensure the target database has **no schema** — either a brand-new `db`
   volume, or explicitly: `docker compose exec db psql -U ckam -d ckam -c
   "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA
   public TO ckam;"`.
3. Restore: `docker compose exec backup sh /scripts/restore.sh
   /backups/<db_file> /backups/<uploads_file>`.
4. `docker compose up -d api`, then spot-check:
   `docker compose exec db psql -U ckam -d ckam -c "SELECT count(*) FROM
   asset;"`.
5. `docker compose exec api alembic upgrade head` (brings the restored
   schema up to the current code; a no-op if the dump was already at
   head).

AM-09 exercised this exact restore procedure live (into a disposable,
uniquely-named database, never over the live `ckam`, per this stage's own
explicit safety instruction) and confirmed: the restored row counts
matched the pre-backup source exactly (`company`, `holder`, `asset`,
`asset_event`, `asset_field_change`), the Alembic revision matched
(`f28b6a913dce`), and all five append-only/identity-protection triggers
and every AM-01 index were present and correct after restore. See §36-38
of `AM-09_RC_FULL_AUDIT_REPORT.md` for the full evidence.

## 13. Post-release verification

After any deploy (routine or a restore-based one):

- Re-run the full smoke-test checklist (§9).
- If this was a restore-based move to a new server: re-run the
  test-account check from `docs/deployment.md`'s "Moving from the dev
  machine to the production server" step 1, and confirm it returns
  nothing active — a leftover `SEEDADMIN`/`E2E-*` test account on a
  production server is an ADMIN login whose password may be known to
  anyone who has read this repository.
- Confirm the real admin's own password is not a default/temporary one.

## 14. Logs to inspect

| Log | Command | What to look for |
|---|---|---|
| API | `docker compose logs -f api` | The `SECURITY WARNING` banner (must be absent); repeated `IntegrityError`/traceback on ordinary requests (not the expected append-only-trigger rejections a test run produces); startup errors. |
| Web (nginx) | `docker compose logs web` | `[emerg]`/`[crit]` lines; unexpected 502/504 (upstream `api` unreachable). |
| Database | `docker compose logs db` | `FATAL`/`PANIC`; the `ERROR: asset_code is immutable once set` / `ERROR: asset_event rows are append-only` lines are **expected** when the append-only triggers correctly reject a write — not an operational problem by themselves. |
| Backup | `docker compose exec backup cat /var/log/ckam-backup.log` | Every night's run should show `Backup complete: <timestamp>`; a missing night or a non-zero-exit line means the nightly cron failed — see §15 below. |

## 15. Who/what to verify operationally

- **Nightly backup**: no automated alert exists yet if a night's backup
  fails (see `RC_ISSUES.md` AM09-09) — an operator should periodically
  check `docker compose exec backup cat /var/log/ckam-backup.log` (e.g.
  weekly) and confirm a `Backup complete` line exists for every expected
  night, and that `${BACKUP_DIR}` actually contains files with recent
  timestamps and non-zero size.
- **Restore capability**: re-run the disposable-database restore drill
  (§12's steps, but into a uniquely-named throwaway database, never over
  `ckam`) after any change to `docker-compose.yml`, the backup/restore
  scripts, or the Postgres version — `docs/deployment.md` also documents
  `ops/test_backup_restore.sh`, a scripted version of this drill, **only
  safe to run against a disposable dev/staging stack** (it drops the
  running `db` service's schema in place).
- **Who restores**: whoever has `docker compose exec` access to the
  server and has read this runbook's §12 in full — restoring is
  destructive and should not be attempted without deliberately confirming
  the target environment first (`docker compose ps` / `hostname`).

## Disaster recovery notes

Stated only from what this stage's actual evidence supports — no SLA is
fabricated:

- **Backup frequency (RPO)**: nightly, `0 2 * * *` (`docker-compose.yml`'s
  `backup` service crontab). Evidence: both a manual on-demand run and the
  automated nightly job were confirmed to have actually run and logged
  success (`ckam_db_20260924_020000.sql.gz` present with a matching
  `Backup complete: 20260924_020000` log line). **Worst-case data loss on
  a full server failure is therefore up to ~24 hours** (everything since
  the last successful nightly run), unless a manual backup was taken more
  recently.
- **Retention**: 14 days (`ops/backup.sh`'s `find "$OUT_DIR" -name
  'ckam_*' -mtime +14 -delete`).
- **Restore duration (RTO)**: AM-09's live restore of the then-current
  database (~150 assets, ~250 holders, ~80 companies, ~125 events) into a
  disposable database completed in well under a minute end-to-end (backup
  file decompression + `psql` replay). A larger production database would
  scale roughly with `pg_dump`/`psql` throughput for its actual size —
  measure this on your own data volume during the periodic restore drill
  above, rather than assuming AM-09's small-dataset timing holds at scale.
- **Backup location**: `${BACKUP_DIR}` — must be configured (per §1/§2
  above) to a disk other than the one holding Docker's volumes, and itself
  copied off the server. The default `./backups` (inside the repo
  checkout) satisfies neither of these and is dev-only.
- **Restore steps**: §12 above, full detail in `docs/deployment.md`,
  "Restore".
