"""Brands and work areas (IT / Non-IT): the one place that decides whether a brand may be used for a work area.

A brand lists the work areas it is used for (`Brand.work_areas`). A write path that gives something a brand -- an
Item's default brand, an asset, a PO line -- asks `ensure_brand_fits` with the work area of that Item / category, so a
Non-IT thing cannot be given a brand that is only set up for IT (the screens already list only the right brands; this
is the server saying no, whatever a client sends).

Only what a write path actually changes is checked: an old asset that already holds a brand keeps it, and an edit
that does not touch the brand never fails over it."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.capabilities import AREA_WORDS
from app.masters.models import AssetCategory, Brand

WHERE_TO_FIX = "in Settings › Catalogue › Brands (the head-office admin can add it), or choose another brand"


def area_word(domain: str | None) -> str:
    return AREA_WORDS.get(domain or "", domain or "this")


def areas_words(areas: list[str] | tuple[str, ...]) -> str:
    return " and ".join(area_word(a) for a in areas) or "no work area"


async def brand_fit_problem(session: AsyncSession, brand_id: int | None, domain: str | None) -> str | None:
    """A plain sentence when `brand_id` is not set up for `domain`, else None. A missing brand or an unknown
    work area is not this check's business (the callers check that the brand exists and is active)."""
    if brand_id is None or domain is None:
        return None
    brand = await session.get(Brand, brand_id)
    if brand is None or domain in (brand.work_areas or []):
        return None
    return (f"The brand {brand.name} is not set up for {area_word(domain)} things (it is used for "
            f"{areas_words(brand.work_areas or [])}). Add {area_word(domain)} to its Used for {WHERE_TO_FIX}.")


async def ensure_brand_fits(session: AsyncSession, brand_id: int | None, domain: str | None, label: str | None = None) -> None:
    """Raises ValueError with the sentence (the routers turn it into a 422) when the brand does not fit."""
    problem = await brand_fit_problem(session, brand_id, domain)
    if problem:
        raise ValueError(f"{label}: {problem}" if label else problem)


async def domain_of_category(session: AsyncSession, category_id: int | None) -> str | None:
    category = await session.get(AssetCategory, category_id) if category_id is not None else None
    return category.asset_domain if category is not None else None


async def removal_problem(session: AsyncSession, brand: Brand, removed: set[str]) -> str | None:
    """A sentence when taking `removed` work areas off `brand` would leave an active Item whose default brand it
    is without it (the Item's own link must never be left pointing at a brand that no longer fits), else None.
    Assets and PO lines that already hold the brand are history and are never a reason to refuse."""
    if not removed:
        return None
    from app.items.models import Item          # local: items imports masters
    rows = (await session.execute(
        select(Item.name, AssetCategory.asset_domain)
        .join(AssetCategory, AssetCategory.id == Item.category_id)
        .where(Item.default_brand_id == brand.id, Item.is_active.is_(True), AssetCategory.asset_domain.in_(sorted(removed)))
        .order_by(Item.name)
    )).all()
    if not rows:
        return None
    shown = ", ".join(name for name, _ in rows[:3]) + (f" and {len(rows) - 3} more" if len(rows) > 3 else "")
    where = areas_words(sorted({d for _, d in rows}))
    return (f"{brand.name} is the default brand of {len(rows)} {where} Item{'' if len(rows) == 1 else 's'} ({shown}), "
            f"so {where} cannot be taken off it. Change those Items' default brand first.")
