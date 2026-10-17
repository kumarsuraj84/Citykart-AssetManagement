# CKAM Security Remediation Report

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Date | 2026-10-15 (Part 1); **Part 2 — closure stage added 2026-10-16** |
| Code range | Part 1: `4ba4e94` (start of the programme) .. `d04779a`. **Part 2: .. `fd34520` (final HEAD)**, worktree `ckam-build` |
| Commits | Part 1: `3e134c1`, `7e57844`, `ba04371`, `77431ba`, `4fa5c9b`, `ae706bb`, `da790d1`, `d04779a`. Part 2: `a3e8fce`, `7b039fb`, `79dbae7`, `69c3a51`, `b401e9f`, `734fd19`, `ca94574`, `fafa225`, `fd34520` (code/test) plus documentation commits `627ed73`, `3362c1b`, `f746e71`, `8664b77`. All local; **none pushed, none deployed** |
| Migrations added | `f9a1c3e5b7d2` (`asset_user.token_version`), `a3c5e7f9b1d4` (TRUNCATE guards, 5-year audit purge floor); **Part 2:** `b5d7f9a1c3e5` (`auth_session`), `c6e8a0b2d4f6` (asset lifecycle field guard). Single Alembic head: **`c6e8a0b2d4f6`** (was `a3c5e7f9b1d4` at the end of Part 1) |
| Related | `CKAM_SECURITY_FINDINGS_REGISTER.md` (every finding and its status), `CKAM_VAPT_REPORT.md`, `CKAM_EXTERNAL_SECURITY_ACTIONS.md` |

## In plain words

Twenty-seven problems were fixed or reduced in the code. Each fix has a test that will fail if the problem ever
comes back. The security testers re-ran their attacks against the fixed code; four late fixes (N1, N4, the
password follow-up and RACE-1) came after that retest and are proven by permanent tests only. Some things will look
different to users: people are signed out when their access changes, signing out signs out every device, weak
passwords are refused, and too many sign-in attempts in a minute get a "wait a minute" message.

None of this is live yet. The most urgent step is to deploy it (it closes IF-01) and then change the
production secrets. The order matters and is written in section 5.

**Update 2026-10-16.** The closure stage (Part 2 at the end of this report) fixed everything that was still
fixable in code, was attacked again by independent testers, and fixed the 7 new problems those testers found; a
third independent retest then re-attacked those last fixes (52/52 checks passed, nothing new found). The deploy order is now in Part 2 §P2.4 (four migrations, not two). Section 7 below is **superseded** by
the tested scripts in `ops/db/` and must not be run as written. Production is still not remediated.

---

## Contents

1. Summary table
2. Remediation detail (each FIXED or MITIGATED finding)
3. Existing tests that were changed, and why
4. Behaviour users will notice
5. Migration notes and production deploy order
6. Regression results
7. Least-privilege database role design (DESIGN ONLY, NOT APPLIED) — **SUPERSEDED 2026-10-16 by `ops/db/`**
8. What was not changed, and why (with 2026-10-16 updates)
9. **Part 2 — closure stage (2026-10-16)**: per-fix detail, user-visible changes, migrations and deploy order,
   regression, what was not changed and why

---

## 1. Summary table

> Dated note 2026-10-16: statuses below are as at 2026-10-15. Final statuses: `CKAM_SECURITY_FINDINGS_REGISTER.md`
> ("FINAL 2026-10-16" notes) and `CKAM_SECURITY_CLOSURE_REGISTER.md` section 0. Changed since: IF-11 → MITIGATED
> (external residual EXT-12); AU-04 → DECISION REQUIRED; AU-06 → FIXED (`69c3a51`); AU-12 now has permanent tests
> (`79dbae7`); N1, N4, AU-08, AU-15, RACE-1 independently retested.

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
| Regression | Pass. Limitation: tested on Linux. Windows backslash, drive-letter and UNC forms are covered by the same `resolve()` + `is_relative_to` logic by design but were not executed; probe them on production after deploy (EXT-01). **Update 2026-10-16:** the Windows forms were hardened lexically (IF-01-WIN, `7b039fb`, Part 2) and executed on a real Windows file system on the dev PC: the old code leaked 10 of 28 payloads (fake `.env`, `nas.pw`, `C:\Windows\win.ini`, also via `\\localhost\C$`), the fixed code 0 of 28 (`evidence/closure/windows/`) |
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
| Code changed | New `backend/app/auth/password_policy.py::password_problem`: `COMMON_PASSWORDS` (about 100), same character / runs, `^(ckam\|citykart)[\W\d_]*$`, the person's code / e-mail local part / name words (≥ 4 characters); `d04779a` adds `COMMON_BASE_WORDS` with look-alike mapping (`@`→a, `0`→o, …) and stripping of surrounding digits/symbols. `auth/router.py::change_password` returns 422 with the sentence and writes a `PASSWORD_CHANGE_FAILED` security row |
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
| Code changed | `frontend/nginx.conf`: `location ~* \.map$ { return 404; }` and `location ~* \.(?:js\|mjs\|css)$ { try_files $uri =404; }`; `frontend/vite.config.ts`: `build.sourcemap: false` |
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

> **Superseded 2026-10-16:** the closure stage added two more migrations (`b5d7f9a1c3e5`, `c6e8a0b2d4f6`), the
> head is now `c6e8a0b2d4f6`, and the start command needs `--no-proxy-headers --no-server-header`. Use the deploy
> order in Part 2 §P2.4 and `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`. The text below is kept as history.

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

> Dated note 2026-10-16: these are the Part 1 numbers. The final numbers on `fd34520` are in Part 2 §P2.5
> (backend 2541 passed, 1 skipped; vitest 1257 in 92 files).

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

> **SUPERSEDED 2026-10-16 — DO NOT RUN THE SQL IN THIS SECTION.** The tested version is `ops/db/role_split.sql`
> with `ops/db/role_split_verify.sql`, `ops/db/check_least_privilege.sql` and `ops/db/ROLE_SPLIT_RUNBOOK.md`
> (WP-B `734fd19`, corrected in WP-F `ca94574`), proven on a disposable database
> (`evidence/closure/db/WPB_RESULTS.md`). This section is what EXT-07 earlier called "to be supplied"; it is now
> supplied by those files. Two defects of the design below, found in the closure retest, are fixed only in
> `ops/db/`: (1) step 4 and step 8 grant `UPDATE` on sequences, which lets the runtime role `setval` the ledger id
> sequences and silently stop the database audit trail (**CL2-IF-01, MEDIUM**) — the tested script grants
> `USAGE, SELECT` only; (2) nothing clears role defaults the runtime role may set on itself (**CL2-IF-02**) — the
> tested script runs `ALTER ROLE … RESET ALL` and the checks FAIL on any stored setting. The proposed production
> names are also different (runbook: `ckasset_owner`, `ckasset_migrator`, runtime stays `ckassetapp`; never reuse
> `ckam_app`), and Alembic runs as the migrator with `ALEMBIC_SET_ROLE=<owner>` (`backend/app/alembic/env.py`).
> The text below is kept as history.
>
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

