# CKAM Security Closure Register (live)

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Date | 2026-10-16 (baseline, written **before** any closure fix starts). **FINAL status added 2026-10-16 after the closure programme (section 0)** |
| Code state read | Baseline: HEAD `627ed73` (parent `a3e8fce`), Alembic head `a3c5e7f9b1d4`, worktree `ckam-build`. At the time of reading `git status` showed no modified code files. **Final: HEAD `fd34520`, Alembic single head `c6e8a0b2d4f6`**; working tree clean except the untracked demo walkthrough (`docs/ai/CKAM_DEMO_WALKTHROUGH.md`, `docs/ai/demo-screens/`) |
| Inputs | `CKAM_SECURITY_COMPLETE_REPORT.md` (Parts A-G; checked line by line to be identical to the individual files), `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md`, `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_VAPT_REPORT.md`, `evidence/retest/*` (`retest_access.md`, `retest_auth_input_infra.md`, `concurrency_results.md`, `retest_tests2.csv`), and the current source (`backend/app`, `backend/Dockerfile`, `docker-compose.yml`, `frontend/nginx.conf`, `frontend/index.html`, `frontend/vite.config.ts`, `frontend/src/lib/auth-fetch.ts`) |
| Production | Not touched. Production (10.0.1.98) still runs `3b5e842`; nothing is pushed or deployed. **This is still true at the final status: PRODUCTION REMAINS NOT REMEDIATED** |
| Owner of this file | Security closure programme. Update a row only with a commit, a test or an evidence file under `docs/security/evidence/closure/` |

> This is an internal tracking register, not a certification. CKAM is not ISO/IEC 27001 certified and has no SOC 2 report.

## In plain words

The October test found 43 problems. On the development PC most of them are fixed. **The live server is still
exposed** to the worst one (IF-01: anyone can read files on the server) until the fix is deployed and the
passwords are changed. That needs your explicit deploy request.

This register lists, for every problem, where it really stands **today**, based on the code as it is now, not on
the earlier reports. It found a few places where the earlier register is out of date (two items were already
fixed after it was written; a few are marked more "done" than the evidence shows). Status was **never raised**
without proof in the repository.

Simple example: AU-08 (weak passwords). The last part of that fix (`Password@2026` is now refused) is in the code
and has an automatic test, but the independent testers never re-ran their attack against it. So it is marked
"FIXED — NEEDS INDEPENDENT RETEST", not "FIXED — RETESTED".

## Classification key (exactly one per row)

| Classification | Meaning |
|---|---|
| FIXED — RETESTED | Code fixed and re-attacked by the retest agents (or, for a comment, checked by reading the source) |
| FIXED — NEEDS INDEPENDENT RETEST | Code fixed and covered by permanent tests, but no second, independent re-attack yet |
| MITIGATED — CODE CAN CLOSE RESIDUAL | Risk reduced; what is left can be closed by a code change |
| MITIGATED — EXTERNAL RESIDUAL | Risk reduced; what is left needs server, database-administration or process work |
| OPEN — CODE FIXABLE | Not fixed; developers can close it on the dev PC |
| OPEN — EXTERNAL | Not fixed (in production); needs server, network, supplier or management action |
| ACCEPTED — VALID DECISION | Kept as is with a written reason that still holds today |
| DECISION REQUIRED | The owner / management must choose before anything is built |
| OBSERVATION — HARDEN NOW | Not a finding, but cheap and worth fixing in this programme |
| OBSERVATION — ACCEPT / DEFER | Not a finding; leave or put in the backlog |

"Can code close it?" means: can a change in this repository, on the dev PC, close the item without any production,
server or management step. **No item is closed in production until it is deployed (EXT-01).**

---

## 0. FINAL STATUS — closure complete (added 2026-10-16, HEAD `fd34520`)

> Dated note, 2026-10-16 (closure writer WP-M2a): sections 1–7 below are the **baseline** written in the morning
> at `627ed73`; they are kept unchanged as history. This section gives the **final** classification of every
> row, using the same vocabulary, plus a closure outcome. Sources: the fact sheet of the programme lead, the
> commits `7b039fb` … `fd34520`, and the evidence under `evidence/closure/`. Every path below is relative to
> `docs/security/` unless it starts with `backend/`, `frontend/`, `ops/` or is a commit.

### 0.1 In plain words

All the problems that could be fixed in the code are now fixed on the development PC, and every one of them was
attacked again by testers who did not write the fixes (the last six in a third retest, 52/52 checks passed). **Nothing is pushed or deployed. PRODUCTION REMAINS NOT
REMEDIATED:** the live server (`3b5e842`) still has IF-01 (anyone can read files on the server) and the QR-label
link bug (CL2-IF-04). What is left needs a server, a database administrator, a supplier or a management decision.

Verdict (code / local): **`CKAM LOCAL SECURITY REMEDIATION COMPLETE WITH EXTERNAL ACTIONS`**. No Critical, High
or Medium item that code can close is still open.

### 0.2 Counting rule

1. **Universe = 51 findings**: the 43 of the first register, plus 8 found during the closure retests:
   CL1-N4-01, CL2-IF-01, CL2-IF-02, CL2-IF-03, CL2-IF-04, CL2-SE-N01, CL2-SE-N02, CL2-SE-N03. Observations
   (section 0.5) are **not** counted.
2. **Severity** as given by the tester who found it. Two split ratings are counted once, at a stated value:
   CL1-N4-01 "Low–Medium" is counted at the **higher** value (MEDIUM, conservative). CL2-IF-04 "functional
   MEDIUM, security INFO" is counted at its **security** severity (INFO), because this is a security register;
   its functional weight is stated in its row.
3. **One classification per finding** (the key above). FIXED — RETESTED needs an independent re-attack in
   closure retest 1, 2 or 3 (or the original retest, where nothing changed since). *Update 2026-10-16:* the six
   WP-F / WP-F2 fixes (CL2-IF-01…04, CL2-SE-N01, CL2-SE-N03), first classified FIXED — NEEDS INDEPENDENT RETEST,
   were re-attacked in the **third independent retest** (`evidence/closure/retest3/RETEST3.md`: ≈ 360 cases,
   52/52 logged assertions PASS, 0 new findings) and are now FIXED — RETESTED. Note: all retest testers are AI
   agents of the build programme, independent of the fix authors but not an external firm (SD-10 / EXT-14).
4. **Production does not change a classification** except where something beyond the normal deploy is still
   needed: every fixed item still needs the deploy (EXT-01); IF-01 needs secret rotation and a compromise check
   too, so it stays OPEN — EXTERNAL although its code is fixed and retested.

### 0.3 Final counts (51 findings)

