import argparse
import asyncio
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Department, Location
from app.asset_users.models import AssetUser


async def ensure_seed_admin(session: AsyncSession, company_code: str = "E2E", password: str = "Passw0rd!") -> dict:
    company = (await session.execute(select(Company).where(Company.code == company_code))).scalars().first()
    if company is None:
        company = Company(code=company_code, name=f"{company_code} Seed Co")
        session.add(company)
        await session.flush()

    location = (await session.execute(
        select(Location).where(and_(Location.company_id == company.id, Location.code == f"{company_code}-HO"))
    )).scalars().first()
    if location is None:
        location = Location(company_id=company.id, code=f"{company_code}-HO", name="Seed HO")
        session.add(location)
        await session.flush()

    department = (await session.execute(select(Department).where(Department.name == f"{company_code}-IT"))).scalars().first()
    if department is None:
        department = Department(name=f"{company_code}-IT")
        session.add(department)
        await session.flush()

    # Scoped by company_id too: AssetUser's real uniqueness constraint is
    # (company_id, code), not code alone, so a global lookup here
    # would silently reuse another company's SEEDADMIN asset_user instead of
    # creating one scoped to this company_code.
    asset_user = (
        await session.execute(select(AssetUser).where(and_(AssetUser.company_id == company.id, AssetUser.code == "SEEDADMIN")))
    ).scalars().first()
    if asset_user is None:
        asset_user = AssetUser(
            company_id=company.id, code="SEEDADMIN", name="Seed Admin", asset_user_type="EMPLOYEE",
            location_id=location.id, department_id=department.id, role="ADMIN",
            login_enabled=True, primary_asset_domain="ALL",
            password_hash=hash_password(password), must_change_password=False,
        )
        session.add(asset_user)
        await session.flush()

    return {"company_id": company.id, "asset_user_id": asset_user.id}


async def _main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-code", default="E2E")
    parser.add_argument("--password", default="Passw0rd!")
    args = parser.parse_args()

    async with SessionLocal() as session:
        result = await ensure_seed_admin(session, args.company_code, args.password)
        await session.commit()
    print(f"Seed admin ready: company_id={result['company_id']} asset_user_id={result['asset_user_id']} emp_code=SEEDADMIN")


if __name__ == "__main__":
    asyncio.run(_main())
