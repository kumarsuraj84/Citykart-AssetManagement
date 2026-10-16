# CKAM: SOC 2 Readiness Assessment

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Document | Readiness assessment, version 1.1 (security closure state). Version 1.0 of 2026-10-15 is kept as history in section 12 |
| Date | 2026-10-16 (v1.1, WP-M2b); v1.0 2026-10-15 |
| Evidence cut-off | Local HEAD `fd34520`: 21 local security commits (`3e134c1` … `fd34520`) on top of `4ba4e94`; **none pushed, none deployed**; production still runs `3b5e842` (Alembic `e6f8a0b2c4d6`; code head `c6e8a0b2d4f6`) |
| Authoritative status source | The lead's fact sheet of 2026-10-16 (wins over older documents) |
| Framework | AICPA Trust Services Criteria (Security / Common Criteria CC1-CC9, Availability, Confidentiality, Processing Integrity, Privacy) |
| Companion files | `CKAM_SOC2_CONTROL_MATRIX.csv` / `.xlsx` (75 controls), `CKAM_ISO27001_READINESS.md` (findings and the 40-risk register), `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_SECURITY_EVIDENCE_INDEX.md`, DRAFT policy pack `docs/security/policies/` |
| Related reports (separate writer) | `CKAM_SECURITY_MASTER_HANDOVER.md`, `CKAM_SECURITY_CLOSURE_REGISTER.md`, `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md`, `CKAM_VAPT_REPORT.md` |

> **This is a readiness assessment only.** CKAM has **not** been through a SOC 2 examination and has no SOC 2
> report. A SOC 2 Type I or Type II report can only be issued by an independent CPA firm after its own
> examination. Nothing here is an attestation, an opinion or a prediction of one. Where no evidence exists
> the text says **NOT EVIDENCED**. The policies in `docs/security/policies/` are **DRAFT — MANAGEMENT APPROVAL
> REQUIRED** and are never counted as operating evidence.

---

## 1. In plain words (for the owner)

A SOC 2 report is a letter from an outside audit firm saying "we checked this company's controls". There are
two kinds:

- **Type I:** "on this one day, the controls were designed well and were in place." Like an inspector checking
  that a shop *has* a CCTV camera, a lock and a written procedure.
- **Type II:** "over the last 6 to 12 months, the controls actually worked every time." Like the inspector
  asking for the CCTV recordings, the key register and the signed checklists for every week of those months.

**Where CKAM stands after the closure (2026-10-16).** The application code is now well designed for SOC 2: it
records who signed in, who failed, who was rate-limited, whose stolen sign-in cookie was reused, who changed
whose access, every export, every data change, every asset movement, every release start-up, and it now also
reports when an audit row itself could not be written. Nine controls are complete in code and only wait for
deployment.

But a SOC 2 auditor looks at **what runs**, and nothing of this is running: production still has the old
release with the critical file-read hole (IF-01), plain-HTTP login, a SYSTEM service on a shared server and
backups on the same server. On the people side, 15 policies were written as **drafts**; none is approved and
none has produced a single record. A policy on paper is not proof that a control works.

**Verdicts (section 10):** **SOC 2 TYPE I READINESS: WEAK** as to production (the CODE design is strong; WEAK
→ PARTIAL is not justified while nothing runs in production). **SOC 2 TYPE II EVIDENCE PROGRAM: NOT READY**
(no operating period, no review records, 180-day log retention shorter than a 12-month observation).

---

## 2. Recommended scope (Trust Services Categories)

| Category | Applies to CKAM? | Recommendation | Why |
|---|---|---|---|
| **Security** (Common Criteria) | Yes | **Required** (every SOC 2 includes it) | — |
| **Confidentiality** | Yes | **Recommended** | Vendor commercial data (GSTIN, contacts, PO values), invoices and documents of two companies that must stay apart |
| **Processing Integrity** | Yes | **Recommended** | A correct asset register: append-only custody ledger with a DB guard, all-or-nothing receipts, idempotent writes, no duplicate names under parallel requests, read-only ERP copy |
| **Availability** | Partly | **Optional / partial** | Single app server and single DB server, no redundancy, backups not off-server |
| **Privacy** | Limited | **Not in the first scope** | Internal tool; handle personal data through Confidentiality and a legal review (EXT-31) |

---

## 3. Summary by criterion

