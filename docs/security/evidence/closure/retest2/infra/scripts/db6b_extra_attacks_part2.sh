#!/bin/bash
# CL2-IF item 6(b) extra checks, part 2: part 1's X2 showed the runtime role CAN give itself
# default_transaction_read_only=on (a self-inflicted outage of every later app session); it then could not undo it
# itself. Superuser resets it here; then X3c (the sequence fix) is re-run, and the real API is exercised once more
# with the fix in place (nextval-only sequences must be enough for the application).
export MSYS_NO_PATHCONV=1
DB=ckam-sec-db-1; RPW=r2c_app_throwaway_pw
app() { docker exec -e PGPASSWORD=$RPW "$DB" psql -h 127.0.0.1 -U r2c_app -d ckam_r2c_rs -X "$@" 2>&1; }
sup() { docker exec "$DB" psql -U ckam -d ckam_r2c_rs -X "$@" 2>&1; }
step() { echo; echo "######## $*"; }
step "X2' role default left by the runtime role, and whether role_split.sql / the verify script notice it"
sup -c "SELECT r.rolname, coalesce(d.datname,'(all)') AS db, s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole LEFT JOIN pg_database d ON d.oid = s.setdatabase WHERE r.rolname LIKE 'r2c_%' ORDER BY 1"
docker exec "$DB" sh -c "cd /tmp/r2c_rs && psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs -v db_name=ckam_r2c_rs -v owner_role=r2c_owner -v migrator_role=r2c_migrator -v runtime_role=r2c_app -f role_split_verify.sql 2>&1" | grep -E '\| (FAIL|INFO) ' || echo "verify with default_transaction_read_only=on on the runtime role: no FAIL/INFO row"
step "X2' superuser clean-up"
sup -c "ALTER ROLE r2c_app RESET ALL"
sup -c "SELECT count(*) AS r2c_app_role_defaults_left FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'r2c_app'"
step "X3c' after the sequence fix: setval refused, nextval + ledger insert work (rolled back)"
app -c "SELECT setval('audit_log_id_seq', 9223372036854775807)"
app -c "SELECT setval('asset_event_id_seq', 1)"
app -c "BEGIN" -c "SELECT nextval('asset_event_id_seq') > 0 AS nextval_ok" -c "INSERT INTO audit_log (category, action, outcome, summary) VALUES ('SECURITY','R2C_PROBE','OK','after fix') RETURNING id > 0 AS insert_ok" -c "ROLLBACK"
sup -c "SELECT c.relname, has_sequence_privilege('r2c_app', c.oid, 'USAGE') AS usage, has_sequence_privilege('r2c_app', c.oid, 'UPDATE') AS upd FROM pg_class c WHERE c.relkind = 'S' AND c.relname IN ('audit_log_id_seq', 'asset_event_id_seq') ORDER BY 1"
