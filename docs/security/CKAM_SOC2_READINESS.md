# CKAM: SOC 2 Readiness Assessment

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Document | Readiness assessment, version 1.0 (FINAL state after remediation and retest) |
| Date | 2026-10-15 |
| Evidence cut-off | HEAD `d04779a`; 8 local security commits (`3e134c1` … `d04779a`), **none pushed, none deployed**; production still runs `3b5e842` |
| Framework | AICPA Trust Services Criteria (Security / Common Criteria CC1-CC9, Availability, Confidentiality, Processing Integrity, Privacy) |
| Companion files | `CKAM_SOC2_CONTROL_MATRIX.csv` / `.xlsx` (73 controls), `CKAM_ISO27001_READINESS.md` (finding summary and risk register), `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_SECURITY_EVIDENCE_INDEX.md` |
| Related reports (separate writer) | `CKAM_VAPT_REPORT.md`, `CKAM_SECURITY_FINDINGS_REGISTER.md` (authoritative findings), `CKAM_SECURITY_REMEDIATION_REPORT.md` |

> **This is a readiness assessment only.** CKAM has **not** been through a SOC 2 examination and has no SOC 2
> report. A SOC 2 Type I or Type II report can only be issued by an independent CPA firm after its own
> examination. Nothing here is an attestation, an opinion or a prediction of one. Where no evidence exists
> the text says **NOT EVIDENCED**.

---

## 1. In plain words (for the owner)

A SOC 2 report is a letter from an outside audit firm saying "we checked this company's controls". There are
two kinds:

- **Type I:** "on this one day, the controls were designed well and were in place." Like an inspector checking
  that a shop *has* a CCTV camera, a lock and a written procedure.
- **Type II:** "over the last 6 to 12 months, the controls actually worked every time." Like the inspector
  asking for the CCTV recordings, the key register and the signed checklists for every week of those months.

**Where CKAM stands.** The application already records much of what a Type II auditor asks for: who signed in,
who failed, who changed whose access, who exported what, every data change, every asset movement, every
release start-up, every ERP copy. That is a good base. But SOC 2 also needs the company around the
application: written policies, people who review the logs on a schedule, an incident plan, supplier checks,
HTTPS, backups that are tested, and records of who approved each release. Most of those do not exist yet.

**After remediation:** every code finding from the 2026-10-15 test is fixed, mitigated or accepted, and
retested (rate limiting, revocable sessions, password policy, request-size limits, CSP, document content
checks, audit TRUNCATE guards, ERP timeouts, weak-secret refusal). But these are **local commits only**: the
live server still runs the old release with the critical weakness IF-01 until the owner approves a deploy
and the secrets are changed. A SOC 2 auditor looks at what runs, so the verdicts do not move yet.

**Verdicts (section 10, unchanged):** `SOC 2 TYPE I READINESS WEAK` and `SOC 2 TYPE II EVIDENCE PROGRAM NOT READY`.

---

## 2. Recommended scope (Trust Services Categories)

| Category | Applies to CKAM? | Recommendation | Why |
|---|---|---|---|
| **Security** (Common Criteria) | Yes | **Required** (every SOC 2 includes it) | — |
| **Confidentiality** | Yes | **Recommended** | CKAM holds vendor commercial data (GSTIN, contacts, PO values), invoices and uploaded documents of two companies, and must keep them apart |
| **Processing Integrity** | Yes | **Recommended** | CKAM's purpose is a correct asset register: append-only custody ledger, all-or-nothing receipts, idempotent writes, read-only ERP copy. These are already its strongest controls |
| **Availability** | Partly | **Optional / partial**: include only if users or customers rely on an uptime commitment | Single app server and single DB server, no redundancy, backups not off-server; a written availability commitment would fail today |
| **Privacy** | Limited | **Not in the first scope**; handle personal data through Confidentiality and an internal privacy review | CKAM holds staff names, codes, emails, phones and IP addresses, but it is an internal tool, not a consumer service. Revisit after the legal review (EXT-31) |

