"""S5: People & Places -- typed creation and one list over the same `asset_user` table (no new table).

The menu is the type (CKAM_SIMPLIFIED_OPERATING_MODEL §6): Employees, Stores, Stock Rooms, Install Points.
* POST /api/people/employees     an Employee (+ an optional login: role in words, work area, extra companies)
* POST /api/people/stores        a Store AND its Stock Room (STK-<code>) AND its Install Point (INS-<code>),
                                 reusing whatever already exists -- running it twice creates nothing new
* POST /api/people/install-points
* POST /api/people/stores/ensure-rooms   (head-office admin) gives every existing store its two rooms
* GET  /api/people?kind=employees|stores|stock-rooms|install-points&company_id=&q=&limit=&offset=
Stock rooms keep their own S3a-1 endpoint (/api/stock-rooms, ADMIN + OPERATOR). Everything else here is
ADMIN-only (the head-office admin included), with the S0 / S2 account rules of /api/asset-users: role and
work-area values checked, an ADMIN limited to one work area cannot give a wider one, codes unique per company
(any case), email format, active company / location / department."""
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.kinds import INSTALL_POINT_PREFIX, KIND_CHOICE_MESSAGE, KIND_LABELS, KIND_PARAMS, kind_label
from app.asset_users.models import ALLOWED_ASSET_DOMAINS, ROLES, AssetUser, AssetUserCompanyAccess
from app.asset_users.router import (
    _refuse_wider_work_area, _validate_asset_user_fields, _validate_asset_user_references, _validate_new_values,
)
from app.asset_users.stock_rooms import resolve_location
from app.asset_users.store_rooms import ensure_store_rooms, room_codes
from app.core.capabilities import (
    HEAD_OFFICE_LABEL, ROLE_LABELS, ensure_company_for_create, require_domain_admin, work_area_label,
)
from app.core.codes import unique_code
from app.core.db import get_session
from app.core.deps import READ_ROLES, require_primary_owner, require_role, scoped_company_ids
from app.core.validation import InModel, MAX_BULK_IDS, clean_optional, escape_like, require_text
from app.erp.stores import store_email
from app.masters.models import Company, Department, Location

router = APIRouter(prefix="/api/people", tags=["people"])

ADMIN_WHAT = "add people and places"
STORE_CODE = re.compile(r"^[A-Z]{3}[A-Z0-9]?$")
STORE_CODE_MESSAGE = "A store code has three letters and at most one more letter or digit (for example LAM or SPR2)."
DUPLICATE_CODE = "A person or place with the code {code} already exists in this company."
CODE_LENGTH = 20
STAFF_ROLES = ("ADMIN", "OPERATOR", "VIEWER")
ROLE_MESSAGE = "Choose an access level: full admin, can add and move, can only view, or sees own assets."
WORK_AREA_MESSAGE = "Choose a work area: IT, Non-IT or both."


# ---------------------------------------------------------------- the list row

class PersonOut(BaseModel):
    id: int
    kind: str | None                 # EMPLOYEE / STORE / STOCK_POINT / INSTALLED
    kind_label: str | None           # Employee / Store / Stock Room / Install Point
    code: str | None
    name: str
    company_id: int | None
    company_code: str | None = None
    company_name: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str
    role_label: str | None = None    # only for someone who can sign in
    work_area: str | None = None     # IT / NON_IT / BOTH -- only for a staff login
    work_area_label: str | None = None
    login_enabled: bool
    has_password: bool
    must_change_password: bool
    is_primary_owner: bool
    is_active: bool


def _work_area(user: AssetUser) -> str | None:
    if not user.login_enabled or user.role not in STAFF_ROLES:
        return None
    if user.is_primary_owner:
        return "BOTH"
    return user.allowed_asset_domains or "BOTH"


def _person(user: AssetUser, company_code, company_name, location_name, department_name) -> PersonOut:
    area = _work_area(user)
    return PersonOut(
        id=user.id, kind=user.asset_user_type, kind_label=kind_label(user.asset_user_type), code=user.code,
        name=user.name, company_id=user.company_id, company_code=company_code, company_name=company_name,
        location_id=user.location_id, location_name=location_name, department_id=user.department_id,
        department_name=department_name, email=user.email, phone=user.phone, role=user.role,
        role_label=(HEAD_OFFICE_LABEL if user.is_primary_owner else ROLE_LABELS.get(user.role)) if user.login_enabled else None,
        work_area=area,
        work_area_label=None if area is None else work_area_label(("IT", "NON_IT") if area == "BOTH" else (area,)),
        login_enabled=user.login_enabled, has_password=user.password_hash is not None,
        must_change_password=user.must_change_password, is_primary_owner=user.is_primary_owner, is_active=user.is_active,
    )


