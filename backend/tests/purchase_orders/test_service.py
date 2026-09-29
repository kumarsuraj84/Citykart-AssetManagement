import pytest
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Department, Location
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import (
    add_pending_asset_line, cancel_pending_asset_line, create_purchase_order, update_pending_asset_line,
)


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"PO-SVC-{suffix}", name=f"PO Service Test Co {suffix}")
        co2 = Company(code=f"PO-SVC2-{suffix}", name=f"PO Service Other Co {suffix}")
        cat = AssetCategory(code=f"PO-SVC-{suffix}", name="IT", asset_domain="IT")
        session.add_all([co, co2, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        cc_other = CostCenter(company_id=co2.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code=f"PO-SVC-{suffix}", name="HO")
        dept = Department(name=f"PO-SVC-{suffix}")
        session.add_all([sub, cc, cc_other, loc, dept])
        await session.flush()
        admin = AssetUser(company_id=co.id, code=f"ADM-{suffix}", name="Admin", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        session.add(admin)
        await session.commit()

        po = PurchaseOrder(company_id=co.id, po_number="PO-1", po_date=date(2026, 1, 1),
                            cost_center_id=cc.id, created_by=admin.id, updated_by=admin.id)
        session.add(po)
        await session.commit()

        return {"co": co, "cc": cc, "cc_other": cc_other, "cat": cat, "sub": sub, "admin": admin, "po": po}


async def test_add_pending_asset_line_with_quantity_creates_that_many_rows():
    ctx = await _setup("Q1")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "subcategory_id": ctx["sub"].id,
            "purchase_cost": 1000, "tax_percent": 18, "quantity": 3,
        }, admin)
        await session.commit()

        assert len(lines) == 3
        for line in lines:
            assert line.status == "PENDING"
            assert line.cost_center_id == ctx["cc"].id
            assert line.tax_amount == 180
            assert line.total_cost == 1180


async def test_barcode_is_shared_across_every_unit_a_quantity_line_creates():
    """Unlike Serial Number (per-unit, filled at Delivery Done), Barcode is
    entered once per line and is explicitly allowed to repeat across
    assets (docs/ai/DECISIONS.md) -- so every row a Quantity>1 line creates
    must carry the identical barcode value entered on that one line."""
    ctx = await _setup("Q1B")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        lines = await add_pending_asset_line(session, po, {
            "description": "Speaker", "category_id": ctx["cat"].id, "barcode": "BC-SPEAKER-BATCH", "quantity": 5,
        }, admin)
        await session.commit()

        assert len(lines) == 5
        assert all(line.barcode == "BC-SPEAKER-BATCH" for line in lines)


async def test_add_pending_asset_line_without_barcode_leaves_it_null():
    ctx = await _setup("Q1C")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "quantity": 1,
        }, admin)
        assert line.barcode is None


async def test_brand_model_warranty_years_are_shared_across_every_unit_a_quantity_line_creates():
    """AM-18: same per-line, shared-across-units convention as Barcode."""
    ctx = await _setup("Q1D")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        brand = Brand(code="Q1D-DELL", name="Dell")
        session.add(brand)
        await session.flush()
        lines = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "brand_id": brand.id, "model": "Latitude 5440", "warranty_years": 3, "quantity": 3,
        }, admin)
        await session.commit()

        assert len(lines) == 3
        assert all(line.brand_id == brand.id and line.model == "Latitude 5440" and line.warranty_years == 3 for line in lines)


async def test_add_pending_asset_line_defaults_warranty_years_to_zero():
    ctx = await _setup("Q1E")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "warranty_years": 0, "quantity": 1,
        }, admin)
        assert line.brand_id is None
        assert line.model is None
        assert line.warranty_years == 0


async def test_update_pending_asset_line_can_change_brand_model_warranty_years():
    ctx = await _setup("Q1F")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        brand = Brand(code="Q1F-HP", name="HP")
        session.add(brand)
        await session.flush()
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "warranty_years": 1, "quantity": 1,
        }, admin)
        await session.commit()

        updated = await update_pending_asset_line(session, line, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "brand_id": brand.id, "model": "EliteBook", "warranty_years": 5,
        }, admin)
        assert updated.brand_id == brand.id
        assert updated.model == "EliteBook"
        assert updated.warranty_years == 5


async def test_create_purchase_order_rejects_cost_centre_from_another_company():
    ctx = await _setup("Q2")
    async with SessionLocal() as session:
        admin = await session.get(AssetUser, ctx["admin"].id)
        with pytest.raises(ValueError, match="same company"):
            await create_purchase_order(session, {
                "company_id": ctx["co"].id, "po_number": "PO-2", "po_date": date(2026, 1, 1),
                "cost_center_id": ctx["cc_other"].id,
            }, admin)


async def test_add_pending_asset_line_rejects_a_po_with_no_cost_centre():
    ctx = await _setup("Q2B")
    async with SessionLocal() as session:
        admin = await session.get(AssetUser, ctx["admin"].id)
        po = PurchaseOrder(company_id=ctx["co"].id, po_number="PO-NOCC", po_date=date(2026, 1, 1),
                            created_by=admin.id, updated_by=admin.id)
        session.add(po)
        await session.commit()

        with pytest.raises(ValueError, match="cost centre"):
            await add_pending_asset_line(session, po, {
                "description": "Laptop", "category_id": ctx["cat"].id, "quantity": 1,
            }, admin)


async def test_update_pending_asset_line_recomputes_tax():
    ctx = await _setup("Q3")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id,
            "purchase_cost": 1000, "tax_percent": 18, "quantity": 1,
        }, admin)
        await session.commit()

        updated = await update_pending_asset_line(session, line, {
            "description": "Laptop Pro", "category_id": ctx["cat"].id, "barcode": "BC-FIXED",
            "purchase_cost": 2000, "tax_percent": 10,
        }, admin)
        await session.commit()

        assert updated.description == "Laptop Pro"
        assert updated.barcode == "BC-FIXED"
        assert updated.tax_amount == 200
        assert updated.total_cost == 2200


async def test_update_pending_asset_line_rejects_a_non_pending_line():
    ctx = await _setup("Q4")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "quantity": 1,
        }, admin)
        await cancel_pending_asset_line(session, line, admin)
        await session.commit()

        with pytest.raises(ValueError, match="cancelled"):
            await update_pending_asset_line(session, line, {
                "description": "New", "category_id": ctx["cat"].id,
            }, admin)


async def test_cancel_pending_asset_line_sets_cancelled_and_is_terminal():
    ctx = await _setup("Q5")
    async with SessionLocal() as session:
        po = await session.get(PurchaseOrder, ctx["po"].id)
        admin = await session.get(AssetUser, ctx["admin"].id)
        [line] = await add_pending_asset_line(session, po, {
            "description": "Laptop", "category_id": ctx["cat"].id, "quantity": 1,
        }, admin)
        await session.commit()

        cancelled = await cancel_pending_asset_line(session, line, admin)
        await session.commit()
        assert cancelled.status == "CANCELLED"

        with pytest.raises(ValueError, match="cancelled"):
            await cancel_pending_asset_line(session, line, admin)
