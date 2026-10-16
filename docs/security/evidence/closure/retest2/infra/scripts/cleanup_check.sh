#!/bin/bash
# CL2-IF: prove that nothing this retest created is left behind.
echo "# $(date -u +%FT%TZ) post-cleanup check (filters on r2c)"
echo "containers: [$(docker ps -a --filter name=r2c --format '{{.Names}}')]"
echo "volumes: [$(docker volume ls -q --filter name=r2c)]"
echo "networks: [$(docker network ls -q --filter name=r2c)]"
echo "images: [$(docker images -q --filter reference='ckam-r2c*')]"
echo "ckam-sec-db-1: $(docker exec ckam-sec-db-1 psql -U ckam -d ckam -X -At -c "SELECT 'r2c roles='||count(*) FROM pg_roles WHERE rolname LIKE 'r2c%'") $(docker exec ckam-sec-db-1 psql -U ckam -d ckam -X -At -c "SELECT 'r2c databases='||count(*) FROM pg_database WHERE datname LIKE '%r2c%'")"
echo "removed: compose project ckam-r2c (down -v: containers, networks ckam-r2c_default/_edge, volumes db_data/uploads/logs);"
echo "         volumes ckam-r2c_rtprobe_uploads/_logs; images ckam-r2c-api/-web/-volume-init/-rt;"
echo "         throw-away containers ckam-r2c-rt-probe, ckam-r2c-rs-api, ckam-r2c-prod, ckam-r2c-n4-* (all --rm or rm -f);"
echo "         database ckam_r2c_rs + roles r2c_owner/r2c_migrator/r2c_app in ckam-sec Postgres (db6b_12_cleanup.out.txt)"
