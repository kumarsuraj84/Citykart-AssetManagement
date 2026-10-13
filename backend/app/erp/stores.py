"""Store users made from the ERP's site list.

Every store has a short code in the ERP (LAM, LAD, SPR2) and a mailbox named after it
(sm.<code>@citykartstores.com). A store is a user in CKAM: assets are allotted to it, and it signs in with its
mailbox. This lists the stores the ERP has, shows which already exist here, and creates the missing ones
(a Location plus a STORE user), never touching what exists.

Only normal store codes (three letters, optionally one digit) are offered. Dummy and test sites in the ERP
(UP-DUMMY, BRBxx, ...) are listed as "not a store code" and cannot be created. A new user has no password: an
admin issues one with Reset Password when the store is ready to sign in."""
import re
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.asset_users.store_rooms import ensure_store_rooms, room_codes
from app.core.config import settings
from app.erp.mirror_models import ErpSiteCopy, ErpSyncRun
from app.erp.vendors import company_for_erp
from app.masters.models import Location

STORE_CODE = re.compile(r"^[A-Za-z]{3}[0-9]?$")
READY, UPCOMING, INACTIVE, NOT_A_CODE = "READY", "UPCOMING", "INACTIVE", "NOT_A_STORE_CODE"


def store_email(code: str) -> str:
    return settings.store_email_pattern.format(code=code.lower())


def _group(site: ErpSiteCopy) -> str:
    code = (site.short_name or "").strip()
    if not STORE_CODE.match(code):
        return NOT_A_CODE
    status = (site.store_status or "").strip().upper()
    if status == "ACTIVE":
        return READY
    if status == "UPCOMING_STORE":
        return UPCOMING
    return INACTIVE


async def list_erp_stores(session: AsyncSession, company_id: int) -> dict:
    """The stores of one company's ERP, each marked with whether it can be created here."""
    company = await company_for_erp(session, company_id)
    copied = (await session.execute(select(ErpSyncRun.id).where(ErpSyncRun.status == "success").limit(1))).first() is not None
    sites = (await session.execute(
        select(ErpSiteCopy).where(
            ErpSiteCopy.company_code == company.erp_code, ErpSiteCopy.site_kind == "STORE",
            ErpSiteCopy.is_active_site.is_(True), ErpSiteCopy.is_present.is_(True),
        ).order_by(ErpSiteCopy.short_name, ErpSiteCopy.site_code)
    )).scalars().all()
    users = (await session.execute(
        select(AssetUser.id, AssetUser.code, AssetUser.email, AssetUser.is_active).where(AssetUser.company_id == company.id)
    )).all()
    by_code = {(u.code or "").upper(): u for u in users}
    by_email = {(u.email or "").lower(): u for u in users if u.email}

    rows = []
    summary = {READY: 0, UPCOMING: 0, INACTIVE: 0, NOT_A_CODE: 0, "ALREADY_CREATED": 0}
    for s in sites:
        code = (s.short_name or "").strip()
        group = _group(s)
        existing = by_code.get(code.upper())
        email = store_email(code) if group != NOT_A_CODE else None
        taken = by_email.get(email.lower()) if email else None
        reason = None
        if existing is not None:
            reason = "A user with this code already exists."
            summary["ALREADY_CREATED"] += 1
        else:
            summary[group] += 1
            if group == NOT_A_CODE:
                reason = "This is not a usual store code (three letters and at most one digit), so it is not offered."
            elif taken is not None:
                reason = f"The login email is already used by another user in this company ({email})."
        selectable = existing is None and group != NOT_A_CODE and taken is None
        rows.append({
            "site_code": s.site_code, "code": code, "name": (s.store_name or code).strip(), "state": s.state, "city": s.city,
            "store_status": s.store_status, "group": group, "email": email, "exists": existing is not None,
            "asset_user_id": existing.id if existing else None, "selectable": selectable,
            "selected_by_default": selectable and group == READY, "reason": reason,
        })
    return {"company_id": company.id, "copied": copied, "summary": summary, "stores": rows}


async def create_erp_stores(session: AsyncSession, actor: AssetUser, company_id: int, codes: list[str]) -> dict:
    """Creates a Location (reusing one with the same code) and a STORE user for each requested store that may be
    created. A store that cannot be is reported with the reason; the others are still created.

    S5: every store created here -- and every store of this list that already exists here as a store -- also
    gets its Stock Room (STK-<code>) and Install Point (INS-<code>), reusing what exists (app.asset_users.
    store_rooms). Additive answer fields: `rooms` (per store: codes and whether each was created) and the counts
    `stock_rooms_created` / `install_points_created`."""
    company = await company_for_erp(session, company_id)
    listing = await list_erp_stores(session, company_id)
    rows = {r["code"].upper(): r for r in listing["stores"]}
    created: list[str] = []
    skipped: list[dict] = []
    rooms_out: list[dict] = []
    known = await room_codes(session, [company.id])
    seen: set[str] = set()

    async def give_rooms(store: AssetUser) -> None:
        rooms = await ensure_store_rooms(session, actor, store, known)
        rooms_out.append({
            "code": (store.code or "").upper(),
            "stock_room_code": rooms["stock_room"].code if rooms["stock_room"] is not None else None,
            "stock_room_created": "stock_room" in rooms["created"],
            "install_point_code": rooms["install_point"].code if rooms["install_point"] is not None else None,
            "install_point_created": "install_point" in rooms["created"],
            "problems": rooms["problems"],
        })

    for raw in codes:
        key = (raw or "").strip().upper()
        if not key or key in seen:
            continue
        seen.add(key)
        row = rows.get(key)
        if row is None:
            skipped.append({"code": raw, "reason": "This is not a store of this company in the ERP."})
            continue
        if not row["selectable"]:
            skipped.append({"code": row["code"], "reason": row["reason"] or "This store cannot be created."})
            if row["exists"] and row["asset_user_id"] is not None:
                existing = await session.get(AssetUser, row["asset_user_id"])
                if existing is not None and existing.asset_user_type == "STORE" and existing.is_active:
                    async with session.begin_nested():
                        await give_rooms(existing)
            continue
        try:
            async with session.begin_nested():
                location = (await session.execute(
                    select(Location).where(Location.company_id == company.id, func.upper(Location.code) == key, Location.is_active.is_(True))
                )).scalars().first()
                if location is None:
                    location = Location(company_id=company.id, code=row["code"].upper(), name=row["name"][:200], created_by=actor.id, updated_by=actor.id)
                    session.add(location)
                    await session.flush()
                store = AssetUser(
                    company_id=company.id, code=row["code"].upper(), name=row["name"][:200], asset_user_type="STORE", location_id=location.id,
                    email=row["email"], role="SELF_SERVICE", login_enabled=True, must_change_password=True,
                    created_by=actor.id, updated_by=actor.id,
                )
                session.add(store)
                await session.flush()
                await give_rooms(store)
        except IntegrityError:
            skipped.append({"code": row["code"], "reason": "A user with this code or email already exists."})
            known = await room_codes(session, [company.id])
            continue
        created.append(row["code"].upper())
    return {
        "created": created, "skipped": skipped, "rooms": rooms_out,
        "stock_rooms_created": sum(r["stock_room_created"] for r in rooms_out),
        "install_points_created": sum(r["install_point_created"] for r in rooms_out),
    }
