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
