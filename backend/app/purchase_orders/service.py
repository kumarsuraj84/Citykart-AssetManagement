from datetime import date, datetime, timezone
from uuid import uuid4
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from app.assets.models import Asset, AssetFieldChange
from app.assets.service import compute_tax, procure_assets
from app.asset_users.models import AssetUser
from app.core.deps import check_work_area
from app.core.validation import MAX_QUANTITY, escape_like
from app.items.models import Item
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


async def next_line_no(session: AsyncSession, po_id: int) -> int:
    """S2.4: the number the next new line of this purchase order gets (1..n).
    The single place every creation path takes a line number from (manual
    line, bundle parts, ERP create, Excel PO import). The PO row is locked for
    the rest of the transaction, so two people adding lines to the same PO at
    the same moment never get the same number."""
    await session.execute(select(PurchaseOrder.id).where(PurchaseOrder.id == po_id).with_for_update())
    current = (await session.execute(
        select(func.max(PendingAsset.line_no)).where(PendingAsset.purchase_order_id == po_id)
    )).scalar_one_or_none()
    return (current or 0) + 1


LINE_NATURAL_KEY = (
    "item_id", "erp_item_code", "description", "barcode", "category_id", "subcategory_id", "brand_id",
    "model", "warranty_years", "purchase_cost", "tax_percent", "bundle_label",
)


async def number_unnumbered_units(session: AsyncSession, po_id: int) -> int:
    """Forward-compat safety net: gives units that have no line number yet
    (only possible for rows written outside the normal creation paths) one,
    grouped by the same rule the migration used, after the PO's highest
    number. Returns how many units were numbered (normally 0)."""
    rows = (await session.execute(
        select(PendingAsset).where(PendingAsset.purchase_order_id == po_id, PendingAsset.line_no.is_(None))
        .order_by(PendingAsset.id)
    )).scalars().all()
    if not rows:
        return 0
    start = await next_line_no(session, po_id)
    numbers: dict[tuple, int] = {}
    for row in rows:
        key = tuple(getattr(row, name) for name in LINE_NATURAL_KEY)
        if key not in numbers:
            numbers[key] = start + len(numbers)
        row.line_no = numbers[key]
    await session.flush()
    return len(rows)


async def add_pending_asset_line(
    session: AsyncSession, purchase_order: PurchaseOrder, data: dict, actor: AssetUser,
    allowed_domains: tuple[str, ...] | None = None,
) -> list[PendingAsset]:
    """quantity>1 creates that many separate PendingAsset rows (each will get
    its own distinct serial number at Delivery Done) -- mirrors
    procure_assets' own quantity handling, never one row with a count.
    `allowed_domains` (S0.3): the caller's work area; a line whose Category
    belongs to the other work area is refused (403).
    S2.4: every unit of this call shares one line number -- `data["line_no"]`
    when the caller adds units to an existing line, else the PO's next one."""
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
    serial_later = data.get("serial_later")
    if serial_later is None:
        serial_later = bool(item and item.serial_later)
    line_no = data.get("line_no") or await next_line_no(session, purchase_order.id)

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
            serial_required=serial_required, serial_later=serial_later,
            bundle_label=data.get("bundle_label"), line_no=line_no,
            item_id=data.get("item_id"), erp_item_code=data.get("erp_item_code"),
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(line)
        created.append(line)
    await session.flush()
    return created


async def _line_edit_values(
    session: AsyncSession, current: PendingAsset, data: dict, allowed_domains: tuple[str, ...] | None,
) -> dict:
    """The column values an edit of a waiting line gives its units (shared by
    the per-unit edit and the S2.1 whole-line edit, so both validate alike).
    `current` is the unit (or, for a whole line, its template unit) the edit
    starts from: choices it already has stay valid even if deactivated since."""
    # Picking another Item changes the line's kind; otherwise it keeps its own.
    changed_item = data.get("item_id") is not None and data["item_id"] != current.item_id
    if data.get("item_id") is None and current.item_id is not None:
        data = {**data, "item_id": current.item_id}
    item = await fill_from_item(session, data, keep_inactive_id=current.item_id)
    category, _subcategory = await _validate_line_masters(session, data, current=current)
    check_work_area(allowed_domains, category.asset_domain)
    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))
    values = {
        "description": data["description"], "barcode": data.get("barcode"),
        "category_id": data["category_id"], "subcategory_id": data.get("subcategory_id"),
        "asset_domain": category.asset_domain, "brand_id": data.get("brand_id"), "model": data.get("model"),
        "warranty_years": data.get("warranty_years"), "purchase_cost": data.get("purchase_cost"),
        "tax_percent": data.get("tax_percent"), "tax_amount": tax_amount, "total_cost": total_cost,
    }
    if changed_item:
        values["serial_required"] = serial_default(item)
        values["serial_later"] = bool(item and item.serial_later)
    if item is not None:
        values["item_id"] = item.id
    return values


