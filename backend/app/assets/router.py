from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role, scoped_company_ids
from app.assets.models import Asset
from app.assets.schemas import AssetCreateIn, AssetOut
from app.assets.service import procure_assets

router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.post("", response_model=list[AssetOut], status_code=201)
async def create_asset(
    body: AssetCreateIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    data = body.model_dump(exclude={"quantity"})
    assets = await procure_assets(session, data, quantity=body.quantity, actor=actor)
    await session.commit()
    for a in assets:
        await session.refresh(a)
    return assets


async def _get_scoped_asset(asset_id: int, session: AsyncSession, holder) -> Asset:
    asset = await session.get(Asset, asset_id)
    if asset is None or asset.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    if holder.role == "HOLDER":
        if asset.current_holder_id != holder.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        return asset

    allowed_companies = scoped_company_ids(holder)
    if allowed_companies is not None and asset.company_id not in allowed_companies:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return asset


@router.get("/{asset_id}", response_model=AssetOut)
async def get_asset(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    return await _get_scoped_asset(asset_id, session, holder)


@router.delete("/{asset_id}", status_code=204)
async def delete_asset_entry_mistake(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN")),
):
    """Soft-deletes an asset created by data-entry mistake. Only allowed while the asset
    still has just its original PROCURED/IMPORTED event — once it has moved, been repaired
    or been disposed, that history is real and must stay visible; use the DISPOSED/SCRAPPED/
    LOST lifecycle events instead (spec §7 "nothing is hard-deleted")."""
    from app.lifecycle.models import AssetEvent

    asset = await session.get(Asset, asset_id)
    if asset is None or asset.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    event_count = (await session.execute(
        select(func.count()).select_from(AssetEvent).where(AssetEvent.asset_id == asset_id)
    )).scalar_one()
    if event_count > 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "This asset already has movement history; it cannot be deleted, only disposed/scrapped/lost")

    asset.deleted_at = datetime.now(timezone.utc)
    asset.updated_by = actor.id
    await session.commit()
