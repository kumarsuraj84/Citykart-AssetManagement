from datetime import date, datetime, timezone
from uuid import uuid4
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from app.assets.models import Asset, AssetFieldChange
from app.assets.service import compute_tax, procure_assets
from app.asset_users.models import AssetUser
from app.lifecycle.models import AssetEvent
from app.core.deps import check_work_area
from app.core.validation import MAX_QUANTITY
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Vendor
from app.items.lookup import fill_from_item
from app.masters.serial_rule import serial_default
from app.purchase_orders.models import PendingAsset, PurchaseOrder


async def compute_pi_status(session: AsyncSession, po_ids: list[int]) -> dict[int, dict]:
    """AM-19: one batched query for however many POs are being listed (never
    N+1 -- same discipline app.assets.router._page_label_maps already
    established). For each po_id: "NOT_DELIVERED" (nothing delivered yet),
    "PENDING" (>=1 delivered asset still has no PI Number), or "RECORDED"
    (every delivered asset has one) -- see PurchaseOrderOut's own docstring
    for why pi_number/pi_date are only ever populated when every delivered
    asset under that PO shares the exact same value."""
    if not po_ids:
        return {}
    stmt = (
        select(PendingAsset.purchase_order_id, Asset.pi_number, Asset.pi_date)
        .join(Asset, Asset.id == PendingAsset.delivered_asset_id)
        .where(PendingAsset.purchase_order_id.in_(po_ids), PendingAsset.delivered_asset_id.is_not(None))
    )
    rows = (await session.execute(stmt)).all()

    by_po: dict[int, list[tuple[str | None, date | None]]] = {}
    for po_id, pi_number, pi_date in rows:
        by_po.setdefault(po_id, []).append((pi_number, pi_date))

    result: dict[int, dict] = {}
    for po_id in po_ids:
        delivered = by_po.get(po_id, [])
        if not delivered:
            result[po_id] = {"pi_status": "NOT_DELIVERED", "pi_number": None, "pi_date": None}
            continue
        if any(pi_number is None or not pi_number.strip() for pi_number, _ in delivered):
            result[po_id] = {"pi_status": "PENDING", "pi_number": None, "pi_date": None}
            continue
        distinct = set(delivered)
        if len(distinct) == 1:
            pi_number, pi_date = next(iter(distinct))
            result[po_id] = {"pi_status": "RECORDED", "pi_number": pi_number, "pi_date": pi_date}
        else:
            result[po_id] = {"pi_status": "RECORDED", "pi_number": None, "pi_date": None}
    return result


async def active_or_error(session: AsyncSession, model, id_: int | None, what: str, *, allow_inactive_id: int | None = None):
    """S0.6: loads a master row a NEW transaction wants to use; refuses (as a
    plain sentence) one that does not exist or has been deactivated. History
    that already points at an inactive row stays readable -- this is only
    called for new choices. `allow_inactive_id`: the value the record already
    had (keeping an existing choice is not a new use)."""
    if id_ is None:
        return None
    obj = await session.get(model, id_)
    if obj is None:
        raise ValueError(f"The {what} you chose does not exist.")
    if not getattr(obj, "is_active", True) and id_ != allow_inactive_id:
        raise ValueError(f"The {what} {getattr(obj, 'name', '')} is no longer active; choose another.".replace("  ", " "))
    return obj


async def create_purchase_order(session: AsyncSession, data: dict, actor: AssetUser) -> PurchaseOrder:
    company = await session.get(Company, data["company_id"])
    if company is None or not company.is_active:
        raise ValueError("The company you chose does not exist or is no longer active.")
    cost_center = await active_or_error(session, CostCenter, data["cost_center_id"], "cost centre")
    if cost_center.company_id != data["company_id"]:
        raise ValueError("The cost centre must belong to the same company as the purchase order.")
    await active_or_error(session, Vendor, data.get("vendor_id"), "vendor")
    delivery_id = data.get("delivery_asset_user_id")
    if delivery_id is not None:
        delivery = await session.get(AssetUser, delivery_id)
        if delivery is None or not delivery.is_active:
            raise ValueError("The delivery location you chose does not exist or is no longer active.")
        if delivery.company_id != data["company_id"]:
            raise ValueError("The delivery location must belong to the same company as the purchase order.")
    # S0.5: a PO number is used once per company (trimmed, any letter case).
    number = (data.get("po_number") or "").strip()
    if not number:
        raise ValueError("PO number cannot be blank.")
    clash = (await session.execute(
        select(PurchaseOrder.id).where(
            PurchaseOrder.company_id == data["company_id"],
            func.lower(func.trim(PurchaseOrder.po_number)) == number.lower(),
            PurchaseOrder.is_active.is_(True),
        ).limit(1)
    )).scalar_one_or_none()
    if clash is not None:
        raise ValueError(f"Purchase order {number} already exists for this company.")
    po = PurchaseOrder(
        company_id=data["company_id"], po_number=number,
        po_date=data["po_date"], vendor_id=data.get("vendor_id"),
        cost_center_id=data["cost_center_id"],
        delivery_asset_user_id=delivery_id, warehouse_code=(data.get("warehouse_code") or None),
        erp_po_code=data.get("erp_po_code"),
        created_by=actor.id, updated_by=actor.id,
    )
    session.add(po)
    await session.flush()
    return po


