from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department, Vendor
from app.asset_users.models import AssetUser
from app.numbering.models import CodeRule


async def _setup(session, suffix):
    co = Company(code=f"CKS-{suffix}", name="Router Test Co")
    cat = AssetCategory(code=f"IT-{suffix}", name="IT", asset_domain="IT")
    session.add_all([co, cat])
    await session.flush()
    sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
    cc = CostCenter(company_id=co.id, code="HO01", name="HO")
    loc = Location(company_id=co.id, code=f"HO-{suffix}", name="HO")
    dept = Department(name=f"IT-{suffix}")
    vendor = Vendor(code=f"VND-{suffix}", name="Router Test Vendor")
    session.add_all([sub, cc, loc, dept, vendor])
    await session.flush()
    stock = AssetUser(company_id=co.id, code=f"ITSTOCK-{suffix}", name="IT Stock-HO",
                    asset_user_type="STOCK_POINT", location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
    it_admin = AssetUser(company_id=co.id, code=f"ITA-{suffix}", name="IT Admin",
                       asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="ADMIN",
                       login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
    ankur = AssetUser(company_id=co.id, code=f"CS-{suffix}", name="Ankur",
                    asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id, role="SELF_SERVICE",
                    login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
    rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                     suffix_template="", start_number=1, pad_width=0)
    session.add_all([stock, it_admin, ankur, rule])
    await session.commit()
    return co, cc, cat, sub, stock, it_admin, ankur, vendor


async def _login(client, company_id, code):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_create_asset_and_scoped_get(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur, vendor = await _setup(session, "R1")

    admin_headers = await _login(client, co.id, it_admin.code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Router Test Laptop", "invoice_date": "2025-12-10",
        "purchase_cost": "50000", "tax_percent": "18", "initial_asset_user_id": stock.id, "quantity": 1,
        "vendor_id": vendor.id, "po_number": "PO-1", "po_date": "2025-12-01",
        "invoice_number": "INV-1", "pi_number": "PI-1", "pi_date": "2025-12-05",
        "serial_number": "SN-R1",
    }, headers=admin_headers)
    assert create_resp.status_code == 201
    asset_id = create_resp.json()[0]["id"]

    get_resp = await client.get(f"/api/assets/{asset_id}", headers=admin_headers)
    assert get_resp.status_code == 200

    asset_user_headers = await _login(client, co.id, ankur.code)
    asset_user_get_resp = await client.get(f"/api/assets/{asset_id}", headers=asset_user_headers)
    assert asset_user_get_resp.status_code == 404  # not allotted to Ankur yet


async def test_delete_asset_only_before_it_has_moved(client):
    async with SessionLocal() as session:
        co, cc, cat, sub, stock, it_admin, ankur, vendor = await _setup(session, "R2")

    admin_headers = await _login(client, co.id, it_admin.code)
    create_resp = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Mistake Entry", "invoice_date": "2025-12-10",
        "initial_asset_user_id": stock.id, "quantity": 1,
        "vendor_id": vendor.id, "po_number": "PO-2", "po_date": "2025-12-01",
        "invoice_number": "INV-2", "pi_number": "PI-2", "pi_date": "2025-12-05",
        "serial_number": "SN-R2A",
    }, headers=admin_headers)
    asset_id = create_resp.json()[0]["id"]

    delete_resp = await client.delete(f"/api/assets/{asset_id}", headers=admin_headers)
    assert delete_resp.status_code == 204
    assert (await client.get(f"/api/assets/{asset_id}", headers=admin_headers)).status_code == 404

    create_resp2 = await client.post("/api/assets", json={
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Moved Then Delete", "invoice_date": "2025-12-10",
        "initial_asset_user_id": stock.id, "quantity": 1,
        "vendor_id": vendor.id, "po_number": "PO-3", "po_date": "2025-12-01",
        "invoice_number": "INV-3", "pi_number": "PI-3", "pi_date": "2025-12-05",
        "serial_number": "SN-R2B",
    }, headers=admin_headers)
    moved_asset_id = create_resp2.json()[0]["id"]
    await client.post(f"/api/assets/{moved_asset_id}/events", json={"event_type": "MOVED", "to_asset_user_id": ankur.id}, headers=admin_headers)

    conflict_resp = await client.delete(f"/api/assets/{moved_asset_id}", headers=admin_headers)
    assert conflict_resp.status_code == 409
