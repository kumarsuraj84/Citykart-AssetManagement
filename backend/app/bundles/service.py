from decimal import ROUND_HALF_UP, Decimal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.bundles.models import Bundle, BundlePart
from app.core.validation import MAX_QUANTITY
from app.items.models import Item
from app.masters.serial_rule import serial_default
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import add_pending_asset_line

CENT = Decimal("0.01")
TOLERANCE = Decimal("0.005")


def split_amounts(price: Decimal, shares: list[Decimal]) -> list[Decimal]:
    """Each part's amount = price x share%, rounded to paise; whatever paise are
    left over (or over-allocated) after rounding go to the part with the
    largest share (the first one on a tie), so the parts add up to `price`
    exactly -- before and, since every part carries the same tax %, after tax."""
    amounts = [(price * s / Decimal(100)).quantize(CENT, rounding=ROUND_HALF_UP) for s in shares]
    diff = price.quantize(CENT, rounding=ROUND_HALF_UP) - sum(amounts)
    if diff != 0:
        biggest = max(range(len(shares)), key=lambda i: (shares[i], -i))
        amounts[biggest] += diff
    return amounts


async def _validate_bundle_input(session: AsyncSession, data: dict, kept_item_ids: frozenset[int] = frozenset()) -> dict[int, Item]:
    """Checks the bundle and returns its parts' Items by id. `kept_item_ids` are
    Items the bundle already uses: they stay valid even if deactivated since."""
    if not data["name"].strip():
        raise ValueError("bundle name is required")
    parts = data["parts"]
    if not parts:
        raise ValueError("a bundle needs at least one part")
    names = [p["name"].strip().lower() for p in parts]
    if any(not n for n in names):
        raise ValueError("every part needs a name")
    if len(set(names)) != len(names):
        raise ValueError("part names must be different from each other")
    total = Decimal(0)
    items: dict[int, Item] = {}
    for p in parts:
        share = Decimal(str(p["share_percent"]))
        if share <= 0 or share > 100:
            raise ValueError(f"share for {p['name']!r} must be more than 0 and at most 100")
        total += share
        item = await session.get(Item, p["item_id"])
        if item is None or (not item.is_active and item.id not in kept_item_ids):
            raise ValueError(f"the Item for {p['name']!r} was not found")
        if item.bundle_id is not None:
            raise ValueError(f"{item.name!r} is itself a bundle; a part must be a single thing such as CPU or Mouse")
        if item.subcategory_id is None:
            raise ValueError(f"{item.name!r} has no sub-category; set one on the Item first")
        items[item.id] = item
    if abs(total - Decimal(100)) > TOLERANCE:
        raise ValueError(f"the shares add up to {total}%, they must add up to exactly 100%")
    return items


async def _name_in_use(session: AsyncSession, name: str, exclude_id: int | None) -> bool:
    rows = (await session.execute(select(Bundle).where(Bundle.is_active.is_(True)))).scalars().all()
    return any(b.name.strip().lower() == name.strip().lower() and b.id != exclude_id for b in rows)


async def list_bundles(session: AsyncSession) -> list[dict]:
    bundles = (await session.execute(
        select(Bundle).where(Bundle.is_active.is_(True)).order_by(Bundle.name)
    )).scalars().all()
    if not bundles:
        return []
    parts = (await session.execute(
        select(BundlePart)
        .where(BundlePart.bundle_id.in_([b.id for b in bundles]), BundlePart.is_active.is_(True))
        .order_by(BundlePart.sort_order, BundlePart.id)
    )).scalars().all()
    item_ids = {p.item_id for p in parts if p.item_id is not None}
    items = {i.id: i for i in (await session.execute(select(Item).where(Item.id.in_(item_ids)))).scalars().all()} if item_ids else {}
    by_bundle: dict[int, list[dict]] = {}
    for p in parts:
        item = items.get(p.item_id)
        by_bundle.setdefault(p.bundle_id, []).append({
            "id": p.id, "name": p.name, "item_id": p.item_id, "item_name": item.name if item else None,
            "category_id": p.category_id, "subcategory_id": p.subcategory_id,
            "serial_required": serial_default(item),
            "share_percent": p.share_percent, "sort_order": p.sort_order,
        })
    return [{"id": b.id, "name": b.name, "is_active": b.is_active, "parts": by_bundle.get(b.id, [])} for b in bundles]


def _apply_part(part: BundlePart, p: dict, item: Item, order: int, actor: AssetUser) -> None:
    part.name = p["name"].strip()
    part.item_id = item.id
    part.category_id = item.category_id
    part.subcategory_id = item.subcategory_id
    part.share_percent = Decimal(str(p["share_percent"])).quantize(CENT)
    part.sort_order = order
    part.updated_by = actor.id


async def create_bundle(session: AsyncSession, data: dict, actor: AssetUser) -> Bundle:
    items = await _validate_bundle_input(session, data)
    if await _name_in_use(session, data["name"], None):
        raise ValueError(f"a bundle named {data['name'].strip()!r} already exists")
    bundle = Bundle(name=data["name"].strip(), created_by=actor.id, updated_by=actor.id)
    session.add(bundle)
    await session.flush()
    for order, p in enumerate(data["parts"]):
        part = BundlePart(bundle_id=bundle.id, created_by=actor.id)
        _apply_part(part, p, items[p["item_id"]], order, actor)
        session.add(part)
    await session.flush()
    return bundle


