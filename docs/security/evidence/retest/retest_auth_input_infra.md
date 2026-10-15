# CKAM retest: AUTH, INPUT and INFRA areas (2026-10-15)

| | |
|---|---|
| Code under test | HEAD `ae706bb` (plus `4fa5c9b`, `77431ba`, `ba04371`, `7e57844`, `3e134c1`), rebuilt `ckam-sec` stack (image `ckam-sec-api` 512540c2de68), Alembic head `a3c5e7f9b1d4` |
| Targets | web http://localhost:3411 (nginx), API http://127.0.0.1:8200, Postgres 127.0.0.1:25442. Single-port production behaviour: a throw-away, **network-less** container of the same api image (`--network none`, removed afterwards) with `FRONTEND_DIST_DIR`, `ENVIRONMENT_NAME=production` and FAKE canary secrets only |
| Not touched | production, 10.x hosts, the ERP warehouse, the NAS, the internet (except `npm audit`), the owner's dev stack |
| Test cases | `retest_tests2.csv`: **310 executed** (280 PASS, 8 FAIL, 22 INFO) |
| Scripts / raw output | `aii_scripts/`, `aii_raw/` (no tokens, no stack secret; the only passwords are the documented test value and passwords of deactivated throw-away accounts) |
| Throw-away accounts | BRUTE11..BRUTE19 (ids 36-44, CKSPL operators) created as SECHO, **all deactivated afterwards**. Planted XSS payloads: vendor 7 and item 8, client report 3 (left in place for the other testers) |

Pacing: host sign-ins were at least 3.5 s apart, through cached tokens. Bursts (timing, race, rate limits) ran inside the api
container, which has its own rate-limit address, so the host address shared with the other retest agent was not used up. The
web (:3411) address was deliberately not exhausted.

## 1. Status of every finding

