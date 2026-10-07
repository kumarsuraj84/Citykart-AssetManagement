# CKAM Initial Production Deployment Report

> **SUPERSEDED 2026-10-07.** This describes the first install on 10.0.1.12, which is now retired and must stay stopped. Production is 10.0.1.98 + 10.0.0.205 + NAS; see `PRODUCTION_INFRASTRUCTURE.md`. Kept as history only.

Date: 2026-09-30
Deployed by: Claude (Claude Code), authorized by Suraj (suraj@citykart.org)

## 1. Production server

- Host: `10.0.1.12`, hostname `CK-SNOOKER-SRV`
- OS: Microsoft Windows Server 2022 Standard, Build 20348
- Access: SSH as `ck-snooker-srv\administrator`, key `~/.ssh/ckam_prod_deploy`

## 2. Target path

`E:\CK Projects\Citykart_Asset_Management`

## 3. Starting DEV state

- Starting/base approved commit: `6a8f9b5979d78a1e467fd9f5112c182608a04791` (branch `worktree-ckam-build`)
- A hosting-architecture gap was discovered during deployment (no nginx/reverse proxy available in production for the two-port split); fixed on DEV, tested, committed as `952c17c`, pushed, and redeployed in place of `6a8f9b5` with explicit user approval at each step. `952c17c` is the actual deployed release.

## 4. Local test results (DEV, before deploy)

- Backend: 473/473 pytest passing (`docker compose exec api pytest -q` against `ckam_test`), including 9 new tests for the single-port static-frontend hosting change
- Frontend: `tsc -b && vite build` clean, no TypeScript errors
- Alembic: single head confirmed (`d3f8a1c5b7e9`)
- Working tree: clean at time of deploy

## 5. Expected Alembic head

`d3f8a1c5b7e9`

## 6. E: disk verification

