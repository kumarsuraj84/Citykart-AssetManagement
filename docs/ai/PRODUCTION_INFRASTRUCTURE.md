# CKAM Production Infrastructure (current as of 2026-10-07)

No passwords, keys or tokens are written here, only where they live.

## Layout

| Piece | Where |
|---|---|
| App server | `10.0.1.98`, folder `D:\Citykart_Applications\Citykart_AssetManagement_App` (shared server: Spinwheel and Citykart Desk also run there; never touch them) |
| Process | Scheduled Task `CKAM-Web` (SYSTEM, at startup, restart every minute up to 999 times, no time limit). One uvicorn process serves the API and the built frontend on **port 3211** |
| Runtime | Python 3.13.15 at `C:\Program Files\Python313` (not on PATH); venv at `shared\venv` on D: |
| Releases | `releases\<sha>\{backend,frontend-dist}`; live release **`e8f85a0`** (deployed 2026-10-09; `7d38523` kept beside it for rollback) |
| Config | `shared\.env` (Administrators/SYSTEM only). Holds DB URL, JWT secret, `BASE_URL`, `UPLOAD_DIR`, `FRONTEND_DIST_DIR` |
| Launcher | `shared\run_ckam_web.ps1`: loads `.env`, logs in to the NAS (retries up to 3 minutes at boot), starts uvicorn. Logs in `logs\` |
| Database | `10.0.0.205` PostgreSQL 18, data on `D:\POSTGRESQL DB`, database `ckassetmanagement`, app role `ckassetapp` (not superuser). `pg_hba.conf` allows only `10.0.1.98/32` for it |
| Files | NAS `\\10.0.0.25\ckapplications_data\CKASSETMANAGEMENT_DATA` as NAS user `ckappuser`. Password is in `shared\nas.pw` (Administrators/SYSTEM only) |
| Backups | Task `CK_Backup_CKASSETMANAGEMENT` on 10.0.0.205, daily 03:00, shared script `C:\ProgramData\CKBackup\backup-db.ps1`, output `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`, 30 days kept, see `backup.log` there. Not yet copied off the DB server |
| Firewall | Rule `CKAM-Web`, inbound TCP 3211 on 10.0.1.98 (same scope as the other apps' rules). Port registered in `D:\Citykart_Applications\PORTS.md` |
| URL | Public address users are given: **`http://ckam.citykartstores.com:3211/`** (DNS A record `ckam` in citykartstores.com -> `182.72.84.10`; router forwards TCP 3211 -> `10.0.1.98:3211`). LAN address `http://10.0.1.98:3211` also works. `BASE_URL` in `shared\.env` is set to the public address (used only for the "open this asset" link inside the small QR on the Asset Detail page, `/api/assets/{id}/qr.png`; the labels made on the Print Labels screen contain just the asset code and no URL) |

## What is NOT done / open

- Public access: the DNS A record and the router forward 3211 -> 10.0.1.98 are the user's steps (confirm they exist before sharing the link). The site is plain HTTP, so logins cross the internet unencrypted; HTTPS in front of it is a recommended later step. If the address changes, update `BASE_URL` in `shared\.env` and restart `CKAM-Web`, and note that any Asset Detail QR already printed or saved keeps the old address.
- HTTPS (decision deferred by the user, 2026-10-08). Notes for later: the certificate is installed on the app server only, never on users' devices, as long as it comes from a public CA (a self-signed or internal-CA certificate would need installing on every device). Options: an existing `*.citykartstores.com` wildcard, Let's Encrypt (port 3211 means the domain proof must be a DNS record, so automation needs DNS API access, otherwise a manual TXT record every 90 days), or a paid 1-year certificate. Serve it either from uvicorn (`--ssl-certfile/--ssl-keyfile`) or via Caddy in front. Then set `COOKIE_SECURE=true` and `BASE_URL=https://ckam.citykartstores.com:3211`. Port 3211 becomes HTTPS-only (`http://10.0.1.98:3211` stops working; by IP the browser shows a name mismatch), and renewal must be automatic or scheduled or the site goes down at expiry.
- Off-server copy of the nightly dumps.
- Reboot test of 10.0.1.98 (confirm `CKAM-Web` returns and uploads still reach the NAS).

## Retired

Old server `10.0.1.12` (`E:\CK Projects\Citykart_Asset_Management`, database `ckam_prod`) is permanently out of service as of 2026-10-07: task `CKAM-Web` stopped and disabled, `shared\.env` and `shared\run_ckam_web.ps1` renamed `*.RETIRED-2026-10-07`, database role `ckam_app` set to NOLOGIN, port 3211 closed. Files and database kept only as an archive (it held just bootstrap accounts, no user data). Do not work on it, and never run both systems at once.

## Deploying a new version

1. Develop and test on the dev PC only. Get the user's explicit OK before any `git push` and before any deploy.
2. Build `frontend` (`npm run build`), package `backend/{app,alembic.ini,pyproject.toml,scripts/create_owner.py}` and `frontend/dist` into `releases\<sha>\`.
3. On 10.0.1.98: back up first (run `CK_Backup_CKASSETMANAGEMENT` on the DB server and confirm `backup.log` says OK), stop `CKAM-Web`, `pip install -e` the new backend into `shared\venv`, set `FRONTEND_DIST_DIR` in `.env` to `<new release>\frontend-dist`, run `alembic upgrade head` (it needs the `.env` values in the process environment), then start `CKAM-Web`.
   **`FRONTEND_DIST_DIR` is the single switch for the release:** the launcher (`shared\run_ckam_web.ps1`) runs the backend from the `backend` folder next to it. (Until 2026-10-09 the launcher had the old release folder hard-coded, so the frontend updated but the API did not. Always verify below.)
4. Verify the NEW code is really running, not just that the site answers: `GET /openapi.json` lists the new routes/parameters, the served `index.html` references the new bundle name, the launcher log says `serving release: <new>`, `/api/health` is ok, and the NAS login line in the launcher log succeeded.
5. Rollback: set `FRONTEND_DIST_DIR` and the editable install back to the previous release folder and restart the task. Database changes are never auto-reversed (restore from a verified backup only if truly needed).

## Rules

- Touch only CKAM's own folder, database, NAS folder, task and firewall rule on the shared servers.
- `alembic upgrade head` and `scripts/create_owner.py` print one-time passwords. Capture them to an admin-only file, never into reports or chat.
- Superuser database steps are run by the user on 10.0.0.205 (they type the `postgres` password).
