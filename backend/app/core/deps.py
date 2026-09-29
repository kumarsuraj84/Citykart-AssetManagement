from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.security import decode_token
from app.asset_users.models import AssetUser, AssetUserCompanyAccess

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# The only authenticated routes a asset_user may call while `must_change_password`
# is still set (spec §7.1 "Forced password change on first login"). Login and
# refresh never go through get_current_asset_user at all, so they need no entry.
PASSWORD_CHANGE_EXEMPT_PATHS = frozenset({"/api/auth/change-password", "/api/auth/login"})
PASSWORD_CHANGE_REQUIRED_DETAIL = "Password change required before using the app"


async def get_current_asset_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> AssetUser:
    try:
        payload = decode_token(token)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    asset_user = await session.get(AssetUser, int(payload["sub"]))
    if asset_user is None or not asset_user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or inactive")
    # Server-side half of the forced first-login password change: the frontend
    # routes such a asset_user to its change-password screen, but that is trivially
    # bypassable (curl, devtools), so every route that authenticates through
    # this dependency -- i.e. every authenticated route, including those using
    # require_role -- refuses with 403 until the password has actually changed.
    # 403 (not 401): the session itself is valid; refreshing it won't help.
    if asset_user.must_change_password and request.url.path.rstrip("/") not in PASSWORD_CHANGE_EXEMPT_PATHS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, PASSWORD_CHANGE_REQUIRED_DETAIL)
    return asset_user


def require_role(*roles: str):
    def checker(asset_user: AssetUser = Depends(get_current_asset_user)) -> AssetUser:
        if asset_user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted for this action")
        return asset_user
    return checker


def require_primary_owner():
    """Granting/revoking Primary Owner status is deliberately not part of the
    ordinary ADMIN-gated Asset User CRUD (require_role("ADMIN")) -- only an
    existing Primary Owner may create another one, so the system can never
    end up with zero of them through ordinary ADMIN-level account
    management."""
    def checker(asset_user: AssetUser = Depends(get_current_asset_user)) -> AssetUser:
        if not asset_user.is_primary_owner:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the Primary Owner may perform this action")
        return asset_user
    return checker


# Every role except SELF_SERVICE. A SELF_SERVICE asset_user sees only the assets
# they currently hold (spec §6/§31), never company-wide KPIs, the movement log,
# or other asset_users' PII. Replaces the old STAFF_ROLES name.
READ_ROLES = ("ADMIN", "OPERATOR", "VIEWER")
# Roles allowed to perform ordinary asset/PO/import write transactions (spec §9
# OPERATOR capabilities). This is the single source of truth for what used to
# be 26 separately hand-typed `("ADMIN", "IT_TEAM")` literals across 8 router
# files -- see docs/ai/ASSET_USER_RBAC_REBUILD_PREFLIGHT.md §15.
WRITE_ROLES = ("ADMIN", "OPERATOR")


def is_self_service(asset_user) -> bool:
    """SELF_SERVICE only ever sees assets currently in their own custody
    (spec §6/§31) -- consolidates what used to be three separately
    duplicated `asset_user.role == "ASSET_USER"` checks (assets/router.py
    twice, reports/router.py once)."""
    return asset_user.role == "SELF_SERVICE"


def can_administer_system(asset_user) -> bool:
    """ADMIN (which the Primary Owner's row always carries as its `role`,
    alongside `is_primary_owner=True`) may manage Asset Users, access roles,
    company access, domain access, login enablement, and password resets
    (spec §49). OPERATOR may never escalate into this regardless of company
    or domain scope."""
    return asset_user.role == "ADMIN"


def can_manage_assets(asset_user) -> bool:
    """ADMIN + OPERATOR may perform ordinary asset transactions (spec §9),
    subject to company/domain scope enforced separately by
    scoped_company_ids()/allowed_asset_domains()."""
    return asset_user.role in WRITE_ROLES


async def allowed_asset_domains(session: AsyncSession, asset_user) -> tuple[str, ...] | None:
    """None means unrestricted -- ADMIN always works across both domains
    regardless of its own configured `primary_asset_domain` (spec §14, the
    "ADMIN cross-domain rule"); SELF_SERVICE is also unrestricted here
    because its scope is governed entirely by custody (current_asset_user_id),
    not domain (spec §15). OPERATOR/VIEWER are restricted to their configured
    `allowed_asset_domains` ("IT"/"NON_IT"/"BOTH", defaulting to "BOTH" if
    never explicitly set)."""
    if asset_user.role in ("ADMIN", "SELF_SERVICE"):
        return None
    value = asset_user.allowed_asset_domains or "BOTH"
    if value == "BOTH":
        return ("IT", "NON_IT")
    return (value,)


async def can_access_asset(session: AsyncSession, asset_user, asset) -> bool:
    """Read-access check combining custody (SELF_SERVICE), company scope, and
    domain scope in one place, per spec §47 ("do NOT scatter ad-hoc role/
    domain checks across dozens of endpoints")."""
    if is_self_service(asset_user):
        return asset.current_asset_user_id == asset_user.id
    allowed_companies = await scoped_company_ids(session, asset_user)
    if allowed_companies is not None and asset.company_id not in allowed_companies:
        return False
    domains = await allowed_asset_domains(session, asset_user)
    if domains is not None and asset.asset_domain not in domains:
        return False
    return True


async def can_write_asset(session: AsyncSession, asset_user, asset) -> bool:
    """Write-access check: SELF_SERVICE can never write (spec §15); everyone
    else needs can_manage_assets() plus the same company/domain scope reads
    use."""
    if not can_manage_assets(asset_user):
        return False
    return await can_access_asset(session, asset_user, asset)


async def scoped_company_ids(session: AsyncSession, asset_user) -> list[int] | None:
    """None means unrestricted (ADMIN). Everyone else is scoped to their own company
    plus any companies granted via asset_user_company_access.

    AM-24: this used to only ever return `[asset_user.company_id]` -- the docstring
    promised the asset_user_company_access grant would be honored, but nothing here
    actually queried it, so `POST /asset-users/{id}/company-access` silently had no
    effect anywhere a scope check ran (asset/PO/reports/masters reads and
    writes all stayed pinned to the asset_user's single home company). Fixed by
    actually looking the grant table up."""
    if asset_user.role == "ADMIN":
        return None
    granted = (await session.execute(
        select(AssetUserCompanyAccess.company_id).where(AssetUserCompanyAccess.asset_user_id == asset_user.id)
    )).scalars().all()
    return list({asset_user.company_id, *granted})


async def ensure_company_in_scope(session: AsyncSession, asset_user, company_id: int | None) -> None:
    """Write-permission check for company-owned data (assets, imports, cost
    centers...): a non-ADMIN actor may only write into a company inside their own
    `scoped_company_ids`. Raises 403 -- not 404 -- because this is a permission
    check on a write the caller explicitly aimed at that company, not a read that
    must hide whether the row exists."""
    allowed = await scoped_company_ids(session, asset_user)
    if allowed is None:
        return
    if company_id is None or company_id not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted to write data for this company")
