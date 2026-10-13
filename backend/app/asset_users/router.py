from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from app.core.validation import check_email
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import (
    READ_ROLES, allowed_asset_domains, get_current_asset_user, require_primary_owner, require_role, scoped_company_ids,
    work_area_words,
)
from app.asset_users.service import AssetUserService
from app.asset_users.schemas import (
    MAX_ISSUE_PASSWORDS, CompanyAccessIn, CompanyAccessOut, AssetUserIn, AssetUserOut, AssetUserUpdateIn,
    IssuedPasswordOut, IssuePasswordsIn, ResetPasswordOut,
)
from app.asset_users.models import ALLOWED_ASSET_DOMAINS, ASSET_USER_TYPES, PRIMARY_ASSET_DOMAINS, ROLES, AssetUser
from app.masters.bulk_import_export import (
    FieldSpec, ImportScopeError, ImportTemplateError,
    build_template as build_import_template, commit_import, export_rows, preview_import,
)
from app.masters.models import Company, Department, Location
from app.masters.schemas import CompanyOut

router = APIRouter(prefix="/api/asset-users", tags=["asset-users"])

# AM-25: AssetUser import reuses the exact same generic engine every master
# uses (app.masters.bulk_import_export) rather than a bespoke copy -- the
# only thing genuinely different here is that it's ADMIN-only (matching
# create_asset_user's own role requirement, stricter than the ADMIN+OPERATOR
# masters use) and that an imported asset_user gets no password (password_hash
# stays NULL, must_change_password defaults True on the model itself) --
# an ADMIN activates login for one afterward via the existing Reset
# Password action, same as any other asset_user that doesn't need one yet
# (STORE/STOCK_POINT/INSTALLED types typically never do). The Primary Owner
# is never created via import -- it has no company/location/code to import
# against (see require_primary_owner in app.core.deps).
ASSET_USER_IMPORT_FIELDS = [
    FieldSpec("Company Code", "company_id", required=True, lookup=(Company, "code")),
    FieldSpec("Code", "code", required=True, max_length=50),
    FieldSpec("Name", "name", required=True, max_length=200),
    FieldSpec("Type", "asset_user_type", required=True, kind="enum", enum_values=ASSET_USER_TYPES),
    FieldSpec("Location Code", "location_id", required=True, lookup=(Location, "code"), scope_by="company_id"),
    FieldSpec("Department", "department_id", lookup=(Department, "name")),
    FieldSpec("Email", "email", max_length=200),
    FieldSpec("Phone", "phone", max_length=30),
    FieldSpec("Role", "role", required=True, kind="enum", enum_values=ROLES),
]


@router.get("/export")
async def export_asset_users(
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
    allowed = await scoped_company_ids(session, asset_user)
    content = await export_rows(session, AssetUser, ASSET_USER_IMPORT_FIELDS, allowed, "company_id")
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=asset_users_export.xlsx"},
    )


@router.get("/import/template")
async def asset_users_import_template(_h=Depends(require_role("ADMIN"))):
    return Response(
        content=build_import_template(ASSET_USER_IMPORT_FIELDS),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=asset_users_import_template.xlsx"},
    )


