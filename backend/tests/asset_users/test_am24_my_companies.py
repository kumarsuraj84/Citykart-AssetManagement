"""AM-24: GET /api/asset-users/me/companies -- which companies the caller may
create/write records under. Also the live end-to-end proof that
POST /api/asset-users/{id}/company-access now actually has an effect (the
underlying scoped_company_ids bug this whole feature depends on)."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
from app.numbering.models import CodeRule


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co_a = Company(code=f"AM24A-{suffix}", name=f"AM24 Co A {suffix}")
        co_b = Company(code=f"AM24B-{suffix}", name=f"AM24 Co B {suffix}")
        session.add_all([co_a, co_b])
        await session.flush()
        loc = Location(company_id=co_a.id, code=f"AM24-{suffix}", name="HO")
        dept = Department(name=f"AM24-{suffix}")
        session.add_all([loc, dept])
        await session.flush()
        admin = AssetUser(company_id=co_a.id, code=f"ADM-{suffix}", name="Admin", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        staff = AssetUser(company_id=co_a.id, code=f"ITT-{suffix}", name="IT Team", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="OPERATOR",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([admin, staff])
        await session.commit()
        return {"co_a": co_a, "co_b": co_b, "admin": f"ADM-{suffix}", "staff": f"ITT-{suffix}", "staff_id": staff.id}


async def _login(client, login_id):
    resp = await client.post("/api/auth/login", json={"login_id": login_id, "password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_admin_sees_every_active_company(client):
    ids = await _setup("MC1")
    headers = await _login(client, ids["admin"])
    resp = await client.get("/api/asset-users/me/companies", headers=headers)
    assert resp.status_code == 200
    codes = {c["code"] for c in resp.json()}
    assert {ids["co_a"].code, ids["co_b"].code} <= codes


async def test_staff_with_no_grant_sees_only_their_home_company(client):
    ids = await _setup("MC2")
    headers = await _login(client, ids["staff"])
    resp = await client.get("/api/asset-users/me/companies", headers=headers)
    assert resp.status_code == 200
    codes = [c["code"] for c in resp.json()]
    assert codes == [ids["co_a"].code]


async def test_get_company_access_reads_back_the_current_grants(client):
    ids = await _setup("GET1")
    admin_headers = await _login(client, ids["admin"])

    empty_resp = await client.get(f"/api/asset-users/{ids['staff_id']}/company-access", headers=admin_headers)
    assert empty_resp.status_code == 200
    assert empty_resp.json() == {"company_ids": []}

    await client.post(
        f"/api/asset-users/{ids['staff_id']}/company-access", json={"company_ids": [ids["co_b"].id]}, headers=admin_headers,
    )
    resp = await client.get(f"/api/asset-users/{ids['staff_id']}/company-access", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json() == {"company_ids": [ids["co_b"].id]}


async def test_get_company_access_404s_for_an_unknown_asset_user(client):
    ids = await _setup("GET2")
    admin_headers = await _login(client, ids["admin"])
    resp = await client.get("/api/asset-users/999999/company-access", headers=admin_headers)
    assert resp.status_code == 404


async def test_granting_company_access_via_the_existing_endpoint_now_actually_works(client):
    """The real fix: before AM-24, POST .../company-access wrote the grant
    row but scoped_company_ids never read it back, so this had zero
    observable effect anywhere. Now it does."""
    ids = await _setup("MC3")
    admin_headers = await _login(client, ids["admin"])

    grant_resp = await client.post(
        f"/api/asset-users/{ids['staff_id']}/company-access", json={"company_ids": [ids["co_b"].id]}, headers=admin_headers,
    )
    assert grant_resp.status_code == 204

    staff_headers = await _login(client, ids["staff"])
    resp = await client.get("/api/asset-users/me/companies", headers=staff_headers)
    assert resp.status_code == 200
    codes = {c["code"] for c in resp.json()}
    assert codes == {ids["co_a"].code, ids["co_b"].code}


async def test_it_team_can_now_create_an_asset_in_a_granted_second_company(client):
    """End-to-end proof through the real write path (POST /api/assets),
    not just the scope-list check above."""
    ids = await _setup("MC4")
    admin_headers = await _login(client, ids["admin"])
    await client.post(
        f"/api/asset-users/{ids['staff_id']}/company-access", json={"company_ids": [ids["co_b"].id]}, headers=admin_headers,
    )

    async with SessionLocal() as session:
        cat = AssetCategory(code="AM24-CAT", name="IT", asset_domain="IT")
        vendor_b = Vendor(code="AM24-VNDB", name="B Vendor")
        session.add_all([cat, vendor_b])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="AM24-SUB", name="Laptop")
        cc_b = CostCenter(company_id=ids["co_b"].id, code="HO", name="HO")
        loc_b = Location(company_id=ids["co_b"].id, code="AM24-LOCB", name="B HO")
        dept_b = Department(name="AM24-DEPTB")
        session.add_all([sub, cc_b, loc_b, dept_b])
        await session.flush()
        stock_b = AssetUser(company_id=ids["co_b"].id, code="STKB-MC4", name="B Stock", asset_user_type="STOCK_POINT",
                          location_id=loc_b.id, department_id=dept_b.id, role="SELF_SERVICE")
        rule_b = CodeRule(company_id=ids["co_b"].id, prefix_template="AM24MC4/", suffix_template="",
                           start_number=1, pad_width=0)
        session.add_all([stock_b, rule_b])
        await session.commit()
        cat_id, sub_id, cc_b_id, stock_b_id, vendor_b_id = cat.id, sub.id, cc_b.id, stock_b.id, vendor_b.id

    staff_headers = await _login(client, ids["staff"])
    resp = await client.post("/api/assets", json={
        "company_id": ids["co_b"].id, "cost_center_id": cc_b_id, "category_id": cat_id, "subcategory_id": sub_id,
        "brand": None, "model": None, "serial_number": "N/A", "description": "Cross-company asset",
        "vendor_id": vendor_b_id, "initial_asset_user_id": stock_b_id, "warranty_years": 0,
    }, headers=staff_headers)
    assert resp.status_code == 201, resp.text
