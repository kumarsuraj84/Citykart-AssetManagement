from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.db import SessionLocal
from app.masters.models import Company, Location, Department
from app.holders.models import Holder


async def test_emp_code_unique_within_company():
    async with SessionLocal() as session:
        co = Company(code="CKS2", name="Test Co")
        loc = Location(code="HO2", name="Head Office 2")
        dept = Department(name="IT-Test")
        session.add_all([co, loc, dept])
        await session.flush()
        company_id = co.id  # captured before the rollback below expires `co`

        session.add(Holder(
            company_id=co.id, emp_code="CS6872", name="Ankur",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="HOLDER",
        ))
        await session.commit()

        dup = Holder(
            company_id=co.id, emp_code="CS6872", name="Duplicate",
            holder_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="HOLDER",
        )
        session.add(dup)
        raised = False
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raised = True
        assert raised

        rows = (await session.execute(select(Holder).where(Holder.company_id == company_id))).scalars().all()
        assert len(rows) == 1
