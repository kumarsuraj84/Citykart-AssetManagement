from sqlalchemy import select
from app.core.db import SessionLocal
from app.masters.models import Company, CostCenter


async def test_cost_center_unique_per_company():
    async with SessionLocal() as session:
        co = Company(code="CKS", name="Citykart Stores")
        session.add(co)
        await session.flush()
        session.add(CostCenter(company_id=co.id, code="HO01", name="Head Office"))
        await session.commit()

        rows = (await session.execute(select(CostCenter).where(CostCenter.company_id == co.id))).scalars().all()
        assert len(rows) == 1
        assert rows[0].code == "HO01"

        await session.delete(co)
        await session.commit()
