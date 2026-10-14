# CKAM — Logging, Audit Trail and Diagnostics (S8)

What CKAM records about itself, where it is kept, how to find everything about one problem, and how to
hand it to an engineer (or to Claude). Code: `backend/app/observability/`. Tables: migration
`e6f8a0b2c4d6_logging_tables`. Report of the stage: `CKAM_SIMPLIFICATION_S8_REPORT.md`.

## 1. The one idea: the request id

Every request gets an id (32 hex characters, or a well-formed `X-Request-ID` the caller sent: 1–64 of
`A-Z a-z 0-9 . _ -`). It is:

* sent back as the `X-Request-ID` header on **every** response (success, refusal, error, file download,
  idempotent replay, the web app itself), and as `request_id` in every error body
  (`{"detail": "...", "errors": [...], "request_id": "..."}`);
* written on every audit row, error row, system event, client report and log-file line the request causes.

A background job (the ERP copy, the daily log purge) gets its own id `job-<component>-<12 hex>`, used the
same way. Rows written by a script (`scripts/create_owner.py`) have source `script` and no request id.

**Support workflow:** a person sees *Reference 3f9c…* on an error message → the head-office admin opens
**Logs › by request** (`GET /api/admin/logs/request/3f9c…`) and sees the access-log line, the audit rows,
security rows, errors (with stack) and the person's own problem report of that request → **Diagnostics ›
Copy bundle** (`GET /api/admin/diagnostics/bundle?request_id=3f9c…`) → paste the `markdown` into a Claude
chat: *"Here is the diagnostics bundle, the user reported X."*

## 2. What is recorded where

| What | Table | File (LOG_DIR) | Written | Survives a rolled-back request? |
|---|---|---|---|---|
| Data changes (create / update / deactivate / delete of business and set-up records) | `audit_log` (category DATA) | `audit.jsonl` (after commit) | automatically, in the same transaction | no (on purpose: nothing changed) |
| Bulk actions (receive, batch add, move, link, import, cancel, delete PO, PI, serials) | `audit_log` (DATA / LIFECYCLE / IMPORT / ERP), ONE row per action | `audit.jsonl` | explicitly, same transaction | no |
| Sign-in, sign-out, failed sign-in, lock-out, password change / reset, access changes, refusals (401 / 403), code-rule changes, head-office admin grant / revoke, suspicious input | `audit_log` (SECURITY) | `audit.jsonl` | own short session | **yes** |
| Exports, import previews, document downloads / uploads, idempotent replays / conflicts, use of the Logs screens | `audit_log` (EXPORT / IMPORT / ACCESS) | `audit.jsonl` | own short session | yes |
| Unexpected errors (500), database errors, uncaught refusals of the movement rules, slow requests, slow SQL, background-job errors | `error_log` | `error.jsonl` (+ `app.jsonl`) | own short session | yes |
| Start / stop, migration mismatch, ERP copies, log purge, log directory problems, database lost / back, background-loop errors | `system_event` | `app.jsonl` (+ `error.jsonl` when WARNING+) | own short session | yes |
| Problems reported by the browser (JS error, failed call, "Report a problem") | `client_report` | — | `POST /api/client-reports` | yes |
| One line per request (who, what, how long, how many statements) | — | `app.jsonl` (`"kind": "access"`) | middleware | yes |
| Movements of assets (who held what, when) | `asset_event` (unchanged ledger) | — | lifecycle service | no |
| Field-by-field edits of an asset | `asset_field_change` (unchanged) | — | asset edit | no |

### Audit categories and actions

