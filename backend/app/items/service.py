"""Items (CityKart's own names for what an asset is) and the rules that say which
Item an ERP item code belongs to. See docs/ai/ITEM_MODEL.md."""
import re
from dataclasses import dataclass
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.bundles.models import Bundle
from app.erp.source import ErpItem, ErpSource
from app.items.models import Item, ItemMap, MATCH_TYPES
from app.masters.models import AssetCategory, AssetSubcategory, Brand
from app.masters.serial_rule import effective_serial_required


def norm(text: str | None) -> str:
    """A name reduced to lower-case words, so 'Duct Split AC' and 'duct split ac.'
    are the same product name."""
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _words(text: str) -> set[str]:
    return {w for w in norm(text).split() if len(w) >= 3}


@dataclass
class Resolution:
    item: Item | None
    matched_by: str | None = None
    map_id: int | None = None


# ---------- Items ----------

async def _validate_item(session: AsyncSession, data: dict, item_id: int | None) -> None:
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("an Item needs a name")
    clash = (await session.execute(
        select(Item.id).where(func.lower(Item.name) == name.lower(), Item.is_active.is_(True), Item.id != (item_id or 0))
    )).first()
    if clash is not None:
        raise ValueError(f"an Item named {name!r} already exists")
    category = await session.get(AssetCategory, data["category_id"])
    if category is None:
        raise ValueError("category not found")
    if data.get("subcategory_id") is not None:
        sub = await session.get(AssetSubcategory, data["subcategory_id"])
        if sub is None or sub.category_id != category.id:
            raise ValueError("the sub-category does not belong to the chosen category")
    if data.get("bundle_id") is not None:
        bundle = await session.get(Bundle, data["bundle_id"])
        if bundle is None or not bundle.is_active:
            raise ValueError("bundle not found")
    if data.get("default_brand_id") is not None and await session.get(Brand, data["default_brand_id"]) is None:
        raise ValueError("brand not found")


def _apply(item: Item, data: dict, actor: AssetUser) -> None:
    item.name = data["name"].strip()
    item.category_id = data["category_id"]
    item.subcategory_id = data.get("subcategory_id")
    item.serial_required = data.get("serial_required")
    item.bundle_id = data.get("bundle_id")
    item.default_brand_id = data.get("default_brand_id")
    item.default_warranty_years = data.get("default_warranty_years")
    item.updated_by = actor.id


async def create_item(session: AsyncSession, data: dict, actor: AssetUser) -> Item:
    await _validate_item(session, data, None)
    item = Item(created_by=actor.id)
    _apply(item, data, actor)
    session.add(item)
    await session.flush()
    return item


async def update_item(session: AsyncSession, item: Item, data: dict, actor: AssetUser) -> Item:
    await _validate_item(session, data, item.id)
    _apply(item, data, actor)
    await session.flush()
    return item


async def deactivate_item(session: AsyncSession, item: Item, actor: AssetUser) -> None:
    """Soft only: assets and lines already pointing at it keep their link. Its
    mapping rules stay but are ignored until it is used again."""
    item.is_active = False
    item.updated_by = actor.id
    await session.flush()


async def list_items(session: AsyncSession) -> list[dict]:
    items = (await session.execute(select(Item).where(Item.is_active.is_(True)).order_by(Item.name))).scalars().all()
    categories = {c.id: c for c in (await session.execute(select(AssetCategory))).scalars().all()}
    subs = {s.id: s for s in (await session.execute(select(AssetSubcategory))).scalars().all()}
    counts = dict((await session.execute(
        select(ItemMap.item_id, func.count()).where(ItemMap.is_active.is_(True)).group_by(ItemMap.item_id)
    )).all())
    return [
        {
            "id": i.id, "name": i.name, "category_id": i.category_id, "subcategory_id": i.subcategory_id,
            "serial_required": i.serial_required, "bundle_id": i.bundle_id, "default_brand_id": i.default_brand_id,
            "default_warranty_years": i.default_warranty_years, "is_active": i.is_active,
            "effective_serial_required": effective_serial_required(categories[i.category_id], subs.get(i.subcategory_id), i),
            "map_count": counts.get(i.id, 0),
        }
        for i in items
    ]


