# WP-C — frontend / infrastructure closure evidence (2026-10-16)

Scope: FONTS, IF-13, N3, N5, AU-12 / OBS-AU12-TEST (with the nginx parts of AU-15), IF-15 (code/reference side,
with N2 launcher and IF-11 release script), IF-09 (inspection + plan only), npm audit re-check. Everything ran on the
dev PC only (10.0.0.47). Nothing was run against production, the database server, the NAS or the ERP. No git write
command was used; the lead commits. The backend copy of the CSP (`backend/app/main.py`) and its test
(`backend/tests/test_vapt_headers_and_docs.py`) are outside this package and must be mirrored by the lead (exact
string below).

Raw files: `raw/` next to this file. Test ids are new and unique (`CL-WPC-…`).

## Files changed

| File | Change |
|---|---|
| `frontend/index.html` | the three Google Fonts `<link>` lines removed |
| `frontend/src/fonts.css` (new), `frontend/src/main.tsx` | self-hosted `@font-face` rules (Inter variable latin + latin-ext; IBM Plex Mono 400/500/600 latin + latin-ext), imported first |
| `frontend/package.json`, `frontend/package-lock.json` | `@fontsource-variable/inter` 5.3.0 and `@fontsource/ibm-plex-mono` 5.3.0 (exact); scripts `check:build`, `check:nginx-live` |
| `frontend/nginx.conf` | CSP without Google hosts; N3 forwarded-address overwrite; N5 `proxy_hide_header` for the six headers nginx adds itself; missing fonts / pictures also a plain 404 |
| `frontend/src/security/nginx-config.test.ts` (new) | 12 static checks of `nginx.conf`, `vite.config.ts`, `index.html` |
| `frontend/scripts/check-build-security.mjs` + `.test.mjs` (new) | post-build check + 5 self-tests |
| `frontend/scripts/check-nginx-live.mjs` (new) | `nginx -t` + throw-away nginx container checks |
| `backend/Dockerfile`, `backend/.dockerignore` (new) | multi-stage `dev` / `runtime`, non-root uid 10001, `-c constraints.txt` |
| `docker-compose.yml` | `volume-init` one-shot service; api: `target: dev`, `cap_drop: [ALL]`, `no-new-privileges`, `TRUSTED_PROXIES` = nginx's fixed address; web on a fixed address on the new `edge` network |
| `ops/windows/` (new) | `run_ckam_web.ps1.template`, `deploy_ckam.ps1.template`, `verify_release.ps1`, `rollback_release.ps1.template`, `README.md` |
| `docs/ai/CKAM_RELEASE_RUNBOOK.md`, `docs/ai/CKAM_PRODUCTION_SERVER_CHECKLIST.md`, `docs/ai/PRODUCTION_INFRASTRUCTURE.md` | status line + Windows production section / pointers |

## 1. FONTS — self-hosted fonts, Google hosts out of the CSP

**New CSP (nginx; the backend copy must be identical):**

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

Only the latin and latin-ext subsets and only upright styles are declared. Inter is one variable file per subset
(covers 400 / 500 / 600 / 650 / 700); Plex Mono 400 / 500 / 600. The family names stay `"Inter"` and
`"IBM Plex Mono"`, so `--font-sans` / `--font-numeric` and every style are unchanged. The ₹ sign (U+20B9) is in the
latin-ext range of both fonts.

Method: the build before and after the change, each served by a throw-away static server
(`raw/fonts/server.mjs`) that sends the CSP read from that build's `nginx.conf` and proxies `/api` to the `ckam-sec`
API (127.0.0.1:8200); Playwright (`raw/fonts/drive.mjs`) signs in once as SECHO at 1366x768 and visits login, Home,
Assets, Asset 360, PO list, PO page, Receive, Move, Reports, Settings, Logs and the Report-a-problem dialog.