---

## 3. Summary by criterion

Counts from `CKAM_SOC2_CONTROL_MATRIX.csv` (73 controls: 11 READY, 33 PARTIAL, 27 NOT READY, 2 NOT IN SCOPE).
Two controls were added after remediation: CC6-18 web hardening and PI1-08 concurrency safety. A control
whose fix is only in a local commit is marked Type I "YES (code) / NO (production)" and stays PARTIAL until
it is deployed.

| Criterion | Topic | Controls | READY | PARTIAL | NOT READY | Criterion status |
|---|---|---|---|---|---|---|
| CC1 | Control environment | 4 | 0 | 0 | 4 | **NOT READY** |
| CC2 | Communication and information | 3 | 0 | 2 | 1 | **PARTIAL** |
| CC3 | Risk assessment | 3 | 0 | 3 | 0 | **PARTIAL** |
| CC4 | Monitoring activities | 2 | 0 | 1 | 1 | **NOT READY** |
| CC5 | Control activities | 2 | 0 | 1 | 1 | **PARTIAL** |
| CC6 | Logical and physical access | 18 | 1 | 10 | 7 | **PARTIAL** |
| CC7 | System operations | 9 | 1 | 2 | 6 | **NOT READY** |
| CC8 | Change management | 7 | 1 | 5 | 1 | **PARTIAL** |
| CC9 | Risk mitigation (incl. vendors) | 2 | 0 | 0 | 2 | **NOT READY** |
| A1 | Availability (optional) | 6 | 0 | 3 | 3 | **NOT READY** |
| C1 | Confidentiality | 5 | 2 | 2 | 1 | **PARTIAL** |
| PI1 | Processing Integrity | 8 | 6 | 2 | 0 | **PARTIAL** (close to ready: ERP TLS, deployment of the ERP timeouts and race fix, and the processing-specification document are the gaps) |
| P | Privacy | 4 | 0 | 2 | 0 (2 not in scope) | **NOT IN SCOPE** |

---

## 4. Criterion-by-criterion assessment

For each criterion: what CKAM has, where the evidence is, the gap, and readiness.
**Type I readiness** is judged on four questions: *Designed?* (a control exists on paper or in code)
*Documented?* (written so an auditor can read it) *Implemented?* (actually in place in production)
*Evidenced?* (a file, record or system output proves it).
**Type II readiness** needs, for each control: how often it runs, where its evidence comes from, how long the
evidence is kept, how an auditor would sample it, and who owns it.

### CC1 Control environment — NOT READY

| | |
|---|---|
| Controls | CC1-01 policy and code of conduct; CC1-02 security roles (RACI); CC1-03 screening/NDAs; CC1-04 awareness |
| Evidence | NOT EVIDENCED. `docs/ai/CKAM_PRODUCTION_SERVER_CHECKLIST.md` lists backup, restore and rollback owners as "Not yet assigned" |
| Gap | ORGANIZATIONAL / PROCESS GAP: no approved policy, no named security roles, HR controls not evidenced |
| Type I | Designed: no. Documented: no. Implemented: no. Evidenced: no |
| Type II | Frequency: annual (policy review, training), at hire (screening). Evidence: signed policies, training records, HR files. Retention: duration of the observation period + 1 year. Sampling: all policy reviews; sample of new joiners. Owner: Management, HR |

### CC2 Communication and information — PARTIAL

| | |
|---|---|
| Controls | CC2-01 system description; CC2-02 Report a problem and reference ids; CC2-03 external commitments / privacy notice |
| Evidence | `docs/ai/PRODUCTION_INFRASTRUCTURE.md`, `docs/security/CKAM_THREAT_MODEL.md`, `docs/ai/ERP_INTEGRATION.md`; `backend/app/observability/client_reports.py`; `client_report` table |
| Gap | No formal SOC 2 system description; staff not told how to report a *security* event; no privacy notice |
| Type I | Designed: partly. Documented: partly (technical docs exist). Implemented: Report a problem is live since release `3b5e842`. Evidenced: yes for tooling |
| Type II | Frequency: continuous (reports), annual (system description). Evidence: `client_report` rows (kept `LOG_RETENTION_DAYS`, default 180; REVIEWED twice as long). Sampling: sample of reports and their handling. Owner: ISMS lead |

