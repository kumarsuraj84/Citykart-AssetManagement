"""S8: the daily purge of old log rows (never the audit trail), the append-only audit_log, and the guarded
archive function that is the only way rows of it can ever be removed."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import insert, text

from app.core.db import SessionLocal
from app.observability.models import AuditLog, ClientReport, ErrorLog, SystemEvent
from app.observability.retention import purge_audit_log_before, purge_old_logs
from tests.observability.helpers import audit, client_reports, errors, system_events

NOW = datetime.now(timezone.utc)


def _ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


async def _seed():
    async with SessionLocal() as s:
        await s.execute(insert(ErrorLog), [
            {"at": _ago(10), "level": "ERROR", "source": "api", "kind": "exception", "message": "recent"},
            {"at": _ago(200), "level": "ERROR", "source": "api", "kind": "exception", "message": "old"},
            {"at": _ago(200), "level": "CRITICAL", "source": "db", "kind": "exception", "message": "old critical"},
            {"at": _ago(400), "level": "CRITICAL", "source": "db", "kind": "exception", "message": "ancient critical"},
        ])
        await s.execute(insert(SystemEvent), [
            {"at": _ago(10), "level": "INFO", "component": "startup", "event": "app_started", "message": "recent"},
            {"at": _ago(200), "level": "INFO", "component": "startup", "event": "app_started", "message": "old"},
        ])
        await s.execute(insert(ClientReport), [
            {"at": _ago(200), "kind": "JS_ERROR", "status": "NEW", "message": "old new"},
            {"at": _ago(200), "kind": "JS_ERROR", "status": "REVIEWED", "message": "old reviewed"},
            {"at": _ago(400), "kind": "JS_ERROR", "status": "REVIEWED", "message": "ancient reviewed"},
        ])
        await s.execute(insert(AuditLog), [
            {"at": _ago(1000), "source": "api", "category": "DATA", "action": "UPDATE", "summary": "very old audit",
             "outcome": "OK", "is_head_office_admin": False}])
        await s.commit()


async def test_the_purge_removes_old_rows_keeps_critical_and_reviewed_twice_as_long_and_never_audit():
    await _seed()
    result = await purge_old_logs(now=NOW, days=180)
    assert (result["error_log"], result["system_event"], result["client_report"]) == (2, 1, 2)
    assert sorted(e.message for e in await errors()) == ["old critical", "recent"]
    assert [r.message for r in await client_reports()] == ["old reviewed"]
    assert [a.summary for a in await audit()] == ["very old audit"]
    events = await system_events()
    assert [e.message for e in events if e.component == "startup"] == ["recent"]
    [purge] = [e for e in events if e.component == "retention"]
    assert purge.event == "purge_finished" and purge.details["error_log"] == 2


async def test_audit_rows_cannot_be_changed_or_deleted():
    await _seed()
    async with SessionLocal() as s:
        with pytest.raises(Exception, match="append-only"):
            await s.execute(text("UPDATE audit_log SET summary = 'tampered'"))
    async with SessionLocal() as s:
        with pytest.raises(Exception, match="append-only"):
            await s.execute(text("DELETE FROM audit_log"))
    assert [a.summary for a in await audit()] == ["very old audit"]


async def test_the_archive_function_refuses_without_the_setting():
    await _seed()
    async with SessionLocal() as s:
        with pytest.raises(Exception, match="not allowed"):
            await s.execute(text("SELECT ckam_purge_audit_log(:b)"), {"b": _ago(30)})
    assert len(await audit()) == 1


async def test_the_archive_function_refuses_a_recent_cut_off():
    async with SessionLocal() as s:
        await s.execute(text("SET LOCAL ckam.allow_audit_purge = 'on'"))
        with pytest.raises(Exception, match="at least one day"):
            await s.execute(text("SELECT ckam_purge_audit_log(now())"))


async def test_the_guarded_archive_removes_only_older_rows_inside_its_transaction():
    await _seed()
    async with SessionLocal() as s:
        await s.execute(insert(AuditLog), [{"source": "api", "category": "DATA", "action": "UPDATE", "summary": "today",
                                            "outcome": "OK", "is_head_office_admin": False}])
        await s.commit()
    async with SessionLocal() as s:
        removed = await purge_audit_log_before(s, _ago(500))
        await s.commit()
    assert removed == 1 and [a.summary for a in await audit()] == ["today"]
    async with SessionLocal() as s:                        # the setting was LOCAL: gone with that transaction
        with pytest.raises(Exception, match="append-only"):
            await s.execute(text("DELETE FROM audit_log"))


async def test_the_triggers_and_function_exist():
    async with SessionLocal() as s:
        triggers = set((await s.execute(text(
            "SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal"))).scalars().all())
        functions = set((await s.execute(text(
            "SELECT proname FROM pg_proc WHERE proname IN ('ckam_purge_audit_log', 'forbid_audit_log_write')"
        ))).scalars().all())
    assert triggers == {"trg_audit_log_no_update", "trg_audit_log_no_delete"}
    assert functions == {"ckam_purge_audit_log", "forbid_audit_log_write"}
