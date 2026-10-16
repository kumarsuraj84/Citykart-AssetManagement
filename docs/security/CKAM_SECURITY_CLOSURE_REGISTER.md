# CKAM Security Closure Register (live)

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Date | 2026-10-16 (baseline, written **before** any closure fix starts) |
| Code state read | HEAD `627ed73` (parent `a3e8fce`), Alembic head `a3c5e7f9b1d4`, worktree `ckam-build`. At the time of reading `git status` showed no modified code files |
| Inputs | `CKAM_SECURITY_COMPLETE_REPORT.md` (Parts A-G; checked line by line to be identical to the individual files), `CKAM_SECURITY_FINDINGS_REGISTER.md`, `CKAM_SECURITY_REMEDIATION_REPORT.md`, `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_VAPT_REPORT.md`, `evidence/retest/*` (`retest_access.md`, `retest_auth_input_infra.md`, `concurrency_results.md`, `retest_tests2.csv`), and the current source (`backend/app`, `backend/Dockerfile`, `docker-compose.yml`, `frontend/nginx.conf`, `frontend/index.html`, `frontend/vite.config.ts`, `frontend/src/lib/auth-fetch.ts`) |
| Production | Not touched. Production (10.0.1.98) still runs `3b5e842`; nothing is pushed or deployed |
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

## 1. Summary counts (the 43 findings)

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

## 2. Register: the 43 findings

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

## 3. Observations (not counted in the 43)

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

Findings:

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

## 7. Work packages

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
