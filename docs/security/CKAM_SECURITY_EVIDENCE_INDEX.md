# CKAM Security Evidence Index

| | |
|---|---|
| Date | 2026-10-16 (updated by WP-M2b for the closure state); first version 2026-10-15 |
| Baseline | Local HEAD `fd34520` (worktree `ckam-build`): 21 local security commits on top of `4ba4e94`, 22 ahead of origin `c66378d`. **Nothing pushed, nothing deployed, production never touched** (still `3b5e842`) |
| Reports | First programme: `CKAM_VAPT_REPORT.md`, `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md`, `CKAM_SECURITY_COMPLETE_REPORT.md` (all present). Closure: `CKAM_SECURITY_CLOSURE_REGISTER.md`, `CKAM_SECURITY_MASTER_HANDOVER.md`, `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` (present; owned by a separate writer, contents not re-checked here) |
| Rule | Every repository path below was checked to exist on 2026-10-16 (Glob / script check). Evidence that can only come from production or from people is marked **TO BE GENERATED** (with the command or screen) or **NOT EVIDENCED** |

All repository paths are relative to the repository root. Server paths are on the machines named in
`docs/ai/PRODUCTION_INFRASTRUCTURE.md`. Never copy secret values into this folder; for secrets, evidence is a
dated note of *that* a rotation or check happened, never the value.

`docs/security/evidence/` holds:
- the first VAPT (2026-10-15) in `access/`, `auth/`, `input/`, `infra/` (with `infra/raw/` and `infra/sql/`);
- the closure programme (2026-10-16) in `closure/` (section 21). Historical folders are never overwritten.

---

## 1. Architecture

