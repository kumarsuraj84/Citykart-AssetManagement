# CKAM: ISO/IEC 27001:2022 Readiness Assessment

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Document | Readiness assessment, version 1.1 (security closure state). Version 1.0 of 2026-10-15 is kept as history in section 15 |
| Date | 2026-10-16 (v1.1, WP-M2b); v1.0 2026-10-15 |
| Evidence cut-off | Local HEAD `fd34520` (worktree `ckam-build`, branch `worktree-ckam-build`): 21 local security commits `3e134c1` … `fd34520` on top of `4ba4e94`, 22 commits ahead of origin `c66378d`. **Nothing is pushed, nothing is deployed, production was never touched.** Production still runs release `3b5e842`. Alembic head in code `c6e8a0b2d4f6` (production `e6f8a0b2c4d6`) |
| Authoritative status source | The lead's fact sheet of 2026-10-16; where an older document disagrees, the fact sheet wins |
| Companion files | `CKAM_ISO27001_CONTROL_MATRIX.csv` / `.xlsx` (all 93 Annex A controls, master copy), `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_THREAT_MODEL.md`, `CKAM_SECURITY_BASELINE.md`, `CKAM_SECURITY_EVIDENCE_INDEX.md`, the DRAFT policy pack `docs/security/policies/` |
| Related reports (separate writer) | `CKAM_SECURITY_MASTER_HANDOVER.md`, `CKAM_SECURITY_CLOSURE_REGISTER.md`, `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md`, `CKAM_VAPT_REPORT.md`, `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md`. This document links to them and does not repeat their detail |

> **This is a readiness assessment, not a certification.** CKAM is **not** ISO/IEC 27001 certified. Only an
> accredited, independent certification body can certify an Information Security Management System (ISMS),
> after a formal Stage 1 and Stage 2 audit. Nothing in this document is a certificate, an audit opinion or
> a promise that certification will be granted. Where no evidence exists the text says **NOT EVIDENCED**.
> The policies in `docs/security/policies/` are **DRAFT — MANAGEMENT APPROVAL REQUIRED**; a draft is not
> evidence that a control operates.

---

## 1. In plain words (for the owner)

**What was checked.** On 2026-10-15 the engineering team ran a full security test of CKAM (VAPT, about 636
cases) and fixed the code findings. On 2026-10-16 a closure programme fixed the remaining code items and had
them re-attacked twice by separate testers (retest 1: 137 cases; retest 2 on the final code: 497 cases, incl.
217 routes x 14 identities = 3,038 access cells with 0 escalations), plus a native Windows test of the
file-read fix, a performance comparison and a database least-privilege simulation. This document asks one
question: *if CityKart wanted ISO 27001 one day, how far is CKAM from it?*

**Important:** every fix is a **local commit on the dev PC**. Nothing has been pushed or deployed. The live
server still runs release `3b5e842`, with the critical file-read hole (IF-01) and a broken QR-label link
(CL2-IF-04), until the owner asks for a deploy and the steps in
`CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` are carried out.

**What is good (in code, retested).**
- A person can only do what their access level allows, and the server checks it every time (0 escalations
  in 3,038 access cells on the final code).
- Every data change goes to an audit trail that the application cannot edit, empty or delete; if an audit
  row ever cannot be written, the failure is now reported instead of disappearing.
- Asset history is append-only like a bank statement, and the database now refuses a direct change of an
  asset's status or holder that does not come through the one lifecycle writer.
- Sign-in is rate-limited, sessions end when rights change, a stolen sign-in cookie that is used twice ends
  every session of that person, passwords must pass a policy, oversized requests are refused, fonts no
  longer come from Google, containers do not run as administrator, and the database account can be split
  so the running app cannot rewrite the audit trail (proven on a test database).

**What is urgent.** Think of the live server as a shop with a strong safe but a back window left open:
- **IF-01 (CRITICAL):** the live server answers requests for files *outside* the website folder, for
  example the settings file with the database password and the JWT secret. Fixed and retested on the dev PC
  (also natively on Windows: old code leaked fake secrets in 10 of 28 attempts, new code in 0 of 28) but
  **not deployed**. Treat it as an incident: deploy, then change every secret (EXT-41, EXT-39, EXT-01, EXT-38,
  EXT-02, EXT-03).
- **QR labels (CL2-IF-04):** in production, scanning a printed asset label most likely shows an error page
  instead of the asset. Fixed in code, same deploy (EXT-44).
- **IF-02 (HIGH):** passwords travel over the internet without encryption (plain `http://`).
- Backups sit on the same database server and have never been restored in production (IF-08); the service
  runs as SYSTEM on a shared server (IF-07).

**What is missing for ISO.** ISO 27001 is mostly about *management*: approved policies, named owners, an
owned risk register, access reviews, an incident plan, supplier checks, training, internal audit and
management review. On 2026-10-16 a pack of 15 **draft** policies and 6 blank record forms was written. None
is approved and none has produced a record, so none of them counts as evidence yet.

**Verdicts (section 12):** **ISO 27001 TECHNICAL READINESS: PARTIAL** (improved: the technical controls are
strong in code, but the production-side items are not deployed). **ISO 27001 ORGANISATIONAL READINESS:
WEAK** (policies are drafts only).

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
| CKAM application (FastAPI backend + React frontend, one uvicorn process, port 3211) | 10.0.1.98, `D:\Citykart_Applications\Citykart_AssetManagement_App` | Scheduled task `CKAM-Web`, runs as SYSTEM (IF-07). Public address via router port-forward of TCP 3211. Live release `3b5e842` |
| Database `ckassetmanagement`, role `ckassetapp` | 10.0.0.205, PostgreSQL 18 | `pg_hba.conf` allows the role only from 10.0.1.98/32; the role still owns the tables (role split prepared in `ops/db/`, not run) |
| Uploaded documents | NAS 10.0.0.25, `CKASSETMANAGEMENT_DATA` folder | NAS user `ckappuser` (whether it is CKAM-only is to be confirmed, EXT-43) |
| Backups | Task `CK_Backup_CKASSETMANAGEMENT` on 10.0.0.205, daily 03:00, 30 days | Not copied off the DB server (IF-08); plan in `CKAM_BACKUP_RESTORE_PLAN.md` |
| ERP read-only link | ERP warehouse 10.0.1.69 (role `ckpost`) | CKAM keeps its own copy, refreshed every 30 minutes; TLS now settable in code (default `prefer`, not mandatory) |
| Development | Dev PC 10.0.0.47 (Docker Compose stack) | Holds dev `.env`, dev dumps and a copy of real ERP data (IF-09; ACL plan prepared, nothing changed) |
| Source code | Git repository; remote `origin` on GitHub | Single author; 23 local commits not pushed; no CI (IF-17) |

### 2.3 Out of scope (and why)

| Item | Reason |
|---|---|
| Spinwheel, Citykart Desk | Other applications that share 10.0.1.98, 10.0.0.205 and the NAS. They are a *risk to* CKAM (R-06) but not part of it |
| The ERP and its warehouse (10.0.1.69) | Owned by another team; CKAM only reads it. The connection's security is in scope |
| CityKart corporate network, e-mail, endpoints | Corporate IT controls; inherited, must be evidenced by CityKart IT |
| Old server 10.0.1.12 | Retired 2026-10-07 for CKAM; must stay dead. Its protection is a CityKart IT duty |

---

## 3. ISMS assumptions and status rules

1. CityKart has **no approved ISMS documentation for CKAM**. A draft policy pack exists (15 documents, 6
   templates, 2026-10-16), all **DRAFT — MANAGEMENT APPROVAL REQUIRED**, 0 approved, 0 operating.
2. People (A.6) and physical (A.7) controls are **inherited** from CityKart HR, Facilities and IT. This
   assessment could not see them, so they are marked NOT EVIDENCED, not "missing".
3. Management will appoint an **ISMS lead** and approve the scope in section 2.1.
4. **Status words** (the matrix column `Status`):
   - `READY`: designed, implemented where it matters (production, or the development practice itself) and evidenced.
   - `READY IN CODE — NOT DEPLOYED` (written `READY IN CODE - NOT DEPLOYED` in the CSV, plain ASCII): the
     control is complete in a local commit and retested, and **the only thing missing is deployment**. For
     production readiness it **counts as PARTIAL**, and every count in this document folds it into PARTIAL
     (shown separately in brackets).
   - `PARTIAL`, `MISSING`, `NOT EVIDENCED`, `N/A` as before.
5. A control that is about development practice itself (A.8.28 secure coding, A.8.29 security testing) is
   READY when the practice operates in development; its production effect is tracked under A.8.8 / EXT-01.
6. **A draft policy never raises a status.** It is listed in the new column `Draft Policy (DRAFT - not
   evidence)`. No status in this document was raised because a draft now exists, and no organisational
   evidence was invented.
7. Certification needs the ISMS to have **operated** (risk treatment, at least one internal audit and one
   management review) before an accredited body performs Stage 1 and Stage 2. This document does not
   estimate the certification body's decision.

---

## 4. The four control kinds

The matrix now has a column **Control Kind**. It says *who* can close the gap and *what kind of evidence* an
auditor will ask for. It is separate from the ISO theme (A.5 to A.8).

| Kind | Meaning | Who closes the gap | Evidence an auditor asks for | Controls |
|---|---|---|---|---|
| **TECHNICAL** | Built into code, database or server configuration | Developers (code), IT/Infra and DBA (servers) | Configuration, test output, system records, post-deploy checks | 31 (A.5.15, A.5.17, A.5.33 and 28 of the A.8 controls) |
| **PROCESS** | A repeatable procedure people run on a schedule or per event, often using system data | Process owner (IT, Dev lead, CKAM owner, ISMS lead) | Dated records of each run (review sheets, change records, restore reports, incident records) | 27 |
| **ORGANISATIONAL** | Management direction, policies, roles, HR, legal, supplier agreements | Management, HR, Legal, ISMS lead | Approved and communicated documents, appointments, contracts, minutes | 21 |
| **PHYSICAL** | Rooms, equipment, utilities, media | Facilities, IT/Infra | Site inspection, access logs, maintenance records | 14 (all of A.7) |

Gaps that code cannot fix are labelled **ORGANIZATIONAL / PROCESS GAP**; gaps that need server, network or
supplier work are labelled **OPEN EXTERNAL / INFRASTRUCTURE ACTION** and listed in
`CKAM_EXTERNAL_SECURITY_ACTIONS.md`. The column **Technical Control** still starts with a tag (`TECH READY`,
`TECH PARTIAL`, `TECH MISSING`, `TECH NOT EVIDENCED`, `NO TECH COMPONENT`) describing the technical part of
any control, whatever its kind.

---

## 5. Readiness counts (computed from `CKAM_ISO27001_CONTROL_MATRIX.csv`)

Counts were produced by the update script and re-checked by the converter (section 14). Production view:
`READY IN CODE — NOT DEPLOYED` is counted as PARTIAL; the number in brackets says how many of the PARTIAL
controls are in that state.

### 5.1 By control kind (new, 2026-10-16)

| Kind | Controls | READY | PARTIAL (of which READY IN CODE — NOT DEPLOYED) | MISSING | NOT EVIDENCED | N/A |
|---|---|---|---|---|---|---|
| TECHNICAL | 31 | 4 | 20 (1) | 1 | 5 | 1 |
| PROCESS | 27 | 1 | 19 (0) | 6 | 1 | 0 |
| ORGANISATIONAL | 21 | 0 | 4 (0) | 5 | 12 | 0 |
| PHYSICAL | 14 | 0 | 0 (0) | 1 | 13 | 0 |
| **Total** | **93** | **5** | **43 (1)** | **13** | **31** | **1** |

