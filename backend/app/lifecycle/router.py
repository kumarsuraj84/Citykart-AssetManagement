from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import require_role
from app.assets.router import _get_scoped_asset
from app.core.deps import get_current_holder
from app.lifecycle.models import AssetEvent
from app.lifecycle.schemas import ApplyEventIn, AssetEventOut
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError

router = APIRouter(prefix="/api/assets", tags=["lifecycle"])


@router.get("/{asset_id}/events", response_model=list[AssetEventOut])
async def list_events(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    asset = await _get_scoped_asset(asset_id, session, holder)
    stmt = select(AssetEvent).where(AssetEvent.asset_id == asset.id).order_by(AssetEvent.event_date, AssetEvent.id)
    return (await session.execute(stmt)).scalars().all()


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
    return event
