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
| `deploy_ckam.ps1.template` | A release: unpack `releases\<sha>`, pre-checks, backup step, stop, `pip install -c constraints.txt`, switch `FRONTEND_DIST_DIR`, `alembic upgrade head` **before** start, start, smoke test. On a failure **before** the migration it switches back; **from the migration on it leaves CKAM-Web stopped** and the owner decides (roll forward first, see below) | Yes (supports `-WhatIf`) |
| `verify_release.ps1` | Smoke / security check of a running release: health, release id, security headers exactly once, CSP, API docs closed, unknown `/api` is a JSON 404, the QR-label address `/assets/<id>` and `/assets/new` open the app shell (CL2-IF-04), no `server: uvicorn` header (WARN), path-traversal probes all 404, session renewal without a cookie and a made-up sign-in are JSON 401, and (on the server itself) the running uvicorn has `--no-proxy-headers` and `--no-server-header` | **No** (GET requests plus two harmless POSTs; never real credentials) |
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
| `-WhatIf` / `-Confirm` | | show every step without doing it / ask before each step. `-WhatIf` also prints, for every step, which failure branch would run, and a closing "failure handling plan" |

Pre-checks (stop before anything is touched; no value is ever printed):
* `ENVIRONMENT_NAME` is `production`.
* `JWT_SECRET` has ≥ 32 characters, ≥ 8 different characters and is not a placeholder (the same rules the app
  enforces at start, IF-04 / N4).
* **`DATABASE_URL`**: exactly one line in `shared\.env`, not empty, not wrapped in quotes, a `postgresql://` address,
  not the development default and not this machine (`localhost`, `127.0.0.1`, `::1`). Only the database host is
  logged, never the address with its password. Why it is a STOP: `app/core/config.py` and `app/alembic/env.py`
  **silently fall back to the development address** `localhost:5432/ckam` when the variable is missing, and the app
  does not refuse that in production. The check runs again on the rewritten file after the release switch, and once
  more in the migration process before `alembic` runs.
* `FRONTEND_DIST_DIR` exists; a warning if the current release folder it names is incomplete (an early switch-back
  could not start it), if `shared\.env` is readable by Users / Everyone / Authenticated Users, or if
  `TRUSTED_PROXIES` is set.
* When the package has a `RELEASE.json` (the security release has one): its `release_sha_short` must be `-Sha`, and
  its `alembic_head` is the revision the database must reach. Before the migration the code's single head
  (`alembic heads`) must equal it; after the migration `alembic current` must equal it, otherwise the deploy fails
  (branch B). Without `RELEASE.json` the code's own head is used.

**Failure handling — roll forward first** (`docs/security/CKAM_PRODUCTION_ROLLBACK_STRATEGY.md`):