@router.post("/import/preview")
async def asset_users_import_preview(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
    content = await file.read()
    allowed = await scoped_company_ids(session, asset_user)
    try:
        return await preview_import(session, ASSET_USER_IMPORT_FIELDS, content, allowed, "company_id")
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/import/commit")
async def asset_users_import_commit(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
    content = await file.read()
    allowed = await scoped_company_ids(session, asset_user)
    try:
        result = await commit_import(session, AssetUser, ASSET_USER_IMPORT_FIELDS, content, asset_user, allowed, "company_id")
    except ImportScopeError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    return result


@router.get("/me/companies", response_model=list[CompanyOut])
async def my_companies(
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    """AM-24: which companies the CURRENT caller may create/write records
    under -- their own home company, plus any granted via
    asset_user_company_access (ADMIN: every active company). Add Asset/New PO
    use this to offer a Company picker only when it's actually meaningful
    (more than one company), rather than always silently using the
    caller's own home company regardless of what else they've been
    granted."""
    allowed = await scoped_company_ids(session, asset_user)
    stmt = select(Company).where(Company.is_active.is_(True)).order_by(Company.name)
    if allowed is not None:
        stmt = stmt.where(Company.id.in_(allowed))
    return (await session.execute(stmt)).scalars().all()


def _effective_work_area(data: dict) -> set[str]:
    """Which work areas this account would actually work in once saved: none
    for an account that cannot log in or a self-service login (custody only),
    else its allowed_asset_domains (BOTH / unset = both)."""
    if not data.get("login_enabled") or data.get("role") not in ("ADMIN", "OPERATOR", "VIEWER"):
        return set()
    value = data.get("allowed_asset_domains") or "BOTH"
    return {"IT", "NON_IT"} if value == "BOTH" else {value}


async def _refuse_wider_work_area(session: AsyncSession, actor: AssetUser, data: dict, existing: AssetUser | None) -> None:
    """S0 leftover: an ADMIN limited to one work area (IT or Non-IT) may not
    give anyone -- new or existing -- a wider work area than their own (403).
    Editing someone who already had a wider area is fine as long as the edit
    does not widen it further (their phone number can still be corrected)."""
    mine = await allowed_asset_domains(session, actor)
    if mine is None:
        return
    after = _effective_work_area(data)
    if after <= set(mine):
        return
    before = _effective_work_area({f: getattr(existing, f) for f in ("login_enabled", "role", "allowed_asset_domains")}) \
        if existing is not None else set()
    if after <= before:
        return
    words = " and ".join(work_area_words(d) for d in mine)
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        f"You handle only {words} work, so you cannot give anyone a wider work area than your own. "
        f"Set their work area to {words}, or ask the head-office admin.",
    )


def _validate_asset_user_fields(data: dict, sent: dict | None = None) -> None:
    # AM-01 confirmed asset_user_type/role accepted any string with no validation at all --
    # AM-02 closes that gap, same pattern as documents/router.py's existing doc_type
    # check. ASSET_USER_TYPES/ROLES were already defined in app/asset_users/models.py and used
    # everywhere else in the codebase; they just weren't checked against an incoming
    # request body. S0.7: messages in plain words, never the stored codes.
    if data.get("asset_user_type") not in ASSET_USER_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Choose a type: employee, store, installed at a store, or stock room.")
    if data.get("role") not in ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Choose an access level: full admin, can add and move, can only view, or sees own assets.")
    domain = data.get("primary_asset_domain")
    if domain is not None and domain not in PRIMARY_ASSET_DOMAINS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a default work area: IT, Non-IT or all.")
    allowed_domains = data.get("allowed_asset_domains")
    if allowed_domains is not None and allowed_domains not in ALLOWED_ASSET_DOMAINS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a work area: IT, Non-IT or both.")
    # Spec §13: primary_asset_domain/allowed_asset_domains are only meaningful
    # for a login-capable operational asset_user -- refuse rather than
    # silently store them on a STORE/INSTALLED/STOCK_POINT point-record or a
    # not-yet-activated EMPLOYEE. Email is deliberately NOT gated here: a
    # EMPLOYEE may have a contact email before login is ever enabled for them.
    # S1: on an edit (`sent` = only what the request sent) the check applies to
    # work-area values the request sends; a stored one that was left out stays
    # as it is (it only ever narrows), so switching login off never fails.
    if sent is not None:
        domain = sent.get("primary_asset_domain")
        allowed_domains = sent.get("allowed_asset_domains")
    if not data.get("login_enabled") and (domain or allowed_domains):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A work area can only be set for someone who can log in.",
        )


HEAD_OFFICE_ONLY = "Only a head-office admin can change a head-office admin account."


def _protect_primary_owner(target: AssetUser, actor: AssetUser) -> None:
    """S0.1: an ordinary ADMIN may never reset the password of, edit,
    deactivate, or change the company access of a Primary Owner account (that
    used to let any ADMIN take the owner's login over). A Primary Owner may
    (including their own record)."""
    if target.is_primary_owner and not actor.is_primary_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, HEAD_OFFICE_ONLY)


async def _validate_new_values(session: AsyncSession, data: dict, existing: AssetUser | None) -> None:
    """S0.10: email format and a case-insensitive, trimmed code check -- only
    for what is new or changed, so an existing record is never blocked by
    what it already holds (mixed-case codes stay as they are)."""
    email = data.get("email")
    if email is not None and (existing is None or (existing.email or "").strip() != email):
        try:
            check_email(email)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    code = data.get("code")
    if code is not None and (existing is None or (existing.code or "").strip().lower() != code.lower()
                             or existing.company_id != data.get("company_id")):
        stmt = select(AssetUser.id).where(
            AssetUser.company_id == data.get("company_id"),
            func.lower(func.trim(AssetUser.code)) == code.lower(),
        )
        if existing is not None:
            stmt = stmt.where(AssetUser.id != existing.id)
        if (await session.execute(stmt.limit(1))).first() is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"A person or place with the code {code} already exists in this company.")


