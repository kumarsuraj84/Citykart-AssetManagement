#!/bin/bash
# CL2-IF item 6(b) extra attacker checks on the throw-away database ckam_r2c_rs (ckam-sec Postgres):
#  X1  can the runtime role give ITSELF a persistent default for the OBS-STATUS marker (ALTER ROLE <self> SET ...)?
#      If yes: every later session of the app role carries ckam.lifecycle_writer=on, the asset-state guard is
#      silently off for every connection, and do the verify / least-privilege scripts notice?
#  X2  other self-settable role defaults that would matter (session_replication_role, purge flag, search_path)
#  X3  the sequence finding (CL2-IF-01) with the obvious fix applied on THIS throw-away database only:
#      REVOKE UPDATE ON ALL SEQUENCES -> setval refused, nextval and the real API still work.
export MSYS_NO_PATHCONV=1
DB=ckam-sec-db-1; RPW=r2c_app_throwaway_pw
V="-v db_name=ckam_r2c_rs -v owner_role=r2c_owner -v migrator_role=r2c_migrator -v runtime_role=r2c_app"
app() { docker exec -e PGPASSWORD=$RPW "$DB" psql -h 127.0.0.1 -U r2c_app -d ckam_r2c_rs -X "$@" 2>&1; }
sup() { docker exec "$DB" psql -U ckam -d ckam_r2c_rs -X "$@" 2>&1; }
step() { echo; echo "######## $*"; }
step "X1a runtime role sets a persistent default for the lifecycle marker on itself"
app -c "ALTER ROLE r2c_app SET ckam.lifecycle_writer = 'on'"
app -c "ALTER ROLE r2c_app IN DATABASE ckam_r2c_rs SET ckam.lifecycle_writer = 'on'"
sup -c "SELECT coalesce(d.datname, '(all databases)') AS db, r.rolname, s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole LEFT JOIN pg_database d ON d.oid = s.setdatabase WHERE r.rolname LIKE 'r2c_%'"
step "X1b a NEW session of the runtime role: marker already on; direct status change WITHOUT set_config (rolled back)"
app -c "SHOW ckam.lifecycle_writer" -c "BEGIN" -c "UPDATE asset SET status = 'LOST' WHERE id = 3" -c "SELECT id, status FROM asset WHERE id = 3" -c "ROLLBACK"
step "X1c does role_split_verify.sql / check_least_privilege.sql notice? (FAIL/INFO rows, and the PASS count)"
docker exec "$DB" sh -c "cd /tmp/r2c_rs && psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs $V -f role_split_verify.sql 2>&1" | grep -E '\| (FAIL|INFO) ' || echo "verify: no FAIL/INFO row"
docker exec "$DB" sh -c "cd /tmp/r2c_rs && psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs $V -f role_split_verify.sql 2>&1" | grep -cE '\| PASS ' | sed 's/^/verify PASS rows: /'
grep -nE "pg_db_role_setting|setconfig|rolconfig" ops/db/*.sql || echo "ops/db/*.sql: no check of pg_db_role_setting / role defaults (grep found nothing; run from the repo root)"
step "X1d does role_split.sql (re-run, as the runbook says after every deploy) clear it?"
docker exec "$DB" sh -c "psql -X -v ON_ERROR_STOP=1 -U ckam -d ckam_r2c_rs $V -f /tmp/r2c_rs/role_split.sql 2>&1" | tail -1
sup -c "SELECT r.rolname, s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'r2c_app'"
step "X2 other role defaults the runtime role may try on itself"
app -c "ALTER ROLE r2c_app SET session_replication_role = replica"
app -c "ALTER ROLE r2c_app SET ckam.allow_audit_purge = 'on'"
app -c "SHOW ckam.allow_audit_purge" -c "BEGIN" -c "DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log)" -c "ROLLBACK"
app -c "ALTER ROLE r2c_app SET default_transaction_read_only = on"
step "X2 clean-up: the runtime role resets its own defaults"
app -c "ALTER ROLE r2c_app RESET ALL"
app -c "ALTER ROLE r2c_app IN DATABASE ckam_r2c_rs RESET ALL"
sup -c "SELECT count(*) AS r2c_app_role_defaults_left FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'r2c_app'"
step "X3a before the fix: sequence privileges of the runtime role"
sup -c "SELECT c.relname, has_sequence_privilege('r2c_app', c.oid, 'USAGE') AS usage, has_sequence_privilege('r2c_app', c.oid, 'SELECT') AS sel, has_sequence_privilege('r2c_app', c.oid, 'UPDATE') AS upd FROM pg_class c WHERE c.relkind = 'S' AND c.relname IN ('audit_log_id_seq', 'asset_event_id_seq', 'master_audit_id_seq', 'asset_field_change_id_seq') ORDER BY 1"
step "X3b candidate fix on THIS throw-away database: REVOKE UPDATE ON ALL SEQUENCES (and the default for future ones)"
sup -c "REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM r2c_app" -c "ALTER DEFAULT PRIVILEGES FOR ROLE r2c_owner IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM r2c_app"
step "X3c after the fix: setval refused, nextval works (rolled back where possible)"
app -c "SELECT setval('audit_log_id_seq', 9223372036854775807)"
app -c "SELECT setval('asset_event_id_seq', 1)"
app -c "BEGIN" -c "SELECT nextval('asset_event_id_seq') > 0 AS nextval_ok" -c "INSERT INTO audit_log (category, action, outcome, summary) VALUES ('SECURITY','R2C_PROBE','OK','after fix') RETURNING id > 0 AS insert_ok" -c "ROLLBACK"
