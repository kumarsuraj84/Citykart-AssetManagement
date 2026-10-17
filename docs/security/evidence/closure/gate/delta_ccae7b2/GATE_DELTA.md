# CKAM security release `ccae7b2`: delta release-gate rehearsal (GD)

| | |
|---|---|
| Date | 2026-10-17, 10:38–10:50 IST (05:08–05:20 UTC), dev PC 10.0.0.47 only |
| Package | `release-packages\ckam-security-release-ccae7b2.zip`, SHA-256 `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`, 2,152,224 bytes (verified before extraction) |
| Baseline | the eed3de1 gate rehearsal in `../GATE_REHEARSAL.md` (283 cases); same rules, the same scripts (copied to `scripts/` and pointed at ccae7b2; case ids rewritten from GT- to GD-) |
| Runtime | the same set-up as eed3de1. Throw-away `ckam-gate-*` containers only: Postgres 17 on 127.0.0.1:25512, the package on 127.0.0.1:4111, image `ckam-sec-api` with the package code mounted. Production layout under `/srv/ckam` with FAKE canaries. `ENVIRONMENT_NAME=production`, a random 64-hex `JWT_SECRET`, `APP_VERSION=ccae7b2`. Command: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-proxy-headers --no-server-header` |
| Not touched | production, every 10.x host, the real ERP and NAS, the compose projects `ckam-build` / `ckam-uat` / `ckam-sec` (12 containers still up, never restarted), git (no write) |
| **Result** | **231 cases: 229 PASS, 0 FAIL, 2 NOT RUN.** There is **no regression against eed3de1** in anything that ran. Step 5 (deploy template dry run) and the optional Require-mode fake-listener test **could not be completed**: the PC's endpoint-security product removed Windows PowerShell part-way through step 5 (**GD-F01**, §5) |

## 1. Package checks (step 1)

* The zip SHA-256 and size match the coordinator's values. `Expand-Archive` (Windows PowerShell 5.1) gave 215 files.
  The five files the packaged `deploy_ckam.ps1.template` checks (its own list: `backend\app\main.py`,
  `backend\alembic.ini`, `backend\pyproject.toml`, `backend\constraints.txt`, `frontend-dist\index.html`) are all
  present. `backend\VERSION` is `ccae7b2281bc4ca71f4b6113f61dc86de392bc3e`. `RELEASE.json` gives
  `release_sha_short ccae7b2` and `alembic_head c6e8a0b2d4f6`.
* `diff -r` against the extracted eed3de1 package shows that **`backend/app` is identical**. Only these differ:
  * `RELEASE.json` and `backend/VERSION`;
  * `backend/constraints.txt` (+ `colorama==0.4.6`, now 44 pins);
  * `frontend-dist/index.html` and the bundle name (`index-Cp5JgQR-.js`, was `index-C42ooaMX.js`; `VITE_APP_VERSION`
    changed);
  * `ops/windows/README.md`, `deploy_ckam.ps1.template` and `verify_release.ps1`.
* The runtime image's packages equal the 43 runtime pins. `colorama` is pinned but not installed on Linux, because
  nothing there requires it and a constraint installs nothing.

## 2. Migration (step 2)

The old-schema `seeded.dump` was restored as the non-superuser owning role `ckassetapp` (exit 0, 332 ms, at
`e6f8a0b2c4d6`). Then the packaged `alembic upgrade head` ran:

* exit 0, 715 ms for the whole alembic process;
* on the server, all four migrations took about **10 ms in one transaction** (`ALTER TABLE asset_user ADD COLUMN token_version` took 0.649 ms);
* `alembic current` is now `c6e8a0b2d4f6 (head)`;
* **39 of 39 tables have unchanged row counts**, and the new `auth_session` table has 0 rows;
* `token_version` is 0 on all 31 rows, the TRUNCATE triggers and the lifecycle guard exist, and 16 of 16 assets have a status and a holder.

Evidence: `raw/alembic_upgrade.txt`, `raw/pg_migration_statement_log.txt`, `raw/counts_*.csv`,
`raw/schema_after_migration.txt`.

## 3. Production-mode verification (step 3), the same Phase-H set as eed3de1

| Area | Result | Evidence |
|---|---|---|
| health, `/docs` `/redoc` `/openapi.json` `/docs/oauth2-redirect` → 404 JSON, 3 unknown `/api` → JSON 404 with `request_id` | all PASS | `raw/cases_step4a_pkg.csv` |
| security headers on 8 answer types: each exactly once, no `Server` header, CSP without Google hosts, `no-store` on `/api/` | 8/8 PASS | `raw/step4a_pkg_raw.txt` |
| **IF-01: 47-path list** (all Windows forms, double encoding, overlong UTF-8, absolute paths, `/etc/passwd`, sibling folder, symlink file and directory, NUL, devices, ADS, 8.3, 5000-character name) | **0 leaks, 0 5xx, 1 identical 404 answer** | `raw/step4a_pkg_raw.txt` |
| legitimate files (new bundle, CSS, 4 root files, 8 fonts) and app addresses `/assets/1`, `/assets/new`, … | 200; app addresses get the package's shell | `raw/cases_step4a_pkg.csv` |
| diagnostics as SECHO | `version ccae7b2`, `environment production`, migrations `c6e8a0b2d4f6 = c6e8a0b2d4f6`; operator → 403 | `raw/step4b_raw.txt` |
| `system_event` `app_started` | "CKAM started (version ccae7b2, production)." | `raw/step4b_raw.txt` |
| sign-in, asset list (16), search, operator scope, Asset 360, PO list/detail | PASS | `raw/cases_step4b.csv` |
| receive: laptop **with** serial (operator), chair **without** serial (SECHO); move to a person and back (new and pre-migration assets); vendor create (SECHO and operator) and operator edit 403; reports; admin logs (receive and move audit rows, error log empty); ledger 0 assets out of step | PASS | `raw/cases_step4b.csv`, `raw/db_after_new_code.txt` |
| QR: `qr.png` = `http://127.0.0.1:4111/assets/1`; `label.png` QR and Code128 = `CKSPL/ITFA-SPL/0001` (re-encoding comparison) | PASS | `raw/qrverify.txt` |
| Playwright: **cold load of `/assets/1`, `/assets/17`, `/assets/new`**, the URL encoded in the QR, `/assets/99999`, 11 main screens; QR link in a new tab → `/login?next=%2Fassets%2F1` → Asset 360; operator scope in the browser | 25/25 PASS | `raw/cases_step4c.csv`, `raw/screens/` |
| fonts / CSP | Inter from `/assets`; **0 requests to Google or any external host, 0 CSP violations**, 0 API 5xx | `raw/step4c_browser_raw.txt` |
| sign-in rate limit | 20 × 401 then the **21st is 429** (`Retry-After: 60`), and a forged `X-Forwarded-For` does not dodge it; 11th try on one id is 429; SECHO signs in after the window | `raw/step4d_console.txt` |
| forged `X-Forwarded-For` in the access log; secrets in the app logs | 0 lines (all 376 from the real peer); JWT secret, DB password, bearer tokens and canary bodies: 0 | GD-405/406 |