| Evidence | Path |
|---|---|
| Production layout | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` |
| Product architecture | `docs/ai/CKAM_CURRENT_PRODUCT_ARCHITECTURE_2026.md`, `docs/ai/PRODUCT_CONTEXT.md` |
| Original design | `docs/specs/2026-09-23-ckam-design.md` |
| Threat model, trust boundaries, attack surface (updated 2026-10-16) | `docs/security/CKAM_THREAT_MODEL.md` |
| Dev stack definition (non-root containers, `volume-init`, tmpfs, edge subnet) | `docker-compose.yml`, `backend/Dockerfile`, `frontend/nginx.conf` (dev only; production has no nginx) |
| App entry point, security headers, static routes, SPA fallback | `backend/app/main.py` |
| Settings and defaults (incl. `RATE_LIMIT_*`, `REFRESH_REUSE_GRACE_SECONDS`, `PO_SOURCE_SSLMODE`, `TRUSTED_PROXIES`) | `backend/app/core/config.py`, `.env.example` |

## 2. Data flow

| Evidence | Path |
|---|---|
| Data-flow diagram | `docs/security/CKAM_THREAT_MODEL.md` section 4 |
| ERP flow | `docs/ai/ERP_INTEGRATION.md` |
| Logging flow | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |

## 3. RBAC (role-based access control)

| Evidence | Path |
|---|---|
| Single source of create/manage decisions; role guards | `backend/app/core/capabilities.py`, `backend/app/core/deps.py` |
| First authorization matrix: 217 routes x 11 personas | `docs/security/evidence/access/authz_matrix.csv`, `docs/security/evidence/access/matrix_raw.csv` |
| First test cases (467) | `docs/security/evidence/access/tests.csv` |
| Escalation / mass-assignment / business logic | `docs/security/evidence/access/phaseB_escalation.json`, `docs/security/evidence/access/phaseB_logic.json` (scripts next to them) |
| **Final-code matrix (retest 2): 217 routes x 14 identities = 3,038 cells, 0 escalations; 319 cases** | `docs/security/evidence/closure/retest2/access/authz_matrix.csv`, `docs/security/evidence/closure/retest2/access/tests.csv`, `docs/security/evidence/closure/retest2/access/RETEST2_ACCESS.md`, raw in `docs/security/evidence/closure/retest2/access/raw/` |
| RBAC rebuild record; permission decisions | `docs/ai/ASSET_USER_RBAC_REBUILD_REPORT.md`; `docs/ai/DECISIONS.md` |

## 4. Company and work-area segregation

| Evidence | Path |
|---|---|
| IDOR / BOLA (first run, 208 cases) | `docs/security/evidence/access/phaseB_results.json` |
| IDOR on the final code | `docs/security/evidence/closure/retest2/access/raw/idor.json` |
| Self-service and cross-company findings (AC-1, AC-2) | `docs/security/evidence/access/findings.csv`, `docs/security/evidence/access/self_service_masters.txt` |
| ERP draft cross-company (IF-03) | `docs/security/evidence/infra/erp_cross_company_draft.txt` |
| Regression tests | `backend/tests/core/test_security_read_scope.py`, `backend/tests/core/test_s0_work_area.py` |
| E2E scoping journeys | `frontend/e2e/add-asset-company-scoping.spec.ts`, `frontend/e2e/rbac-responsibility-journey.spec.ts` |

## 5. Password security and sessions

| Evidence | Path |
|---|---|
| Hashing (Argon2id), JWT (HS256 pinned) | `backend/app/core/security.py`; `backend/tests/auth/test_jwt_algorithm_pinned.py` |
| Login, lockout, refresh, logout | `backend/app/auth/router.py` |
| Server-side refresh sessions (AU-06: SHA-256 of the token id only, rotate once, 10 s grace, reuse ends all sessions) | `backend/app/auth/sessions.py`; migration `backend/app/alembic/versions/b5d7f9a1c3e5_auth_session_refresh_reuse.py`; `backend/tests/auth/test_wpa2_refresh_reuse.py` |
| Atomic session version (OBS-TV) | `backend/tests/auth/test_wpa2_token_version_atomic.py`; migration `backend/app/alembic/versions/f9a1c3e5b7d2_asset_user_token_version.py` |
| First test cases AU-T001..AU-T102 | `docs/security/evidence/auth/tests.csv` |
| Password policy (AU-08) | `backend/app/auth/password_policy.py`, `backend/tests/auth/test_vapt_password_policy.py` |
| Sign-in timing and rate limit (AU-01, AU-03, AU-16) | `backend/app/core/rate_limit.py`, `backend/tests/auth/test_rate_limit.py`, `backend/tests/auth/test_vapt_login.py` |
| Session revocation | `backend/tests/auth/test_vapt_sessions.py`, `frontend/src/lib/auth-session.test.ts` |
| Login clash fix | `backend/tests/auth/test_login_primary_owner_clash.py` |
| Production secret guard and environment default (IF-04, N4, CL1-N4-01) | `backend/tests/core/test_production_secret_guard.py` |
| Sessions retest on the final code (56 cases, all PASS) | `docs/security/evidence/closure/retest2/sessions/RETEST2_SESSIONS.md`, `docs/security/evidence/closure/retest2/sessions/tests.csv`, raw `a1_refresh.json`, `a1b_legacy.json`, `a2_revocation.json`, `a2b_workarea.json`, `a3_ratelimit.json`, `a5_password.json`, `a6_size.json`, `a7_timing.json` in `docs/security/evidence/closure/retest2/sessions/raw/` |
| Closure work-package results | `docs/security/evidence/closure/backend/WPA2_RESULTS.md`, `docs/security/evidence/closure/backend/wpa2_targeted_tests.txt`, `docs/security/evidence/closure/backend/wpa2_full_suite.txt`, `docs/security/evidence/closure/backend/wpa2_probe_output.txt` |
| AU-04 lock-out options (decision SD-06) | `docs/security/evidence/closure/backend/AU-04_OPTIONS.md` |

## 6. Audit trail

| Evidence | Path |
|---|---|
| Design, categories, actions, redaction, retention | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| Automatic audit and writer (incl. log-write failure reporting) | `backend/app/observability/audit.py`, `backend/app/observability/writer.py`, `backend/app/observability/events.py` |
| Write-route coverage (122 routes) | `docs/security/evidence/auth/audit_coverage.csv`; coverage test `backend/tests/observability/test_coverage_walker.py` |
| Audit-write failures visible (once a minute with a count) | `backend/tests/observability/test_log_write_failure_reporting.py` |
| Append-only triggers and privilege tests (first run) | `docs/security/evidence/infra/db_02_triggers_constraints.out.txt`, `docs/security/evidence/infra/db_03_append_only_privilege_tests.out.txt`, `docs/security/evidence/infra/db_04_least_priv_flag_bypass.out.txt` |
| Same checks re-run on the final code | `docs/security/evidence/closure/retest2/infra/raw/db6c_db_01_roles_privileges.out.txt` … `db6c_db_05_data_integrity.out.txt`, `docs/security/evidence/closure/retest2/infra/raw/db6a_guards_sec.out.txt` |
| TRUNCATE guards and 5-year purge floor | `backend/app/alembic/versions/a3c5e7f9b1d4_append_only_truncate_and_purge_floor.py`; `backend/tests/observability/test_vapt_append_only.py` |
| Production audit export | **TO BE GENERATED**: head-office admin, `GET /api/admin/logs/export?kind=audit&from=<date>&to=<date>&format=csv` |

## 7. Lifecycle history

| Evidence | Path |
|---|---|
| Single writer of status / holder / status_since | `backend/app/lifecycle/service.py` |
| DB guard on those fields (OBS-STATUS; marker set by `apply_events`) | `backend/app/alembic/versions/c6e8a0b2d4f6_asset_lifecycle_fields_guard.py`; `backend/tests/lifecycle/test_obs_status_guard.py`, `backend/tests/lifecycle/fixture_marker.py`; `docs/security/evidence/closure/retest2/access/raw/db_guard.txt` |
| `asset_event` / `asset_field_change` append-only | `docs/security/evidence/infra/db_02_triggers_constraints.out.txt` |
| Integrity checks | `docs/security/evidence/infra/db_05_data_integrity.out.txt`; `docs/security/evidence/closure/retest2/sessions/raw/integrity_output.txt` |
| E2E lifecycle | `frontend/e2e/asset-lifecycle.spec.ts`, `frontend/e2e/asset-correction.spec.ts` |

## 8. Logs

| Evidence | Path |
|---|---|
| Log design and settings | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| File logging, request id middleware, redaction | `backend/app/observability/filelog.py`, `backend/app/observability/middleware.py`, `backend/app/observability/redact.py` |
| X-Request-ID also on nginx answers (CL2-IF-03, dev) | `docs/security/evidence/closure/wpf/wpf_03_xrequestid_live.out.txt` |
| Real client address behind nginx (N3) | `docs/security/evidence/closure/infra/raw/docker/n3_result.json`, `docs/security/evidence/closure/retest2/infra/raw/n2n3_sec_probe.json` |
| Production log files | **TO BE GENERATED**: dated, hashed off-server copy of `D:\Citykart_Applications\Citykart_AssetManagement_App\logs\` before the deploy (EXT-41) |
| PostgreSQL server logging (production) | **NOT EVIDENCED** (EXT-27) |

## 9. Diagnostics

| Evidence | Path |
|---|---|
| Diagnostics and health | `backend/app/observability/diagnostics.py`, `backend/app/observability/system.py` |
| Admin logs API | `backend/app/observability/admin_router.py`, `backend/tests/observability/test_admin_api.py` |
| Production health snapshot | **TO BE GENERATED** after deploy: `GET /api/admin/diagnostics/health` and `GET /api/admin/diagnostics/db` (save JSON with date) |

## 10. Dependency scans

| Evidence | Path |
|---|---|
| First run (2026-10-15) | `docs/security/evidence/infra/dependency_audit.md`, `docs/security/evidence/infra/raw/npm_audit_prod.json`, `docs/security/evidence/infra/raw/npm_audit_all.json`, `docs/security/evidence/infra/raw/pip_audit.json`, `docs/security/evidence/infra/raw/pip_freeze_image.txt` |
| Closure re-checks (npm `--omit=dev` 0; one dev-only HIGH, OBS-NPM-DEV; python-jose / ecdsa no fixed version, ACCEPTED) | `docs/security/evidence/closure/backend/dependency_recheck.md`, `docs/security/evidence/closure/backend/raw/pip_audit_constraints.txt`, `docs/security/evidence/closure/infra/npm_audit_recheck.md`, `docs/security/evidence/closure/infra/raw/npm_audit_prod.json`, `docs/security/evidence/closure/infra/raw/npm_audit_all.json`, `docs/security/evidence/closure/retest2/infra/raw/pip_audit_constraints.txt` |
| Manifests | `frontend/package-lock.json`, `backend/pyproject.toml`, `backend/constraints.txt` |
| Production Python versions | **TO BE GENERATED**: on 10.0.1.98, `shared\venv\Scripts\python.exe -m pip freeze` per release |

## 11. VAPT and retest results

| Area | Path |
|---|---|
| First VAPT (2026-10-15): access 467, auth 102, input 67, infra | `docs/security/evidence/access/tests.csv`, `docs/security/evidence/auth/tests.csv`, `docs/security/evidence/input/tests.csv`, `docs/security/evidence/infra/static_route_traversal_and_startup.txt` |
| Closure retest 1 (137 cases: 133 PASS, 1 FAIL now fixed, 2 PARTIAL, 1 OBS) | `docs/security/evidence/closure/retest1/RETEST1.md`, `docs/security/evidence/closure/retest1/tests.csv`, raw `docs/security/evidence/closure/retest1/raw/`, scripts `docs/security/evidence/closure/retest1/scripts/` |
| Closure retest 2 on the final code (access 319, infra 122, sessions + burst 56) | `docs/security/evidence/closure/retest2/access/RETEST2_ACCESS.md`, `docs/security/evidence/closure/retest2/infra/RETEST2_INFRA.md`, `docs/security/evidence/closure/retest2/infra/tests.csv`, `docs/security/evidence/closure/retest2/sessions/RETEST2_SESSIONS.md`, `docs/security/evidence/closure/retest2/sessions/concurrency_results.md` |
| Fixes for retest-2 findings (WP-F, WP-F2) | `docs/security/evidence/closure/wpf/WPF_RESULTS.md`, `docs/security/evidence/closure/wpf/WPF2_RESULTS.md`, `docs/security/evidence/closure/wpf/wpf_01_if01_if02_repro_BEFORE_head734fd19.out.txt`, `docs/security/evidence/closure/wpf/wpf_02_if01_if02_AFTER_wpf.out.txt`, `docs/security/evidence/closure/wpf/wpf_04_check_nginx_live.out.txt` |
| Native Windows IF-01 test (fake canaries: old code 10 of 28 leaks; fixed code 0 of 28; QR deep link 200) | `docs/security/evidence/closure/windows/native_windows_old_release_4ba4e94.txt`, `docs/security/evidence/closure/windows/native_windows_fixed_release_7b039fb.txt`, `docs/security/evidence/closure/windows/native_windows_final_release_fafa225.txt`, `docs/security/evidence/closure/windows/attack.mjs` |
| Findings and statuses | `docs/security/CKAM_SECURITY_CLOSURE_REGISTER.md` (closure), `docs/security/CKAM_SECURITY_FINDINGS_REGISTER.md` (first programme); summary `docs/security/CKAM_ISO27001_READINESS.md` section 6 |
| Independent (external) VAPT | **NOT EVIDENCED** (EXT-14) |

## 12. Git and change management

| Evidence | Path / source |
|---|---|
| Rules | `CLAUDE.md`, `docs/ai/DEVELOPMENT_GUARDRAILS.md`, `docs/security/CKAM_SECURITY_BASELINE.md` |
| Security commits (local, not pushed) | `git log c66378d..fd34520` (22 commits: `4ba4e94` + 21 security commits `3e134c1` … `fd34520`) |
| Deploy steps | `docs/ai/PRODUCTION_INFRASTRUCTURE.md`; prepared security deploy `docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` (not executed) |
| Windows reference scripts (IF-15 reference side) | `ops/windows/README.md`, `ops/windows/run_ckam_web.ps1.template`, `ops/windows/deploy_ckam.ps1.template`, `ops/windows/rollback_release.ps1.template`, `ops/windows/verify_release.ps1`; validation `docs/security/evidence/closure/infra/raw/windows/` (`parse_check.ps1`, `dryrun.ps1`, `dryrun.out.txt`, `verify_*.txt`) |
| Change-record form (DRAFT) | `docs/security/policies/04_Change_Management_Procedure.md`, `docs/security/policies/templates/change_record.md` |
| Change records | **NOT EVIDENCED** (EXT-35, EXT-42) |
| CI runs | **NOT EVIDENCED** (IF-17; EXT-28) |
| Live production launcher | **NOT EVIDENCED in git** (EXT-13) |

## 13. UAT and regression

| Evidence | Path |
|---|---|
| Route-by-route matrix; final UAT | `docs/ai/UAT_MATRIX.md`, `docs/ai/CKAM_FINAL_UAT.md` |
| E2E specs (12 specs + `fixtures.ts`, incl. `security.spec.ts`) | `frontend/e2e/` |
| Final local regression at `fd34520` | Backend 2541 passed, 1 skipped; frontend `tsc` clean, vitest 1257 passed in 92 files, `npm run build` and `npm run check:build` OK; Playwright 11 passed, 1 skipped; security journeys 14/14 (lead's fact sheet; per-run output is not stored as a file, see EXT-28) |
| Performance before/after (31 operations, none over threshold) | `docs/security/evidence/closure/perf/PERF_REPORT.md`, raw `docs/security/evidence/closure/perf/raw/`, scripts `docs/security/evidence/closure/perf/scripts/` |

## 14. Backups documentation

| Evidence | Path / source |
|---|---|
| Production backup task and location | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` |
| Plan and DRAFT policy | `docs/security/CKAM_BACKUP_RESTORE_PLAN.md`; `docs/security/policies/07_Backup_Restore_Policy.md`, `docs/security/policies/templates/restore_test_record.md` |
| Dev backup / restore scripts | `ops/backup.sh`, `ops/restore.sh`, `ops/test_backup_restore.sh` (destructive; dev only) |
| Production backup log | **TO BE GENERATED**: copy of `backup.log` on 10.0.0.205 for the period |
| Off-server copy, NAS document backup, production restore test | **NOT EVIDENCED** (IF-08; EXT-08) |

