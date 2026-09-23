#!/bin/sh
# ops/test_backup_restore.sh
#
# Repeatable backup -> restore -> verify integration check for the `backup`
# service, driven entirely through `docker compose` from the host. Re-run
# this any time docker-compose.yml, the backup/restore scripts, or the
# Postgres version changes, to prove the nightly job still actually works
# end to end -- not just that the container starts.
#
# THIS IS A DESTRUCTIVE TEST: step 5 drops and recreates the `public`
# schema on the running `db` service before restoring into it, which wipes
# every table. Run it only against a disposable dev/staging compose stack,
# never against a database holding real data you care about.
#
# Usage: ops/test_backup_restore.sh   (run from the repo root)
# Requires: `docker compose up -d db api backup` already done.
set -eu

echo "=== [1/6] Seeding known data via seed_admin.py ==="
docker compose exec -T api python -m scripts.seed_admin --company-code BKTEST --password 'Passw0rd!'

BEFORE_COMPANY=$(docker compose exec -T db psql -U ckam -d ckam -tAc "SELECT count(*) FROM company WHERE code='BKTEST';" | tr -d '\r')
BEFORE_HOLDER=$(docker compose exec -T db psql -U ckam -d ckam -tAc "SELECT count(*) FROM holder WHERE company_id=(SELECT id FROM company WHERE code='BKTEST');" | tr -d '\r')
echo "Before: company=$BEFORE_COMPANY holder=$BEFORE_HOLDER"
if [ "$BEFORE_COMPANY" -ne 1 ]; then
  echo "FAIL: seed_admin.py did not create the BKTEST company"
  exit 1
fi

echo "=== [2/6] Ensuring the backup service is up ==="
docker compose up -d backup >/dev/null

echo "=== [3/6] Running backup.sh inside the backup container ==="
BACKUP_OUT=$(docker compose exec -T backup sh /scripts/backup.sh)
echo "$BACKUP_OUT"
STAMP=$(printf '%s\n' "$BACKUP_OUT" | sed -n 's/^Backup complete: //p' | tr -d '\r')
if [ -z "$STAMP" ]; then
  echo "FAIL: could not parse a backup timestamp out of: $BACKUP_OUT"
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DB_FILE="$BACKUP_DIR/ckam_db_${STAMP}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/ckam_uploads_${STAMP}.tar.gz"

echo "=== [4/6] Verifying backup files landed on the host, non-empty ==="
if [ ! -s "$DB_FILE" ]; then
  echo "FAIL: $DB_FILE is missing or empty"
  exit 1
fi
if [ ! -s "$UPLOADS_FILE" ]; then
  echo "FAIL: $UPLOADS_FILE is missing or empty"
  exit 1
fi
echo "OK: $DB_FILE ($(wc -c < "$DB_FILE") bytes), $UPLOADS_FILE ($(wc -c < "$UPLOADS_FILE") bytes)"

echo "=== [5/6] Dropping the schema and restoring (DESTRUCTIVE) ==="
docker compose exec -T db psql -U ckam -d ckam -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ckam;" >/dev/null
docker compose exec -T backup sh /scripts/restore.sh "/backups/ckam_db_${STAMP}.sql.gz" "/backups/ckam_uploads_${STAMP}.tar.gz"

echo "=== [6/6] Verifying restored row counts match the pre-backup baseline ==="
AFTER_COMPANY=$(docker compose exec -T db psql -U ckam -d ckam -tAc "SELECT count(*) FROM company WHERE code='BKTEST';" | tr -d '\r')
AFTER_HOLDER=$(docker compose exec -T db psql -U ckam -d ckam -tAc "SELECT count(*) FROM holder WHERE company_id=(SELECT id FROM company WHERE code='BKTEST');" | tr -d '\r')
echo "After: company=$AFTER_COMPANY holder=$AFTER_HOLDER"

if [ "$BEFORE_COMPANY" != "$AFTER_COMPANY" ] || [ "$BEFORE_HOLDER" != "$AFTER_HOLDER" ]; then
  echo "FAIL: row counts do not match (before company=$BEFORE_COMPANY holder=$BEFORE_HOLDER, after company=$AFTER_COMPANY holder=$AFTER_HOLDER)"
  exit 1
fi

echo "=== Restarting api and confirming it serves against the restored schema ==="
docker compose restart api >/dev/null
sleep 3
docker compose exec -T api alembic current

echo "PASS: backup/restore round-trip verified (company=$AFTER_COMPANY holder=$AFTER_HOLDER)."
