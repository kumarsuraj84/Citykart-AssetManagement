# CKAM Simplification — Stage S8 report (audit trail, logging, diagnostics)

## Backend

| | |
|---|---|
| Starting HEAD | `8231308` (Alembic head `d2e4f6a8b0c2`) |
| Scope | Brief S8 items 1–13: request id + context, four log tables, automatic DATA audit + explicit bulk rows, security / access events, error logging, JSON-lines files, system events, admin Logs / Diagnostics APIs, client reports, retention, PostgreSQL logging, docs, tests |
| Not touched | `frontend/`, git, production / servers, the `ckam-uat` project, the dev `db` container (never restarted: settings applied with `ALTER SYSTEM` + `pg_reload_conf()`) |
| Migration | **one**, additive: `e6f8a0b2c4d6_logging_tables` (down `d2e4f6a8b0c2`) — exactly one head |
| Tests | full suite **1,577 passed, 0 failed** (was 1,387); new `tests/observability/`: **190 tests** in 13 test files |
| Commit | none (the controller commits) |

### 1. What was built (by brief item)

| # | Item | Done |
|---|---|---|
| 1 | Request id & context | `RequestContextMiddleware` (outermost): accepts a well-formed `X-Request-ID` (1–64 of `[A-Za-z0-9._-]`), else a UUID4 hex; `X-Request-ID` on every response (2xx/4xx/5xx, idempotent replays, files, SPA); a context variable holds request id, source, method, path, route template, client IP (`X-Forwarded-For` only from `TRUSTED_PROXIES`), user agent, and the actor (set by `get_current_asset_user`, login, refresh, logout: id, code, name, role, head-office flag, company). Every error body made by `app/core/errors.py` gains `request_id` (HTTPException answers too, through a new `_http_handler` that keeps FastAPI's `{detail}` + headers). Jobs (ERP sync loop, retention) run under `job-<component>-<hex>` ids with source `job`. |
| 2 | Tables | `audit_log`, `error_log`, `system_event`, `client_report` (§3). `audit_log` append-only by trigger (UPDATE always refused, DELETE only inside the guarded `ckam_purge_audit_log`). No foreign keys on log tables. |
| 3 | Automatic data audit | SQLAlchemy `after_flush` listener on every Session: one row per ORM insert / update / soft delete / delete of 21 business and set-up tables, inserted with ONE statement on the flush's own connection (same transaction). Explicit one-row summaries for bulk actions through `audit.record` (+ `audit.suppress`). Coverage walker test classifies all 124 write routes; a middleware safety net writes a generic `WRITE` row for any successful write request that changed business rows without any audit row. |
| 4 | Security & access events | own short session (survive rollback): LOGIN, LOGIN_FAILED (login id, never the password), LOCKED, LOGOUT, TOKEN_REFRESH_FAILED / INVALID_TOKEN (≤ 1 per IP per minute), PASSWORD_CHANGED / _FAILED, PASSWORD_RESET (reset + issue-passwords: who, which accounts, count — never passwords), ACCESS_CHANGED (role / login / work area / home company / company access, new sign-in accounts), PRIMARY_OWNER_GRANTED / _REVOKED, PERMISSION_DENIED (every 401/403, ≤ 1 per person + route per minute), CODE_RULE_CHANGED, EXPORT (register, movements, field changes, people, every master list, log exports: who, filters, rows), IMPORT_PREVIEW / IMPORT_COMMIT, DOCUMENT_UPLOADED / _DOWNLOADED, IDEMPOTENT_REPLAY / _CONFLICT, SUSPICIOUS_INPUT (NUL characters). |
| 5 | Error logging | middleware: any unhandled exception → `error_log` (ERROR, redacted stack, redacted context: path params, query keys/values, body keys/types/sizes only), fingerprint = sha1(type + innermost CKAM frame `file:function` + route template), answer `500 {"detail": "Something went wrong on the server…", "request_id"}` and the exception re-raised like Starlette does. IntegrityError / DataError / other statement errors → WARNING `db` rows; OperationalError / InterfaceError → CRITICAL + `system_event db/connectivity_lost` (and `connectivity_restored` on the next good request); an uncaught LifecycleError → WARNING. Expected business 4xx are not rows (they are in the access log). Slow requests (> `LOG_SLOW_REQUEST_MS`) → WARNING `slow_request` row (≤ 1 per route per minute); slow SQL (> `LOG_SLOW_SQL_MS`, engine events, literals replaced by `?`) → WARNING line at once + `slow_sql` row. |
| 6 | File logs | `app.jsonl` (one access line per request + app messages), `error.jsonl` (WARNING+ with stacks), `audit.jsonl` (mirror of committed audit rows), each 20 MB × 10, in `LOG_DIR` (made if missing; unwritable → JSON to stderr + `system_event config/log_dir_unwritable`). uvicorn's access log switched off. `docker-compose.yml`: `logs` volume at `/data/logs`, `LOG_DIR=/data/logs`. Settings: `LOG_LEVEL, LOG_DIR, LOG_SLOW_REQUEST_MS, LOG_SLOW_SQL_MS, LOG_RETENTION_DAYS, TRUSTED_PROXIES, ENVIRONMENT_NAME, APP_VERSION` (+ `GIT_COMMIT` build arg / env, `VERSION` file). |
| 7 | System events | startup (version, environment, migration state, package versions, safe config) / shutdown; migration mismatch at start (WARNING); every ERP copy (`sync_started`, `sync_success` with counts / `sync_failed` with the reason / `sync_skipped`), carrying the manual request's id or the job id; `scheduler/loop_error` (+ error row) when the background check fails; retention runs; log directory problems; DB connectivity lost / restored. `erp_sync_run` unchanged. |
| 8 | Admin APIs | 11 endpoints under `/api/admin/` (§4), head-office admin (Primary Owner) only, every use an ACCESS / EXPORT row. |
| 9 | Client reports | `POST /api/client-reports` (§4). |
| 10 | Retention | daily purge in a lifespan task (first run 5 min after start); 180 days default; CRITICAL errors and REVIEWED reports kept twice as long; system event per run; `audit_log` never purged; `ckam_purge_audit_log()` guarded by `ckam.allow_audit_purge`, wrapped by the unused, tested `purge_audit_log_before`. |
| 11 | PostgreSQL logging | `docker-compose.yml` `db.command` + applied live to the dev DB (§7); production lines documented only. |
| 12 | Docs | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` (what/where matrix, request-id workflow, redaction, retention, files per environment, PostgreSQL settings, how to add auditing, privacy, 12-question support playbook). |
| 13 | Tests | §8. |

### 2. Files changed

New
* `backend/app/observability/` — `__init__.py`, `context.py` (request context + job ids), `redact.py`, `models.py`, `audit.py` (automatic + explicit DATA audit), `writer.py` (own-session rows, throttles, failure reporting), `events.py` (router helpers: exports, imports, lifecycle summaries, asset snapshots), `filelog.py`, `middleware.py`, `sqltiming.py`, `system.py` (version, migration state, safe config, start / stop events), `retention.py`, `diagnostics.py` (db / health / bundle / correlation / error groups), `admin_router.py`, `client_reports.py`
* `backend/app/alembic/versions/e6f8a0b2c4d6_logging_tables.py`
* `backend/tests/observability/` — `helpers.py` + 13 test files (§8)
* `docs/ai/LOGGING_AND_DIAGNOSTICS.md`, this report

Changed
* `backend/app/main.py` — logging setup, audit + SQL-timing install, secrets registered for redaction, outermost middleware, start / stop events, retention task, two routers; the old ad-hoc `ckam.security` stderr handler replaced by the shared one
* `backend/app/core/config.py` — 8 settings; `core/errors.py` — `request_id` in bodies, `_http_handler`, error / security rows; `core/deps.py` — actor into the context; `core/idempotency.py` — ACCESS rows for replays / conflicts
* `backend/app/auth/router.py` — sign-in / refresh / logout / password events
* `backend/app/asset_users/router.py` (exports, imports, access changes, issue-passwords, reset, owner grant/revoke, company access), `asset_users/people.py` (new sign-in accounts, ensure-rooms summary)
* `backend/app/assets/router.py` (single create row, bulk move / action, serial bulk), `assets/tools_router.py` (batch, link), `lifecycle/router.py` (event row), `documents/router.py` (upload / download)
* `backend/app/purchase_orders/router.py` (lines, line groups, cancel, deliver, receive, PI, delete), `imports/router.py` (previews / commits), `masters/router.py` (exports, imports), `masters/bulk_import_export.py` (optional row counter for exports), `numbering/router.py` (code-rule security rows), `reports/router.py` (three exports), `erp/router.py` (sync, stores, changes, PI, ERP create), `erp/sync.py` (system events, job ids, loop errors)
* `backend/app/alembic/env.py` (imports the new models), `backend/Dockerfile` (`GIT_COMMIT` build arg), `backend/scripts/create_owner.py` + `seed_admin.py` (audit listeners; SECURITY row for a new owner account)
* `backend/tests/conftest.py` (test logs in a temp dir; throttles reset per test), `tests/core/test_s3a1_master_audit_migration.py` (head is now `e6f8a0b2c4d6` — intended)
* `docker-compose.yml` — `db.command` logging flags (all existing options kept), api `LOG_DIR` / `ENVIRONMENT_NAME`, `logs` volume

### 3. Tables and columns (all `text` unless noted; no foreign keys)

* **audit_log** — `id bigserial PK, at timestamptz default now(), request_id, source ('api'|'job'|'script', default 'api'), actor_id bigint, actor_code, actor_name, actor_role, is_head_office_admin bool default false, company_id bigint, ip, category, action, entity, entity_id, summary, changes jsonb, outcome ('OK'|'DENIED'|'FAILED', default 'OK')`. Indexes: `at`; `(entity, entity_id)`; `actor_id`; `request_id`; `(category, at)`. Triggers `trg_audit_log_no_update` / `_no_delete` → `forbid_audit_log_write()`; function `ckam_purge_audit_log(timestamptz) returns bigint` (EXECUTE revoked from PUBLIC).
* **error_log** — `id, at, request_id, level ('ERROR'|'WARNING'|'CRITICAL'), source ('api'|'db'|'job'|'client'), kind (exception | slow_request | slow_sql; default 'exception'), exception_type, message, stack, route, method, status_code int, actor_id bigint, actor_code, ip, user_agent, context jsonb, fingerprint`. Indexes: `at`, `fingerprint`, `request_id`.
* **system_event** — `id, at, level (default 'INFO'), component (startup | shutdown | migration | erp_sync | backup | scheduler | db | retention | config), event, message, details jsonb, request_id`. Indexes: `at`, `(component, at)`.
* **client_report** — `id, at, request_id, reference, actor_id bigint, actor_code, route, app_version, user_agent, kind ('JS_ERROR'|'API_ERROR'|'USER_REPORT'), message, stack, breadcrumbs jsonb, recent_requests jsonb, note, status ('NEW'|'REVIEWED', default 'NEW'), fingerprint, reviewed_by bigint, reviewed_at timestamptz`. Indexes: `at`, `request_id`, `reference`, `fingerprint`. (`reference`, `reviewed_by`, `reviewed_at` are additive to the brief's list.)

### 4. Endpoints (examples are real answers from the test database, shortened)

All admin endpoints: head-office admin only; anyone else `403 {"detail": "Only the head-office admin can do this.", "request_id": "b71e…"}` (and a PERMISSION_DENIED row); no session `401`. Lists: `limit` 1–200 (default 50; entity history 100), `offset`, header `X-Total-Count`, newest first. `from` / `to`: `2026-10-14` (`to` = the whole day) or an ISO date-time.

**`GET /api/admin/logs/audit?category=data&limit=2`** — filters `from, to, actor_id, entity, entity_id, category, action, outcome, request_id, q`
```json
[{"id": 36, "at": "2026-10-14T04:20:40.577229+00:00", "request_id": "affb82df5c604737a04a411f3475238e", "source": "api",
  "actor_id": 1, "actor_code": "S0OWN", "actor_name": "Head Office Admin", "actor_role": "ADMIN", "is_head_office_admin": true,
  "company_id": 1, "ip": "127.0.0.1", "category": "DATA", "action": "UPDATE", "entity": "vendor", "entity_id": "1",
  "summary": "Vendor 'ARIHANT INFOCOM LLP' updated: name, gstin.",
  "changes": {"name": {"old": "Good Vendor", "new": "ARIHANT INFOCOM LLP"}, "gstin": {"old": null, "new": "27AAPFU0939F1ZV"}},
  "outcome": "OK"}, …]
```
A SECURITY row: `{"category": "SECURITY", "action": "PERMISSION_DENIED", "summary": "Ordinary Admin was refused GET /api/admin/logs/audit: Only the head-office admin can do this.", "changes": {"role": "ADMIN", "route": "/api/admin/logs/audit", "method": "GET", "reason": "…"}, "outcome": "DENIED", …}`

**`GET /api/admin/logs/errors?group=true`** — filters `from, to, level, source, kind, fingerprint, request_id, route, actor_id, q`; without `group` the rows (`id, at, request_id, level, source, kind, exception_type, message, stack, route, method, status_code, actor_id, actor_code, ip, user_agent, context, fingerprint`)
```json
[{"fingerprint": "fp…", "exception_type": "KeyError", "message": "m0", "level": "ERROR", "kind": "exception", "count": 3,
  "first_seen": "2026-10-14T04:18:00+00:00", "last_seen": "2026-10-14T04:20:00+00:00", "last_request_id": "err-0",
  "sample_route": "/api/x"}]
```

**`GET /api/admin/logs/system`** — `from, to, level, component, event, request_id, q` → `[{id, at, level, component, event, message, details, request_id}]`, e.g. `{"component": "erp_sync", "event": "sync_success", "message": "ERP data copied: 1 new, 0 changed, 0 gone PO lines; 0 vendors, 0 items.", "details": {…}, "request_id": "job-erp_sync-3fa0c1d2e4b5"}`

**`GET /api/admin/logs/client-reports`** — `from, to, status, kind, actor_id, request_id, q` → rows `{id, at, request_id, reference, actor_id, actor_code, route, app_version, user_agent, kind, message, stack, breadcrumbs, recent_requests, note, status, fingerprint, reviewed_by, reviewed_at}`; **`PATCH /api/admin/logs/client-reports/{id}`** `{"status": "REVIEWED"}` → the row (`reviewed_by`, `reviewed_at` set); 404 / 422.

**`GET /api/admin/logs/entity/vendor/1`** → the record's history: `[{…"action": "UPDATE", "summary": "Vendor 'ARIHANT INFOCOM LLP' updated: name, gstin."…}, {…"source": "script", "action": "CREATE", "summary": "Vendor 'Good Vendor' created.", "changes": {"code": "S0V", "name": "Good Vendor", "is_active": true}…}]`

**`GET /api/admin/logs/request/affb82df5c604737a04a411f3475238e`**
```json
{"request_id": "affb82df5c604737a04a411f3475238e", "found": true,
 "audit": [{"action": "UPDATE", "summary": "Vendor 'ARIHANT INFOCOM LLP' updated: name, gstin.", …}],
 "security": [], "errors": [], "system": [],
 "client_reports": [{"id": 1, "reference": "f6a4c678705041df91534b785bdea61e", "kind": "API_ERROR",
                     "message": "Request failed: 500", "route": "/assets/12", "status": "NEW", …}],
 "access_log": [{"ts": "2026-10-14T04:20:40.587+00:00", "kind": "access", "request_id": "affb82df…", "actor_id": 1,
                 "role": "ADMIN", "ip": "127.0.0.1", "method": "PUT", "route": "/api/masters/vendors/{item_id}",
                 "path": "/api/masters/vendors/1", "status": 200, "duration_ms": 44.2, "bytes": 170, "sql_count": 7,
                 "sql_ms": 2.2}]}
```

**`GET /api/admin/logs/export?kind=audit&from=&to=&format=csv`** — `kind` audit | errors | system | client, `format` jsonl (default) | csv; streamed oldest first; ≤ 100,000 rows; headers `Content-Disposition: attachment; filename=ckam-audit-log-20261014-042041.csv`, `X-Row-Count: 47`, `X-Truncated: false`; first CSV line `id,at,request_id,source,actor_id,actor_code,actor_name,actor_role,is_head_office_admin,company_id,ip,category,action,entity,entity_id,summary,changes,outcome`.

**`GET /api/admin/diagnostics/bundle?hours=24&request_id=`** → keys `app {version, environment, packages}, migration {code_head, db_head, matches, pending}, config (no secrets), erp_sync {configured, enabled, last_success_at, minutes_since_last_success, recent_runs}, database, table_counts, error_groups (≤ 20, with stack), security_events (≤ 30), system_events (≤ 30), new_client_reports (≤ 20), slow {slow_requests_by_route, slow_sql_rows, recent_slow_sql_this_process}, request (when asked), generated_at, period_hours, markdown`. The markdown starts:
```
# CKAM diagnostics bundle (2026-10-14T04:20:41.886186+00:00)
- Version: `unknown`, environment: **development**, last 1 hours
- Migrations: code `e6f8a0b2c4d6`, database `e6f8a0b2c4d6` (match)
- Database: connected=True, latency 0.9 ms, server 17.11 (Debian 17.11-1.pgdg13+2)
- ERP copy: configured=True, last success None (None minutes ago)
- Packages: python 3.13.15, …, fastapi 0.141.1, starlette 1.7.0, sqlalchemy 2.1.1, asyncpg 0.31.0, …
## Error groups (newest first)
### slow_sql x1 on `/api/admin/diagnostics/db` …
## Security events
- 2026-10-14T04:20:40.690292+00:00 PERMISSION_DENIED (DENIED): Ordinary Admin was refused GET /api/admin/logs/audit: … [req `b71e9644…`]
…
```

**`GET /api/admin/diagnostics/db`** → `{checked_at, connected, latency_ms, server_version, database [{name, role, size, size_bytes, is_replica}], connections_by_state [{state, connections}], long_running_queries, lock_waits, largest_tables [{table, bytes, size, live_rows}], dead_tuples_top, replication, replica_lag_seconds, logging_settings [{name, setting, unit}], slow_statement_logging_on}`; any part the role may not read is the string `"not permitted"` (or `"failed (<type>)"`).

**`GET /api/admin/diagnostics/health`**
```json
{"status": "degraded", "version": "unknown", "environment": "development", "checked_at": "…",
 "checks": {"database": {"ok": true, "latency_ms": 1.0}, "log_dir": {"ok": true, "path": "/data/logs", "problem": null},
            "migrations": {"ok": true, "code_head": "e6f8a0b2c4d6", "db_head": "e6f8a0b2c4d6", "matches": true, "pending": false},
            "erp_sync": {"ok": false, "configured": true, "minutes_since_last_success": null},
            "table_counts": {"asset": 0, "purchase_order": 0, "asset_user": 14, "audit_log": 44, "error_log": 0}}}
```
(`degraded` here because the ERP link is configured but never copied in the test database; `erp_sync.ok` = not configured / disabled, or a good copy within 48 h.)

**`POST /api/client-reports`** (any signed-in person)
```json
// request
{"kind": "API_ERROR", "message": "Request failed: 500", "route": "/assets/12", "app_version": "8231308",
 "request_id": "affb82df5c604737a04a411f3475238e", "breadcrumbs": [{"t": "nav", "to": "/assets/12"}],
 "recent_requests": [{"method": "PUT", "path": "/api/masters/vendors/3", "status": 500}], "note": null}
// 201
{"id": 1, "reference": "f6a4c678705041df91534b785bdea61e", "duplicate": false}
```
The same report again within a minute → `200 {"id": 1, "reference": "f6a4…", "duplicate": true}`; more than 30 a minute → `429 {"detail": "You have sent many problem reports in the last minute. Wait a minute and try again.", "request_id": …}`; unknown `kind` → 422; no session → 401; body > 512 KB → 413.

**Changed contracts (additive):** every error body from `app/core/errors.py` and every HTTPException answer now has `request_id`; every response has `X-Request-ID`; an unhandled error answers `500 {"detail": "Something went wrong on the server. Nothing more was saved. Quote the reference to the administrator.", "request_id": …}` (was Starlette's plain-text "Internal Server Error").

### 5. Audit coverage matrix

**Automatic (session events), one row per record** — entity names in brackets:
company, location, department, cost_center, asset_category [category], asset_subcategory [subcategory], brand, vendor, vendor_erp_link, custom_field, code_rule, item, item_map, bundle, bundle_part, asset_user (+ company access explicitly), purchase_order, purchase_order_erp_baseline, asset_document, asset (header only: not status / holder / status_since), app_setting. Updates: only changed fields `{old, new}`; skipped everywhere: created_at / updated_at / created_by / updated_by; plus asset_user.failed_login_count / locked_until, purchase_order.erp_synced_at, asset_document.stored_path. Actions: CREATE, UPDATE, DEACTIVATE (is_active true→false), REACTIVATE, DELETE (deleted_at set, or a removed row).

**Excluded** (never automatic): audit_log / error_log / system_event / client_report, asset_event, asset_field_change, master_audit, purchase_order_erp_change, code_counter, idempotency_key, erp_po_line / erp_vendor / erp_site / erp_item / erp_sync_run, pending_asset; assets created by the bulk INSERT engine (explicit rows instead).

**Routes → how audited** (the full, test-enforced list is `AUDITED` / `ALLOW_LIST` in `tests/observability/test_coverage_walker.py`):

| Route(s) | Audited as |
|---|---|
| masters CRUD (8 masters), custom fields, items, item maps, bundles, stock rooms, install points, employees, stores, asset users create / edit / deactivate, code rules, PO create / header edit, asset edit / serial / correction / delete, ERP vendor import / link / unlink / link-many / import-group, inbox resolves, not-tracked, items seed | automatic DATA rows (+ SECURITY for access / code-rule / owner changes) |
| `POST /api/assets` | DATA CREATE (explicit, the asset's key columns) |
| `POST /api/assets/batch` | DATA BATCH_ADD — one row, ids |
| `POST /api/purchase-orders/{id}/receive`, `/deliver` | DATA RECEIVE — one row, ids |
| `POST /api/assets/bulk-move`, `/bulk-action`, `/{id}/events` | LIFECYCLE MOVE / <event> — one row |
| `POST /api/assets/link-items` | DATA LINK — one row |
| `PUT /api/assets/serials` | DATA SERIALS_FILLED — one row |
| `POST /api/purchase-orders/{id}/record-pi`, ERP `pi/apply` | DATA / ERP PI_RECORDED — one row |
| PO lines / bundle-lines / with-lines / line edit / line-group edit / cancel line / cancel waiting / delete PO | DATA LINES_ADDED / LINE_UPDATE / CANCEL_WAITING / DELETE_PO |
| imports (assets, POs, movements, 8 masters, people) | IMPORT IMPORT_PREVIEW; IMPORT_COMMIT (+ per-record DATA rows where records are ORM rows) |
| `POST /api/asset-users/issue-passwords` | SECURITY PASSWORD_RESET — one row, account ids / codes |
| `POST /api/people/stores/ensure-rooms`, ERP `stores/create` | DATA BATCH_ADD / ERP STORES_CREATE — one row |
| ERP `sync`, `pos/create`, `changes/apply` | ERP ERP_SYNC (+ system events), CREATE_FROM_ERP, ERP_CHANGES_APPLIED |
| auth login / refresh / logout / change-password | SECURITY rows |
| reports exports, people / master exports, admin log export | EXPORT rows |
| document upload / download | ACCESS rows (+ DATA for the upload) |
| `PATCH /api/admin/logs/client-reports/{id}` | ACCESS CLIENT_REPORT_STATUS |
| allow-list: `POST /api/code-rules/preview`, `POST /api/purchase-orders/check-serials`, `POST /api/client-reports` | no audit row (read-only checks; the report is itself a log row) |

### 6. Settings

`LOG_LEVEL=INFO`, `LOG_DIR=./logs` (Docker `/data/logs`), `LOG_SLOW_REQUEST_MS=1000`, `LOG_SLOW_SQL_MS=500`, `LOG_RETENTION_DAYS=180`, `TRUSTED_PROXIES=` (empty), `ENVIRONMENT_NAME=development`, `APP_VERSION=` (→ `GIT_COMMIT` → `VERSION` file → `unknown`).

### 7. Performance

Measured in the test harness (`tests/observability/test_performance.py`, printed with `-s`), statements counted on the engine; "before" = the same request with every S8 audit write switched off:

| Request | Statements before | after | Time after |
|---|---|---|---|
| Receive 100 serial-numbered units (one line) | 28 | 29 (the one RECEIVE row) | 0.043 s (before 0.043 s; test limit 0.4 s) |
| Receive 1 unit (same code path) | — | 29 | — |
| Master update (`PUT /api/masters/vendors/{id}`) | 6 | 7 (the UPDATE row, same flush) | — |
| A read (`GET /api/purchase-orders`) | n | n (no extra statement) | — |

The automatic rows of one flush are ONE multi-row INSERT on the flush's own connection; explicit rows join the next flush; own-session rows (security / access / errors) are one INSERT + COMMIT each on a pooled connection. The existing S4/S5 statement budgets (receive, deliver, batch add, register pages) all still pass unchanged.

### 8. Tests

New `backend/tests/observability/` (190 tests): `test_request_id.py` (headers on 200/401/404/422/403/500/replay, incoming ids kept or replaced, error bodies, actor in context), `test_auto_audit.py` (create/update/deactivate of 15 models, summary sentence, masking, cut text, bookkeeping fields, lifecycle fields left to the ledger, soft delete, single asset create, rollback / refused request leave nothing, suppress / disable, excluded tables, ERP link delete, audit.jsonl after commit only), `test_bulk_summaries.py` (receive 100 = 1 row, delivery, batch 50, bulk move / action, link, serials, PI, cancel / delete PO, issue-passwords without passwords, ensure-rooms, import preview + commit), `test_security_events.py` (sign-in ok / failed / lock-out / locked, failed row survives, logout, refresh + bad-token throttles, 403 throttle, password change, reset, access change + company access, owner grant / revoke, code rule, four exports, documents, idempotency conflict, NUL input), `test_error_logging.py` (500 row with redacted stack / context / no secrets anywhere, fingerprints, IntegrityError, NUL DataError, DB lost / restored, LifecycleError, business 4xx not logged, slow request throttle, slow SQL, a broken log database never breaks a request, helpers never raise, no internals in the 500 body), `test_file_logs.py` (access line keys, error.jsonl stack, no secrets in files, rotation 20 MB × 10, uvicorn access off, unwritable LOG_DIR fallback + startup event, directory made), `test_system_events.py` (start / stop, migration mismatch, version sources, ERP success / failure, scheduled copy job id, loop error survives, manual copy request id + ERP_SYNC row), `test_admin_api.py` (403 for operator and ordinary admin + 401 + owner OK on all 11 endpoints, the use is audited, filters / paging / period / validation, error groups, by-request correlation incl. access-log line and client report reference, security rows apart, entity history, system / client report lists, PATCH review, export jsonl + csv with cap / redaction / audit, bundle content + markdown + no secrets, bundle with a request, DB diagnostics with permission errors, health), `test_client_reports.py` (create + reference, failing request id kept, 401 / 422, redaction, 64 KB cut, dedupe, 30 / minute 429, user report), `test_retention_and_append_only.py` (purge + 2× rules + audit untouched + event, UPDATE / DELETE refused, archive function refused without the setting and for a recent cut-off, guarded archive works and the setting does not leak, triggers / functions exist), `test_redaction.py` (sensitive / ordinary keys, nested masking, 7 value patterns, registered secrets, cutting, JSON-safe values, SQL literals, NUL), `test_coverage_walker.py` (every write route classified; 29 representative write requests each leave a non-safety-net audit row with their request id; the safety net itself), `test_performance.py` (§7).

Changed existing test: `tests/core/test_s3a1_master_audit_migration.py` — the expected single head is now `e6f8a0b2c4d6` (intended: the new migration sits on top).

Runs: `docker compose up -d --build --no-deps api` then `docker compose exec -T -e DATABASE_URL=…/ckam_test api python -m pytest -q` → **1,577 passed, 0 failed** (428 s). (`--no-deps` because `docker-compose.yml`'s `db` service changed: a plain `up --build api` would have recreated — restarted — the dev database container.)

Migration verified: `ckam_test` upgraded; `ckam` (dev) upgraded, `downgrade -1` → `d2e4f6a8b0c2`, `upgrade head` → `e6f8a0b2c4d6`; a fresh scratch database `ckam_s8_scratch` from zero to head, `downgrade -1`, `upgrade head`, the four tables compared column by column / index by index with the models (no difference beyond the TIMESTAMP/DateTime type name), then dropped; `alembic heads` → `e6f8a0b2c4d6 (head)` only.

### 9. Database logging applied (dev only)

Running dev DB (`docker compose exec -T db psql -U ckam -d ckam -c "ALTER SYSTEM SET …"` × 7, then `SELECT pg_reload_conf()`), verified in `pg_settings` (source "configuration file", no pending restart): `log_min_duration_statement=500ms`, `log_lock_waits=on`, `deadlock_timeout=1s`, `log_checkpoints=on`, `log_connections=off`, `log_line_prefix='%m [%p] %q%u@%d '`, `log_temp_files=10MB`. The same flags are in `docker-compose.yml` `db.command` (list form, every existing db option kept). The db container was NOT restarted. Production equivalents (postgresql.conf lines, Windows log directory, weekly rotation, database-level alternative, `pg_read_all_stats`) are in `LOGGING_AND_DIAGNOSTICS.md` §7 — nothing was done on any server.

### 10. Decisions taken where the brief was open

1. **Package name** `app/observability/` (not `app/logs`, to avoid confusion with the `./logs` directory).
2. **Automatic rows are inserted inside the flush** (one multi-row INSERT on the flush's connection, in `after_flush`), not added as ORM objects for a later flush: no extra flush round, no surprise autoflush inside another operation, exact "same transaction" semantics. Consequence: if `audit_log` does not exist (code deployed without `alembic upgrade head`), writes fail — the startup WARNING `migration/head_mismatch` says so; the runbook already migrates before starting.
3. **Bulk asset inserts** go through the S4 engine's `insert(Asset).returning(...)` which session events do not see; every path that creates assets writes its own explicit row (single create = CREATE with the asset's key columns; the others = one summary).
4. **Lifecycle fields** (`status`, `current_asset_user_id`, `status_since`) are never in DATA rows; every movement path writes one LIFECYCLE row; `asset_event` stays the ledger.
5. **Master / people imports** keep their per-record CREATE rows (who created this vendor → the import) AND one IMPORT_COMMIT row; asset / movement imports and all unit-level actions are summary-only.
6. **Every HTTPException body** carries `request_id` (not only the handlers that existed in errors.py); `Refused`-style bodies (`{detail, errors, problems}`) built by routes are unchanged — the id is in their header.
7. **Unhandled exceptions** are answered with a JSON 500 by our middleware and then re-raised (Starlette's own convention), so existing tests that expect the exception still pass and the server log keeps the traceback.
8. **Safety net**: a successful write with business changes and zero audit rows gets a generic `DATA / WRITE` row instead of nothing.
9. **Head-office admin** for the admin APIs = Primary Owner (`require_primary_owner`, its existing 403 sentence).
10. **Client report `reference`** = the POST's own request id (also a column); `request_id` = the failing request's id when given, else the reference. `/logs/request/{id}` finds a report by either.
11. **Throttles and rate limits are in-process** (one uvicorn process in production; reset per test).
12. **Purge timing**: a lifespan task (first run after 5 minutes, then daily), not tied to the ERP loop (which only runs when the ERP is configured).
13. **Archive guard**: the purge function also refuses a cut-off less than a day old.

### 11. Observations (not fixed / for later)

* **Another pytest run in the same api container** — while this stage was running its suites, `docs/ai/CKAM_SIMPLIFICATION_S7_FIX2_REPORT.md` was edited by another session (not by this one) and notes a concurrent `pytest` in the same container. This stage's final full run was checked to be the only pytest process (`/proc` listing) and the only `ckam_test` client.
* `alembic check` cannot be used to compare models with a database: `app/alembic/env.py` does not import every model module (pre-existing; `item`, `bundles`, `purchase_orders`, `erp` are missing), so it fails on a foreign key. The S8 tables were compared with a script instead.
* Starlette 1.7 deprecation warnings for `HTTP_422_UNPROCESSABLE_ENTITY` (pre-existing, cosmetic).
* `GET /api/purchase-orders/{id}/line-groups` (and the receive-info read) can commit unit renumbering (`_numbered`) on a GET; pending units are not audited by design.
* `pg_stat_activity` query texts of other roles show as `<insufficient privilege>` for the production app role; granting `pg_read_all_stats` (superuser step) would complete the long-running / lock-wait lists.
* Production: set `LOG_DIR` outside the release folder and `ENVIRONMENT_NAME=production` in `shared\.env`, write a `VERSION` file at packaging, and run `alembic upgrade head` before starting (as always). Nothing was deployed.

### 12. Frontend work to hand over (exact)

1. **Request id everywhere** (`src/lib/api-client` or equivalent): read `X-Request-ID` from every response; for every error toast / inline error / error page show "Reference: `<first 8 characters>`" with a Copy button that copies the FULL id. Error bodies also carry `request_id` (422 validation, 403/404/409/503, 500). Keep the last 20 calls in memory as `{method, path (no query values), status, ms, request_id, at}` for reports. Optionally send a client-made `X-Request-ID` (uuid hex) so a call that never got an answer can still be quoted (the server keeps a well-formed one).
2. **ErrorBoundary + automatic reports**: a React ErrorBoundary around the app shell and `window.onerror` / `unhandledrejection` handlers → `POST /api/client-reports` `{kind: "JS_ERROR", message, stack, route: location.pathname, app_version: <build-time VITE_APP_VERSION / git sha>, breadcrumbs: last 50 UI events (route changes, button labels clicked — never input values), recent_requests: last 20 (as in 1), request_id?}`; on any 5xx answer `{kind: "API_ERROR", message: "<status> <path>", request_id: <that answer's id>, …}`. Only when signed in (401 otherwise); de-duplicate client-side too; a 429 or failure must be silent. The ErrorBoundary fallback says in plain words that something went wrong, shows the reference and offers Reload and "Report a problem".
3. **"Report a problem" dialog** (user menu / footer, every signed-in person): a note field + "include technical details" (on by default; shows what is sent); `kind: "USER_REPORT"`; on 201 show "Thank you. Your reference is `<reference>`" with Copy; `duplicate: true` → same message with the earlier reference.
4. **Admin › Logs** (head-office admin only; hide for everyone else — the API answers 403): tabs
   * *Audit trail* — filters: period (from / to), person, category, action, outcome, record (entity + id), search; table (time, person, category, summary, outcome) paged by `X-Total-Count` (limit ≤ 200); row drawer: all columns, `changes` rendered as "field: old → new" (creates: key list; bulk: counts + ids, ids link to the asset / PO);
   * *Errors* — grouped view by default (`group=true`: type, message, count, first / last seen, route) → occurrences (`fingerprint=`) → stack + context + "Open request";
   * *System events* — component / level filters;
   * *Problem reports* — NEW / REVIEWED filter, detail with breadcrumbs and recent requests, "Mark reviewed" (`PATCH`), "Open request";
   * *By reference* — one input (request id or a report reference) → `GET /api/admin/logs/request/{id}`: access line, audit, security, errors, system, reports;
   * *Export* — kind, period, JSONL / CSV (`/api/admin/logs/export`, file download; `X-Row-Count`, `X-Truncated`).
   * **History** links on Vendor, Person / place, Item, Category, PO, Asset detail screens → `GET /api/admin/logs/entity/{entity}/{id}` (entity names: vendor, asset_user, item, category, subcategory, purchase_order, asset, company, location, …) — head-office admin only.
5. **Admin › Diagnostics**: Health card (`/diagnostics/health`: status + each check), Database card (`/diagnostics/db`: connected, latency, version, connections, long-running queries, lock waits, largest tables, dead tuples, logging settings; show "not permitted" values as such), and **Diagnostics bundle**: hours selector (1–720, default 24) + optional reference → "Copy for Claude" (copies `markdown`) and "Download JSON".

## Frontend — S8

| | |
|---|---|
| Starting HEAD | `718bb9c` |
| Scope | Brief items 1–8: reference ids everywhere, automatic browser-error capture, "Report a problem", Settings › System › Logs (5 tabs + one request's everything + record History + export), Diagnostics, Home hint, plain-word labels, tests |
| Not touched | `backend/`, git, docker, production / servers, Playwright (the controller runs it), every other doc |
| Checks (from `frontend/`) | `npx tsc -b` clean · `npx vitest run` **1,222 passed, 0 failed** (was 1,127; **+95**) · `npm run build` OK (the bundle carries the git commit as its version) |
| Commit | none (the controller commits) |

### 1. What was built (by brief item)

| # | Item | Done |
|---|---|---|
| 1 | Reference ids everywhere | `api-client` sends its own `X-Request-ID` (32 hex, `crypto.getRandomValues`, works on plain http) on every JSON call; every failure is an `ApiError` with `requestId` = the answer's `X-Request-ID` → else `request_id` in the body → else the id it sent. `authFetch` (every call: JSON, uploads, downloads) records `{at, method, path template, status, ms, requestId}` in a 50-call in-memory ring buffer (`lib/request-log.ts`; ids and query *values* removed from the path), adds an `api` breadcrumb, and announces a 5xx / unanswered call to the problem reports. Failed downloads (`downloadFile`) carry `status` + `requestId`. Every failure's sentence is remembered with its reference for 10 minutes, so screens that keep only the text still show the reference. **One** display component `components/shared/ErrorMessage.tsx` (sentence + quiet "Reference: `<id>` [Copy]"); `ErrorState` and `DataTable` use the same reference line. 5xx / no answer: "Something went wrong. Please try again; if it keeps happening, tell the administrator this reference: … [Copy] · Report a problem" (a specific 5xx sentence such as an ERP 503 is kept, with the same line). Copy copies the full id; on plain http (no Clipboard API) it uses `execCommand("copy")`, and if even that fails the id is selected with "press Ctrl+C". **77 error displays** routed through it (62 inline `role="alert"` blocks converted by one script + ReportsScreen ×3, Import ×3, Bulk import/export ×4, Quick create, reset-password banner, login, Documents ×2) and every `ErrorState` call site (all but Set up CKAM's progress error) and all 5 `DataTable` error tables now pass the error. No toasts exist in the app (sonner is installed but unused), so none to change. |
| 2 | Automatic error capture | `lib/client-reports.ts`, switched on only in `main.tsx` (`installErrorCapture()`; unit tests never report by accident): `window` "error" + "unhandledrejection" → `JS_ERROR`; a 5xx or unanswered call → `API_ERROR` (`message "500 PUT /masters/vendors/{id}"`, `request_id`); a crashed screen → `JS_ERROR` from the error boundary. Payload: `kind, message, stack (cut at 8,000), route (pathname), app_version, breadcrumbs (last 30), recent_requests (last 10, with request ids), request_id`. Rules: never when signed out or while a password change is forced; same message + top stack line within 60 s → sent once (same reference); ≤ 10 automatic reports per session; 429 → no automatic report for 5 minutes; any failure while reporting is swallowed and the report's own call is never reported (no loops); 4xx refusals and already-reported network failures are not JS errors; everything goes through `lib/redact.ts` first (sensitive keys dropped; JWT, `Bearer …`, `password=…` replaced) and is cut to 60 KB. Breadcrumbs (`lib/breadcrumbs.ts`, memory only, 50 kept): route changes (path only, no query), clicks named by aria-label / label / button text (clicks inside text fields, selects and option lists are not recorded; never a value), dialogs opening (by title, MutationObserver), API calls, keyboard shortcuts (Ctrl/Meta/Alt combos and Escape only). App version: `__APP_VERSION__` defined in `vite.config.ts` = `VITE_APP_VERSION` → `GIT_COMMIT` → `git rev-parse --short HEAD` → package version (`frontend/Dockerfile` accepts an optional `GIT_COMMIT` build arg). The user agent is not put in the body: the server takes it from the request header (its schema has no such field). Error boundary: `components/shared/ErrorBoundary.tsx` — the router's `defaultErrorComponent` (every route) and an app-wide boundary in `App.tsx`: "This screen had a problem." + reference (the automatic report's, or the failing request's) + [Try again] + [Report this problem]. |
| 3 | Report a problem | Header button "Report a problem" (every signed-in person; icon-only below `lg`), one app-wide dialog (`features/support/ReportProblemDialog.tsx` + a small zustand store): "What were you doing and what went wrong?" (required, ≤ 1,000 with a counter), the read-only line "This screen, the last few actions and the last requests — no passwords or typed values.", [Send] → `USER_REPORT` (via `authFetch`, so an expired token refreshes); success "Thank you. Reference: `<reference>` [Copy] — Quote this reference when you talk to the head-office admin." (`duplicate: true` says it was already reported). Also opened from the boundary fallback and from the "Report a problem" link of a 5xx error message (with that request id attached). The dialog closes itself on sign-out. |
| 4 | Admin Logs | Settings › **System** (new group; sidebar + landing page come from `settings-structure.ts`) › **Logs** `/settings/system/logs?tab=` and **Diagnostics**; head-office admin only (`guarded("settings")`: anyone else gets "You don't have access to this area." and no request is made; `/settings/system` redirects to Settings). Tabs: **Audit trail** (period chips Last hour / Today / 7 days / Any time + From / To dates, category, record type, outcome, action, person (sign-in accounts from `/asset-users`), reference, free text; table Time · Person · What (summary + "category · action" in words) · Record · Outcome; 50 a page with `X-Total-Count`; row → drawer with the sentence, person + role in words, record, outcome, reference link (→ everything for the request) + Copy, IP, source, a Before / After table from `changes` (field names via `fieldLabel`; bulk `ids` link to the asset / PO), and the raw codes as a muted monospace line); **Errors** (grouped by default via `group=true`: error + kind/type/route, times, first / last seen, [Open] → every occurrence of that fingerprint; "Every occurrence" toggle; drawer with stack trace and context in scrollable monospace blocks with Copy, route, person, IP, browser, reference link); **Security** (audit with `category=SECURITY`, chips Security / Access and All / Refused / Failed); **System events** (level chips, part-of-the-app filter, details JSON); **User reports** (New / Reviewed / All chips, kind filter; drawer: the person's note, kind, screen, report reference + Copy, failing request link, app version, browser, breadcrumbs as readable lines, last requests as a small table with request links, stack, [Mark reviewed] → `PATCH`). A **reference box** at the top of Logs (accepts a request id or a report reference, also with a pasted "Reference:" prefix) → **Everything for this request** `/settings/system/logs/request/$id`: access line, changes, security rows, errors, system events and problem reports merged oldest first, each with Details; "Nothing was found…" when empty; Copy diagnostics / Download bundle scoped to that request. **History** (small "History" button, head-office admin only, a drawer listing `GET /admin/logs/entity/{entity}/{id}` newest first, each entry opening its details): Vendor (and Brands, Companies, Places, Departments, Cost Centres — all `MasterCrudScreen` Edit dialogs via a new optional `historyEntity`), Item (Edit Item), Employee / Store / Stock Room / Install Point (Edit dialog, `asset_user`), the PO page header (`purchase_order`), Asset 360 (`asset`). **Export** JSONL / CSV on Audit, Errors, System and User reports (`GET /admin/logs/export?kind&from&to&format`, blob download with the auth header). |
| 5 | Diagnostics | `/settings/system/diagnostics`: a prominent **Diagnostics for support** card (hours 1 / 6 / 24 / 72, optional reference, **Copy diagnostics for support** → `GET /diagnostics/bundle` → copies `markdown`; when the browser cannot copy, the markdown appears in a read-only textarea, selected, "press Ctrl+C"; **Download bundle (JSON)**; "Paste this into your chat with Claude together with what the user reported; it contains no passwords."), **Health** (database latency, log folder writable + path, database version up to date / waiting, ERP data copy "last good copy N hours ago / never / not set up / switched off", counts, version · environment · checked at), **Database** (connected · latency · PostgreSQL version, size, connections by state, long-running queries, lock waits, largest tables, slow-query logging on / off; any "not permitted" part reads "Not visible to the app's database account."). The same two bundle buttons are on the request page. |
| 6 | Home hint | `features/system/LogsHomeRow.tsx` in the head-office admin's Home rows: "1 error · 2 user reports need a look · last 24 hours → Logs" (errors = kinds of error from `group=true&limit=1` `X-Total-Count`; reports = `status=NEW&limit=1` `X-Total-Count`; both since 24 h ago); nothing at 0, on failure, while loading, or for anyone else (no call made). |
| 7 | Plain words | `lib/labels.ts`: categories (Data change, Security, Access, Import, Export, ERP, Asset movement, System), outcomes (Done, Refused, Failed), 50+ actions (Created, Changed, Deactivated, Signed in, Failed sign-in, Account locked, Password reset, Refused, Exported, Imported, Received, Assets added, Moved, Linked, …; an unknown one is its raw value capitalised), record types (Person / place, Purchase order, Asset group, …), levels, error kinds, error sources, system parts and events, report kinds (Screen error, Failed request, Reported by a person) and statuses, row sources. Raw codes appear only in the muted technical line of a detail drawer. |
| 8 | Tests | §4. |

### 2. Files

New
* `src/lib/request-log.ts` (ring buffer, path templates, failure ↔ reference memory, failure listeners, request ids), `src/lib/breadcrumbs.ts`, `src/lib/client-reports.ts`, `src/lib/redact.ts`, `src/lib/clipboard.ts`, `src/lib/app-version.ts`
* `src/components/shared/ErrorMessage.tsx` (`ErrorMessage`, `ReferenceLine`, `errorInfo`), `src/components/shared/ErrorBoundary.tsx` (`ErrorBoundary`, `ErrorFallback`)
* `src/features/support/ReportProblemDialog.tsx`, `report-problem-store.ts`
* `src/features/system/` — `logs-api.ts` (types, query strings, periods, display helpers), `log-ui.tsx` (paged query hook, pager, chips, period filter, badges, technical line, copy, code block, export buttons), `AuditTab.tsx` (also Security), `ErrorsTab.tsx`, `SystemTab.tsx`, `ReportsTab.tsx`, `LogsScreen.tsx` (tabs + reference box), `RequestScreen.tsx`, `DiagnosticsScreen.tsx`, `BundleActions.tsx`, `RecordHistory.tsx`, `LogsHomeRow.tsx`
* Tests: `src/lib/{request-log,redact,request-capture,client-reports,labels-logs}.test.ts`, `src/lib/breadcrumbs.test.tsx`, `src/components/shared/{ErrorMessage,ErrorBoundary,error-references-screens}.test.tsx`, `src/features/support/ReportProblemDialog.test.tsx`, `src/features/system/system.test.tsx`

Changed
* `src/lib/api-client.ts` (`X-Request-ID`, `ApiError.requestId`, `requestIdFromBody`, `patch`), `src/lib/auth-fetch.ts` (recording, breadcrumbs, failure announcements, network-error flag, download errors with reference), `src/lib/labels.ts` (S8 tables)
* `src/components/shared/ErrorState.tsx` (`error` prop + reference), `DataTable.tsx` (`error` prop), `MasterCrudScreen.tsx` + `types.ts` (`historyEntity`, History in Edit), `QuickCreateDialog.tsx`, `BulkImportExport.tsx`
* `src/router.tsx` (header "Report a problem" + the dialog, `defaultErrorComponent`, four `/settings/system/*` routes), `src/App.tsx` (app-wide boundary), `src/main.tsx` (`installErrorCapture`, route breadcrumbs), `src/routes/dashboard.tsx` (Home hint), `src/features/settings/settings-structure.ts` (System group), `src/routes/login.tsx`, `src/routes/change-password.tsx`, `src/routes/setup/{vendors,brands,companies,cost-centers,departments,locations}.tsx` (`historyEntity`)
* Error displays converted to `ErrorMessage` / given their error: 47 screen files under `src/features/**` (assets, asset-groups, asset-users, bundles, dashboard, erp, imports, items, masters, my-assets, numbering, people, purchase-orders, receive, reports, vendors); History buttons in `EditPersonDialog.tsx`, `ItemFormDialog.tsx`, `PurchaseOrderDetail.tsx`, `AssetDetail.tsx`
* `vite.config.ts` (`__APP_VERSION__`), `frontend/Dockerfile` (optional `GIT_COMMIT` build arg)
* Existing tests extended (intended): `src/router.test.tsx` (the Settings group now ends with Logs, Diagnostics), `people.test.tsx`, `item-form.test.tsx`, `PurchaseOrderDetail.test.tsx`, `ReportsScreen.test.tsx` (History / reference cases appended; no existing expectation changed except the Settings list)

### 3. Walkthrough — "user sees an error → reference → admin finds it in 3 clicks"

1. A store user presses **Receive** on PO 40 and the server fails. Under the button: *"Something went wrong. Please try again; if it keeps happening, tell the administrator this reference: `affb82df5c604737a04a411f3475238e` [Copy] · Report a problem"*. In the background the app has already sent an `API_ERROR` report with that request id, the last 30 actions ("Opened /purchase-orders/40", "Clicked “Receive”", "POST /purchase-orders/{id}/receive → 500") and the last 10 requests. The user presses **Copy** (or **Report a problem**, writes "Receive failed twice", and gets their own report reference) and sends it to the head-office admin.
2. Head-office admin: **(1)** Settings › System › **Logs**, **(2)** paste the reference into the box at the top, **(3)** **Find everything** → *Everything for this request*: the access line (`POST …/receive → 500 in 81 ms`), the error with its stack (Details), the automatic and the person's problem reports with their breadcrumbs.
3. On the same page, **Copy diagnostics for support** → paste into a Claude chat with what the user said ("it contains no passwords"). Or **Download bundle (JSON)** to attach.

### 4. Tests added (95; full suite 1,127 → 1,222)

| File | Tests | Covers |
|---|---|---|
| `lib/request-log.test.ts` | 6 | path templates (ids, query values), ring buffer 50 / last 10, failure ↔ reference memory and its 10-minute limit, listeners (a broken one never breaks a call), request-id format, header reading on test doubles |
| `lib/request-capture.test.ts` | 5 | `X-Request-ID` sent + call recorded with the server's id; reference from header → body → sent id; 5xx / no answer announced, 4xx not; network errors flagged with the sent id; the report's own call never announced; failed downloads carry status + reference |
| `lib/redact.test.ts` | 4 | JWT / Bearer / password pairs in text, sensitive keys at any depth, key list, cycles |
| `lib/breadcrumbs.test.tsx` | 5 | clicks by accessible name, nothing typed or clicked inside fields ever recorded (password typed, checkbox value), shortcuts, dialog titles, 50 kept / 30 sent |
| `lib/client-reports.test.ts` | 12 | off until installed; window error → full JS_ERROR payload (route, version, 30 breadcrumbs, 10 requests, cut stack); unhandled rejection; 4xx not reported; signed out → nothing; dedupe 60 s; cap 10; 429 → 5-minute backoff; failure swallowed; API_ERROR with request id; redaction; USER_REPORT payload and 429 / signed-out messages |
| `components/shared/ErrorMessage.test.tsx` | 10 | refusal + Reference + Copy (no "administrator" line); 5xx wording + Report a problem opens with the id; network / generic 5xx / specific 503; reference found by sentence; nothing extra without a reference; Copy via `execCommand`; select-to-copy fallback; no Report when signed out; ErrorState and DataTable |
| `components/shared/error-references-screens.test.tsx` | 2 | Add Vendor refusal in a dialog; a list that failed with 500 (wording + Report a problem) |
| `components/shared/ErrorBoundary.test.tsx` | 3 | fallback words, one JS_ERROR report with stack, its reference shown; Try again; Report this problem opens the dialog with the crash |
| `features/support/ReportProblemDialog.test.tsx` | 4 | required note, attached line, payload (breadcrumbs, requests), Thank-you + reference; carries an error's reference; ≤ 1,000; refused send keeps the note |
| `features/system/system.test.tsx` | 31 | guard on all three pages (no access, no request) + landing page group; audit default params (7 days, 50, offset 0) and plain words; filters → params (search, reference, Last hour / Any time, outcome, record type); paging via `X-Total-Count`; drawer (before / after, reference link, IP, technical line); export CSV / JSONL params + auth header; errors grouped → Open → fingerprint → stack / context; ungrouped toggle; security category / outcome / access chips; system level chip; user reports NEW + readable breadcrumbs / requests + Mark reviewed; reference box → request page in time order; invalid reference; nothing found; bundle on the request page; diagnostics cards incl. "not permitted"; copy (hours + reference); clipboard fallback textarea; JSON download; Home hint shown / hidden at 0 / silent on failure / never asked by a Full Admin; header Report a problem for a View Only person; Vendor History (owner, list) / not for others / standalone; the History button rules |
| `lib/labels-logs.test.ts` | 5 | the label tables, unknown action capitalised, no listed code shown raw |
| `people.test.tsx` +2, `item-form.test.tsx` +3, `PurchaseOrderDetail.test.tsx` +2, `ReportsScreen.test.tsx` +1 | 8 | History per screen for the head-office admin only; a download error kept as text still shows its reference |

### 5. Decisions taken where the brief was open

1. **The full request id is shown** (monospace, small, wraps), not its first 8 characters: the lookup endpoint needs the whole id and people read references out from screenshots; Copy copies the whole id either way.
2. **One component, two entry points**: `ErrorMessage` for inline messages, `ErrorState` (same `ReferenceLine`) for blocks. Converted displays keep their exact sentence (`message={X instanceof Error ? X.message : "fallback"}`) and pass the error for the reference — no screen text changed except generic 5xx / network sentences, which now read "Something went wrong."
3. **References for text-only displays**: the app remembers the last 50 failure sentences with their reference (10 minutes), so a screen that stored only `err.message` in state still shows the right reference without being rewritten.
4. **A client-made `X-Request-ID` on every JSON call** (the server keeps a well-formed one) so a call that never got an answer still has a quotable id. Not added to downloads / uploads made directly through `authFetch` (existing tests pin those headers); their answers still carry the server's id.
5. **Automatic capture only in `main.tsx`** (never in unit tests or embedded renders); a crash is reported once per error object; the route breadcrumb carries the path only.
6. **Router integration**: TanStack Router catches route errors itself, so the fallback is its `defaultErrorComponent`; an outer `ErrorBoundary` in `App.tsx` covers the rest.
7. **Security tab** = audit list with `category=SECURITY` (chip to switch to ACCESS) and outcome chips All / Refused / Failed — the API filters one category at a time.
8. **Default period 7 days** on every tab; "Any time" is one click. The person filter lists sign-in accounts (`/asset-users`, `login_enabled`).
9. **Export** sends the tab's period only (`kind, from, to, format`) — the export endpoint takes no other filter (see backend requests); the buttons say "exports the chosen period".
10. **History** also on Asset 360 and the other master screens (one optional `historyEntity` on `MasterCrudScreen`), beyond the four the brief named — same rule: head-office admin only, nothing for anyone else.
11. **Home hint** counts *kinds* of error (groups) in the last 24 h, not every occurrence.

### 6. Deferred / not done

* No browser walk-through of the new pages in the Docker stack (the containers do not live-mount source and this stage did not run docker); the controller's Playwright run is the first in-browser check. Mobile: the pages use wrapping filter rows, `grid-cols-1` sections and full-width drawers, but were not looked at on a phone.
* Toasts: none exist in the app; nothing to change.
* Report breadcrumbs do not include `user_agent` in the body (the server records the header).
* Code-splitting the Logs / Diagnostics screens (the bundle-size warning predates this stage).

### 7. Backend requests

1. **`GET /api/admin/logs/export`**: accept the same filters as the lists (`category, action, outcome, entity, entity_id, actor_id, request_id, q`; errors: `level, kind, fingerprint`; system: `level, component`; client: `status, kind`) so Export can match what the tab shows.
2. **A quiet summary for Home**: `GET /api/admin/logs/summary?hours=24` → `{error_groups, new_client_reports}` that does **not** write a `LOGS_VIEWED` access row — today each Home visit of the head-office admin writes two (cached 5 minutes in the browser).
3. **Prefix search by reference**: let `/logs/request/{id}` (or the audit `q`) match a unique prefix of ≥ 8 characters, for references read out over the phone.
4. **`/logs/audit`: several categories at once** (`category=security,access`) so the Security tab can show both in one list.
5. **`/diagnostics/db`**: name the long-running query / lock-wait fields (`seconds`, `query`, `waiting_pid`, …) in the report so the Database card can label them instead of showing raw JSON lines.
