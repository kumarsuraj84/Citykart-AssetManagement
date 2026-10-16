#!/bin/bash
# Helper: feed a SQL file to psql inside a Postgres container, output (errors kept in order) to a file.
# usage: bash run_sql.sh <container> <user> <db> <sql-file> <out-file> [extra psql args...]
# For a role with a password, set PGPW=<throw-away password> in the environment (psql then connects over TCP to
# 127.0.0.1 inside the container, so pg_hba password rules apply).
c="$1"; u="$2"; d="$3"; f="$4"; o="$5"; shift 5
export MSYS_NO_PATHCONV=1
extra="$*"
if [ -n "$PGPW" ]; then
  { echo "# $(date -u +%FT%TZ) psql as $u on $d ($c, TCP) : $(basename "$f")"; docker exec -i -e PGPASSWORD="$PGPW" "$c" sh -c "psql -h 127.0.0.1 -U '$u' -d '$d' -X -e $extra 2>&1" < "$f"; } > "$o" 2>&1
else
  { echo "# $(date -u +%FT%TZ) psql as $u on $d ($c) : $(basename "$f")"; docker exec -i "$c" sh -c "psql -U '$u' -d '$d' -X -e $extra 2>&1" < "$f"; } > "$o" 2>&1
fi
echo "written $o ($(wc -l < "$o") lines)"
