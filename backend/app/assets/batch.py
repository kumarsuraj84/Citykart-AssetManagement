"""S5: Add assets in one go (POST /api/assets/batch) -- "20 chairs into the HO stock room".

The person names the Item, how many, where they are received into and the cost centre; everything else is
optional or comes from the Item: category / sub-category / work area (always the Item's), the serial rule
(HAS_SERIAL / NO_SERIAL / SERIAL_LATER, the Item's unless chosen), brand (the Item's default brand when none
is chosen and it is still active), warranty (the Item's default, else 0), description (the Item's name plus
the brand and model). The company is the cost centre's (a `company_id` sent must be the same).

Same atomic contract as Receive (S4): the WHOLE request is checked first -- serial count for HAS_SERIAL,
serials typed twice or already used in CKAM, extra (custom) fields per unit, active masters, the place it is
received into, the code format -- and any problem gives 422 {detail, errors, problems} with NOTHING written.
Otherwise every asset is written in one transaction by the one asset engine
(app.assets.service.procure_units -> write_units -> app.lifecycle.service.apply_events), each with its own
PROCURED event, exactly as Add Asset and Receive create assets."""
from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.assets.custom_field_values import custom_field_problems
from app.assets.models import Asset
from app.assets.schemas import MAX_BATCH_UNITS
from app.assets.service import (
    NO_SERIAL_PLACEASSET_USER, build_procure_context, find_serials_in_use, prepare_unit, procure_units, serial_key,
)
from app.bundles.models import Bundle, BundlePart
from app.bundles.service import split_amounts
from app.core.deps import check_work_area
from app.core.problems import Refused, collapse_units, plural
from app.items.models import Item
from app.masters.brand_areas import brand_fit_problem, domain_of_category
from app.masters.models import AssetCategory, Brand, CostCenter
from app.masters.serial_rule import serial_mode_of

SERIAL_MODES = ("HAS_SERIAL", "NO_SERIAL", "SERIAL_LATER")
SERIAL_MODE_WORDS = {"HAS_SERIAL": "has a serial number", "NO_SERIAL": "no serial number", "SERIAL_LATER": "serial number later"}
MAX_SERIAL_LENGTH = 200
NOTHING_ADDED = "Nothing was added"
OUTSIDE_COMPANY = "You can only add assets for your own companies. Ask the head-office admin."


def item_serial_mode(item: Item) -> str:
    """The Item's own serial rule, in the words the Receive screen already uses."""
    return serial_mode_of(item)


def _blank_to_none(value: str | None) -> str | None:
    return (value or "").strip() or None


