# CL2-IF: second closure retest, area INFRA (containers, fonts/CSP, headers, proxy address, start-up guard, database, dependencies, secrets)

Independent Senior DevSecOps / Database Security tester, 2026-10-16. I did not write these fixes. I took the checks
from the findings catalogue (`CKAM_SECURITY_CLOSURE_REGISTER.md`, `CKAM_SECURITY_FINDINGS_REGISTER.md`) and added
my own attacks.

- **Targets:** the running `ckam-sec` stack (web :3411 through nginx, API :8200, Postgres :25442), on the final
  code at HEAD `734fd19` with Alembic head `c6e8a0b2d4f6` (both confirmed in the database).
- **My own throw-away resources:**
  - the compose project `ckam-r2c` (web 3711, api 8700, db 25472, edge 172.31.214.0/28, nginx .10,
    `ENVIRONMENT_NAME=uat`, empty `PO_SOURCE_*`, env file in the scratchpad with throw-away values), built from the
    repository's `docker-compose.yml`;
  - the runtime image `ckam-r2c-rt`;
  - throw-away `docker run` containers of the `ckam-sec-api` image;
  - a throw-away database `ckam_r2c_rs` with roles `r2c_owner` / `r2c_migrator` / `r2c_app` in the ckam-sec
    Postgres.

  **All of them were removed at the end** (`raw/cleanup_r2c.txt`, `raw/db6b_12_cleanup.out.txt`).
- **Not done:** no product code was changed, no git writes, no pytest. Nothing was started, built or stopped in
  the `ckam-build`, `ckam-uat` or `ckam-sec` compose projects. Everything ran locally.

**Cases: 122** (`tests.csv`, ids `CL2-IF-T001` to `T122`): **PASS 106, FAIL 6, PARTIAL 2, INFO 8.**
Scripts are in `scripts/`. Redacted raw output is in `raw/`.

The 6 FAILs come from 4 new findings:

| Finding | Severity | FAIL cases | What it is |
|---|---|---|---|
| CL2-IF-01 | MEDIUM | 3 | The runtime role can break the ledger id sequences |
| CL2-IF-02 | LOW | 1 | The runtime role can give itself harmful defaults |
| CL2-IF-03 | INFO | 1 | `X-Request-ID` is missing on responses nginx serves itself |
| CL2-IF-04 | functional, found on the way | 1 | Single-port SPA addresses under `/assets/` give a 404 |

## Verdict per item

