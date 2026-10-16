# CKAM — Complete Security Report (tests + fixes) — 2026-10-15

One file with everything: what was tested, what was found, what was fixed, how it was re-tested, and what is still open.
Local development and test copies only. Production was not touched. Nothing has been pushed to Git or deployed.
This is a readiness and testing report. It is **not** an ISO 27001 certificate or a SOC 2 attestation.

## Read this first (plain language)

**1. Production is exposed right now.** The live server (10.0.1.98) still has a hole (IF-01, CRITICAL): anyone could read any file on it without signing in, including the file that holds the login-signing secret, the database password and the NAS password. It has been in every release since 2026-09-30, including the live one. The fix is finished and tested on this machine (commit `3e134c1`) but is **not deployed**. I did not connect to production, so I cannot say whether anyone has already used it.

**2. What to do, in this order**
1. Before deploying: check the production `JWT_SECRET` is at least 32 characters with at least 8 different characters, and that `ENVIRONMENT_NAME=production` is set (otherwise the new code refuses to start). Run `alembic upgrade head` before starting the new code. Start uvicorn with `--no-proxy-headers`.
2. Deploy the fix release (a separate request from you; you type the server passwords).
3. Change the JWT secret, the `ckassetapp` database password and the NAS password (and the ERP password if it sits in the same file).
4. Plan HTTPS (login still travels over plain HTTP).
5. Until then, if you can, stop forwarding port 3211 from the internet.

**3. What was done**
- About 1,592 security test cases were run (636 first round, 956 retest) across access control, sign-in and sessions, injection, XSS, file upload, secrets, dependencies, database permissions, ERP read-only proof, business logic and parallel requests.
- 43 findings: 1 Critical, 1 High, 14 Medium, 22 Low, 5 Info.
- Fixed in code: the Critical, 8 of the 14 Medium and 13 of the 22 Low. Mitigated: 4. Accepted: 3. Open external (needs infrastructure or process work, not code): 10. Open: 3.
- 73 new backend tests, 16 new frontend tests and 14 browser security journeys were added to the permanent suite.
- Final results: backend 1783 passed; frontend 1239 passed (90 files); TypeScript clean; build passes with no source maps; browser security journeys 14/14; permanent browser journeys 11 passed and 1 skipped (the ERP-link journey, because the ERP link is intentionally off on the test copy); database migrations reach a single head (`a3c5e7f9b1d4`) from an empty database and from your existing dev database.

**4. Verdicts**
- VAPT: ready with non-blocking observations for the code. Production is **not** ready until the fix is deployed, the passwords are changed and HTTPS is planned.
- ISO 27001 technical readiness: PARTIAL (the application's own controls are strong; the policies and processes are mostly absent).
- SOC 2 Type I readiness: WEAK. SOC 2 Type II evidence programme: NOT READY.

**5. Local commits (not pushed), oldest first**
`3e134c1` path-traversal fix · `7e57844` ERP draft access + placeholder-secret refusal · `ba04371` import upload size limit · `77431ba` setup lists, custom fields, admin-login clash · `4fa5c9b` web-server and frontend hardening + security journeys · `ae706bb` sign-in, sessions, password policy, audit guards, document checks, ERP timeouts · `da790d1` same-name race fix, concurrency tests, guardrails · `d04779a` request-size limit, production-name default, password follow-up · `a3e8fce` Docker proxy-header setting · `627ed73` all security documents.

**6. Two honest caveats**
- The last fixes (request-size limit, production-name default, extra password rule, same-name race) are covered by the permanent tests and one live check, not by a separate second retest.
- The path-traversal fix was tested on Linux; production is Windows.

## What is in this file

- Part A — VAPT report (scope, method, tests executed, verdicts)
- Part B — Findings register (one row per finding)
- Part C — Remediation report (before / root cause / code changed / test added / after)
- Part D — Retest: access control and business logic
- Part E — Retest: sign-in, input and infrastructure
- Part F — Concurrency (parallel request) results
- Part G — External and organisational actions (what code cannot fix)

Not included here, because they are long reference documents: the ISO 27001 and SOC 2 readiness reports and their control matrices, the threat model, the security baseline and the evidence index. They are in `docs/security/`, and the raw test data (test case lists, scripts, result files) is in `docs/security/evidence/`.

---



# PART A — VAPT report

(source file: docs/security/CKAM_VAPT_REPORT.md)

# CKAM Vulnerability Assessment and Penetration Test (VAPT) Report

| | |
|---|---|
| System | CKAM (CityKart Asset Manager): FastAPI + PostgreSQL backend, React frontend |
| Test dates | 2026-10-15 (initial test, remediation, retest) |
| Code tested | Initial: HEAD `4ba4e94`/`77431ba`. Retest: `ae706bb` (with `4fa5c9b`, `77431ba`, `ba04371`, `7e57844`, `3e134c1`). Final state: `d04779a` (permanent regression tests) |
| Testers | The CKAM engineering team's internal security-assurance agents (access, authentication, input, infrastructure, retest) under a security lead. **Not an independent test** (see EXT-14) |
| Type | Grey-box (source code, configuration and test accounts available), authenticated and unauthenticated |
| Production touched | **NO** |
| ERP warehouse, NAS, 10.0.1.12 touched | **NO** |
| Git push | **NO** (all commits local) |
| Related | `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md`, `CKAM_THREAT_MODEL.md`, `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_SECURITY_EVIDENCE_INDEX.md` |

> This is an internal security test report. It is not a certification and not an audit opinion. CKAM is not
> ISO/IEC 27001 certified and has no SOC 2 report.

---

## 1. Executive summary

**Production exposure first.** The live CKAM server (10.0.1.98, release `3b5e842`) has a critical hole,
**IF-01**: anyone who can reach the site, including from the internet, can ask it for any file on the server.
That includes the file that holds the database password and the secret key that signs every login. With that
key a stranger can sign in as the head-office admin without a password. The fix is written and proven on the
development PC (commit `3e134c1`, 36 attack variants retested clean), **but it is not deployed**. Until it is
deployed and the secrets are changed, production must be treated as exposed (EXT-01, EXT-02, EXT-03).

**What was tested.** Every one of CKAM's 217 web routes was tried by 11 kinds of user (from the head-office
admin down to a store login), plus attacks on sign-in and sessions, input handling (SQL injection, script
injection, file uploads, spreadsheet formulas), the database's audit protections, the server set-up, the
ERP link and the third-party packages. 636 test cases ran in the first round and 956 in the retest, plus
about 60 infrastructure checks recorded as text.

**What was found.** 43 problems after merging duplicates: 1 critical, 1 high, 14 medium, 22 low, 5
informational.

**What was fixed.** Every problem that could be fixed in the code was dealt with: 23 fixed in code (including
IF-01), 4 reduced (with a stated remainder), 3 accepted with a written reason. The retest agents re-ran their
attacks against the fixes; the last four fixes (N1, N4, the password follow-up and RACE-1) came after that
retest and are proven by permanent tests only. No user could raise their own rights,
read another company's data, or inject SQL or script after the fixes. 73 new backend tests, 16 new browser
unit tests and 14 browser security journeys now guard these fixes permanently.

**What remains.** Mostly server and management work, not code: deploy the fix and rotate secrets (IF-01),
HTTPS (IF-02), a low-privilege Windows account (IF-07), off-server backups (IF-08), a separate database
role so the app can no longer switch off its own audit protections (IF-05/IF-06), and the dev PC's file
permissions (IF-09).

**Verdict:** `CKAM SECURITY ASSURANCE READY WITH NON-BLOCKING OBSERVATIONS (for the local/UAT code at HEAD) —
with a BLOCKING EXTERNAL condition: production is NOT ready until the IF-01 fix is deployed, the three secrets
are rotated, and HTTPS is planned` (section 13).

---

## 2. Scope

| In scope | Detail |
|---|---|
| Environment | **Local development / UAT only**, on the development PC 10.0.0.47 |
| Stacks used | `ckam-sec`: an isolated Docker stack for security testing (web `http://localhost:3411` via nginx, API `http://127.0.0.1:8200`, PostgreSQL `127.0.0.1:25442`, `ENVIRONMENT_NAME=security-test`) with **22 seeded test personas** (password value documented in the fixture, never a real one). `ckam-uat`: the UAT stack, used for the permanent Playwright suite. `ckam-build`: the developer's own stack, used for the pytest and vitest runs |
| Production-mode checks | Throw-away, **network-less** containers (`--network none`) of the same API image with `FRONTEND_DIST_DIR` set and `ENVIRONMENT_NAME=production`, holding **fake canary secrets only**, removed afterwards |
| Application | All 217 HTTP routes (`docs/security/evidence/access/openapi.json`), the React SPA, the Docker nginx configuration, the single-port production code path |
| Database | Schema, triggers, roles and privileges of the test databases (rolled-back transactions) |
| Dependencies | `frontend/package-lock.json` (npm), Python packages in the API image |

