#!/bin/bash
# CL2-IF item 6(b) set-up, part 2 (corrections found while running part 1):
#  - part 1 step 4c was a wrong test: RESET ROLE returns to the role DEFAULT, which role_split.sql sets to the owner,
#    so that CREATE ran as r2c_owner (allowed by design). Drop that table; the right test is SET ROLE <migrator itself>.
#  - part 1 step 6 stopped on the one row the migrations themselves seed (asset_user id 1, the original Primary
#    Owner); remove it (superuser, this throw-away database only) and load the fixture again.
export MSYS_NO_PATHCONV=1
DB=ckam-sec-db-1
MPW="r2c_mig_throwaway_pw"
V="-v db_name=ckam_r2c_rs -v owner_role=r2c_owner -v migrator_role=r2c_migrator -v runtime_role=r2c_app"
step() { echo; echo "######## $*"; }
step "4c' drop the table part 1 created as the owner"
docker exec "$DB" psql -U ckam -d ckam_r2c_rs -X -c 'DROP TABLE r2c_mig_self'
step "4d migrator acting as ITSELF (SET ROLE r2c_migrator) cannot create, alter or read anything"
docker exec "$DB" sh -c "PGPASSWORD=$MPW psql -h 127.0.0.1 -U r2c_migrator -d ckam_r2c_rs -X -c 'SET ROLE r2c_migrator' -c 'SELECT current_user' -c 'CREATE TABLE r2c_mig_self (x int)' -c 'ALTER TABLE audit_log DISABLE TRIGGER ALL' -c 'SELECT count(*) FROM asset' -c 'CREATE SCHEMA r2c_x' 2>&1"
step "6' clear the migration-seeded row and load the ckam-sec fixture rows (data only, as superuser)"
docker exec "$DB" psql -U ckam -d ckam_r2c_rs -X -c 'SET session_replication_role = replica' -c 'DELETE FROM asset_user'
docker exec "$DB" sh -c "pg_dump -U ckam -d ckam --data-only --disable-triggers --exclude-table-data=alembic_version 2>/dev/null | psql -X -q -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs 2>&1 | tail -5"
docker exec "$DB" psql -U ckam -d ckam_r2c_rs -X -At -c "SELECT 'assets='||count(*) FROM asset" -c "SELECT 'audit_log='||count(*) FROM audit_log" -c "SELECT 'asset_event='||count(*) FROM asset_event" -c "SELECT 'asset_user='||count(*) FROM asset_user" -c "SELECT 'triggers disabled after load='||count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'"
step "7' role_split_verify.sql again after the load"
docker exec "$DB" sh -c "cd /tmp/r2c_rs && psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs $V -f role_split_verify.sql 2>&1" | grep -cE '\| PASS ' | sed 's/^/PASS rows: /'
docker exec "$DB" sh -c "cd /tmp/r2c_rs && psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs $V -f role_split_verify.sql 2>&1" | grep -E '\| (FAIL|INFO) ' || echo "FAIL/INFO rows: none"