async def _serials_for(
    session: AsyncSession, mode: str, typed: list[str], quantity: int, problem, first_seen: dict, *,
    allowed_companies: list[int] | None, domains: tuple[str, ...] | None, label: str | None = None, **where,
) -> list[str]:
    """The serial rule applied to one run of `quantity` assets (the whole request, or one part of a set):
    count, length, typed twice, already used in CKAM. Problems go to `problem`; returns the serials to use.
    `label` (a part's name) is put in front of the sentences, `where` (part_id) on each problem; `first_seen`
    is shared by all runs of one request so a serial typed under two parts is caught too."""
    def say(message: str, **more) -> None:
        problem(f"{label}: {message}" if label else message, **where, **more)

    serials: list[str] = []
    if mode not in SERIAL_MODES:
        say("Choose the serial rule: has a serial number, no serial number, or serial number later.")
    elif mode == "HAS_SERIAL":
        if len(typed) != quantity:
            say(f"{quantity} serial {plural(quantity, 'number is', 'numbers are')} needed, "
                f"{len(typed)} {plural(len(typed), 'was', 'were')} typed.")
        serials = typed[:quantity]
        for i, serial in enumerate(serials, start=1):
            if len(serial) > MAX_SERIAL_LENGTH:
                say(f"This serial number is too long (max {MAX_SERIAL_LENGTH} characters).", unit_index=i, serial=serial[:50])
                continue
            key = serial_key(serial)
            if key is None:
                continue
            if key in first_seen:
                other_label, j = first_seen[key]
                if other_label == label:
                    say(f"Serial number {serial} is typed more than once (units {j} and {i}).", unit_index=i, serial=serial)
                else:
                    problem(f"Serial number {serial} is typed more than once ({other_label} unit {j} and {label} unit {i}).",
                            **where, unit_index=i, serial=serial)
            else:
                first_seen[key] = (label, i)
        # Already used by an asset anywhere in CKAM (one query); the asset is named only when the caller may
        # see it (S0.3), as on Receive and the check-serials screen.
        in_use = {serial_key(s): code for s, code in await find_serials_in_use(session, serials)} if serials else {}
        if in_use:
            rows = (await session.execute(
                select(Asset.asset_code, Asset.company_id, Asset.asset_domain).where(Asset.asset_code.in_(set(in_use.values())))
            )).all()
            visible = {code for code, cid, domain in rows
                       if (allowed_companies is None or cid in allowed_companies) and (domains is None or domain in domains)}
            for i, serial in enumerate(serials, start=1):
                code = in_use.get(serial_key(serial))
                if code is not None:
                    holder = f"asset {code}" if code in visible else "an asset outside your companies or work area"
                    say(f"Serial number {serial} is already used by {holder}.", unit_index=i, serial=serial)
    elif typed:
        if label:
            say(f"Its Item says {SERIAL_MODE_WORDS[mode]}, so leave its serial numbers empty.")
        else:
            say(f"These assets are set to {SERIAL_MODE_WORDS[mode]}, so leave the serial numbers empty "
                "(or set them to has a serial number).")
    return serials


async def _set_parts(session: AsyncSession, item: Item) -> list[dict]:
    """The parts a set Item is added as, in the set's order: [{part, item, name, mode, category_id,
    subcategory_id, share}]. Refused (nothing written) when the set or a part's Item is no longer usable."""
    bundle = await session.get(Bundle, item.bundle_id)
    if bundle is None or not bundle.is_active:
        raise Refused([{"message": f"The set of {item.name} is no longer active; ask the head-office admin."}], NOTHING_ADDED)
    rows = (await session.execute(
        select(BundlePart).where(BundlePart.bundle_id == bundle.id, BundlePart.is_active.is_(True))
        .order_by(BundlePart.sort_order, BundlePart.id)
    )).scalars().all()
    if not rows:
        raise Refused([{"message": f"The set of {item.name} has no parts; ask the head-office admin."}], NOTHING_ADDED)
    out: list[dict] = []
    for part in rows:
        part_item = await session.get(Item, part.item_id) if part.item_id is not None else None
        if part_item is not None and not part_item.is_active:
            raise Refused([{"message": f"The Item {part_item.name} (part {part.name} of {item.name}) is no longer active."}], NOTHING_ADDED)
        out.append({
            "part": part, "item": part_item, "name": part.name, "mode": serial_mode_of(part_item),
            "category_id": part_item.category_id if part_item is not None else part.category_id,
            "subcategory_id": part_item.subcategory_id if part_item is not None else part.subcategory_id,
            "share": Decimal(str(part.share_percent)),
        })
    return out


