# CKAM: ISO/IEC 27001:2022 Readiness Assessment

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Document | Readiness assessment, version 1.0 (FINAL state after remediation and retest) |
| Date | 2026-10-15 |
| Evidence cut-off | Repository HEAD `d04779a` (worktree `ckam-build`; 8 local security commits `3e134c1` … `d04779a`, **none pushed, none deployed**), the VAPT evidence under `docs/security/evidence/`, and the final retest |
| Companion files | `CKAM_ISO27001_CONTROL_MATRIX.csv` / `.xlsx` (all 93 Annex A controls), `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_THREAT_MODEL.md`, `CKAM_SECURITY_BASELINE.md`, `CKAM_SECURITY_EVIDENCE_INDEX.md` |
| Related reports (separate writer) | `CKAM_VAPT_REPORT.md` (test report), `CKAM_SECURITY_FINDINGS_REGISTER.md` (authoritative finding list), `CKAM_SECURITY_REMEDIATION_REPORT.md` (fixes, commits, retest). This document links to them and does not repeat their detail |

> **This is a readiness assessment, not a certification.** CKAM is **not** ISO/IEC 27001 certified. Only an
> accredited, independent certification body can certify an Information Security Management System (ISMS),
> after a formal Stage 1 and Stage 2 audit. Nothing in this document is a certificate, an audit opinion or
> a promise that certification will be granted. Where no evidence exists the text says **NOT EVIDENCED**.

---

## 1. In plain words (for the owner)

**What was checked.** On 2026-10-15 the engineering team ran a full security test of CKAM (VAPT): 636 test
cases across access control (467), sign-in and sessions (102) and input handling (67), plus database,
infrastructure and dependency checks. The same day the code findings were fixed in 8 local commits and
retested (646 + 310 retest cases; no original finding left unretested). This document asks one question:
*if CityKart wanted ISO 27001 one day, how far is CKAM from it?*

**Important:** every fix is a **local commit on the dev PC**. Nothing has been pushed or deployed. The live
server still runs release `3b5e842`, with every original weakness, until the owner asks for a deploy.

**What is good.** The application itself is well built for security:
- A person can only do what their access level allows, and the server checks it every time. In 217 routes
  tried by 11 different kinds of user, no one could raise their own rights.
- Every change to data is written to an audit trail that the application cannot edit or delete
  (122 write routes classified: 107 audited, 15 intentionally not, 0 forgotten).
- Asset history (who held which laptop, when) is append-only, like a bank statement.
- No SQL injection, no cross-site scripting, Excel exports cannot carry formulas, passwords are stored with
  Argon2id and never appear in any log.
- After remediation (in code, not yet live): sign-in is rate-limited, sessions end when a person is switched
  off or their rights change, passwords must pass a policy, oversized requests are refused, the browser gets
  a Content-Security-Policy, API docs are hidden in production, uploaded documents are checked by content, the
  audit tables cannot be emptied with TRUNCATE, and the app refuses to start in production with a weak secret.

**What is urgent.** Think of the live server as a shop with a strong safe but a back window left open:
- **IF-01 (CRITICAL):** the live server (release `3b5e842` on 10.0.1.98) still answers requests that ask
  for files *outside* the website folder, for example the settings file that holds the database password and
  the JWT secret (the key that signs every login). The fix exists and is retested on the dev PC (commit
  `3e134c1`) but is **not deployed**. Because the site is reachable from the internet, this must be treated
  as an incident: deploy the fix, then change every secret on that server (EXT-01 to EXT-03).
- **IF-02 (HIGH):** passwords travel over the internet without encryption (plain `http://`), so anyone on
  the path (public Wi-Fi in a store, an ISP) can read them. HTTPS is needed (EXT-04).
- Backups sit on the same database server and have never been restored in production (IF-08).

**What is missing for ISO.** ISO 27001 is mostly about *management*: written policies, named owners, a risk
register that someone owns, access reviews, an incident plan, supplier checks, training, internal audit and
management review. For CKAM almost none of this exists on paper yet. That is normal for an internal app at
this stage, but it is the larger part of the work.

**Verdict:** `ISO 27001 TECHNICAL READINESS PARTIAL` (unchanged after remediation; see section 12). The
application code is now strong and retested; production still has the critical exposure until deployed;
HTTP login, shared servers, backups and the SYSTEM service remain; organisational controls are largely absent.

---

## 2. Scope

### 2.1 Proposed ISMS scope statement (draft, for management to approve)

> "The information security management system covering the development, operation and support of the CityKart
> Asset Manager (CKAM) application, its production application folder and service on server 10.0.1.98, its
> database `ckassetmanagement` on 10.0.0.205, its document folder on NAS 10.0.0.25, its backups, its read-only
> connection to the ERP data warehouse, its development environment on 10.0.0.47 and its source-code
> repository."

### 2.2 In scope (facts from `docs/ai/PRODUCTION_INFRASTRUCTURE.md`, `CLAUDE.md`)

| Component | Where | Notes |
|---|---|---|
| CKAM application (FastAPI backend + React frontend, one uvicorn process, port 3211) | 10.0.1.98, `D:\Citykart_Applications\Citykart_AssetManagement_App` | Scheduled task `CKAM-Web`, runs as SYSTEM (IF-07). Public address via router port-forward of TCP 3211 |
| Database `ckassetmanagement`, role `ckassetapp` | 10.0.0.205, PostgreSQL 18 | `pg_hba.conf` allows the role only from 10.0.1.98/32 |
| Uploaded documents | NAS 10.0.0.25, `CKASSETMANAGEMENT_DATA` folder | NAS user `ckappuser` |
| Backups | Task `CK_Backup_CKASSETMANAGEMENT` on 10.0.0.205, daily 03:00, 30 days | Not copied off the DB server (IF-08) |
| ERP read-only link | ERP warehouse 10.0.1.69 (role `ckpost`) | CKAM keeps its own copy, refreshed every 30 minutes |
| Development | Dev PC 10.0.0.47 (Docker Compose stack) | Holds dev `.env`, dev dumps and a copy of real ERP data (IF-09) |
| Source code | Git repository; remote `origin` on GitHub | Single author, 290 commits at `d04779a` (8 security commits not yet pushed), no CI (IF-17) |

### 2.3 Out of scope (and why)

| Item | Reason |
|---|---|
| Spinwheel, Citykart Desk | Other applications that share 10.0.1.98, 10.0.0.205 and the NAS. They are a *risk to* CKAM (R-06) but not part of it |
| The ERP and its warehouse (10.0.1.69) | Owned by another team; CKAM only reads it. The connection's security is in scope |
| CityKart corporate network, e-mail, endpoints | Corporate IT controls; inherited, must be evidenced by CityKart IT |
| Old server 10.0.1.12 | Retired 2026-10-07 for CKAM; must stay dead. It keeps an archive (bootstrap accounts only); its protection is a CityKart IT duty |

---

## 3. ISMS assumptions

1. CityKart has **no ISMS documentation for CKAM** today. No approved policies, risk methodology, Statement of
   Applicability, internal audit or management review were found (NOT EVIDENCED).
2. People (A.6) and physical (A.7) controls are **inherited** from CityKart HR, Facilities and IT. This
   assessment could not see them, so they are marked NOT EVIDENCED, not "missing".
3. Management will appoint an **ISMS lead** and approve the scope in section 2.1.
4. Finding statuses are the **final** statuses given by the security lead on 2026-10-15 after remediation
   and retest. `FIXED` means fixed in a local commit and retested, **not deployed**. A control whose code is
   fixed but not deployed is not counted READY unless the control is about development practice itself
   (A.8.28, A.8.29).
5. Certification needs the ISMS to have **operated** (records of risk treatment, internal audit and management
   review at least once) before an accredited certification body performs Stage 1 and Stage 2. This document
   does not estimate the certification body's decision.

---

## 4. Technical controls versus organisational controls

| Kind | Meaning | Who can close the gap | Examples for CKAM |
|---|---|---|---|
| **Technical control** | Built into the code, database or server configuration | Developers (code), IT/Infra (servers) | Role checks on every route, append-only triggers, Argon2id, redaction, HTTPS, backups |
| **Organisational / process control** | A written rule plus people doing it on a schedule, with records | Management, ISMS lead, HR, IT | Policies, access reviews, incident plan, supplier review, training, internal audit |

Gaps that code cannot fix are labelled **ORGANIZATIONAL / PROCESS GAP**. Gaps that need server, network or
supplier work are labelled **OPEN EXTERNAL / INFRASTRUCTURE ACTION** and listed in
`CKAM_EXTERNAL_SECURITY_ACTIONS.md`.