Counts from `CKAM_SOC2_CONTROL_MATRIX.csv` (75 controls). New status `READY IN CODE — NOT DEPLOYED` (written
`READY IN CODE - NOT DEPLOYED` in the CSV): complete in a local commit and retested, only deployment (or, for
CC6-19, the DBA running the prepared scripts) is missing. **For readiness it counts as PARTIAL**; the number in
brackets shows how many PARTIAL controls are in that state.

Overall: **11 READY, 35 PARTIAL (9 of them READY IN CODE — NOT DEPLOYED), 27 NOT READY, 2 NOT IN SCOPE**
(v1.0: 73 controls, 11 / 33 / 27 / 2). Two controls were added: **CC6-19** database least privilege and
**CC7-10** visible audit-write failures.

| Criterion | Topic | Controls | READY | PARTIAL (of which READY IN CODE) | NOT READY | Criterion status |
|---|---|---|---|---|---|---|
| CC1 | Control environment | 4 | 0 | 0 (0) | 4 | **NOT READY** |
| CC2 | Communication and information | 3 | 0 | 2 (0) | 1 | **PARTIAL** |
| CC3 | Risk assessment | 3 | 0 | 3 (0) | 0 | **PARTIAL** |
| CC4 | Monitoring activities | 2 | 0 | 1 (0) | 1 | **NOT READY** |
| CC5 | Control activities | 2 | 0 | 1 (0) | 1 | **PARTIAL** |
| CC6 | Logical and physical access | 19 | 1 | 11 (6) | 7 | **PARTIAL** |
| CC7 | System operations | 10 | 1 | 3 (1) | 6 | **NOT READY** |
| CC8 | Change management | 7 | 1 | 5 (0) | 1 | **PARTIAL** |
| CC9 | Risk mitigation (incl. vendors) | 2 | 0 | 0 (0) | 2 | **NOT READY** |
| A1 | Availability (optional) | 6 | 0 | 3 (0) | 3 | **NOT READY** |
| C1 | Confidentiality | 5 | 2 | 2 (0) | 1 | **PARTIAL** |
| PI1 | Processing Integrity | 8 | 6 | 2 (1) | 0 | **PARTIAL** (close to ready: deploy, ERP TLS confirmation, processing specification) |
| P | Privacy | 4 | 0 | 2 (1) | 0 (2 not in scope) | **NOT IN SCOPE** |
| **Total** | | **75** | **11** | **35 (9)** | **27** | |

**Status changes against v1.0:** CC6-02, CC6-09, CC6-10, CC6-16, CC6-18, PI1-08, P-04 moved PARTIAL →
READY IN CODE — NOT DEPLOYED (still PARTIAL in the count); CC6-19 and CC7-10 are new (READY IN CODE — NOT
DEPLOYED). No control became READY, because nothing was deployed and no people-run control has operated. The
column `Previous Status (2026-10-15)` in the CSV keeps the old values.

---

## 4. Criterion-by-criterion assessment

**Type I readiness** is judged on four questions: *Designed?* *Documented?* *Implemented?* (in production)
*Evidenced?*. A DRAFT policy answers "documented (draft)" at most; it never answers "implemented".
**Type II readiness** needs, for each control: how often it runs, where its evidence comes from, how long the
evidence is kept, how an auditor would sample it, and who owns it.

### CC1 Control environment — NOT READY

| | |
|---|---|
| Controls | CC1-01 policy and code of conduct; CC1-02 security roles (RACI); CC1-03 screening/NDAs; CC1-04 awareness |
| Evidence | DRAFT only: `docs/security/policies/01_Information_Security_Policy.md` (roles section), `10_Security_Awareness_Plan.md`. `docs/ai/CKAM_PRODUCTION_SERVER_CHECKLIST.md` lists owners as "Not yet assigned" |
| Gap | ORGANIZATIONAL / PROCESS GAP: no approved policy, nobody appointed, HR controls not evidenced (decision SD-16) |
| Type I | Designed: draft. Documented: draft. Implemented: no. Evidenced: no |
| Type II | Frequency: annual (policy review, training), at hire (screening). Evidence: signed policies, training records, HR files. Retention: period + 1 year. Owner: Management, HR |

### CC2 Communication and information — PARTIAL

| | |
|---|---|
| Controls | CC2-01 system description; CC2-02 Report a problem and reference ids; CC2-03 external commitments / privacy notice |
| Evidence | `docs/ai/PRODUCTION_INFRASTRUCTURE.md`, `CKAM_THREAT_MODEL.md` (updated 2026-10-16), `docs/ai/ERP_INTEGRATION.md`; `backend/app/observability/client_reports.py` |
| Gap | No formal SOC 2 system description; staff not told how to report a *security* event; no privacy notice |
| Type I | Designed: partly. Documented: partly. Implemented: Report a problem is live since `3b5e842`. Evidenced: yes for tooling |
| Type II | `client_report` rows kept `LOG_RETENTION_DAYS` (default 180) — shorter than a 12-month period (section 6) |