async def add_assets_batch(
    session: AsyncSession, body: dict, actor: AssetUser, *,
    allowed_companies: list[int] | None, domains: tuple[str, ...] | None,
) -> dict:
    """Checks the whole request, then writes it. Raises Refused (422, nothing written), HTTPException 403
    (an Item of the other work area, a company outside the caller's), or -- only for an unexpected late
    failure -- whatever the engine raises (the caller rolls the transaction back)."""
    problems: list[dict] = []

    def problem(message: str, **where) -> None:
        problems.append({**where, "message": message})

    quantity = int(body["quantity"])
    item = await session.get(Item, body["item_id"])
    if item is None:
        raise Refused([{"message": "The Item you chose does not exist."}], NOTHING_ADDED)
    if not item.is_active:
        raise Refused([{"message": f"The Item {item.name} is no longer active; choose another."}], NOTHING_ADDED)
    category = await session.get(AssetCategory, item.category_id)
    # S0.3: the assets' work area is the Item's Category's -- it must be the caller's (403, like Add Asset).
    check_work_area(domains, category.asset_domain if category is not None else None)

    # The company is the cost centre's; a company sent must be the same one.
    company_id = body.get("company_id")
    cost_center = await session.get(CostCenter, body["cost_center_id"])
    if cost_center is None:
        problem("The cost centre you chose does not exist.")
    else:
        if company_id is not None and company_id != cost_center.company_id:
            problem("The cost centre must belong to the company you chose.")
        company_id = cost_center.company_id
    if company_id is not None and allowed_companies is not None and company_id not in allowed_companies:
        raise HTTPException(status.HTTP_403_FORBIDDEN, OUTSIDE_COMPANY)
    if company_id is None:
        raise Refused(problems, NOTHING_ADDED)

    # Dates (purchase date = invoice date, else today -- as on Add Asset).
    today = date.today()
    po_date, invoice_date = body.get("po_date"), body.get("invoice_date")
    if po_date is not None and po_date > today:
        problem("PO date cannot be in the future.")
    if invoice_date is not None and invoice_date > today:
        problem("Invoice date cannot be in the future.")
    if po_date is not None and invoice_date is not None and invoice_date < po_date:
        problem(f"The invoice date cannot be before the PO date ({po_date.strftime('%d-%m-%Y')}).")
    # A set Item (a Desktop) is added as its parts, `quantity` of each: its own path.
    if item.bundle_id is not None:
        return await _add_set(
            session, body, item, actor, quantity=quantity, company_id=company_id, today=today, problems=problems,
            problem=problem, allowed_companies=allowed_companies, domains=domains,
        )

    if _blank_to_none(body.get("legacy_asset_code")) and quantity > 1:
        problem("An old asset code can only be given when adding one asset.")

    # The serial rule: the Item's, unless one was chosen.
    mode = (_blank_to_none(body.get("serial_mode")) or item_serial_mode(item)).upper()
    typed = [s.strip() for s in (body.get("serial_numbers") or []) if s is not None and s.strip()]
    serials = await _serials_for(
        session, mode, typed, quantity, problem, {}, allowed_companies=allowed_companies, domains=domains,
    )
    unit_values = body.get("unit_custom_fields") or []
    if len(unit_values) > quantity:
        problem(f"Extra-field values were given for {len(unit_values)} units, but {quantity} "
                f"{plural(quantity, 'is', 'are')} being added.")

    # Defaults from the Item.
    brand_id = body.get("brand_id")
    brand = await session.get(Brand, brand_id) if brand_id is not None else None
    if brand_id is not None:
        # a brand chosen here must be used for this Item's work area (IT / Non-IT)
        fit = await brand_fit_problem(session, brand_id, await domain_of_category(session, item.category_id))
        if fit:
            problem(fit)
    if brand_id is None and item.default_brand_id is not None:
        default = await session.get(Brand, item.default_brand_id)
        if default is not None and default.is_active:      # a retired default brand is just not used
            brand, brand_id = default, default.id
    model = _blank_to_none(body.get("model"))
    description = _blank_to_none(body.get("description"))
    if description is None:
        words = [item.name] + ([brand.name] if brand is not None else []) + ([model] if model else [])
        description = " ".join(words)[:500]
    warranty = body.get("warranty_years")
    if warranty is None:
        warranty = item.default_warranty_years or 0

    base = {
        "company_id": company_id, "cost_center_id": body["cost_center_id"],
        "item_id": item.id, "category_id": item.category_id, "subcategory_id": item.subcategory_id,
        "erp_item_code": None, "brand_id": brand_id, "model": model, "barcode": _blank_to_none(body.get("barcode")),
        "description": description, "vendor_id": body.get("vendor_id"),
        "po_number": _blank_to_none(body.get("po_number")), "po_date": po_date,
        "invoice_number": _blank_to_none(body.get("invoice_number")), "invoice_date": invoice_date,
        "invoice_amount": body.get("invoice_amount"), "purchase_cost": body.get("purchase_cost"),
        "tax_percent": body.get("tax_percent"), "warranty_years": warranty,
        "purchase_date": invoice_date or today, "initial_asset_user_id": body["received_into_asset_user_id"],
        "legacy_asset_code": _blank_to_none(body.get("legacy_asset_code")),
    }
    common_values = body.get("custom_fields") or {}
    units: list[dict] = []
    for i in range(quantity):
        if mode == "HAS_SERIAL":
            serial = serials[i] if i < len(serials) else None
        elif mode == "NO_SERIAL":
            serial = NO_SERIAL_PLACEASSET_USER
        else:
            serial = None
        values = {**common_values, **(unit_values[i] if i < len(unit_values) and unit_values[i] else {})}
        units.append({**base, "serial_number": serial, "serial_pending": mode == "SERIAL_LATER",
                      "custom_fields": values or None})

    return await _write_units(session, units, [(0, len(units), None, {})], problems, actor)