- Read-only checks only (`Get-Volume`, no cleanup/deletion performed)
- E: total 99.18 GB, free 10.48 GB at time of deployment (a previously-flagged and user-acknowledged figure; sufficient for this small application's footprint — final release + venv + logs + backup measured well under 100 MB)

## 7. Target folder verification

`E:\CK Projects\Citykart_Asset_Management` existed, empty except for the CKAM directory skeleton created earlier in this engagement (`releases/`, `shared/`, `logs/`, `backup/`). No unknown/foreign content found.

## 8. PostgreSQL version

PostgreSQL 18.6, Windows service `postgresql-x64-18`, already running before this deployment.

## 9. CKAM database/role used

- Role: `ckam_app` (`LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`)
- Database: `ckam_prod`, owner `ckam_app`
- Both created fresh during this deployment; neither existed beforehand.

## 10. Confirmation no other database was queried

Confirmed. All PostgreSQL admin-credential usage was limited to: (a) an exact-name existence check for `ckam_app`/`ckam_prod` only (`SELECT 1 FROM pg_roles WHERE rolname = 'ckam_app'` / `pg_database WHERE datname = 'ckam_prod'`), (b) `CREATE ROLE ckam_app ...`, (c) `CREATE DATABASE ckam_prod OWNER ckam_app`. No `\l`, no `pg_database` enumeration, no connection to any other database. Admin credentials were used only for this bootstrap and never again afterward.

## 11. Selected ports

- Public: `3211` (0.0.0.0, LAN-reachable)
- No separate backend-internal port used — see architecture note below.

## 12. Runtime architecture

Single-port hosting: the FastAPI application itself serves both the REST API (`/api/...`) and the built frontend (static assets + SPA fallback) on port 3211. There is no separate nginx/IIS reverse proxy in production. This replicates `frontend/nginx.conf`'s behavior in Python (security headers, `Cache-Control: no-store` on API responses, `no-cache` on the SPA shell, SPA fallback routing) rather than sourcing a new reverse-proxy binary. Implemented in `backend/app/main.py` and `backend/app/core/config.py` (new `frontend_dist_dir` setting, unset/inert in dev and Docker).

## 13. Production directory layout

```
E:\CK Projects\Citykart_Asset_Management\
  releases\
    6a8f9b5\           (superseded — kept for history, not running)
    952c17c\           (deployed release)
      backend\         (app/, alembic.ini, pyproject.toml, scripts/create_owner.py)
      frontend-dist\   (built SPA)
      RELEASE_MANIFEST.txt
  shared\
    venv\              (Python 3.13 virtualenv, editable install of ckam-backend)
    .env               (production config; ACL restricted to Administrators/SYSTEM)
    uploads\
    run_ckam_web.ps1   (process launcher used by the CKAM-Web scheduled task)
  logs\
    ckam-web_<timestamp>.log
  backup\
    ckam_prod_20260930_180202_before_952c17c.dump
```

## 14. Secret handling

- JWT secret: generated on the production host itself via the venv's Python (`secrets.token_urlsafe(48)`), written directly into `shared\.env`, never transmitted off-host, never printed in chat or logs.
- Database password for `ckam_app`: generated on the production host itself, used to build `DATABASE_URL` directly in `shared\.env`, never printed.
- `shared\.env` ACL restricted to `BUILTIN\Administrators` and `NT AUTHORITY\SYSTEM` only (inheritance broken).
- Two application bootstrap passwords (the schema-mandated "Primary Owner" account created by migration `d3f8a1c5b7e9`, and the named admin Ankur Pahwa created by `scripts/create_owner.py`) were necessarily printed once to script output as designed (both are `must_change_password=True`, one-time use). The Primary Owner's password appeared in this session's tool output and should be treated as exposed — log in and change it promptly. Ankur Pahwa's password was relayed directly to the operator in chat once and is not repeated in this report.

## 15. Python/runtime config

- Isolated venv at `shared\venv`, Python 3.13.15
- `pip install -e <release>\backend` — production dependencies only (no pytest/httpx/dev extras)
- Editable install re-pointed to `releases\952c17c\backend` after the hosting-architecture fix

## 16. Frontend/backend hosting

Single FastAPI/uvicorn process, see §12. No Vite dev server ever run in production.

## 17. Windows service/task names

- `CKAM-Web` — Scheduled Task, trigger `AtStartup`, principal `SYSTEM`, restart on failure (999 retries, 1-minute interval), no execution time limit. Runs `shared\run_ckam_web.ps1`, which loads `shared\.env` into the process environment and launches `uvicorn app.main:app --host 0.0.0.0 --port 3211`.

## 18. ACL applied

- `E:\CK Projects\Citykart_Asset_Management`: inheritance broken, `BUILTIN\Users` write access removed, `SYSTEM`/`Administrators` FullControl retained. Verified parent `E:\CK Projects` and its `BUILTIN\Users` grant are untouched.
- `shared\.env`: restricted to `Administrators`/`SYSTEM` only.

## 19. Migration result

`alembic upgrade head` succeeded, applying all 21 revisions from empty schema to `d3f8a1c5b7e9`. `alembic current` confirmed `d3f8a1c5b7e9 (head)`.

## 20. Health checks

- `GET /api/health` → 200, `{"status":"ok"}`
- Security headers present on every response (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`); `Cache-Control: no-store` on API responses
- Port 3211 confirmed listening on `0.0.0.0`
- No migration mismatch, no startup errors in the process log

## 21. Smoke checks

- `GET /` , `/login`, `/dashboard` → 200, correctly serve the SPA shell (fallback routing works)
- Hashed JS/CSS assets under `/assets/` → 200, correct content-type
- A nonexistent `/assets/` path → 404 (does not fall back to the shell, by design)
- `/favicon.svg` (root-level static file) → 200
- `POST /api/auth/login` with a wrong password for a real account (`CS6872`) → 401, confirming the database connection and the created admin row both work end-to-end
- Full authenticated page-by-page verification (Dashboard/Asset Register/Asset Users/Purchase Orders/Reports actually rendering data) was deliberately **not** performed by this session, to avoid consuming Ankur Pahwa's real first login / forced password change. Recommend Ankur performs this himself on first login.

## 22. Live release SHA

`952c17c`

## 23. Logs path

`E:\CK Projects\Citykart_Asset_Management\logs\`

## 24. Rollback procedure (first deployment)

No previous release exists. Rollback means: stop the `CKAM-Web` scheduled task, leave `ckam_prod` intact (never dropped). Should a future release fail, `releases\6a8f9b5\` remains on disk as the prior known-good backend/frontend pair, and the scheduled task's launcher script can be repointed to it.

## 25. Backup procedure

First CKAM-only backup taken via `pg_dump -F c` immediately after schema/bootstrap: `backup\ckam_prod_20260930_180202_before_952c17c.dump` (89,171 bytes). No other database touched. Daily-backup automation was **not** created this session (not pre-authorized); recommend a CKAM-scoped scheduled task running the same `pg_dump` command with a retention policy, to be proposed and approved separately.

## 26. Future deployment procedure

DEV develop → full local test suite → commit locally → present commit/tests/migration impact to user → explicit **git push approval** → push → explicit **production deploy approval** → on production: backup `ckam_prod` → deploy release → `alembic upgrade head` → restart only `CKAM-Web` → health/smoke checks → report live SHA. No CI/CD auto-deploy exists or will be created.

## 27. Production → DEV data-copy procedure

Documented, not yet exercised: `pg_dump` a read-only copy of `ckam_prod` only, transfer securely, optionally back up the existing DEV database first, then restore into the existing DEV CKAM database. Direction is strictly LIVE → DEV; DEV is never restored over `ckam_prod`.

## 28. Git push status

- `952c17c` pushed to `origin/worktree-ckam-build` (explicit user approval given). Not merged to `main`.

## 29. Production safety confirmations

| Item | Status |
|---|---|
| Other application files modified | NO |
| Other application services restarted | NO |
| Other PostgreSQL databases connected/queried | NO |
| Other PostgreSQL databases modified | NO |
| Other PostgreSQL roles modified | NO |
| PostgreSQL global config changed | NO |
| PostgreSQL restarted | NO |
| Existing IIS site modified | NO |
| Global IIS config modified | NO |
| Unrelated firewall rule modified | NO |
| Unrelated scheduled task modified | NO |
| Unrelated Windows service modified | NO |
| Production data reset | NO (fresh database, nothing to reset) |

## 30. Open items

- Daily backup automation for `ckam_prod` — proposed above, not yet created (needs separate approval).
- Full authenticated-page smoke test — recommended to be done by Ankur Pahwa on his own first login.
- The Primary Owner "Admin" account's one-time password appeared in this session's tool output (an unavoidable side effect of the approved `d3f8a1c5b7e9` migration's own design) — recommend logging in and changing it promptly.
- `releases\6a8f9b5\` remains on disk, superseded but not deleted (kept for rollback reference).

## 31. Final verdict

**CKAM PRODUCTION DEPLOYMENT SUCCESSFUL WITH NON-BLOCKING OBSERVATIONS**

(Observations: the two items above — backup automation not yet created, and the Primary Owner password exposure — are non-blocking but should be addressed promptly.)
