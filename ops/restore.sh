#!/bin/sh
# pipefail is required: without it, `gunzip | psql` exits 0 even if gunzip
# fails on a corrupt archive, since psql (on empty stdin) still exits 0.
# -v ON_ERROR_STOP=1 is required separately: without it, psql itself exits
# 0 even when individual statements inside the dump error out (e.g. the
# dump was restored onto a non-empty schema) -- it just prints ERROR lines
# to stdout/stderr and keeps going. Both together are what make a failed
# restore actually fail this script instead of printing "Restore complete."
# over a partially-loaded database. See docs/deployment.md.
set -eu -o pipefail
if [ $# -ne 2 ]; then
  echo "Usage: restore.sh <db_backup.sql.gz> <uploads_backup.tar.gz>"
  exit 1
fi
DB_FILE="$1"
UPLOADS_FILE="$2"

gunzip -c "$DB_FILE" | psql -v ON_ERROR_STOP=1 -h db -U ckam -d ckam
tar -xzf "$UPLOADS_FILE" -C /data

echo "Restore complete."
