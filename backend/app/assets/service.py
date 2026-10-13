from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.custom_field_values import applicable_custom_fields, check_custom_field_values
from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.lifecycle.service import apply_events
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, CustomField, Location, Vendor
from app.numbering.models import CodeRule
from app.numbering.service import build_code_tokens, generate_codes, get_active_rule, resolve_prefix

# The one reserved placeholder value exempt from Serial Number's global
# uniqueness rule below -- see check_serial_number_unique's own docstring.
NO_SERIAL_PLACEASSET_USER = "N/A"


async def check_serial_number_unique(
    session: AsyncSession, serial_number: str | None, exclude_asset_id: int | None = None,
) -> None:
    """Serial Number is unique across the ENTIRE system -- every company,
    every category, both creation paths (Add Asset, PO delivery via
    procure_assets) and ordinary Edit mode (app.assets.router.update_asset)
    -- per docs/ai/DECISIONS.md. The one exemption is the reserved
    placeholder "N/A" (case-insensitive, trimmed), used for a unit that
    genuinely has no serial: a category that never had one (a mouse, a
    keyboard), or old stock whose serial is physically lost. "N/A" may
    repeat freely; any other non-blank value may not, regardless of which
    category it's attached to (a CPU and a Monitor sharing one real serial
    is exactly as invalid as two CPUs sharing one).

    This is a pre-check for a clean, specific 422 message naming the
    conflicting asset -- the actual race-safe guarantee is the DB-level
    partial unique index (migration 278437eb710e, ux_asset_serial_number_ci),
    which a concurrent request racing past this pre-check still hits (the
    router layer's existing IntegrityError->422 handling, matching
    app.masters.router's own precedent, is the backstop for that case).

    Raises ValueError (never ValueError for None/blank/"N/A" -- those are
    simply not checked, same as an absent value)."""
    if serial_number is None:
        return
    normalized = serial_number.strip()
    if not normalized or normalized.upper() == NO_SERIAL_PLACEASSET_USER:
        return
    stmt = select(Asset).where(
        func.lower(Asset.serial_number) == normalized.lower(),
        Asset.deleted_at.is_(None),
    )
    if exclude_asset_id is not None:
        stmt = stmt.where(Asset.id != exclude_asset_id)
    existing = (await session.execute(stmt)).scalars().first()
    if existing is not None:
        raise ValueError(f'serial number "{serial_number}" is already used by asset {existing.asset_code}')


def serial_key(serial: str | None) -> str | None:
    """The form serials are compared in (trimmed, any letter case); None for a value that never
    conflicts (blank, or the reserved "N/A")."""
    normalized = (serial or "").strip()
    if not normalized or normalized.upper() == NO_SERIAL_PLACEASSET_USER:
        return None
    return normalized.lower()


async def find_serials_in_use(session: AsyncSession, serials: list[str]) -> list[tuple[str, str]]:
    """The advisory twin of `check_serial_number_unique` for a whole list at
    once (the Mark Delivery dialog asks while the user is still typing):
    returns (serial as typed, asset_code holding it) for every serial that is
    already used by a live asset anywhere in the system. Same rules as the
    real check -- trimmed, case-insensitive, blank and "N/A" never conflict.
    Only advisory: the delivery itself still goes through
    `check_serial_number_unique` and the DB unique index."""
    typed: dict[str, str] = {}
    for s in serials:
        key = serial_key(s)
        if key is not None:
            typed.setdefault(key, (s or "").strip())
    if not typed:
        return []
    stmt = select(Asset.serial_number, Asset.asset_code).where(
        func.lower(Asset.serial_number).in_(list(typed)), Asset.deleted_at.is_(None),
    )
    found: dict[str, str] = {}
    for serial_number, asset_code in (await session.execute(stmt)).all():
        found.setdefault(serial_number.strip().lower(), asset_code)
    return [(typed[k], found[k]) for k in typed if k in found]


