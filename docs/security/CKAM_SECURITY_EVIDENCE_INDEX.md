# CKAM Security Evidence Index

| | |
|---|---|
| Date | 2026-10-15 (FINAL state after remediation and retest) |
| Baseline | Repository HEAD `d04779a` (worktree `ckam-build`); 8 local security commits, none pushed or deployed |
| Reports (separate writer) | `docs/security/CKAM_VAPT_REPORT.md`, `docs/security/CKAM_SECURITY_FINDINGS_REGISTER.md`, `docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md` — the findings register exists; the VAPT and remediation reports were still being written when this index was last checked (2026-10-15) |
| Rule | Every path below was checked to exist on 2026-10-15. Evidence that does not exist yet is marked **TO BE GENERATED** with the command or screen that produces it, or **NOT EVIDENCED** |

All repository paths are relative to the repository root. Server paths are on the machines named in
`docs/ai/PRODUCTION_INFRASTRUCTURE.md`. Never copy secret values into this folder; for secrets, evidence is a
dated note of *that* a rotation or check happened, never the value.

The folder `docs/security/evidence/` holds the VAPT artefacts of 2026-10-15 in four parts: `access/`, `auth/`,
`input/`, `infra/` (with `infra/raw/` and `infra/sql/`).

---

## 1. Architecture