# ---- S0.3 work area (IT / Non-IT) on purchase orders -----------------------
# A line's work area is its asset_domain snapshot (the Category's at line
# creation); a line without one (made before the snapshot existed) takes its
# Category's current one. A PO is visible to a user limited to one work area
# when it has at least one line (any status) in that area, or no lines at all
# yet (a fresh header must stay reachable so its lines can be added). A PO
# that mixes both areas is visible to both, but each user sees, adds, edits,
# cancels, delivers and records PI only for the lines/assets of their own area.

def line_area_of(line_alias=PendingAsset, category_alias=AssetCategory):
    return func.coalesce(line_alias.asset_domain, category_alias.asset_domain)


def po_visible_clause(domains: tuple[str, ...]):
    pa = aliased(PendingAsset)
    cat = aliased(AssetCategory)
    any_line = select(pa.id).where(pa.purchase_order_id == PurchaseOrder.id).exists()
    in_area = (
        select(pa.id).join(cat, cat.id == pa.category_id)
        .where(pa.purchase_order_id == PurchaseOrder.id, line_area_of(pa, cat).in_(domains))
        .exists()
    )
    return or_(~any_line, in_area)


async def po_is_visible(session: AsyncSession, po_id: int, domains: tuple[str, ...] | None) -> bool:
    if domains is None:
        return True
    found = (await session.execute(
        select(PurchaseOrder.id).where(PurchaseOrder.id == po_id, po_visible_clause(domains))
    )).first()
    return found is not None


async def line_area(session: AsyncSession, line: PendingAsset) -> str | None:
    if line.asset_domain:
        return line.asset_domain
    category = await session.get(AssetCategory, line.category_id)
    return category.asset_domain if category else None


def ensure_po_open(po: PurchaseOrder) -> None:
    """S0.6: a deleted purchase order takes no new lines, deliveries or PIs."""
    if not po.is_active:
        raise ValueError("This purchase order has been deleted, so nothing new can be recorded on it.")


async def _validate_line_masters(
    session: AsyncSession, data: dict, current: PendingAsset | None = None,
) -> tuple[AssetCategory, AssetSubcategory | None]:
    """Same referential checks procure_assets already does for category/
    subcategory -- duplicated narrowly here (not imported) because
    procure_assets validates a *complete* asset-creation payload (also
    requiring purchase_date/initial_asset_user_id/cost_center_id, none of which
    are picked at line-entry time -- cost centre lives on the parent PO,
    see create_purchase_order); this is the PO-entry-time subset only.
    Returns the resolved Category (asset_domain, spec §19) and Sub-Category
    (None when not chosen) so callers can derive from them without a second
    lookup. A line that names an Item takes its Category / Sub-Category from
    that Item (done by the caller through `fill_from_item`)."""
    if data.get("category_id") is None:
        raise ValueError("Choose an Item (or a category) for the line.")
    category = await active_or_error(session, AssetCategory, data["category_id"], "category",
                                     allow_inactive_id=current.category_id if current else None)
    subcategory_id = data.get("subcategory_id")
    subcategory = None
    if subcategory_id is not None:
        subcategory = await active_or_error(session, AssetSubcategory, subcategory_id, "sub-category",
                                            allow_inactive_id=current.subcategory_id if current else None)
        if subcategory.category_id != category.id:
            raise ValueError("The sub-category does not belong to the selected category.")
    await active_or_error(session, Brand, data.get("brand_id"), "brand",
                          allow_inactive_id=current.brand_id if current else None)
    return category, subcategory