In the control matrix, the column **Technical Control** starts with a tag: `TECH READY`, `TECH PARTIAL`,
`TECH MISSING`, `TECH NOT EVIDENCED` or `NO TECH COMPONENT`. The **Status** column is the overall readiness of
the control (technical and process together).

---

## 5. Annex A readiness by theme (ISO/IEC 27001:2022, 93 controls)

Counts are computed from `CKAM_ISO27001_CONTROL_MATRIX.csv` by the converter script (section 14).

### 5.1 Overall status per theme

| Theme | Controls | READY | PARTIAL | MISSING | NOT EVIDENCED | N/A |
|---|---|---|---|---|---|---|
| A.5 Organizational | 37 | 0 | 19 | 10 | 8 | 0 |
| A.6 People | 8 | 0 | 2 | 1 | 5 | 0 |
| A.7 Physical | 14 | 0 | 0 | 1 | 13 | 0 |
| A.8 Technological | 34 | 5 | 22 | 1 | 5 | 1 |
| **Total** | **93** | **5** | **43** | **13** | **31** | **1** |

Change after remediation: A.8.28 Secure coding moved from PARTIAL to READY. Everything else keeps its
overall status because the fixes are not yet in production or the remaining gap is organisational.

Applicability: 89 YES, 3 PARTIAL (A.5.23 cloud services, A.8.11 data masking, A.8.30 outsourced development),
1 NO (A.8.23 web filtering, a corporate network control).

### 5.2 Technical component per theme

| Theme | TECH READY | TECH PARTIAL | TECH MISSING | TECH NOT EVIDENCED | No technical component (purely organisational) |
|---|---|---|---|---|---|
| A.5 Organizational | 3 | 19 | 1 | 0 | 14 |
| A.6 People | 2 | 0 | 1 | 0 | 5 |
| A.7 Physical | 0 | 4 | 1 | 0 | 9 |
| A.8 Technological | 6 | 21 | 1 | 5 | 1 |
| **Total** | **11** | **44** | **4** | **5** | **29** |

- **Technical controls ready (11):** A.5.3 role separation in the app, A.5.11 custody/return of assets,
  A.5.15 backend-authoritative access control, A.6.5 sessions end on leaving or role change (token_version),
  A.6.8 Report a problem, A.8.3 company/work-area restriction (AC-1, AC-2, IF-03 fixed), A.8.11 secret
  masking, A.8.28 secure coding, A.8.29 security testing, A.8.31 environment separation, A.8.34 safe audit
  testing. (Before remediation: 8.)
- **Fully ready controls (5):** A.8.11, A.8.28, A.8.29, A.8.31, A.8.34. Others whose technical part is ready
  still need deployment, a written policy or a periodic review to count as ready.
- **Organisational / process gaps:** 87 of the 92 applicable controls need at least one organisational,
  process or deployment action; 29 controls have no technical component at all.
- Controls that become READY on deployment (EXT-01): A.8.3. Controls that need the external actions as well:
  A.8.5 (HTTPS, MFA decision), A.8.13 (backups), A.8.20 / A.8.21 / A.8.24 (TLS, port-forward, N2).

---

## 6. Findings that drive this assessment (FINAL status 2026-10-15)

The authoritative list, with full detail and retest evidence, is `CKAM_SECURITY_FINDINGS_REGISTER.md`; the
fixes are described in `CKAM_SECURITY_REMEDIATION_REPORT.md`. This table only summarises what matters for
readiness.

Status words: `FIXED` (fixed in a local commit and retested; **not pushed, not deployed**), `MITIGATED` (risk
reduced, a residual remains), `ACCEPTED` (deliberate design or compensating control), `OPEN EXTERNAL` (needs
server, network, supplier or management action), `OPEN DECISION` (owner decision needed).

| ID | Severity | Plain description | Final status | Commit / note |
|---|---|---|---|---|
| IF-01 (= IN-01) | **CRITICAL** | `/assets/...` served files outside the frontend folder (path traversal / arbitrary file read) on the single-port production server; in every release since 2026-09-30 incl. live `3b5e842` | Code: **FIXED** (`3e134c1`). **Production: STILL EXPOSED** until deployed and secrets rotated | EXT-01, EXT-02, EXT-03 (URGENT) |
| IF-02 / AU-13 | HIGH | Login and all traffic over plain HTTP, also from the internet; refresh cookie not `Secure` | OPEN EXTERNAL | EXT-04, EXT-05 |
| IF-03 | MEDIUM | ERP PO draft of another company readable | FIXED | `7e57844` |
| IF-04 / AU-09 | MEDIUM | Production could start with a placeholder JWT secret | FIXED (any `ENVIRONMENT_NAME` outside the development/test list counts as production; secret must be ≥ 32 characters with ≥ 8 distinct) | `7e57844`, `d04779a` |
| IF-05 / AU-10, IF-06 | MEDIUM | Audit tables could be TRUNCATEd; DB owner/superuser can bypass the append-only triggers | MITIGATED: TRUNCATE guards + 5-year audit purge floor (migration `a3c5e7f9b1d4`). Residual: owner/superuser can still drop triggers → role split | `ae706bb`; EXT-07 |
| IF-07 | MEDIUM | Service runs as SYSTEM on a shared server | OPEN EXTERNAL | EXT-06 |
| IF-08 | MEDIUM | Backups on the same DB server, unencrypted, never restore-tested in production | OPEN EXTERNAL | EXT-08 |
| IF-09 | MEDIUM | Dev PC `.env` and `backups\` readable too widely | OPEN EXTERNAL (local admin action) | EXT-10 |
| IF-10 | MEDIUM | ERP reads without timeouts | FIXED | `ae706bb` |
| AU-01 | MEDIUM | Sign-in timing revealed whether an account exists | FIXED | `ae706bb` |
| AU-03 | MEDIUM | No per-address sign-in rate limit | FIXED (429; 20 sign-ins per minute per address) | `ae706bb` |
| AU-04 | MEDIUM | Lock-out can be used to lock a real user out | MITIGATED (rate limit); residual lock-out DoS | `ae706bb` |
| AU-05 | MEDIUM | Logout did not revoke the refresh token | FIXED (`token_version`, migration `f9a1c3e5b7d2`) | `ae706bb` |
| AC-1 | MEDIUM | Own Assets Only logins could read setup lists incl. vendor contacts | FIXED | `77431ba` |
| IF-11 | LOW | No Python lock file | FIXED in code (`backend/constraints.txt`); using it in the production install is external | `ae706bb`; EXT-12 |
| IF-12 | LOW | python-jose / ecdsa advisories | ACCEPTED (not reachable: HS256 pinned, no ECDSA use) | — |
| IF-13 | LOW | Container image runs as root with dev dependencies | OPEN EXTERNAL (dev image only; production does not use Docker) | — |
| N3 | LOW | Docker-only dev observation | ACCEPTED (Docker is dev only) | — |
| IF-14 / AU-11 | LOW | `/docs`, `/openapi.json` open in production | FIXED (off in production) | `ae706bb` |
| IF-15 | LOW | Runbook describes Docker; production launcher and release script not in git | OPEN EXTERNAL / PROCESS | EXT-13 |
| IF-16 | LOW | ERP connection without TLS; read-only by connection default | OPEN EXTERNAL | EXT-25 |
| N2 | LOW | uvicorn trusts `X-Forwarded-For` from 127.0.0.1 by default | OPEN EXTERNAL: start production uvicorn with `--no-proxy-headers` | EXT-38 |
| AU-02 | LOW | Locked account answers 423 | ACCEPTED: 423 for any password on a locked account, deliberately, so it is not a password-guessing oracle | — |
| AU-06 | LOW | Refresh-token rotation | MITIGATED: rotated on each refresh; an older rotated token stays valid until sign-out or expiry | `ae706bb` |
| AU-07 | LOW | Switching off a login left the access token valid up to 15 minutes | FIXED (`token_version`) | `ae706bb` |
| AU-08 | LOW | Weak password policy | FIXED (policy incl. common words with numbers; retest gap closed) | `ae706bb`, `d04779a` |
| AU-12 | LOW | Source maps reachable | FIXED (no source maps) | `4fa5c9b` |
| AU-14 | LOW | No CSP / Permissions-Policy | FIXED | `4fa5c9b`, `ae706bb` |
| AU-15 | LOW | Server banner; body cap only in nginx | FIXED (request-size limits in the app, N1) | `4fa5c9b`, `d04779a` |
| AU-16 | LOW | Lock-out counter race | FIXED | `ae706bb` |
| AC-2 | LOW | Custom fields not company-scoped | FIXED | `77431ba` |
| IN-02 | LOW | Import uploads read without size limit | FIXED (15 MB, 413) | `ba04371` |
| IN-03 | INFO | Documents checked by extension only | FIXED (file-signature check) | `ae706bb` |
| N1 | LOW | No general request-size limit | FIXED (413: 64 KB sign-in, 5 MB JSON, 16 MB uploads) | `d04779a` |
| N4 | LOW | Unknown environment names treated as development | FIXED (treated as production) | `d04779a` |
| Login clash | LOW | An employee code equal to the Primary Owner's login could block that login | FIXED | `77431ba` |
| RACE-1 | LOW | Same-name vendor/brand created twice under concurrency | FIXED (serialized; concurrency tests) | `da790d1` |
| IF-17 | INFO | No CI / pre-commit; unsigned commits; single author | OPEN (process) | EXT-28 |
| D6 | INFO | Full Admins are not limited to chosen companies | OPEN DECISION | EXT-26 |
| MFA | INFO | No multi-factor authentication | OPEN DECISION | EXT-19 |

**Positive evidence (PASS areas and final test results):** 467-case access-control run (217 routes x 11
personas, zero privilege escalation, repeated in the retest); SQL injection safe (whitelisted sort columns,
escaped LIKE, bound parameters); XSS safe; formula injection neutralised in all exports; no SSRF, command
injection or unsafe deserialization; Argon2id and no plaintext password in DB, logs or audit; JWT HS256
pinned, tampering and `alg:none` rejected; UPDATE/DELETE (and now TRUNCATE) blocked on the append-only tables;
write-route audit coverage complete (107 audited + 15 intentionally not = 122 in `auth/audit_coverage.csv`;
the lead's summary quotes 108); no secrets in the working tree or in 282 scanned commits; npm production
audit 0 vulnerabilities; ERP code issues SELECT only. **Final retest:** 646 + 310 retest cases with 0
original findings left unretested; backend about 1,783 tests (final run number to be given by the lead);
frontend 1,239 tests in 90 files; Playwright security journeys 14/14 plus 11 permanent journeys (1 skipped
because the ERP link is intentionally off on the test stack). Detail: `CKAM_VAPT_REPORT.md`.

---

## 7. Evidence pointers (short list; full list in `CKAM_SECURITY_EVIDENCE_INDEX.md`)

| Area | File |
|---|---|
| Test report, findings register, remediation and retest | `docs/security/CKAM_VAPT_REPORT.md`, `docs/security/CKAM_SECURITY_FINDINGS_REGISTER.md`, `docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md` (separate writer) |
| Access control matrix | `docs/security/evidence/access/authz_matrix.csv`, `docs/security/evidence/access/tests.csv` |
| Authentication, sessions, audit coverage | `docs/security/evidence/auth/tests.csv`, `docs/security/evidence/auth/audit_coverage.csv`; regression tests `backend/tests/auth/test_vapt_login.py`, `test_rate_limit.py`, `test_vapt_sessions.py`, `test_vapt_password_policy.py` |
| Input handling | `docs/security/evidence/input/tests.csv`, `docs/security/evidence/input/raw_sql_review.md`; `backend/tests/core/test_body_limit.py`, `backend/tests/documents/test_vapt_content_check.py`, `backend/tests/core/test_security_concurrency.py` |
| Database integrity and privileges | `docs/security/evidence/infra/db_01_roles_privileges.out.txt` to `db_05_data_integrity.out.txt`, `docs/security/evidence/infra/sql/`; `backend/tests/observability/test_vapt_append_only.py`; migration `backend/app/alembic/versions/a3c5e7f9b1d4_append_only_truncate_and_purge_floor.py` |
| Path traversal and startup checks | `docs/security/evidence/infra/static_route_traversal_and_startup.txt`; `backend/tests/test_static_frontend.py`; `backend/tests/core/test_production_secret_guard.py` |
| Headers, docs, source maps | `backend/tests/test_vapt_headers_and_docs.py`; `frontend/e2e/security.spec.ts` |
| ERP cross-company and limits | `docs/security/evidence/infra/erp_cross_company_draft.txt`; `backend/tests/erp/test_vapt_erp_limits.py` |
| Dependencies | `docs/security/evidence/infra/dependency_audit.md`, `docs/security/evidence/infra/raw/`; `backend/constraints.txt` |
| Logging design | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| Production layout | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` |

