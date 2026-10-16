"""Dev/UAT only: one login per kind of person who uses CKAM, so every screen can be walked through as each of them.

!!! NEVER RUN AGAINST PRODUCTION (or any server real users can reach): every persona gets the SAME committed,
!!! publicly known test password below (CL2-IF-OBS-06). Throw-away dev/UAT databases only.

Run against a throw-away UAT copy of the dev database, never production. Idempotent. The shared password is a test value
for this scratch environment only (same convention as seed_admin.py).
"""
import asyncio
from sqlalchemy import and_, select
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Department, Location
from app.asset_users.models import AssetUser

PASSWORD = "Passw0rd!"
COMPANY_CODE = "CKSPL"
LOCATION_CODE = "CKS-HO"

# code, name, role, primary_owner, primary_asset_domain, allowed_asset_domains
PERSONAS = [
    ("UATOWNER", "UAT Owner (Primary Owner)", "ADMIN", True, "ALL", None),
    ("UATADMIN", "UAT Admin (ordinary ADMIN)", "ADMIN", False, "ALL", None),
    ("UATIT", "UAT IT Operator", "OPERATOR", False, "IT", "IT"),
    ("UATPO", "UAT Purchase Operator", "OPERATOR", False, "ALL", "BOTH"),
    ("UATNONIT", "UAT Admin-dept Operator (Non-IT)", "OPERATOR", False, "NON_IT", "NON_IT"),
    ("UATVIEW", "UAT Viewer", "VIEWER", False, "ALL", "BOTH"),
]


async def main() -> None:
    async with SessionLocal() as s:
        company = (await s.execute(select(Company).where(Company.code == COMPANY_CODE))).scalars().one()
        location = (await s.execute(select(Location).where(and_(Location.company_id == company.id, Location.code == LOCATION_CODE)))).scalars().one()
        department = (await s.execute(select(Department).where(Department.name == "IT"))).scalars().one()
        for code, name, role, owner, primary, allowed in PERSONAS:
            existing = (await s.execute(select(AssetUser).where(and_(AssetUser.company_id == company.id, AssetUser.code == code)))).scalars().first()
            if existing:
                print(f"{code}: already there")
                continue
            s.add(AssetUser(
                company_id=company.id, code=code, name=name, asset_user_type="EMPLOYEE", location_id=location.id, department_id=department.id,
                email=f"{code.lower()}@example.test", role=role, is_primary_owner=owner, login_enabled=True, primary_asset_domain=primary,
                allowed_asset_domains=allowed, password_hash=hash_password(PASSWORD), must_change_password=False,
            ))
            print(f"{code}: created")
        await s.commit()


if __name__ == "__main__":
    asyncio.run(main())
