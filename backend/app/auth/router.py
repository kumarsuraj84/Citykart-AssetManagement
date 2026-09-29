import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import get_current_asset_user
from app.core.security import (
    create_access_token, create_refresh_token, decode_token, hash_password, verify_password,
)
from app.asset_users.models import AssetUser
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


def _set_refresh_cookie(response: Response, asset_user_id: int) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        create_refresh_token(asset_user_id),
        httponly=True,
        # See Settings.cookie_secure: off by default for this app's plain-HTTP LAN
        # deployment (a Secure cookie is never sent over HTTP, which would break
        # refresh entirely); set COOKIE_SECURE=true behind HTTPS.
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.jwt_refresh_hours * 3600,
        path=REFRESH_COOKIE_PATH,
    )


def _session_response(asset_user: AssetUser) -> LoginResponse:
    # The Primary Owner's row always carries role="ADMIN" (in addition to
    # is_primary_owner=True), so this already covers it with no special case.
    company_scope = None if asset_user.role == "ADMIN" else asset_user.company_id
    return LoginResponse(
        access_token=create_access_token(asset_user.id, asset_user.role, company_scope),
        must_change_password=asset_user.must_change_password,
        role=asset_user.role,
        company_id=asset_user.company_id,
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
    # (Code OR email address, case-insensitively) must resolve to exactly one
    # asset_user across every ACTIVE company. Code and email are only unique
    # *per company* (see migration 0005_asset_user_email_unique.py and
    # AssetUser's own UniqueConstraint), so with more than one company it is
    # possible, though unlikely, for the same login_id to match asset_users in
    # two different companies -- e.g. two independently-run stores both using
    # code "EMP1". That is treated the same as "no match": a generic 401,
    # never a hint that the id exists, plus a server-side warning so an admin
    # can rename one of the colliding accounts. Silently picking one company
    # would be a real account-takeover risk; refusing to guess is not.
    #
    # The Primary Owner is a company-less bootstrap account (no code/email of
    # its own -- see AssetUser.is_primary_owner), so it is matched separately,
    # by name, outside the per-company join above.
    company_scoped_stmt = (
        select(AssetUser)
        .join(Company, AssetUser.company_id == Company.id)
        .where(
            Company.is_active.is_(True),
            AssetUser.is_active.is_(True),
            AssetUser.login_enabled.is_(True),
            AssetUser.password_hash.is_not(None),
            or_(AssetUser.code == body.login_id, func.lower(AssetUser.email) == func.lower(body.login_id)),
        )
    )
    primary_owner_stmt = select(AssetUser).where(
        AssetUser.is_active.is_(True),
        AssetUser.is_primary_owner.is_(True),
        AssetUser.password_hash.is_not(None),
        func.lower(AssetUser.name) == func.lower(body.login_id),
    )
    matches = (
        (await session.execute(company_scoped_stmt)).scalars().all()
        + (await session.execute(primary_owner_stmt)).scalars().all()
    )
    matches.sort(key=lambda h: h.id)
    if len(matches) != 1:
        if len(matches) > 1:
            logger.warning(
                "Login id %r matched asset users in %d different companies (asset user ids: %s) -- "
                "refusing to guess which one; rename one of the colliding emp_code/email values.",
                body.login_id, len(matches), [h.id for h in matches],
            )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    asset_user = matches[0]

    now = datetime.now(timezone.utc)
    if asset_user.locked_until and asset_user.locked_until > now:
        raise HTTPException(status.HTTP_423_LOCKED, "Account locked, try again later")

    if not verify_password(body.password, asset_user.password_hash):
        asset_user.failed_login_count += 1
        if asset_user.failed_login_count >= MAX_FAILED_ATTEMPTS:
            asset_user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
        await session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    asset_user.failed_login_count = 0
    asset_user.locked_until = None
    await session.commit()

    _set_refresh_cookie(response, asset_user.id)
    return _session_response(asset_user)


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
    get_current_asset_user refuses a refresh token used as an access token).
    Role/company are re-read from the asset_user row, so a role change or
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
    asset_user = await session.get(AssetUser, int(payload["sub"]))
    if asset_user is None or not asset_user.is_active or asset_user.password_hash is None:
        raise invalid
    if not asset_user.is_primary_owner and not asset_user.login_enabled:
        raise invalid
    if asset_user.locked_until and asset_user.locked_until > datetime.now(timezone.utc):
        raise invalid

    _set_refresh_cookie(response, asset_user.id)
    return _session_response(asset_user)


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
    asset_user: AssetUser = Depends(get_current_asset_user),
):
    if not verify_password(body.old_password, asset_user.password_hash or ""):
        # 400, not 401: the session is valid, the *input* is wrong. The frontend
        # treats any 401 as "session expired" (refresh, then log out), which would
        # wrongly bounce a user who merely mistyped their current password.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Old password is incorrect")
    asset_user.password_hash = hash_password(body.new_password)
    asset_user.must_change_password = False
    await session.commit()
