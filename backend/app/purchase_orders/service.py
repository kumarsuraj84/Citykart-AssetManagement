from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.service import compute_tax, procure_assets
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, CostCenter
from app.purchase_orders.models import PendingAsset, PurchaseOrder


async def create_purchase_order(session: AsyncSession, data: dict, actor: Holder) -> PurchaseOrder:
    po = PurchaseOrder(
        company_id=data["company_id"], po_number=data["po_number"],
        po_date=data["po_date"], vendor_id=data.get("vendor_id"),
        created_by=actor.id, updated_by=actor.id,
    )
    session.add(po)
    await session.flush()
    return po


async def _validate_line_masters(session: AsyncSession, company_id: int, data: dict) -> None:
    """Same referential checks procure_assets already does for category/
    subcategory/cost-centre -- duplicated narrowly here (not imported)
    because procure_assets validates a *complete* asset-creation payload
    (also requiring purchase_date/initial_holder_id, neither of which
    exist yet at PO-entry time); this is the PO-entry-time subset only."""
    category = await session.get(AssetCategory, data["category_id"])
    if category is None:
        raise ValueError(f"category {data['category_id']} not found")
    subcategory_id = data.get("subcategory_id")
    if subcategory_id is not None:
        subcategory = await session.get(AssetSubcategory, subcategory_id)
        if subcategory is None:
            raise ValueError(f"subcategory {subcategory_id} not found")
        if subcategory.category_id != category.id:
            raise ValueError("sub-category does not belong to the selected category")
    cost_center = await session.get(CostCenter, data["cost_center_id"])
    if cost_center is None:
        raise ValueError(f"cost center {data['cost_center_id']} not found")
    if cost_center.company_id != company_id:
        raise ValueError("cost center must belong to the same company as the purchase order")


async def add_pending_asset_line(
    session: AsyncSession, purchase_order: PurchaseOrder, data: dict, actor: Holder,
) -> list[PendingAsset]:
    """quantity>1 creates that many separate PendingAsset rows (each will get
    its own distinct serial number at Delivery Done) -- mirrors
    procure_assets' own quantity handling, never one row with a count."""
    await _validate_line_masters(session, purchase_order.company_id, data)
    purchase_cost = data.get("purchase_cost")
    tax_percent = data.get("tax_percent")
    tax_amount, total_cost = compute_tax(purchase_cost, tax_percent)

    quantity = data.get("quantity", 1)
    created: list[PendingAsset] = []
    for _ in range(quantity):
        line = PendingAsset(
            purchase_order_id=purchase_order.id, company_id=purchase_order.company_id,
            description=data["description"], category_id=data["category_id"],
            subcategory_id=data.get("subcategory_id"), cost_center_id=data["cost_center_id"],
            purchase_cost=purchase_cost, tax_percent=tax_percent,
            tax_amount=tax_amount, total_cost=total_cost, status="PENDING",
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(line)
        created.append(line)
    await session.flush()
    return created


async def update_pending_asset_line(session: AsyncSession, line: PendingAsset, data: dict, actor: Holder) -> PendingAsset:
    if line.status != "PENDING":
        raise ValueError(f"cannot edit a {line.status.lower()} line")
    await _validate_line_masters(session, line.company_id, data)
    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))
    line.description = data["description"]
    line.category_id = data["category_id"]
    line.subcategory_id = data.get("subcategory_id")
    line.cost_center_id = data["cost_center_id"]
    line.purchase_cost = data.get("purchase_cost")
    line.tax_percent = data.get("tax_percent")
    line.tax_amount = tax_amount
    line.total_cost = total_cost
    line.updated_by = actor.id
    await session.flush()
    return line


async def cancel_pending_asset_line(session: AsyncSession, line: PendingAsset, actor: Holder) -> PendingAsset:
    if line.status != "PENDING":
        raise ValueError(f"cannot cancel a {line.status.lower()} line")
    line.status = "CANCELLED"
    line.updated_by = actor.id
    await session.flush()
    return line


async def deliver_pending_assets(
    session: AsyncSession, lines: list[PendingAsset], deliveries: dict[int, dict],
    po_number: str, po_date, invoice_number: str, invoice_date, invoice_amount: float, actor: Holder,
) -> list[PendingAsset]:
    """One procure_assets(..., quantity=1, ...) call per line -- each
    PendingAsset already represents exactly one physical unit with its own
    serial number, so quantity is always 1 here (never batched), unlike
    Add Asset's own "buying 20 identical mice" quantity case. purchase_date
    is set to invoice_date: the PO design's own point that the two are the
    same thing in this flow, since there is no earlier date to use.
    po_number/po_date come from the parent PurchaseOrder (the caller's job
    to supply) so the resulting Asset's own existing po_number/po_date
    columns (Add Asset already has and uses these) are populated too.

    Each line is delivered inside its own savepoint (nested transaction) --
    one line's failure must not corrupt or partially commit any other
    already-succeeded line in the same batch."""
    delivered: list[PendingAsset] = []
    for line in lines:
        if line.status != "PENDING":
            raise ValueError(f"pending asset {line.id} is not PENDING (already {line.status})")
        delivery = deliveries[line.id]
        async with session.begin_nested():
            [asset] = await procure_assets(
                session,
                {
                    "company_id": line.company_id, "cost_center_id": line.cost_center_id,
                    "category_id": line.category_id, "subcategory_id": line.subcategory_id,
                    "description": line.description, "purchase_cost": line.purchase_cost,
                    "tax_percent": line.tax_percent, "purchase_date": invoice_date,
                    "serial_number": delivery["serial_number"],
                    "initial_holder_id": delivery["initial_holder_id"],
                    "po_number": po_number, "po_date": po_date,
                    "invoice_number": invoice_number, "invoice_date": invoice_date,
                },
                quantity=1, actor=actor,
            )
            line.status = "DELIVERED"
            line.serial_number = delivery["serial_number"]
            line.initial_holder_id = delivery["initial_holder_id"]
            line.invoice_number = invoice_number
            line.invoice_date = invoice_date
            line.invoice_amount = invoice_amount
            line.delivered_asset_id = asset.id
            line.delivered_at = datetime.now(timezone.utc)
            line.delivered_by = actor.id
        delivered.append(line)
    await session.flush()
    return delivered
