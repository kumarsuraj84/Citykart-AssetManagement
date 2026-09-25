from datetime import date, timedelta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.holders.models import Holder
from app.lifecycle.models import AssetEvent
from app.lifecycle.service import with_labels
from app.masters.models import Location

# Kept as named constants (spec §7.2/§10.5) so the thresholds are easy to change later.
WARRANTY_ALERT_DAYS = 30
LONG_ALLOCATION_ALERT_DAYS = 180

# AM-12 G03: the "exception" states an operator needs to see at a glance without
# hunting through the Asset Register one status at a time. Deliberately excludes
# IN_STOCK/ALLOTTED/INSTALLED (the normal, healthy states already visible via the
# existing per-status KPI cards) -- these five are the ones that usually mean
# "something needs attention or is permanently closed out." Fixed, recognized
# ASSET_STATUSES values only (backend/app/assets/models.py) -- no new status.
EXCEPTION_STATUSES = ["UNDER_REPAIR", "LOST", "DISPOSED", "SOLD", "SCRAPPED"]

# Recommended by the AM-12 authorization: small enough to stay a glance-able
# "what just happened" strip, not a second Movement Log.
RECENT_ACTIVITY_LIMIT = 5


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

    # AM-12 G03: reuses status_counts (already grouped, already scoped) rather than a
    # second query -- a status with zero assets is simply absent from that dict (a
    # GROUP BY only returns rows that exist), so default every exception status to 0
    # explicitly. This is what lets the frontend show "Repair: 0" instead of silently
    # omitting the whole metric when nothing is in that state.
    exception_counts = {s: status_counts.get(s, 0) for s in EXCEPTION_STATUSES}

    # Scoped exactly like the base asset query above (allowed_company_ids), joined to
    # Asset since AssetEvent itself has no company_id column. Ordered newest-first,
    # limited server-side -- never fetch-then-slice client-side (spec §16 perf note).
    # AM-01's own ix_asset_event_event_date index already covers this ordering; no new
    # index needed (confirmed by EXPLAIN-equivalent reasoning: same column, same
    # direction the index was built for).
    recent_stmt = (
        select(AssetEvent, Asset.asset_code)
        .join(Asset, AssetEvent.asset_id == Asset.id)
        .where(Asset.deleted_at.is_(None))
    )
    if allowed_company_ids is not None:
        recent_stmt = recent_stmt.where(Asset.company_id.in_(allowed_company_ids))
    recent_stmt = recent_stmt.order_by(AssetEvent.event_date.desc(), AssetEvent.id.desc()).limit(RECENT_ACTIVITY_LIMIT)
    recent_rows = (await session.execute(recent_stmt)).all()
    recent_events = [row[0] for row in recent_rows]
    asset_codes_by_event_id = {row[0].id: row[1] for row in recent_rows}

    # Reuses the exact same snapshot-correct labeling the asset History tab uses (AM-01
    # point-in-time holder-name snapshots) -- never a fresh client-side reconstruction.
    labelled_events = await with_labels(session, recent_events)
    recorded_by_ids = {e.recorded_by for e in recent_events}
    recorder_names: dict[int, str] = {}
    if recorded_by_ids:
        rows = (await session.execute(select(Holder.id, Holder.name).where(Holder.id.in_(recorded_by_ids)))).all()
        recorder_names = {row[0]: row[1] for row in rows}
    recent_activity = [
        {
            "id": e.id,
            "asset_id": e.asset_id,
            "asset_code": asset_codes_by_event_id[e.id],
            "event_type": e.event_type,
            "event_date": e.event_date.isoformat(),
            "label": e.label,
            "recorded_by_name": recorder_names.get(e.recorded_by),
        }
        for e in labelled_events
    ]

    return {
        "status_counts": status_counts,
        "stock_by_location": stock_by_location,
        "warranty_alerts": warranty_alerts,
        "long_allocation_alerts": long_allocation_alerts,
        "exception_counts": exception_counts,
        "recent_activity": recent_activity,
    }
