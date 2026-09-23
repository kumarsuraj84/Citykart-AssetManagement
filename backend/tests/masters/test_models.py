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

        for row in rows:
            await session.delete(row)
        # Flush the child deletes in their own statement before deleting the
        # parent. company's created_by/updated_by FKs to holder.id and
        # holder's company_id/location_id/department_id FKs form a genuine
        # circular dependency (audit columns pointing at the "who did this"
        # holder, which itself points at company/location/department). With
        # both app.masters.models and app.holders.models loaded, SQLAlchemy's
        # cross-mapper flush-ordering sort cannot fully order that cycle and
        # falls back to an order that issues company's DELETE before
        # cost_center's — violating cost_center's FK to company. Flushing
        # first sidesteps the ambiguous ordering entirely.
        await session.flush()
        await session.delete(co)
        await session.commit()
