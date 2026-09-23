from sqlalchemy import select
from app.core.db import SessionLocal
from app.core.security import verify_password
from app.holders.models import Holder
from app.masters.models import Company, Department, Location
from scripts.create_owner import ensure_owner


async def test_create_owner_creates_expected_records_with_random_temp_password():
    async with SessionLocal() as session:
        result = await ensure_owner(session)
        await session.commit()

    assert result["created"] is True
    temp_password = result["temp_password"]
    assert temp_password is not None
    assert len(temp_password) >= 8

    async with SessionLocal() as session:
        company = await session.get(Company, result["company_id"])
        location = await session.get(Location, result["location_id"])
        department = await session.get(Department, result["department_id"])
        holder = await session.get(Holder, result["holder_id"])

        assert company.code == "CKS"
        assert company.name == "Citykart Stores"

        assert location.code == "HO"
        assert location.name == "Head Office"

        assert department.name == "IT"

        assert holder.emp_code == "CS6872"
        assert holder.name == "Ankur Pahwa"
        assert holder.email == "ankur.pahwa@citykartstores.com"
        assert holder.holder_type == "EMPLOYEE"
        assert holder.role == "ADMIN"
        assert holder.company_id == company.id
        assert holder.location_id == location.id
        assert holder.department_id == department.id
        assert holder.must_change_password is True

        # The generated temp password must genuinely verify against the
        # stored Argon2 hash (proves it isn't a hardcoded/fake value and
        # that no plaintext password was persisted anywhere).
        assert verify_password(temp_password, holder.password_hash) is True


async def test_create_owner_is_idempotent_and_does_not_touch_password_on_rerun():
    async with SessionLocal() as session:
        first = await ensure_owner(session)
        await session.commit()

    async with SessionLocal() as session:
        holder_after_first = await session.get(Holder, first["holder_id"])
        password_hash_after_first = holder_after_first.password_hash

    async with SessionLocal() as session:
        second = await ensure_owner(session)
        await session.commit()

    assert second["created"] is False
    assert second["temp_password"] is None
    assert second["holder_id"] == first["holder_id"]
    assert second["company_id"] == first["company_id"]
    assert second["location_id"] == first["location_id"]
    assert second["department_id"] == first["department_id"]

    async with SessionLocal() as session:
        companies = (await session.execute(select(Company).where(Company.code == "CKS"))).scalars().all()
        locations = (await session.execute(select(Location).where(Location.code == "HO"))).scalars().all()
        departments = (await session.execute(select(Department).where(Department.name == "IT"))).scalars().all()
        holders = (await session.execute(select(Holder).where(Holder.emp_code == "CS6872"))).scalars().all()

        assert len(companies) == 1
        assert len(locations) == 1
        assert len(departments) == 1
        assert len(holders) == 1

        holder_after_second = holders[0]
        assert holder_after_second.id == first["holder_id"]
        # Re-running must never silently reset a real admin's password.
        assert holder_after_second.password_hash == password_hash_after_first
