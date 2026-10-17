# CKAM Security Programme — Master Handover for Independent Review

> **Who this is for.** (1) The CKAM owner, who is not a programmer: read section 1, the "Plain:" lines and every
> **Before / After** pair. (2) A reviewing AI or security engineer **who cannot see the repository**: everything
> needed to judge the work is in this one file, with evidence paths so a human can fetch any file you ask for.
>
> **This is an internal record, not a certificate.** CKAM is **not** ISO/IEC 27001 certified and has **no** SOC 2
> report (Type I or Type II). **Production is NOT fixed**: nothing in this file has been pushed or deployed.

> ### ⚠ READ BEFORE ANY PUSH — the GitHub repository is PUBLICLY READABLE (verified 2026-10-16)
> `https://github.com/kumarsuraj84/Citykart-AssetManagement` answers an **unauthenticated** request: the web page
> returns HTTP 200 and `api.github.com/repos/...` returns HTTP 200 (a private repository answers 404 to a stranger).
> The earlier reports said "could not check whether the repo is public"; it is now **checked: it is public**.
> What this means:
> 1. **The vulnerable code and the live server's address are already public.** The pushed history (origin tip
>    `c66378d`) contains the vulnerable `/assets/{path}` route (IF-01), `docs/ai/PRODUCTION_INFRASTRUCTURE.md`
>    (server IPs, the internet-forwarded host name, port 3211, folder layout such as `shared\.env`, task names) and the
>    deploy method. Anyone who reads them can try IF-01 against the live server today. This raises the urgency of the
>    deploy: **the exposure is not theoretical.**
> 2. **Pushing the 22 local commits BEFORE the fix is deployed would publish a ready-made attack recipe** (payload
>    lists, test cases and attack transcripts under `docs/security/evidence/**`, the findings register, the
>    runbook) for a hole that is still open on production.
> 3. **Recommended order (changes the earlier runbook, which put "push" before "deploy"):** production releases are
>    packaged locally on the dev PC (`releases\<sha>\{backend,frontend-dist}`, copied to the server; see
>    `docs/ai/PRODUCTION_INFRASTRUCTURE.md` "Deploy"), **not pulled from GitHub, so a deploy does not need a push first.**
>    Deploy and verify the fix → rotate the secrets → only then push. Also consider (owner decisions): making the
>    repository **private now** (GitHub → Settings → Danger zone; this does not remove what was already copied), and
>    pushing the code commits but keeping the attack-recipe evidence (`docs/security/evidence/**`, parts of the
>    registers) out of the public history until production is fixed (or in a private repository).
> 4. Already-public information cannot be un-published; assume the live server's file-read hole may already have
>    been probed — hence the compromise assessment step in the runbook is mandatory.

---

## 0. Document control

| Item | Value |
|---|---|
| Document | `docs/security/CKAM_SECURITY_MASTER_HANDOVER.md` (single self-contained handover) |
| Date | 2026-10-16 |
| System | CKAM — CityKart Asset Manager (internal asset-lifecycle app) |
| Repository state described | Git worktree `ckam-build`, branch `worktree-ckam-build`. Commit range **`4ba4e94` → `fd34520`** (programme start → final local HEAD). Remote `origin` tip is `c66378d` (the last pushed commit; production runs `3b5e842`, an ancestor of it) |
| Commits ahead of origin | **22** = `4ba4e94` (a small, unrelated frontend fix made before the programme) + **21** security commits (counted with `git rev-list --count c66378d..HEAD`). The lead's fact sheet says "23 (4ba4e94 + 22)"; its own commit list has 21 entries, so 22 is the verified figure. It becomes 23 if this handover file is committed |
| Database migration head | `c6e8a0b2d4f6` (single head). Four migrations added by the programme (section 6.3) |
| Authoritative inputs | The lead's final fact sheet (wins on statuses and numbers), the registers and reports in `docs/security/`, the evidence folders under `docs/security/evidence/`, `git log --stat 4ba4e94..HEAD`, and the code of the key fixes (read directly for this file) |
| Written by | Security auditor / technical writer (documents only: no code edits, no git writes, no Docker, no servers) |

### 0.1 What has and has not happened

| Question | Answer |
|---|---|
| Were fixes written and tested? | **Yes**, locally on the dev PC (10.0.0.47), in Docker test stacks and throw-away containers |
| Was anything pushed to the git remote? | **No.** No remote branch contains `3e134c1` (the first security commit), checked against the local remote-tracking refs |
| Was anything deployed to production? | **No.** Production app server 10.0.1.98 still runs release `3b5e842` |
| Was production (10.0.1.98, DB 10.0.0.205, NAS 10.0.0.25) touched, scanned or tested? | **No**, never |
| Was the ERP warehouse (10.0.1.69) contacted? | **No** (stand-ins and CKAM's local ERP copy were used) |
| Was the retired server 10.0.1.12 touched? | **No** |
| Were any real secrets rotated? | **No.** Rotation is planned and must happen only after the fixed release is verified in production |
| Working tree | Clean except two **untracked** items deliberately not committed: `docs/ai/CKAM_DEMO_WALKTHROUGH.md` and `docs/ai/demo-screens/` (a local demo; the walkthrough contains a demo-only password and must not be committed as is) |

### 0.2 How to read this file

- Every major item starts with **Plain:** (one or two sentences for the owner) followed by the technical detail.
- **Status words** used throughout (exactly one per finding):
  - **FIXED (local, not deployed)** — code/scripts changed and tested on the dev PC; production still has the old behaviour.
  - **MITIGATED** — code side closed (risk reduced in code or reference scripts ready); a stated residual needs a
    DBA/IT step.
  - **ACCEPTED** — kept as is, with a written reason.
  - **EXTERNAL** — needs server, network, supplier or management action. Two sub-kinds: **OPEN EXTERNAL** (server /
    network / DBA / supplier work; code may already contain an option) and **DECISION REQUIRED** (the owner must
    choose before anything is built). These are the counting rules of `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` and the
    findings register; this file uses the same numbers.
- **"Verified"** in this file means one of: *independently retested* (a separate tester agent re-attacked the running
  system), *permanent test* (a pytest/vitest/Playwright test in the repository), *native Windows run*, or *reading the
  code*. Each claim says which.
- Evidence paths are relative to `docs/security/evidence/` unless they start with `backend/`, `frontend/`, `ops/` or
  `docs/`.

### 0.3 Glossary of finding-ID prefixes

| Prefix | Meaning | Where defined |
|---|---|---|
| `IF-` | Infrastructure / configuration / file-serving findings of the first VAPT (IF-01 … IF-17) | `CKAM_SECURITY_FINDINGS_REGISTER.md` |
| `AU-` | Authentication, session, web-header and logging findings (AU-01 … AU-16) | same |
| `AC-` | Access-control findings (AC-1, AC-2) | same |
| `IN-` | Input-handling findings (IN-01 = IF-01 duplicate, IN-02, IN-03) | same |
| `N1`–`N9` | New findings/observations raised by the **first retest** (N1–N4 findings; N5–N9 observations) | register + `retest/retest_auth_input_infra.md` |
| `PO-LOGIN`, `RACE-1`, `D6`, `MFA`, `FONTS` | Named findings (Primary-Owner login clash, same-name race, Full-Admin company scope decision, no MFA, Google Fonts) | register |
| `OBS-` | Observations (not counted as findings), e.g. OBS-TV, OBS-STATUS, OBS-POLYGLOT | register §"Observations", closure register §3 |
| `CL1-` | **Closure retest 1** cases and findings (e.g. CL1-N4-01, CL1-OBS-FILES-01) | `closure/retest1/RETEST1.md` |
| `CL2-IF-` / `CL2-AC-` / `CL2-SE-` | **Second independent retest** (infra / access / sessions+concurrency) cases and findings | `closure/retest2/*/RETEST2_*.md` |
| `CL3-` | **Third independent retest** cases (re-attack of the six late WP-F/WP-F2 fixes + regression sweep; 0 new findings) | `closure/retest3/RETEST3.md`, `tests.csv` |
| `CL-WPC-` | Proof ids of work package C (written by the engineer who made the change, not independent) | `closure/infra/WP-C_closure_evidence.md` |
| `RT-AU-` / `RT-AC-` | First-retest case ids | `retest/retest_tests2.csv`, `retest/retest_tests.csv` |
| `EXT-` | External action (server, DBA, management, supplier) EXT-01 … EXT-50 | `CKAM_EXTERNAL_SECURITY_ACTIONS.md` |
| `SD-` | Security Decision required from the owner, SD-01 … SD-16 | `CKAM_SECURITY_DECISIONS_REQUIRED.md` |
| `WP-` | Closure work package: WP-A1 (backend start-up/static/ERP), WP-A2 (auth sessions), WP-B (database), WP-C (frontend/infra), WP-D1/D2 (documents), WP-R (retests), WP-F / WP-F2 (fixes for retest-2 findings) | `CKAM_SECURITY_CLOSURE_REGISTER.md` §7 |
| `R-` | Risk-register entry R-01 … R-40 (ISO draft risk register, v1.1) | `CKAM_ISO27001_READINESS.md` §9 |

---

## 1. Executive summary for the owner

**What happened.** Between 15 and 16 October 2026 CKAM went through a full internal security test (VAPT), the
problems were fixed on the development PC, and the fixes were attacked again four more times by separate tester
agents (the last time on the final code, including every late fix), plus a native Windows test of the most
dangerous hole. Performance was
measured before and after: normal work is not noticeably slower.

**What was found.** 43 problems in the first test (1 critical, 1 high, 14 medium, 22 low, 5 informational), and 8
more during the later retests (mostly small, plus one real usability bug) — **51 in total: 1 critical, 1 high, 16
medium, 25 low, 8 informational**. **No problem that the code could fix is
left open on the development PC.** What is left needs server, network, database-administrator or management work.

### THE ONE URGENT THING — the live server is exposed today

**Plain:** the live CKAM server (10.0.1.98, reachable from the internet on port 3211) will hand **any file on the
server** to **anyone** who asks for it with a specially written web address — no login needed. That includes the
settings file with the database password and the secret key that signs every login, and the NAS password file.
With the signing key, a stranger can make themselves head-office admin without a password and **without leaving a
login record**. Because CKAM runs as the all-powerful SYSTEM account on a server shared with Spinwheel and Citykart
Desk, those apps' files on that server are very likely readable the same way (inferred from the code and the
SYSTEM account, not tested on production).

- This hole (**IF-01**) has been in every release since **2026-09-30**. App access logs exist only since 2026-10-14,
  so earlier use can be neither confirmed nor ruled out.
- On the dev PC, the **old code** leaked fake test secrets and `C:\Windows\win.ini` in **10 of 28** Windows attack
  addresses; the **fixed code** refused **all 28** (0 leaks). The fix is **not** on the live server.
- Example: it is like a shop whose back window is open — anyone can walk in, copy the master key and leave.

**It is easier to find than it looks: the code repository on GitHub is PUBLIC** (checked 2026-10-16), and it already
contains the vulnerable route and the documents that name the server, port and folder layout. Anyone can read them.

**What to do, in this order (all prepared, none done):** (1) if nobody outside the office needs CKAM right now, ask
IT to **close the internet forward of port 3211** today (SD-04 interim); (2) separately request the **deploy** of the
security release — it is built on the dev PC and copied to the server, so it does **not** need a push first;
(3) only after the fix is verified on the server, change the four secrets (login key, database, NAS, ERP passwords);
(4) check the logs for signs that someone already used the hole; (5) **then** approve the push (pushing the attack
details to a public repository before the fix is live would help an attacker), or make the repository private first.

### The five numbers that matter

| # | Number | Meaning |
|---|---|---|
| 1 | **1** critical hole still live in production (IF-01) | Fixed locally; 0/28 Windows payloads leak on the fixed code vs 10/28 on the old code |
| 2 | **51** findings tracked: **32 FIXED locally**, 4 MITIGATED, 3 ACCEPTED, **12 EXTERNAL** (9 open external + 3 owner decisions) | **0** code-fixable findings left open (section 5.1 shows how counted) |
| 3 | **≈ 2,226** recorded test cases in 4 attack rounds, plus **≈ 360** cases (52 logged assertions, all PASS) in a third closure retest of the late fixes (+ ≈ 60 infra checks as text, + 84 native-Windows probe runs) | 0 privilege escalations in 3,038 route×identity cells; 0 new findings in the last retest |
| 4 | **2,541** backend tests pass (was 1,577 before the programme); **1,257** frontend tests; **14/14** browser security journeys | Permanent guards against regression |
| 5 | **0** pushed, **0** deployed; **22** local commits and **4** database migrations waiting | Nothing protects production yet |

### What is safe to push, and what must happen before production

- **Technically safe to push, but not yet:** all 22 local commits (code, tests, documents, evidence) contain no real
  secret (regex scan + review; only placeholders, fake canaries and throw-away test values). But the GitHub
  repository is **PUBLIC** (warning at the top) and the evidence folders contain working attack addresses for the
  still-live IF-01 hole: **push after the deploy**, or make the repository private first, or keep the evidence out of
  the push. Push ≠ deploy; pushing changes nothing on the server.
- **Before production:** precheck (`ENVIRONMENT_NAME=production`, strong `JWT_SECRET` or the new code refuses to
  start), backup, copy the old logs off the server, run the 4 migrations **before** starting the new code, start
  uvicorn with `--no-proxy-headers --no-server-header`, verify (all traversal probes 404, `/assets/<id>` opens the
  app), then rotate the 4 secrets, then the compromise check. Full list: section 11.

---

## 2. Brief for the reviewing AI

### 2.1 What CKAM is

| Aspect | Detail |
|---|---|
| Purpose | Internal asset-lifecycle tracking for CityKart (two companies, CKSPL and CKVPL; IT and Non-IT "work areas"; ~212 stores). Assets are received against purchase orders, allotted/moved between holders (employees, stock rooms, stores), repaired, sold, scrapped; every custody change is recorded |
| Backend | Python 3.13, FastAPI, SQLAlchemy 2.0 async (asyncpg), Alembic, Argon2id password hashes, `python-jose` HS256 JWTs |
| Frontend | React 19 + Vite + TanStack Query/Router + Tailwind + shadcn/ui; built to static files |
| Database | PostgreSQL 17 in the dev Docker stack; PostgreSQL 18 in production |
| Main modules | Auth / asset users (people, logins, roles), masters (vendors, brands, categories, items, locations, cost centres, custom fields, code rules, bundles), purchase orders + receiving, assets + lifecycle ledger, documents (uploads), imports/exports (Excel), reports, ERP read-only link and local ERP copy, observability (audit log, system events, error log, diagnostics), client problem reports |
| Attack surface (measured) | 217 HTTP routes; 122 write routes (107 audited, 15 intentionally not); unauthenticated: sign-in, refresh, logout, login companies, health, static files and SPA shell |

**The five project rules (from `CLAUDE.md`) the reviewer should hold the work against:**

1. **Backend authorization is authoritative.** Hiding a button is UX; every write path re-checks role and company
   scope server-side.
2. **The asset event ledger is append-only.** `lifecycle/service.py::apply_event(s)` is the only writer of
   `Asset.status` / `current_asset_user_id` / `status_since`. No hard deletes of business records (soft
   `is_active=false` only).
3. **No schema change without an Alembic migration**; never `create_all` at runtime.
4. **Test before commit** (backend pytest against the `ckam_test` DB only; frontend `tsc -b` + `vitest`); rebuild
   containers before browser checks.
5. **Commit locally; push only when the owner says so.** "Commit and push to git and main" = push only, never deploy.

### 2.2 Environments

