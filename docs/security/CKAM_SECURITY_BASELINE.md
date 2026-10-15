# CKAM Security Baseline

**Status:** FINAL DRAFT 2026-10-15, for owner approval. `docs/ai/DEVELOPMENT_GUARDRAILS.md` already carries
the key rules in short form and points here (commit `da790d1`). Once approved this is the **minimum** for
every CKAM change (code, database, configuration, deployment); where documents conflict, the stricter rule
wins. The controls named below exist in code at HEAD `d04779a` (retested, not yet deployed); keep them.

**How to use it:** copy the checklist of each section that your change touches into the stage report or change
record and tick each line. A line that cannot be met needs a written reason and the owner's approval.
Every rule below is checkable by a reviewer.

---

## 1. Authentication

- [ ] Passwords are hashed only with Argon2id (`core/security.py::hash_password`). Never stored, logged, returned or e-mailed in plain text.
- [ ] Temporary passwords are shown **once** in the API answer and force a change at first sign-in (`must_change_password`).
- [ ] JWT verification pins the algorithm (`algorithms=["HS256"]`); no new token type without a `type` claim check.
- [ ] Production refuses to start with a placeholder or weak `JWT_SECRET` (< 32 characters or < 8 distinct), and any `ENVIRONMENT_NAME` outside `development, dev, test, testing, uat, security-test, local, ci` counts as production (IF-04, N4). Never weaken or widen this list.
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
- [ ] Re-run the access matrix (`docs/security/evidence/access/matrix.mjs` method) before each major release.

## 3. Input validation

- [ ] Every request body is a Pydantic schema with types, lengths and ranges; unknown values for closed lists are refused.
- [ ] Errors are a controlled 4xx with a plain sentence and `request_id`; no stack traces, SQL or file paths in responses.
- [ ] Sorting and filtering by column only through a whitelist; `LIKE` / `ILIKE` input escaped (`escape_like`).
- [ ] Quantities and batch sizes have upper limits (e.g. 1 to 1,000 units).
- [ ] Request-size limits (`app/core/body_limit.py`: 64 KB sign-in, 5 MB JSON, 16 MB uploads, 413) stay on; a route that needs more needs a reason and a test.
- [ ] Creation of records with a unique name is safe under concurrency (database constraint or serialization; RACE-1 pattern) and has a concurrency test.
- [ ] Response headers keep the Content-Security-Policy and Permissions-Policy (`main.py` and, in dev, `frontend/nginx.conf`, kept identical); no source maps in builds; `/docs` stays off in production.
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
- [ ] **Every new table gets an audit classification** in the same change: added to `SPECS` in `app/observability/audit.py`, or explicitly listed as not audited with the reason (`docs/ai/LOGGING_AND_DIAGNOSTICS.md` section 6).
- [ ] Every new write route is classified in `backend/tests/observability/test_coverage_walker.py` (`AUDITED` or `ALLOW_LIST` with reason).
- [ ] No hard deletes of business records; deactivate (`is_active=false`).
- [ ] `lifecycle/service.py` (`apply_event` / `apply_events`) remains the only writer of `asset.status`, `current_asset_user_id`, `status_since`.
- [ ] Append-only tables (`audit_log`, `asset_event`, `asset_field_change`, `master_audit`) are never updated, deleted or truncated; migrations must not drop or disable their triggers; a new append-only table gets UPDATE, DELETE and TRUNCATE guards (pattern: migration `a3c5e7f9b1d4`). The audit purge floor (5 years) is not lowered without an owner decision.
- [ ] New tables are company-scoped where the data belongs to a company (`company_id` + scoping in every query).
- [ ] Grants for new tables follow the runtime-role design (EXT-07) once in place: runtime role gets only what it needs; append-only tables get INSERT/SELECT only.
- [ ] Tests run only against `ckam_test`; never bypass the `conftest.py` guard.

## 6. Files (uploads and file serving)

Any new upload route or any route that serves a file needs a **file-security review** recorded in the change:

- [ ] **Containment:** the served path is resolved and checked to stay inside its base folder (`resolve()` + `is_relative_to`); stored names are server-generated, never user-supplied (IF-01 lesson).
- [ ] **Type checks:** extension allowlist on the real suffix **and** file-signature (content) check, with a server-chosen media type (IN-03 pattern).
- [ ] **Size cap** enforced while reading (bounded, streamed), before parsing, with 413 on excess (IN-02 lesson).
- [ ] **Authorization:** the file's owning record is loaded through the scoped getter (company, work area).
- [ ] **Download:** `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- [ ] A regression test proves traversal attempts (`..`, `%2e%2e`, `%2f`, absolute paths, backslashes) are refused.

## 7. Audit

- [ ] Data changes are audited automatically (ORM) or explicitly (bulk actions: `audit.suppress` + one `audit.record` row).
- [ ] Security, access and export events use the writer's own short session so they survive a failed request.
- [ ] Every audit row has actor, company, IP, request id, a plain-sentence summary and old/new values for updates.
- [ ] A new privileged action (grant, reset, rule change, purge) writes a SECURITY row.
- [ ] Seeing a `WRITE` safety-net row in the trail after a release is a defect to fix.

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
- [ ] Keep the permanent security tests green: `backend/tests/**/test_vapt_*.py`, `test_rate_limit.py`, `test_body_limit.py`, `test_security_concurrency.py`, `test_production_secret_guard.py`, `test_static_frontend.py`, and `frontend/e2e/security.spec.ts`.
- [ ] Before a major release: re-run the VAPT battery under `docs/security/evidence/` and record the result (method: `docs/security/CKAM_VAPT_REPORT.md`).

## 11. Deployment

- [ ] Commit locally; push only when the owner says so; deploy only on a separate, explicit owner request.
- [ ] A change record exists (request id, approver, test evidence, rollback plan; `CKAM_SOC2_READINESS.md` section 8).
- [ ] **Backup first:** run `CK_Backup_CKASSETMANAGEMENT` and confirm `backup.log` says OK; note the dump name.
- [ ] **Pre-deploy checks** (EXT-39): `ENVIRONMENT_NAME=production` set; `JWT_SECRET` ≥ 32 characters with ≥ 8 distinct (checked without printing it), otherwise the app refuses to start.
- [ ] Deploy the **exact release** (`releases\<sha>\`), installed with `backend/constraints.txt` (EXT-12) and a `VERSION` file.
- [ ] Run `alembic upgrade head` **before** starting the new code; save the output.
- [ ] Start uvicorn with `--no-proxy-headers` (EXT-38); if a reverse proxy is added, use `TRUSTED_PROXIES` instead.
- [ ] Restart `CKAM-Web`; **smoke:** `/api/health`, `diagnostics/health` (migrations match), new routes in `/openapi.json` (until it is closed in production, then by an authenticated check), served bundle is the new one, launcher log "serving release", NAS mapping OK, `system_event` `app_started` with the new version, ERP `sync_success`.
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