Note: `docs/security/evidence/infra/dependency_audit.md` ends part-way through its Python table; the raw Python
results are complete in `docs/security/evidence/infra/raw/pip_audit.json`.

---

## 8. Main gaps (summary, final state)

| # | Gap | Type | Action |
|---|---|---|---|
| 1 | IF-01 still live in production (fix only local); secrets possibly exposed; all other code fixes also not deployed | OPEN EXTERNAL / INFRASTRUCTURE ACTION | EXT-01, EXT-02, EXT-03, EXT-39 |
| 2 | No encryption in transit; port 3211 forwarded from the internet; uvicorn trusts `X-Forwarded-For` from 127.0.0.1 (N2) | OPEN EXTERNAL / INFRASTRUCTURE ACTION | EXT-04, EXT-05, EXT-38 |
| 3 | Backups single-location, unencrypted, no production restore test | OPEN EXTERNAL / INFRASTRUCTURE ACTION | EXT-08 |
| 4 | Service as SYSTEM; DB runtime role owns the tables (can still drop triggers) | OPEN EXTERNAL / INFRASTRUCTURE ACTION | EXT-06, EXT-07 |
| 5 | No policies, roles, risk ownership | ORGANIZATIONAL / PROCESS GAP | EXT-17, EXT-36 |
| 6 | No access review, no MFA decision, D6 open | ORGANIZATIONAL / PROCESS GAP | EXT-18, EXT-19, EXT-26 |
| 7 | No incident response plan, no monitoring/alerting | ORGANIZATIONAL / PROCESS GAP + infrastructure | EXT-20, EXT-22 |
| 8 | No change records, no CI, prod scripts outside git, constraints file not used by the production install | ORGANIZATIONAL / PROCESS GAP | EXT-12, EXT-13, EXT-28, EXT-35 |
| 9 | Patching, AV/EDR, physical security, HR controls not evidenced | NOT EVIDENCED (inherited) | EXT-09, EXT-32, EXT-37 |
| 10 | No independent review | ORGANIZATIONAL / PROCESS GAP | EXT-14, EXT-36 |

---

## 9. CKAM information-security risk register (draft, needs an owner and management approval)

Scales: **Likelihood (L)** 1 rare, 2 unlikely, 3 possible, 4 likely, 5 almost certain. **Impact (I)** 1
negligible, 2 minor, 3 moderate, 4 major, 5 severe. **Risk = L x I.** Bands: 1-4 Low, 5-9 Medium, 10-16
High, 20-25 Critical. **L, I and Risk describe production today** (release `3b5e842`, none of the fixes
deployed). "Existing controls" marks controls that are fixed in code but not yet live as *(code, not
deployed)*. "Residual" is the expected L x I **after** the listed treatment, including deployment.

