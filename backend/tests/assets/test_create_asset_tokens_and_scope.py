"""POST /api/assets: every code-rule token resolves to a real value, service-layer
errors come back as clean 422s (never raw 500s), and a non-ADMIN actor can only
create assets inside their own company scope (403 otherwise)."""
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
from app.numbering.models import CodeRule


async def _company(session, code):
    co = Company(code=code, name=f"{code} Co")
    session.add(co)
    await session.flush()
    loc = Location(company_id=co.id, code=f"{code}-LOC", name=f"{code} HO")
    dept = Department(name=f"IT-{code}")
    cc = CostCenter(company_id=co.id, code="HO01", name="HO")
    session.add_all([loc, dept, cc])
    await session.flush()
    stock = AssetUser(company_id=co.id, emp_code=f"STOCK-{code}", name=f"IT Stock {code}", asset_user_type="IT_STOCK",
                   location_id=loc.id, department_id=dept.id, role="ASSET_USER")
    vendor = Vendor(code=f"VND-{code}", name=f"{code} Vendor")
    session.add_all([stock, vendor])
    await session.flush()
    return {"co": co, "loc": loc, "dept": dept, "cc": cc, "stock": stock, "vendor": vendor}


async def _setup(prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_", with_rule=True):
    async with SessionLocal() as session:
        a = await _company(session, "CKA")
        b = await _company(session, "CKB")
        cat = AssetCategory(code="IT", name="IT")
        session.add(cat)
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        admin = AssetUser(company_id=a["co"].id, emp_code="ADM", name="Admin", asset_user_type="EMPLOYEE",
                       location_id=a["loc"].id, department_id=a["dept"].id, role="ADMIN",
                       password_hash=hash_password("Passw0rd!"), must_change_password=False)
        it_a = AssetUser(company_id=a["co"].id, emp_code="ITA", name="IT Team A", asset_user_type="EMPLOYEE",
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
        "subcategory_id": sub.id if sub else None, "description": "Laptop",
        # Purchase Date is derived from Invoice Date now (see AssetCreateIn's
        # docstring) -- this is what actually flows into the code-rule's
        # yyyy/yy/mm date tokens and status_since below.
        "invoice_date": "2025-12-10",
        "initial_asset_user_id": target["stock"].id, "quantity": 1,
        "vendor_id": target["vendor"].id, "po_number": "PO-1", "po_date": "2025-12-01",
        "invoice_number": "INV-1", "pi_number": "PI-1", "pi_date": "2025-12-05",
        "serial_number": "SN-TOK",
    }
    body.update(overrides)
    return body


async def test_company_location_and_date_tokens_resolve_to_real_values(client):
    a, b, cat, sub = await _setup("{company.code}/{location.code}/{yyyy}/{yy}{mm}/")
    headers = await _headers(client, a["co"].id, "ADM")

    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub), headers=headers)
    assert resp.status_code == 201, resp.text
    # company.code from the asset's company; location.code from the initial
    # asset_user's location; yyyy/yy/mm from the purchase date (2025-12-10).
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
    # Rule needs {subcategory.code}, but subcategory_id is required now (no
    # None) -- so exercise the "unresolvable" path via a subcategory_id that
    # doesn't reference any real row (app/assets/service.py's
    # `session.get(AssetSubcategory, ...)` simply returns None for it, same
    # as the old "no subcategory" case: the token resolves to "").
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub, subcategory_id=999999), headers=headers)
    assert resp.status_code == 422
    assert "subcategory" in resp.json()["detail"]


async def test_initial_asset_user_from_other_company_is_422_not_500(client):
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub, initial_asset_user_id=b["stock"].id), headers=headers)
    assert resp.status_code == 422
    assert "same company" in resp.json()["detail"]


async def test_cost_center_from_other_company_is_rejected(client):
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub, cost_center_id=b["cc"].id), headers=headers)
    assert resp.status_code == 422
    assert "cost center" in resp.json()["detail"]


async def test_future_purchase_date_is_422_not_500(client):
    """Purchase Date no longer exists as an input field -- it's always
    invoice_date (see AssetCreateIn's docstring). The "future purchase date
    must 422, not 500" business rule now applies to invoice_date, since
    that's the only date that ever becomes purchase_date."""
    a, b, cat, sub = await _setup()
    headers = await _headers(client, a["co"].id, "ADM")
    resp = await client.post("/api/assets", json=_asset_body(a, cat, sub, invoice_date="2999-01-01"), headers=headers)
    assert resp.status_code == 422
    assert "future" in resp.json()["detail"]
