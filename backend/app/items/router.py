from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.bundles.models import Bundle
from app.core.capabilities import (
    AREA_WORDS, TEAM_WORDS, ensure_domain_manage, ensure_item_create, ensure_work_area_change, require_domain_admin,
    require_small_create, work_areas,
)
from app.core.validation import parse_work_area
from app.core.db import get_session
from app.core.deps import WRITE_ROLES, require_primary_owner, require_role
from app.erp.source import ErpSource, ErpUnavailable, get_erp_source
from app.items import service
from app.items.models import Item, ItemMap
from app.items.schemas import ItemIn, ItemMapIn, ItemMapOut, ItemOut
from app.masters import audit as master_audit
from app.masters.models import AssetCategory, AssetSubcategory, Brand

router = APIRouter(prefix="/api/items", tags=["items"])


def _item_out(rows: list[dict], item_id: int) -> dict:
    return next(r for r in rows if r["id"] == item_id)


@router.get("", response_model=list[ItemOut])
async def list_all(
    work_area: str | None = Query(None, max_length=10),
    session: AsyncSession = Depends(get_session), actor=Depends(require_role(*WRITE_ROLES)),
):
    """Active Items. S5 (additive): `work_area=IT` / `NON_IT` -> that team's Items only; `work_area=mine` ->
    the Items the caller may use (their own work area(s)). Left out: every Item, as before."""
    rows = await service.list_items(session)
    if work_area is None or not work_area.strip():
        return rows
    if work_area.strip().lower() == "mine":
        wanted = set(await work_areas(session, actor))
    else:
        try:
            wanted = {parse_work_area(work_area)}
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a work area: IT, Non-IT or mine.")
    return [r for r in rows if r["work_area"] in wanted]


DUPLICATE_NAME = "An Item with this name already exists."
ITEM_ADMIN_WHAT = "change or remove Items"


async def _category_domain(session: AsyncSession, category_id: int | None) -> str | None:
    category = await session.get(AssetCategory, category_id) if category_id is not None else None
    return category.asset_domain if category is not None else None


async def _request_domains(session: AsyncSession, data: dict) -> list[str]:
    """The work areas an Item request touches: its Category's and its
    Sub-category's own Category's (so an Item can never be slipped under a
    sub-category of the other team). Records that do not exist are left to
    the ordinary validation (422)."""
    domains = {await _category_domain(session, data.get("category_id"))}
    sub = await session.get(AssetSubcategory, data["subcategory_id"]) if data.get("subcategory_id") is not None else None
    if sub is not None:
        domains.add(await _category_domain(session, sub.category_id))
    return sorted(d for d in domains if d is not None)


async def _names(session: AsyncSession, model, *ids) -> dict:
    wanted = [i for i in ids if i is not None]
    if not wanted:
        return {}
    return dict((await session.execute(select(model.id, model.name).where(model.id.in_(wanted)))).all())


async def _audit_item_edit(session: AsyncSession, item: Item, data: dict, actor, old_domain: str | None,
                           new_domain: str | None) -> None:
    cats = await _names(session, AssetCategory, item.category_id, data.get("category_id"))
    subs = await _names(session, AssetSubcategory, item.subcategory_id, data.get("subcategory_id"))
    brands = await _names(session, Brand, item.default_brand_id, data.get("default_brand_id"))
    bundles = await _names(session, Bundle, item.bundle_id, data.get("bundle_id"))
    serial_required = True if data.get("serial_required") is None else bool(data["serial_required"])
    master_audit.record(session, entity="item", entity_id=item.id, actor_id=actor.id, changes={
        "name": (item.name, (data.get("name") or "").strip()),
        "category": (cats.get(item.category_id), cats.get(data.get("category_id"))),
        "subcategory": (subs.get(item.subcategory_id), subs.get(data.get("subcategory_id"))),
        "work_area": (AREA_WORDS.get(old_domain or ""), AREA_WORDS.get(new_domain or "")),
        "serial_required": (item.serial_required, serial_required),
        "serial_later": (item.serial_later, bool(data.get("serial_later")) and serial_required),
        "bundle": (bundles.get(item.bundle_id), bundles.get(data.get("bundle_id"))),
        "default_brand": (brands.get(item.default_brand_id), brands.get(data.get("default_brand_id"))),
        "default_warranty_years": (item.default_warranty_years, data.get("default_warranty_years")),
    })