| ID | Risk (plain words) | Linked findings | L | I | Risk | Existing controls | Treatment | Owner | Residual |
|---|---|---|---|---|---|---|---|---|---|
| R-01 | Passwords and session data cross the internet unencrypted (plaintext HTTP login) | IF-02, AU-13 | 4 | 4 | **16 High** | Argon2id at rest; HttpOnly + SameSite refresh cookie; 15-min access token | HTTPS with COOKIE_SECURE and later HSTS (EXT-04) | IT/Infra | 1x4 = 4 Low |
| R-02 | Anyone on the internet reads files from the production server (path traversal) | IF-01 | 5 | 5 | **25 Critical** | Fix `3e134c1` retested *(code, not deployed)*; nothing in production | Deploy (EXT-01, EXT-39), assess logs (EXT-03) | CKAM owner + IT | 1x5 = 5 Medium |
| R-03 | Production secrets compromised (JWT secret lets an attacker forge any admin login; DB, NAS and ERP passwords) | IF-01, IF-04 | 4 | 5 | **20 Critical** | `shared\.env` and `nas.pw` Administrators/SYSTEM only; redaction; weak-secret start-up refusal *(code, not deployed)* | Rotate all secrets after the fix (EXT-02); password manager (EXT-23) | IT/Infra | 1x5 = 5 Medium |
| R-04 | Misuse of a privileged CKAM account (head-office admin or Full Admin working in every company) | D6, MFA | 3 | 4 | **12 High** | Head-office-only actions; grants audited; Full Admin cannot touch head-office admin; sessions end on role change *(code, not deployed)* | MFA decision (EXT-19), D6 (EXT-26), access review (EXT-18), audit review (EXT-22) | CKAM owner | 2x4 = 8 Medium |
| R-05 | Account takeover by password guessing from the internet | AU-01, AU-03, AU-08, AU-16 | 4 | 4 | **16 High** | Lockout 5 tries / 15 min; generic 401; rate limit, constant-time sign-in, password policy, race-safe counter *(code, not deployed)* | Deploy (EXT-01); VPN or HTTPS proxy; MFA for admins | Dev lead | 2x4 = 8 Medium |
| R-06 | A weakness in another app on the shared servers (Spinwheel, Citykart Desk) reaches CKAM | IF-07 | 3 | 4 | **12 High** | Separate folder, task, DB role, NAS folder; `pg_hba` /32 | Low-privilege service accounts; separation (EXT-06, EXT-24) | IT/Infra | 2x4 = 8 Medium |
| R-07 | CKAM runs as SYSTEM, so any CKAM flaw becomes full control of the Windows server | IF-07 | 3 | 5 | **15 High** | None specific | Dedicated low-privilege service account (EXT-06) | IT/Infra | 2x3 = 6 Medium |
| R-08 | ERP credential leakage or ERP link misuse | IF-16, IF-10 | 2 | 4 | **8 Medium** | Read-only role `ckpost`; `default_transaction_read_only`; SELECT-only code; ERP timeouts *(code, not deployed)* | SELECT-only grant + TLS on ERP side (EXT-25) | ERP owner + Dev lead | 1x4 = 4 Low |
| R-09 | Unauthorised or fraudulent asset movement (custody manipulation) | — | 3 | 3 | **9 Medium** | RBAC + work area; single writer `apply_events`; append-only `asset_event`; actor and IP in audit | Periodic movement review and physical verification | CKAM owner | 2x3 = 6 Medium |
| R-10 | Data of another company or work area exposed | IF-03, AC-1, AC-2 | 3 | 3 | **9 Medium** | 208 IDOR cases pass; fixes retested *(code, not deployed)* | Deploy (EXT-01); guardrail: cross-company test on every new route | Dev lead | 1x3 = 3 Low |
| R-11 | Personal data leak (staff names, emails, phones, vendor contacts, IP addresses) through exports, logs or backups | AC-1 | 3 | 3 | **9 Medium** | Logs head-office-only; redaction; exports audited | Classification, encrypted backups, export rules, legal review (EXT-31) | ISMS lead | 2x3 = 6 Medium |
| R-12 | Audit trail tampered with by the DB owner or superuser | IF-05, IF-06, AU-10 | 2 | 4 | **8 Medium** | Row triggers on UPDATE/DELETE; guarded purge; TRUNCATE guards + 5-year purge floor *(code, not deployed)* | Owner/runtime role split (EXT-07); off-server log copy (EXT-21) | DBA | 1x4 = 4 Low |
| R-13 | Data loss: backups only on the DB server, unencrypted, never restored in production | IF-08 | 3 | 5 | **15 High** | Daily dump, 30 days | Off-server encrypted copy + quarterly restore test + NAS backup (EXT-08) | IT/Infra | 1x5 = 5 Medium |
| R-14 | Ransomware encrypts app server, DB server or NAS | IF-07, IF-08 | 3 | 5 | **15 High** | NOT EVIDENCED (no CKAM-specific control) | Offline/immutable backup copy, EDR, patching, least privilege (EXT-08, EXT-09, EXT-37) | IT/Infra | 2x4 = 8 Medium |
| R-15 | Vulnerable third-party package | IF-11, IF-12, IF-13 | 3 | 3 | **9 Medium** | npm production audit 0; HS256 pinned; `backend/constraints.txt` *(not yet used by the production install)* | Use constraints in deploy; monthly audits; consider replacing python-jose (EXT-12) | Dev lead | 2x2 = 4 Low |
| R-16 | A user is given the wrong company, work area or access level | — | 3 | 3 | **9 Medium** | Limited Full Admin cannot widen others; ACCESS_CHANGED audited | Quarterly access review (EXT-18) | CKAM owner | 2x2 = 4 Low |
| R-17 | Unpatched Windows, Python, PostgreSQL or NAS firmware | — | 3 | 4 | **12 High** | NOT EVIDENCED | Patch policy and records (EXT-09) | IT/Infra | 2x3 = 6 Medium |
| R-18 | Port 3211 forwarded from the internet: scanning, exploitation, brute force, DoS | IF-01, IF-02, AU-03 | 5 | 4 | **20 Critical** | Firewall rule; login lockout; rate limit *(code, not deployed)* | Close the forward or restrict to VPN; or HTTPS reverse proxy (EXT-05, EXT-04) | IT/Infra | 2x3 = 6 Medium |
| R-19 | A session keeps working after logout or after a login is switched off | AU-05, AU-06, AU-07 | 2 | 3 | **6 Medium** | 15-min access token; deactivation revokes at once; `token_version` revocation (AU-05, AU-07 fixed), rotation per refresh (AU-06 mitigated) *(code, not deployed)* | Deploy (EXT-01) | Dev lead | 1x3 = 3 Low |
| R-20 | Information that helps an attacker is exposed (API docs, source maps, banners) | IF-14, AU-11, AU-12, AU-15 | 3 | 2 | **6 Medium** | Docs off in production, no source maps, banners removed, CSP *(code, not deployed)*; AU-02 accepted by design | Deploy (EXT-01) | Dev lead | 1x2 = 2 Low |
| R-21 | Denial of service (lock-out DoS, oversized requests, ERP calls without timeout, lock-out race) | AU-04, IN-02, N1, IF-10, AU-16 | 3 | 3 | **9 Medium** | Document cap; import cap, request-size limits, rate limit, ERP timeouts, race fix *(code, not deployed)*; AU-04 residual | Deploy (EXT-01); monitor 429s and lock-outs (EXT-22) | Dev lead | 2x2 = 4 Low |
| R-22 | Malicious file uploaded as an asset document | IN-03 | 2 | 2 | **4 Low** | Extension allowlist, size cap, server-generated path, attachment + nosniff; file-signature check *(code, not deployed)* | AV scan (EXT-37) | Dev lead | 1x2 = 2 Low |
| R-23 | A change breaks security or production (no CI, prod scripts outside git, manual steps; new code refuses to start if production settings are wrong) | IF-15, IF-17 | 3 | 4 | **12 High** | Owner approves push and deploy; backup first; release folders; rollback; security rules in the guardrails | Pre-deploy checks (EXT-39); scripts in git, change records, CI (EXT-13, EXT-28, EXT-35) | Dev lead | 2x3 = 6 Medium |
| R-24 | Key-person dependency: one developer, one owner holds every secret and runs every deploy | IF-17 | 3 | 4 | **12 High** | Docs in `docs/ai/` | Second trained admin; vault with break-glass (EXT-23); RACI | Management | 2x3 = 6 Medium |
| R-25 | Dev PC compromise exposes dev `.env`, old dumps and the real ERP copy | IF-09 | 3 | 3 | **9 Medium** | `.env` and `backups/` gitignored | ACL, disk encryption, purge old dumps (EXT-10) | Dev lead | 1x3 = 3 Low |
| R-26 | Source code repository not under company control (personal GitHub account; MFA and visibility not evidenced) | IF-17 | 2 | 3 | **6 Medium** | No secrets in history | Company-owned repo, MFA, branch protection (EXT-28) | Management | 1x2 = 2 Low |
| R-27 | A security incident goes unnoticed (no alerts on lockouts, errors, backup or ERP failures) | — | 4 | 3 | **12 High** | Data recorded in `audit_log`, `error_log`, `system_event` | Alerting and weekly review (EXT-22) | IT/Infra | 2x3 = 6 Medium |
| R-28 | Physical loss or damage of servers or NAS | — | 2 | 5 | **10 High** | NOT EVIDENCED | Confirm server-room controls; off-site backup (EXT-08, EXT-29) | Facilities + IT | 1x5 = 5 Medium |
| R-29 | Fonts loaded from Google: staff IP addresses go to a third party; page depends on an external site | — | 3 | 1 | **3 Low** | — | Self-host fonts (EXT-11) | Dev lead | 1x1 = 1 Low |
| R-30 | Shared store logins (`sm.<code>@citykartstores.com`) used by several staff, so actions cannot be tied to a person | — | 4 | 2 | **8 Medium** | Each store has its own login; actions audited per login | Store-login rule or named logins (EXT-30) | CKAM owner + HR | 2x2 = 4 Low |
| R-31 | Non-compliance with law (personal-data protection, cyber-incident reporting, record keeping) | — | 3 | 3 | **9 Medium** | NOT EVIDENCED | Legal review (EXT-31) | Legal | 2x2 = 4 Low |
| R-32 | Wrong client address recorded or rate limit sidestepped because uvicorn trusts `X-Forwarded-For` from 127.0.0.1 (a process on the shared server could forge it) | N2 | 2 | 2 | **4 Low** | App believes forwarded addresses only from `TRUSTED_PROXIES` (empty by default) | Start uvicorn with `--no-proxy-headers` (EXT-38) | IT/Infra | 1x2 = 2 Low |
| R-33 | Many store or office users behind one NAT address share the sign-in rate limit (20 per minute per address) and are refused at busy times | AU-03 | 2 | 2 | **4 Low** | Limit is per address and per login id; 429 with Retry-After and a plain message *(code, not deployed)* | Watch 429 counts after deploy; adjust `RATE_LIMIT_LOGIN_PER_IP` if needed (EXT-40) | IT + Dev lead | 1x2 = 2 Low |

