from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import WRITE_ROLES, require_role
from app.assets.router import _get_scoped_asset
from app.core.deps import get_current_asset_user
from app.lifecycle.models import AssetEvent
from app.lifecycle.schemas import ApplyEventIn, AssetEventOut
from app.lifecycle.service import apply_event, with_labels
from app.lifecycle.state_machine import LifecycleError
from app.observability.events import lifecycle_summary

router = APIRouter(prefix="/api/assets", tags=["lifecycle"])


@router.get("/{asset_id}/events", response_model=list[AssetEventOut])
async def list_events(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    asset = await _get_scoped_asset(asset_id, session, asset_user)
    stmt = select(AssetEvent).where(AssetEvent.asset_id == asset.id).order_by(AssetEvent.event_date, AssetEvent.id)
    events = (await session.execute(stmt)).scalars().all()
    return await with_labels(session, list(events))


@router.post("/{asset_id}/events", response_model=AssetEventOut, status_code=201)
async def create_event(
    asset_id: int,
    body: ApplyEventIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    asset = await _get_scoped_asset(asset_id, session, actor)
    try:
        event = await apply_event(
            session, asset, body.event_type, to_asset_user_id=body.to_asset_user_id, actor=actor,
            event_date=body.event_date, remarks=body.remarks, reference_no=body.reference_no,
        )
    except LifecycleError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    # S8: the LIFECYCLE audit row (asset_event stays the ledger of the movement itself).
    await lifecycle_summary(session, "MOVE" if body.event_type == "MOVED" else body.event_type, body.event_type,
                            [asset.id], [], body.to_asset_user_id, body.reference_no, company_id=asset.company_id,
                            asset_code=asset.asset_code)
    await session.commit()
    await session.refresh(event)
    [labelled] = await with_labels(session, [event])
    return labelled
