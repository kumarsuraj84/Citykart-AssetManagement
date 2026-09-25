import pytest
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import (
    add_pending_asset_line, cancel_pending_asset_line, create_purchase_order, update_pending_asset_line,
)


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"PO-SVC-{suffix}", name=f"PO Service Test Co {suffix}")
        co2 = Company(code=f"PO-SVC2-{suffix}", name=f"PO Service Other Co {suffix}")
        cat = AssetCategory(code=f"PO-SVC-{suffix}", name="IT")
        session.add_all([co, co2, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        cc_other = CostCenter(company_id=co2.id, code="HO", name="Head Office")
        loc = Location(code=f"PO-SVC-{suffix}", name="HO")
        dept = Department(name=f"PO-SVC-{suffix}")
        session.add_all([sub, cc, cc_other, loc, dept])
        await session.flush()
        admin = Holder(company_id=co.id, emp_code=f"ADM-{suffix}", name="Admin", holder_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add(admin)
        await session.commit()

        po = PurchaseOrder(company_id=co.id, po_number="PO-1", po_date=date(2026, 1, 1),
                            created_by=admin.id, updated_by=admin.id)
        session.add(po)
        await session.commit()

        return {"co": co, "cc": cc, "cc_other": cc_other, "cat": cat, "sub": sub, "admin": admin, "po": po}


async def test_add_pending_asset_line_with_quantity_creates_that_many_rows():
    ctx = await _setup("Q1")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "subcategory_id": ctx["sub"].id,
            "cost_center_id": ctx["cc"].id, "purchase_cost": 1000, "tax_percent": 18, "quantity": 3,
        }, admin)
        await session.commit()

        assert len(lines) == 3
        for line in lines:
            assert line.status == "PENDING"
            assert line.tax_amount == 180
            assert line.total_cost == 1180


async def test_add_pending_asset_line_rejects_cost_centre_from_another_company():
    ctx = await _setup("Q2")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        with pytest.raises(ValueError, match="same company"):
            await add_pending_asset_line(session, po, {
                "description": "Laptop", "category_id": ctx["cat"].id,
                "cost_center_id": ctx["cc_other"].id, "quantity": 1,
            }, admin)


async def test_update_pending_asset_line_recomputes_tax():
    ctx = await _setup("Q3")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "cost_center_id": ctx["cc"].id, "purchase_cost": 1000, "tax_percent": 18, "quantity": 1,
        }, admin)
        await session.commit()

        updated = await update_pending_asset_line(session, line, {
            "description": "Laptop Pro", "category_id": ctx["cat"].id,
            "cost_center_id": ctx["cc"].id, "purchase_cost": 2000, "tax_percent": 10,
        }, admin)
        await session.commit()

        assert updated.description == "Laptop Pro"
        assert updated.tax_amount == 200
        assert updated.total_cost == 2200


async def test_update_pending_asset_line_rejects_a_non_pending_line():
    ctx = await _setup("Q4")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "cost_center_id": ctx["cc"].id, "quantity": 1,
        }, admin)
        await cancel_pending_asset_line(session, line, admin)
        await session.commit()

        with pytest.raises(ValueError, match="cancelled"):
            await update_pending_asset_line(session, line, {
                "description": "New", "category_id": ctx["cat"].id, "cost_center_id": ctx["cc"].id,
            }, admin)


async def test_cancel_pending_asset_line_sets_cancelled_and_is_terminal():
    ctx = await _setup("Q5")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(Holder, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "cost_center_id": ctx["cc"].id, "quantity": 1,
        }, admin)
        await session.commit()

        cancelled = await cancel_pending_asset_line(session, line, admin)
        await session.commit()
        assert cancelled.status == "CANCELLED"

        with pytest.raises(ValueError, match="cancelled"):
            await cancel_pending_asset_line(session, line, admin)