## 15. ERP read-only proof

| Evidence | Path |
|---|---|
| Read-only connection, timeouts, TLS settings | `backend/app/erp/source.py`; `backend/tests/erp/test_vapt_erp_limits.py`; `backend/tests/erp/test_erp_tls_settings.py` |
| Warehouse reader and sync (SELECT only) | `backend/app/erp/warehouse.py`, `backend/app/erp/sync.py` |
| ERP-side SELECT-only grant, role-level read-only, TLS | **TO BE GENERATED** by the ERP warehouse owner (EXT-25) |

## 16. Database migrations

| Evidence | Path |
|---|---|
| Migration chain (43 committed revisions at `fd34520`, single head `c6e8a0b2d4f6`; programme added `f9a1c3e5b7d2`, `a3c5e7f9b1d4`, `b5d7f9a1c3e5`, `c6e8a0b2d4f6`) | `backend/app/alembic/versions/`, `backend/alembic.ini` |
| Rule: no schema change without a migration | `CLAUDE.md` rule 3 |
| Production schema version | **TO BE GENERATED**: `alembic current` at deploy (expected `c6e8a0b2d4f6`) |

## 17. Release identification

| Evidence | Path / source |
|---|---|
| Version resolution and `app_started` event | `backend/app/observability/system.py`, `backend/app/observability/diagnostics.py` |
| Live release | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (live `3b5e842`) |
| Production start events | **TO BE GENERATED**: `GET /api/admin/logs/system?component=startup` |

