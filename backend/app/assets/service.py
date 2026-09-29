from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.custom_field_values import validate_custom_field_values
from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.lifecycle.service import apply_event
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Location
from app.numbering.service import build_code_tokens, generate_code, get_active_rule

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


async def _get_initial_asset_user(session: AsyncSession, company_id: int, initial_asset_user_id: int | None) -> AssetUser:
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
        raise ValueError("initial_asset_user_id is required")
    asset_user = await session.get(AssetUser, initial_asset_user_id)
    if asset_user is None:
        raise ValueError(f"initial asset user {initial_asset_user_id} not found")
    if asset_user.company_id != company_id:
        raise ValueError("initial asset user must belong to the same company as the asset")
    return asset_user


async def procure_assets(session: AsyncSession, data: dict, quantity: int, actor: AssetUser) -> list[Asset]:
    """Behind "Add Asset": creates `quantity` identical assets (the "buying 20 mice" case),
    each with its own generated asset_code and its own PROCURED ledger entry recorded
    through apply_event — the only function allowed to write status/current_asset_user_id.

    Raises ValueError (bad/missing master data, no code rule, unresolvable code-rule
    token) or LifecycleError (e.g. a future purchase date); POST /api/assets turns
    both into a 422.
    """
    company_id = data["company_id"]
    company = await session.get(Company, company_id)
    if company is None:
        raise ValueError(f"company {company_id} not found")
    rule = await get_active_rule(session, company_id)

    cost_center = await session.get(CostCenter, data["cost_center_id"])
    if cost_center is None:
        raise ValueError(f"cost center {data['cost_center_id']} not found")
    if cost_center.company_id != company_id:
        raise ValueError("cost center must belong to the same company as the asset")
    category = await session.get(AssetCategory, data["category_id"])
    if category is None:
        raise ValueError(f"category {data['category_id']} not found")
    subcategory = await session.get(AssetSubcategory, data["subcategory_id"]) if data.get("subcategory_id") else None
    if subcategory is not None and subcategory.category_id != category.id:
        raise ValueError("sub-category does not belong to the selected category")

    asset_user = await _get_initial_asset_user(session, company_id, data.get("initial_asset_user_id"))
    location = await session.get(Location, asset_user.location_id)

    # AM-02: validated once here, then reused verbatim for every asset this call
    # creates (the "buying 20 mice" quantity case) -- the same custom_fields dict
    # is attached to every row per the existing code below, so one validation
    # pass covers all of them; a ValueError here becomes the same 422 as any
    # other bad-input problem in this function.
    # AM-04: enforce_required=True unconditionally on create -- every active
    # required Custom Field must have a valid value before a new asset can
    # exist, per the locked V1 rule (docs/ai/DECISIONS.md). AM-05: scoped to
    # only the fields applicable to this asset's company (global + this
    # company's own) -- a field scoped to a different company can never
    # apply here, required or not.
    await validate_custom_field_values(
        session, data.get("custom_fields"), company_id=company_id, enforce_required=True,
    )

    tokens = build_code_tokens(
        company=company, location=location, cost_center=cost_center, category=category,
        subcategory=subcategory, purchase_date=data["purchase_date"],
    )

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

    event_date = datetime.combine(data["purchase_date"], datetime.min.time()).replace(tzinfo=timezone.utc)

    created: list[Asset] = []
    for _ in range(quantity):
        # Checked once per unit, inside the loop, not once before it -- a
        # quantity>1 batch with a real (non-"N/A") serial must reject on the
        # 2nd unit onward, since each already-flushed unit from this same
        # call is itself a conflict for the next one.
        await check_serial_number_unique(session, data.get("serial_number"))
        code = await generate_code(session, rule, tokens)
        asset = Asset(
            asset_code=code,
            legacy_asset_code=data.get("legacy_asset_code"),
            company_id=company_id,
            cost_center_id=data["cost_center_id"],
            category_id=data["category_id"],
            subcategory_id=data.get("subcategory_id"),
            brand_id=data.get("brand_id"),
            model=data.get("model"),
            serial_number=data.get("serial_number"),
            barcode=data.get("barcode"),
            description=data["description"],
            vendor_id=data.get("vendor_id"),
            po_number=data.get("po_number"),
            po_date=data.get("po_date"),
            invoice_number=data.get("invoice_number"),
            invoice_date=data.get("invoice_date"),
            invoice_amount=data.get("invoice_amount"),
            pi_number=data.get("pi_number"),
            pi_date=data.get("pi_date"),
            purchase_cost=purchase_cost,
            tax_percent=tax_percent,
            tax_amount=tax_amount,
            total_cost=total_cost,
            purchase_date=data["purchase_date"],
            warranty_years=warranty_years,
            warranty_upto=warranty_upto,
            # Spec §18: always derived server-side from the selected Category,
            # never trusted from the client even if the caller's `data` dict
            # happens to carry an "asset_domain" key -- a snapshot of the
            # Category's CURRENT classification at creation time, so a later
            # Category reclassification never silently rewrites it.
            asset_domain=category.asset_domain,
            # Initial status set directly here, not through apply_event — this is the one
            # documented exception (see apply_event's docstring): a freshly-inserted row
            # needs a non-null status/asset_user before the state machine has anything to
            # transition from. apply_event is called immediately below to record the
            # PROCURED event and is the sole writer for every transition after this one.
            status="IN_STOCK",
            current_asset_user_id=asset_user.id,
            status_since=data["purchase_date"],
            custom_fields=data.get("custom_fields") or {},
            created_by=actor.id,
            updated_by=actor.id,
        )
        session.add(asset)
        await session.flush()

        await apply_event(
            session,
            asset,
            "PROCURED",
            to_asset_user_id=asset_user.id,
            actor=actor,
            event_date=event_date,
        )
        created.append(asset)

    await session.flush()
    return created
