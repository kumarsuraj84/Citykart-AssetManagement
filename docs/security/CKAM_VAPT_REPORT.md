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
