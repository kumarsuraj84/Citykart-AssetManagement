"""S4: Receive -- one receipt of goods against a purchase order, by LINE.

The person enters the common things once (received into, invoice number / date / amount) and a quantity per
line; serial numbers only for lines that have them. The server picks the units (the OLDEST waiting ones of
each line, by id), and runs the same delivery orchestration as the old "Mark Delivery Done"
(app.purchase_orders.service.deliver_units -> app.assets.service.procure_units -> app.lifecycle.service.
apply_events), so a received unit becomes exactly the asset it always became.

Atomicity (decided for S4): the WHOLE receipt is checked before anything is written -- quantities against
what is waiting, serial counts, serials typed twice in the receipt (any letter case; N/A never counts),
serials already used in CKAM (one query), the place it is received into, every line's work area, required
extra (custom) fields per unit, and every rule the asset engine applies (masters, code format). Any problem
-> 422 with every problem listed and NOTHING written. Otherwise the receipt is written in ONE transaction:
all of it, or (on an unexpected late failure) none of it. There is no partial receipt."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.assets.custom_field_values import applicable_custom_fields, custom_field_problems
from app.assets.models import Asset
from app.assets.service import NO_SERIAL_PLACEASSET_USER, build_procure_context, find_serials_in_use, prepare_unit, serial_key
from app.core.deps import check_work_area
from app.core.validation import MAX_QUANTITY
from app.masters.models import AssetCategory, Company, Vendor
from app.numbering.service import get_active_rule
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import (
    delivery_unit_spec, deliver_units, line_area_of, line_groups, list_purchase_orders,
)

SERIAL_MODES = ("HAS_SERIAL", "NO_SERIAL", "SERIAL_LATER")
SERIAL_MODE_WORDS = {"HAS_SERIAL": "has a serial number", "NO_SERIAL": "no serial number", "SERIAL_LATER": "serial number later"}
MAX_PROBLEMS = 200
MAX_SERIAL_LENGTH = 200
DELETED_PO = "This purchase order has been deleted, so nothing new can be recorded on it."


class ReceiveRefused(Exception):
    """The receipt was checked and refused; nothing was written. `problems` = [{line_no, unit_index?,
    serial?, message}] in line order (line_no None for the common fields)."""

    def __init__(self, problems: list[dict]):
        super().__init__(problems[0]["message"] if problems else "Nothing was received.")
        self.problems = problems[:MAX_PROBLEMS]
        self.more = max(0, len(problems) - MAX_PROBLEMS)

    @property
    def sentences(self) -> list[str]:
        out = [f"Line {p['line_no']}: {p['message']}" if p.get("line_no") is not None else p["message"]
               for p in self.problems]
        if self.more:
            out.append(f"... and {self.more} more.")
        return out

    def body(self) -> dict:
        sentences = self.sentences
        total = len(self.problems) + self.more
        detail = sentences[0] if total == 1 else (
            f"Nothing was received: {total} problems need fixing. {sentences[0]}"
        )
        return {"detail": detail, "errors": sentences, "problems": self.problems}


def _problem(message: str, line_no: int | None = None, unit_index: int | None = None, serial: str | None = None) -> dict:
    out = {"line_no": line_no, "message": message}
    if unit_index is not None:
        out["unit_index"] = unit_index
    if serial is not None:
        out["serial"] = serial
    return out


def _collapse(line_no: int, per_unit: list[list[str]]) -> list[dict]:
    """Problems of one line's units: a message every unit has is reported once for the line; the others
    once per unit (unit_index = the unit's position in this receipt's line, 1-based)."""
    out: list[dict] = []
    if not per_unit:
        return out
    seen: list[str] = []
    for messages in per_unit:
        for m in messages:
            if m not in seen:
                seen.append(m)
    for message in seen:
        holders = [i for i, messages in enumerate(per_unit, start=1) if message in messages]
        if len(holders) == len(per_unit):
            out.append(_problem(message, line_no))
        else:
            out.extend(_problem(message, line_no, unit_index=i) for i in holders)
    return out


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


# ---- GET /purchase-orders/{id}/receive-info --------------------------------

async def receive_info(session: AsyncSession, po: PurchaseOrder, domains: tuple[str, ...] | None) -> dict:
    """Everything the Receive screen needs in one call: the PO header, its lines (over the caller's work
    area) with what is still waiting and each line's serial rule, the place goods are received into by
    default (the PO's delivery place, when still usable), the required extra fields of the PO's company,
    and `blockers` -- plain sentences saying why nothing can be received right now (empty when it can)."""
    groups = await line_groups(session, po.id, domains)
    company = await session.get(Company, po.company_id)
    vendor = await session.get(Vendor, po.vendor_id) if po.vendor_id else None
    place = await session.get(AssetUser, po.delivery_asset_user_id) if po.delivery_asset_user_id else None
    usable_place = place if place is not None and place.is_active and place.company_id == po.company_id else None
    defs = await applicable_custom_fields(session, po.company_id)
    required = [
        {"id": f.id, "key": f.field_key, "label": f.label, "type": f.field_type, "options": f.options,
         "sort_order": f.sort_order}
        for f in sorted(defs.values(), key=lambda f: (f.sort_order, f.label)) if f.is_required
    ]
    lines = [{
        "line_no": g["line_no"], "item_id": g["item_id"], "item_name": g["item_name"], "description": g["description"],
        "ordered": g["ordered"], "received_before": g["received"], "waiting": g["waiting"], "cancelled": g["cancelled"],
        "serial_mode": g["serial_mode"], "work_area": g["work_area"], "rate": g["rate"], "tax_percent": g["tax_percent"],
        "unit_total": g["unit_total"], "erp_item_code": g["erp_item_code"], "brand_name": g["brand_name"],
        "model": g["model"], "bundle_label": g["bundle_label"], "status": g["status"],
    } for g in groups]
    waiting = sum(line["waiting"] for line in lines)
    blockers: list[str] = []
    if not po.is_active:
        blockers.append(DELETED_PO)
    if waiting == 0:
        blockers.append("Nothing on this purchase order is still waiting.")
    try:
        await get_active_rule(session, po.company_id)
    except ValueError as exc:
        blockers.append(str(exc))
    return {
        "po_id": po.id, "po_number": po.po_number, "po_date": po.po_date, "is_active": po.is_active,
        "company_id": po.company_id, "company_name": company.name if company else None,
        "company_code": company.code if company else None,
        "vendor_id": po.vendor_id, "vendor_name": vendor.name if vendor else None,
        "received_into_asset_user_id": usable_place.id if usable_place else None,
        "received_into_name": usable_place.name if usable_place else None,
        "ordered_units": sum(line["ordered"] for line in lines),
        "received_units": sum(line["received_before"] for line in lines),
        "waiting_units": waiting,
        "lines": lines, "required_custom_fields": required, "blockers": blockers,
    }


# ---- POST /purchase-orders/{id}/receive ------------------------------------

async def _check_place(session: AsyncSession, po: PurchaseOrder, place_id: int | None, problems: list[dict]) -> AssetUser | None:
    if place_id is None:
        problems.append(_problem("Choose where the goods are received into."))
        return None
    place = await session.get(AssetUser, place_id)
    if place is None:
        problems.append(_problem("The place you chose to receive the goods into does not exist."))
        return None
    if place.company_id != po.company_id:
        problems.append(_problem("The place the goods are received into must belong to the purchase order's company."))
        return None
    if not place.is_active:
        problems.append(_problem(f"{place.name} is no longer active, so goods cannot be received there."))
        return None
    if place.asset_user_type != "STOCK_POINT" and place.id != po.delivery_asset_user_id:
        problems.append(_problem(
            f"{place.name} is not a stock room. Choose a stock room (or the purchase order's delivery place)."
        ))
        return None
    return place


def _check_invoice(po: PurchaseOrder, body: dict, problems: list[dict]) -> tuple[str, date | None, float | None]:
    number = (body.get("invoice_number") or "").strip()
    if not number:
        problems.append(_problem("Invoice number cannot be blank."))
    amount = body.get("invoice_amount")
    if amount is None:
        problems.append(_problem("Invoice amount is required."))
    elif amount < 0:
        problems.append(_problem("Invoice amount cannot be negative."))
    when = body.get("invoice_date")
    if when is None:
        problems.append(_problem("Invoice date is required."))
    elif when > date.today():
        problems.append(_problem("Invoice date cannot be in the future."))
    elif po.po_date is not None and when < po.po_date:
        problems.append(_problem(f"The invoice date cannot be before the PO date ({po.po_date.strftime('%d-%m-%Y')})."))
    return number, when, amount


async def receive_goods(
    session: AsyncSession, po: PurchaseOrder, body: dict, actor: AssetUser,
    domains: tuple[str, ...] | None, visible_companies: list[int] | None,
) -> dict:
    """Checks the whole receipt (see the module docstring), then writes it. Raises ReceiveRefused (nothing
    written), HTTPException 403 (a line of the other work area), or -- only for an unexpected late failure
    -- whatever the writers raise (the caller rolls back the whole transaction)."""
    if not po.is_active:
        raise ReceiveRefused([_problem(DELETED_PO)])
    problems: list[dict] = []
    invoice_number, invoice_date, invoice_amount = _check_invoice(po, body, problems)
    place = await _check_place(session, po, body.get("received_into_asset_user_id") or po.delivery_asset_user_id, problems)

    requested: list[dict] = body.get("lines") or []
    if not requested:
        problems.append(_problem("Add at least one line."))
    total = sum(max(0, int(r.get("quantity") or 0)) for r in requested)
    if total > MAX_QUANTITY:
        problems.append(_problem(f"One receipt can hold at most {MAX_QUANTITY:,} units; this one has {total:,}."))

    groups = {g["line_no"]: g for g in await line_groups(session, po.id, None)}
    wanted: dict[int, dict] = {}
    for req in requested:
        n = req["line_no"]
        if n in wanted:
            problems.append(_problem("This line appears twice in the receipt; enter it once.", n))
            continue
        group = groups.get(n)
        if group is None:
            problems.append(_problem("This line was not found on this purchase order.", n))
            continue
        # S0.3: someone limited to IT or Non-IT receives only their own area's lines (403, like every write).
        check_work_area(domains, group["work_area"], f"Line {n}")
        wanted[n] = req

    # The units: the OLDEST waiting ones of each line, locked for this transaction so two people
    # receiving the same line at the same moment can never turn one unit into two assets.
    units_by_line: dict[int, list[tuple[PendingAsset, str | None]]] = {n: [] for n in wanted}
    if wanted:
        rows = (await session.execute(
            select(PendingAsset, line_area_of())
            .join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
            .where(PendingAsset.purchase_order_id == po.id, PendingAsset.status == "PENDING",
                   PendingAsset.line_no.in_(list(wanted)))
            .order_by(PendingAsset.line_no, PendingAsset.id)
            .with_for_update(of=PendingAsset)
            .execution_options(populate_existing=True)
        )).all()
        for unit, area in rows:
            units_by_line[unit.line_no].append((unit, area))

    chosen: dict[int, list[PendingAsset]] = {}
    modes: dict[int, str] = {}
    serials_by_line: dict[int, list[str]] = {}
    for n, req in wanted.items():
        group = groups[n]
        quantity = int(req.get("quantity") or 0)
        waiting = units_by_line[n]
        if not waiting:
            problems.append(_problem("Nothing on this line is still waiting.", n))
            continue
        if quantity < 1:
            problems.append(_problem("Enter how many are being received (at least 1).", n))
            continue
        if quantity > len(waiting):
            problems.append(_problem(
                f"Only {len(waiting)} {_plural(len(waiting), 'is', 'are')} still waiting, so {quantity} cannot be received.", n,
            ))
            continue
        picked = waiting[:quantity]
        for _unit, area in picked:
            check_work_area(domains, area, f"Line {n}")
        chosen[n] = [unit for unit, _area in picked]

        mode = ((req.get("serial_mode") or "").strip() or group["serial_mode"]).upper()
        if mode not in SERIAL_MODES:
            problems.append(_problem("Choose the serial rule: has a serial number, no serial number, or serial number later.", n))
            continue
        modes[n] = mode
        typed = [s.strip() for s in (req.get("serial_numbers") or []) if s is not None and s.strip()]
        if mode == "HAS_SERIAL":
            if len(typed) != quantity:
                problems.append(_problem(
                    f"{quantity} serial {_plural(quantity, 'number is', 'numbers are')} needed, "
                    f"{len(typed)} {_plural(len(typed), 'was', 'were')} typed.", n,
                ))
            for i, serial in enumerate(typed[:quantity], start=1):
                if len(serial) > MAX_SERIAL_LENGTH:
                    problems.append(_problem(f"This serial number is too long (max {MAX_SERIAL_LENGTH} characters).",
                                             n, unit_index=i, serial=serial[:50]))
            serials_by_line[n] = typed[:quantity]
        elif typed:
            problems.append(_problem(
                f"This line is set to {SERIAL_MODE_WORDS[mode]}, so leave its serial numbers empty "
                "(or set it to has a serial number).", n,
            ))
        unit_values = req.get("unit_custom_fields") or []
        if len(unit_values) > quantity:
            problems.append(_problem(
                f"Extra-field values were given for {len(unit_values)} units, but {quantity} "
                f"{_plural(quantity, 'is', 'are')} being received.", n,
            ))

    # Serials typed twice in this receipt (any letter case; N/A is never a duplicate).
    first_seen: dict[str, int] = {}
    for n, typed in serials_by_line.items():
        for i, serial in enumerate(typed, start=1):
            key = serial_key(serial)
            if key is None:
                continue
            if key in first_seen:
                other = first_seen[key]
                where = "on this line" if other == n else f"on line {other} and line {n}"
                problems.append(_problem(f"Serial number {serial} is typed more than once ({where}).", n, i, serial))
            else:
                first_seen[key] = n

    # Serials already used by an asset anywhere in CKAM (one query). The asset's code is named only when
    # the caller may see that asset (S0.3), as on the check-serials screen.
    all_typed = [s for typed in serials_by_line.values() for s in typed]
    in_use = {serial_key(s): code for s, code in await find_serials_in_use(session, all_typed)} if all_typed else {}
    if in_use:
        rows = (await session.execute(
            select(Asset.asset_code, Asset.company_id, Asset.asset_domain).where(Asset.asset_code.in_(set(in_use.values())))
        )).all()
        visible = {code for code, company_id, domain in rows
                   if (visible_companies is None or company_id in visible_companies) and (domains is None or domain in domains)}
        for n, typed in serials_by_line.items():
            for i, serial in enumerate(typed, start=1):
                code = in_use.get(serial_key(serial))
                if code is not None:
                    holder = f"asset {code}" if code in visible else "an asset outside your companies or work area"
                    problems.append(_problem(f"Serial number {serial} is already used by {holder}.", n, i, serial))

    # Every unit through the asset engine's own checks (masters, received-into, code format) and the
    # required extra fields -- with lookups made once for the whole receipt.
    deliveries: dict[int, dict] = {}
    specs_by_unit: list[tuple[int, PendingAsset, dict]] = []
    ctx = None
    if place is not None and chosen and invoice_date is not None:
        for n, units in chosen.items():
            if n not in modes:
                continue
            req = wanted[n]
            mode = modes[n]
            typed = serials_by_line.get(n, [])
            line_values = req.get("custom_fields") or {}
            unit_values = req.get("unit_custom_fields") or []
            for i, unit in enumerate(units):
                values = {**line_values, **(unit_values[i] if i < len(unit_values) and unit_values[i] else {})}
                if mode == "HAS_SERIAL":
                    serial = typed[i] if i < len(typed) else None
                elif mode == "NO_SERIAL":
                    serial = NO_SERIAL_PLACEASSET_USER
                else:
                    serial = None
                delivery = {
                    "serial_number": serial, "serial_pending": mode == "SERIAL_LATER",
                    "initial_asset_user_id": place.id, "custom_fields": values or None,
                }
                deliveries[unit.id] = delivery
                spec = delivery_unit_spec(unit, delivery, po.po_number, po.po_date, po.vendor_id,
                                          invoice_number, invoice_date, invoice_amount)
                specs_by_unit.append((n, unit, spec))
        if specs_by_unit:
            ctx = await build_procure_context(session, [spec for _, _, spec in specs_by_unit])
            per_line: dict[int, list[list[str]]] = {}
            for n, _unit, spec in specs_by_unit:
                messages = custom_field_problems(ctx.custom_defs, spec.get("custom_fields"))
                if not messages:
                    try:
                        prepare_unit(ctx, spec)     # pure: no query per unit
                    except ValueError as exc:
                        messages = [str(exc)]
                per_line.setdefault(n, []).append(messages)
            for n, per_unit in per_line.items():
                problems.extend(_collapse(n, per_unit))

    if problems:
        order = {n: position for position, n in enumerate([None, *wanted])}
        problems.sort(key=lambda p: (order.get(p.get("line_no"), len(order)), p.get("unit_index") or 0))
        raise ReceiveRefused(problems)

    units = [unit for _, unit, _ in specs_by_unit]
    _lines, assets = await deliver_units(
        session, units, deliveries, po.po_number, po.po_date, po.vendor_id,
        invoice_number, invoice_date, invoice_amount, actor, context=ctx,
    )
    created = [
        {"asset_id": asset.id, "asset_code": asset.asset_code, "line_no": unit.line_no,
         "serial_number": asset.serial_number, "serial_pending": asset.serial_pending}
        for unit, asset in zip(units, assets)
    ]
    rows, _total = await list_purchase_orders(session, None, domains, po_id=po.id)
    summary = rows[0] if rows else {}
    return {
        "po_id": po.id, "invoice_number": invoice_number,
        "assets_created": len(created),
        "serial_pending": sum(1 for a in created if a["serial_pending"]),
        "assets": created,
        "label_asset_ids": [a["asset_id"] for a in created],
        "po_status": summary.get("status"), "waiting_units": summary.get("waiting_units"),
    }