Risk summary (33 risks): 3 Critical (R-02, R-03, R-18; all tied to IF-01/IF-02 and internet exposure),
12 High, 14 Medium, 4 Low. The remediation lowers the **residual** of R-05, R-10, R-12, R-19, R-20, R-21 and
R-22 once deployed, but **none of the inherent production scores falls until EXT-01 is done**. After the
listed treatments no risk stays above Medium (highest residual 8).

---

## 10. DRAFT readiness mapping for all 93 Annex A controls (this is NOT the Statement of Applicability)

A Statement of Applicability (SoA) is a formal ISMS document that management approves after the risk
assessment. The table below is only a **draft readiness mapping** to help write it. "Treats R-xx" links the
control to the risk register above as the reason for applicability. Full detail (technical control, process
control, owner, recommended action, evidence needed) is in `CKAM_ISO27001_CONTROL_MATRIX.csv` / `.xlsx`.

| Control | Title | Applicable | Reason | Current evidence | Gap | Status |
|---|---|---|---|---|---|---|
| A.5.1 | Policies for information security | YES | Treats R-24 (High), R-31 (Medium) | CLAUDE.md; docs/ai/DEVELOPMENT_GUARDRAILS.md (engineering rules only); docs/security/CKAM_SECURITY_BASELINE.md (draft 2026-10-15) | No approved ISMS policy set exists; only engineering guardrails | **MISSING** |
| A.5.2 | Information security roles and responsibilities | YES | Treats R-24 (High) | CLAUDE.md (owner approves every push and every deploy); docs/ai/CKAM_PRODUCTION_SERVER_CHECKLIST.md (backup, restore and rollback owners listed as Not yet assigned) | Only push/deploy approval is defined; operational security roles are unassigned | **PARTIAL** |
| A.5.3 | Segregation of duties | YES | Treats R-23 (High), R-24 (High) | backend/app/core/capabilities.py; docs/ai/DECISIONS.md 2026-10-14 entries (3),(5),(8); docs/security/evidence/access/tests.csv (17 escalation cases, 0 failures) | One person writes code, commits and (with owner approval) deploys; no independent code review (IF-17) | **PARTIAL** |
| A.5.4 | Management responsibilities | YES | Treats R-24 (High) | NOT EVIDENCED | No evidence of management direction on information security | **NOT EVIDENCED** |
| A.5.5 | Contact with authorities | YES | Treats R-31 (Medium) | NOT EVIDENCED | No authority contact list or reporting procedure | **NOT EVIDENCED** |
| A.5.6 | Contact with special interest groups | YES | Treats R-15 (Medium), R-17 (High) | NOT EVIDENCED | No subscriptions evidenced | **NOT EVIDENCED** |
| A.5.7 | Threat intelligence | YES | Treats R-15 (Medium) | docs/security/evidence/infra/dependency_audit.md; docs/security/evidence/infra/raw/pip_audit.json; docs/security/evidence/infra/raw/npm_audit_prod.json (one-off run 2026-10-15) | Only a one-off scan exists; no ongoing threat-intelligence process | **MISSING** |
| A.5.8 | Information security in project management | YES | Treats R-23 (High) | docs/ai/CKAM_SIMPLIFICATION_S0_REPORT.md (security fixes before redesign); docs/ai/AM-09_RC_FULL_AUDIT_REPORT.md; docs/ai/DECISIONS.md 2026-10-14 (1) guardrails; this VAPT evidence set | Security is applied by practice, not by a mandatory project step | **PARTIAL** |
| A.5.9 | Inventory of information and other associated assets | YES | Treats R-11 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (servers, folders, DB, NAS, task, firewall rule); docs/ai/ERP_INTEGRATION.md; docs/security/evidence/infra/raw/pip_freeze_image.txt; frontend/package-lock.json | No formal information-asset register with owners and classification | **PARTIAL** |
| A.5.10 | Acceptable use of information and other associated assets | YES | Treats R-30 (Medium), R-11 (Medium) | NOT EVIDENCED | No acceptable-use policy evidenced | **NOT EVIDENCED** |
| A.5.11 | Return of assets | YES | Treats R-09 (Medium) | docs/ai/DECISIONS.md 2026-10-14 (9) (a person or place that still holds assets cannot be deactivated); Move screen Return to Stock Room (docs/ai/DECISIONS.md (10)) | Leaver process linking HR and CKAM not evidenced | **PARTIAL** |
| A.5.12 | Classification of information | YES | Treats R-11 (Medium) | NOT EVIDENCED (de facto: logs are head-office-admin only, docs/ai/LOGGING_AND_DIAGNOSTICS.md section 9) | No classification scheme | **MISSING** |
| A.5.13 | Labelling of information | YES | Treats R-11 (Medium) | NOT EVIDENCED | Exports are unlabelled | **MISSING** |
| A.5.14 | Information transfer | YES | Treats R-01 (High), R-11 (Medium) | docs/security/evidence/input/formula_export_cell.txt; docs/ai/LOGGING_AND_DIAGNOSTICS.md (EXPORT audit rows); docs/ai/PRODUCTION_INFRASTRUCTURE.md (plain HTTP) | Transfer over the internet is unencrypted; no transfer rules | **PARTIAL** |
| A.5.15 | Access control | YES | Treats R-04 (High), R-10 (Medium) | docs/security/evidence/access/authz_matrix.csv (217 routes x 11 personas, zero escalation, also in the final retest); docs/security/evidence/access/tests.csv; backend/app/core/capabilities.py; backend/app/core/deps.py; docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md (AC-1, AC-2, IF-03 FIXED: commits 77431ba, 7e57844) | No written access-control policy; D6 open; fixes not yet in production | **PARTIAL** |
| A.5.16 | Identity management | YES | Treats R-30 (Medium), R-16 (Medium) | docs/security/evidence/infra/db_02_triggers_constraints.out.txt (unique company+code and company+email); docs/ai/DECISIONS.md 2026-10-14 (9) store logins sm.<code>@citykartstores.com | No JML procedure; store logins are shared identities | **PARTIAL** |
| A.5.17 | Authentication information | YES | Treats R-05 (High), R-01 (High), R-03 (Critical) | docs/security/evidence/auth/tests.csv AU-T044..AU-T050 (Argon2id, temporary password shown once, must change at first sign-in) | Plaintext transport; server secrets handling not formalised; new policy not yet deployed | **PARTIAL** |
| A.5.18 | Access rights | YES | Treats R-04 (High), R-16 (Medium) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (ACCESS_CHANGED, PRIMARY_OWNER_GRANTED/_REVOKED rows); GET /api/asset-users/export (docs/security/evidence/access/authz_matrix.csv) | No periodic access review; grants have no request/approval record | **PARTIAL** |
| A.5.19 | Information security in supplier relationships | YES | Treats R-26 (Medium), R-08 (Medium) | NOT EVIDENCED (suppliers in scope: ERP warehouse team, NAS, GitHub, AI coding assistant provider, Google Fonts, Python/npm ecosystems) | No supplier security process | **MISSING** |
| A.5.20 | Addressing information security within supplier agreements | YES | Treats R-26 (Medium) | NOT EVIDENCED | No agreements evidenced | **NOT EVIDENCED** |
| A.5.21 | Managing information security in the ICT supply chain | YES | Treats R-15 (Medium) | frontend/package-lock.json; docs/security/evidence/infra/raw/npm_audit_prod.json (0 production vulnerabilities); docs/security/evidence/infra/dependency_audit.md; backend/pyproject.toml; backend/constraints.txt (IF-11 FIXED: file added in ae706bb) | Production deploy not yet wired to constraints.txt | **PARTIAL** |
| A.5.22 | Monitoring, review and change management of supplier services | YES | Treats R-08 (Medium) | docs/ai/ERP_INTEGRATION.md (sync_success / sync_failed system events; ERP data as of); docs/ai/LOGGING_AND_DIAGNOSTICS.md (diagnostics/health minutes since last ERP copy) | No scheduled review; grant-loss risk documented but not monitored | **PARTIAL** |
| A.5.23 | Information security for use of cloud services | PARTIAL | Treats R-26 (Medium), R-29 (Low) | git remote origin = GitHub (repository under a personal GitHub account); frontend/index.html loads Google Fonts; commits co-authored by an AI coding assistant | Repository ownership, visibility and MFA not evidenced; no cloud-use rules | **NOT EVIDENCED** |
| A.5.24 | Information security incident management planning and preparation | YES | Treats R-27 (High), R-02 (Critical) | docs/ai/LOGGING_AND_DIAGNOSTICS.md section 1 (request id support workflow) and section 10 (playbook); frontend/src/features/support/report-problem-store.ts | No incident response plan | **MISSING** |
| A.5.25 | Assessment and decision on information security events | YES | Treats R-27 (High) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (error grouping by fingerprint; SECURITY rows) | No triage criteria | **MISSING** |
| A.5.26 | Response to information security incidents | YES | Treats R-02 (Critical), R-03 (Critical) | NOT EVIDENCED (IF-01 response: fix in commit 3e134c1, retested; production deploy and secret rotation still pending) | No documented response; IF-01 production exposure not yet contained | **MISSING** |
| A.5.27 | Learning from information security incidents | YES | Treats R-23 (High) | docs/ai/REVIEW_FINDINGS.md; docs/ai/RC_ISSUES.md; docs/security/evidence/ (findings with regression tests) | Lessons captured informally | **PARTIAL** |
| A.5.28 | Collection of evidence | YES | Treats R-12 (Medium) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (audit_log append-only, request id, actor, IP; export as jsonl); docs/security/evidence/infra/db_03_append_only_privilege_tests.out.txt | Evidence integrity not protected against the DB owner; no off-server copy | **PARTIAL** |
| A.5.29 | Information security during disruption | YES | Treats R-13 (High) | NOT EVIDENCED | Not addressed | **MISSING** |
| A.5.30 | ICT readiness for business continuity | YES | Treats R-13 (High), R-14 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (daily dump 03:00, 30 days; previous releases kept for rollback; scheduled task restarts every minute) | No agreed recovery objectives; never restored in production | **PARTIAL** |
| A.5.31 | Legal, statutory, regulatory and contractual requirements | YES | Treats R-31 (Medium) | NOT EVIDENCED | No legal register | **NOT EVIDENCED** |
| A.5.32 | Intellectual property rights | YES | Treats R-15 (Medium) | frontend/package-lock.json and docs/security/evidence/infra/raw/pip_freeze_image.txt list components; licences not reviewed | Licences not reviewed | **NOT EVIDENCED** |
| A.5.33 | Protection of records | YES | Treats R-12 (Medium), R-13 (High) | docs/security/evidence/infra/db_02_triggers_constraints.out.txt (9 append-only / identity triggers); docs/security/evidence/auth/tests.csv AU-T091..AU-T093; CLAUDE.md rule 2 (no hard deletes) | Owner/superuser can still destroy records; backups not off-server | **PARTIAL** |
| A.5.34 | Privacy and protection of personal identifiable information (PII) | YES | Treats R-11 (Medium), R-31 (Medium) | docs/ai/LOGGING_AND_DIAGNOSTICS.md section 3 (redaction) and section 9 (privacy notes); backend/app/observability/redact.py; docs/security/evidence/auth/tests.csv AU-T049 | No privacy notice or PII retention rule | **PARTIAL** |
| A.5.35 | Independent review of information security | YES | Treats R-23 (High) | docs/security/evidence/ (internal VAPT 2026-10-15 by the engineering team, not independent) | No independent review | **MISSING** |
| A.5.36 | Compliance with policies, rules and standards for information security | YES | Treats R-23 (High) | backend/tests/observability/test_coverage_walker.py (fails on any unclassified write route); backend/tests/conftest.py (refuses tests on the plain ckam DB); docs/ai/DEVELOPMENT_GUARDRAILS.md security rules | Policies to comply with do not exist yet | **PARTIAL** |
| A.5.37 | Documented operating procedures | YES | Treats R-23 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md; docs/ai/LOGGING_AND_DIAGNOSTICS.md; docs/ai/CKAM_RELEASE_RUNBOOK.md (describes Docker; production is Windows without Docker: IF-15) | Runbook does not match production; scripts outside git | **PARTIAL** |
| A.6.1 | Screening | YES | Treats R-04 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.6.2 | Terms and conditions of employment | YES | Treats R-04 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.6.3 | Information security awareness, education and training | YES | Treats R-05 (High), R-30 (Medium) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.6.4 | Disciplinary process | YES | Treats R-09 (Medium) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.6.5 | Responsibilities after termination or change of employment | YES | Treats R-16 (Medium), R-19 (Medium) | docs/security/evidence/auth/tests.csv AU-T041..AU-T043; backend/tests/auth/test_vapt_sessions.py (AU-07 FIXED: token_version, migration f9a1c3e5b7d2) | No HR trigger to CKAM | **PARTIAL** |
| A.6.6 | Confidentiality or non-disclosure agreements | YES | Treats R-11 (Medium) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.6.7 | Remote working | YES | Treats R-18 (Critical), R-01 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (public address via router port-forward of TCP 3211, plain HTTP) | Remote access is open and unencrypted | **MISSING** |
| A.6.8 | Information security event reporting | YES | Treats R-27 (High) | frontend/src/features/support/report-problem-store.ts; backend/app/observability/client_reports.py; docs/security/evidence/auth/tests.csv AU-T098, AU-T101 | Channel for security events not communicated | **PARTIAL** |
| A.7.1 | Physical security perimeters | YES | Treats R-28 (High) | NOT EVIDENCED (servers 10.0.1.98, 10.0.0.205 and NAS 10.0.0.25 are CityKart on-premise equipment) | Not evidenced | **NOT EVIDENCED** |
| A.7.2 | Physical entry | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.7.3 | Securing offices, rooms and facilities | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.7.4 | Physical security monitoring | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.7.5 | Protecting against physical and environmental threats | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.7.6 | Working in secure areas | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.7.7 | Clear desk and clear screen | YES | Treats R-30 (Medium) | backend/app/core/config.py (access token 15 minutes, refresh 8 hours) | Endpoint screen-lock not evidenced | **NOT EVIDENCED** |
| A.7.8 | Equipment siting and protection | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.7.9 | Security of assets off-premises | YES | Treats R-25 (Medium) | CKAM records custody of laptops and other assets given to employees (docs/ai/PRODUCT_CONTEXT.md) | Device protection rules not evidenced | **NOT EVIDENCED** |
| A.7.10 | Storage media | YES | Treats R-13 (High), R-25 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (dumps on E: of 10.0.0.205; files on NAS); dev backups folder (IF-09) | Unencrypted backup media; dev dumps on dev PC | **MISSING** |
| A.7.11 | Supporting utilities | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.7.12 | Cabling security | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | **NOT EVIDENCED** |
| A.7.13 | Equipment maintenance | YES | Treats R-28 (High) | CKAM records Under Repair / Send for Repair (docs/ai/DECISIONS.md 2026-10-14 (10)) | Not evidenced for CKAM servers | **NOT EVIDENCED** |
| A.7.14 | Secure disposal or re-use of equipment | YES | Treats R-11 (Medium) | CKAM statuses Disposed / Scrapped / Sold (docs/ai/DECISIONS.md 2026-10-14 (2)) | Wiping not evidenced | **NOT EVIDENCED** |
| A.8.1 | User end point devices | YES | Treats R-25 (Medium) | docs/security (IF-09: dev PC .env and backups folder ACL) | Endpoints not evidenced; dev PC ACL gap | **NOT EVIDENCED** |
| A.8.2 | Privileged access rights | YES | Treats R-04 (High), R-07 (High), R-12 (Medium) | docs/security/evidence/access/tests.csv (escalation cases); docs/security/evidence/infra/db_01_roles_privileges.out.txt (dev role superuser); docs/ai/PRODUCTION_INFRASTRUCTURE.md (prod role ckassetapp not superuser; task runs as SYSTEM) | Privileged paths not minimised | **PARTIAL** |
| A.8.3 | Information access restriction | YES | Treats R-10 (Medium) | docs/security/evidence/access/tests.csv (208 IDOR/BOLA cases, 4 cross-company cases); docs/security/evidence/access/self_service_masters.txt; docs/security/evidence/infra/erp_cross_company_draft.txt; backend/tests/core/test_security_read_scope.py; docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md | Fixes not yet deployed; production 3b5e842 still has AC-1, AC-2, IF-03 | **PARTIAL** |
| A.8.4 | Access to source code | YES | Treats R-26 (Medium) | git remote origin (GitHub, personal account); 286 commits by one author; secrets scan: none in working tree or 282 commits | Repository control not evidenced | **NOT EVIDENCED** |
| A.8.5 | Secure authentication | YES | Treats R-05 (High), R-01 (High), R-19 (Medium) | docs/security/evidence/auth/tests.csv (original 102 cases); backend/tests/auth/test_vapt_login.py, test_rate_limit.py, test_vapt_sessions.py, test_vapt_password_policy.py; docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md | Plain HTTP; no MFA; fixes not deployed | **PARTIAL** |
| A.8.6 | Capacity management | YES | Treats R-21 (Medium) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (slow request/SQL rows, 660 MB log cap, GET /api/admin/diagnostics/db) | No capacity monitoring | **PARTIAL** |
| A.8.7 | Protection against malware | YES | Treats R-14 (High), R-22 (Low) | docs/security/evidence/input/raw_sql_review.md section 8; backend/tests/documents/test_vapt_content_check.py (IN-03 FIXED: file-signature check) | Server and NAS malware protection not evidenced | **PARTIAL** |
| A.8.8 | Management of technical vulnerabilities | YES | Treats R-02 (Critical), R-17 (High), R-15 (Medium) | docs/security/evidence/ (VAPT 2026-10-15); docs/security/evidence/infra/dependency_audit.md; docs/security/evidence/infra/static_route_traversal_and_startup.txt | CRITICAL IF-01 still exposed in production until deploy + secret rotation; no scheduled scanning or SLA | **PARTIAL** |
| A.8.9 | Configuration management | YES | Treats R-23 (High), R-20 (Medium) | .env.example; backend/app/core/config.py; docs/ai/CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md; backend/tests/core/test_production_secret_guard.py; backend/tests/test_vapt_headers_and_docs.py | Server configuration not baselined | **PARTIAL** |
| A.8.10 | Information deletion | YES | Treats R-31 (Medium), R-11 (Medium) | CLAUDE.md rule 2 (soft-deactivate only); docs/ai/LOGGING_AND_DIAGNOSTICS.md section 4 (error/system/client rows purged after 180 days; audit kept forever; guarded purge) | No retention schedule for business data or audit | **PARTIAL** |
| A.8.11 | Data masking | PARTIAL | Treats R-03 (Critical) | backend/app/observability/redact.py; backend/tests/observability/test_redaction.py; docs/security/evidence/auth/tests.csv AU-T049, AU-T089, AU-T090 | None for secret masking | **READY** |
| A.8.12 | Data leakage prevention | YES | Treats R-11 (Medium), R-01 (High) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (EXPORT rows); main.py Cache-Control no-store on /api/ | No DLP; transport not encrypted | **PARTIAL** |
| A.8.13 | Information backup | YES | Treats R-13 (High), R-14 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (task CK_Backup_CKASSETMANAGEMENT, daily 03:00, 30 days, on the DB server); ops/backup.sh (dev); docs/ai/AM-09_RC_FULL_AUDIT_REPORT.md (dev restore drill) | Single-location unencrypted backups | **PARTIAL** |
| A.8.14 | Redundancy of information processing facilities | YES | Treats R-13 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (one app server, one DB server) | No redundancy and no documented acceptance | **MISSING** |
| A.8.15 | Logging | YES | Treats R-12 (Medium), R-27 (High) | docs/ai/LOGGING_AND_DIAGNOSTICS.md; docs/security/evidence/auth/audit_coverage.csv (122 write routes: 107 audited, 15 intentionally not, 0 accidental); docs/security/evidence/auth/tests.csv AU-T086..AU-T097 | Logs not protected or shipped off-server | **PARTIAL** |
| A.8.16 | Monitoring activities | YES | Treats R-27 (High) | docs/ai/LOGGING_AND_DIAGNOSTICS.md section 8 (admin log screens, diagnostics); Home error count (commit 4ba4e94) | No active monitoring | **PARTIAL** |
| A.8.17 | Clock synchronization | YES | Treats R-12 (Medium) | NOT EVIDENCED (application stores timezone-aware UTC timestamps) | Not evidenced | **NOT EVIDENCED** |
| A.8.18 | Use of privileged utility programs | YES | Treats R-12 (Medium), R-06 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (superuser DB steps typed by the user); docs/ai/LOGGING_AND_DIAGNOSTICS.md (diagnostics read-only, head-office admin only, audited) | Not evidenced | **NOT EVIDENCED** |
| A.8.19 | Installation of software on operational systems | YES | Treats R-15 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (pip install -e into shared\venv at deploy); backend/constraints.txt (IF-11 file added) | Unpinned Python installs | **PARTIAL** |
| A.8.20 | Networks security | YES | Treats R-18 (Critical), R-01 (High), R-08 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (pg_hba allows ckassetapp only from 10.0.1.98/32; firewall rule CKAM-Web TCP 3211; router forwards 3211 from the internet) | Internet exposure without TLS | **PARTIAL** |
| A.8.21 | Security of network services | YES | Treats R-01 (High), R-08 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md | No TLS; no service hardening record; N2 open | **PARTIAL** |
| A.8.22 | Segregation of networks | YES | Treats R-06 (High), R-18 (Critical) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (shared servers with Spinwheel and Citykart Desk) | Not evidenced; shared hosts | **NOT EVIDENCED** |
| A.8.23 | Web filtering | NO | Outside CKAM scope (corporate network control) | Not applicable to the CKAM application: outbound web filtering is a CityKart corporate network control outside this scope | N/A | **N/A** |
| A.8.24 | Use of cryptography | YES | Treats R-01 (High), R-03 (Critical), R-13 (High) | docs/security/evidence/auth/tests.csv AU-T017..AU-T021, AU-T044; backend/app/core/security.py (HS256 pinned) | No encryption in transit; no key management | **PARTIAL** |
| A.8.25 | Secure development life cycle | YES | Treats R-23 (High) | docs/ai/DEVELOPMENT_GUARDRAILS.md; CLAUDE.md (test before commit, Alembic only); docs/security/CKAM_SECURITY_BASELINE.md | Rules depend on discipline, not automation | **PARTIAL** |
| A.8.26 | Application security requirements | YES | Treats R-23 (High) | docs/ai/DEVELOPMENT_GUARDRAILS.md; docs/ai/DECISIONS.md (authorization, append-only, ERP read-only decisions); docs/security/CKAM_SECURITY_BASELINE.md | Baseline not yet approved | **PARTIAL** |
| A.8.27 | Secure system architecture and engineering principles | YES | Treats R-07 (High), R-01 (High) | docs/security/CKAM_THREAT_MODEL.md; docs/ai/DECISIONS.md 2026-10-14 (1),(6),(7); backend/app/lifecycle/service.py (single writer) | Runtime privilege and transport design weak | **PARTIAL** |
| A.8.28 | Secure coding | YES | Treats R-02 (Critical), R-21 (Medium) | docs/security/evidence/input/raw_sql_review.md; docs/security/evidence/input/tests.csv; docs/security/evidence/input/xss_results.json; docs/security/evidence/input/formula_export_cell.txt; backend/tests/test_static_frontend.py; backend/tests/core/test_security_concurrency.py; docs/ai/DEVELOPMENT_GUARDRAILS.md (file-path and file-security rules) | Production still runs code without these fixes (tracked under A.8.8 / EXT-01) | **READY** |
| A.8.29 | Security testing in development and acceptance | YES | Treats R-23 (High) | docs/security/evidence/access/tests.csv; docs/security/evidence/auth/tests.csv; docs/security/evidence/input/tests.csv; backend/tests/observability/test_coverage_walker.py; backend/tests/test_static_frontend.py; backend/tests/**/test_vapt_*.py; frontend/e2e/security.spec.ts; docs/ai/CKAM_FINAL_UAT.md; docs/security/CKAM_VAPT_REPORT.md | No schedule yet for repeating the battery | **READY** |
| A.8.30 | Outsourced development | PARTIAL | Treats R-23 (High), R-03 (Critical) | git log (275 of 286 commits co-authored by an AI coding assistant); no external development firm evidenced | No written rule for AI-assisted development | **PARTIAL** |
| A.8.31 | Separation of development, test and production environments | YES | Treats R-03 (Critical) | CLAUDE.md (dev 10.0.0.47; prod 10.0.1.98 / 10.0.0.205 / NAS); backend/tests/conftest.py (refuses the plain ckam DB); docs/ai/CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md (independent production secrets required) | Independence of production secrets not re-verified | **READY** |
| A.8.32 | Change management | YES | Treats R-23 (High) | CLAUDE.md (commit, then user-approved push, then separately approved deploy); docs/ai/PRODUCTION_INFRASTRUCTURE.md (backup first, release by sha, alembic, verify, rollback) | Approvals and results not recorded as evidence | **PARTIAL** |
| A.8.33 | Test information | YES | Treats R-25 (Medium) | docs/ai/DEVELOPMENT_GUARDRAILS.md (UAT naming convention); docs/security/evidence/access/self_service_masters.txt (synthetic SEC-TEST data); docs/ai/ERP_INTEGRATION.md (dev holds a copy of real ERP data: 18,358 lines, 191 suppliers) | Real ERP data on the dev PC | **PARTIAL** |
| A.8.34 | Protection of information systems during audit testing | YES | Supporting control (keeps testing from harming production) | docs/security/evidence/infra/static_route_traversal_and_startup.txt (tests on throw-away containers; production not touched); docs/security/evidence/infra/db_03_append_only_privilege_tests.out.txt (all in a rolled-back transaction) | None | **READY** |

