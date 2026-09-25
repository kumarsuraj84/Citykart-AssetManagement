from datetime import date
from app.core.db import SessionLocal
from app.masters.models import Company, AssetCategory, CostCenter
from app.purchase_orders.models import PurchaseOrder, PendingAsset


async def test_purchase_order_and_pending_asset_round_trip():
    async with SessionLocal() as session:
        co = Company(code="PO-MODEL-1", name="PO Model Test Co")
        cat = AssetCategory(code="PO-MODEL-1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        session.add(cc)
        await session.flush()

        po = PurchaseOrder(company_id=co.id, po_number="PO-TEST-1", po_date=date(2026, 1, 1))
        session.add(po)
        await session.flush()

        line = PendingAsset(
            purchase_order_id=po.id, company_id=co.id, description="Test Laptop",
            category_id=cat.id, cost_center_id=cc.id, status="PENDING",
        )
        session.add(line)
        await session.commit()

        assert line.id is not None
        assert line.status == "PENDING"
        assert line.delivered_asset_id is None
        assert po.is_active is True
