# CKAM on Windows production: reference scripts

Status: **CODE/REFERENCE SIDE FIXED — LIVE LAUNCHER STILL REQUIRES EXT-13** (security finding IF-15, with N2 and
IF-11). These files are reviewed, secret-free reference versions of what runs CKAM on the production app server.
They are **not** what the server runs today: the live `shared\run_ckam_web.ps1` and the Task Scheduler entry
`CKAM-Web` were written on the server and have never been copied into git. EXT-13 (an IT step) is to compare the
live launcher with `run_ckam_web.ps1.template`, copy the reviewed version into place, and record that the two are
equal. That has **not** been done in this stage, and nothing here has been run on a server.

Production layout these scripts assume (`docs/ai/PRODUCTION_INFRASTRUCTURE.md`):

```
D:\Citykart_Applications\Citykart_AssetManagement_App\      <- AppRoot
  releases\<sha>\backend\        app\, alembic.ini, pyproject.toml, constraints.txt, scripts\create_owner.py, VERSION
  releases\<sha>\frontend-dist\  the built frontend (npm run build)
  shared\.env                    all settings (Administrators / SYSTEM only)
  shared\nas.pw                  NAS password (Administrators / SYSTEM only)
  shared\venv\                   Python 3.13 virtual environment
  shared\run_ckam_web.ps1        the launcher the task starts
  logs\                          launcher, stdout/stderr, deploy logs; logs\app\ = the app's own JSON logs (LOG_DIR)
```

`FRONTEND_DIST_DIR` in `shared\.env` is the **single release switch**: the launcher runs the backend from the
`backend` folder next to the selected `frontend-dist`.

## Files

| File | What it is | Changes anything? |
|---|---|---|
| `run_ckam_web.ps1.template` | The launcher the `CKAM-Web` task starts: loads `shared\.env` into its own process, maps the NAS, picks the release from `FRONTEND_DIST_DIR`, starts `python -m uvicorn app.main:app --host 0.0.0.0 --port 3211 --no-proxy-headers --no-server-header` from the venv, logs to `logs\` | Starts the app (supports `-WhatIf`) |
| `deploy_ckam.ps1.template` | A release: unpack `releases\<sha>`, pre-checks, backup step, stop, `pip install -c constraints.txt`, switch `FRONTEND_DIST_DIR`, `alembic upgrade head` **before** start, start, smoke test, automatic switch-back on failure | Yes (supports `-WhatIf`) |
| `verify_release.ps1` | Smoke / security check of a running release: health, release id, security headers exactly once, CSP, API docs closed, unknown `/api` is a JSON 404, the QR-label address `/assets/<id>` and `/assets/new` open the app shell (CL2-IF-04), no `server: uvicorn` header (WARN), path-traversal probes all 404 | **No** (GET requests only, no sign-in) |
| `rollback_release.ps1.template` | Switch back to a previous release folder; never deletes anything, never touches the database | Yes (supports `-WhatIf`) |

To use a template: review it, copy it without the `.template` suffix (the launcher goes to `shared\`), and run
it in an elevated **Windows PowerShell 5.1** (`powershell.exe`, the version on the server).

## Parameters

### run_ckam_web.ps1(.template)

| Parameter | Default | Meaning |
|---|---|---|
| `-AppRoot` | `D:\Citykart_Applications\Citykart_AssetManagement_App` | CKAM's own folder |
| `-EnvFile` | `<AppRoot>\shared\.env` | settings file loaded into the launcher's process (key names are logged, values never) |
| `-VenvDir` | `<AppRoot>\shared\venv` | virtual environment (VIRTUAL_ENV and PATH are set for the process, i.e. "activated") |
| `-LogDir` | `<AppRoot>\logs` | launcher log `ckam-web_<time>.launcher.log` and uvicorn's `.out.log` / `.err.log` |
| `-BindHost`, `-Port` | `0.0.0.0`, `3211` | listen address (firewall rule `CKAM-Web` opens 3211) |
| `-NasShare`, `-NasUser`, `-NasPasswordFile` | `\\10.0.0.25\ckapplications_data`, `ckappuser`, `<AppRoot>\shared\nas.pw` | NAS mapping for uploads; the password is read from the file at run time and never logged |
| `-NasCheckFolder`, `-NasAttempts`, `-NasRetrySeconds` | `CKASSETMANAGEMENT_DATA`, `12`, `15` | retry the mapping at boot until that folder is visible |
| `-SkipNas` | off | for a server whose `UPLOAD_DIR` is local |

The uvicorn argument line is fixed on purpose: `--no-proxy-headers` (security N2) must never become
`--proxy-headers`, and `TRUSTED_PROXIES` must stay empty in production (CKAM is reached directly, no proxy; the
launcher logs a warning if it is set). `--no-server-header` (CL2-IF-OBS-05) stops uvicorn from announcing itself
in a `server: uvicorn` header; the live launcher on the server (EXT-13 comparison) needs the same flag.

### deploy_ckam.ps1(.template)

| Parameter | Default | Meaning |
|---|---|---|
| `-Sha` | (required) | short git sha = folder name `releases\<sha>` |
| `-PackagePath` | — | zip with `backend\` and `frontend-dist\` at the top (not needed if `releases\<sha>` exists) |
| `-AppRoot`, `-TaskName`, `-Port` | as above, `CKAM-Web`, `3211` | |
| `-BackupHook` | — | your script that takes the pre-deploy database backup and exits 0 on success |
| `-BackupConfirmed` | off | instead of `-BackupHook`: you ran task `CK_Backup_CKASSETMANAGEMENT` on 10.0.0.205 and `backup.log` says OK |
| `-SkipPipInstall` | off | skip `pip install` (only if the venv already has exactly this release's packages) |
| `-HealthTimeoutSeconds` | `120` | wait for `/api/health` after the start |
| `-WhatIf` / `-Confirm` | | show every step without doing it / ask before each step |

Pre-checks (stop before anything is touched; no value is ever printed): `ENVIRONMENT_NAME` is `production`;
`JWT_SECRET` has ≥ 32 characters, ≥ 8 different characters and is not a placeholder (the same rules the app
enforces at start, IF-04 / N4); `DATABASE_URL` and `FRONTEND_DIST_DIR` exist; a warning if `shared\.env` is readable
by Users / Everyone / Authenticated Users or if `TRUSTED_PROXIES` is set.

Packaging on the dev PC (unchanged from the 2026-10-14 deploy, plus `constraints.txt` for IF-11):
build the frontend with `VITE_APP_VERSION=<sha> npm run build`, run `npm run check:build`, then zip
`backend\{app (without __pycache__), alembic.ini, pyproject.toml, constraints.txt, scripts\create_owner.py, VERSION}`
and `frontend\dist` (as `frontend-dist`). `pip install -c constraints.txt` installs exactly the tested versions;
if a version is not already in the venv, the server needs to reach the Python package index (or a wheel folder).

### verify_release.ps1

| Parameter | Default | Meaning |
|---|---|---|
| `-BaseUrl` | `http://127.0.0.1:3211` | address to check |
| `-ExpectedRelease` | — | the served bundle must contain this sha (the build embeds it) |
| `-ReleaseDir` | — | on the server: the served bundle must exist in `<ReleaseDir>\frontend-dist` |
| `-LauncherLogDir` | — | on the server: the newest launcher log must say `serving release: ...<sha>` |
| `-IncludeUncProbe` | off | also send `/assets/%5c%5cserver%5cshare%5cx`; only for a release WITH the IF-01-WIN fix (an older one could make the server look up that host over SMB) |
| `-TimeoutSeconds`, `-OutCsv` | `20`, — | per-request timeout; optional CSV of the result rows |

