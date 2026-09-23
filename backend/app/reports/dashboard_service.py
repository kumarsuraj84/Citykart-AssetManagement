from datetime import date, timedelta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.holders.models import Holder
from app.masters.models import Location

# Kept as named constants (spec §7.2/§10.5) so the thresholds are easy to change later.
WARRANTY_ALERT_DAYS = 30
LONG_ALLOCATION_ALERT_DAYS = 180


async def dashboard_data(session: AsyncSession, allowed_company_ids: list[int] | None) -> dict:
    """Scoped exactly like `search_assets`/`_get_scoped_asset`: `allowed_company_ids` is
    `scoped_company_ids(holder)` -- None means unrestricted (ADMIN sees every company's
    data combined), a list means the caller only ever sees rows for their own company/ies.
    Soft-deleted assets (data-entry mistakes, Task 16) are excluded from every figure here,
    same as the asset register."""
    base = select(Asset).where(Asset.deleted_at.is_(None))
    if allowed_company_ids is not None:
        base = base.where(Asset.company_id.in_(allowed_company_ids))

    count_stmt = base.with_only_columns(Asset.status, func.count()).group_by(Asset.status)
    status_counts = {row[0]: row[1] for row in (await session.execute(count_stmt)).all()}

    stock_stmt = (
        base.join(Holder, Asset.current_holder_id == Holder.id)
        .join(Location, Holder.location_id == Location.id)
        .where(Holder.holder_type == "IT_STOCK")
        .with_only_columns(Location.name, func.count())
        .group_by(Location.name)
    )
    stock_by_location = [{"location": row[0], "count": row[1]} for row in (await session.execute(stock_stmt)).all()]

    today = date.today()

    # Warranty expiring soon: strictly upcoming (not already expired) and within the next
    # WARRANTY_ALERT_DAYS days -- i.e. today <= warranty_upto <= today + N, inclusive of
    # today so an item expiring today still shows up as urgent.
    warranty_stmt = base.where(
        Asset.warranty_upto.is_not(None),
        Asset.warranty_upto >= today,
        Asset.warranty_upto <= today + timedelta(days=WARRANTY_ALERT_DAYS),
    )
    warranty_assets = (await session.execute(warranty_stmt)).scalars().all()
    warranty_alerts = [
        {"asset_id": a.id, "asset_code": a.asset_code, "warranty_upto": a.warranty_upto.isoformat()}
        for a in warranty_assets
    ]

    # Allotted too long: ALLOTTED assets whose status hasn't changed in *more than*
    # LONG_ALLOCATION_ALERT_DAYS days (status_since is a plain date, set whenever the
    # asset's status last transitioned -- see app.assets.models.Asset). Strictly "<" the
    # cutoff (not "<="), so an asset allotted for exactly 180 days does not yet alert --
    # only once it goes over.
    long_alloc_cutoff = today - timedelta(days=LONG_ALLOCATION_ALERT_DAYS)
    long_stmt = base.where(Asset.status == "ALLOTTED", Asset.status_since < long_alloc_cutoff)
    long_assets = (await session.execute(long_stmt)).scalars().all()
    long_allocation_alerts = [
        {"asset_id": a.id, "asset_code": a.asset_code, "days_allotted": (today - a.status_since).days}
        for a in long_assets
    ]

    return {
        "status_counts": status_counts,
        "stock_by_location": stock_by_location,
        "warranty_alerts": warranty_alerts,
        "long_allocation_alerts": long_allocation_alerts,
    }
