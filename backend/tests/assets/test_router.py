from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def _setup(session, suffix):
    co = Company(code=f"CKS-{suffix}", name="Router Test Co")
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
    it_admin = Holder(company_id=co.id, emp_code=f"ITA-{suffix}", name="IT Admin",
                       holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                       password_hash=hash_password("Passw0rd!"), must_change_password=False)
    ankur = Holder(company_id=co.id, emp_code=f"CS-{suffix}", name="Ankur",
                    holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="HOLDER",
                    password_hash=hash_password("Passw0rd!"), must_change_password=False)
    rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                     suffix_template="", start_number=1, pad_width=0)
    session.add_all([stock, it_admin, ankur, rule])
    await session.commit()
    return co, cc, cat, sub, stock, it_admin, ankur


async def _login(client, company_id, emp_code):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "emp_code": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_create_asset_and_scoped_get(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur = await _setup(session, "R1")

    admin_headers = await _login(client, co.id, it_admin.emp_code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Router Test Laptop", "purchase_date": "2025-12-10",
        "purchase_cost": "50000", "tax_percent": "18", "initial_holder_id": stock.id, "quantity": 1,
    }, headers=admin_headers)
    assert create_resp.status_code == 201
    asset_id = create_resp.json()[0]["id"]

    get_resp = await client.get(f"/api/assets/{asset_id}", headers=admin_headers)
    assert get_resp.status_code == 200

    holder_headers = await _login(client, co.id, ankur.emp_code)
    holder_get_resp = await client.get(f"/api/assets/{asset_id}", headers=holder_headers)
    assert holder_get_resp.status_code == 404  # not allotted to Ankur yet


async def test_delete_asset_only_before_it_has_moved(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur = await _setup(session, "R2")

    admin_headers = await _login(client, co.id, it_admin.emp_code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Mistake Entry", "purchase_date": "2025-12-10",
        "initial_holder_id": stock.id, "quantity": 1,
    }, headers=admin_headers)
    asset_id = create_resp.json()[0]["id"]

    delete_resp = await client.delete(f"/api/assets/{asset_id}", headers=admin_headers)
    assert delete_resp.status_code == 204
    assert (await client.get(f"/api/assets/{asset_id}", headers=admin_headers)).status_code == 404

    create_resp2 = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Moved Then Delete", "purchase_date": "2025-12-10",
        "initial_holder_id": stock.id, "quantity": 1,
    }, headers=admin_headers)
    moved_asset_id = create_resp2.json()[0]["id"]
    await client.post(f"/api/assets/{moved_asset_id}/events", json={"event_type": "MOVED", "to_holder_id": ankur.id}, headers=admin_headers)

    conflict_resp = await client.delete(f"/api/assets/{moved_asset_id}", headers=admin_headers)
    assert conflict_resp.status_code == 409