- **TECHNICAL READY (4):** A.8.11 data masking, A.8.28 secure coding, A.8.29 security testing, A.8.31
  environment separation. **READY IN CODE — NOT DEPLOYED (1):** A.8.3 information access restriction (AC-1,
  AC-2, IF-03 fixed and retested three times; production `3b5e842` still lacks them). TECHNICAL MISSING:
  A.8.14 redundancy. TECHNICAL NOT EVIDENCED: A.8.1, A.8.4, A.8.17, A.8.18, A.8.22.
- **PROCESS READY (1):** A.8.34 protection of systems during audit testing. PROCESS MISSING (6): A.5.7 threat
  intelligence, A.5.13 labelling, A.5.24 incident planning, A.5.25 event assessment, A.5.26 incident response
  (IF-01 not contained), A.5.29 security during disruption. Each of these has a DRAFT document; none operates.
- **ORGANISATIONAL:** nothing READY; MISSING A.5.1 policies, A.5.12 classification, A.5.19 supplier security,
  A.5.35 independent review, A.6.7 remote working; 12 NOT EVIDENCED (mostly HR and legal, inherited).
- **PHYSICAL:** 13 NOT EVIDENCED (inherited, not seen) and A.7.10 storage media MISSING (unencrypted backups).

**Why the technical figures hardly move although the code is much stronger.** The closure fixed the code side
of many controls, but almost every technical control also needs something outside the code (deployment,
HTTPS, the DB role split run by a DBA, the service account, off-server backups, alerting). Only A.8.3 had
deployment as its *only* missing piece. Section 5.4 shows the technical-component tags, which did not change
either, for the same reason.

### 5.2 By ISO theme (kept for comparison with v1.0)

| Theme | Controls | READY | PARTIAL (of which RIC) | MISSING | NOT EVIDENCED | N/A |
|---|---|---|---|---|---|---|
| A.5 Organizational | 37 | 0 | 19 (0) | 10 | 8 | 0 |
| A.6 People | 8 | 0 | 2 (0) | 1 | 5 | 0 |
| A.7 Physical | 14 | 0 | 0 (0) | 1 | 13 | 0 |
| A.8 Technological | 34 | 5 | 22 (1) | 1 | 5 | 1 |
| **Total** | **93** | **5** | **43 (1)** | **13** | **31** | **1** |

### 5.3 What changed against v1.0 (2026-10-15)

| Control | v1.0 | v1.1 | Why |
|---|---|---|---|
| A.8.3 | PARTIAL | READY IN CODE — NOT DEPLOYED (counts as PARTIAL) | Only deployment remains; retested in closure retests 1 and 2 |
| All other 92 | unchanged | unchanged | Evidence and gap text updated (closure fixes, retests, draft policies), but each still has a non-deployment gap or no new evidence |

Totals are therefore unchanged in the production view (5 / 43 / 13 / 31 / 1). Applicability is unchanged:
89 YES, 3 PARTIAL (A.5.23, A.8.11, A.8.30), 1 NO (A.8.23).

### 5.4 Technical component per kind (tag at the start of `Technical Control`)

| Kind | TECH READY | TECH PARTIAL | TECH MISSING | TECH NOT EVIDENCED | No technical component |
|---|---|---|---|---|---|
| TECHNICAL | 6 | 18 | 1 | 5 | 1 (A.8.23 N/A) |
| PROCESS | 4 | 19 | 1 | 0 | 3 |
| ORGANISATIONAL | 1 | 3 | 1 | 0 | 16 |
| PHYSICAL | 0 | 4 | 1 | 0 | 9 |
| **Total** | **11** | **44** | **4** | **5** | **29** |

---

## 6. Findings that drive this assessment (status per the 2026-10-16 fact sheet)

The authoritative lists are `CKAM_SECURITY_CLOSURE_REGISTER.md` and `CKAM_SECURITY_FINDINGS_REGISTER.md`
(separate writer). Status words: `FIXED` = fixed in a local commit and retested, **not pushed, not deployed**;
`MITIGATED`; `ACCEPTED`; `OPEN EXTERNAL`; `OPEN DECISION`.