### CC3 Risk assessment — PARTIAL

| | |
|---|---|
| Controls | CC3-01 risk register; CC3-02 fraud (asset misappropriation) risk; CC3-03 security impact of changes |
| Evidence | Draft register re-scored on 2026-10-16 (40 risks, `CKAM_ISO27001_READINESS.md` section 9); DRAFT `policies/12_Risk_Management_Procedure.md`; `CKAM_SECURITY_BASELINE.md` (closure rules added); `backend/tests/observability/test_coverage_walker.py` |
| Gap | Register not owned or approved; no periodic physical verification |
| Type I | Designed: yes (draft). Documented: yes. Implemented: no. Evidenced: draft only |

### CC4 Monitoring activities — NOT READY

| | |
|---|---|
| Controls | CC4-01 internal audit; CC4-02 deficiency tracking |
| Evidence | `CKAM_SECURITY_CLOSURE_REGISTER.md`, `CKAM_SECURITY_FINDINGS_REGISTER.md`, `docs/ai/REVIEW_FINDINGS.md`; DRAFT `policies/13_Internal_Audit_Checklist.md` |
| Gap | No internal audit; trackers are documents, not an owned tracker with due dates |

### CC5 Control activities — PARTIAL

| | |
|---|---|
| Controls | CC5-01 baseline and guardrails mandatory; CC5-02 IT general controls for servers |
| Evidence | `docs/ai/DEVELOPMENT_GUARDRAILS.md`, `CKAM_SECURITY_BASELINE.md` (updated 2026-10-16, not approved); server ITGCs NOT EVIDENCED |
| Gap | Baseline not approved; server patching, AV, hardening not evidenced |

### CC6 Logical and physical access — PARTIAL

| | |
|---|---|
| Controls (19) | Role enforcement (READY), company/work-area scoping (RIC), provisioning, deprovisioning, access review, privileged access, password policy, MFA, brute-force protection (RIC), sessions (RIC), encryption in transit, encryption at rest, secrets, network boundary, physical access, file handling (RIC), equipment disposal, web hardening (RIC), **database least privilege CC6-19 (RIC, new)** |
| Evidence | Original matrix `evidence/access/authz_matrix.csv` (217 routes x 11 personas) and, on the final code, `evidence/closure/retest2/access/authz_matrix.csv` (217 routes x 14 identities = 3,038 cells, 0 escalations); sessions retest `evidence/closure/retest2/sessions/RETEST2_SESSIONS.md` (56 cases, all PASS); `backend/tests/auth/test_wpa2_refresh_reuse.py`, `test_wpa2_token_version_atomic.py`, `test_rate_limit.py`, `test_vapt_*.py`; `backend/tests/test_static_frontend_windows.py`; `evidence/closure/windows/` (0 of 28 leaks); `ops/db/` + `evidence/closure/db/WPB_RESULTS.md` |
| Gap | **Nothing deployed.** Plain HTTP (IF-02); no MFA; no access review; secret rotation after IF-01 pending; backups unencrypted; physical access NOT EVIDENCED; D6 open; production launcher flags (EXT-38); role split not run (EXT-07, EXT-45); residuals: AU-04 lock-out DoS (SD-06), per-office NAT limit (EXT-49), 10 s refresh grace (R-34), no absolute session lifetime (EXT-50) |
| Type I | Designed: yes for application access, sessions, rate limiting, file handling, hardening and DB least privilege; no for MFA, review, encryption. Implemented in production: RBAC yes; the closure controls no. Evidenced: strongly in code, tests and two retests |
| Type II | Continuous (RBAC, logging), quarterly (access review), per event (joiners/leavers). Evidence: `audit_log` (kept forever), user export, review sign-offs (none yet), `auth_session` rows (after deploy). Owner: CKAM owner, IT/Infra |

### CC7 System operations — NOT READY

