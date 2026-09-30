"""Deleting a wrongly-created PO (spec: user-directed feature, 2026-09-30):
an ordinary WRITE_ROLES actor (ADMIN/OPERATOR) may delete a PO only while
every line is still PENDING/CANCELLED -- the PO is deactivated and its
PENDING lines cancelled. The moment even one line has been DELIVERED (a
real Asset now exists), only the Primary Owner may delete it, and doing so
also soft-deletes the delivered asset(s) -- but only while each one still
has just its original PROCURED event; if any has since moved, the whole
deletion is refused and the blocking asset(s) are named."""
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.lifecycle.service import apply_event
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import add_pending_asset_line, deliver_pending_assets


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"PO-DEL-{suffix}", name=f"PO Delete Test Co {suffix}")
        cat = AssetCategory(code=f"PO-DEL-{suffix}", name="IT", asset_domain="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code=f"PO-DEL-{suffix}", name="HO")
        dept = Department(name=f"PO-DEL-{suffix}")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = AssetUser(company_id=co.id, code=f"STK-{suffix}", name="IT Stock", asset_user_type="STOCK_POINT",
                        location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
        stock2 = AssetUser(company_id=co.id, code=f"STK2-{suffix}", name="IT Stock 2", asset_user_type="STOCK_POINT",
                         location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
        operator = AssetUser(company_id=co.id, code=f"OPR-{suffix}", name="Operator", asset_user_type="EMPLOYEE",
                          location_id=loc.id, department_id=dept.id, role="OPERATOR",
                          login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        owner = AssetUser(company_id=co.id, code=f"OWN-{suffix}", name="Owner", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN", is_primary_owner=True,
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template="PODEL/{yyyy}/", suffix_template="",
                         start_number=1, pad_width=3)
        session.add_all([stock, stock2, operator, owner, rule])
        await session.commit()

        po = PurchaseOrder(company_id=co.id, po_number=f"PO-DEL-{suffix}", po_date=date(2026, 1, 1),
                            cost_center_id=cc.id, created_by=operator.id, updated_by=operator.id)
        session.add(po)
        await session.commit()

        return {
            "co": co.id, "cc": cc.id, "cat": cat.id, "sub": sub.id, "stock": stock.id, "stock2": stock2.id,
            "operator": operator.id, "operator_code": f"OPR-{suffix}",
            "owner": owner.id, "owner_code": f"OWN-{suffix}", "po": po.id,
        }


async def _headers(client, code):
    resp = await client.post("/api/auth/login", json={"login_id": code, "password": "Passw0rd!"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_operator_deletes_a_po_with_only_pending_lines(client):
    ctx = await _setup("S1")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"])
        operator = await session.get(AssetUser, ctx["operator"])
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"], "subcategory_id": ctx["sub"],
            "barcode": "BC-1", "purchase_cost": 1000, "tax_percent": 18, "quantity": 2,
        }, operator)
        await session.commit()
        line_ids = [l.id for l in lines]

    headers = await _headers(client, ctx["operator_code"])
    resp = await client.delete(f"/api/purchase-orders/{ctx['po']}", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"cancelled_lines": 2, "deleted_assets": 0}

    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"])
        assert po.is_active is False
        for line_id in line_ids:
            line = await session.get(PendingAsset, line_id)
            assert line.status == "CANCELLED"


async def test_operator_cannot_delete_a_po_that_has_a_delivered_line(client):
    ctx = await _setup("S2")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"])
        operator = await session.get(AssetUser, ctx["operator"])
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"], "subcategory_id": ctx["sub"],
            "barcode": "BC-2", "purchase_cost": 1000, "tax_percent": 18, "quantity": 1,
        }, operator)
        await session.commit()
        await deliver_pending_assets(
            session, lines, {lines[0].id: {"serial_number": "SN-DEL-S2", "initial_asset_user_id": ctx["stock"]}},
            po.po_number, po.po_date, None, "INV-S2", date(2026, 2, 1), 1180.0, operator,
        )
        await session.commit()

    headers = await _headers(client, ctx["operator_code"])
    resp = await client.delete(f"/api/purchase-orders/{ctx['po']}", headers=headers)
    assert resp.status_code == 403

    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"])
        assert po.is_active is True


async def test_primary_owner_deletes_a_po_with_a_delivered_line_and_soft_deletes_the_asset(client):
    ctx = await _setup("S3")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"])
        operator = await session.get(AssetUser, ctx["operator"])
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"], "subcategory_id": ctx["sub"],
            "barcode": "BC-3", "purchase_cost": 1000, "tax_percent": 18, "quantity": 1,
        }, operator)
        await session.commit()
        delivered = await deliver_pending_assets(
            session, lines, {lines[0].id: {"serial_number": "SN-DEL-S3", "initial_asset_user_id": ctx["stock"]}},
            po.po_number, po.po_date, None, "INV-S3", date(2026, 2, 1), 1180.0, operator,
        )
        await session.commit()
        asset_id = delivered[0].delivered_asset_id

    headers = await _headers(client, ctx["owner_code"])
    resp = await client.delete(f"/api/purchase-orders/{ctx['po']}", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"cancelled_lines": 0, "deleted_assets": 1}

    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"])
        assert po.is_active is False
        asset = await session.get(Asset, asset_id)
        assert asset.deleted_at is not None
        # The frozen traceability record itself is never touched -- its
        # status stays DELIVERED, only the Asset it points to is gone.
        line = await session.get(PendingAsset, delivered[0].id)
        assert line.status == "DELIVERED"

    # Soft-deleted: no longer reachable through the ordinary Asset 360 GET.
    get_resp = await client.get(f"/api/assets/{asset_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_primary_owner_cannot_delete_a_po_whose_delivered_asset_has_already_moved(client):
    ctx = await _setup("S4")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"])
        operator = await session.get(AssetUser, ctx["operator"])
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"], "subcategory_id": ctx["sub"],
            "barcode": "BC-4", "purchase_cost": 1000, "tax_percent": 18, "quantity": 1,
        }, operator)
        await session.commit()
        delivered = await deliver_pending_assets(
            session, lines, {lines[0].id: {"serial_number": "SN-DEL-S4", "initial_asset_user_id": ctx["stock"]}},
            po.po_number, po.po_date, None, "INV-S4", date(2026, 2, 1), 1180.0, operator,
        )
        await session.commit()
        asset_id = delivered[0].delivered_asset_id

        # Move it once, beyond its original delivery -- exactly the case
        # that must block the whole PO deletion.
        asset = await session.get(Asset, asset_id)
        await apply_event(session, asset, "MOVED", to_asset_user_id=ctx["stock2"], actor=operator)
        await session.commit()

    headers = await _headers(client, ctx["owner_code"])
    resp = await client.delete(f"/api/purchase-orders/{ctx['po']}", headers=headers)
    assert resp.status_code == 409
    assert "moved" in resp.json()["detail"].lower()

    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"])
        assert po.is_active is True
        asset = await session.get(Asset, asset_id)
        assert asset.deleted_at is None


async def test_deleting_an_already_deleted_po_is_404(client):
    ctx = await _setup("S5")
    headers = await _headers(client, ctx["operator_code"])
    first = await client.delete(f"/api/purchase-orders/{ctx['po']}", headers=headers)
    assert first.status_code == 200

    second = await client.delete(f"/api/purchase-orders/{ctx['po']}", headers=headers)
    assert second.status_code == 404