## 18. Incident reporting

| Evidence | Path |
|---|---|
| Report a problem (server and browser) | `backend/app/observability/client_reports.py`, `frontend/src/features/support/report-problem-store.ts` |
| DRAFT incident plan and record form | `docs/security/policies/05_Incident_Response_Plan.md`, `docs/security/policies/templates/incident_record.md` |
| IF-01 compromise-assessment procedure (prepared) | `docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` phase 13 |
| Incident records | **NOT EVIDENCED** (EXT-20, EXT-03) |

## 19. User access

| Evidence | Path / source |
|---|---|
| User management API | `backend/app/asset_users/router.py` |
| DRAFT access review procedure and form; JML procedure and form | `docs/security/policies/11_Periodic_Access_Review_Procedure.md`, `docs/security/policies/templates/access_review_record.md`, `docs/security/policies/03_Joiner_Mover_Leaver_Procedure.md`, `docs/security/policies/templates/joiner_mover_leaver_record.md` |
| User list; access changes; failed sign-ins; rate-limit refusals; refresh reuse | **TO BE GENERATED** from production: `GET /api/asset-users/export`; `GET /api/admin/logs/audit?category=security&action=ACCESS_CHANGED` (and `LOGIN_FAILED`, `LOCKED`, after deploy also `RATE_LIMITED`, `REFRESH_REUSE`, `REFRESH_DUPLICATE`) |
| Signed access reviews; server / DB administrator list | **NOT EVIDENCED** (EXT-18) |

