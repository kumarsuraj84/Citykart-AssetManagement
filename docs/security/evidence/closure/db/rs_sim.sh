#!/usr/bin/env bash
# WP-B local role-split simulation driver. Throw-away database ckam_rs and roles ckam_rs_* inside the dev Postgres
# (compose service db). Usage: bash rs_sim.sh <phase>. Each phase appends commands + output to an evidence file.
export MSYS_NO_PATHCONV=1
cd "D:/ANKUR AI PROJECTS/Asset Management/.claude/worktrees/ckam-build" || exit 1
EV=docs/security/evidence/closure/db
APP_PW=rsAppThrowaway2026
MIG_PW=rsMigThrowaway2026
APP_URL="postgresql+asyncpg://ckam_rs_app:${APP_PW}@db:5432/ckam_rs"
MIG_URL="postgresql+asyncpg://ckam_rs_migrator:${MIG_PW}@db:5432/ckam_rs"
SU=(docker compose exec -T db psql -X -U ckam)
VARS=(-v db_name=ckam_rs -v owner_role=ckam_rs_owner -v migrator_role=ckam_rs_migrator -v runtime_role=ckam_rs_app)

LOG=""
run() {
  local shown="$*"
  shown="${shown//$APP_PW/***}"
  shown="${shown//$MIG_PW/***}"
  { echo "\$ $shown"; } >>"$LOG"
  "$@" 2>&1 | sed -e "s/$APP_PW/***/g" -e "s/$MIG_PW/***/g" -e 's/\(temporary password[^:]*: \).*/\1*** (redacted)/' >>"$LOG"
  local rc=${PIPESTATUS[0]}
  { echo "[exit $rc]"; echo; } >>"$LOG"
}
note() { { echo "## $*"; echo; } >>"$LOG"; }

