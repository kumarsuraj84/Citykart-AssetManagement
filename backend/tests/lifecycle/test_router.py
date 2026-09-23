from app.core.db import SessionLocal
from app.assets.service import procure_assets
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule
from datetime import date


async def test_allot_via_events_endpoint(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-LR1", name="Lifecycle Router Co")
        cat = AssetCategory(code="IT-LR1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-LR1", name="HO")
        dept = Department(name="IT-LR1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-LR1", name="IT Stock-HO",
                        holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-LR1", name="IT Admin",
                           holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        ankur = Holder(company_id=co.id, emp_code="CS-LR1", name="Ankur",
                        holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="HOLDER")
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, ankur, rule])
        await session.commit()
        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Router Lifecycle Laptop", "purchase_date": date(2025, 12, 10),
            "purchase_cost": 50000, "tax_percent": 18, "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()
        asset_id = assets[0].id

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-LR1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    event_resp = await client.post(f"/api/assets/{asset_id}/events", json={
        "event_type": "MOVED", "to_holder_id": ankur.id,
    }, headers=headers)
    assert event_resp.status_code == 201
    assert event_resp.json()["status_after"] == "ALLOTTED"

    timeline_resp = await client.get(f"/api/assets/{asset_id}/events", headers=headers)
    assert len(timeline_resp.json()) == 2  # PROCURED + MOVED

    bad_resp = await client.post(f"/api/assets/{asset_id}/events", json={
        "event_type": "DISPOSED",
    }, headers=headers)
    assert bad_resp.status_code == 422
