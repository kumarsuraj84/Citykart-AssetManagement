"""S8: system events -- start / stop, migration mismatch, ERP copies (manual and scheduled, with a job id),
the background loop surviving errors, and retention runs."""
import asyncio

from app.core.config import settings
from app.core.db import SessionLocal
from app.erp.sync import run_sync, sync_loop
from app.observability import system
from app.observability.models import AuditLog, ErrorLog, SystemEvent
from tests.erp.fake_warehouse import FakeWarehouse, wh_line
from tests.observability.helpers import audit, errors, system_events


async def test_startup_and_shutdown_are_recorded_with_version_and_safe_config():
    await system.on_startup()
    await system.on_shutdown()
    events = await system_events()
    assert [(e.component, e.event) for e in events] == [("startup", "app_started"), ("shutdown", "app_stopped")]
    details = events[0].details
    assert details["environment"] == settings.environment_name and details["version"]
    # Security migrations (intended change): the head is now b5d7f9a1c3e5 (AU-06 auth_session, closure WP-A2).
    assert details["migration"]["code_head"] == "b5d7f9a1c3e5" and details["migration"]["matches"] is True
    assert "database_url" not in str(details) and settings.jwt_secret not in str(details)
    assert details["config"]["jwt_signing_key_is_placeholder"] in (True, False)


async def test_a_migration_mismatch_is_a_warning(monkeypatch):
    monkeypatch.setattr(system, "code_heads", lambda: ["ffffffffffff"])
    await system.on_startup()
    [mismatch] = await system_events(SystemEvent.component == "migration")
    assert mismatch.level == "WARNING" and mismatch.event == "head_mismatch"
    assert "ffffffffffff" in mismatch.message and "b5d7f9a1c3e5" in mismatch.message


def test_the_version_comes_from_the_setting_the_environment_or_a_file(monkeypatch, tmp_path):
    system.app_version.cache_clear()
    try:
        monkeypatch.setattr(settings, "app_version", "abc1234")
        assert system.app_version() == "abc1234"
        system.app_version.cache_clear()
        monkeypatch.setattr(settings, "app_version", "")
        monkeypatch.setenv("GIT_COMMIT", "def5678")
        assert system.app_version() == "def5678"
        system.app_version.cache_clear()
        monkeypatch.delenv("GIT_COMMIT")
        monkeypatch.setattr(system, "BACKEND_DIR", tmp_path / "backend")
        (tmp_path / "VERSION").write_text("8231308\n")
        assert system.app_version() == "8231308"
        system.app_version.cache_clear()
        (tmp_path / "VERSION").unlink()
        assert system.app_version() == "unknown"
    finally:
        system.app_version.cache_clear()


async def test_an_erp_copy_is_a_started_and_a_success_event():
    wh = FakeWarehouse()
    wh.lines = [wh_line("CKSPL", "A1")]
    run = await run_sync(SessionLocal, wh, "manual")
    assert run.status == "success"
    events = await system_events(SystemEvent.component == "erp_sync")
    assert [e.event for e in events] == ["sync_started", "sync_success"]
    assert events[1].details["po_lines_new"] == 1 and events[1].details["trigger"] == "manual"


async def test_a_failed_erp_copy_is_an_error_event_with_the_reason():
    wh = FakeWarehouse()
    wh.down = "The ERP database could not be reached (OSError)."
    run = await run_sync(SessionLocal, wh, "schedule")
    assert run.status == "failed"
    [failed] = [e for e in await system_events(SystemEvent.component == "erp_sync") if e.event == "sync_failed"]
    assert failed.level == "ERROR" and "could not be reached" in failed.message


async def test_the_scheduled_copy_runs_as_a_job_with_its_own_id(monkeypatch):
    wh = FakeWarehouse()
    wh.lines = [wh_line("CKSPL", "A1")]
    monkeypatch.setattr(settings, "erp_sync_check_minutes", 0.0005)
    stop = asyncio.Event()
    task = asyncio.create_task(sync_loop(SessionLocal, wh, stop))
    try:
        for _ in range(250):
            done = [e for e in await system_events(SystemEvent.event == "sync_success")]
            if done:
                break
            await asyncio.sleep(0.02)
    finally:
        stop.set()
        await asyncio.wait_for(task, timeout=5)
    assert done and done[0].request_id.startswith("job-erp_sync-")


async def test_a_background_loop_error_is_logged_and_the_loop_survives(monkeypatch):
    import app.erp.sync as sync

    async def exploding(*args, **kwargs):
        raise ZeroDivisionError("loop boom")

    monkeypatch.setattr(sync, "needs_sync", exploding)
    monkeypatch.setattr(settings, "erp_sync_check_minutes", 0.0005)
    stop = asyncio.Event()
    task = asyncio.create_task(sync_loop(SessionLocal, FakeWarehouse(), stop))
    await asyncio.sleep(0.2)
    assert not task.done()
    stop.set()
    await asyncio.wait_for(task, timeout=5)
    loop_errors = await system_events(SystemEvent.event == "loop_error")
    assert loop_errors and loop_errors[0].component == "scheduler" and loop_errors[0].level == "ERROR"
    rows = await errors(ErrorLog.exception_type == "ZeroDivisionError")
    assert rows and rows[0].source == "job" and rows[0].request_id.startswith("job-erp_sync-")


async def test_a_manual_copy_carries_the_request_id_and_says_who_asked(client, monkeypatch):
    from app.erp.warehouse import get_warehouse_reader
    from app.main import app
    from tests.erp.test_erp_api import _headers, _setup

    wh = FakeWarehouse()
    wh.lines = [wh_line("CKSPL", "A1")]
    app.dependency_overrides[get_warehouse_reader] = lambda: wh
    monkeypatch.setattr("app.erp.router.is_configured", lambda: True)
    try:
        await _setup()
        resp = await client.post("/api/erp/sync", headers=await _headers(client))
    finally:
        app.dependency_overrides.pop(get_warehouse_reader, None)
    assert resp.status_code == 200, resp.text
    rid = resp.headers["x-request-id"]
    assert [e.event for e in await system_events(SystemEvent.request_id == rid)] == ["sync_started", "sync_success"]
    [row] = await audit(AuditLog.request_id == rid)
    assert (row.category, row.action, row.outcome) == ("ERP", "ERP_SYNC", "OK")