async def update_bundle(session: AsyncSession, bundle: Bundle, data: dict, actor: AssetUser) -> Bundle:
    """Parts are matched by id: listed parts are updated (or added when they
    have no id), parts left out are deactivated, never deleted -- lines
    already made from them keep pointing at real, readable history."""
    existing = {
        p.id: p for p in (await session.execute(
            select(BundlePart).where(BundlePart.bundle_id == bundle.id, BundlePart.is_active.is_(True))
        )).scalars().all()
    }
    items = await _validate_bundle_input(session, data, frozenset(p.item_id for p in existing.values() if p.item_id))
    if await _name_in_use(session, data["name"], bundle.id):
        raise ValueError(f"a bundle named {data['name'].strip()!r} already exists")
    keep: set[int] = set()
    for order, p in enumerate(data["parts"]):
        if p.get("id") is not None:
            part = existing.get(p["id"])
            if part is None:
                raise ValueError(f"part {p['id']} does not belong to this bundle")
            keep.add(part.id)
        else:
            part = BundlePart(bundle_id=bundle.id, created_by=actor.id)
            session.add(part)
        _apply_part(part, p, items[p["item_id"]], order, actor)
    for pid, part in existing.items():
        if pid not in keep:
            part.is_active = False
            part.updated_by = actor.id
    bundle.name = data["name"].strip()
    bundle.updated_by = actor.id
    await session.flush()
    return bundle


async def deactivate_bundle(session: AsyncSession, bundle: Bundle, actor: AssetUser) -> None:
    bundle.is_active = False
    bundle.updated_by = actor.id
    await session.flush()


async def add_bundle_lines(
    session: AsyncSession, po: PurchaseOrder, data: dict, actor: AssetUser,
    allowed_domains: tuple[str, ...] | None = None,
) -> list[PendingAsset]:
    """Expands `quantity` bundles into ordinary PO lines, one per part (each
    `quantity` units, under that part's own category/sub-category), all or
    nothing. Nothing about a bundle survives into the Asset Register: the
    parts become normal assets at Delivery Done; the PendingAsset only keeps a
    `bundle_label` tag and the serial default its category/sub-category gives
    (derived by add_pending_asset_line)."""
    bundle = await session.get(Bundle, data["bundle_id"])
    if bundle is None or not bundle.is_active:
        raise ValueError("The bundle you chose does not exist or is no longer active.")
    quantity = data.get("quantity", 1)
    if not isinstance(quantity, int) or quantity < 1 or quantity > MAX_QUANTITY:
        raise ValueError(f"Quantity must be between 1 and {MAX_QUANTITY}.")
    parts = (await session.execute(
        select(BundlePart)
        .where(BundlePart.bundle_id == bundle.id, BundlePart.is_active.is_(True))
        .order_by(BundlePart.sort_order, BundlePart.id)
    )).scalars().all()
    if not parts:
        raise ValueError("this bundle has no parts")
    base_barcode = (data.get("barcode") or "").strip()
    if not base_barcode:
        raise ValueError("barcode is required")
    description = data["description"].strip()
    if not description:
        raise ValueError("description is required")

    price = Decimal(str(data["price"]))
    amounts = split_amounts(price, [Decimal(str(p.share_percent)) for p in parts])
    overrides = data.get("parts")
    if overrides:
        given = {o["part_id"]: Decimal(str(o["amount"])) for o in overrides}
        if set(given) != {p.id for p in parts} or len(given) != len(overrides):
            raise ValueError("an amount is needed for every part of the bundle, once each")
        if any(a <= 0 for a in given.values()):
            raise ValueError("every part amount must be more than 0")
        total = sum(given.values())
        if abs(total - price) > TOLERANCE:
            raise ValueError(f"the part amounts add up to {total}, not the bundle price {price}")
        amounts = [given[p.id] for p in parts]

    # S2.4: each part is its own PO line (one line number per part, shared by
    # that part's units of every bundle added here). `line_nos` (part name ->
    # line number) adds the units to a part's existing line instead -- used
    # when the ERP raises the quantity of a bundle already on the PO.
    line_nos: dict[str, int] = data.get("line_nos") or {}
    created: list[PendingAsset] = []
    for part, amount in zip(parts, amounts):
        created.extend(await add_pending_asset_line(session, po, {
            "description": f"{description} - {part.name}",
            "barcode": base_barcode,  # the same item barcode on every part of the bundle
            # The part's Item (CPU, TFT...) decides category and serial default; a
            # part that predates Items falls back on its own category/sub-category.
            "item_id": part.item_id,
            "category_id": part.category_id,
            "subcategory_id": part.subcategory_id,
            "warranty_years": data.get("warranty_years", 0),
            "purchase_cost": float(amount),
            "tax_percent": data.get("tax_percent", 0),
            "quantity": data["quantity"],
            "bundle_label": bundle.name,
            "erp_item_code": data.get("erp_item_code"),
            "line_no": line_nos.get(part.name),
        }, actor, allowed_domains=allowed_domains))
    return created
