#!/bin/sh
set -eu
STAMP=$(date +%Y%m%d_%H%M%S)
OUT_DIR="/backups"
mkdir -p "$OUT_DIR"

pg_dump -h db -U ckam -d ckam | gzip > "$OUT_DIR/ckam_db_$STAMP.sql.gz"
tar -czf "$OUT_DIR/ckam_uploads_$STAMP.tar.gz" -C /data uploads

find "$OUT_DIR" -name 'ckam_*' -mtime +14 -delete

echo "Backup complete: $STAMP"
