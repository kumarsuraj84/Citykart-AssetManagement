# CKAM Production Security Release — GO / NO-GO gate

| | |
|---|---|
| Status | **PREPARED — OWNER APPROVAL PENDING.** No gate is signed. **PRODUCTION DEPLOY: NOT AUTHORIZED.** **PRODUCTION REMAINS NOT REMEDIATED** |
| Date | 2026-10-17 |
| Release | `<RELEASE-SHA>`, zip `ckam-security-release-<RELEASE-SHA>.zip`, SHA-256 `<ZIP-SHA256>`, `<ZIP-SIZE>` bytes, content hash `<CONTENT-HASH>` (rebuilt package; filled in by the lead). The earlier candidate `eed3de1` (`be3209af…`, 2,141,099 bytes) is **superseded and is not the approval target** |
| Where this gate sits | Before runbook step C (precheck) is closed and before step D; re-confirmed before step F (`CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`) |
| Who sets the results | The lead, after the final re-checks on the rebuilt package. A gate is PASS only with the evidence named in its row |

## 1. Gate table

| # | Gate | What PASS means | Evidence path | Result |
|---|---|---|---|---|
| 1 | LOCAL CODE | `<RELEASE-SHA>` contains `3e134c1`, `7b039fb`, `69c3a51`, `734fd19`, `ca94574`, `fafa225`; the only non-docs changes after `fd34520` are the fixed `ops/windows/` scripts and `backend/constraints.txt` (`colorama` pin); single Alembic head `c6e8a0b2d4f6` | runbook C13 output; rebuilt package report (`TO BE FILLED BY LEAD`) | `TO BE FILLED BY LEAD` |
| 2 | TESTS | Backend pytest on `ckam_test`, `tsc -b`, `vitest run`, Playwright, security journeys green on `<RELEASE-SHA>` (last recorded on `fd34520`: 2541 passed / 1 skipped, vitest 1257, Playwright 11 + 1 skipped, journeys 14/14) | `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` §B.5 (for `fd34520`); new run `TO BE FILLED BY LEAD` | `TO BE FILLED BY LEAD` |
| 3 | MIGRATIONS | The four migrations `f9a1c3e5b7d2` → `a3c5e7f9b1d4` → `b5d7f9a1c3e5` → `c6e8a0b2d4f6` take a restored `e6f8a0b2c4d6` copy to head as the non-superuser owning role, without losing a row | `docs/security/evidence/closure/gate/GATE_REHEARSAL.md` §1 step 3 and §2; `raw/alembic_runs.txt`, `raw/counts_premigration.csv`, `raw/counts_after_migration.csv`, `raw/copy_c_after_failed_upgrade.txt` | **PASS (gate rehearsal, on the same migration files in the superseded `eed3de1` package):** one `upgrade head` **0.86 s** wall, no row rewritten (metadata only), row counts of all 39 existing tables **unchanged**, failed upgrade rolls back all four (GT-F04). Confirmation that the migration files in `<RELEASE-SHA>` are byte-identical: `TO BE FILLED BY LEAD` |
| 4 | PACKAGE | The zip holds exactly the release layout (`RELEASE.json`, `backend\{app, alembic.ini, pyproject.toml, constraints.txt, VERSION, scripts\create_owner.py}`, `frontend-dist\`, `ops\`), `<FILE-COUNT>` files, no secrets, no tests, no `docs`, no source maps; the fixed deploy template no longer restarts the old release after the migrations; `verify_release.ps1` has the launcher-flag checks; `colorama` pinned | rebuilt package report (`TO BE FILLED BY LEAD`); `docs/security/evidence/closure/release/PACKAGE_REPORT.md` is the superseded `eed3de1` build | `TO BE FILLED BY LEAD` |
| 5 | CHECKSUM | Zip SHA-256 `<ZIP-SHA256>` and size `<ZIP-SIZE>` recorded on the dev PC, sent separately from the file; content hash `<CONTENT-HASH>`; re-verified on the server in runbook C8/E2/E4 | rebuilt package report + `MANIFEST.sha256.txt` (`TO BE FILLED BY LEAD`) | `TO BE FILLED BY LEAD` (server-side check: at deploy time) |
| 6 | ROLLBACK PLAN | Roll-forward first; corrected facts GT-F01, GT-F04, GT-F05; no automatic rollback relied on; owner-decision options with rehearsed timings | `docs/security/CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` (updated 2026-10-17); `GATE_REHEARSAL.md` §3 | `TO BE FILLED BY LEAD` (rehearsal: option `downgrade -1` worked in 0.89 s; full downgrade 0.78 s but not recommended; roll-forward after old-code attempts worked) |
| 7 | RUNBOOK | Steps A–N current for `<RELEASE-SHA>`; placeholders filled; H includes the GT-F05 checks (migrations ok, real sign-in), the move test (GT-F01) and the default-label QR scan (GT-F02) | `docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` (updated 2026-10-17) | `TO BE FILLED BY LEAD` |
| 8 | SECRET ROTATION PLAN | JWT → `ckassetapp` → NAS → ERP after H passes; each with its validation; shared-account questions answered or the rotation of that secret deferred and recorded | `docs/security/CKAM_SECRET_ROTATION_CHECKLISTS.md` | `TO BE FILLED BY LEAD` |
| 9 | COMPROMISE PLAN | A read-only post-deploy review plan with evidence preservation before the change, decision rules and incident-record fields | `docs/security/CKAM_COMPROMISE_ASSESSMENT_PLAN.md` — **INCOMPLETE: this file was only partly written on 2026-10-17 (the writer's session stopped while writing it). It must be completed and reviewed by the lead before this gate can pass** | `TO BE FILLED BY LEAD` |
| 10 | LIVE PRECHECK | Runbook step C on 10.0.1.98 / 10.0.0.205: live `3b5e842`, DB `e6f8a0b2c4d6`, `ENVIRONMENT_NAME`, JWT strength, `DATABASE_URL`, disk, backup, launcher, package index, shared accounts | change record section D | **NOT YET EXECUTED** |
| 11 | PRODUCTION BACKUP | Runbook step D: dump taken, `pg_restore --list` and `-f NUL` exit 0, second copy, NAS copy, settings copy | change record section E | **NOT YET EXECUTED** |
| 12 | PRODUCTION DEPLOY | Owner's written deploy request naming `<RELEASE-SHA>` / `<ZIP-SHA256>` and a window | change record section C | **NOT AUTHORIZED** |

**VERDICT: `TO BE FILLED BY LEAD`** (GO only when gates 1–9 are PASS, gate 12 is authorized in writing, and the
questions in §2 that block a step are answered. Gates 10 and 11 are executed during the window and are STOP points
there.)

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

**Status: PREPARED — OWNER APPROVAL PENDING. PRODUCTION DEPLOY NOT AUTHORIZED. Nothing executed.**