| Category | Actions (non-exhaustive) |
|---|---|
| DATA | CREATE, UPDATE, DEACTIVATE, REACTIVATE, DELETE, BATCH_ADD, RECEIVE, LINK, SERIALS_FILLED, LINES_ADDED, LINE_UPDATE, CANCEL_WAITING, DELETE_PO, PI_RECORDED, WRITE (safety net, see §6) |
| LIFECYCLE | MOVE, SENT_FOR_REPAIR, RECEIVED_FROM_REPAIR, DISPOSED, SOLD, SCRAPPED, LOST, FOUND, CORRECTION |
| SECURITY | LOGIN, LOGIN_FAILED, LOCKED, LOGOUT, TOKEN_REFRESH_FAILED, INVALID_TOKEN, PERMISSION_DENIED, PASSWORD_CHANGED, PASSWORD_CHANGE_FAILED, PASSWORD_RESET, ACCESS_CHANGED, PRIMARY_OWNER_GRANTED / _REVOKED, CODE_RULE_CHANGED, SUSPICIOUS_INPUT |
| ACCESS | DOCUMENT_UPLOADED, DOCUMENT_DOWNLOADED, IDEMPOTENT_REPLAY, IDEMPOTENT_CONFLICT, LOGS_VIEWED, DIAGNOSTICS_VIEWED, DIAGNOSTICS_BUNDLE, CLIENT_REPORT_STATUS |
| EXPORT | EXPORT (asset register, movement log, field-change audit, people, masters, log exports) |
| IMPORT | IMPORT_PREVIEW, IMPORT_COMMIT |
| ERP | ERP_SYNC, STORES_CREATE, CREATE_FROM_ERP, ERP_CHANGES_APPLIED, PI_RECORDED |

Every audit row: `at, request_id, source (api/job/script), actor_id/code/name/role, is_head_office_admin,
company_id, ip, category, action, entity, entity_id, summary` (one plain sentence, e.g. *"Vendor 'ARIHANT
INFOCOM LLP' updated: name, gstin."*), `changes` (updates: `{field: {old, new}}`; creates: key columns;
bulk: counts + the first 200 ids + `total`) and `outcome` (OK / DENIED / FAILED).

Throttles (one process): INVALID_TOKEN and TOKEN_REFRESH_FAILED at most one row per address per minute;
PERMISSION_DENIED one per person + route per minute; slow requests one per route per minute; slow SQL one
per statement shape per minute; SUSPICIOUS_INPUT one per address + route per minute. Failed sign-ins are
never throttled (they matter for lock-outs and guessing).

## 3. Redaction (nothing secret is ever stored or written)

Applied to every row and every file line (`app/observability/redact.py`):

* **by key name**, at any depth: password, new/old/temp password, password_hash, token, access/refresh
  token, authorization, cookie, secret, API key, private key, database URL, ERP source password … → `***`;
* **by value pattern**, in any text (also messages and stacks): `Bearer …`, JWT-shaped strings, argon2
  hashes, `password=…` / `"password": "…"` pairs, the password inside `scheme://user:password@host`,
  `refresh_token=…` cookies, and the running server's own secrets (JWT secret, DB and ERP passwords);
* long text is cut (2,000 characters per value by default, stacks 20,000) with a note of how much;
* error context keeps path parameters, query keys/values (sensitive ones masked) and only the **keys,
  types and sizes** of a request body — never its values;
* SQL in slow-statement rows has its literal values replaced by `?`;
* request headers are never stored (so `Authorization` and `Cookie` cannot leak);
* issued / temporary passwords are only ever in the one API answer that shows them.

## 4. Retention

| Table | Kept |
|---|---|
| `audit_log` | **forever** — never purged by the application; append-only (a trigger refuses UPDATE and DELETE) |
| `error_log` | `LOG_RETENTION_DAYS` (default 180); CRITICAL rows twice as long |
| `system_event` | `LOG_RETENTION_DAYS` |
| `client_report` | `LOG_RETENTION_DAYS`; REVIEWED ones twice as long |
| log files | 20 MB × (1 + 10 rotated) per file = at most 660 MB in all |

The purge runs in the application's background loop 5 minutes after start and then daily, and writes a
`system_event` (`retention / purge_finished` with the counts).

**Archiving the audit trail (deliberate, separate, not built into the app):** export the period first
(`GET /api/admin/logs/export?kind=audit&from=2025-01-01&to=2025-12-31&format=jsonl`, keep the file), then a
role allowed to execute the guarded function runs, in one transaction:

```sql
BEGIN;
SET LOCAL ckam.allow_audit_purge = 'on';
SELECT ckam_purge_audit_log('2026-01-01');   -- removes rows older than this; refuses a cut-off < 1 day old
COMMIT;
```