| ID | Sev. (orig.) | Old behaviour | New behaviour / evidence | Status |
|---|---|---|---|---|
| IF-01 / IN-01 | CRITICAL | `/assets/{path}` in single-port mode served any readable file (`..%2f`, `%2e%2e`, absolute `//etc/passwd`, `%2fetc`), including `shared/.env` and `nas.pw` in the production layout | 36 probes x 2 runs in a production-layout container: encoded, double-encoded, `%5c`, mixed `%5c`/`%2f`, `..;/`, NUL (`%00`), overlong UTF-8, absolute `//` and `%2f`, sibling prefixes `assets-evil` and `frontend-dist-evil`, symlink out of `assets/`, the directory itself, `shared/.env`, `shared/nas.pw`. **All 404, 0 leaks.** Legitimate files still 200 (including a climb-out-and-back-in path to a real asset). SPA shell route `/{path}` and the favicon allow-list return only `index.html` or the listed files (`/secret_in_dist.txt` gives the shell). No 5xx. `RT-AU-T801..T836`, `aii_raw/if01_run1.txt`, `if01_run2.txt` | **FIXED** in code. Production stays vulnerable until EXT-01 deploy and EXT-02 rotation |
| IF-03 | MEDIUM | CKSPL operator read the CKVPL ERP PO draft (and the reverse) | Both directions 404. Own company 200. List shows only own company. Receipts and PI 404. Head-office admin 200 (by design). `RT-AU-T601..T608` | **FIXED** (exercised on the local ERP copy: no ERP link on this stack) |
| IF-04 / AU-09 | MEDIUM | Production started with the committed placeholder JWT secret | `ENVIRONMENT_NAME=production` refuses to start with: the dev default, secret unset, `change_me_too`, a 31-character secret, an empty secret, `PROD`, `" Production "`. Starts with 32 and 48 characters. Refusal message does not echo the secret. `RT-AU-T901..T913` | **FIXED**. Residual: see **RT-AII-N4** (depends on the exact environment name) |
| AU-11 / IF-14 | LOW | `/docs`, `/redoc`, `/openapi.json` open in production | Production without the dist folder: all three 404. With the dist folder they get the SPA shell (no API map). Still open in this security-test stack by design (`RT-AU-T426`) | **FIXED** (same N4 dependence) |
| AU-01 | MEDIUM | Existing-account sign-in about 42 ms vs about 7 ms for unknown, disabled or locked accounts | 36 samples each, in-container, interleaved. Median ms: existing account, wrong password **41.8**; non-existent **39.4**; deactivated **39.4**; sign-in off **42.2**; locked **40.1**; right password **42.0**. Spread of medians 2.8 ms, with overlapping p10..p90 ranges. `RT-AU-T990..T996`, `aii_raw/timing_out.json` | **FIXED** |
| AU-02 | LOW | 423 tells an outsider an account is locked | 423 for the right password **and** for a wrong one (SECLOCK). Lead decision: a lock that answered differently to the right password would become a password-guessing oracle. `RT-AU-T301/302` | **ACCEPTED** (LOW) |
| AU-03 | MEDIUM | No per-address limit (171 failures, no block) | Login: #21 from one address gets 429 with `Retry-After: 60` and "Too many sign-in attempts. Wait a minute and try again." (also in `errors[]`). #11 on one login id gets 429, and the id key ignores case and spaces. Refresh: #61 gets 429. Change-password: #11 gets 429. The window recovers. Spoofed `X-Forwarded-For` from a LAN-like peer is ignored (429). `RATE_LIMITED` SECURITY rows written, no password. `RT-AU-T1002..T1011` | **FIXED**. Residuals **RT-AII-N2** (loopback XFF) and **RT-AII-N3** (Docker/UAT shared bucket) |
| AU-04 | MEDIUM | Anyone can lock a real user out | Still true by design: 5 wrong guesses lock BRUTE12 for 15 min, then the right password gets 423 (`RT-AU-T313/314`). The limits only slow mass lock-outs. One address can send 20 attempts/min, i.e. 4 locks/min, so it can keep about **60 accounts** locked continuously (20/min / 5 x 15 min, calculated, not executed). The per-login-id limit (10/min) also lets an outsider keep one id answering 429 | **MITIGATED** (residual accepted design; MFA / CAPTCHA-free options in EXT-19) |
| AU-05 | MEDIUM | Logout did not revoke the refresh token | Logout: the same device's access and refresh tokens and older rotated refresh tokens all 401. A second device of the same account is also 401 (sign-out ends every session). Unaffected user still 200. Stale or foreign cookie cannot sign anyone out. Password change: old access and refresh 401, new cookie keeps the user signed in. Admin reset: old tokens 401. `RT-AU-T101..T115, T134` | **FIXED** |
| AU-06 | LOW | Refresh rotation not functional; old refresh reusable | A new refresh token on every call (unique `jti`, even within one second). **But an older, already-rotated refresh token is still accepted** until sign-out or password/access change or expiry (8 h): no reuse detection. `RT-AU-T102..T104` | **MITIGATED** (residual LOW: see 3.1) |
| AU-07 | LOW | Sign-in switched off left the access token valid for up to 15 min | `login_enabled=false`: live access 401 at once, refresh 401. Switching it back on does not revive old tokens. Deactivation, role change, work-area change and company-access change all give 401/401. Harmless edits (phone, re-saving the same companies) do **not** end the session. `RT-AU-T120..T133` | **FIXED** |
| AU-08 | LOW | Length-only password policy | Refused with plain sentences: common (case-insensitive), digit/letter/keyboard runs, same character, `Citykart2026`, `ckam@123`, `CITYKART#2026!`, containing own code, name word, surname; too short or long; same as old. Strong passphrase accepted. Admin reset, then temp sign-in (must change), then a strong password works. **But `Password@2026` and `Welcome@2026` were accepted** (fixed ~100-word list). `RT-AU-T201..T221, T135/T136` | **MITIGATED** (residual LOW: see 3.2) |
| AU-10 / IF-05 / IF-06 | MEDIUM | TRUNCATE emptied audit tables; `SET ckam.allow_audit_purge=on` deleted the newest audit rows | As the app role, in a rolled-back transaction: UPDATE/DELETE/TRUNCATE refused on `audit_log`, `asset_event`, `master_audit` (TRUNCATE; table empty, so row triggers could not be exercised), `asset_field_change`. With the flag, the newest row and every row under 5 years old are refused. `ckam_purge_audit_log(now())` and `(now()-4y11m)` refused; without the flag refused; EXECUTE owner-only. A least-privilege role simulation is refused for everything. **Residual (unchanged): the owner/superuser can `DISABLE TRIGGER` then TRUNCATE, or use `session_replication_role=replica`**. The Docker app role `ckam` is a superuser. `RT-AU-T9800..T9821`, `aii_raw/rt_append_only.out.txt` | **MITIGATED** (code part FIXED; owner/superuser bypass OPEN EXTERNAL, EXT-07) |
| AU-12 | LOW | `*.js.map` "reachable" (SPA shell 200) | Entry bundles' `.map`: 404. Made-up `/assets/x.js.map` and `/assets/does-not-exist.js`: nginx 404, not the shell. 0 `sourceMappingURL` comments. `RT-AU-T411..T414` | **FIXED** |
| AU-14 | LOW | No CSP / Permissions-Policy | Present (exactly one copy) on web and API 200/401/404/413/422, SPA shell, assets, single-port production. No `unsafe-eval`, no inline script. Playwright as SECHO (24 screens) and SECOPIT (10 screens): **0 CSP violations, 0 page errors, 0 bounces to login**. QR blob images render. Browser reports camera, microphone, geolocation, payment and usb all false. `RT-AU-T401..T425, T451..T458` | **FIXED** |
| AU-15 | LOW | `Server: nginx/1.x`, `uvicorn`; HTML 413 from nginx; no cap without nginx | `Server: nginx` / `uvicorn` (no version). 12 MB through nginx gets a JSON 413 with a plain sentence (no request id: nginx answers first). **Single-port production still has no request-body cap**: see **RT-AII-N1** | **MITIGATED** (Docker FIXED; production part OPEN as N1) |
| AU-16 | LOW | 20 parallel guesses: 6 processed, lock-out exceeded | 20 parallel wrong guesses on BRUTE11: 10 x 401 + 10 x 429 (per-id limit). DB `failed_login_count = 5`, **one** LOCKED event, the 5 late ones logged "wrong password while locked (not counted)". `RT-AU-T1001` | **FIXED** |
| IF-10 | MEDIUM | ERP reads had no timeouts | `PgErpSource` session: `default_transaction_read_only=on`, `statement_timeout=60000`, `application_name=ckam`; warehouse copy 120000. Every query in a READ ONLY transaction. Black-hole listener gives 503 "could not be reached (TimeoutError)" after **10.01 s** (3.00 s with `ERP_CONNECT_TIMEOUT_SECONDS=3`). 192.0.2.1 gives 503 at once (no network). Against a local Postgres stand-in: `pg_sleep(6)` with a 2 s limit gives 503 "took too long" at 2.02 s. CREATE TEMP TABLE refused (read-only). Switching to read-write refused. `RT-AU-T970..T979` | **FIXED** (TLS/role-level read-only remain EXT-25 / IF-16) |
| IN-02 | LOW | Import uploads read without size limit | 16 MB straight to the API (asset and PO import) gets 413 "larger than 15 MB...". Non-workbook gets 422. Unauthenticated 256 MB multipart gets 401 with no memory growth. `RT-AU-T610..T612, T961` | **FIXED** |
| IN-03 | INFO | Extension-only check; browser-claimed MIME stored | HTML as `.png`, script as `.pdf`, PNG as `.jpg`, bare zip as `.xlsx`, and `.html` all get 422 with plain sentences. Real PNG uploaded as `text/html` is stored as `image/png` and downloaded as `image/png`, `attachment`, `nosniff`. HTML/PDF polyglot with `%PDF-` inside the first 1 KB is accepted, harmlessly (served as PDF attachment + nosniff). `RT-AU-T620..T627` | **FIXED** |
| Primary-Owner login clash | LOW | An employee with code = Primary Owner name blocked the head-office login | With employee id 34 (code `SECHO`) present: `SECHO` and `secho` sign in as id 2 (Primary Owner). `RT-AU-T311/312` | **FIXED** |
| IF-02 / AU-13 | HIGH / LOW | Plain HTTP; refresh cookie not `Secure` | Not code-fixable here (cookie still `HttpOnly; SameSite=lax; Path=/api/auth`, no `Secure`) | OPEN EXTERNAL (EXT-04), not retested |

