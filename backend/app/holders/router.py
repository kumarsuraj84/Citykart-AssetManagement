from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import STAFF_ROLES, get_current_holder, require_role, scoped_company_ids
from app.holders.service import HolderService
from app.holders.schemas import CompanyAccessIn, HolderIn, HolderOut, ResetPasswordOut
from app.holders.models import HOLDER_TYPES, ROLES

router = APIRouter(prefix="/api/holders", tags=["holders"])


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


@router.get("", response_model=list[HolderOut])
async def list_holders(
    company_id: int | None = Query(None),
    holder_type: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role(*STAFF_ROLES)),
):
    # Staff only: the list carries every holder's email/phone, and a HOLDER may
    # only see their own currently-held assets (spec §6) -- 403 for them.
    allowed_company_ids = scoped_company_ids(holder)
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
    return await HolderService(session).create(data, holder.id)


@router.put("/{holder_id}", response_model=HolderOut)
async def update_holder(
    holder_id: int,
    body: HolderIn,
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN")),
):
    data = body.model_dump()
    _validate_holder_fields(data)
    obj = await HolderService(session).update(holder_id, data, holder.id)
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
