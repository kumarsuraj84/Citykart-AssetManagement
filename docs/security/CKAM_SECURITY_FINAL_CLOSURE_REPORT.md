# CKAM Security — Final Closure Report

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Date | 2026-10-16 |
| Written by | Security closure programme, WP-M2a (senior security auditor / technical writer). Documents only |
| Code state | Starting HEAD `4ba4e94` → final HEAD `fd34520` (branch `worktree-ckam-build`), Alembic single head `c6e8a0b2d4f6` |
| Production | **Not touched. PRODUCTION REMAINS NOT REMEDIATED** (10.0.1.98 still runs `3b5e842`) |
| Git | **Nothing pushed.** 22 commits ahead of origin `c66378d` (`4ba4e94` + 21 security commits) |
| Sources | `CKAM_SECURITY_CLOSURE_REGISTER.md` (section 0), `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md` (Part 2), `CKAM_VAPT_REPORT.md` (addendum), `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_SECURITY_DECISIONS_REQUIRED.md`, `evidence/closure/**` |

> This is an internal security record, not a certification or an audit opinion. CKAM is not ISO/IEC 27001
> certified and has no SOC 2 report.

---

# Part A — Management summary (plain language)

## WHAT WAS STILL OPEN

At the start of today's closure work, the October security test had found 43 problems. Most were already fixed on
the development PC, but some fixable ones were still open, for example:

- Pages loaded their letters (fonts) from Google, so every user's address went to Google.
- The test containers ran as the all-powerful "root" user.
- If someone copied a person's "stay signed in" cookie, it kept working for up to 8 hours.
- Nothing in the database itself stopped a stray program from changing an asset's status without writing it in
  the history.
- On a Windows server, special file names (like `C:\Windows\win.ini` or `\\server\share`) had never actually been
  tried against the IF-01 fix.

Two more rounds of attack by testers who did not write the fixes then found **8 new problems**. The most
important ones:

- The planned database lock-down script still let the app's own login "rewind the numbering" of the audit
  history, which would silently stop new history rows from being saved (CL2-IF-01, Medium).