Without the setting the function and any `DELETE FROM audit_log` are refused. `EXECUTE` on the function is
revoked from PUBLIC. `app.observability.retention.purge_audit_log_before` wraps it for a future archive
tool and is unused.

## 5. Log files and settings

| Setting | Default | Meaning |
|---|---|---|
| `LOG_DIR` | `./logs` (Docker: `/data/logs`, the `logs` volume) | where app.jsonl / error.jsonl / audit.jsonl go; made if missing; if it cannot be written the lines go to stderr and a `config / log_dir_unwritable` system event says why |
| `LOG_LEVEL` | `INFO` | level of application messages in app.jsonl (access lines are always written) |
| `LOG_SLOW_REQUEST_MS` | `1000` | a request slower than this → WARNING row (`kind: slow_request`) |
| `LOG_SLOW_SQL_MS` | `500` | a statement slower than this → WARNING line at once + row (`kind: slow_sql`) |
| `LOG_RETENTION_DAYS` | `180` | see §4 |
| `TRUSTED_PROXIES` | empty | comma-separated IPs / networks whose `X-Forwarded-For` is believed (leave empty for the single uvicorn process) |
| `ENVIRONMENT_NAME` | `development` | shown in logs, events and the bundle (set `production` on 10.0.1.98) |
| `APP_VERSION` | empty | release id; empty → `GIT_COMMIT` env (Docker build arg) → a `VERSION` file in the backend folder → `unknown` |

Every line is one JSON object: `ts, level, logger, request_id, actor_id, msg` plus, for access lines,
`kind: access, role, ip, method, route (template), path, status, duration_ms, bytes, sql_count, sql_ms`,
and for errors `exception_type, route, status_code, fingerprint, stack, context`. uvicorn's own access log
is switched off (one access line per request: ours). WARNING and above also go to stderr in the classic
one-line form (so `docker compose logs api` and the production launcher log still show problems).

* **Docker (dev):** `docker compose exec api sh -c "tail -f /data/logs/app.jsonl"`; the files live in the
  `ckam-build_logs` volume and survive container rebuilds.