| Role | Machine | Notes |
|---|---|---|
| Development | **10.0.0.47** (Windows 11 + Docker Desktop/WSL2) | All work and testing here. Stacks: `ckam-build` (owner's dev, web 3211), `ckam-uat`, `ckam-sec` (isolated security stack, web 3411 / API 8200 / PG 25442, 22→23 seeded personas across 2 companies), plus many throw-away projects |
| Production app | **10.0.1.98**, `D:\Citykart_Applications\Citykart_AssetManagement_App` | **Windows**, single **uvicorn** process on port 3211 serving API **and** built frontend ("single-port"); started by Task Scheduler task `CKAM-Web` running as **SYSTEM**; **no nginx, no Docker**; plain HTTP; router forwards TCP 3211 from the internet. Release folders `releases\<sha>\`, secrets in `shared\.env` and `shared\nas.pw`; launcher `shared\run_ckam_web.ps1` (not in git) |
| Production DB | **10.0.0.205**, PostgreSQL 18, database `ckassetmanagement`, role `ckassetapp` (owns all tables today; runs migrations) | Shared with other apps; nightly dump on the same server |
| Production files | NAS **10.0.0.25**, `\\10.0.0.25\ckapplications_data\CKASSETMANAGEMENT_DATA`, NAS user `ckappuser` | Shared NAS |
| ERP warehouse | **10.0.1.69**, read-only role `ckpost` | Owned by another team; CKAM copies PO data every 30 min |
| Retired | **10.0.1.12** | Must stay dead (task disabled, role cannot log in) |
| Shared | 10.0.1.98, 10.0.0.205 and the NAS also serve **Spinwheel** and **Citykart Desk** | Touch only CKAM's own objects |

### 2.3 Authentication and authorization model

- **Sign-in:** login id + password (no company selector). Argon2id. After 5 wrong passwords: locked 15 minutes
  (answers 423 for any password while locked).
- **Tokens:** 15-minute **access JWT** (HS256) kept by the SPA in `sessionStorage` and sent as `Authorization:
  Bearer`; 8-hour sliding **refresh JWT** in an `HttpOnly; SameSite=Lax; Path=/api/auth` cookie (not `Secure` —
  production is HTTP). After the programme every token carries the account's session version `tv` and the refresh
  token carries a session id `sid` + unique `jti`, checked against a server-side `auth_session` row (only SHA-256
  hashes stored).
- **Roles / access levels:** head-office admin ("Primary Owner", `is_primary_owner`), Full Admin (`ADMIN`), Can Add
  & Move Assets (operator), View Only, Own Assets Only (self-service; also every store login
  `sm.<code>@citykartstores.com`). **Scopes:** home company + "company access" list; work areas IT / Non-IT
  (`allowed_asset_domains`); custody (self-service sees only assets it holds). Full Admins currently see **all**
  companies (open decision D6/SD-02) but are limited by work area.
- **Audit:** `audit_log` (security, data, lifecycle, export, access events), `asset_event` (custody ledger),
  `asset_field_change`, `master_audit` — all append-only by triggers.

### 2.4 What was off-limits during the programme

Production hosts and their data; the ERP warehouse; the NAS; the retired 10.0.1.12; any other 10.x host; the
internet (except `npm audit` / `pip-audit` advisory lookups and, once, downloading font packages via npm for the
self-hosted fonts); real secrets and their rotation; Windows firewall / Task Scheduler / database-role changes on
any real machine; git writes by sub-agents (the lead committed); `docker up/build/down` on the owner's stacks
except where explicitly granted. One explicit owner exception: a portable Python was placed in a temp folder on
the dev PC (since deleted) to run CKAM **natively on Windows** with **fake** secrets for the IF-01 test.

---

## 3. Timeline and phases

| Date / time (IST) | Phase | Who / what ran | Output | Commits |
|---|---|---|---|---|
| 2026-10-14 | (pre-programme) | Owner deploys release `3b5e842` to 10.0.1.98; access logging (`app.jsonl`) starts in production | Production state still live today | `3b5e842` (deployed), `c66378d` (origin tip), `4ba4e94` (local UI fix) |
| 2026-10-15 a.m. | **Phase 0 — baseline** | Lead + writers | Threat model (STRIDE per component, trust boundaries), security baseline, attack-surface map (217 routes, OpenAPI dump) | docs later in `627ed73` |
| 2026-10-15 | **Phase 1 — VAPT** | **4 parallel tester agents**: access control; auth/session/web/logging; input/injection/XSS/files/frontend; infra/config/DB/deps/secrets | 636 CSV cases + ≈ 60 infra text checks; 1 Critical (IF-01), 1 High (IF-02), 14 Medium, 22 Low, 5 Info | — |
| 2026-10-15 16:43–18:31 | **Phase 2 — remediation** | Engineering agents, lead commits one logical commit per area | 9 fix commits | `3e134c1` `7e57844` `ba04371` `77431ba` `4fa5c9b` `ae706bb` `da790d1` `d04779a` `a3e8fce` |
| 2026-10-15 (between `ae706bb` and `d04779a`) | **Phase 3 — retest 1** | 2 retest agents on the rebuilt `ckam-sec` stack | 646 access cases (0 FAIL) + 310 auth/input/infra (8 FAIL → residuals and new N1–N4) | N1, N4, AU-08 follow-up fixed in `d04779a`; N2 Docker flag in `a3e8fce` |
| 2026-10-15 18:31 | **Phase 4 — compliance docs** | Writers | VAPT report, findings register, remediation report, ISO 27001 + SOC 2 readiness and control matrices, threat model, baseline, external actions EXT-01…40, evidence pack | `627ed73` |
| 2026-10-16 10:02 | **Phase 5 — closure register** | Auditor | Every finding/observation re-classified against the current code; work packages defined; single-file complete report | `3362c1b` |
| 2026-10-16 10:32–11:35 | **Phase 6 — closure work packages** | WP-A1 (backend), WP-D1/D2 (documents), WP-C (frontend/infra), WP-A2 (auth), WP-B (database) | IF-01-WIN, N6, IF-16 option, fail-closed env, import names; runbook/plans/decisions/15 draft policies; fonts, non-root containers, N3/N5, build checks, Windows scripts; refresh-reuse detection, atomic token version; lifecycle DB guard, role-split scripts + simulation | `7b039fb` `f746e71` `79dbae7` `69c3a51` `b401e9f` `734fd19` |
| 2026-10-16 (image from `d04779a`/`a3e8fce`) | **Phase 7 — closure retest 1** | 1 independent black-box tester | 137 cases: 133 PASS, 1 FAIL (CL1-N4-01), 2 PARTIAL, 1 OBS | evidence in `f746e71` |
| 2026-10-16 | **Native Windows test** | Lead, with the owner's approval (portable Python, fake canaries, production-style folder layout on the dev PC) | Old `4ba4e94`: 10/28 leaks; fixed `7b039fb`: 0/28 | evidence in `8664b77` |
| 2026-10-16 (stack at `734fd19`) | **Phase 8 — second independent retest + performance** | **3 tester agents** (access; infra; sessions + external concurrency burst) + 1 performance engineer | Access 319 (0 FAIL), infra 122 (6 FAIL → 4 new findings), sessions/burst 56 (0 FAIL, 3 LOW/INFO observations); performance 31 operations old vs new | evidence in `8664b77` |
| 2026-10-16 12:43–13:01 | **Phase 9 — WP-F, WP-F2** | Engineering agents | CL2-IF-01…04 + observations; CL2-SE-N01, N03 | `ca94574`, `fafa225` |
| 2026-10-16 13:13 and after | **Phase 10 — final regression** | Lead | Backend 2541 passed / 1 skipped; vitest 1257; tsc/build/check:build OK; Playwright 11+1 skip; security journeys 14/14; native Windows re-run on `fafa225`: 0/28 leaks | `fd34520` |
| 2026-10-16 (HEAD `fd34520`) | **Phase 11 — third independent retest** | 1 tester agent (did not write the fixes) | Re-attack of the six late fixes CL2-IF-04, CL2-IF-01, CL2-IF-02, CL2-IF-03, CL2-SE-N01, CL2-SE-N03 + regression sweep: ≈ 360 cases, 52/52 logged assertions PASS, 0 new findings; 1 DBA caveat, 1 coverage limitation | `closure/retest3/` (uncommitted at the time of writing) |
| 2026-10-16 | **Phase 12 — closure documents** | Writers | Final closure report, registers recounted (51 findings), ISO v1.1 / SOC 2 v1.1, EXT-44…50, SoA regenerated, this handover | uncommitted |

---

## 4. What was tested

### 4.1 Scope, method, stacks, personas, tools

**Plain:** testers acted like every kind of user (from a store login to the head-office admin) and like an outsider,
tried every web address the app has, and tried the classic attacks (stealing other companies' data, raising one's
own rights, injecting code, reading server files, guessing passwords, racing two requests). Then they did it again
after each round of fixes.

- **Method:** grey-box (source, configuration and test accounts available), authenticated and unauthenticated,
  structured on the OWASP Web Security Testing Guide and OWASP API Security Top 10 (2023); CWE on every case; CVSS
  only where evidence states it.
- **Stacks:** `ckam-sec` (isolated; `ENVIRONMENT_NAME=security-test`; nginx in front as in dev/UAT); throw-away
  **production-mode** containers of the same image (`ENVIRONMENT_NAME=production`, `FRONTEND_DIST_DIR` set,
  single-port uvicorn, often `--network none`, **fake canary** `shared/.env` and `shared/nas.pw`); `ckam-uat` for the
  permanent Playwright suite; `ckam-build` for pytest/vitest; many throw-away compose projects (`ckam-nr`,
  `ckam-r2c`, `ckam-pf-old/new`) removed afterwards.
- **Personas:** 22–23 seeded identities in two companies: head-office admin (`SECHO`), Full Admins per work area
  (`SECFAIT`, `SECFANIT`, `SECFABOTH`), operators (`SECOPIT`, `SECOP2IT`, `SECOPNIT`, `SECOPX` with cross-company
  grant), viewer (`SECVIEW`), self-service (`SECSELF`), store logins (`SPA`, `VPA`), second-company mirrors, locked,
  disabled, no-login and must-change accounts; plus throw-away employees created and soft-deactivated by testers.
  All share one throw-away test password (never a real one).
- **Tools:** Node.js `fetch` harnesses (matrix, IDOR, logic, bursts), bash + curl, Python inside containers (token
  crafting, raw-request probes, timing, races, big bodies, ERP stand-ins), Playwright (stored XSS, CSP violations,
  fonts, journeys), psql (privileges, triggers, role split in rolled-back transactions), `npm audit`, `pip-audit`,
  `pip freeze`, ripgrep / `git log -S/-G` secret scan, PowerShell parser + `-WhatIf` for Windows scripts,
  `pg_stat_statements` for performance.

### 4.2 Campaign inventory

Counts are **test cases (rows)**, not unique risks; one risk is usually probed by several cases.

| # | Campaign | Area | Cases | Result | Evidence |
|---|---|---|---|---|---|
| 1a | VAPT (initial) | Access control: 217 routes × 11 personas (2,387 cells), IDOR/BOLA, escalation, mass assignment, business logic | 467 | 451 PASS, 15 FAIL, 1 N/A | `access/tests.csv`, `access/authz_matrix.csv`, `access/findings.csv` |
| 1b | VAPT | Auth, sessions, headers, CSRF/CORS, logging/audit | 102 | 68 PASS, 25 FAIL, 9 INFO | `auth/tests.csv`, `auth/audit_coverage.csv`, `auth/t*.sh` |
| 1c | VAPT | Input: SQLi, XSS, formula injection, uploads, traversal, SSRF/cmd-injection code search | 67 | 59 PASS, 2 FAIL, 4 INFO, 2 N/A | `input/tests.csv`, `input/raw_sql_review.md`, `input/xss_results.json` |
| 1d | VAPT | Infra / config / DB / deps / secrets (text, no CSV) | ≈ 60 checks | IF-01 reproduced (Critical); DB guard gaps; deps | `infra/*.out.txt`, `infra/static_route_traversal_and_startup.txt`, `infra/dependency_audit.md` |
| 2a | Retest 1 | Access (full matrix again, IDOR 208, fixes, sessions, uploads) | 646 (616 unique ids) | 643 PASS, 0 FAIL, 2 INFO, 1 N/A; 13 matrix cells changed, all intended | `retest/retest_access.md`, `retest/retest_tests.csv`, `retest/access_raw/` |
| 2b | Retest 1 | Auth / input / infra | 310 | 280 PASS, 8 FAIL, 22 INFO → N1–N4 found | `retest/retest_auth_input_infra.md`, `retest/retest_tests2.csv`, `retest/aii_raw/` |
| 3 | Closure retest 1 (black-box, late fixes N1, N4, AU-08, RACE-1, IF-01 incl. Windows-style strings on Linux, files, secrets) | Mixed | 137 | 133 PASS, 1 FAIL (CL1-N4-01), 2 PARTIAL, 1 OBS | `closure/retest1/RETEST1.md`, `tests.csv`, `raw/` |
| 4 | Native Windows IF-01 | 28 path payloads × 3 releases (`4ba4e94`, `7b039fb`, `fafa225`) | 84 runs | Old 10 leaks / new 0 / final 0; 0 5xx | `closure/windows/*.txt`, `attack.mjs` |
| 5a | Retest 2 — access | 217 routes × 14 identities (3,038 cells), IDOR, mass assignment, WP-B guard via API and DB, uploads, SQLi, XSS (browser), formula, logic | 319 | 318 PASS, 1 OBS, 0 FAIL; 0 escalations | `closure/retest2/access/RETEST2_ACCESS.md`, `authz_matrix.csv` |
| 5b | Retest 2 — infra | Containers, fonts/CSP, headers, XFF, start-up guard (121 combos), DB guards, role split (~70 break-outs), deps, secrets | 122 | 106 PASS, 6 FAIL (→ CL2-IF-01…04), 2 PARTIAL, 8 INFO | `closure/retest2/infra/RETEST2_INFRA.md` |
| 5c | Retest 2 — sessions + concurrency | Refresh reuse, revocation ×8 triggers, rate limits, lock-out, password policy, size limits + RSS, timing; 13 external burst scenarios | 56 | 56 PASS; 3 observations (CL2-SE-N01…N03) | `closure/retest2/sessions/RETEST2_SESSIONS.md`, `concurrency_results.md` |
| 6 | Performance | 31 operations, old `4ba4e94` vs new `734fd19`, identical seeded data | 31 ops (×15–30 samples, repeat run) | None over threshold | `closure/perf/PERF_REPORT.md` |
| 7 | DB role-split simulation | Disposable DB, owner/migrator/runtime roles | 7 CAN + 40 CANNOT; verify 45/45; 34 checks | All as designed (then CL2-IF-01/02 found by retest 2, fixed) | `closure/db/WPB_RESULTS.md`, `rs_0*.out.txt` |
| 8 | WP-C proofs (by the implementer, not independent) | Fonts, non-root, N3/N5 headers, build checks, Windows script parse/dry-run | ≈ 35 `CL-WPC-` ids | All pass (PSScriptAnalyzer not run) | `closure/infra/WP-C_closure_evidence.md` |
| 9 | **Retest 3** (third independent retest, HEAD `fd34520`) | CL2-IF-04 single-port incl. route-looking canary files and ≈ 45 traversal payloads; CL2-IF-01/02 role split on a fresh DB (all 32 sequences, ≈ 45 break-outs, stored defaults, reset); audit-write failure visibility; CL2-IF-03 request ids; CL2-SE-N01 and N03 20-parallel races + imports; regression sweep incl. move and receive (detail in 5.2/5.3) | ≈ 360 (52 logged assertions) | **52 PASS, 0 FAIL, 0 new findings**; 1 DBA caveat (migrator INHERIT), 1 coverage limitation (OBS-STATUS direct UPDATE on an empty DB) — see 5.3 | `closure/retest3/RETEST3.md`, `tests.csv`, `raw/` |

**Recorded cases in the four attack rounds:** 636 + 956 + 137 + 497 = **2,226**, plus **≈ 360** in retest 3 (52 logged
assertions) (+ ≈ 60 infra text checks, 84 native Windows probe runs, ≈ 35 implementer proofs).

### 4.3 What each family of attack covered

| Family | What was tried | Result on the final code | Depth / caveats |
|---|---|---|---|
| Access control / IDOR / BOLA | Every route × every identity; object ids across companies, work areas and custody; sub-routes; idempotency keys across actors | 0 escalations in 2,387 (initial), 3,038 (final) cells; IF-03, AC-1, AC-2 found and fixed | Full Admin cross-company is **by design** pending D6 |
| Mass assignment | `status`, `current_asset_user_id`, `status_since`, `is_active`, `id`, `token_version`, `is_primary_owner`, `password_hash`, role/company/work-area in bodies and query | All ignored; lifecycle fields additionally refused by a DB trigger | — |
| Authentication | Status/timing enumeration, lock-out + its race, rate limits, Primary-Owner login clash, must-change flow, disabled/locked/no-login states | AU-01/03/16, PO-LOGIN fixed; AU-02 accepted; AU-04 decision | Timing medians within 3.8 ms (0.6 ms across refused states) |
| JWT / session | `alg:none`, HS384/512, RS256/ES256 confusion, DER-key HS256, signature flips, expired/legacy tokens, revocation on 8 triggers, refresh rotation, reuse, 20 parallel refreshes | All refused/handled; AU-05/06/07 fixed | HS256 pinned; legacy (pre-deploy) tokens accepted once by design |
| Passwords | Common lists, sequences, brand+digits, name/code/e-mail and look-alikes, common word + digits/symbols | 40-entry refused list + live API tests pass; long passphrases accepted | No composition rule (by design, NIST-style) |
| Brute force | 171 failures from one address (initial) | Now 20/min/IP, 10/min/login id, 429 + audit row | In-process, single-process limiter |
| SQL injection | Sort/search/numeric/filter params on assets, vendors, items, POs, ERP, logs; raw-SQL review | 0 × 500, no leak | Whitelisted sort, bound params, escaped LIKE |
| XSS | Stored payloads in names/descriptions rendered by Playwright on every major screen; CSP violation listener | Inert, 0 CSP violations, 0 page errors | `style-src 'unsafe-inline'` kept (OBS-CSP-STYLE) |
| Formula injection | `=cmd…` in vendor names exported to Excel | Stored as apostrophe-prefixed inline string, never a formula | — |
| CSRF / CORS / clickjacking / headers | Foreign and `null` origins, cookie flags, CSP, Permissions-Policy, XFO, nosniff, Referrer-Policy, duplicate headers | CORS refuses foreign/null; headers exactly once (N5 fixed); `frame-ancestors 'self'` | Refresh cookie `SameSite=Lax`, not `Secure` (AU-13, needs HTTPS) |
| File upload / path traversal | Extension/content spoofs, polyglots, empty, oversize, `CON.pdf`, traversal in filename; `/assets/…` traversal (Linux + Windows forms) | IF-01, IN-02, IN-03 fixed; polyglot accepted but served as attachment + nosniff (OBS) | Windows native only for the static route |
| SSRF / command injection / deserialization | Code search for outbound HTTP, `subprocess`, `eval`, pickle/yaml loads | No sinks | Code reading only |
| Business logic | Double scrap, move terminal asset, cross-company move, duplicate PO number, receive cancelled PO, over/negative receive | All refused (422/409) | — |
| Races / concurrency | 13 external bursts of 10–30 parallel requests (PO number, receive 6-unit line ×20, idempotency key, serial, batch, sold twice, moved to two holders, same names, auth storm, parallel refresh, create+deactivate+receive) | No duplicates, no over-receipt, no 500, no deadlock; Category race and serial message found and fixed | Run against the local stack only |
| Rate limiting / DoS | Sign-in/refresh/change-password limits; 256 MB bodies, chunked, malformed Content-Length, slow body; RSS | 413 before read; RSS flat; limits hold with forged XFF | AU-04 lock-out DoS remains (decision) |
| Sensitive data exposure | Tokens/passwords/cookies in DB, logs, audit, errors, diagnostics; `repr(Settings)` | None found; `repr=False` on DB URL, JWT secret, ERP password | — |
| Secrets | Regex scan of tree, 299 commits, built dist, 14 image histories, container env key names | No real secret in git/images | **Regex only** (no gitleaks/trufflehog available); PNGs not OCR'd |
| Dependencies / supply chain | `npm audit` (prod and full), `pip-audit` on pinned set, lock files, reachability of advisories | npm prod 0; dev-only HIGH `source-map-js`; `python-jose`/`ecdsa` advisories not reachable (ACCEPTED) | No container OS-package CVE scan; no SBOM |
| Frontend | Source maps, `.map` paths, external resources, sessionStorage on sign-out, Back button after sign-out, deep links per role | 0 maps; 0 external hosts; journeys pass | — |
| Error handling | 17 malformed requests; unknown `/api`; docs paths | 4xx with request id, no stack/SQL/path; JSON 404 | — |
| Logging / audit | Coverage of 122 write routes; failure visibility; forged IPs | 107 audited, 15 intentionally not, 0 forgotten; audit-write failures now counted and re-reported | Diagnostics screen does not show the count yet |
| Database security | Roles, privileges, triggers, TRUNCATE, purge flag, replica mode, DISABLE TRIGGER, `setval`, role defaults | Guards hold for non-owner roles; role split proven on a disposable DB | Production role split not done (EXT-07); dev app role is a superuser |
| Configuration | Start-up guard matrix (121 env-name × secret combos), docs exposure, env fail-closed | All refuse/start as designed | — |
| Docker (dev/UAT only) | uid, capabilities, NoNewPrivs, writable paths, volume hand-over, symlink attack on `volume-init` | Non-root, 0 caps, tmpfs `noexec` | Production does not use Docker |
| Production architecture | **Documents only**: launcher, Task Scheduler as SYSTEM, port forward, shared servers, backups | Findings IF-02, IF-07, IF-08, IF-15 | Never inspected on the servers |
| HTTPS | Not testable (no TLS in production or test stacks) | Plan only | — |
| Backups | Documents only | IF-08 open; plan prepared | No restore test anywhere in production |
| ERP integration | Cross-company drafts, timeouts (black-hole listener, `pg_sleep`), read-only transaction, TLS modes against a plain-text stand-in | IF-03, IF-10 fixed; TLS option available | Real ERP never contacted |
| Privacy | Personal data in audit rows, retention, third-party font requests | FONTS fixed (no Google requests); retention is a legal decision (SD-09) | No legal review done |

### 4.4 Limitations (explicit)

1. **Production never touched.** Every production statement is inferred from code, documents and local
   reproduction. Phase 7 of the runbook is the only production proof that will count.
2. **Windows:** only the IF-01 static route was tested natively on Windows, on the **dev PC**, with a portable Python
   (version not recorded in the evidence) — not on 10.0.1.98. NTFS junctions, real 8.3 aliases and SMB lookups were
   not exercised (they are refused lexically before any filesystem call; proven by monkeypatched tests on Linux).
   Fonts, body limits, rate limits, sessions, NAS mapping and the reference PowerShell scripts were not run under
   the real Windows service.
3. **Real ERP never contacted**: TLS and timeouts proven with stand-ins only.
4. **HTTPS not tested** anywhere.
5. **Secret scan is regex-only**; container OS packages not CVE-scanned; no SBOM.
6. **Least privilege** proven on disposable databases (PG 17), not on the dev stack (its app role `ckam` is a
   superuser) and not on PG 18.
7. **WP-F / WP-F2** (the last fixes, including a new branch in the static-file route) were re-attacked by the **third
   independent retest** (52/52 PASS, 0 new findings). Its own limits: the direct `UPDATE asset SET status …` as the
   runtime role was **inconclusive** (fresh database, no asset rows, so the trigger was not exercised; the guard was
   verified present and enabled by `role_split_verify.sql`, and the app-level tests in
   `tests/lifecycle/test_obs_status_guard.py` plus retest 2 cover its behaviour); and it surfaced a **DBA caveat**:
   `role_split.sql`'s idempotent "already a member" guard does not correct a **pre-existing** migrator role whose
   membership already has `INHERIT` (the documented runbook path creates the migrator fresh and is unaffected).
8. **Independence:** all testers, including every retest round, are AI agents working under the same lead and
   brief as the engineers; this is not an independent third-party test (EXT-14 / SD-10).
9. Mass lock-out across many accounts was **calculated** (≈ 60 accounts per address), not executed.
10. Concurrency bursts ran against a local Docker stack on one machine; production has a networked database.

---

## 5. Findings catalogue

### 5.1 Summary by severity × status (how counted)

**Counting rules.** The universe is **51 findings**: the 43 of the first findings register (after merging duplicates
**IN-01 = IF-01, AU-09 = IF-04, AU-10 = IF-05, AU-11 = IF-14**, and "Primary-Owner login clash" = PO-LOGIN) plus the
8 raised later: **CL1-N4-01, CL2-IF-01, CL2-IF-02, CL2-IF-03, CL2-IF-04, CL2-SE-N01, CL2-SE-N02, CL2-SE-N03**.
Observations (`OBS-`, N5–N9, CL1-OBS-, CL2-IF-OBS-) are **not** counted; they are listed in 5.4. Severity as rated by
the finder; CL1-N4-01 ("Low–Medium") counted at the higher value MEDIUM; **CL2-IF-04** ("functional MEDIUM, security
INFO") counted at its **security value INFO** and described separately as a functional bug (it is also live in
production). Each finding sits in exactly one column. **IF-01 is counted EXTERNAL**: its code is fixed and retested,
but production also needs the deploy, secret rotation and a compromise check. "FIXED" always means **local, not
deployed**. These are exactly the counting rule and numbers of `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` §B.2 and the
findings register.

| Severity | Found | FIXED (local) | MITIGATED | ACCEPTED | Remaining code | EXTERNAL (of which DECISION) |
|---|---|---|---|---|---|---|
| CRITICAL | 1 | 0 | 0 | 0 | 0 | 1 (0) |
| HIGH | 1 | 0 | 0 | 0 | 0 | 1 (0) |
| MEDIUM | 16 | 10 | 2 | 0 | 0 | 4 (1) |
| LOW | 25 | 18 | 2 | 2 | 0 | 3 (0) |
| INFO | 8 | 4 | 0 | 1 | 0 | 3 (2) |
| **Total** | **51** | **32** | **4** | **3** | **0** | **12 (3)** |

IDs per cell: CRITICAL EXT IF-01 · HIGH EXT IF-02 · MEDIUM FIXED IF-03, IF-04, IF-10, AU-01, AU-03, AU-05, AC-1, N1,
CL1-N4-01, CL2-IF-01; MITIGATED IF-05, IF-06 (EXT-07); EXT IF-07, IF-08, IF-09 + DECISION AU-04 (SD-06) · LOW FIXED
IF-13, IF-14, AU-06, AU-07, AU-08, AU-12, AU-14, AU-15, AU-16, AC-2, IN-02, N3, N4, PO-LOGIN, RACE-1, CL2-IF-02,
CL2-SE-N01, CL2-SE-N03; MITIGATED IF-11 (EXT-12), IF-15 (EXT-13); ACCEPTED IF-12, AU-02; EXT IF-16, AU-13, N2 · INFO
FIXED IN-03, FONTS, CL2-IF-03, CL2-IF-04; ACCEPTED CL2-SE-N02; EXT IF-17 + DECISION D6 (SD-02), MFA (SD-03).

- **Open EXTERNAL excluding decisions (9):** IF-01, IF-02, IF-07, IF-08, IF-09, IF-16, AU-13, N2, IF-17.
- **Fixed locally but effective only after a DBA step beyond the deploy (2):** CL2-IF-01, CL2-IF-02 (EXT-07/EXT-45).
- **Verification of the 32 FIXED:** every one has now been re-attacked by an independent retest agent — 26 in the
  earlier retests and the six late WP-F/WP-F2 fixes (CL2-IF-01, -02, -03, -04, CL2-SE-N01, -N03) in **retest 3**
  (52/52 PASS) — on top of permanent tests.

**Status movement since the first register (2026-10-15, 43 findings):** the first register had 22 FIXED + IF-01
"FIXED (code)", 4 MITIGATED, 3 ACCEPTED, 10 OPEN EXTERNAL, 3 OPEN. Closure moved AU-06 MITIGATED→FIXED; IF-13,
FONTS OPEN→FIXED; N3 ACCEPTED→FIXED; IF-15 OPEN→MITIGATED (reference scripts done, EXT-13 left); IF-11
FIXED→MITIGATED (production must install with the lock file, EXT-12); AU-04 MITIGATED→DECISION REQUIRED; D6/MFA
stay EXTERNAL as decisions.

### 5.2 One row per finding

Columns: **Verified** = how the fix was checked (IR = independent retest by a separate agent; IR3 = third
independent retest, `closure/retest3/`; PT = permanent test in the repository; WIN = native Windows run; RD = code
reading). **Prod** = production status today. Status words follow 5.1 (EXTERNAL rows say OPEN EXTERNAL or DECISION).

#### CRITICAL / HIGH

| ID | Sev | What it was (plain) | Fix (where, commit) | Verified | Status | Prod |
|---|---|---|---|---|---|---|
| IF-01 (= IN-01) | CRITICAL | Anyone could read any server file through `/assets/…` on the single-port server (secrets, `win.ini`) | `backend/app/main.py::_serve_frontend_asset` + new `backend/app/core/static_safety.py` (`3e134c1`, `7b039fb`, `ca94574`) | IR ×4 (incl. IR3 ≈ 45 payloads), WIN 0/28, PT (~80 payloads + "no filesystem call" test) | OPEN EXTERNAL (code FIXED) | **STILL VULNERABLE** |
| IF-02 | HIGH | Sign-in and all data in plain HTTP, also over the internet | None in code; HTTPS plan | Not testable | OPEN EXTERNAL (EXT-04/05, SD-04/05) | Vulnerable |

#### MEDIUM

| ID | What it was (plain) | Fix (where, commit) | Verified | Status | Prod |
|---|---|---|---|---|---|
| IF-03 | A CKSPL operator could open CKVPL's ERP PO draft (supplier, rates), and the reverse | `erp/service.py::build_draft` raises `NotAllowed`; router answers the same 404 as a missing PO (`7e57844`) | IR (RT-AC-T713…T729, RT-AU-T601…T608; CL2 IDOR), PT | FIXED | Vulnerable until deploy |
| IF-04 (= AU-09) | Production started with the committed placeholder JWT secret | `main.py::refuse_to_start_with_insecure_secret`: placeholder, < 32 chars or < 8 distinct chars → refuse; message names all rules (`7e57844`, `d04779a`, `7b039fb`) | IR (RT-AU-T901…T913; CL1; CL2 72/72 refusals), PT | FIXED | Depends on today's secret (EXT-39 checks) |
| IF-05 (= AU-10) | One `TRUNCATE` could empty an append-only ledger | Statement-level `BEFORE TRUNCATE` trigger on the 4 ledgers (migration `a3c5e7f9b1d4`, `ae706bb`); role-split scripts (`734fd19`, `ca94574`) | IR (RT-AU-T98xx; CL2 6a/6b), PT, DB simulation | MITIGATED (table owner/superuser can still disable triggers until EXT-07) | Vulnerable |
| IF-06 | Any role could set the purge flag and delete fresh audit rows | Purge allowed only for rows older than a fixed 5-year floor (same migration) | IR, PT | MITIGATED (owner bypass until EXT-07) | Vulnerable |
| IF-07 | CKAM runs as SYSTEM on a server shared with two other apps | Plan `CKAM_SERVICE_ACCOUNT_PLAN.md` | n/a | OPEN EXTERNAL (EXT-06) | Applies |
| IF-08 | Backups on the DB server only, unencrypted, never restore-tested | Plan `CKAM_BACKUP_RESTORE_PLAN.md` | n/a | OPEN EXTERNAL (EXT-08) | Applies |
| IF-09 | Dev PC `.env` (real ERP password, dev JWT) and 36 dumps (real ERP vendor/PO data) readable **and modifiable** by any local account; same for the whole source tree | Inspection + lock-down plan `closure/infra/IF-09_ACL_PLAN.md`; **nothing changed** | `icacls` re-check 2026-10-16 | OPEN EXTERNAL (EXT-10) | n/a (dev PC) |
| IF-10 | ERP reads had no timeouts (a slow ERP hangs requests) | Connect 10 s, statement 60 s (copy 120 s), READ ONLY transaction, `application_name` (`ae706bb`) | IR (RT-AU-T970…T979, black-hole and `pg_sleep` stand-ins), PT | FIXED | Vulnerable until deploy |
| AU-01 | Timing revealed which login ids exist (42 vs 7 ms) | Dummy Argon2 check on every refused sign-in (`ae706bb`) | IR (RT-AU-T990…T996; CL2 A7: medians within 3.8 ms) | FIXED | Vulnerable until deploy |
| AU-03 | 171 failed sign-ins never blocked; `X-Forwarded-For` spoof evaded the lock | `core/rate_limit.py` (20/min/IP, 10/min/login id, refresh 60, change-password 10; 429 + `RATE_LIMITED` audit row) (`ae706bb`) | IR (RT-AU-T1002…T1011; CL2 A3), PT | FIXED | Vulnerable until deploy |
| AU-04 | Anyone who knows a login id can lock that person out for 15 min, repeatedly | None (options paper `closure/backend/AU-04_OPTIONS.md`) | IR (RT-AU-T313/T314; CL2 A4) | DECISION REQUIRED (SD-06) | Applies |
| AU-05 | Sign-out / password change / reset left old tokens valid | `asset_user.token_version` (`tv` claim), migration `f9a1c3e5b7d2` (`ae706bb`, `4fa5c9b`) | IR (RT-AU-T101…T115; CL2 A2: 8 triggers) | FIXED | Vulnerable until deploy |
| AC-1 | Store / self-service logins could read every setup list incl. vendor GSTIN and contacts (CVSS 4.3) | `require_role(*READ_ROLES)` on setup lists (`77431ba`) | IR (44×403, 55×200; matrix diff 13 cells; CL2 matrix) | FIXED | Vulnerable until deploy |
| N1 | Single-port server read a 256 MB unauthenticated body in full (uvicorn peak 914 MB) (CVSS 5.3) | `core/body_limit.py` ASGI middleware: 64 KB auth, 5 MB JSON, 16 MB multipart, chunked counted (`d04779a`) | IR (CL1 T001…T018 RSS flat; CL2 A6), PT | FIXED | Vulnerable until deploy |
| CL1-N4-01 (Low–Med) | `ENVIRONMENT_NAME` **unset** silently meant "development" (docs on, weak secret accepted) | Default is now `production` (`7b039fb`) | IR (CL2 infra item 5), PT | FIXED | Production sets the name explicitly (verify) |
| CL2-IF-01 | Planned runtime DB role could `setval` the ledger sequences → audit rows silently lost, moves blocked, not detected | `ops/db/role_split.sql` grants sequences `USAGE, SELECT` only; checks 19/20; audit-write failure counter (`ca94574`) | Implementer before/after repro + pytest negative controls; **IR3**: `setval`/`ALTER SEQUENCE` denied on all 32 sequences, verify 49/49, audit-failure reporting and repair exercised | FIXED (scripts, local) | n/a until EXT-07 / EXT-45 (today the app role owns everything anyway) |

#### LOW

| ID | What it was (plain) | Fix (where, commit) | Verified | Status |
|---|---|---|---|---|
| IF-11 | No Python lock file; production resolves versions at install | `backend/constraints.txt`; Dockerfile and deploy template use `-c` (`ae706bb`, `79dbae7`) | `pip freeze` identical to audited set | MITIGATED (EXT-12: production install must use it) |
| IF-12 | `python-jose` (HS256 forgery advisory) and `ecdsa` (timing) — no fixed versions | None; HS256 pinned; `tests/auth/test_jwt_algorithm_pinned.py` | IR (CL2: 6 forged tokens 401) | ACCEPTED (not reachable; PyJWT migration recommended) |
| IF-13 | Dev/UAT image ran as root with test tooling | Multi-stage `backend/Dockerfile` (uid 10001, `runtime` target without tests), `volume-init`, `cap_drop: ALL`, `no-new-privileges`, tmpfs `noexec` (`79dbae7`, `ca94574`) | IR (CL2 T001…T018), implementer CL-WPC-10…19 | FIXED (dev/UAT only) |
| IF-14 (= AU-11) | `/docs`, `/redoc`, `/openapi.json` open in production | Off in production; JSON 404 where off (`ae706bb`, `d04779a`, `b401e9f`) | IR (CL2 access + infra), PT | FIXED |
| IF-15 | Production launcher/release script not in git; runbook described Docker | `ops/windows/` reference scripts (launcher, deploy, verify, rollback) + runbook sections (`79dbae7`, `ca94574`) | PowerShell parser + `-WhatIf` dry runs only | MITIGATED (EXT-13: compare/replace the live launcher) |
| IF-16 | ERP link without TLS; SELECT-only grant not evidenced | `PO_SOURCE_SSLMODE` / `PO_SOURCE_SSLROOTCERT` (default `prefer` = unchanged) (`7b039fb`) | PT (plain-text stand-in refused for require/verify modes) | OPEN EXTERNAL (EXT-25, ERP owner) |
| AU-02 | Locked account answers 423 → a stranger learns the id exists and is locked | Kept: 423 for any password, so the lock is not a password oracle | IR (RT-AU-T301/T302; CL2 A4), PT | ACCEPTED |
| AU-06 | Rotated refresh token stayed valid (copied cookie usable 8 h) | Server-side `auth_session` (hashed jti), rotate-once, 10 s grace, reuse ⇒ all sessions ended + `REFRESH_REUSE` row (migration `b5d7f9a1c3e5`, `69c3a51`) | IR (CL2 A1 15/15, burst h), PT (24) | FIXED |
| AU-07 | Switching sign-in off / access changes took effect only at next refresh | Per-request check + version bump (`ae706bb`) | IR (RT-AU-T120…T133; CL2 A2) | FIXED |
| AU-08 | Only a length rule for passwords | `auth/password_policy.py` (common, sequences, brand+digits, own name/code/e-mail and look-alikes, common word + digits/symbols) (`ae706bb`, `d04779a`, `7b039fb`) | IR (CL1 19 refused/2 accepted; CL2 A5 13 refused), PT | FIXED |
| AU-12 | `.map` paths answered 200 (SPA fallback) | nginx `.map` → 404, `sourcemap: false`, `check:build`, nginx config tests (`4fa5c9b`, `79dbae7`) | IR, PT | FIXED |
| AU-13 | Refresh cookie not `Secure` | `COOKIE_SECURE=true` once HTTPS exists | — | OPEN EXTERNAL (with IF-02) |
| AU-14 | No CSP / Permissions-Policy | CSP without `unsafe-eval`/inline script, `'self'` only; zod `jitless` (`4fa5c9b`, `ae706bb`, `b401e9f`) | IR (Playwright 0 violations, 3 personas), PT | FIXED |
| AU-15 | Version banners, HTML 413, no cap without nginx | `server_tokens off`, JSON 413, N1, `--no-server-header` (`4fa5c9b`, `d04779a`, `ca94574`) | IR (CL1, CL2) | FIXED |
| AU-16 | 20 parallel wrong guesses got past the lock threshold | One atomic `UPDATE … RETURNING` counting only while not locked (`ae706bb`) | IR (RT-AU-T1001; CL2 A4), PT | FIXED |
| AC-2 | Custom-field definitions of every company listed to any staff login | Filter by `scoped_company_ids` (`77431ba`) | IR, PT | FIXED |
| IN-02 | Excel imports read whole into memory, no cap | `core/uploads.py::read_upload_bounded` 1 MB pieces, 413 above 15 MB (`ba04371`) | IR, PT | FIXED |
| N2 | uvicorn by default believes `X-Forwarded-For` from 127.0.0.1 → local process escapes rate limit / forges audit IP | `--no-proxy-headers` in Dockerfile and reference launcher; tests (`a3e8fce`, `7b039fb`) | IR (CL2 T047…T052), PT | OPEN EXTERNAL (EXT-38: the live launcher) |
| N3 | Docker: every browser user shared nginx's address and one 20/min bucket | nginx overwrites XFF with `$remote_addr`; API trusts only nginx's fixed IP (`79dbae7`) | IR (CL2), CL-WPC-20…26 | FIXED (dev/UAT only) |
| N4 | Production protections applied only to exact names `production`/`prod` | Allow-list of non-production names; anything else = production (`d04779a`) | IR (CL1, CL2), PT | FIXED |
| PO-LOGIN | An employee code equal to the Primary Owner's name blocked the head-office login | Exact-name precedence (`77431ba`) | IR (RT-AU-T311/T312), PT | FIXED |
| RACE-1 | 10 parallel same-name brand creates made 2 rows | Transaction advisory lock on (table, name); also in Excel import (`da790d1`, `7b039fb`) | IR (CL1 T069…T077; CL2 burst f), PT | FIXED |
| CL2-IF-02 | Planned runtime role could store its own defaults (e.g. read-only) → persistent outage, undetected | `role_split.sql` `RESET ALL`; check 21 / verify 12 FAIL on any stored setting (`ca94574`) | Implementer repro + pytest; **IR3** (4 stored defaults all reported by check 21; stored `role=owner` rejected at login; superuser reset restores writes) | FIXED (detection + reset; cannot be prevented in PostgreSQL) |
| CL2-SE-N01 | 20 parallel Category creates → 3 active rows with one name | Scoped advisory lock + active-name check per work area (sub-categories per category), also in imports (`fafa225`) | PT (20-parallel → exactly 1); **IR3** (20-parallel by two personas → 201×1 / 422×19; variants; other area allowed; out-of-area 403; rename; Excel import) | FIXED |
| CL2-SE-N03 | Same-serial race loser got bare 409 "This record already exists." | `core/errors.py` `CONSTRAINT_REFUSALS`: serial index → 422 plain sentence (`fafa225`) | PT (3 bursts of 20 → 1 success, 19×422); **IR3** (201×1 / 422×19, no 409/5xx; variants → 1 asset) | FIXED |

#### INFO (CL2-IF-04 counted here at its security value; it is also a functional bug)

| ID | Sev | What it was (plain) | Fix | Verified | Status |
|---|---|---|---|---|---|
| IN-03 | INFO | Uploaded documents checked by extension only; browser-claimed type stored | Signature check per type; served type from extension (`ae706bb`) | IR, PT | FIXED (polyglot residual = OBS-POLYGLOT) |
| IF-17 | INFO | No CI, unsigned commits, single author, personal-account remote | — | — | OPEN EXTERNAL (EXT-28) |
| D6 | INFO | Full Admins not limited to chosen companies | — | Retest shows designed behaviour | DECISION REQUIRED (SD-02) |
| MFA | INFO | No second factor anywhere | — | — | DECISION REQUIRED (SD-03) |
| FONTS | INFO | Every page load fetched fonts from Google (user IP to Google; CSP allowed 2 outside hosts) | Self-hosted Inter + IBM Plex Mono (latin, latin-ext); CSP `'self'` only (`79dbae7`, `b401e9f`) | IR (CL2: 0 foreign requests, 3 personas, 41 steps) | FIXED |
| CL2-IF-03 | INFO | No `X-Request-ID` on answers nginx serves itself (dev/UAT) | nginx `add_header X-Request-ID` + conditional map for `/api/` (`ca94574`) | Implementer live check 11/11, PT; **IR3** (exactly one id on static/SPA/404/`.map`/413/API; 500-char and CRLF client ids replaced by a server id) | FIXED |
| CL2-SE-N02 | INFO | Malformed `Content-Length` refused 400 by the HTTP parser before the 413 branch (branch unreachable) | None needed | IR | ACCEPTED |
| CL2-IF-04 | INFO (functional MEDIUM) | Single-port server answered `/assets/<id>` (Asset 360 deep link) and `/assets/new` with a JSON 404 | Extension-less 1–3-segment names under `/assets/` return the SPA shell after the lexical check (`ca94574`) | PT (31 cases incl. real route table); **IR3** (shell for app routes, route-looking canary files never served, ≈ 45 traversal payloads 404, 0 leaks) | FIXED (bug **also in production `3b5e842`**) |

### 5.3 Narratives (Critical, High, Medium, functional)

#### IF-01 — unauthenticated arbitrary file read (CRITICAL) — full walkthrough

**Plain:** the part of CKAM that hands out the website's own files (pictures, scripts) did not check whether the
requested file was really inside the website folder. A specially written address walks out of the folder and
fetches anything on the disk. Nginx in the Docker test stacks happened to block this, which is why ordinary testing
never saw it; production has no nginx.

**Before** (`4ba4e94`, and live `3b5e842`):

```python
candidate = dist_dir / "assets" / file_path      # file_path comes straight from the URL
if not candidate.is_file():
    raise HTTPException(status_code=404)
return FileResponse(candidate)
```

- Linux production-layout container (fake canaries): `GET /assets/..%2f..%2f..%2f..%2fshared%2f.env` returned the
  settings file; `/assets//etc/passwd` and `/assets/%2fetc%2fpasswd` returned system files
  (`infra/static_route_traversal_and_startup.txt`).
- **Native Windows, old code (`closure/windows/native_windows_old_release_4ba4e94.txt`)**, production folder layout
  `<root>\releases\<sha>\frontend-dist`, fake `shared\.env` / `shared\nas.pw`:

| Payload family (examples) | Old `4ba4e94` | Fixed `7b039fb` | Final `fafa225` |
|---|---|---|---|
| Backslash traversal `..%5c..%5c..%5c..%5cshared%5c.env`, encoded `%2e%2e%5c`, forward `..%2f`, mixed | **4 LEAK** (fake JWT_SECRET) | 404 | 404 |
| `nas.pw` via `..%5c` | **LEAK** | 404 | 404 |
| Absolute drive path to `shared\.env` (backslash and forward) | **2 LEAK** | 404 | 404 |
| `C:%2fWindows%2fwin.ini`, `C:%5cWindows%5cwin.ini` | **2 LEAK** (real `win.ini`) | 404 | 404 |
| UNC admin share `%5c%5clocalhost%5cC$%5cWindows%5cwin.ini` | **LEAK** (UNC opened via SMB to localhost) | 404 | 404 |
| Double-encoded, leading `//C:/`, UNC-like, drive-relative `C:win.ini`, reserved names `CON`/`nul.txt`/`aux.js`, 8.3 `OK~1.JS`, NUL byte, 5,000-char name, sibling prefix | 404 | 404 | 404 |
| `ok.js::$DATA`, `ok.js.` (trailing dot), `ok.js%20` (trailing space), `..%5cindex.html` | 200 (served the harmless real file — shows Windows name normalisation) | 404 | 404 |
| **Summary** | **10 / 28 leaks**, 0 × 5xx | **0 / 28**, 0 × 5xx | **0 / 28**, 0 × 5xx |

**Why it matters beyond CKAM (inferred, not tested on production):** the process runs as SYSTEM, so any file SYSTEM
can read on 10.0.1.98 is reachable — including other apps' configuration on that shared server. The UNC result also
shows the old code makes the server open SMB connections to a host named in the URL; pointed at an outside host,
that can leak the server's machine-account NTLM credentials. With `shared\.env` an attacker gets the JWT signing
key (forge any user, no LOGIN audit row), the database URL/password (`ckassetapp` owns all tables → can disable the
audit triggers), the ERP read-only password, and the NAS password.

**Change** (three commits):
1. `3e134c1` (2026-10-15): resolve the candidate and require `is_relative_to(<dist>/assets)`.
2. `7b039fb` (closure WP-A1, IF-01-WIN): new `backend/app/core/static_safety.py`. `is_safe_relative_name()` is
   **purely lexical, no filesystem call**: refuses backslash, NUL, colon (drive/ADS), leading `/`, empty / `.` /
   `..` / dot-leading segments, a segment ending in dot or space, Windows device names (any case, with extension),
   8.3 `~digit`, any character outside `[A-Za-z0-9._~-]`, > 200 chars, and anything `PureWindowsPath` sees as
   drive/root/anchor/`..`. Only then `safe_asset_path()` joins, resolves, requires the result and its `realpath`
   inside the folder, refuses any symlink/junction component pointing outside, and requires `is_file()`. Every
   refusal is the same plain 404.
3. `ca94574` (WP-F, CL2-IF-04): after the lexical check, an extension-less 1–3-segment name returns the SPA shell
   (see CL2-IF-04 below).

```python
if not is_safe_relative_name(file_path):          # IF-01-WIN: text only, before any disk access
    raise HTTPException(status_code=404)
if _ASSETS_APP_ROUTE.fullmatch(file_path):        # CL2-IF-04: /assets/<id>, /assets/new -> app page
    return _spa_shell(dist_dir)
candidate = safe_asset_path(dist_dir / "assets", file_path)   # resolve + containment + link check + is_file
```

**After:** retest 1 (Linux, 36 probes × 2: all 404, 0 leaks); closure retest 1 (Linux + Windows-style strings, all
404); retest 2 access (23 payloads in a production-mode container incl. ADS, `CON`, 8.3, UNC, symlink-out: identical
404 body, 0 canary leaks, 0 × 500); native Windows 0/28 on `7b039fb` and again on the final `fafa225`; **retest 3**
on the final code (≈ 45 traversal / Windows / double- and overlong-encoding / device / NUL / unicode / symlink
payloads in a network-less production-mode container: all 404, 0 leaks, 0 × 5xx, 0 tracebacks). Permanent tests:
`backend/tests/test_static_frontend.py`, `test_static_frontend_windows.py` (~80 payloads, cross-checked with
`PureWindowsPath`/`ntpath.isreserved`; a test that makes `resolve/is_file/exists/stat/lstat/realpath` raise for every
refused payload — "before: 2 filesystem calls on the URL text; after: 0"), `test_static_frontend_spa_assets.py`.
Cost: +40 µs per static file (lexical 2.5 µs).

**Status:** code FIXED (local) — counted OPEN EXTERNAL. **Production: STILL VULNERABLE** (release `3b5e842`, since
2026-09-30). Closes only after: EXT-41 (copy logs) → EXT-39 (precheck) → deploy with migrations → EXT-38 (flags) →
runbook Phase 7 probes incl. Windows forms → EXT-02 (rotate JWT, DB, NAS, ERP secrets) → EXT-03 (compromise check,
incident record). **Do not run the UNC probe against production before the fixed release is live.**

Precision notes: (1) the QR / Asset 360 deep-link fix (CL2-IF-04) is proven by the **permanent tests**
(`test_static_frontend_spa_assets.py`) and **retest 3** — not by the native-Windows transcript, which probes only
`/some/spa/route` although the subject of commit `fd34520` mentions "QR deep link 200". (2) The refusals are
otherwise-identical 404 bodies whose **request ids differ** (`{"detail":"Not Found","request_id":…}`); the Windows
script's `distinct_refusal_bodies=28` counts those ids, and the pytest and retest 3 compare the bodies with the id
removed.

#### CL2-IF-04 — Asset 360 deep links broken on the single-port server (counted INFO; functional bug)

**Plain:** on the production-style server, opening an asset page by link (or refreshing it, or scanning the QR code
shown on the Asset 360 page) showed a JSON error instead of the page, because the file-serving route claimed every
address starting with `/assets/`.

- **Before:** `/assets/1`, `/assets/42`, `/assets/new`, `/assets/1?from=qr` → `404 application/json` in a
  production-mode container; nginx (dev/UAT) answered the app page. Same code path in production `3b5e842`.
- **Which QR codes** *(updated 2026-10-17, security release, gate rehearsal GT-F02; the earlier text said bulk
  labels were not affected)*: `GET /api/assets/{id}/qr.png` encodes the deep link `${BASE_URL}/assets/{id}`. It is
  shown on Asset 360 **and printed by the bulk Print Labels screen in its default "Barcode + QR" format**
  (`frontend/src/components/labels/AssetLabel.tsx`: `link-qr` → `/assets/{id}/qr.png`). Only the formats "QR Code"
  (`label.png?symbol=qr`) and "Barcode" (`label.png?symbol=barcode`) encode the bare **asset code**. So printed bulk
  labels in the default format **are** affected by this bug on the live server, and they keep pointing at the old
  plain-HTTP address if `BASE_URL` changes later (HTTPS). Reading only `backend/app/assets/router.py` missed the
  frontend's choice of image.
- **Change (`ca94574`):** `_ASSETS_APP_ROUTE = [A-Za-z0-9_-]{1,64}(/[A-Za-z0-9_-]{1,64}){0,2}` → SPA shell with
  `Cache-Control: no-cache`, only after the IF-01 lexical check; missing `.js/.css/.woff2/.map` stay 404 (AU-12).
- **After:** 31 permanent cases, including a test that reads the real `frontend/src/router.tsx` (60 routes) and
  requests every route; filesystem spy proves only `<dist>` and `index.html` are touched. Note (pre-existing): in
  single-port mode `HEAD` on any SPA page answers 405 (GET works; phones use GET). **Retest 3** (independent, final
  code): app routes → shell with `no-cache`; route-looking **canary files** named `new`, `123`, `settings` placed in
  `<dist>/assets` were **never served** (shell returned); missing `.js/.css/.map` → identical 404; ≈ 45 traversal
  payloads → 404, 0 leaks; HEAD/OPTIONS/POST → 405, no file read.
- **Status:** FIXED (local). Counted **INFO** (security value) in 5.1; functionally it matters (EXT-44).
  **Production: bug present** until deploy; `ops/windows/verify_release.ps1` now FAILs a release lacking the fix.

#### IF-02 — plain HTTP (HIGH)

**Plain:** passwords and session cookies travel unencrypted, including from stores over the internet.
**Before/After:** unchanged in production; nothing in code can fix it. **Prepared:** `CKAM_HTTPS_IMPLEMENTATION_PLAN.md`
(reverse proxy on 10.0.1.98 terminating TLS on 443 → `127.0.0.1:3211`; certificate options; `COOKIE_SECURE=true`,
`BASE_URL`, `TRUSTED_PROXIES=127.0.0.1` in the same change; staged HSTS; header ownership to avoid duplicates).
**Status:** OPEN EXTERNAL (EXT-04, EXT-05; SD-04, SD-05; HTTPS was deferred by the owner on 2026-10-08).

#### IF-03 — cross-company ERP PO draft (MEDIUM)

**Before:** `SECOPIT` (CKSPL) `GET /api/erp/pos/9002002/draft` → 200 with CKVPL's supplier, rates, warehouse and lines.
**Change:** `build_draft` raised only a warning before; now raises `NotAllowed`, mapped to the same 404 body as a
missing PO (no existence oracle). **After:** both directions 404, own company 200, cross-company grant (`SECOPX`) 200.
**Status:** FIXED. Prod: vulnerable until deploy.

#### IF-04 + N4 + CL1-N4-01 — weak/placeholder JWT secret in production (MEDIUM)

**Plain:** if the login-signing key is the sample value from the source code, anyone who has read the code can make
admin logins. The app now refuses to start in that case — and it now also assumes "production" unless told otherwise.

- **Before:** `ENVIRONMENT_NAME=production` + placeholder secret → started with a warning. Retest 1 found **N4**:
  only the exact names `production`/`prod` triggered the guard (`prd`, `live`, unset → open). Closure retest 1 found
  **CL1-N4-01**: with the variable **unset** the pydantic default `development` applied → docs on, placeholder accepted.
- **Change:** refuse if the stripped secret is a known placeholder, < 32 characters or < 8 distinct characters;
  production = any name not in `{development, dev, test, testing, uat, security-test, local, ci}`; default
  `environment_name = "production"`; refusal message names all three rules, never the value.
- **After:** retest 2: 72/72 weak combinations refused (exit 3), 10 dev names × 4 secrets start, production + good
  secret starts with docs JSON 404. **Side effect:** any CKAM process started without `ENVIRONMENT_NAME` (a new
  script, a local run outside Docker) now behaves as production. Docker stacks set the name explicitly.
- **Status:** FIXED. **Production:** the current secret's strength is NOT EVIDENCED; runbook Phase 1 step 3 checks it
  without printing it (else the new release refuses to start).

#### IF-05 / IF-06 (+ CL2-IF-01, CL2-IF-02, OBS-STATUS) — audit and ledger integrity at the database (MEDIUM)

**Plain:** the audit trail and asset history are meant to be "written once, never changed". The database now blocks
emptying them and blocks deleting recent audit rows. But in production the app's own database account **owns** the
tables, and an owner can switch those blocks off. The fix for that is to split the account into three (owner,
migrator, runtime) — scripts are ready and proven on a throw-away database; a DBA must run them in production.

- **Before:** row triggers refused UPDATE/DELETE but `TRUNCATE` (statement-level) emptied a ledger; the purge flag
  `ckam.allow_audit_purge` could be set by any role to delete the newest audit rows; `asset.status` / holder / date had
  no database guard (only the code rule).
- **Change:**
  - Migration `a3c5e7f9b1d4`: `BEFORE TRUNCATE` trigger on `asset_event`, `asset_field_change`, `master_audit`,
    `audit_log`; purge allowed only for rows older than 5 years (trigger + `ckam_purge_audit_log`), EXECUTE revoked
    from PUBLIC.
  - Migration `c6e8a0b2d4f6` (OBS-STATUS): `BEFORE UPDATE OF status, current_asset_user_id, status_since` trigger
    refuses a change unless the transaction-local marker `ckam.lifecycle_writer = 'on'` is set; only
    `lifecycle/service.py::apply_events` sets it (`set_config(…, true)`) around its flush.
  - `ops/db/role_split.sql`, `role_split_verify.sql`, `check_least_privilege.sql`, `ROLE_SPLIT_RUNBOOK.md`;
    `ALEMBIC_SET_ROLE` in `alembic/env.py` so migrations create objects as the owner role.
  - After retest 2 (WP-F): sequences granted `USAGE, SELECT` only (no `setval`, **CL2-IF-01**), check 20 detects a
    rewound/exhausted id sequence, `ALTER ROLE <runtime> RESET ALL` + detection of stored role defaults
    (**CL2-IF-02**), and audit-write failures are re-reported once a minute with a count + a `system_event` row
    (previously one stderr line per process, which made CL2-IF-01 invisible).
- **After:** as the runtime role on a disposable DB: 7/7 needed actions work, **40/40** forbidden actions refused
  (TRUNCATE, ALTER, DISABLE/DROP TRIGGER, replace trigger function, CREATE, `session_replication_role`, purge, ledger
  UPDATE/DELETE, `alembic_version` writes, SET ROLE owner, COPY TO PROGRAM, lifecycle-field writes); verify 45/45; API
  smoke 11/11 as the runtime role; retest 2 ran ~70 more break-out attempts (all refused) and then found CL2-IF-01/02
  (fixed, with negative controls in the permanent pytest). **Retest 3** re-ran the split on a fresh disposable DB:
  verify 49/49, `setval`/`ALTER SEQUENCE` refused on all 32 sequences (`nextval` allowed), ≈ 45 break-out statements
  refused, stored role defaults all reported by check 21 (a stored `role=<owner>` is rejected at login — no
  escalation), superuser `RESET ALL` restores writes; an exhausted `audit_log` sequence gave the user a normal 401
  (no SQL leak), a first failure report, then "6 failures so far, 5 since the last report", one `system_event`, and
  audit writes resumed after repair. Lifecycle guard: 13 permanent cases; mass assignment via API ignored (retest 2).
- **Retest-3 caveats (honest):** (a) **DBA caveat** — if a migrator role **already exists** with an `INHERIT`
  membership of the owner role, `role_split.sql`'s idempotent "already a member" guard skips the re-grant and leaves
  `INHERIT TRUE` (the migrator could then create objects without becoming the owner); the documented runbook path
  creates the migrator fresh as `NOINHERIT` and is unaffected. Fix for the DBA: drop/recreate the migrator or run
  `GRANT <owner> TO <migrator> WITH INHERIT FALSE`, then re-run verify. Low severity; not counted as a finding.
  (b) The direct `UPDATE asset SET status …` as the runtime role was **inconclusive** (fresh DB with no asset rows,
  0 rows matched); the guard was verified **present and enabled** by `role_split_verify.sql`, and its behaviour is
  covered by the app-level tests and retest 2.
- **Honest limits:** anyone who can run SQL as the app role can set the lifecycle marker themselves (defence in depth
  against bugs and stray writes, not against a malicious DB user); a superuser can always do anything; the dev/UAT app
  role `ckam` is still a superuser (OBS-DOCKER-SU), so least privilege is proven only on disposable databases (PG 17).
- **Status:** IF-05/IF-06 MITIGATED; CL2-IF-01/02 FIXED (scripts). **Production:** owner role still = app role;
  EXT-07 + EXT-45 (run the **updated** scripts) + EXT-46 (re-run the check after every deploy) (SD-11: recommended keep `ckassetapp` as runtime, add `ckasset_owner` + `ckasset_migrator`; never reuse the
  retired `ckam_app` name). Run `check_least_privilege.sql` read-only on production first — check 20 shows whether a
  sequence was already damaged.

#### IF-07 — runs as SYSTEM on a shared server (MEDIUM)

**Plain:** any CKAM bug becomes control of the whole server and the other two apps. **Prepared:**
`CKAM_SERVICE_ACCOUNT_PLAN.md` (gMSA if domain-joined, else local standard user `svc_ckam`; batch-logon right only;
`icacls` rights on CKAM folders; tighten `shared\.env`/`nas.pw` ACLs; NAS reached with `ckappuser` mapped by the
launcher; reboot/upload/NAS test plan; rollback). **Status:** OPEN EXTERNAL (EXT-06).

#### IF-08 — backups (MEDIUM)

**Plain:** the only backups sit on the same machine as the database, unencrypted, and nobody has ever restored one.
**Prepared:** `CKAM_BACKUP_RESTORE_PLAN.md` (off-server encrypted copy, NAS document backup, offline/immutable copy,
retention, proposed RPO 24 h / RTO 4 h, quarterly restore drill with a record template). **Status:** OPEN EXTERNAL
(EXT-08, EXT-29).

#### IF-09 — dev PC secrets and dumps (MEDIUM)

**Plain:** on the development PC, any person or program signed in with any account can read and change the settings
file (holds the real ERP read-only password) and 36 database dumps (with copied real vendor/PO data) — and the whole
source tree. **Inspected read-only 2026-10-16:** `Authenticated Users:(M)`, `Users:(RX)` inherited on `.env`,
`backups\` and the worktree; BitLocker state unknown (needs elevation). **Prepared:** `closure/infra/IF-09_ACL_PLAN.md`
(ACL commands, BitLocker, purge of superseded dumps, Docker Desktop caveat). **Nothing changed.** **Status:** OPEN
EXTERNAL (EXT-10, URGENT local action). Reviewer note: this also means the integrity of the code that will be
deployed depends on nobody else having modified the worktree on that PC.

#### IF-10, AU-01, AC-1, N1 — other MEDIUM fixes (detail in the 5.2 rows)

**IF-10** ERP reads: connect 10 s, statement 60 s (copy 120 s), READ ONLY transaction; black-hole stand-in → 503 after
10.01 s; real ERP never contacted. **AU-01** timing: dummy Argon2 check on every refusal; refused states within 0.6 ms
(retest 2, 35 samples each); +33 ms on refused sign-ins only. **AC-1** setup lists: `require_role(*READ_ROLES)` on
masters, custom fields, numbering and bundle lists; 44 self-service cases 403, exactly 13 matrix cells changed.
**N1** body limits: outermost ASGI middleware (64 KB auth / 5 MB JSON / 16 MB multipart, chunked counted); 413 before
reading, RSS flat in closure retest 1 and retest 2; malformed `Content-Length` → 400 from the parser (CL2-SE-N02).
All **FIXED**, vulnerable in production until the deploy.

#### AU-03 — rate limiting (MEDIUM)

**Before:** 171 failures from one address never throttled; forged `X-Forwarded-For` evaded the per-address lock.
**Change:** `core/rate_limit.py`, in-process sliding window (max 50,000 keys, LRU sweep): sign-in 20/min per address +
10/min per login id; refresh 60/min; change-password 10/min; 429 with `Retry-After` and "Too many sign-in attempts.
Wait a minute and try again."; `RATE_LIMITED` audit row (throttled 1/min/key); client address from `TRUSTED_PROXIES`
only. **After:** retest 2: 429 at the 11th (per id) and 21st (per address) even with a different forged XFF on every
request, through nginx and direct; a second source keeps its own bucket. **Status:** FIXED. Watch NAT'd offices
(SD-08/EXT-40).

#### AU-04 — lock-out abuse (MEDIUM)

**Plain:** anyone who knows or guesses a login id (store logins follow the public pattern
`sm.<code>@citykartstores.com`) can lock that person out for 15 minutes with 5 tries, and again every 15 minutes; an
already signed-in victim is pushed out at the next session renewal. One address can keep ≈ 60 accounts locked
(calculated). **Options** (`closure/backend/AU-04_OPTIONS.md`, SD-06): A keep hard lock; B growing delay (≤ 30 s,
never a lock; ≈ 1 day effort); **C hybrid (recommended)**: delay + existing limits + 5-min lock only after 20 failures
in 60 min, and stop `/refresh` ending open sessions (≈ 2 days). **Status:** DECISION REQUIRED; no code changed.

#### AU-05 (+ AU-06, AU-07, OBS-TV) — revocable sessions (MEDIUM)

**Before:** sign-out, password change and admin reset left old tokens valid until expiry; a rotated refresh cookie
stayed reusable for up to 8 h; the session version was raised in Python (read + 1), losing concurrent bumps
(probe: 18–19 of 20 lost).
**Change:** `token_version` claim checked on every request (`f9a1c3e5b7d2`); bumped atomically
(`UPDATE asset_user SET token_version = token_version + 1 … RETURNING`) at every session-ending site (sign-out,
password change/reset, issue passwords, deactivate, sign-in off, role, work area, home company, company access,
head-office rights removed). AU-06: table `auth_session` (`b5d7f9a1c3e5`), one row per sign-in, only SHA-256 hashes of
token ids; renewal is one atomic statement:

```sql
UPDATE auth_session SET previous_jti_hash = current_jti_hash, previous_valid_until = now + grace,
       current_jti_hash = :new, last_used_at = now, expires_at = now + 8h
 WHERE id = :sid AND asset_user_id = :uid AND current_jti_hash = :presented
   AND revoked_at IS NULL AND expires_at > now RETURNING id
```

A non-rotating presentation is judged: version changed → plain 401; just-replaced token within
`REFRESH_REUSE_GRACE_SECONDS` (10) → 200 with access token only, no new cookie (`REFRESH_DUPLICATE`, LOW); anything
else → **reuse**: 401, all sessions of the person ended, `REFRESH_REUSE` audit row (HIGH). Legacy tokens (no `sid`,
i.e. everyone signed in at deploy time) are upgraded once.
**After:** retest 2 A1 15/15 (reuse after 16 s ends all sessions; duplicate within grace gets no cookie; legacy
upgrade then reuse detected; no token material in DB/logs), A2 8 triggers, burst g (version 2→7, no lost update),
burst h (20 parallel refreshes → exactly one rotation).
**Residuals:** see section 10 (grace window, thief-wins race, lost-response false alarm, legacy path accepts a forged
legacy-style token once if the signing key is stolen — remove after the first post-deploy 8 hours). **Status:** FIXED.

### 5.4 Observations (not counted in the 51)

| ID | Observation | Status now |
|---|---|---|
| IF-01-WIN | Windows path forms never executed; `resolve()` ran before containment (possible outbound SMB on UNC) | FIXED (`7b039fb`), native Windows 0/28 |
| N5 | Security headers twice on proxied `/api` answers (Docker) | FIXED (`79dbae7`), retested |
| N6 | Unknown `/api/...` returned the SPA shell 200 in single-port mode | FIXED (`7b039fb`), retested; docs paths too (`b401e9f`) |
| N7 | Sign-out ends every session of the account → one person on a shared store login signs out every device | ACCEPTED pending SD-07 |
| N8 | Changing a login e-mail does not end sessions | ACCEPTED (not an access change) |
| N9 | `audit_log.at` settable on INSERT, so a backdated inserted row could be purged with the flag | DEFERRED (optional `BEFORE INSERT … now()`) |
| OBS-TV | `token_version` raised non-atomically | FIXED (`69c3a51`), retested (burst g) |
| OBS-STATUS | No DB guard on lifecycle fields | FIXED (`734fd19`, marker trigger; honest limit stated) |
| OBS-COMMENT | Stale lock-out comment | FIXED (`a3e8fce`) |
| OBS-GUARD-MSG (= CL1-OBS-N4-02) | Start-up refusal did not name the 8-distinct-character rule | FIXED (`7b039fb`) |
| OBS-AU12-TEST | No permanent test for source maps / nginx parts | FIXED (`79dbae7`: 12+ nginx config tests, `check:build`, `check:nginx-live`) |
| OBS-NAME-IMPORT | Same-name rule only on the single-create screen, not the Excel import | FIXED (`7b039fb` brands/vendors; `fafa225` categories/sub-categories) — **ahead of owner decision SD-12** |
| OBS-DOCKER-SU | Dev/UAT app role `ckam` is a PostgreSQL superuser | OPEN (tools ready; switching needs a privileged test-clean-up role and the owner) |
| OBS-CSP-STYLE | CSP keeps `style-src 'unsafe-inline'` | DEFERRED (UI-library inline styles) |
| OBS-T410 | nginx's own 413 had no request id | RESOLVED by the CL2-IF-03 fix |
| OBS-NPM-DEV | Dev-only HIGH advisory `source-map-js` 1.2.1 (build tool) | DEFERRED (routine update) |
| OBS-POLYGLOT (= CL1-OBS-FILES-01 = CL2-AC-OBS-01) | `%PDF-`-prefixed HTML/script polyglot is accepted by the prefix check | ACCEPTED: only served as attachment + `nosniff`; revisit if any screen renders documents inline |
| CL1-OBS-SECRET-01 | Untracked demo walkthrough contains a clear-text demo password | OPEN (do not commit it as is) |
| CL2-IF-OBS-01 | Dev containers could write `/var/tmp`, `/dev/shm` | FIXED (tmpfs `noexec`; effective at next `docker compose up --build api`) |
| CL2-IF-OBS-02 | Runtime image needs run flags (`--cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp`) documented | OPEN (not done; production has no Docker) |
| CL2-IF-OBS-03 | Audit insert failure reported once per process, then silent | FIXED with CL2-IF-01 (counter + system_event); **not yet on the Diagnostics screen** |
| CL2-IF-OBS-04 | Stale Google-Fonts comment | FIXED |
| CL2-IF-OBS-05 | `server: uvicorn` banner | FIXED in repo (`--no-server-header`); live launcher needs it (EXT-13) |
| CL2-IF-OBS-06 | UAT persona seeding script uses one shared password | DONE: loud "never against production" docstring; value unchanged |
| OBS-IDS | `retest_tests.csv` reuses ids RT-AC-T700…T729 in two groups | ACCEPTED (historical evidence not rewritten) |
| OBS-DOCS / OBS-REG-STALE / OBS-EXT07-STALE | Older documents behind the code | LARGELY CLOSED on 2026-10-16: runbook now lists all 4 migrations, both uvicorn flags and the QR check; registers, ISO/SOC 2 (v1.1) and EXT (01–50) updated. Small residuals: see section 10 item 14 |
| (retest 3) CL3-DBA-INHERIT | `role_split.sql`'s idempotent membership guard does not correct a **pre-existing** migrator role that already has an `INHERIT` membership of the owner | OPEN, low — DBA note (runbook path creates the migrator fresh; else re-grant `WITH INHERIT FALSE` and re-verify) |
| (retest 3) CL3-COVERAGE | Direct OBS-STATUS `UPDATE` as the runtime role inconclusive on an empty DB | ACCEPTED as a coverage gap: trigger present + enabled (verify script); behaviour covered by app-level tests and retest 2 |
| (new, this review) HEAD-405 | In single-port mode `HEAD` on any SPA page answers 405 (FastAPI GET routes) | OPEN, low (uptime monitors using HEAD would alarm) |
| (new, this review) ALEMBIC-CHECK | `alembic check` cannot run: `alembic/env.py` does not import `app.items.models` (`NoReferencedTableError`) | OPEN, low (schema-drift detection unavailable) |

---

## 6. All changes made (change inventory)

**Plain:** about 5,000 lines of application code, scripts and configuration changed or added (69 files outside
documents and tests), plus ≈ 960 new automated test cases, 4 database changes, and a large set of documents and
evidence. Totals for the whole range: 587 files, +65,158 / −196 lines (most of it documents and raw evidence).

### 6.1 Commit by commit

| # | Commit | Date | One line | Main areas / files |
|---|---|---|---|---|
| 0 | `4ba4e94` | 10-14 | fix(web): ignore harmless ResizeObserver notice on Home | Frontend only; **not security**; predates the programme but is also unpushed |
| 1 | `3e134c1` | 10-15 16:43 | IF-01: `/assets` route cannot serve files outside the assets folder | `backend/app/main.py`, `tests/test_static_frontend.py` |
| 2 | `7e57844` | 10-15 | IF-03 ERP drafts per company; IF-04 refuse placeholder JWT in production | `erp/service.py`, `erp/router.py`, `main.py`, tests |
| 3 | `ba04371` | 10-15 | IN-02 bounded import reads, 413 over 15 MB | `core/uploads.py`, `imports/router.py`, `asset_users/router.py`, `masters/router.py` |
| 4 | `77431ba` | 10-15 | AC-1 staff-only setup lists, AC-2 company-scoped custom fields, PO-LOGIN | masters / custom fields / numbering / bundles routers, `auth/router.py`, tests |
| 5 | `4fa5c9b` | 10-15 | nginx/build hardening, clean sign-out, session-ended notice, security e2e (AU-12, AU-14/15) | `frontend/nginx.conf`, `vite.config.ts`, `lib/auth-fetch.ts`, `routes/login.tsx`, `e2e/security.spec.ts`, vitest |
| 6 | `ae706bb` | 10-15 17:23 | Timing, rate limits, revocable sessions, password policy, TRUNCATE guards + purge floor, document content checks, ERP timeouts, production hardening | 34 files: `core/rate_limit.py`, `core/security.py`, `core/deps.py`, `auth/password_policy.py`, `auth/router.py`, `documents/service.py`, `erp/source.py`, `erp/warehouse.py`, migrations `f9a1c3e5b7d2`, `a3c5e7f9b1d4`, `backend/constraints.txt`, 10+ test files |
| 7 | `da790d1` | 10-15 | RACE-1 advisory lock; concurrency tests; security rules in guardrails | `masters/router.py`, `tests/core/test_security_concurrency.py`, `docs/ai/DEVELOPMENT_GUARDRAILS.md` |
| 8 | `d04779a` | 10-15 18:12 | N1 body limits; N4 environment names; AU-08 follow-up | `core/body_limit.py`, `main.py`, `password_policy.py`, tests |
| 9 | `a3e8fce` | 10-15 18:31 | N2 `--no-proxy-headers` in Docker; lock-out comment | `backend/Dockerfile`, `auth/router.py` comment |
| 10 | `627ed73` | 10-15 18:31 | First docs pack (VAPT report, registers, ISO/SOC 2, threat model, baseline, EXT, evidence) | 162 files under `docs/security/` |
| 11 | `3362c1b` | 10-16 10:02 | Closure register + single-file complete report | 2 docs |
| 12 | `7b039fb` | 10-16 10:32 | **WP-A1**: lexical Windows-path guard, JSON 404 for unknown `/api`, ERP TLS options, unset env = production, look-alike passwords, import duplicate names | `core/static_safety.py` (new), `main.py`, `core/errors.py`, `core/config.py`, `erp/source.py`, `observability/system.py`, `password_policy.py`, `masters/router.py`, `masters/bulk_import_export.py`, 6 test files |
| 13 | `f746e71` | 10-16 10:32 | Urgent runbook, HTTPS/service-account/backup plans, decisions paper, 15 draft policies + 6 templates, closure retest 1 evidence | 51 doc/evidence files |
| 14 | `79dbae7` | 10-16 10:39 | **WP-C**: self-hosted fonts, non-root containers, real client IP behind nginx, headers once, build + nginx checks, Windows reference scripts | `frontend/index.html`, `src/fonts.css`, `package*.json`, `nginx.conf`, `scripts/check-*.mjs`, `src/security/nginx-config.test.ts`, `backend/Dockerfile`, `.dockerignore`, `docker-compose.yml`, `ops/windows/*`, runbook docs |
| 15 | `69c3a51` | 10-16 11:01 | **WP-A2**: refresh-token reuse detection, atomic session version | `auth/models.py`, `auth/sessions.py` (new), `auth/router.py`, `core/security.py`, `asset_users/*`, `observability/retention.py`/`audit.py`, `alembic/env.py`, migration `b5d7f9a1c3e5`, tests |
| 16 | `b401e9f` | 10-16 11:02 | Backend CSP without Google hosts; JSON 404 for docs paths when off | `main.py`, tests |
| 17 | `734fd19` | 10-16 11:35 | **WP-B**: DB guard on lifecycle fields, local role split proven, least-privilege checks | migration `c6e8a0b2d4f6`, `lifecycle/service.py`, `alembic/env.py` (`ALEMBIC_SET_ROLE`), `ops/db/*` (new), `tests/lifecycle/test_obs_status_guard.py`, `tests/security/test_least_privilege_role_split.py`, evidence |
| 18 | `ca94574` | 10-16 12:43 | **WP-F**: QR/Asset 360 deep links on single-port, no sequence rewrite for runtime role, visible audit-write failures, X-Request-ID on nginx answers, no server banner | `main.py`, `ops/db/*.sql`, `observability/writer.py`, `observability/filelog.py`, `nginx.conf`, `Dockerfile`, `docker-compose.yml` (tmpfs), `ops/windows/*`, `scripts/seed_uat_personas.py` docstring, tests |
| 19 | `8664b77` | 10-16 12:43 | Retest 2 evidence, performance before/after, native Windows test | 177 evidence files |
| 20 | `fafa225` | 10-16 13:01 | **WP-F2**: one active category/sub-category name per work area; friendly 422 for serial race loser | `masters/router.py`, `core/errors.py`, 2 test files |
| 21 | `fd34520` | 10-16 13:13 | Final native-Windows run; stabilise lifecycle e2e session-end timing | evidence file, `frontend/e2e/asset-lifecycle.spec.ts` (bounded wait) |

Commit messages follow Conventional Commits; commits are **unsigned**, single human author, co-authored by an AI
assistant.

### 6.2 New files and modules

| Path | Purpose |
|---|---|
| `backend/app/core/static_safety.py` | IF-01/IF-01-WIN lexical path check + safe resolution |
| `backend/app/core/rate_limit.py` | AU-03 in-process sliding-window limiter |
| `backend/app/core/body_limit.py` | N1 request-size ASGI middleware |
| `backend/app/core/uploads.py` | IN-02 bounded upload reader |
| `backend/app/auth/password_policy.py` | AU-08 password rules (plain-sentence refusals) |
| `backend/app/auth/sessions.py`, `backend/app/auth/models.py` | AU-06 `auth_session` model and renew/reuse logic |
| `backend/app/alembic/versions/` ×4 | See 6.3 |
| `backend/constraints.txt`, `backend/.dockerignore` | IF-11 pinned set; smaller build context |
| `frontend/src/fonts.css`, `frontend/src/lib/zod-config.ts` | Self-hosted fonts; zod `jitless` (CSP without `unsafe-eval`) |
| `frontend/scripts/check-build-security.mjs` (+ test), `check-nginx-live.mjs` | `npm run check:build` (0 `.map`, no external host) and `npm run check:nginx-live` (`nginx -t` + live header checks in a throw-away container) |
| `frontend/src/security/nginx-config.test.ts` | Static checks of `nginx.conf`, `vite.config.ts`, `index.html` |
| `frontend/e2e/security.spec.ts` | 14 browser security journeys |
| `ops/windows/run_ckam_web.ps1.template`, `deploy_ckam.ps1.template`, `verify_release.ps1`, `rollback_release.ps1.template`, `README.md` | IF-15 secret-free Windows reference scripts (never run on a server) |
| `ops/db/role_split.sql`, `role_split_verify.sql`, `check_least_privilege.sql`, `ROLE_SPLIT_RUNBOOK.md` | IF-05/06 role split, verification, 34-row read-only check |
| `docs/security/policies/01…15` + `README.md` + `templates/` (6) | DRAFT policy pack (not approved). The SoA working draft (`15_…`) was **regenerated on 2026-10-16** from the v1.1 ISO matrix |
| `docs/security/*.md` | Reports, registers, plans, runbook, decisions (Appendix A). `CKAM_SECURITY_COMPLETE_REPORT.md` is the **earlier first-programme compilation (2026-10-15), superseded by this file**; `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` is the closure-stage summary whose counts this file matches. At the time of writing the closure documents, `closure/retest3/` and this file are **uncommitted** |

### 6.3 Database migrations (in order; single head `c6e8a0b2d4f6`)

| # | Revision | Revises | What it does | Deploy notes |
|---|---|---|---|---|
| 1 | `f9a1c3e5b7d2` | (previous head) | `asset_user.token_version INTEGER NOT NULL DEFAULT 0` | Additive; tokens without `tv` count as 0, so users stay signed in at upgrade. **New code fails every sign-in on the old schema** — upgrade first |
| 2 | `a3c5e7f9b1d4` | `f9a1c3e5b7d2` | `BEFORE TRUNCATE` triggers on 4 ledgers; 5-year floor in `forbid_audit_log_write` and `ckam_purge_audit_log`; EXECUTE revoked from PUBLIC | Must run as the table owner (today `ckassetapp`) |
| 3 | `b5d7f9a1c3e5` | `a3c5e7f9b1d4` | New table `auth_session` (hashed jti, previous hash + grace, expiry, revoked, legacy hash unique; FK to `asset_user`) | Additive; sign-in inserts into it — upgrade first |
| 4 | `c6e8a0b2d4f6` | `b5d7f9a1c3e5` | Trigger `trg_asset_lifecycle_fields_guard` + function `forbid_asset_lifecycle_write()` | Touches no rows. **Old code cannot record any movement once this exists** (no marker): moves, repairs, lost/found, dispose, sale, scrap and bulk actions are refused with a misleading 422; **receives still work** (rows are inserted, the `BEFORE UPDATE` trigger never fires) *(updated 2026-10-17, security release, gate rehearsal GT-F01)* — upgrade only while CKAM is stopped and start the new code right after; see rollback note in 11.5 |

Verified: fresh empty DB → head; downgrade −1 / upgrade cycles; the owner's dev DB, the UAT copy and the security test
DB upgraded to head (per lead). Not verified: `alembic check` drift detection (env.py import gap, 5.4); the migration
from production's exact schema (runbook Phase 1 step 9 asks for a rehearsal on a scratch copy).

### 6.4 New settings / environment variables (details in Appendix D)

`RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_LOGIN_PER_IP`, `RATE_LIMIT_LOGIN_PER_LOGIN_ID`,
`RATE_LIMIT_REFRESH_PER_IP`, `RATE_LIMIT_CHANGE_PASSWORD_PER_IP`; `REFRESH_REUSE_GRACE_SECONDS`;
`PO_SOURCE_SSLMODE`, `PO_SOURCE_SSLROOTCERT`; `ERP_CONNECT_TIMEOUT_SECONDS`, `ERP_STATEMENT_TIMEOUT_SECONDS`,
`ERP_COPY_STATEMENT_TIMEOUT_SECONDS`; `ALEMBIC_SET_ROLE` (migration tool only); `CKAM_EDGE_SUBNET`, `CKAM_WEB_IP`
(Docker dev/UAT only). **Changed default:** `ENVIRONMENT_NAME` unset now means `production`. **Now actively used:**
`TRUSTED_PROXIES` (existed before; the rate limiter and audit IPs depend on it; set to nginx's fixed address in
Docker, must stay **empty** in production until a reverse proxy exists, then `127.0.0.1`).

### 6.5 Infrastructure changes (repository; dev/UAT Docker unless stated)

| Area | Change |
|---|---|
| `backend/Dockerfile` | Multi-stage: `base` (user `ckam` uid/gid 10001), `dev` target (tests + dev deps, used by compose), `runtime` target (no tests/pytest/coverage); `pip install -c constraints.txt`; `USER 10001:10001`; CMD `uvicorn … --no-proxy-headers --no-server-header` |
| `docker-compose.yml` | One-shot `volume-init` (re-owns old root-owned volumes, `network_mode: none`, only CHOWN + DAC_READ_SEARCH); api `cap_drop: [ALL]`, `no-new-privileges`, tmpfs `/tmp` and `/var/tmp` `noexec,nosuid,nodev`; new `edge` network with fixed subnet; web at a fixed IP; `TRUSTED_PROXIES` = that single IP. Each parallel stack must set its own `CKAM_EDGE_SUBNET`/`CKAM_WEB_IP` |
| `frontend/nginx.conf` | CSP `'self'` only; Permissions-Policy; `server_tokens off`; JSON 413; `.map` → 404; missing static files `=404`; `/api/` overwrites `X-Forwarded-For` with `$remote_addr` (never appends); hides 6 upstream headers it sets itself; `X-Request-ID` on nginx's own answers |
| Production (Windows) | **Nothing changed.** Reference launcher/deploy/verify/rollback scripts only |

### 6.6 Behaviour changes users will notice (after a deploy)

| Area | Before | After |
|---|---|---|
| Sign-out | Ended only that browser's copy; tokens stayed valid | Ends **every** session of that login on every device (shared store logins: one person signs everyone out) |
| Access changes | Took effect at next refresh (≤ 15 min) | Role / work area / company / sign-in off / deactivation / reset / password change sign the person out at once: "Your session has ended. Please sign in again." |
| Copied session cookie reused | Worked for up to 8 h | Detected: everyone using that login is signed out; `REFRESH_REUSE` audit row |
| Several tabs | — | Still work (10 s grace) |
| Passwords | Length only | Common/sequence/brand+digits/own name/look-alike/common word+digits refused with a plain sentence |
| Too many attempts | Never throttled | 429 "Too many sign-in attempts. Wait a minute and try again." (20/min per address, 10/min per login id) |
| Lock-out | 5 wrong → 15 min | Unchanged (decision SD-06 pending); counting now race-free |
| Big requests | Read in full | 413 above 64 KB (sign-in), 5 MB (JSON), 16 MB (uploads); imports > 15 MB 413 "Split it into smaller files"; documents > 10 MB unchanged |
| Uploads | Extension only | Renamed/fake files refused ("This file is not a real PDF file…") |
| ERP drafts | Other company's draft visible | "This purchase order was not found in the ERP." |
| Setup lists | Visible to store / self-service logins | Staff only |
| Vendors / brands / categories | Duplicate names possible under parallel saves and in Excel imports | One active name (category per work area, sub-category per category), also in imports; existing duplicates left alone |
| Serial clash in a race | Bare 409 "This record already exists." | 422 "This serial number is already used by another asset…" |
| Unknown `/api/...` and `/docs` in production | SPA page (200) | JSON 404 |
| Asset 360 by link / QR (single-port) | JSON 404 (bug) | Opens the page |
| Fonts | From Google on every page | Served by CKAM itself (same look; pixel-identical screenshots except live counters) |
| Start-up | Weak secret = warning | **Refuses to start** in production with a weak secret; unset `ENVIRONMENT_NAME` counts as production |
| Containers (dev/UAT) | Root | uid 10001, no capabilities |

### 6.7 Deliberately NOT changed (and why)

| Item | Why not |
|---|---|
| HTTPS, `Secure` cookie (IF-02, AU-13) | Needs a certificate and proxy on the server; owner deferred HTTPS 2026-10-08 |
| Production service account, DB role split, backups, dev-PC ACLs (IF-07, IF-05/06, IF-08, IF-09) | Server/DBA/administrator actions; prepared as plans/scripts only |
| Lock-out model (AU-04) | Owner decision SD-06 |
| MFA, Full Admin company scope, store-login policy, absolute session lifetime, password expiry, audit retention | Owner decisions SD-03, SD-02, SD-07, SD-14, SD-13, SD-09 |
| Replace `python-jose` with PyJWT (IF-12) | Not reachable; larger change touching every auth test |
| Strong form of the lifecycle guard (column privileges + `SECURITY DEFINER` setter) | Would change the core ledger path, its statement count and import savepoints; PostgreSQL cannot subtract a column from a table grant (silent breakage risk); role split already removes the realistic bypass |
| `style-src 'unsafe-inline'` (OBS-CSP-STYLE) | UI-library inline styles; risk of visual breakage |
| N9 (backdated audit INSERT) | Optional; every audit writer would need checking first |
| Dev/UAT DB role split (OBS-DOCKER-SU) | Test clean-up needs replica mode; needs a separate privileged clean-up role and the owner |
| ERP TLS mandatory | Default stays `prefer` (today's behaviour) until the ERP owner confirms TLS support (EXT-25) |
| Diagnostics screen count of audit-write failures | Function `failure_counts()` exists; UI not built |
| Cross-company allotment (owner decision 2026-10-13) | Product feature, not part of security closure; not built |

### 6.8 Tests added and tests changed

**Added (permanent):**

| Family | Where | Size |
|---|---|---|
| Static file serving / Windows paths / SPA under `/assets` | `test_static_frontend.py` (+1), `test_static_frontend_windows.py`, `test_static_frontend_spa_assets.py` | ~80 payloads + 31 cases + route-table test |
| Start-up guard / env names / headers / docs | `core/test_production_secret_guard.py`, `test_vapt_headers_and_docs.py` | 11 secrets × 15 names, real lifespan 9 × 8 |
| Proxy headers (N2) | `core/test_n2_forwarded_for.py` | Dockerfile/launcher flags, PID-1 cmdline, 15 forged forms × 4 peers, rate-limit keys |
| Auth: login, timing, lock race, PO-LOGIN, rate limits, password policy, sessions, refresh reuse, atomic version, JWT algorithms | `auth/test_vapt_login.py`, `test_login_primary_owner_clash.py`, `test_rate_limit.py`, `test_vapt_password_policy.py` (40 refused / accepted list), `test_vapt_sessions.py`, `test_wpa2_refresh_reuse.py` (24), `test_wpa2_token_version_atomic.py` (3), `test_jwt_algorithm_pinned.py` | — |
| Body limits, uploads | `core/test_body_limit.py`, `imports/test_upload_size_limit.py`, `documents/test_vapt_content_check.py` | — |
| Access scope | `core/test_security_read_scope.py`, `erp/test_erp_api.py` (+1) | — |
| ERP limits / TLS | `erp/test_vapt_erp_limits.py`, `erp/test_erp_tls_settings.py` | Plain-text stand-in, password never in logs |
| Concurrency / names / serial | `core/test_security_concurrency.py`, `masters/test_import_duplicate_names.py`, `masters/test_wpf2_category_names.py` (11), `core/test_wpf2_serial_race_message.py` (9) | 20-parallel bursts through the app |
| Audit / ledger / DB | `observability/test_vapt_append_only.py`, `observability/test_log_write_failure_reporting.py` (4), `lifecycle/test_obs_status_guard.py` (13), `security/test_least_privilege_role_split.py` (throw-away DB + roles, negative controls) | Role-split test **skips** unless `ops/` is copied into the api container |
| Frontend | `lib/auth-session.test.ts` (11), `routes/login.test.tsx` (+5), `security/nginx-config.test.ts` (13), `scripts/check-build-security.test.mjs` (5) | **+34** vitest (1223 → 1257) |
| Browser | `e2e/security.spec.ts` | 14 journeys (10 declarations, one × 5 `next=` values) |

Backend totals: 27 new test modules (git: `A backend/tests/**/test_*.py`) + helper `tests/lifecycle/fixture_marker.py`;
passing cases 1,577 → 2,541 (**+964**; the fact sheet's "≈ 35 files / ≈ 900 cases" is approximate — 27 is the
git count).

**Existing tests changed (honest list):**

| Test | Change | Why | Weakened? |
|---|---|---|---|
| `auth/test_must_change_password.py` | Old access token now expected 401 after password change | AU-05 intended | No (stricter) |
| `conftest.py` | Clean-up uses `SET LOCAL session_replication_role = replica` before TRUNCATE; rate limits off for the suite (on in `test_rate_limit.py`) | TRUNCATE guards; suite signs in far more than a human | No, but the suite needs a superuser DB role |
| `core/test_s0_friendly_errors.py` | 100,000-char password → 20,000 | 64 KB auth body limit now answers 413 first; 413 covered elsewhere | No (reason stated) |
| `documents/test_router.py` | 20 MB upload → 15 MB | 16 MB outer limit now answers first; still above the 10 MB document limit | No (reason stated) |
| `erp/test_s3a2_draft_create.py` | Other company's draft: 200 with blanked supplier → **404** | IF-03 intended | No (stricter) |
| `observability/test_retention_and_append_only.py` | Purge cut-offs moved beyond 5 years; new trigger names | IF-06 floor | No (stricter rule) |
| `reports/test_s7_home_erp_resilience.py` | Fake asyncpg connection gained `transaction()` | IF-10 read-only transaction | No |
| `auth/test_vapt_sessions.py::test_every_refresh_hands_out_a_new_unique_token` | Second renewal now uses the returned cookie | The old test encoded the insecure behaviour (same cookie twice) that AU-06 forbids | No (old behaviour was the finding) |
| `lifecycle/test_s4_batch_events.py` | Statement limit `<= 6` → `<= 7` | +2 marker statements per batch (not per asset) | Slightly looser bound, reason stated |
| `reports/test_dashboard.py` | Calls `allow_lifecycle_fixture_write` before backdating `status_since` | The only fixture writing a lifecycle field directly; DB now refuses it | No (fixture-only helper) |
| `observability/test_error_logging.py` | Uses `reset_failure_reports()` | Internal set replaced by counters | No |
| Migration-head literals (`test_s3a1_master_audit_migration.py`, `test_admin_api.py`, `test_system_events.py`) | Head updated per migration | New migrations | No |
| `frontend/e2e/fixtures.ts` | Test login password changed | AU-08 refuses a password containing the role word | No |
| `frontend/e2e/asset-lifecycle.spec.ts` | Bounded wait before clearing cookies | Test race (session renewal in flight), not an app bug | Test-only |

---

## 7. Results

### 7.1 Final regression (on the final code)

| Suite | Result | Baseline before programme |
|---|---|---|
| Backend pytest (dev api container, `ckam_test` DB) | **2,541 passed, 1 skipped** (skip = repository-launcher scan needs a checkout) | 1,577 (1,783 at end of first programme) |
| Frontend `npx tsc -b` | Clean | Clean |
| Frontend `npx vitest run` | **1,257 passed in 92 files** | 1,223 / 89 |
| `npm run build` | OK | OK |
| `npm run check:build` | OK: 0 `.map` files, no `sourceMappingURL`, no Google host, no external resource | n/a |
| `npm run check:nginx-live` | OK (`nginx -t`, every security header exactly once on 9 kinds of answer) | n/a |
| Playwright permanent journeys (UAT stack, rate limits off for that stack only) | **11 passed, 1 skipped** (ERP-link journey skips by design) — run by the lead on the final code on 2026-10-16; **no committed transcript**; reproducible with Appendix B | 11 + 1 |
| Playwright security journeys (`ckam-sec`, remediated-auth assertions mandatory) | **14 / 14** — same: lead's run on the final code 2026-10-16, no committed transcript, reproducible with Appendix B | n/a |
| Alembic | Fresh DB → `c6e8a0b2d4f6`; dev, UAT, security DBs upgraded; single head | — |
| Native Windows IF-01 run on final `fafa225` | 0 / 28 leaks, 0 × 5xx | old 10 / 28 |
| DB role-split simulation | Runtime role 7/7 CAN, 40/40 CANNOT; verify 45/45; check script 34 rows PASS after split; ~70 retest-2 break-outs refused; retest 3 on the final scripts: verify 49/49, ≈ 45 break-outs + all 32 sequences refused | — |
| Third independent retest (final code `fd34520`) | ≈ 360 cases, **52/52 logged assertions PASS, 0 new findings** (six late fixes + regression sweep incl. move and receive) | — |

### 7.2 Performance before / after (summary of `closure/perf/PERF_REPORT.md`)

Old `4ba4e94` vs new `734fd19` on identical data (150 POs, 1,960 assets), through nginx, alternating samples; threshold
new ≤ old + max(25 %, 50 ms). **31 operations, none over the threshold**; most within noise (ratio 0.95–1.05).

| Operation | Old median | New median | Why |
|---|---|---|---|
| Sign-in (correct password) | 43.1 ms | 47.8 ms | Session record written (+3–5 ms) |
| Refused sign-in, unknown id | 6.3 ms | 39.2 ms | **By design** (AU-01 equal-cost refusal) |
| Token refresh | 2.3 ms | 3.6 ms | Server-side session row (AU-06) |
| Bulk Move of 50 assets | 168 ms | 202 ms (repeat 159 → 183) | Lifecycle marker `set_config` twice per asset: 408 → 508 SQL statements; trigger itself ≈ 0 cost |
| Static JS via uvicorn | 7.4 ms | 7.4 ms | Lexical check 2.5 µs; full safe path +40 µs |
| 4 MB JSON body | 29.1 ms | 27.7 ms | Body limit ≈ 7.5 µs |

Caveat: WSL2 loopback. In production the database is across the LAN, so the bulk-move overhead grows with round-trip
time (≈ +50 ms per 50 assets at 0.5 ms RTT). A cheap fix exists (marker once per transaction, section 9g).

### 7.3 What these numbers prove — and what they do not

| They prove | They do not prove |
|---|---|
| The code at `fd34520` behaves as intended on Linux/Docker and (static route only) on native Windows on the dev PC | That production is safe — **nothing is deployed** |
| No regression in 2,541 + 1,257 existing/new automated checks; normal work not noticeably slower | Behaviour under the real Windows service account, real NAS, real ERP, PG 18, LAN latency |
| Independent agents (not the implementers) could not escalate, inject, traverse or race their way past the fixes, including the late WP-F/WP-F2 fixes (retest 3 on `fd34520`) | That an organisationally independent tester would agree — every retester was an AI agent under the same lead; retest 3 also left one coverage gap (OBS-STATUS direct UPDATE on an empty DB) |
| Least-privilege design works on a disposable PG 17 database | That the production DBA steps will go as simulated, or that the production schema matches the test schema |
| No real secret in git history or images (regex) | Absence of secrets that do not match the regexes; absence of known CVEs in container OS packages |
| Test counts are large | Counts are **cases**, many parametrised; they are not a measure of residual risk |

---

## 8. Compliance readiness (ISO/IEC 27001:2022 and SOC 2)

> **CKAM is NOT ISO/IEC 27001 certified and has NO SOC 2 report (neither Type I nor Type II).** Only an accredited
> certification body can certify an ISMS, and only a licensed CPA firm can issue a SOC 2 report. This section is a
> readiness view written by the same programme; it is not an audit opinion.

### 8.1 ISO/IEC 27001:2022

| View | Verdict (final) | Basis |
|---|---|---|
| Technical controls | **PARTIAL** (improved) | Strong in code (access control, logging, append-only records, secure coding, security testing, secret masking), but the production-side items are not deployed: IF-01 live, plain HTTP, SYSTEM account, shared servers, single unencrypted backup location, app role owns the audit tables |
| Process / organisational | **WEAK** | No approved policy, no named ISMS lead, no owned risk register, no access reviews, internal audit or management review have run; 15 policies are **drafts** |
| People / physical | **NOT EVIDENCED** | Inherited from CityKart HR / Facilities / IT; nothing seen |

Annex A mapping of all **93 controls** (`CKAM_ISO27001_READINESS.md` **v1.1** and `CKAM_ISO27001_CONTROL_MATRIX.csv/.xlsx`,
updated 2026-10-16 at `fd34520`; production view, "READY IN CODE — NOT DEPLOYED" counted as PARTIAL):

| Control kind | Controls | READY | PARTIAL (of which READY IN CODE — NOT DEPLOYED) | MISSING | NOT EVIDENCED | N/A |
|---|---|---|---|---|---|---|
| TECHNICAL | 31 | 4 | 20 (1) | 1 | 5 | 1 |
| PROCESS | 27 | 1 | 19 (0) | 6 | 1 | 0 |
| ORGANISATIONAL | 21 | 0 | 4 (0) | 5 | 12 | 0 |
| PHYSICAL | 14 | 0 | 0 (0) | 1 | 13 | 0 |
| **Total** | **93** | **5** | **43 (1)** | **13** | **31** | **1** |

READY: A.8.11, A.8.28, A.8.29, A.8.31 (technical), A.8.34 (process). READY IN CODE — NOT DEPLOYED: A.8.3 (access
restriction; only the deploy is missing). Applicability 89 yes / 3 partly / 1 no; technical-component tag ready in 11
controls. Why the totals barely move although the code is much stronger: almost every technical control also needs
something outside the code (deploy, HTTPS, DB role split, service account, off-server backups, alerting). The **draft
risk register now has 40 risks** (R-01…R-40; v1.0 had 33): today 3 Critical (R-02, R-03, R-18), 13 High, 16 Medium,
4 Low among the 36 that exist in production now. The **working-draft Statement of Applicability**
(`policies/15_…`) was **regenerated on 2026-10-16** from the v1.1 matrix (it shows 42 PARTIAL + 1 READY IN CODE —
NOT DEPLOYED = the 43 above); it is explicitly not the official SoA, which needs an approved risk assessment and
treatment plan first (clause 6.1.3 d).

**The 15 draft policies** (`docs/security/policies/`): 01 Information Security Policy, 02 Access Control, 03
Joiner/Mover/Leaver, 04 Change Management, 05 Incident Response, 06 Vulnerability Management, 07 Backup/Restore,
08 BC/DR, 09 Supplier Security Review, 10 Awareness, 11 Periodic Access Review, 12 Risk Management, 13 Internal Audit
Checklist, 14 Management Review Agenda, 15 SoA working draft; plus 6 blank record templates (access review, incident,
change, restore test, vulnerability triage, JML). **Status: 15 documents, 0 approved, 0 operating, 0 records.**
**What they do NOT prove:** that any control operates. A draft policy is not a control; an auditor asks for approval
records and operating evidence (filled forms over time). Certification would need the ISMS to run (at least one
internal audit and one management review) before Stage 1/Stage 2.

### 8.2 SOC 2

| Category | Recommendation | Readiness |
|---|---|---|
| Security (Common Criteria CC1–CC9) | Required | CC1 control environment, CC4 monitoring, CC7 operations, CC9 risk mitigation **NOT READY**; CC2, CC3, CC5, CC6, CC8 **PARTIAL** |
| Confidentiality | Recommended (two companies' vendor/PO data, documents) | PARTIAL |
| Processing Integrity | Recommended (append-only ledger, all-or-nothing receipts, idempotency, race safety — CKAM's strongest area) | PARTIAL, close to ready |
| Availability | Optional | NOT READY (single servers, no off-server backup, no DR) |
| Privacy | Not in first scope (internal tool; legal review EXT-31 first) | NOT IN SCOPE |

Control matrix (`CKAM_SOC2_READINESS.md` **v1.1**, `CKAM_SOC2_CONTROL_MATRIX.csv/.xlsx`, 2026-10-16): **75 controls —
11 READY, 35 PARTIAL (9 of them READY IN CODE — NOT DEPLOYED), 27 NOT READY, 2 NOT IN SCOPE**. Per criterion: CC1 4
(0/0/4), CC2 3, CC3 3, CC4 2, CC5 2, CC6 19 (1 READY, 11 PARTIAL of which 6 in code only, 7 NOT READY), CC7 10, CC8 7,
CC9 2, A1 6, C1 5 (2 READY), PI1 8 (6 READY), P 4 (2 not in scope). No control became READY in the closure, because
nothing was deployed and no people-run control has operated.

- **Type I** (design and implementation at a point in time): **WEAK as to production.** The **code design is
  strong**, but Type I describes controls in place in the running system, and nothing runs in production yet.
  Moving to PARTIAL needs at least EXT-01/02/04/05/38/39 plus approved policies, an incident plan, an access review
  and a change record.
- **Type II** (operating effectiveness over a period): **NOT READY — cannot be claimed.** There is no observation
  period at all; people-run controls (access reviews, change approvals, restore tests, log reviews, patching,
  incident handling) have **no records**; `error_log`, `system_event` and `client_report` are kept only **180 days**
  (`LOG_RETENTION_DAYS`), shorter than a 12-month period (SD-15); production audit logging exists only since
  2026-10-14.
- **Evidence CKAM can already produce automatically** (head-office admin only, each use itself audited): full audit
  trail with filters and JSONL/CSV export (`/api/admin/logs/audit`, `/api/admin/logs/export`); user/role export;
  access-change, password, failed-login, lock, rate-limit, permission-denied, invalid-token, refresh-reuse events;
  exports and document access; append-only custody history; release id and environment in `app_started` events and
  diagnostics; health and migration state; ERP sync events; grouped error log; per-request trace. **Not produced:**
  access-review sign-off, change approval record, backup success/off-server copy/restore result, patch status,
  alerts.

---

## 9. PENDING as of now (the reviewer's to-do)

### 9(a) Production actions, in order (all PREPARED in `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`; none done)

| Step | Action | Owner | Prerequisite / gate |
|---|---|---|---|
| 0 (today) | **Close or narrow the internet forward of TCP 3211** as an interim measure (SD-04, EXT-05) | Infra + owner | Confirm who outside the office needs CKAM; reduces IF-01 exposure while the deploy is prepared |
| 0 (today) | Lock down the dev PC `.env`, `backups\`, worktree; check BitLocker (EXT-10) | Owner / IT (elevated) | `closure/infra/IF-09_ACL_PLAN.md`; do not lock out Docker Desktop |
| 1 | *(updated 2026-10-17, security release: the runbook is now steps A–N; the release is `<RELEASE-SHA>` from the rebuilt package (`<ZIP-SHA256>`), not the superseded `eed3de1`; go/no-go in `CKAM_PRODUCTION_SECURITY_GO_NO_GO.md`; change record draft `CKAM_EMERGENCY_CHANGE_RECORD_DRAFT.md`)* Re-read the release paperwork: the runbook was updated on 2026-10-16 (Phase 4 lists `f9a1c3e5b7d2` → `a3c5e7f9b1d4` → `b5d7f9a1c3e5` → `c6e8a0b2d4f6`; start flags `--no-proxy-headers --no-server-header`; QR deep-link check; roll-forward-only note) — confirm `<RELEASE-SHA>` / `<FINAL-HEAD>` are filled in the change record; use `ops/windows/verify_release.ps1` | Dev | Before the window |
| 2 | Owner approvals in writing: **separate** deploy request for a named release (≥ `fd34520`); window; rotation of 4 secrets right after (SD-01). The push approval comes later (step 13) | Owner | Change record started (EXT-42, EXT-35 template) |
| 3 | Copy production logs off the server with SHA-256 list **before anything restarts** (EXT-41) | IT | Admin-only evidence folder |
| 4 | Precheck (EXT-39): `ENVIRONMENT_NAME=production`; `JWT_SECRET` ≥ 32 chars, ≥ 8 distinct, not a placeholder (checked without printing); backup task healthy and which DB login it uses; disk space; **is `ckappuser` / `ckpost` used only by CKAM?** (EXT-43); migration rehearsal on a scratch copy | IT, DBA, Dev | Stop if backup fails or release lacks `3e134c1` |
| 5 | Package the release locally (`releases\<sha>\{backend,frontend-dist}`) and copy it to the server — **no push needed** for a deploy | Dev / IT | Release = `fd34520` or later |
| 6 | Backup: DB dump (+ `pg_restore --list` check), NAS snapshot/copy, copy of `.env` and launcher | DBA / IT | — |
| 7 | Stop `CKAM-Web` (only CKAM's listener); `pip install -c constraints.txt` (EXT-12; if a Windows wheel is missing, install as before and keep EXT-12 open); `alembic upgrade head` → `c6e8a0b2d4f6` **before** any new code starts | IT | Failure → do not start code; old release is not a safe fallback |
| 8 | Switch `FRONTEND_DIST_DIR` / `APP_VERSION` to the release folder (UTF-8 without BOM) | IT | — |
| 9 | Launcher: uvicorn with `--no-proxy-headers --no-server-header` (EXT-38; compare with `ops/windows/run_ckam_web.ps1.template`, EXT-13); keep `TRUSTED_PROXIES` empty | IT | Forged `X-Forwarded-For` logged as 127.0.0.1 |
| 10 | **Verify** (runbook Phase 7 + `verify_release.ps1`): all traversal probes 404 incl. `..%5c`, `%2e%2e%5c`, `C:%2fWindows%2fwin.ini`, UNC, `CON`/`NUL`; unknown `/api` JSON 404; `/docs`,`/redoc`,`/openapi.json` 404; headers once; `/assets/<id>` and `/assets/new` open + one real label scan (EXT-44); diagnostics show release + `production` + migrations ok; sign-in; receive + move smoke writes ledger + audit rows. *(updated 2026-10-17, security release: `/api/health` + `verify_release.ps1` alone are not proof, GT-F05; the move, not the receive, proves the new code, GT-F01; also scan one default "Barcode + QR" label, GT-F02)* | IT + SEC | **Gate: no rotation until every check passes**; from server and from a LAN PC |
| 11 | Rotate in order: JWT secret (everyone signs in again) → `ckassetapp` DB password (and the backup task's credential if it uses it) → NAS password (only if CKAM-only, else EXT-43 first) → ERP password (ERP owner) → restart, re-verify; delete `.env.pre-*` copies | IT / DBA / NAS admin / ERP owner | Owner types every password on the servers |
| 12 | Compromise assessment (EXT-03; procedure `CKAM_COMPROMISE_ASSESSMENT_PLAN.md`, added 2026-10-17): hunt `/assets/` requests with `..`, `%2e`, `%2f`, `%5c`, `C:`, UNC in the preserved `app.jsonl` (exists only since 2026-10-14); admin actions without matching LOGIN rows; unexpected admins/grants; PostgreSQL, NAS, router, Windows event logs; write the incident record honestly ("cannot be ruled out before 2026-10-14") | SEC / owner | Legal on CERT-In reporting (EXT-31) |
| 13 | **Then** the approved `git push` (push only) — the repository is **PUBLIC**; alternatively make it private first, or keep `docs/security/evidence/**` out of the push (options A/B/C with costs: `CKAM_GITHUB_PUBLIC_REPO_OPTIONS.md`, added 2026-10-17) | Dev | Owner's push phrase for this change; deploy verified and secrets rotated |
| 14 | Within 30 days: HTTPS (EXT-04), service account (EXT-06), DB role split with the **updated** scripts (EXT-07 + EXT-45; run `check_least_privilege.sql` read-only first; mind the migrator-INHERIT caveat, 5.3), off-server backups + restore drill (EXT-08), alerts on `log_write_failed` and REFRESH_REUSE bursts (EXT-48), watch `RATE_LIMITED` rows and set the per-office NAT rule (EXT-40, EXT-49), patching, EDR | Infra / DBA / IT | Plans in `docs/security/` |
| 15 | Every later deploy: re-run `check_least_privilege.sql` and keep the output (EXT-46) | IT / DBA | After EXT-07 |
| 16 | After the first 8 hours post-deploy: a small release removing the legacy (no-`sid`) refresh-token path | Dev | All pre-deploy tokens have expired |

### 9(b) External actions (EXT) grouped by urgency

Source: `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, now **EXT-01 … EXT-50** (EXT-44…50 added on 2026-10-16). Status of every
EXT: **OPEN** (nothing done on any server). "Repo work done" notes what the programme prepared.

| Urgency | ID — action (owner) | Repo work done |
|---|---|---|
| **URGENT** | EXT-01 deploy the security release (Mgmt + IT) · EXT-02 rotate JWT/DB/NAS/ERP secrets after EXT-01 (IT + Infra) · EXT-03 compromise assessment (Security + IT) · EXT-05 close/restrict the 3211 forward — decision now (Infra + Mgmt) · EXT-10 dev PC `.env`/`backups\`/disk (IT + Dev) · EXT-38 launcher `--no-proxy-headers` (IT) · EXT-39 pre-deploy checks (IT + Dev) · EXT-41 preserve logs off-server (IT + Security) · EXT-42 signed change record (Dev + Mgmt) · EXT-43 CKAM-only NAS account decision (Infra + NAS admin) · **EXT-44** deploy the QR / Asset 360 deep-link fix CL2-IF-04 — same deploy as EXT-01 (Mgmt + IT; code done `ca94574`) | Runbook, reference launcher with both flags, deploy template refusing weak secret / dev env name, verify script, IF-09 plan, change-record template |
| **30 days** | EXT-04 HTTPS · EXT-05 complete · EXT-06 service account · EXT-07 DB role split · EXT-08 backups + restore test · EXT-09 patching (then monthly) · EXT-12 constrained installs · EXT-13 launcher/release script in git, Windows runbook · EXT-18 quarterly access review · EXT-20 incident response plan · EXT-22 monitoring + weekly security-log review · EXT-23 password manager + break-glass · EXT-26 D6 decision · EXT-33 joiner/mover/leaver · EXT-35 change record per release · EXT-37 antimalware/EDR · EXT-40 rate limit vs NAT (30 days after deploy) · EXT-43 complete · **EXT-45** run the **updated** `ops/db` role-split scripts (sequences USAGE/SELECT only, `RESET ALL`), never an older copy (part of EXT-07) · **EXT-48** alert on `log_write_failed` and REFRESH_REUSE bursts (30 days after deploy, with EXT-22) · **EXT-49** per-office NAT policy for the 20/min sign-in limit (decision SD-08, 30 days after deploy) · **EXT-46** re-run `check_least_privilege.sql` after **every** deploy (from the first deploy after EXT-07) | HTTPS plan; service-account plan; `ops/db/*` scripts + simulation; backup plan; `constraints.txt`; `ops/windows/*`; draft policies 03, 04, 05, 11 + templates |
| **90 days** | EXT-11 self-host fonts — **done in code (FONTS), closes on deploy** · EXT-14 external VAPT · EXT-17 policy set approval · EXT-19 MFA decision · EXT-21 log retention + off-server log shipping · EXT-25 ERP read-only role with TLS (ERP owner) · EXT-27 PostgreSQL logging on 10.0.0.205 · EXT-28 company-owned repo, MFA, branch protection, CI · EXT-29 BCP/DR, RTO/RPO, reboot test · EXT-30 store-login rule · EXT-31 legal review (DPDP Act 2023, CERT-In) · EXT-32 awareness, screening/NDAs · EXT-34 supplier review · EXT-36 ISMS roles, risk ownership (90 d part) · **EXT-47** replace `python-jose` with PyJWT (Dev) · **EXT-50** decide an absolute session lifetime (decision SD-14) | `PO_SOURCE_SSLMODE` option; 15 draft policies; regenerated SoA working draft; 40-risk draft register |
| **12 months** | EXT-15 ISO 27001 certification body · EXT-16 SOC 2 auditor (CPA firm) · EXT-24 segregation from shared servers · EXT-36 internal audit + management review (12 m part) | Readiness assessments and matrices |

### 9(c) Decisions required (SD-01 … SD-16)

Nothing here is decided. Answer format for the owner: "SD-06: C". Record each answer in `docs/ai/DECISIONS.md`.

| ID | Question | Options | Recommendation | Suggested deadline |
|---|---|---|---|---|
| SD-01 | Deploy the security release now, then change the server secrets? | A deploy now · B wait for everything | **A** | Request by 2026-10-23 |
| SD-02 | Limit Full Admins to chosen companies (D6)? | A all companies (today) · B own + ticked companies | **B**, before CKVPL goes live | 2026-11-15 |
| SD-03 | MFA? | A none, admin work on LAN/VPN · B TOTP for head-office admin + Full Admins · C all staff | **B**, after HTTPS | 2027-01-14 (sooner if internet stays open) |
| SD-04 | Internet exposure of 3211? | A close forward, VPN · B HTTPS + store IP allow-list · C as today | **A** if stores have VPN/MPLS, else **B**; **close now as interim** | Decide 2026-10-23, done 2026-11-15 |
| SD-05 | When to add HTTPS? | A now (after SD-01) · B only if internet stays · C keep deferred | **A** (set `TRUSTED_PROXIES` if a proxy is used) | Cert choice 2026-10-30, live 2026-11-15 |
| SD-06 | Lock-out model (AU-04)? | A hard lock · B growing delay · C hybrid | **C** (B if smallest change) | 2026-11-15 |
| SD-07 | Shared store logins? | A manager only · B named staff logins (needs product change) · C sharing with rules | **A** now | Before bulk issue; ≤ 2027-01-14 |
| SD-08 | 20 sign-ins/min per address for NAT'd offices? | A keep and watch 30 days · B raise · C trusted networks | **A** | 30 days after deploy |
| SD-09 | `audit_log` retention vs personal-data law | A forever · B period after legal review + yearly archive · C blank old fields | **B** after legal; keep A + 5-year floor until then | Legal by 2026-11-15; decide 2027-01-14 |
| SD-10 | Independent external VAPT | A after deploy + infra fixes · B external scan now · C defer 12 months | **A** | Quotes 2026-12-15; test 2027-01-31 |
| SD-11 | Production DB role names/window | A three new roles · B keep `ckassetapp` as runtime + `ckasset_owner`/`ckasset_migrator` | **B** (never reuse retired `ckam_app`) | Window by 2026-11-15 |
| SD-12 | Same-name rule in Excel master import | A refuse · B warn · C allow | **A** — note: **already implemented** for brands/vendors (WP-A1) and categories (WP-F2); owner should ratify or ask for revert | 2027-01-14 |
| SD-13 | Password expiry | A no calendar expiry, change on events · B 90 days · C admins only | **A** + MFA for admins | 2027-01-14 |
| SD-14 | Session lifetime | A today (15 min / 8 h idle, no maximum) · B 12 h absolute + 2 h idle for admins · C 1 h idle for all | **B** | 2027-01-14 |
| SD-15 | Log retention vs 12-month SOC 2 period | A 400 days · B export monthly off-server · C both | **C** if SOC 2 is a goal, else **B** | With SD-16 |
| SD-16 | Is ISO/SOC 2 a goal; ISMS lead; approve drafts | A ISO certification · B adopt policies, decide later · C SOC 2 | **B** | 2027-01-14 |

### 9(d) Accepted risks — and whether the reasoning still holds

| Item | Accepted because | Still holds? |
|---|---|---|
| IF-12 `python-jose` / `ecdsa` advisories | HS256 pinned on decode; only `jose.jwt` used; no asymmetric keys; ecdsa never imported; 6 forged-token variants refused | **Yes**, but it is debt: no fixed versions exist; migrate to PyJWT (9g) |
| AU-02 423 for any password while locked | Saying "locked" only to the right password would make the lock a guessing oracle | **Yes** while the hard lock exists; revisit with SD-06 (B/C keep the same rule: wait before checking the password) |
| CL2-SE-N02 400 instead of 413 for malformed `Content-Length` | Refused by the HTTP parser before the body is read | **Yes** |
| OBS-POLYGLOT | Only served as `attachment` + `nosniff` with extension-derived type | **Yes** until any screen renders documents inline |
| N8 e-mail change keeps sessions | Not an access change | **Yes** (debatable if e-mail is the login id — reviewer may disagree) |
| N7 sign-out signs out every device of a shared store login | Follows from AU-05 design | Pending SD-07 |
| AU-06 residuals (10 s grace, thief-wins race, lost-response false alarm, legacy path) | Usability for multi-tab users; detection not prevention | **Partly**: remove the legacy path after deploy; consider grace 0–5 s once real usage is observed |
| OBS-STATUS marker settable by the app role | Defence in depth; the barrier is the role split | **Only after EXT-07** — until then the production app role owns the trigger and can drop it |
| In-process rate limiter | One uvicorn process; simple | **Yes** while single-process; breaks silently if someone adds `--workers N` (limits ×N) or a proxy without `TRUSTED_PROXIES` (one shared bucket) |

### 9(e) Open observations (not findings)

OBS-DOCKER-SU (dev/UAT app role is superuser) · CL2-IF-OBS-02 (runtime image run flags not documented) · Diagnostics
screen does not show the audit-write failure count · N9 (backdated audit INSERT) · OBS-CSP-STYLE · OBS-NPM-DEV ·
CL1-OBS-SECRET-01 (untracked demo walkthrough with a demo password) · HEAD → 405 on single-port SPA pages ·
`alembic check` unusable (env.py does not import `app.items.models`) · lifecycle marker sent twice per asset (bulk
overhead) · CL3-DBA-INHERIT (pre-existing migrator with an INHERIT membership not corrected by `role_split.sql`) ·
CL3-COVERAGE (direct OBS-STATUS UPDATE as runtime role inconclusive on an empty DB) · small document residuals
(section 10 item 14) · `docs/ai/LOGGING_AND_DIAGNOSTICS.md` §4 still describes the old 1-day purge floor (per SD-09
note).

### 9(f) Known unknowns

1. Whether IF-01 was exploited before 2026-10-14 (no access logs) — and whether other apps' secrets on 10.0.1.98
   were read.
2. Strength of the production `JWT_SECRET` and whether `ENVIRONMENT_NAME` is set (the new release refuses to start if
   weak).
3. Whether `ckappuser` (NAS) and `ckpost` (ERP) are shared with other apps (blocks their rotation).
4. Who has write access to the GitHub repository and whether MFA/branch protection exist (its **visibility is
   known: PUBLIC**, verified 2026-10-16 — see the warning at the top).
5. Whether stores reach CKAM via the internet forward, MPLS or VPN (decides SD-04).
6. Whether `pip install -c constraints.txt` succeeds on Windows (wheel availability).
7. The exact production schema vs the migration chain (rehearsal on a copy is a precheck item).
8. Production table ownership and grants on 10.0.0.205 (documented as `ckassetapp` owner, not inspected).
9. Whether the ERP warehouse supports TLS and grants SELECT-only to `ckpost`.
10. Whether a NAS document backup exists; encryption at rest on 10.0.0.205 and the NAS.
11. Behaviour of fonts, body limits, sessions and NAS mapping under the real Windows service account.
12. The portable Python version used for the native Windows test (not recorded) vs production's 3.13.
13. Whether an unattended browser tab keeps renewing its session (affects SD-14).
14. Whether the dev worktree was modified by any other local account (IF-09 makes it possible).
15. BitLocker state of the dev PC (needs elevation).

### 9(g) Recommended next engineering work (priority order)

| # | Item | Why / size |
|---|---|---|
| 1 | Fill the change record for the actual release (runbook already updated 2026-10-16); add the migrator-INHERIT step to `ops/db/ROLE_SPLIT_RUNBOOK.md` (or an explicit `GRANT … WITH INHERIT FALSE` in `role_split.sql`) | Prevents a failed or incomplete production deploy / role split; small |
| 2 | Remove the legacy refresh-token path one release after deploy | Closes "forged legacy token accepted once" if the key leaked; small |
| 3 | Build the SD-06 choice (C recommended) and stop `/refresh` ending open sessions because of a lock | Removes the store-login lock-out DoS; ≈ 2 days |
| 4 | Diagnostics screen: show audit-write failure counts (`observability/writer.py::failure_counts()`) and alert on > 0 (EXT-48) | Makes CL2-IF-01-style blinding visible to the admin; small |
| 5 | CI pipeline on a **self-hosted runner** (needs Docker + Postgres, no internet secrets): pytest on `ckam_test`, tsc, vitest, build, `check:build`, `check:nginx-live`, `npm audit --omit=dev`, `pip-audit` on `constraints.txt`, gitleaks, migration single-head check | Independent check of every change (IF-17); medium |
| 6 | Replace `python-jose` with PyJWT (HS256 pinned, same claims; drop `ecdsa`) (EXT-47) | Retires IF-12 debt; medium (all auth tests) |
| 7 | Set the lifecycle marker once per transaction in bulk paths (or drop the explicit "off") | −100 SQL round trips per 50-asset move; small, keep the trigger |
| 8 | SBOM (CycloneDX for npm + pip) and CVE scan of base images (`python:3.13-slim`, `nginx:alpine`, `postgres:17`) with Trivy/Grype; proper secret scan (gitleaks/trufflehog) over history | Closes three limitations; small once CI exists |
| 9 | Signed commits, company-owned repository, branch protection, second reviewer (EXT-28) | Supply-chain integrity |
| 10 | External VAPT (SD-10/EXT-14) after the deploy and infra fixes | Independence |
| 11 | MFA (TOTP) for head-office admin + Full Admins after HTTPS (SD-03) | Migration + enrolment + recovery |
| 12 | Absolute session lifetime + shorter admin idle (SD-14 B, EXT-50) | Small (original sign-in time in the cookie) |
| 13 | Store-login policy (SD-07) and Full Admin company scope (SD-02 B) with cross-company tests | Medium |
| 14 | Cross-company allotment (owner decision 2026-10-13, not built) — design with security review (company isolation is a core control) | Product feature |
| 15 | Smaller items: `alembic/env.py` import fix (enables `alembic check`); HEAD support in single-port; N9 trigger; CSP without `'unsafe-inline'` styles; stricter document sniff if inline preview is added; dev/UAT role split with a privileged clean-up role; document runtime-image run flags | Hygiene |

---

## 10. Where to be sceptical (candid list for the reviewer)

1. **Refresh-reuse grace window (10 s).** A thief presenting the *just-replaced* token within 10 s gets one 15-minute
   access token (no cookie). If the thief renews first, detection happens only when the real user renews. A lost
   response (network drop) produces a false "reuse" and signs the person out. The legacy path (tokens without `sid`)
   accepts a forged legacy-style token once if the signing key is stolen — real control is EXT-02.
2. **Lifecycle DB guard is defence in depth only.** `ckam.lifecycle_writer` can be set by any session running SQL as
   the app role. Until the production role split (EXT-07), the app role also owns the trigger and can drop it.
3. **AU-02 / AU-04.** 423-for-any-password reveals that a known id is locked; combined with the hard lock it lets a
   stranger disrupt named users (especially predictable store logins). The decision is still open.
4. **"Unset ENVIRONMENT_NAME = production"** is fail-closed and correct for production, but every new script, local
   run or tool that imports the settings without the variable now refuses weak secrets and hides docs — expect
   surprises in development, not in production.
5. **Rate limiting is per IP and in-process.** Many staff behind one NAT share 20/min; a future reverse proxy without
   `TRUSTED_PROXIES` puts everyone in one bucket; `--workers N` multiplies the limits; restarts reset counters.
6. **Secret scan is regex-only** (no gitleaks/trufflehog image); images and PNGs not OCR'd; container OS packages not
   CVE-scanned; no SBOM.
7. **Linux/Docker vs Windows production.** Nearly all testing ran on Linux containers behind nginx or in
   production-mode Linux containers. Only the IF-01 static route was run natively on Windows — on the dev PC, not on
   10.0.1.98, with an unrecorded Python version. Windows-only side effects (SMB on UNC stat, junctions, 8.3 aliases)
   were prevented lexically and proven by monkeypatched tests, not by execution on the server.
8. **The late fixes were retested — with two caveats.** WP-F changed the very route that had the Critical bug (new
   SPA branch under `/assets/`); WP-F2 changed name rules and error mapping. A **third independent retest** on the
   final code re-attacked all six (≈ 360 cases, 52/52 logged assertions PASS, 0 new findings, incl. route-looking
   canary files in `<dist>/assets` that were never served). Caveats: (a) the direct OBS-STATUS `UPDATE` as the runtime
   role was inconclusive on an empty database (guard verified present and enabled; behaviour covered by app-level
   tests and retest 2); (b) a DBA caveat — `role_split.sql` does not correct a **pre-existing** migrator role that
   already has an `INHERIT` membership (the documented path creates it fresh). Retest 3 also documents that a
   well-formed client `X-Request-ID` (1–64 safe characters) is echoed by the API for correlation — intended, but a
   reviewer may prefer server-only ids.
9. **Tests written by the same team that fixed.** Independent retesters (four rounds) were separate agents, but AI
   agents under the same lead and brief; independence is procedural, not organisational. An external VAPT is still
   needed.
10. **Counts are of cases, not unique risks**, and many are parametrised; "2,541 tests" is not a risk measure.
11. **Evidence anomalies we found (none changes a conclusion):** the native-Windows transcript does not probe the QR
    deep link although the subject of `fd34520` says so (the QR fix is proven by the permanent tests and retest 3);
    the refusal bodies are otherwise identical but carry different request ids, so the script's
    `distinct_refusal_bodies` counts ids, not body differences; the sessions report says "41 cases" in its header but
    its table and CSV have 56; `retest_tests.csv` reuses 30 ids; first-round access CSV has 466/467 rows depending on
    the trailing line; the commit count was inconsistent across documents and has been corrected everywhere to
    **22 commits ahead of origin = 21 security commits + `4ba4e94`** (`git rev-list --count c66378d..HEAD` at
    `fd34520`; it rises as the documentation commits are added). Retest 3's ≈ 360 is an approximate count of discrete requests/statements; only the 52 assertions are logged.
12. **Performance was measured on WSL2 loopback**; production's database is across the LAN, so per-statement costs
    (the lifecycle marker) are larger there.
13. **Role split proven on PostgreSQL 17**, production is 18; never run on the real database; the dev/UAT app role is
    still a superuser, so day-to-day development does not exercise least privilege.
14. **Document residuals after the 2026-10-16 reconciliation:** the runbook, registers, ISO/SOC 2 (v1.1), EXT list
    and the final closure report were brought up to date (commit counts, risk-register size, retest 3, the QR-link
    wording). Still slightly off, for the reviewer to note: the SoA working draft's "Source" line still names the
    2026-10-15 matrix although its totals are the v1.1 ones; the decisions paper (SD-12 is already implemented; SD-04
    said labels carry only the asset code while a `main.py` comment says QR labels encode the deep link — the
    `main.py` comment is right for the default format: bulk labels in "Barcode + QR" (default) = deep link, "QR
    Code"/"Barcode" = asset code, Asset 360 QR = deep link; SD-04 corrected 2026-10-17, GT-F02).
15. **Behaviour changed ahead of decisions:** Excel imports now refuse same-name brands/vendors/categories
    (OBS-NAME-IMPORT) although SD-12 is formally open.
16. **Supply-chain integrity of the release itself:** the code lives on a PC where any local account can modify the
    worktree (IF-09), commits are unsigned, and there is no CI. The push/deploy relies on trust in that PC.
17. **Pushing publishes exploit detail.** The evidence contains working IF-01 payloads, internal IPs, paths and the
    production layout. The GitHub repository **is public** (verified), so pushing before the deploy publishes a
    recipe for the live server.
18. **Rollback is not symmetric** (section 11.5): after migration `c6e8a0b2d4f6`, the old code cannot record any
    asset movement (move, repair, sale, scrap …). It can still receive, and users see a misleading 422 for the
    refused actions *(updated 2026-10-17, security release, GT-F01)*.
19. **Partial-closure labels:** IF-05/06 are "MITIGATED" only for non-owner roles; in production today the app role is
    the owner, so the practical protection begins only with EXT-07.

### Questions we would like the reviewing AI to answer

1. Is the IF-01 fix complete for Windows? Review `is_safe_relative_name` + `safe_asset_path` + the CL2-IF-04 regex
   branch (section 5.3) for any bypass (e.g. Unicode normalisation, `%`-decoding layers in Starlette, case-insensitive
   NTFS, long-path `\\?\` forms, alternate separators) — and whether serving the SPA shell for any extension-less
   1–3-segment `/assets/` name has side effects.
2. Is a 10-second refresh grace window reasonable, or should production start strict (0) or shorter?
3. Should the legacy refresh-token path be removed in the first release or the second?
4. Is the marker-based lifecycle trigger worth its cost, or should the strong form (column privileges + `SECURITY
   DEFINER` setter) be built after EXT-07?
5. Is the deploy order (fix → verify → rotate) right given the secrets may already be stolen? Should the JWT secret be
   rotated **during** the deploy anyway (it must be new after the fix either way)?
6. Is closing the internet forward before the deploy sufficient as an interim, or should CKAM be stopped until the
   fix is live?
7. Which SD decisions would you change (especially SD-06, SD-02, SD-14, SD-09)?
8. Is the in-process rate limiter adequate for a single-process Windows deployment, or should limits move to the
   database?
9. Are the four migrations safe to run on a populated PG 18 database in one window (locks on `asset`, `audit_log`)?
10. What would you require before calling ISO technical readiness "STRONG" or SOC 2 Type I "PARTIAL"?
11. Is the role-split script safe to run on a database server shared with other apps (it touches only CKAM's database
    and roles — please check `ops/db/role_split.sql` if a human provides it)? Should it force `WITH INHERIT FALSE`
    for an existing migrator (retest-3 DBA caveat)?
12. What independent tests would you run first with a small budget?

---

## 11. Push and deploy readiness

### 11.1 What is safe to push and why

- **All 22 local commits** (`4ba4e94` … `fd34520`): code, tests, scripts, documents, evidence. Reasons: full test
  suites pass on the final code; no real secret in the tree, history, built frontend or images (regex scan); evidence
  uses fake canaries, placeholders and throw-away test values; no production configuration is changed by a push.
- **UPDATE 2026-10-16 — the repository is PUBLIC (verified, see the warning at the top).** The earlier wording
  "confirm the repository is private" is therefore replaced by: **do not push the 22 commits while production still
  has IF-01.** Safe order: (1) build the release package locally from `fd34520` or later (deploys are local
  packages, not pulled from GitHub), deploy, verify, rotate secrets; (2) then push. If the owner wants the code
  safely backed up earlier, make the repository private first, or push only to a private repository, or push the
  code commits without `docs/security/evidence/**` and the attack-detail sections of the registers.
- **Conditions:** (1) the public/private question above; (2) do **not** add the untracked
  `docs/ai/CKAM_DEMO_WALKTHROUGH.md` / `demo-screens/` (demo password); (3) if this handover file is committed
  first, it becomes commit 23 — and it contains the same exploit detail, so treat it like the evidence folder.

### 11.2 What a push does NOT do

It does not deploy, does not run migrations, does not change any secret, does not touch 10.0.1.98, 10.0.0.205 or the
NAS. **Production stays vulnerable to IF-01 and keeps the QR/Asset 360 deep-link bug until the deploy.**

### 11.3 Approval phrases (from `CLAUDE.md`)

- **"commit and push to git and main"** = commit, then push to `origin` (default branch `claude/brave-euler-07879a`;
  no branch is literally called `main`). **Push only.** Each approval covers that change only.
- **Deploying to production** needs its **own explicit request** naming the release and window. The owner types every
  superuser, database and NAS password on the servers; secrets are never pasted into chat, tickets or AI tools.

### 11.4 Pre-flight checklist for the production release

| # | Check | Expected |
|---|---|---|
| 1 | Release commit contains `3e134c1`, `7b039fb` (IF-01-WIN, N6, unset-env), `69c3a51`, `734fd19`, `ca94574` (CL2-IF-04, sequence grants), `fafa225` | `git merge-base --is-ancestor` true for each; recommended release = `fd34520` or later |
| 2 | Migration list | `f9a1c3e5b7d2` → `a3c5e7f9b1d4` → `b5d7f9a1c3e5` → `c6e8a0b2d4f6`; final head `c6e8a0b2d4f6`; rehearsed on a scratch copy from `3b5e842`'s schema |
| 3 | `shared\.env` | `ENVIRONMENT_NAME=production`; `JWT_SECRET` ≥ 32 chars, ≥ 8 distinct, not a placeholder (else the app refuses to start); `TRUSTED_PROXIES` empty; `COOKIE_SECURE=false` until HTTPS; no BOM |
| 4 | Launcher | `--no-proxy-headers --no-server-header`; equals the reviewed template apart from paths; SHA-256 recorded |
| 5 | Logs preserved and backup taken | Hash lists exist; `pg_restore --list` OK |
| 6 | Shared accounts | Answers recorded for `ckappuser` and `ckpost` |
| 7 | Users informed | ~30 min downtime; everyone signs in again after the JWT rotation; sessions open at deploy keep working until then (legacy tokens are upgraded on first renewal) |
| 8 | Post-start | *(updated 2026-10-17: runbook step H; diagnostics version + `production` + migrations ok and a real sign-in are mandatory, GT-F05)* Phase 7 all 404, `/assets/<id>` and `/assets/new` shell + one real Asset 360 QR scan (EXT-44), JSON 404s, headers once, smoke receive + move OK, `RATE_LIMITED` rows appear only under abuse |
| 9 | Monitoring | If an uptime monitor uses `HEAD /`, expect 405 (use GET) |

### 11.5 Rollback notes

- **Code rollback is not symmetric with the schema.** The migrations stay. `f9a1c3e5b7d2`, `a3c5e7f9b1d4`,
  `b5d7f9a1c3e5` are additive and old code would ignore them. **`c6e8a0b2d4f6` breaks the old code partly** *(updated
  2026-10-17, security release, gate rehearsal GT-F01; the earlier text said every receive was refused too)*:
  every move, repair, lost/found, dispose, sale or scrap **updates** `asset.status` / holder / status date without the
  marker and is refused by the trigger, with a misleading HTTP 422 "Some of the values could not be saved. Check them
  and try again." for the user (the real reason is only in `error.jsonl`). **Receives still work**, because a receive
  **inserts** the asset already in its final state and the `BEFORE UPDATE OF …` trigger never fires. A code rollback
  to `3b5e842` therefore needs the trigger removed (owner-run `alembic downgrade -1` from the new release's backend
  folder, rehearsed in 0.89 s; never a downgrade of all four), which the runbook otherwise forbids on production —
  and `3b5e842` reopens IF-01 anyway.
- **A failed `alembic upgrade head` rolls back all four migrations** (one transaction): the database stays at
  `e6f8a0b2c4d6` (GT-F04). **New code on that un-migrated database looks healthy** (`/api/health` 200, app page,
  bare `verify_release.ps1` passes) but every sign-in fails with the same misleading 422 (GT-F05): only `alembic
  current` = heads, the startup `head_mismatch` warning and a real sign-in catch it.
- **The deploy template's automatic restart of the previous release after a late failure is being removed** in the
  rebuilt package; until the operator has read the fixed template, no automatic rollback is relied on
  (`CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` §6).
- **Recommended stance: roll forward.** If verification fails, stop `CKAM-Web`, keep the internet forward closed, fix
  and redeploy; restore the pre-deploy dump only on the owner's decision.
- Reference scripts: `ops/windows/rollback_release.ps1.template` switches the release folder only and warns that the
  schema is not rolled back.

### 11.6 Go / no-go (one page)

*(updated 2026-10-17, security release: the detailed gate table with an evidence path per gate is now
`CKAM_PRODUCTION_SECURITY_GO_NO_GO.md`; this summary is kept as written on 2026-10-16.)*

| Gate | Go when | Today |
|---|---|---|
| Push | Owner phrase given; **production fix deployed first OR repository made private OR evidence kept out of the push** (the repository is PUBLIC); untracked demo files excluded | **Technically ready; recommended AFTER the deploy** (awaiting owner) |
| Deploy request | Explicit owner request naming release and window | Not given |
| Paperwork | Runbook Phase 4/6/7 updated (or `verify_release.ps1` used); change record started | Runbook **updated 2026-10-16** (migration list, both flags, QR check); change record **not started** |
| Precheck | Env name, JWT strength, backup, logs copied, shared-account answers, rehearsal | Not done |
| Migrations | 4 revisions applied before start; head `c6e8a0b2d4f6` | Not done |
| Start flags | `--no-proxy-headers --no-server-header` | Not done (live launcher unknown) |
| Verification | All Phase 7 checks pass from server and LAN | Not done |
| Rotation | JWT → DB → NAS → ERP after verification | Not done |
| Compromise check | Incident record written | Not done |
| Interim exposure | Internet forward closed or narrowed | Not done |
| **Overall** | **Production remediated** | **NO-GO until the gates above pass. Production remains NOT remediated.** |

---

## 12. Appendices

### Appendix A — File map

| Path (under `docs/security/` unless stated) | Purpose |
|---|---|
| `CKAM_SECURITY_MASTER_HANDOVER.md` | This file |
| `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` | Closure-stage summary (management + technical closure statement); its finding counts (51 / 32 / 4 / 3 / 0 / 12) are the ones used here |
| `CKAM_SECURITY_COMPLETE_REPORT.md` | **Earlier** first-programme compilation (VAPT, register, remediation, retests, EXT) as of 2026-10-15 — **superseded by this file** |
| `CKAM_SECURITY_FINDINGS_REGISTER.md` | The 43 first-round findings with fix/retest/commit, plus the closure addendum (51 findings, same counts as 5.1) |
| `CKAM_SECURITY_CLOSURE_REGISTER.md` | Re-classification of every finding/observation before closure; work packages; decisions list; final status in its section 0 |
| `CKAM_SECURITY_REMEDIATION_REPORT.md` | How each first-round fix was made/tested; changed tests; deploy order; role design |
| `CKAM_VAPT_REPORT.md` | Scope, method, tools, counts, verdict of the first VAPT |
| `CKAM_THREAT_MODEL.md`, `CKAM_SECURITY_BASELINE.md` | STRIDE threat model; baseline rules for every change |
| `CKAM_EXTERNAL_SECURITY_ACTIONS.md` | EXT-01 … EXT-50 with owner, timing, done-when, prerequisite/rollback/evidence matrix |
| `CKAM_SECURITY_DECISIONS_REQUIRED.md` | SD-01 … SD-16 options papers |
| `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` | 14-phase deploy/rotate/compromise runbook + printable checklist + DO NOT list |
| `CKAM_HTTPS_IMPLEMENTATION_PLAN.md`, `CKAM_SERVICE_ACCOUNT_PLAN.md`, `CKAM_BACKUP_RESTORE_PLAN.md` | Plans for IF-02, IF-07, IF-08 |
| `CKAM_ISO27001_READINESS.md` + `_CONTROL_MATRIX.csv/.xlsx` | ISO readiness v1.1: 93-control mapping by control kind, 40-risk draft register |
| `CKAM_SOC2_READINESS.md` + `_CONTROL_MATRIX.csv/.xlsx` | SOC 2 readiness v1.1, 75 controls |
| `CKAM_SECURITY_EVIDENCE_INDEX.md` | Index of first-round evidence |
| `policies/` (`README.md`, 01–15, `templates/`) | DRAFT policy pack, SoA working draft (regenerated 2026-10-16), 6 record templates |
| `evidence/access/` | First-round authorization matrix (217×11), IDOR, escalation, logic harnesses and results |
| `evidence/auth/` | First-round auth/session/timing/lock/race/header scripts and results; audit coverage |
| `evidence/input/` | First-round SQLi/XSS/formula/upload/traversal batteries; raw-SQL review |
| `evidence/infra/` | First-round DB privilege/trigger SQL outputs, IF-01 reproduction, ERP cross-company draft, dependency audit |
| `evidence/retest/` | Retest 1 (access 646, auth/input/infra 310), raw outputs and scripts |
| `evidence/closure/backend/` | WP-A1, WP-A2 results; AU-04 options; dependency re-check |
| `evidence/closure/db/` | WP-B results; role-split simulation outputs `rs_01…rs_08`; SQL and scripts |
| `evidence/closure/infra/` | WP-C evidence; IF-09 ACL plan; npm audit re-check; raw docker/fonts/windows proofs |
| `evidence/closure/docs/` | Index of closure documents (WP-D) |
| `evidence/closure/retest1/` | Closure retest 1 (137 cases), raw outputs, scripts |
| `evidence/closure/retest2/{access,infra,sessions}/` | Second independent retest (319 / 122 / 56 cases), concurrency bursts |
| `evidence/closure/retest3/` | Third independent retest of the six late fixes + regression sweep (≈ 360 cases, 52/52 logged assertions PASS, 0 new findings; DBA caveat and coverage note) |
| `evidence/closure/perf/` | Performance before/after, raw samples, scripts |
| `evidence/closure/wpf/` | WP-F and WP-F2 results; before/after reproductions; X-Request-ID live check |
| `evidence/closure/windows/` | Native Windows attack script and three result files |
| `ops/windows/`, `ops/db/` (repo root) | Windows reference scripts; DB role-split scripts and runbook |

### Appendix B — How to reproduce the key checks (generic; local only, never against production)

```text
# Backend tests (dev api container, test DB only; one pytest process at a time on the machine)
docker compose cp backend/app/. api:/app/app/
docker compose cp backend/tests/. api:/app/tests/
docker compose cp ops api:/app/                       # needed by tests/security/test_least_privilege_role_split.py (else it skips)
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://<user>:<pw>@db:5432/ckam_test api python -m pytest -q
#   (Git Bash: prefix MSYS_NO_PATHCONV=1 when an argument looks like a path)

# Frontend (in frontend/)
npx tsc -b && npx vitest run
npm run build && npm run check:build
npm run check:nginx-live                              # needs Docker; throw-away nginx container

# Browser journeys (reproduce the lead's final 2026-10-16 runs; no transcript was committed)
E2E_BASE_URL=http://localhost:3411 E2E_SEC_PASSWORD=<persona test password> npx playwright test e2e/security.spec.ts   # expect 14/14
E2E_BASE_URL=<UAT stack URL, sign-in rate limit off for that stack only> npx playwright test                       # expect 11 passed, 1 skipped (ERP journey)

# Least-privilege check (read-only; any CKAM database; PostgreSQL 15+)
psql -X -v ON_ERROR_STOP=1 -d <ckam db> -v runtime_role=<role in DATABASE_URL> [-v owner_role=<owner>] -f ops/db/check_least_privilege.sql

# Role split (superuser, disposable DB first; then verify)
psql -X -v ON_ERROR_STOP=1 -d <db> -v db_name=<db> -v owner_role=<owner> -v migrator_role=<migrator> -v runtime_role=<runtime> -f ops/db/role_split.sql
psql ... -f ops/db/role_split_verify.sql
#   migrations afterwards: run Alembic as the migrator with ALEMBIC_SET_ROLE=<owner>
#   if the migrator role existed BEFORE the split: GRANT <owner> TO <migrator> WITH INHERIT FALSE; then re-run verify (retest-3 caveat)
# Retest 3 scripts and raw output: docs/security/evidence/closure/retest3/{scripts,raw}

# Windows path attack (native Windows run of a LOCAL production-layout copy with FAKE secrets only)
node docs/security/evidence/closure/windows/attack.mjs <port> <label>   # adapt the hard-coded fake-layout root path in the script

# Post-deploy verification on Windows (GET only, no sign-in)
powershell -NoProfile -ExecutionPolicy Bypass -File ops/windows/verify_release.ps1 <parameters per ops/windows/README.md> [-IncludeUncProbe only once the fixed release is live]

# Performance: docs/security/evidence/closure/perf/scripts (seed_perf.py, bench.mjs, make_table.mjs, compose overrides)
```

### Appendix C — Full commit list (`git log --reverse 4ba4e94^..fd34520`)

Subjects (paraphrased), dates and areas are in section 6.1, same order. Files changed / lines added / removed:

`4ba4e94` 4 / +38 −2 · `3e134c1` 2 / +48 −2 · `7e57844` 6 / +63 −3 · `ba04371` 5 / +81 −10 · `77431ba` 7 / +139 −15 ·
`4fa5c9b` 14 / +801 −35 · `ae706bb` 34 / +1651 −62 · `da790d1` 4 / +109 −2 · `d04779a` 9 / +191 −17 ·
`a3e8fce` 2 / +3 −3 · `627ed73` 162 / +20779 · `3362c1b` 2 / +2353 · `7b039fb` 21 / +1419 −49 · `f746e71` 51 / +5007 −6 ·
`79dbae7` 55 / +4418 −24 · `69c3a51` 22 / +1302 −37 · `b401e9f` 4 / +25 −5 · `734fd19` 32 / +2957 −11 ·
`ca94574` 28 / +1086 −54 · `8664b77` 177 / +22271 · `fafa225` 6 / +576 −19 · `fd34520` 2 / +37 (its subject says
"QR deep link 200"; see 5.3 precision note). Whole range: 587 files, +65,158 / −196; **22** commits ahead of origin
`c66378d`. Uncommitted at the time of writing: the closure-stage document updates,
`CKAM_SECURITY_FINAL_CLOSURE_REPORT.md`, `evidence/closure/retest3/` and this file.

### Appendix D — Settings and environment variables

| Variable | Default | Effect | Production guidance |
|---|---|---|---|
| `ENVIRONMENT_NAME` | **`production`** if unset (changed) | Any name outside `development, dev, test, testing, uat, security-test, local, ci` = production: weak `JWT_SECRET` refused, API docs off (JSON 404) | Set `production` explicitly |
| `JWT_SECRET` | placeholder `dev_secret_change_me` (dev) | Signing key; production requires ≥ 32 chars, ≥ 8 distinct, not a placeholder | New random value right after the fix is verified |
| `JWT_ACCESS_MINUTES` / `JWT_REFRESH_HOURS` | 15 / 8 | Access-token life / sliding refresh idle window (unchanged) | SD-14 may add an absolute limit |
| `REFRESH_REUSE_GRACE_SECONDS` | 10 (clamped 0–300) | Window in which the just-replaced refresh token counts as a harmless duplicate; 0 = strict | Keep 10 or lower after observation |
| `RATE_LIMIT_ENABLED` | true | In-process sign-in limiter on/off | true (off only on test stacks) |
| `RATE_LIMIT_WINDOW_SECONDS` | 60 | Sliding window | — |
| `RATE_LIMIT_LOGIN_PER_IP` / `_PER_LOGIN_ID` | 20 / 10 | Sign-in attempts per window | Watch for NAT'd offices (SD-08) |
| `RATE_LIMIT_REFRESH_PER_IP` | 60 | Session renewals per window | — |
| `RATE_LIMIT_CHANGE_PASSWORD_PER_IP` | 10 | Password changes per window | — |
| `TRUSTED_PROXIES` | empty | Only these peer addresses may set `X-Forwarded-For` (affects rate-limit key and audit IP) | Empty now; `127.0.0.1` when an HTTPS proxy is added |
| `COOKIE_SECURE` | false | `Secure` flag on refresh cookie | `true` only once HTTPS is live (true over HTTP signs everyone out) |
| `PO_SOURCE_SSLMODE` | `prefer` | ERP TLS: disable/allow/prefer/require/verify-ca/verify-full; invalid value stops start-up | `verify-full` after EXT-25 |
| `PO_SOURCE_SSLROOTCERT` | empty | CA file for verify modes (empty = system store) | Set with verify modes |
| `ERP_CONNECT_TIMEOUT_SECONDS` / `ERP_STATEMENT_TIMEOUT_SECONDS` / `ERP_COPY_STATEMENT_TIMEOUT_SECONDS` | 10 / 60 / 120 | ERP read limits; exceeded → "ERP unavailable" | — |
| `LOG_RETENTION_DAYS` | 180 (existing) | Purge of error/system/client-report rows (`audit_log` kept) | Raise / export monthly if SOC 2 (SD-15) |
| `FRONTEND_DIST_DIR` | empty | Single-port mode switch: serve the built frontend (the IF-01 code path) | Release folder path |
| `ALEMBIC_SET_ROLE` | empty | Migration sessions `SET ROLE <owner>` and verify it | `ckasset_owner` after EXT-07 |
| `CKAM_EDGE_SUBNET` / `CKAM_WEB_IP` | `172.31.211.0/28` / `.10` | Docker dev/UAT nginx fixed address (each parallel stack needs its own) | Not used |
| uvicorn flags | — | `--no-proxy-headers` (N2), `--no-server-header` (banner) | In the production launcher |

### Appendix E — Decisions required (owner answer sheet)

| ID | One-line question | Recommended answer | Urgency |
|---|---|---|---|
| SD-01 | Deploy the security release now, then rotate secrets? | A | **URGENT** |
| SD-04 | Close/restrict the internet forward of 3211? | A (VPN) or B (HTTPS + allow-list); close now as interim | **URGENT** |
| SD-05 | HTTPS now? | A | 30 days |
| SD-02 | Limit Full Admins to chosen companies? | B | 30 days |
| SD-06 | Lock-out model? | C (hybrid) | 30 days |
| SD-11 | DB role names and window? | B (`ckassetapp` runtime + `ckasset_owner` + `ckasset_migrator`) | 30 days after SD-01 |
| SD-08 | Keep 20 sign-ins/min per address? | A, review after 30 days | 30 days after deploy |
| SD-03 | MFA? | B (admins first, after HTTPS) | 90 days |
| SD-07 | Shared store logins? | A (manager only) | 90 days |
| SD-09 | Audit retention vs personal-data law? | B after legal review | 90 days |
| SD-10 | External VAPT? | A (after deploy + infra fixes) | 90 days |
| SD-13 | Password expiry? | A (event-based) | 90 days |
| SD-14 | Session lifetime? | B (12 h absolute, 2 h idle for admins) | 90 days |
| SD-16 | ISO/SOC 2 goal; ISMS lead; adopt drafts? | B | 90 days |
| SD-15 | Log retention vs SOC 2 period? | C if SOC 2, else B | With SD-16 |
| SD-12 | Same-name rule in Excel imports? | A — already built; ratify or revert | Not urgent |

*End of handover.*

