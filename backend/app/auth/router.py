from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.holders.models import Holder
from app.auth.schemas import ChangePasswordRequest, LoginRequest, LoginResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, response: Response, session: AsyncSession = Depends(get_session)):
    stmt = select(Holder).where(Holder.company_id == body.company_id, Holder.emp_code == body.emp_code)
    holder = (await session.execute(stmt)).scalar_one_or_none()
    if holder is None or not holder.is_active or holder.password_hash is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    now = datetime.now(timezone.utc)
    if holder.locked_until and holder.locked_until > now:
        raise HTTPException(status.HTTP_423_LOCKED, "Account locked, try again later")

    if not verify_password(body.password, holder.password_hash):
        holder.failed_login_count += 1
        if holder.failed_login_count >= MAX_FAILED_ATTEMPTS:
            holder.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
        await session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    holder.failed_login_count = 0
    holder.locked_until = None
    await session.commit()

    company_scope = None if holder.role == "ADMIN" else holder.company_id
    access = create_access_token(holder.id, holder.role, company_scope)
    refresh = create_refresh_token(holder.id)
    response.set_cookie(
        "refresh_token", refresh, httponly=True, secure=True, samesite="lax", max_age=8 * 3600
    )
    return LoginResponse(
        access_token=access,
        must_change_password=holder.must_change_password,
        role=holder.role,
        company_id=holder.company_id,
    )


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    session: AsyncSession = Depends(get_session),
    holder: Holder = Depends(get_current_holder),
):
    if not verify_password(body.old_password, holder.password_hash or ""):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Old password is incorrect")
    holder.password_hash = hash_password(body.new_password)
    holder.must_change_password = False
    await session.commit()