| Evidence | Path |
|---|---|
| Production layout (servers, folders, task, DB, NAS, backups, URL) | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` |
| Product architecture | `docs/ai/CKAM_CURRENT_PRODUCT_ARCHITECTURE_2026.md`, `docs/ai/PRODUCT_CONTEXT.md` |
| Original design | `docs/specs/2026-09-23-ckam-design.md` |
| Threat model, trust boundaries, attack surface | `docs/security/CKAM_THREAT_MODEL.md` |
| Dev stack definition | `docker-compose.yml`, `frontend/nginx.conf` (dev only; production has no nginx) |
| App entry point, security headers, static routes | `backend/app/main.py` |
| Settings and defaults | `backend/app/core/config.py`, `.env.example` |

## 2. Data flow

| Evidence | Path |
|---|---|
| Data-flow diagram | `docs/security/CKAM_THREAT_MODEL.md` section 4 |
| ERP flow (warehouse → local copy → screens) | `docs/ai/ERP_INTEGRATION.md` |
| Logging flow (request id → audit/error/system/files) | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |

## 3. RBAC (role-based access control)

| Evidence | Path |
|---|---|
| Single source of create/manage decisions | `backend/app/core/capabilities.py` |
| Role guards and scoping helpers | `backend/app/core/deps.py` |
| Authorization matrix: 217 routes x 11 personas | `docs/security/evidence/access/authz_matrix.csv`, `docs/security/evidence/access/matrix_raw.csv` |
| Original test cases (467: 451 pass, 15 fail — AC-1, AC-2 — now FIXED and retested, 1 n/a) | `docs/security/evidence/access/tests.csv` |
| Escalation / mass-assignment results (0 escalation) | `docs/security/evidence/access/phaseB_escalation.json`, `docs/security/evidence/access/phaseB_escalation.mjs` |
| Business-logic / idempotency results | `docs/security/evidence/access/phaseB_logic.json`, `docs/security/evidence/access/phaseB_logic.mjs` |
| Test harness | `docs/security/evidence/access/lib.mjs`, `matrix.mjs`, `analyze.mjs`, `make_tests_csv.mjs`; route list `openapi.json` |
| RBAC rebuild record | `docs/ai/ASSET_USER_RBAC_REBUILD_REPORT.md` |
| Permission decisions | `docs/ai/DECISIONS.md` (2026-10-14 entries 3, 4, 8) |

## 4. Company and work-area segregation

| Evidence | Path |
|---|---|
| IDOR / BOLA cases (208) | `docs/security/evidence/access/phaseB_results.json`, `docs/security/evidence/access/phaseB_idor.mjs` |
| Self-service and cross-company findings (AC-1, AC-2) | `docs/security/evidence/access/findings.csv`, `docs/security/evidence/access/self_service_masters.txt` |
| ERP draft cross-company (IF-03) | `docs/security/evidence/infra/erp_cross_company_draft.txt`, `docs/security/evidence/infra/raw/erp_draft_probe.mjs` |
| Cross-company document download 404 | `docs/security/evidence/input/tests.csv` (IN-T050, IN-T052) |
| Read-scope regression tests | `backend/tests/core/test_security_read_scope.py`, `backend/tests/core/test_s0_work_area.py` |
| E2E scoping journeys | `frontend/e2e/add-asset-company-scoping.spec.ts`, `frontend/e2e/rbac-responsibility-journey.spec.ts` |

## 5. Password security

| Evidence | Path |
|---|---|
| Hashing (Argon2id), JWT creation/verification (HS256 pinned) | `backend/app/core/security.py` |
| Password length rules | `backend/app/auth/schemas.py` |
| Login, lockout, refresh, logout | `backend/app/auth/router.py` |
| Test cases AU-T044..AU-T050 (argon2id, no plaintext anywhere, temp password once) | `docs/security/evidence/auth/tests.csv`, `docs/security/evidence/auth/checks.sql` |
| Regression tests | `backend/tests/auth/test_security.py`, `backend/tests/auth/test_must_change_password.py`, `backend/tests/auth/test_login.py`, `backend/tests/auth/test_login_primary_owner_clash.py` |
| Password policy (AU-08) | `backend/app/auth/password_policy.py`, `backend/tests/auth/test_vapt_password_policy.py` |
| Sign-in timing and rate limit (AU-01, AU-03, AU-16; 429) | `backend/app/core/rate_limit.py`, `backend/tests/auth/test_rate_limit.py`, `backend/tests/auth/test_vapt_login.py` |
| Session revocation (`token_version`; AU-05, AU-06, AU-07) | `backend/tests/auth/test_vapt_sessions.py`, migration `backend/app/alembic/versions/f9a1c3e5b7d2_asset_user_token_version.py`, `frontend/src/lib/auth-session.test.ts` |
| Placeholder JWT secret guard | `backend/tests/core/test_production_secret_guard.py`, `backend/tests/core/test_jwt_secret_warning.py`; `docs/security/evidence/infra/static_route_traversal_and_startup.txt` section D |

## 6. Audit trail

| Evidence | Path |
|---|---|
| Design, categories, actions, redaction, retention | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| Automatic audit (`SPECS`) and writer | `backend/app/observability/audit.py`, `backend/app/observability/writer.py`, `backend/app/observability/events.py` |
| Write-route coverage (122: 107 audited, 15 intentionally not, 0 forgotten) | `docs/security/evidence/auth/audit_coverage.csv`, `docs/security/evidence/auth/write_routes.txt`, `docs/security/evidence/auth/audit_check.sql` |
| Coverage test that fails on any unclassified write route | `backend/tests/observability/test_coverage_walker.py` |
| Audit behaviour tests | `backend/tests/observability/test_auto_audit.py`, `backend/tests/observability/test_security_events.py`, `backend/tests/observability/test_bulk_summaries.py` |
| Append-only triggers and privilege tests | `docs/security/evidence/infra/db_02_triggers_constraints.out.txt`, `docs/security/evidence/infra/db_03_append_only_privilege_tests.out.txt`, `docs/security/evidence/infra/db_04_least_priv_flag_bypass.out.txt`, SQL in `docs/security/evidence/infra/sql/` |
| Append-only / retention tests | `backend/tests/observability/test_retention_and_append_only.py`, `backend/tests/observability/test_vapt_append_only.py` |
| TRUNCATE guards and 5-year audit purge floor (IF-05/IF-06 MITIGATED) | `backend/app/alembic/versions/a3c5e7f9b1d4_append_only_truncate_and_purge_floor.py` |
| Audit-table migration | `backend/app/alembic/versions/e6f8a0b2c4d6_logging_tables.py` |
| Production audit export | **TO BE GENERATED**: head-office admin, `GET /api/admin/logs/export?kind=audit&from=<date>&to=<date>&format=csv` |

## 7. Lifecycle history

| Evidence | Path |
|---|---|
| Single writer of status / holder / status_since | `backend/app/lifecycle/service.py` |
| `asset_event` / `asset_field_change` append-only, `asset_code` immutable | `docs/security/evidence/infra/db_02_triggers_constraints.out.txt`; `docs/security/evidence/auth/tests.csv` AU-T093 |
| Integrity checks | `docs/security/evidence/infra/sql/db_05_data_integrity.sql`, `docs/security/evidence/infra/db_05_data_integrity.out.txt`, `docs/security/evidence/access/integrity.sql` |
| Original data-integrity design | `docs/ai/AM-01_DATA_INTEGRITY_REPORT.md` |
| E2E lifecycle | `frontend/e2e/asset-lifecycle.spec.ts`, `frontend/e2e/asset-correction.spec.ts` |

## 8. Logs

| Evidence | Path |
|---|---|
| Log design and settings | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` sections 2, 5 |
| File logging, request id middleware, redaction | `backend/app/observability/filelog.py`, `backend/app/observability/middleware.py`, `backend/app/observability/redact.py` |
| Tests | `backend/tests/observability/test_file_logs.py`, `test_request_id.py`, `test_error_logging.py`, `test_redaction.py`, `test_system_events.py` |
| Log-injection tests | `docs/security/evidence/auth/tests.csv` AU-T086..AU-T088 |
| Production log files | Server: `D:\Citykart_Applications\Citykart_AssetManagement_App\logs\app\` (`app.jsonl`, `error.jsonl`, `audit.jsonl`) — **TO BE GENERATED** as evidence: a dated extract for the review period |
| PostgreSQL server logging (production) | **NOT EVIDENCED** (settings not yet applied on 10.0.0.205; EXT-27) |

## 9. Diagnostics

| Evidence | Path |
|---|---|
| Diagnostics and health (version, migrations, ERP copy, DB) | `backend/app/observability/diagnostics.py`, `backend/app/observability/system.py` |
| Admin logs API | `backend/app/observability/admin_router.py`, `backend/tests/observability/test_admin_api.py` |
| Bundle contains no secrets | `docs/security/evidence/auth/tests.csv` AU-T089, AU-T090 |
| Stage report | `docs/ai/CKAM_SIMPLIFICATION_S8_REPORT.md` |
| Production health snapshot | **TO BE GENERATED**: head-office admin, `GET /api/admin/diagnostics/health` and `GET /api/admin/diagnostics/db` (save JSON with date) |

## 10. Dependency scans

| Evidence | Path |
|---|---|
| Summary (note: Python table ends part-way; raw file complete) | `docs/security/evidence/infra/dependency_audit.md` |
| npm production (0 vulnerabilities) and all | `docs/security/evidence/infra/raw/npm_audit_prod.json`, `docs/security/evidence/infra/raw/npm_audit_all.json` |
| Python advisories and exact versions (dev image) | `docs/security/evidence/infra/raw/pip_audit.json`, `docs/security/evidence/infra/raw/pip_freeze_image.txt` |
| Manifests | `frontend/package-lock.json`, `backend/pyproject.toml`, `backend/constraints.txt` (IF-11) |
| Production Python versions | **TO BE GENERATED**: on 10.0.1.98, `shared\venv\Scripts\python.exe -m pip freeze` saved per release |

## 11. VAPT results (2026-10-15, internal)

| Area | Path |
|---|---|
| Access control (467 cases) | `docs/security/evidence/access/tests.csv` |
| Authentication and sessions (102 cases: 68 pass, 25 fail, 9 info) | `docs/security/evidence/auth/tests.csv`; scripts `docs/security/evidence/auth/t1_auth.sh` … `t10_val_authz.sh`; `craft.py`, `crafted.txt`, `routes.py`; timing samples `t_existing.txt`, `t_nonexist.txt`, `t_locked.txt`, `t_disabled.txt`; `race_codes.txt`; `err_check.sql` |
| Input handling (67 cases: 59 pass, 2 fail, 4 info, 2 n/a) | `docs/security/evidence/input/tests.csv`, `raw_sql_review.md`, `api_battery.mjs`, `api_battery2.mjs`, `battery_results.json`, `battery2_results.json`, `plant_xss.mjs`, `xss_playwright.mjs`, `xss_results.json`, `formula_export_cell.txt`, `traversal_3411.txt` |
| Infrastructure | `docs/security/evidence/infra/static_route_traversal_and_startup.txt`, `docs/security/evidence/infra/raw/probe_dist.py`, `db_01_roles_privileges.out.txt` … `db_05_data_integrity.out.txt`, `erp_cross_company_draft.txt` |
| Findings and statuses | Authoritative: `docs/security/CKAM_SECURITY_FINDINGS_REGISTER.md` (being written); summary: `docs/security/CKAM_ISO27001_READINESS.md` section 6 |
| Test report and remediation/retest | `docs/security/CKAM_VAPT_REPORT.md`, `docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md` (being written) |
| Final retest | 646 + 310 retest cases, 0 original findings left unretested; access matrix 217 routes x 11 personas, zero escalation (figures from the security lead; detail in the reports above) |
| Independent (external) VAPT | **NOT EVIDENCED** (EXT-14) |

## 12. Git and change management

| Evidence | Path / source |
|---|---|
| Rules (test before commit, push only when told, deploy only on request) | `CLAUDE.md`, `docs/ai/DEVELOPMENT_GUARDRAILS.md` (security rules added in `da790d1`) |
| Security remediation commits (local, not pushed) | `git log 3e134c1^..d04779a` — `3e134c1`, `7e57844`, `ba04371`, `77431ba`, `4fa5c9b`, `ae706bb`, `da790d1`, `d04779a` |
| Deploy steps and release notes | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` ("Deploying a new version", "Deploy notes added 2026-10-14") |
| Release manifest / runbook (Docker-based, out of date for production: IF-15) | `docs/ai/CKAM_RELEASE_MANIFEST.md`, `docs/ai/CKAM_RELEASE_RUNBOOK.md` |
| Commit history | **TO BE GENERATED**: `git log --format="%h %ad %an %s" --date=iso` for the period |
| Change records (request, approver, tests, rollback, result) | **NOT EVIDENCED** (EXT-35) |
| CI runs | **NOT EVIDENCED** (no CI, IF-17; EXT-28) |
| Production launcher / release script | **NOT EVIDENCED in git** (on server only, IF-15; EXT-13) |