def _add_years(d: date, years: int) -> date:
    """`date.replace(year=...)` raises ValueError for Feb 29 landing on a
    target year that isn't a leap year -- fall back to Feb 28, the same
    convention most warranty/subscription systems use for a Feb-29 anchor
    date."""
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(month=2, day=28, year=d.year + years)


def compute_warranty_upto(purchase_date: date, warranty_years: int) -> date:
    """AM-18: the one shared formula for every creation/edit path (Add
    Asset, PO Delivery, Import, Asset 360 Edit) -- `warranty_years` is
    always the real input now, `warranty_upto` is always derived from it,
    never typed directly. `0` means "no warranty": the warranty period is
    considered to have already elapsed, matching the day of purchase.
    A positive N means "covered through the day before the Nth
    anniversary" (10-Apr-2026 purchase + 3 years -> 09-Apr-2029), the
    inclusive convention warranty cards and subscription terms commonly
    use."""
    if warranty_years <= 0:
        return purchase_date
    return _add_years(purchase_date, warranty_years) - timedelta(days=1)


def compute_tax(purchase_cost, tax_percent) -> tuple[Decimal, Decimal]:
    """Shared by procure_assets and the AM-02 asset-update endpoint so the two
    call sites can never drift into computing tax differently. Decimal
    arithmetic throughout (never float) to avoid binary floating-point
    rounding errors in money math -- Decimal(str(x)), not Decimal(x), so an
    incoming float/int is converted via its decimal string representation,
    not its imprecise binary value."""
    cost = Decimal(str(purchase_cost or 0))
    percent = Decimal(str(tax_percent or 0))
    tax_amount = (cost * percent / Decimal(100)).quantize(Decimal("0.01"))
    return tax_amount, cost + tax_amount


def _check_initial_asset_user(asset_user: AssetUser | None, company_id: int, initial_asset_user_id: int | None) -> AssetUser:
    """Resolve the asset_user newly procured assets land in.

    `initial_asset_user_id` is required, not defaulted: a company can have multiple STOCK_POINT
    asset_users (one per location, e.g. "IT Stock-HO", "IT Stock-WH-F", "IT Stock-WH-K" per
    the design spec's seed data), so there is no safe way to pick one automatically —
    guessing risks silently misfiling a purchase into the wrong location's stock with no
    error and no warning. The real caller (the Add Asset screen) always has the admin
    explicitly pick a stock location from a dropdown, so this is never actually optional
    in practice.
    """
    if initial_asset_user_id is None:
        raise ValueError("Choose where the asset is received into.")
    if asset_user is None:
        raise ValueError("The place you chose to receive the asset into does not exist.")
    if not asset_user.is_active:
        raise ValueError(f"{asset_user.name} is no longer active, so assets cannot be received there.")
    if asset_user.company_id != company_id:
        raise ValueError("The place the asset is received into must belong to the same company as the asset.")
    return asset_user


async def _get_initial_asset_user(session: AsyncSession, company_id: int, initial_asset_user_id: int | None) -> AssetUser:
    asset_user = await session.get(AssetUser, initial_asset_user_id) if initial_asset_user_id is not None else None
    return _check_initial_asset_user(asset_user, company_id, initial_asset_user_id)


def _usable(obj, what: str, require_active: bool):
    """S0.6: None -> "does not exist"; inactive -> refused when this is a new
    choice (Add Asset). The PO delivery path delivers lines that were valid
    when ordered, so it does not re-refuse a master deactivated since."""
    if obj is None:
        raise ValueError(f"The {what} you chose does not exist.")
    if require_active and not getattr(obj, "is_active", True):
        raise ValueError(f"The {what} {obj.name} is no longer active; choose another.")
    return obj


