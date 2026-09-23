import io
from datetime import date
import openpyxl
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


def _build_workbook(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["legacy_asset_code", "company_code", "cost_center_code", "category_code", "subcategory_code",
               "description", "purchase_date", "holder_emp_code"])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_preview_and_commit_import(client):
    async with SessionLocal() as session:
        co = Company(code="CKS-IMP1", name="Import Test Co")
        cat = AssetCategory(code="IT-IMP1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-IMP1", name="HO")
        dept = Department(name="IT-IMP1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-IMP1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-IMP1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-IMP1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    xlsx = _build_workbook([
        ["OLD-001", "CKS-IMP1", "HO01", "IT-IMP1", "LAP", "Legacy Laptop 1", "2020-01-15", "ITSTOCK-IMP1"],
        ["OLD-002", "CKS-IMP1", "HO01", "IT-IMP1", "BADSUB", "Legacy Laptop 2", "2020-01-15", "ITSTOCK-IMP1"],
    ])
    preview_resp = await client.post("/api/imports/assets/preview",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert preview_resp.status_code == 200
    body = preview_resp.json()
    assert len(body["valid_rows"]) == 1
    assert len(body["errors"]) == 1
    assert body["errors"][0]["row"] == 3  # header is row 1, first data row is row 2

    commit_resp = await client.post("/api/imports/assets/commit",
        files={"file": ("assets.xlsx", io.BytesIO(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers)
    assert commit_resp.status_code == 200
    assert commit_resp.json()["imported"] == 1
    assert commit_resp.json()["errors"][0]["row"] == 3
