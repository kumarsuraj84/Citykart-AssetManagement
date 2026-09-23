#!/bin/sh
# pipefail is required: without it, `pg_dump | gzip > file` exits 0 even if
# pg_dump itself fails (bad auth, connection drop), because gzip still
# succeeds on empty/partial input -- producing a small-but-valid .gz file
# and a false "Backup complete" report. See docs/deployment.md.
set -eu -o pipefail
STAMP=$(date +%Y%m%d_%H%M%S)
OUT_DIR="/backups"
mkdir -p "$OUT_DIR"

pg_dump -h db -U ckam -d ckam | gzip > "$OUT_DIR/ckam_db_$STAMP.sql.gz"
tar -czf "$OUT_DIR/ckam_uploads_$STAMP.tar.gz" -C /data uploads

find "$OUT_DIR" -name 'ckam_*' -mtime +14 -delete

echo "Backup complete: $STAMP"
