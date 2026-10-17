# CKAM Production Security Release — GO / NO-GO gate

| | |
|---|---|
| Status | **PREPARED — OWNER APPROVAL PENDING.** No gate is signed. **PRODUCTION DEPLOY: NOT AUTHORIZED.** **PRODUCTION REMAINS NOT REMEDIATED** |
| Date | 2026-10-17 |
| Release | `ccae7b2`, zip `ckam-security-release-ccae7b2.zip`, SHA-256 `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`, `2152224` bytes, content hash `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b` (rebuilt package; filled in by the lead). The earlier candidate `eed3de1` (`be3209af…`, 2,141,099 bytes) is **superseded and is not the approval target** |
| Where this gate sits | Before runbook step C (precheck) is closed and before step D; re-confirmed before step F (`CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`) |
| Who sets the results | The lead, after the final re-checks on the rebuilt package. A gate is PASS only with the evidence named in its row |

## 1. Gate table

| # | Gate | What PASS means | Evidence path | Result |
|---|---|---|---|---|
| 1 | LOCAL CODE | `ccae7b2` contains `3e134c1`, `7b039fb`, `69c3a51`, `734fd19`, `ca94574`, `fafa225`; the only non-docs changes after `fd34520` are exactly `backend/constraints.txt` (`colorama==0.4.6`), `ops/windows/README.md`, `ops/windows/deploy_ckam.ps1.template`, `ops/windows/verify_release.ps1`; single Alembic head `c6e8a0b2d4f6` | runbook C13 output; `docs/security/evidence/closure/release/PACKAGE_REPORT_ccae7b2.md` §1 | **PASS** (lead, 2026-10-17: `git diff --name-only fd34520..ccae7b2` outside `docs/` lists exactly the four files; `alembic heads` = `c6e8a0b2d4f6`; all fix commits are ancestors) |
| 2 | TESTS | Backend pytest on `ckam_test`, `tsc -b`, `vitest run`, Playwright, security journeys green on `ccae7b2` (last recorded on `fd34520`: 2541 passed / 1 skipped, vitest 1257, Playwright 11 + 1 skipped, journeys 14/14) | `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` §B.5 (for `fd34520`); new run on the committed code 2026-10-17 (the release commit's backend and frontend code is identical to `fd34520`, so the suites were run once on the final code): backend **2541 passed, 1 skipped**; `tsc -b` clean; vitest **1257 passed (92 files)**; `npm run build` + `check:build` OK; permanent Playwright **11 passed, 1 skipped** (ERP-link journey; ERP is off on the test stack); security journeys **14/14**. The four files that differ in `ccae7b2` are not exercised by those suites; they were checked separately (parser, dry runs, native Windows `verify_release.ps1` 41/41) | **PASS** |
| 3 | MIGRATIONS | The four migrations `f9a1c3e5b7d2` → `a3c5e7f9b1d4` → `b5d7f9a1c3e5` → `c6e8a0b2d4f6` take a restored `e6f8a0b2c4d6` copy to head as the non-superuser owning role, without losing a row | `docs/security/evidence/closure/gate/GATE_REHEARSAL.md` §1 step 3 and §2; `raw/alembic_runs.txt`, `raw/counts_premigration.csv`, `raw/counts_after_migration.csv`, `raw/copy_c_after_failed_upgrade.txt` | **PASS (gate rehearsal, on the same migration files in the superseded `eed3de1` package):** one `upgrade head` **0.86 s** wall, no row rewritten (metadata only), row counts of all 39 existing tables **unchanged**, failed upgrade rolls back all four (GT-F04). **Delta rehearsal on the `ccae7b2` zip itself** (`evidence/closure/gate/delta_ccae7b2/GATE_DELTA.md`): `alembic upgrade head` about 10 ms database time (715 ms whole command), head `c6e8a0b2d4f6`, all 39 tables' row counts unchanged. The migration files in `ccae7b2` are byte-identical to those rehearsed in `eed3de1` (`git diff fd34520..ccae7b2 -- backend/app` is empty). **PASS** |
| 4 | PACKAGE | The zip holds exactly the release layout (`RELEASE.json`, `backend\{app, alembic.ini, pyproject.toml, constraints.txt, VERSION, scripts\create_owner.py}`, `frontend-dist\`, `ops\`), 215 files / 238 entries, no secrets, no tests, no `docs`, no source maps; the fixed deploy template (exit 0 ok · 1 failed before the migrations, previous state restored · 2 stopped by a pre-check, nothing touched · 3 failed from the migration on, `CKAM-Web` left stopped; `RELEASE.json` id/head and `DATABASE_URL` pre-checks); `verify_release.ps1 -LocalProcessCheck Require` (both uvicorn flags) and JSON-401 checks; `constraints.txt` 44 pins incl. `colorama==0.4.6` | `docs/security/evidence/closure/release/PACKAGE_REPORT_ccae7b2.md`; scripts: `docs/security/evidence/closure/release/windows_scripts_fix/README.md` (parser + 28-case dry run; never run on a server); native Windows: see §1a. (`PACKAGE_REPORT.md` is the superseded `eed3de1` build) | **PASS** — with one honest gap: the deploy-template `-WhatIf` dry run against the final zip could not be completed on 2026-10-17 because the dev PC's antivirus (Seqrite) removed Windows PowerShell and the zip during the run (GD-F01, see §1b). The same template file passed the 28-case dry run earlier the same day (`windows_scripts_fix/`), its parser check passes, and the package folder was verified intact |
| 5 | CHECKSUM | Zip SHA-256 `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` and size `2152224` recorded on the dev PC, sent separately from the file; content hash `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b`; re-verified on the server in runbook C8/E2/E4 | `PACKAGE_REPORT_ccae7b2.md` + `release-packages\MANIFEST.sha256.txt` (copy: `evidence/closure/release/raw/MANIFEST_ccae7b2.sha256.txt`) | **PASS on the dev PC** — after the antivirus removed the zip, the lead rebuilt it from the verified folder with the reproducible recipe (`mkmtree.mjs` + `tar --format zip`): **byte-identical**, SHA-256 `b975c38d…37e3`, 2152224 bytes; every file in the folder matches `MANIFEST.sha256.txt` (0 mismatches). Server-side re-check at deploy time (runbook C8/E2/E4) |
| 6 | ROLLBACK PLAN | Roll-forward first; corrected facts GT-F01, GT-F04, GT-F05; the fixed template's exit codes mapped to the cases (§6); nothing goes back automatically after the migration starts; owner-decision options with rehearsed timings | `docs/security/CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` (updated 2026-10-17); `GATE_REHEARSAL.md` §3 | `TO BE FILLED BY LEAD` **PASS** (rehearsal: option `downgrade -1` worked in 0.89 s; full downgrade 0.78 s but not recommended; roll-forward after old-code attempts worked) |
| 7 | RUNBOOK | Steps A–N current for `ccae7b2`; placeholders filled; H includes the GT-F05 checks (migrations ok, real sign-in), the move test (GT-F01) and the default-label QR scan (GT-F02) | `docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` (updated 2026-10-17; real values filled in) | **PASS** |
| 8 | SECRET ROTATION PLAN | JWT → `ckassetapp` → NAS → ERP after H passes; each with its validation; shared-account questions answered or the rotation of that secret deferred and recorded | `docs/security/CKAM_SECRET_ROTATION_CHECKLISTS.md` | **PASS (with conditions)** — owner answer 2026-10-17: the NAS *directory* is used only by CKAM; whether the NAS *account* `ckappuser` is CKAM-only is still open and is checked on the day before that password is changed (else EXT-43). The owner chose not to answer Q1–Q3 now: the DB/ERP/NAS rotations each STOP at their step until that account's answer is recorded. Only the platform owner types the passwords |
| 9 | COMPROMISE PLAN | A read-only post-deploy review plan with evidence preservation before the change, decision rules and incident-record fields | `docs/security/CKAM_COMPROMISE_ASSESSMENT_PLAN.md` — completed by the lead on 2026-10-17 (the earlier writers' sessions were stopped part-way): evidence preservation, access-log searches, audit-log SQL, database/NAS/network checks, decision rules, missing-log handling, notifying the other apps' owners, incident-record fields | **PASS** (plan only; nothing executed) |
| 10 | LIVE PRECHECK | Runbook step C on 10.0.1.98 / 10.0.0.205: live `3b5e842`, DB `e6f8a0b2c4d6`, `ENVIRONMENT_NAME`, JWT strength, `DATABASE_URL`, disk, backup, launcher, package index, shared accounts | change record section D | **NOT YET EXECUTED** |
| 11 | PRODUCTION BACKUP | Runbook step D: dump taken, `pg_restore --list` and `-f NUL` exit 0, second copy, NAS copy, settings copy | change record section E | **NOT YET EXECUTED** |
| 12 | PRODUCTION DEPLOY | Owner's written deploy request naming `ccae7b2` / `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` and a window | change record section C | **NOT AUTHORIZED** |

### 1a. Native Windows evidence for the final package (added 2026-10-17, security release)

The `ccae7b2` package was tested on the dev PC (Windows 11), **not on production**:
- unpacked and installed with the exact documented command `pip install -c backend\constraints.txt -e backend`
  (Python 3.13.1; 43 packages at their pins incl. `colorama==0.4.6`; succeeded);
- started with production settings and both uvicorn flags;
- the 32-payload Windows attack list gave **0 leaks, 0 server errors, identical refusals**;
- `/assets/<id>` and `/assets/new` opened the app page, and a browser cold load of `/assets/1` went to sign-in and
  then to the asset page;
- the packaged `verify_release.ps1` gave **41/41 PASS**, including `-LocalProcessCheck Require`.

Evidence: `docs/security/evidence/closure/windows/native_windows_release_ccae7b2.txt`, `native_windows_qr_ccae7b2.txt`,
`native_windows_verify_release_ccae7b2.csv`.

**Limits:** portable (embeddable) Python, not a venv; test database on Docker (PostgreSQL 17), not PostgreSQL 18; no
Task Scheduler / `CKAM-Web` task, no NAS mapping, no real launcher, not 10.0.1.98. It supports gates 4 and 7. It
does **not** replace the live precheck (10) or the step H verification on the server.

### 1b. Incident during the final rehearsal: antivirus removed Windows PowerShell on the dev PC (GD-F01, High)

While the rehearsal tester ran the deploy-template dry run (2026-10-17 about 10:45 IST), the dev PC's endpoint
product (Seqrite, behaviour blocking) removed `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, the
release zip and the running dry-run scripts (four quarantine entries, `Seqrite\QUARANTINE\BDSQUAR`). Findings:
- **Not a release defect:** the release folder and every file in it are intact and match the manifest; the zip was
  rebuilt byte-identically. The trigger was probably the dry-run harness (a compiled stand-in `python.exe` plus
  scripts that stop processes, edit a settings file and restart a task), not the release content.
- **Dev PC:** `powershell.exe` is still missing from System32 (a 32-bit copy exists under SysWOW64). Windows
  PowerShell-based tooling on this PC is broken until the owner restores it (restore from the Seqrite quarantine,
  or `sfc /scannow` / DISM as Administrator). The lead did not change the antivirus or restore system files.
- **Production risk:** if 10.0.1.98 runs the same product with the same policy, a real deploy could be interrupted
  after the migrations and leave CKAM stopped. See Q18.

**VERDICT: READY FOR OWNER-APPROVED PRODUCTION SECURITY DEPLOYMENT — with three conditions** (set by the lead on
2026-10-17): gates 1–9 are PASS; gate 12 is NOT authorized until the owner types the exact sentence
`DEPLOY CKAM SECURITY RELEASE ccae7b2`; and before the window the owner/IT must (a) answer **Q18** (does 10.0.1.98
run Seqrite or similar behaviour-blocking software; agree an exclusion for the CKAM folder and the deploy scripts
for the window), (b) have a second administrator reachable in case the antivirus interferes, and (c) accept that
the NAS/DB/ERP password rotations wait for their shared-account answers (Q1–Q3). Gates 10 and 11 are executed during
the window and are STOP points there. **PRODUCTION REMAINS NOT REMEDIATED.**

## 2. OWNER / INFRA QUESTIONS REQUIRED BEFORE DEPLOY

| # | Question | Who answers | Blocks |
|---|---|---|---|
| Q1 | Is the NAS account `ckappuser` used only by CKAM? | NAS-ADMIN / owner | rotation of the NAS password (else EXT-43: a CKAM-only account later) |
| Q2 | Is the ERP role `ckpost` (`PO_SOURCE_USER`) used only by CKAM, and not by the dev PC's `.env`? | ERP-OWNER | rotation of the ERP password (else a joint change / EXT-25) |
| Q3 | Is the DB role `ckassetapp` used only by CKAM and CKAM's backup? Which login does the nightly backup use? | DBA / owner | rotation of the DB password; the backup's stored credential |
| Q4 | May IT copy the live `shared\run_ckam_web.ps1` for review (after checking it holds no secret)? | owner / IT | launcher comparison (C9, EXT-13) |
| Q5 | Which login does the nightly backup `CK_Backup_CKASSETMANAGEMENT` connect as, and where is that credential stored? | DBA | DB rotation, step J4 |
| Q6 | Can 10.0.1.98 reach the Python package index (pypi.org, files.pythonhosted.org)? | Infra / IT | step F2 (else STOP) |
| Q7 | Production data volume (rows in `asset`, `audit_log`; dump size) | DBA (C7) | timing estimate, disk check |
| Q8 | Which test records will remain in production after H16/H17 (receive one unit, move an asset; no hard delete)? Which PO line and asset are used? | owner | H16, H17 |
| Q9 | Maximum acceptable downtime | owner | user notice, case 2 time box |
| Q10 | Interim decision on port 3211 / the router forward (close, restrict or keep) — not authorised by the runbook | owner + Infra (SD-04 / EXT-05) | interim exposure |
| Q11 | Where is the evidence kept off-server (`<OFFSERVER-EVIDENCE>`), encrypted or access-restricted? | owner / SEC | step B, EXT-41 |
| Q12 | Who tells the Spinwheel and Citykart Desk owners that CKAM ran as SYSTEM on the shared server with IF-01 open (their files may have been readable), and when? | owner | notification, incident record |
| Q13 | Is `DATABASE_URL` set in `shared\.env`, and does `JWT_SECRET` meet the length/variety rules (checked without printing)? | IT (C3, C4) | the new code will not start (JWT) or uses the dev fallback (DB URL) |
| Q14 | Enough free disk on 10.0.1.98 (D:) and 10.0.0.205 (E:)? | IT / DBA (C5) | steps D, E, F |
| Q15 | Does any uptime monitor use `HEAD` requests? (single-port pages answer `HEAD` with 405; use GET) | Infra | false alarms after the deploy |
| Q16 | Has anyone reported QR scans failing (CL2-IF-04)? Which labels are in use: default "Barcode + QR" (carries the plain-HTTP `BASE_URL` link) or "QR Code"/"Barcode" (asset code only)? | owner / store teams | H10 test choice, HTTPS planning (GT-F02) |
| Q17 | Who types each password on the servers (`postgres` superuser, NAS, ERP, new JWT secret)? Names per step | owner | steps D, I |
| Q18 | Does the production server 10.0.1.98 (and the DB server) run Seqrite or another endpoint product with behaviour blocking? Agree an exclusion for the CKAM folder and the deploy scripts for the window; know who can restore a quarantined file (GD-F01) | IT / Infra | the deploy scripts and the release folder could be removed mid-deploy |
| Q19 | Owner's answer 2026-10-17: only the platform owner types the passwords; downtime now is acceptable; the NAS directory is CKAM-only — still to confirm: is the NAS **account** `ckappuser` CKAM-only (Q1)? | owner | NAS rotation |

**Status: PREPARED — OWNER APPROVAL PENDING. PRODUCTION DEPLOY NOT AUTHORIZED. Nothing executed.**
