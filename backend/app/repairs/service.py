"""Release 3 (movement redesign, 2026-11-11): repair vendors as PLACES.

Sending an asset for repair names the repair vendor. The vendor is a place (an `asset_user` of type REPAIR_VENDOR,
one per vendor per company, made here on first use, never by a screen of its own) that HOLDS the asset while it is
away: Asset 360 shows "With <vendor>", the history says "Sent for repair to <vendor>", and CKAM can count what each
vendor has and for how long. Receiving back leaves the vendor place for any place (see `origins_of`: the place each
asset was sent from, so "put each back where it came from" is one choice).

Nothing here writes an asset's status / holder: that stays the ledger writer's (`apply_events`)."""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.asset_users.kinds import REPAIR_PLACE_PREFIX, REPAIR_VENDOR_TYPE
from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.codes import unique_code
from app.lifecycle.models import AssetEvent
from app.masters.models import Vendor

PLACE_NAME_SUFFIX = " (repair)"
CODE_LENGTH = 50


async def ensure_repair_place(session: AsyncSession, actor: AssetUser, vendor: Vendor, company_id: int) -> AssetUser:
    """The repair place of this vendor in this company (made when it does not exist yet). Raises ValueError (a
    sentence) when the vendor is no longer active."""
    if not vendor.is_active:
        raise ValueError(f"The vendor {vendor.name} is no longer active; choose another.")

    async def existing() -> AssetUser | None:
        return (await session.execute(
            select(AssetUser).where(AssetUser.company_id == company_id, AssetUser.vendor_id == vendor.id)
        )).scalars().first()

    place = await existing()
    if place is not None:
        if not place.is_active:
            place.is_active = True
            await session.flush()
        return place
    code = await unique_code(session, AssetUser, vendor.name, max_length=CODE_LENGTH, fallback="VENDOR",
                             prefix=REPAIR_PLACE_PREFIX, separator="-", scope={"company_id": company_id})
    place = AssetUser(
        company_id=company_id, code=code, name=(vendor.name[: 200 - len(PLACE_NAME_SUFFIX)] + PLACE_NAME_SUFFIX),
        asset_user_type=REPAIR_VENDOR_TYPE, vendor_id=vendor.id, role="SELF_SERVICE", login_enabled=False,
        created_by=actor.id, updated_by=actor.id,
    )
    try:
        async with session.begin_nested():
            session.add(place)
            await session.flush()
    except IntegrityError:
        # two people sent assets to the same new vendor at the same moment: use the one that won
        again = await existing()
        if again is None:
            raise ValueError("The repair vendor could not be saved. Try again.")
        return again
    return place


async def origins_of(session: AsyncSession, asset_ids: list[int]) -> dict[int, dict]:
    """asset id -> where it was sent for repair FROM (the latest SENT_FOR_REPAIR event): {place_id, name, active,
    sent_on}. An asset with no such event (or sent before vendors were recorded and with no holder) is missing."""
    if not asset_ids:
        return {}
    origin = aliased(AssetUser, name="repair_origin")
    rows = (await session.execute(
        select(AssetEvent.asset_id, AssetEvent.from_asset_user_id, AssetEvent.from_asset_user_name_snapshot,
               AssetEvent.event_date, origin.name, origin.is_active)
        .outerjoin(origin, origin.id == AssetEvent.from_asset_user_id)
        .where(AssetEvent.asset_id.in_(asset_ids), AssetEvent.event_type == "SENT_FOR_REPAIR")
        .distinct(AssetEvent.asset_id)
        .order_by(AssetEvent.asset_id, AssetEvent.event_date.desc(), AssetEvent.id.desc())
    )).all()
    out: dict[int, dict] = {}
    for asset_id, place_id, snapshot, sent_on, live_name, active in rows:
        if place_id is None:
            continue
        out[asset_id] = {"place_id": place_id, "name": snapshot or live_name, "active": bool(active), "sent_on": sent_on}
    return out


def _scoped(stmt, allowed: list[int] | None, domains):
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    if domains is not None:
        stmt = stmt.where(Asset.asset_domain.in_(domains))
    return stmt


def _days(since: date | None) -> int | None:
    return (date.today() - since).days if since is not None else None


async def repair_summary(session: AsyncSession, allowed: list[int] | None, domains) -> dict:
    """What is away for repair, by vendor: {vendors: [{vendor_id, vendor_name, assets, oldest_days}],
    without_vendor: {assets, oldest_days}} (assets sent before vendors were recorded). Within the caller's
    companies and work area."""
    holder = aliased(AssetUser, name="repair_holder")
    base = (
        select(holder.vendor_id, func.count(Asset.id), func.min(Asset.status_since))
        .select_from(Asset).outerjoin(holder, holder.id == Asset.current_asset_user_id)
        .where(Asset.status == "UNDER_REPAIR", Asset.deleted_at.is_(None))
        .group_by(holder.vendor_id)
    )
    rows = (await session.execute(_scoped(base, allowed, domains))).all()
    names = {}
    vendor_ids = [vid for vid, _n, _s in rows if vid is not None]
    if vendor_ids:
        names = dict((await session.execute(select(Vendor.id, Vendor.name).where(Vendor.id.in_(vendor_ids)))).all())
    vendors = sorted(
        ({"vendor_id": vid, "vendor_name": names.get(vid, "Vendor"), "assets": n, "oldest_days": _days(since)}
         for vid, n, since in rows if vid is not None),
        key=lambda r: (-(r["oldest_days"] or 0), r["vendor_name"]),
    )
    none = next(((n, since) for vid, n, since in rows if vid is None), (0, None))
    return {"vendors": vendors, "without_vendor": {"assets": none[0], "oldest_days": _days(none[1])}}


async def vendor_assets(session: AsyncSession, vendor_id: int, allowed: list[int] | None, domains) -> list[dict]:
    """The assets a vendor holds now (all that vendor's repair places), oldest first, each with where it was sent
    from. Within the caller's companies and work area."""
    holder = aliased(AssetUser, name="repair_holder")
    stmt = (
        select(Asset.id, Asset.asset_code, Asset.serial_number, Asset.description, Asset.status_since, Asset.company_id,
               Asset.current_asset_user_id)
        .select_from(Asset).join(holder, holder.id == Asset.current_asset_user_id)
        .where(Asset.status == "UNDER_REPAIR", Asset.deleted_at.is_(None), holder.vendor_id == vendor_id)
        .order_by(Asset.status_since, Asset.id)
    )
    rows = (await session.execute(_scoped(stmt, allowed, domains))).all()
    origins = await origins_of(session, [r[0] for r in rows])
    out = []
    for asset_id, code, serial, description, since, company_id, place_id in rows:
        origin = origins.get(asset_id)
        out.append({
            "asset_id": asset_id, "asset_code": code, "serial_number": serial, "description": description,
            "company_id": company_id, "place_id": place_id, "sent_on": since.isoformat() if since else None,
            "days": _days(since),
            "origin_asset_user_id": origin["place_id"] if origin else None,
            "origin_name": origin["name"] if origin else None,
            "origin_active": origin["active"] if origin else None,
        })
    return out