| | |
|---|---|
| Controls (10) | Security event logging (READY), audit-log integrity, audit-log review, monitoring/alerting, vulnerability scanning, independent pen test, patching, incident response, malware protection, **audit-write failures visible CC7-10 (RIC, new)** |
| Evidence | `docs/ai/LOGGING_AND_DIAGNOSTICS.md`; `backend/app/observability/writer.py` + `test_log_write_failure_reporting.py`; dependency rechecks `evidence/closure/backend/dependency_recheck.md`, `evidence/closure/infra/npm_audit_recheck.md`; DRAFT `policies/05_Incident_Response_Plan.md`, `06_Vulnerability_Management_Procedure.md`; `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` (prepared, not executed) |
| Gap | No one reviews logs on a schedule; no alerts (not on `log_write_failed`, `REFRESH_REUSE` or `RATE_LIMITED` either: EXT-22, EXT-48); IR plan draft only and IF-01 not yet handled as an incident; patching/AV NOT EVIDENCED; DB owner can still drop triggers in production (EXT-07) |
| Type I | Logging: designed, documented, implemented, evidenced. Audit-failure visibility: in code only. Everything else: draft or not designed |

### CC8 Change management — PARTIAL

| | |
|---|---|
| Controls (7) | Change authorisation, pre-release testing, Alembic-only DB changes (READY), deployment by exact release, emergency changes, secure development, dependency control |
| Evidence | `CLAUDE.md`; git history (23 local commits awaiting push approval); 43 committed migrations, single head `c6e8a0b2d4f6`; final local test run (backend 2541 passed / 1 skipped, frontend 1257 in 92 files, Playwright 11 + 1 skipped, security 14/14, `check:build`); `ops/windows/` reference scripts; DRAFT `policies/04_Change_Management_Procedure.md` + `templates/change_record.md` |
| Gap | Approvals only in chat sessions; no CI; test results kept in reports, not per change; live launcher not in git (EXT-13); emergency path draft only (the IF-01 deploy is the first emergency change, EXT-42). See section 8 |
| Type I | Designed: yes. Documented: partly (draft procedure, reference scripts). Implemented: yes (flow followed for `3b5e842`). Evidenced: partly |

### CC9 Risk mitigation — NOT READY

| | |
|---|---|
| Controls | CC9-01 supplier management; CC9-02 business disruption planning |
| Evidence | DRAFT `policies/09_Supplier_Security_Review.md`, `08_Business_Continuity_and_DR_Plan.md` |
| Gap | No supplier register in use; no BCP approved or tested |

### Availability (optional) — NOT READY

| | |
|---|---|
| Controls | A1-01 capacity, A1-02 daily backup, A1-03 off-server copy, A1-04 restore test, A1-05 RTO/RPO, A1-06 auto-restart and health |
| Evidence | `docs/ai/PRODUCTION_INFRASTRUCTURE.md`; `GET /api/health`; `CKAM_BACKUP_RESTORE_PLAN.md` (prepared); DRAFT `policies/07_Backup_Restore_Policy.md`, `policies/08_Business_Continuity_and_DR_Plan.md`; performance before/after `evidence/closure/perf/PERF_REPORT.md` |
| Gap | IF-08 (same server, unencrypted, never restored in production); no RTO/RPO; reboot test open; no uptime monitor |

### Confidentiality — PARTIAL

| | |
|---|---|
| Controls | C1-01 restriction of confidential data, C1-02 retention/disposal, C1-03 exports controlled (READY), C1-04 secrets never in code/logs (READY), C1-05 dev copies protected |
| Evidence | `evidence/input/formula_export_cell.txt`; `backend/tests/observability/test_redaction.py`; closure secret scan (regex-only: working tree, 299+ commits, built frontend, image layers, container env: no real secret); refresh-token ids stored only as SHA-256 |
| Gap | No classification scheme; no approved retention schedule; dev PC holds real ERP data and dumps (IF-09: ACL plan prepared, nothing changed) |

### Processing Integrity — PARTIAL (close to ready)

| | |
|---|---|
| Controls | PI1-01 input validation, PI1-02 idempotency, PI1-03 append-only ledger with single writer (+ DB guard in code), PI1-04 all-or-nothing, PI1-05 unique identities, PI1-06 ERP read-only (PARTIAL), PI1-07 safe exports, PI1-08 concurrency safety (RIC) |
| Evidence | `backend/app/lifecycle/service.py`; migration `c6e8a0b2d4f6` + `backend/tests/lifecycle/test_obs_status_guard.py`; `backend/tests/masters/test_wpf2_category_names.py`, `test_import_duplicate_names.py`, `backend/tests/core/test_wpf2_serial_race_message.py`; burst tests `evidence/closure/retest2/sessions/concurrency_results.md` (same PO number x20, same PO line receive x20 = exactly 6 of 6 units, idempotency x20, same serial x20, moved to two holders x20 …: no duplicates, no over-receiving, no 500, no deadlock); `backend/tests/erp/test_erp_tls_settings.py` |
| Gap | Nothing deployed; ERP TLS settable but not mandatory and not confirmed by the ERP owner (EXT-25); the lifecycle DB guard is marker-based (R-36); no written processing specification for auditors |