> Dated note 2026-10-16: several rows below were stale or have since changed. The corrections are written into
> the rows as "**Update 2026-10-16**"; the closure-stage list is Part 2 §P2.7.

| Item | Why not in this programme | Where it goes |
|---|---|---|
| HTTPS, `Secure` cookie (IF-02, AU-13) | Needs a certificate and a reverse proxy on the production server | EXT-04, EXT-05 |
| Database owner/runtime role split (IF-05/IF-06 residual) | Database-administration change on the shared production database; superuser password typed by the owner. **Update 2026-10-16:** the scripts now exist and are tested locally (`ops/db/role_split.sql` etc., `734fd19`, corrected `ca94574`); only the production run remains | Section 7 (superseded by `ops/db/`), EXT-07 |
| Service account instead of SYSTEM (IF-07) | Windows server change | EXT-06 |
| Off-server backups and restore test (IF-08) | Infrastructure | EXT-08 |
| Dev PC file permissions (IF-09) | Local administrator action | EXT-10 |
| uvicorn `--no-proxy-headers` (N2) | The production launcher is on the server only, not in git. ~~`backend/Dockerfile` CMD was also left with uvicorn's defaults~~ **Update 2026-10-16 — this was stale:** `a3e8fce` (committed right after this report was written) added `--no-proxy-headers` to the Dockerfile CMD; since `79dbae7` / `ca94574` both Dockerfile targets run `uvicorn … --no-proxy-headers --no-server-header`, the reference launcher `ops/windows/run_ckam_web.ps1.template` carries both flags, and `backend/tests/core/test_n2_forwarded_for.py` pins them. Only the **live** production launcher remains | EXT-38 / EXT-13 |
| nginx `X-Forwarded-For` / `TRUSTED_PROXIES` for Docker (N3) | Dev/UAT only; accepted. **Update 2026-10-16:** acceptance withdrawn and fixed in `79dbae7` (Part 2) | Done |
| Refresh-token reuse detection (AU-06 residual) | Needs server-side storage of the current token id per session; a design change, not a quick fix. **Update 2026-10-16:** built in `69c3a51` (Part 2) | Done |
| Lock-out abuse (AU-04 residual) | A hard lock is the chosen design; real options are MFA, network restriction or progressive delays. **Update 2026-10-16:** reclassified DECISION REQUIRED; options paper `evidence/closure/backend/AU-04_OPTIONS.md` | SD-06 |
| MFA | Management decision | EXT-19, SD-03 |
| Full Admin company scope (D6) | Owner decision open | EXT-26, SD-02 |
| Self-hosted fonts (FONTS) | Small frontend change, not security-blocking; CSP currently allows the two Google hosts. **Update 2026-10-16:** done in `79dbae7` / `b401e9f` | Done |
| Dev image as root (IF-13) | Dev/UAT only; production has no Docker. **Update 2026-10-16:** done in `79dbae7` | Done |
| ERP TLS and SELECT-only role (IF-16) | Needs the ERP warehouse owner first. **Update 2026-10-16:** code settings added in `7b039fb` (default unchanged) | EXT-25 |
| Runbook and launcher in git (IF-15) | Needs a copy of the server scripts with secrets removed. **Update 2026-10-16:** secret-free reference scripts in `ops/windows/` (`79dbae7`); reconciliation with the live launcher remains | EXT-13 |
| `python-jose` / `ecdsa` (IF-12) | Not reachable (HS256 pinned); replacing the JWT library is a larger change | Accepted (re-confirmed 2026-10-16) |
| `token_version` raised in Python, not one SQL increment (OBS-TV) | Suspected, low impact, not tested. **Update 2026-10-16:** atomic increment in `69c3a51` | Done |
| No database guard on `Asset.status` (OBS-STATUS) | Protected by the code rule (`apply_event` is the only writer). **Update 2026-10-16:** database trigger in `734fd19` | Done |
| Stale comment in `auth/router.py::login` (OBS-COMMENT) | Documentation-only issue found while writing this report; no code edits were made in this reporting step. **Update 2026-10-16:** corrected in `a3e8fce` | Done |

---

# Part 2 — closure stage (2026-10-16)

| | |
|---|---|
| Code range | `627ed73` → `fd34520` (code/test commits `a3e8fce`¹, `7b039fb`, `79dbae7`, `69c3a51`, `b401e9f`, `734fd19`, `ca94574`, `fafa225`, `fd34520`) |
| Inputs | `CKAM_SECURITY_CLOSURE_REGISTER.md` (baseline), `evidence/closure/**` (work-package results, retests, performance, native Windows run), `git show --stat` of each commit and the current source |
| Production | **Not touched. PRODUCTION REMAINS NOT REMEDIATED** (`3b5e842` still has IF-01 and CL2-IF-04) |

¹ `a3e8fce` (N2 Docker flag, OBS-COMMENT) predates `627ed73` but was not in Part 1; it is listed here for completeness.

## P2.1 Per-fix detail

Columns as in Part 1. "Retest evidence" paths are relative to `docs/security/`. "Regression" = the full backend
run at the end of the package (counts in §P2.5) — every one passed with no failure.

### IF-01-WIN — Windows path forms on `/assets/{file_path:path}` (observation, LOW suspected) — `7b039fb`

