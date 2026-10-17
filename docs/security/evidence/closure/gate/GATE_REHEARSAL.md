# CKAM emergency security release `eed3de1` — independent release-gate rehearsal (GT)

| | |
|---|---|
| Date | 2026-10-17 (UTC 03:50–04:30), dev PC 10.0.0.47 only |
| Package under test | `release-packages\ckam-security-release-eed3de1.zip`, SHA-256 `be3209af7784bdb837dcf36d25ec1d0158623c26c8822351f5a3256aa1e3d246` (verified before extraction and again after clean-up) |
| What was tested | the **extracted zip only** (215 files, `Expand-Archive`, the cmdlet `deploy_ckam.ps1` uses), never the git working tree |
| Old release | `3b5e842` `backend/app` + `alembic.ini` from `git archive` (read-only git), the live release's code |
| Dataset | `scratchpad\sec\seeded.dump` (pg_dump -Fc, Alembic `e6f8a0b2c4d6`, 22-persona two-company fixture), restored as the **non-superuser owning role** `ckassetapp` (as on 10.0.0.205) |
| Runtime | throw-away containers `ckam-gate-*` only: Postgres 17 (`postgres:17`) on 127.0.0.1:25512; app containers on 127.0.0.1:4111–4115 from the local image `ckam-sec-api` (Python 3.13.15; its installed packages equal the package's `constraints.txt` 43 pins exactly, plus test tools) with the **package code mounted** and `PYTHONPATH`/working dir set to it (`import app` → `/srv/ckam/releases/eed3de1/backend/app`). Layout = production: `/srv/ckam/releases/<sha>/{backend,frontend-dist}`, `/srv/ckam/shared/{.env,nas.pw,run_ckam_web.ps1}` (FAKE canaries), `/srv/ckam/logs/app` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-proxy-headers --no-server-header`, `ENVIRONMENT_NAME=production`, random 64-hex `JWT_SECRET` (throw-away, never printed), `FRONTEND_DIST_DIR` = packaged `frontend-dist`, `APP_VERSION=eed3de1` (as `deploy_ckam.ps1` sets), `ERP_SYNC_ENABLED=false` (no ERP here) |
| Not touched | production, every 10.x host, the real ERP/NAS, compose projects `ckam-build` / `ckam-uat` / `ckam-sec` (still running, never restarted), git (no write command) |
| Result | **283 cases: 280 PASS, 3 FAIL.** The 3 FAILs are documentation claims that the rehearsal disproved (GT-F01, GT-F02); **no defect in the release code was found.** `tests.csv` has every case |

**Verdict for the gate:** the package deploys as documented, migrates the old-schema data in under a second with
no row lost, starts only with a strong secret, closes IF-01 (47-probe list incl. all Windows forms: 0 leaks, 0 5xx,
one identical 404; the same probes leak the canaries from `3b5e842` on the same layout), and every user flow tested
works for a head-office admin and an operator. Before the deploy, correct the two runbook statements in GT-F01 and
GT-F04 so that the people on the call act on the right facts about rollback.

## 1. Step-by-step results

| Step | Command / attack | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 0 | `sha256sum` of the zip | `be3209af…d246` | identical (before and after) | PASS | — |
| 1 | `pg_restore --no-owner --exit-on-error` as `ckassetapp` into a fresh PG 17 | exit 0, `e6f8a0b2c4d6` | exit 0 in 458 ms, `alembic_version=e6f8a0b2c4d6`, role not superuser; 39 tables (asset 16, asset_event 24, audit_log 239, purchase_order 8, pending_asset 20, vendor 6, erp_po_line 4, client_report 2, idempotency_key 4, asset_user 31 …) | PASS | `raw/counts_before.csv` |
| 2 | OLD code 3b5e842, production mode, on the restored DB: receive PO 2 line 2 (1 chair), move asset 3 to a person and back | live behaviour works | receive 200 (asset 17), move 201 ALLOTTED, move back 201 IN_STOCK (GT-020…024) | PASS | `raw/cases_step2.csv` |
| 3 | packaged `alembic upgrade <rev>` × 4, then a single `upgrade head` on a fresh copy | `c6e8a0b2d4f6 (head)`, nothing lost | each migration 0.68–2.5 ms of DDL on the server, ~1 s per alembic process (Python start-up); single `upgrade head` 0.86 s wall. Row counts: 39 of 39 pre-existing tables identical, new `auth_session` = 0 rows. `token_version` INTEGER NOT NULL DEFAULT 0, 31/31 rows = 0. 4 TRUNCATE triggers + lifecycle guard + 5-year audit purge floor present. 17/17 assets readable (DB and API) | PASS | `raw/alembic_runs.txt`, `raw/pg_migration_statement_log.txt`, `raw/schema_after_migration.txt`, `raw/counts_premigration.csv`, `raw/counts_after_migration.csv` |
| 4a | health; `/docs`, `/redoc`, `/openapi.json`, `/docs/oauth2-redirect`; 3 unknown `/api/…` | 404 JSON | all 404 `application/json` envelope with `request_id`, no Swagger/ReDoc/OpenAPI | PASS | `raw/cases_step4a_pkg.csv` |
| 4a | security headers on 8 answer types (`/api/health`, `/`, `/login`, bundle, `/assets/1`, `/api/nope`, a refused probe, `/favicon.svg`) | each exactly once, no `Server`, CSP without Google, `no-store` on `/api/` | all 8 PASS; CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; …` | PASS | `raw/step4a_pkg_raw.txt` |
| 4a | **IF-01 attack list, 47 probes** (attack.mjs adapted): `..%2f`×4 to `.env`/`nas.pw`/launcher/root canary, plain `../`, `%2e%2e%2f`, `..%5c`, `%2e%2e%5c`, mixed slashes, double-encoded (`%255c`, `%252e`), overlong UTF-8, sibling `index.html`, sibling folder `assets-evil` (prefix bug), absolute `/srv/ckam/…` (encoded and `//`), `/etc/passwd` (absolute and traversal), `C:%2fWindows%2fwin.ini`, `C:%5cWindows%5cwin.ini`, `//C:/…`, `C:win.ini`, `%5c%5cserver%5cshare`, `//server/share`, `%5c%5clocalhost%5cC$…`, ADS `::$DATA` and `:stream`, trailing dot/space, `CON`, `NUL`, `nul.txt`, `aux.js`, `COM1`, 8.3 `~1`, NUL byte (×2), 5000-char name, `./`, `.env`, **symlink** file → `shared/.env`, symlinked dir → `shared` (×3) | every probe 404, 0 leaks, 0 5xx, one identical answer | 47/47 404, **0 leaks, 0 5xx, 1 distinct answer** (`404 application/json {"detail":"Not Found","request_id":…}`) | PASS | `raw/step4a_pkg_raw.txt` |
| 4a | legitimate files: bundle, CSS, 4 root files, 8 fonts; app addresses `/assets/1`, `/assets/17`, `/assets/new`, `/assets/12345`, `/purchase-orders/2`, `/dashboard` | 200 | all 200; app addresses get the package's `index.html` with `no-cache` | PASS | `raw/cases_step4a_pkg.csv` |
| 4 | packaged `ops/windows/verify_release.ps1` (Windows PowerShell 5.1, GET only) `-ExpectedRelease eed3de1 -ReleaseDir … -IncludeUncProbe` | exit 0 | **38/38 PASS**, exit 0 | PASS | `raw/verify_release_pkg_eed3de1.txt` |
| 4b | `GET /api/admin/diagnostics/health` as SECHO | version eed3de1, production, migrations ok | `version eed3de1`, `environment production`, `migrations {ok, code_head = db_head = c6e8a0b2d4f6}`, database ok; operator → 403 | PASS | `raw/step4b_raw.txt` |
| 4b | `system_event` `app_started` | release + production | "CKAM started (version eed3de1, production)." with config (no secret; `jwt_signing_key_long_enough: true`, `is_placeholder: false`) | PASS | `raw/step4b_raw.txt` |
| 4b | functional API smoke, SECHO + SECOPIT: sign-in, list 17, search (4), operator scope (4 CKSPL IT only; CKVPL asset 404), Asset 360 (detail/history/changes), PO list (8) + detail + line groups | as designed | all as designed | PASS | `raw/cases_step4b.csv` |
| 4b | **Receive** 1 laptop WITH serial (operator, PO 2 l.1) and 1 chair WITHOUT serial (SECHO, PO 6 l.2) | 200 | asset 18 `GTSERIAL0001`, asset 19 `N/A` | PASS | `raw/step4b_raw.txt` |
| 4b | **Move** new laptop to person and back (operator), pre-migration asset 3 to person and back (SECHO), new chair to a CKVPL person; operator moving a CKVPL asset | 201s; 404 | 201 ALLOTTED / 201 IN_STOCK ×2, 201; 404 | PASS | `raw/cases_step4b.csv` |
| 4b | vendor create / edit | head office: create + edit; operator: create (DECISIONS 2026-10-14 (3)), edit 403 | as expected (first run wrongly expected operator-create 403: tester error, corrected and re-run) | PASS | `raw/cases_step4b.csv` (GT-219) |
| 4b | Reports (assets preview, movements preview, dashboard), admin Logs (audit LIFECYCLE + RECEIVE rows, errors, system) | 200 + rows | all 200, receive/move audit rows present, error log empty | PASS | `raw/step4b_raw.txt` |
| 4b | ledger check after all writes | status = last event for every asset | `assets_out_of_step_with_ledger = 0`; auth_session 10 rows (2 people) | PASS | `raw/db_after_new_code.txt` |
| 4c | Playwright: sign-in via login page, **cold (full document) load** of `/assets/1`, `/assets/18`, `/assets/new`, `/assets/99999`, and 11 main screens in the signed-in tab | Asset 360 renders with the code; no JSON | all render (asset code / serial visible; friendly not-found page); 0 CSP violations; 0 requests to Google / any external host; Inter loaded from `/assets`; 0 API 5xx | PASS | `raw/cases_step4c.csv`, `raw/screens/` |
| 4c | QR link in a **new tab / no session** (a phone) | login, then Asset 360 | `/login?next=%2Fassets%2F1` → after sign-in `/assets/1` with the code | PASS | `raw/screens/qr_new_tab_*.png` |
| 4c | operator in the browser: own asset renders, CKVPL asset shows no data, register shows only own scope | as designed | as designed | PASS | `raw/cases_step4c.csv` |
| 4d | sign-in rate limit: 20 unknown ids with forged `X-Forwarded-For`, then #21; 11 tries for one id; persona after the window | 401×20, 429; 401×10, 429; 200 | exactly that; `Retry-After: 60`; forged header did not dodge it and never reached the access log (482 lines all `172.26.0.1`) | PASS | `raw/step4d_console.txt` |
| 4 | QR / label decode (see §4) | qr.png = deep link; label.png = asset code | confirmed | PASS | `raw/qr_asset1.png`, `raw/label*_asset1.png` |
| 4e | Print Labels default (fresh browser) | docs: "asset code only, no URL" | default "Barcode + QR" requests `/qr.png` (deep link) + `label.png?symbol=barcode` | **FAIL (docs)** → GT-F02 | `raw/screens/print_labels_default.png` |
| 4 | secret scan of every app log (16 files) and of this evidence folder | 0 | JWT secret 0, DB password 0, bearer tokens 0, canary bodies 0 | PASS | `scripts/scan_logs.mjs` |
| 5 | start-up matrix: `ENVIRONMENT_NAME` ∈ {unset, blank, `prd`, `live`, `prod-1`, garbage, `Production`, `production`} × `JWT_SECRET` ∈ {missing, `dev_secret_change_me`, `change_me_too`, 16 chars, 40 spaces, `a`×40, 31 chars, 64 chars/7 distinct, 10 chars + 30 spaces} (72), + production/good, + development/weak control | 72 refuse, both controls start | **72/72 refuse with exit 3**, every message names the 32-character AND 8-different-character rules, secret printed 0/72; production + good secret starts; development + weak starts (warning only) | PASS | `raw/step5_refusals.csv` |
| 6 | OLD 3b5e842 on the migrated DB: receive / move / sale as SECHO | runbook: all refused | **receive 200 (works)**; move **422**; sale **422**; reads fine; nothing half-written | move/sale PASS; receive **FAIL (runbook claim)** → GT-F01 | `raw/step6_old_on_new_raw.txt`, `raw/step6_old_on_new_server_errors.jsonl` |
| 6 | NEW code on the OLD schema (migration skipped) | fails visibly | health 200, app shell 200, **every sign-in 422** "Some of the values could not be saved…" (server: `column asset_user.token_version does not exist`); start-up WARNING + `system_event head_mismatch` | PASS (see GT-F05) | `raw/step6_premigration_*` |
| 6 | fault injection: migration 4 fails during `upgrade head` | not half-migrated | whole run rolled back: DB at `e6f8a0b2c4d6`, nothing of 1–3 left | PASS (see GT-F04) | `raw/copy_c_after_failed_upgrade.txt` |
| 6a | copy A: new code ran, then `alembic downgrade e6f8a0b2c4d6` (package alembic, owning role) | works | exit 0, 0.78 s wall (~2 ms DDL); column/table/triggers gone, audit purge back to the old 1-day rule; 39 tables, business rows identical; OLD code: receive 200, move 201, sale 201; re-upgrade later works | PASS | `raw/copy_a_after_downgrade_all.txt`, `raw/cases_step6a_downgrade_all.csv` |
| 6b | copy B: new code ran, then `alembic downgrade -1` | works | exit 0, 0.89 s; only the lifecycle guard removed; `auth_session` (3 rows), `token_version` (SECHO = 1), TRUNCATE guards and 5-year floor kept; OLD code: receive 200, move 201, sale 201; `upgrade head` again → head; new code receive/move/sale OK; ledger consistent | PASS | `raw/copy_b_after_downgrade_1.txt`, `raw/cases_step6b*.csv` |
| 6c | roll forward: NEW code on the main DB after the old-code attempts | works | receive 200 (serial), move 201, sale 201; ledger consistent (0 out of step) | PASS | `raw/cases_step6c_rollforward.csv`, `raw/db_final_main.txt` |
| 7 | release switch back (old backend + `FRONTEND_DIST_DIR` → old dist) with the DB migrated | documented consequences | `/assets/1`, `/assets/17`, `/assets/new` → **404 JSON** again; move/sale 422 (receive works, GT-F01); `/docs` 200 HTML, `/openapi.json` 200, `/api/nope` 200 shell, no CSP/Permissions-Policy; **IF-01 reopens: 5/5 probes leak the FAKE canaries** | PASS (documented) | `raw/step7_raw.txt`, `raw/cases_step7*.csv` |
| 7 | `verify_release.ps1` against the switched-back old release (negative control of the verify script) | the script catches it | 37 checks: 19 FAIL, exit 1 | PASS | `raw/verify_release_old_3b5e842.txt` |
| 8 | clean-up | nothing left | see §7 | PASS | — |

## 2. Migrations: timing, locks, size risk

| Revision | What it does on the database | Rows touched / rewrite | Lock taken (briefly) | Size-dependent? |
|---|---|---|---|---|
| `f9a1c3e5b7d2` | `ALTER TABLE asset_user ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0` | none: a constant default is stored in the catalogue (PG ≥ 11), **no table rewrite** | ACCESS EXCLUSIVE on `asset_user` | no |
| `a3c5e7f9b1d4` | 1 function + 4 statement-level `BEFORE TRUNCATE` triggers on `asset_event`, `asset_field_change`, `master_audit`, `audit_log`; replaces 2 functions; REVOKE | none, no scan | SHARE ROW EXCLUSIVE on the 4 tables | no |
| `b5d7f9a1c3e5` | new empty table `auth_session` (FK to `asset_user`) + 2 indexes | none | SHARE ROW EXCLUSIVE on `asset_user` (FK on an empty table needs no validation scan) | no |
| `c6e8a0b2d4f6` | 1 function + `BEFORE UPDATE OF status, current_asset_user_id, status_since` trigger on `asset` | none ("Existing data is not touched") | SHARE ROW EXCLUSIVE on `asset` | no |

Measured here: 0.68 ms, ~2.3 ms, ~2.5 ms, ~1.4 ms of server time; ~1 s per alembic process; one `upgrade head` 0.86 s.
On a much larger database nothing changes in kind: no migration reads or rewrites rows, so the time stays in
milliseconds whatever the table sizes. The only realistic risk is a **lock wait**: each statement waits for any open
transaction on the same table. All four run in ONE transaction, so the locks are held until the final COMMIT (well
under a second). With `CKAM-Web` stopped first (runbook Phase 4 step 1) no CKAM session holds those locks; other
apps on 10.0.0.205 use other databases and cannot. Downgrades are equally metadata-only (`DROP COLUMN` does not
rewrite). PostgreSQL 18 in production vs 17 here: same behaviour for these statements.

Row-count integrity: 39 of 39 pre-existing tables identical before/after the upgrade; after the full downgrade the
business tables equal the original dump (only `audit_log` +4 LOGIN/LOGOUT rows and `system_event` +1 from the new
code's run, kept on purpose).

## 3. Rollback reality (the key risk)

**Exact error with the old code on the new schema** (move or sale, as SECHO):
`HTTP 422 {"detail":"Some of the values could not be saved. Check them and try again.","request_id":"…"}`.
The server log (`error.jsonl`, `ckam.errors`, `source db`, `DBAPIError`) carries the real reason:
`asset status, holder and status date can only change through a recorded asset movement (asset_event)` on
`UPDATE asset SET status=…, current_asset_user_id=…, status_since=…`. The user's message is misleading (they will
retry or re-check the form). Nothing is half-written (asset unchanged, no event row).
**Receives (and other inserts of new assets) still work** with the old code: the asset row is INSERTed already in
its final state and the PROCURED event changes nothing, so the `BEFORE UPDATE OF …` trigger never fires (verified in
3b5e842's `lifecycle/service.py`: `really_changed` is false). Every event that changes status or holder (move, send
for repair, back from repair, lost, found, dispose, sell, scrap, bulk move/action) is refused.

| Option | Result here | Data consequence |
|---|---|---|
| **Roll forward (preferred)**: keep the DB at head, fix and redeploy the new code | new code receive/move/sale all fine after the old-code attempts; ledger consistent | none |
| (b) `alembic downgrade -1` **with the package's alembic** (`releases\eed3de1\backend`; 3b5e842's alembic does not know these revisions), as the owning role | 0.9 s; old code: receive, move, sale all work; later `alembic upgrade head` re-adds the guard (1 migration) | only the lifecycle guard is gone while the old code runs; `auth_session`, `token_version`, TRUNCATE guards, 5-year purge floor stay (the old code ignores them) |
| (a) `alembic downgrade e6f8a0b2c4d6` (all four), same alembic and role | 0.8 s; old code works; re-upgrade works | loses every `auth_session` row (reuse detection history) and every `token_version` value (all back to 0 on a later re-upgrade; whether a refresh token revoked before the downgrade becomes usable again was **not tested**), and reopens IF-05 (TRUNCATE) and IF-06 (purge flag without the 5-year floor) |
| Restore the Phase 3 dump | not rehearsed (destructive) | loses everything written since the deploy |

