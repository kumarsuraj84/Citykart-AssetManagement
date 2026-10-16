# WP-F results — fixes for the second infra retest (CL2-IF-01 … 04 and observations)

Date: 2026-10-16. Starting HEAD `734fd19`, Alembic head `c6e8a0b2d4f6` (unchanged: **no migration** was needed).
Input: `docs/security/evidence/closure/retest2/infra/RETEST2_INFRA.md`, `docs/security/evidence/closure/db/WPB_RESULTS.md`.
Everything ran on the dev machine only: the dev api/db containers (compose project `ckam-build`, only `exec` / `cp`,
no up/build/down/restart), throw-away databases and roles inside the dev Postgres (dropped afterwards), throw-away
`docker run --rm` containers and one throw-away docker network (removed). Nothing touched production, 10.0.0.205,
the NAS, the ERP warehouse, 10.0.1.12 or the `ckam-sec` stack. No git write commands (the lead commits).

## Status per item

| Item | Change | Tests | Result |
|---|---|---|---|
| **CL2-IF-04** (functional) — `/assets/<id>` (QR labels), `/assets/new` answered a JSON 404 on the single-port server | `backend/app/main.py::_serve_frontend_asset`: (1) the IF-01-WIN lexical check `is_safe_relative_name` runs first, unchanged; (2) a name of 1–3 `/`-separated segments matching `[A-Za-z0-9_-]{1,64}` (no dot, so never a built file) returns the SPA shell exactly like the catch-all (`index.html`, `Cache-Control: no-cache`) — no filesystem call other than reading `index.html`; (3) everything else goes through `safe_asset_path` as before (real file or the identical plain 404). Shared `_spa_shell()` helper used by both routes | New `backend/tests/test_static_frontend_spa_assets.py` (11 functions, 31 cases) | **FIXED.** Reproduced first: the new test failed on HEAD with `404` for `/assets/123`; passes after the fix. See details below |
| **CL2-IF-01** (MEDIUM) — runtime role could `setval` the ledger sequences | `ops/db/role_split.sql`: sequences `GRANT USAGE, SELECT` only (step 5, after the existing `REVOKE ALL`, so a re-run removes an old UPDATE); default privileges: `REVOKE UPDATE ON SEQUENCES` + `GRANT USAGE, SELECT ON SEQUENCES` (step 6). `check_least_privilege.sql`: new check 19 (FAIL if the runtime role has UPDATE on any sequence) and check 20 (every table-owned id sequence: next id must be above the table's highest id, ≥ 1,000,000 below the sequence maximum and ≤ 1,000,000 above the highest id; read with `query_to_xml`, unreadable = INFO). `role_split_verify.sql` check 11: USAGE by default and never UPDATE. Runbook updated (sections 1, 3, 5, 7, 8, new 9) | `tests/security/test_least_privilege_role_split.py`: 4 new CANNOT cases (`setval` audit_log to max, asset_event to 1, master_audit `is_called=false`, `ALTER SEQUENCE … RESTART`), a check that the refused setval changed nothing, 1 new CAN (`nextval`/`currval`), negative control 3b (the old grant + old default privilege → both scripts FAIL → the real split repairs it), damage detection 3c (nearly exhausted, rewound, absurd jump → check 20 FAIL naming `audit_log_id_seq`; repaired → PASS) | **FIXED (scripts) — production still needs EXT-07 by a DBA.** Reproduced first with the HEAD scripts (`wpf_01`): runtime `setval` to max succeeded, survived ROLLBACK, the next `audit_log` INSERT failed "reached maximum value", and both check scripts printed **no FAIL**. With the WP-F scripts (`wpf_02`): both `setval` refused "permission denied for sequence", `last_value` 1, INSERT OK |
| **CL2-IF-01** second half / OBS-03 — repeated audit-write failures were silent | `backend/app/observability/writer.py`: `report_failure` keeps a per-kind counter; reports the first failure and then at most once per 60 s with "N failures so far, M since the last report"; writes to stderr AND the error log (`ckam.errors` → `error.jsonl`, marked so the console handler does not print it twice — filter in `filelog.py`); `insert_rows` then records a `system_event` (`component=logging`, `event=write_failed`, `details.failures_total`) when the database accepts it (never for a failing system_event itself → no loop); never raises. `failure_counts()` / `reset_failure_reports()` added; `reset_throttles()` (test conftest) also resets the counters | New `tests/observability/test_log_write_failure_reporting.py` (4): real failure via `setval('audit_log_id_seq', max)` in the test DB — first report at once, a 200-call flood within the minute adds no line but is counted, a report after +61 s says "202 failures so far, 201 since the last report", 2 error-log records, 2 `system_event` rows (1, 202), no audit row; failed sign-in still answers 401 with the event tied to its request id; database refusing everything (also the system_event) → one line per kind, no recursion, no exception; `report_failure` survives an unprintable exception and a missing stderr | **FIXED** |
| **CL2-IF-02** (LOW) — runtime role can store its own session defaults | `role_split.sql` new step 7: `ALTER ROLE <runtime> RESET ALL`, `ALTER ROLE <runtime> IN DATABASE <db> RESET ALL`, and the same for every other database that has a stored setting for that role. `check_least_privilege.sql` check 21 and `role_split_verify.sql` check 12: FAIL while `pg_db_role_setting` holds a row for the runtime role (lists the values). Runbook section 9: incident response (superuser `RESET ALL`, restart `CKAM-Web`, treat as credential compromise) | In the role-split pytest (4b): as the runtime role `ALTER ROLE self SET default_transaction_read_only = on` and `ALTER ROLE self IN DATABASE … SET statement_timeout = 5000` (both accepted by PostgreSQL); a new session cannot INSERT ("read-only transaction"); both check scripts FAIL with the values; the split (incident response) runs; both PASS; a new session is writable | **FIXED (detection + reset).** Cannot be prevented inside PostgreSQL; detection is the control, as the retest says. Reproduced (`wpf_01`: accepted, no FAIL row) and fixed (`wpf_02`: both scripts FAIL with "all databases: default_transaction_read_only=on") |
| **CL2-IF-03** (INFO) — no `X-Request-ID` on nginx's own answers | `frontend/nginx.conf`: `add_header X-Request-ID $request_id always;` at server level (static files, `.map`/missing-file 404s), in `location = /index.html` (the shell) and in `@too_large` (413). Under `/api/`: `add_header X-Request-ID $ckam_api_request_id always;` with `map $upstream_http_x_request_id $ckam_api_request_id { "" $request_id; default ""; }` — the application's id passes through untouched (an empty value makes nginx send nothing), nginx's own id only when no application answer exists (API down → nginx's 502/504). No `proxy_set_header`: the API never takes an id from the client | `frontend/src/security/nginx-config.test.ts`: new case (server/shell/413 carry exactly `$request_id always`; `.map`, `/` and the static location stay inheriting; `/api/` only the conditional map; the map's two lines; no forwarding/hiding of X-Request-ID) | **FIXED.** Live: `npm run check:nginx-live` OK (every security header still exactly once, `nginx -t` ok, container removed; `wpf_04`). Own throw-away live check (`wpf_03`, stand-in API on a private network): 11/11 PASS — exactly one id on `/`, an SPA route, `/assets/42`, missing `.js`, `.map`, favicon (nginx's 32-hex id), `/api/health` and an API 404 (the application's id), a client-sent `X-Request-ID` not adopted, the 413 (nginx's id) and API down 502 (nginx's id); containers and network removed |
| OBS-05 (a) `server: uvicorn` | `--no-server-header` in both Dockerfile targets' CMD, `ops/windows/run_ckam_web.ps1.template` (argument line + header), `ops/windows/README.md`; `verify_release.ps1` WARNs on a `uvicorn` Server header | `tests/core/test_n2_forwarded_for.py`: the Dockerfile test now requires both CMDs and the flag on each; new `test_the_windows_reference_launcher_keeps_both_uvicorn_flags` | **DONE in the repo.** The running dev api keeps `server: uvicorn` until the owner rebuilds it (not allowed here); production needs the live launcher changed (EXT-13 comparison) |
| OBS-04 (b) stale Google Fonts comment | `backend/app/main.py` comment corrected (fonts self-hosted, 'self' only) | — | **DONE** |
| OBS-01 (c) writable `/var/tmp`, `/dev/shm` in dev-target containers | `docker-compose.yml` api: `tmpfs: /tmp:rw,noexec,nosuid,nodev` and `/var/tmp:rw,noexec,nosuid,nodev` with a comment. `/dev/shm` is already `noexec,nosuid,nodev` (Docker default, seen in `/proc/mounts`) | Checked on a throw-away container of the `ckam-build-api` image with exactly these mounts (the owner's api container was not recreated): `docker cp` into `/app` works; `/tmp` and `/var/tmp` are tmpfs `noexec` (a script there: "Permission denied", rc 126); pytest subset of 619 tests (static, observability, security incl. role split, documents, imports) passed, 1 skipped (router file not copied there). Note: `docker cp` INTO `/tmp` lands hidden under the tmpfs — documented in the compose comment (copy test inputs into `/app`) | **DONE, takes effect at the owner's next `docker compose up -d --build api`** |
| OBS-06 (d) shared UAT persona password | `backend/scripts/seed_uat_personas.py` docstring: loud "NEVER RUN AGAINST PRODUCTION" lines; code unchanged | — | **DONE** |

Also changed for CL2-IF-04: `ops/windows/verify_release.ps1` now checks that `/assets/1`, `/assets/new` and
`/assets/1?from=qr` return the app shell with `no-cache` and that a missing `.map` stays 404 (FAIL otherwise — a
JSON 404 there means the release lacks the fix), and its stale comment ("never does under /assets/") is corrected.
PowerShell parser: 0 errors in `verify_release.ps1` and `run_ckam_web.ps1.template`. ops/windows README updated.

## CL2-IF-04 details

- **Answers the shell:** `/assets/123`, `/assets/42`, `/assets/1`, `/assets/new`, `/assets/123/edit`, `/assets/abc_DEF-9`,
  `/assets/a/b/c`, `/assets/123?from=qr` → 200 `text/html`, `Cache-Control: no-cache`, CSP and `X-Request-ID` present.
- **Still the identical plain 404** (one body set across all of them, request id removed): the whole `REFUSED`
  list of `test_static_frontend_windows.py` (traversal, encoded traversal, UNC, drive, ADS, device names incl.
  `CON`/`nul`/`Com1`/`sub/CON` which match the route pattern but are refused lexically first, 8.3 names, trailing
  dot/space, NUL, over-long), plus `/assets/does-not-exist.js`, `….js.map`, `missing.css`, `x.map`,
  `fonts/missing.woff2`, 4 segments, a 65-character segment, `1.5`, `new.`, `123/`, `//123`, `/assets/`, a space,
  `%`, a colon.
- **Filesystem:** with `os.stat`/`realpath` recorded and `Path.resolve/is_file/exists/lstat/is_symlink` forbidden,
  the shell branch touches only `<dist>` (the `is_dir` of the configured folder, as before) and `<dist>/index.html`;
  a refused name touches nothing built from the URL.
- **Real files:** hashed `.js` (`text/javascript`), `.css` (`text/css`), `fonts/*.woff2` still served.
- **HEAD:** `HEAD /assets/123` and `/assets/new` answer exactly like `HEAD` on any other SPA page. Note
  (pre-existing, unchanged): FastAPI GET routes do not answer HEAD, so in single-port mode **every** SPA page
  (including `/`) answers HEAD with 405 (nginx answers 200). Phones open labels with GET, so labels are unaffected.
- **Route table:** the test reads the real `frontend/src/router.tsx` (60 distinct `path:` entries), asserts `/assets/$id`
  and `/assets/new` are there, and requests every route with its parameters filled in (`123` and `abc_DEF-9`): all
  answer the shell. Inside the api container it needs the file copied
  (`docker compose cp frontend/src/router.tsx api:/app/frontend-router.tsx`; otherwise that one test skips and
  says so).
- **Other prefix collisions (report):** the backend keeps only `/api/*` (JSON 404 for unknown, N6), `/assets/*`
  (now handled), `/docs`, `/redoc`, `/openapi.json` (JSON 404 where docs are off) and the four root files
  (`favicon.svg`, `favicon.webp`, `icons.svg`, `logo.png`). The frontend's top-level prefixes are `/`, `login`,
  `change-password`, `dashboard`, `assets`, `serial-pending`, `asset-movement`, `print-labels`, `receive`,
  `dispatch`, `purchase-orders`, `my-assets`, `import`, `reports`, `people`, `settings`, `setup`: **no other
  collision**; the test asserts none of them is `api`, `docs`, `redoc` or `openapi.json`. `/assets` itself (the
  register) never reached the asset route. `/assets/` (trailing slash, empty name) stays a 404 as the task requires.

## Existing tests changed (and why)

| File | Change | Why |
|---|---|---|
| `tests/observability/test_error_logging.py::test_a_logging_failure_never_breaks_the_request` | `monkeypatch.setattr(writer, "_reported", set())` → `writer.reset_failure_reports()` | `_reported` (the once-per-process set) no longer exists; the assertion (exactly one "could not write audit_log" line) is unchanged and still passes |
| `tests/security/test_least_privilege_role_split.py` | `len(split) == 11` → `12`; `len(general) >= 30` → `>= 33`; split call factored into `_run_split`; new cases above | New verify/check rows (intended) |
| `tests/core/test_n2_forwarded_for.py::test_the_docker_image_starts_uvicorn_without_proxy_headers` | Requires exactly the two uvicorn CMDs and `--no-server-header` on each | OBS-05 |

## Evidence in this folder

- `wpf_01_if01_if02_repro_BEFORE_head734fd19.out.txt` — the HEAD scripts: runtime `setval` succeeds, survives
  ROLLBACK, audit INSERT fails, `ALTER ROLE self SET default_transaction_read_only = on` accepted, both check
  scripts silent; nothing left behind.
- `wpf_02_if01_if02_AFTER_wpf.out.txt` — the WP-F scripts: `setval` refused, INSERT OK, both scripts FAIL on the
  stored setting; nothing left behind.
- `wpf_03_xrequestid_live.out.txt` — CL2-IF-03 live check (11/11 PASS, cleanup verified).
- `wpf_04_check_nginx_live.out.txt` — the repository's `npm run check:nginx-live` (OK).
- `scripts/repro_if01_if02.py`, `scripts/xrid_live.mjs`, `scripts/fakeapi.conf` — the scripts used.
- Negative controls of the role-split pytest (run with `CKAM_OPS_DB_DIR` copies, not kept as files): HEAD scripts →
  fails (verify has 11 rows); WP-F scripts with the old `UPDATE` sequence grant → fails on check 19 ("UPDATE on:
  bundle_id_seq, …"); WP-F scripts without the `RESET ALL` step → fails on check 21 ("all databases:
  default_transaction_read_only=on; ckam_lpt_…: statement_timeout=5000").
- After every role-split run `\du` showed only `ckam` and `\l` only `ckam`, `ckam_test`, `postgres` and the templates
  (also checked after the full run, below).

## Test runs

- **Backend, one full run** on `ckam_test` in the dev api container, after `docker compose cp` of `backend/app`,
  `backend/tests`, `ops` (into `/app/ops`), `backend/Dockerfile` (into `/app/Dockerfile`) and the frontend router file:
  `2521 passed, 1 skipped, 1303 warnings in 517.33s (0:08:37)`.
  Baseline 2484 passed + 2 skipped = 2486; now 2522 = +36 new cases (31 CL2-IF-04, 4 log-write reporting, 1
  Windows launcher). Skips 2 → 1 because the Dockerfile test now RUNS (I copied `backend/Dockerfile` into the
  container); the remaining skip is the pre-existing "not run from a repository checkout". Role-split test ran (not
  skipped). Afterwards `\du`: only `ckam`; `\l`: `ckam`, `ckam_test`, `postgres`, templates.
- After the full run I only changed where the route-table test looks for the router file (`/app/frontend-router.tsx`
  instead of a `/app/frontend/src/` folder, which `docker compose cp` cannot create for a single file); that one file
  was re-run with the copy at the new place: `31 passed`. The temporary files I placed in the container (`/app/frontend`,
  `/tmp/*`) were removed; `/app/ops`, `/app/Dockerfile` and `/app/frontend-router.tsx` remain there for the next run.
- **Frontend** (`frontend/`): `npx tsc -b` → exit 0; `npx vitest run` → `92 files, 1257 passed` (baseline 1256 + 1
  new nginx case); `npm run check:build` → OK (15 files, no source maps, no Google host, no external resource);
  `npm run check:nginx-live` → OK (`wpf_04`). No `npm install` was run. The existing `dist/` was used (not rebuilt).

## Not done / limits (honest)

- **Production:** nothing deployed or run there (rule 1). CL2-IF-01/02 close only when a DBA runs the updated
  `role_split.sql` + verify on 10.0.0.205 (EXT-07); before that, run check 20 read-only on production to see whether
  a sequence was already damaged. CL2-IF-04 and OBS-05 close in production only with the next deploy (and the live
  launcher needs `--no-server-header`, EXT-13).
- **Dev containers not rebuilt** (not allowed here): the running dev api still sends `server: uvicorn`, its `/tmp`
  is still on the overlay; the dev `web` container still has the old nginx.conf (no X-Request-ID on nginx's own
  answers) until the owner runs `docker compose up -d --build api web`.
- **HEAD in single-port mode** answers 405 for every SPA page (pre-existing, not part of this task).
- **Health/diagnostics signal** for log-write failures (suggested by the retest as an option): only
  `failure_counts()` was added; it is not yet shown on the Diagnostics screen. The `system_event` rows are visible in
  Logs → System events.
- **CL2-IF-OBS-02** (document `--cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp` next to the
  Dockerfile's runtime target) was not in this task's list and was not done.
- The copy of the persona password in `docs/security/evidence/closure/db/rs_smoke.py` is historical evidence and
  was left unchanged.