## 13. UAT

| Evidence | Path |
|---|---|
| Route-by-route matrix | `docs/ai/UAT_MATRIX.md` |
| Final UAT and retest | `docs/ai/CKAM_FINAL_UAT.md`, `docs/ai/CKAM_SIMPLIFICATION_S7_RETEST_REPORT.md` |
| Workflow acceptance | `docs/ai/AM-17_WORKFLOW_ACCEPTANCE_MATRIX.md` |
| E2E specs | `frontend/e2e/` (13 specs incl. `security.spec.ts`, + `fixtures.ts`); final run: security journeys 14/14 and 11 permanent journeys passed, 1 skipped (ERP link intentionally off on the test stack) |
| Unit/integration totals (final) | Backend about 1,783 tests (final run number to be given by the lead); frontend 1,239 tests in 90 files |

## 14. Backups documentation

| Evidence | Path / source |
|---|---|
| Production backup task and location | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (Backups row) |
| Dev backup / restore scripts | `ops/backup.sh`, `ops/restore.sh`, `ops/test_backup_restore.sh` (destructive; dev only) |
| Restore procedure and dev drill | `docs/deployment.md`, `docs/ai/CKAM_RELEASE_RUNBOOK.md` section 12, `docs/ai/AM-09_RC_FULL_AUDIT_REPORT.md` |
| Production backup log | **TO BE GENERATED**: copy of `backup.log` from `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP` on 10.0.0.205 for the period |
| Off-server copy, NAS document backup, production restore test | **NOT EVIDENCED** (IF-08; EXT-08) |