* **Windows production (single uvicorn process on 10.0.1.98):** put
  `LOG_DIR=D:\Citykart_Applications\Citykart_AssetManagement_App\logs\app` and
  `ENVIRONMENT_NAME=production` in `shared\.env` (the default `./logs` would land inside the release folder
  and be left behind at the next release). Write a `VERSION` file (`git rev-parse --short HEAD`) into
  `releases\<sha>\backend\` when packaging so the bundle names the release. Rotation is by size inside the
  process (no external tool needed). Read with PowerShell: `Get-Content ...\app.jsonl -Tail 50 -Wait`, or
  `Select-String -Path ...\app.jsonl -Pattern <request id>`. Note: RotatingFileHandler renames the file when
  it rotates; do not keep it open in an editor on the server.

## 6. How to add auditing for a new table or route

1. **A new business / set-up table** written through the ORM (`session.add`, attribute changes): add one
   line to `SPECS` in `app/observability/audit.py` — the table name, the entity name, the word people use
   and the field(s) that name a record (`EntitySpec("vendor", "Vendor", ("name", "code"))`), plus fields
   that must never be diffed (`skip_fields`). Creates, updates, deactivations and deletes are then audited
   automatically. Sensitive fields are masked by name.
2. **A new bulk action** (many rows at once, or a bulk `insert(...)` / `update(...)` statement, which the
   session events do not see): call `audit.suppress(session, "<entity>")` before the work (no per-row
   rows) and `audit.record(session, CATEGORY, ACTION, "<one sentence>", entity=…, entity_id=…,
   changes={counts, **ids_preview(ids)})` before the commit (helpers in `app/observability/events.py`).
3. **A security / access / export event** (must survive a failed request, or the request is a read):
   `await writer.security(...)` / `writer.access(...)` / `events.exported(...)`.
4. **Classify the route** in `tests/observability/test_coverage_walker.py` (`AUDITED`, or `ALLOW_LIST` with
   the reason it writes nothing). That test fails for any unclassified write route.
5. Safety net: a successful POST/PUT/PATCH/DELETE that changed business rows but wrote no audit row gets a
   generic DATA row with action `WRITE` ("… saved changes that have no specific audit entry"). Seeing one
   in the trail means step 1–3 was forgotten for that route.

Never audited automatically: the log tables, the ledgers that already are audit trails (`asset_event`,
`asset_field_change`, `master_audit`, `purchase_order_erp_change`), technical tables (`code_counter`,
`idempotency_key`), the ERP copy (`erp_*`, `erp_sync_run` — the copies are system events), and the per-unit
`pending_asset` rows (PO actions write their own rows). On `asset`, the lifecycle fields (status, holder,
status_since) are the ledger's; `asset_user.failed_login_count / locked_until` are the security rows'.

## 7. PostgreSQL's own logging

| Setting | Value | Why |
|---|---|---|
| `log_min_duration_statement` | `500` (ms) | every statement slower than 0.5 s, with its duration |
| `log_lock_waits` | `on` | a wait for a lock longer than `deadlock_timeout` |
| `deadlock_timeout` | `1s` | (also the lock-wait reporting threshold) |
| `log_checkpoints` | `on` | checkpoint timing (I/O pressure) |
| `log_connections` | `off` | (the app's pool would flood it) |
| `log_line_prefix` | `'%m [%p] %q%u@%d '` | time with ms, process id, role@database |
| `log_temp_files` | `10MB` | queries spilling more than 10 MB to disk |

* **Dev (Docker):** set in `docker-compose.yml` (`db.command`) and applied to the running dev database
  with `ALTER SYSTEM SET …; SELECT pg_reload_conf();` (no restart). Read: `docker compose logs db --tail 200`.
* **Production (10.0.0.205, PostgreSQL 18 on Windows) — NOT applied by this stage; for the DBA / user to do
  on the server:** add to `postgresql.conf` (in the data directory `D:\POSTGRESQL DB`), or run the same
  `ALTER SYSTEM` statements as the `postgres` superuser, then `SELECT pg_reload_conf();` (no restart):

  ```
  log_min_duration_statement = 500
  log_lock_waits = on
  deadlock_timeout = 1s
  log_checkpoints = on
  log_line_prefix = '%m [%p] %q%u@%d '
  log_temp_files = 10MB
  logging_collector = on                 # usually already on for the Windows service (restart if changed)
  log_directory = 'log'                  # relative to the data directory: D:\POSTGRESQL DB\log
  log_filename = 'postgresql-%a.log'     # one file per weekday ...
  log_truncate_on_rotation = on          # ... overwritten a week later: 7 days kept
  log_rotation_age = 1d
  ```
  These settings are server-wide (the server is shared with other apps); `log_min_duration_statement` can
  instead be limited to CKAM's database: `ALTER DATABASE ckassetmanagement SET log_min_duration_statement = 500;`.
  `GET /api/admin/diagnostics/db` shows the values the server actually uses (`logging_settings`,
  `slow_statement_logging_on`). The application's role (`ckassetapp`, not a superuser) can read them; it
  sees other roles' query texts in `pg_stat_activity` as `<insufficient privilege>` — reported as such,
  never an error. Granting `pg_read_all_stats` to the app role (superuser step) makes the long-running
  query / lock-wait lists complete.

## 8. Admin API (head-office admin only; every use is itself an ACCESS row)

| Endpoint | What |
|---|---|
| `GET /api/admin/logs/audit` | filters `from, to` (date = whole day, or ISO date-time), `actor_id, entity, entity_id, category, action, outcome, request_id, q`; `limit` ≤ 200, `offset`; newest first; `X-Total-Count` |
| `GET /api/admin/logs/errors` | same + `level, source, kind, fingerprint, route`; `group=true` → `{fingerprint, exception_type, message, level, kind, count, first_seen, last_seen, last_request_id, sample_route}` |
| `GET /api/admin/logs/system` | `level, component, event, request_id, q` |
| `GET /api/admin/logs/client-reports` · `PATCH …/{id}` `{status: NEW/REVIEWED}` | the browser's reports |
| `GET /api/admin/logs/entity/{entity}/{entity_id}` | the history of one record (`vendor/12`, `asset_user/5`, `purchase_order/40`, `asset/9001`) |
| `GET /api/admin/logs/request/{request_id}` | everything of one request (also finds a client report by its `reference`) |
| `GET /api/admin/logs/export?kind=audit\|errors\|system\|client&from=&to=&format=jsonl\|csv` | streamed, ≤ 100,000 rows (`X-Row-Count`, `X-Truncated`) |
| `GET /api/admin/diagnostics/bundle?hours=24&request_id=` | JSON + `markdown` to paste into a chat |
| `GET /api/admin/diagnostics/db` | database health (permission-tolerant) |
| `GET /api/admin/diagnostics/health` | log dir writable, migrations, last ERP copy, table counts, DB latency |
| `POST /api/client-reports` (any signed-in person) | `{kind, message, stack?, route, app_version, breadcrumbs[], recent_requests[], note?, request_id?}` → `{id, reference, duplicate}`; 64 KB, deduplicated per minute, 30 per minute (429) |

## 9. Privacy notes

* Audit rows hold names, codes, IP addresses and what people did — personal data of staff. Only the
  head-office admin can read them through the API; the files are on the server only.
* Client reports may contain what was on a person's screen (breadcrumbs, the routes they visited); they
  are redacted like everything else and purged after the retention period.
* A failed sign-in keeps the **login id that was typed** (someone may type their password into the login
  box by mistake — such a row should be treated as sensitive and the person asked to change it).
* Exports of the logs are themselves audited (EXPORT rows).

## 10. Support playbook — which log answers what

| Question | Where to look |
|---|---|
| Who changed this vendor's GSTIN, and when? | Logs › record history: `GET /api/admin/logs/entity/vendor/<id>` → the UPDATE row with `changes.gstin.old/new`, actor, time, request id |
| Why did this receipt fail? | The reference on the user's screen → `GET /api/admin/logs/request/<id>`: the access line (status 422 = a refusal with its sentence; 500 = an error row with stack); `GET /api/admin/logs/errors?route=/api/purchase-orders/{po_id}/receive` |
| A user cannot log in | `GET /api/admin/logs/audit?category=security&q=<their code or email>` → LOGIN_FAILED (unknown id / wrong password, attempt n), LOCKED (15 minutes), TOKEN_REFRESH_FAILED; then their record history for login_enabled / role changes |
| Which requests were slow yesterday? | `GET /api/admin/logs/errors?kind=slow_request&from=<yesterday>&to=<yesterday>` (and `kind=slow_sql`); the bundle's "Slow requests / SQL"; PostgreSQL's own log for statements > 500 ms |
| Who exported the asset register? | `GET /api/admin/logs/audit?category=export&q=asset register` → who, when, filters, row count |
| What happened to PO X? | `GET /api/admin/logs/entity/purchase_order/<id>`: created, header edits, lines added, receipts (RECEIVE with asset ids), cancellations, PI, deletion; ERP changes applied |
| Who moved this asset to the wrong store? | the asset's movement history (asset_event) and `GET /api/admin/logs/audit?entity=asset&entity_id=<id>`; a bulk move names the asset in `changes.ids` → `q`/request id |
| Who gave this person admin rights? | `GET /api/admin/logs/audit?category=security&action=ACCESS_CHANGED&entity_id=<user id>` (and PRIMARY_OWNER_GRANTED) |
| The ERP data looks old | `GET /api/admin/logs/system?component=erp_sync` → sync_started / sync_success with counts / sync_failed with the reason; `diagnostics/health` → minutes since the last good copy |
| The app was down / restarted at night | `GET /api/admin/logs/system?component=startup` and `shutdown`; `db / connectivity_lost / _restored`; the bundle's system events |
| Who printed / downloaded this invoice document? | `GET /api/admin/logs/audit?action=DOCUMENT_DOWNLOADED&entity_id=<asset id>` |
| An error keeps happening | `GET /api/admin/logs/errors?group=true` → count, first / last seen, last request id → that request; copy the bundle |