async def add_pending_asset_line(
    session: AsyncSession, purchase_order: PurchaseOrder, data: dict, actor: AssetUser,
    allowed_domains: tuple[str, ...] | None = None,
) -> list[PendingAsset]:
    """quantity>1 creates that many separate PendingAsset rows (each will get
    its own distinct serial number at Delivery Done) -- mirrors
    procure_assets' own quantity handling, never one row with a count.
    `allowed_domains` (S0.3): the caller's work area; a line whose Category
    belongs to the other work area is refused (403)."""
    ensure_po_open(purchase_order)
    if purchase_order.cost_center_id is None:
        raise ValueError("This purchase order has no cost centre set.")
    quantity = data.get("quantity", 1)
    if not isinstance(quantity, int) or quantity < 1 or quantity > MAX_QUANTITY:
        # S0.2: also guards the internal callers (bundles, ERP create, ERP
        # change "add units", Excel PO import) that do not go through the schema.
        raise ValueError(f"Quantity must be between 1 and {MAX_QUANTITY}.")
    item = await fill_from_item(session, data)
    category, subcategory = await _validate_line_masters(session, data)
    check_work_area(allowed_domains, category.asset_domain, data.get("description"))
    purchase_cost = data.get("purchase_cost")
    tax_percent = data.get("tax_percent")
    tax_amount, total_cost = compute_tax(purchase_cost, tax_percent)
    # The delivery dialog starts with "No serial number" ticked for lines whose
    # Item carries none (a mouse). Only a default, snapshotted here; an explicit
    # value from the caller wins.
    serial_required = data.get("serial_required")
    if serial_required is None:
        serial_required = serial_default(item)

    created: list[PendingAsset] = []
    for _ in range(quantity):
        line = PendingAsset(
            purchase_order_id=purchase_order.id, company_id=purchase_order.company_id,
            description=data["description"], barcode=data.get("barcode"), category_id=data["category_id"],
            subcategory_id=data.get("subcategory_id"), cost_center_id=purchase_order.cost_center_id,
            brand_id=data.get("brand_id"), model=data.get("model"), warranty_years=data.get("warranty_years"),
            purchase_cost=purchase_cost, tax_percent=tax_percent,
            tax_amount=tax_amount, total_cost=total_cost, status="PENDING",
            # Spec §19: derived server-side from the selected Category at
            # line-creation time, same discipline as Asset.asset_domain.
            asset_domain=category.asset_domain,
            serial_required=serial_required, serial_later=bool(item and item.serial_later),
            bundle_label=data.get("bundle_label"),
            item_id=data.get("item_id"), erp_item_code=data.get("erp_item_code"),
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(line)
        created.append(line)
    await session.flush()
    return created


async def update_pending_asset_line(
    session: AsyncSession, line: PendingAsset, data: dict, actor: AssetUser,
    allowed_domains: tuple[str, ...] | None = None,
) -> PendingAsset:
    if line.status != "PENDING":
        raise ValueError(f"cannot edit a {line.status.lower()} line")
    # Picking another Item changes the line's kind; otherwise it keeps its own.
    changed_item = data.get("item_id") is not None and data["item_id"] != line.item_id
    if data.get("item_id") is None and line.item_id is not None:
        data = {**data, "item_id": line.item_id}
    item = await fill_from_item(session, data, keep_inactive_id=line.item_id)
    category, subcategory = await _validate_line_masters(session, data, current=line)
    check_work_area(allowed_domains, category.asset_domain)
    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))
    if changed_item:
        line.serial_required = serial_default(item)
        line.serial_later = bool(item and item.serial_later)
    if item is not None:
        line.item_id = item.id
    line.description = data["description"]
    line.barcode = data.get("barcode")
    line.category_id = data["category_id"]
    line.subcategory_id = data.get("subcategory_id")
    line.asset_domain = category.asset_domain
    line.brand_id = data.get("brand_id")
    line.model = data.get("model")
    line.warranty_years = data.get("warranty_years")
    line.purchase_cost = data.get("purchase_cost")
    line.tax_percent = data.get("tax_percent")
    line.tax_amount = tax_amount
    line.total_cost = total_cost
    line.updated_by = actor.id
    await session.flush()
    return line