async def update_pending_asset_line(
    session: AsyncSession, line: PendingAsset, data: dict, actor: AssetUser,
    allowed_domains: tuple[str, ...] | None = None,
) -> PendingAsset:
    """Edits ONE waiting unit. It keeps its line number (S2.4)."""
    if line.status != "PENDING":
        raise ValueError(f"cannot edit a {line.status.lower()} line")
    values = await _line_edit_values(session, line, data, allowed_domains)
    for name, value in values.items():
        setattr(line, name, value)
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
    cancelled, and the PO itself is deactivated.

    S2 (owner requirement): a PO that has ANY received (delivered) unit is
    never deleted, by anyone -- not even the head-office admin -- because
    its received items are real assets in the register and must never be
    lost with it. The caller is told to cancel the waiting items instead
    (POST /api/purchase-orders/{id}/cancel-waiting), which keeps the PO and
    its assets. Assets are never soft-deleted from here any more;
    `deleted_assets` stays in the response (always 0) for compatibility."""
    if any(line.status == "DELIVERED" for line in lines):
        raise ValueError(DELETE_REFUSED_RECEIVED)

    cancelled = 0
    for line in lines:
        if line.status == "PENDING":
            line.status = "CANCELLED"
            line.updated_by = actor.id
            cancelled += 1

    now = datetime.now(timezone.utc)
    po.is_active = False
    po.deleted_at = now
    po.updated_by = actor.id
    await session.flush()
    return {"cancelled_lines": cancelled, "deleted_assets": 0}


DELETE_REFUSED_RECEIVED = (
    "This purchase order already has received items, so it cannot be deleted; its received assets "
    "must stay in the register. Cancel the waiting items instead."
)


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


# ---- S2.1 / S2.3: a purchase order by LINE, and its progress ---------------
# A line = every unit sharing one line_no (S2.4). Counts are always taken over
# the units the caller may see (S0.3 work area): someone limited to IT sees,
# counts, edits and cancels only the IT units of a mixed PO.

PO_STATUSES = ("WAITING", "PARTLY_RECEIVED", "RECEIVED", "CANCELLED")
# Business words accepted for a unit-status filter, and the stored values.
UNIT_STATUS_FILTER = {
    "WAITING": "PENDING", "PENDING": "PENDING", "RECEIVED": "DELIVERED", "DELIVERED": "DELIVERED",
    "CANCELLED": "CANCELLED",
}
# The fields a line is entered with, that a whole-line edit may change.
LINE_EDIT_FIELDS = (
    "description", "barcode", "item_id", "category_id", "subcategory_id", "brand_id", "model",
    "warranty_years", "purchase_cost", "tax_percent",
)


def derive_status(received: int, waiting: int, cancelled: int) -> str:
    """WAITING / PARTLY_RECEIVED / RECEIVED / CANCELLED for a line or a PO:
    everything cancelled = CANCELLED; nothing waiting = RECEIVED; something
    received and something waiting = PARTLY_RECEIVED; otherwise WAITING (a
    PO with no lines yet is WAITING)."""
    if received == 0 and waiting == 0:
        return "CANCELLED" if cancelled > 0 else "WAITING"
    if waiting == 0:
        return "RECEIVED"
    if received > 0:
        return "PARTLY_RECEIVED"
    return "WAITING"


def status_case(received, waiting, cancelled):
    """The SQL twin of derive_status (used to filter the PO list in the database)."""
    return case(
        ((received + waiting == 0) & (cancelled > 0), "CANCELLED"),
        (received + waiting == 0, "WAITING"),
        (waiting == 0, "RECEIVED"),
        (received > 0, "PARTLY_RECEIVED"),
        else_="WAITING",
    )


def serial_mode_of(serial_required: bool, serial_later: bool) -> str:
    if serial_later:
        return "SERIAL_LATER"
    return "HAS_SERIAL" if serial_required else "NO_SERIAL"


def _in_area(stmt, domains: tuple[str, ...] | None):
    """Adds the work-area filter to a select that already joins AssetCategory."""
    return stmt if domains is None else stmt.where(line_area_of().in_(domains))


async def _load_groups(
    session: AsyncSession, po_id: int, domains: tuple[str, ...] | None, line_no: int | None = None,
) -> list[dict]:
    """Two aggregate queries per PO (never one per unit): the counts per line,
    and one template unit per line (DISTINCT ON) with its names. The template
    is the newest waiting unit, else the newest received, else the newest
    cancelled one -- after a whole-line edit every waiting unit holds the
    line's current values."""
    counts_stmt = (
        select(
            PendingAsset.line_no,
            func.count().filter(PendingAsset.status == "DELIVERED"),
            func.count().filter(PendingAsset.status == "PENDING"),
            func.count().filter(PendingAsset.status == "CANCELLED"),
            func.coalesce(func.sum(PendingAsset.total_cost).filter(PendingAsset.status != "CANCELLED"), 0),
        )
        .join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
        .where(PendingAsset.purchase_order_id == po_id, PendingAsset.line_no.is_not(None))
        .group_by(PendingAsset.line_no)
    )
    status_order = case((PendingAsset.status == "PENDING", 0), (PendingAsset.status == "DELIVERED", 1), else_=2)
    template_stmt = (
        select(PendingAsset, Item.name, AssetCategory.name, AssetSubcategory.name, Brand.name, line_area_of())
        .join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
        .outerjoin(AssetSubcategory, AssetSubcategory.id == PendingAsset.subcategory_id)
        .outerjoin(Item, Item.id == PendingAsset.item_id)
        .outerjoin(Brand, Brand.id == PendingAsset.brand_id)
        .where(PendingAsset.purchase_order_id == po_id, PendingAsset.line_no.is_not(None))
        .distinct(PendingAsset.line_no)
        .order_by(PendingAsset.line_no, status_order, PendingAsset.id.desc())
        .execution_options(populate_existing=True)
    )
    if line_no is not None:
        counts_stmt = counts_stmt.where(PendingAsset.line_no == line_no)
        template_stmt = template_stmt.where(PendingAsset.line_no == line_no)
    counts = {
        row[0]: (row[1], row[2], row[3], row[4])
        for row in (await session.execute(_in_area(counts_stmt, domains))).all()
    }
    groups = []
    for unit, item_name, category_name, subcategory_name, brand_name, area in (
        await session.execute(_in_area(template_stmt, domains))
    ).all():
        received, waiting, cancelled, value = counts.get(unit.line_no, (0, 0, 0, 0))
        groups.append({
            "template": unit, "item_name": item_name, "category_name": category_name,
            "subcategory_name": subcategory_name, "brand_name": brand_name, "work_area": area,
            "received": received, "waiting": waiting, "cancelled": cancelled, "value": value,
        })
    return groups