---

## 11. Required organisational actions (ORGANIZATIONAL / PROCESS GAPS)

Each item names the `EXT-xx` action in `CKAM_EXTERNAL_SECURITY_ACTIONS.md` where the details, owner, timing
and "how to know it is done" are written.

| # | Action | What it means for CKAM | Annex A | EXT |
|---|---|---|---|---|
| 1 | **Policy set** | One short information security policy signed by management, plus topic policies: access control, passwords/MFA, backup, cryptography and key rotation, change management, incident response, supplier security, acceptable use (incl. shared store logins), secure and AI-assisted development, data retention and privacy | 5.1, 5.10, 5.12, 5.37, 8.25 | EXT-17 |
| 2 | **Risk register ownership** | Management appoints an owner for this register, approves the risk method in section 9, reviews it at least yearly and after each major change or incident | 5.4, 5.8; ISO clause 6.1 | EXT-36 |
| 3 | **Access review procedure** | Every quarter the head-office admin exports the user list (`GET /api/asset-users/export`), checks every login, access level, company, work area and head-office admin flag, signs it, and records changes | 5.15, 5.18, 8.2 | EXT-18 |
| 4 | **Joiner / mover / leaver** | HR tells IT on joining, transfer and leaving; CKAM login created / changed / switched off the same day; assets held by a leaver returned (CKAM shows them) | 5.11, 5.16, 6.5 | EXT-33 |
| 5 | **Incident response plan** | Who decides, how to contain (switch off port-forward, stop `CKAM-Web`), how to rotate secrets, how to keep evidence (audit export), who reports to CERT-In and within what time (confirm with legal), post-incident review. First use: IF-01 (fixed in code, still exposed in production) | 5.24-5.28, 6.8 | EXT-20, EXT-03 |
| 6 | **BCP / DR** | Agree how long CKAM may be down (RTO) and how much data may be lost (RPO); reboot test of 10.0.1.98; restore drill; manual fallback for stores | 5.29, 5.30, 8.14 | EXT-29 |
| 7 | **Backup policy** | Daily DB dump plus NAS documents, encrypted, one copy off the DB server and one offline/immutable; 30-day retention minimum; quarterly restore test with a written result | 8.13, 7.10 | EXT-08 |
| 8 | **Supplier review** | List suppliers (ERP warehouse team, NAS vendor/support, GitHub, AI coding assistant provider, Google Fonts, Python/npm ecosystems, any external auditor); rate risk; check terms once a year | 5.19-5.23 | EXT-34 |
| 9 | **Awareness** | Short yearly session for all CKAM users (passwords, store logins, reporting a problem, phishing) and a deeper one for admins | 6.3, 6.8 | EXT-32 |
| 10 | **Change management** | A change record per release: request/ticket id, approver, test evidence, rollback plan, deployment result; emergency change rule | 8.32, 8.9 | EXT-35 |
| 11 | **Vulnerability management** | Monthly dependency audit, patch windows for servers, fix deadlines by severity (e.g. Critical 72 h, High 14 days; to be agreed), yearly external VAPT | 8.8, 5.7 | EXT-09, EXT-12, EXT-14 |
| 12 | **Internal audit** | Once a year someone independent of CKAM development checks a sample of controls against this matrix | 5.35, 5.36; ISO clause 9.2 | EXT-36 |
| 13 | **Management review** | Once a year management reviews risks, incidents, audit results, actions and resources, and records decisions | 5.4; ISO clause 9.3 | EXT-36 |

