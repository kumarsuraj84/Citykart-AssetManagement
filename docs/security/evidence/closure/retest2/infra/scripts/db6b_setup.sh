#!/bin/bash
# CL2-IF item 6(b) set-up: throw-away database ckam_r2c_rs + roles r2c_owner / r2c_migrator / r2c_app in the
# ckam-sec Postgres (container ckam-sec-db-1, superuser `ckam`), following ops/db/ROLE_SPLIT_RUNBOOK.md:
#   1. baseline \du / \l          2. CREATE DATABASE        3. role_split.sql (empty db; creates the roles)
#   4. alembic upgrade head AS THE MIGRATOR with ALEMBIC_SET_ROLE=r2c_owner (inside the ckam-sec api container)
#   5. role_split.sql again (runbook section 5: after every upgrade)   6. load the ckam-sec fixture data (data only,
#      as superuser) so the runtime attacks hit real rows   7. role_split_verify.sql (includes check_least_privilege)
# Throw-away passwords below exist only for this test and die with the roles in db6b_cleanup.sh.
export MSYS_NO_PATHCONV=1
DB=ckam-sec-db-1
MPW="r2c_mig_throwaway_pw"; RPW="r2c_app_throwaway_pw"
V="-v db_name=ckam_r2c_rs -v owner_role=r2c_owner -v migrator_role=r2c_migrator -v runtime_role=r2c_app"
step() { echo; echo "######## $*"; }
step "1 baseline roles and databases (before)"
docker exec "$DB" psql -U ckam -d ckam -X -c '\du' -c '\l'
step "2 CREATE DATABASE ckam_r2c_rs"
docker exec "$DB" psql -U ckam -d ckam -X -c 'CREATE DATABASE ckam_r2c_rs'
step "3 role_split.sql on the empty database (creates the three roles)"
docker exec "$DB" sh -c "psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs $V -v migrator_password=$MPW -v runtime_password=$RPW -f /tmp/r2c_rs/role_split.sql 2>&1"
step "4 alembic upgrade head as r2c_migrator, ALEMBIC_SET_ROLE=r2c_owner (ckam-sec api container, exec only)"
docker exec -w /app -e "DATABASE_URL=postgresql+asyncpg://r2c_migrator:$MPW@db:5432/ckam_r2c_rs" -e ALEMBIC_SET_ROLE=r2c_owner \
  ckam-sec-api-1 alembic upgrade head 2>&1 | tail -6
echo "-- alembic head and owners of what it created:"
docker exec "$DB" psql -U ckam -d ckam_r2c_rs -X -c 'SELECT version_num FROM alembic_version' \
  -c "SELECT pg_get_userbyid(c.relowner) AS owner, c.relkind, count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' GROUP BY 1,2 ORDER BY 1,2" \
  -c "SELECT pg_get_userbyid(p.proowner) AS owner, count(*) AS functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' GROUP BY 1"
step "4b negative: the same migrator WITHOUT ALEMBIC_SET_ROLE (role setting from role_split.sql must still make it the owner)"
docker exec "$DB" sh -c "PGPASSWORD=$MPW psql -h 127.0.0.1 -U r2c_migrator -d ckam_r2c_rs -X -c 'SELECT current_user, session_user' 2>&1"
step "4c negative: migrator with RESET ROLE (acting as itself) cannot create anything"
docker exec "$DB" sh -c "PGPASSWORD=$MPW psql -h 127.0.0.1 -U r2c_migrator -d ckam_r2c_rs -X -c 'RESET ROLE' -c 'SELECT current_user' -c 'CREATE TABLE r2c_mig_self (x int)' 2>&1"
step "5 role_split.sql again after the upgrade (idempotent)"
docker exec "$DB" sh -c "psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs $V -f /tmp/r2c_rs/role_split.sql 2>&1"
step "6 load the ckam-sec fixture rows (data only, triggers off for the load, as superuser; alembic_version excluded)"
docker exec "$DB" sh -c "pg_dump -U ckam -d ckam --data-only --disable-triggers --exclude-table-data=alembic_version | psql -X -q -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs 2>&1 | tail -5"
docker exec "$DB" psql -U ckam -d ckam_r2c_rs -X -At -c "SELECT 'assets='||count(*) FROM asset" -c "SELECT 'audit_log='||count(*) FROM audit_log" -c "SELECT 'asset_event='||count(*) FROM asset_event"
step "7 role_split_verify.sql (includes check_least_privilege.sql)"
docker exec "$DB" sh -c "cd /tmp/r2c_rs && psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs $V -f role_split_verify.sql 2>&1"
step "7b check_least_privilege.sql on its own"
docker exec "$DB" sh -c "cd /tmp/r2c_rs && psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs -v runtime_role=r2c_app -v owner_role=r2c_owner -f check_least_privilege.sql 2>&1"