## 20. Security tests in the permanent suite

| Evidence | Path |
|---|---|
| Static route and path handling (IF-01, IF-01-WIN lexical refusal, CL2-IF-04 deep links) | `backend/tests/test_static_frontend.py`, `backend/tests/test_static_frontend_windows.py`, `backend/tests/test_static_frontend_spa_assets.py` |
| Headers, docs, JSON 404 | `backend/tests/test_vapt_headers_and_docs.py` |
| Forwarded-for handling (N2) | `backend/tests/core/test_n2_forwarded_for.py` |
| Request-size limits (N1) | `backend/app/core/body_limit.py`, `backend/tests/core/test_body_limit.py` |
| Import size limit (IN-02) | `backend/tests/imports/test_upload_size_limit.py` |
| Concurrency / unique names (RACE-1, CL2-SE-N01, CL2-SE-N03) | `backend/tests/core/test_security_concurrency.py`, `backend/tests/masters/test_import_duplicate_names.py`, `backend/tests/masters/test_wpf2_category_names.py`, `backend/tests/core/test_wpf2_serial_race_message.py` |
| Document content check (IN-03) | `backend/tests/documents/test_vapt_content_check.py` |
| ERP limits and TLS | `backend/tests/erp/test_vapt_erp_limits.py`, `backend/tests/erp/test_erp_tls_settings.py` |
| Database least privilege | `backend/tests/security/test_least_privilege_role_split.py` |
| Build and nginx security checks | `frontend/scripts/check-build-security.mjs`, `frontend/scripts/check-build-security.test.mjs`, `frontend/scripts/check-nginx-live.mjs`, `frontend/src/security/nginx-config.test.ts` |
| Self-hosted fonts | `frontend/src/fonts.css`; `docs/security/evidence/closure/retest2/infra/raw/fonts_csp_playwright_summary.txt`; screenshots before/after in `docs/security/evidence/closure/infra/raw/fonts/` |
| Browser security journeys | `frontend/e2e/security.spec.ts` |
| Test files added by the programme (all present) | backend: `tests/auth/test_jwt_algorithm_pinned.py`, `test_login_primary_owner_clash.py`, `test_rate_limit.py`, `test_vapt_login.py`, `test_vapt_password_policy.py`, `test_vapt_sessions.py`, `test_wpa2_refresh_reuse.py`, `test_wpa2_token_version_atomic.py`; `tests/core/test_body_limit.py`, `test_n2_forwarded_for.py`, `test_production_secret_guard.py`, `test_security_concurrency.py`, `test_security_read_scope.py`, `test_wpf2_serial_race_message.py`; `tests/documents/test_vapt_content_check.py`; `tests/erp/test_erp_tls_settings.py`, `test_vapt_erp_limits.py`; `tests/imports/test_upload_size_limit.py`; `tests/lifecycle/fixture_marker.py`, `test_obs_status_guard.py`; `tests/masters/test_import_duplicate_names.py`, `test_wpf2_category_names.py`; `tests/observability/test_log_write_failure_reporting.py`, `test_vapt_append_only.py`; `tests/security/test_least_privilege_role_split.py`; `tests/test_static_frontend_spa_assets.py`, `test_static_frontend_windows.py`, `test_vapt_headers_and_docs.py` (all under `backend/`). Frontend: `frontend/e2e/security.spec.ts`, `frontend/scripts/check-build-security.test.mjs`, `frontend/src/lib/auth-session.test.ts`, `frontend/src/security/nginx-config.test.ts` |
| Test run output for a release | **TO BE GENERATED** per change (EXT-35 / EXT-28) |

