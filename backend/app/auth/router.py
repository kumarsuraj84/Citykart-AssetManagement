import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.capabilities import capabilities
from app.core.config import settings
from app.core.db import get_session
from app.core.deps import get_current_asset_user
from app.core.security import (
    create_access_token, create_refresh_token, decode_token, hash_password, verify_password,
)
from app.asset_users.models import AssetUser
from app.masters.models import Company
from app.auth.schemas import ChangePasswordRequest, CompanyOption, LoginRequest, LoginResponse
from app.observability import context as obs_context
from app.observability import writer as obs_writer

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
        is_primary_owner=asset_user.is_primary_owner,
        asset_user_id=asset_user.id,
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
    # Security: the same row can come back from both queries (a Primary Owner who also has a company, whose code
    # equals its name), and an employee created with the Primary Owner's name as code must not be able to
    # make the Primary Owner's own login ambiguous (a lock-out of the head-office admin by anyone who can add
    # an employee). Same row twice counts once; Primary Owner (matched by its exact name) wins a clash.
    matches = list({h.id: h for h in matches}.values())
    if len(matches) > 1:
        owners = [h for h in matches if h.is_primary_owner and (h.name or "").lower() == (body.login_id or "").lower()]
        if len(owners) == 1:
            matches = owners
    matches.sort(key=lambda h: h.id)
    attempted = (body.login_id or "")[:200]
    if len(matches) != 1:
        if len(matches) > 1:
            logger.warning(
                "Login id %r matched asset users in %d different companies (asset user ids: %s) -- "
                "refusing to guess which one; rename one of the colliding emp_code/email values.",
                body.login_id, len(matches), [h.id for h in matches],
            )
        # S8: the attempted login id is recorded, the password never.
        reason = "matches more than one account" if matches else "no active account can sign in with it"
        await obs_writer.security("LOGIN_FAILED", f"Sign-in failed for '{attempted}': {reason}.", outcome="FAILED",
                                  changes={"login_id": attempted, "reason": reason})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    asset_user = matches[0]

    now = datetime.now(timezone.utc)
    if asset_user.locked_until and asset_user.locked_until > now:
        await obs_writer.security("LOGIN_FAILED", f"Sign-in refused for {asset_user.name}: the account is locked.",
                                  outcome="DENIED", actor=asset_user, entity="asset_user", entity_id=asset_user.id,
                                  changes={"login_id": attempted, "reason": "locked",
                                           "locked_until": asset_user.locked_until.isoformat()})
        raise HTTPException(status.HTTP_423_LOCKED, "Account locked, try again later")

    if not verify_password(body.password, asset_user.password_hash):
        asset_user.failed_login_count += 1
        locked_now = asset_user.failed_login_count >= MAX_FAILED_ATTEMPTS
        if locked_now:
            asset_user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
        attempts = asset_user.failed_login_count
        await session.commit()
        await obs_writer.security("LOGIN_FAILED", f"Sign-in failed for {asset_user.name}: wrong password "
                                  f"(attempt {attempts}).", outcome="FAILED", actor=asset_user, entity="asset_user",
                                  entity_id=asset_user.id,
                                  changes={"login_id": attempted, "reason": "wrong password", "attempt": attempts})
        if locked_now:
            await obs_writer.security("LOCKED", f"{asset_user.name}'s account was locked for {LOCKOUT_MINUTES} minutes "
                                      f"after {attempts} wrong passwords.", outcome="DENIED", actor=asset_user,
                                      entity="asset_user", entity_id=asset_user.id,
                                      changes={"attempts": attempts, "minutes": LOCKOUT_MINUTES})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    asset_user.failed_login_count = 0
    asset_user.locked_until = None
    await session.commit()

    obs_context.set_actor(asset_user)
    await obs_writer.security("LOGIN", f"{asset_user.name} signed in.", entity="asset_user", entity_id=asset_user.id,
                              changes={"login_id": attempted, "must_change_at_sign_in": asset_user.must_change_password})
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

    async def refused(reason: str, user: AssetUser | None = None) -> HTTPException:
        # S8: at most one row per address and minute (a browser left open retries on its own).
        ctx = obs_context.current()
        await obs_writer.security(
            "TOKEN_REFRESH_FAILED", f"A session could not be renewed: {reason}.", outcome="DENIED", actor=user,
            changes={"reason": reason}, throttle=(f"refresh:{ctx.ip if ctx else None}", 60))
        return invalid

    if not refresh_token:
        raise await refused("no refresh cookie")
    try:
        payload = decode_token(refresh_token)
    except ValueError:
        raise await refused("the refresh token is invalid or has expired")
    if payload.get("type") != "refresh":
        raise await refused("not a refresh token")
    asset_user = await session.get(AssetUser, int(payload["sub"]))
    if asset_user is None or not asset_user.is_active or asset_user.password_hash is None:
        raise await refused("the account is not active", asset_user)
    if not asset_user.is_primary_owner and not asset_user.login_enabled:
        raise await refused("the account can no longer sign in", asset_user)
    if asset_user.locked_until and asset_user.locked_until > datetime.now(timezone.utc):
        raise await refused("the account is locked", asset_user)

    obs_context.set_actor(asset_user)
    _set_refresh_cookie(response, asset_user.id)
    return _session_response(asset_user)


@router.post("/logout", status_code=204)
async def logout(response: Response, session: AsyncSession = Depends(get_session),
                 refresh_token: str | None = Cookie(default=None)):
    """Clears the refresh cookie so a logged-out browser can't silently mint a new
    access token via /refresh for the rest of the refresh window. Unauthenticated
    on purpose: logging out must work even with an already-expired access token.
    S8: a LOGOUT row names the person when the refresh cookie still says who it was."""
    user = None
    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            if payload.get("type") == "refresh":
                user = await session.get(AssetUser, int(payload["sub"]))
        except (ValueError, KeyError, TypeError):
            user = None
    if user is not None:
        obs_context.set_actor(user)
    await obs_writer.security("LOGOUT", f"{user.name if user else 'Someone'} signed out.", actor=user,
                              entity="asset_user" if user else None, entity_id=user.id if user else None)
    response.delete_cookie(
        REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH, httponly=True,
        secure=settings.cookie_secure, samesite="lax",
    )


@router.get("/capabilities")
async def my_capabilities(
    session: AsyncSession = Depends(get_session),
    asset_user: AssetUser = Depends(get_current_asset_user),
):
    """S3a-1: what the signed-in person may create and manage, in plain words,
    computed by the same functions the endpoints use (app.core.capabilities),
    so the screens offer exactly what the server will allow."""
    return await capabilities(session, asset_user)


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
        await obs_writer.security("PASSWORD_CHANGE_FAILED", f"{asset_user.name} could not change their password: "
                                  "the current password was wrong.", outcome="FAILED",
                                  entity="asset_user", entity_id=asset_user.id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Old password is incorrect")
    asset_user.password_hash = hash_password(body.new_password)
    asset_user.must_change_password = False
    await session.commit()
    await obs_writer.security("PASSWORD_CHANGED", f"{asset_user.name} changed their password.",
                              entity="asset_user", entity_id=asset_user.id)
