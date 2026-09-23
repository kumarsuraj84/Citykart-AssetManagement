#!/bin/sh
set -eu
if [ $# -ne 2 ]; then
  echo "Usage: restore.sh <db_backup.sql.gz> <uploads_backup.tar.gz>"
  exit 1
fi
DB_FILE="$1"
UPLOADS_FILE="$2"

gunzip -c "$DB_FILE" | psql -h db -U ckam -d ckam
tar -xzf "$UPLOADS_FILE" -C /data

echo "Restore complete."
