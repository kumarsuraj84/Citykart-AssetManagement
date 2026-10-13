"""S3a-1: who may create and who may manage which records -- ONE place.

Every endpoint that the S3a-1 rules opened (vendor / brand / cost centre /
stock room / Item creation in the flow, domain-owned Category / Sub-category /
Item management) asks the small functions below, and `GET /api/auth/capabilities`
builds its answer from the very same functions, so what the screen offers and
what the server allows cannot drift apart.

Rules (owner's approved brief):
* Small operational records -- vendor, brand, Item, stock room, cost centre --
  may be CREATED by an ADMIN or an OPERATOR (company scope and, for an Item,
  work area still apply). Editing / deactivating a vendor, brand or cost centre
  stays with the head-office admin (Primary Owner).
* Category, Sub-category and Item are owned by a work area (the Category's
  asset_domain: IT or NON_IT). An ADMIN manages (create / edit / deactivate)
  them only inside their own work area; an ADMIN with both work areas and the
  head-office admin manage both. An OPERATOR may only create an Item, in their
  own work area.
* Moving a Category (or an Item) to the other work area needs someone who
  handles both (or the head-office admin) and an explicit confirmation.
* Heavy setup (companies, locations, departments, custom fields, bundles, code
  rules, ERP rules, ERP stores / sync, imports) stays head-office-admin only.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    WRITE_ROLES, allowed_asset_domains, can_administer_system, get_current_asset_user, scoped_company_ids,
)

ALL_AREAS = ("IT", "NON_IT")

ROLE_LABELS = {
    "ADMIN": "Full Admin",
    "OPERATOR": "Can Add & Move Assets",
    "VIEWER": "View Only",
    "SELF_SERVICE": "Own Assets Only",
}
HEAD_OFFICE_LABEL = "Head-office Admin"

TEAM_WORDS = {"IT": "the IT team", "NON_IT": "the Admin / Non-IT team"}
ITEM_WORDS = {"IT": "IT items", "NON_IT": "Non-IT items"}
AREA_WORDS = {"IT": "IT", "NON_IT": "Non-IT"}

ASK_ADMIN = "Ask an admin or the head-office admin."
ASK_HEAD_OFFICE = "Ask the head-office admin to do it."


# ---------------------------------------------------------------- who is who

def is_head_office(user) -> bool:
    return bool(getattr(user, "is_primary_owner", False))


def can_write(user) -> bool:
    """ADMIN or OPERATOR (the head-office admin's row is always role ADMIN)."""
    return user.role in WRITE_ROLES or is_head_office(user)


async def work_areas(session: AsyncSession, user) -> tuple[str, ...]:
    """The work areas this login actually works in: both for the head-office
    admin and an unrestricted ADMIN, the configured one(s) for everyone else;
    none for a self-service login (it only ever sees what it holds)."""
    if user.role == "SELF_SERVICE" and not is_head_office(user):
        return ()
    domains = await allowed_asset_domains(session, user)
    return ALL_AREAS if domains is None else tuple(d for d in ALL_AREAS if d in domains)


def work_area_label(areas: tuple[str, ...]) -> str:
    if not areas:
        return "Own assets only"
    if set(areas) == set(ALL_AREAS):
        return "IT and Non-IT"
    return " and ".join(AREA_WORDS[a] for a in areas)


# ------------------------------------------------- the decisions themselves

def can_create_small_master(user) -> bool:
    """Vendor, brand, cost centre, stock room: ADMIN and OPERATOR, in the flow."""
    return can_write(user)


async def item_create_areas(session: AsyncSession, user) -> tuple[str, ...]:
    """Work areas in which this login may create an Item (ADMIN / OPERATOR)."""
    if not can_write(user):
        return ()
    return await work_areas(session, user)


async def domain_manage_areas(session: AsyncSession, user) -> tuple[str, ...]:
    """Work areas in which this login may create / edit / deactivate Categories,
    Sub-categories and Items (ADMIN inside their area; head-office admin both)."""
    if is_head_office(user):
        return ALL_AREAS
    if user.role != "ADMIN":
        return ()
    return await work_areas(session, user)


async def can_change_work_area(session: AsyncSession, user) -> bool:
    """Moving a Category / Item to the other work area: someone who handles both."""
    return set(await domain_manage_areas(session, user)) == set(ALL_AREAS)


def can_manage_heavy_setup(user) -> bool:
    """Edit / deactivate of vendor, brand, cost centre; every heavy master."""
    return is_head_office(user)


async def company_ids_for(session: AsyncSession, user) -> list[int]:
    from app.masters.models import Company          # local: masters imports nothing from core.capabilities
    allowed = await scoped_company_ids(session, user)
    if allowed is not None:
        return sorted(allowed)
    return list((await session.execute(
        select(Company.id).where(Company.is_active.is_(True)).order_by(Company.id)
    )).scalars().all())


# ----------------------------------------------------- the 403 enforcement

def _forbidden(message: str) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, message)