Exit code 0 = no FAIL, 1 = a FAIL, 2 = not reachable. Probe bodies are never printed or saved.
Notes on the results: in single-port production `/docs`, `/redoc` and `/openapi.json` answer the plain app shell
(200) because documentation is switched off and the app falls back to the shell; the script counts that as closed
(it fails only if Swagger / ReDoc / the OpenAPI JSON is served). Behind the Docker dev nginx, extension-less
`/assets/...` probes get the app shell (200, no file) and are reported as WARN; production must answer 404.

### rollback_release.ps1(.template)

| Parameter | Default | Meaning |
|---|---|---|
| `-ToSha` | (required) | release folder to go back to |
| `-AppRoot`, `-TaskName`, `-Port` | as above | |
| `-ReinstallBackend` | off | also `pip install -e` the previous release's backend |
| `-HealthTimeoutSeconds` | `120` | |
| `-WhatIf` / `-Confirm` | | |

The database is never rolled back by a script. If the release you leave added migrations, either roll forward
with a fix or (owner's decision) restore the dump taken just before the deploy, which loses everything written
since. See `docs/ai/CKAM_RELEASE_RUNBOOK.md` (Windows production section).

## Prerequisites

* Windows PowerShell 5.1, run elevated (stopping/starting the task, reading `shared\`).
* Python 3.13 venv at `shared\venv` (Python is at `C:\Program Files\Python313`, not on PATH).
* Scheduled task `CKAM-Web` (at startup, restart on failure) that runs
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <AppRoot>\shared\run_ckam_web.ps1`.
  Today it runs as SYSTEM (IF-07). For EXT-06, a dedicated service account needs: "Log on as a batch job";
  read on `releases\` and `shared\` (incl. `.env`, `nas.pw`); modify on `logs\`; the NAS account in `nas.pw`
  keeps write access to the uploads folder; nothing else on the shared server.
* The database backup task `CK_Backup_CKASSETMANAGEMENT` on 10.0.0.205 (run it before every deploy).

## Deliberately NOT in these files (and never to be added)

* Any password or key: the database URL with its password, `JWT_SECRET`, the NAS password, the ERP
  (`PO_SOURCE_PASSWORD`) password, superuser passwords. They live only in `shared\.env` / `shared\nas.pw` on the
  server, and the owner types the superuser and NAS passwords on the server himself.
* Server names other than the documented NAS default, and anything for 10.0.1.12 (retired, must stay off).
* The live launcher and the task definition: EXT-13 copies the reviewed template to the server; it does not copy
  the server file into git unreviewed.

## How these were checked (2026-10-16, on the dev PC only)

PowerShell parser check of all four files (0 errors); `-WhatIf` runs of deploy, rollback and launcher against a
fake folder layout in a temp folder (no real task, venv, NAS or database touched), including the refusal cases
(no backup, `ENVIRONMENT_NAME` not production, weak `JWT_SECRET`, incomplete release); `verify_release.ps1` run
read-only against the local Docker dev stack (`http://localhost:3211`). PSScriptAnalyzer is not installed on the
dev PC and was not run. Evidence: `docs/security/evidence/closure/infra/WP-C_closure_evidence.md` section 5.
