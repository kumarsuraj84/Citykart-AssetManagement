from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import ensure_company_in_scope, get_current_holder, require_role, scoped_company_ids
from app.assets.audit_service import AUDITED_SCALAR_FIELDS, record_field_changes
from app.assets.custom_field_values import validate_custom_field_values
from app.assets.models import Asset, AssetFieldChange
from app.assets.schemas import AssetCreateIn, AssetDetailOut, AssetFieldChangeOut, AssetOut, AssetUpdateIn
from app.assets.search_service import search_assets
from app.assets.service import compute_tax, procure_assets
from app.holders.models import Holder
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError
from app.masters.models import AssetCategory, AssetSubcategory, CostCenter, Department, Location, Vendor
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


async def _to_detail_out(session: AsyncSession, asset: Asset) -> AssetDetailOut:
    """AM-04 §25: Asset 360 needs human-readable labels, not bare IDs. A
    handful of point lookups by primary key (never more than 6 per call,
    never per-list-row) -- additive, scoped to this one endpoint, not a new
    generic enrichment layer."""
    category = await session.get(AssetCategory, asset.category_id)
    subcategory = await session.get(AssetSubcategory, asset.subcategory_id) if asset.subcategory_id else None
    cost_center = await session.get(CostCenter, asset.cost_center_id)
    vendor = await session.get(Vendor, asset.vendor_id) if asset.vendor_id else None
    current_holder = await session.get(Holder, asset.current_holder_id)
    location = await session.get(Location, current_holder.location_id) if current_holder else None
    department = (
        await session.get(Department, current_holder.department_id)
        if current_holder and current_holder.department_id else None
    )
    return AssetDetailOut(
        **AssetOut.model_validate(asset).model_dump(),
        category_name=category.name if category else None,
        subcategory_name=subcategory.name if subcategory else None,
        cost_center_name=cost_center.name if cost_center else None,
        vendor_name=vendor.name if vendor else None,
        current_holder_name=current_holder.name if current_holder else None,
        current_holder_type=current_holder.holder_type if current_holder else None,
        location_name=location.name if location else None,
        department_name=department.name if department else None,
    )


@router.get("/{asset_id}", response_model=AssetDetailOut)
async def get_asset(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    asset = await _get_scoped_asset(asset_id, session, holder)
    return await _to_detail_out(session, asset)


@router.get("/{asset_id}/changes", response_model=list[AssetFieldChangeOut])
async def list_asset_changes(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    """AM-04 §23: read surface for the field-change audit -- scoped exactly
    like viewing the asset itself (same _get_scoped_asset), so a HOLDER sees
    only their own asset's history and no cross-company leakage is possible.
    Chronological, oldest first, matching the lifecycle Timeline's ordering."""
    asset = await _get_scoped_asset(asset_id, session, holder)
    stmt = (
        select(AssetFieldChange)
        .where(AssetFieldChange.asset_id == asset.id)
        .order_by(AssetFieldChange.created_at, AssetFieldChange.id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    actor_ids = {r.actor_id for r in rows}
    actors: dict[int, str] = {}
    if actor_ids:
        actor_rows = (await session.execute(select(Holder).where(Holder.id.in_(actor_ids)))).scalars().all()
        actors = {h.id: h.name for h in actor_rows}
    return [
        AssetFieldChangeOut.model_validate(r).model_copy(update={"actor_name": actors.get(r.actor_id)})
        for r in rows
    ]


@router.put("/{asset_id}", response_model=AssetDetailOut)
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
    if they were.

    AM-04: required-active-custom-field completeness is only enforced when
    this edit itself includes `custom_fields` -- an asset that predates a
    newly-added required UDF must not be blocked from an unrelated edit (e.g.
    fixing a serial number) solely because it has no value for that field
    yet (docs/ai/DECISIONS.md). Also writes one AssetFieldChange row per
    genuinely changed field, in the same transaction as the edit (committed
    together below, never separately)."""
    asset = await _get_scoped_asset(asset_id, session, actor)
    data = body.model_dump()
    replacing_custom_fields = data.get("custom_fields") is not None
    try:
        await validate_custom_field_values(
            session, data.get("custom_fields"), enforce_required=replacing_custom_fields,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    before = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
    before["custom_fields"] = dict(asset.custom_fields)

    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))

    for field in (
        "legacy_asset_code", "brand", "model", "serial_number", "description",
        "vendor_id", "po_number", "po_date", "invoice_number", "invoice_date",
        "pi_number", "pi_date", "purchase_cost", "tax_percent", "warranty_upto",
    ):
        setattr(asset, field, data[field])
    asset.tax_amount = tax_amount
    asset.total_cost = total_cost
    if replacing_custom_fields:
        asset.custom_fields = data["custom_fields"]
    asset.updated_by = actor.id

    after = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
    after["custom_fields"] = dict(asset.custom_fields)
    await record_field_changes(session, asset_id=asset.id, actor_id=actor.id, before=before, after=after)

    await session.commit()
    await session.refresh(asset)
    return await _to_detail_out(session, asset)


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