async def _validate_asset_user_references(session: AsyncSession, data: dict) -> None:
    # AM-08: `company_id`/`location_id` are NOT NULL foreign keys on `asset_user`
    # (location_id is required by the schema -- it was never actually optional,
    # see DECISIONS.md); `department_id` is genuinely optional. Before AM-08 a
    # nonexistent id here (most commonly the frontend's old `0` sentinel for
    # "nothing selected") reached the database unchecked and surfaced as a raw,
    # unhandled IntegrityError/500. This mirrors _validate_asset_user_fields' own
    # pattern (validate before the service ever touches the session) rather
    # than catching the DB exception after the fact, per the guardrail against
    # leaking DB errors in API responses.
    company = await session.get(Company, data.get("company_id"))
    if company is None or not company.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The company you chose does not exist or is no longer active.")
    location = await session.get(Location, data.get("location_id"))
    if location is None or not location.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The location you chose does not exist or is no longer active.")
    if location.company_id != data.get("company_id"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The location must belong to the same company as the person or place.")
    department_id = data.get("department_id")
    if department_id is not None:
        department = await session.get(Department, department_id)
        if department is None or not department.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The department you chose does not exist or is no longer active.")


@router.get("", response_model=list[AssetUserOut])
async def list_asset_users(
    company_id: int | None = Query(None),
    asset_user_type: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role(*READ_ROLES)),
):
    # Staff only: the list carries every asset_user's email/phone, and a ASSET_USER may
    # only see their own currently-held assets (spec §6) -- 403 for them.
    allowed_company_ids = await scoped_company_ids(session, asset_user)
    rows = await AssetUserService(session).list(
        asset_user_type=asset_user_type,
        allowed_company_ids=allowed_company_ids,
        requested_company_id=company_id,
    )
    # S1 (additive): the location's name and the company's code with each row,
    # from one lookup per list (never one per row).
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


@router.post("", response_model=AssetUserOut, status_code=201)
async def create_asset_user(
    body: AssetUserIn,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
    data = body.model_dump()
    _validate_asset_user_fields(data)
    await _validate_asset_user_references(session, data)
    await _validate_new_values(session, data, None)
    await _refuse_wider_work_area(session, asset_user, data, None)
    try:
        return await AssetUserService(session).create(data, asset_user.id)
    except IntegrityError:
        # AM-09: `code` is unique per company (AssetUser.__table_args__) -- reusing
        # one is an ordinary mistake, not malformed input, and previously hit an
        # unhandled 500 (a raw asyncpg UniqueViolationError) instead of a normal
        # validation error. Rollback is required before the session can be used
        # again in this request (a failed INSERT leaves the transaction aborted).
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A person or place with this code already exists in this company.")


ISSUE_KINDS = {"stores": "STORE", "employees": "EMPLOYEE"}


@router.post("/issue-passwords", response_model=list[IssuedPasswordOut])
async def issue_passwords(
    body: IssuePasswordsIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN")),
):
    """S5: a temporary password for many accounts at once (e.g. every new store), each to be changed at the
    next sign-in. Accounts: `asset_user_ids`, and/or `kind` ("stores" / "employees") and/or `company_id`;
    only active accounts that can sign in; by default only those without a password yet
    (`only_without_password`). Head-office admin accounts and the caller's own account are never included.
    At most 500 accounts per call (more -> 422, nothing issued). The passwords are returned ONLY in this
    answer -- never logged, audited or shown again."""
    kind = None
    if body.kind is not None and body.kind.strip():
        kind = ISSUE_KINDS.get(body.kind.strip().lower())
        if kind is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose stores or employees.")
    if not body.asset_user_ids and kind is None and body.company_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Choose whose passwords to issue: pick the accounts, or choose stores or employees.")
    stmt = select(AssetUser).where(
        AssetUser.is_active.is_(True), AssetUser.login_enabled.is_(True), AssetUser.is_primary_owner.is_(False),
        AssetUser.id != actor.id,
    )
    if body.asset_user_ids:
        stmt = stmt.where(AssetUser.id.in_(set(body.asset_user_ids)))
    if kind is not None:
        stmt = stmt.where(AssetUser.asset_user_type == kind)
    if body.company_id is not None:
        stmt = stmt.where(AssetUser.company_id == body.company_id)
    allowed = await scoped_company_ids(session, actor)
    if allowed is not None:
        stmt = stmt.where(AssetUser.company_id.in_(allowed))
    if body.only_without_password:
        stmt = stmt.where(AssetUser.password_hash.is_(None))
    count = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    if count > MAX_ISSUE_PASSWORDS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"That is {count:,} accounts; at most {MAX_ISSUE_PASSWORDS} can be given a password at a time. "
            "Choose a company, or pick the accounts.",
        )
    users = list((await session.execute(stmt.order_by(AssetUser.company_id, AssetUser.code, AssetUser.id))).scalars().all())
    issued = await AssetUserService(session).issue_passwords(users, actor.id)
    return [
        IssuedPasswordOut(asset_user_id=u.id, code=u.code, name=u.name, email=u.email, temp_password=temp)
        for u, temp in issued
    ]


