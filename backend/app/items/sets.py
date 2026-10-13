"""S6: an Item and its set (bundle) saved in ONE call and one transaction.

`POST /api/items` and `PUT /api/items/{id}` accept `set_parts: [{name, item_id, share_percent}]`. The set is
created / updated through the existing bundles service (`create_bundle` / `update_bundle` -- the same
validation: at least one part, distinct part names, every part an active single Item with a sub-category,
shares adding up to exactly 100), then the Item points at it. Nothing is committed here: the caller commits
the Item and its set together, or rolls both back.

Who may: whoever may save the Item (ADMIN / OPERATOR create in their own work area; an ADMIN of the Item's
work area edits). Every part must be an Item of the caller's own work area (403 otherwise). The /bundles
screens themselves (create / edit / remove any set) stay head-office-admin only.

Rules kept simple on purpose:
* a new set is named after the Item; a set of that name that already exists is refused (never taken over);
* on an edit, the Item's own set is updated in place (parts matched by name keep their identity) and keeps
  its name; a set that other active Items also use is refused (it is changed on the Sets screen);
* `bundle_id` together with `set_parts` is refused unless it is the Item's own set.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bundles.models import Bundle, BundlePart
from app.bundles.service import _name_in_use, create_bundle, update_bundle
from app.core.capabilities import ensure_domain_manage, ensure_item_create
from app.items.models import Item
from app.masters.models import AssetCategory

BOTH_GIVEN = "Choose an existing set or list the set's parts, not both."
NO_PARTS = "A set needs at least one part."
OWN_PART = "An Item cannot be a part of its own set."


def _refuse(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, message)


async def check_set_request(
    session: AsyncSession, actor, parts: list[dict], *, item: Item | None, bundle_id: int | None, creating: bool,
) -> None:
    """Checks that need no write: the request's shape, and the work area of every part (403). The bundles
    service checks the rest (active, single Item, sub-category, shares) when the set is saved."""
    if bundle_id is not None and (item is None or bundle_id != item.bundle_id):
        raise _refuse(BOTH_GIVEN)
    if not parts:
        raise _refuse(NO_PARTS)
    part_ids = {p["item_id"] for p in parts}
    if item is not None and item.id in part_ids:
        raise _refuse(OWN_PART)
    rows = (await session.execute(
        select(Item.id, AssetCategory.asset_domain).join(AssetCategory, AssetCategory.id == Item.category_id)
        .where(Item.id.in_(part_ids))
    )).all()
    ensure = ensure_item_create if creating else ensure_domain_manage
    for domain in sorted({domain for _, domain in rows if domain is not None}):
        await ensure(session, actor, domain)


def parts_summary(parts: list[tuple[str, float]]) -> str | None:
    """"CPU 70%, TFT 30%" -- the readable value written to the Item's audit trail."""
    if not parts:
        return None
    return ", ".join(f"{name} {float(share):g}%" for name, share in parts)


async def current_parts(session: AsyncSession, item: Item) -> list[tuple[str, float]]:
    if item.bundle_id is None:
        return []
    rows = (await session.execute(
        select(BundlePart.name, BundlePart.share_percent)
        .where(BundlePart.bundle_id == item.bundle_id, BundlePart.is_active.is_(True))
        .order_by(BundlePart.sort_order, BundlePart.id)
    )).all()
    return [(name, float(share)) for name, share in rows]


async def save_set(session: AsyncSession, actor, parts: list[dict], *, item_name: str, item: Item | None) -> int:
    """Creates the Item's set (named after the Item) or updates the Item's own set; returns its id. Raises
    ValueError (plain sentence) for anything the bundles service refuses; flushes, never commits."""
    parts = [{"name": p["name"], "item_id": p["item_id"], "share_percent": p["share_percent"]} for p in parts]
    bundle = await session.get(Bundle, item.bundle_id) if item is not None and item.bundle_id is not None else None
    if bundle is not None and bundle.is_active:
        others = (await session.execute(
            select(Item.name).where(Item.bundle_id == bundle.id, Item.is_active.is_(True), Item.id != item.id)
            .order_by(Item.name).limit(3)
        )).scalars().all()
        if others:
            raise ValueError(
                f"The set {bundle.name} is also used by {', '.join(others)}, so it cannot be changed from this Item. "
                "Ask the head-office admin to change it on the Sets screen."
            )
        existing = {
            name.strip().lower(): pid for pid, name in (await session.execute(
                select(BundlePart.id, BundlePart.name).where(BundlePart.bundle_id == bundle.id, BundlePart.is_active.is_(True))
            )).all()
        }
        for p in parts:
            p["id"] = existing.get(p["name"].strip().lower())
        await update_bundle(session, bundle, {"name": bundle.name, "parts": parts}, actor)
        return bundle.id
    name = item_name.strip()
    if await _name_in_use(session, name, None):
        raise ValueError(f"A set named {name} already exists. Choose it as this Item's set, or give the Item another name.")
    bundle = await create_bundle(session, {"name": name, "parts": parts}, actor)
    return bundle.id
