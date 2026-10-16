# Change Record (CKAM) — blank form

> DRAFT — MANAGEMENT APPROVAL REQUIRED (form for doc 04). One record per production change. Never write a password
> or secret here (write "checked: length ≥ 32, ≥ 8 distinct", never the value).

## A. Request

| | |
|---|---|
| Change id | CHG-YYYY-NNN |
| Request / ticket reference | |
| Requested by, date | |
| Reason (plain words) | |
| Type | Standard / Security-relevant / Emergency / Configuration only |
| Risk | Low / Medium / High |
| Findings or decisions closed (e.g. IF-01, SD-06) | |

## B. Development and test evidence (DEV, 10.0.0.47)

| | |
|---|---|
| Commit range (first..last sha) | |
| New Alembic migrations (ids) | |
| Backend tests (`pytest` on `ckam_test`): passed / failed / skipped | |
| Frontend (`tsc -b`, `vitest run`): result, count | |
| Browser / E2E checks (which, result) | |
| Dependency audit (`npm audit --omit=dev`, `pip-audit`) if packages changed | |
| Security baseline checklist done? (security-relevant changes) | |
| Second reviewer (name) or self-review note | |

## C. Approvals

| Approval | By | Date / time | How (words used, channel) |
|---|---|---|---|
| Push to `origin` | | | |
| Deploy to production (separate) | | | |

## D. Pre-deploy checks (EXT-39 / EXT-38)

| Check | Result |
|---|---|
| `ENVIRONMENT_NAME=production` in `shared\.env` | |
| `JWT_SECRET` strength checked without printing it | |
| Install uses `backend/constraints.txt`; `pip freeze` saved in `releases\<sha>\` | |
| uvicorn started with `--no-proxy-headers` | |
| Migrations to run listed | |

## E. Deployment

| Step | Result | Time | By |
|---|---|---|---|
| Backup run; `backup.log` OK; dump file name | | | |
| `shared\.env` copied to `.env.pre-<sha>` | | | |
| `CKAM-Web` stopped | | | |
| Release `releases\<sha>\` installed; `FRONTEND_DIST_DIR` set | | | |
| `alembic upgrade head` (before start); `alembic current` output | | | |
| `CKAM-Web` started; `system_event` `app_started` version / environment | | | |

## F. Smoke checks

| Check | Result |
|---|---|
| `/api/health` ok | |
| New routes present (or checked directly) | |
| Served `index.html` names the new bundle | |
| `X-Request-ID` on responses | |
| Launcher log `serving release <sha>` | |
| NAS mapping succeeded | |
| ERP `sync_success` after start | |
| Change-specific checks (e.g. EXT-01 probes return 404) | |

## G. Rollback plan and result

| | |
|---|---|
| Rollback plan (code only / code + database restore from dump …) | |
| Result | Deployed OK / Rolled back (why) |
| Downtime (minutes) | |
| Issues found after deploy | |
| Record completed by, date | |