### Privacy — NOT IN SCOPE (recommended later)

Personal data present: staff name, code, email, phone; vendor contacts; IP addresses and typed login ids of
failed sign-ins. Closure change: fonts are self-hosted in code (P-04 READY IN CODE — NOT DEPLOYED), so once
deployed no staff IP address goes to Google. Before Privacy can be in scope: privacy notice, lawful basis,
retention for PII inside an append-only audit (SD-09), request handling (EXT-31).

---

## 5. Controls that cannot be Type II tested yet

Type II needs an **observation period** (commonly 6 or 12 months). Nothing below has run for any period:

| Control | Why not testable yet |
|---|---|
| CC1-01..04 policy, roles, screening, training | Drafts only, nothing approved or held |
| CC3-01 risk register review | Draft only |
| CC4-01 internal audit | Never performed (checklist is a draft) |
| CC6-05 quarterly access review | Never performed (procedure and form are drafts) |
| CC6-08 MFA | Not built (decision SD-03) |
| CC6-11 HTTPS | Not deployed |
| CC6-13 secret rotation | Not yet done (needed after IF-01; runbook prepared) |
| CC6-02, CC6-09, CC6-10, CC6-16, CC6-18, CC6-19, CC7-10, PI1-08, P-04 | Exist only in local code or scripts; observation can start only after deployment |
| CC7-03 log review, CC7-04 alerting | Not performed / not built |
| CC7-06 independent pen test, CC7-07 patching, CC7-08 incident response, CC7-09 EDR | Not performed / NOT EVIDENCED |
| CC8-05 emergency change procedure | Draft only |
| CC9-01 supplier review, CC9-02 BCP | Drafts only |
| A1-03 off-server backup, A1-04 restore test, A1-05 DR plan | Not in place (plans prepared) |

Controls whose **evidence source already runs in production** (system-generated) can start their observation
period the day the related process is approved: CC6-01, CC6-03, CC6-04, CC6-06, CC7-01, CC8-03, C1-03, PI1-02,
PI1-03, PI1-04. The production audit trail exists only since release `3b5e842` (deployed 2026-10-14).

---

## 6. Observation-period evidence required (Type II)

| Evidence | Source | Frequency | Keep for | Owner | Notes |
|---|---|---|---|---|---|
| Signed access reviews | User export + `policies/templates/access_review_record.md` | Quarterly | Period + 1 year | CKAM owner | EXT-18 |
| Joiner/mover/leaver records matched to CKAM changes | HR list + `audit_log` on `asset_user` + `templates/joiner_mover_leaver_record.md` | Per event | Period + 1 year | HR, CKAM owner | EXT-33 |
| Weekly security-log review notes | `GET /api/admin/logs/audit?category=security` | Weekly | Period + 1 year | CKAM owner | EXT-22 |
| Change records per release | `templates/change_record.md` + git + CI + `system_event` app_started + `check_least_privilege.sql` output | Per release | Period + 1 year | Dev lead | EXT-35, EXT-42, EXT-46 |
| Backup success log | `backup.log` on 10.0.0.205 + off-server copy log | Daily | Period | IT/Infra | EXT-08 |
| Restore drill report | `templates/restore_test_record.md` | Quarterly | Period + 1 year | IT/Infra | EXT-08 |
| Vulnerability scan + patch reports | npm audit, pip-audit, Windows Update; `templates/vulnerability_triage_record.md` | Monthly | Period | Dev lead, IT | EXT-09, EXT-12, EXT-47 |
| Incident records and reviews | `templates/incident_record.md` | Per incident | Period + 1 year | ISMS lead | EXT-20 (first: IF-01, EXT-03) |
| Alert history | Monitoring tool | Continuous | Period | IT/Infra | EXT-22, EXT-48 |
| Supplier review | Supplier register | Annual | Period + 1 year | Management | EXT-34 |
| Training records | HR | Annual | Period + 1 year | HR | EXT-32 |

