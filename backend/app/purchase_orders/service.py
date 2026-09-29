from datetime import date, datetime, timezone
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset, AssetFieldChange
from app.assets.service import compute_tax, procure_assets
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, CostCenter
from app.purchase_orders.models import PendingAsset, PurchaseOrder


async def compute_pi_status(session: AsyncSession, po_ids: list[int]) -> dict[int, dict]:
    """AM-19: one batched query for however many POs are being listed (never
    N+1 -- same discipline app.assets.router._page_label_maps already
    established). For each po_id: "NOT_DELIVERED" (nothing delivered yet),
    "PENDING" (>=1 delivered asset still has no PI Number), or "RECORDED"
    (every delivered asset has one) -- see PurchaseOrderOut's own docstring
    for why pi_number/pi_date are only ever populated when every delivered
    asset under that PO shares the exact same value."""
    if not po_ids:
        return {}
    stmt = (
        select(PendingAsset.purchase_order_id, Asset.pi_number, Asset.pi_date)
        .join(Asset, Asset.id == PendingAsset.delivered_asset_id)
        .where(PendingAsset.purchase_order_id.in_(po_ids), PendingAsset.delivered_asset_id.is_not(None))
    )
    rows = (await session.execute(stmt)).all()

    by_po: dict[int, list[tuple[str | None, date | None]]] = {}
    for po_id, pi_number, pi_date in rows:
        by_po.setdefault(po_id, []).append((pi_number, pi_date))

    result: dict[int, dict] = {}
    for po_id in po_ids:
        delivered = by_po.get(po_id, [])
        if not delivered:
            result[po_id] = {"pi_status": "NOT_DELIVERED", "pi_number": None, "pi_date": None}
            continue
        if any(pi_number is None or not pi_number.strip() for pi_number, _ in delivered):
            result[po_id] = {"pi_status": "PENDING", "pi_number": None, "pi_date": None}
            continue
        distinct = set(delivered)
        if len(distinct) == 1:
            pi_number, pi_date = next(iter(distinct))
            result[po_id] = {"pi_status": "RECORDED", "pi_number": pi_number, "pi_date": pi_date}
        else:
            result[po_id] = {"pi_status": "RECORDED", "pi_number": None, "pi_date": None}
    return result


async def create_purchase_order(session: AsyncSession, data: dict, actor: Holder) -> PurchaseOrder:
    cost_center = await session.get(CostCenter, data["cost_center_id"])
    if cost_center is None:
        raise ValueError(f"cost center {data['cost_center_id']} not found")
    if cost_center.company_id != data["company_id"]:
        raise ValueError("cost center must belong to the same company as the purchase order")
    po = PurchaseOrder(
        company_id=data["company_id"], po_number=data["po_number"],
        po_date=data["po_date"], vendor_id=data.get("vendor_id"),
        cost_center_id=data["cost_center_id"],
        created_by=actor.id, updated_by=actor.id,
    )
    session.add(po)
    await session.flush()
    return po


async def _validate_line_masters(session: AsyncSession, data: dict) -> None:
    """Same referential checks procure_assets already does for category/
    subcategory -- duplicated narrowly here (not imported) because
    procure_assets validates a *complete* asset-creation payload (also
    requiring purchase_date/initial_holder_id/cost_center_id, none of which
    are picked at line-entry time -- cost centre lives on the parent PO,
    see create_purchase_order); this is the PO-entry-time subset only."""
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


