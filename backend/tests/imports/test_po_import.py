"""POST /api/imports/purchase-orders/{preview,commit}: importing a PO and
its line items from Excel -- one row per line, PO header fields repeated
on every row, grouped by PO Number into one PurchaseOrder with that many
PENDING PendingAsset lines. Primary-Owner-only, same gate as asset import."""
import io
import openpyxl
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from sqlalchemy import select

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
COLUMNS = [
    "Company Code", "PO Number", "PO Date", "Vendor Code", "Cost Centre Code",
    "Description", "Barcode", "Category Code", "Subcategory Code",
    "Brand Code", "Model", "Warranty Years", "Purchase Cost", "Tax %", "Quantity",
]


def _xlsx(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(COLUMNS)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _row(po_number="PO-IMP-1", company="POI", description="Laptop", quantity=1, **overrides):
    row = {
        "Company Code": company, "PO Number": po_number, "PO Date": "2026-02-01",
        "Vendor Code": f"VND-{company}", "Cost Centre Code": "HO01",
        "Description": description, "Barcode": "BC-IMP-1", "Category Code": "IT",
        "Subcategory Code": "LAP", "Brand Code": None, "Model": None,
        "Warranty Years": None, "Purchase Cost": 1000, "Tax %": 18, "Quantity": quantity,
    }
    row.update(overrides)
    return [row[c] for c in COLUMNS]


async def _setup(suffix="POI"):
    async with SessionLocal() as session:
        co = Company(code=suffix, name=f"{suffix} Co")
        cat = AssetCategory(code="IT", name="IT", asset_domain="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(company_id=co.id, code=f"{suffix}-HO", name="HO")
        dept = Department(name=f"IT-{suffix}")
        vendor = Vendor(code=f"VND-{suffix}", name="Test Vendor")
        session.add_all([sub, cc, loc, dept, vendor])
        await session.flush()
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
        session.add_all([owner, operator])
        await session.commit()
        return {"co_id": co.id, "owner_code": f"OWN-{suffix}", "operator_code": f"OPR-{suffix}"}


async def _headers(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _post(client, path, content, headers):
    return await client.post(path, files={"file": ("po.xlsx", io.BytesIO(content), XLSX)}, headers=headers)


async def test_ordinary_admin_cannot_use_po_import(client):
    ctx = await _setup("POI1")
    headers = await _headers(client, ctx["operator_code"])
    resp = await _post(client, "/api/imports/purchase-orders/preview", _xlsx([_row(company="POI1")]), headers)
    assert resp.status_code == 403


async def test_preview_groups_rows_by_po_number(client):
    ctx = await _setup("POI2")
    headers = await _headers(client, ctx["owner_code"])
    rows = [
        _row(po_number="PO-A", company="POI2", description="Laptop A"),
        _row(po_number="PO-A", company="POI2", description="Laptop B"),
    ]
    resp = await _post(client, "/api/imports/purchase-orders/preview", _xlsx(rows), headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["valid_rows"]) == 2
    assert body["errors"] == []
    assert {r["description"] for r in body["valid_rows"]} == {"Laptop A", "Laptop B"}
    assert all(r["po_number"] == "PO-A" for r in body["valid_rows"])


async def test_commit_creates_one_po_with_its_lines(client):
    ctx = await _setup("POI3")
    headers = await _headers(client, ctx["owner_code"])
    rows = [
        _row(po_number="PO-B", company="POI3", description="Laptop A", quantity=1),
        _row(po_number="PO-B", company="POI3", description="Laptop B", quantity=2),
    ]
    resp = await _post(client, "/api/imports/purchase-orders/commit", _xlsx(rows), headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pos_created"] == 1
    assert body["lines_created"] == 3  # 1 + quantity 2
    assert body["errors"] == []

    async with SessionLocal() as session:
        po = (await session.execute(
            select(PurchaseOrder).where(PurchaseOrder.company_id == ctx["co_id"], PurchaseOrder.po_number == "PO-B")
        )).scalars().first()
        assert po is not None
        lines = (await session.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po.id))).scalars().all()
        assert len(lines) == 3
        assert all(l.status == "PENDING" for l in lines)


async def test_importing_a_po_number_that_already_exists_is_rejected(client):
    ctx = await _setup("POI4")
    headers = await _headers(client, ctx["owner_code"])
    first = await _post(client, "/api/imports/purchase-orders/commit", _xlsx([_row(po_number="PO-DUP", company="POI4")]), headers)
    assert first.status_code == 200
    assert first.json()["pos_created"] == 1

    second = await _post(client, "/api/imports/purchase-orders/commit", _xlsx([_row(po_number="PO-DUP", company="POI4")]), headers)
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["pos_created"] == 0
    assert len(body["errors"]) == 1
    assert "already exists" in body["errors"][0]["message"]


async def test_rows_sharing_a_po_number_must_agree_on_header_fields(client):
    ctx = await _setup("POI5")
    headers = await _headers(client, ctx["owner_code"])
    rows = [
        _row(po_number="PO-C", company="POI5", **{"PO Date": "2026-02-01"}),
        _row(po_number="PO-C", company="POI5", **{"PO Date": "2026-03-01"}),
    ]
    resp = await _post(client, "/api/imports/purchase-orders/preview", _xlsx(rows), headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["valid_rows"]) == 1
    assert len(body["errors"]) == 1
    assert "disagree" in body["errors"][0]["message"]