# ---- S4: the one asset-creation engine, split into a once-per-receipt step and a per-unit step ----
#
# build_procure_context  -- every lookup a batch of new assets needs, done ONCE (company, code rule,
#                           cost centres, categories, sub-categories, vendors, brands, the places they
#                           are received into and their locations, the custom-field definitions);
# prepare_unit           -- per unit, pure Python (no query): the same checks, in the same order and
#                           with the same messages, as procure_assets always made, and the asset's
#                           column values and code prefix;
# write_units            -- the writes for the whole batch: one serial check, one counter update per
#                           code prefix, one INSERT of the assets, their PROCURED events through the
#                           ledger's batch entry point (app.lifecycle.service.apply_events).
# procure_units / procure_assets are the two doors in; Add Asset, the old PO delivery, the new Receive
# and any later batch add all go through them, so there is one creation engine, not two.


@dataclass
class ProcureContext:
    company_id: int
    company: Company | None
    rule: CodeRule | None
    rule_error: str | None
    require_active: bool
    cost_centers: dict[int, CostCenter]
    categories: dict[int, AssetCategory]
    subcategories: dict[int, AssetSubcategory]
    vendors: dict[int, Vendor]
    brands: dict[int, Brand]
    holders: dict[int, AssetUser]
    locations: dict[int, Location]
    custom_defs: dict[str, CustomField]


async def _by_id(session: AsyncSession, model, ids) -> dict:
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = (await session.execute(select(model).where(model.id.in_(wanted)))).scalars().all()
    return {row.id: row for row in rows}


async def build_procure_context(session: AsyncSession, units: list[dict], require_active: bool = False) -> ProcureContext:
    """Loads, once, everything `prepare_unit` needs for these units (all of one company). Raises
    ValueError only when the units span several companies; every other problem is reported by
    `prepare_unit` for the unit it concerns."""
    company_ids = {u["company_id"] for u in units}
    if len(company_ids) != 1:
        raise ValueError("The assets of one receipt must all belong to one company.")
    company_id = next(iter(company_ids))
    company = await session.get(Company, company_id)
    rule, rule_error = None, None
    try:
        rule = await get_active_rule(session, company_id)
    except ValueError as exc:
        rule_error = str(exc)
    holders = await _by_id(session, AssetUser, (u.get("initial_asset_user_id") for u in units))
    return ProcureContext(
        company_id=company_id, company=company, rule=rule, rule_error=rule_error, require_active=require_active,
        cost_centers=await _by_id(session, CostCenter, (u.get("cost_center_id") for u in units)),
        categories=await _by_id(session, AssetCategory, (u.get("category_id") for u in units)),
        subcategories=await _by_id(session, AssetSubcategory, (u.get("subcategory_id") for u in units)),
        vendors=await _by_id(session, Vendor, (u.get("vendor_id") for u in units)),
        brands=await _by_id(session, Brand, (u.get("brand_id") for u in units)),
        holders=holders,
        locations=await _by_id(session, Location, (h.location_id for h in holders.values())),
        custom_defs=await applicable_custom_fields(session, company_id),
    )


@dataclass
class PreparedUnit:
    row: dict          # the asset's column values (asset_code and actor columns added at write time)
    prefix: str        # the resolved code prefix
    holder_id: int
    event_date: datetime


