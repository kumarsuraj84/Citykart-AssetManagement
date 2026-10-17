# Windows reference scripts — release-gate fix (2026-10-17), evidence

Dev PC 10.0.0.47 only. No server, no real task, venv, NAS or database was touched; no git write; no compose project
was started or stopped. All values in the fake layouts are throw-away.

| File | What it shows |
|---|---|
| `parse_check.out.txt` | PowerShell 5.1 parser: 4 files, 0 errors; the launcher's uvicorn line has both flags; no hard-coded secret-like assignment |
| `dryrun.summary.txt`, `dryrun_results.csv` | 28 cases, 188 checks, **28 PASS / 0 FAIL**, secret-leak scan 0 hits |
| `dryrun.transcript.txt` | full console output of every case, the facts (exit code, `.env` changed?, which release `.env` selects, every fake task call, every fake python call) and each check |
| `verify_process_check.*` | `verify_release.ps1 -LocalProcessCheck` against a fake local listener on 127.0.0.1:3998: 7 variants, 7 as expected |
| `verify_ckam_sec_3411.txt/.csv` | `verify_release.ps1` against the throw-away `ckam-sec` stack: 38 checks, 21 PASS, 16 WARN (Docker nginx answers, as documented), 0 FAIL, 1 SKIP (process check: Docker's listener); refresh-without-cookie and made-up sign-in both JSON 401 |
| `colorama/` | `backend/constraints.txt` check in a throw-away `python:3.13-slim` container (`check.sh` → `check.out.txt`) |
| `scripts/` | `parse_check.ps1`, `dryrun.ps1` (+ `run_case.ps1`, `fakepython.cs`), `verify_proc_test.ps1` (+ `fake_uvicorn.ps1`) |

Case groups in the dry run:

* **D01–D11** `deploy -WhatIf`: happy path (with and without the unpacked folder; per-step "a failure here → BRANCH A/B"
  lines and the closing failure plan), and the refusals (exit 2, nothing touched): `DATABASE_URL` missing / empty /
  twice / development default / `127.0.0.1`, `JWT_SECRET` 40×"a" / short, `ENVIRONMENT_NAME=development`, no backup.
* **S01–S13** real runs in the fake world (fake `python.exe`; `Stop/Start-ScheduledTask`, `Get-NetTCPConnection`,
  `Stop-Process`, `Start-Sleep`, `Invoke-WebRequest` shadowed by logging fakes; task name `CKAM-Web-FAKE-DRYRUN`):
  * before the migration (S01 pip fails, S02 code head ≠ RELEASE.json, S03 database unreachable, S13 rerun): exit 1,
    `.env` restored byte-identical, previous release started once, `alembic upgrade` never called;
  * from the migration on (S04 upgrade fails, S05 wrong head after upgrade, S06 no health, S07 verify fails): exit 3,
    `.env` still selects the new release, last task call is STOP, the old release is never started, banner +
    `STATE: branch=B` line, the one-time-password line hidden; S04 (revision unchanged) offers only 1-A / 1-B;
  * S08 safety net (database already at the new head, pip fails): exit 3, old release not restarted;
  * S09–S12 refusals in a real run (missing `DATABASE_URL`, weak JWT, `ENVIRONMENT_NAME=prod`, RELEASE.json of another
    release): exit 2, no task and no python call.
* **R01–R02, L01**: rollback `-WhatIf` (already selected → stop; to another release → OK), launcher `-WhatIf`
  (`--no-proxy-headers --no-server-header`, key names only).

Limits: the fake world proves the scripts' control flow, not Windows itself. Not exercised: a real venv and
`pip install` on Windows (package index / setuptools), the real Task Scheduler (including whether stopping the task
ends the uvicorn child, and whether the venv redirector's child process is matched by `Stop-Ckam`'s
`shared\venv\*` path rule), a real uvicorn command line on 10.0.1.98, a real database, `-Confirm` prompts.