| # | Item | Verdict | In short |
|---|---|---|---|
| 1 | IF-13 container hardening | **PASS (2 PARTIAL)** | **Identity and privileges:** API runs as uid 10001 (ckam-sec and a fresh ckam-r2c build); every capability set is 0; `NoNewPrivs=1`; seccomp is on; `/app`, `/usr` and `/etc` cannot be written. **Runtime image:** no tests, pytest or coverage; non-root even without run flags; read-only root filesystem works (start, upload, logs). **Volumes:** pre-existing root-owned volumes (filled as root with the local `alpine:latest`, which is BusyBox-based) are handed to 10001 by `volume-init`; fresh volumes also work. A symlink attack on `volume-init` failed. **PARTIAL:** in the dev-target containers `/var/tmp` and `/dev/shm` are also writable (`/run/lock` is world-writable), so the writable set is not exactly the three paths; see OBS-01 |
| 2 | FONTS | **PASS** | SECHO, SECOPIT and SECSELF covered 41 Playwright steps (login, Home, Assets, Asset 360, PO list/page, Receive, Move, Reports + Excel export, 7 Settings pages, Logs, Diagnostics, label print page, Report-a-problem dialog). Results: **0** requests to other hosts (0 googleapis/gstatic), **0** CSP violations, **0** page errors. The only console errors were 2 expected 403s for the Own-Assets role on Asset 360. All 144 font responses came from the app's own origin, and the Inter and IBM Plex Mono faces loaded. Both fonts carry the ₹ glyph |
| 3 | Headers | **PASS, 1 FAIL** | **Passed:** on :3411, :8200 and production single-port, every security header appears exactly once on 20 kinds of response. The CSP is exact with no Google hosts, and the Permissions-Policy is exact. `Server` gives no version. `.map` files and missing js/css/fonts return 404, not the shell. Unknown `/api` paths return a JSON 404. The API's own 413 through nginx has each header once. **FAIL (CL2-IF-03):** `X-Request-ID` is missing on responses that nginx serves itself (dev/UAT only; production single-port has it everywhere) |
| 4 | N2 / N3 | **PASS** | **Through nginx**, forged XFF, XFF lists, X-Real-IP, `Forwarded` and the "trusted proxy address" trick all recorded `172.31.212.1` (what nginx saw). **Direct to :8200**, nothing was believed (`172.25.0.1`). **Rate-limit key:** 21 failed sign-ins, each with a different forged XFF, still gave 429 on the 21st attempt of the minute, both through nginx and direct (on my own ckam-r2c). **Configuration:** `--no-proxy-headers` is in the running command line, and `TRUSTED_PROXIES` holds only nginx's address |
| 5 | Production start-up guard | **PASS** | **Refusals:** all 72 weak combinations refused with exit code 3 (9 production-treated names, including unset, blank, `prd`, `live`, `prod-1`, `Production`, `staging`, junk and `' PROD '`, times 8 weak secrets). **CL1-N4-01 is closed:** unset `ENVIRONMENT_NAME` now refuses. **Message:** never contains the secret, and names the placeholder rule, the 32-character rule and the 8-different-character rule. **Starts:** 10 dev names × 4 secrets all start. Production with a good secret starts, and `/docs`, `/redoc` and `/openapi.json` return a JSON 404 even with a frontend dist mounted |
| 6a | Database guards on ckam-sec | **PASS** (limit stated) | **Asset fields:** a status, holder or date change without the marker is refused (also bulk, upsert and a wrong marker value). `asset_code` and company cannot change. A hard DELETE of an asset fails on its foreign keys. **Ledgers:** TRUNCATE, UPDATE and DELETE on all 4 ledgers are refused. **Purge:** the purge flag cannot delete fresh rows. **Limit:** `ckam` is a superuser in Docker, so the marker, replica mode and DISABLE TRIGGER still work there (shown, then rolled back) |
| 6b | Least privilege (role split) | **PASS with 1 MEDIUM + 1 LOW finding** | **Set-up:** the runbook worked as written (Alembic as the migrator with `ALEMBIC_SET_ROLE` puts every object under the owner), and verify gave 45/45 PASS. **Runtime attacks:** about 70 attempts as `r2c_app` were all refused: TRUNCATE, ALTER, DROP, CREATE, triggers, replica mode, SET ROLE, purge, ledger writes, `alembic_version`, COPY PROGRAM, file functions, roles, extensions, `pg_authid`, and persistent `ckam.*` role defaults. **Normal work:** the app's normal statements and the real API work as the runtime role. **CL2-IF-01:** the runtime role can `setval` the ledger sequences. That silently stops the database audit trail and blocks asset movements, survives ROLLBACK, and is not detected by the verify scripts. **CL2-IF-02:** the runtime role can give itself `default_transaction_read_only=on` |
| 6c | Historical data-integrity SQL | **PASS** | `db_05` gives the same 2 rows as before (both explained by the fixture or bootstrap). `db_03`/`db_04` items that used to succeed (TRUNCATE, the purge-flag delete) are now refused. Owner/superuser DISABLE TRIGGER is still possible; the role split is the control for that |
| 7 | Dependencies | **PASS (INFO)** | **npm:** production dependencies have 0 advisories. The full audit has 1 high, `source-map-js` 1.2.1, which is build/test only (OBS-NPM-DEV unchanged). **Python:** pip-audit reports `python-jose` 3.5.0 (PYSEC-2026-4298) and `ecdsa` 0.19.2 (PYSEC-2026-1325), neither with a fix. **Neither is reachable:** only `jose.jwt` is used, HS256 is pinned on decode, and 6 forged tokens (none, None, HS256 keyed with a DER public key, HS512, ES256, empty key) all got 401. ecdsa is never imported (jose uses the cryptography backend) |
| 8 | Secret scan | **PASS (regex-only)** | **Scope:** 1284 working-tree files, 299 commits, the dist, 14 image histories, the env of 10 containers (key names only) and the files inside the images. **Result:** no real secret. Hits are placeholders, throw-away or test values (including the FAKE/canary values of earlier retests), fake test JWTs and identifiers. `.env` was never committed. **Expected:** the owner's dev stack env holds the real ERP read-only password, which comes from the git-ignored `.env` (IF-09 territory). **Limitation:** no gitleaks or trufflehog image was available locally |

## Case table (summary; every case with its evidence is in `tests.csv`)

