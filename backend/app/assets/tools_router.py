"""S5 asset endpoints that act on many assets at once: batch Add Assets, "take N of an Item from a stock
room" for Move, and linking existing assets to Items. Mounted BEFORE app.assets.router so these fixed paths
are matched before `/api/assets/{asset_id}`."""
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.assets.batch import add_assets_batch
from app.assets.linking import link_assets, unlinked_assets
from app.assets.models import Asset
from app.assets.schemas import MAX_BATCH_UNITS, AssetBatchIn
from app.core.capabilities import require_domain_admin
from app.core.db import get_session
from app.core.deps import WRITE_ROLES, allowed_asset_domains, require_role, scoped_company_ids
from app.core.problems import Refused
from app.core.validation import InModel
from app.erp.source import ErpSource, get_erp_source
from app.items.models import Item
from app.lifecycle.state_machine import LifecycleError
from app.observability import audit as obs_audit
from app.observability import events as obs_events

router = APIRouter(prefix="/api/assets", tags=["assets"])

MAX_LINK_ENTRIES = 500
LINK_WHAT = "link assets to Items"


@router.post("/batch", status_code=201)
async def add_assets(
    body: AssetBatchIn, session: AsyncSession = Depends(get_session), actor=Depends(require_role(*WRITE_ROLES)),
):
    """Adds `quantity` (1-1000) assets of one Item, all or nothing (see app.assets.batch). 201 ->
    {assets_created, serial_pending, assets: [{asset_id, asset_code, serial_number, serial_pending}],
    label_asset_ids}; 422 -> {detail, errors, problems: [{unit_index?, serial?, message}]} and nothing saved;
    403 for an Item of another work area or a company outside the caller's."""
    try:
        result = await add_assets_batch(
            session, body.model_dump(), actor,
            allowed_companies=await scoped_company_ids(session, actor), domains=await allowed_asset_domains(session, actor),
        )
    except Refused as exc:
        await session.rollback()
        return exc.response()
    except (ValueError, LifecycleError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except BaseException:
        await session.rollback()
        raise
    # S8: ONE row for the whole batch (100 units = 1 row), with the new asset ids.
    item = await session.get(Item, body.item_id)
    codes = [a["asset_code"] for a in result["assets"]]
    obs_audit.record(
        session, "DATA", "BATCH_ADD",
        f"{obs_events.who()} added {obs_events.plural(result['assets_created'], 'asset')} of "
        f"{item.name if item else 'an Item'}" + (f" ({codes[0]} to {codes[-1]})" if codes else "") + ".",
        entity="item", entity_id=body.item_id, company_id=body.company_id,
        changes={"item_id": body.item_id, "quantity": result["assets_created"], "serial_pending": result["serial_pending"],
                 **obs_events.ids_preview(result["label_asset_ids"]), "first_code": codes[0] if codes else None,
                 "last_code": codes[-1] if codes else None})
    await session.commit()
    return result


@router.get("/pick")
async def pick_from_stock_room(
    response: Response,
    item_id: int = Query(...),
    asset_user_id: int = Query(...),
    quantity: int = Query(..., ge=1, le=MAX_BATCH_UNITS),
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Move's "take N of an Item from a stock room": the OLDEST (first added) N in-stock assets of that Item
    held by that stock room, within the caller's companies and work area -> [{asset_id, asset_code,
    serial_number}] (at most `quantity`; fewer when fewer are there). `X-Total-Count` = how many are there in
    all, so the screen can say "only 3 in stock"."""
    allowed = await scoped_company_ids(session, actor)
    place = await session.get(AssetUser, asset_user_id)
    if place is None or (allowed is not None and place.company_id not in allowed):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This stock room was not found.")
    domains = await allowed_asset_domains(session, actor)
    stmt = select(Asset.id, Asset.asset_code, Asset.serial_number).where(
        Asset.item_id == item_id, Asset.current_asset_user_id == place.id, Asset.status == "IN_STOCK",
        Asset.deleted_at.is_(None),
    )
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    if domains is not None:
        stmt = stmt.where(Asset.asset_domain.in_(domains))
    total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await session.execute(stmt.order_by(Asset.id).limit(quantity))).all()
    response.headers["X-Total-Count"] = str(total)
    return [{"asset_id": i, "asset_code": code, "serial_number": serial} for i, code, serial in rows]


@router.get("/unlinked-items")
async def list_unlinked(
    response: Response,
    q: str | None = Query(None, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source),
    actor=Depends(require_domain_admin(LINK_WHAT)),
):
    """Assets with no Item yet (caller's companies and work area), each with suggested Items
    [{item_id, item_name, score, reason: ERP_CODE | DESCRIPTION | GROUP}] -- suggestions only, nothing is
    linked by itself. ADMIN (and the head-office admin). `X-Total-Count` = all such assets."""
    rows, total = await unlinked_assets(
        session, source, allowed=await scoped_company_ids(session, actor),
        domains=await allowed_asset_domains(session, actor), q=q, limit=limit, offset=offset,
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


class LinkEntryIn(InModel):
    asset_id: int
    item_id: int


@router.post("/link-items")
async def link_items(
    body: list[LinkEntryIn] = Body(..., min_length=1, max_length=MAX_LINK_ENTRIES),
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_domain_admin(LINK_WHAT)),
):
    """Links assets to Items, all or nothing: every entry checked first (asset reachable, Item active, of the
    caller's work area and of the asset's own Category / Sub-category); any problem -> 422 {detail, errors,
    problems: [{entry_index, asset_id, item_id, message}]} and nothing changes. Sets only the Item; one
    field-change row (item_id) per asset."""
    obs_audit.suppress(session, "asset")      # S8: one LINK row, not one per asset
    try:
        result = await link_assets(
            session, [e.model_dump() for e in body], actor,
            allowed=await scoped_company_ids(session, actor), domains=await allowed_asset_domains(session, actor),
        )
    except Refused as exc:
        await session.rollback()
        return exc.response()
    except BaseException:
        await session.rollback()
        raise
    changed = [r for r in result["results"] if r["changed"]]
    obs_audit.record(
        session, "DATA", "LINK",
        f"{obs_events.who()} linked {obs_events.plural(result['linked'], 'asset')} to Items"
        + (f" ({result['unchanged']} already linked)" if result["unchanged"] else "") + ".",
        entity="asset", entity_id=changed[0]["asset_id"] if len(changed) == 1 else None,
        changes={"linked": result["linked"], "unchanged": result["unchanged"],
                 "links": [{"asset_id": r["asset_id"], "item_id": r["item_id"]} for r in changed][:200]})
    await session.commit()
    return result