## 21. Closure programme evidence folders (2026-10-16)

| Folder | What it holds | Key files |
|---|---|---|
| `docs/security/evidence/closure/backend/` | WP-A1 / WP-A2 results (Windows-path guard, JSON 404, ERP TLS, environment default, refresh reuse, atomic session version), dependency re-check, AU-04 options | `WPA1_RESULTS.md`, `WPA2_RESULTS.md`, `dependency_recheck.md`, `AU-04_OPTIONS.md`, `raw/repro_before_after.txt` |
| `docs/security/evidence/closure/db/` | WP-B: role split simulation on a disposable DB (owner / migrator / runtime), can/cannot matrix, downgrade/upgrade cycle, dev-stack check | `WPB_RESULTS.md`, `rs_01_setup_presplit.out.txt` … `rs_08_dev_stack_check.out.txt`, `rs_sim.sh`, `rs_runtime_matrix.sql` |
| `docs/security/evidence/closure/infra/` | WP-C: fonts, non-root containers, N3, Windows reference-script validation, npm re-check, IF-09 ACL plan | `WP-C_closure_evidence.md`, `npm_audit_recheck.md`, `IF-09_ACL_PLAN.md`, `raw/fonts/`, `raw/docker/`, `raw/windows/` |
| `docs/security/evidence/closure/retest1/` | First closure re-attack (137 cases) | `RETEST1.md`, `tests.csv`, `raw/`, `scripts/` |
| `docs/security/evidence/closure/retest2/access/` | Second retest, access (319 cases; 3,038 cells) | `RETEST2_ACCESS.md`, `authz_matrix.csv`, `tests.csv`, `raw/` |
| `docs/security/evidence/closure/retest2/infra/` | Second retest, infrastructure (122 cases; DB break-out attempts, headers, IF-13, secret scan, JWT probe) | `RETEST2_INFRA.md`, `tests.csv`, `raw/`, `scripts/` |
| `docs/security/evidence/closure/retest2/sessions/` | Second retest, sessions + external concurrency burst (56 cases) | `RETEST2_SESSIONS.md`, `concurrency_results.md`, `tests.csv`, `raw/` |
| `docs/security/evidence/closure/perf/` | Performance before (`4ba4e94`) / after on identical data | `PERF_REPORT.md`, `raw/`, `scripts/` |
| `docs/security/evidence/closure/windows/` | Native Windows IF-01 runs with fake canaries | three `native_windows_*.txt`, `attack.mjs` |
| `docs/security/evidence/closure/wpf/` | WP-F / WP-F2 fixes for retest-2 findings | `WPF_RESULTS.md`, `WPF2_RESULTS.md`, `wpf_01` … `wpf_04` outputs, `scripts/` |
| `docs/security/evidence/closure/docs/` | Documentation work-package indexes and the SoA generator | `INDEX.md`, `WPD2_INDEX.md`, `make_soa.mjs` |