**Log-retention gap (unchanged, still open).** `error_log`, `system_event` and `client_report` are purged after
`LOG_RETENTION_DAYS` (default **180 days**) and the JSON log files rotate by size. A Type II observation period
of **12 months** is therefore longer than the retention of exactly the tables that would hold the new automated
evidence below (audit-write failure reports, start-up events, ERP sync events, error groups). Before any
observation period starts: raise `LOG_RETENTION_DAYS` above the period length, **or** export these tables
monthly to off-server storage with a hash (`GET /api/admin/logs/export?kind=system|errors|client`) (EXT-21,
decision SD-15). `audit_log` (security events, data changes) is kept forever and has a 5-year purge floor in
code (not deployed). `auth_session` rows are operational records, not an audit log; the REFRESH_REUSE /
REFRESH_DUPLICATE audit rows are the durable evidence.

---

## 7. Automated evidence CKAM can produce (verified in code/docs)

Only items that exist in code are listed. Items marked *(code, not deployed)* exist only at local HEAD
`fd34520` and will start producing evidence after the deploy. All admin endpoints are head-office-admin only and
every use writes an ACCESS row (`LOGS_VIEWED`, `DIAGNOSTICS_*`).

| Evidence | How to produce it | Verified in |
|---|---|---|
| Full audit trail (data, lifecycle, security, export, import, ERP, access) | `GET /api/admin/logs/audit`; export `GET /api/admin/logs/export?kind=audit&from=&to=&format=jsonl\|csv` | `docs/ai/LOGGING_AND_DIAGNOSTICS.md`; `backend/app/observability/admin_router.py` |
| User and role list | `GET /api/asset-users/export` | `evidence/access/authz_matrix.csv` |
| Access changes | SECURITY `ACCESS_CHANGED`, `PRIMARY_OWNER_GRANTED` / `_REVOKED` | `evidence/auth/audit_coverage.csv` |
| Failed sign-ins and lockouts | SECURITY `LOGIN_FAILED` (unknown login, wrong password, locked account), `LOCKED` | `backend/app/auth/router.py` |
| Rate-limit refusals *(code, not deployed)* | SECURITY `RATE_LIMITED` (endpoint, by address or login id, retry-after; one row per key per minute) | `backend/app/core/rate_limit.py`; `evidence/closure/retest2/sessions/raw/a3_ratelimit.json` |
| Refresh-token reuse *(code, not deployed)* | SECURITY `REFRESH_REUSE` (an already-used sign-in token presented again: every session of that person ended) and `REFRESH_DUPLICATE` (renewed twice within the grace window, e.g. several tabs) | `backend/app/auth/router.py`, `backend/app/auth/sessions.py`; `backend/tests/auth/test_wpa2_refresh_reuse.py` |
| Server-side session records *(code, not deployed)* | `auth_session` table (per refresh session: person, SHA-256 of the token id only, rotation time, ended time); migration `b5d7f9a1c3e5` | `backend/app/alembic/versions/b5d7f9a1c3e5_auth_session_refresh_reuse.py` |
| Invalid tokens and permission refusals | SECURITY `INVALID_TOKEN`, `PERMISSION_DENIED`, `TOKEN_REFRESH_FAILED` (throttled one per minute per key) | `backend/app/core/errors.py` |
| Audit-write failure reports *(code, not deployed)* | Error log line kind `log_write_failed` on the first failure and then at most once a minute with a running count, plus a `system_event` row | `backend/app/observability/writer.py`; `backend/tests/observability/test_log_write_failure_reporting.py` |
| Password resets and changes | SECURITY `PASSWORD_RESET`, `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILED` | `evidence/auth/audit_coverage.csv` |
| Exports, document uploads and downloads | EXPORT rows; ACCESS `DOCUMENT_UPLOADED`, `DOCUMENT_DOWNLOADED` | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| Asset custody history | `asset_event` (append-only); `asset_field_change`; DB guard on status / holder / date *(code, not deployed)* | `evidence/infra/db_02_triggers_constraints.out.txt`; migration `c6e8a0b2d4f6` |
| Database least-privilege check output *(scripts, not run in production)* | `ops/db/check_least_privilege.sql` (34 checks) after every deploy; `ops/db/role_split_verify.sql` (45 checks) after the split | `evidence/closure/db/WPB_RESULTS.md`; `backend/tests/security/test_least_privilege_role_split.py` |
| Build and edge security checks *(dev/CI-ready)* | `npm run check:build` (0 `.map` files, no sourceMappingURL, no Google host, no external resource); `check-nginx-live.mjs`; `nginx-config.test.ts` | `frontend/scripts/`, `frontend/src/security/` |
| Release id | `APP_VERSION` in `system_event` `app_started` (version, environment); `GET /api/admin/diagnostics/health` → `version`; launcher log "serving release"; `ops/windows/verify_release.ps1` (reference) | `backend/app/observability/system.py`, `diagnostics.py` |
| Health and schema version | `GET /api/health`; `diagnostics/health` (migrations vs head, last ERP copy, DB latency) | `diagnostics.py` |
| ERP sync events | `system_event` component `erp_sync`; `erp_sync_run` | `docs/ai/ERP_INTEGRATION.md` |
| Error events, start/stop, purge | `error_log` grouped by fingerprint; `system_event` | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| User problem reports; everything about one request | `client_report`; `GET /api/admin/logs/request/{request_id}`; diagnostics bundle | same |

