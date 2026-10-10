from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import WRITE_ROLES, require_primary_owner, require_role
from app.erp.source import ErpSource, ErpUnavailable, get_erp_source
from app.items import service
from app.items.models import Item, ItemMap
from app.items.schemas import ItemIn, ItemMapIn, ItemMapOut, ItemOut

router = APIRouter(prefix="/api/items", tags=["items"])


def _item_out(rows: list[dict], item_id: int) -> dict:
    return next(r for r in rows if r["id"] == item_id)


@router.get("", response_model=list[ItemOut])
async def list_all(session: AsyncSession = Depends(get_session), _actor=Depends(require_role(*WRITE_ROLES))):
    return await service.list_items(session)


@router.post("", response_model=ItemOut, status_code=201)
async def create(body: ItemIn, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner())):
    try:
        item = await service.create_item(session, body.model_dump(), actor)
        await session.commit()
    except (ValueError, IntegrityError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc) if isinstance(exc, ValueError) else "an Item with this name already exists")
    return _item_out(await service.list_items(session), item.id)


@router.put("/{item_id}", response_model=ItemOut)
async def update(
    item_id: int, body: ItemIn, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner()),
):
    item = await session.get(Item, item_id)
    if item is None or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    try:
        await service.update_item(session, item, body.model_dump(), actor)
        await session.commit()
    except (ValueError, IntegrityError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc) if isinstance(exc, ValueError) else "an Item with this name already exists")
    return _item_out(await service.list_items(session), item_id)


@router.delete("/{item_id}", status_code=204)
async def deactivate(item_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner())):
    item = await session.get(Item, item_id)
    if item is None or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    await service.deactivate_item(session, item, actor)
    await session.commit()


@router.post("/seed-from-subcategories")
async def seed(session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner())):
    """One Item per existing Sub-Category that has none yet."""
    created = await service.seed_from_subcategories(session, actor)
    await session.commit()
    return {"created": created}


# ---- the ERP Article mapping screen ----

@router.get("/articles")
async def articles(
    company_id: int | None = None, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), _actor=Depends(require_primary_owner()),
):
    """The Articles bought by one company (each company's ERP master is its own)."""
    try:
        return await service.article_overview(session, source, company_id)
    except ErpUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))


@router.get("/articles/codes")
async def article_codes(
    article_key: str, company_id: int | None = None, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), _actor=Depends(require_primary_owner()),
):
    try:
        return await service.article_code_overview(session, source, article_key, company_id)
    except ErpUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))


@router.get("/maps", response_model=list[ItemMapOut])
async def list_maps(
    item_id: int | None = None, session: AsyncSession = Depends(get_session), _actor=Depends(require_primary_owner()),
):
    stmt = select(ItemMap).where(ItemMap.is_active.is_(True)).order_by(ItemMap.match_type, ItemMap.id)
    if item_id is not None:
        stmt = stmt.where(ItemMap.item_id == item_id)
    return (await session.execute(stmt)).scalars().all()


@router.post("/maps", response_model=ItemMapOut, status_code=201)
async def save_map(body: ItemMapIn, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner())):
    try:
        rule = await service.upsert_map(session, actor, body.model_dump())
        await session.commit()
    except (ValueError, IntegrityError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc) if isinstance(exc, ValueError) else "that rule already exists")
    await session.refresh(rule)
    return rule


@router.delete("/maps/{map_id}", status_code=204)
async def delete_map(map_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner())):
    rule = await session.get(ItemMap, map_id)
    if rule is None or not rule.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    await service.remove_map(session, rule, actor)
    await session.commit()
