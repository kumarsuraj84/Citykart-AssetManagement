from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.security import decode_token
from app.holders.models import Holder

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# The only authenticated routes a holder may call while `must_change_password`
# is still set (spec §7.1 "Forced password change on first login"). Login and
# refresh never go through get_current_holder at all, so they need no entry.
PASSWORD_CHANGE_EXEMPT_PATHS = frozenset({"/api/auth/change-password", "/api/auth/login"})
PASSWORD_CHANGE_REQUIRED_DETAIL = "Password change required before using the app"


async def get_current_holder(
    request: Request,
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> Holder:
    try:
        payload = decode_token(token)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    holder = await session.get(Holder, int(payload["sub"]))
    if holder is None or not holder.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or inactive")
    # Server-side half of the forced first-login password change: the frontend
    # routes such a holder to its change-password screen, but that is trivially
    # bypassable (curl, devtools), so every route that authenticates through
    # this dependency -- i.e. every authenticated route, including those using
    # require_role -- refuses with 403 until the password has actually changed.
    # 403 (not 401): the session itself is valid; refreshing it won't help.
    if holder.must_change_password and request.url.path.rstrip("/") not in PASSWORD_CHANGE_EXEMPT_PATHS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, PASSWORD_CHANGE_REQUIRED_DETAIL)
    return holder


def require_role(*roles: str):
    def checker(holder: Holder = Depends(get_current_holder)) -> Holder:
        if holder.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted for this action")
        return holder
    return checker


# Every role except HOLDER. A HOLDER sees only the assets they currently hold
# (spec §6), never company-wide KPIs, the movement log, or other holders' PII.
STAFF_ROLES = ("ADMIN", "IT_TEAM", "VIEWER")


def scoped_company_ids(holder) -> list[int] | None:
    """None means unrestricted (ADMIN). Everyone else is scoped to their own company
    plus any companies granted via holder_company_access (checked by the caller)."""
    if holder.role == "ADMIN":
        return None
    return [holder.company_id]


def ensure_company_in_scope(holder, company_id: int | None) -> None:
    """Write-permission check for company-owned data (assets, imports, cost
    centers...): a non-ADMIN actor may only write into a company inside their own
    `scoped_company_ids`. Raises 403 -- not 404 -- because this is a permission
    check on a write the caller explicitly aimed at that company, not a read that
    must hide whether the row exists."""
    allowed = scoped_company_ids(holder)
    if allowed is None:
        return
    if company_id is None or company_id not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted to write data for this company")