---

## 12. Verdict

### `ISO 27001 TECHNICAL READINESS PARTIAL`

**This is not a certification and not an audit opinion.**

The verdict is **unchanged after remediation and retest**. The code got materially stronger, but the
verdict describes the system as it runs, and nothing has been deployed.

Justification:

1. **Strong at the application layer, now in code as well as in tests.** Access control (A.5.15, A.8.3),
   logging (A.8.15), protection of records (A.5.33), secret masking (A.8.11), secure coding (A.8.28) and
   security testing (A.8.29) are designed and evidenced by the original 636 test cases, the 646 + 310 retest
   cases, about 1,783 backend and 1,239 frontend tests and 14/14 Playwright security journeys. 11 technical
   components are ready (8 before remediation); 5 controls are fully ready (4 before).
2. **Not STRONG** because (a) **every fix is a local commit; production still runs `3b5e842` with the CRITICAL
   IF-01 exposure** until EXT-01 and EXT-02 are done; (b) login still crosses the internet in plain HTTP
   (IF-02, HIGH); (c) CKAM shares its servers with other apps and runs as SYSTEM (IF-07); (d) backups have a
   single unencrypted location with no production restore test (IF-08); (e) the DB owner can still drop the
   audit triggers (IF-05/IF-06 only mitigated). These are infrastructure gaps that code alone cannot close.