## 4. Packaged `verify_release.ps1` (step 4)

Run natively in Windows PowerShell 5.1 on the host with `-BaseUrl http://127.0.0.1:4111 -ExpectedRelease ccae7b2
-ReleaseDir <extracted package> -IncludeUncProbe`. The result was **41 checks: 40 PASS, 0 WARN, 0 FAIL, 1 SKIP**,
exit 0. The SKIP is `uvicorn flags (local process)`: the listener on 4111 is Docker's, not a CKAM uvicorn process,
exactly as expected. The new JSON-401 checks pass: a refresh without a cookie and a made-up sign-in both answer
401 JSON with no session cookie (`raw/verify_release_pkg_ccae7b2.txt/.csv`).

The optional `-LocalProcessCheck Require` fake-listener test (GD-408) was **not run**, because PowerShell was gone by
then (§5). The same test on the identical script is in `release/windows_scripts_fix/verify_process_check.*`: 7 of 7
as expected, including Require → FAIL against a non-CKAM listener.

## 5. Deploy template dry run (step 5): NOT COMPLETED. Incident GD-F01

* The PowerShell 5.1 parser check of the 4 packaged `ops/windows` scripts passed: 0 parse errors, the launcher's
  uvicorn line has both flags, and no hard-coded secret-like value (`raw/parse_check.txt`).
* I then started a delta harness, built on `release/windows_scripts_fix/scripts/dryrun.ps1` and its `run_case.ps1`
  and `fakepython.cs`, with the REAL package and its RELEASE.json. It had these cases:
  * W01 `-WhatIf -Sha ccae7b2`;
  * W02 `-WhatIf` with the zip;
  * W03 and W04 with the wrong `-Sha eed3de1`;
  * F01–F04 failure after the migration (expected: exit 3, CKAM-Web stopped, the old release not restarted);
  * F05, a control for branch A.

  In the fake world the scripts call a compiled fake `python.exe`, and the Task Scheduler, process, sleep and web
  cmdlets are shadowed. While **case W01** was running, at **10:45:38–39 IST**, the PC's endpoint-security product
  (**Seqrite**; `C:\Program Files\Seqrite\Seqrite\LOGS\bdsserv.log` shows `CRemediation::TerminateProcessByPid` at
  10:45:38 and 10:45:39) killed the process tree and **quarantined or removed** these files (folder `QUARANTINE\BDSQUAR`
  has 4 new incident folders `4f184850…`, `4f18485f…`, `4f184861…`, `4f184863…` from 10:45):
  * **`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`**: still missing. The SysWOW64 copy is still
    there. Claude Code's PowerShell tool on this PC has failed since then with "powershell.exe is not recognized";
  * **`release-packages\ckam-security-release-ccae7b2.zip`**, which the harness had only read (Copy-Item source);
  * the harness files that were running: `dryrun_delta.ps1`, `run_case.ps1`, the parsed copy of `deploy_ckam.ps1`,
    and every file in the W01 fake AppRoot.
