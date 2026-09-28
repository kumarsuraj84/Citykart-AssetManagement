from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.service import procure_assets
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department, Vendor
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_search_by_serial_and_scoped_bulk_move(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-SR1", name="Search Test Co")
        cat = AssetCategory(code="IT-SR1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="MOU", name="Mouse")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-SR1", name="HO")
        dept = Department(name="IT-SR1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-SR1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        store = Holder(company_id=co.id, emp_code="ALC-SR1", name="ALC", holder_type="STORE",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-SR1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, store, it_admin, rule])
        await session.commit()
        # Serial Number is now globally unique (docs/ai/DECISIONS.md) -- two
        # units can no longer share one real serial via a single quantity=2
        # call, so this is two quantity=1 calls with distinct-but-related
        # serials instead, searched by their shared substring below.
        assets = []
        for suffix in ("1A", "1B"):
            [a] = await procure_assets(session, {
                "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
                "description": "Bulk Mouse", "purchase_date": date(2025, 12, 10),
                "serial_number": f"SR-SEARCH-{suffix}", "initial_holder_id": stock.id,
            }, quantity=1, actor=it_admin)
            assets.append(a)
        await session.commit()
        asset_ids = [a.id for a in assets]

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "login_id": "ITA-SR1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    search_resp = await client.get("/api/assets?q=SR-SEARCH", headers=headers)
    assert search_resp.json()["total"] == 2

    bulk_resp = await client.post("/api/assets/bulk-move", json={
        "asset_ids": asset_ids, "to_holder_id": store.id,
    }, headers=headers)
    assert bulk_resp.status_code == 200
    assert bulk_resp.json()["moved"] == 2
    assert bulk_resp.json()["failed"] == []


async def test_am11_search_by_description_substring(client):
    """AM-11 Phase-1 gap review: found the register's search covered asset_code/
    legacy_asset_code/serial_number/po_number/invoice_number/pi_number but not
    description -- a real operator is more likely to remember "the Dell laptop"
    than its generated code."""
    async with SessionLocal() as session:
        co = Company(code="CKS-SR2", name="Description Search Co")
        cat = AssetCategory(code="IT-SR2", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-SR2", name="HO")
        dept = Department(name="IT-SR2")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-SR2", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-SR2", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK2_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Dell Latitude Laptop", "purchase_date": date(2025, 12, 10),
            "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "login_id": "ITA-SR2", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    search_resp = await client.get("/api/assets?q=latitude", headers=headers)
    assert search_resp.json()["total"] == 1
    assert search_resp.json()["items"][0]["description"] == "Dell Latitude Laptop"


async def test_am11_list_resolves_holder_and_company_names(client):
    """AM-11 Phase-1 gap review: the register previously returned only raw
    current_holder_id/company_id, forcing a click into every row just to see
    who holds an asset -- CKAM's own stated core guarantee. Now resolved via
    a page-scoped batch lookup."""
    async with SessionLocal() as session:
        co = Company(code="CKS-SR3", name="Holder Name Co")
        cat = AssetCategory(code="IT-SR3", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-SR3", name="HO")
        dept = Department(name="IT-SR3")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-SR3", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-SR3", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK3_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Name Resolution Laptop", "purchase_date": date(2025, 12, 10),
            "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "login_id": "ITA-SR3", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    list_resp = await client.get("/api/assets?q=Name+Resolution", headers=headers)
    item = list_resp.json()["items"][0]
    assert item["current_holder_name"] == "IT Stock-HO"
    assert item["company_name"] == "Holder Name Co"


async def test_am11_list_resolves_category_subcategory_vendor_and_cost_center_names(client):
    """Asset Register "show every field" pass: the register's FK columns beyond
    Holder/Company (Category, Sub-Category, Vendor, Cost Centre) must also come
    back as names, not bare ids, via the same page-scoped batch lookup."""
    async with SessionLocal() as session:
        co = Company(code="CKS-SR4", name="Label Resolution Co")
        cat = AssetCategory(code="IT-SR4", name="IT Equipment")
        vendor = Vendor(code="VEN-SR4", name="Acme Supplies")
        session.add_all([co, cat, vendor])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="Head Office")
        loc = Location(code="HO-SR4", name="HO")
        dept = Department(name="IT-SR4")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-SR4", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-SR4", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK4_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "vendor_id": vendor.id, "description": "Column Label Resolution Laptop", "purchase_date": date(2025, 12, 10),
            "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "login_id": "ITA-SR4", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    list_resp = await client.get("/api/assets?q=Column+Label+Resolution", headers=headers)
    item = list_resp.json()["items"][0]
    assert item["category_name"] == "IT Equipment"
    assert item["subcategory_name"] == "Laptop"
    assert item["cost_center_name"] == "Head Office"
    assert item["vendor_name"] == "Acme Supplies"
