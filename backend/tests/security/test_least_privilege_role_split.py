"""Security IF-05 / IF-06 / OBS-DOCKER-SU / EXT-07 (closure WP-B): the three-role database split in ops/db/ works.

Inside the test's own Postgres server (never production) this creates a uniquely named throw-away database and
three throw-away roles (owner / migrator / runtime), reproduces production's starting point (the runtime role owns
the database and runs `alembic upgrade head` on it), applies the plain-SQL body of ops/db/role_split.sql, runs the
read-only checks of ops/db/check_least_privilege.sql and ops/db/role_split_verify.sql, and then proves through
asyncpg connections AS those roles what the runtime role can and cannot do, that the migrator migrates as the owner
(ALEMBIC_SET_ROLE in app/alembic/env.py) and that new objects get the runtime grants by default. Everything is
dropped afterwards, also when an assertion fails; the last step checks that no role or database is left behind.

It needs a superuser test role (the dev/test `ckam` role is one) and the ops/db folder. Inside the dev api
container only `backend/` is present: copy it there first (`docker compose cp ops api:/app/`) or set
CKAM_OPS_DB_DIR; without it the module is skipped and says why.
"""
import asyncio
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.engine import make_url

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[2]
PREFIX = "ckam_lpt_"
DENIED = r"permission denied|must be owner"


def _find_ops_db() -> Path | None:
    candidates = [Path(os.environ["CKAM_OPS_DB_DIR"])] if os.environ.get("CKAM_OPS_DB_DIR") else []
    candidates += [parent / "ops" / "db" for parent in Path(__file__).resolve().parents]
    return next((c for c in candidates if (c / "role_split.sql").is_file()), None)


OPS_DB = _find_ops_db()
pytestmark = pytest.mark.skipif(
    OPS_DB is None,
    reason="ops/db/role_split.sql not found: run `docker compose cp ops api:/app/` or set CKAM_OPS_DB_DIR",
)


def _body(file_name: str, marker: str) -> str:
    """The plain-SQL part of an ops/db script (between `-- >>> marker` and `-- <<< marker`): exactly what a DBA
    runs through psql, minus psql's own variable handling."""
    text = (OPS_DB / file_name).read_text(encoding="utf-8")
    start, end = text.index(f"-- >>> {marker}"), text.index(f"-- <<< {marker}")
    return text[text.index("\n", start) + 1:end]


def _server() -> dict:
    url = make_url(settings.database_url)
    return {"host": url.host, "port": url.port or 5432, "user": url.username, "password": url.password}


def _alembic(args: list[str], database_url: str, set_role: str | None = None) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != "ALEMBIC_SET_ROLE"}
    env["DATABASE_URL"] = database_url
    if set_role:
        env["ALEMBIC_SET_ROLE"] = set_role
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR, env=env,
                          capture_output=True, text=True, timeout=600)


