"""POST /api/assets: every code-rule token resolves to a real value, service-layer
errors come back as clean 422s (never raw 500s), and a non-ADMIN actor can only
create assets inside their own company scope (403 otherwise)."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule


async def _company(session, code):
    co = Company(code=code, name=f"{code} Co")
    session.add(co)
    await session.flush()
    loc = Location(code=f"{code}-LOC", name=f"{code} HO")
    dept = Department(name=f"IT-{code}")
    cc = CostCenter(company_id=co.id, code="HO01", name="HO")
    session.add_all([loc, dept, cc])
    await session.flush()
    stock = Holder(company_id=co.id, emp_code=f"STOCK-{code}", name=f"IT Stock {code}", holder_type="IT_STOCK",
                   location_id=loc.id, department_id=dept.id, role="HOLDER")
    session.add(stock)
    await session.flush()
    return {"co": co, "loc": loc, "dept": dept, "cc": cc, "stock": stock}


async def _setup(prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_", with_rule=True):
    async with SessionLocal() as session:
        a = await _company(session, "CKA")
        b = await _company(session, "CKB")
        cat = AssetCategory(code="IT", name="IT")
        session.add(cat)
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        admin = Holder(company_id=a["co"].id, emp_code="ADM", name="Admin", holder_type="EMPLOYEE",
                       location_id=a["loc"].id, department_id=a["dept"].id, role="ADMIN",
                       password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_a = Holder(company_id=a["co"].id, emp_code="ITA", name="IT Team A", holder_type="EMPLOYEE",
                      location_id=a["loc"].id, department_id=a["dept"].id, role="IT_TEAM",
                      password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add_all([sub, admin, it_a])
        if with_rule:
            session.add(CodeRule(company_id=None, prefix_template=prefix_template, suffix_template="",
                                 start_number=1, pad_width=0))
        await session.commit()
    return a, b, cat, sub


async def _headers(client, company_id, emp_code):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _asset_body(target, cat, sub, **overrides):
    body = {
        "company_id": target["co"].id, "cost_center_id": target["cc"].id, "category_id": cat.id,
        "subcategory_id": sub.id if sub else None, "description": "Laptop", "purchase_date": "2025-12-10",
        "initial_holder_id": target["stock"].id, "quantity": 1,
    }
    body.update(overrides)
    return body


async def test_company_location_and_date_tokens_resolve_to_real_values(client):
    a, b, cat, sub = await _setup("{company.code}/{location.code}/{yyyy}/{yy}{mm}/")
    headers = await _headers(client, a["co"].id, "ADM")

    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub), headers=headers)
    assert resp.status_code == 201, resp.text
    # company.code from the asset's company; location.code from the initial
    # holder's location; yyyy/yy/mm from the purchase date (2025-12-10).
    assert resp.json()[0]["asset_code"] == "CKA/CKA-LOC/2025/2512/1"


async def test_it_team_cannot_create_asset_in_another_company(client):
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ITA")

    resp = await client.post("/api/assets", json=_asset_body(b, cat, sub), headers=headers)
    assert resp.status_code == 403

    # ...but can in their own company.
    ok = await client.post("/api/assets", json=_asset_body(a, cat, sub), headers=headers)
    assert ok.status_code == 201, ok.text


async def test_admin_can_create_asset_in_any_company(client):
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(b, cat, sub), headers=headers)
    assert resp.status_code == 201, resp.text


async def test_no_active_code_rule_is_422_not_500(client):
    a, b, cat, sub = await _setup(with_rule=False)
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub), headers=headers)
    assert resp.status_code == 422
    assert "code rule" in resp.json()["detail"]


async def test_unresolvable_token_is_422_not_500(client):
    # Rule needs {subcategory.code} but the asset has no subcategory.
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, None), headers=headers)
    assert resp.status_code == 422
    assert "subcategory" in resp.json()["detail"]


async def test_initial_holder_from_other_company_is_422_not_500(client):
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub, initial_holder_id=b["stock"].id), headers=headers)
    assert resp.status_code == 422
    assert "same company" in resp.json()["detail"]


async def test_cost_center_from_other_company_is_rejected(client):
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub, cost_center_id=b["cc"].id), headers=headers)
    assert resp.status_code == 422
    assert "cost center" in resp.json()["detail"]


async def test_future_purchase_date_is_422_not_500(client):
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub, purchase_date="2999-01-01"), headers=headers)
    assert resp.status_code == 422
    assert "future" in resp.json()["detail"]
