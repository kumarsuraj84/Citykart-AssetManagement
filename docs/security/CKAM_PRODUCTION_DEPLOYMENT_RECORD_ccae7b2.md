# CKAM production deployment record — security release `ccae7b2`

| | |
|---|---|
| Date / window | 2026-10-17, 11:14–11:30 IST (CKAM downtime 11:21:51 → 11:23:36 = **1 min 45 s**) |
| Approval | The owner typed the exact sentence `DEPLOY CKAM SECURITY RELEASE ccae7b2` in chat. Approved: the deploy and the **JWT secret** rotation. **Not approved / left out on purpose by the owner (2026-10-17): the DB password (`ckassetapp`), the NAS password (`ckappuser`) and the ERP password (`ckpost`)** |
| Done by | Claude (over SSH, small `.ps1` files run with `-File`); the owner did the sign-in checks. No secret was printed or typed by Claude |
| From → to | release `3b5e842` → `ccae7b2` (`ccae7b2281bc4ca71f4b6113f61dc86de392bc3e`); database `e6f8a0b2c4d6` → `c6e8a0b2d4f6` (four migrations, one transaction, **2.34 s**) |
| Servers touched | App server 10.0.1.98 (CKAM folder, task `CKAM-Web`); DB server 10.0.0.205 (CKAM's own backup task, read-only precheck folder). Nothing else. 10.0.1.12 untouched |
| Result | **Deployed. IF-01 (unauthenticated file read) is closed on production.** Rotation of the DB, NAS and ERP secrets is still open (owner decision), so the exposure of those three is **not** closed |

## What was done, in order

| # | Step | Result |
|---|---|---|
| 1 | Read-only prechecks on both servers (`ops/precheck`) | App: `ENVIRONMENT_NAME=production`, JWT secret strong (value never shown), `DATABASE_URL` host 10.0.0.205, disk 395 GB free, DB/NAS/package index reachable. DB: PostgreSQL 18.6, Alembic `e6f8a0b2c4d6`, DB 28 MB, `ckassetapp` not a superuser, `pg_hba` allows only the app server for this DB, nightly backup task OK (last result 0). Antivirus: Windows Defender only; **no Seqrite or other third-party product on either server** (name search of services and installed programs). Defender exclusion lists could not be read over SSH |
| 2 | Evidence copy (step B) | `D:\CKAM_EVIDENCE_20261017_111445` on the app server (admin-only ACL): CKAM logs, task XML, folder listings, 9 Windows event logs, SHA-256 list. The server had **no** Windows Firewall text log |
| 3 | Backup (step D) | CKAM's own backup task run twice: `ckassetmanagement_20261017_111452.dump` (before the change; SHA-256 `cdbd22afc9e2fdf75f28e322f43201bb5113925e284e313d2fd05118a6147b10`) and one more after CKAM was stopped. The backup script verifies each dump with `pg_restore --list` before keeping it. Dumps live **only** on `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP` of the DB server — the owner accepted that as sufficient. NAS file copy not made (the deploy does not change documents; production holds no assets yet) |
| 4 | Copy + verify (step E) | Zip SHA-256 `b975c38d…7137e3` and size 2,152,224 **match on the server**. 215 files; `VERSION`, `RELEASE.json` (`ccae7b2`, head `c6e8a0b2d4f6`, 44 pins) and the bundle name `index-Cp5JgQR-.js` correct. **All 215 per-file SHA-256 match `MANIFEST.sha256.txt`.** The runbook's one-shot "content hash" snippet gave `96cad826…` instead of `e2408eab…`: that snippet had never been run before and is not the proof; treat the zip hash and the per-file comparison as the proof and the snippet as unreliable |
| 5 | Launcher | Live launcher (SHA-256 `B6D08CC2…CC00`) lacked both flags. Replaced by the reviewed template `run_ckam_web.ps1.template` (SHA-256 `56F9B5C7…1F07`); `-WhatIf` dry run first. Old launcher saved in the evidence folder |
| 6 | Cutover (step F) | `CKAM-Web` stopped (port 3211 free); `pip install -c constraints.txt -e` OK (exit 0, `pip check` clean, **0 pin mismatches**, `colorama==0.4.6`; one extra unpinned package already in the venv: `opentelemetry-api==1.45.1`); `.env` switched (`FRONTEND_DIST_DIR`, `APP_VERSION`; no BOM); four migrations to head |
| 7 | Start (step G) | Healthy after 5 s. One listener; process command line has `--no-proxy-headers --no-server-header`; launcher log names `ccae7b2`, NAS mapping succeeded; stderr empty; startup event: `db_head == code_head == c6e8a0b2d4f6`, `database_host 10.0.0.205`, JWT checks true |
| 8 | Verify (step H, no-sign-in part) | `verify_release.ps1 -LocalProcessCheck Require`: **42/42 PASS** (before and after the JWT rotation). 15 manual file-read probes (`..%2f`, `%5c`, drive, UNC, `CON`, `NUL`, `::$DATA`, …): all **404**, from the server and from the LAN. `/openapi.json`, `/docs`, `/redoc`: JSON 404. `/assets/<id>` and `/assets/new`: **200** app page (QR deep link works). Headers once, no `Server` header, forged `X-Forwarded-For` ignored. ERP copy ran after the start (`sync_success`) |
| 9 | Owner sign-in | The owner signed in at 11:27 IST (audit `LOGIN`, `auth_session` row created by the new code): proves the migrated schema works for sign-in. Functional checks H14–H19 (asset list, PO, receive, move, documents) are the owner's; production has 0 assets, so receive/move were not exercised by Claude |
| 10 | JWT rotation (step I.1) | New 64-hex key generated **on the server**, written straight to `shared\.env`, never displayed. Strength check true/true/not-quoted, no BOM, other keys intact; `CKAM-Web` restarted 11:26:56–11:27:10; no "Refusing to start"; `app_started` shows `jwt_signing_key_is_placeholder=false`. All earlier tokens are void |
| 11 | Compromise review (step K, read-only) | See below |

## Compromise review (step K) — what the evidence can and cannot say

- **Retained request history starts only on 2026-10-14 14:13 IST** (release `3b5e842` start). Before that the old releases wrote no request log (the web server's access log is off; the `.out.log` files hold only start-up lines). **Requests between the start of IF-01 (2026-09-30, live on production since the 2026-10-07 migration) and 2026-10-14 cannot be reviewed.** No router/firewall, NAS or PostgreSQL connection log exists either (`log_connections` is off; no firewall text log).
- In the retained window (to 2026-10-17 08:52 UTC copy time): **10 requests in total**, all HTTP 200, from `127.0.0.1` (7) and the dev PC (3). **0** suspicious paths (no `..`, `%2e`, `%5c`, `\`, `:`, `.env`, `nas.pw`, `shared`, `win.ini`, scripts), **0** requests to `/assets/`, **0** responses over 1 MB, no 401/403/5xx.
- Users: only the two original ADMIN accounts (created 2026-10-07); no account was created since. `audit_log` holds 9 rows: the owner's `LOGIN`, 3 `LOGS_VIEWED`, 1 `ERP_SYNC`, plus 4 failed attempts from `127.0.0.1` that are the verify script's own probes. The owner's sign-in was recorded from address `10.0.0.1` (see observation 2).
- The one ERROR in the logs is an ERP-side `QueryCanceledError` on 2026-10-15 (ERP copy timeout), unrelated.
- **Decision (draft, for the owner to sign):** *no evidence of misuse in the retained logs; misuse before 2026-10-14 cannot be ruled out.* Therefore treat the three secrets that are **not yet rotated** (DB `ckassetapp`, NAS `ckappuser`, ERP `ckpost`) as possibly exposed. The JWT key is replaced, so forged login tokens no longer work.

## Still open after this deployment

1. Rotate the DB (`ckassetapp`), NAS (`ckappuser`) and ERP (`ckpost`) passwords — **left out by the owner on 2026-10-17**; revisit. The shared-account questions (C10) are still unanswered.
2. The old settings copies in the evidence folder held the old secrets: **deleted at the end of this change** (they would otherwise be copied off the server with the evidence). Their SHA-256 values are in `env.pre-ccae7b2.sha256.txt`.
3. HTTPS (login is plain http; `COOKIE_SECURE=false`), the service account (task runs as SYSTEM), network restriction of port 3211, backups only on the DB server — unchanged.
4. Copy `D:\CKAM_EVIDENCE_20261017_111445` to an admin-only / encrypted place that is not the CKAM NAS folder (owner).
5. Git push of the security evidence and of local commits only on the owner's push phrase (the repository is public).

## Observations for the owner

1. **Rate limit behind the office router (new).** The owner's browser sign-in reached CKAM from `10.0.0.1`, not from the PC's own address; the dev PC reaching the server by IP shows its real address. Staff who open CKAM through `ckam.citykartstores.com` are probably translated to `10.0.0.1`, so they would **share** the sign-in limit (20 per minute per address). If many people sign in in the same minute, some may be told to wait. Safer: use the internal address or an internal DNS name for CKAM. Not changed in this release.
2. One package (`opentelemetry-api==1.45.1`) is in the production venv but not in `constraints.txt`; the venv is otherwise exactly the 43 pinned packages.
3. Old releases (`3b5e842` and earlier) were kept. **Do not run the old release again** (it reopens IF-01 and cannot move/sell/scrap assets after the new database trigger); roll forward instead.
4. The runbook's content-hash snippet (step E4) is wrong or unreliable; fix it before the next release.

## Evidence (on the app server, admin-only)

`D:\CKAM_EVIDENCE_20261017_111445`: `logs-at-stop`, `ckam_app_logs`, `ckam_all_logs_folder`, event logs, `task_CKAM-Web.xml`, `pip-install.txt`, `pip-check.txt`, `alembic-*.txt`, `verify_server.csv`, `if01_probe_results_server.csv`, `release_ccae7b2_filehashes.txt`, `run_ckam_web.live-before.ps1`, precheck reports (`ckam_precheck_app_*.txt`). These contain staff names and IP addresses: do not paste them into chat, tickets or AI tools.
