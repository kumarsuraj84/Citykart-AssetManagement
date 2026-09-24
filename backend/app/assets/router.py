from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import ensure_company_in_scope, get_current_holder, require_role, scoped_company_ids
from app.assets.custom_field_values import validate_custom_field_values
from app.assets.models import Asset
from app.assets.schemas import AssetCreateIn, AssetOut, AssetUpdateIn
from app.assets.search_service import search_assets
from app.assets.service import compute_tax, procure_assets
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
    # Write-scope check: an IT_TEAM actor can only *read* their own company's data,
    # so they must not be able to create assets in any other company either.
    ensure_company_in_scope(actor, body.company_id)
    data = body.model_dump(exclude={"quantity"})
    try:
        assets = await procure_assets(session, data, quantity=body.quantity, actor=actor)
    except (ValueError, LifecycleError) as exc:
        # e.g. no active code rule, an unresolvable code-rule token, initial holder /
        # cost center from another company, a future purchase date -- all problems
        # with the request, not server faults, so a clean 422 instead of a raw 500.
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
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
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
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


@router.put("/{asset_id}", response_model=AssetOut)
async def update_asset(
    asset_id: int,
    body: AssetUpdateIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    """AM-02: the first general edit surface for an asset's EDITABLE DESCRIPTIVE
    DATA (see the Asset Field Policy Matrix in docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md)
    -- previously there was no way to correct e.g. a mistyped serial number or
    add a PI Number after the fact without going through a lifecycle event,
    which this deliberately is not: no asset_event row is written, no status/
    holder change happens, nothing here touches the ledger. Identity fields
    (asset_code/company_id/cost_center_id) aren't in AssetUpdateIn at all --
    trg_asset_no_identity_change would reject them at the database level even
    if they were."""
    asset = await _get_scoped_asset(asset_id, session, actor)
    data = body.model_dump()
    try:
        await validate_custom_field_values(session, data.get("custom_fields"))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))

    for field in (
        "legacy_asset_code", "brand", "model", "serial_number", "description",
        "vendor_id", "po_number", "po_date", "invoice_number", "invoice_date",
        "pi_number", "pi_date", "purchase_cost", "tax_percent", "warranty_upto",
    ):
        setattr(asset, field, data[field])
    asset.tax_amount = tax_amount
    asset.total_cost = total_cost
    if data.get("custom_fields") is not None:
        asset.custom_fields = data["custom_fields"]
    asset.updated_by = actor.id

    await session.commit()
    await session.refresh(asset)
    return asset


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
