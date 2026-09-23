# CKAM Deployment Guide (LAN server)

## Prerequisites
- Docker + Docker Compose v2 installed on the server.
- Ports 3211 (web) and optionally 5432 (Postgres, for admin access only) open on the LAN.

## First-time setup
1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`, `JWT_SECRET`, `BASE_URL` (e.g. `http://assets.citykart.local:3211`), `BACKUP_DIR`.
2. `docker compose up -d --build`
3. Run migrations: `docker compose exec api alembic upgrade head`
4. Create the first ADMIN holder:
   - **For this deployment**, the real owner account (Ankur Pahwa, Citykart Stores) is created with `docker compose exec api python -m scripts.create_owner`. It is idempotent (safe to re-run) and on its *first* run only, prints a one-time temporary password to stdout — relay it to the account owner out-of-band and have them change it, since `must_change_password` is set and forces a real password at first login. Re-running the script never touches an already-created holder's password. See `backend/scripts/create_owner.py`.
   - For dev/E2E setups needing a generic, throwaway admin instead, use `docker compose exec api python -m scripts.seed_admin --company-code E2E --password 'Passw0rd!'` (change the password before going live — also idempotent). See `backend/scripts/seed_admin.py`.
5. Visit `http://<server-ip>:3211/` and log in.

## Day-to-day
- Logs: `docker compose logs -f api`
- Restart: `docker compose restart api web`
- Update: `git pull && docker compose up -d --build`
- Running the backend test suite: **never** against this stack's `ckam` database — see
  [backend/README.md](../backend/README.md#running-the-test-suite) for the dedicated `ckam_test` database
  to use instead.

## Backups
- Nightly automatic backup to `${BACKUP_DIR}`, 14-day retention, run by the `backup` service (cron, `0 2 * * *`) — see `docker-compose.yml` and `ops/backup.sh`.
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

`ops/restore.sh <db_backup.sql.gz> <uploads_backup.tar.gz>` replays a plain-SQL `pg_dump` (schema + data) and untars the uploads archive. `restore.sh` runs `psql -v ON_ERROR_STOP=1` (so any single failed statement aborts the whole restore with a non-zero exit code, instead of silently printing "Restore complete." over a partial load) and `set -o pipefail` (so a failure earlier in the `gunzip | psql` pipe is not masked by `psql` succeeding on empty input). Because it is a plain SQL dump (not `pg_restore --clean`), **it must be run against a database with no existing schema** — otherwise every `CREATE TABLE`/`ALTER TABLE`/`ADD CONSTRAINT` statement collides with the objects already there, and if constraints are already active, `COPY` can fail with foreign-key violations partway through (this was verified by testing: restoring into a merely-truncated database produced dozens of errors and a partially-loaded `holder` table, while restoring into a database whose schema had been dropped — i.e. a genuinely fresh state — completed cleanly with correct row counts and no errors). **Do not run `alembic upgrade head` before a restore** — that creates the very schema that then collides with the dump; migrations and restore are alternatives, not a sequence (see "Moving from the dev machine to the production server" below).

Steps for a real restore:
1. **Stop the `api` service first** (`docker compose stop api`) to avoid writes during restore.
2. Ensure the target database has no schema. Either:
   - restore onto a brand-new `db` volume (e.g. after `docker compose down -v` and `docker compose up -d db`, before running `alembic upgrade head`), or
   - on an existing volume you intend to overwrite, drop and recreate the schema first: `docker compose exec db psql -U ckam -d ckam -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ckam;"`
3. Run the restore: `docker compose exec backup sh /scripts/restore.sh /backups/<db_file> /backups/<uploads_file>`
4. Start the API again: `docker compose start api`, then spot-check row counts, e.g. `docker compose exec db psql -U ckam -d ckam -c "SELECT count(*) FROM asset;"`, and confirm `docker compose exec api alembic current` still reports the expected head revision.

## Moving from the dev machine to the production server

This is a **restore-based deployment**, not a fresh install — it brings over existing data, so it
**skips the migrations step entirely**. `restore.sh`'s dump already contains the full schema at whatever
migration head it was taken at; running `alembic upgrade head` first would create that same schema again
and the restore would then collide with it (see the warning in "Restore" above). Only run
`alembic upgrade head` for a genuinely fresh install with no data to restore (First-time setup, step 3).

1. On the dev machine: `docker compose exec backup sh /scripts/backup.sh` to get a full snapshot.
2. Copy the repo (or `git clone` from the GitHub remote) and the two backup files to the server.
3. On the server:
   a. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`, `JWT_SECRET`, `BASE_URL`, `BACKUP_DIR` (First-time setup, step 1).
   b. Bring up `db` and `api` **without running migrations**: `docker compose up -d db api` (the `db` volume is brand-new here, so it already has no schema — do not run `alembic upgrade head`).
   c. Follow "Restore" above (steps 1–4) to load the two backup files onto this fresh, schema-less database. This applies the schema (at the migration head it was dumped at) and the data together, and step 4 there confirms `alembic current` afterward.
   d. `docker compose up -d --build` to bring up `web` as well.
   e. Visit `http://<server-ip>:3211/` and log in with an account from the restored data — skip the seed-admin step from First-time setup, since the restore already brought over the admin holder(s).
