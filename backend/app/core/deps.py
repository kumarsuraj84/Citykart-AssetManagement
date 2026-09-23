from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.security import decode_token
from app.holders.models import Holder

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_holder(
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
    return holder


def require_role(*roles: str):
    def checker(holder: Holder = Depends(get_current_holder)) -> Holder:
        if holder.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted for this action")
        return holder
    return checker


def scoped_company_ids(holder) -> list[int] | None:
    """None means unrestricted (ADMIN). Everyone else is scoped to their own company
    plus any companies granted via holder_company_access (checked by the caller)."""
    if holder.role == "ADMIN":
        return None
    return [holder.company_id]