async def _drop_everything(admin: asyncpg.Connection, db: str, roles: list[str]) -> None:
    await admin.execute(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
    for role in roles:
        await admin.execute(f'DROP ROLE IF EXISTS "{role}"')


async def _drop_abandoned_leftovers(admin: asyncpg.Connection) -> None:
    """A run that was killed half-way (never a running one: only databases nobody is connected to) leaves
    `ckam_lpt_<tag>` behind; remove it and its roles so `\\du` stays clean."""
    for db in await admin.fetch(
            "SELECT datname FROM pg_database d WHERE datname LIKE $1 AND NOT EXISTS "
            "(SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)", PREFIX + "%"):
        name = db["datname"]
        await _drop_everything(admin, name, [f"{name}_migrator", f"{name}_app", f"{name}_owner"])


async def _checks(conn: asyncpg.Connection, body: str, **values: str) -> list[asyncpg.Record]:
    for key, value in values.items():
        await conn.execute("SELECT set_config($1, $2, false)", f"ckam_check.{key}", value)
    return await conn.fetch(body)


def _failed(rows) -> list[str]:
    return [f"{r['check']}: {r['detail']}" for r in rows if r["result"] == "FAIL"]


# The runtime role must be refused every one of these (each runs in its own rolled-back transaction).
CANNOT = [
    "TRUNCATE audit_log", "TRUNCATE asset_event", "TRUNCATE master_audit", "TRUNCATE asset_field_change",
    "TRUNCATE asset CASCADE",
    "ALTER TABLE asset ADD COLUMN lpt_evil integer",
    "ALTER TABLE asset_event DISABLE TRIGGER ALL",
    "ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_no_delete",
    "ALTER TABLE asset DISABLE TRIGGER trg_asset_lifecycle_fields_guard",
    "ALTER TABLE asset ENABLE REPLICA TRIGGER trg_asset_lifecycle_fields_guard",
    "DROP TRIGGER trg_asset_lifecycle_fields_guard ON asset",
    "DROP TRIGGER trg_audit_log_no_truncate ON audit_log",
    "DROP TABLE audit_log",
    "CREATE OR REPLACE FUNCTION forbid_audit_log_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$",
    "CREATE TRIGGER lpt_evil BEFORE DELETE ON asset FOR EACH ROW EXECUTE FUNCTION forbid_asset_event_write()",
    "CREATE TABLE public.lpt_evil (id integer)",
    "CREATE SCHEMA lpt_evil",
    "CREATE TEMP TABLE lpt_tmp (id integer)",
    "SET session_replication_role = replica",
    "SELECT ckam_purge_audit_log(now() - interval '6 years')",
    "UPDATE audit_log SET summary = summary",
    "DELETE FROM audit_log",
    "SET LOCAL ckam.allow_audit_purge = 'on'; DELETE FROM audit_log",
    "UPDATE asset_event SET remarks = remarks",
    "DELETE FROM asset_event",
    "DELETE FROM master_audit",
    "UPDATE asset_field_change SET reason = reason",
    "UPDATE alembic_version SET version_num = version_num",
    "DELETE FROM alembic_version",
    "INSERT INTO alembic_version VALUES ('ffffffffffff')",
    "CREATE ROLE lpt_evil",
    "CREATE EXTENSION pgcrypto",
    "ALTER TABLE audit_log OWNER TO CURRENT_USER",
    "ALTER FUNCTION ckam_purge_audit_log(timestamptz) SECURITY DEFINER",
    "COPY (SELECT 1) TO PROGRAM 'id'",
    # CL2-IF-01: no setval / ALTER SEQUENCE on the ledger id sequences (exhaust audit_log's, rewind asset_event's).
    "SELECT setval('audit_log_id_seq', 9223372036854775807)",
    "SELECT setval('asset_event_id_seq', 1)",
    "SELECT setval('master_audit_id_seq', 1, false)",
    "ALTER SEQUENCE audit_log_id_seq RESTART WITH 1",
]

# ... and must be allowed everything the application needs.
CAN = [
    "SELECT (SELECT count(*) FROM asset) + (SELECT count(*) FROM audit_log) + (SELECT count(*) FROM asset_event)",
    "SELECT version_num FROM alembic_version",
    "INSERT INTO audit_log (source, category, action, summary, outcome, is_head_office_admin) "
    "VALUES ('api', 'DATA', 'UPDATE', 'least-privilege test', 'OK', false)",
    "INSERT INTO company (code, name) VALUES ('LPT1', 'Least privilege test company')",
    "UPDATE asset_user SET name = name",
    "DELETE FROM auth_session WHERE id = -1",
    "SELECT nextval(pg_get_serial_sequence('vendor', 'id'))",
    "SELECT nextval('audit_log_id_seq'), currval('audit_log_id_seq')",
]


def _split_settings_sql() -> str:
    return ("SELECT set_config('ckam_split.db_name', $1, true), set_config('ckam_split.schema_name', 'public', true),"
            " set_config('ckam_split.owner_role', $2, true), set_config('ckam_split.migrator_role', $3, true),"
            " set_config('ckam_split.runtime_role', $4, true), set_config('ckam_split.current_owner', $4, true)")


async def _run_split(su: asyncpg.Connection, body: str, db: str, owner: str, migrator: str, app: str) -> None:
    async with su.transaction():
        await su.execute(_split_settings_sql(), db, owner, migrator, app)
        await su.execute(body)


def _failed_names(rows) -> set[str]:
    return {r["check"] for r in rows if r["result"] == "FAIL"}


def test_the_ops_db_scripts_keep_passwords_out_and_their_bodies_plain_sql():
    for file_name, marker in (("role_split.sql", "ROLE SPLIT BODY"), ("check_least_privilege.sql", "CHECK BODY"),
                              ("role_split_verify.sql", "VERIFY BODY")):
        body = _body(file_name, marker)
        assert not [line for line in body.splitlines() if line.lstrip().startswith("\\")], file_name
        assert "PASSWORD '" not in (OPS_DB / file_name).read_text(encoding="utf-8").upper().replace('"', "'"), file_name
    # The two check scripts are read-only: no writing statement outside the quoted labels.
    writes = re.compile(r"\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b")
    for name, marker in (("check_least_privilege.sql", "CHECK BODY"), ("role_split_verify.sql", "VERIFY BODY")):
        code = re.sub(r"'[^']*'", "''", _body(name, marker)).upper()
        assert not writes.search(code), (name, writes.search(code))


async def test_the_role_split_on_a_throwaway_database():
    server = _server()
    tag = uuid.uuid4().hex[:10]
    db = f"{PREFIX}{tag}"
    owner, migrator, app = f"{db}_owner", f"{db}_migrator", f"{db}_app"
    app_pw, migrator_pw = uuid.uuid4().hex, uuid.uuid4().hex          # throw-away, never printed
    app_url = f"postgresql+asyncpg://{app}:{app_pw}@{server['host']}:{server['port']}/{db}"
    migrator_url = f"postgresql+asyncpg://{migrator}:{migrator_pw}@{server['host']}:{server['port']}/{db}"

    admin = await asyncpg.connect(database="postgres", **server)
    if not await admin.fetchval("SELECT rolsuper FROM pg_roles WHERE rolname = current_user"):
        await admin.close()
        pytest.skip("the role split needs a superuser test role")
    await _drop_abandoned_leftovers(admin)
    try:
        # 1. Production's starting point: the runtime role owns the database and migrates it.
        await admin.execute(f"CREATE ROLE \"{app}\" LOGIN PASSWORD '{app_pw}'")
        await admin.execute(f'CREATE DATABASE "{db}" OWNER "{app}"')
        done = await asyncio.to_thread(_alembic, ["upgrade", "head"], app_url)
        assert done.returncode == 0, done.stderr[-2000:]

        su = await asyncpg.connect(database=db, **server)
        try:
            before = await _checks(su, _body("check_least_privilege.sql", "CHECK BODY"),
                                   runtime_role=app, owner_role="", schema_name="public")
            assert {"runtime role does not own the database", "alembic_version: runtime role may only read it",
                    "append-only audit_log: SELECT+INSERT only (no UPDATE, DELETE, TRUNCATE)"} <= {
                r["check"] for r in before if r["result"] == "FAIL"}

            # 2. The split, exactly the body of ops/db/role_split.sql (one transaction), then once more (idempotent).
            split_body = _body("role_split.sql", "ROLE SPLIT BODY")
            for _ in range(2):
                await _run_split(su, split_body, db, owner, migrator, app)
            await admin.execute(f"ALTER ROLE \"{migrator}\" PASSWORD '{migrator_pw}'")

            # 3. Every least-privilege and role-split check passes.
            check_body, verify_body = _body("check_least_privilege.sql", "CHECK BODY"), _body("role_split_verify.sql", "VERIFY BODY")
            general = await _checks(su, check_body, runtime_role=app, owner_role=owner, schema_name="public")
            assert _failed(general) == [] and len(general) >= 33
            split = await _checks(su, verify_body, db_name=db, migrator_role=migrator)
            assert _failed(split) == [] and len(split) == 12

            # 3b. CL2-IF-01 negative control: the previous grant (UPDATE on sequences, i.e. setval) makes both check
            #     scripts FAIL; re-running the real split repairs it (tables AND default privileges).
            old_grant = split_body.replace("GRANT USAGE, SELECT ON ALL SEQUENCES", "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES")
            old_grant = old_grant.replace("REVOKE UPDATE ON SEQUENCES FROM %I',", "GRANT UPDATE ON SEQUENCES TO %I',")
            assert old_grant != split_body
            await _run_split(su, old_grant, db, owner, migrator, app)
            seq_check = "runtime role has no UPDATE on any sequence (setval could rewind or exhaust an id sequence)"
            assert seq_check in _failed_names(await _checks(su, check_body, runtime_role=app, owner_role=owner,
                                                            schema_name="public"))
            assert "future sequences: runtime role gets USAGE (and SELECT) by default, never UPDATE" in _failed_names(
                await _checks(su, verify_body, db_name=db, migrator_role=migrator))
            await _run_split(su, split_body, db, owner, migrator, app)
            assert _failed(await _checks(su, check_body, runtime_role=app, owner_role=owner, schema_name="public")) == []
            assert _failed(await _checks(su, verify_body, db_name=db, migrator_role=migrator)) == []

            # 3c. CL2-IF-01 detection of earlier damage: an exhausted or a rewound id sequence is a FAIL.
            pos_check = "id sequences: next id above the highest id, far from the maximum, no absurd jump"
            await su.execute("INSERT INTO audit_log (source, category, action, summary, outcome, is_head_office_admin) "
                             "VALUES ('api', 'DATA', 'UPDATE', 'sequence check', 'OK', false)")
            for damage in ("SELECT setval('audit_log_id_seq', 9223372036854775000)",       # nearly exhausted
                           "SELECT setval('audit_log_id_seq', 1, false)",                  # rewound
                           "SELECT setval('audit_log_id_seq', (SELECT max(id) FROM audit_log) + 5000000)"):  # jump
                await su.execute(damage)
                rows = await _checks(su, check_body, runtime_role=app, owner_role=owner, schema_name="public")
                assert pos_check in _failed_names(rows), damage
                assert "audit_log_id_seq" in next(r["detail"] for r in rows if r["check"] == pos_check), damage
            await su.execute("SELECT setval('audit_log_id_seq', (SELECT max(id) FROM audit_log))")
            assert _failed(await _checks(su, check_body, runtime_role=app, owner_role=owner, schema_name="public")) == []
        finally:
            await su.close()

        # 4. The runtime role: everything the application needs, nothing more.
        rt = await asyncpg.connect(database=db, user=app, password=app_pw, host=server["host"], port=server["port"])
        try:
            for sql in CAN:
                tx = rt.transaction()
                await tx.start()
                try:
                    await rt.execute(sql)
                finally:
                    await tx.rollback()
            for sql in CANNOT:
                tx = rt.transaction()
                await tx.start()
                try:
                    with pytest.raises(asyncpg.PostgresError, match=DENIED):
                        await rt.execute(sql)
                finally:
                    await tx.rollback()
            # CREATE DATABASE cannot run inside a transaction: tried on its own.
            with pytest.raises(asyncpg.PostgresError, match=DENIED):
                await rt.execute("CREATE DATABASE lpt_evil")
            for target in (owner, migrator):
                with pytest.raises(asyncpg.PostgresError, match=DENIED):
                    await rt.execute(f'SET ROLE "{target}"')
            # CL2-IF-01: the refused setval changed nothing (setval is not undone by a rollback, so check it).
            assert await rt.fetchval("SELECT last_value < 1000000000 FROM audit_log_id_seq")
        finally:
            await rt.close()

        # 4b. CL2-IF-02: PostgreSQL lets the runtime role store its own session defaults (it cannot be forbidden),
        #     so detection is the control: both check scripts FAIL, the split's RESET ALL repairs it.
        rt = await asyncpg.connect(database=db, user=app, password=app_pw, host=server["host"], port=server["port"])
        try:
            await rt.execute(f'ALTER ROLE "{app}" SET default_transaction_read_only = on')
            await rt.execute(f'ALTER ROLE "{app}" IN DATABASE "{db}" SET statement_timeout = 5000')
        finally:
            await rt.close()
        rt = await asyncpg.connect(database=db, user=app, password=app_pw, host=server["host"], port=server["port"])
        try:
            with pytest.raises(asyncpg.PostgresError, match="read-only transaction"):
                await rt.execute("INSERT INTO company (code, name) VALUES ('LPT2', 'read-only probe')")
        finally:
            await rt.close()
        su = await asyncpg.connect(database=db, **server)
        try:
            settings_check = "runtime role has no stored session defaults (pg_db_role_setting), in any database"
            rows = await _checks(su, check_body, runtime_role=app, owner_role=owner, schema_name="public")
            assert settings_check in _failed_names(rows)
            assert "default_transaction_read_only=on" in next(r["detail"] for r in rows if r["check"] == settings_check)
            assert "runtime role has no stored session defaults in this database or for all databases" in _failed_names(
                await _checks(su, verify_body, db_name=db, migrator_role=migrator))
            await _run_split(su, split_body, db, owner, migrator, app)          # incident response: RESET ALL
            assert _failed(await _checks(su, check_body, runtime_role=app, owner_role=owner, schema_name="public")) == []
            assert _failed(await _checks(su, verify_body, db_name=db, migrator_role=migrator)) == []
        finally:
            await su.close()
        rt = await asyncpg.connect(database=db, user=app, password=app_pw, host=server["host"], port=server["port"])
        try:
            assert await rt.fetchval("SHOW default_transaction_read_only") == "off"
            tx = rt.transaction()
            await tx.start()
            try:
                await rt.execute("INSERT INTO company (code, name) VALUES ('LPT2', 'writable again')")
            finally:
                await tx.rollback()
        finally:
            await rt.close()

        # 5. The runtime role cannot migrate; the migrator migrates as the owner (downgrade + upgrade of the head).
        refused = await asyncio.to_thread(_alembic, ["downgrade", "-1"], app_url)
        assert refused.returncode != 0 and "must be owner" in refused.stderr
        for args in (["downgrade", "-1"], ["upgrade", "head"]):
            done = await asyncio.to_thread(_alembic, args, migrator_url, owner)
            assert done.returncode == 0, done.stderr[-2000:]

        # 6. A new object made by the migrator belongs to the owner and the runtime role can use it at once.
        mig = await asyncpg.connect(database=db, user=migrator, password=migrator_pw, host=server["host"], port=server["port"])
        rt = await asyncpg.connect(database=db, user=app, password=app_pw, host=server["host"], port=server["port"])
        try:
            assert tuple(await mig.fetchrow("SELECT current_user, session_user")) == (owner, migrator)
            await mig.execute("CREATE TABLE lpt_probe (id bigserial PRIMARY KEY, note text)")
            assert await mig.fetchval("SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'lpt_probe'") == owner
            assert await rt.fetchval("INSERT INTO lpt_probe (note) VALUES ('runtime') RETURNING id") == 1
            for sql in ("TRUNCATE lpt_probe", "DROP TABLE lpt_probe"):
                with pytest.raises(asyncpg.PostgresError, match=DENIED):
                    await rt.execute(sql)
            await mig.execute("DROP TABLE lpt_probe")
            # Without the owner role the migrator itself can create nothing.
            await mig.execute("SET ROLE NONE")
            with pytest.raises(asyncpg.PostgresError, match=DENIED):
                await mig.execute("CREATE TABLE lpt_probe_as_migrator (id integer)")
        finally:
            await mig.close()
            await rt.close()

        # 7. After the migrations, the post-deploy verification still passes (triggers present and enabled).
        su = await asyncpg.connect(database=db, **server)
        try:
            general = await _checks(su, _body("check_least_privilege.sql", "CHECK BODY"),
                                    runtime_role=app, owner_role=owner, schema_name="public")
            assert _failed(general) == []
        finally:
            await su.close()
    finally:
        await _drop_everything(admin, db, [migrator, app, owner])
        left = await admin.fetch(
            "SELECT rolname AS name FROM pg_roles WHERE rolname LIKE $1 UNION ALL "
            "SELECT datname FROM pg_database WHERE datname LIKE $1", f"{db}%")
        await admin.close()
    assert [r["name"] for r in left] == []
