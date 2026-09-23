from datetime import date
from app.core.db import SessionLocal
from app.assets.service import procure_assets
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_procure_assets_creates_quantity_with_tax_and_codes():
    async with SessionLocal() as session:
        co = Company(code="CKS-PR1", name="Procure Test Co")
        # Category code is "IT" (not "IT-PR1") because the code-rule template below embeds
        # {category.code} verbatim into the generated asset_code, and the expected codes below
        # are "FA/HO01/IT/MOU/CK_n". The per-test table TRUNCATE in conftest.py's
        # _truncate_tables fixture means no cross-test/cross-file uniqueness collision risk,
        # so there's no need to suffix this code the way other fixtures do.
        cat = AssetCategory(code="IT", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="MOU", name="Mouse")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-PR1", name="HO")
        dept = Department(name="IT-PR1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-PR1", name="IT Stock-HO",
                        holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_actor = Holder(company_id=co.id, emp_code="ITA-PR1", name="IT Actor",
                           holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="IT_TEAM")
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_actor, rule])
        await session.commit()

        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Wireless Mouse", "purchase_date": date(2025, 12, 10),
            "purchase_cost": 1000, "tax_percent": 18, "initial_holder_id": stock.id,
        }, quantity=3, actor=it_actor)
        await session.commit()

        assert len(assets) == 3
        assert [a.asset_code for a in assets] == [
            "FA/HO01/IT/MOU/CK_1", "FA/HO01/IT/MOU/CK_2", "FA/HO01/IT/MOU/CK_3",
        ]
        for a in assets:
            assert a.tax_amount == 180
            assert a.total_cost == 1180
            assert a.status == "IN_STOCK"
            assert a.current_holder_id == stock.id
