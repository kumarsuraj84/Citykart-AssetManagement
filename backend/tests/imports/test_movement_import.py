"""POST /api/imports/movements/{preview,commit}: importing a batch of
asset movements from Excel -- one row per asset, each with its own Action
and (when needed) Destination Asset User, run through the exact same
lifecycle engine a manual move uses. Primary-Owner-only, same gate as
asset import."""
import io
from datetime import date
import openpyxl
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.lifecycle.models import AssetEvent
from app.masters.models import AssetCategory, Company, CostCenter, Department, Location
from sqlalchemy import select

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
COLUMNS = ["Serial Number or Asset Code", "Action", "Destination AssetUser Code", "Remarks"]


def _xlsx(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(COLUMNS)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _setup(suffix="MVI"):
    async with SessionLocal() as session:
        co = Company(code=suffix, name=f"{suffix} Co")
        cat = AssetCategory(code="IT", name="IT", asset_domain="IT")
        session.add_all([co, cat])
        await session.flush()
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(company_id=co.id, code=f"{suffix}-HO", name="HO")
        dept = Department(name=f"IT-{suffix}")
        session.add_all([cc, loc, dept])
        await session.flush()
        stock = AssetUser(company_id=co.id, code=f"STK-{suffix}", name="Stock", asset_user_type="STOCK_POINT",
                        location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
        employee = AssetUser(company_id=co.id, code=f"EMP-{suffix}", name="Employee", asset_user_type="EMPLOYEE",
                          location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
        owner = AssetUser(
            company_id=co.id, code=f"OWN-{suffix}", name=f"Owner {suffix}", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="ADMIN", is_primary_owner=True,
            login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        operator = AssetUser(
            company_id=co.id, code=f"OPR-{suffix}", name=f"Operator {suffix}", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="OPERATOR",
            login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add_all([stock, employee, owner, operator])
        await session.flush()

        asset = Asset(
            asset_code=f"FA/{suffix}/IT/LAP/CK_1", company_id=co.id, cost_center_id=cc.id, category_id=cat.id,
            description="Laptop", serial_number=f"SN-{suffix}-1", purchase_date=date(2025, 12, 1),
            status="IN_STOCK", current_asset_user_id=stock.id, status_since=date(2025, 12, 1), asset_domain="IT",
        )
        scrapped = Asset(
            asset_code=f"FA/{suffix}/IT/LAP/CK_2", company_id=co.id, cost_center_id=cc.id, category_id=cat.id,
            description="Scrapped Laptop", serial_number=f"SN-{suffix}-2", purchase_date=date(2025, 12, 1),
            status="SCRAPPED", current_asset_user_id=stock.id, status_since=date(2025, 12, 1), asset_domain="IT",
        )
        session.add_all([asset, scrapped])
        await session.commit()
        return {
            "co_id": co.id, "owner_code": f"OWN-{suffix}", "operator_code": f"OPR-{suffix}",
            "employee_code": f"EMP-{suffix}", "stock_code": f"STK-{suffix}",
            "asset_id": asset.id, "asset_code": asset.asset_code, "serial": asset.serial_number,
            "scrapped_id": scrapped.id, "scrapped_code": scrapped.asset_code,
        }


async def _headers(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _post(client, path, content, headers):
    return await client.post(path, files={"file": ("movements.xlsx", io.BytesIO(content), XLSX)}, headers=headers)


async def test_ordinary_admin_cannot_use_movement_import(client):
    ctx = await _setup("MVI1")
    headers = await _headers(client, ctx["operator_code"])
    resp = await _post(client, "/api/imports/movements/preview", _xlsx([[ctx["serial"], "MOVED", ctx["employee_code"], ""]]), headers)
    assert resp.status_code == 403


async def test_preview_shows_action_and_destination_for_a_valid_row(client):
    ctx = await _setup("MVI2")
    headers = await _headers(client, ctx["owner_code"])
    resp = await _post(client, "/api/imports/movements/preview", _xlsx([[ctx["serial"], "MOVED", ctx["employee_code"], "bulk move"]]), headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["errors"] == []
    assert len(body["valid_rows"]) == 1
    assert body["valid_rows"][0]["asset_code"] == ctx["asset_code"]
    assert body["valid_rows"][0]["action"] == "MOVED"
    assert body["valid_rows"][0]["destination"] == "Employee"


async def test_commit_moves_the_asset_exactly_like_a_manual_move(client):
    ctx = await _setup("MVI3")
    headers = await _headers(client, ctx["owner_code"])
    resp = await _post(client, "/api/imports/movements/commit", _xlsx([[ctx["asset_code"], "MOVED", ctx["employee_code"], "bulk move"]]), headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["moved"] == 1
    assert body["errors"] == []

    async with SessionLocal() as session:
        asset = await session.get(Asset, ctx["asset_id"])
        assert asset.status == "ALLOTTED"
        events = (await session.execute(
            select(AssetEvent).where(AssetEvent.asset_id == ctx["asset_id"])
        )).scalars().all()
        assert len(events) == 1
        assert events[0].event_type == "MOVED"
        assert events[0].remarks == "bulk move"


async def test_missing_destination_for_an_action_that_needs_one_is_a_row_error(client):
    ctx = await _setup("MVI4")
    headers = await _headers(client, ctx["owner_code"])
    resp = await _post(client, "/api/imports/movements/preview", _xlsx([[ctx["serial"], "MOVED", "", ""]]), headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid_rows"] == []
    assert len(body["errors"]) == 1
    assert "Destination AssetUser Code is required" in body["errors"][0]["message"]


async def test_unknown_identifier_is_a_row_error(client):
    ctx = await _setup("MVI5")
    headers = await _headers(client, ctx["owner_code"])
    resp = await _post(client, "/api/imports/movements/preview", _xlsx([["SN-DOES-NOT-EXIST", "MOVED", ctx["employee_code"], ""]]), headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid_rows"] == []
    assert "no asset found" in body["errors"][0]["message"]


async def test_an_ineligible_action_from_the_assets_current_status_is_a_row_error(client):
    ctx = await _setup("MVI6")
    headers = await _headers(client, ctx["owner_code"])
    # SCRAPPED is terminal -- MOVED must never be accepted from it, exactly
    # like the manual bulk-action endpoint already refuses.
    resp = await _post(client, "/api/imports/movements/preview", _xlsx([[ctx["scrapped_code"], "MOVED", ctx["employee_code"], ""]]), headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["valid_rows"] == []
    assert len(body["errors"]) == 1