async def _write_units(
    session: AsyncSession, units: list[dict], runs: list[tuple[int, int, str | None, dict]], problems: list[dict],
    actor: AssetUser,
) -> dict:
    """Every unit through the asset engine's own checks (masters, received-into, code format) and the required
    extra fields -- lookups made once for the whole batch, no query per unit -- then, if nothing is wrong, all
    written in one go. `runs` = (first unit, end, label, where) per run of units of one kind: the whole
    request, or one part of a set (its name in front of the sentences, its part_id on each problem)."""
    ctx = await build_procure_context(session, units, require_active=True)
    per_unit: list[list[str]] = []
    for unit in units:
        messages = custom_field_problems(ctx.custom_defs, unit.get("custom_fields"))
        if not messages:
            try:
                prepare_unit(ctx, unit)     # pure: no query per unit
            except ValueError as exc:
                messages = [str(exc)]
        per_unit.append(messages)
    for start, end, label, where in runs:
        run = per_unit[start:end]
        if label:
            run = [[f"{label}: {m}" for m in messages] for messages in run]
        for found in collapse_units(run, **where):
            if not any(p["message"] == found["message"] and p.get("unit_index") == found.get("unit_index") for p in problems):
                problems.append(found)

    if problems:
        problems.sort(key=lambda p: p.get("unit_index") or 0)
        raise Refused(problems, NOTHING_ADDED)

    assets = await procure_units(session, units, actor, require_active=True, context=ctx)
    created = [{"asset_id": a.id, "asset_code": a.asset_code, "serial_number": a.serial_number,
                "serial_pending": a.serial_pending} for a in assets]
    return {
        "assets_created": len(created),
        "serial_pending": sum(1 for a in created if a["serial_pending"]),
        "assets": created,
        "label_asset_ids": [a["asset_id"] for a in created],
    }


SET_ONLY_FIELDS = (
    ("serial_mode", "Each part of a set follows its own Item's serial rule, so the serial rule cannot be changed here."),
    ("serial_numbers", "Serial numbers for a set are entered per part, not as one list."),
    ("brand_id", "Each part of a set takes the brand of its own Item, so leave Brand empty."),
    ("model", "A set's parts have different models, so leave Model empty."),
    ("legacy_asset_code", "An old asset code cannot be given for a set."),
    ("unit_custom_fields", "Different extra-field values per asset cannot be given for a set; the same values go on every part."),
)


