from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role, scoped_company_ids
from app.assets.models import Asset
from app.assets.schemas import AssetCreateIn, AssetOut
from app.assets.search_service import search_assets
from app.assets.service import procure_assets
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError
from app.reports.export_service import asset_qr_png

router = APIRouter(prefix="/api/assets", tags=["assets"])


class AssetListOut(BaseModel):
    items: list[AssetOut]
    total: int


class BulkMoveIn(BaseModel):
    asset_ids: list[int]
    to_holder_id: int


class BulkMoveOut(BaseModel):
    moved: int
    failed: list[dict]


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


@router.get("", response_model=AssetListOut)
async def list_assets(
    status: str | None = Query(None),
    category_id: int | None = Query(None),
    holder_id: int | None = Query(None),
    company_id: int | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    """Scoped exactly like `_get_scoped_asset`: a HOLDER only ever sees assets they
    currently hold (so `holder_id` is pinned to their own id, ignoring any value the
    caller passed, and the company filter is left unrestricted since holder_id already
    narrows it); everyone else is scoped to `scoped_company_ids` (None = ADMIN,
    unrestricted)."""
    if holder.role == "HOLDER":
        holder_id = holder.id
        allowed = None
    else:
        allowed = scoped_company_ids(holder)
    items, total = await search_assets(session, allowed, status, category_id, holder_id, company_id, q, limit, offset)
    return AssetListOut(items=items, total=total)


@router.post("/bulk-move", response_model=BulkMoveOut)
async def bulk_move(
    body: BulkMoveIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    moved = 0
    failed = []
    for asset_id in body.asset_ids:
        try:
            asset = await _get_scoped_asset(asset_id, session, actor)
        except HTTPException:
            # Out of scope or already soft-deleted -- same fail-closed-to-404 behaviour
            # as every other asset endpoint (spec: scoping fails closed), reported here as
            # a per-item failure so one out-of-scope id doesn't abort the rest of the batch.
            failed.append({"asset_id": asset_id, "reason": "not found"})
            continue
        try:
            await apply_event(session, asset, "MOVED", to_holder_id=body.to_holder_id, actor=actor)
            moved += 1
        except LifecycleError as exc:
            failed.append({"asset_id": asset_id, "reason": str(exc)})
    await session.commit()
    return BulkMoveOut(moved=moved, failed=failed)


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


@router.get("/{asset_id}/qr.png")
async def asset_qr(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    """Goes through the same `_get_scoped_asset` every other `/api/assets/{id}/...`
    route uses (Task 16), so a HOLDER who doesn't currently hold this asset gets 404
    here exactly like they would from GET /api/assets/{id} -- a QR code is not a
    backdoor around asset scoping."""
    await _get_scoped_asset(asset_id, session, holder)
    return Response(content=asset_qr_png(asset_id), media_type="image/png")
