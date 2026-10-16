# CKAM Security Findings Register

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Date | 2026-10-15; **closure update 2026-10-16** (statuses, Commit column, 8 new findings, final counts; earlier text kept, changes marked "FINAL 2026-10-16") |
| Code state | Written at local HEAD `d04779a` (worktree `ckam-build`). **Final: HEAD `fd34520`**, Alembic head `c6e8a0b2d4f6`. Programme started at `4ba4e94`. **Nothing pushed, nothing deployed.** Production (10.0.1.98) still runs release `3b5e842` — **PRODUCTION REMAINS NOT REMEDIATED** |
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

**Update 2026-10-16 (closure).** The closure retests found 8 more problems (one Medium in the database scripts,
the rest Low or Info, plus a functional bug where scanned QR labels do not open the asset page on the single-port
server). All 7 that needed a fix are fixed on the development PC; one needs no action. Every code-fixable item is
now closed locally. Production is unchanged: it still has IF-01 and the QR-label bug until a deploy.

## Counts

### FINAL counts (2026-10-16, HEAD `fd34520`) — 51 findings

How they were counted: the 43 findings below plus the 8 new ones in the closure addendum (CL1-N4-01, CL2-IF-01,
CL2-IF-02, CL2-IF-03, CL2-IF-04, CL2-SE-N01, CL2-SE-N02, CL2-SE-N03); observations are not counted. Each finding
is counted once, at the severity the finder gave; the two split ratings are counted as follows: CL1-N4-01
("Low–Medium") at the higher value, MEDIUM; CL2-IF-04 ("functional MEDIUM, security INFO") at its security value,
INFO. Status columns: **Fixed** = fixed in a local commit and re-attacked by an independent tester; **Mitigated** = code side closed, residual needs server/DBA work;
**Accepted** = kept with a re-confirmed reason; **Remaining code** = open and closable by code; **External** = open,
needs server, network, supplier or management action, including 3 decisions. IF-01 is counted as External although
its code is fixed and retested, because production also needs secret rotation and a compromise check.

| Severity | Found | Fixed | Mitigated | Accepted | Remaining code | External (of which decision) |
|---|---|---|---|---|---|---|
| CRITICAL | 1 | 0 | 0 | 0 | 0 | 1 (0) — IF-01 |
| HIGH | 1 | 0 | 0 | 0 | 0 | 1 (0) — IF-02 |
| MEDIUM | 16 | 10 | 2 | 0 | 0 | 4 (1) |
| LOW | 25 | 18 | 2 | 2 | 0 | 3 (0) |
| INFO | 8 | 4 | 0 | 1 | 0 | 3 (2) |
| **Total** | **51** | **32** | **4** | **3** | **0** | **12 (3)** |

IDs: MEDIUM Fixed IF-03, IF-04, IF-10, AU-01, AU-03, AU-05, AC-1, N1, CL1-N4-01, CL2-IF-01 · Mitigated IF-05, IF-06 ·
External IF-07, IF-08, IF-09, AU-04 (decision). LOW Fixed IF-13, IF-14, AU-06, AU-07, AU-08, AU-12, AU-14, AU-15,
AU-16, AC-2, IN-02, N3, N4, PO-LOGIN, RACE-1, CL2-IF-02, CL2-SE-N01, CL2-SE-N03 · Mitigated IF-11, IF-15 · Accepted
IF-12, AU-02 · External IF-16, AU-13, N2. INFO Fixed IN-03, FONTS, CL2-IF-03, CL2-IF-04 · Accepted CL2-SE-N02 ·
External IF-17, D6 (decision), MFA (decision).

All 32 Fixed were re-attacked by an independent tester. The last six (CL2-IF-01, CL2-IF-02, CL2-IF-03, CL2-IF-04,
CL2-SE-N01, CL2-SE-N03 — the WP-F / WP-F2 fixes after retest 2) were re-attacked in the third independent retest
(`evidence/closure/retest3/RETEST3.md`: ≈ 360 cases, 52/52 logged assertions PASS, 0 new findings). The retest
testers are AI agents of the programme who did not write the fixes; they are not an external firm. The same rows,
in the closure register's vocabulary, are in `CKAM_SECURITY_CLOSURE_REGISTER.md` section 0.

The counts below are the register **as at 2026-10-15** (43 findings), kept for history.

### By severity (as at 2026-10-15)

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 1 | IF-01 |
| HIGH | 1 | IF-02 |
| MEDIUM | 14 | IF-03, IF-04, IF-05, IF-06, IF-07, IF-08, IF-09, IF-10, AU-01, AU-03, AU-04, AU-05, AC-1, N1 |
| LOW | 22 | IF-11, IF-12, IF-13, IF-14, IF-15, IF-16, AU-02, AU-06, AU-07, AU-08, AU-12, AU-13, AU-14, AU-15, AU-16, AC-2, IN-02, N2, N3, N4, PO-LOGIN, RACE-1 |
| INFO | 5 | IN-03, IF-17, D6, MFA, FONTS |
| **Total** | **43** | |

### By status (as at 2026-10-15)

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

> Dated note 2026-10-16: rows whose status or commits changed in the closure programme carry a
> "**FINAL 2026-10-16**" note in the Status (and where relevant Retest) cell; the Commit column lists the added
> commits. The 8 new findings are in the "Closure addendum" at the end of this file, in the same columns.

Column notes: **Retest** names the evidence file and test ids. `RT-AU-T…` ids are in
`docs/security/evidence/retest/retest_tests2.csv`; `RT-AC-…` ids in `docs/security/evidence/retest/retest_tests.csv`
(note: in that file the ids `RT-AC-T700`…`RT-AC-T729` are used twice, once by group `retest-AC1-AC2-IF03`
(`RT-AC-T600`…`T729`) and once by group `retest-sessions-clash-massassign` (`RT-AC-T700`…`T750`), so a group name is
given where it matters). CVSS 3.1 is shown **only** where the evidence gives it.

