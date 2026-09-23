from __future__ import annotations

import secrets
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.security import hash_password
from app.holders.models import Holder, HolderCompanyAccess


class HolderService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(self, company_id: int | None = None, holder_type: str | None = None):
        stmt = select(Holder).where(Holder.is_active.is_(True))
        if company_id is not None:
            stmt = stmt.where(Holder.company_id == company_id)
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
