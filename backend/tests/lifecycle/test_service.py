import pytest
from datetime import date, datetime, timedelta, timezone
from app.core.db import SessionLocal
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.assets.models import Asset


async def _fixture(session, suffix):
    co = Company(code=f"CKS-{suffix}", name="Lifecycle Test Co")
    cat = AssetCategory(code=f"IT-{suffix}", name="IT")
    session.add_all([co, cat])
    await session.flush()
    sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
    cc = CostCenter(company_id=co.id, code="HO01", name="HO")
    loc = Location(code=f"HO-{suffix}", name="HO")
    dept = Department(name=f"IT-{suffix}")
    session.add_all([sub, cc, loc, dept])
    await session.flush()
    stock = Holder(company_id=co.id, emp_code=f"ITSTOCK-{suffix}", name="IT Stock-HO",
                    holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
    ankur = Holder(company_id=co.id, emp_code=f"CS-{suffix}", name="Ankur",
                    holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="HOLDER")
    it_actor = Holder(company_id=co.id, emp_code=f"ITA-{suffix}", name="IT Actor",
                       holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="IT_TEAM")
    session.add_all([stock, ankur, it_actor])
    await session.flush()
    asset = Asset(asset_code=f"FA/HO01/IT/LAP/CK_{suffix}", company_id=co.id, cost_center_id=cc.id,
                   category_id=cat.id, subcategory_id=sub.id, description="Fixture Laptop",
                   purchase_date=date(2025, 12, 10), status="IN_STOCK", current_holder_id=stock.id,
                   status_since=date(2025, 12, 10))
    session.add(asset)
    await session.flush()
    return asset, stock, ankur, it_actor


async def test_apply_event_allots_and_updates_asset():
    async with SessionLocal() as session:
        asset, stock, ankur, it_actor = await _fixture(session, "S1")
        event = await apply_event(session, asset, "MOVED", to_holder_id=ankur.id, actor=it_actor)
        await session.commit()

        assert event.event_type == "MOVED"
        assert event.to_holder_id == ankur.id
        assert asset.status == "ALLOTTED"
        assert asset.current_holder_id == ankur.id


async def test_apply_event_rejects_dispose_while_allotted():
    async with SessionLocal() as session:
        asset, stock, ankur, it_actor = await _fixture(session, "S2")
        await apply_event(session, asset, "MOVED", to_holder_id=ankur.id, actor=it_actor)
        await session.commit()

        with pytest.raises(LifecycleError):
            await apply_event(session, asset, "DISPOSED", to_holder_id=None, actor=it_actor)


async def test_apply_event_rejects_future_date():
    async with SessionLocal() as session:
        asset, stock, ankur, it_actor = await _fixture(session, "S3")
        future = datetime.now(timezone.utc) + timedelta(days=5)
        with pytest.raises(LifecycleError, match="future"):
            await apply_event(session, asset, "MOVED", to_holder_id=ankur.id, actor=it_actor, event_date=future)


async def test_apply_event_rejects_date_before_last_event():
    async with SessionLocal() as session:
        asset, stock, ankur, it_actor = await _fixture(session, "S4")
        await apply_event(session, asset, "MOVED", to_holder_id=ankur.id, actor=it_actor)
        await session.commit()

        too_early = datetime(2020, 1, 1, tzinfo=timezone.utc)
        with pytest.raises(LifecycleError, match="before"):
            await apply_event(session, asset, "MOVED", to_holder_id=stock.id, actor=it_actor, event_date=too_early)
