from datetime import date, timedelta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.lifecycle.models import AssetEvent
from app.lifecycle.service import with_labels
from app.masters.models import Location
from app.purchase_orders.models import PendingAsset, PurchaseOrder

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

# Same "glance-able strip, not a second full screen" reasoning as RECENT_ACTIVITY_LIMIT
# -- the full list of open POs is one click away on the Purchase Orders screen itself.
OPEN_PURCHASE_ORDERS_LIMIT = 5


async def dashboard_data(
    session: AsyncSession,
    allowed_company_ids: list[int] | None,
    include_purchase_orders: bool,
    allowed_domains: tuple[str, ...] | None = None,
    domain: str | None = None,
) -> dict:
    """Scoped exactly like `search_assets`/`_get_scoped_asset`: `allowed_company_ids` is
    `scoped_company_ids(asset_user)` -- None means unrestricted (ADMIN sees every company's
    data combined), a list means the caller only ever sees rows for their own company/ies.
    `allowed_domains` (spec §14/§15/§37/§67) is the caller's server-side domain scope from
    `allowed_asset_domains()` -- None means unrestricted, a tuple restricts every figure
    below to those domains; `domain` is the optional "My Responsibility" selector, a
    further narrowing within whatever `allowed_domains` already permits (never a way to
    widen past it). Soft-deleted assets (data-entry mistakes, Task 16) are excluded from
    every figure here, same as the asset register."""
    base = select(Asset).where(Asset.deleted_at.is_(None))
    if allowed_company_ids is not None:
        base = base.where(Asset.company_id.in_(allowed_company_ids))
    if allowed_domains is not None:
        base = base.where(Asset.asset_domain.in_(allowed_domains))
    if domain is not None and (allowed_domains is None or domain in allowed_domains):
        base = base.where(Asset.asset_domain == domain)

    count_stmt = base.with_only_columns(Asset.status, func.count()).group_by(Asset.status)
    status_counts = {row[0]: row[1] for row in (await session.execute(count_stmt)).all()}

    stock_stmt = (
        base.join(AssetUser, Asset.current_asset_user_id == AssetUser.id)
        .join(Location, AssetUser.location_id == Location.id)
        .where(AssetUser.asset_user_type == "STOCK_POINT")
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
    if allowed_domains is not None:
        recent_stmt = recent_stmt.where(Asset.asset_domain.in_(allowed_domains))
    if domain is not None and (allowed_domains is None or domain in allowed_domains):
        recent_stmt = recent_stmt.where(Asset.asset_domain == domain)
    recent_stmt = recent_stmt.order_by(AssetEvent.event_date.desc(), AssetEvent.id.desc()).limit(RECENT_ACTIVITY_LIMIT)
    recent_rows = (await session.execute(recent_stmt)).all()
    recent_events = [row[0] for row in recent_rows]
    asset_codes_by_event_id = {row[0].id: row[1] for row in recent_rows}

    # Reuses the exact same snapshot-correct labeling the asset History tab uses (AM-01
    # point-in-time asset_user-name snapshots) -- never a fresh client-side reconstruction.
    labelled_events = await with_labels(session, recent_events)
    recorded_by_ids = {e.recorded_by for e in recent_events}
    recorder_names: dict[int, str] = {}
    if recorded_by_ids:
        rows = (await session.execute(select(AssetUser.id, AssetUser.name).where(AssetUser.id.in_(recorded_by_ids)))).all()
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

    # Purchase Orders card: pending-asset lines are staging rows, never Assets, so this
    # is a separate query against pending_asset (not the `base` Asset query above) --
    # scoped the same way (company_id in allowed_company_ids, or unrestricted for ADMIN).
    # Gated by include_purchase_orders (caller's role): the Purchase Orders module
    # itself is ADMIN/IT_TEAM only (app.purchase_orders.router), so a VIEWER -- who can
    # reach this dashboard endpoint but never /api/purchase-orders -- must not see this
    # data surfaced here either; they get the same explicit zero/empty shape as "nothing
    # pending", not an omitted key.
    pending_po_summary = {"count": 0, "value": 0.0}
    open_purchase_orders: list[dict] = []
    if include_purchase_orders:
        pending_stmt = select(func.count(), func.coalesce(func.sum(PendingAsset.total_cost), 0)).where(
            PendingAsset.status == "PENDING"
        )
        if allowed_company_ids is not None:
            pending_stmt = pending_stmt.where(PendingAsset.company_id.in_(allowed_company_ids))
        if allowed_domains is not None:
            pending_stmt = pending_stmt.where(PendingAsset.asset_domain.in_(allowed_domains))
        if domain is not None and (allowed_domains is None or domain in allowed_domains):
            pending_stmt = pending_stmt.where(PendingAsset.asset_domain == domain)
        pending_count, pending_value = (await session.execute(pending_stmt)).one()
        pending_po_summary = {"count": pending_count, "value": float(pending_value)}

        open_po_stmt = (
            select(PurchaseOrder.id, PurchaseOrder.po_number, PurchaseOrder.po_date, PurchaseOrder.vendor_id, func.count(PendingAsset.id))
            .join(PendingAsset, PendingAsset.purchase_order_id == PurchaseOrder.id)
            .where(PendingAsset.status == "PENDING", PurchaseOrder.is_active.is_(True))
            .group_by(PurchaseOrder.id)
            .order_by(PurchaseOrder.po_date.desc(), PurchaseOrder.id.desc())
            .limit(OPEN_PURCHASE_ORDERS_LIMIT)
        )
        if allowed_company_ids is not None:
            open_po_stmt = open_po_stmt.where(PurchaseOrder.company_id.in_(allowed_company_ids))
        open_purchase_orders = [
            {
                "id": row[0], "po_number": row[1], "po_date": row[2].isoformat(),
                "vendor_id": row[3], "pending_line_count": row[4],
            }
            for row in (await session.execute(open_po_stmt)).all()
        ]

    return {
        "status_counts": status_counts,
        "stock_by_location": stock_by_location,
        "warranty_alerts": warranty_alerts,
        "long_allocation_alerts": long_allocation_alerts,
        "exception_counts": exception_counts,
        "recent_activity": recent_activity,
        "pending_po_summary": pending_po_summary,
        "open_purchase_orders": open_purchase_orders,
    }