def prepare_unit(ctx: ProcureContext, data: dict) -> PreparedUnit:
    """Every check procure_assets made for one asset, against the preloaded context (no query).
    Raises ValueError with the same plain sentences."""
    company_id = ctx.company_id
    company = ctx.company
    if company is None or (ctx.require_active and not company.is_active):
        raise ValueError("The company you chose does not exist or is no longer active.")
    if ctx.rule is None:
        raise ValueError(ctx.rule_error or "No code rule (asset code format) is set up for this company yet.")
    require_active = ctx.require_active

    cost_center = _usable(ctx.cost_centers.get(data["cost_center_id"]), "cost centre", require_active)
    if cost_center.company_id != company_id:
        raise ValueError("The cost centre must belong to the same company as the asset.")
    if data.get("category_id") is None:
        raise ValueError("Choose an Item (or a category) for the asset.")
    category = _usable(ctx.categories.get(data["category_id"]), "category", require_active)
    subcategory = ctx.subcategories.get(data["subcategory_id"]) if data.get("subcategory_id") else None
    if data.get("subcategory_id"):
        _usable(subcategory, "sub-category", require_active)
    if subcategory is not None and subcategory.category_id != category.id:
        raise ValueError("The sub-category does not belong to the selected category.")
    if data.get("vendor_id") is not None:
        _usable(ctx.vendors.get(data["vendor_id"]), "vendor", require_active)
    if data.get("brand_id") is not None:
        _usable(ctx.brands.get(data["brand_id"]), "brand", require_active)

    holder_id = data.get("initial_asset_user_id")
    asset_user = _check_initial_asset_user(ctx.holders.get(holder_id) if holder_id is not None else None, company_id, holder_id)
    location = ctx.locations.get(asset_user.location_id)

    # AM-02 / AM-04 / AM-05: every active required Custom Field applicable to this
    # company (global + the company's own) must have a valid value before a new
    # asset can exist -- enforce_required=True unconditionally on create.
    check_custom_field_values(ctx.custom_defs, data.get("custom_fields"), enforce_required=True)

    tokens = build_code_tokens(
        company=company, location=location, cost_center=cost_center, category=category,
        subcategory=subcategory, purchase_date=data["purchase_date"],
    )
    prefix = resolve_prefix(ctx.rule, tokens)

    purchase_cost = Decimal(str(data.get("purchase_cost") or 0))
    tax_percent = Decimal(str(data.get("tax_percent") or 0))
    tax_amount, total_cost = compute_tax(purchase_cost, tax_percent)

    # AM-18: warranty_years is the real input on every public creation path
    # (AssetCreateIn/PendingAssetLineIn/Import all require it); a caller
    # that omits it entirely (internal/service-level, e.g. a test building
    # `data` directly) gets the old pass-through behavior instead, so this
    # never breaks a call site that predates this feature.
    warranty_years = data.get("warranty_years")
    warranty_upto = (
        compute_warranty_upto(data["purchase_date"], warranty_years)
        if warranty_years is not None
        else data.get("warranty_upto")
    )
    serial_pending = bool(data.get("serial_pending"))
    row = {
        "legacy_asset_code": data.get("legacy_asset_code"),
        "company_id": company_id,
        "cost_center_id": data["cost_center_id"],
        "category_id": data["category_id"],
        "subcategory_id": data.get("subcategory_id"),
        "item_id": data.get("item_id"),
        "erp_item_code": data.get("erp_item_code"),
        "brand_id": data.get("brand_id"),
        "model": data.get("model"),
        "serial_number": None if serial_pending else data.get("serial_number"),
        "serial_pending": serial_pending,
        "barcode": data.get("barcode"),
        "description": data["description"],
        "vendor_id": data.get("vendor_id"),
        "po_number": data.get("po_number"),
        "po_date": data.get("po_date"),
        "invoice_number": data.get("invoice_number"),
        "invoice_date": data.get("invoice_date"),
        "invoice_amount": data.get("invoice_amount"),
        "pi_number": data.get("pi_number"),
        "pi_date": data.get("pi_date"),
        "purchase_cost": purchase_cost,
        "tax_percent": tax_percent,
        "tax_amount": tax_amount,
        "total_cost": total_cost,
        "purchase_date": data["purchase_date"],
        "warranty_years": warranty_years,
        "warranty_upto": warranty_upto,
        # Spec §18: always derived server-side from the selected Category,
        # never trusted from the client even if the caller's `data` dict
        # happens to carry an "asset_domain" key -- a snapshot of the
        # Category's CURRENT classification at creation time, so a later
        # Category reclassification never silently rewrites it.
        "asset_domain": category.asset_domain,
        # Initial status set directly here, not through apply_event — this is the one
        # documented exception (see apply_event's docstring): a freshly-inserted row
        # needs a non-null status/asset_user before the state machine has anything to
        # transition from. The ledger's batch entry point (apply_events) is called right
        # after the insert to record the PROCURED event and is the sole writer for every
        # transition after this one.
        "status": "IN_STOCK",
        "current_asset_user_id": asset_user.id,
        "status_since": data["purchase_date"],
        "custom_fields": data.get("custom_fields") or {},
    }
    event_date = datetime.combine(data["purchase_date"], datetime.min.time()).replace(tzinfo=timezone.utc)
    return PreparedUnit(row=row, prefix=prefix, holder_id=asset_user.id, event_date=event_date)


