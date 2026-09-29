from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import READ_ROLES, get_current_asset_user, require_primary_owner, require_role, scoped_company_ids
from app.asset_users.service import AssetUserService
from app.asset_users.schemas import CompanyAccessIn, CompanyAccessOut, AssetUserIn, AssetUserOut, ResetPasswordOut
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


def _validate_asset_user_fields(data: dict) -> None:
    # AM-01 confirmed asset_user_type/role accepted any string with no validation at all --
    # AM-02 closes that gap, same pattern as documents/router.py's existing doc_type
    # check. ASSET_USER_TYPES/ROLES were already defined in app/asset_users/models.py and used
    # everywhere else in the codebase; they just weren't checked against an incoming
    # request body.
    if data.get("asset_user_type") not in ASSET_USER_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"asset_user_type must be one of {ASSET_USER_TYPES}")
    if data.get("role") not in ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"role must be one of {ROLES}")
    domain = data.get("primary_asset_domain")
    if domain is not None and domain not in PRIMARY_ASSET_DOMAINS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"primary_asset_domain must be one of {PRIMARY_ASSET_DOMAINS}")
    allowed_domains = data.get("allowed_asset_domains")
    if allowed_domains is not None and allowed_domains not in ALLOWED_ASSET_DOMAINS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"allowed_asset_domains must be one of {ALLOWED_ASSET_DOMAINS}")
    # Spec §13: primary_asset_domain/allowed_asset_domains are only meaningful
    # for a login-capable operational asset_user -- refuse rather than
    # silently store them on a STORE/INSTALLED/STOCK_POINT point-record or a
    # not-yet-activated EMPLOYEE. Email is deliberately NOT gated here: a
    # EMPLOYEE may have a contact email before login is ever enabled for them.
    if not data.get("login_enabled") and (domain or allowed_domains):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "primary_asset_domain/allowed_asset_domains require login_enabled",
        )


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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "company not found or inactive")
    location = await session.get(Location, data.get("location_id"))
    if location is None or not location.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "location not found or inactive")
    if location.company_id != data.get("company_id"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "location must belong to the same company as the asset user")
    department_id = data.get("department_id")
    if department_id is not None:
        department = await session.get(Department, department_id)
        if department is None or not department.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "department not found or inactive")


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
    return await AssetUserService(session).list(
        asset_user_type=asset_user_type,
        allowed_company_ids=allowed_company_ids,
        requested_company_id=company_id,
    )


@router.post("", response_model=AssetUserOut, status_code=201)
async def create_asset_user(
    body: AssetUserIn,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
    data = body.model_dump()
    _validate_asset_user_fields(data)
    await _validate_asset_user_references(session, data)
    try:
        return await AssetUserService(session).create(data, asset_user.id)
    except IntegrityError:
        # AM-09: `code` is unique per company (AssetUser.__table_args__) -- reusing
        # one is an ordinary mistake, not malformed input, and previously hit an
        # unhandled 500 (a raw asyncpg UniqueViolationError) instead of a normal
        # validation error. Rollback is required before the session can be used
        # again in this request (a failed INSERT leaves the transaction aborted).
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "a code already exists for this company")


@router.put("/{asset_user_id}", response_model=AssetUserOut)
async def update_asset_user(
    asset_user_id: int,
    body: AssetUserIn,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
    data = body.model_dump()
    _validate_asset_user_fields(data)
    await _validate_asset_user_references(session, data)
    try:
        obj = await AssetUserService(session).update(asset_user_id, data, asset_user.id)
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "a code already exists for this company")
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return obj


@router.delete("/{asset_user_id}", status_code=204)
async def deactivate_asset_user(
    asset_user_id: int,
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role("ADMIN")),
):
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
    target = await AssetUserService(session).get(asset_user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not target.login_enabled:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "this asset user is not login-enabled")
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
    ok = await AssetUserService(session).set_company_access(asset_user_id, body.company_ids)
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