3. **Not WEAK** because no original code finding is left unfixed or unretested, the residuals are mitigated
   or accepted with reasons, and the external gaps are documented with concrete actions.
4. **Organisational readiness is low and unchanged** (0 of 37 A.5 controls ready, 31 controls NOT EVIDENCED,
   mostly inherited HR and physical controls). Certification is not realistic until the policy set, risk
   ownership, access reviews, incident plan, internal audit and management review exist and have run at least
   once.

**What would move the technical verdict to STRONG:** EXT-01, EXT-02, EXT-38 and EXT-39 (deploy the fixed
release correctly and rotate secrets), EXT-04 and EXT-05 (HTTPS; close or restrict the internet forward),
EXT-06 and EXT-07 (low-privilege service account and DB role split) and EXT-08 (off-server encrypted backups
with a restore test), followed by a post-deploy check on production.

---

## 13. Statements that could not be evidenced

- Physical security of the rooms holding 10.0.1.98, 10.0.0.205 and the NAS (A.7.x): NOT EVIDENCED.
- HR screening, contracts, NDAs, disciplinary process, training (A.6.1-A.6.4, A.6.6, A.6.3): NOT EVIDENCED.
- Patch level and antimalware on 10.0.1.98, 10.0.0.205, NAS; time synchronisation (A.8.7, A.8.8, A.8.17): NOT EVIDENCED.
- Disk/database encryption at rest in production; TLS on the PostgreSQL connection in production: NOT EVIDENCED (dev shows `ssl off`, `db_01_roles_privileges.out.txt`).
- Whether a backup of the NAS documents exists: NOT EVIDENCED.
- GitHub repository ownership, visibility, collaborators and MFA (A.8.4): NOT EVIDENCED.
- Whether IF-01 was exploited on production before today: NOT EVIDENCED either way (no production logs were reviewed; EXT-03).
- Whether production secrets are independent of the dev secrets: NOT EVIDENCED (EXT-02 confirms it).
- The SELECT-only grant of the ERP role on the warehouse side: NOT EVIDENCED (the code side is evidenced).
- The production runtime DB role `ckassetapp` is documented as not a superuser (`PRODUCTION_INFRASTRUCTURE.md`); its table ownership in production was not inspected (the dev stack runs as a superuser owner, `db_01`).
- That the production `JWT_SECRET` meets the new start-up rule (≥ 32 characters, ≥ 8 distinct) and that `ENVIRONMENT_NAME=production` is set: NOT EVIDENCED (checked at deploy, EXT-39).
- The final backend test-run number: to be given by the lead (about 1,783 tests reported).
- Any of the remediation running in production: NOT EVIDENCED (nothing deployed).

---

## 14. Spreadsheets

`CKAM_ISO27001_CONTROL_MATRIX.xlsx` and `CKAM_SOC2_CONTROL_MATRIX.xlsx` were regenerated on 2026-10-15 (final state) from the
CSV files with openpyxl, by running a converter script once in a temporary folder of the dev stack's `api`
container (read-only use; no build, no restart). Header row bold and frozen, filters on, column widths set,
text wrapped, and any cell starting with `= + - @` written as text. The CSV files are the master copies; if a
CSV changes, regenerate the `.xlsx`.
