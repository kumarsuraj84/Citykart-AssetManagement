from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import STAFF_ROLES, get_current_holder, require_role, scoped_company_ids
from app.holders.service import HolderService
from app.holders.schemas import CompanyAccessIn, CompanyAccessOut, HolderIn, HolderOut, ResetPasswordOut
from app.holders.models import HOLDER_TYPES, ROLES, Holder
from app.masters.bulk_import_export import (
    FieldSpec, ImportScopeError, ImportTemplateError,
    build_template as build_import_template, commit_import, export_rows, preview_import,
)
from app.masters.models import Company, Department, Location
from app.masters.schemas import CompanyOut

router = APIRouter(prefix="/api/holders", tags=["holders"])

# AM-25: Holder import reuses the exact same generic engine every master
# uses (app.masters.bulk_import_export) rather than a bespoke copy -- the
# only thing genuinely different here is that it's ADMIN-only (matching
# create_holder's own role requirement, stricter than the ADMIN+IT_TEAM
# masters use) and that an imported holder gets no password (password_hash
# stays NULL, must_change_password defaults True on the model itself) --
# an ADMIN activates login for one afterward via the existing Reset
# Password action, same as any other holder that doesn't need one yet
# (STORE/IT_STOCK/INSTALLED types typically never do).
HOLDER_IMPORT_FIELDS = [
    FieldSpec("Company Code", "company_id", required=True, lookup=(Company, "code")),
    FieldSpec("Emp Code", "emp_code", required=True),
    FieldSpec("Name", "name", required=True),
    FieldSpec("Type", "holder_type", required=True, kind="enum", enum_values=HOLDER_TYPES),
    FieldSpec("Location Code", "location_id", required=True, lookup=(Location, "code")),
    FieldSpec("Department", "department_id", lookup=(Department, "name")),
    FieldSpec("Email", "email"),
    FieldSpec("Phone", "phone"),
    FieldSpec("Role", "role", required=True, kind="enum", enum_values=ROLES),
]


@router.get("/export")
async def export_holders(
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN")),
):
    allowed = await scoped_company_ids(session, holder)
    content = await export_rows(session, Holder, HOLDER_IMPORT_FIELDS, allowed, "company_id")
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=holders_export.xlsx"},
    )


@router.get("/import/template")
async def holders_import_template(_h=Depends(require_role("ADMIN"))):
    return Response(
        content=build_import_template(HOLDER_IMPORT_FIELDS),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=holders_import_template.xlsx"},
    )


@router.post("/import/preview")
async def holders_import_preview(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN")),
):
    content = await file.read()
    allowed = await scoped_company_ids(session, holder)
    try:
        return await preview_import(session, HOLDER_IMPORT_FIELDS, content, allowed, "company_id")
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/import/commit")
async def holders_import_commit(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN")),
):
    content = await file.read()
    allowed = await scoped_company_ids(session, holder)
    try:
        result = await commit_import(session, Holder, HOLDER_IMPORT_FIELDS, content, holder, allowed, "company_id")
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
    holder=Depends(get_current_holder),
):
    """AM-24: which companies the CURRENT caller may create/write records
    under -- their own home company, plus any granted via
    holder_company_access (ADMIN: every active company). Add Asset/New PO
    use this to offer a Company picker only when it's actually meaningful
    (more than one company), rather than always silently using the
    caller's own home company regardless of what else they've been
    granted."""
    allowed = await scoped_company_ids(session, holder)
    stmt = select(Company).where(Company.is_active.is_(True)).order_by(Company.name)
    if allowed is not None:
        stmt = stmt.where(Company.id.in_(allowed))
    return (await session.execute(stmt)).scalars().all()


def _validate_holder_fields(data: dict) -> None:
    # AM-01 confirmed holder_type/role accepted any string with no validation at all --
    # AM-02 closes that gap, same pattern as documents/router.py's existing doc_type
    # check. HOLDER_TYPES/ROLES were already defined in app/holders/models.py and used
    # everywhere else in the codebase; they just weren't checked against an incoming
    # request body.
    if data.get("holder_type") not in HOLDER_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"holder_type must be one of {HOLDER_TYPES}")
    if data.get("role") not in ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"role must be one of {ROLES}")


