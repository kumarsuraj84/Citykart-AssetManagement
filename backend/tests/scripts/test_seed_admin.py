from sqlalchemy import select
from app.core.db import SessionLocal
from app.holders.models import Holder
from scripts.seed_admin import ensure_seed_admin


async def test_seed_admin_is_idempotent():
    async with SessionLocal() as session:
        first = await ensure_seed_admin(session, company_code="SEEDTEST", password="Passw0rd!")
        await session.commit()
        second = await ensure_seed_admin(session, company_code="SEEDTEST", password="Passw0rd!")
        await session.commit()

    assert first["holder_id"] == second["holder_id"]

    async with SessionLocal() as session:
        stmt = select(Holder).where(Holder.emp_code == "SEEDADMIN")
        rows = (await session.execute(stmt)).scalars().all()
        assert len(rows) == 1
        assert rows[0].role == "ADMIN"