**Recommendation:** roll forward. A code rollback to 3b5e842 reopens IF-01 (shown in step 7: the canaries leak) and
should only happen with the internet forward closed. If it must happen, use option (b) only (one migration, nothing
of value lost), run from the package's backend folder, and re-run `alembic upgrade head` before the fixed release
starts again. Never option (a).

**Migrate before starting:** the new code on the old schema answers `/api/health` 200 and serves the app, but every
sign-in fails (422). `deploy_ckam.ps1` already refuses to start when `alembic current` ≠ `alembic heads`, and the
app logs `head_mismatch`; a hand deploy that skipped the migration would pass a health-only check.

## 4. QR codes: what each format encodes (verified)

No QR decoder exists offline on this PC, so each served PNG was compared pixel-for-pixel with an image generated
independently (pinned `qrcode 8.2` / `python-barcode`, not the app's functions) from five candidate texts; exactly
one matched each time (`scripts/qrverify.py`).

| Image | Used by | Encodes |
|---|---|---|
| `GET /api/assets/1/qr.png` | Asset 360 header QR; Print Labels **"Barcode + QR" (the default)** | `http://127.0.0.1:4111/assets/1` = `${BASE_URL}/assets/{id}` |
| `GET /api/assets/1/label.png?symbol=qr` | Print Labels "QR Code" | `CKSPL/ITFA-SPL/0001` (asset code) |
| `GET /api/assets/1/label.png?symbol=barcode` | Print Labels "Barcode" and the bars of "Barcode + QR" | `CKSPL/ITFA-SPL/0001` (Code128) |

The encoded deep link opened directly (cold, signed in) shows Asset 360 of that asset; in a new tab it goes through
`/login?next=%2Fassets%2F1` and then lands on the asset. A CKVPL asset's QR is 404 for a CKSPL operator (no backdoor).
After a switch back to 3b5e842 the same link is a 404 JSON page again.

## 5. Findings (new, prefix GT-)

| Id | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| **GT-F01** | Medium (runbook accuracy, rollback decisions) | The runbook (2026-10-16 update banner, Phase 4 table row 4) and `RELEASE.json` say that after `c6e8a0b2d4f6` "the OLD release cannot record receives/moves/sales". Measured: the old release **can still receive** (and add assets); it cannot move, repair, lose/find, dispose, sell or scrap. The user sees a misleading 422 "Some of the values could not be saved. Check them and try again." | GT-601, GT-7L01, GT-602/603, `raw/step6_old_on_new_server_errors.jsonl` | Correct the text ("receives still work; every movement/status change is refused with a generic 422"); add the option (b) procedure (`alembic downgrade -1` from the package folder, re-upgrade before restarting the fixed release) to Phase 4/5 rollback |
| **GT-F02** | Low (docs) | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (URL row) says labels made on Print Labels "contain just the asset code and no URL". The **default** label setting "Barcode + QR" prints `qr.png`, i.e. the `BASE_URL` deep link; only "QR Code" / "Barcode" are code-only. So the public `BASE_URL` (plain HTTP today) is printed on physical labels by default, and a later address change (HTTPS, Phase 14) leaves printed labels pointing at the old address | GT-340/341, `raw/screens/print_labels_default.png`, `frontend/src/components/labels/AssetLabel.tsx` | Fix the docs; plan the HTTPS/`BASE_URL` change knowing printed labels keep the old URL (keep the old address redirecting) |
| **GT-F03** | Info | The `.woff2` fonts are served as `application/octet-stream` by the Linux runtime (Python `mimetypes` in this image has no woff2 entry). Browsers load them anyway (fonts are not MIME-blocked by `nosniff`; Inter loaded, 0 console errors). On Windows `mimetypes` also reads the registry, so the type there may differ | GT-167…174, GT-330 | Optional: `mimetypes.add_type("font/woff2", ".woff2")` at start-up for a deterministic type |
| **GT-F04** | Low (runbook accuracy) | Runbook Phase 4 rollback: "a failed revision leaves the database at the previous revision". `app/alembic/env.py` runs all pending migrations in ONE transaction, so a failure in any of the four leaves the database at `e6f8a0b2c4d6` (fault-injected and confirmed). This is the safer behaviour (the old release keeps working), but the operator should know nothing of 1–3 is kept | GT-037, `raw/copy_c_after_failed_upgrade.txt` | Reword: "a failure rolls back the whole run; the database stays at `e6f8a0b2c4d6`; do not start the new code" |
| **GT-F05** | Low | New code started on the un-migrated schema looks healthy (`/api/health` 200, app shell 200, `verify_release.ps1` has no migration check) but every sign-in answers 422 with the generic "values could not be saved" text. Only `deploy_ckam.ps1`'s `current == heads` check, the start-up `head_mismatch` warning and the runbook's manual diagnostics/sign-in checks catch it | GT-6P00…04, `raw/step6_premigration_server_log.txt` | Keep the deploy script's check; consider adding a "migrations match" line to `verify_release.ps1` (e.g. a non-secret field on `/api/health`) |
| **GT-F06** | Info (docs) | `ops/windows/README.md` says that in single-port production `/docs`, `/redoc`, `/openapi.json` "answer the plain app shell (200)". The package answers a JSON 404 (better); `verify_release.ps1` accepts both | GT-041…044 | Update the README sentence |

Tester errors corrected during the run (not product findings): GT-219 first expected the operator's vendor create to
be refused (it is allowed by DECISIONS 2026-10-14 (3)); the first browser run opened each screen in a NEW tab and saw
the login screen, which is the designed per-tab sign-in (`sessionStorage`), kept as
`raw/cases_step4c_firstrun_newtab.csv`; the step-4a summary first counted the per-request `request_id` as a different
answer. Each was fixed in the script and re-run.

## 6. What could not be exercised

* **Native Windows was NOT possible**: this PC has no Windows Python, so the package ran in a Linux container. The
  Windows-only path behaviour (UNC lookups, drive letters, ADS, device names, 8.3 names, junctions) was probed over
  HTTP and every probe was refused by the lexical check before any filesystem call, but the Windows filesystem itself
  was not involved. The earlier native-Windows runs (`evidence/closure/windows/`) remain the Windows evidence.
  `verify_release.ps1` itself did run natively in Windows PowerShell 5.1 (against the container).
* `deploy_ckam.ps1`, `run_ckam_web.ps1`, `rollback_release.ps1`, Task Scheduler, the NAS mapping, `pip install` on
  Windows and the ERP copy were not run (no Windows venv, no NAS/ERP by rule).
* PostgreSQL 18 (production) vs 17 here; production data volume unknown (see §2: no migration is size-dependent).
* The old release's real frontend build was not available; step 7 used a stub `index.html` for the old
  `frontend-dist`, so only the old **backend** behaviour was shown (deep-link 404 JSON comes from the backend).
* Whether a refresh token revoked before a full downgrade becomes usable again after a re-upgrade was not tested
  (option (a) is not recommended anyway).
* QR images were identified by re-encoding comparison, not by an independent decoder.

## 7. Clean-up

`docker ps -a`, `docker volume ls`, `docker network ls` filtered by `ckam-gate` list nothing; the Postgres
container was removed with `-v` (its anonymous data volume is gone); the scratch folder (extracted package, `old.tar`,
the env files with the throw-away secret, copied logs) was deleted; the zip still has its original SHA-256. The
compose stacks `ckam-build`, `ckam-uat`, `ckam-sec` kept running untouched. The throw-away DB passwords that appear
in `scripts/restore.sh` / `scripts/dbcheck.sh` belonged to the deleted container only.

## 8. Files

* `tests.csv` — all 283 cases (id, step, what, expected, actual, result, evidence).
* `scripts/` — `lib.mjs`, `raw.mjs`, `step2_old_baseline.mjs`, `step4a_surface.mjs`, `step4b_functional.mjs`
  (+ `step4b_fix.mjs`), `step4c_browser.mjs` (+ `_firstrun`), `step4d_ratelimit.mjs`, `step4e_printlabels.mjs`,
  `refusals.py`, `step6_lifecycle_try.mjs`, `step6_premigration.mjs`, `seed_sessions.mjs`, `step7_release_switch.mjs`,
  `alembic_run.py`, `depcheck.py`, `qrverify.py`, `setup_volume.py`, `restore.sh`, `counts.sh`, `dbcheck.sh`,
  `schema_check.sql`, `session_check.sql`, `downgrade_check.sql`, `fault_inject.sql`, `scan_logs.mjs`, `explore.mjs`,
  `merge_cases.mjs`.
* `raw/` — per-step case files, raw outputs (bearer tokens redacted; no secret), row counts, schema/DB checks, the
  Alembic and PostgreSQL statement logs, `verify_release` outputs, QR/label PNGs, and `raw/screens/` (8 screenshots).