| id | item | check | expected | actual | result |
|---|---|---|---|---|---|
| T001-T003 | IF-13 | ckam-sec api: uid / capabilities / NNP | 10001, 0, 1 | 10001; CapEff=CapBnd=0; NNP 1; seccomp 2 | PASS |
| T004, T008 | IF-13 | writable paths as the app user | only `/data/uploads`, `/data/logs`, `/tmp` | those three **and** `/var/tmp`, `/dev/shm`; `/run/lock` world-writable | PARTIAL |
| T005-T006 | IF-13 | writes to `/app`, `/usr`, `/etc`; su / setuid / chown / raw socket | denied | denied | PASS |
| T010-T011 | IF-13 | runtime target: tests, pytest, coverage; user | absent; non-root | absent (45 distributions); `User=10001:10001`; CMD has `--no-proxy-headers` | PASS |
| T013-T014 | IF-13 | runtime target with `--read-only` + real DB: start, upload, logs | works, files uid 10001 | health 200, upload 201, download identical, logs written | PASS |
| T015-T016 | IF-13 | pre-existing root-owned volumes | `volume-init` re-owns; API writes | exit 0, everything 10001; old root log appended; upload into old root dir | PASS |
| T017 | IF-13 | fresh volumes | works | works | PASS |
| T018 | IF-13 | symlink attack on the root `volume-init` | targets outside untouched | `/etc/shadow`, `/etc/passwd`, `/app/app/main.py` still root-owned | PASS |
| T021-T030 | FONTS | 3 personas, 41 steps | 0 foreign, 0 CSP, fonts self-hosted | 0 / 0 / 144 same-origin woff2, Inter + Plex loaded, ₹ glyph in both | PASS |
| T032-T038 | headers :3411 | x1, exact CSP/PP, no version, `.map` / missing → 404, unknown `/api` → JSON | as expected | as expected | PASS |
| T039 | headers :3411 | `X-Request-ID` everywhere | everywhere | missing on nginx-served static/SPA/404/413 | **FAIL** (CL2-IF-03) |
| T040-T044 | headers :8200 | x1, exact, request id, JSON 404 / 413 | as expected | as expected (`server: uvicorn`, no version) | PASS |
| T045 | single-port production | headers, maps, docs | x1, 404 JSON | as expected, request id on all | PASS |
| T046 | single-port production | `/assets/1` (QR label target), `/assets/new` | SPA shell | **JSON 404** (nginx gives the shell) | **FAIL** (CL2-IF-04) |
| T047-T050 | N2/N3 | forged XFF / X-Real-IP / Forwarded via nginx and direct | nginx's view; peer | 172.31.212.1; 172.25.0.1 | PASS |
| T051-T052 | N2/N3 | 21 sign-ins with 21 forged addresses | 429 on the 21st | 429 on the 21st (both paths) | PASS |
| T054-T066 | IF-04/N4 | 121 start-up combinations | 72 refuse, 49 start | exactly so; no secret in output; 3 rules named | PASS |
| T067-T076 | 6a | guards as `ckam`, rolled back | refused | refused | PASS |
| T077-T078 | 6a | N9 residual; superuser limits | documented | as documented | INFO |
| T079-T081 | 6b | role split + Alembic as migrator + verify | owner owns all; 45 PASS | so | PASS |
| T082-T096 | 6b | ~70 break-out attempts as `r2c_app` | refused | refused | PASS |
| T097-T099 | 6b | `setval` on ledger sequences; effect via the API; detected? | refused / detected | **allowed**, audit silently lost, movements 409, not detected | **FAIL** (CL2-IF-01) |
| T100 | 6b | candidate fix on the throw-away DB | setval denied, app fine | so | PASS |
| T101 | 6b | `ALTER ROLE self SET default_transaction_read_only=on` | (gap) | accepted, not detected | **FAIL** (CL2-IF-02) |
| T102-T104 | 6b | normal statements, real API as runtime role, clean-up | work; nothing left | so | PASS |
| T105-T108 | 6c | historical SQL re-run | no regressions | old FAILs now refused | PASS |
| T109-T113 | deps | npm / pip-audit / reachability | prod 0; not reachable | so | PASS / INFO |
| T114-T122 | secrets | tree, history, dist, images, env | no real secret | none | PASS / INFO |

---

## New findings (full format)

### CL2-IF-01: the runtime role can rewind or exhaust the ledger id sequences, which silently stops the database audit trail and blocks asset movements