## 15. ERP read-only proof

| Evidence | Path |
|---|---|
| Connection opened with `default_transaction_read_only` | `backend/app/erp/source.py` |
| Warehouse reader and sync (SELECT only) | `backend/app/erp/warehouse.py`, `backend/app/erp/sync.py`, `backend/app/erp/local_source.py` |
| Design and role `ckpost` (read-only) | `docs/ai/ERP_INTEGRATION.md` |
| No outbound HTTP / SSRF sinks | `docs/security/evidence/input/raw_sql_review.md` section 2 |
| ERP-side SELECT-only grant and role-level read-only setting | **TO BE GENERATED** by the ERP warehouse owner: grant listing for role `ckpost` on 10.0.1.69 (EXT-25) |

## 16. Database migrations

| Evidence | Path |
|---|---|
| Migration chain (41 committed revisions at HEAD `d04779a`, single head; newest `f9a1c3e5b7d2`, `a3c5e7f9b1d4`) | `backend/app/alembic/versions/`, `backend/alembic.ini` |
| Rule: no schema change without a migration | `CLAUDE.md` rule 3 |
| Production schema version | **TO BE GENERATED**: `alembic current` at deploy, or `GET /api/admin/diagnostics/health` → `migrations` |

## 17. Release identification

| Evidence | Path / source |
|---|---|
| Version resolution (`APP_VERSION` → `GIT_COMMIT` → `VERSION` file) and `app_started` event | `backend/app/observability/system.py` |
| Version in health and bundle | `backend/app/observability/diagnostics.py` |
| Live release and rollback folders | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (live `3b5e842`) |
| Production start events | **TO BE GENERATED**: `GET /api/admin/logs/system?component=startup` |

