"""Bootstrap the real, named first ADMIN account for this CKAM deployment.

Unlike scripts/seed_admin.py (a generic, throwaway bootstrap admin used for
dev/E2E testing), this script creates one specific, real person's account:
Ankur Pahwa, the actual owner/manager of this deployed instance. The
company/location/department/holder values below are intentionally
hardcoded (not CLI args) because this script exists for exactly one
real-world deployment, not as a reusable dev fixture.

Idempotent: safe to re-run. Re-running never creates duplicate
Company/Location/Department/Holder rows, and never touches the existing
holder's password — the temporary password is generated and printed to
stdout ONLY the first time the holder is created. It is never hardcoded,
logged persistently, or written to a file; the operator must relay it to
Ankur out-of-band and it is discarded once the terminal scrolls past it.
"""
import asyncio
import secrets
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.masters.models import Company, Department, Location
from app.holders.models import Holder

COMPANY_CODE = "CKS"
COMPANY_NAME = "Citykart Stores"
LOCATION_CODE = "HO"
LOCATION_NAME = "Head Office"
DEPARTMENT_NAME = "IT"
EMP_CODE = "CS6872"
HOLDER_NAME = "Ankur Pahwa"
HOLDER_EMAIL = "ankur.pahwa@citykartstores.com"


async def ensure_owner(session: AsyncSession) -> dict:
    company = (await session.execute(select(Company).where(Company.code == COMPANY_CODE))).scalars().first()
    if company is None:
        company = Company(code=COMPANY_CODE, name=COMPANY_NAME)
        session.add(company)
        await session.flush()

    # Location and Department are shared/global masters (not company-scoped
    # per app/masters/models.py), so they are looked up by their own
    # unique keys, not scoped to the company.
    #
    # Location is looked up by NAME, not by LOCATION_CODE ("HO"): the DB's
    # actual unique constraint on Location is `code`, but that code is an
    # arbitrary value this script invents. If "Head Office" already exists
    # under a different code (e.g. created earlier via the Setup UI), a
    # code-only lookup would silently miss it and create a duplicate
    # "Head Office" row. "Head Office" is the human-meaningful identity
    # that matters here, so reuse whatever's found by name regardless of
    # its code, and only create a new row if no such name exists at all.
    location = (await session.execute(select(Location).where(Location.name == LOCATION_NAME))).scalars().first()
    if location is None:
        location = Location(code=LOCATION_CODE, name=LOCATION_NAME)
        session.add(location)
        await session.flush()

    department = (await session.execute(select(Department).where(Department.name == DEPARTMENT_NAME))).scalars().first()
    if department is None:
        department = Department(name=DEPARTMENT_NAME)
        session.add(department)
        await session.flush()

    # Scoped by company_id too: Holder's real uniqueness constraint is
    # (company_id, emp_code), not emp_code alone (see app/holders/models.py),
    # so a global lookup here would silently reuse a same-emp_code holder
    # belonging to a different company instead of this one.
    holder = (
        await session.execute(select(Holder).where(and_(Holder.company_id == company.id, Holder.emp_code == EMP_CODE)))
    ).scalars().first()

    temp_password: str | None = None
    created = False
    if holder is None:
        # secrets.token_urlsafe(9): same pattern as
        # HolderService.reset_password (app/holders/service.py) for
        # generating a secure random temporary password. Never hardcoded,
        # never persisted in plaintext anywhere - only its Argon2 hash is
        # stored, and the raw value is returned once for the caller to
        # print and hand off out-of-band.
        temp_password = secrets.token_urlsafe(9)
        holder = Holder(
            company_id=company.id,
            emp_code=EMP_CODE,
            name=HOLDER_NAME,
            holder_type="EMPLOYEE",
            location_id=location.id,
            department_id=department.id,
            email=HOLDER_EMAIL,
            role="ADMIN",
            password_hash=hash_password(temp_password),
            must_change_password=True,
        )
        session.add(holder)
        await session.flush()
        created = True

    return {
        "company_id": company.id,
        "location_id": location.id,
        "department_id": department.id,
        "holder_id": holder.id,
        "created": created,
        "temp_password": temp_password,
    }


async def _main():
    async with SessionLocal() as session:
        result = await ensure_owner(session)
        await session.commit()

    if result["created"]:
        print(
            f"Owner admin created: company_id={result['company_id']} "
            f"holder_id={result['holder_id']} emp_code={EMP_CODE} name={HOLDER_NAME!r}"
        )
        print(f"One-time temporary password (relay to {HOLDER_NAME} out-of-band, then discard): {result['temp_password']}")
        print("must_change_password is set, so this password must be changed at first login.")
    else:
        print(
            f"Owner admin already exists: company_id={result['company_id']} "
            f"holder_id={result['holder_id']} emp_code={EMP_CODE} - password left untouched."
        )


if __name__ == "__main__":
    asyncio.run(_main())
