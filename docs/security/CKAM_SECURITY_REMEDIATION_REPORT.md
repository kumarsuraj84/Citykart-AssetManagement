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
