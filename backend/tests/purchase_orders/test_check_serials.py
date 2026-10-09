"""POST /api/purchase-orders/check-serials: the Mark Delivery dialog asks, while
the user is still typing, which serials already exist anywhere in CKAM."""
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import add_pending_asset_line, deliver_pending_assets


async def _setup_with_delivered_serial(serial: str):
    async with SessionLocal() as session:
        co = Company(code="SERCHK", name="Serial Check Co")
        cat = AssetCategory(code="SERCHK", name="IT", asset_domain="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code="SERCHK", name="HO")
        dept = Department(name="SERCHK")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = AssetUser(company_id=co.id, code="STK-SC", name="IT Stock", asset_user_type="STOCK_POINT",
                          location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
        operator = AssetUser(company_id=co.id, code="OPR-SC", name="Operator", asset_user_type="EMPLOYEE",
                             location_id=loc.id, department_id=dept.id, role="OPERATOR",
                             login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        viewer = AssetUser(company_id=co.id, code="VWR-SC", name="Viewer", asset_user_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="VIEWER",
                           login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template="SC/{yyyy}/", suffix_template="", start_number=1, pad_width=3)
        session.add_all([stock, operator, viewer, rule])
        await session.commit()
        po = PurchaseOrder(company_id=co.id, po_number="PO-SC-1", po_date=date(2026, 1, 1),
                           cost_center_id=cc.id, created_by=operator.id, updated_by=operator.id)
        session.add(po)
        await session.commit()
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": cat.id, "subcategory_id": sub.id,
            "barcode": "BC-SC", "purchase_cost": 1000, "tax_percent": 18, "quantity": 1,
        }, operator)
        await session.commit()
        delivered = await deliver_pending_assets(
            session, lines, {lines[0].id: {"serial_number": serial, "initial_asset_user_id": stock.id}},
            po.po_number, po.po_date, None, "INV-SC", date(2026, 2, 1), 1180.0, operator,
        )
        await session.commit()
        return delivered[0].delivered_asset_id


async def _headers(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_reports_only_serials_already_used_ignoring_case_spaces_blank_and_na(client):
    await _setup_with_delivered_serial("SN-EXIST-1")
    headers = await _headers(client, "OPR-SC")
    resp = await client.post("/api/purchase-orders/check-serials", headers=headers, json={
        "serials": ["  sn-exist-1 ", "SN-FREE", "N/A", "n/a", "", "sn-exist-1"],
    })
    assert resp.status_code == 200
    conflicts = resp.json()["conflicts"]
    assert [c["serial"] for c in conflicts] == ["sn-exist-1"]
    assert conflicts[0]["asset_code"].startswith("SC/")


async def test_no_conflicts_for_an_empty_or_all_free_list(client):
    await _setup_with_delivered_serial("SN-EXIST-2")
    headers = await _headers(client, "OPR-SC")
    assert (await client.post("/api/purchase-orders/check-serials", headers=headers, json={"serials": []})).json() == {"conflicts": []}
    free = await client.post("/api/purchase-orders/check-serials", headers=headers, json={"serials": ["A", "B"]})
    assert free.json() == {"conflicts": []}


async def test_a_soft_deleted_asset_does_not_hold_its_serial(client):
    from app.assets.models import Asset
    from datetime import datetime, timezone
    asset_id = await _setup_with_delivered_serial("SN-EXIST-3")
    async with SessionLocal() as session:
        (await session.get(Asset, asset_id)).deleted_at = datetime.now(timezone.utc)
        await session.commit()
    headers = await _headers(client, "OPR-SC")
    resp = await client.post("/api/purchase-orders/check-serials", headers=headers, json={"serials": ["SN-EXIST-3"]})
    assert resp.json() == {"conflicts": []}


async def test_roles_that_cannot_deliver_are_refused(client):
    await _setup_with_delivered_serial("SN-EXIST-4")
    headers = await _headers(client, "VWR-SC")
    resp = await client.post("/api/purchase-orders/check-serials", headers=headers, json={"serials": ["SN-EXIST-4"]})
    assert resp.status_code == 403