case "$1" in
  A)
    LOG=$EV/rs_01_setup_presplit.out.txt; : >"$LOG"
    note "Baseline of the dev Postgres server before the simulation"
    run "${SU[@]}" -d ckam -c '\du' -c '\l'
    note "Production-like start: the runtime role owns the database and runs the migrations (as ckassetapp today)"
    run "${SU[@]}" -d postgres -c "CREATE ROLE ckam_rs_app LOGIN PASSWORD '${APP_PW}'" -c "CREATE DATABASE ckam_rs OWNER ckam_rs_app"
    run docker compose exec -T -w /app -e DATABASE_URL="$APP_URL" api alembic upgrade b5d7f9a1c3e5
    note "Seed the S0/S4 test world as the runtime role"
    run docker compose exec -T -w /app -e PYTHONPATH=/app -e DATABASE_URL="$APP_URL" -e LOG_DIR=/tmp/rs_logs api python /tmp/wpb/rs_seed.py
    note "Least-privilege check BEFORE the split (expected: FAIL on ownership / schema CREATE / append-only rows)"
    run "${SU[@]}" -d ckam_rs -v runtime_role=ckam_rs_app -f /tmp/ckam_ops_db/check_least_privilege.sql
    note "IF-05 residual before the split: the owning runtime role disables a guard and truncates (rolled back)"
    run docker compose exec -T db psql -X -e -U ckam_rs_app -d ckam_rs -f /tmp/ckam_ev/rs_presplit_residual.sql
    ;;
  B)
    LOG=$EV/rs_02_role_split.out.txt; : >"$LOG"
    note "Role split as superuser (first run). Passwords given as run-time variables (throw-away; production uses \\password)"
    run "${SU[@]}" -d ckam_rs "${VARS[@]}" -v migrator_password="$MIG_PW" -f /tmp/ckam_ops_db/role_split.sql
    note "Verify (expected: everything PASS except the OBS-STATUS trigger, which the next migration adds)"
    run "${SU[@]}" -d ckam_rs "${VARS[@]}" -f /tmp/ckam_ops_db/role_split_verify.sql
    note "Second run of role_split.sql (idempotent)"
    run "${SU[@]}" -d ckam_rs "${VARS[@]}" -f /tmp/ckam_ops_db/role_split.sql
    ;;
  C)
    LOG=$EV/rs_03_alembic_as_migrator.out.txt; : >"$LOG"
    note "(1) Alembic upgrade head as the MIGRATOR, switched to the owner (ALEMBIC_SET_ROLE)"
    run docker compose exec -T -w /app -e DATABASE_URL="$MIG_URL" -e ALEMBIC_SET_ROLE=ckam_rs_owner api alembic upgrade head
    run docker compose exec -T -w /app -e DATABASE_URL="$MIG_URL" -e ALEMBIC_SET_ROLE=ckam_rs_owner api alembic current
    note "Owners of the objects the migration created, and of everything else"
    run "${SU[@]}" -d ckam_rs -c "SELECT p.proname, pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1" -c "SELECT tgname, tgenabled, tgrelid::regclass FROM pg_trigger WHERE tgname = 'trg_asset_lifecycle_fields_guard'" -c "SELECT pg_get_userbyid(relowner) AS owner, relkind, count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' GROUP BY 1, 2 ORDER BY 1, 2"
    note "The runtime role cannot run migrations (downgrade would drop the trigger)"
    run docker compose exec -T -w /app -e DATABASE_URL="$APP_URL" api alembic downgrade -1
    note "Post-deploy routine: re-run role_split.sql, then verify (expected: every row PASS)"
    run "${SU[@]}" -d ckam_rs "${VARS[@]}" -f /tmp/ckam_ops_db/role_split.sql
    run "${SU[@]}" -d ckam_rs "${VARS[@]}" -f /tmp/ckam_ops_db/role_split_verify.sql
    ;;
  D)
    LOG=$EV/rs_04_api_smoke_as_runtime.out.txt; : >"$LOG"
    note "(2) Throw-away uvicorn (port 8790, inside the dev api container) as the RUNTIME role; ERP link off"
    run docker compose exec -T -d -w /app -e DATABASE_URL="$APP_URL" -e ERP_SYNC_ENABLED=false -e PO_SOURCE_HOST= -e PO_SOURCE_PASSWORD= -e LOG_DIR=/tmp/rs_logs api sh -c "uvicorn app.main:app --host 127.0.0.1 --port 8790 > /tmp/rs_uvicorn.log 2>&1"
    sleep 6
    run docker compose exec -T -w /app api python /tmp/wpb/rs_smoke.py http://127.0.0.1:8790
    note "Rows the smoke wrote (append-only ledgers: INSERT only)"
    run "${SU[@]}" -d ckam_rs -c "SELECT (SELECT count(*) FROM asset) AS assets, (SELECT count(*) FROM asset_event) AS asset_events, (SELECT count(*) FROM asset_field_change) AS field_changes, (SELECT count(*) FROM master_audit) AS master_audit, (SELECT count(*) FROM audit_log) AS audit_log, (SELECT count(*) FROM auth_session) AS auth_sessions, (SELECT count(*) FROM client_report) AS client_reports, (SELECT count(*) FROM system_event) AS system_events" -c "SELECT asset_code, status, current_asset_user_id, status_since FROM asset ORDER BY id"
    note "Stop the throw-away uvicorn"
    run docker compose exec -T api python -c "import os,signal; [os.kill(int(p), signal.SIGTERM) for p in os.listdir('/proc') if p.isdigit() and b'8790' in open(f'/proc/{p}/cmdline','rb').read() and b'uvicorn' in open(f'/proc/{p}/cmdline','rb').read()]; print('stopped')"
    sleep 3
    run docker compose exec -T api sh -c "grep -i -E 'error|denied|exception' /tmp/rs_uvicorn.log | head -20; echo '--- last lines:'; tail -5 /tmp/rs_uvicorn.log"
    ;;
  E)
    LOG=$EV/rs_05_can_cannot_matrix.out.txt; : >"$LOG"
    note "(3)+(5) What the runtime role can and cannot do (OBS-STATUS trigger present)"
    run docker compose exec -T db sh -c "psql -X -e -U ckam_rs_app -d ckam_rs -f /tmp/ckam_ev/rs_runtime_matrix.sql 2>&1"
    note "(4) A new object made by the migrator belongs to the owner; the runtime role gets the default privileges"
    run docker compose exec -T db sh -c "psql -X -e -U ckam_rs_migrator -d ckam_rs -f /tmp/ckam_ev/rs_migrator_new_object.sql 2>&1"
    run docker compose exec -T db sh -c "psql -X -e -U ckam_rs_app -d ckam_rs -f /tmp/ckam_ev/rs_runtime_new_object.sql 2>&1"
    run docker compose exec -T db psql -X -e -U ckam_rs_migrator -d ckam_rs -c "DROP TABLE wpb_probe" -c "DROP TABLE IF EXISTS wpb_probe_as_migrator" -c "SELECT current_user"
    note "Guard triggers still present and enabled after every attempt"
    run "${SU[@]}" -d ckam_rs "${VARS[@]}" -f /tmp/ckam_ops_db/role_split_verify.sql
    ;;
  F)
    LOG=$EV/rs_06_downgrade_upgrade_cycle.out.txt; : >"$LOG"
    note "Downgrade / upgrade cycle of c6e8a0b2d4f6 as the migrator (owner)"
    run docker compose exec -T -w /app -e DATABASE_URL="$MIG_URL" -e ALEMBIC_SET_ROLE=ckam_rs_owner api alembic downgrade -1
    run "${SU[@]}" -d ckam_rs -c "SELECT count(*) AS guard_triggers FROM pg_trigger WHERE tgname = 'trg_asset_lifecycle_fields_guard'"
    run docker compose exec -T -w /app -e DATABASE_URL="$MIG_URL" -e ALEMBIC_SET_ROLE=ckam_rs_owner api alembic upgrade head
    run docker compose exec -T -w /app -e DATABASE_URL="$MIG_URL" api alembic heads
    run "${SU[@]}" -d ckam_rs -c "SELECT tgname, pg_get_userbyid(c.relowner) AS table_owner FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE tgname = 'trg_asset_lifecycle_fields_guard'"
    ;;
  H)
    LOG=$EV/rs_08_dev_stack_check.out.txt; : >"$LOG"
    note "Read-only check of the dev stack's TEST database (OBS-DOCKER-SU): the dev/test app role ckam is a superuser and owns everything. Not switched (owner decision); shown so the gap stays visible"
    run "${SU[@]}" -d ckam_test -v runtime_role=ckam -f /tmp/ckam_ops_db/check_least_privilege.sql
    ;;
  G)
    LOG=$EV/rs_07_cleanup.out.txt; : >"$LOG"
    note "Drop the throw-away database and roles; show the server is back to its baseline"
    run "${SU[@]}" -d postgres -c "DROP DATABASE IF EXISTS ckam_rs WITH (FORCE)" -c "DROP ROLE IF EXISTS ckam_rs_migrator" -c "DROP ROLE IF EXISTS ckam_rs_app" -c "DROP ROLE IF EXISTS ckam_rs_owner"
    run "${SU[@]}" -d ckam -c '\du' -c '\l'
    ;;
esac
