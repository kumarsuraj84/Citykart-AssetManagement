"""Items (CityKart's own names for what an asset is) and the rules that say which
Item an ERP item code belongs to. See docs/ai/ITEM_MODEL.md."""
import re
from dataclasses import dataclass
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.bundles.models import Bundle, BundlePart
from app.erp.source import ErpItem, ErpSource
from app.items.models import Item, ItemMap, LEVEL_TYPES, MATCH_TYPES
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company


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
    # The rule that matched says this code is not something CKAM tracks (then `item` is None).
    not_tracked: bool = False
    level_key: str | None = None            # the Department / Section / Division name, for a level rule

    @property
    def why_not_tracked(self) -> str | None:
        if not self.not_tracked:
            return None
        return f"{self.matched_by.title()} {self.level_key}" if self.level_key else (self.matched_by or "").title()


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
    if data.get("subcategory_id") is None:
        raise ValueError("an Item needs a sub-category")
    sub = await session.get(AssetSubcategory, data["subcategory_id"])
    if sub is None or sub.category_id != category.id:
        raise ValueError("the sub-category does not belong to the chosen category")
    if data.get("bundle_id") is not None:
        bundle = await session.get(Bundle, data["bundle_id"])
        if bundle is None or not bundle.is_active:
            raise ValueError("bundle not found")
        if item_id is not None and (await session.execute(
            select(BundlePart.id).where(BundlePart.item_id == item_id, BundlePart.is_active.is_(True)).limit(1)
        )).first() is not None:
            raise ValueError("this Item is a part of a bundle, so it cannot be a bundle itself")
    if data.get("default_brand_id") is not None and await session.get(Brand, data["default_brand_id"]) is None:
        raise ValueError("brand not found")