@router.post("", response_model=ItemOut, status_code=201)
async def create(body: ItemIn, session: AsyncSession = Depends(get_session), actor=Depends(require_small_create("an Item"))):
    """S3a-1: ADMIN and OPERATOR may add an Item while working (e.g. reviewing
    an ERP PO), but only under a Category of their own work area."""
    data = body.model_dump()
    for domain in await _request_domains(session, data):
        await ensure_item_create(session, actor, domain)
    try:
        item = await service.create_item(session, data, actor)
        await session.commit()
    except (ValueError, IntegrityError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc) if isinstance(exc, ValueError) else DUPLICATE_NAME)
    return _item_out(await service.list_items(session), item.id)


@router.put("/{item_id}", response_model=ItemOut)
async def update(
    item_id: int, body: ItemIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_domain_admin(ITEM_ADMIN_WHAT)),
):
    """S3a-1: an ADMIN of the Item's work area (or the head-office admin).
    Moving it to a Category of the other work area needs someone who handles
    both and `confirm_domain_change: true`. Every changed field is audited."""
    item = await session.get(Item, item_id)
    if item is None or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This Item was not found.")
    data = body.model_dump()
    confirmed = bool(data.pop("confirm_domain_change", False))
    old_domain = await _category_domain(session, item.category_id)
    await ensure_domain_manage(session, actor, old_domain)
    for domain in await _request_domains(session, data):
        await ensure_domain_manage(session, actor, domain)
    new_domain = await _category_domain(session, data.get("category_id"))
    if new_domain is not None and old_domain is not None and new_domain != old_domain:
        await ensure_work_area_change(session, actor, "an Item")
        if not confirmed:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Moving {item.name} from {TEAM_WORDS[old_domain]} to {TEAM_WORDS[new_domain]} changes who handles it: "
                f"{TEAM_WORDS[new_domain]} will handle the assets added as {item.name} from now on (assets already in "
                "the register keep their work area). Confirm the change to go ahead.",
            )
    try:
        await _audit_item_edit(session, item, data, actor, old_domain, new_domain or old_domain)
        await service.update_item(session, item, data, actor)
        await session.commit()
    except (ValueError, IntegrityError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc) if isinstance(exc, ValueError) else DUPLICATE_NAME)
    return _item_out(await service.list_items(session), item_id)


@router.delete("/{item_id}", status_code=204)
async def deactivate(
    item_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_domain_admin(ITEM_ADMIN_WHAT)),
):
    item = await session.get(Item, item_id)
    if item is None or not item.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This Item was not found.")
    await ensure_domain_manage(session, actor, await _category_domain(session, item.category_id))
    master_audit.record(session, entity="item", entity_id=item.id, actor_id=actor.id, changes={"active": (True, False)})
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


@router.get("/articles/groups")
async def article_groups(
    level: str, company_id: int | None = None, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), _actor=Depends(require_primary_owner()),
):
    """The Departments / Sections / Divisions (`level`) one company has bought from, to mark a whole group not tracked."""
    try:
        return await service.group_overview(session, source, level.upper(), company_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except ErpUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))


@router.get("/codes")
async def search_codes(
    q: str = "", company_id: int | None = None, session: AsyncSession = Depends(get_session),
    source: ErpSource = Depends(get_erp_source), _actor=Depends(require_primary_owner()),
):
    """ERP item codes, one row each, each with its own decision (not its Article's). No `q` = every bought code of the company;
    with `q` (two characters or more) = the codes whose code, name or Article contains it."""
    try:
        return await service.code_search(session, source, q, company_id)
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
