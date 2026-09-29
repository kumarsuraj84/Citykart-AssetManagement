"""GET /api/assets/{id}/events carries a ready-to-display `label` built with
label_for_event and the real asset_user names (spec §5 custody wording), e.g.
"Allotted to Ankur Test" -- not just the raw event_type/status_after."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
from app.numbering.models import CodeRule


async def _setup():
    async with SessionLocal() as session:
        co = Company(code="LBL", name="Label Co")
        cat = AssetCategory(code="IT", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(company_id=co.id, code="LBL-HO", name="HO")
        dept = Department(name="IT-LBL")
        vendor = Vendor(code="VND-LBL", name="Label Vendor")
        session.add_all([sub, cc, loc, dept, vendor])
        await session.flush()

        def h(code, name, asset_user_type, role="ASSET_USER", **kw):
            return AssetUser(company_id=co.id, emp_code=code, name=name, asset_user_type=asset_user_type,
                          location_id=loc.id, department_id=dept.id, role=role, **kw)

        stock = h("STK", "IT Stock-HO", "IT_STOCK")
        emp = h("EMP", "Ankur Test", "EMPLOYEE")
        store = h("STR", "Store Karol Bagh", "STORE")
        admin = h("ADM", "Admin", "EMPLOYEE", role="ADMIN",
                  password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([stock, emp, store, admin,
                         CodeRule(company_id=None, prefix_template="FA/", suffix_template="", start_number=1, pad_width=0)])
        await session.commit()
        return co.id, cc.id, cat.id, sub.id, stock.id, emp.id, store.id, vendor.id


async def test_event_labels_use_asset_user_names(client):
    co_id, cc_id, cat_id, sub_id, stock_id, emp_id, store_id, vendor_id = await _setup()
    resp = await client.post("/api/auth/login", json={"company_id": co_id, "login_id": "ADM", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    [asset] = (await client.post("/api/assets", json={
        "company_id": co_id, "cost_center_id": cc_id, "category_id": cat_id, "subcategory_id": sub_id,
        "description": "Laptop", "invoice_date": "2025-01-01", "initial_asset_user_id": stock_id,
        "vendor_id": vendor_id, "po_number": "PO-1", "po_date": "2024-12-20",
        "invoice_number": "INV-1", "pi_number": "PI-1", "pi_date": "2024-12-25",
        "serial_number": "SN-LBL",
    }, headers=headers)).json()
    aid = asset["id"]

    async def move(to_id):
        r = await client.post(f"/api/assets/{aid}/events", json={"event_type": "MOVED", "to_asset_user_id": to_id}, headers=headers)
        assert r.status_code == 201, r.text
        return r.json()

    allot = await move(emp_id)
    # The create response carries the label too, not just the list endpoint.
    assert allot["label"] == "Allotted to Ankur Test"
    await move(store_id)       # EMPLOYEE -> STORE
    await move(stock_id)       # back to IT stock
    repair = await client.post(f"/api/assets/{aid}/events", json={"event_type": "SENT_FOR_REPAIR"}, headers=headers)
    assert repair.status_code == 201

    events = (await client.get(f"/api/assets/{aid}/events", headers=headers)).json()
    assert [e["label"] for e in events] == [
        "Procured into IT Stock-HO",
        "Allotted to Ankur Test",
        "Transferred from Ankur Test to Store Karol Bagh",
        "Returned to IT Stock-HO",
        "Sent for repair",
    ]
    # Raw fields are still there for anything that needs them.
    assert events[1]["event_type"] == "MOVED" and events[1]["status_after"] == "ALLOTTED"