def _people_select():
    return (
        select(AssetUser, Company.code, Company.name, Location.name, Department.name)
        .outerjoin(Company, Company.id == AssetUser.company_id)
        .outerjoin(Location, Location.id == AssetUser.location_id)
        .outerjoin(Department, Department.id == AssetUser.department_id)
    )


async def people_out(session: AsyncSession, ids: list[int]) -> dict[int, PersonOut]:
    """The list rows of these people / places (one query)."""
    if not ids:
        return {}
    rows = (await session.execute(_people_select().where(AssetUser.id.in_(ids)))).all()
    return {u.id: _person(u, cc, cn, ln, dn) for u, cc, cn, ln, dn in rows}


async def person_out(session: AsyncSession, user_id: int) -> PersonOut:
    return (await people_out(session, [user_id]))[user_id]


@router.get("", response_model=list[PersonOut])
async def list_people(
    response: Response,
    kind: str | None = Query(None, max_length=30),
    company_id: int | None = Query(None),
    q: str | None = Query(None, max_length=200),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role(*READ_ROLES)),
):
    """Active people and places of the caller's companies (scoped like GET /api/asset-users), one kind or
    all four, searched by code / name / email / phone / place (`q`), ordered by name. `X-Total-Count` = all
    matches before paging. A company outside the caller's scope gives an empty list."""
    wanted = None
    if kind is not None and kind.strip():
        wanted = KIND_PARAMS.get(kind.strip().lower().replace("_", "-"))
        if wanted is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, KIND_CHOICE_MESSAGE)
    allowed = await scoped_company_ids(session, actor)
    stmt = _people_select().where(AssetUser.is_active.is_(True), AssetUser.asset_user_type.in_(list(KIND_LABELS)))
    if company_id is not None:
        if allowed is not None and company_id not in allowed:
            response.headers["X-Total-Count"] = "0"
            return []
        stmt = stmt.where(AssetUser.company_id == company_id)
    elif allowed is not None:
        stmt = stmt.where(AssetUser.company_id.in_(allowed))
    if wanted is not None:
        stmt = stmt.where(AssetUser.asset_user_type == wanted)
    if q and q.strip():
        pattern = f"%{escape_like(q.strip())}%"
        stmt = stmt.where(or_(*(c.ilike(pattern, escape="\\") for c in (
            AssetUser.code, AssetUser.name, AssetUser.email, AssetUser.phone, Location.name,
        ))))
    total = (await session.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    rows = (await session.execute(
        stmt.order_by(func.lower(AssetUser.name), AssetUser.id).limit(limit).offset(offset)
    )).all()
    response.headers["X-Total-Count"] = str(total)
    return [_person(u, cc, cn, ln, dn) for u, cc, cn, ln, dn in rows]


# ---------------------------------------------------------------- employees

class LoginIn(InModel):
    enabled: bool = False
    role: str | None = Field(default=None, max_length=20)
    work_area: str | None = Field(default=None, max_length=10)
    extra_company_ids: list[int] = Field(default_factory=list, max_length=MAX_BULK_IDS)


class PlaceFields(InModel):
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


class EmployeeIn(PlaceFields):
    code: str = Field(max_length=50)
    department_id: int | None = None
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    login: LoginIn | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        return require_text(value, "Code")

    @field_validator("email", "phone")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return clean_optional(value)


def _parse_role(value: str | None) -> str:
    text = (value or "").strip().upper().replace("-", "_").replace(" ", "_")
    if not text:
        return "SELF_SERVICE"
    if text not in ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, ROLE_MESSAGE)
    return text


def _parse_area(value: str | None) -> str | None:
    text = (value or "").strip().upper().replace("-", "_").replace(" ", "_")
    if not text:
        return None
    if text not in ALLOWED_ASSET_DOMAINS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, WORK_AREA_MESSAGE)
    return text