* No result from step 5 was produced, so GD-501 is NOT RUN. The same control flow passed earlier today on the
  identical template in `release/windows_scripts_fix/` (28/28: wrong RELEASE.json → exit 2; failure after the
  migration → exit 3, task left stopped, old release never restarted). That run used synthetic packages, not the
  real one, and it was not repeated on the packaged copy.
* What remains intact: the package **folder** `release-packages\ckam-security-release-ccae7b2\`. All 215 files verify
  against `MANIFEST.sha256.txt` (`sha256sum -c`: OK), and its `ops/windows` files are present. Only the zip is gone.
  The PACKAGE_REPORT says the zip is reproducible byte-for-byte from that folder (mtree + bsdtar).
* I did **not** try to restore anything from quarantine, repair System32 or change the security product. That is
  for the owner or IT.

## 6. Start-up refusals (step 6)

72 of 72 weak combinations refuse to start with exit 3. The ENVIRONMENT_NAME values were unset, blank, `prd`, `live`,
`prod-1`, garbage, `Production` and `production`. The JWT_SECRET values were missing, the 2 placeholders, 16
characters, 40 spaces, `a`×40, 31 characters, 64 characters with 7 distinct, and 10 characters plus 30 spaces. Every
refusal message names both the 32-character rule and the 8-different-character rule, and none printed the secret.
`production` with a good secret starts, and `development` with a weak secret starts (the control). See
`raw/step5_refusals.csv`.

## 7. Findings (prefix GD-)

| Id | Severity | Finding | Action (owner / IT) |
|---|---|---|---|
| **GD-F01** | **High (environment, deploy-day risk)** | The endpoint-security product on the dev PC (Seqrite behaviour detection) remediated the deploy-script dry run. It killed the process tree and removed `System32\…\powershell.exe`, the ccae7b2 release zip and the running scripts. Nothing in CKAM's code or package content is implicated: the same scripts ran clean earlier today. But **if 10.0.1.98 runs the same product with the same policy, `deploy_ckam.ps1` could be killed in the middle of a real deploy, possibly after the migration**, which leaves CKAM stopped and the launcher or scripts quarantined | 1) Restore `powershell.exe` (Seqrite console → quarantine → restore incidents `4f1848…` of 10:45 IST, or as Administrator `sfc /scannow` / `DISM /Online /Cleanup-Image /RestoreHealth`). 2) Restore the zip from quarantine **or** rebuild it from the intact folder, then **re-verify SHA-256 `b975c38d…7e3`** before any use. 3) Ask IT whether 10.0.1.98 runs Seqrite or another behaviour-blocking product and, if so, agree an exclusion or approval for the CKAM deploy before the window (that is IT's decision, not changed here). 4) Re-run step 5 (`-WhatIf` and the failure branches on the packaged template) once PowerShell is back |

The eed3de1 findings GT-F01…F06 are unchanged by this package (`backend/app` is identical); see `../GATE_REHEARSAL.md`.

## 8. Clean-up

`docker ps -a`, `docker volume ls` and `docker network ls`, filtered by `ckam-gate`, list nothing. The Postgres
container was removed with `-v`. The scratch folder `scratchpad\gate2` (extracted package, env file with the
throw-away secret, harness leftovers, copied logs) is deleted. The compose stacks are untouched. Files removed by the
security product (§5) were not mine to restore and were left for the owner.

## 9. Files

`tests.csv` (231 cases). `raw/`: per-step case files, Alembic and PostgreSQL logs, counts, schema and DB checks,
surface/functional/browser/rate-limit outputs, the refusal matrix, `verify_release` outputs, the parser check, QR PNGs
and their decode, and 5 screenshots. `scripts/`: the eed3de1 gate scripts as adapted for ccae7b2, plus
`merge_delta.mjs`. The step-5 harness `dryrun_delta.ps1` was removed by the security product; its design is described
in §5.