async def seed_from_subcategories(session: AsyncSession, actor: AssetUser) -> int:
    """One Item per existing active Sub-Category that has none yet (name = the
    sub-category's name, with the category added when two share a name). The
    one-click way to carry today's classification over; ERP codes are linked to
    these afterwards."""
    cats = {c.id: c for c in (await session.execute(select(AssetCategory).where(AssetCategory.is_active.is_(True)))).scalars().all()}
    subs = (await session.execute(
        select(AssetSubcategory).where(AssetSubcategory.is_active.is_(True)).order_by(AssetSubcategory.category_id, AssetSubcategory.name)
    )).scalars().all()
    existing = (await session.execute(select(Item).where(Item.is_active.is_(True)))).scalars().all()
    have_sub = {i.subcategory_id for i in existing if i.subcategory_id}
    names = {i.name.lower() for i in existing}
    created = 0
    for sub in subs:
        if sub.id in have_sub or sub.category_id not in cats:
            continue
        name = sub.name.strip()
        if name.lower() in names:
            name = f"{name} ({cats[sub.category_id].name})"
        if name.lower() in names:
            continue
        session.add(Item(name=name, category_id=sub.category_id, subcategory_id=sub.id, created_by=actor.id, updated_by=actor.id))
        names.add(name.lower())
        created += 1
    await session.flush()
    return created


# ---------- mapping rules ----------

async def _active_maps(session: AsyncSession) -> list[tuple[ItemMap, Item]]:
    return list((await session.execute(
        select(ItemMap, Item).join(Item, Item.id == ItemMap.item_id).where(ItemMap.is_active.is_(True), Item.is_active.is_(True))
    )).all())


async def resolve_items(session: AsyncSession, erp_items: list[ErpItem]) -> dict[str, Resolution]:
    """For each ERP item: the Item it belongs to, found most specific first --
    its own code, then its product name inside its Article, then its Article."""
    maps = await _active_maps(session)
    by_code = {m.erp_item_code.lower(): (m, i) for m, i in maps if m.match_type == "CODE" and m.erp_item_code}
    by_name = {(m.article_key, m.name_key): (m, i) for m, i in maps if m.match_type == "NAME"}
    by_article = {m.article_key: (m, i) for m, i in maps if m.match_type == "ARTICLE"}
    out: dict[str, Resolution] = {}
    for e in erp_items:
        hit, how = by_code.get(e.icode.lower()), "CODE"
        if hit is None and norm(e.name):
            hit, how = by_name.get((e.article_key, norm(e.name))), "NAME"
        if hit is None:
            hit, how = by_article.get(e.article_key), "ARTICLE"
        out[e.icode] = Resolution(item=hit[1], matched_by=how, map_id=hit[0].id) if hit else Resolution(item=None)
    return out