- **Severity:** MEDIUM. Within the IF-05/IF-06 threat model, someone who holds the runtime database credentials
  (for example from a server `.env` read through IF-01) must not be able to tamper with the append-only ledgers.
  The prerequisite is those credentials; the impact is on integrity (completeness of the audit trail) and on
  availability.
- **CWE:** CWE-269 (improper privilege management), CWE-778 (insufficient logging).
- **Component:** `ops/db/role_split.sql` step 5 (`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES ... TO runtime`)
  and step 6 (default privileges `USAGE, SELECT, UPDATE ON SEQUENCES`). Also `ops/db/check_least_privilege.sql` /
  `role_split_verify.sql`, which require UPDATE (the row "future sequences: runtime role gets USAGE by default"
  PASSes on `SELECT,UPDATE,USAGE`). Also `backend/app/observability/writer.py::insert_rows` / `report_failure`
  (the audit row is written in its own session; a failure is printed once per process and then swallowed).
- **What I observed (T097-T099):** as `r2c_app` after the split, `SELECT setval('audit_log_id_seq',
  9223372036854775807)` succeeded. Every later `audit_log` INSERT failed with "nextval: reached maximum value".
  `setval('asset_event_id_seq', 1)` made the next movement fail with a duplicate key. `setval` is
  non-transactional: the damage stayed after `ROLLBACK`. Through the real API running as the runtime role (T098),
  sign-in still worked and a failed sign-in still returned 401, but **no `audit_log` row was written**
  (0 rows for that request id). The only trace was one stderr line, "could not write audit_log ... Further
  failures of this kind are not repeated". An asset movement returned **409** "A record with this id already
  exists". `audit.jsonl` (file log) still got the rows, because `mirror_audit` runs before the insert; the DB
  trail that the Logs screen shows did not. Neither verify script flags it.
- **Impact:** an attacker with the runtime password can blind the database audit trail (sign-ins, exports,
  security events) without touching a single ledger row, which defeats the purpose of IF-05/IF-06. They can also
  stop every asset movement until a DBA repairs the sequence. When EXT-07 runs on production as written, the
  production runtime role `ckassetapp` would get the same right.
- **Root cause:** the application only ever calls `nextval` (implicit column defaults); a grep of `backend/app`
  finds no `setval` or `ALTER SEQUENCE`. Yet the split grants `UPDATE` on sequences, which is exactly the
  privilege that allows `setval`.
- **Reproduce:** `scripts/db6b_runtime_attacks.sql` section A15; `scripts/db6b_app_smoke.mjs` (label
  `seq-damaged`); raw `db6b_03_runtime_attacks.out.txt`, `db6b_04_*`, `db6b_05_*`.
- **Suggested fix** (documented only; I write no product code):
  1. In `role_split.sql`, grant `USAGE, SELECT` (no `UPDATE`) on all sequences, and the same in the default
     privileges.
  2. In `check_least_privilege.sql`, FAIL when the runtime role has `UPDATE` on any sequence (at least the four
     ledger sequences), and change the expected value in `role_split_verify.sql`.
  3. Make an audit-insert failure visible beyond the first one per process: keep a counter and surface it in
     health/diagnostics as a warning.

  **Already shown on the throw-away database (T100):** revoking `UPDATE` makes `setval` fail, while `nextval`,
  ledger inserts and the real API (sign-in, failed sign-in with its audit row, CORRECTION event, reads) all keep
  working.
- **Effort / regression risk:** small. Nothing in the app needs `setval`. Alembic data migrations run as the
  owner and are unaffected.
- **Owner / status:** WP-B (database) + EXT-07 deploy pack. OPEN, code-fixable.

### CL2-IF-02: the runtime role can set its own persistent role defaults (e.g. `default_transaction_read_only = on`), and the verify scripts do not notice

- **Severity:** LOW. The prerequisite is the runtime credentials. The effect is a persistent self-inflicted outage
  or quiet setting tampering, not data access.
- **CWE:** CWE-15 (external control of system or configuration setting).
- **Component:** PostgreSQL behaviour (a role may `ALTER ROLE <itself> SET` any user-settable parameter) combined
  with `ops/db/role_split.sql`, which does not clear runtime-role defaults, and `check_least_privilege.sql` /
  `role_split_verify.sql`, which do not inspect `pg_db_role_setting` for the runtime role (they do inspect it for
  the migrator).