def require_small_create(noun: str):
    """FastAPI dependency: ADMIN / OPERATOR may add `noun` (e.g. "a vendor").
    Runs before the body is read, like require_role, so a view-only login gets
    403 whatever it sends."""
    def checker(user=Depends(get_current_asset_user)):
        if not can_create_small_master(user):
            raise _forbidden(f"Your access does not allow adding {noun}. {ASK_ADMIN}")
        return user
    return checker


def require_head_office(action: str):
    """FastAPI dependency: only the head-office admin may `action`
    (e.g. "change or remove a vendor")."""
    def checker(user=Depends(get_current_asset_user)):
        if not can_manage_heavy_setup(user):
            raise _forbidden(f"Only the head-office admin can {action}. {ASK_HEAD_OFFICE}")
        return user
    return checker


def require_domain_admin(what: str):
    """FastAPI dependency: an ADMIN (any work area) or the head-office admin;
    the work area itself is checked once the record is known. `what` is e.g.
    "add or change categories and sub-categories"."""
    def checker(user=Depends(get_current_asset_user)):
        if not is_head_office(user) and user.role != "ADMIN":
            raise _forbidden(f"Only an admin can {what}. {ASK_ADMIN}")
        return user
    return checker


def outside_area_message(domain: str, mine: tuple[str, ...]) -> str:
    team = TEAM_WORDS.get(domain, "another team")
    allowed = " and ".join(ITEM_WORDS[a] for a in mine) or "nothing here"
    return (f"This belongs to {team}; you can only work with {allowed}. "
            f"Ask someone in {team} or the head-office admin.")


async def ensure_domain_manage(session: AsyncSession, user, domain: str | None) -> None:
    """403 unless this login may manage a Category / Sub-category / Item of `domain`."""
    if domain is None:
        return
    areas = await domain_manage_areas(session, user)
    if domain not in areas:
        if not areas:
            raise _forbidden(f"Only an admin can change categories, sub-categories and Items. {ASK_ADMIN}")
        raise _forbidden(outside_area_message(domain, areas))


async def ensure_item_create(session: AsyncSession, user, domain: str | None) -> None:
    """403 unless this login may create an Item of `domain`."""
    if domain is None:
        return
    areas = await item_create_areas(session, user)
    if domain not in areas:
        if not areas:
            raise _forbidden(f"Your access does not allow adding Items. {ASK_ADMIN}")
        raise _forbidden(outside_area_message(domain, areas))


async def ensure_work_area_change(session: AsyncSession, user, noun: str) -> None:
    """403 unless this login may move `noun` (e.g. "a category") to the other work area."""
    if not await can_change_work_area(session, user):
        raise _forbidden(
            f"Only someone who handles both IT and Non-IT, or the head-office admin, can move {noun} "
            "to the other team. Ask the head-office admin."
        )


async def ensure_company_for_create(session: AsyncSession, user, company_id: int | None, noun: str) -> None:
    """403 when a scoped login aims a new record at a company outside its scope."""
    allowed = await scoped_company_ids(session, user)
    if allowed is None:
        return
    if company_id is None or company_id not in allowed:
        raise _forbidden(
            f"You can only add {noun} for your own company. Ask the head-office admin to add it for another company."
        )


# -------------------------------------------------------- the whole answer

async def capabilities(session: AsyncSession, user) -> dict:
    head_office = is_head_office(user)
    areas = await work_areas(session, user)
    item_areas = await item_create_areas(session, user)
    manage_areas = await domain_manage_areas(session, user)
    small = can_create_small_master(user)
    heavy = can_manage_heavy_setup(user)
    return {
        "role": user.role,
        "role_label": HEAD_OFFICE_LABEL if head_office else ROLE_LABELS.get(user.role, user.role),
        "is_head_office_admin": head_office,
        "work_areas": list(areas),
        "work_area_label": work_area_label(areas),
        "can_create": {
            "vendor": small,
            "brand": small,
            "cost_centre": small,
            "stock_room": small,
            "item": bool(item_areas),
            "category": bool(manage_areas),
            "sub_category": bool(manage_areas),
        },
        # The work areas the two domain-owned answers cover.
        "item_create_work_areas": list(item_areas),
        "domain_manage_work_areas": list(manage_areas),
        "can_manage": {
            # edit / deactivate
            "vendor": heavy,
            "brand": heavy,
            "cost_centre": heavy,
            "category": bool(manage_areas),
            "sub_category": bool(manage_areas),
            "item": bool(manage_areas),
            "change_work_area": await can_change_work_area(session, user),
            "erp_vendor_link": small,
            "erp_vendor_unlink": heavy,
            "users": can_administer_system(user),
            # heavy setup: head-office admin only
            "company": heavy,
            "location": heavy,
            "department": heavy,
            "custom_field": heavy,
            "bundle": heavy,
            "code_rule": heavy,
            "item_rules": heavy,
            "erp_setup": heavy,
            "imports": heavy,
        },
        "company_ids": await company_ids_for(session, user),
    }
