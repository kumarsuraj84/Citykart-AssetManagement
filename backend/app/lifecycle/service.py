from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset
from app.holders.models import Holder
from app.lifecycle.models import AssetEvent
from app.lifecycle.schemas import AssetEventOut
from app.lifecycle.state_machine import LifecycleError, label_for_event, transition

UNKNOWN_HOLDER_NAME = "unknown holder"


async def with_labels(session: AsyncSession, events: list[AssetEvent]) -> list[AssetEventOut]:
    """Attaches the human-readable custody label (spec §5: "Allotted to {name}",
    "Returned to {name}", "Transferred from {a} to {b}", ...) to each event.
    label_for_event picks the wording from the from/to holders' *types*; the names
    are then substituted in here, so the timeline reads like a custody story instead
    of raw event_type/status codes. One query loads every referenced holder.

    AM-12: moved here from app.lifecycle.router (its original, single caller) so
    the Dashboard's Recent Activity feed (app.reports.dashboard_service) can reuse
    the exact same snapshot-correct labeling instead of duplicating it."""
    holder_ids = {hid for e in events for hid in (e.from_holder_id, e.to_holder_id) if hid is not None}
    holders: dict[int, Holder] = {}
    if holder_ids:
        rows = (await session.execute(select(Holder).where(Holder.id.in_(holder_ids)))).scalars().all()
        holders = {h.id: h for h in rows}

    out: list[AssetEventOut] = []
    for e in events:
        from_h = holders.get(e.from_holder_id) if e.from_holder_id is not None else None
        to_h = holders.get(e.to_holder_id) if e.to_holder_id is not None else None
        # Prefer the point-in-time snapshot taken when the event was recorded (AM-01) so a
        # later holder rename doesn't retroactively rewrite this label; only rows written
        # before the snapshot column existed fall back to today's live holder name.
        from_name = e.from_holder_name_snapshot or (from_h.name if from_h else None) or UNKNOWN_HOLDER_NAME
        to_name = e.to_holder_name_snapshot or (to_h.name if to_h else None) or UNKNOWN_HOLDER_NAME
        try:
            template = label_for_event(
                e.event_type, from_h.holder_type if from_h else None, to_h.holder_type if to_h else None,
            )
            label = template.format(**{"from": from_name, "to": to_name})
        except LifecycleError:
            label = e.event_type.replace("_", " ").capitalize()
        out.append(AssetEventOut.model_validate(e).model_copy(update={"label": label}))
    return out


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
    # AM-09: a caller-supplied event_date with no offset (Pydantic parses a
    # bare "2025-06-01" or "2025-06-01T00:00:00" into a naive datetime,
    # confirmed directly) used to crash the `event_date > now` comparison
    # below with an unhandled TypeError -- a raw 500 for input that isn't
    # actually malformed, just missing a timezone. The real frontend always
    # sends `.toISOString()` (always UTC, always offset-aware), so this only
    # affected a direct API caller, but "no offset" is a legitimate ISO-8601
    # datetime, not adversarial input, and deserves a controlled response
    # (or, here, just correct handling) rather than a crash. A naive value is
    # treated as UTC, matching the frontend's own convention.
    if event_date.tzinfo is None:
        event_date = event_date.replace(tzinfo=timezone.utc)
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
    to_holder = None
    if to_holder_id is not None:
        to_holder = await session.get(Holder, to_holder_id)
        if to_holder is None:
            raise LifecycleError("target holder not found")
        if to_holder.company_id != asset.company_id:
            raise LifecycleError("assets can only move within their own company")
        to_holder_type = to_holder.holder_type

    # Loaded purely for the display-snapshot below (see AssetEvent.from_holder_name_snapshot's
    # docstring) -- asset.current_holder_id itself is already known and is what gets written
    # as from_holder_id; this fetch only resolves its *name at this point in time*.
    from_holder = (
        await session.get(Holder, asset.current_holder_id)
        if asset.current_holder_id is not None else None
    )

    new_status = transition(asset.status, event_type, to_holder_type, actor.role)

    event = AssetEvent(
        asset_id=asset.id,
        event_type=event_type,
        event_date=event_date,
        from_holder_id=asset.current_holder_id,
        to_holder_id=to_holder_id,
        from_holder_name_snapshot=from_holder.name if from_holder else None,
        to_holder_name_snapshot=to_holder.name if to_holder else None,
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