async def upsert_map(session: AsyncSession, actor: AssetUser, data: dict) -> ItemMap:
    """Creates (or re-points) one rule. A rule is identified by what it matches,
    so mapping the same Article / name / code again just changes its Item."""
    item = await session.get(Item, data["item_id"])
    if item is None or not item.is_active:
        raise ValueError("Item not found")
    mt = data["match_type"]
    if mt not in MATCH_TYPES:
        raise ValueError(f"match_type must be one of {MATCH_TYPES}")
    article_key = (data.get("article_key") or "").strip() or None
    name_key = norm(data.get("name_key")) or None
    code = (data.get("erp_item_code") or "").strip() or None
    if mt == "CODE" and not code:
        raise ValueError("a code rule needs the ERP item code")
    if mt in ("ARTICLE", "NAME") and not article_key:
        raise ValueError("this rule needs the Article")
    if mt == "NAME" and not name_key:
        raise ValueError("a product-name rule needs the product name")
    stmt = select(ItemMap).where(ItemMap.is_active.is_(True), ItemMap.match_type == mt)
    if mt == "CODE":
        stmt = stmt.where(func.lower(ItemMap.erp_item_code) == code.lower())
    elif mt == "ARTICLE":
        stmt = stmt.where(ItemMap.article_key == article_key)
    else:
        stmt = stmt.where(ItemMap.article_key == article_key, ItemMap.name_key == name_key)
    rule = (await session.execute(stmt.limit(1))).scalar_one_or_none()
    if rule is None:
        rule = ItemMap(match_type=mt, created_by=actor.id, article_key=article_key if mt != "CODE" else None,
                       name_key=name_key if mt == "NAME" else None, erp_item_code=code if mt == "CODE" else None)
        session.add(rule)
    rule.item_id = item.id
    for field in ("section", "department", "article_name", "note"):
        if data.get(field):
            setattr(rule, field, data[field])
    if mt == "CODE" and article_key:
        rule.article_key = article_key
    rule.updated_by = actor.id
    await session.flush()
    return rule


async def remove_map(session: AsyncSession, rule: ItemMap, actor: AssetUser) -> None:
    rule.is_active = False
    rule.updated_by = actor.id
    await session.flush()


# ---------- the Article mapping screen ----------

async def article_overview(session: AsyncSession, source: ErpSource) -> list[dict]:
    """Every Article that has been bought, with how it is mapped and a
    suggested Item (the existing Item whose name shares the most words with the
    Article's name, department and sample product names)."""
    articles = await source.bought_articles()
    maps = await _active_maps(session)
    article_item = {m.article_key: i for m, i in maps if m.match_type == "ARTICLE"}
    name_rules: dict[str, int] = {}
    code_rules: dict[str, int] = {}
    for m, _ in maps:
        if m.match_type == "NAME" and m.article_key:
            name_rules[m.article_key] = name_rules.get(m.article_key, 0) + 1
        if m.match_type == "CODE" and m.article_key:
            code_rules[m.article_key] = code_rules.get(m.article_key, 0) + 1
    items = (await session.execute(select(Item).where(Item.is_active.is_(True)))).scalars().all()
    item_words = {i.id: _words(i.name) for i in items}
    out = []
    for a in articles:
        mapped = article_item.get(a.article_key)
        text_words = _words(" ".join([a.article_name, a.department, *a.samples]))
        suggestion, best = None, 0.0
        if mapped is None:
            for i in items:
                words = item_words[i.id]
                score = len(words & text_words) / len(words) if words else 0
                if score > best:
                    suggestion, best = i, score
        out.append({
            "article_key": a.article_key, "article_name": a.article_name, "section": a.section, "department": a.department,
            "codes": a.codes, "units": a.units, "lines": a.lines, "samples": a.samples,
            "item_id": mapped.id if mapped else None, "item_name": mapped.name if mapped else None,
            "name_rules": name_rules.get(a.article_key, 0), "code_rules": code_rules.get(a.article_key, 0),
            "suggested_item_id": suggestion.id if suggestion and best >= 0.5 else None,
            "suggested_item_name": suggestion.name if suggestion and best >= 0.5 else None,
        })
    return out


async def article_code_overview(session: AsyncSession, source: ErpSource, article_key: str) -> list[dict]:
    """The codes of one Article that were bought, grouped by product name, with
    the Item each currently resolves to (and why)."""
    codes = await source.article_codes(article_key)
    erp = {e.icode: e for e in await source.items([c.icode for c in codes])}
    resolved = await resolve_items(session, list(erp.values()))
    out = []
    for c in codes:
        r = resolved.get(c.icode, Resolution(item=None))
        out.append({
            "icode": c.icode, "name": c.name, "name_key": norm(c.name), "description": c.description, "units": c.units, "lines": c.lines,
            "item_id": r.item.id if r.item else None, "item_name": r.item.name if r.item else None, "matched_by": r.matched_by,
        })
    return out
