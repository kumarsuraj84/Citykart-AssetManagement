# Change Record (CKAM) — EMERGENCY security release — DRAFT

> **Status: DRAFT — NOT APPROVED — NOT EXECUTED — NOT COMPLETED.**
> Filled-in draft of `policies/templates/change_record.md` (doc 04). Prepared 2026-10-17 by the release manager.
> Nothing in it has happened. Every approval and signature field is blank and `PENDING`. Copy this file, give it a
> change id, and keep the filled copy **outside** the repository (it will hold names, times and evidence
> references). Never write a password or secret here (write "checked: length ≥ 32, ≥ 8 distinct", never the value).
> Placeholders `ccae7b2`, `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`, `2152224`, `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b` are filled in by the lead from the
> rebuilt package. The earlier candidate `eed3de1` (SHA-256 `be3209af…`, 2,141,099 bytes) is **superseded and is not
> the subject of this change**.

## A. Request

| | |
|---|---|
| Change id | CHG-2026-___ (`PENDING`) |
| Linked incident | INC-2026-___ "IF-01 file-read exposure on production since 2026-09-30" (`PENDING`, runbook step A2) |
| Request / ticket reference | `PENDING` |
| Requested by, date | `PENDING` (the owner's explicit deploy request; the push phrase is **not** a deploy request) |
| Reason (plain words) | **CRITICAL IF-01 security remediation**: the live server `3b5e842` lets anyone who reaches port 3211 read any file on it, including the file with the database password, the login-signing key, the ERP password and the NAS password. **CL2-IF-04 QR deep-link fix**: scanning an asset's QR (Asset 360, and labels printed in the default "Barcode + QR" format) shows an error page instead of the asset |
| Other fixes in the same release (one line each) | IF-01-WIN Windows path forms (`..\`, drive letters, UNC, device names, ADS) refused before any file access · N4/CL1-N4-01 start-up guard: weak or placeholder `JWT_SECRET` refused, missing `ENVIRONMENT_NAME` = production · IF-14/N6 API docs off in production, unknown `/api` paths a JSON 404 · AU-05/AU-07 session version: role/password/access changes end all sessions · AU-06 refresh-token reuse detection (`auth_session`) · IF-05/IF-06 TRUNCATE guards and 5-year audit purge floor · OBS-STATUS database guard on asset status/holder/date · N2 forged `X-Forwarded-For` ignored (`--no-proxy-headers`) · CL2-IF-OBS-05 no `Server` banner (`--no-server-header`) · FONTS self-hosted (no Google requests) · CSP and security headers once · sign-in rate limits · stronger password rules · same-name rules for vendors/brands/categories (also in imports) · upload content checks · audit-write failures visible · IF-11 exact package versions (`constraints.txt`, now incl. `colorama`) |
| Type | **Emergency**, security-relevant |
| Risk | **security urgent** — High (CRITICAL IF-01 live in production; the change itself adds four database migrations and a new launcher command line) |
| Findings or decisions closed (on successful verification only) | IF-01, IF-01-WIN, CL2-IF-04 (EXT-01, EXT-44); code side of IF-14, N2, N4, AU-05, AU-06, IF-05/06 (non-owner roles), OBS-STATUS, FONTS (EXT-11), EXT-38 (launcher flags). **Not closed by this change:** EXT-02 (rotation, step I), EXT-03 (compromise check, step K), IF-02 HTTPS, IF-07 service account, EXT-07 role split |

## B. Development and test evidence (DEV, 10.0.0.47)

| | |
|---|---|
| Release commit | `ccae7b2` (full: `ccae7b2`), branch `worktree-ckam-build`, not pushed |
| Commit range | `4ba4e94` … `ccae7b2` (security commits `3e134c1` … `fafa225`, then documentation and the rebuild fixes) — exact list `TO BE FILLED BY LEAD` (`git log --oneline c66378d..ccae7b2`) |
| Package | `release-packages\ckam-security-release-ccae7b2.zip`, SHA-256 `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`, 2,152,224 bytes, 238 entries, 215 files, content hash `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b`, bundles `index-Cp5JgQR-.js` / `index-Bj21ou3B.css`, `constraints.txt` 44 pins incl. `colorama==0.4.6`; report: `docs/security/evidence/closure/release/PACKAGE_REPORT_ccae7b2.md` (`PACKAGE_REPORT.md` describes the superseded `eed3de1` build). Outside `docs/`, it differs from `fd34520` only in `backend/constraints.txt`, `ops/windows/README.md`, `ops/windows/deploy_ckam.ps1.template`, `ops/windows/verify_release.ps1` |
| Native Windows evidence (dev PC, not production) | The `ccae7b2` package was installed with `pip install -c backend\constraints.txt -e backend` (Python 3.13.1 portable/embeddable, not a venv; 43 packages at their pins, succeeded) and started with production settings and both flags. Results: 32 Windows payloads → 0 leaks and one identical refusal; `/assets/<id>`, `/assets/new` opened the app; a cold browser load of `/assets/1` went to sign-in and then to the asset; packaged `verify_release.ps1` 41/41 PASS incl. `-LocalProcessCheck Require`. Evidence: `docs/security/evidence/closure/windows/native_windows_release_ccae7b2.txt`, `native_windows_qr_ccae7b2.txt`, `native_windows_verify_release_ccae7b2.csv`. Limits: test DB on Docker (not PostgreSQL 18), no Task Scheduler, no NAS, not 10.0.1.98 |
| Reference scripts | `deploy_ckam.ps1.template` fixed (exit 0 ok · 1 failed before the migrations, previous state restored · 2 stopped by a pre-check, nothing touched · 3 failed from the migration on, `CKAM-Web` left stopped); `verify_release.ps1 -LocalProcessCheck Require`. Dry run only, never run on a server: `docs/security/evidence/closure/release/windows_scripts_fix/README.md` |
| New Alembic migrations (ids, in this order) | 1 `f9a1c3e5b7d2` (`asset_user.token_version`) → 2 `a3c5e7f9b1d4` (TRUNCATE guards, 5-year audit purge floor) → 3 `b5d7f9a1c3e5` (`auth_session`) → 4 `c6e8a0b2d4f6` (lifecycle field guard). Production `e6f8a0b2c4d6` → `c6e8a0b2d4f6` (single head). All four run in **one** transaction |
| Backend tests (`pytest` on `ckam_test`) | Last recorded: 2541 passed / 1 skipped on `fd34520`. On `ccae7b2`: `TO BE FILLED BY LEAD` |
| Frontend (`tsc -b`, `vitest run`) | Last recorded: vitest 1257 on `fd34520`. On `ccae7b2`: `TO BE FILLED BY LEAD` |
| Browser / E2E / security journeys | Last recorded: Playwright 11 + 1 skipped, security journeys 14/14 on `fd34520`. On `ccae7b2`: `TO BE FILLED BY LEAD` |
| Release-gate rehearsal | `docs/security/evidence/closure/gate/GATE_REHEARSAL.md` (on the superseded `eed3de1` package, same application code, Linux container): 283 cases, 280 PASS, 3 FAIL (documentation claims only: GT-F01, GT-F02); migrations 0.86 s, no row rewritten, row counts unchanged; IF-01 47 probes, 0 leaks. Re-check of the rebuilt package: `TO BE FILLED BY LEAD` |
| Other test evidence | `docs/security/evidence/closure/**` (retest 1–3, sessions, infra, Windows native runs, performance, WP-F/WP-F2); summary `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` §B.3–B.5 |
| Dependency audit (`npm audit --omit=dev`, `pip-audit`) | `docs/security/evidence/closure/backend/dependency_recheck.md`, `docs/security/evidence/closure/infra/npm_audit_recheck.md`; re-run for `ccae7b2`: `TO BE FILLED BY LEAD` |
| Security baseline checklist done? | `PENDING` (`CKAM_SECURITY_BASELINE.md`) |
| Second reviewer (name) or self-review note | `PENDING` (independent AI retests are procedural, not organisational independence) |

## C. Approvals

Every field is blank on purpose. Nothing is approved.

| Approval | By | Date / time | How (words used, channel) | Status |
|---|---|---|---|---|
| Deploy `ccae7b2` (`b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3`) to production in a named window | | | | `PENDING` |
| Rotation of the four secrets after verification (JWT, `ckassetapp`, NAS, ERP) | | | | `PENDING` |
| Shared-account answers (`ckappuser`, `ckpost`, `ckassetapp`) | | | | `PENDING` |
| User notice (downtime; everyone signs in again) | | | | `PENDING` |
| Gate "H passed" (runbook step H) | | | | `PENDING` |
| Any rollback / downgrade / restore decision (only if needed) | | | | `PENDING` |
| Push to `origin` (separate; runbook step N, option A/B/C) | | | | `PENDING` |
| Record completed and signed | | | | `PENDING` |

## D. Pre-deploy checks (runbook step C; EXT-39 / EXT-38)

| Check | Result |
|---|---|
| Live release is `3b5e842`; DB at `e6f8a0b2c4d6` | `PENDING` |
| `ENVIRONMENT_NAME=production` in `shared\.env` | `PENDING` |
| `JWT_SECRET` strength checked without printing it (1 line, no quotes, ≥ 32, ≥ 8 distinct, not a placeholder) | `PENDING` |
| `DATABASE_URL` present, host `10.0.0.205`, database `ckassetmanagement` (password never printed) | `PENDING` |
| Disk space on 10.0.1.98 and 10.0.0.205 | `PENDING` |
| Backup task healthy; which DB login the backup uses | `PENDING` |
| Zip SHA-256 `b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3` and size `2152224` verified **on the server** | `PENDING` |
| Live launcher reviewed and hashed; both flags missing today (expected) | `PENDING` |
| Package index reachable from 10.0.1.98; venv Python 3.13 | `PENDING` |
| Window does not overlap the 03:00 backup or other apps' maintenance | `PENDING` |
| Install uses `backend\constraints.txt`; `pip freeze` saved in `releases\ccae7b2\` | `PENDING` |
| uvicorn will start with `--no-proxy-headers --no-server-header` | `PENDING` |
| Migrations to run listed (section B) | listed |
| Operator has read the **fixed** `deploy_ckam.ps1.template` (branch A before the migrations restarts the previous release, exit 1; branch B from the migration on leaves `CKAM-Web` stopped, exit 3) — or the deploy is done by hand | `PENDING` |
| If the script was used: its exit code (0/1/2/3) and the `STATE:` line from the deploy log | `PENDING` |
| Go/no-go table signed READY (`CKAM_PRODUCTION_SECURITY_GO_NO_GO.md`) | `PENDING` |

## E. Deployment (runbook steps B, D, E, F, G)

| Step | Result | Time | By |
|---|---|---|---|
| B — production logs copied off-server, hash list | `PENDING` | | |
| D — DB dump; `pg_restore --list` and `-f NUL` exit 0; second copy kept; NAS copy; `.env` copy | `PENDING` | | |
| E — zip copied; SHA-256 re-checked after copy; expanded to `releases\ccae7b2\`; content hash `e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b` | `PENDING` | | |
| F0 — final log top-up | `PENDING` | | |
| F1 — `CKAM-Web` stopped (CKAM's listener only) | `PENDING` | | |
| F2 — `pip install -c constraints.txt -e`; exit 0; 43 packages at their pins, `colorama==0.4.6` | `PENDING` | | |
| F3 — `FRONTEND_DIST_DIR`, `APP_VERSION=ccae7b2`; no BOM; C3/C4 re-pass | `PENDING` | | |
| F4 — `alembic upgrade head` **before** start; before `e6f8a0b2c4d6` → after `c6e8a0b2d4f6 (head)`; `current` = `heads` | `PENDING` | | |
| G — launcher with both flags (hash); `CKAM-Web` started; one listener; `serving release ccae7b2`; no "Refusing to start" | `PENDING` | | |

## F. Verification plan and smoke checks (runbook step H)

Verification follows **runbook step H (H1–H19)** from the server and from a LAN PC. `/openapi.json` is no longer a
check: in production it is a JSON 404.

| Check | Result |
|---|---|
| H1 `/api/health` ok | `PENDING` |
| H2 `app_started`: version `ccae7b2`, `production`, migrations match, `database_host` 10.0.0.205; no `head_mismatch` | `PENDING` |
| H3 Alembic head `c6e8a0b2d4f6` | `PENDING` |
| H4 `verify_release.ps1` 0 FAIL (server with `-LocalProcessCheck Require`, elevated: both uvicorn flags; + LAN), incl. the JSON-401 checks | `PENDING` |
| H5 IF-01 probe list all 404 (server + LAN) | `PENDING` |
| H6 `/docs`, `/redoc`, `/openapi.json` JSON 404 | `PENDING` |
| H7 unknown `/api` path JSON 404 | `PENDING` |
| H8 security headers exactly once; no `server: uvicorn`; `X-Request-ID` | `PENDING` |
| H9 forged `X-Forwarded-For` logged as `127.0.0.1` | `PENDING` |
| H10 `/assets/<id>`, `/assets/new` 200; phone scan of an Asset 360 QR **and** of a default "Barcode + QR" label | `PENDING` |
| H11 served `index.html` names `index-Cp5JgQR-.js` | `PENDING` |
| H12 launcher log `serving release …\ccae7b2`; NAS mapping OK | `PENDING` |
| H13 sign-in as head-office admin; diagnostics: version, `production`, migrations ok (mandatory: health alone is not proof, GT-F05) | `PENDING` |
| H14–H15 Asset list, PO list and detail | `PENDING` |
| H16 Receive one unit (ledger + audit row ids) | `PENDING` |
| H17 Move (ledger + audit row ids) — the real test of the new trigger; a receive alone does not prove it (GT-F01) | `PENDING` |
| H18 ERP `sync_success` after start | `PENDING` |
| H19 document upload / download (NAS) | `PENDING` |

## G. Rollback plan and result

| | |
|---|---|
| Rollback plan | **Roll-forward preferred due to migration compatibility** (`CKAM_PRODUCTION_ROLLBACK_STRATEGY.md`). Facts: a failed `alembic upgrade head` rolls back **all four** migrations, so the database stays at `e6f8a0b2c4d6` and `3b5e842` can be restarted (IF-01 still open) — safe abort, case 1 (GT-F04). After a successful upgrade, `3b5e842` **can still receive but cannot move, repair, sell or scrap** (users get a misleading 422 "Some of the values could not be saved…"; the real reason is only in `error.jsonl`), and it reopens IF-01 (GT-F01). The new code on an un-migrated database passes `/api/health` and a bare `verify_release.ps1` but nobody can sign in (GT-F05). Going back after the upgrade is an **owner decision** only: `alembic downgrade -1` (trigger migration only, from `releases\ccae7b2\backend`; rehearsed 0.89 s; never all four) or restoring the step-D dump (loses everything written since). **After the migrations start, nothing goes back automatically**: the fixed deploy template restarts the previous release only before `alembic upgrade head` (exit 1) and leaves `CKAM-Web` stopped from the upgrade on (exit 3). It was dry-run only, so the operator reads it first |
| Case that applied (0–5) and decision (who, when, words) | `PENDING` |
| Result | `PENDING` — Deployed OK / Rolled forward / Aborted (why) |
| Downtime (minutes) | `PENDING` |
| Issues found after deploy | `PENDING` |
| Secrets (names only): JWT / `ckassetapp` / NAS / ERP — rotated or not rotated (reason) | `PENDING` (runbook steps I/J) |
| Old secret copies (`.env.pre-*`) deleted (J5) | `PENDING` |
| Evidence copied off-server (EXT-41) | `PENDING` |
| HTTPS / port 3211 / service account / role split / backups — dates agreed (step M) | `PENDING` |
| Record completed by, date | `PENDING` |
| APPROVER signature | `PENDING` |

**Status: DRAFT — NOT APPROVED — NOT EXECUTED — NOT COMPLETED.**
