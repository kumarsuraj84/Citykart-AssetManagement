"""Security AU-10 / IF-05 / IF-06 (VAPT 2026-10): the append-only ledgers refuse UPDATE, DELETE and TRUNCATE for the
application's own database role, and the audit purge setting cannot remove recent audit rows."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import insert, text

from app.core.db import SessionLocal, engine
from app.observability.models import AuditLog
from tests.core.s0_world import build_world, login, make_asset
from tests.observability.helpers import audit

APPEND_ONLY = ("asset_event", "asset_field_change", "master_audit", "audit_log")


async def _audit_row(summary: str, at: datetime | None = None) -> None:
    async with SessionLocal() as s:
        row = {"source": "api", "category": "DATA", "action": "UPDATE", "summary": summary, "outcome": "OK",
               "is_head_office_admin": False}
        if at is not None:
            row["at"] = at
        await s.execute(insert(AuditLog), [row])
        await s.commit()


@pytest.mark.parametrize("table", APPEND_ONLY)
async def test_truncate_is_refused_on_every_append_only_table(client, table):
    await _audit_row("keep me")
    async with SessionLocal() as s:
        with pytest.raises(Exception, match="append-only; TRUNCATE is not allowed"):
            await s.execute(text(f"TRUNCATE TABLE {table}"))
    async with SessionLocal() as s:
        with pytest.raises(Exception, match="TRUNCATE is not allowed"):
            await s.execute(text(f"TRUNCATE TABLE {table} CASCADE"))
    assert [a.summary for a in await audit()] == ["keep me"]


async def test_the_movement_ledger_refuses_update_delete_and_truncate(client):
    w = await build_world()
    h = await login(client, w, "admin")
    await make_asset(client, h, w)
    for sql in ("UPDATE asset_event SET event_type = event_type", "DELETE FROM asset_event", "TRUNCATE asset_event"):
        async with SessionLocal() as s:
            with pytest.raises(Exception, match="append-only"):
                await s.execute(text(sql))
    async with SessionLocal() as s:
        assert (await s.execute(text("SELECT count(*) FROM asset_event"))).scalar_one() >= 1


async def test_the_purge_setting_cannot_delete_a_fresh_audit_row(client):
    await _audit_row("today")
    async with SessionLocal() as s:
        await s.execute(text("SET LOCAL ckam.allow_audit_purge = 'on'"))
        with pytest.raises(Exception, match="append-only"):
            await s.execute(text("DELETE FROM audit_log"))
    async with SessionLocal() as s:
        await s.execute(text("SET LOCAL ckam.allow_audit_purge = 'on'"))
        with pytest.raises(Exception, match="at least 5 years"):
            await s.execute(text("SELECT ckam_purge_audit_log(now() - interval '1 year')"))
    assert [a.summary for a in await audit()] == ["today"]


async def test_the_purge_setting_still_opens_rows_older_than_the_floor(client):
    await _audit_row("six years old", datetime.now(timezone.utc) - timedelta(days=6 * 366))
    await _audit_row("today")
    async with SessionLocal() as s:
        await s.execute(text("SET LOCAL ckam.allow_audit_purge = 'on'"))
        removed = (await s.execute(text("DELETE FROM audit_log WHERE at < now() - interval '5 years'"))).rowcount
        await s.commit()
    assert removed == 1 and [a.summary for a in await audit()] == ["today"]


async def test_a_role_that_is_not_a_superuser_cannot_switch_the_guards_off(client):
    """The test suite empties tables with session_replication_role = replica (superuser only). A non-superuser
    role -- like the production application role -- can neither set that nor TRUNCATE past the trigger, even
    holding the TRUNCATE privilege. (The role exists only inside this rolled-back transaction.)"""
    await _audit_row("keep me")
    role = f"ckam_vapt_{uuid.uuid4().hex[:8]}"
    async with engine.connect() as conn:
        outer = await conn.begin()
        try:
            await conn.execute(text(f"CREATE ROLE {role} NOLOGIN NOSUPERUSER"))
            await conn.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON audit_log TO {role}"))
            await conn.execute(text(f"SET LOCAL ROLE {role}"))
            savepoint = await conn.begin_nested()
            with pytest.raises(Exception, match="permission denied"):
                await conn.execute(text("SET LOCAL session_replication_role = replica"))
            await savepoint.rollback()
            savepoint = await conn.begin_nested()
            with pytest.raises(Exception, match="TRUNCATE is not allowed"):
                await conn.execute(text("TRUNCATE TABLE audit_log"))
            await savepoint.rollback()
            savepoint = await conn.begin_nested()
            await conn.execute(text("SET LOCAL ckam.allow_audit_purge = 'on'"))
            with pytest.raises(Exception, match="append-only"):
                await conn.execute(text("DELETE FROM audit_log"))
            await savepoint.rollback()
        finally:
            await outer.rollback()
    assert [a.summary for a in await audit()] == ["keep me"]