- On the live-style single server, **opening an asset link directly (for example by scanning the QR code printed from
  an asset's own page) shows an error instead of the asset page** (CL2-IF-04). This bug is also on the live server
  today. **Labels from the bulk "Print Labels" screen are affected too in the default "Barcode + QR" format**: its
  QR holds the same web link (the plain-HTTP `BASE_URL`). Only the "QR Code" and "Barcode" formats hold just the
  asset code. Labels printed today also keep the old address if the web address changes later (for example for
  HTTPS). *(updated 2026-10-17, security release: the earlier sentence "labels from Print Labels carry only the
  asset code and are not affected" was wrong; gate rehearsal finding GT-F02.)*

## WHAT WE FIXED

Everything that could be fixed in the code is fixed on the development PC — **0 code-fixable findings left**.
Examples in everyday terms:

- A file-name trick that read `C:\Windows\win.ini` and the server's password file **worked on the old version
  10 times out of 28** in a real Windows test; on the fixed version **0 times out of 28**.
- A copied "stay signed in" cookie now works once at most: if it comes back, that person is signed out
  everywhere and the event is written in the security log.
- The database now refuses any change to an asset's status or holder that does not go through the history
  ledger.
- Fonts come from CKAM itself; no page talks to Google any more.
- 20 people adding the same category at the same moment now create exactly one category, not three.
- QR labels open the asset page again (on the development PC; production needs the deploy).

Numbers: of **51 findings** in total, **32 fixed, 4 reduced** (the rest needs a server or database
administrator), **3 accepted with a written reason, 12 need outside work or a decision**.

## WHAT CHANGED FOR USERS

- Scanning a QR label opens the asset page (after deploy).
- Changing someone's role, work area, company or password, switching their sign-in off or signing out ends their
  sessions on every device.
- Weak passwords such as `Password@2026`, `Citykart2026` or a password that spells your own name are refused with
  a plain sentence.
- After 20 sign-in attempts a minute from one place, or 10 on one login, the screen says "Too many sign-in
  attempts. Wait a minute and try again."
- Duplicate names for vendors, brands and categories are refused, also in the Excel import.
- A person who loses a "same serial number" race sees "This serial number is already used by another asset."
- Renamed or fake uploads (an HTML page called `.pdf`) are refused.
- Everything else looks the same: screens were compared pixel by pixel after the font change.

## WHAT STILL NEEDS SERVER/INFRA WORK

- **Deploy the fixed release** to 10.0.1.98, then **change the four passwords/keys** (login signing key, database
  password, NAS password, ERP password) and **check whether IF-01 was already used** (logs).
- HTTPS (today passwords travel in clear text, also from the internet).
- Run CKAM under its own low-power Windows account instead of SYSTEM.
- Off-server, encrypted backups and a tested restore.
- Lock down the `.env` file and old dumps on the development PC.
- A database administrator splits the database login into owner / migrator / app (scripts are ready and tested).
- The ERP owner confirms TLS and read-only rights on the ERP connection.
- IT confirms the live launcher matches the reviewed copy in git (and adds two safety flags).

## WHAT NEEDS MANAGEMENT DECISION

16 decisions are written up as A/B choices in `CKAM_SECURITY_DECISIONS_REQUIRED.md`. The three that are findings:
the lock-out rule after wrong passwords (SD-06), whether Full Admins should be limited to chosen companies
(SD-02), and two-step sign-in / MFA (SD-03). Others: internet exposure of port 3211 (SD-04), when to add HTTPS
(SD-05), shared store logins (SD-07), how long sessions and audit records last (SD-14, SD-09), an external
security test (SD-10), and whether ISO 27001 / SOC 2 is a goal (SD-16).

## WHAT IS URGENT

1. **Ask for the deploy** of the security release (SD-01): the live server still lets anyone on the internet read
   files on it, including its passwords (IF-01, open since 2026-09-30).
2. Right after the deploy: **change the four secrets** and **check the logs** for earlier misuse.
3. Decide on internet exposure of port 3211 (SD-04).
4. Lock down the development PC's `.env` and `backups\` folder (EXT-10).

## WHAT IS SAFE TO PUSH

The 21 security commits (plus the earlier small fix `4ba4e94`) are tested and technically safe to push to Git.
**Pushing does not change the live server** — only a separate deploy request does. Do **not** add the untracked
demo walkthrough (`docs/ai/CKAM_DEMO_WALKTHROUGH.md`, `docs/ai/demo-screens/`): it contains a demo password.

**The GitHub repository is PUBLIC** (verified 2026-10-16: the unauthenticated GitHub API and the web page both
return HTTP 200). A push would publish the IF-01 fix, the attack payloads and the evidence (`docs/security/evidence/`)
while the live server is still open. Because releases are packaged locally (production does not pull from
GitHub), the recommended order is **deploy → verify → rotate secrets → THEN push**. The alternatives are to make
the repository private first, or to keep `docs/security/evidence/` out of the push. **The owner should decide this
order before any push.**

---

# Part B — Technical closure statement

## B.1 Required response structure

| Item | Value |
|---|---|
| Stage | Security closure programme — final (local remediation, two independent retests, native Windows test, performance check, documentation) |
| Verdict | **`CKAM LOCAL SECURITY REMEDIATION COMPLETE WITH EXTERNAL ACTIONS`** |
| Starting HEAD | `4ba4e94` |
| Final HEAD | `fd34520` |
| Production touched | **NO** |
| Git pushed | **NO** |
| Repository visibility | **PUBLIC** (verified 2026-10-16: unauthenticated GitHub API and web page return HTTP 200). Recommended order: deploy → verify → rotate secrets → THEN push (releases are packaged locally, not pulled from GitHub); or make the repository private / keep `docs/security/evidence/` out of the push. Owner decides |
| Production status | **PRODUCTION REMAINS NOT REMEDIATED** — live `3b5e842` still contains IF-01 (unauthenticated arbitrary file read on the single-port server) and the QR/Asset-360 deep-link bug (CL2-IF-04) |

Verdict scope: code-side, local. No Critical, High or Medium item that code can close remains open locally. All
32 fixed findings were attacked again by independent testers; the six WP-F / WP-F2 fixes made after retest 2 were
re-attacked in a third independent retest (52/52 assertions PASS, 0 new findings). The testers are AI agents of
the programme, not an external firm.

## B.2 FINDINGS

**Counting rule.** 51 findings = the 43 of the first register + 8 found in the closure retests (CL1-N4-01,
CL2-IF-01, CL2-IF-02, CL2-IF-03, CL2-IF-04, CL2-SE-N01, CL2-SE-N02, CL2-SE-N03); observations are not counted.
Severity as rated by the finder; CL1-N4-01 ("Low–Medium") counted at the higher value MEDIUM; CL2-IF-04
("functional MEDIUM, security INFO") counted at its security value INFO. Each finding sits in exactly one column.
**Fixed** = code fix committed locally and re-attacked by an independent tester (all 32: closure retests 1–3 or
the original retest).
**Mitigated** = code side closed, residual needs DBA/IT work. **Accepted** = kept with a reason re-confirmed on
2026-10-16. **Remaining code** = open and closable by a code change. **External** = needs server, network,
supplier or management action, including decisions. IF-01 is counted External (its code is fixed and retested,
but production also needs secret rotation and a compromise check). No finding is "fixed" in production.

| Severity | Found | Fixed | Mitigated | Accepted | Remaining code | External |
|---|---|---|---|---|---|---|
| CRITICAL | 1 | 0 | 0 | 0 | 0 | 1 |
| HIGH | 1 | 0 | 0 | 0 | 0 | 1 |
| MEDIUM | 16 | 10 | 2 | 0 | 0 | 4 |
| LOW | 25 | 18 | 2 | 2 | 0 | 3 |
| INFO | 8 | 4 | 0 | 1 | 0 | 3 |
| **Total** | **51** | **32** | **4** | **3** | **0** | **12** |

| Count | Value | IDs |
|---|---|---|
| **Open CODE-FIXABLE findings** | **0** (target 0 — met; no exception) | — |
| **Open EXTERNAL** | **9** (excluding decisions) | IF-01, IF-02, IF-07, IF-08, IF-09, IF-16, AU-13, N2, IF-17 |
| Mitigated with an external residual | 4 | IF-05, IF-06 (EXT-07), IF-11 (EXT-12), IF-15 (EXT-13) |
| **Decision required (findings)** | **3** | AU-04 (SD-06), D6 (SD-02), MFA (SD-03); in total 16 owner decisions SD-01…SD-16 |
| Fixed locally, production step beyond deploy | 2 | CL2-IF-01, CL2-IF-02 (only effective when the DBA runs the updated `ops/db/` scripts, EXT-07) |

Code-side work still possible but **not** a finding (deliberately deferred): PyJWT instead of python-jose,
showing the audit-failure count on the Diagnostics screen, removing the AU-06 legacy-token path after the deploy,
`style-src 'unsafe-inline'`, N9, `HEAD` 405 in single-port mode, runtime-image run-flag documentation.

Per-row detail: `CKAM_SECURITY_CLOSURE_REGISTER.md` section 0.4.

## B.3 IMPORTANT RETESTS

| Retest | Result | Evidence |
|---|---|---|
| IF-01 Linux | **PASS** — every traversal (dot-dot, encoded, double-encoded, absolute, Windows-style, NUL, symlink-out, `shared/.env` + `nas.pw` canaries) → 404, 0 leaks, 0 5xx | `evidence/closure/retest1/RETEST1.md` (`CL1-T082`…`T104`), `retest1/raw/if01_results.txt`; `evidence/closure/retest2/access/raw/prod_file_probe.json` (23 payloads, production-mode container) |
| IF-01 Windows-local (native, dev PC) | **PASS** — old `4ba4e94` leaked 10 of 28 (fake `.env`, `nas.pw`, `C:\Windows\win.ini`, also via `\\localhost\C$`); `7b039fb` and final `fafa225` 0 of 28, 0 5xx. Not on the production server; junctions / 8.3 aliases / SMB not exercised | `evidence/closure/windows/native_windows_old_release_4ba4e94.txt`, `native_windows_fixed_release_7b039fb.txt`, `native_windows_final_release_fafa225.txt`, `attack.mjs` |
| N1 request-size limits | **PASS** — 413 with envelope; chunked counted; RSS flat through 256 MB floods (retest 1) and 155.6 → 155.7 MiB (retest 2) | `retest1/raw/n1_raw_results.txt`, `n1_host_results.txt`; `retest2/sessions/raw/a6_size.json` |
| N4 environment fail-closed | **PASS** after the fix — retest 1 found CL1-N4-01 (unset name → development); fixed in `7b039fb`; retest 2: 72 weak combinations refused, unset refuses, message names all three rules | `retest1/raw/n4_results.txt`; `retest2/infra/RETEST2_INFRA.md` item 5 |
| AU-08 password policy | **PASS** — 19 + 13 weak passwords refused 422, passphrases accepted | `retest1/raw/au08_results.txt`; `retest2/sessions/raw/a5_password.json` |
| RACE-1 same-name races | **PASS** — one 201, rest 422, 0 5xx, one active row per name; vendor/brand/item in the retest-2 burst | `retest1/raw/race_results.json`, `race_db_verify.txt`; `retest2/sessions/concurrency_results.md` (f) |
| Refresh-token reuse (AU-06) | **PASS** — 15/15: old cookie after grace → 401 and every session ended; duplicate within grace → access token, no cookie; legacy upgraded once; audit rows; no token material stored | `retest2/sessions/RETEST2_SESSIONS.md` A1, `raw/a1_refresh.json`, `raw/a1b_legacy.json` |
| External concurrency burst | **PASS** — 13 scenarios: same PO × 20 → 1; receive a 6-unit line × 20 → exactly 6; idempotency key × 20 → 1; serial × 20 → 1; batch × 20 → 1; sold twice / moved twice → one outcome; parallel refresh × 20 → one rotation; no 500, no deadlock. Found CL2-SE-N01 / N03 (fixed in `fafa225`) | `retest2/sessions/concurrency_results.md`, `raw/b_concurrency.json`, `raw/b_g_authstorm.json` |
| Database least privilege (local simulation) | **PASS** — runtime role 7/7 needed actions, 40/40 forbidden actions refused, verify 45/45; ≈ 70 more break-out attempts in retest 2 refused; CL2-IF-01 / 02 then fixed and reproduced before/after | `evidence/closure/db/WPB_RESULTS.md`, `rs_05_can_cannot_matrix.out.txt`; `retest2/infra/RETEST2_INFRA.md` 6b; `evidence/closure/wpf/wpf_01_…BEFORE…`, `wpf_02_…AFTER…` |
| Retest 3 — the six late fixes (CL2-IF-01…04, CL2-SE-N01, N03) + regression sweep | **PASS** — ≈ 360 cases, 52/52 logged assertions, 0 new findings: QR/Asset 360 routes serve the app page in single-port mode with canary files never served; all sequence rewrites denied; stored role defaults detected and reset; one request id everywhere; 20 parallel category / serial adds → exactly one. Notes: pre-existing `INHERIT` migrator not repaired by the script guard (DBA note); OBS-STATUS direct UPDATE inconclusive on an empty DB (guard present and enabled) | `retest3/RETEST3.md`, `retest3/tests.csv`, `retest3/raw/` |

(Paths without a prefix are under `docs/security/evidence/closure/`.)

## B.4 SECURITY domains

| Domain | Result | One-line evidence |
|---|---|---|
| Authentication | PASS | Equal-cost refusals (refused kinds within 0.6 ms), rate limits, lock-out without oracle, reuse detection, password policy — retest 2 sessions A1–A7 |
| Authorization | PASS | 217 routes × 14 identities = 3,038 cells, 0 escalations (retest 2 access) |
| Company isolation | PASS | Other company's PO, ERP draft, custom fields, assets → 404 (retest 2 IDOR); D6 is an open decision |
| IT/NON_IT | PASS | Full-Admin work-area limit holds (SECFANIT 404 on an IT asset); category names per work area |
| Self Service | PASS | Own-Assets-Only / store logins see only held assets; setup lists 403 |
| IDOR/BOLA | PASS | Retest 2 IDOR battery incl. per-actor idempotency keys and custody |
| Injection | PASS | SQLi on search/sort/filter 0 × 500; spreadsheet formulas neutralised in exports |
| XSS | PASS | Stored payloads inert in the real UI; CSP `'self'` only, 0 violations |
| Files | PASS (code) — production FAIL until deployed | IF-01 0 leaks on Linux and natively on Windows; uploads checked, stored as UUIDs; downloads attachment + `nosniff` |
| Audit integrity | PASS (application role) — production residual EXT-07 | TRUNCATE/UPDATE/DELETE refused; lifecycle-field trigger; role split proven locally; sequence and role-default holes fixed in `ops/db/` |
| Concurrency | PASS | 13 external burst scenarios, integrity SQL clean |
| Rate limiting | PASS | 429 at the 21st per address and 11th per login id, through nginx and direct, forged `X-Forwarded-For` ignored |
| Secrets | PASS (repository) — production FAIL until rotation | Regex scan of tree, 299+ commits, dist, images, container env: no real secret; weak secrets refuse to start |
| Dependencies | PASS (accepted residual) | npm production 0; python-jose / ecdsa not reachable → ACCEPTED, PyJWT recommended; one dev-only HIGH (OBS-NPM-DEV) |

## B.5 REGRESSION

| Suite | Result |
|---|---|
| Backend pytest (dev api container, `ckam_test`) | **2541 passed, 1 skipped** (baseline 1577; first-programme end 1783; the skip is an environment-only check) |
| Frontend `npx tsc -b` | Clean |
| Frontend `npx vitest run` | **1257 passed in 92 files** (baseline 1223 / 89) |
| `npm run build`, `npm run check:build` | OK — 0 `.map` files, no `sourceMappingURL`, no Google host, no external resource |
| Playwright permanent journeys (UAT stack, sign-in limit off for that stack only) | **11 passed, 1 skipped** (ERP-unmatched-vendor journey skips itself: ERP link off on the test stack). Asset-lifecycle journey timing race in the test stabilised in `fd34520` |
| Security Playwright journeys (`frontend/e2e/security.spec.ts`) | **14/14** |
| Performance (old vs new, identical data) | 31 operations, none over threshold; refused sign-in +33 ms by design; bulk Move of 50 +23…34 ms |
| Permanent tests added | ≈ 960 backend test cases (1577 → 2541) in 27 new backend test modules; ≈ 34 new frontend tests (1223 → 1257) in 3 new frontend test files; 14 browser security journeys; DB least-privilege pytest; nginx / build security checks |

## B.6 COMPLIANCE READINESS (readiness only — no certification or attestation claimed)

| Area | Status |
|---|---|
| ISO/IEC 27001 — technical readiness | **PARTIAL** (improved: technical controls strong in code; production-side items not deployed) |
| ISO/IEC 27001 — organisational readiness | **WEAK** (15 policies and 6 record templates are DRAFT — MANAGEMENT APPROVAL REQUIRED; none approved, none operating) |
| SOC 2 Type I readiness | **WEAK** as to production (nothing runs in production yet); the **code design** is strong |
| SOC 2 Type II evidence programme | **NOT READY** (no operating period, no review records; 180-day log retention is shorter than a 12-month observation) |
| Documents | Annex A mapping (93 controls), draft SoA, 40-risk register; SOC 2 matrix (Security required; Confidentiality + Processing Integrity recommended); 16-decision paper |

## B.7 EXTERNAL ACTIONS (from `CKAM_EXTERNAL_SECURITY_ACTIONS.md`; none is marked complete)

**URGENT**

- EXT-01 Deploy the security release (IF-01 first) · EXT-39 pre-deploy checks (`ENVIRONMENT_NAME=production`,
  strong JWT secret, `alembic upgrade head` before start, constraints) · EXT-38 start uvicorn with
  `--no-proxy-headers` (and `--no-server-header`) · EXT-41 copy production logs off-server before the deploy ·
  EXT-42 signed change record for the IF-01 deploy.
- EXT-02 Rotate JWT secret, `ckassetapp` DB password, NAS password, ERP password — **after** EXT-01.
- EXT-03 Compromise assessment for IF-01.
- EXT-10 Dev PC: lock down `.env` and `backups\`, disk encryption, purge old dumps.
- Decisions now: EXT-05 internet port-forward of 3211 (SD-04); EXT-43 CKAM-only NAS account before rotating the NAS
  password.

**30 days**

- EXT-04 HTTPS · EXT-05 complete the port-forward change · EXT-06 low-privilege service account · EXT-07 database
  role split **using the updated `ops/db/` scripts** · EXT-08 off-server encrypted backups + restore test · EXT-09
  patching baseline · EXT-12 locked Python installs · EXT-13 live launcher reconciled with `ops/windows/` · EXT-18
  first access review · EXT-20 incident response plan · EXT-22 monitoring and weekly log review · EXT-23 password
  manager for server secrets · EXT-26 D6 decision · EXT-33 joiner/mover/leaver · EXT-35 change record per release ·
  EXT-37 antimalware/EDR · EXT-40 review the sign-in limit 30 days after the deploy · EXT-43 CKAM-only NAS account.

**90 days**

- EXT-11 self-hosted fonts (code done in `79dbae7`; closes with the deploy) · EXT-14 independent external VAPT ·
  EXT-17 policy set · EXT-19 MFA decision · EXT-21 log retention and off-server shipping · EXT-25 ERP read-only
  role with TLS · EXT-27 PostgreSQL slow-query/lock logging · EXT-28 company-owned repository, MFA, branch
  protection, CI · EXT-29 BCP/DR · EXT-30 shared store logins rule · EXT-31 legal review · EXT-32 awareness ·
  EXT-34 supplier review · EXT-36 ISMS roles and risk ownership.

**12 months**

- EXT-15 ISO 27001 certification body · EXT-16 SOC 2 auditor · EXT-24 segregation from shared servers · EXT-36
  first internal audit and management review.

**Management decisions** (from `CKAM_SECURITY_DECISIONS_REQUIRED.md`; **none decided**)

| ID | Decision | Urgency | Recommendation |
|---|---|---|---|
| SD-01 | Deploy the security release, then change the server secrets | URGENT | A — deploy now |
| SD-04 | Internet exposure of port 3211 / VPN | URGENT | A (close, VPN) if stores have VPN, else B |
| SD-02 | Full Admin company scope (D6) | 30 days | B — limit to chosen companies |
| SD-05 | When to add HTTPS | 30 days | A — now, after SD-01 |
| SD-06 | Lock-out after wrong passwords (AU-04) | 30 days | C — hybrid |
| SD-08 | Sign-in limit per internet address | 30 days after deploy | A — keep 20/min and watch |
| SD-11 | Production database roles (date, names) | 30 days after SD-01 | B — keep `ckassetapp` as runtime, add two roles |
| SD-03 | MFA | 90 days | B — head-office admin + Full Admins first |
| SD-07 | Shared store logins | 90 days | A — one login, store manager only |
| SD-09 | Audit-log retention vs personal-data law | 90 days | B — after legal review |
| SD-10 | Independent external VAPT | 90 days | A — after deploy and infrastructure fixes |
| SD-13 | Password expiry | 90 days | A — no calendar expiry |
| SD-14 | Session absolute lifetime (none today) | 90 days | B — daily limit, shorter for admins |
| SD-16 | ISO 27001 / SOC 2 as a goal; ISMS lead; approve the DRAFT policies | 90 days | B — adopt policies, certify later |
| SD-15 | Log retention vs a 12-month SOC 2 observation | Only if SD-16 says SOC 2 | C |
| SD-12 | Same-name rule in the Excel master import | Not urgent | A — already built (`7b039fb`, `fafa225`); the owner may overrule |

Not a security decision but still open: cross-company allotment (owner decision of 2026-10-13) is not built.

## B.8 LOCAL COMMITS (`git log --oneline 4ba4e94..HEAD`)

```
fd34520 test(security): final native-Windows path run on the committed code (0 leaks, QR deep link 200), stabilise the lifecycle journey's session-end timing
fafa225 fix(security): closure WP-F2 — one active category/sub-category name per work area (also under parallel requests and imports), friendly 422 for the loser of a same-serial race
8664b77 docs(security): second independent retest evidence (access 319 cases, infra 122, sessions + parallel burst 56), performance before/after, native Windows path test
ca94574 fix(security): closure WP-F — QR/Asset 360 deep links work on the single-port server, no ledger id-sequence rewrite for the runtime database role, audit-write failures stay visible, X-Request-ID on nginx answers, no server banner
734fd19 fix(security): closure WP-B — database guard on asset status/holder/date, local role split (owner/migrator/runtime) proven, repeatable least-privilege checks
b401e9f fix(security): backend CSP without Google hosts, JSON 404 for the documentation paths where they are switched off
69c3a51 fix(security): closure WP-A2 — refresh-token reuse detection with server-side hashed session records, atomic session version increment
79dbae7 fix(security): closure WP-C — self-hosted fonts, non-root containers, real client address behind nginx, headers exactly once, build and nginx security checks, Windows reference scripts
f746e71 docs(security): urgent production runbook, HTTPS, service-account and backup/restore plans, decisions required, 15 draft policies with record templates, first closure re-attack evidence
7b039fb fix(security): closure WP-A1 — lexical Windows-path guard before any file lookup, JSON 404 for unknown /api, ERP TLS options, unset environment counts as production, stricter name look-alike passwords, duplicate-name check in the brand/vendor import
3362c1b docs(security): closure register (all findings and observations classified before the closure work) and the single-file complete security report
627ed73 docs(security): VAPT report, findings register, remediation report, ISO 27001 and SOC 2 readiness, control matrices, threat model, baseline, external actions and the evidence pack
a3e8fce fix(security): run uvicorn in Docker without proxy-header rewriting (N2) and correct the lock-out comment
d04779a fix(security): refuse oversized request bodies, treat unknown environment names as production, catch common words with numbers in passwords
da790d1 fix(security): serialize same-name vendor/brand creation, add concurrency tests, security rules in the guardrails
ae706bb fix(security): sign-in timing and rate limits, revocable sessions, password policy, audit TRUNCATE guards and purge floor, document content checks, ERP timeouts, production hardening
4fa5c9b fix(security): nginx and build hardening, clean sign-out, session-ended notice and security e2e journeys
77431ba fix(security): staff-only setup lists, company-scoped custom fields and a head-office admin login that an employee code cannot block
ba04371 fix(security): read import uploads in pieces and refuse files over 15 MB (413) before they reach openpyxl
7e57844 fix(security): hide other companies' ERP PO drafts and refuse to start in production with a placeholder JWT secret
3e134c1 fix(security): stop the /assets route serving files outside the frontend assets folder (path traversal)
```

21 commits after `4ba4e94`; `4ba4e94` itself (a small frontend fix) is also unpushed → 22 ahead of origin `c66378d`.
Note: the subject of `fd34520` says "QR deep link 200", but the committed evidence file
`native_windows_final_release_fafa225.txt` records a probe of `/some/spa/route` only; the QR deep link is proven
by `backend/tests/test_static_frontend_spa_assets.py` and by retest 3 in a single-port production-mode Linux
container (`evidence/closure/retest3/raw/if04_result.txt`), not natively on Windows.

Migrations added (in order): `f9a1c3e5b7d2`, `a3c5e7f9b1d4`, `b5d7f9a1c3e5`, `c6e8a0b2d4f6` — run
`alembic upgrade head` before starting the new code.

## B.9 ARTIFACTS (each path checked to exist on 2026-10-16)

Reports and registers (`docs/security/`):

- `CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` (this file)
- `CKAM_SECURITY_CLOSURE_REGISTER.md` (final status in section 0)
- `CKAM_SECURITY_FINDINGS_REGISTER.md` (closure addendum)
- `CKAM_SECURITY_REMEDIATION_REPORT.md` (Part 2)
- `CKAM_VAPT_REPORT.md` (closure addendum; verdict replaced)
- `CKAM_SECURITY_MASTER_HANDOVER.md` (written in parallel by another writer; content not reviewed here)
- `CKAM_SECURITY_COMPLETE_REPORT.md`, `CKAM_SECURITY_BASELINE.md`, `CKAM_SECURITY_EVIDENCE_INDEX.md`, `CKAM_THREAT_MODEL.md`
- `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_SECURITY_DECISIONS_REQUIRED.md`
- `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`, `CKAM_HTTPS_IMPLEMENTATION_PLAN.md`, `CKAM_SERVICE_ACCOUNT_PLAN.md`, `CKAM_BACKUP_RESTORE_PLAN.md`
- `CKAM_ISO27001_READINESS.md`, `CKAM_ISO27001_CONTROL_MATRIX.csv`, `CKAM_ISO27001_CONTROL_MATRIX.xlsx`
- `CKAM_SOC2_READINESS.md`, `CKAM_SOC2_CONTROL_MATRIX.csv`, `CKAM_SOC2_CONTROL_MATRIX.xlsx`
- `policies/README.md`, `policies/01_…` to `policies/15_Statement_of_Applicability_Working_Draft.md`, `policies/templates/` (6 record templates) — all DRAFT

Closure evidence (`docs/security/evidence/closure/`):

- `backend/WPA1_RESULTS.md`, `backend/WPA2_RESULTS.md`, `backend/AU-04_OPTIONS.md`, `backend/dependency_recheck.md`
- `db/WPB_RESULTS.md`, `db/rs_01`…`rs_08` outputs and SQL
- `infra/WP-C_closure_evidence.md`, `infra/IF-09_ACL_PLAN.md`, `infra/npm_audit_recheck.md`
- `wpf/WPF_RESULTS.md`, `wpf/WPF2_RESULTS.md`, `wpf/wpf_01`…`wpf_04`
- `retest1/RETEST1.md`, `retest1/tests.csv`, `retest1/raw/`
- `retest2/access/RETEST2_ACCESS.md` (+ `authz_matrix.csv`, `tests.csv`), `retest2/infra/RETEST2_INFRA.md` (+ `tests.csv`), `retest2/sessions/RETEST2_SESSIONS.md` (+ `concurrency_results.md`, `tests.csv`)
- `retest3/RETEST3.md`, `retest3/tests.csv`, `retest3/raw/`, `retest3/scripts/` (third independent retest; **untracked** at the time of writing — to be committed by the lead)
- `perf/PERF_REPORT.md`
- `windows/native_windows_old_release_4ba4e94.txt`, `windows/native_windows_fixed_release_7b039fb.txt`, `windows/native_windows_final_release_fafa225.txt`, `windows/attack.mjs`
- `docs/INDEX.md`, `docs/WPD2_INDEX.md`

Repository scripts and tests:

- `ops/db/role_split.sql`, `ops/db/role_split_verify.sql`, `ops/db/check_least_privilege.sql`, `ops/db/ROLE_SPLIT_RUNBOOK.md`
- `ops/windows/run_ckam_web.ps1.template`, `ops/windows/deploy_ckam.ps1.template`, `ops/windows/verify_release.ps1`, `ops/windows/rollback_release.ps1.template`, `ops/windows/README.md`
- `docs/ai/CKAM_RELEASE_RUNBOOK.md` (Windows section)
- `frontend/e2e/security.spec.ts`, `frontend/src/security/nginx-config.test.ts`, `frontend/scripts/check-build-security.mjs`, `frontend/scripts/check-nginx-live.mjs`

**Working tree: NOT CLEAN — only because of the untracked demo walkthrough files** `docs/ai/CKAM_DEMO_WALKTHROUGH.md`
and `docs/ai/demo-screens/` (a local demo from an earlier task that contains a demo password; deliberately not
committed). The four documents updated, this new report and the retest-3 evidence folder are uncommitted
documentation changes of this final step; the lead commits them, after which only the demo walkthrough remains.

---

# Part C — User-impact review (every fix)

"Who" = who notices. All of it applies only **after the deploy**.

| Fix | User-visible? | Before | After | Who is affected |
|---|---|---|---|---|
| IF-01 / IF-01-WIN path traversal | NO | Anyone could read server files via `/assets/…` | Plain 404, no file touched | Nobody (attackers blocked) |
| CL2-IF-04 QR / Asset 360 deep link (single-port) | YES | Scanned label → JSON error page | Asset 360 opens | Everyone scanning labels |
| IF-03 ERP draft per company | YES (rare) | Other company's ERP draft visible | "This purchase order was not found in the ERP." | Operators of one company |
| IF-04 / N4 / CL1-N4-01 start-up guard | YES (IT only) | Weak or placeholder secret accepted; missing `ENVIRONMENT_NAME` = development | Server refuses to start with a sentence naming the rules | IT / operator |
| IF-05 / IF-06 TRUNCATE guards, purge floor | NO | One statement could empty the audit trail | Refused; purge only above 5 years | Nobody |
| OBS-STATUS lifecycle-field trigger | NO | Stray writes could change status/holder | Refused unless through the ledger | Nobody |
| CL2-IF-01 / CL2-IF-02 role-split scripts | NO | (scripts not yet run anywhere real) | Safer scripts for the DBA | DBA |
| Audit-write failure reporting | NO (admins: Logs → System events) | First failure only, then silence | Counted, repeated once a minute | Admins / IT |
| IF-10 ERP timeouts | YES (only when ERP is down) | Requests hung | "ERP unavailable" after about 10 s | Purchase / receiving staff |
| IF-16 ERP TLS settings | NO (default unchanged) | No option | Optional TLS modes | IT |
| AU-01 equal-cost refusal | NO | Unknown login answered faster | Same time for every refusal (+33 ms) | Nobody notices |
| AU-03 rate limits | YES (rare) | Unlimited attempts | "Too many sign-in attempts. Wait a minute and try again." | Anyone hammering sign-in; busy offices behind one address (SD-08) |
| AU-04 lock-out | unchanged | 5 wrong → 15 min lock | Same (decision pending) | — |
| AU-05 / AU-07 sessions end on access change | YES | Old sessions kept working | Signed out on role / work area / company / password / sign-in-off changes and on sign-out, on every device | All users; shared store logins (one sign-out signs out every device) |
| AU-06 refresh reuse detection | YES (rare) | Copied cookie usable for 8 h | Reused cookie → that person signed out everywhere | Victims of cookie theft; very rarely a user whose renewal answer was lost |
| OBS-TV atomic session version | NO | Concurrent bumps could be lost | None lost | Nobody |
| AU-08 password policy | YES | Weak passwords accepted | Refused with a plain sentence | Anyone changing a password |
| AU-12 source maps / build checks | NO | — | Permanent checks | Developers |
| AU-14 / FONTS CSP and self-hosted fonts | NO (looks identical) | Google Fonts on every load | Fonts from CKAM; CSP `'self'` | Everyone (privacy) |
| AU-15 / N1 size limits, no version banner | YES (rare) | Huge bodies read in full | 413 "This request is larger than … allowed here." | Anyone sending oversized requests |
| AU-16 lock-out counter race | NO | Parallel guesses exceeded the limit | Exactly 5 | Nobody |
| AC-1 setup lists staff-only | YES | Self-service / store logins saw vendor and setup lists | 403 for those lists; own assets unchanged | Own-Assets-Only and store logins |
| AC-2 custom fields per company | YES (small) | All companies' fields listed | Global + own company only | Staff limited to one company |
| IN-02 import size cap | YES (rare) | Unbounded Excel read | 413 "Split it into smaller files" over 15 MB | Admins importing |
| IN-03 upload content check | YES (rare) | Renamed files accepted | "This file is not a real PDF file. Upload the original document." | Anyone uploading documents |
| IF-14 / N6 docs off, unknown `/api` JSON 404 | NO (integrations only) | API map public; unknown API → web page | JSON 404 | Integrations, monitors |
| PO-LOGIN | NO | An employee code could block the head-office login | Primary Owner always signs in | Head-office admin |
| RACE-1 + import, CL2-SE-N01 duplicate names | YES | Duplicates possible (screen race, import, categories) | "… already exists." (also per import row) | Admins maintaining masters |
| CL2-SE-N03 serial race message | YES (rare) | "This record already exists." (409) | "This serial number is already used by another asset…" (422) | Receiving / asset entry |
| IF-13, N3, N5, CL2-IF-03, tmpfs, `--no-server-header` (Docker dev/UAT) | YES (dev/UAT only) | Root containers; shared sign-in bucket; duplicate headers | Non-root; own bucket per user; headers once; request id everywhere | Developers, UAT testers |
| N2 / IF-15 / IF-11 launcher and deploy scripts | NO | Server-only scripts | Reviewed reference in git | IT |

---

All approved security remediation and retesting is complete locally. Nothing has been pushed or deployed. Would you like me to push these security commits to Git?

Because the GitHub repository is PUBLIC, the owner should first decide the order: deploy → verify → rotate secrets
→ then push (recommended), or make the repository private / keep `docs/security/evidence/` out of the push.

**PRODUCTION REMAINS NOT REMEDIATED** until the release is deployed, the four secrets are rotated and the IF-01
compromise assessment is done.
