from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import ensure_company_in_scope, get_current_holder, require_role, scoped_company_ids
from app.assets.audit_service import AUDITED_SCALAR_FIELDS, record_field_changes
from app.assets.correction_service import correct_asset, UNSET as CORRECTION_UNSET
from app.assets.custom_field_values import validate_custom_field_values
from app.assets.models import Asset, AssetFieldChange
from app.assets.schemas import AssetCorrectionIn, AssetCreateIn, AssetDetailOut, AssetFieldChangeOut, AssetOut, AssetUpdateIn
from app.assets.search_service import search_assets
from app.assets.service import check_serial_number_unique, compute_tax, compute_warranty_upto, procure_assets
from app.holders.models import Holder
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location, Vendor
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


class BulkActionIn(BaseModel):
    """AM-20: the Asset Movement console -- scan a batch of assets by Serial
    Number/Asset Code, pick ONE action and (for the actions that need one) ONE
    destination Holder for the whole batch, apply to all of them at once.
    `event_type` is any of actionRules.ts's own set (MOVED/SENT_FOR_REPAIR/
    LOST/DISPOSED/SOLD/SCRAPPED/RECEIVED_FROM_REPAIR/FOUND) -- the backend
    state machine (app.lifecycle.state_machine.transition) remains the real
    authority on which is actually legal from each asset's current status,
    exactly as it already is for the single-asset action buttons."""
    asset_ids: list[int]
    event_type: str
    to_holder_id: int | None = None
    remarks: str | None = None


class BulkActionOut(BaseModel):
    done: int
    failed: list[dict]


async def _page_label_maps(session: AsyncSession, items: list[Asset]) -> tuple[dict, dict, dict, dict, dict, dict]:
    """AM-11: page-scoped id->name lookups for the register's columns -- only
    the distinct ids actually present on this one page (at most `limit`,
    currently capped at 200), never every holder/company/category/etc in the
    system (that's `app.reports.router._export_label_maps`'s job, which is
    fine for a bounded export but would be wasteful on every register page
    view/filter keystroke). Extended beyond the original Holder/Company pair
    to Category/Sub-Category/Vendor/Cost Centre so the "show every field"
    register pass can label those FK columns too instead of showing bare ids."""
    holder_ids = {a.current_holder_id for a in items}
    company_ids = {a.company_id for a in items}
    category_ids = {a.category_id for a in items}
    subcategory_ids = {a.subcategory_id for a in items if a.subcategory_id is not None}
    vendor_ids = {a.vendor_id for a in items if a.vendor_id is not None}
    cost_center_ids = {a.cost_center_id for a in items}

    async def _labels(model, ids: set[int]) -> dict[int, str]:
        if not ids:
            return {}
        rows = (await session.execute(select(model.id, model.name).where(model.id.in_(ids)))).all()
        return {row[0]: row[1] for row in rows}

    holders = await _labels(Holder, holder_ids)
    companies = await _labels(Company, company_ids)
    categories = await _labels(AssetCategory, category_ids)
    subcategories = await _labels(AssetSubcategory, subcategory_ids)
    vendors = await _labels(Vendor, vendor_ids)
    cost_centers = await _labels(CostCenter, cost_center_ids)
    return holders, companies, categories, subcategories, vendors, cost_centers


