"""The copy of the ERP data: first run, repeat runs, changes, things that disappear, failures."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.core.db import SessionLocal
from app.erp.mirror_models import ErpItemCopy, ErpPoLineCopy, ErpSyncRun, ErpVendorCopy
from app.erp.sync import HISTORY_DAYS, latest_run, needs_sync, run_sync
from tests.erp.fake_warehouse import FakeWarehouse, wh_item, wh_line, wh_vendor


def seeded() -> FakeWarehouse:
    wh = FakeWarehouse()
    wh.lines = [
        wh_line("CKSPL", "A1", po_code=1001), wh_line("CKSPL", "A2", po_code=1001, icode="CT2"),
        wh_line("CKVPL", "A1", po_code=2001, supplier_code="61", po_number="PO/00000060/26-27", delivery_location="CKVPL-WH-FARUKHNAGAR"),
    ]
    wh.vendor_list = [wh_vendor("CKSPL", "4431"), wh_vendor("CKVPL", "61", name="TRAANS GLOBAL")]
    wh.item_list = [wh_item("CT371487"), wh_item("CT2")]
    return wh


async def rows(model):
    async with SessionLocal() as s:
        return (await s.execute(select(model))).scalars().all()


async def test_the_first_run_copies_both_companies():
    run = await run_sync(SessionLocal, seeded(), "manual")
    assert (run.status, run.trigger, run.po_lines_new, run.po_lines_changed, run.po_lines_gone) == ("success", "manual", 3, 0, 0)
    assert run.finished_at is not None and run.source_stamp is not None
    lines = await rows(ErpPoLineCopy)
    assert sorted((l.company_code, l.po_line_key) for l in lines) == [("CKSPL", "A1"), ("CKSPL", "A2"), ("CKVPL", "A1")]
    assert all(l.is_present and l.first_seen_at == l.last_seen_at for l in lines)
    vendors = await rows(ErpVendorCopy)
    assert sorted((v.company_code, v.vendor_code) for v in vendors) == [("CKSPL", "4431"), ("CKVPL", "61")]
    assert run.vendors == 2 and run.items == 2
    assert sorted(i.icode for i in await rows(ErpItemCopy)) == ["CT2", "CT371487"]


async def test_a_repeat_run_changes_nothing_but_remembers_it_saw_the_rows():
    wh = seeded()
    await run_sync(SessionLocal, wh, "manual")
    before = {(l.company_code, l.po_line_key): l.last_seen_at for l in await rows(ErpPoLineCopy)}
    # the warehouse reloaded: same data, new load time -- that is not a change
    wh.lines = [wh_line(**{"company": l.company_code, "key": l.po_line_key, "po_code": l.po_code, "po_number": l.po_number,
                           "supplier_code": l.supplier_code, "icode": l.icode, "delivery_location": l.delivery_location,
                           "erp_loaded_at": l.erp_loaded_at + timedelta(days=1)}) for l in await rows(ErpPoLineCopy)]
    run = await run_sync(SessionLocal, wh, "schedule")
    assert (run.po_lines_new, run.po_lines_changed, run.po_lines_gone) == (0, 0, 0)
    after = {(l.company_code, l.po_line_key): l.last_seen_at for l in await rows(ErpPoLineCopy)}
    assert all(after[k] > before[k] for k in before)


async def test_a_changed_quantity_is_one_change():
    wh = seeded()
    await run_sync(SessionLocal, wh, "manual")
    wh.lines[0] = wh_line("CKSPL", "A1", po_code=1001, ordqty=7.0, line_netamt=3150.0, cnlqty=3.0)
    run = await run_sync(SessionLocal, wh, "schedule")
    assert (run.po_lines_new, run.po_lines_changed, run.po_lines_gone) == (0, 1, 0)
    [line] = [l for l in await rows(ErpPoLineCopy) if (l.company_code, l.po_line_key) == ("CKSPL", "A1")]
    assert (float(line.ordqty), float(line.cnlqty)) == (7.0, 3.0)
    assert line.first_seen_at < line.last_seen_at


async def test_a_line_the_erp_no_longer_returns_is_marked_gone_not_deleted():
    wh = seeded()
    await run_sync(SessionLocal, wh, "manual")
    wh.lines = [l for l in wh.lines if not (l.company_code == "CKSPL" and l.po_line_key == "A2")]
    run = await run_sync(SessionLocal, wh, "schedule")
    assert run.po_lines_gone == 1
    by_key = {(l.company_code, l.po_line_key): l for l in await rows(ErpPoLineCopy)}
    assert by_key[("CKSPL", "A2")].is_present is False
    assert by_key[("CKSPL", "A1")].is_present is True
    # and it comes back if the ERP returns it again
    wh.lines.append(wh_line("CKSPL", "A2", po_code=1001, icode="CT2"))
    run = await run_sync(SessionLocal, wh, "schedule")
    assert run.po_lines_gone == 0
    assert {(l.company_code, l.po_line_key): l for l in await rows(ErpPoLineCopy)}[("CKSPL", "A2")].is_present is True


async def test_an_old_po_outside_the_window_is_left_alone():
    wh = FakeWarehouse()
    old = date.today() - timedelta(days=HISTORY_DAYS + 30)
    wh.lines = [wh_line("CKSPL", "OLD1", po_code=900, po_date=old, line_status="CLOSED")]
    await run_sync(SessionLocal, wh, "manual")
    wh.lines = []                                              # the ERP stops returning it (too old, closed)
    run = await run_sync(SessionLocal, wh, "schedule")
    assert run.po_lines_gone == 0
    [line] = await rows(ErpPoLineCopy)
    assert line.is_present is True and line.line_status == "CLOSED"


async def test_pos_still_open_in_the_copy_are_asked_for_again_so_their_closing_is_seen():
    wh = FakeWarehouse()
    old = date.today() - timedelta(days=HISTORY_DAYS + 30)
    wh.lines = [wh_line("CKSPL", "OLD1", po_code=900, po_date=old, line_status="OPEN"), wh_line("CKSPL", "N1", po_code=901)]
    await run_sync(SessionLocal, wh, "manual")
    await run_sync(SessionLocal, wh, "schedule")
    assert wh.asked_also == frozenset({900})                    # old and open: asked for by number; the recent one is in the window anyway
    assert wh.asked_since == date.today() - timedelta(days=HISTORY_DAYS)


async def test_a_warehouse_problem_is_recorded_and_keeps_the_earlier_copy():
    wh = seeded()
    await run_sync(SessionLocal, wh, "manual")
    wh.down = "The ERP database could not be reached (OSError)."
    run = await run_sync(SessionLocal, wh, "schedule")
    assert run.status == "failed" and "could not be reached" in run.message
    assert len(await rows(ErpPoLineCopy)) == 3
    assert (await latest_run(SessionLocal)).status == "failed"


async def test_sites_of_both_companies_are_copied_and_the_same_site_code_stays_apart():
    from app.erp.mirror_models import ErpSiteCopy
    from tests.erp.fake_warehouse import wh_site
    wh = seeded()
    wh.site_list = [wh_site("CKSPL", 2, "LAM"), wh_site("CKVPL", 2, "CKVPL-WH-KHETAWAS", site_kind="WAREHOUSE", store_status=None)]
    await run_sync(SessionLocal, wh, "manual")
    sites = {(s.company_code, s.site_code): s for s in await rows(ErpSiteCopy)}
    assert set(sites) == {("CKSPL", 2), ("CKVPL", 2)} and sites[("CKSPL", 2)].short_name == "LAM"
    # a change is picked up, and a site the warehouse stops returning is marked not present (never deleted)
    wh.site_list = [wh_site("CKSPL", 2, "LAM", store_status="CLOSED")]
    await run_sync(SessionLocal, wh, "schedule")
    sites = {(s.company_code, s.site_code): s for s in await rows(ErpSiteCopy)}
    assert sites[("CKSPL", 2)].store_status == "CLOSED" and sites[("CKSPL", 2)].is_present is True
    assert sites[("CKVPL", 2)].is_present is False


async def test_a_second_copy_started_at_the_same_time_is_skipped():
    from sqlalchemy import text
    from app.erp.sync import LOCK_KEY
    async with SessionLocal() as holder:
        await holder.execute(text("select pg_advisory_xact_lock(:k)"), {"k": LOCK_KEY})      # a copy is "running"
        run = await run_sync(SessionLocal, seeded(), "schedule")
        assert run.status == "skipped" and "already running" in run.message
    assert await rows(ErpPoLineCopy) == []
    assert await rows(ErpSyncRun) == []


async def test_a_sync_is_needed_before_any_run_and_when_the_warehouse_has_loaded_again():
    wh = seeded()
    assert await needs_sync(SessionLocal, wh) is True
    await run_sync(SessionLocal, wh, "manual")
    assert await needs_sync(SessionLocal, wh) is False
    wh.stamp = wh.stamp + timedelta(hours=5)
    assert await needs_sync(SessionLocal, wh) is True


async def test_a_failed_run_does_not_count_as_up_to_date():
    wh = seeded()
    wh.down = "The ERP database could not be reached (OSError)."
    await run_sync(SessionLocal, wh, "manual")
    wh.down = None
    assert await needs_sync(SessionLocal, wh) is True


async def test_if_the_warehouse_cannot_say_when_it_loaded_the_copy_is_renewed_daily():
    wh = seeded()
    await run_sync(SessionLocal, wh, "manual")
    wh.stamp = None
    assert await needs_sync(SessionLocal, wh) is False          # copied just now
    async with SessionLocal() as s:
        run = (await s.execute(select(ErpSyncRun).where(ErpSyncRun.status == "success"))).scalars().one()
        run.finished_at = datetime.now(timezone.utc) - timedelta(hours=30)
        await s.commit()
    assert await needs_sync(SessionLocal, wh) is True
