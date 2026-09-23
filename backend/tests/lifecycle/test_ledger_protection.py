import pytest
from datetime import date, datetime, timezone
from sqlalchemy.exc import DBAPIError
from app.core.db import SessionLocal
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.assets.models import Asset
from app.lifecycle.models import AssetEvent


async def test_asset_event_cannot_be_updated_or_deleted():
    async with SessionLocal() as session:
        co = Company(code="CKS-LG1", name="Ledger Test Co")
        cat = AssetCategory(code="IT-LG1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-LG1", name="HO")
        dept = Department(name="IT-LG1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        holder = Holder(company_id=co.id, emp_code="ITSTOCK-LG1", name="IT Stock-HO",
                         holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        session.add(holder)
        await session.flush()
        asset = Asset(asset_code="FA/HO01/IT/LAP/CK_99", company_id=co.id, cost_center_id=cc.id,
                       category_id=cat.id, subcategory_id=sub.id, description="Ledger Laptop",
                       purchase_date=date(2025, 12, 10), status="IN_STOCK", current_holder_id=holder.id,
                       status_since=date(2025, 12, 10))
        session.add(asset)
        await session.flush()
        event = AssetEvent(asset_id=asset.id, event_type="PROCURED", event_date=datetime.now(timezone.utc),
                            to_holder_id=holder.id, status_after="IN_STOCK", recorded_by=holder.id)
        session.add(event)
        await session.commit()
        await session.refresh(event)

        event.remarks = "trying to edit history"
        with pytest.raises(DBAPIError):
            await session.commit()
        await session.rollback()

        await session.refresh(event)
        await session.delete(event)
        with pytest.raises(DBAPIError):
            await session.commit()
        await session.rollback()
