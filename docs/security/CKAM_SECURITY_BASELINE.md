# CKAM Security Baseline

**Status:** DRAFT for owner approval — first version 2026-10-15, **updated 2026-10-16 with the rules learned in
the security closure stage** (marked *(closure)*; summary in section 14). `docs/ai/DEVELOPMENT_GUARDRAILS.md`
carries the key rules in short form and points here (commit `da790d1`). Once approved this is the **minimum**
for every CKAM change (code, database, configuration, deployment); where documents conflict, the stricter rule
wins. The controls named below exist in code at local HEAD `fd34520` (retested, **not pushed, not deployed**);
keep them.

**How to use it:** copy the checklist of each section that your change touches into the stage report or change
record and tick each line. A line that cannot be met needs a written reason and the owner's approval.
Every rule below is checkable by a reviewer.

---

## 1. Authentication

- [ ] Passwords are hashed only with Argon2id (`core/security.py::hash_password`). Never stored, logged, returned or e-mailed in plain text.
- [ ] Temporary passwords are shown **once** in the API answer and force a change at first sign-in (`must_change_password`).
- [ ] JWT verification pins the algorithm (`algorithms=["HS256"]`); no new token type without a `type` claim check.
- [ ] Production refuses to start with a placeholder or weak `JWT_SECRET` (< 32 characters or < 8 distinct), and any `ENVIRONMENT_NAME` outside `development, dev, test, testing, uat, security-test, local, ci` counts as production (IF-04, N4). Never weaken or widen this list.
- [ ] *(closure)* **`ENVIRONMENT_NAME` must be set explicitly** in every environment's settings (`production` on 10.0.1.98). An unset value now counts as production and fails closed (CL1-N4-01); never rely on a default, and never add code that treats "unset" as development.
- [ ] *(closure)* **No raw tokens or token ids are stored.** Refresh sessions keep only a SHA-256 hash of the token id (`auth_session`, AU-06); the same applies to any future token, reset link or API key. A reused refresh token ends every session of that person and writes `REFRESH_REUSE`; keep the grace window (`REFRESH_REUSE_GRACE_SECONDS`, 10 s) small and never remove the reuse check.
- [ ] *(closure)* **Security counters change atomically in the database** (`UPDATE … SET x = x + 1 RETURNING`, row lock or advisory lock), never read-modify-write in Python (OBS-TV, AU-16 lesson). This covers `token_version`, lock-out counters and any future rate or attempt counter.
- [ ] Sign-in takes the same time whether or not the account exists (AU-01); failures return one generic message. A locked account answers 423 for any password (AU-02, accepted by design); do not add other distinguishing answers.
- [ ] Lockout and the sign-in rate limit (`app/core/rate_limit.py`, 429 with `Retry-After`) stay on; never add a sign-in path that bypasses them.
- [ ] Anything that signs people in or keeps them signed in goes through `token_version`: sign-out, deactivation, switching off a login and changes of role, work area, company access or password end that person's sessions (AU-05, AU-07); add a test when touching sessions.
- [ ] New or changed passwords pass `app/auth/password_policy.py` (AU-08); never accept a password the policy refuses.
- [ ] Any new sign-in method (SSO, MFA, API key) needs a design note and owner approval.

## 2. Authorization (backend authoritative)

- [ ] Every route checks role **and** scope on the server: company, work area (IT / Non-IT) and, for Own Assets Only, own custody. Hiding a button is not a control.
- [ ] Decisions come from `backend/app/core/capabilities.py` (create/manage rules) and `backend/app/core/deps.py` (role guards); no ad-hoc role strings in routers.
- [ ] **Every new or changed write route has an authorization test** that proves: allowed role succeeds; each lower role gets 403; another company's record gets 403/404; another work area's record gets 403/404; Own Assets Only gets 403.
- [ ] **Every new read route** has a cross-company test and, where records have a work area, a cross-work-area test.
- [ ] Setup lists and other company-wide reads are staff-only (`READ_ROLES`), never just "any signed-in user" (AC-1 lesson).
- [ ] Head-office-admin-only actions stay head-office-admin-only (`docs/ai/DECISIONS.md` 2026-10-14 (3), (8)); widening any permission needs a new decision entry.
- [ ] Request bodies never carry fields that decide authorization (company of the actor, role, work area, `asset_domain`); the server derives them.
- [ ] Re-run the access matrix (`docs/security/evidence/access/matrix.mjs` method; final-code version in `docs/security/evidence/closure/retest2/access/`) before each major release.
- [ ] *(closure)* **Every new route — read or write — ships with an authorization test that includes a cross-company case and, where the record has a work area, a cross-work-area case**, plus a lower-role 403 case. No route is merged without it; this is what kept 3,038 access cells at 0 escalations.