async def cancel_pending_asset_line(session: AsyncSession, line: PendingAsset, actor: AssetUser) -> PendingAsset:
    if line.status != "PENDING":
        raise ValueError(f"cannot cancel a {line.status.lower()} line")
    line.status = "CANCELLED"
    line.updated_by = actor.id
    await session.flush()
    return line


async def delete_purchase_order(
    session: AsyncSession, po: PurchaseOrder, lines: list[PendingAsset], actor: AssetUser,
) -> dict:
    """Soft-deletes a wrongly-created PO: every still-PENDING line is
    cancelled, and the PO itself is deactivated. A DELIVERED line's own row
    is never touched -- PendingAsset is "frozen and kept as the
    traceability record" once delivered (see the model's own docstring) --
    but the real Asset it produced is soft-deleted too, using the exact
    same rule app.assets.router.delete_asset_entry_mistake already enforces
    for a single asset: only while that asset still has just its original
    PROCURED event. If ANY delivered asset has since moved/been repaired/
    disposed, that history is real, so the WHOLE deletion is refused (never
    a partial one) and the blocking asset(s) are named in the error, so the
    caller can go handle them individually first. The router is
    responsible for the actual authorization split (an ordinary
    WRITE_ROLES actor may only reach here when no line has been delivered
    yet; once one has, only the Primary Owner may)."""
    asset_ids = [line.delivered_asset_id for line in lines if line.delivered_asset_id is not None]
    assets: list[Asset] = []
    if asset_ids:
        assets = (await session.execute(select(Asset).where(Asset.id.in_(asset_ids)))).scalars().all()
        event_counts = dict((await session.execute(
            select(AssetEvent.asset_id, func.count())
            .where(AssetEvent.asset_id.in_(asset_ids))
            .group_by(AssetEvent.asset_id)
        )).all())
        moved = [a for a in assets if event_counts.get(a.id, 0) > 1]
        if moved:
            codes = ", ".join(a.asset_code for a in moved)
            raise ValueError(
                f"cannot delete: {len(moved)} delivered asset(s) have already moved beyond their original "
                f"delivery and must be handled individually first ({codes})"
            )

    cancelled = 0
    for line in lines:
        if line.status == "PENDING":
            line.status = "CANCELLED"
            line.updated_by = actor.id
            cancelled += 1

    now = datetime.now(timezone.utc)
    for asset in assets:
        asset.deleted_at = now
        asset.updated_by = actor.id

    po.is_active = False
    po.deleted_at = now
    po.updated_by = actor.id
    await session.flush()
    return {"cancelled_lines": cancelled, "deleted_assets": len(assets)}


async def deliver_pending_assets(
    session: AsyncSession, lines: list[PendingAsset], deliveries: dict[int, dict],
    po_number: str, po_date, vendor_id: int | None, invoice_number: str, invoice_date, invoice_amount: float,
    actor: AssetUser,
) -> list[PendingAsset]:
    """One procure_assets(..., quantity=1, ...) call per line -- each
    PendingAsset already represents exactly one physical unit with its own
    serial number, so quantity is always 1 here (never batched), unlike
    Add Asset's own "buying 20 identical mice" quantity case. purchase_date
    is set to invoice_date: the PO design's own point that the two are the
    same thing in this flow, since there is no earlier date to use.
    po_number/po_date/vendor_id come from the parent PurchaseOrder (the
    caller's job to supply) so the resulting Asset's own existing
    po_number/po_date/vendor_id columns (Add Asset already has and uses
    these) are populated too -- AM-17 §DEF-01: vendor_id was previously
    omitted here, so every PO-delivered asset silently got vendor_id=NULL
    even though the PO itself has a vendor.

    Each line is delivered inside its own savepoint (nested transaction) --
    one line's failure must not corrupt or partially commit any other
    already-succeeded line in the same batch."""
    delivered: list[PendingAsset] = []
    for line in lines:
        if line.status != "PENDING":
            what = {"DELIVERED": "already delivered", "CANCELLED": "cancelled"}.get(line.status, "not waiting for delivery")
            raise ValueError(f"One of the selected units ({line.description}) is {what}, so it cannot be delivered.")
        delivery = deliveries[line.id]
        async with session.begin_nested():
            [asset] = await procure_assets(
                session,
                {
                    "company_id": line.company_id, "cost_center_id": line.cost_center_id,
                    "category_id": line.category_id, "subcategory_id": line.subcategory_id,
                    "item_id": line.item_id, "erp_item_code": line.erp_item_code,
                    "description": line.description, "barcode": line.barcode, "purchase_cost": line.purchase_cost,
                    "tax_percent": line.tax_percent, "purchase_date": invoice_date,
                    "brand_id": line.brand_id, "model": line.model, "warranty_years": line.warranty_years,
                    "serial_number": delivery["serial_number"],
                    "serial_pending": bool(delivery.get("serial_pending")),
                    "initial_asset_user_id": delivery["initial_asset_user_id"],
                    "po_number": po_number, "po_date": po_date, "vendor_id": vendor_id,
                    "invoice_number": invoice_number, "invoice_date": invoice_date,
                    "invoice_amount": invoice_amount,
                },
                quantity=1, actor=actor,
            )
            line.status = "DELIVERED"
            line.serial_number = delivery["serial_number"]
            line.initial_asset_user_id = delivery["initial_asset_user_id"]
            line.invoice_number = invoice_number
            line.invoice_date = invoice_date
            line.invoice_amount = invoice_amount
            line.delivered_asset_id = asset.id
            line.delivered_at = datetime.now(timezone.utc)
            line.delivered_by = actor.id
        delivered.append(line)
    await session.flush()
    return delivered