async def check_batch_serials(session: AsyncSession, serials: list[str | None]) -> None:
    """Serial uniqueness for a whole batch, in unit order, with one query: a serial already used by a live
    asset, or typed twice in the batch, raises ValueError for the first unit it concerns. Blank and "N/A"
    never conflict (pending units pass None)."""
    in_use = dict(
        (serial_key(s), code) for s, code in await find_serials_in_use(session, [s for s in serials if s])
    )
    seen: set[str] = set()
    for serial in serials:
        key = serial_key(serial)
        if key is None:
            continue
        if key in in_use:
            raise ValueError(f'serial number "{serial}" is already used by asset {in_use[key]}')
        if key in seen:
            raise ValueError(f'serial number "{serial}" is used for more than one asset in this batch')
        seen.add(key)


async def write_units(session: AsyncSession, ctx: ProcureContext, prepared: list[PreparedUnit], actor: AssetUser) -> list[Asset]:
    """The writes for a whole batch of prepared units, in order: serial check (one query), asset codes
    (one counter update per prefix), one INSERT for the assets, then their PROCURED events through
    app.lifecycle.service.apply_events (one ledger INSERT). Returns the new assets in unit order."""
    if not prepared:
        return []
    await check_batch_serials(session, [p.row["serial_number"] for p in prepared if not p.row["serial_pending"]])
    codes = await generate_codes(session, ctx.rule, [p.prefix for p in prepared])
    rows = [{**p.row, "asset_code": code, "created_by": actor.id, "updated_by": actor.id} for p, code in zip(prepared, codes)]
    assets = list((await session.scalars(insert(Asset).returning(Asset, sort_by_parameter_order=True), rows)).all())

    by_date: dict[datetime, list[tuple[Asset, int]]] = {}
    for asset, p in zip(assets, prepared):
        by_date.setdefault(p.event_date, []).append((asset, p.holder_id))
    for event_date, moves in by_date.items():
        await apply_events(session, moves, "PROCURED", actor, event_date=event_date)
    await session.flush()
    return assets


async def procure_units(
    session: AsyncSession, units: list[dict], actor: AssetUser, require_active: bool = False,
    *, context: ProcureContext | None = None,
) -> list[Asset]:
    """S4: creates one asset per entry of `units` (each a full procure_assets-style `data` dict; all of
    one company), with the lookups done once for the whole batch. All-or-nothing: the first problem
    raises ValueError / LifecycleError before any asset is written (the caller rolls back). `context`:
    one already built for these units (the Receive pre-validation builds it; reused, not rebuilt)."""
    if not units:
        return []
    ctx = context or await build_procure_context(session, units, require_active)
    prepared = [prepare_unit(ctx, data) for data in units]
    return await write_units(session, ctx, prepared, actor)


async def procure_assets(
    session: AsyncSession, data: dict, quantity: int, actor: AssetUser, require_active: bool = False,
) -> list[Asset]:
    """Behind "Add Asset": creates `quantity` identical assets (the "buying 20 mice" case),
    each with its own generated asset_code and its own PROCURED ledger entry recorded
    through the ledger (app.lifecycle.service) — the only code allowed to write status/
    current_asset_user_id.

    Raises ValueError (bad/missing master data, no code rule, unresolvable code-rule
    token) or LifecycleError (e.g. a future purchase date); POST /api/assets turns
    both into a 422. `require_active` (S0.6): refuse deactivated masters (Add Asset).
    S4: a thin door into `procure_units` (the same engine every creation path uses).
    """
    if quantity < 1:
        ctx = await build_procure_context(session, [data], require_active)
        prepare_unit(ctx, data)
        return []
    return await procure_units(session, [data] * quantity, actor, require_active)
