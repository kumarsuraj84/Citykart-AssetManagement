from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role
from app.holders.service import HolderService
from app.holders.schemas import CompanyAccessIn, HolderIn, HolderOut, ResetPasswordOut

router = APIRouter(prefix="/api/holders", tags=["holders"])


@router.get("", response_model=list[HolderOut])
async def list_holders(
    company_id: int | None = Query(None),
    holder_type: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
    _holder=Depends(get_current_holder),
):
    return await HolderService(session).list(company_id, holder_type)


@router.post("", response_model=HolderOut, status_code=201)
async def create_holder(
    body: HolderIn,
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN", "IT_TEAM")),
):
    return await HolderService(session).create(body.model_dump(), holder.id)


@router.put("/{holder_id}", response_model=HolderOut)
async def update_holder(
    holder_id: int,
    body: HolderIn,
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN", "IT_TEAM")),
):
    obj = await HolderService(session).update(holder_id, body.model_dump(), holder.id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return obj


@router.delete("/{holder_id}", status_code=204)
async def deactivate_holder(
    holder_id: int,
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role("ADMIN", "IT_TEAM")),
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
