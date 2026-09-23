import argparse
import asyncio
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Department, Location
from app.holders.models import Holder


async def ensure_seed_admin(session: AsyncSession, company_code: str = "E2E", password: str = "Passw0rd!") -> dict:
    company = (await session.execute(select(Company).where(Company.code == company_code))).scalars().first()
    if company is None:
        company = Company(code=company_code, name=f"{company_code} Seed Co")
        session.add(company)
        await session.flush()

    location = (await session.execute(select(Location).where(Location.code == f"{company_code}-HO"))).scalars().first()
    if location is None:
        location = Location(code=f"{company_code}-HO", name="Seed HO")
        session.add(location)
        await session.flush()

    department = (await session.execute(select(Department).where(Department.name == f"{company_code}-IT"))).scalars().first()
    if department is None:
        department = Department(name=f"{company_code}-IT")
        session.add(department)
        await session.flush()

    # Scoped by company_id too: Holder's real uniqueness constraint is
    # (company_id, emp_code), not emp_code alone, so a global lookup here
    # would silently reuse another company's SEEDADMIN holder instead of
    # creating one scoped to this company_code.
    holder = (
        await session.execute(select(Holder).where(and_(Holder.company_id == company.id, Holder.emp_code == "SEEDADMIN")))
    ).scalars().first()
    if holder is None:
        holder = Holder(
            company_id=company.id, emp_code="SEEDADMIN", name="Seed Admin", holder_type="EMPLOYEE",
            location_id=location.id, department_id=department.id, role="ADMIN",
            password_hash=hash_password(password), must_change_password=False,
        )
        session.add(holder)
        await session.flush()

    return {"company_id": company.id, "holder_id": holder.id}


async def _main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-code", default="E2E")
    parser.add_argument("--password", default="Passw0rd!")
    args = parser.parse_args()

    async with SessionLocal() as session:
        result = await ensure_seed_admin(session, args.company_code, args.password)
        await session.commit()
    print(f"Seed admin ready: company_id={result['company_id']} holder_id={result['holder_id']} emp_code=SEEDADMIN")


if __name__ == "__main__":
    asyncio.run(_main())
