from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.holders.models import Holder
from app.lifecycle.service import apply_event
from app.masters.models import CostCenter, AssetCategory, AssetSubcategory
from app.numbering.service import generate_code, get_active_rule


async def _get_initial_holder(session: AsyncSession, company_id: int, initial_holder_id: int | None) -> Holder:
    """Resolve the holder newly procured assets land in.

    `initial_holder_id` is required, not defaulted: a company can have multiple IT_STOCK
    holders (one per location, e.g. "IT Stock-HO", "IT Stock-WH-F", "IT Stock-WH-K" per
    the design spec's seed data), so there is no safe way to pick one automatically —
    guessing risks silently misfiling a purchase into the wrong location's stock with no
    error and no warning. The real caller (the Add Asset screen) always has the admin
    explicitly pick a stock location from a dropdown, so this is never actually optional
    in practice.
    """
    if initial_holder_id is None:
        raise ValueError("initial_holder_id is required")
    holder = await session.get(Holder, initial_holder_id)
    if holder is None:
        raise ValueError(f"initial holder {initial_holder_id} not found")
    if holder.company_id != company_id:
        raise ValueError("initial holder must belong to the same company as the asset")
    return holder


async def procure_assets(session: AsyncSession, data: dict, quantity: int, actor: Holder) -> list[Asset]:
    """Behind "Add Asset": creates `quantity` identical assets (the "buying 20 mice" case),
    each with its own generated asset_code and its own PROCURED ledger entry recorded
    through apply_event — the only function allowed to write status/current_holder_id.
    """
    company_id = data["company_id"]
    rule = await get_active_rule(session, company_id)

    cost_center = await session.get(CostCenter, data["cost_center_id"])
    category = await session.get(AssetCategory, data["category_id"])
    subcategory = await session.get(AssetSubcategory, data["subcategory_id"]) if data.get("subcategory_id") else None

    tokens = {
        "cost_center.code": cost_center.code if cost_center else "",
        "category.code": category.code if category else "",
        "subcategory.code": subcategory.code if subcategory else "",
        "company.code": "",
        "location.code": "",
        "yyyy": str(data["purchase_date"].year),
        "yy": str(data["purchase_date"].year)[-2:],
        "mm": f"{data['purchase_date'].month:02d}",
    }

    # Decimal arithmetic throughout (never float) to avoid binary floating-point rounding
    # errors in money math. Decimal(str(x)) rather than Decimal(x) so an incoming float/int
    # is converted via its decimal string representation, not its imprecise binary value.
    purchase_cost = Decimal(str(data.get("purchase_cost") or 0))
    tax_percent = Decimal(str(data.get("tax_percent") or 0))
    tax_amount = (purchase_cost * tax_percent / Decimal(100)).quantize(Decimal("0.01"))
    total_cost = purchase_cost + tax_amount

    holder = await _get_initial_holder(session, company_id, data.get("initial_holder_id"))

    event_date = datetime.combine(data["purchase_date"], datetime.min.time()).replace(tzinfo=timezone.utc)

    created: list[Asset] = []
    for _ in range(quantity):
        code = await generate_code(session, rule, tokens)
        asset = Asset(
            asset_code=code,
            legacy_asset_code=data.get("legacy_asset_code"),
            company_id=company_id,
            cost_center_id=data["cost_center_id"],
            category_id=data["category_id"],
            subcategory_id=data.get("subcategory_id"),
            brand=data.get("brand"),
            model=data.get("model"),
            serial_number=data.get("serial_number"),
            description=data["description"],
            vendor_id=data.get("vendor_id"),
            po_number=data.get("po_number"),
            po_date=data.get("po_date"),
            invoice_number=data.get("invoice_number"),
            invoice_date=data.get("invoice_date"),
            pi_number=data.get("pi_number"),
            pi_date=data.get("pi_date"),
            purchase_cost=purchase_cost,
            tax_percent=tax_percent,
            tax_amount=tax_amount,
            total_cost=total_cost,
            purchase_date=data["purchase_date"],
            warranty_upto=data.get("warranty_upto"),
            # Initial status set directly here, not through apply_event — this is the one
            # documented exception (see apply_event's docstring): a freshly-inserted row
            # needs a non-null status/holder before the state machine has anything to
            # transition from. apply_event is called immediately below to record the
            # PROCURED event and is the sole writer for every transition after this one.
            status="IN_STOCK",
            current_holder_id=holder.id,
            status_since=data["purchase_date"],
            custom_fields=data.get("custom_fields") or {},
            created_by=actor.id,
            updated_by=actor.id,
        )
        session.add(asset)
        await session.flush()

        await apply_event(
            session,
            asset,
            "PROCURED",
            to_holder_id=holder.id,
            actor=actor,
            event_date=event_date,
        )
        created.append(asset)

    await session.flush()
    return created