### CC3 Risk assessment — PARTIAL

| | |
|---|---|
| Controls | CC3-01 risk register; CC3-02 fraud (asset misappropriation) risk; CC3-03 security impact of changes |
| Evidence | Draft register with 31 risks in `CKAM_ISO27001_READINESS.md` section 9; `CKAM_SECURITY_BASELINE.md`; `backend/tests/observability/test_coverage_walker.py` |
| Gap | Register not owned or approved; no periodic physical verification of assets against the register |
| Type I | Designed: yes (draft). Documented: yes. Implemented: no (not approved). Evidenced: draft only |
| Type II | Frequency: annual and on major change. Evidence: approved register with dates. Sampling: the yearly review + changes in the period. Owner: ISMS lead, Management |

### CC4 Monitoring activities — NOT READY

| | |
|---|---|
| Controls | CC4-01 internal audit; CC4-02 deficiency tracking |
| Evidence | Findings exist in `docs/ai/REVIEW_FINDINGS.md`, `docs/security/evidence/access/findings.csv`, `CKAM_ISO27001_READINESS.md` section 6 |
| Gap | No internal audit; no single owned tracker with due dates |
| Type I | Designed: no (audit) / partly (tracking). Documented: partly. Implemented: no. Evidenced: partly |
| Type II | Frequency: annual audit, monthly tracker review. Evidence: audit report, tracker history. Owner: Management |

### CC5 Control activities — PARTIAL

| | |
|---|---|
| Controls | CC5-01 baseline and guardrails mandatory; CC5-02 IT general controls for servers |
| Evidence | `docs/ai/DEVELOPMENT_GUARDRAILS.md`, `docs/security/CKAM_SECURITY_BASELINE.md`; server ITGCs NOT EVIDENCED |
| Gap | Baseline not approved; server patching, AV, hardening not evidenced |
| Type I | Designed: yes (app) / no (servers). Documented: yes (app). Implemented: partly. Evidenced: partly |

### CC6 Logical and physical access — PARTIAL

| | |
|---|---|
| Controls (18) | Role enforcement (READY), company/work-area scoping, provisioning, deprovisioning, access review, privileged access, password policy, MFA, brute-force protection, sessions, encryption in transit, encryption at rest, secrets, network boundary, physical access, file handling, equipment disposal, web hardening (CC6-18) |
| Evidence | `docs/security/evidence/access/authz_matrix.csv` (217 routes x 11 personas, zero escalation, repeated in the retest), `docs/security/evidence/access/tests.csv`, `docs/security/evidence/auth/tests.csv`, regression tests `backend/tests/auth/test_rate_limit.py`, `test_vapt_login.py`, `test_vapt_sessions.py`, `test_vapt_password_policy.py`, `backend/tests/core/test_body_limit.py`, `backend/tests/test_vapt_headers_and_docs.py`, `frontend/e2e/security.spec.ts`; `backend/app/core/capabilities.py`; `audit_log` SECURITY rows (now incl. `RATE_LIMITED`) |
| Gap | Plain HTTP (IF-02/AU-13, OPEN EXTERNAL, HIGH); no MFA; no access review; secrets rotation after IF-01 pending; backups unencrypted; physical access NOT EVIDENCED; D6 open; N2 (`--no-proxy-headers`) open; **all code fixes (AC-1, AC-2, IF-03, AU-01/03/05/07/08/16, N1, N4, AU-11/12/14/15) are retested but not deployed**; residuals AU-04 (lock-out DoS) and AU-06 (old rotated refresh token valid until sign-out/expiry) |
| Type I | Designed: yes for application access, sessions, rate limiting and hardening; no for MFA, review, encryption. Documented: partly. Implemented in production: RBAC yes; the remediation no (not deployed); HTTPS no. Evidenced: strongly in code and tests |
| Type II | Frequency: continuous (RBAC, logging), quarterly (access review), per event (joiners/leavers). Evidence: `audit_log` (kept forever), user export, review sign-offs. Sampling: sample of joiners/leavers per quarter against HR list; all quarterly reviews; sample of PERMISSION_DENIED and ACCESS_CHANGED rows. Owner: CKAM owner (head-office admin), IT/Infra |