- **What I observed (T096, T101):**
  - **Refused (good):** `ALTER ROLE r2c_app SET ckam.lifecycle_writer = 'on'`, `SET ckam.allow_audit_purge`
    and `SET session_replication_role`. On PG17 a custom placeholder or superuser parameter needs superuser.
  - **Accepted:** `ALTER ROLE r2c_app SET default_transaction_read_only = on`. Every later session of the role
    was read-only; the role could not even reset it itself. `role_split_verify.sql` still printed no
    FAIL or INFO row. The same applies to `statement_timeout`, `search_path`, `lock_timeout` and similar.
  - I checked that `role_split.sql` re-run does not clear such a default; a superuser had to
    `ALTER ROLE r2c_app RESET ALL`.
- **Impact:** an attacker with the app credentials can make CKAM fail on every write (or every query, through a
  1 ms `statement_timeout`) in a way that survives restarts, and the post-deploy check would still say PASS.
- **Suggested fix:**
  1. `check_least_privilege.sql`: FAIL when `pg_db_role_setting` holds any row for the runtime role, in this
     database or in all databases.
  2. `role_split.sql`: `ALTER ROLE <runtime> RESET ALL` (and `IN DATABASE ... RESET ALL`).
  3. Optionally the app checks `SHOW default_transaction_read_only` at start-up.

  It cannot be prevented inside PostgreSQL for user-settable parameters, so detection is the control.
- **Owner / status:** WP-B. OPEN, code-fixable (detection).

### CL2-IF-03: `X-Request-ID` is missing on every response nginx answers itself (dev/UAT Docker stacks)

- **Severity:** INFO.
- **Component:** `frontend/nginx.conf`.
- **Observed (T039):** on :3411, `/`, `/assets/*.js` and `.css`, SPA routes, static 404s, `.map` 404s and nginx's
  own 413 carry no `X-Request-ID`. Every proxied `/api` answer has it. OBS-T410 accepted this only for the 413.
  Single-port production (T045) has it on every response, so production is unaffected.
- **Suggested fix:**
  1. `add_header X-Request-ID $request_id always;` at server level and in every location that repeats its
     `add_header` lines.
  2. Optionally `proxy_set_header X-Request-ID $request_id;`, but only if the API is changed to adopt that header
     from the trusted proxy alone. Otherwise leave it out: the API must not take a request id from clients.
- **Owner / status:** WP-C. OPEN, low priority.

### CL2-IF-04 (functional, found during the security retest): single-port production answers SPA addresses under `/assets/` with a JSON 404, including the Asset 360 address that printed QR labels encode

- **Severity:** functional MEDIUM, security INFO. Not a vulnerability.
- **Component:** `backend/app/main.py::_serve_frontend_asset` (`@app.get("/assets/{file_path:path}")`). Every
  `/assets/...` path that is not a file returns 404. The frontend's own routes `/assets/$id` and `/assets/new`
  (`frontend/src/router.tsx` lines 381 and 395) are under the same prefix. `docker-compose.yml` says labels encode
  `${BASE_URL}/assets/{id}`.
- **Observed (T046):** on a production-mode container of the `ckam-sec-api` image with the built dist mounted,
  `/assets/1`, `/assets/42`, `/assets/new` and `/assets/1?from=qr` returned `404 application/json`. nginx (:3411)
  returns the SPA shell 200 for the same addresses.
- **Not a closure regression:** the same behaviour is in production's `3b5e842`, where `candidate.is_file()` or
  404. Opening Asset 360 by link, a page refresh on it, or a scanned QR label would show a JSON error on the
  Windows single-port server. **I did not and must not test production**, so production impact is inferred from
  the code plus the local reproduction.
- **Suggested fix:** in `_serve_frontend_asset`, after the existing IF-01/IF-01-WIN lexical and containment
  checks:
  - if the last path segment has **no file extension**, return the SPA shell (the nginx rule:
    `\.(js|css|woff2|...)$` → `=404`, everything else → shell);
  - keep the 404 for missing `.js`, `.css`, fonts and `.map` (AU-12).

  Add tests for `/assets/1` → shell and `/assets/x.js` → 404.
- **Owner / status:** WP-A1 / product owner. OPEN. It needs the owner's attention because labels are already
  printed.

## Observations (not counted as findings)