def _apply(item: Item, data: dict, actor: AssetUser) -> None:
    item.name = data["name"].strip()
    item.category_id = data["category_id"]
    item.subcategory_id = data.get("subcategory_id")
    item.serial_required = True if data.get("serial_required") is None else bool(data["serial_required"])
    # "Read later" only makes sense for something that has a serial.
    item.serial_later = bool(data.get("serial_later")) and item.serial_required
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
    counts = dict((await session.execute(
        select(ItemMap.item_id, func.count()).where(ItemMap.is_active.is_(True), ItemMap.item_id.is_not(None)).group_by(ItemMap.item_id)
    )).all())
    return [
        {
            "id": i.id, "name": i.name, "category_id": i.category_id, "subcategory_id": i.subcategory_id,
            "serial_required": i.serial_required, "serial_later": i.serial_later, "bundle_id": i.bundle_id, "default_brand_id": i.default_brand_id,
            "default_warranty_years": i.default_warranty_years, "is_active": i.is_active,
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

async def _active_maps(session: AsyncSession) -> list[tuple[ItemMap, Item | None]]:
    """The rules in force: an Item rule whose Item is active, and every "not tracked" rule (it has no Item)."""
    return list((await session.execute(
        select(ItemMap, Item).outerjoin(Item, Item.id == ItemMap.item_id)
        .where(ItemMap.is_active.is_(True), or_(ItemMap.not_tracked.is_(True), Item.is_active.is_(True)))
    )).all())


class _Rules:
    """The rules in force for one company, indexed by what they match."""

    def __init__(self, maps: list[tuple[ItemMap, Item | None]], company_id: int | None):
        mine = [(m, i) for m, i in maps if m.company_id in (None, company_id)]

        def index(match_type: str, key):
            table: dict = {}
            for m, i in sorted(mine, key=lambda mi: mi[0].company_id is not None):   # every-company first, so a company's rule overwrites it
                if m.match_type == match_type:
                    table[key(m)] = (m, i)
            return table

        self.code = index("CODE", lambda m: (m.erp_item_code or "").lower())
        self.name = index("NAME", lambda m: (m.article_key, m.name_key))
        self.article = index("ARTICLE", lambda m: m.article_key)
        self.department = index("DEPARTMENT", lambda m: norm(m.level_key))
        self.section = index("SECTION", lambda m: norm(m.level_key))
        self.division = index("DIVISION", lambda m: norm(m.level_key))

    @staticmethod
    def _resolution(hit: tuple[ItemMap, Item | None], how: str) -> Resolution:
        m, i = hit
        if m.not_tracked:
            return Resolution(item=None, matched_by=how, map_id=m.id, not_tracked=True, level_key=m.level_key)
        return Resolution(item=i, matched_by=how, map_id=m.id)

    def resolve(self, e: ErpItem) -> Resolution:
        """Most specific first: its own code, its product name inside its Article, its Article, then its
        Department, Section and Division (those three can only say "not tracked")."""
        hit, how = self.code.get(e.icode.lower()), "CODE"
        if hit is None and norm(e.name):
            hit, how = self.name.get((e.article_key, norm(e.name))), "NAME"
        if hit is None:
            hit, how = self.article.get(e.article_key), "ARTICLE"
        if hit is None and norm(e.department):
            hit, how = self.department.get(norm(e.department)), "DEPARTMENT"
        if hit is None and norm(e.section):
            hit, how = self.section.get(norm(e.section)), "SECTION"
        if hit is None and norm(e.division):
            hit, how = self.division.get(norm(e.division)), "DIVISION"
        return self._resolution(hit, how) if hit else Resolution(item=None)

    def resolve_article(self, article_key: str, department: str, section: str, division: str) -> Resolution:
        """What the Article as a whole resolves to (its own rule, else its Department, Section, Division)."""
        hit, how = self.article.get(article_key), "ARTICLE"
        if hit is None and norm(department):
            hit, how = self.department.get(norm(department)), "DEPARTMENT"
        if hit is None and norm(section):
            hit, how = self.section.get(norm(section)), "SECTION"
        if hit is None and norm(division):
            hit, how = self.division.get(norm(division)), "DIVISION"
        return self._resolution(hit, how) if hit else Resolution(item=None)


async def resolve_items(session: AsyncSession, erp_items: list[ErpItem], company_id: int | None = None) -> dict[str, Resolution]:
    """For each ERP item: the Item it belongs to, or that it is not tracked, found most specific first --
    its own code, then its product name inside its Article, then its Article, then its Department, Section
    and Division. Rules are per company (each company's ERP master is its own): at every step the company's
    own rule wins over an every-company rule, and another company's rule is never used."""
    rules = _Rules(await _active_maps(session), company_id)
    return {e.icode: rules.resolve(e) for e in erp_items}


async def upsert_map(session: AsyncSession, actor: AssetUser, data: dict) -> ItemMap:
    """Creates (or re-points) one rule. A rule is identified by what it matches,
    so mapping the same Article / name / code again just changes its Item, or
    turns it into (or back from) "not tracked". A Department / Section / Division
    rule can only be "not tracked"."""
    mt = data["match_type"]
    if mt not in MATCH_TYPES:
        raise ValueError(f"match_type must be one of {MATCH_TYPES}")
    not_tracked = bool(data.get("not_tracked"))
    item = None
    if not not_tracked:
        if mt in LEVEL_TYPES:
            raise ValueError(f"a {mt.title()} rule can only say \"not tracked\": one {mt.title()} is not one Item")
        item = await session.get(Item, data.get("item_id")) if data.get("item_id") is not None else None
        if item is None or not item.is_active:
            raise ValueError("Item not found")
    article_key = (data.get("article_key") or "").strip() or None
    name_key = norm(data.get("name_key")) or None
    level_key = (data.get("level_key") or "").strip() or None
    code = (data.get("erp_item_code") or "").strip() or None
    if mt == "CODE" and not code:
        raise ValueError("a code rule needs the ERP item code")
    if mt in ("ARTICLE", "NAME") and not article_key:
        raise ValueError("this rule needs the Article")
    if mt == "NAME" and not name_key:
        raise ValueError("a product-name rule needs the product name")
    if mt in LEVEL_TYPES and not level_key:
        raise ValueError(f"a {mt.title()} rule needs the {mt.title()} name")
    company_id = data.get("company_id")
    if company_id is not None and await session.get(Company, company_id) is None:
        raise ValueError("company not found")
    stmt = select(ItemMap).where(ItemMap.is_active.is_(True), ItemMap.match_type == mt)
    stmt = stmt.where(ItemMap.company_id.is_(None) if company_id is None else ItemMap.company_id == company_id)
    if mt == "CODE":
        stmt = stmt.where(func.lower(ItemMap.erp_item_code) == code.lower())
    elif mt == "ARTICLE":
        stmt = stmt.where(ItemMap.article_key == article_key)
    elif mt in LEVEL_TYPES:
        stmt = stmt.where(func.lower(ItemMap.level_key) == level_key.lower())
    else:
        stmt = stmt.where(ItemMap.article_key == article_key, ItemMap.name_key == name_key)
    rule = (await session.execute(stmt.limit(1))).scalar_one_or_none()
    if rule is None:
        rule = ItemMap(match_type=mt, created_by=actor.id, company_id=company_id,
                       article_key=article_key if mt not in ("CODE",) + LEVEL_TYPES else None,
                       name_key=name_key if mt == "NAME" else None, erp_item_code=code if mt == "CODE" else None,
                       level_key=level_key if mt in LEVEL_TYPES else None)
        session.add(rule)
    rule.not_tracked = not_tracked
    rule.item_id = None if not_tracked else item.id
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

async def _company_code(session: AsyncSession, company_id: int | None) -> str | None:
    company = await session.get(Company, company_id) if company_id is not None else None
    return company.erp_code if company else None


async def article_overview(session: AsyncSession, source: ErpSource, company_id: int | None = None) -> list[dict]:
    """Every Article that company has bought, with how it is mapped for that
    company and a suggested Item (the existing Item whose name shares the most
    words with the Article's name, department and sample product names)."""
    articles = await source.bought_articles(await _company_code(session, company_id))
    all_maps = await _active_maps(session)
    maps = [(m, i) for m, i in all_maps if m.company_id in (None, company_id)]
    rules = _Rules(all_maps, company_id)
    name_rules: dict[str, int] = {}
    code_rules: dict[str, int] = {}
    untracked_rules: dict[str, int] = {}          # code / product-name rules inside the Article that say "not tracked"
    for m, _ in maps:
        if m.match_type == "NAME" and m.article_key:
            name_rules[m.article_key] = name_rules.get(m.article_key, 0) + 1
        if m.match_type == "CODE" and m.article_key:
            code_rules[m.article_key] = code_rules.get(m.article_key, 0) + 1
        if m.not_tracked and m.match_type in ("NAME", "CODE") and m.article_key:
            untracked_rules[m.article_key] = untracked_rules.get(m.article_key, 0) + 1
    items = (await session.execute(select(Item).where(Item.is_active.is_(True)))).scalars().all()
    item_words = {i.id: _words(i.name) for i in items}
    out = []
    for a in articles:
        res = rules.resolve_article(a.article_key, a.department, a.section, a.division)
        mapped = res.item
        text_words = _words(" ".join([a.article_name, a.department, *a.samples]))
        suggestion, best = None, 0.0
        if mapped is None and not res.not_tracked:
            for i in items:
                words = item_words[i.id]
                score = len(words & text_words) / len(words) if words else 0
                if score > best:
                    suggestion, best = i, score
        out.append({
            "article_key": a.article_key, "article_name": a.article_name, "section": a.section, "department": a.department,
            "division": a.division, "codes": a.codes, "units": a.units, "lines": a.lines, "samples": a.samples,
            "icodes": a.icodes, "names": a.names,
            "item_id": mapped.id if mapped else None, "item_name": mapped.name if mapped else None,
            # "ITEM" (linked to an Item), "NOT_TRACKED" (the Article, or its Department / Section / Division, is not tracked), or null
            "decision": "ITEM" if mapped else ("NOT_TRACKED" if res.not_tracked else None),
            "not_tracked_by": res.why_not_tracked, "not_tracked_level": res.matched_by if res.not_tracked else None,
            "decision_map_id": res.map_id,
            "name_rules": name_rules.get(a.article_key, 0), "code_rules": code_rules.get(a.article_key, 0),
            "untracked_rules": untracked_rules.get(a.article_key, 0),
            "suggested_item_id": suggestion.id if suggestion and best >= 0.5 else None,
            "suggested_item_name": suggestion.name if suggestion and best >= 0.5 else None,
        })
    return out


async def group_overview(session: AsyncSession, source: ErpSource, level: str, company_id: int | None = None) -> list[dict]:
    """The Departments, Sections or Divisions that company has bought from, with how many Articles, codes and
    units each holds and whether the whole group is marked not tracked (so one click can clear a department)."""
    if level not in LEVEL_TYPES:
        raise ValueError(f"level must be one of {LEVEL_TYPES}")
    articles = await source.bought_articles(await _company_code(session, company_id))
    rules = _Rules(await _active_maps(session), company_id)
    table = getattr(rules, level.lower())
    field = level.lower()
    groups: dict[str, dict] = {}
    for a in articles:
        value = (getattr(a, field) or "").strip()
        if not value:
            continue
        g = groups.setdefault(norm(value), {"value": value, "articles": 0, "codes": 0, "units": 0.0, "section": a.section, "samples": []})
        g["articles"] += 1
        g["codes"] += a.codes
        g["units"] += a.units
        if len(g["samples"]) < 3:
            g["samples"].append(a.article_name)
    out = []
    for key, g in sorted(groups.items(), key=lambda kv: -kv[1]["codes"]):
        hit = table.get(key)
        out.append({**g, "level": level, "not_tracked": hit is not None and hit[0].not_tracked, "map_id": hit[0].id if hit else None})
    return out


async def article_code_overview(
    session: AsyncSession, source: ErpSource, article_key: str, company_id: int | None = None,
) -> list[dict]:
    """The codes of one Article that were bought (by that company), grouped by
    product name, with the Item each currently resolves to (and why)."""
    codes = await source.article_codes(article_key, await _company_code(session, company_id))
    erp = {e.icode: e for e in await source.items([c.icode for c in codes])}
    resolved = await resolve_items(session, list(erp.values()), company_id)
    out = []
    for c in codes:
        r = resolved.get(c.icode, Resolution(item=None))
        out.append({
            "icode": c.icode, "name": c.name, "name_key": norm(c.name), "description": c.description, "units": c.units, "lines": c.lines,
            "item_id": r.item.id if r.item else None, "item_name": r.item.name if r.item else None, "matched_by": r.matched_by,
            "not_tracked": r.not_tracked, "not_tracked_by": r.why_not_tracked, "map_id": r.map_id,
        })
    return out
