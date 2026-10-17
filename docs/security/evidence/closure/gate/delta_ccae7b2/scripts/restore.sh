#!/bin/sh
# GT rehearsal: fresh restore of the OLD-schema dump into database $1, owned by the
# non-superuser app role ckassetapp (as on 10.0.0.205: the app role owns the tables).
# Runs INSIDE the throw-away ckam-gate-db container. Throw-away passwords only.
set -eu
DB="$1"
export PGPASSWORD=gate_super_throwaway_pw
psql -v ON_ERROR_STOP=1 -U postgres -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ckassetapp') THEN
    CREATE ROLE ckassetapp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'gate_app_throwaway_pw';
  END IF;
END \$\$;
DROP DATABASE IF EXISTS "$DB" WITH (FORCE);
CREATE DATABASE "$DB" OWNER ckassetapp;
SQL
export PGPASSWORD=gate_app_throwaway_pw
START=$(date +%s%N)
pg_restore -h 127.0.0.1 -U ckassetapp -d "$DB" --no-owner --exit-on-error /tmp/seeded.dump
END=$(date +%s%N)
echo "restore of $DB took $(( (END-START)/1000000 )) ms (exit 0)"
psql -h 127.0.0.1 -U ckassetapp -d "$DB" -Atc "select 'alembic_version=' || version_num from alembic_version"
psql -h 127.0.0.1 -U ckassetapp -d "$DB" -Atc "select 'superuser=' || rolsuper from pg_roles where rolname=current_user"