async def _get_target(session: AsyncSession, asset_user_id: int, actor: AssetUser) -> AssetUser:
    target = await AssetUserService(session).get(asset_user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This person or place was not found.")
    _protect_primary_owner(target, actor)
    return target


EDITABLE_FIELDS = (
    "company_id", "code", "name", "asset_user_type", "location_id", "department_id", "email", "phone",
    "role", "login_enabled", "primary_asset_domain", "allowed_asset_domains",
)
CANNOT_CLEAR = {
    "company_id": "Choose the company.", "asset_user_type": "Choose a type: employee, store, installed at a store, or stock room.",
    "location_id": "Choose the location.",
}


@router.put("/{asset_user_id}", response_model=AssetUserOut)
async def update_asset_user(
    asset_user_id: int,
    body: AssetUserUpdateIn,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
    """S1: only the fields the request sends change; a field left out keeps
    its stored value (the work area, role, login and email used to be reset
    by an edit form that did not send them). A field sent as null / blank is
    cleared where that is allowed."""
    target = await _get_target(session, asset_user_id, asset_user)
    sent = body.model_dump(exclude_unset=True)
    for field, message in CANNOT_CLEAR.items():
        if field in sent and sent[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, message)
    if "login_enabled" in sent and sent["login_enabled"] is None:
        sent["login_enabled"] = False
    data = {field: getattr(target, field) for field in EDITABLE_FIELDS}
    data.update(sent)
    _validate_asset_user_fields(data, sent=sent)
    await _validate_asset_user_references(session, data)
    await _validate_new_values(session, data, target)
    await _refuse_wider_work_area(session, asset_user, data, target)
    try:
        obj = await AssetUserService(session).update(asset_user_id, data, asset_user.id)
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A person or place with this code already exists in this company.")
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return obj


@router.delete("/{asset_user_id}", status_code=204)
async def deactivate_asset_user(
    asset_user_id: int,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
    await _get_target(session, asset_user_id, asset_user)
    try:
        ok = await AssetUserService(session).deactivate(asset_user_id, asset_user.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.post("/{asset_user_id}/primary-owner", response_model=AssetUserOut)
async def grant_primary_owner(
    asset_user_id: int,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    """Only an existing Primary Owner may create another one (spec: "fixed",
    never selectable through the ordinary Role dropdown or Add/Edit form) --
    see require_primary_owner in app.core.deps for why this is not merely
    ADMIN-gated."""
    obj = await AssetUserService(session).set_primary_owner(asset_user_id, True, actor.id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return obj


@router.delete("/{asset_user_id}/primary-owner", response_model=AssetUserOut)
async def revoke_primary_owner(
    asset_user_id: int,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    try:
        obj = await AssetUserService(session).set_primary_owner(asset_user_id, False, actor.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return obj


@router.post("/{asset_user_id}/reset-password", response_model=ResetPasswordOut)
async def reset_password(
    asset_user_id: int,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN")),
):
    # Spec §51: Reset Password only applies to a login-capable asset_user --
    # a STORE/INSTALLED/STOCK_POINT point-record (or an EMPLOYEE that was
    # never activated for login) has nothing meaningful to reset.
    target = await _get_target(session, asset_user_id, actor)
    if not target.login_enabled:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This person or place cannot log in, so there is no password to reset.")
    temp = await AssetUserService(session).reset_password(asset_user_id, actor.id)
    if temp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return ResetPasswordOut(temp_password=temp)


@router.post("/{asset_user_id}/company-access", status_code=204)
async def set_company_access(
    asset_user_id: int,
    body: CompanyAccessIn,
    session: AsyncSession = Depends(get_session),
    _actor=Depends(require_role("ADMIN")),
):
    await _get_target(session, asset_user_id, _actor)
    company_ids = list(dict.fromkeys(body.company_ids))
    if company_ids:
        found = set((await session.execute(
            select(Company.id).where(Company.id.in_(company_ids), Company.is_active.is_(True))
        )).scalars().all())
        if len(found) != len(company_ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "One of the companies you chose does not exist or is no longer active.")
    ok = await AssetUserService(session).set_company_access(asset_user_id, company_ids)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.get("/{asset_user_id}/company-access", response_model=CompanyAccessOut)
async def get_company_access(
    asset_user_id: int,
    session: AsyncSession = Depends(get_session),
    _actor=Depends(require_role("ADMIN")),
):
    """AM-24: the extra companies (beyond the asset_user's own home company)
    this asset_user has been granted -- lets the AssetUsers screen show current
    grants before the ADMIN changes them, rather than only ever writing
    blind."""
    company_ids = await AssetUserService(session).get_company_access(asset_user_id)
    if company_ids is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return CompanyAccessOut(company_ids=company_ids)