def _group_out(group: dict) -> dict:
    unit: PendingAsset = group["template"]
    received, waiting, cancelled = group["received"], group["waiting"], group["cancelled"]
    return {
        "line_no": unit.line_no, "item_id": unit.item_id, "item_name": group["item_name"],
        "description": unit.description, "barcode": unit.barcode, "erp_item_code": unit.erp_item_code,
        "category_id": unit.category_id, "category_name": group["category_name"],
        "subcategory_id": unit.subcategory_id, "subcategory_name": group["subcategory_name"],
        "work_area": group["work_area"], "brand_id": unit.brand_id, "brand_name": group["brand_name"],
        "model": unit.model, "warranty_years": unit.warranty_years,
        "rate": float(unit.purchase_cost) if unit.purchase_cost is not None else None,
        "tax_percent": float(unit.tax_percent) if unit.tax_percent is not None else None,
        "unit_total": float(unit.total_cost) if unit.total_cost is not None else None,
        "ordered": received + waiting, "received": received, "waiting": waiting, "cancelled": cancelled,
        "line_value": round(float(group["value"] or 0), 2),
        "status": derive_status(received, waiting, cancelled),
        "serial_mode": serial_mode_of(unit.serial_required, unit.serial_later),
        "bundle_label": unit.bundle_label, "waiting_unit_count": waiting,
    }


