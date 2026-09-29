"""POST /api/imports/assets/commit (and preview): real code-rule token values,
per-company rule lookup, clean errors instead of 500s, and IT_TEAM company scope."""
import io

import openpyxl

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
from app.numbering.models import CodeRule
from sqlalchemy import func, select

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx(rows):
    """AM-23: no "Purchase Date" column (derived from Invoice Date, else
    today); Vendor Code/Serial Number are now mandatory columns too."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Legacy Asset Code", "Company Code", "Cost Centre Code", "Category Code", "Subcategory Code",
               "Description", "Invoice Date", "Initial AssetUser Code", "Vendor Code", "Serial Number"])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _company(session, code):
    co = Company(code=code, name=f"{code} Co")
    session.add(co)
    await session.flush()
    loc = Location(company_id=co.id, code=f"{code}-LOC", name=f"{code} HO")
    dept = Department(name=f"IT-{code}")
    session.add_all([loc, dept, CostCenter(company_id=co.id, code="HO01", name="HO")])
    await session.flush()
    session.add(AssetUser(company_id=co.id, emp_code=f"STOCK-{code}", name=f"IT Stock {code}", asset_user_type="IT_STOCK",
                       location_id=loc.id, department_id=dept.id, role="ASSET_USER"))
    await session.flush()
    return co, loc, dept


async def _setup(rules):
    async with SessionLocal() as session:
        co_a, loc_a, dept_a = await _company(session, "IMA")
        co_b, _, _ = await _company(session, "IMB")
        cat = AssetCategory(code="IT", name="IT")
        # Vendor is a global master (not company-scoped), so one code
        # serves every row/company in this file.
        session.add_all([cat, Vendor(code="VND", name="Test Vendor")])
        await session.flush()
        session.add(AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop"))
        for emp_code, role in (("ADM", "ADMIN"), ("ITA", "IT_TEAM")):
            session.add(AssetUser(company_id=co_a.id, emp_code=emp_code, name=emp_code, asset_user_type="EMPLOYEE",
                               location_id=loc_a.id, department_id=dept_a.id, role=role,
                               password_hash=hash_password("Passw0rd!"), must_change_password=False))
        ids = {"A": co_a.id, "B": co_b.id, None: None}
        for scope, prefix in rules:
            session.add(CodeRule(company_id=ids[scope], prefix_template=prefix, suffix_template="",
                                 start_number=1, pad_width=0))
        await session.commit()
    return co_a.id, co_b.id


async def _headers(client, company_id, emp_code):
    resp = await client.post("/api/auth/login", json={"company_id": company_id, "login_id": emp_code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _row(company="IMA", legacy="OLD-1"):
    return [legacy, company, "HO01", "IT", "LAP", "Legacy Laptop", "2020-01-15", f"STOCK-{company}", "VND", "N/A"]


async def _post(client, path, content, headers):
    return await client.post(path, files={"file": ("a.xlsx", io.BytesIO(content), XLSX)}, headers=headers)


async def _asset_codes():
    async with SessionLocal() as session:
        return sorted((await session.execute(select(Asset.asset_code))).scalars().all())


async def test_import_fills_company_location_and_date_tokens(client):
    a_id, _ = await _setup([(None, "{company.code}/{location.code}/{yyyy}/{yy}{mm}/")])
    headers = await _headers(client, a_id, "ADM")

    resp = await _post(client, "/api/imports/assets/commit", _xlsx([_row()]), headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"imported": 1, "updated": None, "errors": []}
    # location.code comes from the row's resolved asset_user's location.
    assert await _asset_codes() == ["IMA/IMA-LOC/2020/2001/1"]


async def test_import_uses_each_rows_own_company_rule(client):
    """Previously the rule for the FIRST valid row's company was applied to every
    row, so a multi-company file coded company B's assets with company A's rule."""
    a_id, _ = await _setup([("A", "A-RULE/"), ("B", "B-RULE/")])
    headers = await _headers(client, a_id, "ADM")

    resp = await _post(client, "/api/imports/assets/commit", _xlsx([_row("IMA", "O1"), _row("IMB", "O2")]), headers)
    assert resp.json()["imported"] == 2
    assert await _asset_codes() == ["A-RULE/1", "B-RULE/1"]


async def test_import_with_no_active_rule_reports_row_errors_not_500(client):
    a_id, _ = await _setup([])
    headers = await _headers(client, a_id, "ADM")

    resp = await _post(client, "/api/imports/assets/commit", _xlsx([_row()]), headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported"] == 0
    assert body["errors"][0]["row"] == 2
    assert "code rule" in body["errors"][0]["message"]


async def test_import_with_unknown_token_reports_row_errors_not_500(client):
    a_id, _ = await _setup([(None, "FA/{not_a_token}/")])
    headers = await _headers(client, a_id, "ADM")

    resp = await _post(client, "/api/imports/assets/commit", _xlsx([_row()]), headers)
    assert resp.status_code == 200
    assert resp.json()["imported"] == 0
    assert "unknown token" in resp.json()["errors"][0]["message"]
    assert await _asset_codes() == []


async def test_it_team_cannot_import_into_another_company(client):
    a_id, _ = await _setup([(None, "FA/")])
    headers = await _headers(client, a_id, "ITA")

    content = _xlsx([_row("IMA", "O1"), _row("IMB", "O2")])
    resp = await _post(client, "/api/imports/assets/commit", content, headers)
    assert resp.status_code == 403
    # Whole file refused -- not even the in-scope row was written.
    assert await _asset_codes() == []

    # Preview flags the out-of-scope row instead of calling it valid.
    preview = await _post(client, "/api/imports/assets/preview", content, headers)
    body = preview.json()
    assert [r["row"] for r in body["valid_rows"]] == [2]
    assert body["errors"][0]["row"] == 3
    assert "scope" in body["errors"][0]["message"]


async def test_it_team_can_import_into_own_company(client):
    a_id, _ = await _setup([(None, "FA/")])
    headers = await _headers(client, a_id, "ITA")
    resp = await _post(client, "/api/imports/assets/commit", _xlsx([_row("IMA")]), headers)
    assert resp.status_code == 200
    assert resp.json()["imported"] == 1
    async with SessionLocal() as session:
        assert (await session.execute(select(func.count()).select_from(Asset))).scalar_one() == 1


async def test_import_rejects_a_cost_center_code_that_belongs_to_another_company(client):
    """AM-01 company/cost-centre integrity review: cost_center_service._lookup scopes
    the code lookup to the row's own resolved company (company_id=company.id), so a
    cost_center_code that only exists under a *different* company must be reported as
    an unknown code for this row -- never silently resolved to that other company's
    cost center. (procure_assets already has its own equivalent guard and test,
    test_cost_center_from_other_company_is_rejected; this covers the import path,
    which resolves cost centers by code rather than by id and had no matching test.)"""
    a_id, b_id = await _setup([(None, "FA/")])
    async with SessionLocal() as session:
        session.add(CostCenter(company_id=b_id, code="B-ONLY", name="B Only Cost Center"))
        await session.commit()
    headers = await _headers(client, a_id, "ADM")

    content = _xlsx([[
        "OLD-XCO", "IMA", "B-ONLY", "IT", "LAP", "Cross-company Laptop", "2020-01-15", "STOCK-IMA", "VND", "N/A",
    ]])
    resp = await _post(client, "/api/imports/assets/commit", content, headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported"] == 0
    assert "unknown Cost Centre Code" in body["errors"][0]["message"]
    assert await _asset_codes() == []
