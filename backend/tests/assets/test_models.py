import pytest
from datetime import date
from sqlalchemy.exc import DBAPIError
from app.core.db import SessionLocal
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.asset_users.models import AssetUser
from app.assets.models import Asset


async def _base_fixtures(session, suffix="AM1"):
    co = Company(code=f"CKS-{suffix}", name="Asset Test Co")
    cat = AssetCategory(code=f"IT-{suffix}", name="IT Equipment", asset_domain="IT")
    session.add_all([co, cat])
    await session.flush()
    sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
    cc = CostCenter(company_id=co.id, code="HO01", name="Head Office")
    loc = Location(company_id=co.id, code=f"HO-{suffix}", name="HO")
    dept = Department(name=f"IT-Dept-{suffix}")
    session.add_all([sub, cc, loc, dept])
    await session.flush()
    stock_asset_user = AssetUser(company_id=co.id, code=f"ITSTOCK-{suffix}", name="IT Stock-HO",
                           asset_user_type="STOCK_POINT", location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
    session.add(stock_asset_user)
    await session.flush()
    return co, cat, sub, cc, stock_asset_user


async def test_asset_code_is_immutable_after_insert():
    async with SessionLocal() as session:
        co, cat, sub, cc, asset_user = await _base_fixtures(session)
        asset = Asset(
            asset_code="FA/HO01/IT/LAP/CK_1", company_id=co.id, cost_center_id=cc.id,
            category_id=cat.id, subcategory_id=sub.id, description="Test Laptop",
            purchase_date=date(2025, 12, 10), status="IN_STOCK", current_asset_user_id=asset_user.id,
            status_since=date(2025, 12, 10), asset_domain="IT",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        asset.asset_code = "CHANGED"
        with pytest.raises(DBAPIError):
            await session.commit()
        await session.rollback()
