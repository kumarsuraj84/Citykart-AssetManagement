"""WP-F reproduction of CL2-IF-01 / CL2-IF-02 on a throw-away database inside the dev Postgres (never production).

Usage (inside the dev api container, from /app):
  CKAM_OPS_DB_DIR=/tmp/ops_old/db python /tmp/repro_if01_if02.py   -> the scripts at HEAD 734fd19
  CKAM_OPS_DB_DIR=/app/ops/db    python /tmp/repro_if01_if02.py   -> the WP-F scripts
Creates ckam_wpf_<tag> + three roles, runs alembic upgrade head as the runtime role (production's start), applies
the split body, then as the RUNTIME role tries setval on the ledger sequences and ALTER ROLE self SET
default_transaction_read_only, and prints what the two check scripts say. Drops everything at the end."""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, "/app")
import asyncpg  # noqa: E402

import tests.security.test_least_privilege_role_split as t  # noqa: E402


async def main() -> None:
    print("ops/db used:", t.OPS_DB)
    server = t._server()
    tag = uuid.uuid4().hex[:8]
    db = f"ckam_wpf_{tag}"
    owner, migrator, app = f"{db}_owner", f"{db}_migrator", f"{db}_app"
    app_pw = uuid.uuid4().hex
    app_url = f"postgresql+asyncpg://{app}:{app_pw}@{server['host']}:{server['port']}/{db}"
    admin = await asyncpg.connect(database="postgres", **server)
    try:
        await admin.execute(f"CREATE ROLE \"{app}\" LOGIN PASSWORD '{app_pw}'")
        await admin.execute(f'CREATE DATABASE "{db}" OWNER "{app}"')
        done = await asyncio.to_thread(t._alembic, ["upgrade", "head"], app_url)
        print("alembic upgrade head as runtime role: rc", done.returncode)
        su = await asyncpg.connect(database=db, **server)
        body = t._body("role_split.sql", "ROLE SPLIT BODY")
        async with su.transaction():
            await su.execute(t._split_settings_sql(), db, owner, migrator, app)
            await su.execute(body)
        print("role split applied")
        rt = await asyncpg.connect(database=db, user=app, password=app_pw, host=server["host"], port=server["port"])
        for sql in ("SELECT setval('audit_log_id_seq', 9223372036854775807)", "SELECT setval('asset_event_id_seq', 1)"):
            try:
                await rt.execute("BEGIN")
                await rt.execute(sql)
                await rt.execute("ROLLBACK")
                print(f"RUNTIME CAN   : {sql}  (then ROLLBACK)")
            except asyncpg.PostgresError as exc:
                await rt.execute("ROLLBACK")
                print(f"RUNTIME CANNOT: {sql}  -> {type(exc).__name__}: {exc}")
        last = await su.fetchval("SELECT last_value FROM audit_log_id_seq")
        print("audit_log_id_seq last_value after the ROLLBACK:", last)
        try:
            await rt.execute("INSERT INTO audit_log (source, category, action, summary, outcome, is_head_office_admin) "
                             "VALUES ('api', 'DATA', 'UPDATE', 'repro', 'OK', false)")
            print("audit_log INSERT as runtime: OK")
        except asyncpg.PostgresError as exc:
            print(f"audit_log INSERT as runtime: FAILED -> {type(exc).__name__}: {exc}")
        await rt.execute(f'ALTER ROLE "{app}" SET default_transaction_read_only = on')
        print("RUNTIME CAN   : ALTER ROLE <self> SET default_transaction_read_only = on")
        await rt.close()
        general = await t._checks(su, t._body("check_least_privilege.sql", "CHECK BODY"), runtime_role=app,
                                  owner_role=owner, schema_name="public")
        split = await t._checks(su, t._body("role_split_verify.sql", "VERIFY BODY"), db_name=db, migrator_role=migrator)
        print(f"check_least_privilege: {len(general)} rows, FAIL rows:")
        for r in general:
            if r["result"] == "FAIL":
                print(f"   FAIL  {r['check']}: {r['detail']}")
        print(f"role_split_verify: {len(split)} rows, FAIL rows:")
        for r in split:
            if r["result"] == "FAIL":
                print(f"   FAIL  {r['check']}: {r['detail']}")
        await su.close()
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
        for role in (migrator, app, owner):
            await admin.execute(f'DROP ROLE IF EXISTS "{role}"')
        left = await admin.fetch("SELECT rolname FROM pg_roles WHERE rolname LIKE 'ckam_wpf_%' UNION ALL "
                                 "SELECT datname FROM pg_database WHERE datname LIKE 'ckam_wpf_%'")
        print("left behind:", [r[0] for r in left])
        await admin.close()


asyncio.run(main())