@router.post("", response_model=list[AssetOut], status_code=201)
async def create_asset(
    body: AssetCreateIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    # Write-scope check: an IT_TEAM actor can only *read* their own company's data,
    # so they must not be able to create assets in any other company either.
    ensure_company_in_scope(actor, body.company_id)
    data = body.model_dump()
    # Purchase Date is Invoice Date when Invoice Date is known
    # (docs/ai/DECISIONS.md) -- never accepted from the client (AssetCreateIn
    # has no purchase_date field at all), derived here the same way
    # deliver_pending_assets derives it for the PO path. AM-19: Invoice Date
    # is now optional (ground reality -- it often isn't in hand yet when the
    # physical asset is logged); when it's missing, Purchase Date falls back
    # to today, the day the asset is actually being logged.
    data["purchase_date"] = data["invoice_date"] or date.today()
    try:
        # AM-19: quantity is gone -- every call creates exactly one asset.
        assets = await procure_assets(session, data, quantity=1, actor=actor)
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
    holder_labels, company_labels, category_labels, subcategory_labels, vendor_labels, cost_center_labels = (
        await _page_label_maps(session, items)
    )
    out_items = []
    for a in items:
        out = AssetOut.model_validate(a)
        out.current_holder_name = holder_labels.get(a.current_holder_id)
        out.company_name = company_labels.get(a.company_id)
        out.category_name = category_labels.get(a.category_id)
        out.subcategory_name = subcategory_labels.get(a.subcategory_id) if a.subcategory_id else None
        out.vendor_name = vendor_labels.get(a.vendor_id) if a.vendor_id else None
        out.cost_center_name = cost_center_labels.get(a.cost_center_id)
        out_items.append(out)
    return AssetListOut(items=out_items, total=total)


async def _bulk_apply_event(
    asset_ids: list[int], event_type: str, to_holder_id: int | None, remarks: str | None,
    session: AsyncSession, actor,
) -> tuple[int, list[dict]]:
    """Shared by /bulk-move (MOVED only, kept for backward compatibility with
    the Asset Register's existing bulk-move) and /bulk-action (AM-20, any
    event type). One asset's failure never aborts the rest of the batch --
    each is its own try/except, matching the original bulk_move's own
    reasoning: a scan/checkbox session naturally mixes a few ineligible or
    out-of-scope assets in with many valid ones, and losing the whole batch
    over one bad item would be far worse than reporting it and moving on."""
    done = 0
    failed: list[dict] = []
    for asset_id in asset_ids:
        try:
            asset = await _get_scoped_asset(asset_id, session, actor)
        except HTTPException:
            # Out of scope or already soft-deleted -- same fail-closed-to-404 behaviour
            # as every other asset endpoint (spec: scoping fails closed), reported here as
            # a per-item failure so one out-of-scope id doesn't abort the rest of the batch.
            failed.append({"asset_id": asset_id, "reason": "not found"})
            continue
        try:
            await apply_event(session, asset, event_type, to_holder_id=to_holder_id, actor=actor, remarks=remarks)
            done += 1
        except LifecycleError as exc:
            failed.append({"asset_id": asset_id, "reason": str(exc)})
    return done, failed


@router.post("/bulk-move", response_model=BulkMoveOut)
async def bulk_move(
    body: BulkMoveIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    moved, failed = await _bulk_apply_event(body.asset_ids, "MOVED", body.to_holder_id, None, session, actor)
    await session.commit()
    return BulkMoveOut(moved=moved, failed=failed)


@router.post("/bulk-action", response_model=BulkActionOut)
async def bulk_action(
    body: BulkActionIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    done, failed = await _bulk_apply_event(
        body.asset_ids, body.event_type, body.to_holder_id, body.remarks, session, actor,
    )
    await session.commit()
    return BulkActionOut(done=done, failed=failed)


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
    company = await session.get(Company, asset.company_id)
    location = await session.get(Location, current_holder.location_id) if current_holder else None
    department = (
        await session.get(Department, current_holder.department_id)
        if current_holder and current_holder.department_id else None
    )
    # current_holder_name/company_name/category_name/subcategory_name/cost_center_name/
    # vendor_name already live on AssetOut itself (AM-11's original pair, plus the
    # register's later "show every field" additions) -- exclude them all from the base
    # dump here so this endpoint's own, already-fetched rows are the ones that win,
    # not a duplicate keyword argument.
    base = AssetOut.model_validate(asset).model_dump(
        exclude={"current_holder_name", "company_name", "category_name", "subcategory_name", "cost_center_name", "vendor_name"}
    )
    return AssetDetailOut(
        **base,
        current_holder_name=current_holder.name if current_holder else None,
        company_name=company.name if company else None,
        category_name=category.name if category else None,
        subcategory_name=subcategory.name if subcategory else None,
        cost_center_name=cost_center.name if cost_center else None,
        vendor_name=vendor.name if vendor else None,
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
            session, data.get("custom_fields"), company_id=asset.company_id,
            enforce_required=replacing_custom_fields,
        )
        # Only re-checked when the edit actually changes the value -- an
        # untouched serial_number (already this asset's own) must never
        # conflict with itself (exclude_asset_id).
        if data.get("serial_number") != asset.serial_number:
            await check_serial_number_unique(session, data.get("serial_number"), exclude_asset_id=asset.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    before = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
    before["custom_fields"] = dict(asset.custom_fields)

    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))

    for field in (
        "legacy_asset_code", "brand", "model", "serial_number", "barcode", "description",
        "vendor_id", "po_number", "po_date", "invoice_number", "invoice_date", "invoice_amount",
        "pi_number", "pi_date", "purchase_cost", "tax_percent",
    ):
        setattr(asset, field, data[field])
    asset.tax_amount = tax_amount
    asset.total_cost = total_cost
    # AM-18: None means "leave exactly as-is" -- a legacy NULL-warranty_years
    # asset's existing warranty_upto (manually entered or NULL, from before
    # this feature existed) is never touched by an edit that doesn't mention
    # warranty at all. An explicit int (0 or more) recomputes both.
    if data["warranty_years"] is not None:
        asset.warranty_years = data["warranty_years"]
        asset.warranty_upto = compute_warranty_upto(asset.purchase_date, data["warranty_years"])
    if replacing_custom_fields:
        asset.custom_fields = data["custom_fields"]
    asset.updated_by = actor.id

    after = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
    after["custom_fields"] = dict(asset.custom_fields)
    await record_field_changes(session, asset_id=asset.id, actor_id=actor.id, before=before, after=after)

    await session.commit()
    await session.refresh(asset)
    return await _to_detail_out(session, asset)


@router.post("/{asset_id}/corrections", response_model=AssetDetailOut)
async def correct_asset_classification(
    asset_id: int,
    body: AssetCorrectionIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    """AM-07: a deliberately separate, narrower operation from
    `PUT /api/assets/{id}` for correcting Category, Subcategory, and/or
    Purchase Date -- the three fields `AssetUpdateIn` has excluded since
    AM-02 precisely because they're controlled master/date references, not
    ordinary descriptive data. Same scoping as every other asset-mutation
    endpoint (`_get_scoped_asset`): a HOLDER never reaches this route at all
    (`require_role` gate), and IT_TEAM can only correct an asset already
    inside their own company scope. `body.model_fields_set` is what tells
    "this field wasn't part of the request" apart from "explicitly set to
    null" -- see `AssetCorrectionIn`'s own docstring."""
    asset = await _get_scoped_asset(asset_id, session, actor)
    fields_set = body.model_fields_set
    try:
        await correct_asset(
            session, asset, actor,
            category_id=body.category_id if "category_id" in fields_set else CORRECTION_UNSET,
            subcategory_id=body.subcategory_id if "subcategory_id" in fields_set else CORRECTION_UNSET,
            purchase_date_value=body.purchase_date if "purchase_date" in fields_set else CORRECTION_UNSET,
            reason=body.reason,
        )
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    asset.updated_by = actor.id
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