@router.post("/employees", response_model=PersonOut, status_code=201)
async def create_employee(
    body: EmployeeIn, session: AsyncSession = Depends(get_session), actor=Depends(require_domain_admin(ADMIN_WHAT)),
):
    """An Employee, optionally able to sign in: `login.enabled`, `login.role` (ADMIN / OPERATOR / VIEWER /
    SELF_SERVICE; default SELF_SERVICE = sees own assets), `login.work_area` (IT / NON_IT / BOTH) and
    `login.extra_company_ids`. No password is set here: issue one with POST /api/asset-users/issue-passwords
    (or Reset Password). Where the employee sits: `location_id`, or `location_name` (an existing place of that
    company with that name, else a new one)."""
    await ensure_company_for_create(session, actor, body.company_id, "an employee")
    login = body.login or LoginIn()
    if not login.enabled and (clean_optional(login.work_area) or login.extra_company_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "A work area and extra companies can only be given to someone who can log in.")
    role = _parse_role(login.role) if login.enabled else "SELF_SERVICE"
    area = _parse_area(login.work_area) if login.enabled else None
    company = await session.get(Company, body.company_id)
    if company is None or not company.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The company you chose does not exist or is no longer active.")
    location = await resolve_location(session, actor, company.id, body.location_id, body.location_name,
                                      noun="employee", missing="Choose where the employee sits, or type the name of the place.")
    data = {
        "company_id": company.id, "code": body.code, "name": body.name, "asset_user_type": "EMPLOYEE",
        "location_id": location.id, "department_id": body.department_id, "email": body.email, "phone": body.phone,
        "role": role, "login_enabled": login.enabled, "primary_asset_domain": None, "allowed_asset_domains": area,
    }
    _validate_asset_user_fields(data)
    await _validate_asset_user_references(session, data)
    await _validate_new_values(session, data, None)
    await _refuse_wider_work_area(session, actor, data, None)
    extra = [c for c in dict.fromkeys(login.extra_company_ids) if c != company.id]
    if extra:
        found = set((await session.execute(
            select(Company.id).where(Company.id.in_(extra), Company.is_active.is_(True))
        )).scalars().all())
        if len(found) != len(extra):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "One of the companies you chose does not exist or is no longer active.")
    user = AssetUser(**data, created_by=actor.id, updated_by=actor.id)
    session.add(user)
    try:
        await session.flush()
        for company_id in extra:
            session.add(AssetUserCompanyAccess(asset_user_id=user.id, company_id=company_id))
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, DUPLICATE_CODE.format(code=body.code))
    return await person_out(session, user.id)


# ---------------------------------------------------------------- stores

class StoreIn(PlaceFields):
    code: str = Field(max_length=10)

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        text = require_text(value, "Store code").upper()
        if not STORE_CODE.match(text):
            raise ValueError(STORE_CODE_MESSAGE)
        return text


class StoreOut(BaseModel):
    store: PersonOut
    stock_room: PersonOut | None
    install_point: PersonOut | None
    created: list[str]               # of "store", "stock_room", "install_point"
    reused: list[str]
    problems: list[str] = []


async def _store_location(session: AsyncSession, actor, company_id: int, body: StoreIn) -> Location:
    if body.location_id is not None or body.location_name is not None:
        return await resolve_location(session, actor, company_id, body.location_id, body.location_name, noun="store")
    # As for stores made from the ERP: the company's place with the store's code, else a new one.
    found = (await session.execute(
        select(Location).where(Location.company_id == company_id, Location.is_active.is_(True),
                               func.upper(func.trim(Location.code)) == body.code)
        .order_by(Location.id).limit(1)
    )).scalars().first()
    if found is not None:
        return found
    code = await unique_code(session, Location, body.code, max_length=CODE_LENGTH, fallback="LOC", separator="-",
                             scope={"company_id": company_id})
    location = Location(company_id=company_id, code=code, name=body.name, created_by=actor.id, updated_by=actor.id)
    session.add(location)
    await session.flush()
    return location


@router.post("/stores", response_model=StoreOut, status_code=201)
async def create_store(
    body: StoreIn, response: Response, session: AsyncSession = Depends(get_session),
    actor=Depends(require_domain_admin(ADMIN_WHAT)),
):
    """A Store (code: three letters, optionally one more letter or digit; login email from the store email
    rule, able to sign in but with NO password until one is issued) together with its Stock Room and its
    Install Point. Whatever already exists is reused (a store with this code, STK-<code>, INS-<code>), so
    running it twice creates nothing new: 201 when something was created, 200 when everything existed."""
    await ensure_company_for_create(session, actor, body.company_id, "a store")
    company = await session.get(Company, body.company_id)
    if company is None or not company.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The company you chose does not exist or is no longer active.")
    created: list[str] = []
    reused: list[str] = []
    store = (await session.execute(
        select(AssetUser).where(AssetUser.company_id == company.id, func.upper(func.trim(AssetUser.code)) == body.code)
        .limit(1)
    )).scalars().first()
    if store is not None:
        if store.asset_user_type != "STORE" or not store.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, DUPLICATE_CODE.format(code=body.code))
        reused.append("store")
    else:
        email = store_email(body.code)
        taken = (await session.execute(
            select(AssetUser.id).where(AssetUser.company_id == company.id,
                                       func.lower(func.trim(AssetUser.email)) == email.lower()).limit(1)
        )).first()
        if taken is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"The login email {email} is already used by someone else in this company.")
        location = await _store_location(session, actor, company.id, body)
        store = AssetUser(
            company_id=company.id, code=body.code, name=body.name, asset_user_type="STORE", location_id=location.id,
            email=email, role="SELF_SERVICE", login_enabled=True, must_change_password=True,
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(store)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, DUPLICATE_CODE.format(code=body.code))
        created.append("store")
    rooms = await ensure_store_rooms(session, actor, store)
    if rooms["problems"]:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, rooms["problems"][0])
    created += rooms["created"]
    reused += rooms["reused"]
    await session.commit()
    rows = await people_out(session, [r.id for r in (store, rooms["stock_room"], rooms["install_point"]) if r is not None])
    if not created:
        response.status_code = status.HTTP_200_OK
    return StoreOut(
        store=rows[store.id],
        stock_room=rows.get(rooms["stock_room"].id) if rooms["stock_room"] is not None else None,
        install_point=rows.get(rooms["install_point"].id) if rooms["install_point"] is not None else None,
        created=created, reused=reused,
    )


