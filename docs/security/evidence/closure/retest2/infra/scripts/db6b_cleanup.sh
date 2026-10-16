#!/bin/bash
# CL2-IF item 6(b) clean-up: drop the throw-away database and the three roles, prove with \du and \l.
export MSYS_NO_PATHCONV=1
DB=ckam-sec-db-1
echo "######## sessions still on ckam_r2c_rs"
docker exec "$DB" psql -U ckam -d ckam -X -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'ckam_r2c_rs'"
echo "######## drop database and roles"
docker exec "$DB" psql -U ckam -d ckam -X -c 'DROP DATABASE ckam_r2c_rs WITH (FORCE)'
docker exec "$DB" psql -U ckam -d ckam -X -c 'DROP ROLE r2c_app' -c 'DROP ROLE r2c_migrator' -c 'DROP ROLE r2c_owner'
docker exec "$DB" rm -rf /tmp/r2c_rs
echo "######## after: \\du and \\l (no r2c_* role, no ckam_r2c_rs database may remain)"
docker exec "$DB" psql -U ckam -d ckam -X -c '\du' -c '\l'
docker exec "$DB" psql -U ckam -d ckam -X -At -c "SELECT 'r2c roles left: '||count(*) FROM pg_roles WHERE rolname LIKE 'r2c%'" -c "SELECT 'r2c databases left: '||count(*) FROM pg_database WHERE datname LIKE '%r2c%'"
docker exec "$DB" ls -la /tmp
