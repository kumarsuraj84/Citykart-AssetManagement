from sqlalchemy import text
from app.core.db import SessionLocal


async def test_db_connects():
    async with SessionLocal() as session:
        result = await session.execute(text("SELECT 1"))
        assert result.scalar() == 1
