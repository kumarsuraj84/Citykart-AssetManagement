import pytest
from datetime import date
from sqlalchemy import select
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.models import Asset
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import add_pending_asset_line, deliver_pending_assets


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"PO-DLV-{suffix}", name=f"PO Delivery Test Co {suffix}")
        cat = AssetCategory(code=f"PO-DLV-{suffix}", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(code=f"PO-DLV-{suffix}", name="HO")
        dept = Department(name=f"PO-DLV-{suffix}")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code=f"STK-{suffix}", name="IT Stock", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        admin = Holder(company_id=co.id, emp_code=f"ADM-{suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template="PODLV/{yyyy}/", suffix_template="",
                         start_number=1, pad_width=3)
        session.add_all([stock, admin, rule])
        await session.commit()

        po = PurchaseOrder(company_id=co.id, po_number="PO-DLV-1", po_date=date(2026, 1, 1),
                            created_by=admin.id, updated_by=admin.id)
        session.add(po)
        await session.commit()

        return {"co": co, "cc": cc, "cat": cat, "sub": sub, "stock": stock, "admin": admin, "po": po}


async def test_deliver_pending_assets_creates_real_assets_with_distinct_serials():
    ctx = await _setup("D1")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "subcategory_id": ctx["sub"].id,
            "cost_center_id": ctx["cc"].id, "purchase_cost": 1000, "tax_percent": 18, "quantity": 3,
        }, admin)
        await session.commit()

        deliveries = {
            lines[0].id: {"serial_number": "SN-001", "initial_holder_id": ctx["stock"].id},
            lines[1].id: {"serial_number": "SN-002", "initial_holder_id": ctx["stock"].id},
            lines[2].id: {"serial_number": "SN-003", "initial_holder_id": ctx["stock"].id},
        }
        delivered = await deliver_pending_assets(
            session, lines, deliveries, po.po_number, po.po_date,
            "INV-001", date(2026, 2, 1), 3540.0, admin,
        )
        await session.commit()

        assert len(delivered) == 3
        serials = set()
        for line in delivered:
            asset = await session.get(Asset, line.delivered_asset_id)
            assert asset is not None
            assert asset.status == "IN_STOCK"
            assert asset.invoice_number == "INV-001"
            assert asset.invoice_date == date(2026, 2, 1)
            assert asset.po_number == "PO-DLV-1"
            assert asset.po_date == date(2026, 1, 1)
            assert asset.purchase_date == date(2026, 2, 1)
            serials.add(asset.serial_number)
        assert serials == {"SN-001", "SN-002", "SN-003"}


async def test_deliver_pending_assets_updates_line_status_and_traceability():
    ctx = await _setup("D2")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "cost_center_id": ctx["cc"].id, "quantity": 1,
        }, admin)
        await session.commit()

        [delivered] = await deliver_pending_assets(
            session, [line], {line.id: {"serial_number": "SN-X", "initial_holder_id": ctx["stock"].id}},
            po.po_number, po.po_date, "INV-002", date(2026, 2, 1), 1000.0, admin,
        )
        await session.commit()

        assert delivered.status == "DELIVERED"
        assert delivered.delivered_asset_id is not None
        asset = await session.get(Asset, delivered.delivered_asset_id)
        assert asset.serial_number == "SN-X"


async def test_deliver_partial_selection_leaves_others_pending():
    ctx = await _setup("D3")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "cost_center_id": ctx["cc"].id, "quantity": 5,
        }, admin)
        await session.commit()

        to_deliver = lines[:3]
        deliveries = {l.id: {"serial_number": f"SN-{l.id}", "initial_holder_id": ctx["stock"].id} for l in to_deliver}
        await deliver_pending_assets(
            session, to_deliver, deliveries, po.po_number, po.po_date,
            "INV-003", date(2026, 2, 1), 3000.0, admin,
        )
        await session.commit()

        remaining_stmt_lines = (await session.execute(
            select(PendingAsset).where(PendingAsset.purchase_order_id == po.id)
        )).scalars().all()
        statuses = {l.status for l in remaining_stmt_lines if l.id not in {x.id for x in to_deliver}}
        assert statuses == {"PENDING"}
        delivered_count = sum(1 for l in remaining_stmt_lines if l.status == "DELIVERED")
        assert delivered_count == 3


async def test_deliver_rejects_an_already_delivered_line():
    ctx = await _setup("D4")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "cost_center_id": ctx["cc"].id, "quantity": 1,
        }, admin)
        await session.commit()

        await deliver_pending_assets(
            session, [line], {line.id: {"serial_number": "SN-1", "initial_holder_id": ctx["stock"].id}},
            po.po_number, po.po_date, "INV-004", date(2026, 2, 1), 1000.0, admin,
        )
        await session.commit()

        with pytest.raises(ValueError, match="not PENDING"):
            await deliver_pending_assets(
                session, [line], {line.id: {"serial_number": "SN-1-AGAIN", "initial_holder_id": ctx["stock"].id}},
                po.po_number, po.po_date, "INV-005", date(2026, 2, 2), 1000.0, admin,
            )


async def test_deliver_generates_sequential_distinct_asset_codes():
    ctx = await _setup("D5")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "cost_center_id": ctx["cc"].id, "quantity": 4,
        }, admin)
        await session.commit()
        deliveries = {l.id: {"serial_number": f"SN-{l.id}", "initial_holder_id": ctx["stock"].id} for l in lines}
        delivered = await deliver_pending_assets(
            session, lines, deliveries, po.po_number, po.po_date,
            "INV-006", date(2026, 2, 1), 4000.0, admin,
        )
        await session.commit()

        codes = set()
        for line in delivered:
            asset = await session.get(Asset, line.delivered_asset_id)
            codes.add(asset.asset_code)
        assert len(codes) == 4