Severity × classification (the register's vocabulary):

| Severity | FIXED — RETESTED | FIXED — NEEDS IND. RETEST | MITIGATED — CODE CAN CLOSE | MITIGATED — EXTERNAL | OPEN — CODE FIXABLE | OPEN — EXTERNAL | ACCEPTED | DECISION REQUIRED | Total |
|---|---|---|---|---|---|---|---|---|---|
| CRITICAL | | | | | | 1 | | | 1 |
| HIGH | | | | | | 1 | | | 1 |
| MEDIUM | 10 | 0 | | 2 | | 3 | | 1 | 16 |
| LOW | 18 | 0 | | 2 | | 3 | 2 | | 25 |
| INFO | 4 | 0 | | | | 1 | 1 | 2 | 8 |
| **Total** | **32** | **0** | **0** | **4** | **0** | **9** | **3** | **3** | **51** |

(Before retest 3 the FIXED columns were 26 RETESTED / 6 NEEDS IND. RETEST; totals unchanged.)

Closure outcome (the owner's columns; Fixed = both FIXED columns; External = OPEN — EXTERNAL + DECISION REQUIRED):

| Severity | Found | Fixed | Mitigated | Accepted | Remaining code | External (of which decision) |
|---|---|---|---|---|---|---|
| CRITICAL | 1 | 0 | 0 | 0 | 0 | 1 (0) |
| HIGH | 1 | 0 | 0 | 0 | 0 | 1 (0) |
| MEDIUM | 16 | 10 | 2 | 0 | 0 | 4 (1) |
| LOW | 25 | 18 | 2 | 2 | 0 | 3 (0) |
| INFO | 8 | 4 | 0 | 1 | 0 | 3 (2) |
| **Total** | **51** | **32** | **4** | **3** | **0** | **12 (3)** |

IDs per cell:

- CRITICAL / OPEN — EXTERNAL: IF-01 (code FIXED — RETESTED on Linux and natively on Windows; production exposed).
- HIGH / OPEN — EXTERNAL: IF-02.
- MEDIUM: FIXED — RETESTED IF-03, IF-04, IF-10, AU-01, AU-03, AU-05, AC-1, N1, CL1-N4-01, CL2-IF-01 ·
  MITIGATED — EXTERNAL IF-05, IF-06 · OPEN — EXTERNAL IF-07, IF-08, IF-09 · DECISION REQUIRED AU-04.
- LOW: FIXED — RETESTED IF-13, IF-14, AU-06, AU-07, AU-08, AU-12, AU-14, AU-15, AU-16, AC-2, IN-02, N3, N4,
  PO-LOGIN, RACE-1, CL2-IF-02, CL2-SE-N01, CL2-SE-N03 · MITIGATED — EXTERNAL IF-11, IF-15 · OPEN — EXTERNAL
  IF-16, AU-13, N2 · ACCEPTED IF-12, AU-02.
- INFO: FIXED — RETESTED IN-03, FONTS, CL2-IF-03, CL2-IF-04 · OPEN — EXTERNAL IF-17 · ACCEPTED CL2-SE-N02 ·
  DECISION REQUIRED D6, MFA.

Movement since the baseline (section 1): OPEN — CODE FIXABLE 4 → **0** (IF-13, N3, FONTS fixed and retested;
IF-15 code side done, residual external); MITIGATED — CODE CAN CLOSE 1 → **0** (AU-06 fixed and retested);
FIXED — NEEDS IND. RETEST 5 → all 5 retested (N1, AU-08, AU-15, N4, RACE-1); 8 new findings, 7 fixed (all
re-attacked: CL1-N4-01 in retest 2, the other six in retest 3) and 1 accepted. **All 32 fixed findings were
re-attacked by an independent tester.** **Open CODE-FIXABLE findings: 0. Open EXTERNAL: 9 (+ 4 MITIGATED with an external residual). Decision
required: 3 findings** (and 16 owner decisions SD-01…SD-16 in `CKAM_SECURITY_DECISIONS_REQUIRED.md`).

### 0.4 Final register (every finding; closure outcome)

Columns: **ID | Sev. | Baseline (section 2) | FINAL classification | Closure outcome | Commit(s) | Retest / evidence | Production.**

| ID | Sev. | Baseline | FINAL | Closure outcome | Commit(s) | Retest / evidence | Production |
|---|---|---|---|---|---|---|---|
| IF-01 | CRITICAL | OPEN — EXTERNAL | **OPEN — EXTERNAL** (code FIXED — RETESTED) | EXTERNAL: deploy (EXT-01), then rotate JWT, `ckassetapp`, NAS and ERP secrets (EXT-02), compromise assessment (EXT-03) | `3e134c1`, `7b039fb` (IF-01-WIN), `ca94574` (guard kept first) | Linux: closure retest 1 `CL1-T082`…`T104` (`evidence/closure/retest1/RETEST1.md`); retest 2 production-mode container, 23 payloads, 0 leaks (`evidence/closure/retest2/access/raw/prod_file_probe.json`). **Native Windows (dev PC)**: old `4ba4e94` leaked 10 of 28 (`evidence/closure/windows/native_windows_old_release_4ba4e94.txt`), fixed `7b039fb` and final `fafa225` 0 of 28, 0 5xx (`…_fixed_release_7b039fb.txt`, `…_final_release_fafa225.txt`) | **Still exposed** (`3b5e842`, since 2026-09-30) |
| IF-02 | HIGH | OPEN — EXTERNAL | **OPEN — EXTERNAL** | EXTERNAL: HTTPS (EXT-04), internet forward (EXT-05); decisions SD-04, SD-05 | — | Plan `CKAM_HTTPS_IMPLEMENTATION_PLAN.md` | Plain HTTP |
| IF-03 | MEDIUM | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `7e57844` | Retest 2 access, IDOR ERP draft 404 both ways, grant 200 (`evidence/closure/retest2/access/raw/idor.json`) | After deploy |
| IF-04 | MEDIUM | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `7e57844`, `d04779a`, `7b039fb` | Retest 2 infra item 5: 72 weak combinations refused, 49 start (`evidence/closure/retest2/infra/RETEST2_INFRA.md`, T054–T066) | After deploy; EXT-39 precheck |
| IF-05 | MEDIUM | MITIGATED — EXTERNAL | **MITIGATED — EXTERNAL** (code/scripts side closed) | MITIGATED — residual EXTERNAL: production role split by a DBA (EXT-07, SD-11) | `ae706bb`, `734fd19`, `ca94574` | Local role split: 7/7 CAN, 40/40 CANNOT (`evidence/closure/db/WPB_RESULTS.md`, `rs_05_can_cannot_matrix.out.txt`); retest 2 infra 6b, ~70 break-out attempts refused | App role still owner |
| IF-06 | MEDIUM | MITIGATED — EXTERNAL | **MITIGATED — EXTERNAL** | As IF-05 (purge function refused for the runtime role) | `ae706bb`, `734fd19` | As IF-05 | As IF-05 |
| IF-07 | MEDIUM | OPEN — EXTERNAL | OPEN — EXTERNAL | EXTERNAL: EXT-06 | — | Plan `CKAM_SERVICE_ACCOUNT_PLAN.md` | Runs as SYSTEM |
| IF-08 | MEDIUM | OPEN — EXTERNAL | OPEN — EXTERNAL | EXTERNAL: EXT-08 | — | Plan `CKAM_BACKUP_RESTORE_PLAN.md` | Unchanged |
| IF-09 | MEDIUM | OPEN — EXTERNAL | OPEN — EXTERNAL | EXTERNAL: EXT-10 (dev-PC administrator); **nothing changed on the PC** | — | Plan `evidence/closure/infra/IF-09_ACL_PLAN.md` | n/a (dev PC) |
| IF-10 | MEDIUM | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED (TLS is IF-16) | `ae706bb` | RT-AU-T970…T979 (`evidence/retest/aii_raw/erp_connect_out.txt`); code unchanged since except the TLS argument (`backend/tests/erp/test_erp_tls_settings.py`) | After deploy |
| AU-01 | MEDIUM | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `ae706bb` | Retest 2 sessions A7: medians within 3.8 ms, refused categories within 0.6 ms (`evidence/closure/retest2/sessions/RETEST2_SESSIONS.md`) | After deploy |
| AU-03 | MEDIUM | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `ae706bb`, `79dbae7` | Retest 2 sessions A3 (per id, per IP through nginx and direct, forged XFF, two sources) | After deploy; EXT-40 watch |
| AU-04 | MEDIUM | DECISION REQUIRED | **DECISION REQUIRED** | DECISION: SD-06 (options A/B/C, recommendation C hybrid); no code change | — | `evidence/closure/backend/AU-04_OPTIONS.md`; retest 2 A4 shows a stranger cannot extend the lock | Unchanged |
| AU-05 | MEDIUM | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `ae706bb`, `4fa5c9b`, `69c3a51` | Retest 2 sessions A2: 8 triggers, old access and refresh tokens 401 | After deploy |
| AC-1 | MEDIUM | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `77431ba` | Retest 2 access: 217 routes × 14 identities = 3,038 cells, 0 escalations (`evidence/closure/retest2/access/authz_matrix.csv`) | After deploy |
| N1 | MEDIUM | FIXED — NEEDS IND. RETEST | **FIXED — RETESTED** | FIXED — RETESTED | `d04779a` | Closure retest 1 `CL1-T001`…`T018` (RSS flat at 143,664 kB through 256 MB floods); retest 2 sessions A6 | After deploy |
| CL1-N4-01 *(new)* | MEDIUM (rated Low–Medium) | — | **FIXED — RETESTED** | FIXED — RETESTED: unset `ENVIRONMENT_NAME` now counts as production (`backend/app/core/config.py` default `production`) | `7b039fb` | Found by `CL1-T019` (retest 1); closed per retest 2 infra item 5 | After deploy; production must keep `ENVIRONMENT_NAME=production` |
| CL2-IF-01 *(new)* | MEDIUM | — | **FIXED — RETESTED** (scripts; was NEEDS IND. RETEST until retest 3) | FIXED in `ops/db/role_split.sql` (sequences USAGE, SELECT only) + checks 19/20; audit-write failures counted and repeated once a minute. Production: the DBA must run the **updated** scripts (EXT-07) | `ca94574` | Before/after: `evidence/closure/wpf/wpf_01_if01_if02_repro_BEFORE_head734fd19.out.txt` (setval succeeded, checks silent) vs `wpf_02_if01_if02_AFTER_wpf.out.txt` (refused); `backend/tests/security/test_least_privilege_role_split.py`, `backend/tests/observability/test_log_write_failure_reporting.py`; retester's own candidate-fix proof T100. **Retest 3:** every `setval` / `ALTER SEQUENCE` on all 32 sequences denied for the runtime role, `nextval` OK, verify 49/49; audit failure re-reported with a running count, `system_event` row, resumes after repair (`evidence/closure/retest3/RETEST3.md`, `raw/r3_06_runtime_matrix.txt`, `raw/if01b_03_reports.txt`) | No role split yet (worse: the app owns everything) |
| IF-11 | LOW | MITIGATED — EXTERNAL | MITIGATED — EXTERNAL | MITIGATED — residual EXTERNAL: install with `-c constraints.txt` in production (EXT-12) | `ae706bb`, `79dbae7` | Dockerfile and `ops/windows/deploy_ckam.ps1.template` use `-c constraints.txt` (`evidence/closure/infra/WP-C_closure_evidence.md` §2, §5) | Unpinned until EXT-12 |
| IF-12 | LOW | ACCEPTED | **ACCEPTED — VALID DECISION (re-confirmed 2026-10-16)** | ACCEPTED: no fixed versions of `python-jose` / `ecdsa` exist; not reachable (HS256 pinned on decode; only `jose.jwt` used; 6 forged tokens refused; `ecdsa` never imported). Follow-up: replace python-jose with PyJWT | `7b039fb` (pin test) | `evidence/closure/backend/dependency_recheck.md`; `backend/tests/auth/test_jwt_algorithm_pinned.py`; retest 2 infra T109–T113 | Same |
| IF-13 | LOW | OPEN — CODE FIXABLE | **FIXED — RETESTED** | FIXED — RETESTED (uid 10001, capabilities 0, `no-new-privileges`, runtime target without test tooling, `volume-init`; `/tmp` and `/var/tmp` tmpfs `noexec`) | `79dbae7`, `ca94574` | Retest 2 infra item 1, T001–T018 (2 PARTIAL on `/var/tmp`, closed by the tmpfs change in `ca94574`, effective at the owner's next rebuild) | n/a (no Docker in production) |
| IF-14 | LOW | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED; `/docs`, `/redoc`, `/openapi.json` now a JSON 404 where docs are off | `ae706bb`, `d04779a`, `b401e9f` | Retest 2 access production-mode container: all JSON 404 (`raw/prod_file_probe.json`); retest 2 infra item 5 | After deploy |
| IF-15 | LOW | OPEN — CODE FIXABLE (partly) | **MITIGATED — EXTERNAL** | Code/reference side FIXED (`ops/windows/` secret-free launcher, deploy, verify, rollback; runbook Windows section); residual EXTERNAL: IT confirms the live launcher equals the repo copy (EXT-13) | `79dbae7`, `ca94574` | PowerShell parser 0 errors; `-WhatIf` dry runs (`evidence/closure/infra/raw/windows/dryrun.out.txt`); PSScriptAnalyzer not run (not installed) | Live launcher not in git |
| IF-16 | LOW | OPEN — EXTERNAL | **OPEN — EXTERNAL** (code side done) | EXTERNAL: ERP owner must confirm TLS, SELECT-only, role-level read-only (EXT-25). Code: `PO_SOURCE_SSLMODE` / `PO_SOURCE_SSLROOTCERT`, default `prefer` = today's behaviour; TLS **not** mandatory | `7b039fb` | `backend/tests/erp/test_erp_tls_settings.py` (a TLS mode refuses a plain-text stand-in before the password is sent) | Unchanged |
| AU-02 | LOW | ACCEPTED | **ACCEPTED — VALID DECISION (re-confirmed 2026-10-16)** | ACCEPTED: 423 for any password on a locked account; answering "locked" only to the right password would be a guessing oracle. Re-open only if SD-06 changes the lock model | `ae706bb` | Retest 2 sessions A4 (423 on the correct password; lock not extendable by a stranger) | Same |
| AU-06 | LOW | MITIGATED — CODE CAN CLOSE | **FIXED — RETESTED** | FIXED — RETESTED: server-side `auth_session` (SHA-256 of `jti` only), rotate once, 10 s grace, reuse ⇒ 401 + every session of that person ended + `REFRESH_REUSE` audit row | `69c3a51` (migration `b5d7f9a1c3e5`) | Retest 2 sessions A1, 15/15; burst (h) 20 parallel refreshes → exactly one rotation (`evidence/closure/retest2/sessions/concurrency_results.md`) | After deploy (legacy tokens upgraded once) |
| AU-07 | LOW | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `ae706bb` | Retest 2 sessions A2 (sign-in off, role, work area, deactivation); retest 2 access throw-away replays 401 | After deploy |
| AU-08 | LOW | FIXED — NEEDS IND. RETEST | **FIXED — RETESTED** | FIXED — RETESTED (plus look-alike name and run-plus-number refusals) | `ae706bb`, `d04779a`, `7b039fb` | Closure retest 1 `CL1-T047`…`T067` (19 refused, 2 accepted); retest 2 sessions A5 (13 refused, passphrase accepted) | After deploy |
| AU-12 | LOW | FIXED — RETESTED (no permanent test) | FIXED — RETESTED | FIXED — RETESTED, now with permanent checks | `4fa5c9b`, `79dbae7` | `frontend/src/security/nginx-config.test.ts`, `npm run check:build`, `npm run check:nginx-live`; retest 2 infra T032–T038 | n/a (no nginx in production; no maps built) |
| AU-13 | LOW | OPEN — EXTERNAL | OPEN — EXTERNAL | EXTERNAL: `COOKIE_SECURE=true` with HTTPS (EXT-04) | — | — | Cookie not `Secure` |
| AU-14 | LOW | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED; CSP now without any Google host (nginx and backend) | `4fa5c9b`, `ae706bb`, `79dbae7`, `b401e9f` | Retest 2 infra items 2–3: exact CSP, 0 violations, 0 page errors, 41 steps × 3 personas | After deploy |
| AU-15 | LOW | FIXED — NEEDS IND. RETEST | **FIXED — RETESTED** | FIXED — RETESTED; repository launch paths also drop the `server: uvicorn` banner (`--no-server-header`) | `4fa5c9b`, `d04779a`, `ca94574` | Closure retest 1 (N1); retest 2 infra headers (no version) | Live launcher needs `--no-server-header` (EXT-13) |
| AU-16 | LOW | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `ae706bb` | Retest 2 sessions A4: parallel guesses → exactly 5 counted | After deploy |
| AC-2 | LOW | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `77431ba` | Retest 2 access IDOR (custom fields [1] / [2], widening refused) | After deploy |
| IN-02 | LOW | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED | `ba04371` | Retest 2 access upload: 16 MB import → 413 (`raw/upload.json`) | After deploy |
| N2 | LOW | OPEN — EXTERNAL (Docker part fixed) | **OPEN — EXTERNAL** (repository side done) | EXTERNAL: production launcher `--no-proxy-headers` (EXT-38, EXT-13). Repository: Dockerfile CMDs, reference launcher, permanent tests | `a3e8fce`, `7b039fb`, `79dbae7`, `ca94574` | `backend/tests/core/test_n2_forwarded_for.py`; retest 2 infra item 4 (forged headers ignored; 429 on the 21st) | Live launcher unchanged |
| N3 | LOW | OPEN — CODE FIXABLE | **FIXED — RETESTED** | FIXED — RETESTED (nginx overwrites `X-Forwarded-For`; API trusts only nginx's fixed address) | `79dbae7` | Retest 2 infra item 4; retest 2 sessions A3 (two sources, two buckets) | n/a (Docker only) |
| N4 | LOW | FIXED — NEEDS IND. RETEST | **FIXED — RETESTED** | FIXED — RETESTED (with CL1-N4-01) | `d04779a`, `7b039fb` | Closure retest 1 `CL1-T020`…`T044`; retest 2 infra item 5 | After deploy |
| PO-LOGIN | LOW | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED (code unchanged since the first retest) | `77431ba` | RT-AU-T311/T312 (`evidence/retest/`) | After deploy |
| RACE-1 | LOW | FIXED — NEEDS IND. RETEST | **FIXED — RETESTED** | FIXED — RETESTED; residual (Excel import) closed too | `da790d1`, `7b039fb` | Closure retest 1 `CL1-T069`…`T077` (one 201, rest 422, 0 5xx); retest 2 burst (f): vendor/brand/item one active each | After deploy |
| CL2-IF-02 *(new)* | LOW | — | **FIXED — RETESTED** (detection + reset) | FIXED in scripts: `RESET ALL` for the runtime role, checks 21 / verify 12 FAIL on any stored setting. Cannot be prevented inside PostgreSQL; detection is the control. Production: EXT-07 | `ca94574` | `wpf_01` (accepted, not detected) vs `wpf_02` (both scripts FAIL); role-split pytest case 4b. **Retest 3:** 4 stored defaults all reported by check 21, a stored `role=<owner>` rejected at login (no escalation), superuser reset clears them (`evidence/closure/retest3/raw/r3_06_runtime_matrix.txt`, `r3_07_reset.txt`) | With EXT-07 |
| CL2-SE-N01 *(new)* | LOW | — | **FIXED — RETESTED** | FIXED: one active Category name per work area, one Sub-category name per Category (screen, rename, move, Excel import), advisory lock | `fafa225` | `backend/tests/masters/test_wpf2_category_names.py` (20 parallel → exactly 1); `evidence/closure/wpf/WPF2_RESULTS.md`. **Retest 3:** 20 parallel creates (two personas) 201 × 1 / 422 × 19, sub-categories likewise, other work area allowed, out-of-area 403, import duplicates refused (`evidence/closure/retest3/raw/cl3_masters_race.txt`, `cl3_import_commit.txt`) | After deploy |
| CL2-SE-N03 *(new)* | LOW | — | **FIXED — RETESTED** | FIXED: the serial index answers 422 with a plain sentence (`CONSTRAINT_REFUSALS`) | `fafa225` | `backend/tests/core/test_wpf2_serial_race_message.py`: 3 bursts × 20 → 1 success, 19 × 422, no 409, no 500. **Retest 3:** 20 parallel adds 201 × 1 / 422 × 19, no 409/5xx, case/space variants one asset (`evidence/closure/retest3/raw/cl3_serial_race.txt`, `cl3_serial_verify_sql.txt`) | After deploy |
| IN-03 | INFO | FIXED — RETESTED | FIXED — RETESTED | FIXED — RETESTED (polyglot residual = observation) | `ae706bb` | Closure retest 1 FILES; retest 2 access upload | After deploy |
| IF-17 | INFO | OPEN — EXTERNAL | OPEN — EXTERNAL | EXTERNAL: EXT-28 | — | — | n/a |
| D6 | INFO | DECISION REQUIRED | DECISION REQUIRED | DECISION: SD-02 (recommendation B, limit Full Admin to chosen companies) | — | Retest 2 access confirms the designed behaviour and the work-area limit | Unchanged |
| MFA | INFO | DECISION REQUIRED | DECISION REQUIRED | DECISION: SD-03 | — | — | None |
| FONTS | INFO | OPEN — CODE FIXABLE | **FIXED — RETESTED** | FIXED — RETESTED (self-hosted Inter + IBM Plex Mono, latin + latin-ext) | `79dbae7`, `b401e9f` | Retest 2 infra item 2: 0 foreign requests, 144 same-origin font responses, ₹ glyph in both fonts | After deploy |
| CL2-IF-03 *(new)* | INFO | — | **FIXED — RETESTED** | FIXED: `X-Request-ID` on nginx's own answers; the application's id passes through under `/api/` | `ca94574` | Fixer's live check 11/11 (`evidence/closure/wpf/wpf_03_xrequestid_live.out.txt`); `nginx-config.test.ts`. **Retest 3:** exactly one id on static, SPA, 404, map-404, 413 and API answers; unsafe client ids replaced (`evidence/closure/retest3/raw/if03_reqid_result.txt`) | n/a (Docker only) |
| CL2-IF-04 *(new)* | INFO (security); functional MEDIUM | — | **FIXED — RETESTED** (retest 3: `/assets/<id>`, `/assets/new`, multi-segment → shell with `no-cache`; route-looking canary files in `<dist>/assets` never served; ≈ 45 traversal payloads identical 404, 0 leaks, 0 5xx — `evidence/closure/retest3/raw/if04_result.txt`) | FIXED: in single-port mode `/assets/<id>` (Asset 360, the QR-label address) and `/assets/new` serve the app page; the IF-01 lexical guard still runs first | `ca94574` | `backend/tests/test_static_frontend_spa_assets.py` (11 functions, 31 cases, incl. every route of `frontend/src/router.tsx`). **Note:** commit `fd34520` says "QR deep link 200", but `native_windows_final_release_fafa225.txt` records only `/some/spa/route` → 200, not an `/assets/<id>` probe | **Bug also live in `3b5e842`**: scanned labels likely show a JSON error until deployed |
| CL2-SE-N02 *(new)* | INFO | — | **ACCEPTED — VALID DECISION** | ACCEPTED: a malformed `Content-Length` is refused with 400 by uvicorn's parser before the app; body never read; no action | — | Retest 2 sessions A6 | Same |

### 0.5 Observations (not counted) — final status

| ID | Baseline | FINAL | Commit / evidence |
|---|---|---|---|
| IF-01-WIN | HARDEN NOW | **FIXED — RETESTED** (lexical refusal before any filesystem call; then resolve + containment + symlink refusal) | `7b039fb` (`backend/app/core/static_safety.py`); native Windows run 0/28 leaks; limits: junctions, real 8.3 aliases and SMB lookups not exercised natively; run on the dev PC, not on the production server |
| N5 | HARDEN NOW | FIXED — RETESTED | `79dbae7`; retest 2 infra item 3 (each header once on 20 response kinds) |
| N6 | HARDEN NOW | FIXED — RETESTED | `7b039fb`; retest 2 access + infra (unknown `/api` → JSON 404) |
| N7 | ACCEPT / DEFER | ACCEPT / DEFER | Follows SD-07 (shared store logins) |
| N8 | ACCEPT / DEFER | ACCEPTED | — |
| N9 | ACCEPT / DEFER | DEFER | Not done in WP-B (optional) |
| OBS-TV | HARDEN NOW | FIXED — RETESTED | `69c3a51`; retest 2 burst (g) `token_version` consistent |
| OBS-STATUS | HARDEN NOW | FIXED — RETESTED (honest limit: the app role can set the marker itself; the barrier is the role split) | `734fd19` (migration `c6e8a0b2d4f6`); retest 2 access DB guard + infra 6a |
| OBS-COMMENT | FIXED — RETESTED | unchanged | `a3e8fce` |
| OBS-IDS | ACCEPT / DEFER | ACCEPTED | Closure evidence uses unique `CL1-` / `CL2-` ids |
| OBS-DOCS | HARDEN NOW | Assigned to the parallel documentation package (ISO / SOC 2 / threat model / evidence index); **not verified by this writer** | — |
| OBS-REG-STALE | HARDEN NOW | FIXED (documents): dated addenda in the findings register, remediation report (Part 2) and VAPT report, 2026-10-16 | This update |
| OBS-EXT07-STALE | HARDEN NOW | Remediation report §7 now marked SUPERSEDED by `ops/db/role_split.sql`; the EXT-07 text itself belongs to `CKAM_EXTERNAL_SECURITY_ACTIONS.md` (another writer) | This update |
| OBS-AU12-TEST | HARDEN NOW | FIXED — RETESTED | `79dbae7` (12 static nginx/vite checks, `check:build`, `check:nginx-live`) |
| OBS-GUARD-MSG (= CL1-OBS-N4-02) | HARDEN NOW | FIXED — RETESTED | `7b039fb`; retest 2 infra item 5 (message names all three rules, never the secret) |
| OBS-DOCKER-SU | HARDEN NOW | ACCEPT / DEFER — tools ready, owner decision. The dev/UAT app role is still a superuser; least privilege is proven on a disposable database and by a permanent pytest | `734fd19`; `evidence/closure/db/rs_08_dev_stack_check.out.txt` |
| OBS-NAME-IMPORT | ACCEPT / DEFER | FIXED — RETESTED for the category import (retest 3, `raw/cl3_import_commit.txt`); the brand/vendor import uses the same `_import_name_checks` and is covered by permanent tests only (brand/vendor import refuses duplicate names; categories since `fafa225`). SD-12 is therefore already implemented as option A | `7b039fb`, `fafa225`; `backend/tests/masters/test_import_duplicate_names.py` |
| OBS-CSP-STYLE | ACCEPT / DEFER | DEFER | — |
| OBS-T410 | ACCEPT / DEFER | FIXED (nginx's 413 now carries an `X-Request-ID`, CL2-IF-03) | `ca94574` |
| OBS-NPM-DEV | ACCEPT / DEFER | ACCEPT / DEFER (re-confirmed: production dependencies 0; one dev-only HIGH in `source-map-js` 1.2.1) | `evidence/closure/infra/npm_audit_recheck.md`; retest 2 T109 |
| OBS-POLYGLOT (= CL1-OBS-FILES-01 = CL2-AC-OBS-01) | ACCEPT / DEFER | ACCEPTED (served only as attachment + `nosniff`; revisit if a screen ever renders a document inline) | Retest 1 `CL1-T116`…`T118`; retest 2 access upload |
| CL1-OBS-SECRET-01 *(new)* | — | ACCEPT / DEFER: the untracked demo walkthrough holds a demo-only password; it is deliberately **not committed** | `docs/ai/CKAM_DEMO_WALKTHROUGH.md` (untracked) |
| CL2-IF-OBS-01 *(new)* writable `/var/tmp` | — | FIXED in the repository (tmpfs `noexec`); effective at the owner's next `docker compose up -d --build api` | `ca94574` |
| CL2-IF-OBS-02 *(new)* runtime-image run flags | — | OPEN — DEFER (documentation only; production has no Docker) | — |
| CL2-IF-OBS-03 *(new)* silent audit-write failure | — | FIXED (counted, repeated once a minute, `system_event`); the Logs → Diagnostics screen does **not yet show** the count (function `failure_counts()` exists) | `ca94574` |
| CL2-IF-OBS-04 *(new)* stale Google Fonts comment | — | FIXED | `ca94574` |
| CL2-IF-OBS-05 *(new)* `server: uvicorn` | — | FIXED in the repository (`--no-server-header`); live launcher needs it (EXT-13) | `ca94574` |
| CL2-IF-OBS-06 *(new)* shared UAT persona password | — | ACCEPTED (UAT only; "NEVER RUN AGAINST PRODUCTION" warning added) | `ca94574` |
| OBS-HEAD405 *(new)* | — | DEFER (functional, pre-existing): in single-port mode every SPA page answers `HEAD` with 405; phones open labels with GET | `evidence/closure/wpf/WPF_RESULTS.md` |
| OBS-ROLE-INHERIT *(new, retest 3)* | — | DBA NOTE (not a finding): if a migrator role **already exists** with `INHERIT` membership when `ops/db/role_split.sql` runs, the idempotent `IF NOT pg_has_role(…)` guard skips the re-grant and does not repair the inherit flag (the migrator could then create objects as itself). The documented runbook path creates the migrator fresh (`NOINHERIT`), so it is unaffected. The DBA should drop/recreate a pre-existing migrator or issue `GRANT <owner> TO <migrator> WITH INHERIT FALSE`, then re-run `role_split_verify.sql`. To be added as a note to `ops/db/ROLE_SPLIT_RUNBOOK.md` in a later code change (`ops/` not edited by this documentation step) | `evidence/closure/retest3/RETEST3.md` methodology note 1 |
| OBS-STATUS-R3 *(new, retest 3)* | — | COVERAGE NOTE: the direct `UPDATE asset SET status …` as the runtime role was inconclusive in retest 3 (fresh database with no asset rows, 0 rows matched). The guard was verified present and enabled by `role_split_verify.sql`; its behaviour is covered by `backend/tests/lifecycle/test_obs_status_guard.py`, WP-B `rs_05` (CANNOT-39/40) and retest 2 | `evidence/closure/retest3/RETEST3.md` note 3 |
| CL2-IF-03 client id *(new, retest 3)* | — | ACCEPTED (intended): the API honours a well-formed client `X-Request-ID` (1–64 of `A-Za-z0-9._-`) for correlation; unsafe values are replaced; nginx-served answers always use nginx's id | `evidence/closure/retest3/RETEST3.md` note 2 |
| OBS-LEGACY-REFRESH *(new)* | — | DEFER to the release after the deploy: the AU-06 legacy-token path (tokens without `sid`) accepts a forged legacy token once if the JWT key is known; remove it once all pre-deploy tokens have expired (8 h). EXT-02 is the real control | `evidence/closure/backend/WPA2_RESULTS.md` (residual 7) |

### 0.6 Re-confirmed decisions (ACCEPTED), 2026-10-16

| ID | Rationale re-checked today | Still valid? |
|---|---|---|
| IF-12 | `backend/app/core/security.py::decode_token` pins `algorithms=["HS256"]`; pip-audit again reports no fixed version for `python-jose` 3.5.0 / `ecdsa` 0.19.2; forged-token probes refused (retest 2 T109–T113) | Yes; recommend PyJWT at the next auth rework |
| AU-02 | Lock answer is the same for any password (retest 2 A4); alternative is a password oracle | Yes, unless SD-06 changes the lock model |
| CL2-SE-N02 | Request is refused (400) before the app reads the body; the middleware branch is only belt-and-braces | Yes |

---

## 1. Summary counts (the 43 findings) — BASELINE before the closure fixes (kept for history; final: section 0)

| Severity | FIXED — RETESTED | FIXED — NEEDS IND. RETEST | MITIGATED — CODE CAN CLOSE | MITIGATED — EXTERNAL | OPEN — CODE FIXABLE | OPEN — EXTERNAL | ACCEPTED | DECISION REQUIRED | Total |
|---|---|---|---|---|---|---|---|---|---|
| CRITICAL | | | | | | 1 | | | 1 |
| HIGH | | | | | | 1 | | | 1 |
| MEDIUM | 7 | 1 | | 2 | | 3 | | 1 | 14 |
| LOW | 8 | 4 | 1 | 1 | 3 | 3 | 2 | | 22 |
| INFO | 1 | | | | 1 | 1 | | 2 | 5 |
| **Total** | **16** | **5** | **1** | **3** | **4** | **9** | **2** | **3** | **43** |

IDs per cell:

- CRITICAL / OPEN — EXTERNAL: IF-01 (code fixed and retested on Linux; production still exposed).
- HIGH / OPEN — EXTERNAL: IF-02.
- MEDIUM: FIXED — RETESTED IF-03, IF-04, IF-10, AU-01, AU-03, AU-05, AC-1 · FIXED — NEEDS IND. RETEST N1 · MITIGATED — EXTERNAL IF-05, IF-06 · OPEN — EXTERNAL IF-07, IF-08, IF-09 · DECISION REQUIRED AU-04.
- LOW: FIXED — RETESTED IF-14, AU-07, AU-12, AU-14, AU-16, AC-2, IN-02, PO-LOGIN · FIXED — NEEDS IND. RETEST AU-08, AU-15, N4, RACE-1 · MITIGATED — CODE CAN CLOSE AU-06 · MITIGATED — EXTERNAL IF-11 · OPEN — CODE FIXABLE IF-13, IF-15, N3 · OPEN — EXTERNAL IF-16, AU-13, N2 · ACCEPTED IF-12, AU-02.
- INFO: FIXED — RETESTED IN-03 · OPEN — CODE FIXABLE FONTS · OPEN — EXTERNAL IF-17 · DECISION REQUIRED D6, MFA.

Observations (not counted in the 43): 21 rows in section 3. OBSERVATION — HARDEN NOW 11 (IF-01-WIN, N5, N6,
OBS-TV, OBS-STATUS, OBS-AU12-TEST, OBS-GUARD-MSG, OBS-DOCKER-SU, OBS-DOCS, OBS-REG-STALE, OBS-EXT07-STALE) ·
OBSERVATION — ACCEPT / DEFER 9 (N7, N8, N9, OBS-IDS, OBS-NAME-IMPORT, OBS-CSP-STYLE, OBS-T410, OBS-NPM-DEV,
OBS-POLYGLOT) · FIXED — RETESTED (by reading the source) 1 (OBS-COMMENT).

### Changes against the 2026-10-15 register (do not smooth over)

| ID | Register 2026-10-15 | This register | Why |
|---|---|---|---|
| IF-01 | FIXED (code) — OPEN EXTERNAL, counted under FIXED in the VAPT totals | OPEN — EXTERNAL | The live server is still exposed; the code fix alone protects nobody. Windows behaviour also never executed (IF-01-WIN) |
| IF-11 | FIXED | MITIGATED — EXTERNAL RESIDUAL | `backend/constraints.txt` exists, but production still resolves versions at install until EXT-12 is followed |
| AU-04 | MITIGATED (residual accepted design) | DECISION REQUIRED | The "accepted design" was the lead's call; a lock-out policy that any stranger can trigger against a named person is an owner decision |
| AU-15 | FIXED | FIXED — NEEDS INDEPENDENT RETEST | The retest left it MITIGATED; it became FIXED only through N1 (`d04779a`), which was not re-attacked |
| N2 | OPEN EXTERNAL; remediation report §8 says the Dockerfile kept uvicorn's defaults | OPEN — EXTERNAL (Docker part fixed) | `a3e8fce` (after the register) added `--no-proxy-headers` to `backend/Dockerfile`. Production launcher unchanged (EXT-38). No permanent test, not retested |
| N3 | ACCEPTED | OPEN — CODE FIXABLE | Rationale only partly holds (see row); the fix is small and this programme targets it |
| IF-15 | OPEN (needs IT access) | OPEN — CODE FIXABLE (partly) | Secret-free reference scripts and the Windows runbook can be written in the repo; only the reconciliation with the live launcher needs IT |
| OBS-COMMENT | Open observation | FIXED — RETESTED (by reading) | Corrected in `a3e8fce`: `backend/app/auth/router.py` lines 147-148 now say 423 is answered for ANY password |

---

## 2. Register: the 43 findings (BASELINE)

> Dated note 2026-10-16 (closure): the "Current status" column below is the morning baseline at `627ed73`. The
> final status of every row, with the closure outcome, commit and retest evidence, is in **section 0.4**.

Columns: **ID | Severity | Current status | Current evidence | Can code close it? | Proposed action | Risk of change | Test needed | Final target.**
Evidence paths are relative to `docs/security/` unless they start with `backend/`, `frontend/` or a commit.

### CRITICAL and HIGH

| ID | Sev. | Current status | Current evidence | Can code close it? | Proposed action | Risk of change | Test needed | Final target |
|---|---|---|---|---|---|---|---|---|
| IF-01 | CRITICAL | **OPEN — EXTERNAL.** Code fixed (`3e134c1`) and retested 36 probes × 2 on Linux; live server `3b5e842` still serves any file | `backend/app/main.py::_serve_frontend_asset` lines 260-270 (`resolve()` + `is_relative_to`); `backend/tests/test_static_frontend.py::test_assets_route_cannot_read_files_outside_the_assets_folder`; `evidence/retest/aii_raw/if01_run1.txt`, `if01_run2.txt` | PARTLY (Windows hardening = IF-01-WIN, WP-A1). Production: NO | WP-A1 Windows hardening first; then EXT-39 → EXT-01 deploy → EXT-38 → EXT-02 rotate JWT/DB/NAS/ERP secrets → EXT-03 compromise check | Deploy itself: medium (two migrations, startup refusal on weak secret; see EXT-39) | After deploy: EXT-01 probes on production (owner-run), but the UNC probe only after IF-01-WIN is in (see that row) | CLOSED when deployed, secrets rotated, EXT-03 incident record written |
| IF-02 | HIGH | **OPEN — EXTERNAL.** Plain HTTP on `http://10.0.1.98:3211`, forwarded from the internet. HTTPS was deferred by the owner on 2026-10-08 (`docs/ai/PRODUCTION_INFRASTRUCTURE.md` line 24) | No code evidence possible; `COOKIE_SECURE` defaults to false (`docker-compose.yml`) | NO (certificate + proxy or uvicorn `--ssl-*` on the server) | EXT-04 HTTPS; EXT-05 decision on the internet forward (DECISION list) | Medium (port 3211 becomes HTTPS-only; LAN users must use the DNS name) | TLS scan, cookie `Secure`, redirect check (production, owner-run) | CLOSED when EXT-04 done |

### MEDIUM

| ID | Sev. | Current status | Current evidence | Can code close it? | Proposed action | Risk of change | Test needed | Final target |
|---|---|---|---|---|---|---|---|---|
| IF-03 | MEDIUM | **FIXED — RETESTED** | `backend/app/erp/service.py::build_draft`, `erp/router.py::po_draft`; `backend/tests/erp/test_erp_api.py::test_an_operator_cannot_open_the_draft_of_another_companys_po`; group `retest-AC1-AC2-IF03` (`RT-AC-T713`…`T729`), RT-AU-T601…T608 | YES (done) | None; deploy (EXT-01) | — | Keep in regression | CLOSED after deploy |
| IF-04 | MEDIUM | **FIXED — RETESTED** (original refusal, RT-AU-T901…T909). The `d04779a` hardening (name default, 8 distinct characters) is tracked under N4 | `backend/app/main.py::refuse_to_start_with_insecure_secret` lines 112-123; `backend/tests/core/test_production_secret_guard.py`; `evidence/retest/aii_raw/startup_matrix_out.txt` | YES (done) | Improve the refusal message (OBS-GUARD-MSG); EXT-39 pre-deploy check | Low | Revalidation in WP-A1 | CLOSED after deploy |
| IF-05 | MEDIUM | **MITIGATED — EXTERNAL RESIDUAL.** TRUNCATE refused for non-owner roles; owner/superuser can still `DISABLE TRIGGER` or use `session_replication_role=replica` (RT-AU-T9817/T9818 FAIL) | Migration `a3c5e7f9b1d4`; `backend/tests/observability/test_vapt_append_only.py`; `evidence/retest/aii_raw/rt_append_only.out.txt` | PARTLY: local role split and least-privilege tests (WP-B) prove the design; production needs EXT-07 by the owner | WP-B local `ckam_owner`/`ckam_migrator`/`ckam_app` split + tests; production role split EXT-07 (SQL in `CKAM_SECURITY_REMEDIATION_REPORT.md` §7, DESIGN ONLY) | Medium (dev workflow and `conftest.py` clean-up use superuser rights today) | As `ckam_app`: TRUNCATE, DISABLE TRIGGER, DROP, `SET session_replication_role`, UPDATE/DELETE on ledgers, purge function all refused; normal sign-in/create/move work | CLOSED when production runs as a non-owner role (EXT-07) |
| IF-06 | MEDIUM | **MITIGATED — EXTERNAL RESIDUAL.** Purge flag cannot remove rows under 5 years; owner bypass as IF-05 | Same migration; `test_vapt_append_only.py::test_the_purge_setting_cannot_delete_a_fresh_audit_row`; RT-AU-T98xx | PARTLY (as IF-05) | As IF-05 | As IF-05 | As IF-05, plus `ckam_purge_audit_log` refused for `ckam_app` | As IF-05 |
| IF-07 | MEDIUM | **OPEN — EXTERNAL.** `CKAM-Web` runs as SYSTEM on a shared server | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` line 10 | NO | EXT-06 service account; the WP-C reference launcher can document the needed rights | Medium (NAS mapping and folder rights must be right first time) | Reboot test, uploads, NAS mapping (owner/IT) | CLOSED when EXT-06 done |
| IF-08 | MEDIUM | **OPEN — EXTERNAL.** Backups on the database server, unencrypted, never restore-tested in production | `CKAM_EXTERNAL_SECURITY_ACTIONS.md` EXT-08 | NO | EXT-08 | Low | Quarterly restore drill record | CLOSED when EXT-08 done |
| IF-09 | MEDIUM | **OPEN — EXTERNAL.** Re-checked today: `.env` and `backups\` in the worktree grant `Authenticated Users:(M)` and `Users:(RX)`; `backups\` has 36 entries. Both are git-ignored | `icacls .env`, `icacls backups` run read-only on 2026-10-16 (no content read) | NO (local administrator action) | WP-C writes the inspection and lock-down plan; the owner/IT runs it (EXT-10) | Low (do not lock out the Docker Desktop service; test `docker compose` after) | `icacls` shows only the developer + Administrators; BitLocker on; dump count reduced | CLOSED when EXT-10 done |
| IF-10 | MEDIUM | **FIXED — RETESTED** (TLS and role-level read-only are IF-16) | `backend/app/erp/source.py::PgReadOnly`; `backend/tests/erp/test_vapt_erp_limits.py`; RT-AU-T970…T979 | YES (done) | None | — | Keep | CLOSED after deploy |
| AU-01 | MEDIUM | **FIXED — RETESTED** | `backend/app/core/security.py::burn_password_check`; `test_vapt_login.py`; RT-AU-T990…T996 (`aii_raw/timing_out.json`) | YES (done) | None | — | Keep | CLOSED after deploy |
| AU-03 | MEDIUM | **FIXED — RETESTED** (residuals are N2, N3) | `backend/app/core/rate_limit.py`; `backend/tests/auth/test_rate_limit.py` (7); RT-AU-T1002…T1011 | YES (done) | Post-deploy tuning for NAT'd sites (EXT-40) | — | Keep | CLOSED after deploy |
| AU-04 | MEDIUM | **DECISION REQUIRED.** Anyone who knows a login id can lock it for 15 min (RT-AU-T313/T314); one address can keep ~60 accounts locked (calculated). Rate limits only slow it | `backend/app/auth/router.py::login` (5 tries / 15 min); `test_vapt_login.py::test_once_the_lock_has_run_out_the_right_password_signs_in` | PARTLY: code can implement a chosen alternative (progressive delay, per-address lock, longer per-id window); the choice is the owner's | WP-A2 writes the options paper (A/B with plain examples); owner decides; then build | Medium (any change alters what locked-out users see) | Depends on option: lock-out by a stranger no longer blocks the real user from a known address, or delay grows per try | DECIDED and either built + retested, or ACCEPTED in `docs/ai/DECISIONS.md` |
| AU-05 | MEDIUM | **FIXED — RETESTED** | Migration `f9a1c3e5b7d2`; `backend/tests/auth/test_vapt_sessions.py` (9); `frontend/src/lib/auth-session.test.ts`; RT-AU-T101…T115, T134 | YES (done) | OBS-TV makes the increment atomic (WP-A2) | — | Keep | CLOSED after deploy |
| AC-1 | MEDIUM | **FIXED — RETESTED** | `require_role(*READ_ROLES)` on setup lists; `backend/tests/core/test_security_read_scope.py`; `retest/access_raw/ac_fixes_transcript.txt`, `authz_matrix_diff.csv` | YES (done) | None | — | Keep | CLOSED after deploy |
| N1 | MEDIUM | **FIXED — NEEDS INDEPENDENT RETEST** | `backend/app/core/body_limit.py::BodyLimitMiddleware`, registered `main.py` line 166; `backend/tests/core/test_body_limit.py` (5). Found by RT-AU-T960; fix never re-attacked | YES (done) | WP-R: re-run `aii_scripts/bigbody.py` (256 MB and chunked) against a production-mode throw-away container | — | 413 before the body is read; RSS stays flat | CLOSED after independent retest + deploy |

### LOW

| ID | Sev. | Current status | Current evidence | Can code close it? | Proposed action | Risk of change | Test needed | Final target |
|---|---|---|---|---|---|---|---|---|
| IF-11 | LOW | **MITIGATED — EXTERNAL RESIDUAL.** Pinned set exists; production still installs unpinned until EXT-12 | `backend/constraints.txt` (`python-jose==3.5.0`, `ecdsa==0.19.2`, …); `aii_raw/pip_freeze_rebuilt.txt` | PARTLY: the WP-C reference release script can use `-c constraints.txt` | EXT-12 in the deploy; reference script in `ops/windows/` (WP-C) | Low | `pip freeze` per release equals the tested set | CLOSED when the first production release is installed with constraints |
| IF-12 | LOW | **ACCEPTED — VALID DECISION.** Rationale still holds today: `decode_token` pins `algorithms=["HS256"]` (`backend/app/core/security.py` line 64); only `jose.jwt` is imported (no JWE, no ECDSA keys) | `evidence/infra/raw/pip_audit.json` (advisories on `python-jose` 3.5.0 and `ecdsa` 0.19.2); `backend/constraints.txt` | YES if the JWT library is replaced (larger change) | Keep; re-check at every pip-audit; move to PyJWT when auth code is next reworked | Medium (token format and all auth tests) | n/a | ACCEPTED, re-confirmed each release |
| IF-13 | LOW | **OPEN — CODE FIXABLE.** Image runs as root, installs `.[dev]` and copies `tests/` (dev/UAT only; production has no Docker) | `backend/Dockerfile` (no `USER`, `pip install -e ".[dev]"`, `COPY tests ./tests`) | YES | WP-C: multi-stage Dockerfile with a non-root user; a `dev` target (tests + dev deps, used by compose so the CLAUDE.md pytest command keeps working) and a `runtime` target | Medium: existing named volumes `uploads`/`logs` are root-owned, so a non-root process cannot write them until they are re-owned; test only on a throw-away project | Image `whoami` ≠ root; upload and log write work on a fresh volume; full pytest still runs in the `dev` target | CLOSED after WP-C + retest |
| IF-14 | LOW | **FIXED — RETESTED** (with N4 hardening) | `backend/app/main.py::docs_urls`; `backend/tests/test_vapt_headers_and_docs.py`; `retest_auth_input_infra.md` row AU-11 | YES (done) | None | — | Keep | CLOSED after deploy |
| IF-15 | LOW | **OPEN — CODE FIXABLE** (partly). `docs/ai/CKAM_RELEASE_RUNBOOK.md` still describes Docker (36 mentions); no `ops/windows/` folder; launcher only on the server | `ops/` holds only `backup.sh`, `init-test-db.sql`, `restore.sh`, `test_backup_restore.sh` | PARTLY: secret-free reference scripts + runbook in the repo; matching them to the live launcher needs IT (EXT-13) | WP-C: `ops/windows/run_ckam_web.ps1` and release script (reads `shared\.env`, no values; uvicorn `--no-proxy-headers`; `pip -c constraints.txt`; `alembic upgrade head` before start); WP-D: rewrite the runbook | Low (documents/scripts not run anywhere) | Static test: scripts contain no secret-looking values and do contain `--no-proxy-headers` | CLOSED when IT confirms the server copy equals the repo copy |
| IF-16 | LOW | **OPEN — EXTERNAL.** No TLS options in code: `asyncpg.connect` gets no `ssl` argument, so the driver default applies (opportunistic, no certificate check, per asyncpg documentation; not verified against the ERP). SELECT-only grant not evidenced | `backend/app/erp/source.py::PgReadOnly._connect` lines 257-266; `backend/app/core/config.py` lines 36-53 (no ssl setting) | PARTLY: settings `PO_SOURCE_SSLMODE` / `PO_SOURCE_SSLROOTCERT` (WP-A1). Grant, role-level read-only and `hostssl` need the ERP owner (EXT-25) | WP-A1 adds the settings with today's behaviour as default; EXT-25 | Low if the default is unchanged; a wrong mode in production stops ERP sync (it fails safe to "ERP unavailable") | Unit test that each mode reaches `asyncpg.connect`; `verify-full` refused against a plain-text stand-in | CLOSED when EXT-25 done and production sets `verify-full` |
| AU-02 | LOW | **ACCEPTED — VALID DECISION.** Rationale still holds: `login` checks the password first (equal cost), then answers 423 for any password on a locked account (`backend/app/auth/router.py` lines 147-172); answering "locked" only to the right password would be a guessing oracle | `test_vapt_login.py::test_a_locked_account_says_locked_for_any_password_so_the_lock_is_no_guessing_oracle`; RT-AU-T301/T302 | n/a | Keep. Re-open only if AU-04's decision changes the lock model | — | Keep the test | ACCEPTED |
| AU-06 | LOW | **MITIGATED — CODE CAN CLOSE RESIDUAL.** New `jti` each refresh, but an already-rotated refresh token stays valid until sign-out/expiry (RT-AU-T103 FAIL). No server-side token record exists (no model/table found) | `backend/app/auth/router.py::refresh` lines 221-266; `backend/app/core/security.py::create_refresh_token` | YES | WP-A2: per-session refresh record (hashed `jti`, family id, user, expiry, `replaced_at`); reuse of a replaced token ends that family (or all sessions) and writes a SECURITY row | **Medium-high**: needs an Alembic migration; several browser tabs share one cookie and each tab single-flights its own refresh (`frontend/src/lib/auth-fetch.ts` line 111), so parallel tabs would look like reuse. Needs a short grace window for the just-replaced token, and a per-session (not per-account) record so shared store logins on several devices do not sign each other out | `test_rotated_refresh_token_reuse_is_refused_and_ends_sessions`; two parallel refreshes within the grace window both succeed; two devices of one store login stay signed in; sign-out still ends everything | CLOSED after WP-A2 + independent retest of RT-AU-T103 |
| AU-07 | LOW | **FIXED — RETESTED** | `backend/app/core/deps.py::get_current_asset_user`; `asset_users/router.py::_access_reduced_or_changed`; RT-AU-T120…T133 | YES (done) | None | — | Keep | CLOSED after deploy |
| AU-08 | LOW | **FIXED — NEEDS INDEPENDENT RETEST** (`d04779a` follow-up: `Password@2026`, `Welcome@2026`) | `backend/app/auth/password_policy.py`; `backend/tests/auth/test_vapt_password_policy.py::test_a_common_word_with_digits_or_symbols_around_it_is_refused`; RT-AU-T217/T218 FAIL before the follow-up. The policy is applied only on `change-password` (the only place a person chooses a password; resets and `create_owner.py` use random values) | YES (done) | WP-A1 revalidation tests; WP-R re-runs `aii_scripts/policy.mjs` incl. `Admin@2026`, `Qwerty@123`, `India@2026` | — | Those refused; `Granite#Meadow-4418` accepted | CLOSED after independent retest |
| AU-12 | LOW | **FIXED — RETESTED** (no permanent test: OBS-AU12-TEST) | `frontend/nginx.conf` (`location ~* \.map$` 404); `frontend/vite.config.ts` line 44 `sourcemap: false`; RT-AU-T411…T414 | YES (done) | Permanent build test in WP-C | — | See OBS-AU12-TEST | CLOSED after the permanent test exists |
| AU-13 | LOW | **OPEN — EXTERNAL.** Refresh cookie not `Secure` because production is plain HTTP | `COOKIE_SECURE` default false (`docker-compose.yml`, settings) | NO (needs HTTPS) | `COOKIE_SECURE=true` with EXT-04 | Low once HTTPS exists; turning it on over HTTP breaks sign-in | Cookie flag check after EXT-04 | CLOSED with IF-02 |
| AU-14 | LOW | **FIXED — RETESTED** (residuals FONTS and OBS-CSP-STYLE) | `frontend/nginx.conf` lines 12-17; `backend/app/main.py` lines 219-241; `test_vapt_headers_and_docs.py`; `aii_raw/pw_csp_results.json` | YES (done) | Remove the Google hosts with FONTS | — | CSP test updated when FONTS lands | CLOSED after deploy |
| AU-15 | LOW | **FIXED — NEEDS INDEPENDENT RETEST.** nginx part retested (RT-AU-T409/T410); production part depends on N1, never re-attacked | `frontend/nginx.conf` `server_tokens off`, `@too_large`; `backend/app/core/body_limit.py` | YES (done) | WP-R with N1; nginx static checks in OBS-AU12-TEST | — | As N1 | CLOSED with N1 |
| AU-16 | LOW | **FIXED — RETESTED** | Atomic `UPDATE … RETURNING` in `backend/app/auth/router.py` lines 175-211; `test_vapt_login.py::test_twenty_parallel_wrong_guesses_stop_at_the_threshold`; RT-AU-T1001 | YES (done) | None | — | Keep | CLOSED after deploy |
| AC-2 | LOW | **FIXED — RETESTED** | `backend/app/masters/custom_fields_router.py::list_custom_fields`; `test_security_read_scope.py::test_custom_fields_follow_the_company`; group `retest-AC1-AC2-IF03` | YES (done) | None | — | Keep | CLOSED after deploy |
| IN-02 | LOW | **FIXED — RETESTED** | `backend/app/core/uploads.py::read_upload_bounded`; `backend/tests/imports/test_upload_size_limit.py`; `RT-AC-T815`, RT-AU-T610…T612, T961 | YES (done) | None | — | Keep | CLOSED after deploy |
| N2 | LOW | **OPEN — EXTERNAL** (production launcher). Docker part fixed in code by `a3e8fce`: `backend/Dockerfile` CMD now has `--no-proxy-headers`; not retested, no permanent test | `backend/Dockerfile` last line; `backend/app/observability/middleware.py::client_ip` (XFF only from `TRUSTED_PROXIES`, default empty, `core/config.py` line 75); app-level test `test_rate_limit.py::test_a_forged_forwarded_for_header_does_not_buy_new_attempts`; RT-AU-T1009 FAIL (before `a3e8fce`) | PARTLY: permanent test + reference launcher with the flag (WP-A1/WP-C); the live launcher change is EXT-38 | WP-A1 test: loopback peer + forged XFF + empty `TRUSTED_PROXIES` → rate-limit key and `audit_log.ip` stay the peer; static test that `backend/Dockerfile` and `ops/windows/run_ckam_web.ps1` carry `--no-proxy-headers`; EXT-38 | Low | As described; WP-R re-runs `aii_scripts/xff.py` on a rebuilt image | CLOSED when EXT-38 is done in production |
| N3 | LOW | **OPEN — CODE FIXABLE** (was ACCEPTED). Rationale only partly holds: production is still unaffected, but UAT acceptance sessions with several people share one 20/min sign-in bucket and every audit IP shows the nginx container | `frontend/nginx.conf` lines 44-65 (no `proxy_set_header X-Forwarded-For`); `docker-compose.yml` `api` has no `TRUSTED_PROXIES`; RT-AU-T1010 | YES | WP-C: nginx `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, never append); trust only the nginx container address | Medium if done carelessly: trusting `172.16.0.0/12` would also trust the Docker gateway that host connections to the published API port (`127.0.0.1:8000`) arrive from, letting a host process forge its address. Pin nginx to a fixed address on a fixed compose subnet and trust only that | Two clients through nginx get different `audit_log.ip`; 21 failures from one do not block the other; a forged XFF sent straight to `127.0.0.1:8000` is not believed | CLOSED after WP-C + retest |
| N4 | LOW | **FIXED — NEEDS INDEPENDENT RETEST** | `backend/app/main.py::is_production` lines 95-101 (`_NON_PRODUCTION_NAMES`); `backend/tests/core/test_production_secret_guard.py`, `backend/tests/test_vapt_headers_and_docs.py` | YES (done) | WP-A1 revalidation tests; WP-R re-runs `aii_scripts/startup_matrix.sh` (`prd`, `live`, unset, 40 spaces, `"a"*40`) | — | All refuse in production mode; known dev names only warn | CLOSED after independent retest |
| PO-LOGIN | LOW | **FIXED — RETESTED** (INFO side effect: such an employee cannot sign in by code; each attempt counts one failure against the Primary Owner) | `backend/tests/auth/test_login_primary_owner_clash.py`; RT-AU-T311/T312 | YES (done) | None | — | Keep | CLOSED after deploy |
| RACE-1 | LOW | **FIXED — NEEDS INDEPENDENT RETEST.** Single-create route serialised by `pg_advisory_xact_lock`; the retest burst was never run. See also OBS-NAME-IMPORT | `backend/app/masters/router.py::_refuse_duplicate_name` lines 314-326; `backend/tests/core/test_security_concurrency.py` (4); `evidence/retest/concurrency_results.md` (NOT EXECUTED) | YES (done) | WP-R: external burst (10-20 parallel same-name brand/vendor creates through the API) | — | Exactly one 201, rest 422, no 5xx | CLOSED after independent burst |

### INFO

| ID | Sev. | Current status | Current evidence | Can code close it? | Proposed action | Risk of change | Test needed | Final target |
|---|---|---|---|---|---|---|---|---|
| IN-03 | INFO | **FIXED — RETESTED** (polyglot residual: OBS-POLYGLOT) | `backend/app/documents/service.py::content_matches_extension`, `media_type_for`; `backend/tests/documents/test_vapt_content_check.py`; RT-AU-T620…T627 | YES (done) | None | — | Keep | CLOSED after deploy |
| IF-17 | INFO | **OPEN — EXTERNAL.** No CI, unsigned commits, personal-account remote | `CKAM_EXTERNAL_SECURITY_ACTIONS.md` EXT-28 | PARTLY: a CI workflow file can be prepared; ownership, MFA and branch protection are management steps | EXT-28 | Low | CI run history | CLOSED when EXT-28 done |
| D6 | INFO | **DECISION REQUIRED.** Full Admins are not limited to chosen companies (open since 2026-10-14, `docs/ai/DECISIONS.md` line 26) | Retest: ADMIN sees both companies (`retest_access.md` AC-2 row) | YES after the decision | WP-D decision paper (A/B); if "limit": build + cross-company tests | Medium (changes what Full Admins can see and do) | Cross-company matrix for Full Admin personas | DECIDED; built and retested if "limit" |
| MFA | INFO | **DECISION REQUIRED.** No second factor | — | PARTLY (TOTP can be built after a decision) | EXT-19 decision paper (WP-D); until then admin use on LAN/VPN | Medium-high (sign-in journey, recovery, store logins) | If built: enrolment, recovery, refused without code | DECIDED |
| FONTS | INFO | **OPEN — CODE FIXABLE.** Every page load calls Google Fonts; CSP allows two Google hosts | `frontend/index.html` lines 8-11; `frontend/nginx.conf` line 12; `backend/app/main.py` lines 219-222 | YES | WP-C: self-host Inter and IBM Plex Mono (latin + latin-ext), remove the links, drop both hosts from both CSPs | Low (visual only; check the 650 weight). Getting the font files needs internet: the WP-C task must say so explicitly (brief rule 1) | No request to Google in a Playwright run; CSP test without Google hosts; 0 CSP violations | CLOSED after WP-C + retest |

---

## 3. Observations (not counted in the 43) (BASELINE)

> Dated note 2026-10-16 (closure): final status of these rows and of the new observations is in **section 0.5**.

| ID | Sev. | Current status | Current evidence | Can code close it? | Proposed action | Risk of change | Test needed | Final target |
|---|---|---|---|---|---|---|---|---|
| IF-01-WIN | OBS (LOW, suspected by code reading) | **OBSERVATION — HARDEN NOW.** Windows path forms never executed. Also: `_serve_frontend_asset` calls `resolve()` **before** the containment check, so on Windows a value such as `%5c%5chost%5cshare` becomes a UNC path that `resolve()` may try to open, an outbound SMB lookup from the server (not executed, suspected) | `backend/app/main.py` lines 263-269; `CKAM_SECURITY_REMEDIATION_REPORT.md` IF-01 "Regression"; `retest_auth_input_infra.md` §4 | YES | WP-A1: lexical refusal **before** any filesystem call: refuse empty, NUL, `\`, `:`, leading `/`, any `..` segment, drive or UNC prefix (`ntpath.splitdrive`), reserved device names (`CON`, `NUL`, `AUX`, `COM1`…); then resolve + `is_relative_to` as today. Do **not** run the `%5c%5cserver%5cshare` probe on production before this is deployed | Low (real asset names are hashed `name-hash.js/.css`) | Platform-independent parametrized tests with Windows-style inputs (`..\`, `%5c`, `C:foo`, `C:%2fWindows`, `\\host\share`, `\\?\`, `\\.\`, `CON`, `x.js:stream`, trailing dot/space); Windows execution itself still not possible on this host (no Python on the host) | CLOSED after WP-A1; Windows probes after deploy |
| N5 | OBS | **OBSERVATION — HARDEN NOW.** Proxied `/api` answers carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control` twice (identical) | `frontend/nginx.conf` lines 49-60 hide only CSP and Permissions-Policy; RT-AU-T403…T405 | YES | WP-C (same file as N3): `proxy_hide_header` the other four | Low | Each header exactly once on proxied responses | CLOSED |
| N6 | OBS | **OBSERVATION — HARDEN NOW.** Single-port production answers an unknown `/api/...` path with the SPA shell and 200 | `backend/app/main.py::_serve_frontend_shell` lines 273-282 (no `api/` check); RT-AU-T952 | YES | WP-A1: `api` or `api/...` → JSON 404 with the usual envelope | Low (no SPA route starts with `api`) | Unknown `/api/x` → 404 JSON with request id; SPA routes still 200 | CLOSED |
| N7 | OBS | **OBSERVATION — ACCEPT / DEFER.** Sign-out ends every session of the account, so one person on a shared store login signs out every device | RT-AU-T109; `CKAM_SECURITY_REMEDIATION_REPORT.md` §4 | n/a | Follows the store-login decision (EXT-30); tell store users | — | — | Revisit with EXT-30 |
| N8 | OBS | **OBSERVATION — ACCEPT / DEFER.** Changing the login e-mail does not end sessions (not an access change) | RT-AU-T131 | n/a | None | — | — | ACCEPTED |
| N9 | OBS | **OBSERVATION — ACCEPT / DEFER.** `audit_log.at` is settable on INSERT, so a row the inserter backdated can be purged with the flag; real rows cannot be backdated | RT-AU-T9811 | YES (BEFORE INSERT trigger forcing `at = now()`) | Optional in WP-B, only if no import path writes historical `at` values | Low-medium (check every audit writer first) | Backdated insert gets `now()` | DEFER |
| OBS-TV | OBS (LOW, suspected) | **OBSERVATION — HARDEN NOW.** `end_all_sessions` raises `token_version` in Python (read + 1) | `backend/app/core/security.py` line 88 | YES | WP-A2: SQL increment (`token_version = AssetUser.token_version + 1`), then re-read the value before any new token is minted (change-password issues a fresh cookie with the new version) | Low-medium (callers rely on the attribute right after) | Two parallel revocations raise the version by 2; change-password still returns a working new session | CLOSED |
| OBS-STATUS | OBS | **OBSERVATION — HARDEN NOW.** `Asset.status`, `current_asset_user_id`, `status_since` have no database guard. Code check today: the only writers are `lifecycle/service.py::apply_event` (UPDATE) and the documented INSERT-time exceptions `assets/service.py` line 345 and `imports/asset_import_service.py` lines 966-972 (followed at once by `apply_event`) | `evidence/infra/db_03_append_only_privilege_tests.out.txt` A9 | YES | WP-B: a deferred constraint trigger (`AFTER UPDATE OF status, current_asset_user_id, status_since … DEFERRABLE INITIALLY DEFERRED`) that refuses the change unless an `asset_event` row for that asset was written in the same transaction; INSERT stays allowed. Deferred, because the ORM may flush the asset UPDATE before the event INSERT | Medium (core lifecycle path; bulk imports of thousands of rows; test clean-up uses replica mode) | A direct UPDATE of `asset.status` without an event fails; every lifecycle, import and correction test still passes; bulk import timing compared before/after | CLOSED after WP-B + retest |
| OBS-COMMENT | OBS | **FIXED — RETESTED** (verified by reading the source). Corrected in `a3e8fce`, the parent of `627ed73` | `backend/app/auth/router.py` lines 147-148 and 168-172 now agree with the 423-for-any-password behaviour | YES (done) | Remove from WP-A1; WP-D updates the old register | — | — | CLOSED |
| OBS-IDS | OBS | **OBSERVATION — ACCEPT / DEFER.** `retest_tests.csv` reuses ids `RT-AC-T700`…`T729` in two groups | `evidence/retest/retest_tests.csv` | n/a | Closure evidence uses new, unique ids (`CL-…`) | — | — | ACCEPTED (historical evidence is not rewritten) |
| OBS-DOCS | OBS | **OBSERVATION — HARDEN NOW.** ISO/SOC 2 readiness, threat model and evidence index still show `FIXED-PENDING-RETEST` / `IN PROGRESS` from HEAD `77431ba` | Those four files in `docs/security/` | YES (documents) | WP-D | Low | — | CLOSED |
| OBS-REG-STALE | OBS | **OBSERVATION — HARDEN NOW.** Findings register, remediation report §8 and VAPT report were written at `d04779a`; they miss `a3e8fce` (N2 Docker flag, OBS-COMMENT) | `CKAM_SECURITY_REMEDIATION_REPORT.md` §8 rows "uvicorn `--no-proxy-headers`" and "Stale comment" | YES (documents) | WP-D: add a dated addendum (do not rewrite history) pointing to this register | Low | — | CLOSED |
| OBS-EXT07-STALE | OBS | **OBSERVATION — HARDEN NOW.** EXT-07 says the role SQL "will be supplied … (file name to be confirmed)", but it already exists in the remediation report §7 | `CKAM_EXTERNAL_SECURITY_ACTIONS.md` EXT-07; `CKAM_SECURITY_REMEDIATION_REPORT.md` §7 | YES (documents) | WP-D: point EXT-07 at §7 (and at the WP-B tested version) | Low | — | CLOSED |
| OBS-AU12-TEST | OBS | **OBSERVATION — HARDEN NOW.** No permanent test for AU-12 (source maps) or for the nginx parts of AU-15 (`server_tokens off`, JSON 413) | Remediation report AU-12 "No automated test"; AU-15 "no automated test" | YES | WP-C: a vitest/node check that `vite.config.ts` keeps `sourcemap: false` and `nginx.conf` keeps the `.map` 404, the js/css `=404`, `server_tokens off` and `@too_large`; plus a post-build check of `dist/` (0 `.map` files, 0 `sourceMappingURL`) | Low | The tests themselves | CLOSED |
| OBS-GUARD-MSG | OBS | **OBSERVATION — HARDEN NOW.** The production start refusal also fires for fewer than 8 different characters, but the message only says "placeholder or shorter than 32 characters", which could mislead the operator during EXT-39 | `backend/app/main.py` lines 119-123 | YES | WP-A1: name all three rules in the message (never echo the secret) | Low | Message names the rule; secret not in the text | CLOSED |
| OBS-DOCKER-SU | OBS | **OBSERVATION — HARDEN NOW.** The Docker app role `ckam` is a superuser, so dev/UAT cannot show the least-privilege behaviour | RT-AU-T9820; `docker-compose.yml` (`POSTGRES_USER: ckam`, app connects as `ckam`) | YES | WP-B local role split on a throw-away stack first | Medium (CLAUDE.md test command, `conftest.py` replica-mode clean-up, `ops/init-test-db.sql`) | As IF-05 | CLOSED after WP-B |
| OBS-NAME-IMPORT | OBS (LOW, confirmed by code reading) | **OBSERVATION — ACCEPT / DEFER.** The "one active name per brand/vendor" rule (and RACE-1's lock) exists only on the single-create route. The head-office admin's Excel master import for brands and vendors checks codes only, and the ERP vendor-add paths check ERP link and GSTIN instead | `backend/app/masters/bulk_import_export.py::commit_import` lines 280-310; `masters/router.py` brand/vendor `import_fields` (lines ~600-620, `require_primary_owner`); `backend/app/erp/vendors.py` lines 240-262, 380-400 | YES | Ask the product owner whether the import should refuse same-name rows; if yes, a small change in WP-A1 or later | Low-medium (changes import results) | Import with a duplicate name gets a row error | Product decision; DEFER |
| OBS-CSP-STYLE | OBS | **OBSERVATION — ACCEPT / DEFER.** CSP keeps `style-src 'unsafe-inline'` | `backend/app/main.py` line 220; `frontend/nginx.conf` line 12 | PARTLY (needs a review of inline styles from the UI library) | Defer | Medium (visual breakage) | — | DEFER |
| OBS-T410 | OBS | **OBSERVATION — ACCEPT / DEFER.** nginx's JSON 413 has no request id (nginx answers before the API) | RT-AU-T410 | n/a | None | — | — | ACCEPTED |
| OBS-NPM-DEV | OBS | **OBSERVATION — ACCEPT / DEFER.** One HIGH npm advisory in a dev/build-only package (`source-map-js` 1.2.1); production dependencies 0 | `evidence/infra/dependency_audit.md`; `evidence/infra/raw/npm_audit_all.json` | YES (routine patch update) | Next routine `npm update`; re-run `npm audit` in WP-C if WP-C touches `package-lock.json` | Low | `npm audit` | DEFER |
| OBS-POLYGLOT | OBS | **OBSERVATION — ACCEPT / DEFER.** An HTML/PDF polyglot with `%PDF-` inside the first 1 KB is accepted; it is only ever served as a PDF attachment with `nosniff` | RT-AU-T627; `RT-AC-T800`…`T814` | PARTLY | None | — | — | ACCEPTED |

---

## 4. OPEN — CODE FIXABLE

> **Final (2026-10-16): none.** IF-13, N3 and FONTS are FIXED — RETESTED; IF-15's code/reference side is done
> and only the external residual (EXT-13) remains; AU-06 is FIXED — RETESTED; every HARDEN-NOW code observation
> is fixed (section 0.5). Code-side work still possible but **not a finding** and deliberately deferred: PyJWT
> instead of python-jose (IF-12 follow-up), showing `failure_counts()` on the Diagnostics screen, removing the
> AU-06 legacy-token path after the deploy, `style-src 'unsafe-inline'` (OBS-CSP-STYLE), N9, OBS-HEAD405,
> CL2-IF-OBS-02. The list below is the baseline.

Findings (baseline):

1. **IF-13** — dev/UAT image as root with dev dependencies and tests (WP-C).
2. **IF-15** — production launcher, release script and Windows runbook not in git (WP-C scripts, WP-D runbook; reconciliation with the server = EXT-13).
3. **N3** — Docker dev/UAT shares one sign-in bucket and records the nginx address (WP-C).
4. **FONTS** — Google Fonts on every page load; CSP allows Google hosts (WP-C).

Also code-closable, though not labelled OPEN:

- **AU-06** (MITIGATED — CODE CAN CLOSE RESIDUAL): refresh-token reuse detection (WP-A2).
- **OBSERVATION — HARDEN NOW**: IF-01-WIN, N5, N6, OBS-TV, OBS-STATUS, OBS-AU12-TEST, OBS-GUARD-MSG,
  OBS-DOCKER-SU (code); OBS-DOCS, OBS-REG-STALE, OBS-EXT07-STALE (documents).
- **Code side of external items**: IF-16 TLS settings, N2 permanent test + reference launcher, IF-05/IF-06 local
  role split and tests, IF-11 reference release script.

## 5. Every OPEN item and why it is open

> **Final (2026-10-16).** Still open: IF-01, IF-02, IF-07, IF-08, IF-09, IF-16, AU-13, N2, IF-17 (OPEN —
> EXTERNAL; the reasons below still hold, IF-16 and N2 now with their repository side done) and AU-04, D6, MFA
> (DECISION REQUIRED). Residual external work on MITIGATED items: IF-05, IF-06 (EXT-07, now also carrying the
> CL2-IF-01/02 script fixes), IF-11 (EXT-12), IF-15 (EXT-13). **No longer open:** IF-13, IF-15 (code side), N3,
> FONTS. The table below is the baseline.

| ID | Classification | Why it is still open |
|---|---|---|
| IF-01 | OPEN — EXTERNAL | The fix is on the dev PC only. Production `3b5e842` still serves any file, and its secrets may already be copied. Needs the owner's deploy request (EXT-01), secret rotation (EXT-02) and a compromise check (EXT-03) |
| IF-02 | OPEN — EXTERNAL | HTTPS needs a certificate and a proxy (or uvicorn TLS) on the server; the owner deferred HTTPS on 2026-10-08 |
| IF-07 | OPEN — EXTERNAL | Changing the Windows account of `CKAM-Web` is a server change (EXT-06) |
| IF-08 | OPEN — EXTERNAL | Backups are an infrastructure job on 10.0.0.205 and the NAS (EXT-08) |
| IF-09 | OPEN — EXTERNAL | File permissions and disk encryption on the dev PC are a local administrator action; re-checked 2026-10-16, still `Authenticated Users:(M)` |
| IF-16 | OPEN — EXTERNAL | Needs the ERP warehouse owner (SELECT-only grant, role-level read-only, `hostssl`); the code side is only settings |
| AU-13 | OPEN — EXTERNAL | `Secure` cookie only makes sense over HTTPS (IF-02) |
| N2 | OPEN — EXTERNAL | The production launcher is on the server only, not in git (EXT-38/EXT-13); the Docker side is fixed but untested |
| IF-17 | OPEN — EXTERNAL | Repository ownership, MFA and branch protection are management steps (EXT-28) |
| IF-13 | OPEN — CODE FIXABLE | Was left as backlog because production has no Docker |
| IF-15 | OPEN — CODE FIXABLE | The scripts were never copied off the server; the runbook was never rewritten for Windows |
| N3 | OPEN — CODE FIXABLE | Was accepted as dev/UAT-only; the acceptance is withdrawn because the fix is small and UAT audit IPs are useless today |
| FONTS | OPEN — CODE FIXABLE | Was judged not security-blocking; needs the font files (internet fetch must be allowed by the WP-C task) |

## 6. Items that need a management decision

> **Final (2026-10-16):** these were written up as SD-01 … SD-16 in `CKAM_SECURITY_DECISIONS_REQUIRED.md`
> (row 1 → SD-01, 2 → SD-04, 3 → SD-05, 4 → SD-06, 5 → SD-02, 6 → SD-03, 7 → SD-07, 8 → SD-11, 9 → SD-08,
> 10 → SD-09, 11 → SD-10, 12 → SD-12). **None is decided.** Row 12 (same-name import rule) was built as option A
> in `7b039fb` / `fafa225`; the owner may still overrule it.

| # | Decision | Linked items | Why the owner must decide | Options (to be written as a plain A/B paper in WP-D) |
|---|---|---|---|---|
| 1 | Deploy the security release, then rotate the secrets | IF-01, EXT-01, EXT-02, EXT-39 | Deploying needs the owner's explicit request; the owner types the server passwords | Deploy now (recommended) / keep production exposed |
| 2 | Internet exposure of port 3211 | IF-02, AU-04, EXT-05 | Who really needs CKAM from outside the office | A: close the forward, VPN for outside users · B: keep it, only behind HTTPS with an allow-list of store IPs |
| 3 | HTTPS (deferred 2026-10-08) | IF-02, AU-13, EXT-04 | Certificate type, cost, DNS name | Public wildcard / Let's Encrypt with DNS proof / paid 1-year certificate |
| 4 | Hard lock-out policy | AU-04 (AU-02 depends on it) | A stranger can lock a named person out for 15 minutes | A: keep the hard lock (accept) · B: progressive delay instead of a lock · C: lock only the attacking address |
| 5 | Full Admin company scope | D6, EXT-26 | Least privilege versus convenience for admins who work in both companies | A: Full Admin sees every company (today) · B: Full Admin limited to chosen companies |
| 6 | MFA | MFA, EXT-19 | Cost and effort for users; recovery when a phone is lost | A: no MFA, admin use only on LAN/VPN · B: authenticator-app code for head-office admin and Full Admins first |
| 7 | Shared store logins | EXT-30, N7, AU-06 design | With one login per store nobody can tell who did what; one sign-out signs out every device | A: store manager only · B: named logins for store staff |
| 8 | Production database role split window and names | IF-05, IF-06, EXT-07 | Superuser work on a shared database server in a maintenance window; `ckam_app` is also the name of the retired role on 10.0.1.12 (different server, but confusing) | Keep the proposed names / choose others; date of the window |
| 9 | Sign-in limit for shops behind one internet address | AU-03, EXT-40 | Busy offices may hit 20 sign-ins per minute | Keep 20/min and watch for 30 days / raise it |
| 10 | `audit_log` kept forever vs personal-data law | IF-06 purge floor, EXT-31 | Legal retention question (DPDP Act 2023) | Keep forever / define a retention after legal review |
| 11 | Independent external VAPT | EXT-14 | Budget and supplier choice; this test was done by the builders | Engage after EXT-01…08 / later |
| 12 | Same-name rule for Excel master import | OBS-NAME-IMPORT | Business rule, not security | Refuse duplicate names in imports / allow them |

---

## 7. Work packages — RESULTS (final, 2026-10-16)

All commits are **local only** (branch `worktree-ckam-build`, 22 commits ahead of origin `c66378d`: `4ba4e94` plus
21 security commits). Backend counts are full `pytest -q` runs in the dev api container against `ckam_test`.

| WP | Scope (items) | Commit(s) | Result | Tests at the end of the package | Evidence |
|---|---|---|---|---|---|
| WP-A1 | IF-01-WIN, N6, N2 tests, IF-16 TLS settings, OBS-GUARD-MSG, CL1-N4-01 (unset = production), AU-08 revalidation, RACE-1 import residual, dependency recheck | `7b039fb`; follow-up `b401e9f` (backend CSP without Google hosts, JSON 404 for `/docs` `/redoc` `/openapi.json` where docs are off) | DONE; every item retested in retest 2 (CL1-N4-01 closed) | 2437 passed, 1 skipped | `evidence/closure/backend/WPA1_RESULTS.md`, `raw/repro_before_after.txt`, `dependency_recheck.md` |
| WP-A2 | AU-06 reuse detection, OBS-TV atomic version, AU-04 options paper | `69c3a51` (migration `b5d7f9a1c3e5`) | DONE (AU-04 stays DECISION REQUIRED); retested in retest 2 sessions A1/A2 and burst (g)/(h) | 2464 passed, 2 skipped | `evidence/closure/backend/WPA2_RESULTS.md`, `AU-04_OPTIONS.md`, `wpa2_probe_output.txt` |
| WP-B | OBS-STATUS trigger, IF-05/IF-06 local role split, repeatable least-privilege checks | `734fd19` (migration `c6e8a0b2d4f6`) | DONE locally; production role split still needs a DBA (EXT-07); retest 2 found CL2-IF-01/02 in the scripts (fixed in WP-F) | 2484 passed, 2 skipped | `evidence/closure/db/WPB_RESULTS.md`, `rs_01`…`rs_08` |
| WP-C | FONTS, IF-13, N3, N5, AU-12 permanent checks, IF-15 reference scripts (+ N2 launcher, IF-11 release script), IF-09 plan, npm recheck | `79dbae7` | DONE; retested in retest 2 infra items 1–4 | vitest 1256 in 92 files; `check:build` OK; `check:nginx-live` OK | `evidence/closure/infra/WP-C_closure_evidence.md`, `IF-09_ACL_PLAN.md`, `npm_audit_recheck.md` |
| WP-D1 | Urgent production runbook, HTTPS, service-account and backup/restore plans, EXT-41/42/43 | `f746e71` | DONE — documents only; **PREPARED, NOT DONE** in production | — | `evidence/closure/docs/INDEX.md` |
| WP-D2 | Decisions paper SD-01…SD-16, 15 DRAFT policies, 6 record templates, SoA working draft | `f746e71` | DONE — all DRAFT, none approved, none operating | — | `evidence/closure/docs/WPD2_INDEX.md` |
| WP-R1 | Closure retest 1 of the late fixes (N1, N4, AU-08, RACE-1, IF-01 incl. Windows-style payloads, files, secrets) | evidence in `f746e71` | 137 cases: 133 PASS, 1 FAIL (CL1-N4-01, fixed in `7b039fb`), 2 PARTIAL, 1 OBS | — | `evidence/closure/retest1/RETEST1.md`, `tests.csv` |
| WP-R2a | Retest 2 — access (route matrix, IDOR, mass assignment, files in production mode, uploads, injection, XSS, business logic) on HEAD `734fd19` | evidence in `8664b77` | 319 cases: 318 PASS, 1 OBS; 3,038 cells, 0 escalations; no new finding | — | `evidence/closure/retest2/access/RETEST2_ACCESS.md`, `authz_matrix.csv` |
| WP-R2b | Retest 2 — infra (containers, fonts/CSP, headers, proxy address, start-up guard, database guards and role split, dependencies, secrets) | evidence in `8664b77` | 122 cases: 106 PASS, 6 FAIL (→ CL2-IF-01…04, all fixed in WP-F), 2 PARTIAL, 8 INFO | — | `evidence/closure/retest2/infra/RETEST2_INFRA.md` |
| WP-R2c | Retest 2 — sessions + external concurrency burst | evidence in `8664b77` | 56 cases, 56 PASS; 3 LOW/INFO findings (CL2-SE-N01, N03 fixed in WP-F2; N02 accepted) | — | `evidence/closure/retest2/sessions/RETEST2_SESSIONS.md`, `concurrency_results.md` |
| WP-F | CL2-IF-01…04, audit-write failure reporting, `--no-server-header`, tmpfs, stale comment, UAT seed warning | `ca94574` (no migration) | DONE; re-attacked in retest 3 (all PASS) | 2521 passed, 1 skipped; vitest 1257 in 92 files | `evidence/closure/wpf/WPF_RESULTS.md`, `wpf_01`…`wpf_04` |
| WP-F2 | CL2-SE-N01, CL2-SE-N03 | `fafa225` (no migration) | DONE; re-attacked in retest 3 (all PASS) | **2541 passed, 1 skipped** (final) | `evidence/closure/wpf/WPF2_RESULTS.md` |
| WP-R3 | Third independent retest of CL2-IF-01…04, CL2-SE-N01, CL2-SE-N03 + regression sweep, on HEAD `fd34520` | evidence `evidence/closure/retest3/` (uncommitted at the time of writing) | ≈ 360 cases, **52/52 logged assertions PASS, 0 new findings**; 3 notes (role INHERIT for a pre-existing migrator — DBA note; intended client request-id behaviour; OBS-STATUS direct UPDATE inconclusive on an empty DB) | — | `evidence/closure/retest3/RETEST3.md`, `tests.csv`, `raw/` |
| Perf | Old `4ba4e94` vs new `734fd19`, identical data (150 POs, 1,960 assets), 31 operations | evidence in `8664b77` | None over threshold; refused sign-in +33 ms by design (AU-01); bulk Move of 50 +23…34 ms (lifecycle marker) | — | `evidence/closure/perf/PERF_REPORT.md` |
| Windows native | IF-01 on a real Windows file system (dev PC, portable Python since deleted, fake canaries) | `8664b77`, `fd34520` | Old 10 of 28 leaked; `7b039fb` and `fafa225` 0 of 28, 0 5xx | — | `evidence/closure/windows/*.txt`, `attack.mjs` |
| Final | Final Windows run file; Playwright lifecycle journey timing stabilised (bounded wait) | `fd34520` | Permanent Playwright 11 passed, 1 skipped; security journeys 14/14 | — | `frontend/e2e/asset-lifecycle.spec.ts` |

### Original plan (baseline, kept for history)

Packages hold only OPEN or HARDEN-NOW **code** items (plus WP-D documents). Every package: one logical commit
per area by the lead, Conventional Commits, tests per CLAUDE.md rule 4, evidence in
`docs/security/evidence/closure/<area>/`, short why-comments with the finding id.

### WP-A1 — backend (main app, startup, ERP settings)

| Item | What | Files (expected) |
|---|---|---|
| IF-01-WIN | Lexical refusal before `resolve()` (no filesystem call for a bad path) + platform-independent permanent tests with Windows-style inputs | `backend/app/main.py`, `backend/tests/test_static_frontend.py` |
| N6 | Unknown `/api/...` → JSON 404 in single-port mode | `backend/app/main.py`, `backend/tests/test_static_frontend.py` |
| N2 (code side) | Test: loopback peer + forged `X-Forwarded-For` + empty `TRUSTED_PROXIES` → rate-limit key and `audit_log.ip` stay the peer; static test that the Dockerfile CMD (and, once WP-C adds it, the reference launcher) contain `--no-proxy-headers` | `backend/tests/…` (new test file) |
| IF-16 (code side) | `PO_SOURCE_SSLMODE` / `PO_SOURCE_SSLROOTCERT` settings passed to `asyncpg.connect`; default = today's behaviour | `backend/app/core/config.py`, `backend/app/erp/source.py`, `backend/tests/erp/test_vapt_erp_limits.py` |
| N4 / AU-08 revalidation | Extra cases in the startup-guard and password-policy tests (names `PROD`, `" Production "`, `prod-1`, unset; secrets `"a"*40`, 40 spaces, 31 chars; passwords `Admin@2026`, `Qwerty@123`, `India@2026`) | `backend/tests/core/test_production_secret_guard.py`, `backend/tests/auth/test_vapt_password_policy.py` |
| OBS-GUARD-MSG | Refusal message names all three rules | `backend/app/main.py` |

**Adjusted:** OBS-COMMENT is **removed** from WP-A1: it was already corrected in `a3e8fce` (verified, lines 147-148).
OBS-GUARD-MSG is **added** (same function as the startup guard).

### WP-A2 — backend authentication

| Item | What | Files (expected) |
|---|---|---|
| AU-06 | Server-side refresh record per session (hashed `jti`, family id, expiry, replaced-at), reuse → end that family/all sessions + SECURITY row; short grace window for the just-replaced token (parallel tabs) | New Alembic migration; `backend/app/auth/router.py::refresh`, `login`, `logout`, `change_password`; `backend/app/core/security.py`; `backend/tests/auth/test_vapt_sessions.py` |
| OBS-TV | Atomic SQL increment of `token_version`, value re-read before new tokens are minted | `backend/app/core/security.py`, callers in `auth/router.py`, `asset_users/service.py`, `asset_users/router.py` |
| AU-04 | Options write-up only (A/B/C with plain examples, numbers from RT-AU-T313/T314); no code until the owner decides | Document (handed to WP-D) |

### WP-B — database

| Item | What | Files (expected) |
|---|---|---|
| OBS-STATUS | Deferred constraint trigger: lifecycle fields change only together with an `asset_event` in the same transaction | New Alembic migration; `backend/tests/lifecycle/…` |
| IF-05 / IF-06 / OBS-DOCKER-SU | Local role split `ckam_owner` (NOLOGIN, owns everything) / `ckam_migrator` (runs Alembic as owner) / `ckam_app` (runtime, SELECT+INSERT only on the four ledgers, no TRUNCATE) on a **throw-away** stack first; least-privilege regression tests (TRUNCATE, DISABLE TRIGGER, DROP, `SET session_replication_role`, UPDATE/DELETE on ledgers, purge function → refused; normal flows → OK) | `ops/` init SQL (new), test fixtures, a new test module; the dev `ckam-build` stack is **not** switched without the owner |
| N9 (optional) | Force `audit_log.at = now()` on INSERT, only if no writer needs historical values | Same migration |

### WP-C — frontend / infrastructure

| Item | What | Files (expected) |
|---|---|---|
| FONTS | Self-host Inter + IBM Plex Mono; remove Google links; drop both Google hosts from both CSPs | `frontend/index.html`, font files / CSS, `frontend/nginx.conf`, `backend/app/main.py` (CSP string), `backend/tests/test_vapt_headers_and_docs.py` |
| IF-13 | Multi-stage `backend/Dockerfile`: `dev` target (tests + dev deps, used by compose) and `runtime` target; non-root user; volume ownership plan | `backend/Dockerfile`, `docker-compose.yml` (target only) |
| N3 (+ N5) | nginx overwrites `X-Forwarded-For` with `$remote_addr`; compose pins nginx to a fixed address and trusts only it; hide the four duplicated headers | `frontend/nginx.conf`, `docker-compose.yml` |
| OBS-AU12-TEST | Permanent config + build checks for AU-12 and the nginx parts of AU-15 | `frontend/` test file |
| IF-15 (+ IF-11 code side) | Secret-free reference `ops/windows/run_ckam_web.ps1` and release script (`--no-proxy-headers`, `pip -c constraints.txt`, `alembic upgrade head` before start, NAS mapping reading `shared\nas.pw` at run time) | `ops/windows/` (new) |
| IF-09 | Dev-PC inspection and lock-down plan (read-only commands + the ACL/BitLocker steps for the owner to run) | Document (handed to WP-D) |

**Adjusted:** N5 is **added** to WP-C because it is the same `nginx.conf` block as N3. The AU-15 nginx checks are
**added** to the AU-12 test because they are the same kind of static check.

### WP-D — documents

1. Keep this register live (status, evidence path, commit) as each package lands.
2. Dated addenda to the findings register, remediation report and VAPT report for `a3e8fce` (OBS-REG-STALE),
   EXT-07 pointer fix (OBS-EXT07-STALE), and the readiness documents (OBS-DOCS). Historical evidence is not rewritten.
3. Windows runbook rewrite (`docs/ai/CKAM_RELEASE_RUNBOOK.md`, IF-15).
4. Decision papers for section 6 (plain language, A/B), including the AU-04 write-up from WP-A2.
5. Update the production deploy pack (EXT-39 / remediation §5.2): WP-A2 and WP-B add **new migrations**, so the
   deploy must run them before start; the production role split (EXT-07) must also cover the new tables and trigger.
6. IF-09 dev-PC plan from WP-C.

### WP-R — independent retest (added)

Not in the original list, added because five findings cannot be closed without it: re-attack **N1**, **N4**,
**AU-08 follow-up**, **AU-15** (production part) and **RACE-1** (external burst), plus **N2** on the rebuilt image
(`--no-proxy-headers`), plus every WP-A1…WP-C change, on the `ckam-sec` stack after the lead rebuilds it, by an agent
that did not write the fix. Evidence in `docs/security/evidence/closure/retest/` with new unique `CL-…` ids.

### Coordination notes

- **Migrations:** WP-A2 (refresh record) and WP-B (lifecycle trigger, optional N9) each add an Alembic revision.
  They must be chained (one `down_revision` after the other) so there is still a **single head**; the migration
  head literals in `test_s3a1_master_audit_migration.py`, `test_admin_api.py` and `test_system_events.py` change.
- **Shared files:** `backend/app/main.py` (WP-A1 IF-01-WIN/N6/OBS-GUARD-MSG and WP-C CSP), `backend/app/core/config.py`
  (WP-A1 ERP settings, WP-A2 grace window), `docker-compose.yml` (WP-B roles, WP-C target/TRUSTED_PROXIES).
  Sequence these edits or give each file to one engineer at a time.
- **Not in any package:** everything OPEN — EXTERNAL and every DECISION REQUIRED item, which are prepared as
  documents only (brief rule 1).
