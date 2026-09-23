from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.holders.models import Holder
from app.masters.models import Company
from app.auth.schemas import ChangePasswordRequest, CompanyOption, LoginRequest, LoginResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


@router.get("/companies", response_model=list[CompanyOption])
async def list_login_companies(session: AsyncSession = Depends(get_session)):
    """Deliberately unauthenticated -- the login screen's company picker needs this
    list *before* anyone has a token. Only id+name are exposed (same fields already
    visible in the picker itself), nothing sensitive. Replaces the hard-coded
    single-company list App.tsx previously shipped with (see its old TODO)."""
    stmt = select(Company).where(Company.is_active.is_(True)).order_by(Company.name)
    rows = (await session.execute(stmt)).scalars().all()
    return [CompanyOption(id=c.id, name=c.name) for c in rows]


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, response: Response, session: AsyncSession = Depends(get_session)):
    # login_id may be either the holder's Employee Code OR their email address
    # (case-insensitively) -- many holders (stores, stock locations,
    # installed-equipment locations) have no email at all, so this must never
    # require email; it only adds an alternative for holders who have one.
    # A partial unique index (company_id, lower(email)) WHERE email IS NOT
    # NULL -- see migration 0005_holder_email_unique.py -- makes a duplicate
    # email within one company structurally impossible; .order_by(Holder.id)
    # here is cheap defense in depth, independent of that constraint.
    stmt = (
        select(Holder)
        .where(
            Holder.company_id == body.company_id,
            or_(Holder.emp_code == body.login_id, func.lower(Holder.email) == func.lower(body.login_id)),
        )
        .order_by(Holder.id)
    )
    holder = (await session.execute(stmt)).scalars().first()
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