| Out of scope / not touched | Why |
|---|---|
| Production app 10.0.1.98, database 10.0.0.205, NAS 10.0.0.25 | Testing production needs the owner's written approval; none was given. **Production touched: NO** |
| ERP warehouse 10.0.1.69 | Owned by another team. **ERP touched: NO** (ERP behaviour tested on CKAM's local ERP copy and stand-ins) |
| Old server 10.0.1.12 | Retired; must stay dead. **Touched: NO** |
| Spinwheel, Citykart Desk | Other applications on shared servers |
| Internet | Not used, except `npm audit` |
| Git remote | **No push** |

---

## 3. Methodology

The test followed the structure of the OWASP Web Security Testing Guide and the OWASP API Security Top 10
(2023), with CWE ids on every case and CVSS 3.1 scores where the evidence states them.

| Phase | What was done |
|---|---|
| 1. Threat model | Actors, trust boundaries, data flows and STRIDE per component (`CKAM_THREAT_MODEL.md`) |
| 2. Attack-surface map | Route list from the OpenAPI document; write routes classified for audit coverage |
| 3. Access control | Full authorization matrix (217 routes × 11 personas), IDOR/BOLA by object id across companies and work areas, privilege escalation and mass assignment, business-logic and idempotency checks |
| 4. Authentication and sessions | Sign-in, enumeration by status and timing, lock-out and its race, rate limiting, token tampering (`alg:none`, signature flips), refresh/logout/revocation, cookie flags, headers, CSRF/CORS, password policy, audit and log content |
| 5. Input handling | SQL injection (sort, search, numeric, filters), stored and reflected XSS (planted payloads viewed in a real browser), spreadsheet formula injection, file uploads, path traversal, SSRF / command-injection code search, raw-SQL review |
| 6. Infrastructure | Single-port static route, start-up configuration, database roles/triggers/privileges, ERP connection, dependency audit, secret scan of the tree and history |
| 7. Remediation | Fixes by the engineering agents, one logical commit per area, each with a regression test |
| 8. Retest | Independent retest agents re-ran every failed case and the full matrix against the rebuilt stack |
| 9. Permanent regression | New pytest, vitest and Playwright tests kept in the repository |

Pacing: sign-ins were spaced (3.5 s or more) and tokens cached so that the new rate limits did not distort
results; burst tests ran inside the API container with its own rate-limit address.

---

## 4. Environment

| Item | Value |
|---|---|
| Host | Development PC 10.0.0.47, Windows 11, Docker Desktop |
| Database | PostgreSQL 17 (Docker); production uses 18 |
| Rebuilt image for the retest | `ckam-sec-api` `512540c2de68`, Alembic head `a3c5e7f9b1d4` |
| Personas | 22 seeded personas on `ckam-sec` (e.g. head-office admin `SECHO`, Full Admins per work area, operators IT / Non-IT / both / second company, viewers, self-service holders, store logins `SPA`/`VPA`, a locked account), plus throw-away accounts created and soft-deactivated during the tests |
| Matrix personas | 11 (a subset of the 22) |
| Production layout simulation | `<root>/releases/<sha>/frontend-dist`, `<root>/shared/.env`, `<root>/shared/nas.pw`, fake canaries |

---

## 5. Attack surface

| Surface | Size | Evidence |
|---|---|---|
| HTTP routes | 217 routes × 11 personas = 2,387 authorization cells | `evidence/access/authz_matrix.csv`, `evidence/access/matrix_raw.csv` |
| Write routes classified for audit | 122 (107 audited, 15 intentionally not, 0 forgotten) | `evidence/auth/audit_coverage.csv`, `evidence/auth/write_routes.txt` |
| Unauthenticated | Sign-in, refresh, logout, login companies, health, static files (`/assets/…`, SPA shell), and in non-production `/docs`, `/redoc`, `/openapi.json` | `evidence/auth/tests.csv` |
| File inputs | Document uploads (10 MB), Excel imports (assets, POs, movements, people, masters; 15 MB) | `evidence/input/tests.csv` |
| Outbound | ERP PostgreSQL (read-only); no outbound HTTP (no SSRF sinks) | `evidence/input/raw_sql_review.md` |
| Data stores | PostgreSQL (append-only `asset_event`, `asset_field_change`, `master_audit`, `audit_log`), document folder | `evidence/infra/db_0*.out.txt` |

---

## 6. Threat model

See `docs/security/CKAM_THREAT_MODEL.md` (actors, trust boundaries TB1-TB5, data-flow diagram, STRIDE per
component, top risks). The top risk it names, "IF-01 arbitrary file read on production → secret theft →
forged admin tokens", is the one confirmed by this test.

---

## 7. Tools

| Tool | Use |
|---|---|
| Node.js scripts (`fetch`) | Authorization matrix, IDOR, escalation, business logic, input batteries, retest harnesses (`evidence/access/*.mjs`, `evidence/input/*.mjs`, `evidence/retest/access_raw/*.mjs`, `evidence/retest/aii_scripts/*.mjs`) |
| Bash + curl | Sign-in, token, timing, lock-out, race, header and revocation scripts (`evidence/auth/t1_auth.sh` … `t10_val_authz.sh`) |
| Python (inside containers) | Token crafting, raw-request path probes, timing, races, rate limits, `X-Forwarded-For`, big bodies, ERP timeouts (`evidence/auth/craft.py`, `evidence/infra/raw/probe_dist.py`, `evidence/retest/aii_scripts/*.py`) |
| Playwright | Stored-XSS rendering, CSP violations, browser security journeys (`evidence/input/xss_playwright.mjs`, `evidence/retest/aii_scripts/pw_csp.mjs`, `frontend/e2e/security.spec.ts`) |
| psql | Roles, privileges, triggers, append-only and integrity checks in rolled-back transactions (`evidence/infra/sql/`, `evidence/retest/aii_scripts/rt_append_only.sql`) |
| npm audit, pip-audit, pip freeze | Dependency advisories (`evidence/infra/raw/`) |
| pytest, vitest, tsc, vite build | Permanent regression |
| git log / grep | Secret scan of the working tree and history (282 commits at the time of the scan) |

---

## 8. Tests executed

### 8.1 Black-box / grey-box test cases (CSV rows in `docs/security/evidence/`)

| Area | Round | File | Rows | PASS | FAIL | INFO | N/A |
|---|---|---|---|---|---|---|---|
| Access control | Initial | `access/tests.csv` | 467 | 451 | 15 | 0 | 1 |
| Authentication and sessions | Initial | `auth/tests.csv` | 102 | 68 | 25 | 9 | 0 |
| Input handling | Initial | `input/tests.csv` | 67 | 59 | 2 | 4 | 2 |
| Infrastructure | Initial | text evidence (`infra/*.out.txt`, `static_route_traversal_and_startup.txt`, `dependency_audit.md`, `erp_cross_company_draft.txt`) | about 60 documented checks, **not counted as CSV rows** | | | | |
| **Initial total (CSV)** | | | **636** | **578** | **42** | **13** | **3** |
| Access control | Retest | `retest/retest_tests.csv` | 646 | 643 | 0 | 2 | 1 |
| Authentication, input, infrastructure | Retest | `retest/retest_tests2.csv` | 310 | 280 | 8 | 22 | 0 |
| **Retest total** | | | **956** | **923** | **8** | **24** | **1** |
| **All CSV rows** | | | **1,592** | | | | |

Notes:
- The input CSV has 67 rows (65 executed, 2 N/A were code searches with no runtime target). The brief for this
  report gave 60; the file has 67.
- The access retest breaks down as: matrix 217 rows (2,387 cells), IDOR/BOLA 208, escalation/mass assignment
  17, business logic/idempotency 7, AC-1/AC-2/IF-03 verification 130, sessions/clash/mass assignment 51,
  uploads 16 (`retest/retest_access.md`).
- The 8 retest FAILs are all accounted for: RT-AU-T103 (AU-06 residual, MITIGATED), T217/T218 (AU-08 gap,
  closed later in `d04779a`), T960 (N1, closed in `d04779a`), T9817/T9818 (owner/superuser residual of
  IF-05/IF-06, EXT-07), T1009 (N2, OPEN EXTERNAL), T1010 (N3, ACCEPTED).
- Concurrency bursts by the access retest agent were **not executed** (`retest/concurrency_results.md`); see
  section 8.2 and Limitations.

### 8.2 Permanent regression tests added to the repository (`git diff 4ba4e94..HEAD`)

| Kind | New tests | Where |
|---|---|---|
| Backend pytest | **73 test functions**: 71 in 14 new files, 2 added to existing files. Parametrized cases are counted separately in the pytest totals | `backend/tests/auth/test_login_primary_owner_clash.py` (2), `auth/test_rate_limit.py` (7), `auth/test_vapt_login.py` (7), `auth/test_vapt_password_policy.py` (10), `auth/test_vapt_sessions.py` (9), `core/test_body_limit.py` (5), `core/test_production_secret_guard.py` (3), `core/test_security_concurrency.py` (4), `core/test_security_read_scope.py` (3), `documents/test_vapt_content_check.py` (3), `erp/test_vapt_erp_limits.py` (4), `imports/test_upload_size_limit.py` (2), `observability/test_vapt_append_only.py` (5), `test_vapt_headers_and_docs.py` (7); plus one each in `test_static_frontend.py` and `erp/test_erp_api.py` |
| Frontend vitest | **16** | `frontend/src/lib/auth-session.test.ts` (11), `frontend/src/routes/login.test.tsx` (5 added) |
| Playwright | **14 journeys** (10 declarations; one runs for 5 `next=` values) | `frontend/e2e/security.spec.ts` |

The concurrency gap was covered by permanent asyncio tests instead of a one-off burst:
`backend/tests/core/test_security_concurrency.py` (over-receiving one PO line, one serial on two receipts, ten
parallel same-name vendors, ten parallel same-name brands). The brand test found RACE-1, which was fixed.

### 8.3 Regression results (final lead runs)

| Suite | Result |
|---|---|
| Backend pytest | **1783 passed**¹ |
| Frontend `tsc -b` | Clean |
| Frontend vitest | 1239 passed in 90 files |
| `npm run build` | OK, 0 `.map` files |
| Playwright permanent suite (12 spec files, `ckam-uat`, rate limits switched off for that stack only) | 11 passed, 1 skipped (the ERP-link spec skips itself because the ERP link is intentionally off on the test stack); the one earlier failure was two Playwright runs sharing one artifact folder and passed alone |
| Playwright security journeys (`ckam-sec`, remediated-auth assertions mandatory) | 14/14 |
| Alembic | Fresh database → `a3c5e7f9b1d4`; dev, UAT and security-test databases upgraded; single head |

¹ Confirmed: the final complete run on the committed code was 1783 passed, 0 failed, in 7 min 47 s.


---

## 9. Findings

| Severity | Count | FIXED | MITIGATED | ACCEPTED | OPEN EXTERNAL | OPEN |
|---|---|---|---|---|---|---|
| CRITICAL | 1 | 1 in code (**production OPEN EXTERNAL**) | | | | |
| HIGH | 1 | | | | 1 | |
| MEDIUM | 14 | 8 | 3 | | 3 | |
| LOW | 22 | 13 | 1 | 3 | 3 | 2 |
| INFO | 5 | 1 | | | 3 | 1 |
| **Total** | **43** | **23** | **4** | **3** | **10** | **3** |

(The FIXED column includes IF-01, whose code fix is complete but whose register status is "FIXED (code) — OPEN
EXTERNAL until deployed".)

Full list, one row per finding, with component, impact, fix, retest evidence and commit:
**`docs/security/CKAM_SECURITY_FINDINGS_REGISTER.md`**.

Positive results (no finding): zero privilege escalation in 2,387 matrix cells and 208 IDOR cases; SQL injection
safe (whitelisted sort columns, escaped LIKE, bound parameters); stored and reflected XSS inert on every screen
visited; spreadsheet exports neutralise formulas; no SSRF, command injection or unsafe deserialisation sinks;
Argon2id hashing; no plaintext password, token or cookie in the database, logs, audit or client reports; JWT
HS256 pinned, `alg:none` and tampering rejected; CORS refuses foreign and `null` origins; 17 malformed requests
answered 4xx with a request id and no stack, SQL or path; audit coverage complete for write routes; no secrets in
the working tree or the 282 scanned commits; npm production dependencies 0 known vulnerabilities.

---

## 10. Evidence

All evidence is in `docs/security/evidence/` (index: `docs/security/CKAM_SECURITY_EVIDENCE_INDEX.md`).

| Area | Main files |
|---|---|
| Access control | `access/tests.csv`, `access/authz_matrix.csv`, `access/findings.csv`, `access/phaseB_results.json`, `access/phaseB_escalation.json`, `access/phaseB_logic.json`, `access/self_service_masters.txt` |
| Authentication | `auth/tests.csv`, `auth/audit_coverage.csv`, `auth/t_existing.txt`, `auth/t_nonexist.txt`, `auth/t_locked.txt`, `auth/t_disabled.txt`, `auth/race_codes.txt` |
| Input | `input/tests.csv`, `input/raw_sql_review.md`, `input/xss_results.json`, `input/battery_results.json`, `input/battery2_results.json`, `input/formula_export_cell.txt` |
| Infrastructure | `infra/static_route_traversal_and_startup.txt`, `infra/db_01_roles_privileges.out.txt` … `infra/db_05_data_integrity.out.txt`, `infra/erp_cross_company_draft.txt`, `infra/dependency_audit.md`, `infra/raw/` |
| Retest | `retest/retest_access.md`, `retest/retest_auth_input_infra.md`, `retest/retest_tests.csv`, `retest/retest_tests2.csv`, `retest/authz_matrix_retest.csv`, `retest/access_raw/`, `retest/aii_raw/`, `retest/concurrency_results.md` |

No evidence file contains a real secret. Canary values are fake; tokens and throw-away passwords were kept in
memory only.

Evidence quality note: in `retest/retest_tests.csv` the ids `RT-AC-T700`…`RT-AC-T729` appear in two groups
(646 rows, 616 unique ids). Counts are unaffected; the register cites the group name with those ids.

---

## 11. Remediation

How each finding was fixed (before, risk, root cause, code, test, after, retest, regression), the tests that
changed, behaviour users will notice, migration notes, the production deploy order and the least-privilege
database role design (DESIGN ONLY, NOT APPLIED): **`docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md`**.

Commits (local, not pushed, not deployed): `3e134c1` (IF-01), `7e57844` (IF-03, IF-04), `ba04371` (IN-02),
`77431ba` (AC-1, AC-2, PO-LOGIN), `4fa5c9b` (AU-12, AU-14/AU-15 web side, clean sign-out, security e2e),
`ae706bb` (AU-01, 03, 05, 06, 07, 08, 10, 11, 14, 16, IF-05/06, IF-10, IN-03, IF-11, AU-02 decision),
`da790d1` (RACE-1, concurrency tests, guardrails), `d04779a` (N1, N4, AU-08 follow-up).

---

## 12. Retest: every Critical, High and Medium finding

| ID | Sev. | Retest result | Evidence | Final status |
|---|---|---|---|---|
| IF-01 | CRITICAL | 36 variants × 2 runs: all 404, 0 leaks; legitimate files 200 | RT-AU-T801…T836; `retest/aii_raw/if01_run1.txt`, `if01_run2.txt` | FIXED (code) — **OPEN EXTERNAL until deployed** |
| IF-02 | HIGH | Not retestable locally (needs HTTPS on the server) | — | OPEN EXTERNAL (EXT-04) |
| IF-03 | MEDIUM | Both company directions 404 like a missing PO; own company 200 | Group `retest-AC1-AC2-IF03`; RT-AU-T601…T608 | FIXED |
| IF-04 | MEDIUM | Production refuses weak secrets; N4 found name-dependence, closed in `d04779a` | RT-AU-T901…T913; `test_production_secret_guard.py` | FIXED |
| IF-05 | MEDIUM | TRUNCATE refused for the app role; owner/superuser bypass remains | RT-AU-T9800…T9821 (T9817/T9818 residual) | MITIGATED |
| IF-06 | MEDIUM | Purge flag cannot remove rows under 5 years; owner bypass remains | RT-AU-T98xx | MITIGATED |
| IF-07 | MEDIUM | Server setting, not testable locally | — | OPEN EXTERNAL (EXT-06) |
| IF-08 | MEDIUM | Infrastructure, not testable locally | — | OPEN EXTERNAL (EXT-08) |
| IF-09 | MEDIUM | Local admin action pending | — | OPEN EXTERNAL (EXT-10) |
| IF-10 | MEDIUM | Connect 10.01 s and statement limits enforced; writes refused | RT-AU-T970…T979 | FIXED |
| AU-01 | MEDIUM | Timing spread 2.8 ms across all account states | RT-AU-T990…T996 | FIXED |
| AU-03 | MEDIUM | 429 per address, per login id, refresh, change-password | RT-AU-T1002…T1011 | FIXED (residuals N2, N3) |
| AU-04 | MEDIUM | Targeted lock-out still possible by design; slowed by limits | RT-AU-T313/T314 | MITIGATED |
| AU-05 | MEDIUM | Old tokens 401 after logout, password change, reset; others unaffected | RT-AU-T101…T115, T134; group `retest-sessions-clash-massassign` | FIXED |
| AC-1 | MEDIUM | 44 self-service cases 403; staff 200; 13 expected matrix cells changed, 0 escalations | Group `retest-AC1-AC2-IF03`; `retest/access_raw/authz_matrix_diff.csv` | FIXED |
| N1 | MEDIUM | Found in the retest (RT-AU-T960); fix verified by permanent tests, not re-run by the retest agent | `backend/tests/core/test_body_limit.py` | FIXED |

---

## 13. Residual risk (OPEN EXTERNAL first)

| Order | ID | Residual | Owner / action |
|---|---|---|---|
| 1 | **IF-01 (production)** | **Live server still serves any file, including secrets, to anyone. Secrets may already have been copied** | Deploy (EXT-01), then rotate JWT secret, DB, NAS and ERP passwords (EXT-02), compromise assessment (EXT-03) — URGENT |
| 2 | IF-02 / AU-13 | Plain HTTP from the internet; cookie not `Secure` | HTTPS (EXT-04); restrict the port forward (EXT-05) |
| 3 | IF-05 / IF-06 residual | The production app role owns its tables, so it could still disable the audit triggers | Role split (EXT-07; design in the remediation report, section 7) |
| 4 | IF-07 | CKAM runs as SYSTEM on a shared server | EXT-06 |
| 5 | IF-08 | Backups on the same server, unencrypted, untested | EXT-08 |
| 6 | IF-09 | Dev PC secrets and dumps readable too widely | EXT-10 |
| 7 | N2 | Loopback `X-Forwarded-For` trusted by uvicorn defaults | `--no-proxy-headers` in the production launcher (EXT-13) |
| 8 | IF-16 | ERP link without TLS; SELECT-only grant not evidenced | EXT-25 |
| 9 | IF-17, D6, MFA | No CI; Full Admin across companies; no MFA | EXT-28, EXT-26, EXT-19 |
| 10 | AU-04 | Targeted lock-out of a known login id | Accepted design; EXT-05, EXT-19 |
| 11 | AU-06 | An already-rotated refresh token stays valid until sign-out or expiry (8 h) | Backlog (needs server-side token storage) |
| 12 | IF-13, IF-15, FONTS | Dev image as root; runbook/launcher not in git; Google Fonts | Backlog, EXT-13, EXT-11 |
| 13 | IF-12, AU-02, N3 | Accepted | — |

---

## 14. Limitations

1. **IF-01 on Windows not executed.** All traversal tests ran on Linux containers. Production is Windows. The fix
   (`Path.resolve()` + `is_relative_to`) covers backslash, drive-letter and UNC forms by design, but this was not
   executed. Run the EXT-01 probes plus `..%5c`, `C:%2fWindows%2fwin.ini`, `%5c%5cserver%5cshare` on production
   right after the deploy.
2. **Concurrency bursts by the retest agent were blocked** (the session stopped while the burst script was being
   written; `retest/concurrency_results.md`). They were replaced by permanent asyncio tests
   (`backend/tests/core/test_security_concurrency.py`) and existing idempotency/row-lock tests. These run through
   the app against a real PostgreSQL but in one process, not as an external load.
3. **Not exercised:** the live ERP connection and its TLS (stand-ins used), HTTPS and the `Secure` cookie, a
   container operating-system package scan, `pip-audit` online re-run in the retest (installed versions were
   byte-identical to the audited set), mass lock-out and exhausting the shared Docker address (calculated, not
   executed), `master_audit` row triggers (table empty on the test stack; the TRUNCATE trigger was verified),
   and production itself.
4. **Fixes after the retest** (`d04779a`: N1, N4, AU-08 follow-up; `da790d1`: RACE-1) are verified by permanent
   tests only, not by a second independent retest.
5. **Test counts.** The infrastructure area has no CSV (about 60 checks recorded as text). The input CSV has 67
   rows, not 60 as stated in the brief. `retest_tests.csv` has 30 duplicated ids. The CSP Playwright evidence
   shows 34 screen visits; the lead's summary quotes 33. The Playwright permanent-suite result is
   (11 passed, 1 skipped (the ERP-link spec skips itself because the ERP link is intentionally off on the test stack); the one earlier failure was two Playwright runs sharing one artifact folder and passed alone). The backend total 1783 is confirmed.
6. **Not independent.** Testers belong to the team that builds CKAM. An external VAPT is planned (EXT-14).
7. **Point in time.** Results apply to the code at the commits named above, on 2026-10-15.

---

## 15. Security domains

| Domain | Result | One-line evidence |
|---|---|---|
| Authentication | PASS | Argon2id; HS256 pinned and tamper-proof; constant-time refusal (AU-01); rate limits (AU-03); revocable sessions (AU-05/07); password policy (AU-08). Residuals: AU-04 lock-out, AU-06 rotation, no MFA, plain HTTP in production (external) |
| Authorization | PASS | 217 routes × 11 personas retested, 2,387 cells, 0 escalations; 13 changed cells all expected (`retest/access_raw/authz_matrix_diff.csv`) |
| Company isolation | PASS | 208 IDOR/BOLA cases pass; IF-03 and AC-2 fixed. Full Admin across companies is by design (D6 open) |
| IT/NON_IT isolation | PASS | Work-area personas in the matrix and IDOR battery; Playwright "Full Admin Non-IT: a deep link to an IT asset shows 'Asset not found.'"; `backend/tests/core/test_s0_work_area.py` |
| Self-service isolation | PASS | AC-1 fixed (44 cases 403); self-service sees only its own assets (IDOR battery, Playwright self-service journeys) |
| Input validation | PASS | 39-row input battery and 17 malformed-request sweep: no 5xx; friendly 422; body limits (N1, IN-02) |
| Injection | PASS | SQL injection battery and raw-SQL review clean; no SSRF or command-injection sinks; formula injection neutralised |
| XSS | PASS | Planted payloads inert on every screen visited; CSP without `unsafe-eval` or inline script, 0 violations |
| File security | PASS (code at HEAD); **production FAIL until EXT-01** | IF-01 fixed and retested (36 × 2); IN-02 and IN-03 fixed; downloads `attachment` + `nosniff` |
| Business logic | PASS | Logic/idempotency battery 7/7; escalation 16/16 (1 N/A harness artefact); Primary-Owner protections and PO-LOGIN fixed |
| Concurrency | PASS | AU-16 fixed; RACE-1 found and fixed; 4 permanent asyncio race tests plus existing row-lock and numbering tests. Limitation: no external burst run |
| Idempotency | PASS | `backend/tests/core/test_s7_idempotency.py`; retest logic battery 7/7 |
| Logging | PASS | No password, token or cookie in any log, audit or report; log injection controlled; `RATE_LIMITED` and session-ended events recorded. Residual N2 (forged IP from loopback) |
| Audit integrity | PASS for the application role | UPDATE/DELETE/TRUNCATE refused; purge floor 5 years; non-superuser cannot switch guards off. **Residual:** the table owner or a superuser can disable or drop the triggers, and in production the app role is the owner (EXT-07) |
| Secret handling | PASS (repository and code); **production FAIL until EXT-02** | No secrets in the tree or 282 scanned commits; production refuses placeholder or weak JWT secrets. But IF-01 exposed the production secrets to anyone able to read them |
| Dependency security | PASS | npm production 0 vulnerabilities (141 packages); `python-jose`/`ecdsa` advisories not reachable (HS256 pinned); no lock file before → `backend/constraints.txt` added |
| Database security | PARTIAL | Append-only triggers, TRUNCATE guards, purge floor, bound parameters; but the app role owns the tables in production and the Docker app role is a superuser (`db_01`, AU-T095) |

---

## 16. Verdict

### Final VAPT verdict

The verdict rule used: **NOT READY** if a Critical or High remains, a known exploitable authorization bypass
remains, or there is secret leakage, authentication bypass, SQL injection, stored XSS, unsafe file access,
broken audit integrity, or failing security regression tests.

Applied to the **code at HEAD `d04779a`**: no Critical remains (IF-01 fixed and retested); the one High (IF-02,
plain HTTP) is an infrastructure item that cannot be fixed in code; no authorization bypass, authentication
bypass, SQL injection, stored XSS or unsafe file access remains; audit integrity holds for the application role;
security regression tests pass. Applied to **production**: IF-01 (unsafe file access and secret leakage) is
still live.

> ## `CKAM SECURITY ASSURANCE READY WITH NON-BLOCKING OBSERVATIONS (for the local/UAT code at HEAD) — with a BLOCKING EXTERNAL condition: production is NOT ready until the IF-01 fix is deployed, the three secrets are rotated, and HTTPS is planned`

**Why this verdict.** The code at HEAD meets every condition of the rule: the only remaining High needs a server
change, not a code change, and every open item in the code is low, accepted or mitigated with a stated residual.
But production still runs the release with IF-01 and its secrets may already be known, so calling production
ready would be false; the blocking condition says exactly what must happen first.

"The three secrets" are the JWT secret, the production database password and the NAS password; the ERP
password should be rotated at the same time (EXT-02).


---


# PART B — Findings register

(source file: docs/security/CKAM_SECURITY_FINDINGS_REGISTER.md)

# CKAM Security Findings Register

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Date | 2026-10-15 |
| Code state | Local HEAD `d04779a` (worktree `ckam-build`). Programme started at `4ba4e94`. **Nothing pushed, nothing deployed.** Production (10.0.1.98) still runs release `3b5e842` |
| Sources | `docs/security/evidence/` (access, auth, input, infra, retest), the commits listed in the Commit column, and the changed code and tests themselves |
| Companion documents | `CKAM_SECURITY_REMEDIATION_REPORT.md` (how each fix was made and tested), `CKAM_VAPT_REPORT.md` (scope, method, verdict), `CKAM_EXTERNAL_SECURITY_ACTIONS.md` (EXT-xx actions), `CKAM_THREAT_MODEL.md` |

> This register is an internal security-testing record. It is **not** a certification. CKAM is not ISO/IEC 27001
> certified and has no SOC 2 report.

## In plain words

The security test found **43 distinct problems** (after merging duplicates). The one that matters most is
**IF-01**: the live server hands out any file on the server to anyone who asks for it in a certain way. That
includes the file that holds the database password and the key that signs every login. The fix is written and
proven on the development PC. **Production is still exposed until the fix is deployed and those secrets are
changed.**

All the other serious problems that could be fixed in the code are fixed and retested. What is left needs
server, network or management work (HTTPS, a low-privilege service account, off-server backups, a separate
database role), not more code.

## Counts

### By severity

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 1 | IF-01 |
| HIGH | 1 | IF-02 |
| MEDIUM | 14 | IF-03, IF-04, IF-05, IF-06, IF-07, IF-08, IF-09, IF-10, AU-01, AU-03, AU-04, AU-05, AC-1, N1 |
| LOW | 22 | IF-11, IF-12, IF-13, IF-14, IF-15, IF-16, AU-02, AU-06, AU-07, AU-08, AU-12, AU-13, AU-14, AU-15, AU-16, AC-2, IN-02, N2, N3, N4, PO-LOGIN, RACE-1 |
| INFO | 5 | IN-03, IF-17, D6, MFA, FONTS |
| **Total** | **43** | |

### By status

| Status | Meaning | Count | IDs |
|---|---|---|---|
| FIXED (code) — OPEN EXTERNAL until deployed | Fixed and retested in code; production still vulnerable | 1 | IF-01 |
| FIXED | Fixed in a local commit and retested (or covered by a permanent regression test, see the Retest column) | 22 | IF-03, IF-04, IF-10, AU-01, AU-03, AU-05, AC-1, N1, IF-11, IF-14, AU-07, AU-08, AU-12, AU-14, AU-15, AU-16, AC-2, IN-02, N4, PO-LOGIN, RACE-1, IN-03 |
| MITIGATED | Risk reduced in code; a stated residual remains | 4 | IF-05, IF-06, AU-04, AU-06 |
| ACCEPTED | Kept as is, with a written reason | 3 | IF-12, AU-02, N3 |
| OPEN EXTERNAL | Needs server, network, database-administration, supplier or management action | 10 | IF-02, IF-07, IF-08, IF-09, IF-16, AU-13, N2, IF-17, D6, MFA |
| OPEN | Not fixed; could be done by the developers | 3 | IF-13, IF-15, FONTS |
| **Total** | | **43** | |

By severity and status: CRITICAL 1 (FIXED code / OPEN EXTERNAL). HIGH 1 (OPEN EXTERNAL). MEDIUM 14 (8 FIXED,
3 MITIGATED, 3 OPEN EXTERNAL). LOW 22 (13 FIXED, 1 MITIGATED, 3 ACCEPTED, 3 OPEN EXTERNAL, 2 OPEN).
INFO 5 (1 FIXED, 3 OPEN EXTERNAL, 1 OPEN).

**Fixes are local only.** "FIXED" means fixed in a local commit and retested on the development PC. None of
these commits is pushed or deployed. Production keeps every one of these problems until a deploy (EXT-01).

### Duplicates merged (listed once)

| Merged ID | Listed as | Why |
|---|---|---|
| IN-01 | IF-01 | Same `/assets/{file_path:path}` traversal, found by the input review (code reading) and proven by the infra test |
| AU-09 | IF-04 | Same placeholder JWT secret start-up issue |
| AU-10 | IF-05 | Same TRUNCATE-on-audit-tables issue |
| AU-11 | IF-14 | Same `/docs`, `/redoc`, `/openapi.json` exposure |
| "Primary-Owner login clash" / "Login clash" | PO-LOGIN | Name used in `retest_access.md` and `CKAM_ISO27001_READINESS.md` |

### Severity and status changes (do not smooth over)

| ID | Earlier | Now | Reason |
|---|---|---|---|
| IN-01 → IF-01 | Input review: "GAP … SUSPECTED by code review", not reproducible on the sec stack (`evidence/input/raw_sql_review.md`). The lead's note calls this "MEDIUM/SUSPECTED"; the evidence file itself states no severity | **CRITICAL** | The infra test reproduced it in a production-layout container and read `shared/.env` and `shared/nas.pw` (fake canaries) (`evidence/infra/static_route_traversal_and_startup.txt` section B) |
| AU-02 | `CKAM_ISO27001_READINESS.md`: IN PROGRESS | ACCEPTED (LOW) | Lead decision recorded in commit `ae706bb`: answering "locked" only to the right password would make the lock a password-guessing oracle |
| AU-04 | ISO readiness: ACCEPTED (design) | MITIGATED (MEDIUM) | Rate limits (AU-03) now slow mass lock-outs; the residual (targeted lock-out) is accepted design |
| AU-08 | Retest: MITIGATED (`Password@2026`, `Welcome@2026` accepted) | FIXED | Closed in `d04779a`; covered by a permanent test; **not re-run by the independent retest agent** |
| AU-15 | Retest: MITIGATED (single-port production had no body cap, N1) | FIXED | N1 closed in `d04779a` |
| IF-04 / IF-14 | Retest: FIXED with residual N4 | FIXED (hardened) | N4 closed in `d04779a` |
| IF-13 | ISO readiness: ACCEPTED (dev-only image) | OPEN (LOW) | Lead's final status: still open, dev image only |
| IN-03 | Evidence: INFO (`raw_sql_review.md`, `retest_auth_input_infra.md`). The lead's final list groups it under LOW | **INFO kept** | The brief says "severities as in the evidence"; the exploit path was already neutralised by `nosniff` + `attachment` |

---

## Register

Column notes: **Retest** names the evidence file and test ids. `RT-AU-T…` ids are in
`docs/security/evidence/retest/retest_tests2.csv`; `RT-AC-…` ids in `docs/security/evidence/retest/retest_tests.csv`
(note: in that file the ids `RT-AC-T700`…`RT-AC-T729` are used twice, once by group `retest-AC1-AC2-IF03`
(`RT-AC-T600`…`T729`) and once by group `retest-sessions-clash-massassign` (`RT-AC-T700`…`T750`), so a group name is
given where it matters). CVSS 3.1 is shown **only** where the evidence gives it.

### CRITICAL and HIGH

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| IF-01 (= IN-01) | CRITICAL | Path traversal / arbitrary file read (CWE-22) | `backend/app/main.py::_serve_frontend_asset` (`GET /assets/{file_path:path}`), single-port mode (`FRONTEND_DIST_DIR` set), which is how production runs | The URL path was joined onto `<dist>/assets` with no containment check. `..%2f`, `%2e%2e`, `//etc/passwd` and `%2fetc%2fpasswd` returned files outside the folder. In a copy of the production folder layout the route returned `shared/.env` (JWT secret, database URL) and `shared/nas.pw` (fake canary values). Present in every release since 2026-09-30, including live `3b5e842` | An anonymous person who can reach port 3211 (forwarded from the internet) can read server secrets, forge a head-office-admin login, read or change all CKAM data, and use the database, NAS and ERP passwords | Resolve the requested path, then require it to sit inside `<dist>/assets` (`Path.resolve()` + `is_relative_to`); anything else is a plain 404 | 36 probe variants × 2 runs in a network-less production-layout container: all 404, 0 leaks; legitimate files still 200 (RT-AU-T801…T836; `retest/aii_raw/if01_run1.txt`, `if01_run2.txt`). Permanent test `backend/tests/test_static_frontend.py::test_assets_route_cannot_read_files_outside_the_assets_folder`. Windows path behaviour not executed (Linux only) | **FIXED (code) — OPEN EXTERNAL until deployed** (EXT-01 deploy, EXT-02 rotate secrets, EXT-03 compromise check) | `3e134c1` |
| IF-02 | HIGH | Cleartext transmission (CWE-319) | Production uvicorn on `http://10.0.1.98:3211`, router forward of TCP 3211 | Sign-in, tokens and all data travel over plain HTTP, also from the internet | Passwords and sessions readable by anyone on the network path (store Wi-Fi, ISP) | HTTPS reverse proxy in front of uvicorn; restrict or close the internet forward (EXT-04, EXT-05) | Not testable locally | OPEN EXTERNAL | — |

### MEDIUM

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| IF-03 | MEDIUM | Broken object-level authorization, cross-company (CWE-639) | `backend/app/erp/service.py::build_draft`, `backend/app/erp/router.py::po_draft` | A CKSPL operator could open the ERP PO draft of a CKVPL PO (supplier, rates, warehouse), and the reverse (`evidence/infra/erp_cross_company_draft.txt`) | Another company's commercial data disclosed | `build_draft` raises `NotAllowed` when the PO's company is outside the login's scope; the router answers the same 404 body as a missing PO (no existence oracle) | Both directions 404, own company 200, receipts/PI 404, list shows own company only (group `retest-AC1-AC2-IF03`, `RT-AC-T713`…`T729`; `RT-AU-T601`…`T608`). Exercised on the local ERP copy | FIXED | `7e57844` |
| IF-04 (= AU-09) | MEDIUM | Hard-coded / insecure default secret (CWE-798, CWE-1188) | `backend/app/main.py::refuse_to_start_with_insecure_secret`, `is_production`, `lifespan` | With `ENVIRONMENT_NAME=production` the app started with the committed placeholder `JWT_SECRET` (only a warning line) | Anyone who has read the source could forge admin tokens | Refuse to start in production when `JWT_SECRET` is a known placeholder, shorter than 32 characters, or has fewer than 8 distinct characters. Hardened by N4 | RT-AU-T901…T913 (refused: dev default, unset, `change_me_too`, 31 chars, empty; starts with 32 and 48 chars; message does not echo the secret). N4 follow-up: `backend/tests/core/test_production_secret_guard.py` | FIXED | `7e57844`, `d04779a` |
| IF-05 (= AU-10) | MEDIUM | Audit integrity (CWE-778) | Append-only tables `asset_event`, `asset_field_change`, `master_audit`, `audit_log` | Row triggers refused UPDATE/DELETE, but row triggers do not fire on TRUNCATE: one statement emptied a ledger (`evidence/infra/db_03_append_only_privilege_tests.out.txt` A7) | Audit trail and asset history could be erased | Migration `a3c5e7f9b1d4`: statement-level `BEFORE TRUNCATE` trigger (`forbid_append_only_truncate`) on all four tables | TRUNCATE refused for the app role on all four (RT-AU-T9800…T9821, `retest/aii_raw/rt_append_only.out.txt`). Residual FAILs RT-AU-T9817/T9818: the owner or a superuser can still `DISABLE TRIGGER` or use `session_replication_role=replica` | MITIGATED (owner/runtime role split = EXT-07) | `ae706bb` |
| IF-06 | MEDIUM | Audit integrity / bypass by session flag (CWE-778, CWE-284) | Trigger function `forbid_audit_log_write`, function `ckam_purge_audit_log` | Any role could `SET LOCAL ckam.allow_audit_purge = on` and delete the newest audit rows (`db_03` A6, `db_04_least_priv_flag_bypass.out.txt` D2). The table owner can disable or drop the triggers (`db_03` C1-C3) | Recent audit rows erasable by the application's own role | Same migration: the flag only opens rows older than a fixed 5-year floor written into the trigger function; `ckam_purge_audit_log` refuses a cut-off newer than 5 years; EXECUTE stays revoked from PUBLIC | Newest row and every row under 5 years refused with the flag; `ckam_purge_audit_log(now())` and `(now() - 4y11m)` refused (RT-AU-T98xx). Owner bypass unchanged | MITIGATED (EXT-07) | `ae706bb` |
| IF-07 | MEDIUM | Excessive privilege (CWE-250) | Scheduled task `CKAM-Web` on 10.0.1.98 | Runs as SYSTEM on a server shared with Spinwheel and Citykart Desk | Any CKAM flaw becomes control of the whole server and the other apps | Dedicated low-privilege service account (EXT-06) | n/a (server) | OPEN EXTERNAL | — |
| IF-08 | MEDIUM | Backup and recovery | Backup task on 10.0.0.205 | Nightly dumps sit on the same server as the database, unencrypted, never restore-tested in production | Permanent data loss on disk failure, ransomware or mistake | Off-server encrypted copy, NAS backup, quarterly restore test (EXT-08) | n/a | OPEN EXTERNAL | — |
| IF-09 | MEDIUM | Sensitive files too widely readable (CWE-552) | Dev PC 10.0.0.47: repository `.env`, `backups\` | Dev secrets and about 30 dev dumps (with a copy of real ERP vendor/PO data) readable by more accounts than needed | Leak of real vendor/PO data and dev credentials | ACL, disk encryption, purge old dumps (EXT-10) | n/a | OPEN EXTERNAL | — |
| IF-10 | MEDIUM | Uncontrolled resource consumption (CWE-400) | `backend/app/erp/source.py::PgReadOnly` (`_server_settings`, `_connect`, `_fetch`), `backend/app/erp/warehouse.py::PgWarehouseReader` | ERP reads had no connect or statement timeouts | A slow or unreachable ERP hangs requests and the background copy | Connect timeout 10 s, `statement_timeout` 60 s (background copy 120 s), client-side timeout, explicit READ ONLY transaction, `application_name=ckam` | Black-hole listener: 503 after 10.01 s; `pg_sleep` with a 2 s limit: 503 at 2.02 s; writes refused (RT-AU-T970…T979, `retest/aii_raw/erp_connect_out.txt`, `erp_stmt_out.txt`). No real ERP used | FIXED (TLS and role-level read-only remain IF-16) | `ae706bb` |
| AU-01 | MEDIUM | User enumeration by timing (CWE-208) | `backend/app/auth/router.py::login`, `backend/app/core/security.py::burn_password_check` | Existing account about 42 ms vs about 7 ms for unknown, disabled or locked accounts (`evidence/auth/t_existing.txt` vs `t_nonexist.txt`) | An outsider learns which login ids exist | Every refused sign-in does the same Argon2 work (check against a dummy hash) | 36 interleaved samples per case: medians 39.4-42.2 ms, spread 2.8 ms (RT-AU-T990…T996, `retest/aii_raw/timing_out.json`) | FIXED | `ae706bb` |
| AU-03 | MEDIUM | Improper restriction of authentication attempts (CWE-307) | `backend/app/core/rate_limit.py`; `POST /api/auth/login`, `/refresh`, `/change-password` | 171 failed sign-ins from one address were never blocked; `X-Forwarded-For` spoofing evaded the account lock (AU-T034, AU-T036) | Unthrottled password guessing | In-process sliding window: login 20/min per address and 10/min per login id, refresh 60/min, change-password 10/min; 429 with `Retry-After` and a plain sentence; `RATE_LIMITED` security audit row; `X-Forwarded-For` believed only from `TRUSTED_PROXIES` | RT-AU-T1002…T1011 pass, except T1009 (= N2) and T1010 (= N3) (`retest/aii_raw/ratelimit_out.json`) | FIXED | `ae706bb` |
| AU-04 | MEDIUM | Account lock-out abuse (CWE-645) | Lock-out rule in `login` (5 wrong / 15 min) | Anyone who knows a login id can lock that person out (AU-T032) | Real users locked out | Rate limits (AU-03) slow mass lock-outs; the head-office admin's Reset Password clears a lock | Still lockable by design (RT-AU-T313/T314, INFO). One address can keep about 60 accounts locked (calculated, not executed) | MITIGATED (residual accepted design; options EXT-05, EXT-19) | `ae706bb` |
| AU-05 | MEDIUM | Insufficient session expiration (CWE-613) | `asset_user.token_version` (migration `f9a1c3e5b7d2`); `backend/app/core/security.py::end_all_sessions`, `token_is_current`; `backend/app/core/deps.py::get_current_asset_user`; `backend/app/auth/router.py::logout`, `refresh`, `change_password`; `backend/app/asset_users/service.py` | Logout, password change and admin reset left the old access and refresh tokens valid until they expired (AU-T037) | A copied token survives sign-out | Every token carries the account's session version `tv`; sign-out, password change/reset, deactivation, sign-in switched off and access changes raise it | Old access and refresh tokens 401 after every trigger; other users unaffected (RT-AU-T101…T115, T134; group `retest-sessions-clash-massassign`; `retest/access_raw/sessions_transcript.txt`) | FIXED | `ae706bb` (browser side `4fa5c9b`) |
| AC-1 | MEDIUM | Broken function-level authorization (CWE-863; OWASP API5:2023). CVSS 3.1 `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N` = 4.3 | `backend/app/masters/router.py::build_master_router.list_items`, `backend/app/masters/custom_fields_router.py::list_custom_fields`, `backend/app/numbering/router.py::list_rules`, `preview_rule`, `backend/app/bundles/router.py::list_all` | Own-Assets-Only (self-service) logins, including store logins, could read every setup list, including vendor GSTIN and contacts of both companies (`evidence/access/findings.csv`, `self_service_masters.txt`) | Vendor contact data and configuration disclosed to the lowest role | Lists require `require_role(*READ_ROLES)` (staff roles only) | 44 self-service cases 403, 55 staff cases 200 (group `retest-AC1-AC2-IF03`, `retest/access_raw/ac_fixes_transcript.txt`); matrix diff shows exactly the 13 expected cells changed (`retest/access_raw/authz_matrix_diff.csv`) | FIXED | `77431ba` |
| N1 | MEDIUM | Uncontrolled resource consumption (CWE-770; OWASP API4:2023). CVSS 3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` = 5.3 (`A:H` = 7.5 if the shared server is affected) | `backend/app/core/body_limit.py::BodyLimitMiddleware` (new), registered in `backend/app/main.py` | Found in the retest: single-port production had no request-body cap; an unauthenticated 256 MB sign-in body was read in full before the 422 (uvicorn peak 914 MB) | Memory exhaustion on a server shared with other apps | Pure ASGI middleware, outermost: 64 KB for `/api/auth/*`, 16 MB for multipart uploads, 5 MB for other bodies; checks `Content-Length` and counts chunked bodies; 413 with the usual JSON envelope | Found by RT-AU-T960 (`retest/aii_raw/bigbody_out.txt`). Fix covered by `backend/tests/core/test_body_limit.py` (5 tests). **Not re-run by the retest agent** | FIXED | `d04779a` |

### LOW

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| IF-11 | LOW | Supply chain: no lock file | `backend/pyproject.toml`; production `pip install -e` at deploy | No Python lock file; production resolves package versions at install time | Production may run untested versions | `backend/constraints.txt` pins the tested set | Rebuilt image `pip freeze` identical to the audited set (`retest/aii_raw/pip_freeze_rebuilt.txt`) | FIXED (using it in the production install = EXT-12) | `ae706bb` |
| IF-12 | LOW | Known-vulnerable dependency, not reachable | `python-jose`, `ecdsa` | pip-audit advisories (3 records, 2 packages) (`evidence/infra/raw/pip_audit.json`) | Not reachable: HS256 is pinned, no ECDSA use | None now; review when replacing the JWT library | Versions unchanged | ACCEPTED | — |
| IF-13 | LOW | Container hardening (CWE-250) | `backend/Dockerfile` (dev/UAT only) | The image runs as root and includes development dependencies | Dev/UAT only; production does not use Docker | Non-root user, separate dev dependencies | — | OPEN | — |
| IF-14 (= AU-11) | LOW | Information exposure (CWE-651) | `backend/app/main.py::docs_urls` | `/docs`, `/redoc`, `/openapi.json` open in production | Full API map for anonymous visitors | Switched off in production; after N4 any name that is not an explicit development name counts as production | Production without the dist folder: 404; with it: the SPA shell, no API map (`retest_auth_input_infra.md` row AU-11); `backend/tests/test_vapt_headers_and_docs.py` | FIXED | `ae706bb`, `d04779a` |
| IF-15 | LOW | Change management | `docs/ai/CKAM_RELEASE_RUNBOOK.md`; production launcher `run_ckam_web.ps1` and release script (server only) | Runbook describes Docker; production launcher and release script are not in git | Production steps and flags (for example N2) are not reviewed or versioned | Put the scripts in git; Windows runbook (EXT-13) | — | OPEN (needs IT access to the server) | — |
| IF-16 | LOW | ERP channel | `backend/app/erp/source.py`; ERP role `ckpost` on 10.0.1.69 | No TLS on the ERP connection; read-only is enforced by CKAM's connection setting only; SELECT-only grant not evidenced | ERP password and data in clear on the LAN | ERP owner: SELECT-only grant, role-level read-only, `hostssl`; then a TLS option in code (EXT-25) | Not exercised (no ERP) | OPEN EXTERNAL | — |
| AU-02 | LOW | Account-state disclosure (CWE-204) | `backend/app/auth/router.py::login` | HTTP 423 tells a stranger that a login id exists and is locked (AU-T006) | Small enumeration of locked accounts | Kept: 423 for any password. Alternative rejected: saying "locked" only to the right password would turn the lock into a password-guessing oracle | 423 for right and wrong password (RT-AU-T301/T302); `backend/tests/auth/test_vapt_login.py::test_a_locked_account_says_locked_for_any_password_so_the_lock_is_no_guessing_oracle` | ACCEPTED | `ae706bb` (decision) |
| AU-06 | LOW | Session token reuse (CWE-384) | `backend/app/auth/router.py::refresh`, `backend/app/core/security.py::create_refresh_token` | The refresh token was not rotated; an old one stayed reusable (AU-T038, AU-T039) | A copied refresh cookie usable for up to 8 h | Every refresh issues a new unique token (`jti`); all earlier tokens die on sign-out, password or access change. No reuse detection: an already-rotated token stays valid until then or until expiry (single-use needs server-side storage) | New token each call PASS; RT-AU-T103 FAIL (residual) | MITIGATED | `ae706bb` |
| AU-07 | LOW | Insufficient session expiration (CWE-613) | `backend/app/core/deps.py::get_current_asset_user`; `backend/app/asset_users/router.py::_access_reduced_or_changed`, `update_asset_user`; `backend/app/asset_users/service.py` | Switching sign-in off left the access token valid up to 15 min; role, work-area and company changes applied only at the next refresh (AU-T041) | A removed user keeps acting for a while | Sign-in switch checked on every request; access changes raise the session version | Each change 401/401 at once; harmless edits keep the session (RT-AU-T120…T133; group `retest-sessions-clash-massassign`) | FIXED | `ae706bb` |
| AU-08 | LOW | Weak password requirements (CWE-521) | `backend/app/auth/password_policy.py::password_problem`; `backend/app/auth/router.py::change_password` | Only a length rule (AU-T047) | Guessable passwords | Refuse common passwords, same-character or simple runs, brand + digits, the person's own code/name/email; follow-up: a common base word with digits, symbols or look-alike characters around it | RT-AU-T201…T221 pass except T217/T218 (`Password@2026`, `Welcome@2026` accepted), closed in `d04779a` by `test_a_common_word_with_digits_or_symbols_around_it_is_refused`. Follow-up **not re-run by the retest agent** | FIXED | `ae706bb`, `d04779a` |
| AU-12 | LOW | Information exposure (CWE-540) | `frontend/nginx.conf`, `frontend/vite.config.ts` | `*.js.map` looked reachable. The maps were never built: nginx's SPA fallback answered `index.html` with 200 for any `.map` path (AU-T065) | Misleading result; real exposure if maps were ever built | `location ~* \.map$` returns 404; a missing `.js/.mjs/.css` returns 404; `build.sourcemap: false` | RT-AU-T411…T414; `npm run build` produces 0 `.map` files | FIXED | `4fa5c9b` |
| AU-13 | LOW | Cookie without `Secure` (CWE-614) | Refresh cookie (`HttpOnly; SameSite=lax; Path=/api/auth`) | Not `Secure` because production is plain HTTP (AU-T040) | Cookie sent in clear | `COOKIE_SECURE=true` once HTTPS exists (EXT-04) | Not retested | OPEN EXTERNAL | — |
| AU-14 | LOW | Missing browser hardening (CWE-693) | `frontend/nginx.conf`; `backend/app/main.py::_security_headers`; `frontend/src/lib/zod-config.ts` | No Content-Security-Policy or Permissions-Policy (AU-T059, AU-T060) | No defence in depth against script injection | CSP without `unsafe-eval` or inline script; Permissions-Policy turns off camera, microphone, geolocation, payment, usb; zod set to `jitless` (its eval probe was the only violation) | Headers once on every response type (RT-AU-T401…T425, T451…T458); Playwright: 0 CSP violations, 0 page errors (`retest/aii_raw/pw_csp_results.json`: 34 screen visits, 24 as SECHO + 10 as SECOPIT; the lead's summary says 33) | FIXED | `4fa5c9b`, `ae706bb` |
| AU-15 | LOW | Information exposure / resource limits (CWE-200, CWE-770) | `frontend/nginx.conf`; `backend/app/core/body_limit.py` | `Server` header showed versions; nginx's 413 was an HTML page; no body cap without nginx (AU-T061, AU-T068) | Version fingerprinting; production had no cap | `server_tokens off`; JSON 413; production cap by N1 | `Server: nginx` / `uvicorn` without version; 12 MB through nginx gives a JSON 413 (RT-AU-T409/T410); production part via N1 tests | FIXED | `4fa5c9b`, `d04779a` |
| AU-16 | LOW | Race condition (CWE-362) | `backend/app/auth/router.py::login` (failed-attempt counter) | 20 parallel wrong guesses: 6 processed, the lock threshold was exceeded (AU-T035) | More guesses than the lock allows | One atomic `UPDATE … RETURNING` that counts only while the account is not locked; the reset on success is conditional too | Count stops at 5, one LOCKED event (RT-AU-T1001); `test_vapt_login.py::test_twenty_parallel_wrong_guesses_stop_at_the_threshold` | FIXED | `ae706bb` |
| AC-2 | LOW | Cross-company disclosure (CWE-639; OWASP API1:2023) | `backend/app/masters/custom_fields_router.py::list_custom_fields` | Custom-field definitions of every company were listed to any staff login (AC-T520…T522) | Small cross-company configuration leak | Filter by `scoped_company_ids` (global fields plus own companies) | CKSPL logins see [1], CKVPL logins [2], a login with both [1,2]; `?company_id=2` does not widen (group `retest-AC1-AC2-IF03`) | FIXED | `77431ba` |
| IN-02 | LOW | Uncontrolled resource consumption (CWE-400) | `backend/app/core/uploads.py::read_upload_bounded`; import routes in `imports/router.py`, `asset_users/router.py`, `masters/router.py` | Excel imports were read whole into memory with no cap (IN-T117; head-office-admin / Full-Admin routes only) | Memory exhaustion by an admin upload | Read in 1 MB pieces; refuse above 15 MB with 413 | 16 MB file gives 413 in 89 ms (`RT-AC-T815`, RT-AU-T610…T612, T961) | FIXED | `ba04371` (outer limit `d04779a`) |
| N2 | LOW | Reliance on an untrusted header (CWE-348, CWE-290) | uvicorn default `--proxy-headers --forwarded-allow-ips=127.0.0.1` (production launcher; also `backend/Dockerfile` CMD) | A client connecting from 127.0.0.1 can set `X-Forwarded-For`: it escapes the per-address sign-in limit and writes a forged IP into the audit trail | Needs local access to the CKAM server (other apps share it) | Run uvicorn with `--no-proxy-headers` in the production launcher, which is not in git (EXT-13); set `TRUSTED_PROXIES` when an HTTPS proxy arrives | RT-AU-T1009 FAIL (`retest/aii_raw/xff_out.json`) | OPEN EXTERNAL | — |
| N3 | LOW | Shared rate-limit bucket (CWE-770) | `frontend/nginx.conf` (`/api/` sends no `X-Forwarded-For`); `docker-compose.yml` (no `TRUSTED_PROXIES`) | Docker dev/UAT only: every browser user has the nginx container's address, so 20 sign-ins per minute in total | Dev/UAT availability; audit IPs show nginx. Production not affected | Accepted for dev/UAT; the UAT Playwright run switches the limits off for that stack only | RT-AU-T1010 | ACCEPTED | — |
| N4 | LOW | Insecure default (CWE-1188, CWE-798) | `backend/app/main.py::is_production` | Found in the retest: production protections applied only when `ENVIRONMENT_NAME` was exactly `production`/`prod`; `prd`, `live` or unset started with the placeholder secret and served `/docs` (RT-AU-T910…T913) | IF-04 and IF-14 could fail open on one wrong `.env` line | Only `development, dev, test, testing, uat, security-test, local, ci` are non-production; anything else (including empty) is production; blank or low-variety secrets refused | `backend/tests/core/test_production_secret_guard.py`, `backend/tests/test_vapt_headers_and_docs.py`. **Not re-run by the retest agent** | FIXED | `d04779a` |
| PO-LOGIN | LOW | Authentication availability | `backend/app/auth/router.py::login` (login-id matching) | An employee whose code equals the Primary Owner's name made the head-office-admin login ambiguous (401): a lock-out by anyone allowed to add an employee | Head-office admin locked out | The same row counts once; on a clash the Primary Owner matched by exact name wins | With employee code `SECHO` present, `SECHO` and `secho` sign in as the Primary Owner (RT-AU-T311/T312; group `retest-sessions-clash-massassign`). Side effect (INFO): such an employee cannot sign in by code, and each attempt counts one failure against the Primary Owner | FIXED | `77431ba` |
| RACE-1 | LOW | Race condition (CWE-362) | `backend/app/masters/router.py::_refuse_duplicate_name` | Found by the lead while writing concurrency tests: ten parallel creates of a brand with one name produced two rows (check-then-insert); vendors use the same check (listed as SUSPECTED in `retest/concurrency_results.md`) | Duplicate master records | Transaction-level advisory lock on (table, name) before the duplicate check | `backend/tests/core/test_security_concurrency.py::test_ten_parallel_brand_creates_with_one_name_make_one_brand` and `…_vendor_creates_…` (asyncio, through the app). The retest agent's burst run was **not executed** | FIXED | `da790d1` |

### INFO

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| IN-03 | INFO | Upload content not checked (CWE-434) | `backend/app/documents/service.py::content_matches_extension`, `media_type_for`, `save_document`; `backend/app/documents/router.py::download_document` | Documents were checked by extension only; the type the browser claimed was stored and sent back (IN-T118) | Already neutralised by `nosniff` + `attachment`; defence in depth | Signature check per allowed type; the stored and served type comes from the extension, never from the browser | Fakes refused with a plain 422; a real PNG claimed as `text/html` stored and served as `image/png` (RT-AU-T620…T627; `RT-AC-T800`…`T814`). HTML/PDF polyglot with `%PDF-` in the first 1 KB is accepted and served harmlessly as a PDF attachment (INFO) | FIXED | `ae706bb` |
| IF-17 | INFO | Development process | Git repository | No CI, no pre-commit hooks, unsigned commits, single author; remote under a personal account | No independent check of each change | Company-owned repository, MFA, branch protection, CI (EXT-28) | — | OPEN EXTERNAL | — |
| D6 | INFO | Least privilege (decision) | Full Admin role | Full Admins are not limited to chosen companies (owner decision D6 open since 2026-10-14) | A Full Admin of one company can act in the other | Owner decision (EXT-26) | Retest shows the designed behaviour (ADMIN sees both companies) | OPEN EXTERNAL (decision) | — |
| MFA | INFO | Authentication strength | Sign-in | No multi-factor authentication | A stolen password is enough, also for admins | Decision and build (EXT-19) | — | OPEN EXTERNAL (decision) | — |
| FONTS | INFO | Third-party requests / privacy | `frontend/index.html`; CSP allows `fonts.googleapis.com`, `fonts.gstatic.com` | Every page load fetches Inter / IBM Plex Mono from Google Fonts | User IP sent to Google; the CSP must allow two outside hosts | Self-host the fonts. The frontend engineer's notes size this at 94 KB (latin subset) + 126 KB (latin-ext) (EXT-11) | — | OPEN | — |

---

## Observations that are not findings

| Ref | Observation | Source |
|---|---|---|
| N5 | Proxied `/api` responses on the Docker stack carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control` twice (identical values; browsers accept it) | `retest_auth_input_infra.md` |
| N6 | In single-port production an unknown `/api/...` path returns the SPA shell with 200 instead of a JSON 404 (error handling only) | RT-AU-T952 |
| N7 | Sign-out ends every session of that account by design; with shared store logins (EXT-30) one person signing out signs out every device using that store login | RT-AU-T109 |
| N8 | Changing someone's login e-mail does not end their session (not an access change) | RT-AU-T131 |
| N9 | An `audit_log` row INSERTed with an old timestamp can be purged with the flag; real recent rows cannot be backdated (UPDATE refused) | RT-AU-T9811 |
| OBS-TV | `end_all_sessions` raises `token_version` in Python (read + 1), not as one SQL increment. Two revocations at the same moment write the same value; every earlier session still ends. SUSPECTED low impact, not tested | `retest/concurrency_results.md` |
| OBS-STATUS | `Asset.status` has no database-level guard; only the code rule (`lifecycle/service.py::apply_event` is the only writer) protects it | `db_03` A9 |
| OBS-COMMENT | The comment at the top of the password check in `backend/app/auth/router.py::login` still says "locked" (423) is said only to someone who typed the right password. The code (and the AU-02 decision) answer 423 for any password. Behaviour is correct; the comment is stale and should be corrected in a later code change | `backend/app/auth/router.py` |
| OBS-IDS | `retest/retest_tests.csv` reuses ids `RT-AC-T700`…`RT-AC-T729` in two groups (646 rows, 616 unique ids). Counts are unaffected; cite the group name with those ids | `retest/retest_tests.csv` |
| OBS-DOCS | `CKAM_ISO27001_READINESS.md`, `CKAM_SOC2_READINESS.md`, `CKAM_THREAT_MODEL.md` and `CKAM_SECURITY_EVIDENCE_INDEX.md` were written at HEAD `77431ba` and still show `FIXED-PENDING-RETEST` / `IN PROGRESS` for items that this register now shows as FIXED, MITIGATED or ACCEPTED. This register is the later record | those files |


---


# PART C — Remediation report

(source file: docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md)

# CKAM Security Remediation Report

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Date | 2026-10-15 |
| Code range | `4ba4e94` (start of the programme) .. `d04779a` (HEAD), worktree `ckam-build` |
| Commits | `3e134c1`, `7e57844`, `ba04371`, `77431ba`, `4fa5c9b`, `ae706bb`, `da790d1`, `d04779a` (all local; **none pushed, none deployed**) |
| Migrations added | `f9a1c3e5b7d2` (`asset_user.token_version`), `a3c5e7f9b1d4` (TRUNCATE guards, 5-year audit purge floor). Single Alembic head: `a3c5e7f9b1d4` |
| Related | `CKAM_SECURITY_FINDINGS_REGISTER.md` (every finding and its status), `CKAM_VAPT_REPORT.md`, `CKAM_EXTERNAL_SECURITY_ACTIONS.md` |

## In plain words

Twenty-seven problems were fixed or reduced in the code. Each fix has a test that will fail if the problem ever
comes back. The security testers re-ran their attacks against the fixed code; four late fixes (N1, N4, the
password follow-up and RACE-1) came after that retest and are proven by permanent tests only. Some things will look
different to users: people are signed out when their access changes, signing out signs out every device, weak
passwords are refused, and too many sign-in attempts in a minute get a "wait a minute" message.

None of this is live yet. The most urgent step is to deploy it (it closes IF-01) and then change the
production secrets. The order matters and is written in section 5.

---

## Contents

1. Summary table
2. Remediation detail (each FIXED or MITIGATED finding)
3. Existing tests that were changed, and why
4. Behaviour users will notice
5. Migration notes and production deploy order
6. Regression results
7. Least-privilege database role design (DESIGN ONLY, NOT APPLIED)
8. What was not changed, and why

---

## 1. Summary table

| ID | Sev. | Status | Commit | Main code | Permanent test |
|---|---|---|---|---|---|
| IF-01 | CRITICAL | FIXED (code), OPEN EXTERNAL until deployed | `3e134c1` | `backend/app/main.py::_serve_frontend_asset` | `backend/tests/test_static_frontend.py` |
| IF-03 | MEDIUM | FIXED | `7e57844` | `backend/app/erp/service.py::build_draft`, `erp/router.py::po_draft` | `backend/tests/erp/test_erp_api.py` |
| IF-04 | MEDIUM | FIXED | `7e57844`, `d04779a` | `backend/app/main.py::refuse_to_start_with_insecure_secret` | `backend/tests/core/test_production_secret_guard.py` |
| IF-05 | MEDIUM | MITIGATED | `ae706bb` | migration `a3c5e7f9b1d4` | `backend/tests/observability/test_vapt_append_only.py` |
| IF-06 | MEDIUM | MITIGATED | `ae706bb` | migration `a3c5e7f9b1d4` | same |
| IF-10 | MEDIUM | FIXED | `ae706bb` | `backend/app/erp/source.py::PgReadOnly` | `backend/tests/erp/test_vapt_erp_limits.py` |
| AU-01 | MEDIUM | FIXED | `ae706bb` | `backend/app/core/security.py::burn_password_check` | `backend/tests/auth/test_vapt_login.py` |
| AU-03 | MEDIUM | FIXED | `ae706bb` | `backend/app/core/rate_limit.py` | `backend/tests/auth/test_rate_limit.py` |
| AU-04 | MEDIUM | MITIGATED | `ae706bb` | (rate limits) | `test_rate_limit.py`, `test_vapt_login.py` |
| AU-05 | MEDIUM | FIXED | `ae706bb`, `4fa5c9b` | `token_version`, `end_all_sessions`, `token_is_current` | `backend/tests/auth/test_vapt_sessions.py`, `frontend/src/lib/auth-session.test.ts` |
| AC-1 | MEDIUM | FIXED | `77431ba` | `require_role(*READ_ROLES)` on setup lists | `backend/tests/core/test_security_read_scope.py` |
| N1 | MEDIUM | FIXED | `d04779a` | `backend/app/core/body_limit.py` | `backend/tests/core/test_body_limit.py` |
| IF-11 | LOW | FIXED | `ae706bb` | `backend/constraints.txt` | (none; file) |
| IF-14 | LOW | FIXED | `ae706bb`, `d04779a` | `backend/app/main.py::docs_urls` | `backend/tests/test_vapt_headers_and_docs.py` |
| AU-06 | LOW | MITIGATED | `ae706bb` | `create_refresh_token` (`jti`) | `test_vapt_sessions.py` |
| AU-07 | LOW | FIXED | `ae706bb` | `deps.get_current_asset_user`, `_access_reduced_or_changed` | `test_vapt_sessions.py` |
| AU-08 | LOW | FIXED | `ae706bb`, `d04779a` | `backend/app/auth/password_policy.py` | `backend/tests/auth/test_vapt_password_policy.py` |
| AU-12 | LOW | FIXED | `4fa5c9b` | `frontend/nginx.conf`, `frontend/vite.config.ts` | None automated; checked by the build (0 `.map` files) and retest RT-AU-T411…T414 |
| AU-14 | LOW | FIXED | `4fa5c9b`, `ae706bb` | nginx + `main.py::_security_headers`, `zod-config.ts` | `test_vapt_headers_and_docs.py` |
| AU-15 | LOW | FIXED | `4fa5c9b`, `d04779a` | nginx `server_tokens off`, JSON 413; N1 | `test_body_limit.py` |
| AU-16 | LOW | FIXED | `ae706bb` | atomic counter in `auth/router.py::login` | `test_vapt_login.py` |
| AC-2 | LOW | FIXED | `77431ba` | `custom_fields_router.py::list_custom_fields` | `test_security_read_scope.py` |
| IN-02 | LOW | FIXED | `ba04371` | `backend/app/core/uploads.py::read_upload_bounded` | `backend/tests/imports/test_upload_size_limit.py` |
| N4 | LOW | FIXED | `d04779a` | `backend/app/main.py::is_production` | `test_production_secret_guard.py`, `test_vapt_headers_and_docs.py` |
| PO-LOGIN | LOW | FIXED | `77431ba` | `auth/router.py::login` matching | `backend/tests/auth/test_login_primary_owner_clash.py` |
| RACE-1 | LOW | FIXED | `da790d1` | `masters/router.py::_refuse_duplicate_name` | `backend/tests/core/test_security_concurrency.py` |
| IN-03 | INFO | FIXED | `ae706bb` | `documents/service.py::content_matches_extension`, `media_type_for` | `backend/tests/documents/test_vapt_content_check.py` |

"Regression result" in section 2 refers to the full runs in section 6: backend `1783 passed`¹, frontend type
check clean and vitest `1239 passed` in 90 files, security Playwright journeys 14/14.

---

## 2. Remediation detail

Retest evidence paths are relative to `docs/security/evidence/retest/`. `RT-AU-…` ids are in
`retest_tests2.csv` (summary `retest_auth_input_infra.md`); `RT-AC-…` ids in `retest_tests.csv` (summary
`retest_access.md`).

### IF-01 Path traversal on `/assets/{file_path:path}` (CRITICAL)

| | |
|---|---|
| Before | In single-port mode (production), `GET /assets/..%2f..%2f..%2f..%2fshared%2f.env` returned the settings file; `/assets//etc/passwd` and `/assets/%2fetc%2fpasswd` returned system files (`../infra/static_route_traversal_and_startup.txt` A and B, fake canaries) |
| Risk | Anyone on the internet could read the JWT secret, database URL and NAS password, then forge a head-office-admin login |
| Root cause | `candidate = dist_dir / "assets" / file_path` followed `..` segments and treated an absolute path as a new root; there was no containment check. nginx blocks this in Docker, but production has no nginx |
| Code changed | `backend/app/main.py::_serve_frontend_asset`: resolve `<dist>/assets` and the candidate, then `candidate.is_relative_to(assets_root)` and `is_file()`; `OSError`/`ValueError` while resolving → 404 |
| Security test added | `backend/tests/test_static_frontend.py::test_assets_route_cannot_read_files_outside_the_assets_folder` (10 variants: `..`, `%2e%2e`, `%5c`, absolute, sibling folder, NUL) |
| After | Every escape attempt is a plain 404 that does not reveal whether the file exists; real assets still load |
| Retest evidence | `aii_raw/if01_run1.txt`, `aii_raw/if01_run2.txt`; RT-AU-T801…T836: 36 probes × 2 runs (encoded, double-encoded, `%5c`, mixed, `..;/`, `%00`, overlong UTF-8, `//`, `%2f`, sibling prefixes `assets-evil` / `frontend-dist-evil`, symlink out of `assets/`, `shared/.env`, `shared/nas.pw`): all 404, 0 leaks, no 5xx |
| Regression | Pass. Limitation: tested on Linux. Windows backslash, drive-letter and UNC forms are covered by the same `resolve()` + `is_relative_to` logic by design but were not executed; probe them on production after deploy (EXT-01) |
| Production | **Still vulnerable** until EXT-01 (deploy) and EXT-02 (rotate JWT secret, DB, NAS and ERP passwords) |

### IF-03 Another company's ERP PO draft readable (MEDIUM)

| | |
|---|---|
| Before | `SECOPIT` (CKSPL) `GET /api/erp/pos/9002002/draft` → 200 with the CKVPL supplier, rates and lines; the reverse also 200 (`../infra/erp_cross_company_draft.txt`) |
| Risk | Commercial data of the other company disclosed |
| Root cause | `build_draft` added only a warning ("do not have access") and still built the draft |
| Code changed | `backend/app/erp/service.py::build_draft` raises `NotAllowed` when the PO's company is outside `scoped_company_ids`; `backend/app/erp/router.py::po_draft` maps it to 404 "This purchase order was not found in the ERP." (same body as a missing PO) |
| Security test added | `backend/tests/erp/test_erp_api.py::test_an_operator_cannot_open_the_draft_of_another_companys_po` |
| After | Both directions 404 with the missing-PO body; own company 200; head-office admin and a login with both companies 200 |
| Retest evidence | Group `retest-AC1-AC2-IF03` (`RT-AC-T713`…`T729`), `access_raw/ac_fixes.json`; RT-AU-T601…T608 |
| Regression | Pass. `test_s3a2_draft_create.py::test_another_companys_supplier_details_are_not_shown` changed on purpose (section 3) |

### IF-04 (= AU-09) Placeholder JWT secret accepted in production (MEDIUM), with N4

| | |
|---|---|
| Before | `ENVIRONMENT_NAME=production` with the committed default secret, or no secret at all: the app started and only logged a warning (`../infra/static_route_traversal_and_startup.txt` D) |
| Risk | Anyone who has read the source can sign tokens as any user |
| Root cause | Warning only, never a refusal |
| Code changed | `backend/app/main.py::refuse_to_start_with_insecure_secret` (called first in `lifespan`): in production, refuse when the stripped secret is in `_KNOWN_INSECURE_JWT_SECRETS`, shorter than `_MIN_SECURE_JWT_SECRET_LENGTH` (32), or has fewer than 8 distinct characters. The error never echoes the secret |
| Security test added | `backend/tests/core/test_production_secret_guard.py` (3 test functions, parametrized over 9 environment names × 6 weak secrets) |
| After | Production refuses to start with a weak secret; development and test keep the warning |
| Retest evidence | RT-AU-T901…T913, `aii_raw/startup_matrix_out.txt` (refusals for placeholder, unset, `change_me_too`, 31 characters, empty; starts with 32 and 48 characters) |
| Regression | Pass |

### N4 Production protections fail open on an unexpected environment name (LOW)

| | |
|---|---|
| Before | Only `production`/`prod` counted as production. `prd`, `live` or an unset name started with the placeholder secret and served `/docs` (RT-AU-T910…T913) |
| Risk | One wrong `.env` line on 10.0.1.98 switches IF-04 and IF-14 off |
| Root cause | Allow-list of production names (fail open) |
| Code changed | `backend/app/main.py::is_production` now uses `_NON_PRODUCTION_NAMES = {development, dev, test, testing, uat, security-test, local, ci}`; anything else, including empty, is production |
| Security test added | `test_production_secret_guard.py::test_anything_that_is_not_a_known_dev_name_is_production_and_refuses_a_weak_secret`, `…::test_known_non_production_names_only_get_the_warning_and_keep_the_docs`; `backend/tests/test_vapt_headers_and_docs.py` |
| After | Fails closed |
| Retest evidence | Permanent tests only; **not re-run by the retest agent** (fix made after the retest) |
| Regression | Pass |

### IF-05 (= AU-10) TRUNCATE on append-only tables (MEDIUM, MITIGATED)

| | |
|---|---|
| Before | As the app role, `TRUNCATE audit_log` (and `master_audit`, `asset_field_change`) succeeded (`../infra/db_03_append_only_privilege_tests.out.txt` A7) |
| Risk | The audit trail and asset history could be wiped with one statement |
| Root cause | The append-only rules were row-level triggers; PostgreSQL does not fire row triggers on TRUNCATE |
| Code changed | Migration `backend/app/alembic/versions/a3c5e7f9b1d4_append_only_truncate_and_purge_floor.py`: function `forbid_append_only_truncate()` and statement-level triggers `trg_<table>_no_truncate` (`BEFORE TRUNCATE … FOR EACH STATEMENT`) on `asset_event`, `asset_field_change`, `master_audit`, `audit_log`. `backend/tests/conftest.py` empties tables with `SET LOCAL session_replication_role = replica` (superuser only) |
| Security test added | `backend/tests/observability/test_vapt_append_only.py`: `test_truncate_is_refused_on_every_append_only_table` (4 tables), `test_the_movement_ledger_refuses_update_delete_and_truncate`, `test_a_role_that_is_not_a_superuser_cannot_switch_the_guards_off` |
| After | TRUNCATE refused for any role that is not the table owner or a superuser |
| Retest evidence | RT-AU-T9800…T9821, `aii_raw/rt_append_only.out.txt` (`aii_scripts/rt_append_only.sql`, rolled-back transaction) |
| Residual | RT-AU-T9817/T9818 FAIL: the table owner or a superuser can `ALTER TABLE … DISABLE TRIGGER` and then TRUNCATE, or set `session_replication_role = replica`. In production the app role `ckassetapp` owns the tables. Closed only by the role split in section 7 (EXT-07) |
| Regression | Pass |

### IF-06 Audit purge flag opened recent rows (MEDIUM, MITIGATED)

| | |
|---|---|
| Before | Any role could `SET LOCAL ckam.allow_audit_purge = on` and delete the 10 newest audit rows (`../infra/db_04_least_priv_flag_bypass.out.txt` D2) |
| Risk | Recent evidence erased by the app's own role |
| Root cause | `forbid_audit_log_write` let any DELETE through when the session flag was on; any role can set a custom setting |
| Code changed | Same migration: `forbid_audit_log_write` allows a DELETE only when the flag is on **and** `OLD.at < now() - interval '5 years'` (fixed in the function, not settable by a client); `ckam_purge_audit_log(p_before)` refuses a cut-off newer than 5 years; `REVOKE ALL … FROM PUBLIC` on that function |
| Security test added | `test_vapt_append_only.py::test_the_purge_setting_cannot_delete_a_fresh_audit_row`, `test_the_purge_setting_still_opens_rows_older_than_the_floor` |
| After | Nothing younger than 5 years can be deleted, whatever the session says. The application never purges `audit_log` (`backend/app/observability/retention.py`), so the floor costs nothing today |
| Retest evidence | RT-AU-T98xx: newest row refused; `ckam_purge_audit_log(now())` and `(now() - 4 years 11 months)` refused; EXECUTE owner-only |
| Residual | Owner/superuser bypass as IF-05 (EXT-07). INFO N9: a row the inserter backdated themselves can be purged |
| Regression | Pass. `test_retention_and_append_only.py` adjusted to the 5-year floor (section 3) |

### IF-10 No timeouts on ERP reads (MEDIUM)

| | |
|---|---|
| Before | No connect or statement timeout on the ERP connection (`statement_timeout_ms = None` by default) |
| Risk | A hanging ERP hangs CKAM requests and the background copy |
| Root cause | Timeouts not configured |
| Code changed | `backend/app/core/config.py`: `erp_connect_timeout_seconds` (10), `erp_statement_timeout_seconds` (60), `erp_copy_statement_timeout_seconds` (120). `backend/app/erp/source.py::PgReadOnly._server_settings` (`default_transaction_read_only=on`, `application_name=ckam`, `statement_timeout`), `_connect` (connect timeout), `_fetch` (`conn.transaction(readonly=True)`, client timeout = server + 5 s, `QueryCanceledError`/`TimeoutError` → `ErpUnavailable`, forced `terminate()` if close fails). `backend/app/erp/warehouse.py::PgWarehouseReader.statement_timeout_seconds` |
| Security test added | `backend/tests/erp/test_vapt_erp_limits.py`: `test_every_connection_is_bounded_read_only_and_named`, `test_the_background_copy_has_its_own_longer_limit`, `test_a_query_that_runs_too_long_becomes_erp_unavailable`, `test_a_connection_that_cannot_be_made_in_time_becomes_erp_unavailable` |
| After | A slow or unreachable ERP becomes a friendly "ERP unavailable" within the limits |
| Retest evidence | RT-AU-T970…T979, `aii_raw/erp_connect_out.txt`, `aii_raw/erp_stmt_out.txt`: black-hole listener 503 after 10.01 s (3.00 s with the setting at 3); `pg_sleep(6)` with a 2 s limit 503 at 2.02 s; CREATE TEMP TABLE and switching to read-write refused |
| Regression | Pass. `test_s7_home_erp_resilience.py` fake connection extended (section 3) |

### AU-01 Sign-in timing reveals which accounts exist (MEDIUM)

| | |
|---|---|
| Before | About 42 ms for an existing account vs about 7 ms for an unknown, disabled or locked one (`../auth/t_existing.txt`, `t_nonexist.txt`, `t_locked.txt`, `t_disabled.txt`) |
| Risk | Login ids can be confirmed before guessing passwords |
| Root cause | The Argon2 check ran only when exactly one active account matched |
| Code changed | `backend/app/core/security.py`: `_DUMMY_HASH` (a real Argon2 hash of a random value) and `burn_password_check`; `backend/app/auth/router.py::login` calls it for no match / ambiguous match, and checks the password before looking at the lock state |
| Security test added | `test_vapt_login.py::test_every_refused_sign_in_does_the_same_password_work`, `test_an_ambiguous_login_id_also_does_the_password_work` |
| After | Every refused sign-in costs the same work |
| Retest evidence | RT-AU-T990…T996, `aii_raw/timing_out.json`: 36 interleaved samples per case, medians 39.4-42.2 ms, spread 2.8 ms, overlapping p10-p90 |
| Regression | Pass |

### AU-03 No rate limit on sign-in (MEDIUM)

| | |
|---|---|
| Before | 171 failed sign-ins from one address, never blocked; `X-Forwarded-For` spoofing evaded the account lock (AU-T034, AU-T036) |
| Risk | Unlimited password guessing from the internet |
| Root cause | No rate limit existed |
| Code changed | New `backend/app/core/rate_limit.py` (`hit`, `check`, `limit_login`, `limit_refresh`, `limit_change_password`; bounded memory, `MAX_KEYS` 50,000); settings `rate_limit_*` in `core/config.py`; `auth/router.py::login` calls `limit_login` before any lookup; `refresh` and `change_password` use the dependencies; `core/errors.py` adds the 429 sentence to `errors[]`. The client address comes from `observability/middleware.py::client_ip` (`X-Forwarded-For` only from `TRUSTED_PROXIES`) |
| Security test added | `backend/tests/auth/test_rate_limit.py` (7): 21st sign-in per address refused, per-login-id limit across addresses, forged `X-Forwarded-For` ignored, sliding window, bounded memory, refresh and change-password limits, switch-off |
| After | 429 with `Retry-After: 60` and "Too many sign-in attempts. Wait a minute and try again."; a `RATE_LIMITED` security audit row (no password) |
| Retest evidence | RT-AU-T1002…T1011, `aii_raw/ratelimit_out.json` |
| Residual | N2 (loopback `X-Forwarded-For` through uvicorn defaults, OPEN EXTERNAL) and N3 (Docker dev/UAT shared address, ACCEPTED) |
| Regression | Pass. The suite runs with the limits off (`conftest.py`), except `test_rate_limit.py` |

### AU-04 Lock-out can be used against a real user (MEDIUM, MITIGATED)

| | |
|---|---|
| Before | Anyone knowing a login id could lock it for 15 minutes with 5 guesses, without limit (AU-T032) |
| Risk | Denial of service against chosen users |
| Root cause | Hard lock-out by design, no throttle |
| Code changed | No separate change; AU-03 rate limits apply |
| Security test added | `test_rate_limit.py`; `test_vapt_login.py::test_once_the_lock_has_run_out_the_right_password_signs_in` |
| After | Mass lock-out is slower; the head-office admin's Reset Password clears a lock at once |
| Retest evidence | RT-AU-T313/T314 (INFO): a targeted lock-out still works. One address can keep about 60 accounts locked (20/min ÷ 5 × 15 min, calculated, not executed) |
| Residual | Accepted design. Options: restrict the internet forward (EXT-05), MFA (EXT-19), progressive delays |
| Regression | Pass |

### AU-05 Sign-out and password change did not end sessions (MEDIUM)

| | |
|---|---|
| Before | After logout, password change or admin reset, the old access and refresh tokens kept working until expiry (AU-T037) |
| Risk | A stolen or left-behind token stays usable |
| Root cause | Tokens were stateless with no revocation handle |
| Code changed | Migration `f9a1c3e5b7d2` adds `asset_user.token_version` (NOT NULL, default 0). `backend/app/core/security.py`: `create_access_token` / `create_refresh_token` carry `tv`, `jti`, `iat`; `token_version_of`, `token_is_current`, `end_all_sessions`. `backend/app/core/deps.py::get_current_asset_user` refuses a token whose version is not current ("Your session has ended. Please sign in again."). `backend/app/auth/router.py`: `logout` ends every session when the cookie is current (a stale or foreign cookie ends nothing); `refresh` refuses a non-current token; `change_password` ends all sessions and sets a new refresh cookie. `backend/app/asset_users/service.py`: deactivate, reset password, bulk issue, removing head-office rights and changing company access call `end_all_sessions`. `observability/audit.py` ignores `token_version` in change summaries. Browser: `frontend/src/lib/auth-fetch.ts` (`logoutSession` tells the server first with a 4 s cap, `clearLocalSession` empties auth state, query cache and PO draft), `frontend/src/routes/login.tsx` (session-ended notice) |
| Security test added | `backend/tests/auth/test_vapt_sessions.py` (9), incl. `test_sign_out_ends_every_token_of_that_account_but_nobody_elses`, `test_a_stale_cookie_at_sign_out_cannot_sign_anyone_out`, `test_a_password_change_ends_old_tokens_and_hands_the_browser_a_working_new_session`, `test_a_token_from_before_this_release_keeps_working_until_the_version_changes`; `frontend/src/lib/auth-session.test.ts` (11); `frontend/e2e/security.spec.ts` "session end: Back shows no protected data…" |
| After | Old tokens get 401 at once after each trigger; the user's next screen shows the sign-in page with a one-line notice |
| Retest evidence | RT-AU-T101…T115, T134 (`aii_raw/sessions_out.txt`); group `retest-sessions-clash-massassign` (`access_raw/sessions_transcript.txt`) |
| Regression | Pass. `test_must_change_password.py` changed on purpose (section 3) |

### AC-1 Self-service logins could read setup lists (MEDIUM)

| | |
|---|---|
| Before | `SECSELF` read vendors (GSTIN, contacts), companies, departments, categories, sub-categories, brands, locations, cost centres, custom fields, code rules and bundles (AC-T189, T197, T510…T519; `../access/self_service_masters.txt`) |
| Risk | Vendor contact data and configuration readable by store logins and single-laptop holders |
| Root cause | These list routes used `get_current_asset_user` (any signed-in login) instead of `require_role(*READ_ROLES)` |
| Code changed | `require_role(*READ_ROLES)` on `backend/app/masters/router.py::build_master_router.list_items`, `masters/custom_fields_router.py::list_custom_fields`, `numbering/router.py::list_rules` and `preview_rule`, `bundles/router.py::list_all` |
| Security test added | `backend/tests/core/test_security_read_scope.py::test_a_self_service_login_cannot_read_the_setup_lists`, `test_staff_roles_can_still_read_the_setup_lists` |
| After | Self-service 403 on all 11 lists; staff unchanged; self-service still reads its own asset |
| Retest evidence | Group `retest-AC1-AC2-IF03` (`RT-AC-T600…`), `access_raw/ac_fixes_transcript.txt`, `access_raw/ac_fixes.json`: 44 cases 403, 55 staff cases 200; `access_raw/authz_matrix_diff.csv`: 13 cells changed, all expected, 0 escalations |
| Regression | Pass |

### N1 No request-body limit in single-port production (MEDIUM)

| | |
|---|---|
| Before | A 256 MB unauthenticated JSON body to `/api/auth/login` was read in full; uvicorn grew from 129 MB to 914 MB peak (`aii_raw/bigbody_out.txt`, RT-AU-T960) |
| Risk | A few parallel requests exhaust memory on a server shared with two other apps |
| Root cause | The only body cap lived in `frontend/nginx.conf`; production has no nginx; FastAPI parses the body before the handler and the rate limiter run |
| Code changed | New `backend/app/core/body_limit.py::BodyLimitMiddleware` (pure ASGI): limits by `limit_for` — `AUTH_MAX_BYTES` 64 KB for `/api/auth/*`, `UPLOAD_MAX_BYTES` 16 MB for multipart, `JSON_MAX_BYTES` 5 MB otherwise; refuses on `Content-Length` (or an unparsable one) and counts chunked bodies; 413 JSON envelope with request id. Registered in `backend/app/main.py` |
| Security test added | `backend/tests/core/test_body_limit.py` (5): `test_limits_by_kind_of_request`, `test_a_big_sign_in_body_is_refused_with_413_and_the_envelope`, `test_a_chunked_body_with_no_length_is_stopped_while_it_streams`, `test_an_ordinary_sign_in_and_a_normal_json_post_are_unaffected`, `test_a_16_mb_plus_upload_is_refused_before_the_endpoint` |
| After | Oversized bodies get 413 before being read |
| Retest evidence | Permanent tests only; **not re-run by the retest agent** |
| Regression | Pass. Two older tests resized their payloads to stay under the new outer limit (section 3) |

### IF-11 No Python lock file (LOW)

| | |
|---|---|
| Before | Production ran `pip install -e` against `pyproject.toml` ranges |
| Risk | Untested versions in production |
| Root cause | No lock or constraints file |
| Code changed | New `backend/constraints.txt` (51 lines) pinning the audited set |
| Security test added | None (a file); the rebuilt image matched it |
| After | A pinned set exists; production deploys must use it (`pip install -c constraints.txt …`, EXT-12) |
| Retest evidence | `aii_raw/pip_freeze_rebuilt.txt` identical to `../infra/raw/pip_freeze_image.txt` |
| Regression | Pass |

### IF-14 (= AU-11) API documentation open in production (LOW)

| | |
|---|---|
| Before | `/docs`, `/redoc`, `/openapi.json` served to anyone (AU-T063, AU-T064) |
| Risk | Complete API map for attackers |
| Root cause | FastAPI defaults |
| Code changed | `backend/app/main.py::docs_urls` passes `docs_url=None, redoc_url=None, openapi_url=None` to `FastAPI(...)` in production (N4 decides what production is) |
| Security test added | `backend/tests/test_vapt_headers_and_docs.py::test_production_has_no_api_docs`, `test_a_production_app_answers_404_for_the_docs`, `test_development_still_serves_the_openapi_document`, `test_other_environments_keep_the_defaults` |
| After | 404 in production (or the SPA shell when the frontend is served) |
| Retest evidence | `retest_auth_input_infra.md` row AU-11/IF-14; RT-AU-T426 (INFO: open on the security-test stack by design) |
| Regression | Pass |

### AU-06 Refresh token not rotated (LOW, MITIGATED)

| | |
|---|---|
| Before | The same refresh token could be replayed; no rotation (AU-T038, AU-T039) |
| Risk | A copied refresh cookie usable for up to 8 hours |
| Root cause | Stateless refresh with no unique id |
| Code changed | `create_refresh_token` adds `jti` (and `iat`); `_set_refresh_cookie` issues a new one on every refresh; AU-05's version kills every earlier token on sign-out or password/access change |
| Security test added | `test_vapt_sessions.py::test_every_refresh_hands_out_a_new_unique_token` |
| After | New token every refresh |
| Retest evidence | RT-AU-T102…T104; **RT-AU-T103 FAIL**: an already-rotated refresh token is still accepted until sign-out, a password/access change or expiry |
| Residual | No reuse detection. Needs server-side storage of the current `jti` per session (`test_rotated_refresh_token_reuse_is_refused_and_ends_sessions` proposed by the retest) |
| Regression | Pass |

### AU-07 Sign-in switched off left the token valid (LOW)

| | |
|---|---|
| Before | `login_enabled=false` took effect only when the 15-minute access token ran out; role or company changes only at the next refresh (AU-T041) |
| Risk | A removed person keeps acting for up to 15 minutes |
| Root cause | Access-token claims trusted until expiry |
| Code changed | `backend/app/core/deps.py::get_current_asset_user` refuses when sign-in is off (except the Primary Owner, as at `/refresh`); `backend/app/asset_users/router.py::_access_reduced_or_changed` + `update_asset_user` call `end_all_sessions` on sign-in off, role, work-area or home-company change; `asset_users/service.py` on company-access change |
| Security test added | `test_vapt_sessions.py::test_sign_in_switched_off_ends_a_live_access_token_at_once`, `test_an_admin_change_ends_the_persons_sessions_and_nobody_elses`, `test_an_ordinary_edit_keeps_the_person_signed_in`, `test_taking_head_office_rights_away_ends_that_admins_sessions` |
| After | Immediate 401; harmless edits (phone, same companies re-saved) do not sign the person out |
| Retest evidence | RT-AU-T120…T133; group `retest-sessions-clash-massassign` (role, work area, company access, switch-off, re-enable, deactivate) |
| Regression | Pass |

### AU-08 Weak password policy (LOW)

| | |
|---|---|
| Before | Length 8-128 only (AU-T047) |
| Risk | `Password1`, `Citykart2026` and similar accepted |
| Root cause | No content rules |
| Code changed | New `backend/app/auth/password_policy.py::password_problem`: `COMMON_PASSWORDS` (about 100), same character / runs, `^(ckam|citykart)[\W\d_]*$`, the person's code / e-mail local part / name words (≥ 4 characters); `d04779a` adds `COMMON_BASE_WORDS` with look-alike mapping (`@`→a, `0`→o, …) and stripping of surrounding digits/symbols. `auth/router.py::change_password` returns 422 with the sentence and writes a `PASSWORD_CHANGE_FAILED` security row |
| Security test added | `backend/tests/auth/test_vapt_password_policy.py` (10), incl. `test_a_common_word_with_digits_or_symbols_around_it_is_refused` (`Password@2026`, `Welcome@2026`, `Adm1n#123`, `P@ssw0rd99`, …) and `test_reasonable_passwords_and_every_password_the_test_suite_uses_are_fine` |
| After | Weak choices refused in plain words. Resets and issued passwords stay random |
| Retest evidence | RT-AU-T201…T221, T135/T136 (`aii_raw/policy_out.txt`); T217/T218 FAIL closed later in `d04779a` (permanent test only, **not re-run by the retest agent**) |
| Regression | Pass. `frontend/e2e/fixtures.ts` password pattern changed (section 3) |

### AU-12 Source maps looked reachable (LOW)

| | |
|---|---|
| Before | `/assets/index-*.js.map` answered 200 (AU-T065) |
| Risk | Would expose original source if maps existed |
| Root cause | The maps were never built; nginx's SPA fallback returned `index.html` with 200 for any unknown path, including `.map` |
| Code changed | `frontend/nginx.conf`: `location ~* \.map$ { return 404; }` and `location ~* \.(?:js|mjs|css)$ { try_files $uri =404; }`; `frontend/vite.config.ts`: `build.sourcemap: false` |
| Security test added | No automated test; verified by the production build (0 `.map` files) and the retest (0 `sourceMappingURL` comments). A permanent check would be a small addition |
| After | Real 404 for maps and missing scripts/styles |
| Retest evidence | RT-AU-T411…T414 |
| Regression | Pass; `npm run build` OK with 0 `.map` files |

### AU-14 No Content-Security-Policy / Permissions-Policy (LOW)

| | |
|---|---|
| Before | Neither header (AU-T059, AU-T060) |
| Risk | No browser-side defence in depth |
| Root cause | Not configured |
| Code changed | `frontend/nginx.conf` (`map $ckam_csp`, `$ckam_permissions_policy`, added in every location, API copies hidden so each appears once); `backend/app/main.py`: `CONTENT_SECURITY_POLICY`, `PERMISSIONS_POLICY` in `_security_headers` (single-port production; not on `/docs` outside production). `frontend/src/lib/zod-config.ts` sets zod `jitless` so nothing evaluates strings (its `new Function` probe was the only violation found) |
| Security test added | `test_vapt_headers_and_docs.py::test_health_carries_the_policies`, `test_a_refusal_carries_the_policies`, `test_the_spa_shell_and_its_files_carry_the_policies` |
| After | `script-src 'self'`, no `unsafe-eval`, no inline script; camera, microphone, geolocation, payment, usb off |
| Retest evidence | RT-AU-T401…T425, T451…T458 (`aii_raw/headers_out.txt`, `aii_raw/prod_headers_out.txt`); Playwright `aii_raw/pw_csp_results.json`: 34 screen visits (24 SECHO, 10 SECOPIT), 0 CSP violations, 0 page errors, QR images render |
| Regression | Pass. Note: `style-src 'unsafe-inline'` and the two Google Fonts hosts are still allowed (FONTS) |

### AU-15 Version banners, HTML 413, no cap without nginx (LOW)

| | |
|---|---|
| Before | `Server: nginx/1.x`; nginx's HTML 413 page; no body cap in single-port mode (AU-T061, AU-T068) |
| Risk | Version fingerprinting; memory exhaustion (see N1) |
| Root cause | nginx defaults; cap only in nginx |
| Code changed | `frontend/nginx.conf`: `server_tokens off`, `error_page 413 = @too_large` (JSON sentence); production cap via N1 |
| Security test added | `test_body_limit.py` (single-port cap and JSON 413 envelope). The nginx `server_tokens` and JSON 413 parts have no automated test; verified by the retest. `frontend/src/lib/api-client.ts::errorMessageFrom` gives plain words for 413 and 429 (the 429 case is tested in `auth-session.test.ts`) |
| After | No version in headers; JSON 413 everywhere |
| Retest evidence | RT-AU-T409/T410 |
| Regression | Pass |

### AU-16 Lock-out counter race (LOW)

| | |
|---|---|
| Before | 20 parallel wrong guesses: 6 processed past the threshold of 5 (AU-T035, `../auth/race_codes.txt`) |
| Risk | More guesses than the lock allows |
| Root cause | Read-modify-write of `failed_login_count` in Python |
| Code changed | `backend/app/auth/router.py::login`: one `UPDATE … SET failed_login_count = failed_login_count + 1, locked_until = CASE … WHERE id = … AND (not locked) RETURNING`; the success reset is also conditional on "not locked" |
| Security test added | `test_vapt_login.py::test_twenty_parallel_wrong_guesses_stop_at_the_threshold`, `test_the_lock_threshold_is_the_same_one_by_one` |
| After | Count stops at 5; one LOCKED event; late guesses logged "wrong password while locked (not counted)" |
| Retest evidence | RT-AU-T1001 |
| Regression | Pass |

### AC-2 Custom fields listed across companies (LOW)

| | |
|---|---|
| Before | Every staff login got `company_ids [1,2]` (AC-T520…T522) |
| Risk | The other company's field definitions disclosed |
| Root cause | `list_custom_fields` used `list_active()` with no company filter |
| Code changed | `backend/app/masters/custom_fields_router.py::list_custom_fields` filters by `scoped_company_ids` (global rows plus own companies; `None` scope = all) |
| Security test added | `test_security_read_scope.py::test_custom_fields_follow_the_company` |
| After | CKSPL logins see CKSPL + global; CKVPL logins CKVPL + global |
| Retest evidence | Group `retest-AC1-AC2-IF03` |
| Regression | Pass |

### IN-02 Import uploads without a size cap (LOW)

| | |
|---|---|
| Before | `content = await file.read()` on every Excel import (IN-T117) |
| Risk | Memory exhaustion through an admin upload |
| Root cause | No bounded read |
| Code changed | New `backend/app/core/uploads.py::read_upload_bounded` (1 MB chunks, 15 MB `IMPORT_MAX_BYTES`, 413); used in `backend/app/imports/router.py` (`preview`, `commit`, `preview_po`, `commit_po`, `preview_movements`, `commit_movements`), `backend/app/asset_users/router.py` (`asset_users_import_preview`, `asset_users_import_commit`), `backend/app/masters/router.py` (master import preview/commit) |
| Security test added | `backend/tests/imports/test_upload_size_limit.py::test_an_oversized_import_file_is_refused_with_413`, `test_a_small_bad_file_is_still_a_normal_validation_error_not_413` |
| After | Over 15 MB: 413 "This file is larger than 15 MB. Split it into smaller files…" |
| Retest evidence | `RT-AC-T815` (413 in 89 ms), RT-AU-T610…T612, T961 |
| Regression | Pass |

### PO-LOGIN Employee code could block the head-office-admin login (LOW)

| | |
|---|---|
| Before | An employee created with code equal to the Primary Owner's name made that login match two rows → 401 for the Primary Owner |
| Risk | Anyone allowed to add employees could lock the head-office admin out |
| Root cause | Two lookup queries could return the same or competing rows; any count other than one was refused |
| Code changed | `backend/app/auth/router.py::login`: de-duplicate by id; on a clash keep the single Primary Owner whose name equals the login id |
| Security test added | `backend/tests/auth/test_login_primary_owner_clash.py::test_an_employee_coded_like_the_head_office_admin_cannot_lock_the_admin_out`, `test_a_primary_owner_matched_by_both_code_and_name_is_one_account` |
| After | `SECHO` and `secho` sign in as the Primary Owner |
| Retest evidence | RT-AU-T311/T312; group `retest-sessions-clash-massassign` ("clash") |
| Residual (INFO) | That employee cannot sign in by code; each attempt counts one failure against the Primary Owner |
| Regression | Pass |

### RACE-1 Same-name vendor/brand created twice (LOW)

| | |
|---|---|
| Before | Ten parallel `POST /api/masters/brands` with one name produced two brands; vendors use the same check |
| Risk | Duplicate master records |
| Root cause | Check-then-insert in `_refuse_duplicate_name` with no unique index or lock behind it |
| Code changed | `backend/app/masters/router.py::_refuse_duplicate_name`: `SELECT pg_advisory_xact_lock(hashtext('<table>:<name>'))` before the check, so the second request waits for the first to commit, then sees the row |
| Security test added | `backend/tests/core/test_security_concurrency.py` (4): `test_ten_parallel_brand_creates_with_one_name_make_one_brand`, `test_ten_parallel_vendor_creates_with_one_name_make_one_vendor`, plus `test_four_parallel_receipts_cannot_receive_more_than_the_po_line`, `test_the_same_serial_on_two_parallel_receipts_creates_one_asset` |
| After | Exactly one 201; the rest 422 "already exists"; no 5xx |
| Retest evidence | Permanent asyncio tests. The retest agent's planned burst run was **not executed** (`concurrency_results.md`) |
| Regression | Pass |

### IN-03 Document content not checked (INFO)

| | |
|---|---|
| Before | Extension whitelist only; the browser's claimed MIME type stored and sent back on download (IN-T118) |
| Risk | Defence in depth only (already `nosniff` + `attachment`) |
| Root cause | No signature check |
| Code changed | `backend/app/documents/service.py`: `MEDIA_TYPES`, `media_type_for`, `_is_office`, `content_matches_extension` (`%PDF-` in the first 1 KB, JPEG/PNG magic, Office zip with `[Content_Types].xml` and `xl/workbook.xml` / `word/document.xml`); `save_document` stores the server's type. `backend/app/documents/router.py::download_document` serves `media_type_for(stored_path)` |
| Security test added | `backend/tests/documents/test_vapt_content_check.py` (3) |
| After | Fakes refused with "This file is not a real PDF file. Upload the original document."; old rows served by extension |
| Retest evidence | RT-AU-T620…T627; `RT-AC-T800`…`T814` (`access_raw/uploads_transcript.txt`) |
| Residual (INFO) | An HTML/PDF polyglot with `%PDF-` inside the first 1 KB is accepted; it is only ever served as a PDF attachment with `nosniff` |
| Regression | Pass |

---

## 3. Existing tests that were changed, and why

Found with `git diff 4ba4e94..HEAD --stat -- backend/tests frontend/src frontend/e2e`. "Existing" means the file
existed at `4ba4e94`. **No test was weakened.** Two tests had their payload sizes reduced; the reason is given
and the original larger case is now covered by a stricter test.

| File | What changed | Why | Weakened? |
|---|---|---|---|
| `backend/tests/auth/test_must_change_password.py` | After change-password, the old access token is now expected to get **401**; the test refreshes with the new cookie and then expects 200 | AU-05 intended change: a password change ends every earlier token | No (stricter) |
| `backend/tests/conftest.py` | Table clean-up before each test runs `SET LOCAL session_replication_role = replica` before `TRUNCATE`; sign-in rate limits switched off and reset for the suite | IF-05: the append-only tables now refuse TRUNCATE (only a superuser can set `replica`, the production role cannot). The suite signs in far more often than a person; `test_rate_limit.py` switches the limits on for itself | No |
| `backend/tests/core/test_s0_friendly_errors.py` | `test_an_absurd_password_length_is_refused`: password of 100,000 characters → 20,000 | N1: a 100 KB body is now refused with 413 by the 64 KB sign-in body limit before validation. 20,000 characters is under that limit and still exercises the "too long" 422. The 100 KB case is now covered by `test_body_limit.py` (413) | No (reason stated) |
| `backend/tests/core/test_s3a1_master_audit_migration.py` | Expected head `e6f8a0b2c4d6` → `a3c5e7f9b1d4` plus two new chain assertions; expected `master_audit` triggers now include `trg_master_audit_no_truncate` | Two new migrations; IF-05 TRUNCATE guard | No (more assertions) |
| `backend/tests/documents/test_router.py` | `test_oversized_upload_is_rejected_via_bounded_read`: 20 MB upload → 15 MB | N1: 20 MB would now be stopped by the 16 MB outer upload limit before the document's own 10 MB check. 15 MB is still above the 10 MB document limit, so the test still proves the document check. Over 16 MB is covered by `test_body_limit.py` | No (reason stated) |
| `backend/tests/erp/test_erp_api.py` | New test `test_an_operator_cannot_open_the_draft_of_another_companys_po` | IF-03 regression test | Addition |
| `backend/tests/erp/test_s3a2_draft_create.py` | `test_another_companys_supplier_details_are_not_shown`: previously expected a 200 draft with supplier details blanked; now expects **404** and no supplier name in the body | IF-03 intended change: the other company's draft is not shown at all (it used to leak rates, warehouse and lines) | No (stricter) |
| `backend/tests/observability/test_admin_api.py` | Migration head literal `e6f8a0b2c4d6` → `a3c5e7f9b1d4` (2 places) | New migrations | No |
| `backend/tests/observability/test_retention_and_append_only.py` | Seed audit row 1,000 → 2,000 days old; purge cut-off 500 → 1,900 days; expected error "at least one day" → "at least 5 years"; expected triggers include `trg_audit_log_no_truncate` | IF-06: the purge floor is now 5 years; the test still proves the guarded archive removes only older rows inside its transaction | No (stricter rule) |
| `backend/tests/observability/test_system_events.py` | Migration head literal updated (2 places) | New migrations | No |
| `backend/tests/reports/test_s7_home_erp_resilience.py` | The fake asyncpg connection gains `transaction()` and accepts keyword arguments on `fetch`/`close` | IF-10: reads now run inside `conn.transaction(readonly=True)` with a timeout. The assertion (missing view told apart from a down ERP) is unchanged | No |
| `backend/tests/test_static_frontend.py` | New test `test_assets_route_cannot_read_files_outside_the_assets_folder` | IF-01 regression test | Addition |
| `frontend/src/routes/login.test.tsx` | 5 new tests (429 message, 401 generic, 423 locked, session-ended notice, notice read once); the 2 existing tests unchanged | AU-03/AU-05 browser messages | Addition |
| `frontend/e2e/fixtures.ts` | `createTestLogin` password `E2e-${role}-…!` → `Zq9-…-Xk!` | AU-08: the policy refuses a password containing the person's code or role word | No |

Programme test files that were changed again within the programme (by `d04779a`):

| File | What changed | Why |
|---|---|---|
| `backend/tests/core/test_production_secret_guard.py` | More environment names (`prd`, `live`, `prod-1`, empty, `None`) must refuse; weak secrets add 40 spaces and `"a" * 40`; the "real" test secret now has 8 distinct characters | N4 and the distinct-character rule (stricter) |
| `backend/tests/test_vapt_headers_and_docs.py` | `""` and `None` moved from "keeps the docs" to production | N4 intended change |
| `backend/tests/auth/test_vapt_password_policy.py` | New common-word test; `Passw0rd!` and the suite's `PASSWORD` removed from the "fine" list | AU-08 follow-up: those are now refused (stricter) |

---

## 4. Behaviour users will notice

| Change | What the user sees | Finding |
|---|---|---|
| Sessions end when access changes | Changing someone's role, work area, home company, company access, switching their sign-in off, deactivating them, resetting their password or removing head-office rights signs them out at once, on every device. Their next click shows the sign-in page with "Your session has ended. Please sign in again." Editing a phone number or e-mail does not | AU-05, AU-07 |
| Sign-out signs out everywhere | Signing out on one device ends every session of that login. With a shared store login, one person signing out signs out every device using it (N7) | AU-05 |
| Own password change | The user stays signed in on the device they used; other devices are signed out | AU-05 |
| Weak passwords refused | Change-password refuses common passwords, simple runs, `Citykart2026`-style, the person's own name/code/e-mail, and common words with numbers or symbols added (`Password@2026`), with a plain sentence (422) | AU-08 |
| Too many attempts | After 20 sign-ins per minute from one address, or 10 per minute on one login id: "Too many sign-in attempts. Wait a minute and try again." (429). Refresh and change-password have their own limits | AU-03 |
| Locked message | After 5 wrong passwords: locked for 15 minutes; the screen says the account is locked for any password typed. The head-office admin's Reset Password clears it | AU-02, AU-04 |
| Renamed or fake uploads refused | A file whose content does not match its extension (an HTML page renamed `.pdf`, a fake `.xlsx`) is refused: "This file is not a real PDF file. Upload the original document." | IN-03 |
| Stricter ERP draft access | Opening the ERP PO draft of a company the login does not work in says "This purchase order was not found in the ERP." | IF-03 |
| Setup lists staff-only | Own-Assets-Only logins (store logins, single-laptop holders) can no longer open vendor, company, department, category, brand, location, cost-centre, custom-field, code-rule or bundle lists. Their own assets are unaffected | AC-1 |
| Custom fields per company | A login limited to one company sees only global fields and its own company's fields | AC-2 |
| Oversized requests | Sign-in or password bodies over 64 KB, JSON over 5 MB, uploads over 16 MB get 413 "This request is larger than … allowed here." Imports over 15 MB: 413 "Split it into smaller files". Documents over 10 MB unchanged | N1, IN-02 |
| Large-request and rate-limit messages in the browser | 413 and 429 without a sentence of their own still show plain words; a rate-limited refresh does not sign the user out | AU-15, AU-03 |
| API documentation gone in production | `/docs`, `/redoc`, `/openapi.json` not available in production | IF-14 |

---

## 5. Migration notes and production deploy order

### 5.1 Migrations

| Revision | What it does | Notes |
|---|---|---|
| `f9a1c3e5b7d2` | Adds `asset_user.token_version INTEGER NOT NULL DEFAULT 0` | Additive. Existing rows get 0; tokens issued before the upgrade have no `tv` claim and count as version 0, so **people signed in at the upgrade stay signed in** until their version first changes |
| `a3c5e7f9b1d4` | `forbid_append_only_truncate()` + `trg_<table>_no_truncate` on the four append-only tables; `forbid_audit_log_write` with the 5-year floor; `ckam_purge_audit_log` with the 5-year floor; `REVOKE ALL ON FUNCTION ckam_purge_audit_log(timestamptz) FROM PUBLIC` | Must run as the table owner (creating triggers needs ownership). In production today that is `ckassetapp`. Downgrade restores the previous functions and drops the TRUNCATE triggers |

**Run `alembic upgrade head` BEFORE starting the new code.** The new code reads and writes
`asset_user.token_version`; started against the old schema, every query of `asset_user` fails, including
sign-in. After the upgrade the single
head is `a3c5e7f9b1d4` (verified: a fresh database migrates to it, and the dev, UAT and security-test databases
were upgraded to it).

### 5.2 Production deploy order (needs the owner's explicit deploy request; this is not that request)

| Step | Action | Check |
|---|---|---|
| 0 | **Before deploying, check `shared\.env` on 10.0.1.98** (the owner reads it; never copy values into chat or git): `ENVIRONMENT_NAME=production` is set; `JWT_SECRET` is at least 32 characters, has at least 8 different characters and is not a placeholder. If not, the new code **refuses to start**. If it fails, prepare the new random secret now (it is replaced in step 6 anyway) | Written yes/no per item |
| 1 | Back up `ckassetmanagement` (normal deploy step in `docs/ai/PRODUCTION_INFRASTRUCTURE.md`) | Dump file exists |
| 2 | Deploy the release at HEAD (contains `3e134c1` … `d04779a`). Install Python packages with `pip install -c backend/constraints.txt …` (EXT-12) | `pip freeze` saved with the release |
| 3 | `alembic upgrade head` → `a3c5e7f9b1d4` | `alembic current` shows `a3c5e7f9b1d4` |
| 4 | Change the launcher so uvicorn runs with **`--no-proxy-headers`** (N2; the launcher is not in git, EXT-13). The request-size limit is now inside the app; no extra setting is needed | Launcher reviewed |
| 5 | Start `CKAM-Web`; verify: `system_event app_started` shows the new version and `environment=production`; `/openapi.json` → 404; `/api/health` OK; the IF-01 probes from EXT-01 **including Windows forms** (`..%5c`, `C:%2fWindows%2fwin.ini`, `%5c%5cserver%5cshare`) → 404 | Probe log kept |
| 6 | **Then rotate secrets (EXT-02)**: new `JWT_SECRET` (everyone signs in again), new `ckassetapp` DB password, NAS password, ERP password; delete old `.env` copies such as `shared\.env.pre-3b5e842`; restart | Old tokens 401; ERP sync OK; NAS mapping OK |
| 7 | Compromise assessment for IF-01 (EXT-03), in parallel | Incident record |
| 8 | Plan HTTPS (EXT-04) and the internet-forward decision (EXT-05) | Dated plan |

Why this order: rotating secrets while the hole is still open is wasted, because the new secrets could be read
the same way. Deploy first, then rotate.

---

## 6. Regression results (final lead runs)

| Suite | Result |
|---|---|
| Backend pytest (`ckam_test` database) | **1783 passed**¹ |
| Frontend type check (`npx tsc -b`) | Clean |
| Frontend unit tests (`npx vitest run`) | 1239 passed in 90 files |
| Frontend production build (`npm run build`) | OK; 0 `.map` files |
| Playwright permanent suite (12 spec files, UAT stack, rate limits off for that stack only) | 11 passed, 1 skipped (the ERP-link spec skips itself because the ERP link is intentionally off on the test stack); the one earlier failure was two Playwright runs sharing one artifact folder and passed alone |
| Playwright security journeys (`frontend/e2e/security.spec.ts`, ckam-sec stack, remediated-auth assertions mandatory) | 14/14 passed |
| Alembic | Fresh database → head `a3c5e7f9b1d4`; existing dev, UAT and security-test databases upgraded; single head |

¹ Confirmed: the final complete run on the committed code (d04779a plus the later test-only edits) was 1783 passed, 0 failed, in 7 min 47 s.


New permanent tests added by the programme: 73 backend test functions (71 in 14 new files, 2 added to existing
files; parametrized cases are counted separately in the pytest totals), 16 vitest tests (11 in
`frontend/src/lib/auth-session.test.ts`, 5 in `frontend/src/routes/login.test.tsx`), 14 Playwright security
journeys (10 test declarations in `frontend/e2e/security.spec.ts`, one of which runs for 5 `next=` values).

---

## 7. Least-privilege database role design — DESIGN ONLY, NOT APPLIED

> **Status: DESIGN ONLY. NOT APPLIED anywhere.** Nothing below has been run on 10.0.0.205, the dev stack or any
> other database. It closes the residual of IF-05 / IF-06 (EXT-07). The owner runs it himself as superuser on
> 10.0.0.205, after a backup, in a maintenance window, typing every password himself. It touches only CKAM's
> database `ckassetmanagement` and CKAM's roles; it must not touch Spinwheel's or Citykart Desk's databases or
> roles. The backend engineer's own design document was not found in the repository; this section is written
> from the role names agreed by the lead and from the actual migrations, and should be reviewed by the backend
> engineer before use.

### 7.1 Why

Today production has one role, `ckassetapp`. It runs `alembic upgrade head`, so it **owns** every table, and
the running app uses the same role. A table owner can `DISABLE TRIGGER`, `DROP TRIGGER` and then TRUNCATE or
rewrite the audit tables (`db_03` section C). The triggers added by `a3c5e7f9b1d4` stop every role **except**
the owner and a superuser. So the app must stop being the owner.

### 7.2 The three roles

| Role | Login | Owns | Used by | Can |
|---|---|---|---|---|
| `ckam_owner` | NOLOGIN | Every CKAM table, sequence, function and trigger | Nobody directly | Everything on CKAM objects (owner) |
| `ckam_migrator` | LOGIN | nothing itself; member of `ckam_owner`, sessions start as `ckam_owner` | `alembic upgrade head` during a deploy only | Create/alter CKAM objects (as `ckam_owner`) |
| `ckam_app` | LOGIN | nothing | The running app (`DATABASE_URL` in `shared\.env`) | SELECT/INSERT/UPDATE/DELETE on ordinary tables; **SELECT and INSERT only** on the four append-only tables; no TRUNCATE anywhere; cannot alter or drop anything, cannot disable triggers, cannot set `session_replication_role`, cannot run `ckam_purge_audit_log` |

Name note: `ckam_app` is also the name of the **retired** role on the old server 10.0.1.12 (NOLOGIN there).
They are different servers, so there is no technical clash, but the owner may prefer a different name on
10.0.0.205 to avoid confusion.

### 7.3 SQL (DESIGN ONLY — NOT APPLIED)

```sql
-- DESIGN ONLY, NOT APPLIED. Run as superuser on 10.0.0.205, connected to database ckassetmanagement.
-- Passwords are typed by the owner at the prompt (\password), never written in this file.

-- 1. Roles
CREATE ROLE ckam_owner NOLOGIN;
CREATE ROLE ckam_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT ckam_owner TO ckam_migrator;
ALTER ROLE ckam_migrator SET role = 'ckam_owner';        -- objects created by Alembic are owned by ckam_owner
CREATE ROLE ckam_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password ckam_migrator
\password ckam_app

-- 2. Move ownership of CKAM's objects from ckassetapp to ckam_owner (in this database only).
--    Check first that ckassetapp owns nothing outside ckassetmanagement.
REASSIGN OWNED BY ckassetapp TO ckam_owner;

-- 3. Database and schema access
REVOKE ALL ON DATABASE ckassetmanagement FROM PUBLIC;
GRANT CONNECT ON DATABASE ckassetmanagement TO ckam_app, ckam_migrator;
GRANT USAGE ON SCHEMA public TO ckam_app;                 -- no CREATE for the app

-- 4. Runtime privileges on existing objects
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ckam_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ckam_app;

-- 5. Append-only tables: read and add only
REVOKE UPDATE, DELETE, TRUNCATE ON asset_event, asset_field_change, master_audit, audit_log FROM ckam_app;

-- 6. Alembic's own table: the app only reads it (health and diagnostics show the migration head)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON alembic_version FROM ckam_app;

-- 7. The guarded archive function stays owner-only (a3c5e7f9b1d4 already revoked it from PUBLIC)
REVOKE ALL ON FUNCTION ckam_purge_audit_log(timestamptz) FROM ckam_app;

-- 8. Objects created by future migrations
ALTER DEFAULT PRIVILEGES FOR ROLE ckam_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ckam_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ckam_owner IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ckam_app;
-- RULE: any future migration that creates an append-only table must also
-- REVOKE UPDATE, DELETE, TRUNCATE ON <table> FROM ckam_app;

-- 9. After the app has run successfully as ckam_app:
ALTER ROLE ckassetapp NOLOGIN;
```

`pg_hba.conf`: allow `ckam_app` and `ckam_migrator` only from `10.0.1.98/32` (as `ckassetapp` today).

Application side: `DATABASE_URL` in `shared\.env` uses `ckam_app`. Alembic reads `DATABASE_URL` from the
environment (`backend/app/alembic/env.py`), so at deploy time the operator sets `DATABASE_URL` to the
`ckam_migrator` connection **in that one shell only** and runs `alembic upgrade head`.

### 7.4 How to prove it worked (in a rolled-back transaction, as in `db_03` section B)

As `ckam_app`: `TRUNCATE audit_log` → permission denied; `ALTER TABLE asset_event DISABLE TRIGGER ALL` → must be
owner; `DROP TABLE audit_log` → must be owner; `SET session_replication_role = replica` → permission denied;
`UPDATE audit_log …` / `DELETE FROM asset_event …` → permission denied; `SELECT ckam_purge_audit_log(…)` →
permission denied; a normal sign-in, asset create and move work. Then a superuser query of table owners shows
`ckam_owner` for every CKAM object.

---

## 8. What was not changed, and why

| Item | Why not in this programme | Where it goes |
|---|---|---|
| HTTPS, `Secure` cookie (IF-02, AU-13) | Needs a certificate and a reverse proxy on the production server | EXT-04, EXT-05 |
| Database owner/runtime role split (IF-05/IF-06 residual) | Database-administration change on the shared production database; superuser password typed by the owner | Section 7, EXT-07 |
| Service account instead of SYSTEM (IF-07) | Windows server change | EXT-06 |
| Off-server backups and restore test (IF-08) | Infrastructure | EXT-08 |
| Dev PC file permissions (IF-09) | Local administrator action | EXT-10 |
| uvicorn `--no-proxy-headers` (N2) | The production launcher is on the server only, not in git. `backend/Dockerfile` CMD was also left with uvicorn's defaults (dev/UAT; nginx connects from another container address, so only a client inside the API container could use it) | EXT-13 (and a small Dockerfile change later) |
| nginx `X-Forwarded-For` / `TRUSTED_PROXIES` for Docker (N3) | Dev/UAT only; accepted | — |
| Refresh-token reuse detection (AU-06 residual) | Needs server-side storage of the current token id per session; a design change, not a quick fix | Backlog |
| Lock-out abuse (AU-04 residual) | A hard lock is the chosen design; real options are MFA, network restriction or progressive delays | EXT-05, EXT-19 |
| MFA | Management decision | EXT-19 |
| Full Admin company scope (D6) | Owner decision open | EXT-26 |
| Self-hosted fonts (FONTS) | Small frontend change, not security-blocking; CSP currently allows the two Google hosts | EXT-11 |
| Dev image as root (IF-13) | Dev/UAT only; production has no Docker | Backlog |
| ERP TLS and SELECT-only role (IF-16) | Needs the ERP warehouse owner first | EXT-25 |
| Runbook and launcher in git (IF-15) | Needs a copy of the server scripts with secrets removed | EXT-13 |
| `python-jose` / `ecdsa` (IF-12) | Not reachable (HS256 pinned); replacing the JWT library is a larger change | Accepted |
| `token_version` raised in Python, not one SQL increment (OBS-TV) | Suspected, low impact, not tested | Backlog |
| No database guard on `Asset.status` (OBS-STATUS) | Protected by the code rule (`apply_event` is the only writer) | Backlog |
| Stale comment in `auth/router.py::login` (OBS-COMMENT) | Documentation-only issue found while writing this report; no code edits were made in this reporting step | Next code change |


---


# PART D — Retest: access control and business logic

(source file: docs/security/evidence/retest/retest_access.md)

# ACCESS area: retest report (stack `ckam-sec`, HEAD ae706bb, ENVIRONMENT_NAME=security-test)

Date: 2026-10-15. Personas come from the re-seeded fixture (`Sec#Test2026ok`).

Each persona signed in once. Tokens were cached and renewed by refresh. Sign-ins were spaced 3.5–6 s apart, and the change-password and refresh calls in the matrix were spaced 7 s apart. No request got a 429.

## Counts
| | executed | PASS | FAIL | N/A | INFO |
|---|---|---|---|---|---|
| Authorization matrix (217 routes x 11 personas) | 217 rows (2,387 cells) | 217 | 0 | 0 | 0 |
| IDOR/BOLA battery (rerun) | 208 | 208 | 0 | 0 | 0 |
| Escalation and mass-assignment battery (rerun) | 17 | 16 | 0 | 1 (T302 harness artifact, as in the original) | 0 |
| Business logic and idempotency battery (rerun) | 7 | 7 | 0 | 0 | 0 |
| AC-1, AC-2, IF-03 verification | 130 | 130 | 0 | 0 | 0 |
| Sessions AU-05/06/07, Primary-Owner clash, valid-body mass assignment | 51 | 50 | 0 | 0 | 1 |
| IN-03 uploads and IN-02 oversize import | 16 | 15 | 0 | 0 | 1 (polyglot) |
| **Total** (`retest_tests.csv`) | **646** | **643** | **0** | **1** | **2** |

**Concurrency bursts (part C) were NOT executed.** See `concurrency_results.md`.

## Matrix diff (`authz_matrix_retest.csv` vs `../access/authz_matrix.csv`; cells in `access_raw/authz_matrix_diff.csv`)
- 0 escalations: no lower-privilege persona got past a guard.
- 13 cells changed. Every change is an expected result of a fix:

| Route | Persona | Old | New | Why |
|---|---|---|---|---|
| GET /api/masters/{companies,locations,departments,cost-centers,categories,subcategories,brands,vendors,custom-fields}, GET /api/code-rules, GET /api/bundles | SECSELF | 200 | 403 | AC-1: the lists now use `require_role(*READ_ROLES)`. `locations` changed too because it shares the generic `build_master_router.list_items`. |
| POST /api/code-rules/preview | SECSELF | 422 | 403 | AC-1: commit 77431ba also put the preview behind staff roles. The role guard now answers before body validation. |
| GET /api/erp/pos/{po_code}/draft (9001001 = CKSPL PO) | SECOTHER (CKVPL) | 200 | 404 | IF-03: another company's PO now answers like a missing PO. |

- The 11 "role-denied" cells on POST /api/auth/refresh (401 for every persona) are the same as in the original run: the matrix sends no refresh cookie.
- Nothing changed on the upload routes in the matrix. The probe sends no multipart body, so it gets 422 both before and after.
- `/docs` (200) and `/openapi.json` (200) are still open. That is expected here, because the stack is not `production`.

## Findings status
| ID | Sev (orig) | Old behaviour | New behaviour / evidence | Status |
|---|---|---|---|---|
| AC-1 | MEDIUM | A SELF_SERVICE login read every setup list (vendors with GSTIN and contacts, companies, departments, categories, subcategories, brands, cost centres, custom fields, code rules, bundles) | SECSELF, SECSELFV and the store logins SPA and VPA get **403** on all 11 lists: `GET /api/masters/vendors -> 403 {"detail":"Not permitted for this action"}` (44 cases). The staff roles SECVIEW, SECOPIT, SECOTHER, SECFAIT and SECHO still get 200 (55 cases). SECSELF still reads its own asset 1 and its capabilities. Evidence: `access_raw/ac_fixes_transcript.txt`, `ac_fixes.json`. | **FIXED** |
| AC-2 | LOW | `GET /api/masters/custom-fields` returned company_ids [1,2] to every role | SECOPIT, SECVIEW and SECOPNIT get [1]. SECOTHER, SECVIEWV and SECOPITV get [2]. SECOPX (grant to CKVPL) gets [1,2]. ADMIN and SECHO get [1,2] (Full Admin is not company-scoped: open decision D6). `?company_id=2` does not widen SECOPIT's result. | **FIXED** |
| IF-03 (infra) | — | `GET /api/erp/pos/{code}/draft` returned another company's PO, with supplier and rates | SECOPIT gets **404** on 9002001 and 9002002. SECOTHER and SECOPITV get 404 on 9001001 and 9001002. The body is the same as for a non-existent code: `{"detail":"This purchase order was not found in the ERP."}`, so it is no existence oracle. Controls still work: own company 200, SECOPX both companies 200, SECFAIT and SECHO 200. Adjacent routes are also refused: receipts and pi 404, `POST /erp/pos/create` 422, and the ERP PO list shows no 9002xxx for SECOPIT. The local ERP copy holds these POs, so every case was exercised. | **FIXED** |
| Primary-Owner login clash | — | An employee coded like the Primary Owner's name made the "SECHO" login ambiguous (401) | SECHO matches by **name** ('SECHO'; the row has code SECHO and company_id null). SECHO created employee 34 with code `SECHO` in CKSPL, with sign-in on and an issued password. After that, `login_id "SECHO"` and `login_id "secho"` both return **200, asset_user_id 2, is_primary_owner true**. The employee's own password with login id SECHO returns 401. Employee 34 is soft-deactivated (204). | **FIXED**. Side effect (INFO): an employee whose code equals the Primary Owner's name cannot sign in by code. Each such attempt counts one failed sign-in against the Primary Owner. |
| IN-03 (input) | — | A document's content was not checked, and it was served with the type the browser claimed | HTML/script uploaded as .pdf, .png or .jpg, fake .xlsx and .docx, and .html or .svg files all get **422** with a plain message. A valid PDF or PNG uploaded with a claimed `text/html` gets **201**, and the stored `mime_type` is application/pdf or image/png. Downloads of docs 1–5 return `200`, a server-derived Content-Type, `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. | **FIXED**. INFO: the check only looks at the signature, so a `%PDF-` header followed by HTML is accepted (doc 5). It is still only ever served as an application/pdf attachment, so there is no XSS path. |
| IN-02 (input) | — | An Excel import of any size was read whole into openpyxl | A 16 MB file sent to `POST /api/imports/assets/preview?mode=add` on the API port (one attempt) gets **413** in 89 ms: `"This file is larger than 15 MB. Split it into smaller files and upload them one by one."` | **FIXED** (residual INFO: Starlette still receives and spools the whole multipart body before the handler refuses it, and production has no proxy body limit) |
| AU-05 / AU-06 (auth) | — | Logout, password change and reset left the old access and refresh tokens valid until they expired | Throw-away operator 32. The OLD access token and OLD refresh cookie both return **401 / 401** after each of: logout with own cookie, forced first change-password, own change-password, and reset by SECHO. The detail is "Your session has ended. Please sign in again." The NEW cookie from change-password still refreshes (200). Old passwords return 401. In every step SECOP2IT's and SECHO's sessions stay **200**. A logout with a bearer token and no cookie ends nothing. | **FIXED** |
| AU-07 (auth) | — | A changed role, work area, company access or sign-in setting only took effect at the next refresh | Role OPERATOR->VIEWER, work area IT->BOTH, company-access grant and sign-in switched off: each gives **401 / 401** at once on the old tokens. The next sign-in carries the new role (VIEWER). A phone-only edit does **not** end the session (200 / 200). For throw-away 33, switch-off kills the session at once, and re-enabling does not bring the old session back (401). After deactivation: 401 "Account not found or inactive". | **FIXED** |
| Mass assignment on user create (orig AC-T503) | — | (was PASS) | SECFABOTH POST /api/asset-users with `is_primary_owner, token_version, password_hash, id` in the body gets **201** with `is_primary_owner=false` and an auto id. User 35 is soft-deactivated. | still PASS |

Every IDOR/BOLA, escalation, Primary-Owner-protection, cross-company move and idempotency case from the original run still passes. That covers 208 + 16 + 7 cases.

## NEW findings
None from the cases executed. The two SUSPECTED items in `concurrency_results.md` (vendor duplicate-name race, non-atomic `token_version` increment) were **not** tested. They are not findings until a burst run confirms them.

## Not exercised
- **Part C concurrency bursts: none were run** (session stopped while the burst script was being written). There is no burst evidence, no SQL integrity check after bursts, and no log scan for deadlock or serialization errors. This retest gives no verdict on them.
- `/docs` and `/openapi.json` closing in production: this stack is `security-test`, so that cannot be checked here.

## Files
- `retest_tests.csv` (646 cases, ids RT-AC-M### for the matrix and RT-AC-T### for the batteries)
- `authz_matrix_retest.csv`
- `concurrency_results.md`
- `access_raw/`: scripts (`lib.mjs` paced/cached login, `matrix_retest.mjs`, `analyze_retest.mjs`, `idor_retest.mjs`, `escalation_retest.mjs`, `logic_retest.mjs`, `ac_fixes.mjs`, `sessions.mjs`, `uploads.mjs`, `probe_setup.mjs`, `make_retest_tests_csv.mjs`) and raw results (`*.json`, `*_transcript.txt`, `matrix_raw_retest.csv`, `authz_matrix_diff.csv`). No tokens or passwords are stored: the throw-away passwords were random and held only in memory.


---


# PART E — Retest: sign-in, input and infrastructure

(source file: docs/security/evidence/retest/retest_auth_input_infra.md)

# CKAM retest: AUTH, INPUT and INFRA areas (2026-10-15)

| | |
|---|---|
| Code under test | HEAD `ae706bb` (plus `4fa5c9b`, `77431ba`, `ba04371`, `7e57844`, `3e134c1`), rebuilt `ckam-sec` stack (image `ckam-sec-api` 512540c2de68), Alembic head `a3c5e7f9b1d4` |
| Targets | web http://localhost:3411 (nginx), API http://127.0.0.1:8200, Postgres 127.0.0.1:25442. Single-port production behaviour: a throw-away, **network-less** container of the same api image (`--network none`, removed afterwards) with `FRONTEND_DIST_DIR`, `ENVIRONMENT_NAME=production` and FAKE canary secrets only |
| Not touched | production, 10.x hosts, the ERP warehouse, the NAS, the internet (except `npm audit`), the owner's dev stack |
| Test cases | `retest_tests2.csv`: **310 executed** (280 PASS, 8 FAIL, 22 INFO) |
| Scripts / raw output | `aii_scripts/`, `aii_raw/` (no tokens, no stack secret; the only passwords are the documented test value and passwords of deactivated throw-away accounts) |
| Throw-away accounts | BRUTE11..BRUTE19 (ids 36-44, CKSPL operators) created as SECHO, **all deactivated afterwards**. Planted XSS payloads: vendor 7 and item 8, client report 3 (left in place for the other testers) |

Pacing: host sign-ins were at least 3.5 s apart, through cached tokens. Bursts (timing, race, rate limits) ran inside the api
container, which has its own rate-limit address, so the host address shared with the other retest agent was not used up. The
web (:3411) address was deliberately not exhausted.

## 1. Status of every finding

| ID | Sev. (orig.) | Old behaviour | New behaviour / evidence | Status |
|---|---|---|---|---|
| IF-01 / IN-01 | CRITICAL | `/assets/{path}` in single-port mode served any readable file (`..%2f`, `%2e%2e`, absolute `//etc/passwd`, `%2fetc`), including `shared/.env` and `nas.pw` in the production layout | 36 probes x 2 runs in a production-layout container: encoded, double-encoded, `%5c`, mixed `%5c`/`%2f`, `..;/`, NUL (`%00`), overlong UTF-8, absolute `//` and `%2f`, sibling prefixes `assets-evil` and `frontend-dist-evil`, symlink out of `assets/`, the directory itself, `shared/.env`, `shared/nas.pw`. **All 404, 0 leaks.** Legitimate files still 200 (including a climb-out-and-back-in path to a real asset). SPA shell route `/{path}` and the favicon allow-list return only `index.html` or the listed files (`/secret_in_dist.txt` gives the shell). No 5xx. `RT-AU-T801..T836`, `aii_raw/if01_run1.txt`, `if01_run2.txt` | **FIXED** in code. Production stays vulnerable until EXT-01 deploy and EXT-02 rotation |
| IF-03 | MEDIUM | CKSPL operator read the CKVPL ERP PO draft (and the reverse) | Both directions 404. Own company 200. List shows only own company. Receipts and PI 404. Head-office admin 200 (by design). `RT-AU-T601..T608` | **FIXED** (exercised on the local ERP copy: no ERP link on this stack) |
| IF-04 / AU-09 | MEDIUM | Production started with the committed placeholder JWT secret | `ENVIRONMENT_NAME=production` refuses to start with: the dev default, secret unset, `change_me_too`, a 31-character secret, an empty secret, `PROD`, `" Production "`. Starts with 32 and 48 characters. Refusal message does not echo the secret. `RT-AU-T901..T913` | **FIXED**. Residual: see **RT-AII-N4** (depends on the exact environment name) |
| AU-11 / IF-14 | LOW | `/docs`, `/redoc`, `/openapi.json` open in production | Production without the dist folder: all three 404. With the dist folder they get the SPA shell (no API map). Still open in this security-test stack by design (`RT-AU-T426`) | **FIXED** (same N4 dependence) |
| AU-01 | MEDIUM | Existing-account sign-in about 42 ms vs about 7 ms for unknown, disabled or locked accounts | 36 samples each, in-container, interleaved. Median ms: existing account, wrong password **41.8**; non-existent **39.4**; deactivated **39.4**; sign-in off **42.2**; locked **40.1**; right password **42.0**. Spread of medians 2.8 ms, with overlapping p10..p90 ranges. `RT-AU-T990..T996`, `aii_raw/timing_out.json` | **FIXED** |
| AU-02 | LOW | 423 tells an outsider an account is locked | 423 for the right password **and** for a wrong one (SECLOCK). Lead decision: a lock that answered differently to the right password would become a password-guessing oracle. `RT-AU-T301/302` | **ACCEPTED** (LOW) |
| AU-03 | MEDIUM | No per-address limit (171 failures, no block) | Login: #21 from one address gets 429 with `Retry-After: 60` and "Too many sign-in attempts. Wait a minute and try again." (also in `errors[]`). #11 on one login id gets 429, and the id key ignores case and spaces. Refresh: #61 gets 429. Change-password: #11 gets 429. The window recovers. Spoofed `X-Forwarded-For` from a LAN-like peer is ignored (429). `RATE_LIMITED` SECURITY rows written, no password. `RT-AU-T1002..T1011` | **FIXED**. Residuals **RT-AII-N2** (loopback XFF) and **RT-AII-N3** (Docker/UAT shared bucket) |
| AU-04 | MEDIUM | Anyone can lock a real user out | Still true by design: 5 wrong guesses lock BRUTE12 for 15 min, then the right password gets 423 (`RT-AU-T313/314`). The limits only slow mass lock-outs. One address can send 20 attempts/min, i.e. 4 locks/min, so it can keep about **60 accounts** locked continuously (20/min / 5 x 15 min, calculated, not executed). The per-login-id limit (10/min) also lets an outsider keep one id answering 429 | **MITIGATED** (residual accepted design; MFA / CAPTCHA-free options in EXT-19) |
| AU-05 | MEDIUM | Logout did not revoke the refresh token | Logout: the same device's access and refresh tokens and older rotated refresh tokens all 401. A second device of the same account is also 401 (sign-out ends every session). Unaffected user still 200. Stale or foreign cookie cannot sign anyone out. Password change: old access and refresh 401, new cookie keeps the user signed in. Admin reset: old tokens 401. `RT-AU-T101..T115, T134` | **FIXED** |
| AU-06 | LOW | Refresh rotation not functional; old refresh reusable | A new refresh token on every call (unique `jti`, even within one second). **But an older, already-rotated refresh token is still accepted** until sign-out or password/access change or expiry (8 h): no reuse detection. `RT-AU-T102..T104` | **MITIGATED** (residual LOW: see 3.1) |
| AU-07 | LOW | Sign-in switched off left the access token valid for up to 15 min | `login_enabled=false`: live access 401 at once, refresh 401. Switching it back on does not revive old tokens. Deactivation, role change, work-area change and company-access change all give 401/401. Harmless edits (phone, re-saving the same companies) do **not** end the session. `RT-AU-T120..T133` | **FIXED** |
| AU-08 | LOW | Length-only password policy | Refused with plain sentences: common (case-insensitive), digit/letter/keyboard runs, same character, `Citykart2026`, `ckam@123`, `CITYKART#2026!`, containing own code, name word, surname; too short or long; same as old. Strong passphrase accepted. Admin reset, then temp sign-in (must change), then a strong password works. **But `Password@2026` and `Welcome@2026` were accepted** (fixed ~100-word list). `RT-AU-T201..T221, T135/T136` | **MITIGATED** (residual LOW: see 3.2) |
| AU-10 / IF-05 / IF-06 | MEDIUM | TRUNCATE emptied audit tables; `SET ckam.allow_audit_purge=on` deleted the newest audit rows | As the app role, in a rolled-back transaction: UPDATE/DELETE/TRUNCATE refused on `audit_log`, `asset_event`, `master_audit` (TRUNCATE; table empty, so row triggers could not be exercised), `asset_field_change`. With the flag, the newest row and every row under 5 years old are refused. `ckam_purge_audit_log(now())` and `(now()-4y11m)` refused; without the flag refused; EXECUTE owner-only. A least-privilege role simulation is refused for everything. **Residual (unchanged): the owner/superuser can `DISABLE TRIGGER` then TRUNCATE, or use `session_replication_role=replica`**. The Docker app role `ckam` is a superuser. `RT-AU-T9800..T9821`, `aii_raw/rt_append_only.out.txt` | **MITIGATED** (code part FIXED; owner/superuser bypass OPEN EXTERNAL, EXT-07) |
| AU-12 | LOW | `*.js.map` "reachable" (SPA shell 200) | Entry bundles' `.map`: 404. Made-up `/assets/x.js.map` and `/assets/does-not-exist.js`: nginx 404, not the shell. 0 `sourceMappingURL` comments. `RT-AU-T411..T414` | **FIXED** |
| AU-14 | LOW | No CSP / Permissions-Policy | Present (exactly one copy) on web and API 200/401/404/413/422, SPA shell, assets, single-port production. No `unsafe-eval`, no inline script. Playwright as SECHO (24 screens) and SECOPIT (10 screens): **0 CSP violations, 0 page errors, 0 bounces to login**. QR blob images render. Browser reports camera, microphone, geolocation, payment and usb all false. `RT-AU-T401..T425, T451..T458` | **FIXED** |
| AU-15 | LOW | `Server: nginx/1.x`, `uvicorn`; HTML 413 from nginx; no cap without nginx | `Server: nginx` / `uvicorn` (no version). 12 MB through nginx gets a JSON 413 with a plain sentence (no request id: nginx answers first). **Single-port production still has no request-body cap**: see **RT-AII-N1** | **MITIGATED** (Docker FIXED; production part OPEN as N1) |
| AU-16 | LOW | 20 parallel guesses: 6 processed, lock-out exceeded | 20 parallel wrong guesses on BRUTE11: 10 x 401 + 10 x 429 (per-id limit). DB `failed_login_count = 5`, **one** LOCKED event, the 5 late ones logged "wrong password while locked (not counted)". `RT-AU-T1001` | **FIXED** |
| IF-10 | MEDIUM | ERP reads had no timeouts | `PgErpSource` session: `default_transaction_read_only=on`, `statement_timeout=60000`, `application_name=ckam`; warehouse copy 120000. Every query in a READ ONLY transaction. Black-hole listener gives 503 "could not be reached (TimeoutError)" after **10.01 s** (3.00 s with `ERP_CONNECT_TIMEOUT_SECONDS=3`). 192.0.2.1 gives 503 at once (no network). Against a local Postgres stand-in: `pg_sleep(6)` with a 2 s limit gives 503 "took too long" at 2.02 s. CREATE TEMP TABLE refused (read-only). Switching to read-write refused. `RT-AU-T970..T979` | **FIXED** (TLS/role-level read-only remain EXT-25 / IF-16) |
| IN-02 | LOW | Import uploads read without size limit | 16 MB straight to the API (asset and PO import) gets 413 "larger than 15 MB...". Non-workbook gets 422. Unauthenticated 256 MB multipart gets 401 with no memory growth. `RT-AU-T610..T612, T961` | **FIXED** |
| IN-03 | INFO | Extension-only check; browser-claimed MIME stored | HTML as `.png`, script as `.pdf`, PNG as `.jpg`, bare zip as `.xlsx`, and `.html` all get 422 with plain sentences. Real PNG uploaded as `text/html` is stored as `image/png` and downloaded as `image/png`, `attachment`, `nosniff`. HTML/PDF polyglot with `%PDF-` inside the first 1 KB is accepted, harmlessly (served as PDF attachment + nosniff). `RT-AU-T620..T627` | **FIXED** |
| Primary-Owner login clash | LOW | An employee with code = Primary Owner name blocked the head-office login | With employee id 34 (code `SECHO`) present: `SECHO` and `secho` sign in as id 2 (Primary Owner). `RT-AU-T311/312` | **FIXED** |
| IF-02 / AU-13 | HIGH / LOW | Plain HTTP; refresh cookie not `Secure` | Not code-fixable here (cookie still `HttpOnly; SameSite=lax; Path=/api/auth`, no `Secure`) | OPEN EXTERNAL (EXT-04), not retested |

Regression batteries re-run, all PASS:

- INPUT SQLi/sort/numeric/search battery: 39 rows, no 5xx, no timed sleeps (`RT-AU-T7000..T7073`).
- Secret-field and self-service batteries (`RT-AU-T7074..T7080`).
- Stored and reflected XSS inert on every screen visited.
- CORS/CSRF: no `Access-Control-Allow-Origin` for evil or `null` origins, preflight 405.
- Error sweep: 17 malformed requests on auth, assets, people, admin logs and ERP routes, all 4xx with a request id, no stack/SQL/path. `error_log` has 0 rows of 5xx during the whole retest.
- Logs: test password, every password typed in this retest, JWTs and refresh-cookie values are found in none of `app.jsonl`, `audit.jsonl`, `error.jsonl`, `audit_log`, `error_log`, `client_report` or `system_event`.
- Dependencies: `npm audit --omit=dev` 0 of 141 (unchanged). The rebuilt image's `pip freeze` is identical to the earlier one (`ecdsa`/`python-jose` advisories unchanged, IF-12 accepted; `constraints.txt` pins the same versions).

## 2. New findings

### RT-AII-N1: No request-body size limit in single-port production; unauthenticated sign-in requests can exhaust memory (CONFIRMED)

| | |
|---|---|
| Category / CWE / OWASP | Uncontrolled resource consumption / CWE-770 / API4:2023 (unrestricted resource consumption), A05:2021 |
| Component | `backend/app/main.py` (no body-size middleware); `POST /api/auth/login` (body is parsed before the handler and the rate limiter run); production `uvicorn` on 10.0.1.98:3211 with no nginx in front |
| Preconditions | None (unauthenticated). The production port is forwarded to the internet (EXT-05) |
| Reproduce | Throw-away production-mode container: `aii_scripts/bigbody.py 8000 256`. It POSTs a 256 MB JSON `{"login_id":"x","password":"aaaa..."}` to `/api/auth/login` |
| Evidence | `422 "Password is too long"` only **after** the full body was read. uvicorn RSS 129 MB to 652 MB, peak 914 MB. A 64 MB body peaks at 324 MB (about 3.5x the body). Multipart import uploads are not affected (401 before the body is read, RSS unchanged). The Docker stack is protected by nginx `client_max_body_size 11m` (JSON 413, `RT-AU-T409`) |
| Impact | A few parallel large requests push one process to several GB. On a server shared with Spinwheel and Citykart Desk that can kill CKAM (OOM) or starve the other apps. Not a data risk |
| Likelihood | Medium (internet-reachable, trivial, no account needed). The sign-in rate limit does not help: it runs after the body is parsed |
| Severity | **MEDIUM**. CVSS 3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` = 5.3 (A:H, 7.5, if the shared server is affected) |
| Root cause | AU-15 limited the body only in `frontend/nginx.conf`. The single-port production server has no equivalent |
| Fix | In `main.py`, add a pure ASGI middleware (outermost, before `RequestContextMiddleware`) that answers 413 JSON when `Content-Length` exceeds a limit, and counts bytes of chunked bodies, aborting past the limit. Suggested limits: 16 KB for `/api/auth/*`, 11 MB elsewhere (documents 10 MB, imports 15 MB, so imports need about 16 MB), same plain sentence as nginx. Alternatively put the planned HTTPS proxy (EXT-04) in front with a body limit |
| Regression test | `test_body_limit_single_port`: POST `/api/auth/login` with `Content-Length: 2000000` gets 413 JSON and the handler is never called. A chunked 20 MB body to `/api/imports/assets/preview` gets 413 |

### RT-AII-N2: uvicorn's default proxy trust lets any loopback client choose its "address", bypassing the per-address limit and forging audit IPs (CONFIRMED)

| | |
|---|---|
| Category / CWE / OWASP | Reliance on untrusted header / CWE-348, CWE-290 / A07:2021, A09:2021 |
| Component | `backend/Dockerfile` CMD and the production launcher run `uvicorn` with its default `--proxy-headers --forwarded-allow-ips=127.0.0.1`. uvicorn rewrites `scope["client"]` from `X-Forwarded-For` **before** `app/observability/middleware.py::client_ip` applies `TRUSTED_PROXIES` (empty) |
| Preconditions | Requests that reach uvicorn from 127.0.0.1: any process on the CKAM server (on 10.0.1.98, other apps and their users share the host), or an SSRF in another local app |
| Reproduce | `aii_scripts/xff.py` (inside the api container). After 20 sign-in failures the 21st plain request gets 429, but the 22nd with `X-Forwarded-For: 203.0.113.77` gets **401** (processed). From the container's network address the same header gets **429**. `audit_log.ip` shows `203.0.113.77`, `203.0.113.9`, `198.51.100.7` |
| Impact | Unlimited per-address sign-in attempts from the server itself (the per-login-id limit and the 5-try lock still apply), and a forged IP in the security audit trail |
| Likelihood | Low (needs local access to the server) |
| Severity | **LOW** |
| Fix | Run uvicorn with `--no-proxy-headers` (or `--forwarded-allow-ips=""`) in `backend/Dockerfile` and in the production launcher (EXT-13), so `TRUSTED_PROXIES` is the only place that decides whether `X-Forwarded-For` is believed. When the HTTPS proxy (EXT-04) arrives, set `TRUSTED_PROXIES=127.0.0.1` |
| Regression test | `test_xff_from_loopback_not_trusted_without_trusted_proxies`: start the app with the same uvicorn flags, exhaust the limit from 127.0.0.1, then a request with XFF still gets 429 and `audit_log.ip == "127.0.0.1"` |

### RT-AII-N3: Docker stack (dev/UAT): every browser user shares the nginx container's address, so 20 sign-ins per minute in total (CONFIRMED by evidence, not exhausted)

| | |
|---|---|
| CWE / OWASP | CWE-770 / A05:2021 |
| Component | `frontend/nginx.conf` `location ^~ /api/` sends no `X-Forwarded-For`; `docker-compose.yml` api has no `TRUSTED_PROXIES` |
| Evidence | The two Playwright sign-ins through :3411 are recorded as `ip=172.25.0.4` (the nginx container). Code: `rate_limit.client_address` uses that peer, so everyone using :3411 shares one 20/min login, 60/min refresh and 10/min change-password bucket. Not exhausted, to avoid blocking the other retest agent's browser session |
| Impact | On the dev or UAT stack, one person mistyping repeatedly (or 21 people signing in within a minute, e.g. a UAT session start) blocks everybody for up to 60 s. Audit IPs are useless there. **Production is not affected** (single uvicorn, real client addresses) |
| Severity | **LOW** (dev/UAT availability and audit quality) |
| Fix | nginx: `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, do not append). Compose: `TRUSTED_PROXIES: 172.16.0.0/12` (or the nginx service address) for `api` |
| Regression test | e2e: two sign-ins through :3411 with different client addresses are recorded with different `audit_log.ip`; 21 failures from one client do not block a second client |

### RT-AII-N4: Production-only protections fail open unless `ENVIRONMENT_NAME` is exactly production/prod (CONFIRMED)

| | |
|---|---|
| CWE / OWASP | CWE-1188 (insecure default), CWE-798 / A05:2021 |
| Component | `backend/app/main.py::is_production`, `refuse_to_start_with_insecure_secret`, `docs_urls`; `core/config.py` `environment_name="development"` |
| Evidence | `RT-AU-T910..T913`: `ENVIRONMENT_NAME` unset, `prd` or `live` with the committed `dev_secret_change_me` starts (a warning line only) and serves `/docs`, `/redoc`, `/openapi.json`. `JWT_SECRET` of 40 spaces passes the length rule in production |
| Impact | The IF-04 and AU-11 protections depend on one manual `.env` line in `shared\.env` on 10.0.1.98. Docs say "set production"; whether the live `.env` has it is not evidenced. If it is missing, a forgotten or placeholder secret again allows forged admin tokens |
| Severity | **LOW** (needs a misconfiguration, but that is exactly what IF-04 is about) |
| Fix | Treat single-port mode (`FRONTEND_DIST_DIR` set) as production for these checks, **or** invert the default: refuse placeholder or short secrets unless `ENVIRONMENT_NAME` is explicitly `development`/`test`/`security-test`. Also reject secrets with fewer than about 16 distinct characters. Add to the deploy checklist: after restart, `system_event app_started` shows `environment=production` and `/openapi.json` is 404 |
| Regression test | `test_single_port_mode_counts_as_production`: `FRONTEND_DIST_DIR` set + `ENVIRONMENT_NAME` unset + placeholder secret makes startup raise. `test_low_entropy_secret_refused` |

### INFO observations (no finding)

- **N5**: Proxied `/api` responses on :3411 carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Cache-Control` **twice** (API and nginx). The values are identical, browsers accept them, and CSP and Permissions-Policy appear once. Tidy-up: `proxy_hide_header` those four as well (`RT-AU-T403..T405`).
- **N6**: In single-port production an unknown `/api/...` path returns the SPA shell with 200 instead of a JSON 404. Pre-existing; affects error handling only. Fix: `_serve_frontend_shell` raises 404 for `api/` paths (`RT-AU-T952`).
- **N7**: Sign-out ends **every** session of the account by design (`RT-AU-T109`). With shared store logins (EXT-30), one person signing out signs out every device using that store login. This is the expected kind of unexpected session end, worth telling store users. Using a revoked token is audited as `INVALID_TOKEN` (at most one row per address and minute), and the row does not name the account.
- **N8**: Changing someone's login e-mail does not end their session (`RT-AU-T131`). This is acceptable: it is not an access change.
- **N9**: An `audit_log` row can be INSERTed with an old `at` and is then purgeable with the flag (`T12`). This only concerns rows the inserter forged themselves; real recent rows cannot be backdated (UPDATE refused).
- Malformed integers and NUL bytes reach PostgreSQL and are mapped to a friendly 422. Logged as WARNING with a request id, never a 5xx.

## 3. Residuals of fixed or mitigated findings (for the risk register)

1. **AU-06 residual (LOW)**: no refresh-token reuse detection. A refresh cookie copied before the owner refreshed stays usable for up to 8 h unless the owner signs out or changes password/access. Fix: store the current refresh `jti` (or a hash) per account or per session, refuse an older one, and on reuse end all sessions (`token_version += 1`). Test: `test_rotated_refresh_token_reuse_is_refused_and_ends_sessions`.
2. **AU-08 residual (LOW)**: the common-password list is fixed and small, so `Password@2026`, `Welcome@2026` (and by construction `Admin@2026`, `Qwerty@123`, `India@2026`) are accepted. Fix: normalise before comparing (strip trailing digits/symbols and a 4-digit year, de-leet `@`/`0`/`1`/`$`), then check the base word against a larger list (for example the top 10k from a public breach corpus, shipped as a file). Test: those five refused, `Granite#Meadow-4418` accepted.
3. **AU-04 residual (MEDIUM, accepted design)**: targeted lock-outs remain possible (5 guesses per 15 min per victim). With one address, about 60 accounts can be kept locked. Mitigations are external (EXT-05 restricting the internet forward, EXT-19 MFA) or design (progressive delays instead of hard locks).
4. **AU-10/IF-05/IF-06 residual**: the table owner or a superuser can still disable or drop the triggers or use replica mode: EXT-07 (separate runtime role).
5. **IF-01**: tested on Linux. Production is **Windows**. The code (`Path.resolve()` + `is_relative_to`) also covers backslash, drive-letter and UNC paths on Windows by design, but that could not be executed here. After EXT-01, run the EXT-01 "done when" probes (plus `..%5c`, `C:%2fWindows%2fwin.ini`, `%5c%5cserver%5cshare`) against production.

## 4. What could not be exercised, and why

- Windows path semantics for IF-01 and the real production launcher flags (no Windows host in scope; launcher not in git, EXT-13).
- A real ERP (IF-03 used CKAM's local ERP copy; IF-10 used a black-hole listener, TEST-NET, and the local sec Postgres as a stand-in. No ERP TLS (IF-16/EXT-25)).
- HTTPS / `Secure` cookie (IF-02/AU-13: needs EXT-04).
- `master_audit` row triggers: the table is empty on this stack (TRUNCATE trigger verified).
- Mass lock-out (AU-04) and exhausting the :3411 address bucket (N3): calculated and proven from code and audit rows, not executed, to avoid locking real personas or blocking the parallel retest agent.
- `pip-audit` was not re-run online; the installed versions are byte-identical to the earlier audited set, so the earlier result stands.


---


# PART F — Concurrency results

(source file: docs/security/evidence/retest/concurrency_results.md)

# Concurrency bursts (ACCESS retest, part C): NOT EXECUTED

**Status: not run in this retest. No verdict is given for any burst.**

The ACCESS retest session stopped while the burst script was being written. No burst request was sent to `ckam-sec`. The incomplete scratch script was never run and is not copied into this folder.

| Planned burst | Executed | Result |
|---|---|---|
| Parallel PO create with the same PO number | no | none |
| Parallel Receive of the same PO line, with and without the same Idempotency-Key | no | none |
| Parallel batch asset creation with the same Idempotency-Key | no | none |
| Parallel Move of one asset to two holders, and the same asset sold twice | no | none |
| Parallel entry of the same serial on two assets | no | none |
| Parallel vendor and item creation with the same name or code | no | none |
| Parallel change-password and login for one user | no | none |

## What the code and schema show (static, not proven under load)
These observations are not test results. They only show where a burst run should start.
- `purchase_order`: a partial unique index `uq_purchase_order_company_number_active (company_id, lower(btrim(po_number))) WHERE is_active` and an advisory lock (`purchase_orders/service.py::lock_po_number`).
- Receive (`purchase_orders/receive.py:230-238`) locks the waiting `pending_asset` units with `FOR UPDATE`.
- Lifecycle events (`lifecycle/service.py:128-134`) lock the asset rows with `FOR UPDATE`, in id order.
- Asset codes come from an atomic counter update (`numbering/service.py::reserve_codes`). `asset.asset_code` is UNIQUE. Serials have the partial unique index `ux_asset_serial_number_ci`.
- Items have the unique index `ux_item_name_active_ci`.
- **Vendors are different.** Only `vendor.code` is UNIQUE. Duplicate active names are refused by check-then-insert (`masters/router.py::_refuse_duplicate_name`), with no index or lock behind it. Two parallel creates with the same name and different explicit codes could therefore both succeed. This is a candidate race (SUSPECTED, not tested).
- Change-password and the other session-ending paths raise `token_version` in Python (`core/security.py::end_all_sessions`: read +1), not with an atomic SQL increment. Under a race two revocations can write the same value. This still ends every earlier session, so the expected impact is low (SUSPECTED, not tested).

## Throw-away data created by this retest (all RT-tagged, as SECHO)
- Asset 17 (`CKSPL/ADFA-SPL/0005`, "RT probe chair", in stock room 3), with documents 3, 4 and 5.
- PO 9 `RT-PO-PROBE-85582` (2 chairs waiting).
- Users 32 (`RT-SESS-A-771711`), 33 (`RT-SESS-B-771711`), 34 (employee coded `SECHO`, "RT Clash Employee") and 35 (`RT-MASS-771711`). All four are soft-deactivated.


---


# PART G — External and organisational actions

(source file: docs/security/CKAM_EXTERNAL_SECURITY_ACTIONS.md)

# CKAM: External Security Actions

| | |
|---|---|
| Date | 2026-10-15 (FINAL state after remediation and retest) |
| Purpose | Every security action that **cannot be completed by changing CKAM code on the dev PC**: server, network, database administration, supplier, people and management actions |
| Code state | All code findings are FIXED, MITIGATED or ACCEPTED in 8 **local** commits (`3e134c1`, `7e57844`, `ba04371`, `77431ba`, `4fa5c9b`, `ae706bb`, `da790d1`, `d04779a`; HEAD `d04779a`). **None is pushed or deployed**: production still runs `3b5e842` |
| Related | `CKAM_ISO27001_READINESS.md` (finding summary section 6, risk register section 9), `CKAM_SOC2_READINESS.md`, `CKAM_THREAT_MODEL.md`; and from the separate writer `CKAM_VAPT_REPORT.md`, `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md` |

How to read this list:

- **Owner** is one of IT, Infra, Management, HR, Vendor, Security, Audit, Dev (a developer task that still needs
  a server or a decision).
- **Timing:** `URGENT` (now, within days), `30 days`, `90 days`, `12 months`.
- **Done when** is the check that proves the action is complete. Keep that proof; it becomes audit evidence.
- No action here needs any password written down in this repository. **The owner types every superuser,
  database, NAS and ERP password on the servers himself** (`CLAUDE.md`).
- Deploying to production always needs the owner's explicit request (`CLAUDE.md`). This list says *what* must
  happen; it is not that request.

## Summary

| ID | Action | Owner | Timing |
|---|---|---|---|
| EXT-01 | Deploy the release with all 8 security commits (IF-01 fix first among them) to production | Management + IT | **URGENT** |
| EXT-02 | Rotate JWT secret, `ckassetapp` DB password, NAS password, ERP password after EXT-01 | IT + Infra | **URGENT** |
| EXT-03 | Check whether IF-01 was used against production (compromise assessment) | Security + IT | **URGENT** |
| EXT-04 | HTTPS for production | Infra | 30 days |
| EXT-05 | Stop the internet port-forward of 3211 or restrict it (VPN) | Infra + Management | **URGENT** (decision) / 30 days |
| EXT-06 | Run CKAM as a low-privilege service account instead of SYSTEM | Infra | 30 days |
| EXT-07 | Separate low-privilege runtime DB role from the owner role | Infra (DBA) + Dev | 30 days |
| EXT-08 | Off-server encrypted backups, NAS file backup, quarterly restore test | Infra | 30 days |
| EXT-09 | OS / runtime / database / NAS patching | Infra | 30 days, then monthly |
| EXT-10 | Lock down dev PC `.env` and `backups\`; encrypt disk; purge old dumps | IT + Dev | **URGENT** |
| EXT-11 | Self-host the Google Fonts | Dev | 90 days |
| EXT-12 | Reproducible (locked) Python installs in production deploys | Dev + IT | 30 days |
| EXT-13 | Put the production launcher and release script in git; Windows runbook | Dev + IT | 30 days |
| EXT-14 | External VAPT by an independent firm | Management + Audit | 90 days (after EXT-01..08) |
| EXT-15 | ISO 27001 certification body engagement | Management | 12 months |
| EXT-16 | SOC 2 auditor (CPA firm) selection | Management | 12 months |
| EXT-17 | Policy set | Management + Security | 90 days |
| EXT-18 | Quarterly access review | Management (CKAM owner) | 30 days, then quarterly |
| EXT-19 | MFA decision (head-office admin and Full Admin first) | Management + Dev | 90 days |
| EXT-20 | Incident response plan | Security + Management | 30 days |
| EXT-21 | Log retention and off-server log shipping | Infra + Dev | 90 days |
| EXT-22 | Monitoring and alerting; weekly security-log review | IT + Management | 30 days |
| EXT-23 | Password manager for server secrets, with break-glass | IT + Management | 30 days |
| EXT-24 | Segregation from shared servers (Spinwheel, Citykart Desk) | Infra + Management | 12 months |
| EXT-25 | ERP read-only DB role with TLS | Vendor (ERP warehouse owner) + Infra | 90 days |
| EXT-26 | Decision D6: limit Full Admin to chosen companies | Management | 30 days |
| EXT-27 | Apply PostgreSQL slow-query / lock logging on 10.0.0.205 | Infra (DBA) | 90 days |
| EXT-28 | Company-owned repository with MFA and branch protection; CI | Management + Dev | 90 days |
| EXT-29 | BCP / DR plan, RTO/RPO, reboot test, server-room check | Management + Infra | 90 days |
| EXT-30 | Rule for shared store logins | Management + HR | 90 days |
| EXT-31 | Legal review: personal data, incident reporting, record keeping | Management (Legal) | 90 days |
| EXT-32 | Awareness training; screening/NDA confirmation | HR + Security | 90 days, then yearly |
| EXT-33 | Joiner / mover / leaver process | HR + IT | 30 days |
| EXT-34 | Supplier review | Management + IT | 90 days, then yearly |
| EXT-35 | Change record per release; emergency change rule | Dev + Management | 30 days |
| EXT-36 | ISMS roles, risk-register ownership, internal audit, management review | Management + Audit | 90 days / 12 months |
| EXT-37 | Antimalware / EDR on servers and NAS | Infra | 30 days |
| EXT-38 | Start production uvicorn with `--no-proxy-headers` (N2) | IT | **URGENT** (with EXT-01) |
| EXT-39 | Pre-deploy checks for the new release: JWT secret strength, `ENVIRONMENT_NAME=production`, `alembic upgrade head` before start, constraints | IT + Dev | **URGENT** (with EXT-01) |
| EXT-40 | Watch the sign-in rate limit for users behind one NAT address | IT + Dev | 30 days after deploy |

Order that matters: **EXT-39 → EXT-01 → EXT-38 → EXT-02** (check the settings, deploy with migrations first,
start with the right flags, then rotate secrets; changing secrets while the hole is still open is wasted
effort, because the new secrets could be read the same way). **EXT-05 decision as soon as possible** (closing
or narrowing the internet forward reduces the danger while EXT-01 is prepared).

---

## EXT-01 Deploy the IF-01 fix to production — URGENT

| | |
|---|---|
| What | After the owner approves the push and, separately, the deploy: deploy a release at `d04779a` or later, which contains all 8 security commits (`3e134c1` path-traversal fix for `GET /assets/{file_path:path}`, `7e57844`, `ba04371`, `77431ba`, `4fa5c9b`, `ae706bb`, `da790d1`, `d04779a`; all fixed and retested), following the normal deploy steps in `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (backup first, release by commit, `alembic upgrade head`, restart, verify) **plus the pre-deploy checks in EXT-39** and the start flag in EXT-38 |
| Why (plain words) | The live server (release `3b5e842`) hands out any file on the server to anyone who asks in a special way, including the file with the database password and the key that signs logins. The fix, and all other fixes of 2026-10-15, exist on the dev PC only |
| Risk if ignored | Full takeover of CKAM: an attacker can forge a head-office-admin login, read or change all data in `ckassetmanagement`, read NAS documents, and use the ERP password. The server is reachable from the internet (R-02, R-03, R-18) |
| Owner | Management (approve) + IT (deploy) |
| Timing | **URGENT** |
| Done when | On production: `GET /assets/..%2f..%2f..%2fshared%2f.env` and `GET /assets/%2fetc%2fpasswd`-style probes return 404 (never 200); `/docs` and `/openapi.json` return 404; responses carry `Content-Security-Policy`; `alembic current` = head (`a3c5e7f9b1d4` / `f9a1c3e5b7d2` applied); `system_event` `app_started` shows the new version and `production`; a change record exists (EXT-35) |

## EXT-02 Rotate production secrets after EXT-01 — URGENT

| | |
|---|---|
| What | After EXT-01 is verified: (1) new random `JWT_SECRET` (at least 32 characters with at least 8 different characters, e.g. 64 random hex characters; the new code refuses to start otherwise) in `shared\.env` — every user signs in again, nothing else breaks; (2) new password for DB role `ckassetapp` (the owner runs `ALTER ROLE` as superuser on 10.0.0.205 and updates `DATABASE_URL` in `shared\.env`); (3) new password for NAS user `ckappuser` (on the NAS) and in `shared\nas.pw`; (4) new password for ERP role `ckpost`, coordinated with the ERP warehouse owner, then `PO_SOURCE_PASSWORD` in `shared\.env`. Restart `CKAM-Web`. Delete or lock down old copies such as `shared\.env.pre-3b5e842` (they hold the old secrets). Confirm the new production values are not the same as any dev value |
| Why | Since 2026-09-30 every release had IF-01. Anyone who used it could have copied these secrets. Changing them makes stolen copies useless |
| Risk if ignored | A copied JWT secret lets someone sign in as anyone, forever, without a password and without a LOGIN row in the audit trail |
| Owner | IT + Infra (the owner types the passwords) |
| Timing | **URGENT**, immediately after EXT-01 |
| Done when | Old access tokens are rejected (401); the app starts without the placeholder-secret refusal; `/api/admin/diagnostics/health` OK; NAS mapping line in the launcher log succeeded; ERP `sync_success` after restart; a dated rotation note (who, when, which secrets; never the values) is kept |

## EXT-03 Compromise assessment for IF-01 — URGENT

| | |
|---|---|
| What | Look for signs that IF-01 was used: (1) `logs\app\app.jsonl` access lines (exist since 2026-10-14) with paths under `/assets/` containing `..`, `%2e`, `%2f`, `%5c` or a leading `/`; (2) older launcher logs in `logs\` for the same patterns, if they contain request lines; (3) `audit_log`: actions by head-office admin or Full Admin accounts from unknown IP addresses, or actions with no LOGIN row from the same address (a forged token does not create a LOGIN row); (4) PostgreSQL log on 10.0.0.205 for `ckassetapp` connection attempts from other hosts (pg_hba blocks them, but attempts show intent); (5) NAS access log for `ckappuser` from unexpected hosts; (6) router/firewall logs for unusual volumes on 3211. Record the result as an incident (EXT-20) |
| Why | Fixing a hole does not tell you whether someone already came through it |
| Risk if ignored | A past intrusion goes unnoticed; data changes or copies stay unexplained |
| Owner | Security + IT |
| Timing | **URGENT** (in parallel with EXT-01) |
| Done when | A written incident record: period checked, sources checked, findings, decision (no evidence of use / evidence of use and next steps) |

## EXT-04 HTTPS for production — 30 days

| | |
|---|---|
| What | Serve CKAM only over HTTPS. **Recommended design:** a reverse proxy on 10.0.1.98 terminates TLS and forwards to uvicorn bound to `127.0.0.1` only. **Proxy options:** Caddy for Windows (simple, can renew certificates itself), nginx for Windows, or IIS with URL Rewrite/ARR if IIS is already the standard on that server. Check `D:\Citykart_Applications\PORTS.md` first because the server is shared and 443 may already be used. **Certificate options:** (a) the existing `*.citykartstores.com` wildcard if CityKart has one; (b) Let's Encrypt: because the public port is 3211, the domain proof must be a DNS-01 TXT record (automatic only with DNS API access, otherwise manual every 90 days, which is risky); (c) a paid 1-year certificate. A public-CA certificate needs nothing installed on users' devices; a self-signed or internal-CA one would. **Settings after the switch:** `COOKIE_SECURE=true`, `BASE_URL=https://ckam.citykartstores.com:3211` (or `:443`), `TRUSTED_PROXIES=127.0.0.1` so the real client IP from `X-Forwarded-For` is recorded. **Redirect:** if a plain-HTTP listener remains (e.g. port 80), it only answers with a redirect to HTTPS. **HSTS:** only after HTTPS has been stable for some weeks, start with a short `max-age` (minutes), then raise it to one year; do not use `preload` at first. **LAN users:** use the DNS name, not `http://10.0.1.98:3211` (by IP the browser shows a name warning); internal DNS may need a record. **Renewal:** automatic or calendared with an alert; protect the private key file (Administrators + the CKAM service account only) |
| Why | Today passwords and session cookies travel in clear text over the internet; anyone on the path can read them (IF-02, AU-13) |
| Risk if ignored | Stolen passwords and sessions; SOC 2 CC6 and ISO A.8.24 cannot be met |
| Owner | Infra |
| Timing | 30 days |
| Done when | An HTTPS scan (e.g. a TLS checker) shows a valid certificate and TLS 1.2+ only; `http://` requests are refused or redirected; refresh cookie carries `Secure`; the audit trail shows real client IPs; renewal date is in the calendar |

## EXT-05 Stop or restrict the internet port-forward of 3211 — URGENT decision, 30 days to complete

| | |
|---|---|
| What | Decide who really needs CKAM from outside the CityKart network. If nobody: remove the router forward TCP 3211 → 10.0.1.98:3211. If stores or staff outside need it: prefer the corporate VPN; otherwise keep it only behind HTTPS (EXT-04), with the login rate limit (AU-03) deployed, and if possible an IP allow-list of store public IPs. Consider keeping head-office-admin use LAN/VPN-only |
| Why | The forward lets anyone on the internet reach the login page and every weakness of the server |
| Risk if ignored | Internet scanning finds CKAM; IF-01-type flaws and password guessing are exposed to the whole world (R-18) |
| Owner | Infra + Management (decision) |
| Timing | Decision **URGENT**; change within 30 days |
| Done when | From an outside network, `http://ckam.citykartstores.com:3211/` does not connect (forward closed) or connects only through VPN / allow-listed IPs; router configuration export kept |

## EXT-06 Low-privilege Windows service account instead of SYSTEM — 30 days

| | |
|---|---|
| What | Create a dedicated account (e.g. `svc_ckam`, local or domain) that is not an administrator, cannot log on interactively, and has: read/execute on `releases\` and `shared\venv`, modify on `logs\`, read on `shared\.env` and `shared\nas.pw` (and nothing else of other apps), and the "Log on as a batch job" right. Change the `CKAM-Web` scheduled task to run as this account. Remove SYSTEM/Everyone read on the secret files except Administrators and `svc_ckam` |
| Why | CKAM currently runs with the highest Windows privilege on a server shared with Spinwheel and Citykart Desk (IF-07). Any CKAM flaw becomes full control of the server and the other apps |
| Risk if ignored | One bug = whole server, all apps, all their secrets (R-07, R-06) |
| Owner | Infra |
| Timing | 30 days |
| Done when | Task Scheduler shows `CKAM-Web` running as the new account; the app starts, NAS mapping succeeds, uploads work; `icacls` output for `shared\` kept as evidence; a reboot test passes (EXT-29) |

## EXT-07 Separate low-privilege runtime database role — 30 days

| | |
|---|---|
| What | Split the database account into (a) an **owner/migration role** that owns the schema and is used only during deploys for `alembic upgrade head`, and (b) a **runtime role** used by the running app, which can read and write business tables, can only INSERT and SELECT on the audit tables (`audit_log`, `asset_event`, `asset_field_change`, `master_audit`), cannot TRUNCATE, cannot ALTER or DROP anything, cannot disable triggers and cannot run the audit purge function. The exact least-privilege role design and grant script will be supplied by the backend engineer in the remediation report under `docs/security/` (file name to be confirmed); this document does not define the SQL. The owner runs it as superuser on 10.0.0.205 |
| Why | Today the production app connects as `ckassetapp`, which runs Alembic and therefore owns the tables. A table owner can switch off or drop the append-only triggers and wipe the audit trail (IF-05, IF-06; `db_03` section C). The code fix (TRUNCATE guards and a 5-year audit purge floor, migration `a3c5e7f9b1d4`, status MITIGATED) narrows this but cannot stop an owner or superuser |
| Risk if ignored | An attacker with the runtime password, or a bug, can rewrite history that auditors rely on (R-12) |
| Owner | Infra (DBA) + Dev |
| Timing | 30 days (after EXT-02) |
| Done when | `pg_roles` / table-owner query on 10.0.0.205 shows the runtime role is not the owner and has no TRUNCATE; the `db_03` style tests (in a rolled-back transaction) show TRUNCATE, DISABLE TRIGGER and DROP refused for the runtime role |

## EXT-08 Off-server encrypted backups, NAS file backup, restore test — 30 days

| | |
|---|---|
| What | (1) Copy each nightly dump from `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP` to a second location **not on 10.0.0.205**, encrypted (e.g. AES-256 archive, or a backup tool with encryption), with the key kept in the password manager (EXT-23). (2) Keep at least one copy **offline or immutable** (cannot be deleted by a compromised server account) against ransomware. (3) Back up the NAS folder `CKASSETMANAGEMENT_DATA` (documents) on the same schedule. (4) Every quarter restore the latest dump into a throw-away database on a non-production server, compare row counts and the Alembic version, open a few documents, and write down the time it took (this is the measured RTO). Never restore over `ckassetmanagement` for a test |
| Why | Today all backups sit on the same server as the database, unencrypted, and have never been restored in production (IF-08). A disk failure, a ransomware attack or a mistake on 10.0.0.205 loses both the data and the backups |
| Risk if ignored | Permanent loss of the asset register and documents (R-13, R-14) |
| Owner | Infra |
| Timing | 30 days |
| Done when | Off-server copy log shows daily success; one offline/immutable copy exists; NAS folder backup log exists; a dated restore-drill report with row counts and duration |

## EXT-09 Patching of OS, runtime, database and NAS — 30 days, then monthly

| | |
|---|---|
| What | Monthly patch window for Windows on 10.0.1.98 and 10.0.0.205, Python 3.13 (`C:\Program Files\Python313`), PostgreSQL 18 minor releases, and NAS firmware. Check vendor advisories (subscribe, A.5.6). Patch status is NOT EVIDENCED today |
| Why | Old software has known holes that attackers use first |
| Risk if ignored | Compromise through a known, already-fixed vulnerability (R-17) |
| Owner | Infra |
| Timing | Baseline within 30 days, then monthly |
| Done when | Monthly patch report per server (installed updates, pending updates, reboot date) |

## EXT-10 Dev PC: `.env`, `backups\`, disk — URGENT (local action)

| | |
|---|---|
| What | On 10.0.0.47: restrict the repository's `.env` and `backups\` folder (it holds about 30 daily dev dumps and a first-login note) to the developer account and Administrators only; enable disk encryption (BitLocker); delete dev dumps older than needed; remember the dev database holds a copy of **real** ERP data (vendors, POs) |
| Why | IF-09: other local accounts or malware on the dev PC can read dev secrets and dumps |
| Risk if ignored | Leak of real vendor/PO data and dev credentials (R-25) |
| Owner | IT + Dev |
| Timing | **URGENT** |
| Done when | `icacls` output shows only the developer and Administrators; BitLocker status "on"; dump count reduced |

## EXT-11 Self-host the Google Fonts — 90 days

| | |
|---|---|
| What | Download the Inter and IBM Plex Mono font files once, add them to the frontend build, remove the `fonts.googleapis.com` / `fonts.gstatic.com` links from `frontend/index.html` (a small frontend code change, then a normal release) |
| Why | Every page load sends the user's IP address to Google and depends on an outside site; the new Content-Security-Policy (AU-14) has to allow Google's font hosts until this is done |
| Risk if ignored | Minor privacy issue; page looks different if Google is unreachable (R-29) |
| Owner | Dev |
| Timing | 90 days |
| Done when | Browser network tab shows no request to Google; fonts still render |

## EXT-12 Reproducible Python installs in production — 30 days

| | |
|---|---|
| What | `backend/constraints.txt` now exists (IF-11 FIXED in code, commit `ae706bb`). Use it in every production deploy (`pip install -c constraints.txt -e ...`), keep `pip freeze` of each release next to it, and run `pip-audit` on that list before deploy |
| Why | Without a lock, production may install different package versions from the tested ones |
| Risk if ignored | Untested or vulnerable versions in production (R-15) |
| Owner | Dev + IT |
| Timing | 30 days |
| Done when | Each `releases\<sha>\` has a `pip freeze` file identical to the tested set |

## EXT-13 Production launcher and release script in git; Windows runbook — 30 days

| | |
|---|---|
| What | Add `run_ckam_web.ps1` and the release script (secrets removed, read from `shared\.env` as today) to the repository; rewrite `docs/ai/CKAM_RELEASE_RUNBOOK.md` for the real Windows single-port production (it still describes Docker, IF-15) |
| Why | The steps that touch production are not reviewed or versioned |
| Risk if ignored | A wrong deploy or an untraceable change (R-23) |
| Owner | Dev + IT |
| Timing | 30 days |
| Done when | Scripts in git; runbook matches what the operator actually does |

## EXT-14 External VAPT by an independent firm — 90 days

| | |
|---|---|
| What | Engage an independent security testing firm (for example a CERT-In empanelled auditor) for an authenticated web-application and infrastructure test, after EXT-01 to EXT-08, with a written scope and an approved test plan; production tests only with the owner's written approval |
| Why | The 2026-10-15 VAPT was done by the people who build CKAM; ISO A.5.35 and SOC 2 CC4/CC7 expect independent testing |
| Risk if ignored | Blind spots of the builders stay hidden |
| Owner | Management + Audit |
| Timing | 90 days |
| Done when | Signed report; findings tracked to closure |

## EXT-15 ISO 27001 certification body engagement — 12 months

| | |
|---|---|
| What | Only after the ISMS has operated (policies approved, risk treatment running, at least one internal audit and one management review, EXT-36), choose an **accredited** certification body and plan Stage 1 (documents) and Stage 2 (implementation) audits |
| Why | Certification can only come from an accredited, independent body; this repository's documents are readiness material only |
| Owner | Management |
| Timing | 12 months |
| Done when | Signed engagement; Stage 1 date booked |

## EXT-16 SOC 2 auditor selection — 12 months

| | |
|---|---|
| What | If customers or partners ask for SOC 2: select a licensed CPA firm; agree scope (Security + Confidentiality + Processing Integrity recommended), Type I first, then a Type II observation period (commonly 6-12 months) |
| Why | A SOC 2 report can only be issued by an independent CPA firm |
| Owner | Management |
| Timing | 12 months |
| Done when | Engagement letter with scope and observation-period dates |

## EXT-17 Policy set — 90 days

| | |
|---|---|
| What | Short, approved policies: information security (top level); access control (incl. least privilege, D6, store logins); passwords and MFA; acceptable use; data classification and handling (incl. exports); cryptography and key management (JWT secret, certificates, backup keys, rotation); backup and restore; change management (incl. emergency changes); secure development (incl. the baseline and AI-assisted development: no production data or secrets in prompts, human review of every change); vulnerability and patch management; logging and monitoring; incident response; supplier security; business continuity; data retention and privacy |
| Why | ISO A.5.1 and SOC 2 CC1/CC5 start from written, approved rules |
| Owner | Management + Security |
| Timing | 90 days |
| Done when | Signed and dated policies; staff acknowledgement records |

## EXT-18 Quarterly access review — 30 days, then quarterly

| | |
|---|---|
| What | The head-office admin exports the user list (`GET /api/asset-users/export`), checks for each login: still employed, right access level, right companies, right work area, head-office admin flag only where intended, store logins still needed; fixes and signs. Include server and database accounts (who can log on to 10.0.1.98 / 10.0.0.205, who knows the superuser password) |
| Why | Access drifts over time; reviews catch leftovers and mistakes (R-04, R-16) |
| Owner | Management (CKAM owner) |
| Timing | First review within 30 days, then quarterly |
| Done when | Signed review sheet per quarter; matching `ACCESS_CHANGED` / deactivation rows in the audit trail |

## EXT-19 MFA decision — 90 days

| | |
|---|---|
| What | Decide whether to add a second factor (e.g. authenticator-app TOTP) for head-office admin and Full Admin first, then others. Until MFA exists, keep admin use on the LAN/VPN (EXT-05) |
| Why | A stolen password is today enough to act as an admin |
| Owner | Management (decision) + Dev (build) |
| Timing | Decision within 90 days |
| Done when | Written decision; if yes, MFA enforced for the chosen roles and tested |

## EXT-20 Incident response plan — 30 days

| | |
|---|---|
| What | A short plan: who leads, severity levels, first steps for CKAM (switch off the port-forward, stop `CKAM-Web`, preserve logs with `GET /api/admin/logs/export`, rotate secrets per EXT-02), who talks to management and users, when and how to report to CERT-In (confirm the required window with legal counsel, EXT-31), how to restore, and a post-incident review. Test it once a year with a table-top exercise; use IF-01 as the first real case (EXT-03) |
| Why | Without a plan, people improvise under pressure and evidence is lost |
| Owner | Security + Management |
| Timing | 30 days |
| Done when | Approved plan; IF-01 incident record; first exercise record |

## EXT-21 Log retention and off-server log shipping — 90 days

| | |
|---|---|
| What | Decide retention: `audit_log` is kept forever by design (check this against privacy, EXT-31); set `LOG_RETENTION_DAYS` long enough for audit needs (above 365 days if SOC 2 Type II is planned); copy `audit.jsonl` / `error.jsonl` / `app.jsonl` (or monthly exports from `GET /api/admin/logs/export`) to storage that the CKAM server account cannot delete; keep a hash of each export |
| Why | Logs on the same server can be lost or altered together with the server |
| Owner | Infra + Dev |
| Timing | 90 days |
| Done when | Retention written in policy; off-server log store with monthly files and hashes |

## EXT-22 Monitoring, alerting and log review — 30 days

| | |
|---|---|
| What | Alerts (e-mail or chat) for: `CKAM-Web` down (external check of `/api/health`), many `LOGIN_FAILED` / `LOCKED` rows, 5xx spikes in `error_log`, ERP `sync_failed` or no `sync_success` for a day, backup task failure, disk space. Weekly 15-minute review by the head-office admin of SECURITY rows (`GET /api/admin/logs/audit?category=security`) and grouped errors, with a one-line note kept |
| Why | Today problems are only seen when a user complains (R-27) |
| Owner | IT + Management |
| Timing | 30 days |
| Done when | Alert test messages received; weekly review notes exist |

## EXT-23 Password manager for server secrets — 30 days

| | |
|---|---|
| What | Store the JWT secret, DB passwords (incl. `postgres` superuser), NAS password, ERP password, backup encryption key and certificate key passphrase in a company password manager with access for two named people and a sealed break-glass procedure |
| Why | Today these exist only in server files and in one person's memory (R-24) |
| Owner | IT + Management |
| Timing | 30 days |
| Done when | Vault entries exist (names only listed as evidence, never values); two people can retrieve them |

## EXT-24 Segregation from shared servers — 12 months

| | |
|---|---|
| What | Reduce what Spinwheel and Citykart Desk can do to CKAM: separate service accounts per app (EXT-06), separate database roles (already), consider a separate VM for CKAM or at least separate Windows file permissions per app folder; review who administers the shared servers |
| Why | A weakness in another app on 10.0.1.98 / 10.0.0.205 / the NAS can reach CKAM (R-06) |
| Owner | Infra + Management |
| Timing | 12 months |
| Done when | Written separation design; per-app accounts; (optional) dedicated VM |

## EXT-25 ERP read-only DB role with TLS — 90 days

| | |
|---|---|
| What | With the ERP warehouse owner on 10.0.1.69: confirm role `ckpost` has **SELECT only** on the views CKAM reads (no INSERT/UPDATE/DELETE/TRUNCATE, no ownership); set `default_transaction_read_only = on` **on the role itself** (`ALTER ROLE ... SET`), not only per connection as CKAM does today; require TLS for this role (`hostssl` in `pg_hba.conf`); then add a TLS option on the CKAM side (IF-16, code change) |
| Why | Today read-only is guaranteed by CKAM's own connection setting; the ERP password and data travel unencrypted on the LAN |
| Owner | Vendor (ERP warehouse owner) + Infra |
| Timing | 90 days |
| Done when | `\du` / grant listing shows SELECT only; role setting shows read-only; `pg_stat_ssl` shows TLS for CKAM's connection |

## EXT-26 Decision D6: limit Full Admin to chosen companies — 30 days

| | |
|---|---|
| What | Owner decides whether an ordinary Full Admin should work only in chosen companies (CKSPL / CKVPL) instead of every company (open since 2026-10-14, `docs/ai/DECISIONS.md`) |
| Why | Least privilege: a Full Admin of one company can today act in the other |
| Owner | Management |
| Timing | 30 days |
| Done when | Decision recorded in `docs/ai/DECISIONS.md`; if "limit", built, tested with cross-company tests, deployed |

## EXT-27 PostgreSQL logging on 10.0.0.205 — 90 days

| | |
|---|---|
| What | Apply the slow-query, lock-wait and checkpoint settings listed in `docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 7 (can be limited to CKAM's database for `log_min_duration_statement`); consider `log_connections` for the CKAM role only if volume allows |
| Why | Database-side evidence for performance and security investigations |
| Owner | Infra (DBA; superuser step typed by the owner) |
| Timing | 90 days |
| Done when | `GET /api/admin/diagnostics/db` shows `slow_statement_logging_on` true |

## EXT-28 Company-owned repository, MFA, branch protection, CI — 90 days

| | |
|---|---|
| What | The `origin` remote is a GitHub repository under a personal account. Move it to a CityKart-owned organisation, keep it private, require MFA for every member, protect the default branch (`claude/brave-euler-07879a`), and add CI that runs the backend and frontend tests and the dependency audit on every push (IF-17). Consider signed commits |
| Why | The company must control its source code even if a person leaves; CI gives durable test evidence |
| Owner | Management + Dev |
| Timing | 90 days |
| Done when | Repository settings screenshot (owner, visibility, MFA, branch rules); CI run history |

## EXT-29 BCP / DR plan, reboot test, server-room check — 90 days

| | |
|---|---|
| What | Agree RTO/RPO with the business; write the recovery steps (restore DB per EXT-08, restore NAS documents, redeploy last release, rotate secrets if compromise); do the open reboot test of 10.0.1.98 (`CKAM-Web` returns, NAS mapping works); record the accepted risk of having no standby server (A.8.14); confirm physical protection of the server room and NAS (A.7) |
| Why | Nobody knows today how long CKAM could be down or how much data could be lost |
| Owner | Management + Infra |
| Timing | 90 days |
| Done when | Approved plan; reboot test record; server-room checklist |

## EXT-30 Rule for shared store logins — 90 days

| | |
|---|---|
| What | Each store has one login (`sm.<code>@citykartstores.com`). Decide: only the store manager uses it, or named logins for store staff; no password sharing; password changed when the manager changes |
| Why | With a shared login, nobody can tell which person did an action (R-30) |
| Owner | Management + HR |
| Timing | 90 days |
| Done when | Written rule; acknowledged by store managers |

## EXT-31 Legal review — 90 days

| | |
|---|---|
| What | Legal counsel confirms: obligations under India's Digital Personal Data Protection Act 2023 for staff and vendor-contact data (notice, purpose, retention, requests); cyber-incident reporting to CERT-In (time window and what counts); retention rules for fixed-asset, purchase and invoice records; whether `audit_log` kept forever is acceptable for personal data |
| Why | The right technical retention depends on legal requirements |
| Owner | Management (Legal) |
| Timing | 90 days |
| Done when | Written legal register and retention decision |

## EXT-32 Awareness training; screening and NDAs — 90 days, then yearly

| | |
|---|---|
| What | Short yearly session for CKAM users (passwords, store logins, phishing, using Report a problem for anything suspicious); deeper session for admins; HR confirms screening and NDAs for staff with privileged access |
| Owner | HR + Security |
| Timing | 90 days, then yearly |
| Done when | Attendance list; HR confirmation |

## EXT-33 Joiner / mover / leaver process — 30 days

| | |
|---|---|
| What | HR notifies IT on joining, transfer and leaving; IT creates, changes or switches off the CKAM login the same day; before final settlement, assets held by the leaver (CKAM shows them) are returned |
| Owner | HR + IT |
| Timing | 30 days |
| Done when | Process note; sample of leavers matched to CKAM deactivation rows |

## EXT-34 Supplier review — 90 days, then yearly

| | |
|---|---|
| What | List and rate suppliers that touch CKAM: ERP warehouse team (data source), NAS vendor/support, GitHub (code), the AI coding assistant provider used in development (what data is shared), Google Fonts (until EXT-11), Python and npm package ecosystems, any external tester or auditor. Check terms, security commitments and contacts |
| Owner | Management + IT |
| Timing | 90 days, then yearly |
| Done when | Supplier register with rating and review date |

## EXT-35 Change record per release; emergency changes — 30 days

| | |
|---|---|
| What | Use the minimum change-record fields in `CKAM_SOC2_READINESS.md` section 8 for every production release (request id, approver, test evidence, rollback plan, deployment result); define the emergency path (e.g. IF-01: owner approves by message, record completed within one working day, reviewed afterwards) |
| Owner | Dev + Management |
| Timing | 30 days |
| Done when | A change record exists for the next release, including the IF-01 deploy |

## EXT-36 ISMS roles, risk ownership, internal audit, management review — 90 days / 12 months

| | |
|---|---|
| What | Appoint an ISMS lead; approve the scope (`CKAM_ISO27001_READINESS.md` section 2.1) and the risk method; assign an owner to every risk in the register; plan a yearly internal audit by someone independent of CKAM development; hold a yearly management review with minutes |
| Owner | Management + Audit |
| Timing | Roles and risk ownership 90 days; first internal audit and management review within 12 months |
| Done when | Appointment letter; approved register; audit report; review minutes |

## EXT-37 Antimalware / EDR on servers and NAS — 30 days

| | |
|---|---|
| What | Confirm or install antimalware/EDR on 10.0.1.98 and 10.0.0.205 with exclusions only where needed (PostgreSQL data folder per vendor guidance); enable NAS antivirus/snapshot features if available |
| Owner | Infra |
| Timing | 30 days |
| Done when | Console screenshot showing both servers protected and up to date |

## EXT-38 Start production uvicorn with `--no-proxy-headers` — URGENT (with EXT-01)

| | |
|---|---|
| What | Add `--no-proxy-headers` to the uvicorn command in the production launcher `shared\run_ckam_web.ps1` (and in the copy that goes into git, EXT-13). If a reverse proxy is added later (EXT-04), set CKAM's own `TRUSTED_PROXIES` to that proxy's address instead of re-enabling uvicorn's header handling |
| Why (plain words) | By default uvicorn believes the `X-Forwarded-For` header when the request comes from 127.0.0.1. On a shared server another local process could use this to pretend to be any address, which would put a false address in the audit trail and could sidestep the per-address sign-in limit (N2) |
| Risk if ignored | Wrong IP addresses in investigations; weaker rate limiting (R-32) |
| Owner | IT |
| Timing | **URGENT**, in the same deploy as EXT-01 |
| Done when | Launcher command line shows `--no-proxy-headers`; a test request from the server with a forged `X-Forwarded-For` is logged with `127.0.0.1`, not the forged address |

## EXT-39 Pre-deploy checks for the security release — URGENT (with EXT-01)

| | |
|---|---|
| What | Before starting the new code on 10.0.1.98: (1) confirm `shared\.env` has `ENVIRONMENT_NAME=production` (any name outside `development, dev, test, testing, uat, security-test, local, ci` is treated as production anyway); (2) confirm the **current** `JWT_SECRET` is at least 32 characters with at least 8 different characters (check the length and variety without printing the value); if not, generate the new secret now (EXT-02 step 1); (3) run `alembic upgrade head` as the app role **before** starting the new code (it adds `f9a1c3e5b7d2` asset_user.token_version and `a3c5e7f9b1d4` TRUNCATE guards and audit purge floor; new code on the old schema fails); (4) install with `backend/constraints.txt` (EXT-12); (5) check the uvicorn flag (EXT-38) |
| Why (plain words) | The new code deliberately refuses to start in production with a weak secret, and needs the two new database changes. Without these checks the deploy fails and the old, vulnerable release stays live longer |
| Risk if ignored | Failed deploy and downtime; IF-01 stays exposed |
| Owner | IT + Dev |
| Timing | **URGENT**, part of EXT-01 |
| Done when | Change record shows the five checks ticked; `alembic current` = head; launcher log shows a normal start with `production` |

## EXT-40 Sign-in rate limit and shared NAT addresses — 30 days after deploy

| | |
|---|---|
| What | The new sign-in limit is 20 attempts per minute per client address (`RATE_LIMIT_LOGIN_PER_IP`), plus a per-login-id limit. Many staff behind one NAT address (a store, the head office internet line seen from outside) share that address. After deploy, watch `RATE_LIMITED` security rows and 429 answers for a few weeks (EXT-22) and raise the per-address value only if real users are refused at busy times (e.g. morning shift start) |
| Why (plain words) | The limit stops password guessing, but a busy office behind one address could hit it |
| Risk if ignored | Legitimate users refused for up to a minute (R-33); or, if raised too far, weaker protection |
| Owner | IT + Dev |
| Timing | Review 30 days after deploy |
| Done when | A note with the observed 429 counts and the decision (keep / change the value) |


---
