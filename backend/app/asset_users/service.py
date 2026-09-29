from __future__ import annotations

import secrets
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import hash_password
from app.asset_users.models import AssetUser, AssetUserCompanyAccess


class AssetUserService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(
        self,
        asset_user_type: str | None = None,
        allowed_company_ids: list[int] | None = None,
        requested_company_id: int | None = None,
    ):
        """`allowed_company_ids` is the caller's server-side scope from
        `scoped_company_ids()`: None means unrestricted (ADMIN), a list means
        the caller may only ever see those companies. When restricted, the
        scope is enforced unconditionally and `requested_company_id` is only
        honored if it falls inside that scope -- a foreign company_id passed
        by a non-ADMIN caller is silently ignored rather than followed, so a
        non-ADMIN can never enumerate another company's asset_users regardless of
        query params. An unrestricted (ADMIN) caller's `requested_company_id`
        is applied as-is.
        """
        stmt = select(AssetUser).where(AssetUser.is_active.is_(True))
        if allowed_company_ids is not None:
            if requested_company_id is not None and requested_company_id in allowed_company_ids:
                stmt = stmt.where(AssetUser.company_id == requested_company_id)
            else:
                stmt = stmt.where(AssetUser.company_id.in_(allowed_company_ids))
        elif requested_company_id is not None:
            stmt = stmt.where(AssetUser.company_id == requested_company_id)
        if asset_user_type is not None:
            stmt = stmt.where(AssetUser.asset_user_type == asset_user_type)
        return (await self.session.execute(stmt)).scalars().all()

    async def get(self, asset_user_id: int) -> AssetUser | None:
        return await self.session.get(AssetUser, asset_user_id)

    async def create(self, data: dict, actor_id: int) -> AssetUser:
        asset_user = AssetUser(**data, created_by=actor_id, updated_by=actor_id)
        self.session.add(asset_user)
        await self.session.commit()
        await self.session.refresh(asset_user)
        return asset_user

    async def update(self, asset_user_id: int, data: dict, actor_id: int) -> AssetUser | None:
        asset_user = await self.get(asset_user_id)
        if asset_user is None:
            return None
        for key, value in data.items():
            setattr(asset_user, key, value)
        asset_user.updated_by = actor_id
        await self.session.commit()
        await self.session.refresh(asset_user)
        return asset_user

    async def deactivate(self, asset_user_id: int, actor_id: int) -> bool:
        asset_user = await self.get(asset_user_id)
        if asset_user is None:
            return False
        if asset_user.is_primary_owner and await self.count_active_primary_owners() <= 1:
            raise ValueError("cannot deactivate the last remaining Primary Owner")
        asset_user.is_active = False
        asset_user.updated_by = actor_id
        await self.session.commit()
        return True

    async def reset_password(self, asset_user_id: int, actor_id: int) -> str | None:
        asset_user = await self.session.get(AssetUser, asset_user_id)
        if asset_user is None:
            return None
        temp_password = secrets.token_urlsafe(9)
        asset_user.password_hash = hash_password(temp_password)
        asset_user.must_change_password = True
        asset_user.failed_login_count = 0
        asset_user.locked_until = None
        asset_user.updated_by = actor_id
        await self.session.commit()
        return temp_password

    async def count_active_primary_owners(self) -> int:
        stmt = select(AssetUser).where(AssetUser.is_active.is_(True), AssetUser.is_primary_owner.is_(True))
        return len((await self.session.execute(stmt)).scalars().all())

    async def set_primary_owner(self, asset_user_id: int, value: bool, actor_id: int) -> AssetUser | None:
        """Only reachable via require_primary_owner (an existing Primary Owner
        granting/revoking another). Revoking the last remaining Primary Owner
        is refused -- the system must always have at least one account with
        unconditional access, independent of ordinary role management."""
        asset_user = await self.session.get(AssetUser, asset_user_id)
        if asset_user is None:
            return None
        if not value and asset_user.is_primary_owner and await self.count_active_primary_owners() <= 1:
            raise ValueError("cannot remove the last remaining Primary Owner")
        asset_user.is_primary_owner = value
        asset_user.updated_by = actor_id
        await self.session.commit()
        await self.session.refresh(asset_user)
        return asset_user

    async def set_company_access(self, asset_user_id: int, company_ids: list[int]) -> bool:
        asset_user = await self.session.get(AssetUser, asset_user_id)
        if asset_user is None:
            return False
        await self.session.execute(delete(AssetUserCompanyAccess).where(AssetUserCompanyAccess.asset_user_id == asset_user_id))
        for cid in company_ids:
            self.session.add(AssetUserCompanyAccess(asset_user_id=asset_user_id, company_id=cid))
        await self.session.commit()
        return True

    async def get_company_access(self, asset_user_id: int) -> list[int] | None:
        """None means the asset_user itself doesn't exist (404); an empty list is
        a real, valid answer (no extra grants beyond their own home company)."""
        asset_user = await self.session.get(AssetUser, asset_user_id)
        if asset_user is None:
            return None
        rows = (await self.session.execute(
            select(AssetUserCompanyAccess.company_id).where(AssetUserCompanyAccess.asset_user_id == asset_user_id)
        )).scalars().all()
        return list(rows)
