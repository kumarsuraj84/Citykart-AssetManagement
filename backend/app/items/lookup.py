"""Small shared step: when a request names an Item, the Item decides the
Category and Sub-Category. Kept free of the rest of the Items service so the
asset, purchase-order and bundle code can all use it without import cycles."""
from sqlalchemy.ext.asyncio import AsyncSession
from app.items.models import Item


async def fill_from_item(session: AsyncSession, data: dict, *, keep_inactive_id: int | None = None) -> Item | None:
    """If `data` carries an `item_id`, loads that (active) Item and overwrites
    `category_id` / `subcategory_id` in `data` with the Item's own, so a client
    can never file an Item under a different Category. Returns the Item, or None
    when no Item was named (the caller then needs `category_id` itself).
    `keep_inactive_id`: an Item a line already has stays usable for that line even
    after it was deactivated (picking a deactivated Item afresh is refused)."""
    item_id = data.get("item_id")
    if item_id is None:
        return None
    item = await session.get(Item, item_id)
    if item is None or (not item.is_active and item_id != keep_inactive_id):
        raise ValueError(f"item {item_id} not found")
    data["category_id"] = item.category_id
    data["subcategory_id"] = item.subcategory_id
    return item
