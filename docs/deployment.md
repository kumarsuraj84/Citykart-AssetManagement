# CKAM Deployment Guide (LAN server)

## Prerequisites
- Docker + Docker Compose v2 installed on the server.
- Port 3211 (web) open on the LAN. That is the only port other devices need.

### Ports
`docker-compose.yml` publishes three host ports:

| Service | Host port | Bound to | Who can reach it |
|---|---|---|---|
| `web` (nginx: the app and `/api`) | `${WEB_PORT:-3211}` | all interfaces | everyone on the LAN |
| `db` (PostgreSQL) | `${DB_PORT:-5432}` | `127.0.0.1` only | the server itself (psql, pgAdmin over SSH tunnel) |
| `api` (FastAPI, bypasses nginx) | `${API_PORT:-8000}` | `127.0.0.1` only | the server itself (curl, `/docs`) |

Postgres and the raw API are deliberately **not** reachable from other LAN devices: the database is
password-only, and the direct API path skips nginx (and its upload limit). If you genuinely need one of
them from another machine, prefer an SSH tunnel (`ssh -L 5432:127.0.0.1:5432 user@server`). Only if that
is impossible, edit the `ports:` entry in `docker-compose.yml` to drop the `127.0.0.1:` prefix
(e.g. `"${DB_PORT:-5432}:5432"`), restart with `docker compose up -d`, and firewall the port to the
specific admin machine.

## First-time setup
1. Copy `.env.example` to `.env` and set:
   - `POSTGRES_PASSWORD`.
   - `JWT_SECRET` — a long random value (`openssl rand -hex 32`). If this is left unset, the API falls back
     to a development secret that is committed to this repository (anyone who has seen the code could forge
     login tokens, including ADMIN ones) and prints a large `SECURITY WARNING` at startup — check
     `docker compose logs api` after every deploy and make sure that warning is **not** there.
   - `BASE_URL` — the web app's address **as a phone on the LAN reaches it**, e.g.
     `http://assets.citykart.local:3211` or `http://192.168.1.50:3211`. Printed QR labels encode
     `${BASE_URL}/assets/<id>`, so `localhost` or the API's port 8000 here produces labels that scan to
     nowhere. Labels printed before a `BASE_URL` change keep the old address.
   - `BACKUP_DIR` — see "Backups" below for where it should point.
   - `COOKIE_SECURE` — leave `false` for plain HTTP (this guide). Browsers never send a `Secure` cookie over
     HTTP, so `true` without HTTPS silently breaks session refresh (everyone gets logged out every 15
     minutes). Set it to `true` only once the site is served over HTTPS.
2. `docker compose up -d --build`
3. Run migrations: `docker compose exec api alembic upgrade head`
4. Create the first ADMIN holder:
   - **For this deployment**, the real owner account (Ankur Pahwa, Citykart Stores) is created with `docker compose exec api python -m scripts.create_owner`. It is idempotent (safe to re-run) and on its *first* run only, prints a one-time temporary password to stdout — relay it to the account owner out-of-band. `must_change_password` is set, and the app enforces it: after the first login with the temporary password the user is taken to a "Set a new password" screen, and the API refuses every other request (HTTP 403) until the password has been changed. Re-running the script never touches an already-created holder's password. See `backend/scripts/create_owner.py`.
   - For dev/E2E setups needing a generic, throwaway admin instead, use `docker compose exec api python -m scripts.seed_admin --company-code E2E --password '<something-random>'`. **Never run this against a database that is, or will become, production** — see "End-to-end (Playwright) tests" below. See `backend/scripts/seed_admin.py`.