## 22. Operations scripts (`ops/`)

| Folder | Files | Status |
|---|---|---|
| `ops/db/` | `role_split.sql`, `role_split_verify.sql`, `check_least_privilege.sql`, `ROLE_SPLIT_RUNBOOK.md` | Proven on a disposable DB; **never run on 10.0.0.205** (EXT-07, EXT-45, EXT-46) |
| `ops/windows/` | `README.md`, `run_ckam_web.ps1.template`, `deploy_ckam.ps1.template`, `rollback_release.ps1.template`, `verify_release.ps1` | Secret-free reference; parser and `-WhatIf` validated; **never run on 10.0.1.98** (EXT-13, EXT-38) |
| `ops/` (dev) | `backup.sh`, `restore.sh`, `test_backup_restore.sh`, `init-test-db.sql` | Dev only |

## 23. Policies and decisions (DRAFT — MANAGEMENT APPROVAL REQUIRED)

| Evidence | Path | Status |
|---|---|---|
| Policy pack index | `docs/security/policies/README.md` | 15 documents, 0 approved, 0 operating, 0 records |
| Policies 01–15 | `docs/security/policies/01_Information_Security_Policy.md` … `docs/security/policies/15_Statement_of_Applicability_Working_Draft.md` | DRAFT; not evidence of operation |
| Record forms | `docs/security/policies/templates/` (`access_review_record.md`, `change_record.md`, `incident_record.md`, `joiner_mover_leaver_record.md`, `restore_test_record.md`, `vulnerability_triage_record.md`) | Blank |
| Owner decisions needed | `docs/security/CKAM_SECURITY_DECISIONS_REQUIRED.md` (SD-01 … SD-16) | Open |
| Prepared production procedures | `docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`, `docs/security/CKAM_HTTPS_IMPLEMENTATION_PLAN.md`, `docs/security/CKAM_SERVICE_ACCOUNT_PLAN.md`, `docs/security/CKAM_BACKUP_RESTORE_PLAN.md` | Prepared, NOT executed |

None of the closure controls runs in production yet: production evidence for them is **TO BE GENERATED**
after EXT-01 (runbook phase 7 probe results, `alembic current`, headers, QR deep link, least-privilege check).

---

## Readiness documents (this set)

`docs/security/CKAM_ISO27001_READINESS.md`, `docs/security/CKAM_ISO27001_CONTROL_MATRIX.csv` / `.xlsx`,
`docs/security/CKAM_SOC2_READINESS.md`, `docs/security/CKAM_SOC2_CONTROL_MATRIX.csv` / `.xlsx`,
`docs/security/CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `docs/security/CKAM_SECURITY_BASELINE.md`,
`docs/security/CKAM_THREAT_MODEL.md`, `docs/security/CKAM_SECURITY_EVIDENCE_INDEX.md`.

## Change history

| Date | Change |
|---|---|
| 2026-10-15 | First index (HEAD `d04779a`); reports then marked "being written" |
| 2026-10-16 | WP-M2b: closure folders, `ops/db`, `ops/windows`, new tests, policies and plans added; "being written" notes removed (the reports exist); production-only evidence still TO BE GENERATED |