### CRITICAL and HIGH

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| IF-01 (= IN-01) | CRITICAL | Path traversal / arbitrary file read (CWE-22) | `backend/app/main.py::_serve_frontend_asset` (`GET /assets/{file_path:path}`), single-port mode (`FRONTEND_DIST_DIR` set), which is how production runs | The URL path was joined onto `<dist>/assets` with no containment check. `..%2f`, `%2e%2e`, `//etc/passwd` and `%2fetc%2fpasswd` returned files outside the folder. In a copy of the production folder layout the route returned `shared/.env` (JWT secret, database URL) and `shared/nas.pw` (fake canary values). Present in every release since 2026-09-30, including live `3b5e842` | An anonymous person who can reach port 3211 (forwarded from the internet) can read server secrets, forge a head-office-admin login, read or change all CKAM data, and use the database, NAS and ERP passwords | Resolve the requested path, then require it to sit inside `<dist>/assets` (`Path.resolve()` + `is_relative_to`); anything else is a plain 404 | 36 probe variants × 2 runs in a network-less production-layout container: all 404, 0 leaks; legitimate files still 200 (RT-AU-T801…T836; `retest/aii_raw/if01_run1.txt`, `if01_run2.txt`). Permanent test `backend/tests/test_static_frontend.py::test_assets_route_cannot_read_files_outside_the_assets_folder`. Windows path behaviour not executed (Linux only) | **FIXED (code) — OPEN EXTERNAL until deployed** (EXT-01 deploy, EXT-02 rotate secrets, EXT-03 compromise check). **FINAL 2026-10-16: unchanged — code FIXED and retested also on a real Windows file system (old code leaked 10 of 28 payloads, fixed code 0 of 28, `evidence/closure/windows/`); production still exposed (External)** | `3e134c1`, `7b039fb` (IF-01-WIN), `ca94574` |
| IF-02 | HIGH | Cleartext transmission (CWE-319) | Production uvicorn on `http://10.0.1.98:3211`, router forward of TCP 3211 | Sign-in, tokens and all data travel over plain HTTP, also from the internet | Passwords and sessions readable by anyone on the network path (store Wi-Fi, ISP) | HTTPS reverse proxy in front of uvicorn; restrict or close the internet forward (EXT-04, EXT-05) | Not testable locally | OPEN EXTERNAL | — |