| ID | Severity | Plain description | Status 2026-10-16 | Commit / action |
|---|---|---|---|---|
| IF-01 (= IN-01) + IF-01-WIN | **CRITICAL** | `/assets/...` served files outside the frontend folder on the single-port server; Windows path forms (backslash, drive, UNC, ADS, device names) | Code **FIXED** (lexical refusal before any filesystem call, then containment); native Windows test 0 of 28 leaks. **Production: STILL EXPOSED** (since 2026-09-30) | `3e134c1`, `7b039fb`; EXT-41, EXT-39, EXT-01, EXT-38, EXT-02, EXT-03 |
| CL2-IF-04 | Functional, high value | `/assets/<id>` (the Asset 360 page a QR label opens) and `/assets/new` returned JSON 404 in single-port mode; **also in production `3b5e842`** | Code FIXED; production broken until deploy | `ca94574`; EXT-44 |
| IF-02 / AU-13 | HIGH | Login and all traffic over plain HTTP, also from the internet | OPEN EXTERNAL (owner deferred HTTPS 2026-10-08) | EXT-04, EXT-05 |
| IF-03 | MEDIUM | Other company's ERP PO draft readable | FIXED | `7e57844` |
| IF-04 / AU-09, N4, CL1-N4-01 | MEDIUM / LOW | Weak secret / unknown or **unset** `ENVIRONMENT_NAME` | FIXED (unset now = production, fails closed; refusal names both secret rules) | `7e57844`, `d04779a`, `7b039fb` |
| IF-05 / AU-10, IF-06 | MEDIUM | Audit tables TRUNCATE; owner/superuser can bypass triggers | Code side CLOSED (TRUNCATE guards, 5-year purge floor); **role split needs a DBA** (scripts, runbook, local proof ready) | `ae706bb`, `734fd19`; EXT-07, EXT-45, EXT-46 |
| CL2-IF-01 | MEDIUM | First role-split script gave the runtime role UPDATE on sequences (`setval` could break audit/ledger ids) | FIXED in the script (USAGE, SELECT only) + checks; production DBA must run the **updated** scripts | `ca94574`; EXT-45 |
| CL2-IF-02 | LOW | Runtime role could set its own `default_transaction_read_only` | FIXED (`RESET ALL` + detection) | `ca94574`; EXT-45 |
| IF-07 | MEDIUM | Service runs as SYSTEM on a shared server | OPEN EXTERNAL (plan prepared) | EXT-06 |
| IF-08 | MEDIUM | Backups on the DB server, unencrypted, no restore test | OPEN EXTERNAL (plan prepared) | EXT-08 |
| IF-09 | MEDIUM | Dev PC `.env` and `backups\` readable too widely | OPEN EXTERNAL (ACL plan prepared, NOTHING CHANGED on the PC) | EXT-10 |
| IF-10 | MEDIUM | ERP reads without timeouts | FIXED | `ae706bb` |
| AU-01, AU-03, AU-05, AU-07, AU-08, AU-16 | MEDIUM / LOW | Timing, rate limit, revocation, password policy, lock-out race | FIXED | `ae706bb`, `d04779a`, `7b039fb` |
| AU-06 | LOW | Rotated refresh token stayed valid | FIXED (server-side `auth_session`, SHA-256 of the token id only, rotate once, 10 s grace, reuse ends every session + REFRESH_REUSE row) | `69c3a51` |
| OBS-TV | OBS | Session version increment not atomic | FIXED (atomic `UPDATE … RETURNING` at 9 sites) | `69c3a51` |
| OBS-STATUS | OBS | `asset.status` / holder / date had no DB guard | FIXED (trigger; honest limit: the marker can be set by anyone with SQL as the app role) | `734fd19` |
| AU-04 | MEDIUM | Known-user lock-out DoS | OPEN DECISION (options A / B / C, recommendation C) | SD-06 in `CKAM_SECURITY_DECISIONS_REQUIRED.md`; `evidence/closure/backend/AU-04_OPTIONS.md` |
| AU-02 | LOW | Locked account answers 423 | ACCEPTED (any password, not a guessing oracle) | — |
| AC-1, AC-2, Login clash | MEDIUM / LOW | Setup lists, custom fields, employee code vs owner login | FIXED | `77431ba` |
| RACE-1 + CL2-SE-N01/N03 | LOW | Same-name vendor/brand; category/sub-category names; same-serial race message | FIXED (also in Excel imports) | `da790d1`, `7b039fb`, `fafa225` |
| IN-02, IN-03, N1 | LOW / INFO | Import size, content check, request-size limits | FIXED | `ba04371`, `ae706bb`, `d04779a` |
| IF-11 | LOW | No Python lock file | FIXED in code (`backend/constraints.txt`); production install must use it | EXT-12 |
| IF-12 | LOW | python-jose / ecdsa advisories (no fixed versions) | ACCEPTED (not reachable); PyJWT replacement recommended | EXT-47 |
| IF-13 | LOW | Containers ran as root with dev tooling | FIXED (uid 10001, `runtime` target, `volume-init`, capabilities dropped, tmpfs `/tmp`) | `79dbae7` |
| IF-14 / AU-11, N6 | LOW | `/docs`, `/openapi.json`; unknown `/api` paths | FIXED (off in production; JSON 404) | `ae706bb`, `7b039fb`, `b401e9f` |
| IF-15 | LOW | Production launcher/release script not in git | Code/reference side FIXED (`ops/windows/` templates); **live launcher still not in git** | `79dbae7`; EXT-13 |
| IF-16 | LOW | ERP connection without TLS | Code side FIXED (`PO_SOURCE_SSLMODE`, default `prefer`, TLS not mandatory); ERP owner must confirm | `7b039fb`; EXT-25 |
| N2 | LOW | uvicorn trusted `X-Forwarded-For` | Code side FIXED (`--no-proxy-headers` in every repository launch path); production launcher still needs it | `a3e8fce`, `79dbae7`; EXT-38 |
| N3, N5, CL2-IF-03, banner | LOW / INFO | nginx forwarded address; headers twice; X-Request-ID; server banner | FIXED | `79dbae7`, `ca94574` |
| AU-12, AU-14, AU-15, FONTS | LOW | Source maps, CSP, banner, Google Fonts | FIXED (self-hosted fonts, CSP `'self'`, permanent build checks) | `4fa5c9b`, `79dbae7`, `b401e9f` |
| IF-17 | INFO | No CI / pre-commit; unsigned commits; single author | OPEN (process) | EXT-28 |
| D6, MFA, store logins, per-office NAT limit, audit retention vs privacy law, absolute session lifetime | INFO / decision | Owner decisions | OPEN DECISION | EXT-26, EXT-19, EXT-30, EXT-49, EXT-31, EXT-50 (SD-02, SD-03, SD-07, SD-08, SD-09, SD-14) |
| OBS-NPM-DEV, polyglot document | INFO | Dev-only HIGH in a build tool; PDF-header + HTML body accepted but served as attachment + nosniff | ACCEPTED / INFO | — |
| Audit-failure count on screen | INFO | Logs > Diagnostics does not show the audit-failure count yet (function exists) | OPEN (small follow-up) | EXT-48 covers alerting |

**Positive evidence (final local regression at `fd34520`):** backend **2541 passed, 1 skipped**; frontend `tsc`
clean, **1257** vitest tests in 92 files, `npm run build` and `npm run check:build` OK (0 `.map` files, no Google
host, no external resource); Playwright permanent journeys **11 passed, 1 skipped** (ERP link off on the test
stack); security journeys **14/14**. Closure retest 1: 137 cases (133 PASS; the one FAIL, CL1-N4-01, is now
fixed). Retest 2 on the final code: access 319 cases (318 PASS, 1 OBS), infra 122 (4 new findings, all fixed in
WP-F), sessions + concurrency burst 56 (all PASS). Performance: 31 operations, none over threshold. SQL
injection, XSS, formula injection, SSRF and command injection held throughout.

---

## 7. Evidence pointers (short list; full list in `CKAM_SECURITY_EVIDENCE_INDEX.md`)

| Area | File |
|---|---|
| Closure status and handover | `docs/security/CKAM_SECURITY_CLOSURE_REGISTER.md`, `docs/security/CKAM_SECURITY_MASTER_HANDOVER.md` (separate writer) |
| Original VAPT evidence | `docs/security/evidence/access/`, `auth/`, `input/`, `infra/` |
| Closure evidence | `docs/security/evidence/closure/` (`backend/`, `db/`, `infra/`, `retest1/`, `retest2/{access,infra,sessions}/`, `perf/`, `windows/`, `wpf/`, `docs/`) |
| Database least privilege | `ops/db/role_split.sql`, `role_split_verify.sql`, `check_least_privilege.sql`, `ROLE_SPLIT_RUNBOOK.md`; `docs/security/evidence/closure/db/WPB_RESULTS.md`; `backend/tests/security/test_least_privilege_role_split.py` |
| Windows production reference scripts | `ops/windows/` (README and templates; never run on the server) |
| Production procedures (prepared, not executed) | `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`, `CKAM_HTTPS_IMPLEMENTATION_PLAN.md`, `CKAM_SERVICE_ACCOUNT_PLAN.md`, `CKAM_BACKUP_RESTORE_PLAN.md` |
| Draft policy pack | `docs/security/policies/` (README, 01–15, `templates/`) — DRAFT — MANAGEMENT APPROVAL REQUIRED |
| Owner decisions needed | `docs/security/CKAM_SECURITY_DECISIONS_REQUIRED.md` (SD-01 … SD-16) |
| Logging design | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` |
| Production layout | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` |

---

## 8. Main gaps (summary, 2026-10-16)

| # | Gap | Kind | Type | Action |
|---|---|---|---|---|
| 1 | IF-01 and the QR deep-link bug live in production; secrets possibly exposed; none of the 21 security commits deployed | TECHNICAL | OPEN EXTERNAL / INFRASTRUCTURE ACTION | EXT-41, EXT-39, EXT-01, EXT-44, EXT-38, EXT-02, EXT-43, EXT-03, EXT-42 |
| 2 | No encryption in transit; port 3211 forwarded from the internet | TECHNICAL | OPEN EXTERNAL | EXT-04, EXT-05 |
| 3 | Backups single-location, unencrypted, never restored in production | TECHNICAL / PHYSICAL | OPEN EXTERNAL | EXT-08 |
| 4 | Service as SYSTEM; runtime DB role owns the tables (role split ready but not run) | TECHNICAL | OPEN EXTERNAL | EXT-06, EXT-07, EXT-45, EXT-46 |
| 5 | Policies only DRAFT; no roles appointed; risk register not owned | ORGANISATIONAL | ORGANIZATIONAL / PROCESS GAP | EXT-17, EXT-36 |
| 6 | No access review, no MFA decision, D6 open, store-login rule open | PROCESS / ORGANISATIONAL | ORGANIZATIONAL / PROCESS GAP | EXT-18, EXT-19, EXT-26, EXT-30 |
| 7 | No incident plan in operation, no monitoring/alerting (incl. on audit-write failures and refresh-token reuse) | PROCESS | ORGANIZATIONAL / PROCESS GAP + infrastructure | EXT-20, EXT-22, EXT-48 |
| 8 | No change records, no CI, live launcher outside git, constraints not used in production | PROCESS | ORGANIZATIONAL / PROCESS GAP | EXT-12, EXT-13, EXT-28, EXT-35, EXT-42 |
| 9 | Patching, AV/EDR, physical security, HR controls not evidenced | PHYSICAL / ORGANISATIONAL | NOT EVIDENCED (inherited) | EXT-09, EXT-32, EXT-37 |
| 10 | No independent review (all testing so far internal) | ORGANISATIONAL | ORGANIZATIONAL / PROCESS GAP | EXT-14, EXT-36 |
| 11 | Log retention (180 days) shorter than an audit observation period; no off-server log copy | TECHNICAL / PROCESS | OPEN EXTERNAL | EXT-21 |

---

## 9. CKAM information-security risk register (draft, re-scored 2026-10-16; needs an owner and management approval)

Scales: **Likelihood (L)** 1 rare … 5 almost certain. **Impact (I)** 1 negligible … 5 severe. **Risk = L x I.**
Bands: 1-4 Low, 5-9 Medium, 10-16 High, 20-25 Critical.

Columns:
- **L, I, Today** describe **production today** (release `3b5e842`, nothing of the programme deployed). They
  are unchanged from v1.0 for R-01 … R-33 because nothing was deployed; this is deliberate honesty, not an
  oversight.
- **After deploy** = expected score once the local code `fd34520` is deployed correctly (runbook phases 1–7:
  migrations, launcher flags, constraints, verification) **but before any other external action** (no secret
  rotation, no HTTPS, no service account, no role split, no backups). This is the re-score of the closure.
- **Residual** = expected score after the full listed treatment.
- *(code, not deployed)* marks controls that exist only in local commits.
- R-34 … R-37 are risks **created by the new controls**; they do not exist in production today and are scored
  for the state in which they appear (marked).

| ID | Risk (plain words) | Linked | L | I | Today | Existing controls | Treatment | Owner | After deploy | Residual |
|---|---|---|---|---|---|---|---|---|---|---|
| R-01 | Passwords and sessions cross the internet unencrypted | IF-02, AU-13 | 4 | 4 | **16 High** | Argon2id; HttpOnly SameSite cookie; 15-min access token | HTTPS, `COOKIE_SECURE`, later HSTS (EXT-04) | IT/Infra | 16 High (deploy does not fix it) | 1x4 = 4 Low |
| R-02 | Anyone on the internet reads files from the production server (IF-01) | IF-01, IF-01-WIN | 5 | 5 | **25 Critical** | Fix incl. Windows forms retested, native Windows 0/28 *(code, not deployed)* | Deploy (EXT-41, EXT-39, EXT-01, EXT-38), assess logs (EXT-03) | CKAM owner + IT | 1x5 = 5 Medium | 1x5 = 5 Medium |
| R-03 | Production secrets compromised (JWT secret forges any admin; DB, NAS, ERP passwords) | IF-01, IF-04 | 4 | 5 | **20 Critical** | Secret files Administrators/SYSTEM only; redaction; weak-secret refusal *(code, not deployed)* | Rotate everything after the fix (EXT-02, EXT-43); password manager (EXT-23) | IT/Infra | **20 Critical** (stays until rotation) | 1x5 = 5 Medium |
| R-04 | Misuse of a privileged CKAM account | D6, MFA | 3 | 4 | **12 High** | Head-office-only actions; grants audited; sessions end on role change *(code)* | MFA (EXT-19), D6 (EXT-26), access review (EXT-18), alerting (EXT-22) | CKAM owner | 12 High | 2x4 = 8 Medium |
| R-05 | Account takeover by password guessing from the internet | AU-01, AU-03, AU-08, AU-16 | 4 | 4 | **16 High** | Lockout; generic 401; rate limit, constant-time sign-in, policy *(code)* | Deploy; VPN or HTTPS proxy; MFA for admins | Dev lead | 2x4 = 8 Medium | 2x4 = 8 Medium |
| R-06 | A weakness in another app on the shared servers reaches CKAM | IF-07 | 3 | 4 | **12 High** | Separate folder, task, DB role, NAS folder; `pg_hba` /32 | Per-app service accounts; separation (EXT-06, EXT-24, EXT-43) | IT/Infra | 12 High | 2x4 = 8 Medium |
| R-07 | CKAM runs as SYSTEM, so any CKAM flaw becomes full control of the server | IF-07 | 3 | 5 | **15 High** | None specific | Low-privilege service account (EXT-06) | IT/Infra | 15 High | 2x3 = 6 Medium |
| R-08 | ERP credential leakage or ERP link misuse | IF-16, IF-10 | 2 | 4 | **8 Medium** | Read-only role; read-only transactions; SELECT-only code; timeouts and TLS option *(code)* | SELECT-only grant + mandatory TLS on the ERP side (EXT-25) | ERP owner + Dev lead | 8 Medium (TLS not mandatory) | 1x4 = 4 Low |
| R-09 | Unauthorised or fraudulent asset movement | OBS-STATUS | 3 | 3 | **9 Medium** | RBAC + work area; single writer; append-only ledger; DB guard on status/holder *(code)* | Periodic movement review and physical verification | CKAM owner | 9 Medium | 2x3 = 6 Medium |
| R-10 | Data of another company or work area exposed | IF-03, AC-1, AC-2 | 3 | 3 | **9 Medium** | 0 escalations in 3,038 access cells *(code)* | Deploy; cross-company test on every new route | Dev lead | 1x3 = 3 Low | 1x3 = 3 Low |
| R-11 | Personal data leak through exports, logs or backups | AC-1 | 3 | 3 | **9 Medium** | Logs head-office-only; redaction; exports audited; self-hosted fonts *(code)* | Classification, encrypted backups, export rules, legal review (EXT-31) | ISMS lead | 9 Medium | 2x3 = 6 Medium |
| R-12 | Audit trail tampered with by the DB owner or superuser | IF-05, IF-06 | 2 | 4 | **8 Medium** | Row triggers; TRUNCATE guards; 5-year purge floor *(code)*; role split proven locally | Role split with the updated scripts (EXT-07, EXT-45, EXT-46); off-server log copy (EXT-21) | DBA | 8 Medium (owner still = runtime role) | 1x4 = 4 Low |
| R-13 | Data loss: backups only on the DB server, unencrypted, never restored | IF-08 | 3 | 5 | **15 High** | Daily dump, 30 days | Off-server encrypted + offline copy, quarterly restore test, NAS backup (EXT-08) | IT/Infra | 15 High | 1x5 = 5 Medium |
| R-14 | Ransomware encrypts app server, DB server or NAS | IF-07, IF-08 | 3 | 5 | **15 High** | NOT EVIDENCED | Offline/immutable backup, EDR, patching, least privilege (EXT-08, EXT-09, EXT-37) | IT/Infra | 15 High | 2x4 = 8 Medium |
| R-15 | Vulnerable third-party package | IF-11, IF-12, IF-13 | 3 | 3 | **9 Medium** | npm production 0; HS256 pinned; constraints file; non-root containers (dev) | Constrained install (EXT-12); monthly audits; PyJWT replacement (EXT-47) | Dev lead | 2x3 = 6 Medium | 2x2 = 4 Low |
| R-16 | A user is given the wrong company, work area or access level | — | 3 | 3 | **9 Medium** | Limited Full Admin cannot widen others; ACCESS_CHANGED audited | Quarterly access review (EXT-18) | CKAM owner | 9 Medium | 2x2 = 4 Low |
| R-17 | Unpatched Windows, Python, PostgreSQL or NAS firmware | — | 3 | 4 | **12 High** | NOT EVIDENCED | Patch policy and records (EXT-09) | IT/Infra | 12 High | 2x3 = 6 Medium |
| R-18 | Port 3211 forwarded from the internet: scanning, exploitation, brute force, DoS | IF-01, IF-02, AU-03 | 5 | 4 | **20 Critical** | Firewall rule; lockout; rate limit *(code)* | Close/restrict the forward (EXT-05); HTTPS (EXT-04) | IT/Infra | 4x3 = 12 High | 2x3 = 6 Medium |
| R-19 | A session keeps working after logout, deactivation or token theft | AU-05, AU-06, AU-07 | 2 | 3 | **6 Medium** | 15-min access token; deactivation; `token_version`; refresh reuse detection *(code)* | Deploy (EXT-01); absolute lifetime decision (EXT-50) | Dev lead | 1x3 = 3 Low | 1x3 = 3 Low |
| R-20 | Information that helps an attacker is exposed (docs, source maps, banners) | IF-14, AU-11, AU-12, AU-15 | 3 | 2 | **6 Medium** | Docs off + JSON 404, no source maps, no banner, CSP *(code)* | Deploy (EXT-01, EXT-38 for the banner flag) | Dev lead | 1x2 = 2 Low | 1x2 = 2 Low |
| R-21 | Denial of service (lock-out DoS, oversized requests, ERP hangs) | AU-04, IN-02, N1, IF-10 | 3 | 3 | **9 Medium** | Size limits, rate limit, ERP timeouts *(code)*; AU-04 residual | Deploy; AU-04 decision; monitor 429s and lock-outs (EXT-22) | Dev lead | 2x3 = 6 Medium | 2x2 = 4 Low |
| R-22 | Malicious file uploaded as an asset document | IN-03 | 2 | 2 | **4 Low** | Allowlist, size cap, attachment + nosniff; signature check *(code)* | AV scan (EXT-37) | Dev lead | 1x2 = 2 Low | 1x2 = 2 Low |
| R-23 | A change breaks security or production (no CI, live launcher outside git, manual steps, new code refuses to start on wrong settings) | IF-15, IF-17 | 3 | 4 | **12 High** | Owner approves push and deploy; backup first; reference scripts in `ops/windows`; runbook prepared | Prechecks (EXT-39); live launcher in git (EXT-13); change records (EXT-35, EXT-42); CI (EXT-28) | Dev lead | 12 High | 2x3 = 6 Medium |
| R-24 | Key-person dependency (one developer, one owner) | IF-17 | 3 | 4 | **12 High** | Docs in `docs/ai/` and `docs/security/` | Second trained admin; vault with break-glass (EXT-23); RACI | Management | 12 High | 2x3 = 6 Medium |
| R-25 | Dev PC compromise exposes dev `.env`, old dumps and real ERP copy | IF-09 | 3 | 3 | **9 Medium** | `.env` and `backups/` gitignored; ACL plan prepared (nothing changed) | ACL, disk encryption, purge old dumps (EXT-10) | Dev lead | 9 Medium | 1x3 = 3 Low |
| R-26 | Source repository not under company control | IF-17 | 2 | 3 | **6 Medium** | No secrets in history (regex scan, 299+ commits) | Company-owned repo, MFA, branch protection (EXT-28) | Management | 6 Medium | 1x2 = 2 Low |
| R-27 | A security incident goes unnoticed (no alerts) | — | 4 | 3 | **12 High** | Rows in `audit_log`, `error_log`, `system_event`; more security events *(code)* | Alerting and weekly review (EXT-22, EXT-48) | IT/Infra | 12 High | 2x3 = 6 Medium |
| R-28 | Physical loss or damage of servers or NAS | — | 2 | 5 | **10 High** | NOT EVIDENCED | Server-room check; off-site backup (EXT-08, EXT-29) | Facilities + IT | 10 High | 1x5 = 5 Medium |
| R-29 | Fonts from Google send staff IP addresses to a third party | FONTS | 3 | 1 | **3 Low** | Self-hosted fonts, CSP `'self'` *(code)* | Deploy | Dev lead | 1x1 = 1 Low | 1x1 = 1 Low |
| R-30 | Shared store logins: actions cannot be tied to a person | — | 4 | 2 | **8 Medium** | One login per store; actions audited per login | Store-login rule or named logins (EXT-30) | CKAM owner + HR | 8 Medium | 2x2 = 4 Low |
| R-31 | Non-compliance with law (personal data, incident reporting, record keeping) | — | 3 | 3 | **9 Medium** | NOT EVIDENCED | Legal review (EXT-31) | Legal | 9 Medium | 2x2 = 4 Low |
| R-32 | Forged client address via `X-Forwarded-For` (N2) | N2, N3 | 2 | 2 | **4 Low** | App trusts only `TRUSTED_PROXIES`; repository launch paths use `--no-proxy-headers` *(code)* | Production launcher flag (EXT-38) | IT/Infra | 1x2 = 2 Low | 1x2 = 2 Low |
| R-33 | Many users behind one NAT address share the sign-in limit (20/min per address) and are refused at busy times | AU-03 | 2 | 2 | **4 Low** *(applies after deploy)* | Per-address and per-login-id limits; 429 with a plain message *(code)* | Watch 429s (EXT-40); per-office NAT policy (EXT-49) | IT + Dev lead | 4 Low | 1x2 = 2 Low |
| R-34 | **New control residual:** refresh-token reuse grace window — a stolen refresh cookie used within 10 s of the real rotation is accepted once as a duplicate | AU-06 | 1 | 3 | **3 Low** *(after deploy)* | REFRESH_DUPLICATE row; access token 15 min; `REFRESH_REUSE_GRACE_SECONDS=0` makes it strict | Keep the window small; alert on REFRESH_DUPLICATE bursts (EXT-48); HTTPS (EXT-04) | Dev lead | 3 Low | 1x2 = 2 Low |
| R-35 | **New control residual:** after the role split the owner/migrator credential becomes the key that can change triggers; if it is kept in `shared\.env` or reused, the split protects nothing | IF-05, IF-06 | 2 | 4 | **8 Medium** *(after EXT-07)* | Runbook keeps the migrator separate (`ALEMBIC_SET_ROLE`); runtime role refuses 40/40 forbidden actions (local proof) | Migrator password only in the vault (EXT-23), used only during deploys; `check_least_privilege.sql` after every deploy (EXT-46) | DBA | n/a (needs EXT-07) | 1x4 = 4 Low |
| R-36 | **New control residual:** the lifecycle-field DB guard is marker-based; anyone who can run SQL as the app role can set the marker and change `asset.status` | OBS-STATUS | 1 | 3 | **3 Low** *(after deploy)* | Guard is defence in depth; app code is the only writer; append-only ledger shows the change | Role split (EXT-07) so ad-hoc SQL does not run as the app role; integrity check against `asset_event` | Dev lead + DBA | 3 Low | 1x2 = 2 Low |
| R-37 | **New control residual:** role-split drift — running an older script version (UPDATE on sequences, CL2-IF-01) or a later grant/setting change lets the runtime role break audit/ledger id sequences or make the DB read-only | CL2-IF-01, CL2-IF-02 | 2 | 3 | **6 Medium** *(at EXT-07)* | Updated scripts (USAGE/SELECT only, `RESET ALL`); 34 least-privilege checks | Run only the current `ops/db` scripts (EXT-45); re-run `check_least_privilege.sql` after every deploy (EXT-46) | DBA | n/a (needs EXT-07) | 1x3 = 3 Low |
| R-38 | No absolute session lifetime: a refresh chain that keeps being used can stay signed in indefinitely | — | 2 | 3 | **6 Medium** | 8-hour refresh, rotation; revocation on rights change | Owner decision on an absolute lifetime (EXT-50) | Management + Dev | 6 Medium | 1x3 = 3 Low |
| R-39 | QR labels do not open the asset in production (CL2-IF-04), so scanning for verification fails | CL2-IF-04 | 5 | 2 | **10 High** | Fixed in code (`ca94574`), native Windows check 200 | Deploy (EXT-44 with EXT-01) | Dev lead + IT | 1x2 = 2 Low | 1x2 = 2 Low |
| R-40 | A failure to write audit rows goes unnoticed | — | 2 | 3 | **6 Medium** | Failures now reported once a minute with a count *(code)*; no alert | Alert on `log_write_failed` (EXT-48); show the count on Diagnostics | Dev lead + IT | 6 Medium | 1x3 = 3 Low |

**Risk summary (40 risks; counted from the table).**
- **Production today** (36 risks that exist today: R-01 … R-33, R-38, R-39, R-40): **3 Critical** (R-02, R-03,
  R-18), **13 High** (R-01, R-04, R-05, R-06, R-07, R-13, R-14, R-17, R-23, R-24, R-27, R-28, R-39), **16 Medium**,
  **4 Low**. v1.0 had 33 risks: 3 Critical, 12 High, 14 Medium, 4 Low; the change is only the three added
  production risks (R-38, R-39, R-40). IF-01, plain HTTP, the SYSTEM service and the backups stay High or
  Critical **until the external actions happen**.
- **After deploy only** (38 risks; R-35 and R-37 need EXT-07 first): **1 Critical** (R-03, until the secrets are
  rotated), **12 High** (R-01, R-04, R-06, R-07, R-13, R-14, R-17, R-18, R-23, R-24, R-27, R-28), **15 Medium**,
  **10 Low**. Deploying alone removes two Criticals (R-02 to Medium, R-18 to High); rotation (EXT-02) removes the
  last one.
- **New-control residuals** (R-34 … R-37): 2 Low, 2 Medium. They are the price of the new controls and are
  small compared with what the controls remove.
- After the full listed treatment no risk stays above Medium (highest residual 8).

---

## 10. DRAFT readiness mapping for all 93 Annex A controls (this is NOT the Statement of Applicability)

A Statement of Applicability (SoA) is a formal ISMS document that management approves after the risk
assessment. The table below is only a **draft readiness mapping** to help write it; its working-draft copy
in the policy pack (`docs/security/policies/15_Statement_of_Applicability_Working_Draft.md`, separate writer)
was generated from the 2026-10-15 matrix and should be regenerated from the current CSV. "Treats R-xx" links
the control to the risk register above. "Draft policy" names the DRAFT document(s) in `docs/security/policies/`
(**DRAFT — MANAGEMENT APPROVAL REQUIRED**; never evidence). Full detail is in
`CKAM_ISO27001_CONTROL_MATRIX.csv` / `.xlsx`. The rows below were generated from the CSV, not typed by hand.

| Control | Title | Kind | Applicable | Reason | Current evidence | Gap | Draft policy (not evidence) | Status |
|---|---|---|---|---|---|---|---|---|
| A.5.1 | Policies for information security | ORGANISATIONAL | YES | Treats R-24 (High), R-31 (Medium) | CLAUDE.md; docs/ai/DEVELOPMENT_GUARDRAILS.md (engineering rules only); docs/security/CKAM_SECURITY_BASELINE.md (draft 2026-10-15); docs/security/policies/01_Information_Security_Policy.md and 14 further drafts (2026-10-16; DRAFT - MANAGEMENT APPROVAL REQUIRED; 0 approved, 0 operating; not evidence of operation) | Policy set exists only as DRAFT (15 documents, 0 approved, 0 communicated, 0 records); only the engineering guardrails operate | DRAFT 01 | **MISSING** |
| A.5.2 | Information security roles and responsibilities | ORGANISATIONAL | YES | Treats R-24 (High) | CLAUDE.md (owner approves every push and every deploy); docs/ai/CKAM_PRODUCTION_SERVER_CHECKLIST.md (backup, restore and rollback owners listed as Not yet assigned); docs/security/policies/01_Information_Security_Policy.md roles section (DRAFT) | Roles are described in a DRAFT only; no one is appointed; operational security roles unassigned | DRAFT 01 | **PARTIAL** |
| A.5.3 | Segregation of duties | ORGANISATIONAL | YES | Treats R-23 (High), R-24 (High) | backend/app/core/capabilities.py; docs/ai/DECISIONS.md 2026-10-14 entries (3),(5),(8); docs/security/evidence/access/tests.csv (17 escalation cases, 0 failures); docs/security/evidence/closure/retest2/access/RETEST2_ACCESS.md (217 routes x 14 identities = 3,038 cells, 0 escalations) | One person writes code, commits and (with owner approval) deploys; no independent code review (IF-17) | DRAFT 02, 04 | **PARTIAL** |
| A.5.4 | Management responsibilities | ORGANISATIONAL | YES | Treats R-24 (High) | NOT EVIDENCED | No evidence of management direction on information security | DRAFT 01, 14 | **NOT EVIDENCED** |
| A.5.5 | Contact with authorities | ORGANISATIONAL | YES | Treats R-31 (Medium) | NOT EVIDENCED | No authority contact list or reporting procedure | DRAFT 05 | **NOT EVIDENCED** |
| A.5.6 | Contact with special interest groups | PROCESS | YES | Treats R-15 (Medium), R-17 (High) | NOT EVIDENCED | No subscriptions evidenced | DRAFT 06 | **NOT EVIDENCED** |
| A.5.7 | Threat intelligence | PROCESS | YES | Treats R-15 (Medium) | docs/security/evidence/infra/dependency_audit.md; docs/security/evidence/infra/raw/pip_audit.json; docs/security/evidence/infra/raw/npm_audit_prod.json (one-off run 2026-10-15); docs/security/evidence/closure/backend/dependency_recheck.md; docs/security/evidence/closure/infra/npm_audit_recheck.md; docs/security/evidence/closure/retest2/infra/raw/pip_audit_constraints.txt (re-runs 2026-10-16); docs/security/policies/06_Vulnerability_Management_Procedure.md (DRAFT) | Only one-off scans (2026-10-15/16); the monthly advisory review exists only in DRAFT doc 06 and has never run | DRAFT 06 | **MISSING** |
| A.5.8 | Information security in project management | PROCESS | YES | Treats R-23 (High) | docs/ai/CKAM_SIMPLIFICATION_S0_REPORT.md (security fixes before redesign); docs/ai/AM-09_RC_FULL_AUDIT_REPORT.md; docs/ai/DECISIONS.md 2026-10-14 (1) guardrails; this VAPT evidence set; docs/security/CKAM_SECURITY_CLOSURE_REGISTER.md; docs/security/CKAM_SECURITY_DECISIONS_REQUIRED.md (closure programme 2026-10-16) | Security is applied by practice, not by a mandatory project step | DRAFT 04, 12 | **PARTIAL** |
| A.5.9 | Inventory of information and other associated assets | PROCESS | YES | Treats R-11 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (servers, folders, DB, NAS, task, firewall rule); docs/ai/ERP_INTEGRATION.md; docs/security/evidence/infra/raw/pip_freeze_image.txt; frontend/package-lock.json | No formal information-asset register with owners and classification | DRAFT 01, 12 | **PARTIAL** |
| A.5.10 | Acceptable use of information and other associated assets | ORGANISATIONAL | YES | Treats R-30 (Medium), R-11 (Medium) | NOT EVIDENCED | No acceptable-use policy evidenced | DRAFT 01, 10 | **NOT EVIDENCED** |
| A.5.11 | Return of assets | PROCESS | YES | Treats R-09 (Medium) | docs/ai/DECISIONS.md 2026-10-14 (9) (a person or place that still holds assets cannot be deactivated); Move screen Return to Stock Room (docs/ai/DECISIONS.md (10)) | Leaver process linking HR and CKAM not evidenced | DRAFT 03 | **PARTIAL** |
| A.5.12 | Classification of information | ORGANISATIONAL | YES | Treats R-11 (Medium) | NOT EVIDENCED (de facto: logs are head-office-admin only, docs/ai/LOGGING_AND_DIAGNOSTICS.md section 9) | No classification scheme | DRAFT 01 | **MISSING** |
| A.5.13 | Labelling of information | PROCESS | YES | Treats R-11 (Medium) | NOT EVIDENCED | Exports are unlabelled | DRAFT 01 | **MISSING** |
| A.5.14 | Information transfer | PROCESS | YES | Treats R-01 (High), R-11 (Medium) | docs/security/evidence/input/formula_export_cell.txt; docs/ai/LOGGING_AND_DIAGNOSTICS.md (EXPORT audit rows); docs/ai/PRODUCTION_INFRASTRUCTURE.md (plain HTTP) | Transfer over the internet is unencrypted; no transfer rules | DRAFT 01 | **PARTIAL** |
| A.5.15 | Access control | TECHNICAL | YES | Treats R-04 (High), R-10 (Medium) | docs/security/evidence/access/authz_matrix.csv (217 routes x 11 personas, zero escalation, also in the final retest); docs/security/evidence/access/tests.csv; backend/app/core/capabilities.py; backend/app/core/deps.py; docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md (AC-1, AC-2, IF-03 FIXED: commits 77431ba, 7e57844); docs/security/evidence/closure/retest2/access/authz_matrix.csv (second retest on the final code: 217 routes x 14 identities = 3,038 cells, 0 escalations); docs/security/policies/02_Access_Control_Policy.md (DRAFT) | Access-control policy is DRAFT only; D6 open; AC-1, AC-2, IF-03 fixes not deployed (production 3b5e842) | DRAFT 02 | **PARTIAL** |
| A.5.16 | Identity management | PROCESS | YES | Treats R-30 (Medium), R-16 (Medium) | docs/security/evidence/infra/db_02_triggers_constraints.out.txt (unique company+code and company+email); docs/ai/DECISIONS.md 2026-10-14 (9) store logins sm.<code>@citykartstores.com | No JML procedure; store logins are shared identities | DRAFT 02, 03 | **PARTIAL** |
| A.5.17 | Authentication information | TECHNICAL | YES | Treats R-05 (High), R-01 (High), R-03 (Critical) | docs/security/evidence/auth/tests.csv AU-T044..AU-T050 (Argon2id, temporary password shown once, must change at first sign-in) | Plaintext transport; server secrets handling not formalised; new policy not yet deployed | DRAFT 02 | **PARTIAL** |
| A.5.18 | Access rights | PROCESS | YES | Treats R-04 (High), R-16 (Medium) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (ACCESS_CHANGED, PRIMARY_OWNER_GRANTED/_REVOKED rows); GET /api/asset-users/export (docs/security/evidence/access/authz_matrix.csv); docs/security/policies/11_Periodic_Access_Review_Procedure.md and templates/access_review_record.md (DRAFT, never run) | No periodic access review; grants have no request/approval record | DRAFT 02, 03, 11 | **PARTIAL** |
| A.5.19 | Information security in supplier relationships | ORGANISATIONAL | YES | Treats R-26 (Medium), R-08 (Medium) | NOT EVIDENCED (suppliers in scope: ERP warehouse team, NAS, GitHub, AI coding assistant provider, Google Fonts, Python/npm ecosystems); docs/security/policies/09_Supplier_Security_Review.md (DRAFT); Google Fonts drops out of the supplier list once the self-hosted fonts (79dbae7) are deployed | No operating supplier security process (DRAFT doc 09 only) | DRAFT 09 | **MISSING** |
| A.5.20 | Addressing information security within supplier agreements | ORGANISATIONAL | YES | Treats R-26 (Medium) | NOT EVIDENCED | No agreements evidenced | DRAFT 09 | **NOT EVIDENCED** |
| A.5.21 | Managing information security in the ICT supply chain | PROCESS | YES | Treats R-15 (Medium) | frontend/package-lock.json; docs/security/evidence/infra/raw/npm_audit_prod.json (0 production vulnerabilities); docs/security/evidence/infra/dependency_audit.md; backend/pyproject.toml; backend/constraints.txt (IF-11 FIXED: file added in ae706bb); docs/security/evidence/closure/backend/dependency_recheck.md; docs/security/evidence/closure/retest2/infra/raw/pip_audit_constraints.txt; ops/windows/deploy_ckam.ps1.template (installs with -c constraints.txt; reference only) | Production deploy not yet wired to constraints.txt (the reference deploy script is, but has never run on 10.0.1.98: EXT-12, EXT-13); PyJWT migration open | DRAFT 06, 09 | **PARTIAL** |
| A.5.22 | Monitoring, review and change management of supplier services | PROCESS | YES | Treats R-08 (Medium) | docs/ai/ERP_INTEGRATION.md (sync_success / sync_failed system events; ERP data as of); docs/ai/LOGGING_AND_DIAGNOSTICS.md (diagnostics/health minutes since last ERP copy) | No scheduled review; grant-loss risk documented but not monitored | DRAFT 09 | **PARTIAL** |
| A.5.23 | Information security for use of cloud services | ORGANISATIONAL | PARTIAL | Treats R-26 (Medium), R-29 (Low) | git remote origin = GitHub (repository under a personal GitHub account); frontend/index.html loads Google Fonts; commits co-authored by an AI coding assistant; Fonts self-hosted in code (frontend/src/fonts.css, 79dbae7; CSP without Google hosts, b401e9f), not deployed: production 3b5e842 still loads Google Fonts | Repository ownership, visibility and MFA not evidenced; no cloud-use rules | DRAFT 09 | **NOT EVIDENCED** |
| A.5.24 | Information security incident management planning and preparation | PROCESS | YES | Treats R-27 (High), R-02 (Critical) | docs/ai/LOGGING_AND_DIAGNOSTICS.md section 1 (request id support workflow) and section 10 (playbook); frontend/src/features/support/report-problem-store.ts; docs/security/policies/05_Incident_Response_Plan.md and templates/incident_record.md (DRAFT); docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md (prepared, not executed) | Incident response plan exists only as DRAFT; never approved or exercised | DRAFT 05 | **MISSING** |
| A.5.25 | Assessment and decision on information security events | PROCESS | YES | Treats R-27 (High) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (error grouping by fingerprint; SECURITY rows); docs/security/policies/05_Incident_Response_Plan.md severity table (DRAFT) | Triage criteria exist only as DRAFT; no triage record | DRAFT 05 | **MISSING** |
| A.5.26 | Response to information security incidents | PROCESS | YES | Treats R-02 (Critical), R-03 (Critical) | NOT EVIDENCED (IF-01 response: fix in commit 3e134c1, retested; production deploy and secret rotation still pending); docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md (deploy, rotation and compromise-assessment phases prepared, NOT executed); docs/security/policies/05_Incident_Response_Plan.md (DRAFT) | IF-01 production exposure not contained (nothing deployed, no secret rotated, no compromise assessment, no incident record) | DRAFT 05 | **MISSING** |
| A.5.27 | Learning from information security incidents | PROCESS | YES | Treats R-23 (High) | docs/ai/REVIEW_FINDINGS.md; docs/ai/RC_ISSUES.md; docs/security/evidence/ (findings with regression tests); docs/security/CKAM_SECURITY_CLOSURE_REGISTER.md; docs/security/CKAM_SECURITY_BASELINE.md (closure lessons added 2026-10-16) | Lessons captured informally | DRAFT 05 | **PARTIAL** |
| A.5.28 | Collection of evidence | PROCESS | YES | Treats R-12 (Medium) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (audit_log append-only, request id, actor, IP; export as jsonl); docs/security/evidence/infra/db_03_append_only_privilege_tests.out.txt | Evidence integrity not protected against the DB owner; no off-server copy | DRAFT 05 | **PARTIAL** |
| A.5.29 | Information security during disruption | PROCESS | YES | Treats R-13 (High) | NOT EVIDENCED; docs/security/policies/08_Business_Continuity_and_DR_Plan.md (DRAFT) | Addressed only in a DRAFT plan; not approved or tested | DRAFT 08 | **MISSING** |
| A.5.30 | ICT readiness for business continuity | PROCESS | YES | Treats R-13 (High), R-14 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (daily dump 03:00, 30 days; previous releases kept for rollback; scheduled task restarts every minute); docs/security/CKAM_BACKUP_RESTORE_PLAN.md (prepared); docs/security/policies/07_Backup_Restore_Policy.md and 08 (DRAFT) | No agreed recovery objectives; never restored in production | DRAFT 08 | **PARTIAL** |
| A.5.31 | Legal, statutory, regulatory and contractual requirements | ORGANISATIONAL | YES | Treats R-31 (Medium) | NOT EVIDENCED | No legal register | DRAFT 01, 12 | **NOT EVIDENCED** |
| A.5.32 | Intellectual property rights | ORGANISATIONAL | YES | Treats R-15 (Medium) | frontend/package-lock.json and docs/security/evidence/infra/raw/pip_freeze_image.txt list components; licences not reviewed | Licences not reviewed | DRAFT 06, 09 | **NOT EVIDENCED** |
| A.5.33 | Protection of records | TECHNICAL | YES | Treats R-12 (Medium), R-13 (High) | docs/security/evidence/infra/db_02_triggers_constraints.out.txt (9 append-only / identity triggers); docs/security/evidence/auth/tests.csv AU-T091..AU-T093; CLAUDE.md rule 2 (no hard deletes); migration backend/app/alembic/versions/c6e8a0b2d4f6_asset_lifecycle_fields_guard.py; backend/tests/lifecycle/test_obs_status_guard.py; docs/security/evidence/closure/db/WPB_RESULTS.md | Owner/superuser can still destroy records; backups not off-server | DRAFT 07 | **PARTIAL** |
| A.5.34 | Privacy and protection of personal identifiable information (PII) | ORGANISATIONAL | YES | Treats R-11 (Medium), R-31 (Medium) | docs/ai/LOGGING_AND_DIAGNOSTICS.md section 3 (redaction) and section 9 (privacy notes); backend/app/observability/redact.py; docs/security/evidence/auth/tests.csv AU-T049 | No privacy notice or PII retention rule | DRAFT 01 | **PARTIAL** |
| A.5.35 | Independent review of information security | ORGANISATIONAL | YES | Treats R-23 (High) | docs/security/evidence/ (internal VAPT 2026-10-15 by the engineering team, not independent); Closure retests 1 and 2 (docs/security/evidence/closure/retest1, retest2) were run by testers separate from the fixers but inside the same engineering programme: not independent in the ISO sense | No independent review | DRAFT 13 | **MISSING** |
| A.5.36 | Compliance with policies, rules and standards for information security | ORGANISATIONAL | YES | Treats R-23 (High) | backend/tests/observability/test_coverage_walker.py (fails on any unclassified write route); backend/tests/conftest.py (refuses tests on the plain ckam DB); docs/ai/DEVELOPMENT_GUARDRAILS.md security rules; backend/tests/security/test_least_privilege_role_split.py; frontend/scripts/check-build-security.mjs; frontend/scripts/check-nginx-live.mjs; frontend/src/security/nginx-config.test.ts; ops/db/check_least_privilege.sql | Policies to comply with do not exist yet | DRAFT 13 | **PARTIAL** |
| A.5.37 | Documented operating procedures | PROCESS | YES | Treats R-23 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md; docs/ai/LOGGING_AND_DIAGNOSTICS.md; docs/ai/CKAM_RELEASE_RUNBOOK.md (describes Docker; production is Windows without Docker: IF-15); ops/windows/README.md and secret-free templates run_ckam_web.ps1.template, deploy_ckam.ps1.template, rollback_release.ps1.template, verify_release.ps1 (parser + -WhatIf validated); docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md; ops/db/ROLE_SPLIT_RUNBOOK.md (all prepared, none executed on production) | Live launcher not in git and not compared with the reference; runbooks prepared but never executed or confirmed by IT | DRAFT 04, 07, 08 | **PARTIAL** |
| A.6.1 | Screening | ORGANISATIONAL | YES | Treats R-04 (High) | NOT EVIDENCED | Not evidenced | DRAFT 03 | **NOT EVIDENCED** |
| A.6.2 | Terms and conditions of employment | ORGANISATIONAL | YES | Treats R-04 (High) | NOT EVIDENCED | Not evidenced | DRAFT 03 | **NOT EVIDENCED** |
| A.6.3 | Information security awareness, education and training | ORGANISATIONAL | YES | Treats R-05 (High), R-30 (Medium) | NOT EVIDENCED; docs/security/policies/10_Security_Awareness_Plan.md (DRAFT, no session held) | Not evidenced | DRAFT 10 | **NOT EVIDENCED** |
| A.6.4 | Disciplinary process | ORGANISATIONAL | YES | Treats R-09 (Medium) | NOT EVIDENCED | Not evidenced | DRAFT 03 | **NOT EVIDENCED** |
| A.6.5 | Responsibilities after termination or change of employment | PROCESS | YES | Treats R-16 (Medium), R-19 (Medium) | docs/security/evidence/auth/tests.csv AU-T041..AU-T043; backend/tests/auth/test_vapt_sessions.py (AU-07 FIXED: token_version, migration f9a1c3e5b7d2); docs/security/policies/03_Joiner_Mover_Leaver_Procedure.md (DRAFT); backend/tests/auth/test_wpa2_token_version_atomic.py | No HR trigger to CKAM | DRAFT 03 | **PARTIAL** |
| A.6.6 | Confidentiality or non-disclosure agreements | ORGANISATIONAL | YES | Treats R-11 (Medium) | NOT EVIDENCED | Not evidenced | DRAFT 03 | **NOT EVIDENCED** |
| A.6.7 | Remote working | ORGANISATIONAL | YES | Treats R-18 (Critical), R-01 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (public address via router port-forward of TCP 3211, plain HTTP); docs/security/CKAM_HTTPS_IMPLEMENTATION_PLAN.md (prepared, owner decisions open) | Remote access is open and unencrypted | DRAFT 02 | **MISSING** |
| A.6.8 | Information security event reporting | PROCESS | YES | Treats R-27 (High) | frontend/src/features/support/report-problem-store.ts; backend/app/observability/client_reports.py; docs/security/evidence/auth/tests.csv AU-T098, AU-T101 | Channel for security events not communicated | DRAFT 05, 10 | **PARTIAL** |
| A.7.1 | Physical security perimeters | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED (servers 10.0.1.98, 10.0.0.205 and NAS 10.0.0.25 are CityKart on-premise equipment) | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.2 | Physical entry | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.3 | Securing offices, rooms and facilities | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.4 | Physical security monitoring | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.5 | Protecting against physical and environmental threats | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.6 | Working in secure areas | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.7 | Clear desk and clear screen | PHYSICAL | YES | Treats R-30 (Medium) | backend/app/core/config.py (access token 15 minutes, refresh 8 hours) | Endpoint screen-lock not evidenced | DRAFT 10 | **NOT EVIDENCED** |
| A.7.8 | Equipment siting and protection | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.9 | Security of assets off-premises | PHYSICAL | YES | Treats R-25 (Medium) | CKAM records custody of laptops and other assets given to employees (docs/ai/PRODUCT_CONTEXT.md) | Device protection rules not evidenced | DRAFT 01 | **NOT EVIDENCED** |
| A.7.10 | Storage media | PHYSICAL | YES | Treats R-13 (High), R-25 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (dumps on E: of 10.0.0.205; files on NAS); dev backups folder (IF-09); docs/security/CKAM_BACKUP_RESTORE_PLAN.md (prepared); docs/security/evidence/closure/infra/IF-09_ACL_PLAN.md (prepared; nothing changed on the dev PC) | Unencrypted backup media; dev dumps on dev PC | DRAFT 07 | **MISSING** |
| A.7.11 | Supporting utilities | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.12 | Cabling security | PHYSICAL | YES | Treats R-28 (High) | NOT EVIDENCED | Not evidenced | DRAFT 08 (inherited) | **NOT EVIDENCED** |
| A.7.13 | Equipment maintenance | PHYSICAL | YES | Treats R-28 (High) | CKAM records Under Repair / Send for Repair (docs/ai/DECISIONS.md 2026-10-14 (10)) | Not evidenced for CKAM servers | DRAFT 08 | **NOT EVIDENCED** |
| A.7.14 | Secure disposal or re-use of equipment | PHYSICAL | YES | Treats R-11 (Medium) | CKAM statuses Disposed / Scrapped / Sold (docs/ai/DECISIONS.md 2026-10-14 (2)) | Wiping not evidenced | DRAFT 01 | **NOT EVIDENCED** |
| A.8.1 | User end point devices | TECHNICAL | YES | Treats R-25 (Medium) | docs/security (IF-09: dev PC .env and backups folder ACL); docs/security/evidence/closure/infra/IF-09_ACL_PLAN.md (plan only; NOTHING CHANGED on the dev PC) | Endpoints not evidenced; dev PC ACL gap | DRAFT 01 | **NOT EVIDENCED** |
| A.8.2 | Privileged access rights | TECHNICAL | YES | Treats R-04 (High), R-07 (High), R-12 (Medium) | docs/security/evidence/access/tests.csv (escalation cases); docs/security/evidence/infra/db_01_roles_privileges.out.txt (dev role superuser); docs/ai/PRODUCTION_INFRASTRUCTURE.md (prod role ckassetapp not superuser; task runs as SYSTEM); ops/db/role_split.sql, role_split_verify.sql, check_least_privilege.sql; docs/security/evidence/closure/db/WPB_RESULTS.md (runtime role: 7/7 needed actions work, 40/40 forbidden refused; verify 45/45; 34 least-privilege checks); docs/security/CKAM_SERVICE_ACCOUNT_PLAN.md | Privileged paths not minimised in production: role split not run on 10.0.0.205 (EXT-07, EXT-45), service still SYSTEM (EXT-06), no MFA, D6 open | DRAFT 02, 11 | **PARTIAL** |
| A.8.3 | Information access restriction | TECHNICAL | YES | Treats R-10 (Medium) | docs/security/evidence/access/tests.csv (208 IDOR/BOLA cases, 4 cross-company cases); docs/security/evidence/access/self_service_masters.txt; docs/security/evidence/infra/erp_cross_company_draft.txt; backend/tests/core/test_security_read_scope.py; docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md; docs/security/evidence/closure/retest2/access/authz_matrix.csv and tests.csv (319 cases, 0 escalations on the final code) | Only deployment is missing: production 3b5e842 still has AC-1, AC-2 and IF-03 (counted PARTIAL for production readiness) | DRAFT 02 | **READY IN CODE - NOT DEPLOYED (counts as PARTIAL)** |
| A.8.4 | Access to source code | TECHNICAL | YES | Treats R-26 (Medium) | git remote origin (GitHub, personal account); 286 commits by one author; secrets scan: none in working tree or 282 commits | Repository control not evidenced | DRAFT 02, 04 | **NOT EVIDENCED** |
| A.8.5 | Secure authentication | TECHNICAL | YES | Treats R-05 (High), R-01 (High), R-19 (Medium) | docs/security/evidence/auth/tests.csv (original 102 cases); backend/tests/auth/test_vapt_login.py, test_rate_limit.py, test_vapt_sessions.py, test_vapt_password_policy.py; docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md; backend/tests/auth/test_wpa2_refresh_reuse.py; backend/tests/auth/test_wpa2_token_version_atomic.py; migration b5d7f9a1c3e5_auth_session_refresh_reuse.py; docs/security/evidence/closure/retest2/sessions/RETEST2_SESSIONS.md (56 cases, all PASS) | Plain HTTP; no MFA; no absolute session lifetime decision; fixes not deployed | DRAFT 02 | **PARTIAL** |
| A.8.6 | Capacity management | PROCESS | YES | Treats R-21 (Medium) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (slow request/SQL rows, 660 MB log cap, GET /api/admin/diagnostics/db) | No capacity monitoring | DRAFT 08 | **PARTIAL** |
| A.8.7 | Protection against malware | TECHNICAL | YES | Treats R-14 (High), R-22 (Low) | docs/security/evidence/input/raw_sql_review.md section 8; backend/tests/documents/test_vapt_content_check.py (IN-03 FIXED: file-signature check) | Server and NAS malware protection not evidenced | DRAFT 06 | **PARTIAL** |
| A.8.8 | Management of technical vulnerabilities | TECHNICAL | YES | Treats R-02 (Critical), R-17 (High), R-15 (Medium) | docs/security/evidence/ (VAPT 2026-10-15); docs/security/evidence/infra/dependency_audit.md; docs/security/evidence/infra/static_route_traversal_and_startup.txt; docs/security/CKAM_SECURITY_CLOSURE_REGISTER.md; docs/security/evidence/closure/retest1/RETEST1.md (137 cases); docs/security/evidence/closure/retest2/ (497 cases: access 319, infra 122, sessions 56) | CRITICAL IF-01 still exposed in production until deploy + secret rotation; no scheduled scanning; SLAs only in DRAFT doc 06 | DRAFT 06 | **PARTIAL** |
| A.8.9 | Configuration management | TECHNICAL | YES | Treats R-23 (High), R-20 (Medium) | .env.example; backend/app/core/config.py; docs/ai/CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md; backend/tests/core/test_production_secret_guard.py; backend/tests/test_vapt_headers_and_docs.py; frontend/scripts/check-nginx-live.mjs; frontend/src/security/nginx-config.test.ts; backend/tests/core/test_n2_forwarded_for.py; ops/windows/run_ckam_web.ps1.template | Server configuration not baselined | DRAFT 04 | **PARTIAL** |
| A.8.10 | Information deletion | TECHNICAL | YES | Treats R-31 (Medium), R-11 (Medium) | CLAUDE.md rule 2 (soft-deactivate only); docs/ai/LOGGING_AND_DIAGNOSTICS.md section 4 (error/system/client rows purged after 180 days; audit kept forever; guarded purge) | No retention schedule for business data or audit | DRAFT 01, 07 | **PARTIAL** |
| A.8.11 | Data masking | TECHNICAL | PARTIAL | Treats R-03 (Critical) | backend/app/observability/redact.py; backend/tests/observability/test_redaction.py; docs/security/evidence/auth/tests.csv AU-T049, AU-T089, AU-T090 | None for secret masking | DRAFT 01 | **READY** |
| A.8.12 | Data leakage prevention | TECHNICAL | YES | Treats R-11 (Medium), R-01 (High) | docs/ai/LOGGING_AND_DIAGNOSTICS.md (EXPORT rows); main.py Cache-Control no-store on /api/ | No DLP; transport not encrypted | DRAFT 01 | **PARTIAL** |
| A.8.13 | Information backup | TECHNICAL | YES | Treats R-13 (High), R-14 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (task CK_Backup_CKASSETMANAGEMENT, daily 03:00, 30 days, on the DB server); ops/backup.sh (dev); docs/ai/AM-09_RC_FULL_AUDIT_REPORT.md (dev restore drill); docs/security/CKAM_BACKUP_RESTORE_PLAN.md (prepared); docs/security/policies/07_Backup_Restore_Policy.md (DRAFT) | Single-location unencrypted backups | DRAFT 07 | **PARTIAL** |
| A.8.14 | Redundancy of information processing facilities | TECHNICAL | YES | Treats R-13 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (one app server, one DB server) | No redundancy and no documented acceptance | DRAFT 08 | **MISSING** |
| A.8.15 | Logging | TECHNICAL | YES | Treats R-12 (Medium), R-27 (High) | docs/ai/LOGGING_AND_DIAGNOSTICS.md; docs/security/evidence/auth/audit_coverage.csv (122 write routes: 107 audited, 15 intentionally not, 0 accidental); docs/security/evidence/auth/tests.csv AU-T086..AU-T097; backend/app/observability/writer.py; backend/tests/observability/test_log_write_failure_reporting.py | Logs not protected or shipped off-server; 180-day retention of error/system/client rows; nothing of the closure deployed | DRAFT 05 | **PARTIAL** |
| A.8.16 | Monitoring activities | TECHNICAL | YES | Treats R-27 (High) | docs/ai/LOGGING_AND_DIAGNOSTICS.md section 8 (admin log screens, diagnostics); Home error count (commit 4ba4e94) | No active monitoring | DRAFT 05 | **PARTIAL** |
| A.8.17 | Clock synchronization | TECHNICAL | YES | Treats R-12 (Medium) | NOT EVIDENCED (application stores timezone-aware UTC timestamps) | Not evidenced | DRAFT 06 | **NOT EVIDENCED** |
| A.8.18 | Use of privileged utility programs | TECHNICAL | YES | Treats R-12 (Medium), R-06 (High) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (superuser DB steps typed by the user); docs/ai/LOGGING_AND_DIAGNOSTICS.md (diagnostics read-only, head-office admin only, audited) | Not evidenced | DRAFT 02 | **NOT EVIDENCED** |
| A.8.19 | Installation of software on operational systems | TECHNICAL | YES | Treats R-15 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (pip install -e into shared\venv at deploy); backend/constraints.txt (IF-11 file added); ops/windows/deploy_ckam.ps1.template (pip install -c constraints.txt; reference only, never run on the server) | Unpinned Python installs | DRAFT 04, 06 | **PARTIAL** |
| A.8.20 | Networks security | TECHNICAL | YES | Treats R-18 (Critical), R-01 (High), R-08 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (pg_hba allows ckassetapp only from 10.0.1.98/32; firewall rule CKAM-Web TCP 3211; router forwards 3211 from the internet) | Internet exposure without TLS | DRAFT 01, 02 | **PARTIAL** |
| A.8.21 | Security of network services | TECHNICAL | YES | Treats R-01 (High), R-08 (Medium) | docs/ai/PRODUCTION_INFRASTRUCTURE.md; backend/tests/erp/test_erp_tls_settings.py; backend/tests/core/test_n2_forwarded_for.py | No TLS on any production link; production launcher flag (N2) not applied; no service hardening record | DRAFT 01, 02 | **PARTIAL** |
| A.8.22 | Segregation of networks | TECHNICAL | YES | Treats R-06 (High), R-18 (Critical) | docs/ai/PRODUCTION_INFRASTRUCTURE.md (shared servers with Spinwheel and Citykart Desk) | Not evidenced; shared hosts | DRAFT 01 | **NOT EVIDENCED** |
| A.8.23 | Web filtering | TECHNICAL | NO | Outside CKAM scope (corporate network control) | Not applicable to the CKAM application: outbound web filtering is a CityKart corporate network control outside this scope | N/A | None | **N/A** |
| A.8.24 | Use of cryptography | TECHNICAL | YES | Treats R-01 (High), R-03 (Critical), R-13 (High) | docs/security/evidence/auth/tests.csv AU-T017..AU-T021, AU-T044; backend/app/core/security.py (HS256 pinned) | No encryption in transit; no key management | DRAFT 01 | **PARTIAL** |
| A.8.25 | Secure development life cycle | PROCESS | YES | Treats R-23 (High) | docs/ai/DEVELOPMENT_GUARDRAILS.md; CLAUDE.md (test before commit, Alembic only); docs/security/CKAM_SECURITY_BASELINE.md; docs/security/CKAM_SECURITY_BASELINE.md (closure rules added 2026-10-16); frontend/scripts/check-build-security.mjs (npm run check:build) | Rules depend on discipline, not automation | DRAFT 04 | **PARTIAL** |
| A.8.26 | Application security requirements | TECHNICAL | YES | Treats R-23 (High) | docs/ai/DEVELOPMENT_GUARDRAILS.md; docs/ai/DECISIONS.md (authorization, append-only, ERP read-only decisions); docs/security/CKAM_SECURITY_BASELINE.md; docs/security/CKAM_SECURITY_BASELINE.md updated 2026-10-16 (still not approved) | Baseline not yet approved | DRAFT 04 | **PARTIAL** |
| A.8.27 | Secure system architecture and engineering principles | TECHNICAL | YES | Treats R-07 (High), R-01 (High) | docs/security/CKAM_THREAT_MODEL.md; docs/ai/DECISIONS.md 2026-10-14 (1),(6),(7); backend/app/lifecycle/service.py (single writer) | Runtime privilege and transport design weak | DRAFT 04 | **PARTIAL** |
| A.8.28 | Secure coding | TECHNICAL | YES | Treats R-02 (Critical), R-21 (Medium) | docs/security/evidence/input/raw_sql_review.md; docs/security/evidence/input/tests.csv; docs/security/evidence/input/xss_results.json; docs/security/evidence/input/formula_export_cell.txt; backend/tests/test_static_frontend.py; backend/tests/core/test_security_concurrency.py; docs/ai/DEVELOPMENT_GUARDRAILS.md (file-path and file-security rules); backend/tests/test_static_frontend_windows.py and test_static_frontend_spa_assets.py (IF-01-WIN lexical refusal before any filesystem call; CL2-IF-04 deep links); docs/security/evidence/closure/windows/ (native Windows run: old code leaked fake canaries in 10 of 28 payloads, fixed code 0 of 28); backend/tests/masters/test_wpf2_category_names.py; backend/tests/core/test_wpf2_serial_race_message.py | Production still runs code without these fixes (tracked under A.8.8 / EXT-01) | DRAFT 04, 06 | **READY** |
| A.8.29 | Security testing in development and acceptance | TECHNICAL | YES | Treats R-23 (High) | docs/security/evidence/access/tests.csv; docs/security/evidence/auth/tests.csv; docs/security/evidence/input/tests.csv; backend/tests/observability/test_coverage_walker.py; backend/tests/test_static_frontend.py; backend/tests/**/test_vapt_*.py; frontend/e2e/security.spec.ts; docs/ai/CKAM_FINAL_UAT.md; docs/security/CKAM_VAPT_REPORT.md; docs/security/evidence/closure/retest1/, docs/security/evidence/closure/retest2/, docs/security/evidence/closure/perf/PERF_REPORT.md, docs/security/evidence/closure/windows/ | No schedule yet for repeating the battery | DRAFT 04, 06 | **READY** |
| A.8.30 | Outsourced development | PROCESS | PARTIAL | Treats R-23 (High), R-03 (Critical) | git log (275 of 286 commits co-authored by an AI coding assistant); no external development firm evidenced | No written rule for AI-assisted development | DRAFT 04, 09 | **PARTIAL** |
| A.8.31 | Separation of development, test and production environments | TECHNICAL | YES | Treats R-03 (Critical) | CLAUDE.md (dev 10.0.0.47; prod 10.0.1.98 / 10.0.0.205 / NAS); backend/tests/conftest.py (refuses the plain ckam DB); docs/ai/CKAM_PRODUCTION_ENVIRONMENT_CHECKLIST.md (independent production secrets required) | Independence of production secrets not re-verified | DRAFT 04 | **READY** |
| A.8.32 | Change management | PROCESS | YES | Treats R-23 (High) | CLAUDE.md (commit, then user-approved push, then separately approved deploy); docs/ai/PRODUCTION_INFRASTRUCTURE.md (backup first, release by sha, alembic, verify, rollback); docs/security/policies/04_Change_Management_Procedure.md and templates/change_record.md (DRAFT, no record yet); 21 local security commits waiting for the owner's push approval (none pushed, none deployed) | Approvals and results not recorded as evidence | DRAFT 04 | **PARTIAL** |
| A.8.33 | Test information | PROCESS | YES | Treats R-25 (Medium) | docs/ai/DEVELOPMENT_GUARDRAILS.md (UAT naming convention); docs/security/evidence/access/self_service_masters.txt (synthetic SEC-TEST data); docs/ai/ERP_INTEGRATION.md (dev holds a copy of real ERP data: 18,358 lines, 191 suppliers) | Real ERP data on the dev PC | DRAFT 04 | **PARTIAL** |
| A.8.34 | Protection of information systems during audit testing | PROCESS | YES | Supporting control (keeps testing from harming production) | docs/security/evidence/infra/static_route_traversal_and_startup.txt (tests on throw-away containers; production not touched); docs/security/evidence/infra/db_03_append_only_privilege_tests.out.txt (all in a rolled-back transaction); Closure tests ran only on throw-away stacks (ckam-sec, disposable role-split DB) and a native Windows run with FAKE canary secrets on the dev PC; production and 10.x hosts never touched | None | DRAFT 13 | **READY** |

---

## 11. Required organisational actions (ORGANIZATIONAL / PROCESS GAPS)

Each item names the `EXT-xx` action in `CKAM_EXTERNAL_SECURITY_ACTIONS.md` and the DRAFT document that would
cover it. Every linked document is **DRAFT — MANAGEMENT APPROVAL REQUIRED**: approving it is the first step,
producing its first record is what makes it evidence.

| # | Action | What it means for CKAM | Annex A | Kind | DRAFT document | EXT |
|---|---|---|---|---|---|---|
| 1 | **Policy set** | Approve, publish and get acknowledgement of the information security policy and topic policies | 5.1, 5.10, 5.12, 5.37, 8.25 | ORGANISATIONAL | [01 Information Security Policy](policies/01_Information_Security_Policy.md), [02 Access Control Policy](policies/02_Access_Control_Policy.md) | EXT-17 |
| 2 | **Risk register ownership** | Appoint an owner for the 40-risk register (section 9), approve the method, review yearly and after major change | 5.4, 5.8; clause 6.1 | ORGANISATIONAL | [12 Risk Management Procedure](policies/12_Risk_Management_Procedure.md) | EXT-36 |
| 3 | **Access review** | Quarterly review of every login, access level, company, work area and head-office admin flag, plus server/DB accounts; signed | 5.15, 5.18, 8.2 | PROCESS | [11 Periodic Access Review](policies/11_Periodic_Access_Review_Procedure.md), [templates/access_review_record.md](policies/templates/access_review_record.md) | EXT-18 |
| 4 | **Joiner / mover / leaver** | HR tells IT; CKAM login created / changed / switched off the same day; assets returned | 5.11, 5.16, 6.5 | PROCESS | [03 JML Procedure](policies/03_Joiner_Mover_Leaver_Procedure.md), [templates/joiner_mover_leaver_record.md](policies/templates/joiner_mover_leaver_record.md) | EXT-33 |
| 5 | **Incident response** | Contain, rotate, keep evidence, report (CERT-In window via legal), review. First use: IF-01 | 5.24-5.28, 6.8 | PROCESS | [05 Incident Response Plan](policies/05_Incident_Response_Plan.md), [templates/incident_record.md](policies/templates/incident_record.md) | EXT-20, EXT-03, EXT-41 |
| 6 | **BCP / DR** | RTO/RPO, reboot test, restore drill, manual fallback | 5.29, 5.30, 8.14 | PROCESS | [08 BCP and DR Plan](policies/08_Business_Continuity_and_DR_Plan.md) | EXT-29 |
| 7 | **Backup** | Encrypted off-server and offline copies, NAS documents, quarterly restore test | 8.13, 7.10 | PROCESS / TECHNICAL | [07 Backup and Restore Policy](policies/07_Backup_Restore_Policy.md), [templates/restore_test_record.md](policies/templates/restore_test_record.md); `CKAM_BACKUP_RESTORE_PLAN.md` | EXT-08 |
| 8 | **Supplier review** | ERP warehouse team, NAS vendor, GitHub, AI coding assistant provider, package ecosystems, external testers | 5.19-5.23 | ORGANISATIONAL | [09 Supplier Security Review](policies/09_Supplier_Security_Review.md) | EXT-34 |
| 9 | **Awareness** | Yearly session for users, deeper one for admins | 6.3, 6.8 | ORGANISATIONAL | [10 Security Awareness Plan](policies/10_Security_Awareness_Plan.md) | EXT-32 |
| 10 | **Change management** | A change record per release incl. the IF-01 emergency change | 8.32, 8.9 | PROCESS | [04 Change Management Procedure](policies/04_Change_Management_Procedure.md), [templates/change_record.md](policies/templates/change_record.md) | EXT-35, EXT-42 |
| 11 | **Vulnerability management** | Monthly dependency audit, patch windows, severity deadlines, yearly external VAPT, PyJWT follow-up | 8.8, 5.7 | PROCESS | [06 Vulnerability Management](policies/06_Vulnerability_Management_Procedure.md), [templates/vulnerability_triage_record.md](policies/templates/vulnerability_triage_record.md) | EXT-09, EXT-12, EXT-14, EXT-47 |
| 12 | **Least-privilege check after every deploy** | Run `ops/db/check_least_privilege.sql` and keep the output with the change record | 8.2, 8.18 | PROCESS | (covered by 04; no separate draft) | EXT-46 |
| 13 | **Internal audit** | Yearly, by someone independent of CKAM development | 5.35, 5.36; clause 9.2 | ORGANISATIONAL | [13 Internal Audit Checklist](policies/13_Internal_Audit_Checklist.md) | EXT-36 |
| 14 | **Management review** | Yearly review of risks, incidents, audits, actions; minutes | 5.4; clause 9.3 | ORGANISATIONAL | [14 Management Review Agenda](policies/14_Management_Review_Agenda.md) | EXT-36 |
| 15 | **Statement of Applicability** | Approve after the risk register; regenerate from the current matrix | clause 6.1.3 d | ORGANISATIONAL | [15 SoA working draft](policies/15_Statement_of_Applicability_Working_Draft.md) | EXT-36 |
| 16 | **Owner decisions** | D6, MFA, store logins, AU-04, per-office NAT limit, absolute session lifetime, audit retention vs privacy | 5.15, 8.5, 5.34 | ORGANISATIONAL | `CKAM_SECURITY_DECISIONS_REQUIRED.md` (SD-01 … SD-16) | EXT-19, EXT-26, EXT-30, EXT-31, EXT-49, EXT-50 |

---

## 12. Verdicts

### `ISO 27001 TECHNICAL READINESS: PARTIAL` (improved)

**This is not a certification and not an audit opinion.**

1. **Strong in code and retested.** Access control, authentication and sessions (incl. refresh-token reuse
   detection), logging (incl. visible audit-write failures), protection of records (append-only + DB guard on
   lifecycle fields), secure coding and security testing are designed and evidenced by the original 636 cases,
   closure retests of 137 and 497 cases, 2541 backend and 1257 frontend tests, 14/14 browser security journeys,
   a native Windows test and a least-privilege simulation. Four technical controls are READY and A.8.3 is READY
   IN CODE — NOT DEPLOYED.
2. **Not STRONG** because (a) **nothing is deployed: production `3b5e842` still has the CRITICAL IF-01
   exposure and the QR deep-link bug**; (b) login crosses the internet in plain HTTP (IF-02); (c) CKAM shares
   its servers and runs as SYSTEM (IF-07); (d) backups are single-location, unencrypted and never restored in
   production (IF-08); (e) the production DB role still owns the tables (role split prepared, not run). These
   need deployment and infrastructure work that code cannot do.
3. **Not WEAK** because no code-fixable Critical/High/Medium item remains open locally, every fix was
   independently retested, and every external gap has a prepared procedure.

### `ISO 27001 ORGANISATIONAL READINESS: WEAK`

0 of 21 organisational controls are READY (4 PARTIAL, 5 MISSING, 12 NOT EVIDENCED); 27 process controls have
1 READY (A.8.34). A draft policy pack exists, but **policies are drafts only**: none approved, none
communicated, none has produced a record. Certification is not realistic until the policy set, risk ownership,
access reviews, incident plan, internal audit and management review exist **and have run at least once**.

**What would move the technical verdict to STRONG:** EXT-41, EXT-39, EXT-01, EXT-44, EXT-38, EXT-02 and EXT-03
(deploy the fixed release correctly, rotate secrets, assess compromise), EXT-04 and EXT-05 (HTTPS; close or
restrict the internet forward), EXT-06 and EXT-07/EXT-45/EXT-46 (service account; DB role split with the current
scripts and the post-deploy check) and EXT-08 (off-server encrypted backups with a restore test), followed by a
post-deploy check on production.

---

## 13. Statements that could not be evidenced

- Physical security of the rooms holding 10.0.1.98, 10.0.0.205 and the NAS (A.7.x): NOT EVIDENCED.
- HR screening, contracts, NDAs, disciplinary process, training (A.6.1-A.6.4, A.6.6, A.6.3): NOT EVIDENCED.
- Patch level and antimalware on 10.0.1.98, 10.0.0.205, NAS; time synchronisation: NOT EVIDENCED.
- Disk/database encryption at rest in production; TLS on the production PostgreSQL connection: NOT EVIDENCED.
- Whether a backup of the NAS documents exists: NOT EVIDENCED.
- GitHub repository ownership, visibility, collaborators and MFA (A.8.4): NOT EVIDENCED.
- Whether IF-01 was exploited on production: NOT EVIDENCED either way (no production log reviewed; EXT-41, EXT-03).
- Whether production secrets are independent of dev, and whether `ckappuser` / `ckpost` are CKAM-only: NOT EVIDENCED (EXT-02, EXT-43).
- The ERP-side SELECT-only grant and TLS support: NOT EVIDENCED (code side evidenced with stand-ins only).
- That the production `JWT_SECRET` meets the start-up rule and `ENVIRONMENT_NAME=production` is set: NOT EVIDENCED (EXT-39).
- Least privilege on a real production-like database: proven only on a disposable DB (the dev Docker app role is a superuser).
- Windows behaviour beyond the path-traversal fix (junctions, 8.3 aliases, SMB lookups) and on the production server itself: not exercised.
- Container OS packages were not scanned for CVEs; the secret scan is regex-only.
- WP-F2 (category names, serial-race message) had permanent tests and the retest-2 findings behind it, but no separate third retest.
- Any of the remediation running in production: NOT EVIDENCED (nothing deployed).

---

## 14. Spreadsheets

`CKAM_ISO27001_CONTROL_MATRIX.xlsx` and `CKAM_SOC2_CONTROL_MATRIX.xlsx` were regenerated on 2026-10-16 from the
CSV files with openpyxl, by streaming the converter and the CSVs into a temporary folder (`/tmp/matrix`, a
tmpfs) of the dev stack's `api` container and running it once (read-only use; no build, no restart; the
SHA-256 of each `.xlsx` was compared before and after copying back). Header row bold and frozen, filters on,
column widths set, text wrapped, any cell starting with `= + - @` written as text. The CSV files are the master
copies; new columns in v1.1: `Control Kind`, `Draft Policy (DRAFT - not evidence)`,
`Previous Status (2026-10-15)`. If a CSV changes, regenerate the `.xlsx`.

---

## 15. Change history

| Version | Date | Writer | Change |
|---|---|---|---|
| 1.0 | 2026-10-15 | Readiness consultant (first programme) | First assessment at HEAD `d04779a`: 93 controls (5 READY, 43 PARTIAL, 13 MISSING, 31 NOT EVIDENCED, 1 N/A), 33 risks, verdict `ISO 27001 TECHNICAL READINESS PARTIAL` |
| 1.1 | 2026-10-16 | WP-M2b (closure programme) | Re-assessed at HEAD `fd34520` from the lead's fact sheet: four control kinds added (TECHNICAL / PROCESS / ORGANISATIONAL / PHYSICAL); new status `READY IN CODE — NOT DEPLOYED` (A.8.3), counted as PARTIAL; draft policies linked but never counted as evidence; findings table and evidence updated for the closure; risk register re-scored (production today unchanged, new "after deploy" column, 7 new risks R-34 … R-40); verdicts split into technical PARTIAL (improved) and organisational WEAK |
