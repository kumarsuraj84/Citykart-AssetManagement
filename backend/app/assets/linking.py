"""S5: link existing assets to Items (assets made before Items existed, or by the Excel import, have none).

* `unlinked_assets` lists live assets without an Item (caller's companies and work area) with SUGGESTIONS
  only -- never applied by themselves:
    ERP_CODE     the Item the asset's ERP item code resolves to through the item rules (app.items.service,
                 the same CODE > NAME > ARTICLE resolution the ERP screens use, per company);
    DESCRIPTION  Items of the same Category (and Sub-category, when the asset has one) whose name's words are
                 mostly found in the asset's description (the shared word-overlap rule, >= half the name);
    GROUP        the Item(s) of the asset's own Sub-category when there are only a few (one -> stronger).
  Only Items the asset could actually be linked to are suggested (active, same Category / Sub-category).
* `link_assets` links many at once, all or nothing after checking every entry: the Item must be active, of
  the caller's work area and of the asset's own Category (and Sub-category when the asset has one) --
  otherwise "This Item belongs to a different asset group; use Correct Classification first.". It sets only
  asset.item_id and writes one asset_field_change row (field item_id) per asset; category, status and holder
  never change."""
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.assets.labels import asset_label_rows
from app.assets.models import Asset, AssetFieldChange
from app.core.deps import outside_work_area_message
from app.core.problems import Refused
from app.core.validation import escape_like
from app.erp.source import ErpItem, ErpSource, ErpUnavailable
from app.items.models import Item
from app.items.service import SUGGESTION_THRESHOLD, _words, active_rule_sets
from app.masters.models import AssetCategory

MAX_SUGGESTIONS = 5
DIFFERENT_GROUP = "This Item belongs to a different asset group; use Correct Classification first."


def fits(asset: Asset, item: Item) -> bool:
    """An Item an asset may be linked to: same Category, and the same Sub-category when the asset has one."""
    if item.category_id != asset.category_id:
        return False
    return asset.subcategory_id is None or item.subcategory_id == asset.subcategory_id


def _scoped(stmt, allowed: list[int] | None, domains: tuple[str, ...] | None):
    stmt = stmt.where(Asset.deleted_at.is_(None))
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    if domains is not None:
        stmt = stmt.where(Asset.asset_domain.in_(domains))
    return stmt


async def _erp_records(source: ErpSource | None, codes: list[str]) -> dict[str, ErpItem]:
    """The ERP item master records of these codes (one read); an unreadable ERP only means fewer
    suggestions -- the code rules still apply without the record."""
    if source is None or not codes:
        return {}
    try:
        found = await source.items(codes)
    except ErpUnavailable:
        return {}
    return {e.icode.upper(): e for e in found}


def suggestions_for(asset: Asset, candidates: list[Item], words_of: dict[int, set[str]], erp_hit: Item | None) -> list[dict]:
    out: dict[int, dict] = {}

    def add(item: Item, score: float, reason: str) -> None:
        if item.id not in out or out[item.id]["score"] < score:
            out[item.id] = {"item_id": item.id, "item_name": item.name, "score": round(score, 2), "reason": reason}

    if erp_hit is not None and erp_hit.is_active and fits(asset, erp_hit):
        add(erp_hit, 1.0, "ERP_CODE")
    fitting = [i for i in candidates if fits(asset, i)]
    description_words = _words(asset.description or "")
    for item in fitting:
        words = words_of.get(item.id) or set()
        if words:
            score = len(words & description_words) / len(words)
            if score >= SUGGESTION_THRESHOLD:
                add(item, min(score, 0.95), "DESCRIPTION")
    if asset.subcategory_id is not None:
        same_group = [i for i in fitting if i.subcategory_id == asset.subcategory_id]
        if 1 <= len(same_group) <= 3:
            for item in same_group:
                add(item, 0.4 if len(same_group) == 1 else 0.2, "GROUP")
    return sorted(out.values(), key=lambda s: (-s["score"], s["item_name"].lower()))[:MAX_SUGGESTIONS]