async def line_groups(
    session: AsyncSession, po_id: int, domains: tuple[str, ...] | None, line_no: int | None = None,
) -> list[dict]:
    """GET /purchase-orders/{id}/line-groups: one entry per line, in line order."""
    return [_group_out(g) for g in await _load_groups(session, po_id, domains, line_no)]


async def line_group_units(
    session: AsyncSession, po_id: int, line_no: int, domains: tuple[str, ...] | None, status: str | None = None,
) -> list[PendingAsset]:
    stmt = (
        select(PendingAsset).join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
        .where(PendingAsset.purchase_order_id == po_id, PendingAsset.line_no == line_no)
        .order_by(PendingAsset.id).execution_options(populate_existing=True)
    )
    if status is not None:
        stmt = stmt.where(PendingAsset.status == status)
    return list((await session.execute(_in_area(stmt, domains))).scalars().all())


def _waiting_ids_stmt(po_id: int, domains: tuple[str, ...] | None, line_no: int | None = None):
    stmt = (
        select(PendingAsset.id).join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
        .where(PendingAsset.purchase_order_id == po_id, PendingAsset.status == "PENDING")
    )
    if line_no is not None:
        stmt = stmt.where(PendingAsset.line_no == line_no)
    return _in_area(stmt, domains)


async def cancel_waiting_units(
    session: AsyncSession, po: PurchaseOrder, actor: AssetUser, domains: tuple[str, ...] | None,
    line_no: int | None = None, quantity: int | None = None,
) -> int:
    """Cancels `quantity` (default: all) waiting units of one line (or of the
    whole PO when `line_no` is None) that the caller may see, the most
    recently added first. Received and already-cancelled units are never
    touched; the PO itself stays. Returns how many were cancelled."""
    ensure_po_open(po)
    stmt = _waiting_ids_stmt(po.id, domains, line_no).order_by(PendingAsset.id.desc())
    if quantity is not None:
        stmt = stmt.limit(quantity)
    ids = list((await session.execute(stmt)).scalars().all())
    if not ids:
        return 0
    await session.execute(
        update(PendingAsset)
        .where(PendingAsset.id.in_(ids), PendingAsset.status == "PENDING")
        .values(status="CANCELLED", updated_by=actor.id)
    )
    await session.flush()
    return len(ids)


async def update_line_group(
    session: AsyncSession, po: PurchaseOrder, line_no: int, fields: dict, actor: AssetUser,
    domains: tuple[str, ...] | None,
) -> None:
    """S2.1 whole-line edit. `fields` holds only what the request sent.
    Descriptive / price fields are applied (with the per-unit edit's own
    validation) to EVERY still-waiting unit of the line; received and
    cancelled units never change. `quantity` is the new ORDERED total
    (received + waiting): more adds units copied from the line (same line
    number); fewer cancels the surplus waiting units, newest first, never
    below what has been received."""
    ensure_po_open(po)
    found = await _load_groups(session, po.id, domains, line_no)
    if not found:
        raise LookupError("This PO line was not found.")
    group = found[0]
    template: PendingAsset = group["template"]
    received, waiting = group["received"], group["waiting"]
    ordered = received + waiting
    fields = dict(fields)
    quantity = fields.pop("quantity", None)
    if quantity is not None:
        if quantity > MAX_QUANTITY:
            raise ValueError(f"Quantity must be at most {MAX_QUANTITY}.")
        if quantity < received:
            raise ValueError(
                f"{received} of this line {'has' if received == 1 else 'have'} already been received, "
                f"so the quantity cannot be less than {received}."
            )
    if not fields and quantity is None:
        raise ValueError("Nothing was changed.")

    current = {name: getattr(template, name) for name in LINE_EDIT_FIELDS}
    new_values: dict = {}
    if fields:
        adds_units = quantity is not None and quantity > ordered
        if waiting == 0 and not adds_units:
            raise ValueError("Nothing on this line is still waiting, so there is nothing to change.")
        new_values = await _line_edit_values(session, template, {**current, **fields}, domains)
        if waiting:
            await session.execute(
                update(PendingAsset)
                .where(PendingAsset.id.in_(_waiting_ids_stmt(po.id, domains, line_no).scalar_subquery()))
                .values(**new_values, updated_by=actor.id)
                .execution_options(synchronize_session=False)
            )
            await session.flush()

    if quantity is not None and quantity > ordered:
        base = {**current, **new_values}
        await add_pending_asset_line(session, po, {
            **{name: base.get(name) for name in LINE_EDIT_FIELDS},
            "warranty_years": base.get("warranty_years") or 0,
            "quantity": quantity - ordered, "line_no": line_no,
            "bundle_label": template.bundle_label, "erp_item_code": template.erp_item_code,
            "serial_required": base.get("serial_required", template.serial_required),
            "serial_later": base.get("serial_later", template.serial_later),
        }, actor, allowed_domains=domains)
    elif quantity is not None and quantity < ordered:
        await cancel_waiting_units(session, po, actor, domains, line_no, ordered - quantity)