### MEDIUM

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| IF-03 | MEDIUM | Broken object-level authorization, cross-company (CWE-639) | `backend/app/erp/service.py::build_draft`, `backend/app/erp/router.py::po_draft` | A CKSPL operator could open the ERP PO draft of a CKVPL PO (supplier, rates, warehouse), and the reverse (`evidence/infra/erp_cross_company_draft.txt`) | Another company's commercial data disclosed | `build_draft` raises `NotAllowed` when the PO's company is outside the login's scope; the router answers the same 404 body as a missing PO (no existence oracle) | Both directions 404, own company 200, receipts/PI 404, list shows own company only (group `retest-AC1-AC2-IF03`, `RT-AC-T713`…`T729`; `RT-AU-T601`…`T608`). Exercised on the local ERP copy | FIXED | `7e57844` |
| IF-04 (= AU-09) | MEDIUM | Hard-coded / insecure default secret (CWE-798, CWE-1188) | `backend/app/main.py::refuse_to_start_with_insecure_secret`, `is_production`, `lifespan` | With `ENVIRONMENT_NAME=production` the app started with the committed placeholder `JWT_SECRET` (only a warning line) | Anyone who has read the source could forge admin tokens | Refuse to start in production when `JWT_SECRET` is a known placeholder, shorter than 32 characters, or has fewer than 8 distinct characters. Hardened by N4 | RT-AU-T901…T913 (refused: dev default, unset, `change_me_too`, 31 chars, empty; starts with 32 and 48 chars; message does not echo the secret). N4 follow-up: `backend/tests/core/test_production_secret_guard.py` | FIXED. **FINAL 2026-10-16: FIXED — retested (retest 2 infra item 5; message names all three rules)** | `7e57844`, `d04779a`, `7b039fb` |
| IF-05 (= AU-10) | MEDIUM | Audit integrity (CWE-778) | Append-only tables `asset_event`, `asset_field_change`, `master_audit`, `audit_log` | Row triggers refused UPDATE/DELETE, but row triggers do not fire on TRUNCATE: one statement emptied a ledger (`evidence/infra/db_03_append_only_privilege_tests.out.txt` A7) | Audit trail and asset history could be erased | Migration `a3c5e7f9b1d4`: statement-level `BEFORE TRUNCATE` trigger (`forbid_append_only_truncate`) on all four tables | TRUNCATE refused for the app role on all four (RT-AU-T9800…T9821, `retest/aii_raw/rt_append_only.out.txt`). Residual FAILs RT-AU-T9817/T9818: the owner or a superuser can still `DISABLE TRIGGER` or use `session_replication_role=replica` | MITIGATED (owner/runtime role split = EXT-07). **FINAL 2026-10-16: MITIGATED — external residual. Role split scripts `ops/db/role_split.sql` + checks proven on a disposable DB (40/40 forbidden actions refused) and fixed for CL2-IF-01/02; production DBA step EXT-07** | `ae706bb`, `734fd19`, `ca94574` |
| IF-06 | MEDIUM | Audit integrity / bypass by session flag (CWE-778, CWE-284) | Trigger function `forbid_audit_log_write`, function `ckam_purge_audit_log` | Any role could `SET LOCAL ckam.allow_audit_purge = on` and delete the newest audit rows (`db_03` A6, `db_04_least_priv_flag_bypass.out.txt` D2). The table owner can disable or drop the triggers (`db_03` C1-C3) | Recent audit rows erasable by the application's own role | Same migration: the flag only opens rows older than a fixed 5-year floor written into the trigger function; `ckam_purge_audit_log` refuses a cut-off newer than 5 years; EXECUTE stays revoked from PUBLIC | Newest row and every row under 5 years refused with the flag; `ckam_purge_audit_log(now())` and `(now() - 4y11m)` refused (RT-AU-T98xx). Owner bypass unchanged | MITIGATED (EXT-07). **FINAL 2026-10-16: MITIGATED — external residual, as IF-05** | `ae706bb`, `734fd19`, `ca94574` |
| IF-07 | MEDIUM | Excessive privilege (CWE-250) | Scheduled task `CKAM-Web` on 10.0.1.98 | Runs as SYSTEM on a server shared with Spinwheel and Citykart Desk | Any CKAM flaw becomes control of the whole server and the other apps | Dedicated low-privilege service account (EXT-06) | n/a (server) | OPEN EXTERNAL | — |
| IF-08 | MEDIUM | Backup and recovery | Backup task on 10.0.0.205 | Nightly dumps sit on the same server as the database, unencrypted, never restore-tested in production | Permanent data loss on disk failure, ransomware or mistake | Off-server encrypted copy, NAS backup, quarterly restore test (EXT-08) | n/a | OPEN EXTERNAL | — |
| IF-09 | MEDIUM | Sensitive files too widely readable (CWE-552) | Dev PC 10.0.0.47: repository `.env`, `backups\` | Dev secrets and about 30 dev dumps (with a copy of real ERP vendor/PO data) readable by more accounts than needed | Leak of real vendor/PO data and dev credentials | ACL, disk encryption, purge old dumps (EXT-10) | n/a | OPEN EXTERNAL | — |
| IF-10 | MEDIUM | Uncontrolled resource consumption (CWE-400) | `backend/app/erp/source.py::PgReadOnly` (`_server_settings`, `_connect`, `_fetch`), `backend/app/erp/warehouse.py::PgWarehouseReader` | ERP reads had no connect or statement timeouts | A slow or unreachable ERP hangs requests and the background copy | Connect timeout 10 s, `statement_timeout` 60 s (background copy 120 s), client-side timeout, explicit READ ONLY transaction, `application_name=ckam` | Black-hole listener: 503 after 10.01 s; `pg_sleep` with a 2 s limit: 503 at 2.02 s; writes refused (RT-AU-T970…T979, `retest/aii_raw/erp_connect_out.txt`, `erp_stmt_out.txt`). No real ERP used | FIXED (TLS and role-level read-only remain IF-16) | `ae706bb` |
| AU-01 | MEDIUM | User enumeration by timing (CWE-208) | `backend/app/auth/router.py::login`, `backend/app/core/security.py::burn_password_check` | Existing account about 42 ms vs about 7 ms for unknown, disabled or locked accounts (`evidence/auth/t_existing.txt` vs `t_nonexist.txt`) | An outsider learns which login ids exist | Every refused sign-in does the same Argon2 work (check against a dummy hash) | 36 interleaved samples per case: medians 39.4-42.2 ms, spread 2.8 ms (RT-AU-T990…T996, `retest/aii_raw/timing_out.json`) | FIXED | `ae706bb` |
| AU-03 | MEDIUM | Improper restriction of authentication attempts (CWE-307) | `backend/app/core/rate_limit.py`; `POST /api/auth/login`, `/refresh`, `/change-password` | 171 failed sign-ins from one address were never blocked; `X-Forwarded-For` spoofing evaded the account lock (AU-T034, AU-T036) | Unthrottled password guessing | In-process sliding window: login 20/min per address and 10/min per login id, refresh 60/min, change-password 10/min; 429 with `Retry-After` and a plain sentence; `RATE_LIMITED` security audit row; `X-Forwarded-For` believed only from `TRUSTED_PROXIES` | RT-AU-T1002…T1011 pass, except T1009 (= N2) and T1010 (= N3) (`retest/aii_raw/ratelimit_out.json`) | FIXED | `ae706bb` |
| AU-04 | MEDIUM | Account lock-out abuse (CWE-645) | Lock-out rule in `login` (5 wrong / 15 min) | Anyone who knows a login id can lock that person out (AU-T032) | Real users locked out | Rate limits (AU-03) slow mass lock-outs; the head-office admin's Reset Password clears a lock | Still lockable by design (RT-AU-T313/T314, INFO). One address can keep about 60 accounts locked (calculated, not executed) | MITIGATED (residual accepted design; options EXT-05, EXT-19). **FINAL 2026-10-16: DECISION REQUIRED (SD-06; options A/B/C in `evidence/closure/backend/AU-04_OPTIONS.md`, recommendation C). Counted under External** | `ae706bb` |
| AU-05 | MEDIUM | Insufficient session expiration (CWE-613) | `asset_user.token_version` (migration `f9a1c3e5b7d2`); `backend/app/core/security.py::end_all_sessions`, `token_is_current`; `backend/app/core/deps.py::get_current_asset_user`; `backend/app/auth/router.py::logout`, `refresh`, `change_password`; `backend/app/asset_users/service.py` | Logout, password change and admin reset left the old access and refresh tokens valid until they expired (AU-T037) | A copied token survives sign-out | Every token carries the account's session version `tv`; sign-out, password change/reset, deactivation, sign-in switched off and access changes raise it | Old access and refresh tokens 401 after every trigger; other users unaffected (RT-AU-T101…T115, T134; group `retest-sessions-clash-massassign`; `retest/access_raw/sessions_transcript.txt`) | FIXED. **FINAL 2026-10-16: FIXED — retested (retest 2 sessions A2, 8 triggers); version increment now atomic (OBS-TV)** | `ae706bb` (browser side `4fa5c9b`), `69c3a51` |
| AC-1 | MEDIUM | Broken function-level authorization (CWE-863; OWASP API5:2023). CVSS 3.1 `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N` = 4.3 | `backend/app/masters/router.py::build_master_router.list_items`, `backend/app/masters/custom_fields_router.py::list_custom_fields`, `backend/app/numbering/router.py::list_rules`, `preview_rule`, `backend/app/bundles/router.py::list_all` | Own-Assets-Only (self-service) logins, including store logins, could read every setup list, including vendor GSTIN and contacts of both companies (`evidence/access/findings.csv`, `self_service_masters.txt`) | Vendor contact data and configuration disclosed to the lowest role | Lists require `require_role(*READ_ROLES)` (staff roles only) | 44 self-service cases 403, 55 staff cases 200 (group `retest-AC1-AC2-IF03`, `retest/access_raw/ac_fixes_transcript.txt`); matrix diff shows exactly the 13 expected cells changed (`retest/access_raw/authz_matrix_diff.csv`) | FIXED | `77431ba` |
| N1 | MEDIUM | Uncontrolled resource consumption (CWE-770; OWASP API4:2023). CVSS 3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` = 5.3 (`A:H` = 7.5 if the shared server is affected) | `backend/app/core/body_limit.py::BodyLimitMiddleware` (new), registered in `backend/app/main.py` | Found in the retest: single-port production had no request-body cap; an unauthenticated 256 MB sign-in body was read in full before the 422 (uvicorn peak 914 MB) | Memory exhaustion on a server shared with other apps | Pure ASGI middleware, outermost: 64 KB for `/api/auth/*`, 16 MB for multipart uploads, 5 MB for other bodies; checks `Content-Length` and counts chunked bodies; 413 with the usual JSON envelope | Found by RT-AU-T960 (`retest/aii_raw/bigbody_out.txt`). Fix covered by `backend/tests/core/test_body_limit.py` (5 tests). **Not re-run by the retest agent**. **FINAL 2026-10-16: re-attacked — closure retest 1 `CL1-T001`…`T018` PASS (RSS flat through 256 MB floods), retest 2 sessions A6 PASS** | FIXED. **FINAL 2026-10-16: FIXED — retested** | `d04779a` |