async def unlinked_assets(
    session: AsyncSession, source: ErpSource | None, *, allowed: list[int] | None, domains: tuple[str, ...] | None,
    q: str | None, limit: int, offset: int,
) -> tuple[list[dict], int]:
    stmt = _scoped(select(Asset).where(Asset.item_id.is_(None)), allowed, domains)
    if q and q.strip():
        pattern = f"%{escape_like(q.strip())}%"
        stmt = stmt.where(or_(*(c.ilike(pattern, escape="\\") for c in (
            Asset.asset_code, Asset.description, Asset.erp_item_code, Asset.serial_number, Asset.model, Asset.barcode,
        ))))
    total = (await session.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    assets = list((await session.execute(stmt.order_by(Asset.id).limit(limit).offset(offset))).scalars().all())
    if not assets:
        return [], total
    labels = await asset_label_rows(session, [a.id for a in assets])
    categories = {a.category_id for a in assets}
    candidates = list((await session.execute(
        select(Item).where(Item.is_active.is_(True), Item.category_id.in_(categories)).order_by(Item.name)
    )).scalars().all())
    words_of = {i.id: _words(i.name) for i in candidates}
    codes = sorted({a.erp_item_code.strip() for a in assets if (a.erp_item_code or "").strip()})
    erp = await _erp_records(source, codes)
    rules = await active_rule_sets(session, sorted({a.company_id for a in assets})) if codes else {}
    rows = []
    for a in assets:
        hit = None
        code = (a.erp_item_code or "").strip()
        if code:
            record = erp.get(code.upper()) or ErpItem(icode=code, article_key="", article_name="", section="",
                                                      department="", division="")
            resolution = rules[a.company_id].resolve(record)
            hit = resolution.item if not resolution.not_tracked else None
        names = labels.get(a.id, {})
        rows.append({
            "asset_id": a.id, "asset_code": a.asset_code, "description": a.description, "model": a.model,
            "serial_number": a.serial_number, "erp_item_code": a.erp_item_code, "status": a.status,
            "company_id": a.company_id, "company_code": names.get("company_code"),
            "category_id": a.category_id, "category_name": names.get("category_name"),
            "subcategory_id": a.subcategory_id, "subcategory_name": names.get("subcategory_name"),
            "brand_name": names.get("brand_name"), "holder_name": names.get("holder_name"),
            "holder_kind_label": names.get("holder_kind_label"),
            "work_area": a.asset_domain, "work_area_label": names.get("work_area_label"),
            "suggestions": suggestions_for(a, candidates, words_of, hit),
        })
    return rows, total


async def link_assets(
    session: AsyncSession, entries: list[dict], actor: AssetUser, *,
    allowed: list[int] | None, domains: tuple[str, ...] | None,
) -> dict:
    asset_ids = {e["asset_id"] for e in entries}
    item_ids = {e["item_id"] for e in entries}
    assets = {a.id: a for a in (await session.execute(
        _scoped(select(Asset).where(Asset.id.in_(asset_ids)), allowed, domains)
    )).scalars().all()}
    items = {i.id: i for i in (await session.execute(select(Item).where(Item.id.in_(item_ids)))).scalars().all()}
    item_area = dict((await session.execute(
        select(AssetCategory.id, AssetCategory.asset_domain).where(AssetCategory.id.in_({i.category_id for i in items.values()}))
    )).all()) if items else {}
    linked_names = dict((await session.execute(
        select(Item.id, Item.name).where(Item.id.in_({a.item_id for a in assets.values() if a.item_id}))
    )).all()) if any(a.item_id for a in assets.values()) else {}

    problems: list[dict] = []
    planned: list[tuple[Asset, Item]] = []
    unchanged: list[tuple[Asset, Item]] = []
    seen: set[int] = set()
    for index, entry in enumerate(entries, start=1):
        def refuse(message: str):
            problems.append({"entry_index": index, "asset_id": entry["asset_id"], "item_id": entry["item_id"],
                             "message": message})
        if entry["asset_id"] in seen:
            refuse("This asset appears more than once; enter it once.")
            continue
        seen.add(entry["asset_id"])
        asset = assets.get(entry["asset_id"])
        if asset is None:
            refuse("This asset was not found.")
            continue
        item = items.get(entry["item_id"])
        if item is None:
            refuse("The Item you chose does not exist.")
            continue
        if not item.is_active:
            refuse(f"The Item {item.name} is no longer active; choose another.")
            continue
        area = item_area.get(item.category_id)
        if domains is not None and area not in domains:
            refuse(outside_work_area_message(area))
            continue
        if not fits(asset, item):
            refuse(DIFFERENT_GROUP)
            continue
        if asset.item_id is not None:
            if asset.item_id == item.id:
                unchanged.append((asset, item))
            else:
                refuse(f"{asset.asset_code} is already linked to the Item {linked_names.get(asset.item_id, 'another Item')}.")
            continue
        planned.append((asset, item))
    if problems:
        raise Refused(problems, "Nothing was linked")

    results = []
    for asset, item in planned:
        asset.item_id = item.id
        asset.updated_by = actor.id
        session.add(AssetFieldChange(
            asset_id=asset.id, field_name="item_id", old_value=None, new_value=f"{item.name} (#{item.id})",
            actor_id=actor.id, request_id=str(uuid4()),
        ))
        results.append({"asset_id": asset.id, "asset_code": asset.asset_code, "item_id": item.id,
                        "item_name": item.name, "changed": True})
    for asset, item in unchanged:
        results.append({"asset_id": asset.id, "asset_code": asset.asset_code, "item_id": item.id,
                        "item_name": item.name, "changed": False})
    await session.flush()
    order = {e["asset_id"]: i for i, e in enumerate(entries)}
    results.sort(key=lambda r: order[r["asset_id"]])
    return {"linked": len(planned), "unchanged": len(unchanged), "results": results}