Regression batteries re-run, all PASS:

- INPUT SQLi/sort/numeric/search battery: 39 rows, no 5xx, no timed sleeps (`RT-AU-T7000..T7073`).
- Secret-field and self-service batteries (`RT-AU-T7074..T7080`).
- Stored and reflected XSS inert on every screen visited.
- CORS/CSRF: no `Access-Control-Allow-Origin` for evil or `null` origins, preflight 405.
- Error sweep: 17 malformed requests on auth, assets, people, admin logs and ERP routes, all 4xx with a request id, no stack/SQL/path. `error_log` has 0 rows of 5xx during the whole retest.
- Logs: test password, every password typed in this retest, JWTs and refresh-cookie values are found in none of `app.jsonl`, `audit.jsonl`, `error.jsonl`, `audit_log`, `error_log`, `client_report` or `system_event`.
- Dependencies: `npm audit --omit=dev` 0 of 141 (unchanged). The rebuilt image's `pip freeze` is identical to the earlier one (`ecdsa`/`python-jose` advisories unchanged, IF-12 accepted; `constraints.txt` pins the same versions).

## 2. New findings

### RT-AII-N1: No request-body size limit in single-port production; unauthenticated sign-in requests can exhaust memory (CONFIRMED)

| | |
|---|---|
| Category / CWE / OWASP | Uncontrolled resource consumption / CWE-770 / API4:2023 (unrestricted resource consumption), A05:2021 |
| Component | `backend/app/main.py` (no body-size middleware); `POST /api/auth/login` (body is parsed before the handler and the rate limiter run); production `uvicorn` on 10.0.1.98:3211 with no nginx in front |
| Preconditions | None (unauthenticated). The production port is forwarded to the internet (EXT-05) |
| Reproduce | Throw-away production-mode container: `aii_scripts/bigbody.py 8000 256`. It POSTs a 256 MB JSON `{"login_id":"x","password":"aaaa..."}` to `/api/auth/login` |
| Evidence | `422 "Password is too long"` only **after** the full body was read. uvicorn RSS 129 MB to 652 MB, peak 914 MB. A 64 MB body peaks at 324 MB (about 3.5x the body). Multipart import uploads are not affected (401 before the body is read, RSS unchanged). The Docker stack is protected by nginx `client_max_body_size 11m` (JSON 413, `RT-AU-T409`) |
| Impact | A few parallel large requests push one process to several GB. On a server shared with Spinwheel and Citykart Desk that can kill CKAM (OOM) or starve the other apps. Not a data risk |
| Likelihood | Medium (internet-reachable, trivial, no account needed). The sign-in rate limit does not help: it runs after the body is parsed |
| Severity | **MEDIUM**. CVSS 3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` = 5.3 (A:H, 7.5, if the shared server is affected) |
| Root cause | AU-15 limited the body only in `frontend/nginx.conf`. The single-port production server has no equivalent |
| Fix | In `main.py`, add a pure ASGI middleware (outermost, before `RequestContextMiddleware`) that answers 413 JSON when `Content-Length` exceeds a limit, and counts bytes of chunked bodies, aborting past the limit. Suggested limits: 16 KB for `/api/auth/*`, 11 MB elsewhere (documents 10 MB, imports 15 MB, so imports need about 16 MB), same plain sentence as nginx. Alternatively put the planned HTTPS proxy (EXT-04) in front with a body limit |
| Regression test | `test_body_limit_single_port`: POST `/api/auth/login` with `Content-Length: 2000000` gets 413 JSON and the handler is never called. A chunked 20 MB body to `/api/imports/assets/preview` gets 413 |

### RT-AII-N2: uvicorn's default proxy trust lets any loopback client choose its "address", bypassing the per-address limit and forging audit IPs (CONFIRMED)

| | |
|---|---|
| Category / CWE / OWASP | Reliance on untrusted header / CWE-348, CWE-290 / A07:2021, A09:2021 |
| Component | `backend/Dockerfile` CMD and the production launcher run `uvicorn` with its default `--proxy-headers --forwarded-allow-ips=127.0.0.1`. uvicorn rewrites `scope["client"]` from `X-Forwarded-For` **before** `app/observability/middleware.py::client_ip` applies `TRUSTED_PROXIES` (empty) |
| Preconditions | Requests that reach uvicorn from 127.0.0.1: any process on the CKAM server (on 10.0.1.98, other apps and their users share the host), or an SSRF in another local app |
| Reproduce | `aii_scripts/xff.py` (inside the api container). After 20 sign-in failures the 21st plain request gets 429, but the 22nd with `X-Forwarded-For: 203.0.113.77` gets **401** (processed). From the container's network address the same header gets **429**. `audit_log.ip` shows `203.0.113.77`, `203.0.113.9`, `198.51.100.7` |
| Impact | Unlimited per-address sign-in attempts from the server itself (the per-login-id limit and the 5-try lock still apply), and a forged IP in the security audit trail |
| Likelihood | Low (needs local access to the server) |
| Severity | **LOW** |
| Fix | Run uvicorn with `--no-proxy-headers` (or `--forwarded-allow-ips=""`) in `backend/Dockerfile` and in the production launcher (EXT-13), so `TRUSTED_PROXIES` is the only place that decides whether `X-Forwarded-For` is believed. When the HTTPS proxy (EXT-04) arrives, set `TRUSTED_PROXIES=127.0.0.1` |
| Regression test | `test_xff_from_loopback_not_trusted_without_trusted_proxies`: start the app with the same uvicorn flags, exhaust the limit from 127.0.0.1, then a request with XFF still gets 429 and `audit_log.ip == "127.0.0.1"` |

### RT-AII-N3: Docker stack (dev/UAT): every browser user shares the nginx container's address, so 20 sign-ins per minute in total (CONFIRMED by evidence, not exhausted)

| | |
|---|---|
| CWE / OWASP | CWE-770 / A05:2021 |
| Component | `frontend/nginx.conf` `location ^~ /api/` sends no `X-Forwarded-For`; `docker-compose.yml` api has no `TRUSTED_PROXIES` |
| Evidence | The two Playwright sign-ins through :3411 are recorded as `ip=172.25.0.4` (the nginx container). Code: `rate_limit.client_address` uses that peer, so everyone using :3411 shares one 20/min login, 60/min refresh and 10/min change-password bucket. Not exhausted, to avoid blocking the other retest agent's browser session |
| Impact | On the dev or UAT stack, one person mistyping repeatedly (or 21 people signing in within a minute, e.g. a UAT session start) blocks everybody for up to 60 s. Audit IPs are useless there. **Production is not affected** (single uvicorn, real client addresses) |
| Severity | **LOW** (dev/UAT availability and audit quality) |
| Fix | nginx: `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, do not append). Compose: `TRUSTED_PROXIES: 172.16.0.0/12` (or the nginx service address) for `api` |
| Regression test | e2e: two sign-ins through :3411 with different client addresses are recorded with different `audit_log.ip`; 21 failures from one client do not block a second client |

### RT-AII-N4: Production-only protections fail open unless `ENVIRONMENT_NAME` is exactly production/prod (CONFIRMED)

| | |
|---|---|
| CWE / OWASP | CWE-1188 (insecure default), CWE-798 / A05:2021 |
| Component | `backend/app/main.py::is_production`, `refuse_to_start_with_insecure_secret`, `docs_urls`; `core/config.py` `environment_name="development"` |
| Evidence | `RT-AU-T910..T913`: `ENVIRONMENT_NAME` unset, `prd` or `live` with the committed `dev_secret_change_me` starts (a warning line only) and serves `/docs`, `/redoc`, `/openapi.json`. `JWT_SECRET` of 40 spaces passes the length rule in production |
| Impact | The IF-04 and AU-11 protections depend on one manual `.env` line in `shared\.env` on 10.0.1.98. Docs say "set production"; whether the live `.env` has it is not evidenced. If it is missing, a forgotten or placeholder secret again allows forged admin tokens |
| Severity | **LOW** (needs a misconfiguration, but that is exactly what IF-04 is about) |
| Fix | Treat single-port mode (`FRONTEND_DIST_DIR` set) as production for these checks, **or** invert the default: refuse placeholder or short secrets unless `ENVIRONMENT_NAME` is explicitly `development`/`test`/`security-test`. Also reject secrets with fewer than about 16 distinct characters. Add to the deploy checklist: after restart, `system_event app_started` shows `environment=production` and `/openapi.json` is 404 |
| Regression test | `test_single_port_mode_counts_as_production`: `FRONTEND_DIST_DIR` set + `ENVIRONMENT_NAME` unset + placeholder secret makes startup raise. `test_low_entropy_secret_refused` |

### INFO observations (no finding)

- **N5**: Proxied `/api` responses on :3411 carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Cache-Control` **twice** (API and nginx). The values are identical, browsers accept them, and CSP and Permissions-Policy appear once. Tidy-up: `proxy_hide_header` those four as well (`RT-AU-T403..T405`).
- **N6**: In single-port production an unknown `/api/...` path returns the SPA shell with 200 instead of a JSON 404. Pre-existing; affects error handling only. Fix: `_serve_frontend_shell` raises 404 for `api/` paths (`RT-AU-T952`).
- **N7**: Sign-out ends **every** session of the account by design (`RT-AU-T109`). With shared store logins (EXT-30), one person signing out signs out every device using that store login. This is the expected kind of unexpected session end, worth telling store users. Using a revoked token is audited as `INVALID_TOKEN` (at most one row per address and minute), and the row does not name the account.
- **N8**: Changing someone's login e-mail does not end their session (`RT-AU-T131`). This is acceptable: it is not an access change.
- **N9**: An `audit_log` row can be INSERTed with an old `at` and is then purgeable with the flag (`T12`). This only concerns rows the inserter forged themselves; real recent rows cannot be backdated (UPDATE refused).
- Malformed integers and NUL bytes reach PostgreSQL and are mapped to a friendly 422. Logged as WARNING with a request id, never a 5xx.

## 3. Residuals of fixed or mitigated findings (for the risk register)

1. **AU-06 residual (LOW)**: no refresh-token reuse detection. A refresh cookie copied before the owner refreshed stays usable for up to 8 h unless the owner signs out or changes password/access. Fix: store the current refresh `jti` (or a hash) per account or per session, refuse an older one, and on reuse end all sessions (`token_version += 1`). Test: `test_rotated_refresh_token_reuse_is_refused_and_ends_sessions`.
2. **AU-08 residual (LOW)**: the common-password list is fixed and small, so `Password@2026`, `Welcome@2026` (and by construction `Admin@2026`, `Qwerty@123`, `India@2026`) are accepted. Fix: normalise before comparing (strip trailing digits/symbols and a 4-digit year, de-leet `@`/`0`/`1`/`$`), then check the base word against a larger list (for example the top 10k from a public breach corpus, shipped as a file). Test: those five refused, `Granite#Meadow-4418` accepted.
3. **AU-04 residual (MEDIUM, accepted design)**: targeted lock-outs remain possible (5 guesses per 15 min per victim). With one address, about 60 accounts can be kept locked. Mitigations are external (EXT-05 restricting the internet forward, EXT-19 MFA) or design (progressive delays instead of hard locks).
4. **AU-10/IF-05/IF-06 residual**: the table owner or a superuser can still disable or drop the triggers or use replica mode: EXT-07 (separate runtime role).
5. **IF-01**: tested on Linux. Production is **Windows**. The code (`Path.resolve()` + `is_relative_to`) also covers backslash, drive-letter and UNC paths on Windows by design, but that could not be executed here. After EXT-01, run the EXT-01 "done when" probes (plus `..%5c`, `C:%2fWindows%2fwin.ini`, `%5c%5cserver%5cshare`) against production.

## 4. What could not be exercised, and why

- Windows path semantics for IF-01 and the real production launcher flags (no Windows host in scope; launcher not in git, EXT-13).
- A real ERP (IF-03 used CKAM's local ERP copy; IF-10 used a black-hole listener, TEST-NET, and the local sec Postgres as a stand-in. No ERP TLS (IF-16/EXT-25)).
- HTTPS / `Secure` cookie (IF-02/AU-13: needs EXT-04).
- `master_audit` row triggers: the table is empty on this stack (TRUNCATE trigger verified).
- Mass lock-out (AU-04) and exhausting the :3411 address bucket (N3): calculated and proven from code and audit rows, not executed, to avoid locking real personas or blocking the parallel retest agent.
- `pip-audit` was not re-run online; the installed versions are byte-identical to the earlier audited set, so the earlier result stands.
