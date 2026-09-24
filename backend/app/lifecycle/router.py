from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import require_role
from app.assets.router import _get_scoped_asset
from app.core.deps import get_current_holder
from app.holders.models import Holder
from app.lifecycle.models import AssetEvent
from app.lifecycle.schemas import ApplyEventIn, AssetEventOut
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError, label_for_event

router = APIRouter(prefix="/api/assets", tags=["lifecycle"])

UNKNOWN_HOLDER_NAME = "unknown holder"


async def _with_labels(session: AsyncSession, events: list[AssetEvent]) -> list[AssetEventOut]:
    """Attaches the human-readable custody label (spec §5: "Allotted to {name}",
    "Returned to {name}", "Transferred from {a} to {b}", ...) to each event.
    label_for_event picks the wording from the from/to holders' *types*; the names
    are then substituted in here, so the timeline reads like a custody story instead
    of raw event_type/status codes. One query loads every referenced holder."""
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


@router.get("/{asset_id}/events", response_model=list[AssetEventOut])
async def list_events(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    asset = await _get_scoped_asset(asset_id, session, holder)
    stmt = select(AssetEvent).where(AssetEvent.asset_id == asset.id).order_by(AssetEvent.event_date, AssetEvent.id)
    events = (await session.execute(stmt)).scalars().all()
    return await _with_labels(session, list(events))


@router.post("/{asset_id}/events", response_model=AssetEventOut, status_code=201)
async def create_event(
    asset_id: int,
    body: ApplyEventIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    asset = await _get_scoped_asset(asset_id, session, actor)
    try:
        event = await apply_event(
            session, asset, body.event_type, to_holder_id=body.to_holder_id, actor=actor,
            event_date=body.event_date, remarks=body.remarks, reference_no=body.reference_no,
        )
    except LifecycleError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    await session.refresh(event)
    [labelled] = await _with_labels(session, [event])
    return labelled