## 3. Input validation

- [ ] Every request body is a Pydantic schema with types, lengths and ranges; unknown values for closed lists are refused.
- [ ] Errors are a controlled 4xx with a plain sentence and `request_id`; no stack traces, SQL or file paths in responses.
- [ ] Sorting and filtering by column only through a whitelist; `LIKE` / `ILIKE` input escaped (`escape_like`).
- [ ] Quantities and batch sizes have upper limits (e.g. 1 to 1,000 units).
- [ ] Request-size limits (`app/core/body_limit.py`: 64 KB sign-in, 5 MB JSON, 16 MB uploads, 413) stay on; a route that needs more needs a reason and a test.
- [ ] Creation of records with a unique name is safe under concurrency (database constraint or serialization; RACE-1 pattern) and has a concurrency test.
- [ ] *(closure)* **Any new master with a unique-name rule** (like vendor, brand, category / sub-category per work area) takes a transaction-scoped **advisory lock on the normalised name and then checks** for an active duplicate before inserting — on the single-create path **and** in every Excel import path (RACE-1, CL2-SE-N01). The loser of a race gets a friendly 422, never a 500 (CL2-SE-N03). Add a parallel-request test.
- [ ] Response headers keep the Content-Security-Policy and Permissions-Policy (`main.py` and, in dev, `frontend/nginx.conf`, kept identical); no source maps in builds; `/docs` stays off in production.
- [ ] *(closure)* **Security headers are sent exactly once** (N5): when nginx fronts the API, decide per header who sets it and test it (`frontend/src/security/nginx-config.test.ts`, `frontend/scripts/check-nginx-live.mjs`); duplicated or conflicting headers are a defect.
- [ ] *(closure)* **Fonts, scripts, styles and images are self-hosted**; the CSP stays `'self'` with no third-party host. `npm run check:build` must pass (0 `.map` files, no `sourceMappingURL`, no Google or other external host) before any release.
- [ ] *(closure)* Unknown `/api/...` paths and switched-off documentation paths answer a JSON 404; the single-port SPA fallback serves the app page for app routes (e.g. `/assets/<id>`, `/assets/new`, CL2-IF-04) **without a filesystem lookup for unknown paths**. Add a deep-link test for every new client route that can be opened from outside (QR, e-mail link).
- [ ] Every export cell passes the formula-injection sanitizer (`_sanitize_row` / `_csv_value`).
- [ ] Redirect targets go through `safeNextPath()`; no new open redirect.
- [ ] No `eval`, `exec`, `pickle`, `yaml.load`, shell calls or `dangerouslySetInnerHTML` with data.
- [ ] No outbound HTTP to a URL supplied by a user (SSRF).

## 4. Secrets

- [ ] No secret in the repository, in tests, in docs, in commit messages or in chat. `.env` stays gitignored; `.env.example` holds placeholders only.
- [ ] New secrets are read from settings (`backend/app/core/config.py`) and registered with the redactor (`app/observability/redact.py`).
- [ ] Production secrets are typed by the owner on the server and kept in the password manager (EXT-23); never the same value as dev.
- [ ] A suspected exposure means rotation (EXT-02 procedure), not just a code fix.
- [ ] Secret files on servers are readable only by Administrators and the CKAM service account.

## 5. Database