async def add_pending_asset_line(
    session: AsyncSession, purchase_order: PurchaseOrder, data: dict, actor: Holder,
) -> list[PendingAsset]:
    """quantity>1 creates that many separate PendingAsset rows (each will get
    its own distinct serial number at Delivery Done) -- mirrors
    procure_assets' own quantity handling, never one row with a count."""
    if purchase_order.cost_center_id is None:
        raise ValueError("purchase order has no cost centre set")
    await _validate_line_masters(session, data)
    purchase_cost = data.get("purchase_cost")
    tax_percent = data.get("tax_percent")
    tax_amount, total_cost = compute_tax(purchase_cost, tax_percent)

    quantity = data.get("quantity", 1)
    created: list[PendingAsset] = []
    for _ in range(quantity):
        line = PendingAsset(
            purchase_order_id=purchase_order.id, company_id=purchase_order.company_id,
            description=data["description"], barcode=data.get("barcode"), category_id=data["category_id"],
            subcategory_id=data.get("subcategory_id"), cost_center_id=purchase_order.cost_center_id,
            brand_id=data.get("brand_id"), model=data.get("model"), warranty_years=data.get("warranty_years"),
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
    await _validate_line_masters(session, data)
    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))
    line.description = data["description"]
    line.barcode = data.get("barcode")
    line.category_id = data["category_id"]
    line.subcategory_id = data.get("subcategory_id")
    line.brand_id = data.get("brand_id")
    line.model = data.get("model")
    line.warranty_years = data.get("warranty_years")
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
    po_number: str, po_date, vendor_id: int | None, invoice_number: str, invoice_date, invoice_amount: float,
    actor: Holder,
) -> list[PendingAsset]:
    """One procure_assets(..., quantity=1, ...) call per line -- each
    PendingAsset already represents exactly one physical unit with its own
    serial number, so quantity is always 1 here (never batched), unlike
    Add Asset's own "buying 20 identical mice" quantity case. purchase_date
    is set to invoice_date: the PO design's own point that the two are the
    same thing in this flow, since there is no earlier date to use.
    po_number/po_date/vendor_id come from the parent PurchaseOrder (the
    caller's job to supply) so the resulting Asset's own existing
    po_number/po_date/vendor_id columns (Add Asset already has and uses
    these) are populated too -- AM-17 §DEF-01: vendor_id was previously
    omitted here, so every PO-delivered asset silently got vendor_id=NULL
    even though the PO itself has a vendor.

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
                    "description": line.description, "barcode": line.barcode, "purchase_cost": line.purchase_cost,
                    "tax_percent": line.tax_percent, "purchase_date": invoice_date,
                    "brand_id": line.brand_id, "model": line.model, "warranty_years": line.warranty_years,
                    "serial_number": delivery["serial_number"],
                    "initial_holder_id": delivery["initial_holder_id"],
                    "po_number": po_number, "po_date": po_date, "vendor_id": vendor_id,
                    "invoice_number": invoice_number, "invoice_date": invoice_date,
                    "invoice_amount": invoice_amount,
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


async def record_pi_for_invoice(
    session: AsyncSession, purchase_order: PurchaseOrder, invoice_number: str,
    pi_number: str, pi_date: date, overwrite: bool, actor: Holder,
) -> dict:
    """AM-19: PI Number/Date arrive from Finance well after delivery, and
    ground reality is one PO can be delivered across several invoices (a
    vendor's partial delivery), each getting its OWN PI later -- so this is
    keyed by (purchase_order, invoice_number), never the whole PO, and
    never a single flag on the PO itself. Applies to every Asset that was
    delivered under this exact PO+invoice combination (via the frozen
    pending_asset traceability rows, never a po_number/invoice_number
    string match, which could theoretically collide across POs).

    `overwrite=False` (the default, and the safer everyday choice): only
    fills in assets whose pi_number is still blank, leaving anything
    already entered untouched. `overwrite=True` is the deliberate,
    explicit escape hatch for fixing a typo across every asset from this
    invoice at once, instead of opening each one individually.

    Writes an ordinary (reason=NULL) AssetFieldChange row per field
    actually changed per asset, all sharing one request_id -- same
    audit-trail shape app.assets.audit_service.record_field_changes
    already uses for a single-asset edit, just applied across many assets
    in one call."""
    stmt = select(PendingAsset).where(
        PendingAsset.purchase_order_id == purchase_order.id,
        PendingAsset.invoice_number == invoice_number,
        PendingAsset.delivered_asset_id.is_not(None),
    )
    lines = (await session.execute(stmt)).scalars().all()

    request_id = str(uuid4())
    updated: list[str] = []
    skipped: list[str] = []
    for line in lines:
        asset = await session.get(Asset, line.delivered_asset_id)
        if asset is None:
            continue
        already_set = bool((asset.pi_number or "").strip())
        if already_set and not overwrite:
            skipped.append(asset.asset_code)
            continue

        changes = [
            ("pi_number", asset.pi_number, pi_number),
            ("pi_date", asset.pi_date, pi_date),
        ]
        for field_name, old, new in changes:
            if old == new:
                continue
            session.add(AssetFieldChange(
                asset_id=asset.id, field_name=field_name,
                old_value=str(old) if old is not None else None,
                new_value=str(new) if new is not None else None,
                actor_id=actor.id, request_id=request_id,
            ))
        asset.pi_number = pi_number
        asset.pi_date = pi_date
        asset.updated_by = actor.id
        updated.append(asset.asset_code)

    await session.flush()
    return {"invoice_number": invoice_number, "updated": updated, "skipped": skipped}