| Id | Check | Before (Google Fonts) | After (self-hosted) |
|---|---|---|---|
| CL-WPC-01 | Requests to fonts.googleapis.com / fonts.gstatic.com | 55 (11 + 44) | **0** (all 155 requests to the app's own address) |
| CL-WPC-02 | CSP violations (`securitypolicyviolation` events) | 0 | **0** |
| CL-WPC-03 | Console errors / page errors | 0 / 0 | **0 / 0** |
| CL-WPC-04 | Font files loaded | 44 responses from gstatic | 44 responses `200 font/woff2` from `/assets/*.woff2` |
| CL-WPC-05 | Fonts really in use | `Inter`, `IBM Plex Mono` faces loaded | `document.fonts`: `Inter 100 900` (latin, latin-ext) and `IBM Plex Mono 600` loaded; `document.fonts.check()` true for Inter 400 / 650 / 700 and Plex 600; computed `font-family` of html/body `Inter, system-ui, sans-serif` |
| CL-WPC-06 | ₹ drawn by the web font (canvas width with two very different fallbacks must be equal) | Inter 17.328 / 17.328 px, Plex 19.200 / 19.200 px | **identical**: Inter 17.328 / 17.328, Plex 19.200 / 19.200 |
| CL-WPC-07 | Screenshots 1366x768, pixel comparison (`raw/fonts/compare.mjs`) | — | login, Assets, Asset 360, PO list, **PO page, Receive**, Move, Reports, Settings: **0 different pixels**. Home: 2,050 px, all inside one line (y 356–369, the live "16 user reports need a look" count); Logs and the dialog: changed live log rows only. Typography unchanged |
| CL-WPC-08 | `npm run check:build` on the build | before build: FAIL (4 problems: Google host and 3 external links in `index.html`) | **OK** |

Bundle delta (`vite build`): JS unchanged (1,374.25 kB); CSS 100.26 → 102.84 kB (+2.58 kB; gzip 17.78 → 18.17 kB);
`index.html` 0.79 → 0.47 kB; plus 8 font files, 219,644 bytes in total (Inter latin 48.3 kB, latin-ext 85.1 kB;
Plex Mono 6 files 13.3–15.6 kB). `dist/` grew from 2,461,061 to 2,682,972 bytes (+221,911). A browser downloads
only the subsets and weights a page uses (on Home: Inter latin and Plex latin 600; latin-ext only when a page shows
such a character, e.g. ₹), about what it used to fetch from Google, now from CKAM itself.

Production note: single-port uvicorn serves the fonts through the existing `/assets/{file}` route
(`FileResponse`, type from the file extension); `nosniff` does not block fonts. Not executed on Windows.

Raw: `raw/fonts/before|after/playwright_result.json`, 5 screenshot pairs, `raw/fonts/screenshot_compare.json`.

## 2. IF-13 — non-root dev/UAT image

Design: `backend/Dockerfile` has a `base` stage (user `ckam`, uid/gid 10001; `/data/uploads`, `/data/logs` owned by
it), a `dev` target (`pip install -c constraints.txt -e ".[dev]"`, copies `tests/`, `PYTEST_ADDOPTS=-p
no:cacheprovider`) used by compose, and a `runtime` target (runtime packages only, no tests), the default when no
target is named. Both end with `USER 10001:10001` and the `--no-proxy-headers` CMD. `/app` stays root-owned, so the
process cannot change its own code.

Existing root-owned volumes: a one-shot compose service `volume-init` (same image, `user: "0:0"`, `network_mode:
none`, `cap_drop: [ALL]`, `cap_add: [CHOWN, DAC_READ_SEARCH]`, `no-new-privileges`) runs
`find /data/uploads /data/logs ( ! -user 10001 -o ! -group 10001 ) -exec chown -h 10001:10001 {} +` and exits; the
api waits for it (`service_completed_successfully`). Chosen over a root entrypoint that drops privileges, because
then the long-running API never runs as root even for a moment, keeps zero capabilities (an entrypoint would need
CHOWN + SETUID + SETGID in the API container), and `docker compose exec api …` (pytest, alembic) also runs as uid
10001. It re-runs on every `docker compose up`, so files restored as root later (e.g. by `ops/restore.sh` in the
`backup` container) are handed over again. Data is never moved or deleted; `-h` never follows a link.

The api container is **not** given `read_only: true`: `docker compose cp backend/app/. api:/app/app/` (the code-sync
step used before pytest) needs a writable root filesystem. The process still can write only `/data/uploads`,
`/data/logs` and `/tmp` (proved below). The `runtime` image was run with `--read-only`.

Throw-away project `ckam-nr` (web 3511, api 8300, db 25452, edge subnet 172.31.219.0/28, env file with throw-away
values and empty `PO_SOURCE_*`), built from a clean `git archive` copy of `backend/` at `3362c1b` (taken before
WP-A1's `7b039fb` landed) plus the new Dockerfile / compose, so other engineers' unfinished backend edits did not
affect the proof.

| Id | Proof | Result |
|---|---|---|
| CL-WPC-10 | **(b) pre-existing root volumes**: started `ckam-nr` with the OLD compose + OLD root image, migrated, created `/data/uploads/999/old-doc.txt` and `/data/logs/old-marker.txt` as root (`uid=0`); then `up -d --build api web` with the NEW files on the same project | `volume-init: /data/uploads and /data/logs belong to uid 10001`, exited 0; api `Up`; both old files intact (`old-upload`, `old-log`) and now `10001:10001`; old `app.jsonl` kept growing (written by the new process); edge network created and containers recreated without a manual step |
| CL-WPC-11 | Process identity (`/proc/1/status`, `/proc/1/cmdline`) | `Name: uvicorn`, `Uid 10001 10001 10001 10001`, `Gid 10001 …`, `CapEff 0000000000000000`, `CapBnd 0000000000000000`, `NoNewPrivs 1`; cmdline `… uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-proxy-headers` |
| CL-WPC-12 | Upload written + read back by the app's own `documents.service.save_document` as the container user (`raw/docker/upload_probe.py`), into the old root-made folder 999 and a new folder | `uid=10001 wrote /data/uploads/999/<uuid>.pdf size=44 owner=10001:10001 read_back_equal=True` (and the same for 1000) |
| CL-WPC-13 | `alembic upgrade head` / `alembic current` as uid 10001 | exit 0; `a3c5e7f9b1d4 (head)` |
| CL-WPC-14 | A file restored later as root (`docker run … postgres:17-alpine` writes `/u/2000/restored.txt` as 0:0), then `docker compose up -d api` | volume-init re-ran; file now `10001:10001` |
| CL-WPC-15 | **(a) fresh volumes** (`down -v`, `up -d api web`) | api starts; `/api/health` 200 direct (8300) and through nginx (3511); `alembic upgrade head` ran 41 migrations, exit 0, head `a3c5e7f9b1d4`; upload written and read back (`/data/uploads/1/…`, `10001:10001`); `/data/logs/app.jsonl` + `error.jsonl` written by `10001:10001` (the only error line is the expected "database is at migration None" before the migration) |
| CL-WPC-16 | What the dev-target process can write | `/app`, `/app/app`, `/etc`: `Permission denied`; `/tmp`, `/data/uploads`, `/data/logs`: writable |
| CL-WPC-17 | **(c) dev target runs pytest** against its own `ckam_test` (created by `ops/init-test-db.sql`, migrated first) as uid 10001: `tests/observability/test_file_logs.py tests/documents/test_router.py tests/core/test_body_limit.py tests/test_static_frontend.py` | **30 passed**, no cache / permission warnings (`raw/docker/dev_pytest_subset.out`); after `docker compose cp backend/app/. api:/app/app/` and `backend/tests/.` into the running container: `test_body_limit.py` 5 passed (the sync workflow still works) |
| CL-WPC-18 | **(d) runtime image** (`docker build --target runtime`, `raw/docker/runtime_check.sh`) | `uid=10001(ckam)`; `/app`: `alembic.ini app ckam_backend.egg-info constraints.txt pyproject.toml scripts`; tests dir **absent**; modules `pytest`, `_pytest`, `coverage`, `pytest_asyncio`, `pytest_cov`, `httpx` **absent**; no `pytest` command; fastapi / uvicorn / sqlalchemy / asyncpg / alembic import fine |
| CL-WPC-19 | runtime image with `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges` on the project's network and volumes | `/api/health` 200; upload written + read back as 10001; writing `/app/x.txt`: `Read-only file system`; `ReadonlyRootfs=true CapDrop=[ALL] User=10001:10001` |

## 3. N3 + N5 — real client address through nginx, each header once

`nginx.conf` `/api/`: `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, never
`$proxy_add_x_forwarded_for`), `X-Real-IP $remote_addr`, `X-Forwarded-Proto $scheme`, `Host $host`; `proxy_hide_header`
for `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`, `Permissions-Policy`,
`Cache-Control` (nginx adds its own, identical values, `always`). Compose: `web` only on the `edge` network at
`${CKAM_WEB_IP:-172.31.211.10}` on `${CKAM_EDGE_SUBNET:-172.31.211.0/28}`; api on `default` + `edge`;
`TRUSTED_PROXIES: ${CKAM_WEB_IP:-172.31.211.10}` — that single address, no Docker range.

Proof on `ckam-nr` (edge 172.31.219.0/28: gateway .1, web .10, api .2), script `raw/docker/n3_probe.mjs`:

| Id | Request | Address the API recorded (access line in `/data/logs/app.jsonl`, `raw/docker/n3_access_lines.jsonl`) |
|---|---|---|
| CL-WPC-20 | from the host through nginx, with a forged `X-Forwarded-For: 1.2.3.4` and `X-Real-IP: 1.2.3.4` | `172.31.219.1` (where Docker delivers the host's connection) — forged value **overwritten** |
| CL-WPC-21 | from a second container on the edge network through nginx | `172.31.219.3` — a **different** address |
| CL-WPC-22 | from the host straight to the API port (8300) with `X-Forwarded-For: 1.2.3.4` | `172.26.0.1` (the default-network gateway) — **not believed** |

| Id | Sign-in rate limit (20 / min per address; distinct login ids so the per-id limit is not what trips) | Result |
|---|---|---|
| CL-WPC-23 | 21 failed sign-ins from the host through nginx | 20 × 401, then **429** |
| CL-WPC-24 | then the host again with a forged `X-Forwarded-For: 9.9.9.9` | **429** (no new bucket) |
| CL-WPC-25 | then one failed sign-in from the second container | **401** (its own bucket, not blocked) |
| CL-WPC-26 | `audit_log` rows of that minute (`raw/docker/n3_audit_rows.txt`) | `172.31.219.1`: 20 LOGIN_FAILED, 1 RATE_LIMITED, 1 INVALID_TOKEN; `172.31.219.3`: 1 LOGIN_FAILED |

| Id | Header count through nginx (raw response headers counted, `raw/docker/n3_result.json`) | Status | CSP | Permissions-Policy | nosniff | X-Frame-Options | Referrer-Policy | Cache-Control |
|---|---|---|---|---|---|---|---|---|
| CL-WPC-27 | `/` | 200 | 1 | 1 | 1 | 1 | 1 | 1 (`no-cache`) |
| | `/assets/x` (SPA route) | 200 | 1 | 1 | 1 | 1 | 1 | 1 |
| | `/assets/nothing.js` | 404 | 1 | 1 | 1 | 1 | 1 | 0 |
| | `/assets/nothing.js.map` | 404 | 1 | 1 | 1 | 1 | 1 | 0 |
| | `/api/health` | 200 | 1 | 1 | 1 | 1 | 1 | 1 (`no-store`) |
| | `/api/auth/capabilities` without token | 401 | 1 | 1 | 1 | 1 | 1 | 1 |
| | `/api/does-not-exist` | 404 | 1 | 1 | 1 | 1 | 1 | 1 |
| | `POST /api/documents`, 12 MB `Content-Length` | 413 | 1 | 1 | 1 | 1 | 1 | 1 |

`X-Request-ID` once on every API answer; `Server: nginx` (no version). Before the change the running dev stack sent
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Cache-Control` twice on `/api/` answers
(`verify_release.ps1` against `http://localhost:3211`, section 5).

Several stacks from this compose file at the same time (`ckam-build`, `ckam-uat`, `ckam-sec`) each need their own
`CKAM_EDGE_SUBNET` / `CKAM_WEB_IP` in their env file, otherwise Docker refuses the second one ("Pool overlaps").
Production is unaffected (no nginx, no Docker; `TRUSTED_PROXIES` stays empty there).

## 4. AU-12 / OBS-AU12-TEST — permanent checks

| Id | Check | Result |
|---|---|---|
| CL-WPC-30 | `src/security/nginx-config.test.ts` (vitest, 12 tests): `server_tokens off`; body limit + JSON 413; CSP (`'self'`, no `unsafe-eval`, no Google / http host); Permissions-Policy; the five security headers exactly once with `always` on the server and on every location that sets headers; `.map` → 404; missing static file → `=404` (pattern checked against real file names and SPA routes); SPA fallback + `no-cache` shell; `/api/` overwrite lines and no `$proxy_add_x_forwarded_for`; the six `proxy_hide_header`; `vite.config.ts` `sourcemap: false`; `index.html` with no external resource | 12 passed. Mutation check: with the old `nginx.conf` copied in, 4 fail (CSP Google hosts, static 404 for fonts, N3, N5), then restored |
| CL-WPC-31 | `scripts/check-build-security.mjs` (`npm run check:build`) + 5 self-tests (`scripts/check-build-security.test.mjs`, in vitest) | current build: OK (15 files); old build: FAIL (Google host + 3 external links) |
| CL-WPC-32 | `scripts/check-nginx-live.mjs` (`npm run check:nginx-live`, needs Docker, not in vitest): `nginx -t` in `nginx:alpine`, then a throw-away container on a free 127.0.0.1 port with `dist/` and `nginx.conf` read-only | `syntax is ok / test is successful`; `/assets/nothing.js.map` 404, `/assets/nothing.js` 404, `/assets/nothing.woff2` 404, `/settings/system/logs` 200 shell, `/assets/42` 200 shell, `/` 200 `no-cache`, real bundle 200, `/api/health` 502 (no upstream) `no-store`, oversized upload 413 JSON; every security header exactly once on all 9; `Server: nginx`; container removed |

## 5. IF-15 — Windows reference scripts (code/reference side)

Status: **CODE/REFERENCE SIDE FIXED — LIVE LAUNCHER STILL REQUIRES EXT-13.** Files in `ops/windows/`, described in
its README (parameters, prerequisites, what is not included). Matching the 2026-10-14 deploy flow:
`releases\<sha>\{backend, frontend-dist}`, `FRONTEND_DIST_DIR` as the single switch, `alembic upgrade head` before the
start, `.env` keys `LOG_DIR`, `ENVIRONMENT_NAME`, `APP_VERSION`, `pip install -c constraints.txt` (IF-11), launcher
with `--no-proxy-headers` (N2).

| Id | Check | Result |
|---|---|---|
| CL-WPC-40 | PowerShell parser (`[System.Management.Automation.Language.Parser]::ParseFile`, templates copied to `.ps1` names; `raw/windows/parse_check.ps1`) | 0 errors in all 4 scripts; every line with `uvicorn` + `app.main:app` carries `--no-proxy-headers` (2 lines, both in the launcher) |
| CL-WPC-41 | PSScriptAnalyzer | **not run**: not installed on the dev PC (installing it needs the PowerShell Gallery) |
| CL-WPC-42 | `-WhatIf` runs against a fake folder layout in the scratchpad (`raw/windows/dryrun.ps1`, output `raw/windows/dryrun.out.txt`) | deploy (zip not yet unpacked, and already unpacked): every changing step shown as "What if", exit 0, `.env` unchanged; refusals with exit 2 and `.env` unchanged for: no backup step, `ENVIRONMENT_NAME=development`, `JWT_SECRET` = 40 × "a" ("fewer than 8 different characters"), short secret ("shorter than 32"), incomplete release (missing `constraints.txt`); rollback: refuses the already-selected release, `-WhatIf` to another one exit 0; launcher `-WhatIf`: loads 7 key names, NAS mapping and start shown as "What if", argument line `-m uvicorn app.main:app --host 0.0.0.0 --port 3211 --no-proxy-headers`. The fake JWT secret, fake DB password and fake NAS password appear in **0** log lines |
| CL-WPC-43 | `verify_release.ps1` read-only against the local dev app `http://localhost:3211` (running containers, built before WP-C) | runs; shows the old state: N5 duplicates on `/api/` (4 FAIL rows), CSP with Google hosts (WARN), extension-less traversal paths answered with the nginx app shell (200, no file) |
| CL-WPC-44 | `verify_release.ps1` against `ckam-nr` with the WP-C nginx (`raw/windows/verify_ckam_nr.txt`) | 0 FAIL: health, headers exactly once (shell, `/api/health`, `/api` 404, missing script), `no-store`, CSP without Google, nosniff, docs closed, unknown `/api` JSON 404; traversal rows WARN only (nginx 400, or app shell without a file) |
| CL-WPC-45 | `verify_release.ps1 -IncludeUncProbe` against the `3362c1b` backend (before WP-A1) in single-port production mode on Linux (runtime image, `ENVIRONMENT_NAME=production`, `FRONTEND_DIST_DIR` set, read-only; `raw/windows/verify_singleport_head.txt`) | all 17 traversal probes **404**; headers once; docs closed (200 app shell, see note); **1 FAIL: unknown `/api` returns the shell (N6 was not in `3362c1b` — correct detection; WP-A1 `7b039fb` adds it)**; CSP WARN (backend CSP not yet mirrored) |

Note for the lead: in single-port production `/docs`, `/redoc`, `/openapi.json` return the SPA shell with 200 (docs
are off, the catch-all serves the shell), not 404 as EXT-01's "done when" and the urgent runbook say. The script
treats "shell, no documentation" as closed. If a literal 404 is wanted, the backend's N6 rule would also have to
cover those three paths (WP-A1 file), or the runbook expectation should be changed.

Secret grep of all new / changed files (`password|secret|token|pw=|BEGIN …KEY`, case-insensitive): only parameter
names, file names (`nas.pw`), rule texts and the throw-away `ckam-nr` values in test scripts under `raw/`; no real
secret.

## 6. IF-09 — see `IF-09_ACL_PLAN.md` (inspection only, nothing changed)

## 7. npm audit and final regression

npm audit: `npm_audit_recheck.md` (production 0; full: the known dev-only `source-map-js` HIGH, OBS-NPM-DEV).

| Command (in `frontend/`) | Result |
|---|---|
| `npx tsc -b` | exit 0 |
| `npx vitest run` | **92 files, 1256 tests passed** (baseline 90 / 1239, + `nginx-config.test.ts` 12 + `check-build-security.test.mjs` 5) |
| `npm run build` | OK (8 woff2 + 1 CSS + 1 JS + index.html) |
| `npm run check:build` | OK |
| `npm run check:nginx-live` | OK |

Not verified, and why: the frontend Docker image itself was not rebuilt with `npm ci` (the `ckam-nr` web image used
the same `nginx:alpine` final stage with the locally built `dist/`; the lock file was produced by `npm install` and
`npm run build` uses it); the font rendering on the real Windows single-port server; the backend CSP mirror and
its test (not in this package); BitLocker state (needs elevation); PSScriptAnalyzer (not installed).

Clean-up: `docker compose -p ckam-nr down -v`; images `ckam-nr-api`, `ckam-nr-web`, `ckam-nr-volume-init`,
`ckam-nr-runtime` removed; throw-away containers `ckam-nr-runtime-ro`, `ckam-nr-singleport` and every
`ckam-nginx-check-*` removed; no `ckam-nr` container, volume, network or image left; no dangling image.