- [ ] **No schema change without an Alembic migration.** Never `create_all` at runtime. Write the downgrade where practical.
- [ ] **Parameterised queries only.** ORM or `text()` with bound parameters; **no raw SQL built with string formatting or concatenation of values**; dynamic identifiers only from code constants.
- [ ] **Every new table gets an audit classification** in the same change: added to `SPECS` in `app/observability/audit.py`, or explicitly listed as not audited with the reason (`docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 6). *(closure)* **If the new table is append-only, the same migration adds UPDATE, DELETE and TRUNCATE guards** (pattern `a3c5e7f9b1d4`) and the runtime role gets INSERT/SELECT only on it.
- [ ] Every new write route is classified in `backend/tests/observability/test_coverage_walker.py` (`AUDITED` or `ALLOW_LIST` with reason).
- [ ] No hard deletes of business records; deactivate (`is_active=false`).
- [ ] `lifecycle/service.py` (`apply_event` / `apply_events`) remains the only writer of `asset.status`, `current_asset_user_id`, `status_since`. *(closure)* A database trigger (`c6e8a0b2d4f6`) refuses any change to these fields unless the transaction carries the marker `ckam.lifecycle_writer`, which **only `apply_events` sets**. Never set the marker anywhere else (not in scripts, migrations, imports or tests outside `backend/tests/lifecycle/fixture_marker.py`); a data repair goes through `apply_events` or a reviewed migration. Honest limit: anyone who can run SQL as the app role can set the marker, so the role split is the strong barrier.
- [ ] Append-only tables (`audit_log`, `asset_event`, `asset_field_change`, `master_audit`) are never updated, deleted or truncated; migrations must not drop or disable their triggers; a new append-only table gets UPDATE, DELETE and TRUNCATE guards (pattern: migration `a3c5e7f9b1d4`). The audit purge floor (5 years) is not lowered without an owner decision.
- [ ] New tables are company-scoped where the data belongs to a company (`company_id` + scoping in every query).
- [ ] Grants for new tables follow the runtime-role design (`ops/db/role_split.sql`, EXT-07) once in place: runtime role gets only what it needs; append-only tables get INSERT/SELECT only.
- [ ] *(closure)* **Sequences are USAGE and SELECT only for the runtime role — never UPDATE** (CL2-IF-01: UPDATE allows `setval`, which can break the audit and ledger id sequences). The runtime role owns nothing, has no role-level settings (`RESET ALL`, CL2-IF-02) and cannot TRUNCATE, ALTER, DROP or disable triggers.
- [ ] *(closure)* **Run `ops/db/check_least_privilege.sql` after every deploy** (and after any manual grant) and keep the output with the change record (EXT-46); the pytest `backend/tests/security/test_least_privilege_role_split.py` keeps the scripts honest in development.
- [ ] Tests run only against `ckam_test`; never bypass the `conftest.py` guard.

## 6. Files (uploads and file serving)

Any new upload route or any route that serves a file needs a **file-security review** recorded in the change:

- [ ] *(closure)* **Lexical checks come before any filesystem call.** A requested path is refused on its text alone first — backslash, colon (drive letter or NTFS alternate data stream), UNC prefix, `.` / `..` segments, Windows reserved device names (`CON`, `NUL`, `COM1` …), trailing dot or space, anything outside an allow-list of characters — and only then resolved (IF-01-WIN lesson: on Windows, `resolve()` itself can touch `\\server\share` or `C:\…`). All refusals look identical (plain 404).
- [ ] **Containment:** the served path is resolved and checked to stay inside its base folder (`resolve()` + `is_relative_to`), and symlinks are refused; stored names are server-generated, never user-supplied (IF-01 lesson).
- [ ] **Type checks:** extension allowlist on the real suffix **and** file-signature (content) check, with a server-chosen media type (IN-03 pattern).
- [ ] **Size cap** enforced while reading (bounded, streamed), before parsing, with 413 on excess (IN-02 lesson).
- [ ] **Authorization:** the file's owning record is loaded through the scoped getter (company, work area).
- [ ] **Download:** `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- [ ] A regression test proves traversal attempts (`..`, `%2e%2e`, `%2f`, absolute paths, backslashes, `%5c`, drive letters, UNC, device names) are refused (`backend/tests/test_static_frontend_windows.py` pattern).

## 7. Audit

- [ ] Data changes are audited automatically (ORM) or explicitly (bulk actions: `audit.suppress` + one `audit.record` row).
- [ ] Security, access and export events use the writer's own short session so they survive a failed request.
- [ ] Every audit row has actor, company, IP, request id, a plain-sentence summary and old/new values for updates.
- [ ] A new privileged action (grant, reset, rule change, purge) writes a SECURITY row.
- [ ] Seeing a `WRITE` safety-net row in the trail after a release is a defect to fix.
- [ ] *(closure)* A failure to write an audit or log row must stay visible: keep the writer's report (first occurrence, then at most once a minute with a count, kind `log_write_failed`); never swallow such an error silently.

## 8. Logging

- [ ] No secrets, passwords, tokens, cookies, `Authorization` headers or full request bodies in any log, audit row, error row or diagnostics bundle (keys, types and sizes only).
- [ ] Personal data in logs kept to what is needed (actor id/code/name, IP); never log documents or free-text bodies.
- [ ] Every log line and error carries the `request_id`.
- [ ] New background jobs use a `job-<component>-<id>` request id and write start/success/failure system events.
- [ ] `backend/tests/observability/test_redaction.py` is extended when a new secret or sensitive field appears.

## 9. Dependencies

- [ ] Before adding or upgrading a package: state the need, check maintenance status and licence, and run `npm audit --omit=dev` or `pip-audit` on the result.
- [ ] npm changes go through `package-lock.json`; Python changes update the constraints/lock file (IF-11) in the same commit.
- [ ] No new framework or major library without owner approval (`DEVELOPMENT_GUARDRAILS.md`).
- [ ] Monthly: run the dependency audit and record the result (EXT-12).
- [ ] An advisory is either fixed or written down as not reachable with the compensating control (IF-12 pattern).

## 10. Testing

- [ ] Backend: `docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest -q` passes. Frontend: `npx tsc -b && npx vitest run` passes.
- [ ] **Every security fix has a regression test** that fails before the fix and passes after; its name says what it protects.
- [ ] Authorization tests per section 2 for every new or changed route.
- [ ] Browser checks only after rebuilding the relevant container.
- [ ] Keep the permanent security tests green: `backend/tests/**/test_vapt_*.py`, `test_rate_limit.py`, `test_body_limit.py`, `test_security_concurrency.py`, `test_production_secret_guard.py`, `test_static_frontend.py`, *(closure)* `test_static_frontend_windows.py`, `test_static_frontend_spa_assets.py`, `test_wpa2_*.py`, `test_wpf2_*.py`, `test_obs_status_guard.py`, `test_n2_forwarded_for.py`, `test_erp_tls_settings.py`, `test_log_write_failure_reporting.py`, `tests/security/test_least_privilege_role_split.py`, `frontend/src/security/nginx-config.test.ts`, `npm run check:build`, and `frontend/e2e/security.spec.ts`.
- [ ] Before a major release: re-run the VAPT battery under `docs/security/evidence/` and record the result (method: `docs/security/CKAM_VAPT_REPORT.md`).

## 11. Deployment

- [ ] Commit locally; push only when the owner says so; deploy only on a separate, explicit owner request.
- [ ] A change record exists (request id, approver, test evidence, rollback plan; `CKAM_SOC2_READINESS.md` section 8).
- [ ] **Backup first:** run `CK_Backup_CKASSETMANAGEMENT` and confirm `backup.log` says OK; note the dump name.
- [ ] **Pre-deploy checks** (EXT-39): `ENVIRONMENT_NAME=production` set explicitly; `JWT_SECRET` ≥ 32 characters with ≥ 8 distinct (checked without printing it), otherwise the app refuses to start.
- [ ] *(closure)* **Containers run as non-root** (uid 10001, `runtime` image target without test tooling, capabilities dropped, tmpfs `/tmp`); a Dockerfile or compose change that adds `user: root`, extra capabilities or test tooling to the runtime image needs a written reason (IF-13).
- [ ] Deploy the **exact release** (`releases\<sha>\`), installed with `backend/constraints.txt` (EXT-12) and a `VERSION` file.
- [ ] Run `alembic upgrade head` **before** starting the new code; save the output.
- [ ] Start uvicorn with `--no-proxy-headers --no-server-header` (EXT-38; reference launcher `ops/windows/run_ckam_web.ps1.template`); if a reverse proxy is added, set `TRUSTED_PROXIES` to that proxy's address only instead of re-enabling uvicorn's header handling.
- [ ] *(closure)* After the deploy run `ops/db/check_least_privilege.sql` (EXT-46) and the verification of runbook phase 7 (IF-01 incl. Windows forms, JSON 404, docs closed, headers once, QR deep link).
- [ ] Restart `CKAM-Web`; **smoke:** `/api/health`, `diagnostics/health` (migrations match), new routes by an authenticated check (from the security release on, `/docs`, `/redoc` and `/openapi.json` are a JSON 404 in production, so they can no longer be used; *updated 2026-10-17, security release*), a real sign-in (health alone does not prove the migrations ran, GT-F05), served bundle is the new one, launcher log "serving release", NAS mapping OK, `system_event` `app_started` with the new version, ERP `sync_success`.
- [ ] **Rollback** plan written per release: code only (previous release folder) or code + database restore when the schema changed.
- [ ] Never deploy to, start or re-enable anything on 10.0.1.12 (retired). Touch only CKAM's own folder, task, firewall rule, database, role, backup task and NAS folder on shared servers.

## 12. Incident handling

- [ ] A suspected security problem is reported at once to the owner / ISMS lead, with the request id if there is one.
- [ ] Do not "clean up" evidence: export the relevant audit and log rows first (`GET /api/admin/logs/export`).
- [ ] Contain first (close the port-forward, stop `CKAM-Web` if needed), then fix, then rotate secrets if any may have been read.
- [ ] Record every incident and its review (EXT-20); add the lesson to this baseline.

## 13. Data protection

- [ ] Collect only the personal data the feature needs; no new personal field without a reason in the change record.
- [ ] Company data stays within its company (scoping) and work area where applicable.
- [ ] Exports are role-restricted and audited; no new export without both.
- [ ] Dev and test use synthetic data where possible; real data copies on the dev PC are protected (EXT-10).
- [ ] No production data or secrets are pasted into chat tools, tickets or AI assistants.
- [ ] Backups are encrypted and stored off the database server (EXT-08) once in place.

## 14. Rules learned in the closure stage (2026-10-16) — quick list

Each rule is also placed in its section above (marked *(closure)*). Use this list as the reviewer's checklist.

| # | Rule | Why (finding) | Section |
|---|---|---|---|
| 1 | Lexical path checks (backslash, colon/ADS, UNC, drive, dot segments, device names, trailing dot/space, allow-list) **before any filesystem call**; then resolve + containment + symlink refusal | IF-01-WIN | 6 |
| 2 | No raw tokens or token ids stored — hashes only | AU-06 | 1 |
| 3 | Security counters change atomically in the database | OBS-TV, AU-16 | 1 |
| 4 | Any new unique-name master: advisory lock on the normalised name + duplicate check, on every create and import path; friendly 422 for the loser | RACE-1, CL2-SE-N01, CL2-SE-N03 | 3 |
| 5 | Sequences are USAGE/SELECT only for the runtime role; the runtime role owns nothing and has no role settings (`RESET ALL`) | CL2-IF-01, CL2-IF-02 | 5 |
| 6 | New tables get an audit classification; append-only tables get UPDATE/DELETE/TRUNCATE guards in the same migration | IF-05, IF-06 | 5 |
| 7 | Lifecycle fields change only through `apply_events` (marker); never set the marker elsewhere | OBS-STATUS | 5 |
| 8 | Containers run as non-root, runtime image without test tooling | IF-13 | 11 |
| 9 | Fonts, scripts and styles self-hosted; CSP `'self'`; `npm run check:build` passes | FONTS, AU-12, AU-14 | 3 |
| 10 | Every new route has an authorization test incl. cross-company and cross-work-area cases | AC-1, AC-2, IF-03 | 2 |
| 11 | Run `ops/db/check_least_privilege.sql` after every deploy | CL2-IF-01 | 5, 11 |
| 12 | `ENVIRONMENT_NAME` set explicitly everywhere; unset means production | CL1-N4-01 | 1 |
| 13 | Security headers exactly once (test both the app and nginx) | N5 | 3 |
| 14 | Audit-write failures stay visible; never swallow them | CL2 (audit-failure reporting) | 7 |
| 15 | Every client route that can be opened from outside (QR, link) has a single-port deep-link test | CL2-IF-04 | 3 |
| 16 | uvicorn always with `--no-proxy-headers --no-server-header`; trust a proxy only via `TRUSTED_PROXIES` | N2, N3, banner | 11 |

## Change history

| Date | Change |
|---|---|
| 2026-10-15 | First version (HEAD `d04779a`), for owner approval |
| 2026-10-16 | WP-M2b: closure-stage rules added (section 14 and items marked *(closure)*); still DRAFT, not approved |
