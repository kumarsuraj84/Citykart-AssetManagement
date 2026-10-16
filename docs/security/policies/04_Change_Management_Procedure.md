# 04 — CKAM Change Management Procedure

| | |
|---|---|
| Document | CKAM-ISMS-04, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Describes the flow already followed in practice; the change record is new and not yet used |
| Owner (proposed) | Dev Lead (procedure and records); CKAM System Owner (approvals) |
| Approver | Management |
| Review | Yearly, and after any failed or emergency deploy |
| Maps to | ISO A.5.8, A.8.9, A.8.19, A.8.25-8.29, A.8.31-8.33; SOC 2 CC8.1, CC3.4, CC7.1; EXT-12, EXT-13, EXT-28, EXT-35, EXT-39 |

## 1. Purpose

Every change that reaches production is requested, tested, approved twice (push, then deploy), backed up, deployed
as an exact release, verified and recorded, so that a reviewer can trace it from request to result.

## 2. Scope

Application code, database migrations, frontend build, configuration in `shared\.env`, the launcher and release
script, scheduled tasks, firewall/router rules and certificates for CKAM. Not other apps on the shared servers.

## 3. The flow (as followed for release `3b5e842` on 2026-10-14)

| # | Step | Who | Rule | Evidence |
|---|---|---|---|---|
| 1 | **Request** | CKAM System Owner (or a user via the owner) | One change id per request (e.g. `CHG-2026-001`) | Change record opened (`templates/change_record.md`) |
| 2 | **Develop on DEV** (10.0.0.47) | Dev Lead (AI-assisted) | Never on production; follow `docs/ai/DEVELOPMENT_GUARDRAILS.md`; schema changes only by an Alembic migration, never `create_all` | Commits on a branch |
| 3 | **Test on DEV** | Dev Lead | Backend `pytest` against `ckam_test` only (never the plain `ckam` database); frontend `npx tsc -b && npx vitest run`; browser checks after rebuilding the container; `npm audit` / `pip-audit` when a dependency changes | Test counts and result pasted or attached to the record |
| 4 | **Commit** | Dev Lead | Conventional Commits, small logical commits, a short why-comment with the finding id for security fixes | Commit ids in the record |
| 5 | **Owner approves push** | CKAM System Owner | The words "commit and push to git and main" (or equivalent) mean push only, **not** deploy | Approver + date/time in the record |
| 6 | **Push** to `origin` | Dev Lead | Default branch `claude/brave-euler-07879a` | Remote commit id |
| 7 | **Separate owner approval for production** | CKAM System Owner | A new, explicit request to deploy, naming the release | Approver + date/time in the record |
| 8 | **Pre-deploy checks** | IT + Dev Lead | `ENVIRONMENT_NAME=production`; `JWT_SECRET` strength checked without printing it; new migrations listed; install with `backend/constraints.txt`; uvicorn started with `--no-proxy-headers` (EXT-39, EXT-38) | Ticked checklist |
| 9 | **Backup** | IT | Run `CK_Backup_CKASSETMANAGEMENT` on 10.0.0.205; `backup.log` says OK | Dump file name in the record |
| 10 | **Deploy the exact release** | IT (the owner types passwords) | Package `releases\<sha>\`; stop `CKAM-Web`; `pip install -c constraints.txt -e`; set `FRONTEND_DIST_DIR` to the new release | Release sha |
| 11 | **Migrate** | IT | `alembic upgrade head` **before** starting the new code | `alembic current` output |
| 12 | **Restart** | IT | Start `CKAM-Web` | `system_event` `app_started` with version and `production` |
| 13 | **Smoke** | IT + Dev Lead | `/api/health` ok; `/openapi.json` lists the new routes (or 404 in production after the security release, then check a new route directly); served `index.html` names the new bundle; `X-Request-ID` present; launcher log `serving release <sha>`; NAS mapping succeeded; ERP `sync_success`; for the security release also the EXT-01 probes | Smoke results in the record |
| 14 | **Result / rollback** | IT | Rollback = previous release folder + restart; a database restore only from a verified dump and only if the schema changed | "Deployed OK" or "Rolled back" with reason |

**Never** deploy to, start or re-enable anything on the retired server 10.0.1.12.

## 4. Change types

| Type | Example | Extra rule |
|---|---|---|
| Standard | A normal release | Full flow |
| Security-relevant | Sign-in, sessions, permissions, uploads, secrets, migrations touching audit tables | Security baseline checklist (`CKAM_SECURITY_BASELINE.md`) done; second reviewer once available |
| **Emergency** | IF-01 fix | Owner may approve by message; steps 8-14 still mandatory; record completed within one working day and reviewed at the next management review (doc 14) |
| Configuration only | `shared\.env` value, `LOG_RETENTION_DAYS` | Steps 1, 7, 9 (copy `.env` to `.env.pre-<change>`), 12, 13, 14 |

## 5. Segregation of duties (known gap)

One developer writes and tests, and the same owner approves. Until a second reviewer exists: (a) the push and the
deploy approvals stay separate; (b) every security-relevant change has a written self-review against the baseline;
(c) CI on a company-owned repository (EXT-28) adds an independent test run; (d) the internal audit (doc 13) samples
two releases a year.

## 6. Evidence this procedure would produce

One change record per production change, plus git history, CI runs (after EXT-28), `backup.log`, `system_event`
`app_started`, launcher log, `alembic current` output.

## 7. What this does NOT yet prove

* No change record has ever been completed; approvals so far exist only in chat sessions.
* The launcher and release script are not in git (IF-15) and the runbook `docs/ai/CKAM_RELEASE_RUNBOOK.md` still
  describes Docker.
* There is no CI and no independent reviewer; production installs did not yet use `constraints.txt`.