async def _validate_holder_references(session: AsyncSession, data: dict) -> None:
    # AM-08: `company_id`/`location_id` are NOT NULL foreign keys on `holder`
    # (location_id is required by the schema -- it was never actually optional,
    # see DECISIONS.md); `department_id` is genuinely optional. Before AM-08 a
    # nonexistent id here (most commonly the frontend's old `0` sentinel for
    # "nothing selected") reached the database unchecked and surfaced as a raw,
    # unhandled IntegrityError/500. This mirrors _validate_holder_fields' own
    # pattern (validate before the service ever touches the session) rather
    # than catching the DB exception after the fact, per the guardrail against
    # leaking DB errors in API responses.
    company = await session.get(Company, data.get("company_id"))
    if company is None or not company.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "company not found or inactive")
    location = await session.get(Location, data.get("location_id"))
    if location is None or not location.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "location not found or inactive")
    department_id = data.get("department_id")
    if department_id is not None:
        department = await session.get(Department, department_id)
        if department is None or not department.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "department not found or inactive")


@router.get("", response_model=list[HolderOut])
async def list_holders(
    company_id: int | None = Query(None),
    holder_type: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role(*STAFF_ROLES)),
):
    # Staff only: the list carries every holder's email/phone, and a HOLDER may
    # only see their own currently-held assets (spec §6) -- 403 for them.
    allowed_company_ids = await scoped_company_ids(session, holder)
    return await HolderService(session).list(
        holder_type=holder_type,
        allowed_company_ids=allowed_company_ids,
        requested_company_id=company_id,
    )


@router.post("", response_model=HolderOut, status_code=201)
async def create_holder(
    body: HolderIn,
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN")),
):
    data = body.model_dump()
    _validate_holder_fields(data)
    await _validate_holder_references(session, data)
    try:
        return await HolderService(session).create(data, holder.id)
    except IntegrityError:
        # AM-09: `emp_code` is unique per company (Holder.__table_args__) -- reusing
        # one is an ordinary mistake, not malformed input, and previously hit an
        # unhandled 500 (a raw asyncpg UniqueViolationError) instead of a normal
        # validation error. Rollback is required before the session can be used
        # again in this request (a failed INSERT leaves the transaction aborted).
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "an employee code already exists for this company")


@router.put("/{holder_id}", response_model=HolderOut)
async def update_holder(
    holder_id: int,
    body: HolderIn,
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN")),
):
    data = body.model_dump()
    _validate_holder_fields(data)
    await _validate_holder_references(session, data)
    try:
        obj = await HolderService(session).update(holder_id, data, holder.id)
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "an employee code already exists for this company")
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return obj


@router.delete("/{holder_id}", status_code=204)
async def deactivate_holder(
    holder_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN")),
):
    ok = await HolderService(session).deactivate(holder_id, holder.id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.post("/{holder_id}/reset-password", response_model=ResetPasswordOut)
async def reset_password(
    holder_id: int,
    session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN")),
):
    temp = await HolderService(session).reset_password(holder_id, actor.id)
    if temp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return ResetPasswordOut(temp_password=temp)


@router.post("/{holder_id}/company-access", status_code=204)
async def set_company_access(
    holder_id: int,
    body: CompanyAccessIn,
    session: AsyncSession = Depends(get_session),
    _actor=Depends(require_role("ADMIN")),
):
    ok = await HolderService(session).set_company_access(holder_id, body.company_ids)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.get("/{holder_id}/company-access", response_model=CompanyAccessOut)
async def get_company_access(
    holder_id: int,
    session: AsyncSession = Depends(get_session),
    _actor=Depends(require_role("ADMIN")),
):
    """AM-24: the extra companies (beyond the holder's own home company)
    this holder has been granted -- lets the Holders screen show current
    grants before the ADMIN changes them, rather than only ever writing
    blind."""
    company_ids = await HolderService(session).get_company_access(holder_id)
    if company_ids is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return CompanyAccessOut(company_ids=company_ids)