### LOW

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| IF-11 | LOW | Supply chain: no lock file | `backend/pyproject.toml`; production `pip install -e` at deploy | No Python lock file; production resolves package versions at install time | Production may run untested versions | `backend/constraints.txt` pins the tested set | Rebuilt image `pip freeze` identical to the audited set (`retest/aii_raw/pip_freeze_rebuilt.txt`) | FIXED (using it in the production install = EXT-12). **FINAL 2026-10-16: MITIGATED — external residual (as the closure register classifies it: production still installs unpinned until EXT-12; Dockerfile and the Windows deploy template now use `-c constraints.txt`)** | `ae706bb`, `79dbae7` |
| IF-12 | LOW | Known-vulnerable dependency, not reachable | `python-jose`, `ecdsa` | pip-audit advisories (3 records, 2 packages) (`evidence/infra/raw/pip_audit.json`) | Not reachable: HS256 is pinned, no ECDSA use | None now; review when replacing the JWT library | Versions unchanged. Closure recheck: still no fixed versions; 6 forged tokens refused (retest 2 T109–T113); `backend/tests/auth/test_jwt_algorithm_pinned.py` | ACCEPTED. **FINAL 2026-10-16: ACCEPTED, rationale re-confirmed; PyJWT replacement recommended** | `7b039fb` (pin test) |
| IF-13 | LOW | Container hardening (CWE-250) | `backend/Dockerfile` (dev/UAT only) | The image runs as root and includes development dependencies | Dev/UAT only; production does not use Docker | Non-root user, separate dev dependencies. **Closure:** multi-stage `backend/Dockerfile` (`dev` / `runtime`, uid 10001), `volume-init`, `cap_drop: [ALL]`, `no-new-privileges`, tmpfs `/tmp` `/var/tmp` | **Closure:** retest 2 infra item 1, T001–T018 (`evidence/closure/retest2/infra/RETEST2_INFRA.md`) | OPEN. **FINAL 2026-10-16: FIXED — retested** | `79dbae7`, `ca94574` |
| IF-14 (= AU-11) | LOW | Information exposure (CWE-651) | `backend/app/main.py::docs_urls` | `/docs`, `/redoc`, `/openapi.json` open in production | Full API map for anonymous visitors | Switched off in production; after N4 any name that is not an explicit development name counts as production | Production without the dist folder: 404; with it: the SPA shell, no API map (`retest_auth_input_infra.md` row AU-11); `backend/tests/test_vapt_headers_and_docs.py`. **Closure:** where docs are off the three paths are now a JSON 404 (not the shell); retest 2 access production-mode probe | FIXED. **FINAL 2026-10-16: FIXED — retested** | `ae706bb`, `d04779a`, `b401e9f` |
| IF-15 | LOW | Change management | `docs/ai/CKAM_RELEASE_RUNBOOK.md`; production launcher `run_ckam_web.ps1` and release script (server only) | Runbook describes Docker; production launcher and release script are not in git | Production steps and flags (for example N2) are not reviewed or versioned | Put the scripts in git; Windows runbook (EXT-13) | **Closure:** `ops/windows/` templates checked by the PowerShell parser and `-WhatIf` dry runs (`evidence/closure/infra/WP-C_closure_evidence.md` §5) | OPEN (needs IT access to the server). **FINAL 2026-10-16: MITIGATED — external residual: code/reference side fixed (secret-free launcher, deploy, verify, rollback templates; Windows runbook section); IT must confirm the live launcher (EXT-13)** | `79dbae7`, `ca94574` |
| IF-16 | LOW | ERP channel | `backend/app/erp/source.py`; ERP role `ckpost` on 10.0.1.69 | No TLS on the ERP connection; read-only is enforced by CKAM's connection setting only; SELECT-only grant not evidenced | ERP password and data in clear on the LAN | ERP owner: SELECT-only grant, role-level read-only, `hostssl`; then a TLS option in code (EXT-25) | Not exercised (no ERP). **Closure:** `PO_SOURCE_SSLMODE` / `PO_SOURCE_SSLROOTCERT` (default `prefer` = unchanged behaviour); `backend/tests/erp/test_erp_tls_settings.py` (TLS modes refuse a plain-text stand-in before the password is sent) | OPEN EXTERNAL. **FINAL 2026-10-16: OPEN EXTERNAL, code side done; ERP owner must confirm TLS and grants (EXT-25)** | `7b039fb` |
| AU-02 | LOW | Account-state disclosure (CWE-204) | `backend/app/auth/router.py::login` | HTTP 423 tells a stranger that a login id exists and is locked (AU-T006) | Small enumeration of locked accounts | Kept: 423 for any password. Alternative rejected: saying "locked" only to the right password would turn the lock into a password-guessing oracle | 423 for right and wrong password (RT-AU-T301/T302); `backend/tests/auth/test_vapt_login.py::test_a_locked_account_says_locked_for_any_password_so_the_lock_is_no_guessing_oracle` | ACCEPTED. **FINAL 2026-10-16: ACCEPTED, re-confirmed (retest 2 sessions A4); re-open only if SD-06 changes the lock model** | `ae706bb` (decision) |
| AU-06 | LOW | Session token reuse (CWE-384) | `backend/app/auth/router.py::refresh`, `backend/app/core/security.py::create_refresh_token` | The refresh token was not rotated; an old one stayed reusable (AU-T038, AU-T039) | A copied refresh cookie usable for up to 8 h | Every refresh issues a new unique token (`jti`); all earlier tokens die on sign-out, password or access change. No reuse detection: an already-rotated token stays valid until then or until expiry (single-use needs server-side storage) | New token each call PASS; RT-AU-T103 FAIL (residual). **Closure:** reuse detection with server-side `auth_session` (SHA-256 of the token id only, rotate once, 10 s grace, reuse ends every session of that person + `REFRESH_REUSE` audit row); retest 2 sessions A1 15/15, burst (h) exactly one rotation | MITIGATED. **FINAL 2026-10-16: FIXED — retested** | `ae706bb`, `69c3a51` (migration `b5d7f9a1c3e5`) |
| AU-07 | LOW | Insufficient session expiration (CWE-613) | `backend/app/core/deps.py::get_current_asset_user`; `backend/app/asset_users/router.py::_access_reduced_or_changed`, `update_asset_user`; `backend/app/asset_users/service.py` | Switching sign-in off left the access token valid up to 15 min; role, work-area and company changes applied only at the next refresh (AU-T041) | A removed user keeps acting for a while | Sign-in switch checked on every request; access changes raise the session version | Each change 401/401 at once; harmless edits keep the session (RT-AU-T120…T133; group `retest-sessions-clash-massassign`) | FIXED | `ae706bb` |
| AU-08 | LOW | Weak password requirements (CWE-521) | `backend/app/auth/password_policy.py::password_problem`; `backend/app/auth/router.py::change_password` | Only a length rule (AU-T047) | Guessable passwords | Refuse common passwords, same-character or simple runs, brand + digits, the person's own code/name/email; follow-up: a common base word with digits, symbols or look-alike characters around it | RT-AU-T201…T221 pass except T217/T218 (`Password@2026`, `Welcome@2026` accepted), closed in `d04779a` by `test_a_common_word_with_digits_or_symbols_around_it_is_refused`. Follow-up **not re-run by the retest agent**. **FINAL 2026-10-16: re-attacked — closure retest 1 `CL1-T047`…`T067` and retest 2 sessions A5 PASS; look-alike name spellings and run-plus-number passwords also refused** | FIXED. **FINAL 2026-10-16: FIXED — retested** | `ae706bb`, `d04779a`, `7b039fb` |
| AU-12 | LOW | Information exposure (CWE-540) | `frontend/nginx.conf`, `frontend/vite.config.ts` | `*.js.map` looked reachable. The maps were never built: nginx's SPA fallback answered `index.html` with 200 for any `.map` path (AU-T065) | Misleading result; real exposure if maps were ever built | `location ~* \.map$` returns 404; a missing `.js/.mjs/.css` returns 404; `build.sourcemap: false` | RT-AU-T411…T414; `npm run build` produces 0 `.map` files. **Closure:** permanent checks `frontend/src/security/nginx-config.test.ts`, `npm run check:build`, `npm run check:nginx-live` | FIXED. **FINAL 2026-10-16: FIXED — retested, with permanent tests** | `4fa5c9b`, `79dbae7` |
| AU-13 | LOW | Cookie without `Secure` (CWE-614) | Refresh cookie (`HttpOnly; SameSite=lax; Path=/api/auth`) | Not `Secure` because production is plain HTTP (AU-T040) | Cookie sent in clear | `COOKIE_SECURE=true` once HTTPS exists (EXT-04) | Not retested | OPEN EXTERNAL | — |
| AU-14 | LOW | Missing browser hardening (CWE-693) | `frontend/nginx.conf`; `backend/app/main.py::_security_headers`; `frontend/src/lib/zod-config.ts` | No Content-Security-Policy or Permissions-Policy (AU-T059, AU-T060) | No defence in depth against script injection | CSP without `unsafe-eval` or inline script; Permissions-Policy turns off camera, microphone, geolocation, payment, usb; zod set to `jitless` (its eval probe was the only violation) | Headers once on every response type (RT-AU-T401…T425, T451…T458); Playwright: 0 CSP violations, 0 page errors (`retest/aii_raw/pw_csp_results.json`: 34 screen visits, 24 as SECHO + 10 as SECOPIT; the lead's summary says 33) | FIXED. **FINAL 2026-10-16: FIXED — retested; CSP now without any Google host (retest 2 infra items 2–3)** | `4fa5c9b`, `ae706bb`, `79dbae7`, `b401e9f` |
| AU-15 | LOW | Information exposure / resource limits (CWE-200, CWE-770) | `frontend/nginx.conf`; `backend/app/core/body_limit.py` | `Server` header showed versions; nginx's 413 was an HTML page; no body cap without nginx (AU-T061, AU-T068) | Version fingerprinting; production had no cap | `server_tokens off`; JSON 413; production cap by N1 | `Server: nginx` / `uvicorn` without version; 12 MB through nginx gives a JSON 413 (RT-AU-T409/T410); production part via N1 tests | FIXED. **FINAL 2026-10-16: FIXED — retested (N1 re-attacked twice); `--no-server-header` in every repository launch path; live launcher EXT-13** | `4fa5c9b`, `d04779a`, `ca94574` |
| AU-16 | LOW | Race condition (CWE-362) | `backend/app/auth/router.py::login` (failed-attempt counter) | 20 parallel wrong guesses: 6 processed, the lock threshold was exceeded (AU-T035) | More guesses than the lock allows | One atomic `UPDATE … RETURNING` that counts only while the account is not locked; the reset on success is conditional too | Count stops at 5, one LOCKED event (RT-AU-T1001); `test_vapt_login.py::test_twenty_parallel_wrong_guesses_stop_at_the_threshold` | FIXED | `ae706bb` |
| AC-2 | LOW | Cross-company disclosure (CWE-639; OWASP API1:2023) | `backend/app/masters/custom_fields_router.py::list_custom_fields` | Custom-field definitions of every company were listed to any staff login (AC-T520…T522) | Small cross-company configuration leak | Filter by `scoped_company_ids` (global fields plus own companies) | CKSPL logins see [1], CKVPL logins [2], a login with both [1,2]; `?company_id=2` does not widen (group `retest-AC1-AC2-IF03`) | FIXED | `77431ba` |
| IN-02 | LOW | Uncontrolled resource consumption (CWE-400) | `backend/app/core/uploads.py::read_upload_bounded`; import routes in `imports/router.py`, `asset_users/router.py`, `masters/router.py` | Excel imports were read whole into memory with no cap (IN-T117; head-office-admin / Full-Admin routes only) | Memory exhaustion by an admin upload | Read in 1 MB pieces; refuse above 15 MB with 413 | 16 MB file gives 413 in 89 ms (`RT-AC-T815`, RT-AU-T610…T612, T961) | FIXED | `ba04371` (outer limit `d04779a`) |
| N2 | LOW | Reliance on an untrusted header (CWE-348, CWE-290) | uvicorn default `--proxy-headers --forwarded-allow-ips=127.0.0.1` (production launcher; also `backend/Dockerfile` CMD) | A client connecting from 127.0.0.1 can set `X-Forwarded-For`: it escapes the per-address sign-in limit and writes a forged IP into the audit trail | Needs local access to the CKAM server (other apps share it) | Run uvicorn with `--no-proxy-headers` in the production launcher, which is not in git (EXT-13); set `TRUSTED_PROXIES` when an HTTPS proxy arrives | RT-AU-T1009 FAIL (`retest/aii_raw/xff_out.json`). **Closure:** Dockerfile CMDs and the reference launcher carry `--no-proxy-headers`; `backend/tests/core/test_n2_forwarded_for.py`; retest 2 infra item 4 PASS on Docker | OPEN EXTERNAL. **FINAL 2026-10-16: OPEN EXTERNAL, repository side done; live launcher EXT-38 / EXT-13** | `a3e8fce`, `7b039fb`, `79dbae7`, `ca94574` |
| N3 | LOW | Shared rate-limit bucket (CWE-770) | `frontend/nginx.conf` (`/api/` sends no `X-Forwarded-For`); `docker-compose.yml` (no `TRUSTED_PROXIES`) | Docker dev/UAT only: every browser user has the nginx container's address, so 20 sign-ins per minute in total | Dev/UAT availability; audit IPs show nginx. Production not affected | Accepted for dev/UAT; the UAT Playwright run switches the limits off for that stack only | RT-AU-T1010. **Closure:** nginx overwrites `X-Forwarded-For`; API trusts only nginx's fixed address; retest 2 infra item 4 and sessions A3 PASS | ACCEPTED. **FINAL 2026-10-16: acceptance withdrawn by the closure register; FIXED — retested** | `79dbae7` |
| N4 | LOW | Insecure default (CWE-1188, CWE-798) | `backend/app/main.py::is_production` | Found in the retest: production protections applied only when `ENVIRONMENT_NAME` was exactly `production`/`prod`; `prd`, `live` or unset started with the placeholder secret and served `/docs` (RT-AU-T910…T913) | IF-04 and IF-14 could fail open on one wrong `.env` line | Only `development, dev, test, testing, uat, security-test, local, ci` are non-production; anything else (including empty) is production; blank or low-variety secrets refused | `backend/tests/core/test_production_secret_guard.py`, `backend/tests/test_vapt_headers_and_docs.py`. **Not re-run by the retest agent**. **FINAL 2026-10-16: closure retest 1 PASS except an unset name (→ CL1-N4-01, fixed); retest 2 infra item 5 PASS (72 weak combinations refused)** | FIXED. **FINAL 2026-10-16: FIXED — retested** | `d04779a`, `7b039fb` |
| PO-LOGIN | LOW | Authentication availability | `backend/app/auth/router.py::login` (login-id matching) | An employee whose code equals the Primary Owner's name made the head-office-admin login ambiguous (401): a lock-out by anyone allowed to add an employee | Head-office admin locked out | The same row counts once; on a clash the Primary Owner matched by exact name wins | With employee code `SECHO` present, `SECHO` and `secho` sign in as the Primary Owner (RT-AU-T311/T312; group `retest-sessions-clash-massassign`). Side effect (INFO): such an employee cannot sign in by code, and each attempt counts one failure against the Primary Owner | FIXED | `77431ba` |
| RACE-1 | LOW | Race condition (CWE-362) | `backend/app/masters/router.py::_refuse_duplicate_name` | Found by the lead while writing concurrency tests: ten parallel creates of a brand with one name produced two rows (check-then-insert); vendors use the same check (listed as SUSPECTED in `retest/concurrency_results.md`) | Duplicate master records | Transaction-level advisory lock on (table, name) before the duplicate check | `backend/tests/core/test_security_concurrency.py::test_ten_parallel_brand_creates_with_one_name_make_one_brand` and `…_vendor_creates_…` (asyncio, through the app). The retest agent's burst run was **not executed**. **FINAL 2026-10-16: external bursts run — closure retest 1 `CL1-T069`…`T077` (one 201, rest 422, 0 5xx) and retest 2 burst (f); the Excel import now refuses duplicate names too** | FIXED. **FINAL 2026-10-16: FIXED — retested** | `da790d1`, `7b039fb` |

### INFO

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| IN-03 | INFO | Upload content not checked (CWE-434) | `backend/app/documents/service.py::content_matches_extension`, `media_type_for`, `save_document`; `backend/app/documents/router.py::download_document` | Documents were checked by extension only; the type the browser claimed was stored and sent back (IN-T118) | Already neutralised by `nosniff` + `attachment`; defence in depth | Signature check per allowed type; the stored and served type comes from the extension, never from the browser | Fakes refused with a plain 422; a real PNG claimed as `text/html` stored and served as `image/png` (RT-AU-T620…T627; `RT-AC-T800`…`T814`). HTML/PDF polyglot with `%PDF-` in the first 1 KB is accepted and served harmlessly as a PDF attachment (INFO) | FIXED | `ae706bb` |
| IF-17 | INFO | Development process | Git repository | No CI, no pre-commit hooks, unsigned commits, single author; remote under a personal account | No independent check of each change | Company-owned repository, MFA, branch protection, CI (EXT-28) | — | OPEN EXTERNAL | — |
| D6 | INFO | Least privilege (decision) | Full Admin role | Full Admins are not limited to chosen companies (owner decision D6 open since 2026-10-14) | A Full Admin of one company can act in the other | Owner decision (EXT-26) | Retest shows the designed behaviour (ADMIN sees both companies); retest 2 access confirms it and the work-area limit | OPEN EXTERNAL (decision). **FINAL 2026-10-16: DECISION REQUIRED (SD-02)** | — |
| MFA | INFO | Authentication strength | Sign-in | No multi-factor authentication | A stolen password is enough, also for admins | Decision and build (EXT-19) | — | OPEN EXTERNAL (decision). **FINAL 2026-10-16: DECISION REQUIRED (SD-03)** | — |
| FONTS | INFO | Third-party requests / privacy | `frontend/index.html`; CSP allows `fonts.googleapis.com`, `fonts.gstatic.com` | Every page load fetches Inter / IBM Plex Mono from Google Fonts | User IP sent to Google; the CSP must allow two outside hosts | Self-host the fonts. The frontend engineer's notes size this at 94 KB (latin subset) + 126 KB (latin-ext) (EXT-11). **Closure:** self-hosted Inter + IBM Plex Mono (latin, latin-ext), Google hosts removed from both CSPs | **Closure:** retest 2 infra item 2 — 0 requests to other hosts, 0 CSP violations, 144 same-origin font responses | OPEN. **FINAL 2026-10-16: FIXED — retested** | `79dbae7`, `b401e9f` |

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

Final status of these observations (2026-10-16): N5, N6, OBS-TV, OBS-STATUS FIXED and retested (`79dbae7`,
`7b039fb`, `69c3a51`, `734fd19`); OBS-COMMENT fixed (`a3e8fce`); N7, N8, N9, OBS-IDS accepted or deferred; OBS-DOCS
assigned to the parallel documentation package. Details in `CKAM_SECURITY_CLOSURE_REGISTER.md` section 0.5.

---

## Closure addendum (2026-10-16): new findings, final code state `fd34520`

Sources: `evidence/closure/retest1/RETEST1.md` (closure retest 1, 137 cases), `evidence/closure/retest2/infra/RETEST2_INFRA.md`
(122 cases), `evidence/closure/retest2/sessions/RETEST2_SESSIONS.md` (56 cases), `evidence/closure/retest2/access/RETEST2_ACCESS.md`
(319 cases, no new finding), and the fixes in `evidence/closure/backend/WPA1_RESULTS.md`, `evidence/closure/wpf/WPF_RESULTS.md`,
`evidence/closure/wpf/WPF2_RESULTS.md`. All fixes are local only.

### New findings — MEDIUM

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| CL1-N4-01 | MEDIUM (tester: Low–Medium; counted at the higher value) | Insecure default (CWE-1188, CWE-16) | `backend/app/core/config.py` (`environment_name` default), `backend/app/main.py::is_production`, `refuse_to_start_with_insecure_secret`, `docs_urls` | With `ENVIRONMENT_NAME` **not set at all**, the default `development` applied: the app started with the placeholder JWT secret and published `/docs`, `/redoc`, `/openapi.json` (a blank value correctly refused) (`CL1-T019`) | A production host started without the variable would come up in development mode: forgeable tokens, API map exposed | Default changed to `production` (fail closed); Docker dev/UAT stacks set the name explicitly | Found by closure retest 1 (`evidence/closure/retest1/raw/n4_results.txt`); `backend/tests/core/test_production_secret_guard.py::test_an_unset_environment_name_counts_as_production`, `test_the_real_start_up_with_an_unset_environment_name_refuses_the_placeholder`; retest 2 infra item 5: unset refuses | FIXED — retested | `7b039fb` |
| CL2-IF-01 | MEDIUM | Improper privilege management (CWE-269), insufficient logging (CWE-778) | `ops/db/role_split.sql` steps 5–6 (sequence grants), `ops/db/check_least_privilege.sql`, `ops/db/role_split_verify.sql`; `backend/app/observability/writer.py::report_failure` | The role-split script granted the runtime role `UPDATE` on sequences, so it could `setval` the ledger id sequences: every later `audit_log` insert failed silently ("reached maximum value"), movements failed with 409; survives ROLLBACK; neither check script noticed; the audit writer reported only the first failure per process (T097–T099) | Someone with the runtime DB password could blind the database audit trail and stop asset movements, defeating IF-05/IF-06. Production would have inherited it through EXT-07 | Sequences `GRANT USAGE, SELECT` only (also default privileges); check 19 (UPDATE on any sequence = FAIL), check 20 (id sequences sane against the table's highest id); verify check 11; runbook section 9; audit-write failures counted and reported at most once a minute with a count, plus a `system_event` row | Reproduced before/after: `evidence/closure/wpf/wpf_01_if01_if02_repro_BEFORE_head734fd19.out.txt`, `wpf_02_if01_if02_AFTER_wpf.out.txt`; `backend/tests/security/test_least_privilege_role_split.py` (4 new CANNOT cases, negative control, damage detection), `backend/tests/observability/test_log_write_failure_reporting.py` (4). **Retest 3:** every `setval` / `ALTER SEQUENCE` denied for the runtime role, verify 49/49, failures re-reported with a running count (`evidence/closure/retest3/RETEST3.md`, `raw/r3_06_runtime_matrix.txt`, `raw/if01b_03_reports.txt`) | FIXED — retested (scripts) — production needs the updated scripts run by a DBA (EXT-07) | `ca94574` |

### New findings — LOW

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| CL2-IF-02 | LOW | External control of a configuration setting (CWE-15) | PostgreSQL role defaults; `ops/db/role_split.sql`, both check scripts | The runtime role could `ALTER ROLE <itself> SET default_transaction_read_only = on` (or a tiny `statement_timeout`); every later session failed, a re-run of the split did not clear it, and the checks still said PASS (T101) | Persistent self-inflicted outage by anyone with the runtime password, invisible to the post-deploy check | `role_split.sql` step 7 `ALTER ROLE … RESET ALL` (and per database); check 21 / verify 12 FAIL while `pg_db_role_setting` holds a row for the runtime role. Cannot be prevented inside PostgreSQL; detection is the control | `wpf_01` (accepted, undetected) vs `wpf_02` (both scripts FAIL, reset works); role-split pytest case 4b. **Retest 3:** every stored default reported by check 21; stored `role=<owner>` rejected at login; reset works (`evidence/closure/retest3/raw/r3_06_runtime_matrix.txt`, `r3_07_reset.txt`) | FIXED — retested (detection + reset) — production with EXT-07 | `ca94574` |
| CL2-SE-N01 | LOW | Race condition / data consistency (CWE-362) | `backend/app/masters/router.py` (category and sub-category create, edit, import) | No name-uniqueness guard on Category: 20 parallel adds of one name created 3 active categories (the code index stopped the rest) | Duplicate category names; code generation not serialised | One active Category name per work area and one Sub-category name per Category: `_active_name_exists` / `_refuse_duplicate_name` gain `scope` and `exclude_id`; advisory lock on `asset_category:<work area>:<name>`; Excel import via `MasterPolicy.unique_name_scope`; 403 for the wrong work area still comes first | `backend/tests/masters/test_wpf2_category_names.py` (11; 20 parallel → exactly one). **Retest 3:** 20 parallel creates 201 × 1 / 422 × 19, sub-categories likewise, import duplicates refused (`evidence/closure/retest3/raw/cl3_masters_race.txt`, `cl3_import_commit.txt`) | FIXED — retested | `fafa225` |
| CL2-SE-N03 | LOW | Inconsistent error handling | `backend/app/core/errors.py::integrity_message` | A same-serial race loser that reached the expression index `ux_asset_serial_number_ci` got a bare 409 "This record already exists." instead of the 422 plain sentence of the pre-check (13 of 20 in retest 2 scenario c) | Confusing message; no leak | `CONSTRAINT_REFUSALS` maps that index to 422 "This serial number is already used by another asset. Check the serial number and try again." | `backend/tests/core/test_wpf2_serial_race_message.py` (9; 3 bursts × 20 → 1 success, 19 × 422, no 409, no 500). **Retest 3:** 201 × 1 / 422 × 19, no 409/5xx (`evidence/closure/retest3/raw/cl3_serial_race.txt`) | FIXED — retested | `fafa225` |

### New findings — INFO

| ID | Severity | Category | Component | Finding | Impact | Fix | Retest | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|
| CL2-IF-03 | INFO | Traceability | `frontend/nginx.conf` | No `X-Request-ID` on answers nginx serves itself (static files, SPA shell, 404s, its 413) on the Docker stacks (T039) | Harder to trace an incident on dev/UAT; production single-port unaffected | `add_header X-Request-ID $request_id always` on nginx's own answers; under `/api/` the application's id passes through (map), never taken from the client | `frontend/src/security/nginx-config.test.ts`; fixer's live check 11/11 (`evidence/closure/wpf/wpf_03_xrequestid_live.out.txt`). **Retest 3:** exactly one id on every answer type; unsafe client ids replaced (`evidence/closure/retest3/raw/if03_reqid_result.txt`) | FIXED — retested | `ca94574` |
| CL2-IF-04 | INFO (security); functional MEDIUM | Functional defect found during the security retest | `backend/app/main.py::_serve_frontend_asset` | In single-port mode (production) `/assets/<id>` — the Asset 360 address that printed QR labels encode — and `/assets/new` answered a JSON 404 (T046). **The same bug is in production `3b5e842`** | Scanned labels, refreshes and pasted links to Asset 360 likely fail on the live server | A name of 1–3 segments of `[A-Za-z0-9_-]` (no dot) returns the SPA shell like the catch-all; the IF-01 lexical check runs first; real files and the plain 404 unchanged | `backend/tests/test_static_frontend_spa_assets.py` (11 functions, 31 cases incl. every route of `frontend/src/router.tsx`). The commit message of `fd34520` says "QR deep link 200"; the committed file `evidence/closure/windows/native_windows_final_release_fafa225.txt` records `/some/spa/route` → 200 only. **Retest 3** (single-port production-mode container of the final image): `/assets/<id>`, `/assets/new` and multi-segment routes → shell with `no-cache`; route-looking canary files never served; ≈ 45 traversal payloads identical 404, 0 leaks (`evidence/closure/retest3/raw/if04_result.txt`) | FIXED — retested (local) — production still affected until deployed | `ca94574` |
| CL2-SE-N02 | INFO | Defence in depth | `backend/app/core/body_limit.py` behind uvicorn's h11 parser | A malformed `Content-Length` is refused 400 by the HTTP parser before the body-limit middleware, so the middleware's 413 branch for it is never reached | None: refused, body never read | No action | Retest 2 sessions A6 | ACCEPTED | — |

### Severity and status changes in the closure (do not smooth over)

| ID | 2026-10-15 | 2026-10-16 final | Reason |
|---|---|---|---|
| IF-11 | FIXED | MITIGATED (external residual) | Pinned set exists, but production still installs unpinned until EXT-12 (closure register reclassification) |
| AU-04 | MITIGATED (accepted design) | DECISION REQUIRED | A lock-out a stranger can trigger against a named person is an owner decision (SD-06) |
| N3 | ACCEPTED | FIXED — retested | Acceptance withdrawn; fixed in `79dbae7` |
| AU-06 | MITIGATED | FIXED — retested | Reuse detection built (`69c3a51`) |
| IF-13, FONTS | OPEN | FIXED — retested | `79dbae7` |
| IF-15 | OPEN | MITIGATED (external residual) | Code/reference side done; live launcher EXT-13 |
| N1, N4, AU-08, AU-15, RACE-1 | FIXED, not independently retested | FIXED — retested | Closure retests 1 and 2 |
| CL1-N4-01 | — | MEDIUM | Tester rated "Low–Medium"; counted at the higher value |
| CL2-IF-04 | — | INFO (security) | Tester rated "functional MEDIUM, security INFO"; counted at the security value because this is a security register; its business weight is high (printed labels) |

### New observations (not counted)

| Ref | Observation | Final | Source |
|---|---|---|---|
| CL1-OBS-N4-02 | Start-up refusal text did not name the 8-different-characters rule | Fixed (`7b039fb`), retested | `RETEST1.md` |
| CL1-OBS-FILES-01 / CL2-AC-OBS-01 | Polyglot (`%PDF-` header, HTML body) accepted by the prefix check; only ever served as attachment + `nosniff` | Accepted (= OBS-POLYGLOT) | `RETEST1.md`, `RETEST2_ACCESS.md` |
| CL1-OBS-SECRET-01 | Untracked `docs/ai/CKAM_DEMO_WALKTHROUGH.md` holds a demo-only password | Deliberately not committed | `RETEST1.md` |
| CL2-IF-OBS-01 | Dev-target containers could write `/var/tmp` | Fixed in the repository (tmpfs `noexec`, `ca94574`); effective at the next rebuild | `RETEST2_INFRA.md` |
| CL2-IF-OBS-02 | Runtime image needs run flags (`--cap-drop ALL`, `--read-only`, …) documented | Deferred (production has no Docker) | `RETEST2_INFRA.md` |
| CL2-IF-OBS-03 | Audit-write failure reported only once per process | Fixed with CL2-IF-01 (`ca94574`); the Diagnostics screen does not yet show the count | `RETEST2_INFRA.md` |
| CL2-IF-OBS-04 | Stale Google Fonts comment in `backend/app/main.py` | Fixed (`ca94574`) | `RETEST2_INFRA.md` |
| CL2-IF-OBS-05 | `server: uvicorn` banner in single-port mode | Fixed in the repository (`--no-server-header`); live launcher EXT-13 | `RETEST2_INFRA.md` |
| CL2-IF-OBS-06 | Shared password of seeded UAT personas | Accepted (UAT only; warning added in `backend/scripts/seed_uat_personas.py`) | `RETEST2_INFRA.md` |
| OBS-HEAD405 | Single-port mode answers `HEAD` with 405 on SPA pages (pre-existing) | Deferred (labels use GET) | `WPF_RESULTS.md` |
| OBS-NPM-DEV | One dev-only HIGH advisory (`source-map-js` 1.2.1); production dependencies 0 | Deferred, re-confirmed | `evidence/closure/infra/npm_audit_recheck.md` |
| OBS-ROLE-INHERIT (retest 3) | If a migrator role already exists with `INHERIT` membership, `ops/db/role_split.sql`'s idempotent re-grant guard does not repair it (the documented path creates the migrator fresh and is unaffected) | DBA note: drop/recreate the migrator or `GRANT <owner> TO <migrator> WITH INHERIT FALSE`, then re-run the verify; to be added to `ops/db/ROLE_SPLIT_RUNBOOK.md` in a later change | `evidence/closure/retest3/RETEST3.md` note 1 |
| OBS-STATUS-R3 (retest 3) | Direct status UPDATE as the runtime role inconclusive on a fresh empty database (0 rows matched); guard verified present and enabled | Coverage note; behaviour covered by `backend/tests/lifecycle/test_obs_status_guard.py`, WP-B `rs_05`, retest 2 | `evidence/closure/retest3/RETEST3.md` note 3 |

### Third independent retest (added 2026-10-16)

`evidence/closure/retest3/RETEST3.md` re-attacked CL2-IF-01, CL2-IF-02, CL2-IF-03, CL2-IF-04, CL2-SE-N01 and
CL2-SE-N03 on HEAD `fd34520` plus a regression sweep (sign-in, Asset 360, reports, logs, move, receive): ≈ 360 cases,
**52/52 logged assertions PASS, 0 new findings**. Those six rows above are now "FIXED — retested". Counts and the
counting rule are unchanged (51 findings; 32 fixed, all re-attacked).