| | |
|---|---|
| Before | The IF-01 fix called `resolve()` before the containment check, so on Windows a UNC or drive value (`%5c%5chost%5cshare`, `C:%2fWindows%2fwin.ini`) reached the filesystem first (possible outbound SMB lookup). On a real Windows file system the **old** release `4ba4e94` returned the fake `.env`, `nas.pw` and `C:\Windows\win.ini` for 10 of 28 payloads |
| Risk | Windows-only bypass or SMB credential leak on the production server type |
| Root cause | Containment proven only after an OS path operation; Windows path semantics (drive, UNC, ADS, device names, trailing dot/space, 8.3 names) never handled lexically |
| Code changed | New `backend/app/core/static_safety.py`: `is_safe_relative_name()` (pure text check, no filesystem: refuses backslash, NUL, colon, leading `/`, empty / dot segments, trailing dot or space, device names, `~digit` short names, characters outside `[A-Za-z0-9._~-]`, > 200 characters, anything `PureWindowsPath` reads as drive/root/`..`) and `safe_asset_path()` (then join, `resolve()`, containment, symlink/junction refusal, `is_file()`). Used by `backend/app/main.py::_serve_frontend_asset` and the root-file branch of `_serve_frontend_shell` |
| Test added | `backend/tests/test_static_frontend_windows.py` (~80 payloads; e.g. `test_the_lexical_check_refuses_every_dangerous_form`, `test_a_refused_name_never_reaches_the_filesystem`, `test_every_refused_name_is_the_same_plain_404_through_the_route`, `test_a_symlink_inside_assets_that_points_outside_is_404_through_the_route`, `test_legitimate_hashed_assets_are_served_with_their_content_type`) |
| After | Every refused name is the same plain 404 with zero filesystem calls built from the URL; hashed `.js`/`.css`/`.woff2` still served |
| Retest evidence | Closure retest 1 Windows-style payloads PASS (`evidence/closure/retest1/RETEST1.md`); retest 2 access, 23 payloads in a production-mode container, 0 leaks (`evidence/closure/retest2/access/raw/prod_file_probe.json`); **native Windows on the dev PC:** `7b039fb` and final `fafa225` 0 of 28, 0 5xx (`evidence/closure/windows/native_windows_fixed_release_7b039fb.txt`, `…_final_release_fafa225.txt`) |
| Regression | Pass (2437 passed, 1 skipped). Limits: junctions, real 8.3 aliases and SMB lookups not exercised natively; run on the dev PC, not on the production server |

### N6 — unknown `/api/...` answered with the SPA shell — `7b039fb`

| | |
|---|---|
| Before | Single-port mode: `GET /api/nope` → 200 `text/html`; `POST /api/nope` → 405 |
| Risk | Misleading answers; clients and monitors could not tell a wrong address from success |
| Root cause | The SPA catch-all did not exclude `/api` |
| Code changed | `backend/app/core/errors.py::is_api_path`, `unknown_api_response`; `backend/app/main.py::_serve_frontend_shell` answers `/api` first. Follow-up `b401e9f`: where the API docs are off, `/docs`, `/redoc`, `/openapi.json` are the same JSON 404 (not the shell) |
| Test added | `backend/tests/test_static_frontend_windows.py::test_an_unknown_api_address_is_a_json_404_never_the_shell`, `…_without_the_frontend_too`, `test_other_methods_on_an_unknown_api_address_are_404_too`, `test_where_the_docs_are_off_they_are_a_json_404_not_the_shell`, `test_real_api_routes_are_unchanged` |
| After | JSON 404 "This API address does not exist…" with request id, any method |
| Retest evidence | Retest 2 access and infra (unknown `/api` and docs paths JSON 404) |
| Regression | Pass |

### N2 (repository side) — forged `X-Forwarded-For` through uvicorn — `a3e8fce`, `7b039fb`, `79dbae7`, `ca94574`

| | |
|---|---|
| Before | uvicorn's default `--proxy-headers` trusted `X-Forwarded-For` from 127.0.0.1 (RT-AU-T1009 FAIL) |
| Risk | A local client escapes the per-address sign-in limit and forges audit IPs |
| Root cause | Launcher used uvicorn defaults |
| Code changed | `backend/Dockerfile` CMDs (both targets) `--no-proxy-headers --no-server-header`; `ops/windows/run_ckam_web.ps1.template` likewise; `backend/app/observability/middleware.py::client_ip` unchanged (already correct) |
| Test added | `backend/tests/core/test_n2_forwarded_for.py` (`test_the_docker_image_starts_uvicorn_without_proxy_headers`, `test_the_windows_reference_launcher_keeps_both_uvicorn_flags`, `test_every_launch_script_in_the_repository_keeps_proxy_headers_off`, `test_the_running_api_process_in_docker_has_proxy_headers_off`, `test_a_forged_header_from_loopback_or_outside_cannot_buy_fresh_sign_in_attempts`, …) |
| After | Forged headers never change the address or the rate-limit key in any repository launch path |
| Retest evidence | Retest 2 infra item 4 (T047–T052) |
| Regression | Pass. **Production launcher unchanged (EXT-38 / EXT-13)** |

### IF-16 (code side) — ERP connection TLS options — `7b039fb`

