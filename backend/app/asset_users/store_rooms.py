"""S5: a store comes with its own Stock Room (STK-<code>) and Install Point (INS-<code>).

One store used to mean three records the user had to make by hand; now every way a store is made (People &
Places, the ERP store list) and a one-off backfill give it the other two. Kept free of the routers so the
ERP store code can use it without an import cycle."""
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.kinds import INSTALL_POINT_PREFIX, STOCK_ROOM_PREFIX
from app.asset_users.models import AssetUser

ROOM_KINDS = (
    ("stock_room", STOCK_ROOM_PREFIX, "STOCK_POINT", "Stock Room"),
    ("install_point", INSTALL_POINT_PREFIX, "INSTALLED", "Install Point"),
)


async def room_codes(session: AsyncSession, company_ids: list[int] | None = None) -> dict[tuple[int, str], AssetUser]:
    """Every STK-... / INS-... record (any type, active or not) by (company, code in capitals) -- read once."""
    stmt = select(AssetUser).where(or_(
        func.upper(func.trim(AssetUser.code)).like(f"{STOCK_ROOM_PREFIX}%"),
        func.upper(func.trim(AssetUser.code)).like(f"{INSTALL_POINT_PREFIX}%"),
    ))
    if company_ids is not None:
        stmt = stmt.where(AssetUser.company_id.in_(company_ids))
    return {(u.company_id, (u.code or "").strip().upper()): u for u in (await session.execute(stmt)).scalars().all()}


async def ensure_store_rooms(
    session: AsyncSession, actor: AssetUser, store: AssetUser, known: dict[tuple[int, str], AssetUser] | None = None,
) -> dict:
    """Gives a store its Stock Room (STK-<code>) and Install Point (INS-<code>), at the store's own place,
    reusing an active one of the right kind that already has that code. Never changes an existing record.
    Returns {stock_room, install_point (the records or None), created: [...], reused: [...], problems: [...]}
    (`created` / `reused` hold "stock_room" / "install_point"). `known` (from room_codes) avoids a query per
    store when many stores are done at once; it is kept up to date."""
    code = (store.code or "").strip().upper()
    if known is None:
        known = await room_codes(session, [store.company_id])
    out: dict = {"stock_room": None, "install_point": None, "created": [], "reused": [], "problems": []}
    for key, prefix, type_, label in ROOM_KINDS:
        want = f"{prefix}{code}"
        row = known.get((store.company_id, want))
        if row is not None:
            if row.asset_user_type == type_ and row.is_active:
                out[key] = row
                out["reused"].append(key)
            else:
                out["problems"].append(
                    f"The code {want} is already used by {row.name}"
                    f"{'' if row.is_active else ' (no longer active)'}, so the {label.lower()} of store {code} was not made."
                )
            continue
        room = AssetUser(
            company_id=store.company_id, code=want, name=f"{store.name} {label}"[:200], asset_user_type=type_,
            location_id=store.location_id, role="SELF_SERVICE", login_enabled=False,
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(room)
        await session.flush()
        known[(store.company_id, want)] = room
        out[key] = room
        out["created"].append(key)
    return out