async def _add_set(
    session: AsyncSession, body: dict, item: Item, actor: AssetUser, *, quantity: int, company_id: int, today: date,
    problems: list[dict], problem, allowed_companies: list[int] | None, domains: tuple[str, ...] | None,
) -> dict:
    """A set Item (a Desktop = CPU + TFT + Keyboard + Mouse) is added as its parts: `quantity` assets of each
    part's own Item (its category, brand and warranty defaults), exactly what a PO does with a set. Nothing of
    the set itself is saved on the assets. Each part follows ITS Item's serial rule -- a mouse that has no
    serial needs none, a CPU that has one needs one per set -- so serials are given per part (`part_serials`,
    keyed by the part's id). A typed cost is the price of one whole set and is split over the parts by their
    share, to the paisa. Same atomic contract as a single Item: any problem and nothing is written."""
    parts = await _set_parts(session, item)
    for part in parts:
        category = await session.get(AssetCategory, part["category_id"])
        check_work_area(domains, category.asset_domain if category is not None else None)
    for key, message in SET_ONLY_FIELDS:
        value = body.get(key)
        if isinstance(value, str):
            value = value.strip()
        if value not in (None, "", [], {}):
            problem(message)
    if quantity * len(parts) > MAX_BATCH_UNITS:
        problem(f"{quantity} sets of {len(parts)} parts is {quantity * len(parts)} assets; at most {MAX_BATCH_UNITS} can be added at once.")

    # Serials, per part: only the parts whose Item has a serial take any.
    given = body.get("part_serials") or {}
    known = {str(p["part"].id) for p in parts}
    if any(k not in known for k in given):
        problem(f"Serial numbers were given for something that is not a part of {item.name}.")
    first_seen: dict = {}
    serials_by_part: dict[int, list[str]] = {}
    for p in parts:
        typed = [s.strip() for s in (given.get(str(p["part"].id)) or []) if s is not None and s.strip()]
        serials_by_part[p["part"].id] = await _serials_for(
            session, p["mode"], typed, quantity, problem, first_seen,
            allowed_companies=allowed_companies, domains=domains, label=p["name"], part_id=p["part"].id,
        )

    # Cost of one set, split by share (to the paisa, the parts add up to it exactly).
    cost = body.get("purchase_cost")
    amounts: list[float | None] = (
        [float(a) for a in split_amounts(Decimal(str(cost)), [p["share"] for p in parts])] if cost is not None
        else [None] * len(parts)
    )

    typed_description = _blank_to_none(body.get("description"))
    warranty_typed = body.get("warranty_years")
    common_values = body.get("custom_fields") or {}
    invoice_date, po_date = body.get("invoice_date"), body.get("po_date")
    units: list[dict] = []
    runs: list[tuple[int, int, str | None, dict]] = []
    for p, amount in zip(parts, amounts):
        part_item = p["item"]
        brand = None
        if part_item is not None and part_item.default_brand_id is not None:
            default = await session.get(Brand, part_item.default_brand_id)
            if default is not None and default.is_active:      # a retired default brand is just not used
                brand = default
        name = part_item.name if part_item is not None else p["name"]
        description = (f"{typed_description} - {p['name']}" if typed_description
                       else " ".join([name] + ([brand.name] if brand is not None else [])))[:500]
        warranty = warranty_typed if warranty_typed is not None else ((part_item.default_warranty_years if part_item is not None else None) or 0)
        base = {
            "company_id": company_id, "cost_center_id": body["cost_center_id"],
            "item_id": part_item.id if part_item is not None else None,
            "category_id": p["category_id"], "subcategory_id": p["subcategory_id"],
            "erp_item_code": None, "brand_id": brand.id if brand is not None else None, "model": None,
            "barcode": _blank_to_none(body.get("barcode")),
            "description": description, "vendor_id": body.get("vendor_id"),
            "po_number": _blank_to_none(body.get("po_number")), "po_date": po_date,
            "invoice_number": _blank_to_none(body.get("invoice_number")), "invoice_date": invoice_date,
            "invoice_amount": body.get("invoice_amount"), "purchase_cost": amount,
            "tax_percent": body.get("tax_percent"), "warranty_years": warranty,
            "purchase_date": invoice_date or today, "initial_asset_user_id": body["received_into_asset_user_id"],
            "legacy_asset_code": None,
        }
        serials = serials_by_part[p["part"].id]
        start = len(units)
        for i in range(quantity):
            if p["mode"] == "HAS_SERIAL":
                serial = serials[i] if i < len(serials) else None
            elif p["mode"] == "NO_SERIAL":
                serial = NO_SERIAL_PLACEASSET_USER
            else:
                serial = None
            units.append({**base, "serial_number": serial, "serial_pending": p["mode"] == "SERIAL_LATER",
                          "custom_fields": dict(common_values) or None})
        runs.append((start, len(units), p["name"], {"part_id": p["part"].id}))

    result = await _write_units(session, units, runs, problems, actor)
    result["set_name"] = item.name
    result["sets"] = quantity
    return result