# ---- S2.3: the purchase-order list with progress ---------------------------

def _po_progress(domains: tuple[str, ...] | None):
    stmt = (
        select(
            PendingAsset.purchase_order_id.label("po_id"),
            func.count().filter(PendingAsset.status == "DELIVERED").label("received"),
            func.count().filter(PendingAsset.status == "PENDING").label("waiting"),
            func.count().filter(PendingAsset.status == "CANCELLED").label("cancelled"),
        )
        .join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
        .group_by(PendingAsset.purchase_order_id)
    )
    return _in_area(stmt, domains).subquery("po_progress")


async def list_purchase_orders(
    session: AsyncSession, allowed_companies: list[int] | None, domains: tuple[str, ...] | None, *,
    status: str | None = None, waiting: bool | None = None, q: str | None = None,
    limit: int = 200, offset: int = 0, po_id: int | None = None,
) -> tuple[list[dict], int]:
    """One aggregated query: each PO with its company and vendor names and
    its ordered / received / waiting / cancelled unit counts and status, over
    the units the caller may see. Returns (rows, total before paging).
    `po_id` reads one PO (deleted ones included); otherwise only active POs."""
    progress = _po_progress(domains)
    received = func.coalesce(progress.c.received, 0)
    waiting_units = func.coalesce(progress.c.waiting, 0)
    cancelled = func.coalesce(progress.c.cancelled, 0)
    status_expr = status_case(received, waiting_units, cancelled)
    stmt = (
        select(
            PurchaseOrder, Company.name.label("company_name"), Vendor.name.label("vendor_name"),
            received.label("received"), waiting_units.label("waiting"), cancelled.label("cancelled"),
            status_expr.label("status"),
        )
        .join(Company, Company.id == PurchaseOrder.company_id)
        .outerjoin(Vendor, Vendor.id == PurchaseOrder.vendor_id)
        .outerjoin(progress, progress.c.po_id == PurchaseOrder.id)
    )
    if po_id is not None:
        stmt = stmt.where(PurchaseOrder.id == po_id)
    else:
        stmt = stmt.where(PurchaseOrder.is_active.is_(True))
    if allowed_companies is not None:
        stmt = stmt.where(PurchaseOrder.company_id.in_(allowed_companies))
    if domains is not None:
        stmt = stmt.where(po_visible_clause(domains))
    if status is not None:
        stmt = stmt.where(status_expr == status)
    if waiting is True:
        stmt = stmt.where(waiting_units > 0)
    elif waiting is False:
        stmt = stmt.where(waiting_units == 0)
    if q and q.strip():
        pattern = f"%{escape_like(q.strip())}%"
        stmt = stmt.where(or_(
            PurchaseOrder.po_number.ilike(pattern, escape="\\"), Vendor.name.ilike(pattern, escape="\\"),
        ))
    total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await session.execute(
        stmt.order_by(PurchaseOrder.id.desc()).limit(limit).offset(offset)
    )).all()
    return [
        {
            "po": row[0], "company_name": row.company_name, "vendor_name": row.vendor_name,
            "ordered_units": row.received + row.waiting, "received_units": row.received,
            "waiting_units": row.waiting, "cancelled_units": row.cancelled, "status": row.status,
        }
        for row in rows
    ], total