async def record_pi_for_invoice(
    session: AsyncSession, purchase_order: PurchaseOrder, invoice_number: str,
    pi_number: str, pi_date: date, overwrite: bool, actor: AssetUser,
    allowed_domains: tuple[str, ...] | None = None,
) -> dict:
    """AM-19: PI Number/Date arrive from Finance well after delivery, and
    ground reality is one PO can be delivered across several invoices (a
    vendor's partial delivery), each getting its OWN PI later -- so this is
    keyed by (purchase_order, invoice_number), never the whole PO, and
    never a single flag on the PO itself. Applies to every Asset that was
    delivered under this exact PO+invoice combination (via the frozen
    pending_asset traceability rows, never a po_number/invoice_number
    string match, which could theoretically collide across POs).

    `overwrite=False` (the default, and the safer everyday choice): only
    fills in assets whose pi_number is still blank, leaving anything
    already entered untouched. `overwrite=True` is the deliberate,
    explicit escape hatch for fixing a typo across every asset from this
    invoice at once, instead of opening each one individually.

    Writes an ordinary (reason=NULL) AssetFieldChange row per field
    actually changed per asset, all sharing one request_id -- same
    audit-trail shape app.assets.audit_service.record_field_changes
    already uses for a single-asset edit, just applied across many assets
    in one call.

    S0.3: `allowed_domains` (the caller's work area; None = both) -- only
    the assets of that invoice inside the caller's work area are touched; the
    other work area's assets are left for someone who handles them. S0.6: a
    deleted PO takes no PI; soft-deleted assets are never touched."""
    ensure_po_open(purchase_order)
    stmt = select(PendingAsset).where(
        PendingAsset.purchase_order_id == purchase_order.id,
        PendingAsset.invoice_number == invoice_number,
        PendingAsset.delivered_asset_id.is_not(None),
    )
    lines = (await session.execute(stmt)).scalars().all()

    request_id = str(uuid4())
    updated: list[str] = []
    skipped: list[str] = []
    for line in lines:
        asset = await session.get(Asset, line.delivered_asset_id)
        if asset is None or asset.deleted_at is not None:
            continue
        if allowed_domains is not None and asset.asset_domain not in allowed_domains:
            continue
        already_set = bool((asset.pi_number or "").strip())
        if already_set and not overwrite:
            skipped.append(asset.asset_code)
            continue

        changes = [
            ("pi_number", asset.pi_number, pi_number),
            ("pi_date", asset.pi_date, pi_date),
        ]
        for field_name, old, new in changes:
            if old == new:
                continue
            session.add(AssetFieldChange(
                asset_id=asset.id, field_name=field_name,
                old_value=str(old) if old is not None else None,
                new_value=str(new) if new is not None else None,
                actor_id=actor.id, request_id=request_id,
            ))
        asset.pi_number = pi_number
        asset.pi_date = pi_date
        asset.updated_by = actor.id
        updated.append(asset.asset_code)

    await session.flush()
    return {"invoice_number": invoice_number, "updated": updated, "skipped": skipped}