| | |
|---|---|
| Before | No TLS setting; asyncpg default; `repr(Settings)` showed the ERP password |
| Risk | ERP password and data in clear on the LAN; password in debug output |
| Root cause | No configuration surface |
| Code changed | `backend/app/core/config.py`: `po_source_sslmode` (default `prefer` = today's behaviour; invalid value stops the start), `po_source_sslrootcert`, `repr=False` on secrets; `backend/app/erp/source.py::erp_ssl_argument`, `PgReadOnly.connect_arguments` (shared by the live source and the warehouse reader); `backend/app/observability/system.py::safe_config` shows the mode, not secrets |
| Test added | `backend/tests/erp/test_erp_tls_settings.py` (e.g. `test_the_default_passes_no_ssl_argument_so_behaviour_is_unchanged`, `test_a_tls_mode_refuses_a_server_without_tls_before_sending_the_password`, `test_the_password_never_reaches_logs_or_the_diagnostics_bundle`) |
| After | TLS can be required or verified by setting; default unchanged; TLS **not** mandatory |
| Retest evidence | Permanent tests only (no real ERP; stand-ins used) |
| Regression | Pass. External: ERP owner must confirm TLS and grants (EXT-25) |

### CL1-N4-01 + OBS-GUARD-MSG — unset `ENVIRONMENT_NAME` fell open — `7b039fb`

| | |
|---|---|
| Before | No `ENVIRONMENT_NAME` → default `development` → placeholder JWT secret accepted, `/docs` published (`CL1-T019`); refusal text did not name the 8-different-characters rule |
| Risk | Forgeable tokens and exposed API map after one missing `.env` line |
| Root cause | Fail-open default in `Settings` |
| Code changed | `backend/app/core/config.py`: `environment_name: str = "production"`; `backend/app/main.py::refuse_to_start_with_insecure_secret` message names all three rules, never the value; `docker-compose.yml` keeps dev/UAT names explicit |
| Test added | `backend/tests/core/test_production_secret_guard.py`: `test_an_unset_environment_name_counts_as_production`, `test_the_real_start_up_refuses_a_weak_secret_in_production`, `test_the_real_start_up_with_an_unset_environment_name_refuses_the_placeholder`, `test_the_real_start_up_runs_in_development_names_even_with_the_placeholder`, `test_the_real_start_up_runs_in_production_with_a_real_secret` (real FastAPI lifespan) |
| After | Unset = production; 11 weak secrets × 15 production-like names refused |
| Retest evidence | Retest 2 infra item 5: 72 weak combinations refused, 49 start, unset refuses, message names three rules (`evidence/closure/retest2/infra/RETEST2_INFRA.md`) |
| Regression | Pass |

### AU-08 revalidation — `7b039fb`

| | |
|---|---|
| Before | Look-alike spellings of the person's name (`R@vi#2026xyz`) and simple-run-plus-number passwords (`abcdefgh1`) accepted |
| Risk | Guessable passwords |
| Root cause | Name check on the literal text only; run check required the whole password |
| Code changed | `backend/app/auth/password_policy.py` (look-alike undo for name parts; run-plus-short-number rule; still no composition rule) |
| Test added | `backend/tests/auth/test_vapt_password_policy.py`: `test_the_owners_list_of_weak_passwords_is_refused` (40 entries), `test_strong_passphrases_are_accepted_without_any_symbol_rule`, `test_there_is_no_composition_rule`, `test_a_name_part_found_only_after_look_alikes_are_undone_is_refused_but_not_short_parts` |
| After | Weak list refused with a sentence that never repeats the password; passphrases accepted |
| Retest evidence | Closure retest 1 `CL1-T047`…`T067`; retest 2 sessions A5 |
| Regression | Pass |

### RACE-1 residual / OBS-NAME-IMPORT — duplicate names through the Excel import — `7b039fb`

| | |
|---|---|
| Before | Brand/vendor Excel import checked codes only; two parallel imports of one new name created two vendors (3 of 5 new tests failed on the old code, `evidence/closure/backend/raw/import_names_before.txt`) |
| Risk | Duplicate master records bypassing the screen's rule |
| Root cause | Name rule and lock lived only in the single-create route |
| Code changed | `backend/app/masters/router.py::_active_name_exists` (shared, same advisory lock), `_import_name_checks`, `MasterPolicy.unique_name_noun`; `backend/app/masters/bulk_import_export.py` `row_check` (preview) and `before_create` (commit, inside the row savepoint) |
| Test added | `backend/tests/masters/test_import_duplicate_names.py` (`test_a_vendor_file_with_two_rows_of_one_name_and_one_existing_name`, `test_two_imports_of_the_same_name_at_the_same_moment_create_only_one`, …) |
| After | Duplicate rows refused with a plain row message; other rows still import |
| Retest evidence | Permanent tests; retest 2 burst (f) covered the screen path |
| Regression | Pass |

### IF-12 recheck — JWT algorithm pinned — `7b039fb`

| | |
|---|---|
| Before / Risk / Root cause | `python-jose` / `ecdsa` advisories without fixed versions (IF-12, accepted) |
| Code changed | None |
| Test added | `backend/tests/auth/test_jwt_algorithm_pinned.py` (HS384 / HS512 / none / RS256 / ES256 refused) |
| After / Retest evidence | Still not reachable; retest 2 infra T109–T113; `evidence/closure/backend/dependency_recheck.md` |
| Regression | Pass |

### FONTS, AU-14 — self-hosted fonts, CSP without Google hosts — `79dbae7`, `b401e9f`

| | |
|---|---|
| Before | 55 requests to Google per tour; both CSPs allowed `fonts.googleapis.com` and `fonts.gstatic.com` |
| Risk | User IPs sent to a third party; weaker CSP |
| Root cause | Fonts loaded from Google Fonts in `frontend/index.html` |
| Code changed | `frontend/index.html` (links removed), new `frontend/src/fonts.css` imported first in `frontend/src/main.tsx`, `@fontsource-variable/inter` 5.3.0 and `@fontsource/ibm-plex-mono` 5.3.0; CSP in `frontend/nginx.conf` and `backend/app/main.py::CONTENT_SECURITY_POLICY` = `'self'` only |
| Test added | `frontend/src/security/nginx-config.test.ts` ("has a strict Content-Security-Policy without any Google host", "index.html loads nothing from another site"); `backend/tests/test_vapt_headers_and_docs.py` CSP string updated |
| After | 0 Google requests, 0 CSP violations, pixel-identical screens (except live data) |
| Retest evidence | `evidence/closure/infra/WP-C_closure_evidence.md` CL-WPC-01…08; retest 2 infra item 2 (3 personas, 41 steps, 144 same-origin font responses) |
| Regression | Pass (vitest 1256 in 92 files) |

### IF-13 — non-root containers — `79dbae7`, `ca94574`

| | |
|---|---|
| Before | Image ran as root with dev dependencies and tests |
| Risk | Container breakout impact; test tooling in the image |
| Root cause | Single-stage Dockerfile, no `USER` |
| Code changed | `backend/Dockerfile` (`base` / `dev` / `runtime`, uid 10001, `-c constraints.txt`), `backend/.dockerignore`, `docker-compose.yml` (`volume-init`, `target: dev`, `cap_drop: [ALL]`, `no-new-privileges`; tmpfs `/tmp` and `/var/tmp` `noexec` in `ca94574`) |
| Test added | Proofs CL-WPC-10…19 (no unit test; container behaviour) |
| After | uid 10001, no capabilities, runtime image without tests, old root-owned volumes handed over |
| Retest evidence | Retest 2 infra item 1, T001–T018 |
| Regression | Pass; `dev` target still runs pytest (CL-WPC-17) |

### N3 + N5 — real client address behind nginx; each header once — `79dbae7`

| | |
|---|---|
| Before | All browser users shared nginx's address (one sign-in bucket, useless audit IPs); four headers sent twice |
| Risk | Dev/UAT lock-out of everyone; poor audit trail |
| Root cause | nginx sent no `X-Forwarded-For`; api had no trusted proxy; nginx did not hide the API's copies |
| Code changed | `frontend/nginx.conf` (`proxy_set_header X-Forwarded-For $remote_addr`, `proxy_hide_header` × 6); `docker-compose.yml` (fixed `edge` subnet, `TRUSTED_PROXIES` = nginx's single address) |
| Test added | `frontend/src/security/nginx-config.test.ts` ("proxies /api/ with the real client address, overwritten and never appended (N3)", "drops the API's own copies of the headers nginx adds, so each appears once (N5)") |
| After | Each client its own bucket; forged values overwritten; each header exactly once |
| Retest evidence | CL-WPC-20…27; retest 2 infra items 3–4, sessions A3 |
| Regression | Pass |

### AU-12 / OBS-AU12-TEST — permanent build and nginx checks — `79dbae7`

| | |
|---|---|
| Before | No automated guard for source maps, `server_tokens`, JSON 413 |
| Code changed | `frontend/scripts/check-build-security.mjs` (`npm run check:build`), `frontend/scripts/check-nginx-live.mjs` (`npm run check:nginx-live`) |
| Test added | `frontend/src/security/nginx-config.test.ts` (12, later 13), `frontend/scripts/check-build-security.test.mjs` (5) |
| After / Retest evidence | Build check OK (0 `.map`, no `sourceMappingURL`, no Google host); mutation check with the old `nginx.conf` → 4 failures; retest 2 infra T032–T038 |
| Regression | Pass |

### IF-15 + IF-11 (code/reference side) — Windows scripts — `79dbae7`, `ca94574`

| | |
|---|---|
| Before | Production launcher and release script only on the server; runbook described Docker |
| Code changed | `ops/windows/run_ckam_web.ps1.template`, `deploy_ckam.ps1.template` (refuses without backup, `ENVIRONMENT_NAME=development`, weak secrets; `pip install -c constraints.txt`; `alembic upgrade head` before start), `verify_release.ps1` (incl. `/assets/1`, `/assets/new` shell checks since `ca94574`), `rollback_release.ps1.template`, `README.md`; `docs/ai/CKAM_RELEASE_RUNBOOK.md` Windows section |
| Test added | PowerShell parser 0 errors; `-WhatIf` dry runs (`evidence/closure/infra/raw/windows/dryrun.out.txt`); fake secrets in 0 log lines |
| After | Reviewed, secret-free reference in git |
| Regression | n/a. **IT must reconcile the live launcher (EXT-13); production still installs unpinned (EXT-12)** |

### AU-06 — refresh-token reuse detection — `69c3a51` (migration `b5d7f9a1c3e5`)

| | |
|---|---|
| Before | An already-rotated refresh token stayed valid until sign-out or expiry (RT-AU-T103 FAIL) |
| Risk | A copied refresh cookie usable for up to 8 h |
| Root cause | No server-side session record |
| Code changed | New `auth_session` table (`backend/app/auth/models.py`), `backend/app/auth/sessions.py::renew` (one atomic `UPDATE … WHERE current_jti_hash = :presented … RETURNING`; DUPLICATE within the grace window → access token, no cookie; otherwise REUSE → 401, all the person's sessions ended, `REFRESH_REUSE` audit row); wired into `backend/app/auth/router.py` (login, refresh, logout, change-password); `REFRESH_REUSE_GRACE_SECONDS` (default 10, 0 = strict) in `backend/app/core/config.py`; clean-up 30 days after expiry in `backend/app/observability/retention.py::purge_old_logs`; legacy tokens upgraded once |
| Test added | `backend/tests/auth/test_wpa2_refresh_reuse.py` (e.g. `test_an_old_token_ends_every_session_of_that_person_and_nobody_elses`, `test_a_duplicate_inside_the_grace_window_gets_an_access_token_and_no_cookie`, `test_parallel_refreshes_with_one_token_rotate_exactly_once`, `test_renewals_reuse_and_sign_out_at_the_same_moment_never_fail_with_an_error`, `test_no_token_or_token_id_is_stored_logged_or_in_the_diagnostics_bundle`) |
| After | Only SHA-256 hashes stored; one rotation per token; reuse ends everything |
| Retest evidence | Retest 2 sessions A1 (15/15) and burst (h) (`evidence/closure/retest2/sessions/`) |
| Regression | Pass (2464 passed, 2 skipped). Residuals: 10 s grace; thief-wins race detected after the fact; legacy path to remove next release (`evidence/closure/backend/WPA2_RESULTS.md`) |

### OBS-TV — atomic session-version increment — `69c3a51`

| | |
|---|---|
| Before | `token_version` read + 1 in Python: the probe lost 18–19 of 20 concurrent bumps (`evidence/closure/backend/wpa2_probe_output.txt`) |
| Code changed | `backend/app/core/security.py::end_all_sessions` (async; one `UPDATE … SET token_version = token_version + 1 … RETURNING`; also revokes `auth_session` rows); all callers in `auth/router.py`, `asset_users/service.py`, `asset_users/router.py` |
| Test added | `backend/tests/auth/test_wpa2_token_version_atomic.py` (`test_twenty_concurrent_bumps_end_at_start_plus_twenty`, `test_a_bump_leaves_no_pending_write_of_the_old_value`, `test_sessions_ended_at_the_same_moment_all_stay_ended`) |
| After / Retest evidence | 0 lost bumps; retest 2 burst (g) version consistent |
| Regression | Pass |

### OBS-STATUS — database guard on asset status / holder / date — `734fd19` (migration `c6e8a0b2d4f6`)

| | |
|---|---|
| Before | Only the code rule protected `asset.status`, `current_asset_user_id`, `status_since` |
| Risk | A stray write bypasses the append-only ledger |
| Root cause | No database-level guard |
| Code changed | Trigger `trg_asset_lifecycle_fields_guard` → `forbid_asset_lifecycle_write()` refuses changes unless the transaction marker `ckam.lifecycle_writer` is on; `backend/app/lifecycle/service.py::apply_events` sets it (`LIFECYCLE_WRITER_SETTING`, `_set_lifecycle_writer`) around its write |
| Test added | `backend/tests/lifecycle/test_obs_status_guard.py` (13 cases: `test_an_orm_write_of_a_lifecycle_field_is_refused`, `test_a_raw_sql_update_of_a_lifecycle_field_is_refused`, `test_the_edit_screen_cannot_mass_assign_the_lifecycle_fields`, …) |
| After | Stray writes refused; ledger path unchanged. **Honest limit:** the app role can set the marker itself; the barrier against a database user is the role split |
| Retest evidence | Retest 2 access (DB guard + mass assignment) and infra 6a. Retest 3: guard verified present and enabled by `role_split_verify.sql`; its direct-UPDATE probe as the runtime role was inconclusive on a fresh database with no asset rows (0 rows matched) — coverage note, not a failure |
| Regression | Pass (2484 passed, 2 skipped); one fixture now uses `allow_lifecycle_fixture_write`, one statement-count limit 6 → 7 (explained in `WPB_RESULTS.md` §2) |

### IF-05 / IF-06 / OBS-DOCKER-SU — local role split and least-privilege checks — `734fd19`

| | |
|---|---|
| Before | Production app role owns every table; it can disable or drop the append-only triggers |
| Code changed | `ops/db/role_split.sql`, `role_split_verify.sql`, `check_least_privilege.sql`, `ROLE_SPLIT_RUNBOOK.md`; `backend/app/alembic/env.py` `ALEMBIC_SET_ROLE` (`_set_migration_role`) |
| Test added | `backend/tests/security/test_least_privilege_role_split.py` (full split on a throw-away database, negative control) |
| After | Runtime role: 7/7 needed actions, 40/40 forbidden actions refused; app works end to end as that role (11/11) |
| Retest evidence | `evidence/closure/db/rs_01`…`rs_08`; retest 2 infra 6b (~70 refused) — which found CL2-IF-01/02 (below) |
| Regression | Pass. **Production DBA step remains (EXT-07)**; dev/UAT role still superuser (owner decision) |

### CL2-IF-01 — runtime role could `setval` the ledger sequences; silent audit-write failures — `ca94574`

| | |
|---|---|
| Before | `role_split.sql` granted `UPDATE` on sequences: `setval('audit_log_id_seq', max)` succeeded, survived ROLLBACK, every later audit insert failed with only one stderr line; checks silent (`evidence/closure/wpf/wpf_01_if01_if02_repro_BEFORE_head734fd19.out.txt`) |
| Risk | MEDIUM: someone with the runtime password blinds the database audit trail and blocks movements |
| Root cause | Over-broad sequence grant; once-per-process failure report in `backend/app/observability/writer.py::report_failure` |
| Code changed | `ops/db/role_split.sql` (sequences `USAGE, SELECT`; default privileges likewise), `check_least_privilege.sql` checks 19–20, `role_split_verify.sql` check 11, runbook §9; `backend/app/observability/writer.py` (`report_failure` counts and reports at most once a minute with totals; `failure_counts()`, `reset_failure_reports()`; `insert_rows` records a `system_event`), `backend/app/observability/filelog.py` (no double console line) |
| Test added | `backend/tests/security/test_least_privilege_role_split.py` (4 new CANNOT cases, negative control 3b, damage detection 3c); `backend/tests/observability/test_log_write_failure_reporting.py` (`test_a_repeating_audit_write_failure_is_reported_first_then_once_a_minute_with_a_count`, `test_the_failing_audit_write_never_breaks_the_request`, `test_when_the_database_refuses_everything_nothing_raises_and_nothing_loops`, `test_report_failure_itself_never_raises`) |
| After | `setval` refused, inserts OK (`wpf_02_if01_if02_AFTER_wpf.out.txt`); failures visible with counts |
| Retest evidence | Before/after reproduction + permanent tests; the retester's own candidate fix (T100). **Retest 3 (independent):** every `setval` / `ALTER SEQUENCE` on all 32 sequences denied for the runtime role, `nextval` OK, verify 49/49; a provoked audit-write failure answered 401 without SQL, re-reported "6 failures so far, 5 since the last report", one `system_event` row, resumed after repair (`evidence/closure/retest3/RETEST3.md`, `raw/r3_06_runtime_matrix.txt`, `raw/if01b_01_break.txt` … `if01b_04_repair.txt`) |
| Regression | Pass (2521 passed, 1 skipped). Production: DBA runs the updated scripts; before that, check 20 read-only to see whether a sequence was already damaged |

### CL2-IF-02 — runtime role could store its own defaults — `ca94574`

| | |
|---|---|
| Before | `ALTER ROLE self SET default_transaction_read_only = on` accepted, undetected, survived a re-run of the split |
| Root cause | PostgreSQL allows it; scripts did not reset or inspect `pg_db_role_setting` for the runtime role |
| Code changed | `ops/db/role_split.sql` step 7 `RESET ALL` (and per database); check 21 / verify 12 |
| Test added | Role-split pytest case 4b; negative control without `RESET ALL` fails on check 21 |
| After / Retest evidence | Detected and reset (`wpf_02`). **Retest 3:** 4 stored defaults all reported by check 21, a stored `role=<owner>` rejected at login (no escalation), superuser reset clears them (`evidence/closure/retest3/raw/r3_06_runtime_matrix.txt`, `r3_07_reset.txt`). DBA note from retest 3: a migrator that **already exists** with `INHERIT` membership is not repaired by the script's idempotent guard — drop/recreate it or `GRANT <owner> TO <migrator> WITH INHERIT FALSE` (to be noted in `ops/db/ROLE_SPLIT_RUNBOOK.md` in a later change) |
| Regression | Pass |

### CL2-IF-03 — `X-Request-ID` on nginx's own answers — `ca94574`

| | |
|---|---|
| Before | No request id on static files, shell, 404s, 413 served by nginx |
| Code changed | `frontend/nginx.conf`: `add_header X-Request-ID $request_id always` (server, shell, `@too_large`); `/api/` uses a `map` so the application's id passes through and nginx's only when the API did not answer |
| Test added | `frontend/src/security/nginx-config.test.ts` ("sends exactly one X-Request-ID …") |
| After / Retest evidence | 11/11 live (`evidence/closure/wpf/wpf_03_xrequestid_live.out.txt`); `npm run check:nginx-live` OK (`wpf_04`). **Retest 3:** exactly one id on static, SPA, 404, map-404, 413 and API answers; 500-character and CR/LF client ids replaced by a server id (`evidence/closure/retest3/raw/if03_reqid_result.txt`) |
| Regression | Pass (vitest 1257 in 92 files) |

### CL2-IF-04 — QR / Asset 360 deep links on the single-port server — `ca94574`

| | |
|---|---|
| Before | `/assets/1`, `/assets/new`, `/assets/1?from=qr` → `404 application/json` in single-port mode (T046); **same in production `3b5e842`** |
| Risk | Functional: printed labels and Asset 360 links fail on the live server |
| Root cause | The `/assets/{file_path:path}` route (needed for built files) shadows the frontend routes `/assets/$id`, `/assets/new` |
| Code changed | `backend/app/main.py::_serve_frontend_asset`: after `is_safe_relative_name`, a name matching `_ASSETS_APP_ROUTE` (1–3 segments of `[A-Za-z0-9_-]`, no dot) returns `_spa_shell()`; everything else as before |
| Test added | `backend/tests/test_static_frontend_spa_assets.py` (11 functions, 31 cases: `test_an_application_address_under_assets_is_the_spa_shell`, `test_a_scanned_label_with_a_query_string_opens_the_shell`, `test_device_names_that_look_like_routes_are_still_refused_before_the_shell`, `test_the_shell_branch_reads_only_index_html`, `test_every_route_of_the_real_frontend_router_opens_the_shell`, …) |
| After | Labels open Asset 360; refused names still the identical plain 404 |
| Retest evidence | Permanent tests; `ops/windows/verify_release.ps1` checks it after deploy. **Retest 3** (single-port production-mode container of the final image, Linux): app routes → shell with `no-cache`, route-looking canary files never served, ≈ 45 traversal payloads identical 404, 0 leaks, 0 5xx (`evidence/closure/retest3/raw/if04_result.txt`). The native Windows evidence file still has no `/assets/<id>` probe |
| Regression | Pass. Pre-existing and unchanged: `HEAD` on SPA pages answers 405 in single-port mode |

### WP-F observations — `ca94574`

`--no-server-header` in both Dockerfile CMDs and the reference launcher (CL2-IF-OBS-05; test
`test_the_docker_image_starts_uvicorn_without_proxy_headers` now requires it); tmpfs `noexec` `/tmp` and
`/var/tmp` for the dev api container (CL2-IF-OBS-01, effective at the next rebuild); stale Google Fonts comment
fixed (CL2-IF-OBS-04); "NEVER RUN AGAINST PRODUCTION" warning in `backend/scripts/seed_uat_personas.py`
(CL2-IF-OBS-06).

### CL2-SE-N01 — duplicate Category / Sub-category names under parallel creates — `fafa225`

| | |
|---|---|
| Before | 20 parallel creates of one category name → 3 active categories |
| Root cause | No name guard on Category / Sub-category (vendors and brands had one) |
| Code changed | `backend/app/masters/router.py`: `_active_name_exists` / `_refuse_duplicate_name` with `scope` and `exclude_id`; create, edit (rename / work-area move), sub-category create / rename; `MasterPolicy.unique_name_scope` for the Excel import; advisory lock per work area + name; 403 still first |
| Test added | `backend/tests/masters/test_wpf2_category_names.py` (11, incl. `test_twenty_parallel_category_adds_of_one_name_make_one_category`, `test_twenty_parallel_sub_category_adds_of_one_name_make_one`, `test_existing_twins_are_left_alone_and_can_still_be_saved`) |
| After | "A category with this name already exists." (422); existing twins untouched |
| Retest evidence | Permanent tests. **Retest 3:** 20 parallel creates (two personas) 201 × 1 / 422 × 19; sub-categories likewise; other work area allowed; out-of-area 403; rename and Excel-import duplicates refused (`evidence/closure/retest3/raw/cl3_masters_race.txt`, `cl3_masters_verify_sql.txt`, `cl3_import_commit.txt`) |
| Regression | Pass (2541 passed, 1 skipped) |

### CL2-SE-N03 — friendly message for the loser of a same-serial race — `fafa225`

| | |
|---|---|
| Before | 201 × 1, **409 × 13** "This record already exists.", 422 × 6 |
| Root cause | `backend/app/core/errors.py::integrity_message` could not parse the expression index `ux_asset_serial_number_ci` |
| Code changed | `CONSTRAINT_REFUSALS` map (consulted first): that index → 422 "This serial number is already used by another asset. Check the serial number and try again." |
| Test added | `backend/tests/core/test_wpf2_serial_race_message.py` (9, incl. three 20-way bursts and `test_the_reserved_no_serial_values_still_repeat_freely`) |
| After | 1 success, 19 × 422, no 409, no 500 |
| Retest evidence | Permanent tests. **Retest 3:** 20 parallel adds 201 × 1 / 422 × 19, no 409 / 5xx; case/space variants one asset (`evidence/closure/retest3/raw/cl3_serial_race.txt`, `cl3_serial_verify_sql.txt`) |
| Regression | Pass |

## P2.2 User-visible behaviour changes (closure stage)

| Change | What the user (or operator) sees | Who | Finding |
|---|---|---|---|
| QR labels and Asset 360 links work on the single-port server | Scanning a label opens the asset page instead of a JSON error | Everyone scanning labels; store and office staff | CL2-IF-04 |
| Refresh-token reuse | Normally nothing; if a copied, already-used session cookie comes back, that person is signed out everywhere: "Your session has ended. Please sign in again." Several tabs renewing together keep working | All users (rare) | AU-06 |
| Duplicate category / sub-category names refused | "A category with this name already exists." (also in the Excel import, per row) | Admins maintaining categories | CL2-SE-N01 |
| Duplicate brand / vendor names refused in the Excel import | Row error in the preview and commit; other rows still import | Head-office admin | RACE-1 residual |
| Same-serial race message | "This serial number is already used by another asset…" (422) instead of "This record already exists." (409) | Receiving / asset entry | CL2-SE-N03 |
| More password refusals | Look-alike spellings of one's own name and simple runs plus a short number are refused | Anyone changing a password | AU-08 |
| Unknown `/api` address | JSON 404 "This API address does not exist…" | Integrations, monitors | N6 |
| Fonts | Served by CKAM itself; looks identical | Everyone (no outside request) | FONTS |
| Server start | Without `ENVIRONMENT_NAME` the server counts as production and refuses a weak JWT secret; longer refusal text naming all rules; invalid `PO_SOURCE_SSLMODE` stops the start | IT / operator | CL1-N4-01, IF-16 |
| Dev/UAT | Containers run as non-root; each browser user has their own sign-in limit; request id on every answer | Developers, UAT testers | IF-13, N3, CL2-IF-03 |

Part 1's changes (sessions end on access changes, sign-out everywhere, 429 after bursts, 413 for oversized
requests, renamed uploads refused, staff-only setup lists, other company's ERP drafts 404) still apply (§4).

## P2.3 Migrations of the whole programme (4)

| Order | Revision | What it does | Notes |
|---|---|---|---|
| 1 | `f9a1c3e5b7d2` | `asset_user.token_version` | Additive; existing sessions stay valid |
| 2 | `a3c5e7f9b1d4` | TRUNCATE guards on the four append-only tables; 5-year audit purge floor | Must run as the table owner |
| 3 | `b5d7f9a1c3e5` | `auth_session` table (refresh-token reuse detection) | Additive; login writes to it, so the new code needs it |
| 4 | `c6e8a0b2d4f6` | Trigger guarding `asset.status` / `current_asset_user_id` / `status_since` | Touches no row; **old code cannot record movements once it exists** (moves, repairs, sales, scraps are refused with a misleading 422; receives still work: *updated 2026-10-17, security release, gate rehearsal GT-F01*), so start the new code right after the upgrade |

Single head `c6e8a0b2d4f6`. Verified: fresh empty database → head; dev, UAT and security-test databases upgraded;
downgrade −1 / upgrade cycles (`evidence/closure/backend/WPA2_RESULTS.md`, `evidence/closure/db/rs_06_downgrade_upgrade_cycle.out.txt`).

## P2.4 Production deploy order (PREPARED, NOT EXECUTED; needs the owner's explicit deploy request)

Full procedure: `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`.

1. **Precheck:** `ENVIRONMENT_NAME=production`; `JWT_SECRET` ≥ 32 characters and ≥ 8 different characters, not a
   placeholder (otherwise the app refuses to start); backup working; window agreed.
2. **Approved git push** (separate approval; push only — "commit and push to git and main").
3. **Backup** of `ckassetmanagement`.
4. **`alembic upgrade head`** (the four revisions above) **before** starting the new code.
5. Deploy the release folder; switch `FRONTEND_DIST_DIR`; install with `-c constraints.txt` (EXT-12).
6. Start uvicorn with **`--no-proxy-headers --no-server-header`** (EXT-38 / EXT-13).
7. **Verify:** IF-01 closed including `..%5c`, `%2e%2e%5c`, `C:%2fWindows%2fwin.ini`, `%5c%5cserver%5cshare`;
   unknown `/api` JSON 404; `/docs` closed; headers once; `/assets/<id>` opens (QR); sign-in; receive/move smoke
   (`ops/windows/verify_release.ps1`).
8. **Rotate** the JWT secret (everyone signs in again) → `ckassetapp` DB password → NAS password → ERP password →
   restart and verify. Never rotate before the fixed release is running.
9. **Compromise assessment** (logs for `/assets/` requests with `..`, `%2e`, `%5c`) (EXT-03, EXT-41).
10. HTTPS plan (EXT-04); later the role split with the **updated** `ops/db/` scripts (EXT-07).

## P2.5 Regression results (final, HEAD `fd34520`)

| Suite | Result |
|---|---|
| Backend pytest (dev api container, `ckam_test`) | **2541 passed, 1 skipped** (programme baseline 1577; Part 1 end 1783). The skip is the environment-only "not run from a repository checkout" launcher scan |
| Frontend `npx tsc -b` | Clean |
| Frontend `npx vitest run` | **1257 passed in 92 files** (baseline 1223 / 89) |
| `npm run build` / `npm run check:build` | OK (0 `.map` files, no `sourceMappingURL`, no Google host, no external resource) |
| Playwright permanent journeys (UAT stack, sign-in limit off for that stack only) | 11 passed, 1 skipped (ERP-unmatched-vendor journey skips itself: ERP link off on the test stack). The asset-lifecycle journey had an intermittent timing race in the test; stabilised with a bounded wait (`fd34520`), then passed in the full run |
| Security Playwright journeys (`frontend/e2e/security.spec.ts`) | **14/14** |
| Performance (old `4ba4e94` vs new, identical data) | 31 operations, none over threshold; refused sign-in +33 ms (by design); bulk Move of 50 +23…34 ms (`evidence/closure/perf/PERF_REPORT.md`) |

New permanent test files since `4ba4e94` (counted with `git diff --diff-filter=A`): 27 backend test modules (plus
2 helpers), 4 frontend test files (`auth-session.test.ts`, `nginx-config.test.ts`, `check-build-security.test.mjs`,
`e2e/security.spec.ts`). Backend test cases grew by 964 (1577 → 2541), most of them parametrised.

## P2.6 Existing tests changed in the closure stage (and why)

| File | Change | Why | Weakened? |
|---|---|---|---|
| `backend/tests/auth/test_vapt_sessions.py::test_every_refresh_hands_out_a_new_unique_token` | Second renewal uses the cookie the first returned | AU-06: the same cookie twice is now duplicate or reuse | No (intended) |
| `backend/tests/core/test_s3a1_master_audit_migration.py`, `observability/test_admin_api.py`, `observability/test_system_events.py` | Head literal → `b5d7f9a1c3e5` → `c6e8a0b2d4f6` (+ chain asserts) | New migrations | No |
| `backend/tests/reports/test_dashboard.py` | Calls `allow_lifecycle_fixture_write` before backdating `status_since` | OBS-STATUS: the database now refuses direct writes | No (fixture only) |
| `backend/tests/lifecycle/test_s4_batch_events.py` | Statement limit ≤ 6 → ≤ 7 | +2 marker statements per batch, never per asset | No (assertion of constant cost kept) |
| `backend/tests/observability/test_error_logging.py` | Uses `writer.reset_failure_reports()` | `_reported` set replaced by counters | No |
| `backend/tests/security/test_least_privilege_role_split.py` | Row counts 11 → 12, ≥ 30 → ≥ 33; new cases | New checks | No (stricter) |
| `backend/tests/core/test_n2_forwarded_for.py` | Dockerfile test requires both CMDs and `--no-server-header` | OBS-05 | No (stricter) |
| `backend/tests/core/test_production_secret_guard.py`, `backend/tests/auth/test_vapt_password_policy.py` | Extended only | Revalidation | No |
| `backend/tests/test_vapt_headers_and_docs.py` | CSP string without Google hosts | FONTS | No |
| `frontend/e2e/asset-lifecycle.spec.ts` | Bounded wait for an in-flight session renewal before clearing cookies | Test timing race, not product behaviour | No |

## P2.7 What was not changed, and why (closure stage)

| Item | Why not | Where it goes |
|---|---|---|
| Production deploy, secret rotation, compromise assessment (IF-01, CL2-IF-04 in production) | Needs the owner's explicit deploy request; secrets typed by the owner on the servers | EXT-01/02/03/38/39/41/42, SD-01 |
| HTTPS, `Secure` cookie (IF-02, AU-13) | Server certificate and proxy; owner deferred HTTPS on 2026-10-08 | EXT-04/05, SD-04/05 |
| Production database role split (IF-05/06, CL2-IF-01/02 in production) | DBA work on a shared server in a window | EXT-07, SD-11 (use `ops/db/`, not §7) |
| Service account, backups, dev-PC ACLs (IF-07/08/09) | Server / infrastructure / local administrator | EXT-06/08/10; plans written; **nothing changed on the dev PC** |
| ERP TLS mandatory (IF-16) | ERP owner must confirm TLS support first; default kept | EXT-25 |
| Live launcher flags (N2, `server` banner) | Launcher not in git | EXT-38 / EXT-13 |
| Lock-out model (AU-04) | Owner decision; no code change | SD-06 |
| Full Admin company scope (D6), MFA, store logins, per-office sign-in limit, audit retention, session absolute lifetime | Owner decisions | SD-02, SD-03, SD-07, SD-08, SD-09, SD-14 |
| PyJWT instead of python-jose (IF-12) | Not reachable today; larger auth change | Next auth rework |
| OBS-STATUS strong form (column privileges + definer function) | Changes the core ledger path; every future column would need a grant | Revisit after the role split is live (`WPB_RESULTS.md` §6) |
| Bulk-move marker optimisation | Within threshold (+23…34 ms per 50 assets locally; ≈ +50 ms at 0.5 ms LAN RTT) | Optional |
| Diagnostics screen showing the audit-failure count | `failure_counts()` exists; `system_event` rows visible in Logs | Backlog |
| AU-06 legacy-token path | Needed for tokens issued before the deploy (8 h) | Remove in the release after the deploy |
| Dev/UAT database role still superuser (OBS-DOCKER-SU) | `conftest.py` clean-up needs it; switching needs the owner | Owner decision |
| N9, OBS-CSP-STYLE, OBS-HEAD405, CL2-IF-OBS-02, polyglot | Low value or no exploit path | Deferred / accepted |
| Cross-company allotment (owner decision 2026-10-13) | Product feature, not security | Not built |
