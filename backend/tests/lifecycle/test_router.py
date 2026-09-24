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

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "login_id": "ITA-LR1", "password": "Passw0rd!"})
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


async def test_naive_event_date_is_treated_as_utc_not_a_500(client):
    """AM-09: a caller-supplied event_date with no timezone offset (a bare
    "2025-06-01", perfectly valid ISO-8601, not adversarial input) used to
    crash `apply_event`'s `event_date > now` comparison with an unhandled
    TypeError ("can't compare offset-naive and offset-aware datetimes") --
    a raw 500. The real frontend always sends `.toISOString()` (always
    UTC-offset-aware) so this never reached the app through its own UI, but
    a direct API caller supplying a bare date must still get a controlled,
    correct response, not a crash."""
    async with SessionLocal() as session:
        co = Company(code="CKS-LR2", name="Lifecycle Router Co 2")
        cat = AssetCategory(code="IT-LR2", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-LR2", name="HO")
        dept = Department(name="IT-LR2")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-LR2", name="IT Stock-HO",
                        holder_type="IT_STOCK", location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-LR2", name="IT Admin",
                           holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/LR2_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Naive Date Laptop", "purchase_date": date(2025, 1, 1),
            "purchase_cost": 0, "tax_percent": 0, "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()
        asset_id = assets[0].id

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "login_id": "ITA-LR2", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    event_resp = await client.post(f"/api/assets/{asset_id}/events", json={
        "event_type": "MOVED", "to_holder_id": stock.id, "event_date": "2025-06-01",
    }, headers=headers)
    assert event_resp.status_code == 201
    assert event_resp.json()["status_after"] == "IN_STOCK"
