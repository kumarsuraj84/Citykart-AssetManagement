from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class MasterCRUDService:
    def __init__(self, model, session: AsyncSession):
        self.model = model
        self.session = session

    async def list_active(self):
        stmt = select(self.model).where(self.model.is_active.is_(True))
        return (await self.session.execute(stmt)).scalars().all()

    async def get(self, id_: int):
        return await self.session.get(self.model, id_)

    async def create(self, data: dict, actor_id: int):
        obj = self.model(**data, created_by=actor_id, updated_by=actor_id)
        self.session.add(obj)
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def update(self, id_: int, data: dict, actor_id: int):
        obj = await self.get(id_)
        if obj is None:
            return None
        for key, value in data.items():
            setattr(obj, key, value)
        obj.updated_by = actor_id
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def deactivate(self, id_: int, actor_id: int) -> bool:
        obj = await self.get(id_)
        if obj is None:
            return False
        obj.is_active = False
        obj.updated_by = actor_id
        await self.session.commit()
        return True
