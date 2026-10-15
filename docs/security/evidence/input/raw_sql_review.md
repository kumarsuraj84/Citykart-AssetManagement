# INPUT area — static review of raw SQL, injection sinks, and web-layer sinks

Scope: `backend/app/**`, `backend/scripts/**`, `frontend/src/**`. Grep + manual read of every hit.
Verdict legend: SAFE (parameterized / whitelisted / not user-reachable), GAP (finding raised).

## 1. Raw SQL — `text(...)`, `.execute(...)`, `literal_column`, `exec_driver_sql`, `.format`, dynamic `getattr` columns

| Location | Construct | Verdict | Why |
|---|---|---|---|
| `assets/custom_field_values.py:59` | `text("SELECT EXISTS (... custom_fields::jsonb ? :field_key)")` | SAFE | field key bound as `:field_key` parameter |
| `observability/diagnostics.py:43-121` `_query(conn, sql, params)` | `conn.execute(text(sql), params)` | SAFE | every `sql` is a hard-coded string literal; all variables (`:secs` etc.) bound as params; no user string concatenated. Endpoint is primary-owner-only. |
| `observability/retention.py:60-61` | `text("SET LOCAL ...")`, `text("SELECT ckam_purge_audit_log(:before)")` | SAFE | literal + bound `:before` |
| `observability/system.py:52`, `erp/sync.py:122`, `sync.py:169+` | `text("select version_num ...")`, advisory lock, `getattr(row,f)` over fixed field tuples | SAFE | literals / fixed field lists |
| `assets/search_service.py` (sort/search) | `SORTABLE_COLUMNS` dict whitelist; `escape_like` on all ILIKE; full ORM `select()` | SAFE | sort_by looked up in a dict of real `Asset` columns, unknown keys ignored; `%`,`_`,`\` escaped with `escape="\\"` |
| `observability/admin_router.py` (logs filters: q/level/from/group/entity) | ORM `.ilike(pattern, escape="\\")`, enum membership checks, `escape_like` | SAFE | all filters parameterized; category/outcome/status validated against fixed sets |
| `masters/router.py:60-62`, `masters/service.py:13`, `core/codes.py:35`, `masters/bulk_import_export.py:85,114` | `getattr(model, field/key)` | SAFE | `field` from literal `("code","name")`; `key` from server-built scope dict keys (`company_id`,`category_id`); values bound as params. getattr yields a mapped Column, never a raw identifier string in SQL |
| `items/service.py:430` `getattr(rules, level.lower())` | dynamic attr | SAFE | `level` validated against `LEVEL_TYPES` (ValueError otherwise) at line 426 |
| `imports/asset_import_service.py:136` `getattr(model,key)` in `_lookup(**filters)` | dynamic attr | SAFE | `filters` keys are caller code kwargs, not request keys |
| `lifecycle/service.py:42` `template.format(**{"from":..,"to":..})` | str.format | SAFE | template is a code constant; only named substitution of server values |
| `erp/stores.py:27` `settings.store_email_pattern.format(code=...)` | str.format | SAFE | pattern from config; produces an email string, not SQL |

Live confirmation: `api_battery.mjs` fired quote / boolean / comment / UNION / stacked-`pg_sleep` / wildcard / backslash payloads at asset `q`, `sort_by`, `sort_dir`, `status`, `category_id`, `company_id`, `limit`, plus vendors/items/assets-pick/purchase-orders/admin-logs(q,level,from,group). Result: no 500s, no timing delay (all < 15 ms vs a 3 s sleep threshold), injected strings matched literally (0 rows), numeric contexts 422. **No SQL injection found (CONFIRMED).**

## 2. SSRF — `httpx` / `requests` / `urlopen` / `aiohttp` / webhooks / image-fetch
Grep of `backend/app`: **no outbound HTTP client in application code** (only `backend/tests/**` use httpx as a test client). The ERP integration reads a PostgreSQL source (`PO_SOURCE_*`), not an HTTP URL, and is empty/disabled on this stack. **N/A — no user-controlled URL fetch exists.**

## 3. Command injection / unsafe parsing — `subprocess`/`os.system`/`shell=True`/`eval`/`exec`/`pickle`/`marshal`/`yaml.load`/`render_template_string`/`Template(`/`format_map`
Grep of `backend/app`: **none present.** `importlib` appears only as `from importlib import metadata` (version lookup). No shell, no eval, no dynamic template engine, no pickle. Operator scripts in `backend/scripts` take no shell input. **N/A.**

## 4. Frontend raw-HTML / JS sinks
- `dangerouslySetInnerHTML`: only `components/ui/chart.tsx:73` — injects a `<style>` block built from the developer's `ChartConfig` theme colours (hard-coded in dashboard code), never user/request data. SAFE.
- `innerHTML`: only in a `.test.tsx`. No `eval`, `new Function`, `document.write`, `insertAdjacentHTML` in `frontend/src` (non-test).
- React escapes all interpolated text; Playwright (`xss_playwright.mjs`) confirmed stored payloads in vendor name, item name and a SELF_SERVICE client report render as inert text in tables and the admin Logs UI, and a reflected `?q=` payload is inert. **No XSS found (CONFIRMED).**

## 5. Open redirect
`lib/auth-fetch.ts:31 safeNextPath()` — accepts `next` only if it starts with `/` AND not `//` AND not `/\` AND not `/login`/`/change-password`. `javascript:`, `https://evil`, `//evil`, `/\evil` all rejected. Used by every post-login / post-change-password redirect in `router.tsx`. SAFE.

## 6. QR / label URL
`reports/export_service.py:160-168` builds the QR deep link from `settings.base_url` (env), never from the request `Host`/`X-Forwarded-Host` header. No host-header poisoning. SAFE.

## 7. Client-report automatic capture (token/PII leakage)
`lib/client-reports.ts` + `lib/redact.ts` (+ unit tests `redact.test.ts`, `client-reports.test.ts`): breadcrumbs are UI events "never typed values"; `recent_requests` records request-id / path-template / status, not bodies; `redactText` strips `Authorization: Bearer ...`, `access_token`, `refreshToken`, `password`, `token`, `secret`, `cookie`, `api-key`, `otp` before send. Server side `observability/redact.py` also registers the JWT secret and PO-source password for redaction. SAFE.

## 8. File upload / download
- Download `documents/router.py:71-82`: `stored_path` is a server-generated UUID path (`documents/service.py:20`), not user input — no traversal. Authorization via `_get_scoped_asset(doc.asset_id,...)` → 404 when out of company/work-area scope (confirmed cross-company 404, IN-T050/T052).
- Response carries `Content-Disposition: attachment` + global `X-Content-Type-Options: nosniff` (`main.py:183`) → an uploaded file cannot execute in the app origin even with an attacker-chosen mime type.
- Upload `documents/service.py`: extension whitelist (`.pdf/.jpg/.jpeg/.png/.xlsx/.docx`) on the real suffix (`a.pdf.exe`→`.exe` rejected; `.html`/`.svg` rejected); 10 MB cap enforced twice (streaming `_read_bounded` + `save_document`). GAP: content is **not** validated against magic bytes and the stored `mime_type` is taken from the client (IN-T118, INFO — neutralised today by nosniff+attachment).

## Findings raised from static review
- **IN-01 (GAP)** `main.py:197-210` `/assets/{file_path:path}` → `FileResponse(dist_dir/"assets"/file_path)` with no `resolve()`/`is_relative_to` containment. In production (single-port uvicorn, no nginx) this is an unauthenticated path-traversal/arbitrary-file-read. On the sec stack nginx fronts :3411 and blocks it, and the sec API has `frontend_dist_dir` unset (404), so not runtime-reproducible locally — SUSPECTED by code review.
- **IN-02 (GAP)** every Excel import endpoint does `content = await file.read()` with no API-layer size cap (`imports/router.py:38,53,119,133,166,182`; `asset_users/router.py:85,101`; `masters/router.py` import). Unbounded buffering → memory-exhaustion DoS. Primary-owner/ADMIN only → LOW.
- **IN-03 (INFO)** document upload: no content/magic-byte validation; client-supplied mime stored and echoed on download (safe only due to nosniff + attachment).