### CC7 System operations — NOT READY

| | |
|---|---|
| Controls (9) | Security event logging (READY), audit-log integrity, audit-log review, monitoring/alerting, vulnerability scanning, independent pen test, patching, incident response, malware protection |
| Evidence | `docs/ai/LOGGING_AND_DIAGNOSTICS.md`; `docs/security/evidence/infra/db_03_append_only_privilege_tests.out.txt`; `docs/security/evidence/infra/dependency_audit.md` (one-off) |
| Gap | No one reviews logs on a schedule; no alerts; no incident plan; IF-01 not yet handled as an incident (fixed in code, production still exposed); patching/AV NOT EVIDENCED; audit TRUNCATE now guarded and purge floored at 5 years (IF-05/IF-06 MITIGATED, not deployed) but the DB owner can still drop triggers (EXT-07) |
| Type I | Logging: designed, documented, implemented, evidenced. Everything else: not designed |
| Type II | Frequency: weekly log review, monthly scans and patching, continuous alerting. Evidence: review sign-offs, scan reports, patch reports, alert history, incident tickets. Sampling: e.g. a sample of weeks for log review; all incidents. Owner: IT/Infra, ISMS lead |

### CC8 Change management — PARTIAL

| | |
|---|---|
| Controls (7) | Change authorisation, pre-release testing, Alembic-only DB changes (READY), deployment by exact release, emergency changes, secure development, dependency control |
| Evidence | `CLAUDE.md` (rules 3-5 and the push phrase); `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (deploy steps, 2026-10-14 notes); git history (290 commits; the 8 security commits are local, awaiting the owner's push approval); 41 committed migrations with a single head; `docs/ai/DEVELOPMENT_GUARDRAILS.md` security rules (`da790d1`); `backend/constraints.txt`; `system_event` `app_started` with version |
| Gap | Approvals only in chat sessions; no CI; test results kept in reports, not per change; launcher/release script not in git (IF-15); production install not yet using `constraints.txt`; no emergency procedure (the IF-01 deploy is the first emergency change). See section 8 |
| Type I | Designed: yes. Documented: partly (runbook out of date). Implemented: yes. Evidenced: partly |
| Type II | Frequency: per change. Evidence: change records, CI runs, git log, `system_event`. Sampling: sample of releases in the period, each traced from request to smoke result. Owner: Dev lead, CKAM owner |

### CC9 Risk mitigation — NOT READY

| | |
|---|---|
| Controls | CC9-01 supplier management; CC9-02 business disruption planning |
| Evidence | NOT EVIDENCED |
| Gap | No supplier register (ERP team, NAS, GitHub, AI coding assistant provider, Google Fonts); no BCP |
| Type I / II | Not designed. Annual supplier review and BCP test needed |

### Availability (optional) — NOT READY

| | |
|---|---|
| Controls | A1-01 capacity, A1-02 daily backup, A1-03 off-server copy, A1-04 restore test, A1-05 RTO/RPO, A1-06 auto-restart and health |
| Evidence | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (daily dump 03:00, 30 days, task restart); `GET /api/health`, `GET /api/admin/diagnostics/health`; dev restore drill in `docs/ai/AM-09_RC_FULL_AUDIT_REPORT.md` |
| Gap | IF-08 (same server, unencrypted, never restored in production); no RTO/RPO; reboot test open; no uptime monitor |
| Type II | Daily backup log, quarterly restore report, monthly capacity review. Owner: IT/Infra |

### Confidentiality — PARTIAL

| | |
|---|---|
| Controls | C1-01 restriction of confidential data, C1-02 retention/disposal, C1-03 exports controlled (READY), C1-04 secrets never in code/logs (READY), C1-05 dev copies protected |
| Evidence | `docs/security/evidence/input/formula_export_cell.txt`; `backend/tests/observability/test_redaction.py`; secrets scan (none in working tree or 282 commits); EXPORT and DOCUMENT_DOWNLOADED audit rows |
| Gap | No classification scheme; no approved retention schedule; dev PC holds real ERP data and dumps (IF-09) |

### Processing Integrity — PARTIAL (close to ready)

| | |
|---|---|
| Controls | PI1-01 input validation, PI1-02 idempotency, PI1-03 append-only ledger with single writer, PI1-04 all-or-nothing bulk operations, PI1-05 unique identities, PI1-06 ERP read-only integrity (PARTIAL), PI1-07 safe exports, PI1-08 concurrent same-name creation serialized (PARTIAL: not deployed) |
| Evidence | `backend/app/lifecycle/service.py`; `backend/app/core/idempotency.py`; `docs/security/evidence/infra/db_02_triggers_constraints.out.txt`; `docs/ai/DECISIONS.md` 2026-10-14 (5), (6), (7); `backend/app/erp/source.py` (`default_transaction_read_only`, timeouts); `backend/tests/erp/test_vapt_erp_limits.py`; `backend/tests/core/test_security_concurrency.py` (RACE-1) |
| Gap | ERP connection without TLS (IF-16, OPEN EXTERNAL); ERP timeouts (IF-10) and the RACE-1 fix are retested but not deployed; `asset.status` has no database-level guard against the DB owner (db_03 A9); no written processing specification for auditors; db_05 shows two dev-data observations to explain (two primary owners; user id 1 without a CREATE audit row; cause NOT EVIDENCED, to be explained) |

### Privacy — NOT IN SCOPE (recommended later)

Personal data present: staff name, code, email, phone; vendor contact name/phone/email; IP addresses and the
typed login id of failed sign-ins in `audit_log`. Controls today: admin-only logs, redaction of secrets,
fonts loaded from Google (sends IP addresses to a third party, EXT-11). Before Privacy can be in scope: privacy
notice, lawful basis, retention for PII inside an append-only audit, request handling (EXT-31).

---

## 5. Controls that cannot be Type II tested yet

Type II needs an **observation period** (commonly 6 or 12 months; the auditor and CityKart agree it). None of
the following has run for any period yet, so there is nothing to sample:

| Control | Why not testable yet |
|---|---|
| CC1-01..04 policy, roles, screening, training | Do not exist |
| CC3-01 risk register review | Draft only |
| CC4-01 internal audit | Never performed |
| CC6-05 quarterly access review | Never performed |
| CC6-08 MFA | Not built |
| CC6-11 HTTPS | Not deployed |
| CC6-13 secret rotation | Not yet done (needed after IF-01) |
| CC7-03 log review, CC7-04 alerting | Not performed / not built |
| CC7-06 independent pen test, CC7-07 patching, CC7-08 incident response, CC7-09 EDR | Not performed / NOT EVIDENCED |
| CC8-05 emergency change procedure | Not written |
| CC9-01 supplier review, CC9-02 BCP | Not performed |
| A1-03 off-server backup, A1-04 restore test, A1-05 DR plan | Not in place |

Controls whose **evidence source already exists** (system-generated) can start their observation period the
day the related process is approved: CC6-01, CC6-03, CC6-04, CC6-06, CC6-09, CC7-01, CC8-03, C1-03, PI1-02,
PI1-03, PI1-04. Note: the production audit trail only exists since release `3b5e842` (deployed 2026-10-14).

---

## 6. Observation-period evidence required (Type II)

| Evidence | Source | Frequency | Keep for | Owner | Notes |
|---|---|---|---|---|---|
| Signed access reviews | User export + sign-off | Quarterly | Period + 1 year | CKAM owner | EXT-18 |
| Joiner/mover/leaver tickets matched to CKAM changes | HR list + `audit_log` CREATE/UPDATE on `asset_user` | Per event | Period + 1 year | HR, CKAM owner | EXT-33 |
| Weekly security-log review notes | `GET /api/admin/logs/audit?category=security` | Weekly | Period + 1 year | CKAM owner | EXT-22 |
| Change records per release | Ticket + git + CI + `system_event` app_started | Per release | Period + 1 year | Dev lead | EXT-35 |
| Backup success log | `backup.log` on 10.0.0.205 + off-server copy log | Daily | Period | IT/Infra | EXT-08 |
| Restore drill report | Drill record | Quarterly | Period + 1 year | IT/Infra | EXT-08 |
| Vulnerability scan + patch reports | npm audit, pip-audit, Windows Update reports | Monthly | Period | Dev lead, IT | EXT-09, EXT-12 |
| Incident tickets and post-incident reviews | IR process | Per incident | Period + 1 year | ISMS lead | EXT-20 |
| Alert history | Monitoring tool | Continuous | Period | IT/Infra | EXT-22 |
| Supplier review | Supplier register | Annual | Period + 1 year | Management | EXT-34 |
| Training records | HR | Annual | Period + 1 year | HR | EXT-32 |

**Retention warning.** `error_log`, `system_event` and `client_report` are purged after `LOG_RETENTION_DAYS`
(default 180) and the JSON log files rotate at 20 MB x 11 per file. For a 12-month observation period, either
raise `LOG_RETENTION_DAYS` above the period length, or export these tables monthly to off-server storage
(`GET /api/admin/logs/export?kind=system|errors|client`) (EXT-21). `audit_log` is kept forever.

---

## 7. Automated evidence CKAM can already produce (verified in code/docs)

Only items that exist today are listed. All admin endpoints are head-office-admin only and every use writes an
ACCESS row (`LOGS_VIEWED`, `DIAGNOSTICS_*`).

| Evidence | How to produce it | Verified in |
|---|---|---|
| Full audit trail (data, lifecycle, security, export, import, ERP, access) | `GET /api/admin/logs/audit` (filters by date, actor, entity, category, action, outcome); export `GET /api/admin/logs/export?kind=audit&from=&to=&format=jsonl\|csv` | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` sections 2 and 8; `backend/app/observability/admin_router.py` |
| User and role list | `GET /api/asset-users/export` (Full Admin and head-office admin) | `docs/security/evidence/access/authz_matrix.csv` |
| Access changes | `audit_log` SECURITY `ACCESS_CHANGED`, `PRIMARY_OWNER_GRANTED` / `_REVOKED` | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 2; `auth/audit_coverage.csv` |
| Failed sign-ins and lockouts | SECURITY `LOGIN_FAILED`, `LOCKED` (never throttled) | `docs/security/evidence/auth/tests.csv` AU-T096 |
| Rate-limit refusals (after deploy) | SECURITY `RATE_LIMITED` (endpoint, limited by address or login id, retry-after; at most one row per key per minute) | `backend/app/core/rate_limit.py` (commit `ae706bb`, not deployed) |
| Password resets and changes | SECURITY `PASSWORD_RESET`, `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILED` | `auth/audit_coverage.csv` |
| Permission refusals and invalid tokens | SECURITY `PERMISSION_DENIED`, `INVALID_TOKEN`, `TOKEN_REFRESH_FAILED` (throttled one per minute per key) | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 2 |
| Exports | EXPORT rows with filters and row count | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 10 |
| Document uploads and downloads | ACCESS `DOCUMENT_UPLOADED`, `DOCUMENT_DOWNLOADED` | same |
| Asset custody history | `asset_event` (append-only); `asset_field_change` | `db_02_triggers_constraints.out.txt` |
| Release id | `APP_VERSION` in `system_event` `app_started` (version, environment); `GET /api/admin/diagnostics/health` returns `version`; launcher log "serving release" | `backend/app/observability/system.py`; `backend/app/observability/diagnostics.py`; `docs/ai/PRODUCTION_INFRASTRUCTURE.md` |
| Health | `GET /api/health`; `GET /api/admin/diagnostics/health` (log dir writable, migrations, last ERP copy, table counts, DB latency) | `backend/app/main.py`; `diagnostics.py` |
| Database schema version | `diagnostics/health` → `migrations` (matches head or not); `alembic current` at deploy | `diagnostics.py` (`system.migration_state()`) |
| ERP sync events | `system_event` component `erp_sync` (`sync_started`, `sync_success` with counts, `sync_failed` with reason); `erp_sync_run` table; `GET /api/erp/sync` | `docs/ai/ERP_INTEGRATION.md`; `docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 10 |
| Error events | `error_log` (500s, DB errors, slow requests, slow SQL, job errors), grouped by fingerprint: `GET /api/admin/logs/errors?group=true` | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| Start/stop, DB lost/restored, log purge | `system_event` (`startup`, `shutdown`, `db connectivity_lost/_restored`, `retention purge_finished`) | same |
| User problem reports | `client_report`, `GET /api/admin/logs/client-reports` | `backend/app/observability/client_reports.py` |
| Everything about one request | `GET /api/admin/logs/request/{request_id}`; `GET /api/admin/diagnostics/bundle` | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 1 |

**Not produced automatically (gaps):** access-review sign-off, change approval record, backup success in the
app (it lives only in `backup.log` on 10.0.0.205), off-server copy log, restore result, patch status, alerts.

---

## 8. Change-management assessment (SOC 2 CC8)

Intended flow (from `CLAUDE.md` and `docs/ai/PRODUCTION_INFRASTRUCTURE.md`):
DEV → test → commit → user approves push → push → **separate** user approval for production → backup →
deploy exact release → migration → restart → smoke.

| Step | Exists today? | Evidence produced today | Missing evidence | Recommendation |
|---|---|---|---|---|
| Develop on dev PC 10.0.0.47 | Yes (the 2026-10-15 remediation followed it: 8 commits, tested, not pushed) | git commits (author, time, Conventional Commit message) | Link to a request/ticket id | Put the request id in the commit message and change record |
| Test (pytest on `ckam_test`, `tsc`, `vitest`, E2E) | Yes, by rule | Only in the session's terminal output | Stored test result per change | CI job (EXT-28) or attach test output to the change record |
| Commit | Yes | git history (unsigned, single author) | Independent review | Second reviewer or recorded self-review checklist (baseline) |
| User approves push | Yes, by rule ("commit and push to git and main") | Only in the chat session | Named approver + time in a durable record | Change record field "push approved by / when" |
| Push to `origin` | Yes | Remote git history | Branch protection evidence | Company-owned repo with branch protection (EXT-28) |
| **Separate** user approval for production | Yes, by rule | Only in the chat session | Durable approval record | Change record field "deploy approved by / when" (EXT-35) |
| Backup before deploy | Yes | `backup.log` on 10.0.0.205; named dump (e.g. `ckassetmanagement_20261014_141205.dump`) | Link from change record to the dump name | Record dump name in change record |
| Deploy the exact release | Yes | `releases\<sha>\`; `.env.pre-<sha>` copy | Release script itself (not in git, IF-15) | Put launcher and release script in git (EXT-13) |
| Pre-deploy configuration check | Not yet | — | Proof that `JWT_SECRET` (≥ 32 chars, ≥ 8 distinct) and `ENVIRONMENT_NAME=production` are set; otherwise the new code refuses to start | EXT-39 checklist in the change record |
| Migration (`alembic upgrade head`) | Yes | `alembic current` output; `diagnostics/health` migrations | Captured output; the next deploy adds `f9a1c3e5b7d2` and `a3c5e7f9b1d4` and **must run before the new code starts** | Save output in the change record |
| Start with the right flags | Partly | Launcher log | `--no-proxy-headers` on uvicorn (N2) | EXT-38 |
| Restart | Yes | `system_event` `app_started` with version and environment | — | — |
| Smoke | Yes (2026-10-14 checks: health, openapi routes, bundle name, X-Request-ID, launcher "serving release", NAS mapping, ERP `sync_success`) | Described in `PRODUCTION_INFRASTRUCTURE.md` | Per-release smoke checklist result | Checklist in change record |
| Rollback plan | Yes (previous release folders; DB restore when schema changed) | Described in `PRODUCTION_INFRASTRUCTURE.md` | Per-release rollback plan and whether DB restore is needed | Field in change record |
| Deployment result | Partly | Launcher log, system events | Final "deployed OK / rolled back" record | Field in change record |

**Assessment:** the flow is well designed and actually followed (release `3b5e842` on 2026-10-14 followed it
end to end), but most evidence lives in chat sessions and server logs, not in a durable change record. A Type II
auditor would sample releases and ask for request id, approver, test evidence, rollback plan and deployment
result for each; today only part of that can be shown. The separation of push approval from deploy approval is
a good control; segregation of duties is weak because the same person develops and deploys (A.5.3).

**Minimum change record per release (template fields):** change id; request/reason; risk (low/medium/high,
security-relevant yes/no); commit range; test evidence (pytest, tsc, vitest, E2E counts); security baseline
checklist done; push approved by/when; deploy approved by/when; backup dump name; migrations applied; smoke
results; rollback plan (code only / code + DB restore); result; post-deploy issues.

---

## 9. Statements that could not be evidenced

- Any production log review, alert, incident ticket, patch record, AV/EDR record: NOT EVIDENCED.
- Encryption at rest on 10.0.0.205 and the NAS; TLS on the production PostgreSQL connection: NOT EVIDENCED.
- Physical access controls, HR screening and training: NOT EVIDENCED.
- GitHub repository ownership, MFA and branch protection: NOT EVIDENCED.
- Backup of NAS documents; off-server copy of DB dumps: NOT EVIDENCED (documented as not done).
- Whether IF-01 was exploited before today: NOT EVIDENCED either way.
- Any remediation running in production: NOT EVIDENCED (nothing deployed).
- Production `JWT_SECRET` strength and `ENVIRONMENT_NAME`: NOT EVIDENCED (checked at deploy, EXT-39).
- Final backend test-run number: to be given by the lead (about 1,783 tests).

---

## 10. Verdicts

### `SOC 2 TYPE I READINESS WEAK` (unchanged after remediation)

Application controls for access, logging, integrity and confidentiality are strong and, after the 2026-10-15
remediation and retest, stronger still in code. But a Type I report describes controls **in place in the
running system**: the remediation is not deployed, the CRITICAL IF-01 exposure is still live in production,
login still uses plain HTTP, CKAM still shares servers and runs as SYSTEM, and the Common Criteria for the
control environment (CC1), monitoring (CC4), operations (CC7) and risk mitigation (CC9) are mostly not
designed. **This is not an attestation.** It would rise to PARTIAL once EXT-01, EXT-02, EXT-04, EXT-05,
EXT-38 and EXT-39 are done and the policy set, incident plan, access review and change record exist.

### `SOC 2 TYPE II EVIDENCE PROGRAM NOT READY` (unchanged)

Strong system-generated evidence sources exist (and gain `RATE_LIMITED` rows once deployed) (audit trail, security events, release id, ERP sync events), but
the people-run controls (reviews, approvals, restore tests, patching, incident handling) have no records yet,
there is no observation period, and 180-day retention of system and error events is shorter than a 12-month
observation period.

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

`CKAM_SOC2_CONTROL_MATRIX.xlsx` was regenerated on 2026-10-15 (final state) from `CKAM_SOC2_CONTROL_MATRIX.csv` (the master
copy) with openpyxl inside a temporary folder of the dev `api` container: bold frozen header, filters, column
widths, wrapped text. Regenerate it whenever the CSV changes.