@router.post("/stores/ensure-rooms")
async def ensure_rooms_for_every_store(
    company_id: int | None = Query(None), session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    """Head-office admin: gives every active store (of one company, or all) the Stock Room and Install Point
    it lacks. Nothing that exists is changed; a store whose room code is taken by something else is listed
    in `problems` and the rest go ahead."""
    stmt = select(AssetUser).where(AssetUser.asset_user_type == "STORE", AssetUser.is_active.is_(True))
    if company_id is not None:
        stmt = stmt.where(AssetUser.company_id == company_id)
    stores = list((await session.execute(stmt.order_by(AssetUser.company_id, AssetUser.code))).scalars().all())
    known = await room_codes(session, sorted({s.company_id for s in stores}) if stores else [])
    companies = dict((await session.execute(select(Company.id, Company.code))).all()) if stores else {}
    counts = {"stores_checked": len(stores), "stores_completed": 0, "already_complete": 0,
              "stock_rooms_created": 0, "install_points_created": 0}
    problems: list[dict] = []
    for store in stores:
        rooms = await ensure_store_rooms(session, actor, store, known)
        counts["stock_rooms_created"] += "stock_room" in rooms["created"]
        counts["install_points_created"] += "install_point" in rooms["created"]
        if rooms["created"]:
            counts["stores_completed"] += 1
        elif not rooms["problems"]:
            counts["already_complete"] += 1
        problems += [{"store_code": store.code, "company_code": companies.get(store.company_id), "message": m}
                     for m in rooms["problems"]]
    await session.commit()
    return {**counts, "problems": problems}


# ---------------------------------------------------------------- install points

class InstallPointOut(PersonOut):
    created: bool = True


@router.post("/install-points", response_model=InstallPointOut, status_code=201)
async def create_install_point(
    body: PlaceFields, response: Response, session: AsyncSession = Depends(get_session),
    actor=Depends(require_domain_admin(ADMIN_WHAT)),
):
    """An Install Point (where things are fixed in place). Code made from the name (INS-...); it never signs
    in. The same name again in the same company returns the existing one (200, `created: false`)."""
    await ensure_company_for_create(session, actor, body.company_id, "an install point")
    company = await session.get(Company, body.company_id)
    if company is None or not company.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The company you chose does not exist or is no longer active.")

    async def existing() -> AssetUser | None:
        return (await session.execute(
            select(AssetUser).where(
                AssetUser.company_id == company.id, AssetUser.asset_user_type == "INSTALLED", AssetUser.is_active.is_(True),
                func.lower(func.trim(AssetUser.name)) == body.name.lower(),
            ).order_by(AssetUser.id).limit(1)
        )).scalars().first()

    found = await existing()
    if found is not None:
        response.status_code = status.HTTP_200_OK
        return InstallPointOut(**(await person_out(session, found.id)).model_dump(), created=False)
    location = await resolve_location(session, actor, company.id, body.location_id, body.location_name, noun="install point")
    code = await unique_code(session, AssetUser, body.name, max_length=CODE_LENGTH, fallback="POINT",
                             prefix=INSTALL_POINT_PREFIX, separator="-", scope={"company_id": company.id})
    point = AssetUser(
        company_id=company.id, code=code, name=body.name, asset_user_type="INSTALLED", location_id=location.id,
        role="SELF_SERVICE", login_enabled=False, created_by=actor.id, updated_by=actor.id,
    )
    session.add(point)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        again = await existing()
        if again is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "This install point could not be saved. Try again.")
        response.status_code = status.HTTP_200_OK
        return InstallPointOut(**(await person_out(session, again.id)).model_dump(), created=False)
    return InstallPointOut(**(await person_out(session, point.id)).model_dump(), created=True)
