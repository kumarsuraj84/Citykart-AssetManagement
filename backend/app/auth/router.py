import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import get_current_holder
from app.core.security import (
    create_access_token, create_refresh_token, decode_token, hash_password, verify_password,
)
from app.holders.models import Holder
from app.masters.models import Company
from app.auth.schemas import ChangePasswordRequest, CompanyOption, LoginRequest, LoginResponse

# Same logger name main.py configures a stderr handler for -- getLogger caches
# by name, so this reuses that handler rather than silently going nowhere.
logger = logging.getLogger("ckam.security")

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

REFRESH_COOKIE_NAME = "refresh_token"
# Scoped to the auth endpoints: the refresh token is only ever needed by
# /api/auth/refresh (and cleared by /api/auth/logout), so the browser has no
# reason to attach it to every other API request.
REFRESH_COOKIE_PATH = "/api/auth"


def _set_refresh_cookie(response: Response, holder_id: int) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        create_refresh_token(holder_id),
        httponly=True,
        # See Settings.cookie_secure: off by default for this app's plain-HTTP LAN
        # deployment (a Secure cookie is never sent over HTTP, which would break
        # refresh entirely); set COOKIE_SECURE=true behind HTTPS.
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.jwt_refresh_hours * 3600,
        path=REFRESH_COOKIE_PATH,
    )


def _session_response(holder: Holder) -> LoginResponse:
    company_scope = None if holder.role == "ADMIN" else holder.company_id
    return LoginResponse(
        access_token=create_access_token(holder.id, holder.role, company_scope),
        must_change_password=holder.must_change_password,
        role=holder.role,
        company_id=holder.company_id,
    )


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
    # The login screen no longer asks which company to sign into -- login_id
    # (Employee Code OR email address, case-insensitively) must resolve to
    # exactly one holder across every ACTIVE company. emp_code and email are
    # only unique *per company* (see migration 0005_holder_email_unique.py
    # and Holder's own UniqueConstraint), so with more than one company it is
    # possible, though unlikely, for the same login_id to match holders in
    # two different companies -- e.g. two independently-run stores both using
    # emp_code "EMP1". That is treated the same as "no match": a generic 401,
    # never a hint that the id exists, plus a server-side warning so an admin
    # can rename one of the colliding accounts. Silently picking one company
    # would be a real account-takeover risk; refusing to guess is not.
    stmt = (
        select(Holder)
        .join(Company, Holder.company_id == Company.id)
        .where(
            Company.is_active.is_(True),
            Holder.is_active.is_(True),
            Holder.password_hash.is_not(None),
            or_(Holder.emp_code == body.login_id, func.lower(Holder.email) == func.lower(body.login_id)),
        )
        .order_by(Holder.id)
    )
    matches = (await session.execute(stmt)).scalars().all()
    if len(matches) != 1:
        if len(matches) > 1:
            logger.warning(
                "Login id %r matched holders in %d different companies (holder ids: %s) -- "
                "refusing to guess which one; rename one of the colliding emp_code/email values.",
                body.login_id, len(matches), [h.id for h in matches],
            )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    holder = matches[0]

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

    _set_refresh_cookie(response, holder.id)
    return _session_response(holder)


@router.post("/refresh", response_model=LoginResponse)
async def refresh(
    response: Response,
    session: AsyncSession = Depends(get_session),
    refresh_token: str | None = Cookie(default=None),
):
    """Exchanges the httpOnly refresh cookie (set at login) for a fresh 15-minute
    access token, so a session survives past the access token's expiry for up to
    `jwt_refresh_hours` of idleness (spec §8: "8 h idle"). The refresh cookie is
    rotated on every call, which is what makes that window *idle*-based rather
    than a hard cap from login.

    Only a genuine `type: "refresh"` token is accepted here -- an access token can
    never be replayed through this endpoint to mint new tokens (just as
    get_current_holder refuses a refresh token used as an access token).
    Role/company are re-read from the holder row, so a role change or
    deactivation takes effect on the next refresh rather than living on in a
    stale token."""
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")
    if not refresh_token:
        raise invalid
    try:
        payload = decode_token(refresh_token)
    except ValueError:
        raise invalid
    if payload.get("type") != "refresh":
        raise invalid
    holder = await session.get(Holder, int(payload["sub"]))
    if holder is None or not holder.is_active or holder.password_hash is None:
        raise invalid
    if holder.locked_until and holder.locked_until > datetime.now(timezone.utc):
        raise invalid

    _set_refresh_cookie(response, holder.id)
    return _session_response(holder)


@router.post("/logout", status_code=204)
async def logout(response: Response):
    """Clears the refresh cookie so a logged-out browser can't silently mint a new
    access token via /refresh for the rest of the refresh window. Unauthenticated
    on purpose: logging out must work even with an already-expired access token."""
    response.delete_cookie(
        REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH, httponly=True,
        secure=settings.cookie_secure, samesite="lax",
    )


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    session: AsyncSession = Depends(get_session),
    holder: Holder = Depends(get_current_holder),
):
    if not verify_password(body.old_password, holder.password_hash or ""):
        # 400, not 401: the session is valid, the *input* is wrong. The frontend
        # treats any 401 as "session expired" (refresh, then log out), which would
        # wrongly bounce a user who merely mistyped their current password.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Old password is incorrect")
    holder.password_hash = hash_password(body.new_password)
    holder.must_change_password = False
    await session.commit()