- **CL2-IF-OBS-01:** dev-target containers (compose `api`) can also write `/var/tmp` and `/dev/shm` (`/run/lock`
  is world-writable), because compose deliberately does not mount the root read-only (the pytest code-sync needs
  it). The runtime target with `--read-only` closes `/var/tmp` (T013). Accept, or add `tmpfs: /var/tmp` with a
  comment.
- **CL2-IF-OBS-02:** the runtime image cannot drop its own bounding capabilities or set no-new-privileges; a
  plain `docker run` keeps Docker's default bounding set (CapEff is still 0 because the user is not root).
  Whoever runs the runtime target must pass `--cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs
  /tmp`. Document this next to the Dockerfile comment. Production has no Docker.
- **CL2-IF-OBS-03:** the audit writer reports an insert failure once per process and then stays silent
  (`report_failure`). This is what made CL2-IF-01 invisible; fold a counter/health signal into its fix.
- **CL2-IF-OBS-04:** stale comment in `backend/app/main.py` lines 223-224. It still says "Google Fonts serves the
  Inter / IBM Plex stylesheet and font files", although the CSP right below now allows only `'self'`.
  Documentation drift only.
- **CL2-IF-OBS-05:** single-port production sends `server: uvicorn` (product name, no version).
  `--no-server-header` on the launcher removes it. INFO.
- **CL2-IF-OBS-06:** `backend/scripts/seed_uat_personas.py` (and the copy in `closure/db/rs_smoke.py`) hard-code
  one shared password for seeded UAT personas (value not reproduced here). It is UAT/test only. Make sure it is
  never used on a server reachable by real users, or generate it per run.

## Confirmed closed by this retest

- **IF-13:** non-root, no capabilities, no-new-privileges, runtime target without test tooling. Old and new
  volumes work, and `volume-init` resists a symlink attack.
- **FONTS:** no Google request on any page for three roles; the CSP has no Google hosts.
- **N3 / N5:** nginx overwrites the forwarded address, the API trusts only nginx, and headers appear exactly once.
- **N2:** the Docker part is done (`--no-proxy-headers`, forged headers ignored directly). The production
  launcher part is still EXT-38.
- **N4 / IF-04 / OBS-GUARD-MSG / CL1-N4-01:** unset now fails closed, and the message names all three rules.
- **OBS-STATUS** (the asset lifecycle guard) is live.
- **IF-05 / IF-06 / OBS-DOCKER-SU:** the role-split design works as documented. **Exception:** CL2-IF-01 and
  CL2-IF-02 must be fixed in the pack before EXT-07.

## What I could not exercise (honesty)

- **No production or Windows work** (rule 1). Production impact of CL2-IF-04 and N2 (launcher) is inferred, not
  tested.
- **ckam-sec's own database role is a superuser.** Item 6(a) therefore proves the triggers only; least privilege
  was proven on the separate throw-away database (6b).
- **The rate-limit burst (T051/T052) ran only on my private `ckam-r2c`.** On ckam-sec I sent just 6 paced forged
  sign-ins, because another tester shares this IP.
- **Secret scan is regex-only.** No gitleaks or trufflehog image is present and pulling is not allowed. Images and
  PNGs were not OCR-scanned. CL1-OBS-SECRET-01 (demo walkthrough) was not re-read line by line; my patterns did
  not flag it.
- **`pip-audit`** used `--no-deps --disable-pip` on the pinned list (no hashes in `constraints.txt`).
- **₹ check:** no page in the tour showed `₹` in its text, so the check is the glyph test (canvas width against
  two fallbacks, plus `document.fonts.check`), not a visual comparison of a real amount. Chromium only.
- **"Old busybox image":** none was present. I used `alpine:latest` (already local, BusyBox-based) as root to
  create the root-owned volume contents, instead of reasoning from the compose file.
- **No pytest** (not allowed for this task).

## Side effects on ckam-sec (all harmless, listed for the other testers)

- **Sign-ins:** 6 failed sign-ins with unknown login ids `r2c-xff-*`, so no persona was locked. Playwright signed
  in once each as SECHO, SECOPIT and SECSELF.
- **Exports:** 2 Excel exports, which wrote their audit rows.
- **Probes:** 6 JWT probes (401) and header probes.
- **Database:** every guard test ran in a rolled-back transaction. `/tmp/r2c_rs` in `ckam-sec-db-1` was created
  and removed. One `alembic upgrade` ran through `docker exec` in `ckam-sec-api-1`, against the throw-away
  database only.
- **No ckam-sec data, persona or container was changed.**