## 18. Incident reporting (Report a problem / client reports)

| Evidence | Path |
|---|---|
| Server side (rate limit, de-duplication, admin-only listing) | `backend/app/observability/client_reports.py`, `backend/tests/observability/test_client_reports.py` |
| Browser side (reference ids, Report a problem) | `frontend/src/features/support/report-problem-store.ts`, `frontend/src/components/shared/ErrorMessage.tsx` |
| Support workflow | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` sections 1 and 10 |
| Tests | `docs/security/evidence/auth/tests.csv` AU-T098..AU-T101 |
| Incident response plan and incident records | **NOT EVIDENCED** (EXT-20) |

## 19. User access

| Evidence | Path / source |
|---|---|
| User management API (create, reset, issue passwords, company access, head-office admin) | `backend/app/asset_users/router.py` |
| Access-change audit rows | `docs/security/evidence/auth/audit_coverage.csv` |
| User and role list | **TO BE GENERATED**: Full Admin or head-office admin, `GET /api/asset-users/export` |
| Access changes for the period | **TO BE GENERATED**: `GET /api/admin/logs/audit?category=security&action=ACCESS_CHANGED` (and `PRIMARY_OWNER_GRANTED`, `PASSWORD_RESET`) |
| Failed sign-ins and lockouts | **TO BE GENERATED**: `GET /api/admin/logs/audit?category=security&action=LOGIN_FAILED` (and `LOCKED`) |
| Signed access reviews | **NOT EVIDENCED** (EXT-18) |
| Server / DB administrator list | **NOT EVIDENCED** |

## 20. Security test results (automated, in the suite)

| Evidence | Path |
|---|---|
| Static-frontend route tests (incl. path handling) | `backend/tests/test_static_frontend.py` |
| Security and scope tests | `backend/tests/auth/test_security.py`, `backend/tests/core/test_security_read_scope.py`, `backend/tests/core/test_deps.py`, `backend/tests/core/test_db_safety.py` |
| Idempotency | `backend/tests/core/test_s7_idempotency.py` |
| Concurrency / same-name race (RACE-1) | `backend/tests/core/test_security_concurrency.py` |
| Document upload/download, file-signature check (IN-03) | `backend/tests/documents/test_router.py`, `backend/tests/documents/test_vapt_content_check.py` |
| Request-size limits (N1: 413 at 64 KB sign-in, 5 MB JSON, 16 MB uploads) | `backend/app/core/body_limit.py`, `backend/tests/core/test_body_limit.py` |
| Weak-secret refusal and environment default (IF-04, N4) | `backend/tests/core/test_production_secret_guard.py` |
| CSP, Permissions-Policy, docs off in production (AU-11, AU-14, IF-14) | `backend/tests/test_vapt_headers_and_docs.py`, `frontend/nginx.conf` (dev) |
| No source maps (AU-12) | `frontend/vite.config.ts` |
| ERP read-only and timeouts (IF-10) | `backend/tests/erp/test_vapt_erp_limits.py` |
| Security browser journeys | `frontend/e2e/security.spec.ts` |
| Test run output for a release | **TO BE GENERATED** per change (EXT-35 / EXT-28) |

All remediation files listed above are **committed** (local commits `3e134c1` … `d04779a`) and retested. None
of them runs in production yet: production evidence for these controls is **TO BE GENERATED** after EXT-01
(post-deploy probe of `/assets` traversal, `/docs`, response headers, `alembic current`).

---

## Readiness documents (this set)

`docs/security/CKAM_ISO27001_READINESS.md`, `docs/security/CKAM_ISO27001_CONTROL_MATRIX.csv` / `.xlsx`,
`docs/security/CKAM_SOC2_READINESS.md`, `docs/security/CKAM_SOC2_CONTROL_MATRIX.csv` / `.xlsx`,
`docs/security/CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `docs/security/CKAM_SECURITY_BASELINE.md`,
`docs/security/CKAM_THREAT_MODEL.md`, `docs/security/CKAM_SECURITY_EVIDENCE_INDEX.md`.
