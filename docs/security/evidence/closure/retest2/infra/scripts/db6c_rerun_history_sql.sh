#!/bin/bash
# CL2-IF item 6(c): re-run the historical IF-T SQL files (docs/security/evidence/infra/sql/db_0*.sql) on ckam-sec,
# unchanged, as `ckam` (superuser in Docker). db_01/02/05 are read-only; db_03/04 run in ONE transaction that is
# ROLLED BACK (they say so in their header). Output per file in raw/db6c_<name>.out.txt.
export MSYS_NO_PATHCONV=1
SRC="docs/security/evidence/infra/sql"
OUT="docs/security/evidence/closure/retest2/infra/raw"
for f in db_05_data_integrity db_01_roles_privileges db_02_triggers_constraints db_03_append_only_privilege_tests db_04_least_priv_flag_bypass; do
  { echo "# $(date -u +%FT%TZ) ckam-sec-db-1 psql -U ckam -d ckam -X -v ON_ERROR_STOP=0 < $SRC/$f.sql (unchanged historical file)"
    docker exec -i ckam-sec-db-1 sh -c "psql -U ckam -d ckam -X -v ON_ERROR_STOP=0 2>&1" < "$SRC/$f.sql"; } > "$OUT/db6c_$f.out.txt" 2>&1
  echo "$f: $(wc -l < "$OUT/db6c_$f.out.txt") lines"
done
