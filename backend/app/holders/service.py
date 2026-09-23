from __future__ import annotations

import secrets
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import hash_password
from app.holders.models import Holder, HolderCompanyAccess


class HolderService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(
        self,
        holder_type: str | None = None,
        allowed_company_ids: list[int] | None = None,
        requested_company_id: int | None = None,
    ):
        """`allowed_company_ids` is the caller's server-side scope from
        `scoped_company_ids()`: None means unrestricted (ADMIN), a list means
        the caller may only ever see those companies. When restricted, the
        scope is enforced unconditionally and `requested_company_id` is only
        honored if it falls inside that scope -- a foreign company_id passed
        by a non-ADMIN caller is silently ignored rather than followed, so a
        non-ADMIN can never enumerate another company's holders regardless of
        query params. An unrestricted (ADMIN) caller's `requested_company_id`
        is applied as-is.
        """
        stmt = select(Holder).where(Holder.is_active.is_(True))
        if allowed_company_ids is not None:
            if requested_company_id is not None and requested_company_id in allowed_company_ids:
                stmt = stmt.where(Holder.company_id == requested_company_id)
            else:
                stmt = stmt.where(Holder.company_id.in_(allowed_company_ids))
        elif requested_company_id is not None:
            stmt = stmt.where(Holder.company_id == requested_company_id)
        if holder_type is not None:
            stmt = stmt.where(Holder.holder_type == holder_type)
        return (await self.session.execute(stmt)).scalars().all()

    async def get(self, holder_id: int) -> Holder | None:
        return await self.session.get(Holder, holder_id)

    async def create(self, data: dict, actor_id: int) -> Holder:
        holder = Holder(**data, created_by=actor_id, updated_by=actor_id)
        self.session.add(holder)
        await self.session.commit()
        await self.session.refresh(holder)
        return holder

    async def update(self, holder_id: int, data: dict, actor_id: int) -> Holder | None:
        holder = await self.get(holder_id)
        if holder is None:
            return None
        for key, value in data.items():
            setattr(holder, key, value)
        holder.updated_by = actor_id
        await self.session.commit()
        await self.session.refresh(holder)
        return holder

    async def deactivate(self, holder_id: int, actor_id: int) -> bool:
        holder = await self.get(holder_id)
        if holder is None:
            return False
        holder.is_active = False
        holder.updated_by = actor_id
        await self.session.commit()
        return True

    async def reset_password(self, holder_id: int, actor_id: int) -> str | None:
        holder = await self.session.get(Holder, holder_id)
        if holder is None:
            return None
        temp_password = secrets.token_urlsafe(9)
        holder.password_hash = hash_password(temp_password)
        holder.must_change_password = True
        holder.failed_login_count = 0
        holder.locked_until = None
        holder.updated_by = actor_id
        await self.session.commit()
        return temp_password

    async def set_company_access(self, holder_id: int, company_ids: list[int]) -> bool:
        holder = await self.session.get(Holder, holder_id)
        if holder is None:
            return False
        await self.session.execute(delete(HolderCompanyAccess).where(HolderCompanyAccess.holder_id == holder_id))
        for cid in company_ids:
            self.session.add(HolderCompanyAccess(holder_id=holder_id, company_id=cid))
        await self.session.commit()
        return True
