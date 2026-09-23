# CKAM Deployment Guide (LAN server)

## Prerequisites
- Docker + Docker Compose v2 installed on the server.
- Ports 80 (web) and optionally 5432 (Postgres, for admin access only) open on the LAN.

## First-time setup
1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD`, `JWT_SECRET`, `BASE_URL` (e.g. `http://assets.citykart.local`), `BACKUP_DIR`.
2. `docker compose up -d --build`
3. Run migrations: `docker compose exec api alembic upgrade head`
4. Create the first ADMIN holder: `docker compose exec api python -m scripts.seed_admin --company-code E2E --password 'Passw0rd!'` (change the password before going live — the script is idempotent, safe to re-run). See `backend/scripts/seed_admin.py`.
5. Visit `http://<server-ip>/` and log in.

## Day-to-day
- Logs: `docker compose logs -f api`
- Restart: `docker compose restart api web`
- Update: `git pull && docker compose up -d --build`

## Backups
- Nightly automatic backup to `${BACKUP_DIR}`, 14-day retention, run by the `backup` service (cron, `0 2 * * *`) — see `docker-compose.yml` and `ops/backup.sh`.
- The `backup` service intentionally runs on `postgres:17-alpine`, not the `db` service's `postgres:17` (Debian-based) image. The Debian-based image ships neither `apk` nor a working cron daemon, so an `apk add ... || true`-style fallback would silently no-op and the nightly job would never run. `postgres:17-alpine` ships matching PostgreSQL 17 client tools (so `pg_dump`/`psql` are always version-matched to the `db` server) plus BusyBox `crond`, `tar` and `gzip` already built in — verified directly by running the image and confirming a test crontab entry fired under `crond -f`.
- Manual backup: `docker compose exec backup sh /scripts/backup.sh`
- Two files are produced per run: `ckam_db_<timestamp>.sql.gz` (a full `pg_dump` of the `ckam` database) and `ckam_uploads_<timestamp>.tar.gz` (a tar of the `uploads` volume).

## Restore
`ops/restore.sh <db_backup.sql.gz> <uploads_backup.tar.gz>` replays a plain-SQL `pg_dump` (schema + data) and untars the uploads archive. Because it is a plain SQL dump (not `pg_restore --clean`), **it must be run against a database with no existing schema** — otherwise every `CREATE TABLE`/`ALTER TABLE`/`ADD CONSTRAINT` statement collides with the objects already there, and if constraints are already active, `COPY` can fail with foreign-key violations partway through (this was verified by testing: restoring into a merely-truncated database produced dozens of errors and a partially-loaded `holder` table, while restoring into a database whose schema had been dropped — i.e. a genuinely fresh state — completed cleanly with correct row counts and no errors).

Steps for a real restore:
1. **Stop the `api` service first** (`docker compose stop api`) to avoid writes during restore.
2. Ensure the target database has no schema. Either:
   - restore onto a brand-new `db` volume (e.g. after `docker compose down -v` and `docker compose up -d db`, before running `alembic upgrade head`), or
   - on an existing volume you intend to overwrite, drop and recreate the schema first: `docker compose exec db psql -U ckam -d ckam -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ckam;"`
3. Run the restore: `docker compose exec backup sh /scripts/restore.sh /backups/<db_file> /backups/<uploads_file>`
4. Start the API again: `docker compose start api`, then spot-check row counts, e.g. `docker compose exec db psql -U ckam -d ckam -c "SELECT count(*) FROM asset;"`, and confirm `docker compose exec api alembic current` still reports the expected head revision.

## Moving from the dev machine to the production server
1. On the dev machine: `docker compose exec backup sh /scripts/backup.sh` to get a full snapshot.
2. Copy the repo (or `git clone` from the GitHub remote) and the two backup files to the server.
3. On the server: follow "First-time setup" above through step 3 (migrations), then follow "Restore" above before creating any new data, then continue with step 5 (visit and log in) — skip the seed-admin step if the restored data already includes an admin holder.
