"""Seeing when the ERP data was copied, copying now, and the background check."""
import asyncio

import pytest

from app.core.config import settings
from app.core.db import SessionLocal
from app.erp.sync import latest_run, sync_loop
from app.erp.warehouse import get_warehouse_reader
from app.main import app
from tests.erp.fake_warehouse import FakeWarehouse, wh_item, wh_line, wh_vendor
from tests.erp.test_erp_api import _headers, _setup


@pytest.fixture
def warehouse(monkeypatch):
    wh = FakeWarehouse()
    wh.lines = [wh_line("CKSPL", "A1"), wh_line("CKVPL", "V1", po_code=2001, supplier_code="61")]
    wh.vendor_list = [wh_vendor("CKSPL", "4431"), wh_vendor("CKVPL", "61")]
    wh.item_list = [wh_item("CT371487")]
    app.dependency_overrides[get_warehouse_reader] = lambda: wh
    monkeypatch.setattr("app.erp.router.is_configured", lambda: True)
    yield wh
    app.dependency_overrides.pop(get_warehouse_reader, None)


async def test_before_any_copy_the_status_has_no_runs(client, warehouse):
    await _setup()
    resp = await client.get("/api/erp/sync", headers=await _headers(client, "OPR"))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"configured": True, "last": None, "last_success": None}


async def test_the_primary_owner_can_copy_now(client, warehouse):
    await _setup()
    h = await _headers(client)
    resp = await client.post("/api/erp/sync", headers=h)
    assert resp.status_code == 200, resp.text
    run = resp.json()
    assert (run["status"], run["trigger"], run["po_lines_new"], run["vendors"], run["items"]) == ("success", "manual", 2, 2, 1)
    status = (await client.get("/api/erp/sync", headers=await _headers(client, "OPR"))).json()
    assert status["last"]["status"] == "success" and status["last_success"]["po_lines_new"] == 2
    assert status["last_success"]["source_stamp"] is not None


async def test_only_the_primary_owner_can_copy_now(client, warehouse):
    await _setup()
    assert (await client.post("/api/erp/sync", headers=await _headers(client, "OPR"))).status_code == 403
    assert (await client.get("/api/erp/sync", headers=await _headers(client, "VWR"))).status_code == 403


async def test_copying_without_an_erp_connection_says_so(client, warehouse, monkeypatch):
    await _setup()
    monkeypatch.setattr("app.erp.router.is_configured", lambda: False)
    resp = await client.post("/api/erp/sync", headers=await _headers(client))
    assert resp.status_code == 503 and "not set up" in resp.json()["detail"]


async def test_a_warehouse_problem_comes_back_as_a_failed_run_not_an_error(client, warehouse):
    await _setup()
    warehouse.down = "The ERP database could not be reached (OSError)."
    resp = await client.post("/api/erp/sync", headers=await _headers(client))
    assert resp.status_code == 200
    assert resp.json()["status"] == "failed" and "could not be reached" in resp.json()["message"]
    status = (await client.get("/api/erp/sync", headers=await _headers(client))).json()
    assert status["last"]["status"] == "failed" and status["last_success"] is None


async def wait_for(check, seconds=5.0):
    for _ in range(int(seconds / 0.02)):
        if await check():
            return True
        await asyncio.sleep(0.02)
    return False


async def test_the_background_check_copies_at_start_and_again_when_the_warehouse_has_loaded(monkeypatch):
    wh = FakeWarehouse()
    wh.lines = [wh_line("CKSPL", "A1")]
    monkeypatch.setattr(settings, "erp_sync_check_minutes", 0.0005)          # about 30 ms
    stop = asyncio.Event()
    task = asyncio.create_task(sync_loop(SessionLocal, wh, stop))
    try:
        async def first():
            run = await latest_run(SessionLocal)
            return run is not None and run.status == "success"
        assert await wait_for(first)
        assert (await latest_run(SessionLocal)).trigger == "startup"

        wh.stamp = wh.stamp.replace(hour=wh.stamp.hour + 1)                    # the warehouse loaded again
        async def second():
            run = await latest_run(SessionLocal)
            return run is not None and run.trigger == "schedule" and run.status == "success"
        assert await wait_for(second)
    finally:
        stop.set()
        await asyncio.wait_for(task, timeout=5)
    assert task.done() and task.exception() is None


async def test_the_background_check_survives_a_warehouse_that_is_down(monkeypatch):
    wh = FakeWarehouse()
    wh.down = "The ERP database could not be reached (OSError)."
    monkeypatch.setattr(settings, "erp_sync_check_minutes", 0.0005)
    stop = asyncio.Event()
    task = asyncio.create_task(sync_loop(SessionLocal, wh, stop))
    await asyncio.sleep(0.2)
    assert not task.done()                                                     # still alive after failing
    stop.set()
    await asyncio.wait_for(task, timeout=5)
