"""S3a-1: stock rooms, added in the flow.

A stock room is an asset user of type STOCK_POINT (no new table; the type name
stays internal). ADMIN and OPERATOR may add one for a company they work in --
e.g. "received into" while receiving a PO -- giving only its name and where it
is (an existing Location, or a location name: an active Location of that
company with that name is reused, else one is made). The stock room's code is
made from its name ("STK-HOSTOCK"); it never logs in. Adding the same name
again in the same company returns the existing stock room (200), so a double
click or a retry never makes two."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.asset_users.schemas import AssetUserOut
from app.core.capabilities import ensure_company_for_create, require_small_create
from app.core.codes import unique_code
from app.core.db import get_session
from app.core.deps import WRITE_ROLES, require_role, scoped_company_ids
from app.core.validation import InModel, clean_optional, require_text
from app.masters.models import Company, Location

router = APIRouter(prefix="/api/stock-rooms", tags=["stock-rooms"])

STOCK_ROOM_TYPE = "STOCK_POINT"
CODE_LENGTH = 20            # asset_user.code allows 50; kept short to stay readable
LOCATION_CODE_LENGTH = 20   # location.code column


class StockRoomIn(InModel):
    name: str = Field(max_length=200)
    company_id: int
    location_id: int | None = None
    location_name: str | None = Field(default=None, max_length=200)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return require_text(value, "Name")

    @field_validator("location_name")
    @classmethod
    def _location_name(cls, value: str | None) -> str | None:
        return clean_optional(value)


async def _out(session: AsyncSession, rows: list[AssetUser]) -> list[AssetUserOut]:
    """Same shape as GET /api/asset-users (with location_name and company_code)."""
    location_ids = {r.location_id for r in rows if r.location_id is not None}
    company_ids = {r.company_id for r in rows if r.company_id is not None}
    locations = dict((await session.execute(
        select(Location.id, Location.name).where(Location.id.in_(location_ids))
    )).all()) if location_ids else {}
    companies = dict((await session.execute(
        select(Company.id, Company.code).where(Company.id.in_(company_ids))
    )).all()) if company_ids else {}
    return [
        AssetUserOut.model_validate(r).model_copy(update={
            "location_name": locations.get(r.location_id), "company_code": companies.get(r.company_id),
        })
        for r in rows
    ]


async def _existing(session: AsyncSession, company_id: int, name: str) -> AssetUser | None:
    return (await session.execute(
        select(AssetUser).where(
            AssetUser.company_id == company_id, AssetUser.asset_user_type == STOCK_ROOM_TYPE,
            AssetUser.is_active.is_(True), func.lower(func.trim(AssetUser.name)) == name.lower(),
        ).order_by(AssetUser.id).limit(1)
    )).scalars().first()


async def _location_for(session: AsyncSession, actor, company_id: int, body: StockRoomIn) -> Location:
    if body.location_id is not None:
        location = await session.get(Location, body.location_id)
        if location is None or not location.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The location you chose does not exist or is no longer active.")
        if location.company_id != company_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The location must belong to the same company as the stock room.")
        return location
    if body.location_name is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose where the stock room is, or type the name of the place.")
    found = (await session.execute(
        select(Location).where(
            Location.company_id == company_id, Location.is_active.is_(True),
            func.lower(func.trim(Location.name)) == body.location_name.lower(),
        ).order_by(Location.id).limit(1)
    )).scalars().first()
    if found is not None:
        return found
    code = await unique_code(session, Location, body.location_name, max_length=LOCATION_CODE_LENGTH, fallback="LOC",
                             separator="-", scope={"company_id": company_id})
    location = Location(company_id=company_id, code=code, name=body.location_name,
                        created_by=actor.id, updated_by=actor.id)
    session.add(location)
    await session.flush()
    return location


@router.post("", response_model=AssetUserOut, status_code=201)
async def create_stock_room(
    body: StockRoomIn, response: Response, session: AsyncSession = Depends(get_session),
    actor=Depends(require_small_create("a stock room")),
):
    await ensure_company_for_create(session, actor, body.company_id, "a stock room")
    company = await session.get(Company, body.company_id)
    if company is None or not company.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The company you chose does not exist or is no longer active.")
    existing = await _existing(session, company.id, body.name)
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return (await _out(session, [existing]))[0]
    location = await _location_for(session, actor, company.id, body)
    code = await unique_code(session, AssetUser, body.name, max_length=CODE_LENGTH, fallback="ROOM",
                             prefix="STK-", separator="-", scope={"company_id": company.id})
    room = AssetUser(
        company_id=company.id, code=code, name=body.name, asset_user_type=STOCK_ROOM_TYPE, location_id=location.id,
        role="SELF_SERVICE", login_enabled=False, created_by=actor.id, updated_by=actor.id,
    )
    session.add(room)
    try:
        await session.commit()
    except IntegrityError:
        # two people adding the same stock room at the same moment
        await session.rollback()
        again = await _existing(session, company.id, body.name)
        if again is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "This stock room could not be saved. Try again.")
        response.status_code = status.HTTP_200_OK
        return (await _out(session, [again]))[0]
    await session.refresh(room)
    return (await _out(session, [room]))[0]


@router.get("", response_model=list[AssetUserOut])
async def list_stock_rooms(
    company_id: int | None = Query(None), session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*WRITE_ROLES)),
):
    """Active stock rooms of the caller's companies (one company with
    `company_id`; a company outside the caller's scope gives an empty list)."""
    allowed = await scoped_company_ids(session, actor)
    stmt = select(AssetUser).where(AssetUser.asset_user_type == STOCK_ROOM_TYPE, AssetUser.is_active.is_(True))
    if company_id is not None:
        if allowed is not None and company_id not in allowed:
            return []
        stmt = stmt.where(AssetUser.company_id == company_id)
    elif allowed is not None:
        stmt = stmt.where(AssetUser.company_id.in_(allowed))
    rows = (await session.execute(stmt.order_by(AssetUser.name, AssetUser.id))).scalars().all()
    return await _out(session, list(rows))