5. Visit `http://<server-ip>:3211/` and log in. With nothing configured yet, go to **Setup → Code Rule**
   (assets can't be numbered without one), then **Setup → Holders & Users** to create at least one
   `IT_STOCK` holder per stock location, before adding the first asset.

## Day-to-day
- Logs: `docker compose logs -f api`
- Restart: `docker compose restart api web`
- Update (migrations do **not** run automatically on container start — always run the third command, it is a
  no-op when there is nothing new):
  ```bash
  git pull
  docker compose up -d --build
  docker compose exec api alembic upgrade head
  ```
- Running the backend test suite: **never** against this stack's `ckam` database — see
  [backend/README.md](../backend/README.md#running-the-test-suite) for the dedicated `ckam_test` database
  to use instead.

## End-to-end (Playwright) tests

`frontend/e2e/` drives the real app in a browser. Its fixture **writes real data** into whatever stack it
targets: it creates a company, a `SEEDADMIN` ADMIN login (via `scripts.seed_admin`), holders and masters, and
the test itself records an asset with ledger events. A `test.afterEach` teardown deactivates the company,
every holder (SEEDADMIN last) and every master it created — also when the test fails — but the test asset
and its custody events **cannot** be removed: the asset ledger is append-only by design.

So run Playwright against a **dedicated E2E/staging stack**, never against a stack whose database anyone might
later back up and restore into production. A separate Compose project on the same machine is enough — it gets
its own containers and its own database/upload volumes:

```bash
# from the repo root: an isolated stack on other host ports
COMPOSE_PROJECT_NAME=ckam-e2e WEB_PORT=13211 DB_PORT=15432 API_PORT=18000 docker compose up -d --build web
COMPOSE_PROJECT_NAME=ckam-e2e docker compose exec api alembic upgrade head
# run the suite against it (COMPOSE_PROJECT_NAME also routes the fixture's `docker compose exec`)
cd frontend
COMPOSE_PROJECT_NAME=ckam-e2e E2E_BASE_URL=http://localhost:13211 npx playwright test
# throw the whole thing away afterwards, data included
cd .. && COMPOSE_PROJECT_NAME=ckam-e2e docker compose down -v
```

(Some Windows hosts reserve ports like 5433; pick any free high ports.)

## Backups

> **Before using any backup to seed production:** backups taken on the dev/demo machine (including every
> file already in this repo's `backups/` folder) may contain test data — E2E companies, `SEEDADMIN` ADMIN
> logins with known passwords, test holders and assets. Do not restore one onto the production server without
> first running the test-account check in "Moving from the dev machine to the production server", step 1.

- Nightly automatic backup to `${BACKUP_DIR}`, 14-day retention, run by the `backup` service (cron, `0 2 * * *`) — see `docker-compose.yml` and `ops/backup.sh`. The `backup` service must be running for this (`docker compose up -d` starts it).
- **Where `BACKUP_DIR` should point on the production server:** an absolute path on a disk other than the one holding Docker's volumes (so one disk failure can't take both the database and its backups), and which is itself copied off the server (NAS share, external drive rotation, or the company file server's backup), e.g. `BACKUP_DIR=/srv/ckam-backups` (Linux) or `BACKUP_DIR=D:/ckam-backups` (Windows). Create the folder before `docker compose up`. The default `./backups` (inside the repo checkout) is only suitable for development.
- The `backup` service intentionally runs on `postgres:17-alpine`, not the `db` service's `postgres:17` (Debian-based) image. The Debian-based image ships neither `apk` nor a working cron daemon, so an `apk add ... || true`-style fallback would silently no-op and the nightly job would never run. `postgres:17-alpine` ships matching PostgreSQL 17 client tools (so `pg_dump`/`psql` are always version-matched to the `db` server) plus BusyBox `crond`, `tar` and `gzip` already built in — verified directly by running the image and confirming a test crontab entry fired under `crond -f`.
- Manual backup: `docker compose exec backup sh /scripts/backup.sh`
- Two files are produced per run: `ckam_db_<timestamp>.sql.gz` (a full `pg_dump` of the `ckam` database) and `ckam_uploads_<timestamp>.tar.gz` (a tar of the `uploads` volume).
- `ops/test_backup_restore.sh` is a repeatable, scripted backup→restore→verify check (seeds known data, backs it up, drops the schema, restores, and asserts row counts match). Re-run it against a disposable dev/staging stack any time `docker-compose.yml`, the backup/restore scripts, or the Postgres version changes. It is destructive to whatever stack it runs against — see its header comment.

## Restore

> **WARNING: THIS IS A DESTRUCTIVE OPERATION.** Restoring permanently overwrites and destroys all
> current data in the target database (and the target `uploads` volume) — there is no undo once
> `restore.sh` has run. **Before you run it, stop and confirm you are on the intended host and the
> intended environment** (e.g. `docker compose ps` / `hostname` / check you are not accidentally
> pointed at production while testing) — a restore aimed at the wrong stack is unrecoverable.

`ops/restore.sh <db_backup.sql.gz> <uploads_backup.tar.gz>` replays a plain-SQL `pg_dump` (schema + data) and untars the uploads archive. `restore.sh` runs `psql -v ON_ERROR_STOP=1` (so any single failed statement aborts the whole restore with a non-zero exit code, instead of silently printing "Restore complete." over a partial load) and `set -o pipefail` (so a failure earlier in the `gunzip | psql` pipe is not masked by `psql` succeeding on empty input). Because it is a plain SQL dump (not `pg_restore --clean`), **it must be run against a database with no existing schema** — otherwise every `CREATE TABLE`/`ALTER TABLE`/`ADD CONSTRAINT` statement collides with the objects already there, and if constraints are already active, `COPY` can fail with foreign-key violations partway through (this was verified by testing: restoring into a merely-truncated database produced dozens of errors and a partially-loaded `holder` table, while restoring into a database whose schema had been dropped — i.e. a genuinely fresh state — completed cleanly with correct row counts and no errors). **Do not run `alembic upgrade head` before a restore** — that creates the very schema that then collides with the dump. Running it *after* a restore is fine (and needed if the code is newer than the dump — see step 5).

Steps for a real restore (the `restore.sh` script runs inside the `backup` service, so that service must be running):
1. **Stop the `api` service first** (`docker compose stop api`) to avoid writes during restore, and make sure `backup` is up: `docker compose up -d db backup`.
2. Ensure the target database has no schema. Either:
   - restore onto a brand-new `db` volume (e.g. after `docker compose down -v` and `docker compose up -d db backup`, before running `alembic upgrade head`), or
   - on an existing volume you intend to overwrite, drop and recreate the schema first: `docker compose exec db psql -U ckam -d ckam -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ckam;"`
3. Run the restore: `docker compose exec backup sh /scripts/restore.sh /backups/<db_file> /backups/<uploads_file>` (the files must be in `${BACKUP_DIR}`, which is mounted at `/backups`).
4. Start the API again: `docker compose up -d api`, then spot-check row counts, e.g. `docker compose exec db psql -U ckam -d ckam -c "SELECT count(*) FROM asset;"`.
5. `docker compose exec api alembic current` shows the revision the dump was taken at; run `docker compose exec api alembic upgrade head` to bring it up to the current code (a no-op if already at head).

## Moving from the dev machine to the production server

This is a **restore-based deployment**, not a fresh install — it brings over existing data, so it
**must not run migrations before the restore**. `restore.sh`'s dump already contains the full schema at whatever
migration head it was taken at; running `alembic upgrade head` first would create that same schema again
and the restore would then collide with it (see the warning in "Restore" above).

> **Consider not doing this at all.** If the dev database has ever had the E2E suite, `seed_admin.py` or
> other test data run against it, a clean First-time setup on the server plus the Excel import is often
> safer than carrying the dev database over.

1. **On the dev machine, BEFORE taking the backup: make sure no test/E2E accounts or companies exist.**
   E2E runs create companies coded `E2E-…` with `SEEDADMIN` ADMIN logins and test holders; a leftover one
   is an ADMIN account with a password that may be known to anyone who has read the repository. Run:
   ```bash
   docker compose exec db psql -U ckam -d ckam -c "
     SELECT c.id AS company_id, c.code, c.is_active AS company_active,
            h.id AS holder_id, h.emp_code, h.name, h.role, h.is_active,
            h.password_hash IS NOT NULL AS can_log_in
     FROM holder h JOIN company c ON c.id = h.company_id
     WHERE h.emp_code ILIKE '%SEEDADMIN%' OR h.emp_code ILIKE '%TEST%' OR h.emp_code ILIKE '%E2E%'
        OR h.name ILIKE '%E2E%' OR h.name ILIKE '%TEST%' OR c.code ILIKE 'E2E%'
     ORDER BY c.id, h.id;"
   ```
   Every row returned must be understood. For any test account or company found, deactivate it and remove
   its ability to log in (this app never hard-deletes), then re-run the query to confirm:
   ```bash
   docker compose exec db psql -U ckam -d ckam -c "
     UPDATE holder SET is_active = false, password_hash = NULL
       WHERE emp_code ILIKE '%SEEDADMIN%' OR company_id IN (SELECT id FROM company WHERE code ILIKE 'E2E%');
     UPDATE company SET is_active = false WHERE code ILIKE 'E2E%';"
   ```
   (Adjust the `WHERE` clauses to what the check actually found — do not deactivate a real account.)
   Also check that the real admin's own password is not a default/temporary one.
2. Still on the dev machine: `docker compose exec backup sh /scripts/backup.sh` to take a full snapshot
   **after** step 1. Do not use any older file from `backups/` — those predate the cleanup.
3. Copy the repo (or `git clone` from the GitHub remote) and the two new backup files to the server; put the
   backup files in the server's `${BACKUP_DIR}`.
4. On the server:
   a. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`, `JWT_SECRET`, `BASE_URL`, `BACKUP_DIR` (First-time setup, step 1).
   b. Bring up `db` and `backup` only — **not** `api`, and **without running migrations**: `docker compose up -d db backup` (the `db` volume is brand-new here, so it already has no schema — do not run `alembic upgrade head`). `backup` must be running because the restore script runs inside it.
   c. Run the restore: `docker compose exec backup sh /scripts/restore.sh /backups/<db_file> /backups/<uploads_file>` ("Restore", step 3; steps 1–2 are already satisfied — `api` isn't running and the database is empty).
   d. `docker compose up -d --build` to build and start `api` and `web` (and keep `db`/`backup` running).
   e. `docker compose exec api alembic upgrade head` — applies any migrations newer than the dump (a no-op otherwise); `docker compose exec api alembic current` should then report `(head)`.
   f. Re-run the test-account query from step 1 against the server's database and confirm it returns nothing active.
   g. `docker compose logs api` must **not** show the `SECURITY WARNING` about `JWT_SECRET`.
   h. Visit `http://<server-ip>:3211/` and log in with an account from the restored data — skip the seed-admin step from First-time setup, since the restore already brought over the admin holder(s).