**Not produced automatically (gaps):** access-review sign-off, change approval record, backup success in the
app (only in `backup.log` on 10.0.0.205), off-server copy log, restore result, patch status, alerts, and the
audit-failure count on the Logs > Diagnostics screen (function exists, screen not yet).

---

## 8. Change-management assessment (SOC 2 CC8)

Intended flow (`CLAUDE.md`, `docs/ai/PRODUCTION_INFRASTRUCTURE.md`, DRAFT `policies/04_Change_Management_Procedure.md`): DEV → test → commit →
owner approves push → push → **separate** owner approval for production → backup → migrations → deploy exact
release → start with the right flags → verify → rotate (security release only) → record.

| Step | Exists today? | Evidence produced today | Missing evidence | Recommendation |
|---|---|---|---|---|
| Develop on dev PC 10.0.0.47 | Yes (21 security commits, tested, not pushed) | git commits | Link to a request id | Request id in commit and change record |
| Test | Yes, by rule (final: backend 2541 / 1 skipped, frontend 1257, Playwright 11 + 1 skipped, security 14/14, `check:build`) | Session output and reports | Stored result per change | CI (EXT-28) or attach output to the change record |
| Commit | Yes | git history (unsigned, single author) | Independent review | Second reviewer or recorded checklist (baseline) |
| Owner approves push | Yes, by rule ("commit and push to git and main") | Chat session only | Durable approver + time | Change record field |
| Push to `origin` | Yes | Remote history | Branch protection | EXT-28 |
| **Separate** approval for production | Yes, by rule | Chat session only | Durable record | EXT-35, EXT-42 |
| Pre-deploy checks | Prepared (runbook Phase 1, EXT-39) | — | Proof of `ENVIRONMENT_NAME=production`, `JWT_SECRET` ≥ 32 chars and ≥ 8 different characters | Ticked in the change record |
| Backup before deploy | Yes | `backup.log`; named dump | Link from change record | Record dump name |
| Migration before start | Yes | `alembic current` | Captured output; the next deploy adds **four** migrations (`f9a1c3e5b7d2`, `a3c5e7f9b1d4`, `b5d7f9a1c3e5`, `c6e8a0b2d4f6`) that **must run before the new code starts** | Save output |
| Deploy the exact release | Yes | `releases\<sha>\` | Live release script not in git (reference in `ops/windows/`) | EXT-13 |
| Start with the right flags | Not yet in production | Launcher log | `--no-proxy-headers --no-server-header` | EXT-38 |
| Verify | Prepared (runbook Phase 7: IF-01 incl. Windows forms, JSON 404, docs closed, headers once, QR deep link, sign-in, receive/move) | — | Per-release smoke result | Checklist in change record |
| Least-privilege check | Prepared (`ops/db/check_least_privilege.sql`) | — | Output per deploy | EXT-46 |
| Rollback plan | Yes (release folders; DB restore when schema changed) | Described | Per-release plan | Field in change record |
| Deployment result | Partly | Launcher log, system events | Final record | Field in change record |

**Assessment:** the flow is well designed and was followed for `3b5e842`, but most evidence lives in chat
sessions and server logs. The IF-01 release will be the first emergency change; its change record (EXT-42) is
the first opportunity to produce a complete record. Segregation of duties stays weak (same person develops and
deploys).

**Minimum change record per release:** `docs/security/policies/templates/change_record.md` (DRAFT) — change id;
request; risk; commit range; test evidence; baseline checklist; push approved by/when; deploy approved by/when;
backup dump name; migrations applied; least-privilege check output; smoke results; rollback plan; result.

---

## 9. Statements that could not be evidenced

- Any production log review, alert, incident record, patch record, AV/EDR record: NOT EVIDENCED.
- Encryption at rest on 10.0.0.205 and the NAS; TLS on the production PostgreSQL connection: NOT EVIDENCED.
- Physical access controls, HR screening and training: NOT EVIDENCED.
- GitHub repository ownership, MFA and branch protection: NOT EVIDENCED.
- Backup of NAS documents; off-server copy of DB dumps: NOT EVIDENCED (documented as not done).
- Whether IF-01 was exploited: NOT EVIDENCED either way.
- Any closure control running in production: NOT EVIDENCED (nothing deployed).
- Least privilege on a production-like database: proven on a disposable DB only.
- The ERP side (TLS, SELECT-only grant): proven with stand-ins only; the real ERP was never contacted.
- Container OS package CVEs: not scanned; secret scan is regex-only.

---

## 10. Verdicts

### `SOC 2 TYPE I READINESS: WEAK` (as to production)

The **code design is strong**: access, sessions (incl. refresh-token reuse detection), brute-force protection,
file handling, web hardening, processing integrity, database least privilege and audit-failure visibility are
designed, implemented in local code and independently retested. But a Type I report describes controls **in
place in the running system**, and nothing of the programme runs in production: the CRITICAL IF-01 exposure is
still live, login uses plain HTTP, CKAM still shares servers and runs as SYSTEM, and CC1 (control
environment), CC4 (monitoring), CC7 (operations) and CC9 (risk mitigation) are drafts or not designed.
**Moving WEAK → PARTIAL is not justified while nothing runs in production.** **This is not an attestation.**
It would rise to PARTIAL once EXT-41, EXT-39, EXT-01, EXT-44, EXT-38, EXT-02, EXT-04 and EXT-05 are done and the
policy set, incident plan, access review and change record are approved and in use.

### `SOC 2 TYPE II EVIDENCE PROGRAM: NOT READY`

Strong system-generated evidence sources exist and gain new ones after deploy (REFRESH_REUSE,
REFRESH_DUPLICATE, RATE_LIMITED, LOGIN_FAILED, INVALID_TOKEN security events, `auth_session` records,
audit-failure reports, least-privilege check output, build/nginx checks, release id). But there is **no
operating period**, the people-run controls (reviews, approvals, restore tests, patching, incident handling)
have **no records**, a DRAFT policy is not operating evidence, and **180-day retention** of system and error
events is shorter than a **12-month** observation period.

### Per-criterion

| Criterion | Status |
|---|---|
| CC1 Control environment | NOT READY |
| CC2 Communication and information | PARTIAL |
| CC3 Risk assessment | PARTIAL |
| CC4 Monitoring activities | NOT READY |
| CC5 Control activities | PARTIAL |
| CC6 Logical and physical access | PARTIAL |
| CC7 System operations | NOT READY |
| CC8 Change management | PARTIAL |
| CC9 Risk mitigation | NOT READY |
| Availability | NOT READY (optional) |
| Confidentiality | PARTIAL |
| Processing Integrity | PARTIAL |
| Privacy | NOT IN SCOPE |

---

## 11. Spreadsheet

`CKAM_SOC2_CONTROL_MATRIX.xlsx` was regenerated on 2026-10-16 from `CKAM_SOC2_CONTROL_MATRIX.csv` (master copy)
with openpyxl inside a temporary tmpfs folder of the dev `api` container (no build, no restart; SHA-256 compared
after copying back). New column in v1.1: `Previous Status (2026-10-15)` (`NEW 2026-10-16` for CC6-19 and CC7-10).

---

## 12. Change history

| Version | Date | Writer | Change |
|---|---|---|---|
| 1.0 | 2026-10-15 | Readiness consultant (first programme) | 73 controls (11 READY, 33 PARTIAL, 27 NOT READY, 2 NOT IN SCOPE) at HEAD `d04779a`; verdicts Type I WEAK, Type II NOT READY |
| 1.1 | 2026-10-16 | WP-M2b (closure programme) | Re-assessed at HEAD `fd34520` from the lead's fact sheet: status `READY IN CODE — NOT DEPLOYED` (7 moved, counted as PARTIAL); CC6-19 and CC7-10 added (75 controls: 11 / 35 / 27 / 2); new automated evidence listed; draft policies linked but not counted; log-retention gap restated; verdicts unchanged (Type I WEAK as to production with strong code design; Type II NOT READY) |
