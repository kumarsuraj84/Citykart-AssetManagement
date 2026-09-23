from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.holders.models import Holder
from app.lifecycle.models import AssetEvent
from app.lifecycle.state_machine import LifecycleError, transition


async def apply_event(
    session: AsyncSession,
    asset: Asset,
    event_type: str,
    to_holder_id: int | None,
    actor: Holder,
    event_date: datetime | None = None,
    remarks: str | None = None,
    reference_no: str | None = None,
) -> AssetEvent:
    """The only function allowed to write asset.status/current_holder_id/status_since and
    insert into asset_event (see backend/app/lifecycle/service.py module docstring in the
    task brief / spec §5). Every lifecycle transition — including the initial PROCURED/
    IMPORTED event created by app.assets.service.procure_assets — must go through here so
    the ledger (asset_event) and the asset's denormalized current-state columns never
    drift apart.
    """
    event_date = event_date or datetime.now(timezone.utc)
    now = datetime.now(timezone.utc)
    if event_date > now:
        raise LifecycleError("event date cannot be in the future")

    last_event_stmt = (
        select(AssetEvent)
        .where(AssetEvent.asset_id == asset.id)
        .order_by(AssetEvent.event_date.desc(), AssetEvent.id.desc())
    )
    last_event = (await session.execute(last_event_stmt)).scalars().first()
    if last_event and event_date < last_event.event_date:
        raise LifecycleError("event date cannot be before the asset's last recorded event")

    to_holder_type = None
    if to_holder_id is not None:
        to_holder = await session.get(Holder, to_holder_id)
        if to_holder is None:
            raise LifecycleError("target holder not found")
        if to_holder.company_id != asset.company_id:
            raise LifecycleError("assets can only move within their own company")
        to_holder_type = to_holder.holder_type

    new_status = transition(asset.status, event_type, to_holder_type, actor.role)

    event = AssetEvent(
        asset_id=asset.id,
        event_type=event_type,
        event_date=event_date,
        from_holder_id=asset.current_holder_id,
        to_holder_id=to_holder_id,
        status_after=new_status,
        remarks=remarks,
        reference_no=reference_no,
        recorded_by=actor.id,
        recorded_at=now,
    )
    session.add(event)

    asset.status = new_status
    if to_holder_id is not None:
        asset.current_holder_id = to_holder_id
    # asset.status_since is a Date column (the custody/status change is dated, not
    # timestamped) while event_date is a timezone-aware datetime; store just the date
    # part so the assigned value's type actually matches the column.
    asset.status_since = event_date.date()

    await session.flush()
    return event