| Where it fails | What the script does | Exit |
|---|---|---|
| steps 1–3 (release folder, pre-checks, backup) | stops; nothing in CKAM was changed | 2 |
| **branch A**: steps 4–8a, i.e. **before** `alembic upgrade head` is started (save settings, stop, pip, settings switch and its re-check, read-only `alembic heads` / `alembic current`) | the schema is untouched: restores `shared\.env.pre-<sha>` and restarts the previous release (strategy case 1-A). **IF-01 stays open on the old release**: re-plan the deploy at once. Safety net: if `alembic current` already shows the new head (an earlier run or a hand migration), it does **not** restart the old release and behaves like branch B | 1 (3 in the safety-net case) |
| **branch B**: from the moment `alembic upgrade head` is started (the upgrade, the head check, the start, `/api/health`, `verify_release.ps1`) | **no** restart of the previous release, **no** `alembic downgrade`, **no** restore. CKAM-Web is stopped and left stopped (IF-01 cannot be used while nothing listens). A banner in the console and the deploy log shows the reason, `alembic current` (before / now / the release's head), that the previous release cannot record moves, repairs, losses, disposals, sales or scrapping on the new schema (receives still work, GT-F01) and re-opens the file-read hole IF-01, the three owner options (roll-forward fix — preferred; `alembic downgrade -1` from `releases\<sha>\backend`; restore the pre-deploy dump) and the pointer to the rollback strategy. The last log line is a machine-readable `STATE: branch=B; ckam_web=stopped; …` line. If the upgrade itself failed, the banner says the revision is unchanged (all pending migrations run in one transaction, GT-F04) and that this is strategy case 1 | 3 |

In branch B `shared\.env` still selects the new release, and the task keeps its at-startup trigger: after a server
restart it would start the new release (which is the roll-forward target). Disable the task only on the owner's
decision. A rerun after a fix never overwrites the first `shared\.env.pre-<sha>` (a rerun's copy gets a time suffix).

**Keep the release folders.** The script never deletes a release folder, and nobody should during the change:
`pip install -e` makes the venv load the backend package from `releases\<sha>\backend` (an editable install links to
the folder, it does not copy it), so deleting that folder breaks the installed app; and the previous release folder
is needed for any switch-back. An existing `releases\<sha>` is reused as it is, never replaced.

**Installing the backend.** The command (step 6, and runbook F2) is

```
<AppRoot>\shared\venv\Scripts\python.exe -m pip install -c <release>\backend\constraints.txt -e <release>\backend
```

`backend\pyproject.toml` has **no `[build-system]` table**, so pip builds the editable install with the newest
`setuptools`, which it **downloads from the package index** into an isolated build environment, and it downloads
every pinned package that is not already in the venv. So the server must **reach the Python package index**
(runbook precheck C11), **or** use a wheelhouse prepared on the dev PC (`pip download` of the pins plus
`setuptools` for `win_amd64` / CPython 3.13, then `pip install --no-index --find-links <wheelhouse> -c … -e …`;
this is a new procedure and has not been rehearsed). `constraints.txt` has 44 pins: the 43 runtime packages of
Linux plus the Windows-only `colorama==0.4.6` that `qrcode` needs on Windows (before 2026-10-17 it had no line, so
the server would take whatever colorama is newest at install time). On Windows 43 of them install: `colorama` yes,
`uvloop` no (`uvicorn[standard]` asks for it only off Windows).

Packaging on the dev PC (unchanged from the 2026-10-14 deploy, plus `constraints.txt` for IF-11 and `RELEASE.json`):
build the frontend with `VITE_APP_VERSION=<sha> npm run build`, run `npm run check:build`, then zip
`backend\{app (without __pycache__), alembic.ini, pyproject.toml, constraints.txt, scripts\create_owner.py, VERSION}`
and `frontend\dist` (as `frontend-dist`), with `RELEASE.json` (release id, `alembic_head`) at the top.

### verify_release.ps1

| Parameter | Default | Meaning |
|---|---|---|
| `-BaseUrl` | `http://127.0.0.1:3211` | address to check |
| `-ExpectedRelease` | — | the served bundle must contain this sha (the build embeds it) |
| `-ReleaseDir` | — | on the server: the served bundle must exist in `<ReleaseDir>\frontend-dist` |
| `-LauncherLogDir` | — | on the server: the newest launcher log must say `serving release: ...<sha>` |
| `-IncludeUncProbe` | off | also send `/assets/%5c%5cserver%5cshare%5cx`; only for a release WITH the IF-01-WIN fix (an older one could make the server look up that host over SMB) |
| `-LocalProcessCheck` | `Auto` | `Auto`: when the address is this machine and a uvicorn process listens on its port, check that process's command line (`Get-CimInstance Win32_Process`, or its parent's when the venv `python.exe` is a redirector) for **both** `--no-proxy-headers` and `--no-server-header`, no `--proxy-headers`, no `--workers`, and exactly one CKAM listener; otherwise SKIP. `Require`: FAIL instead of SKIP (use it on 10.0.1.98, elevated, so the task's process can be read; `deploy_ckam.ps1` passes it). `Skip`: never |
| `-TimeoutSeconds`, `-OutCsv` | `20`, — | per-request timeout; optional CSV of the result rows |

Exit code 0 = no FAIL, 1 = a FAIL, 2 = not reachable. Results are PASS / WARN / FAIL / SKIP. Probe bodies are never
printed or saved.

Sign-in checks (read-only in effect, never real credentials): `POST /api/auth/refresh` without a cookie must answer
`401` JSON "Invalid or expired refresh token" and set no session cookie; `POST /api/auth/login` with a made-up
login id `ckam-verify-release-<random>` and a random password must answer `401` JSON "Invalid credentials" and set
no cookie. Each run therefore leaves one "sign-in failed" security row with that login id, and uses one try of the
sign-in rate limit (a `429` is reported as WARN: run again a minute later).

Notes on the results: in single-port production `/docs`, `/redoc` and `/openapi.json` answer a **JSON 404**
(documentation is switched off and these paths are not app pages; confirmed by the release-gate rehearsal, GT-F06).
The script also accepts the plain app shell (200), which older releases and the Docker dev nginx answer, and fails only if Swagger /
ReDoc / the OpenAPI JSON is served. Behind the Docker dev nginx, extension-less `/assets/...` probes get the app
shell (200, no file) and are reported as WARN; production must answer 404. The local-process check is SKIP against
the Docker dev stack (its listener is Docker's, not uvicorn).

### rollback_release.ps1(.template)

| Parameter | Default | Meaning |
|---|---|---|
| `-ToSha` | (required) | release folder to go back to |
| `-AppRoot`, `-TaskName`, `-Port` | as above | |
| `-ReinstallBackend` | off | also `pip install -e` the previous release's backend |
| `-HealthTimeoutSeconds` | `120` | |
| `-WhatIf` / `-Confirm` | | |

The database is never rolled back by a script. If the release you leave added migrations, the older code may not
work on the newer schema (for the security release: after `c6e8a0b2d4f6` the old release cannot record movements
and it re-opens IF-01). Roll forward with a fix first; going back (`alembic downgrade -1` from the new release's
backend folder, or restoring the pre-deploy dump, which loses everything written since) is the owner's decision.
Do not run this script after a migration without that decision. See
`docs/security/CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` and `docs/ai/CKAM_RELEASE_RUNBOOK.md` (Windows production section).

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

## How these were checked (on the dev PC only; never on a server)

2026-10-16 (WP-C): PowerShell parser check of all four files (0 errors); `-WhatIf` runs of deploy, rollback and
launcher against a fake folder layout in a temp folder, including the refusal cases; `verify_release.ps1` run
read-only against the local Docker dev stack. Evidence: `docs/security/evidence/closure/infra/WP-C_closure_evidence.md`
section 5.

2026-10-17 (release-gate fix GT-F01/F04/F05/F06, roll-forward failure handling): parser check of all four files
(0 errors, Windows PowerShell 5.1); 28 dry-run cases / 188 checks, all PASS, against fake layouts: `-WhatIf` runs
(happy path, missing / empty / duplicate / development-default / localhost `DATABASE_URL`, weak and short
`JWT_SECRET`, wrong `ENVIRONMENT_NAME`, no backup) and **real runs inside a fake world** (a compiled fake
`python.exe` plays pip and alembic; the scheduled-task, port, process and HTTP cmdlets are replaced by fakes that
only write a log; a fake task name) that drive both failure branches: pip / head mismatch / database unreachable
before the migration (previous release restarted, settings restored), and upgrade failure, wrong head after the
upgrade, no health, verify failure after the migration (CKAM-Web left stopped, previous release never started,
banner + STATE line, exit 3), plus the "database already at the new head" safety net and the rerun that must not
overwrite an earlier `.env.pre-<sha>`; 0 secret leaks. `verify_release.ps1`: the local-process check against a fake
local listener (7 variants: PASS, three kinds of FAIL, SKIP, `Require` FAIL, `Skip`), and one run against the
throw-away security stack (`http://localhost:3411`: 0 FAIL; both sign-in checks PASS; the process check SKIP).
`constraints.txt`: resolved in a throw-away `python:3.13-slim` container (Linux, and the Windows closure with the
markers evaluated for win32). PSScriptAnalyzer is not installed and was not run. **Not verified:** a real Windows
venv, `pip install` on Windows, the real Task Scheduler, a real uvicorn command line on the server, a real
database. Evidence: `docs/security/evidence/closure/release/windows_scripts_fix/`.
