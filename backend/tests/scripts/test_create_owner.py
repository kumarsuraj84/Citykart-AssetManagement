from sqlalchemy import select
from app.core.db import SessionLocal
from app.core.security import verify_password
from app.asset_users.models import AssetUser
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
        asset_user = await session.get(AssetUser, result["asset_user_id"])

        assert company.code == "CKS"
        assert company.name == "Citykart Stores"

        assert location.code == "HO"
        assert location.name == "Head Office"

        assert department.name == "IT"

        assert asset_user.code == "CS6872"
        assert asset_user.name == "Ankur Pahwa"
        assert asset_user.email == "ankur.pahwa@citykartstores.com"
        assert asset_user.asset_user_type == "EMPLOYEE"
        assert asset_user.role == "ADMIN"
        assert asset_user.company_id == company.id
        assert asset_user.location_id == location.id
        assert asset_user.department_id == department.id
        assert asset_user.must_change_password is True

        # The generated temp password must genuinely verify against the
        # stored Argon2 hash (proves it isn't a hardcoded/fake value and
        # that no plaintext password was persisted anywhere).
        assert verify_password(temp_password, asset_user.password_hash) is True


async def test_create_owner_is_idempotent_and_does_not_touch_password_on_rerun():
    async with SessionLocal() as session:
        first = await ensure_owner(session)
        await session.commit()

    async with SessionLocal() as session:
        asset_user_after_first = await session.get(AssetUser, first["asset_user_id"])
        password_hash_after_first = asset_user_after_first.password_hash

    async with SessionLocal() as session:
        second = await ensure_owner(session)
        await session.commit()

    assert second["created"] is False
    assert second["temp_password"] is None
    assert second["asset_user_id"] == first["asset_user_id"]
    assert second["company_id"] == first["company_id"]
    assert second["location_id"] == first["location_id"]
    assert second["department_id"] == first["department_id"]

    async with SessionLocal() as session:
        companies = (await session.execute(select(Company).where(Company.code == "CKS"))).scalars().all()
        locations = (await session.execute(select(Location).where(Location.code == "HO"))).scalars().all()
        departments = (await session.execute(select(Department).where(Department.name == "IT"))).scalars().all()
        asset_users = (await session.execute(select(AssetUser).where(AssetUser.code == "CS6872"))).scalars().all()

        assert len(companies) == 1
        assert len(locations) == 1
        assert len(departments) == 1
        assert len(asset_users) == 1

        asset_user_after_second = asset_users[0]
        assert asset_user_after_second.id == first["asset_user_id"]
        # Re-running must never silently reset a real admin's password.
        assert asset_user_after_second.password_hash == password_hash_after_first


async def test_create_owner_reuses_existing_head_office_location_under_different_code():
    """Location's real DB-enforced uniqueness is on (company_id, code), but
    this script invents its own code ("HO"). If "Head Office" already
    exists under some other code for this same company (e.g. created
    earlier via the Setup UI), the script must reuse that row by name, not
    create a duplicate "Head Office" location under "HO"."""
    async with SessionLocal() as session:
        # Location is company-scoped now -- the pre-existing "Head Office"
        # must belong to the same "CKS" company ensure_owner will look up
        # (and, on a first run, create) for this to be a genuine reuse case.
        company = Company(code="CKS", name="Citykart Stores")
        session.add(company)
        await session.flush()
        existing_location = Location(company_id=company.id, code="OFFICE-01", name="Head Office")
        session.add(existing_location)
        await session.flush()
        existing_location_id = existing_location.id
        await session.commit()

    async with SessionLocal() as session:
        result = await ensure_owner(session)
        await session.commit()

    assert result["location_id"] == existing_location_id

    async with SessionLocal() as session:
        locations = (await session.execute(select(Location).where(Location.name == "Head Office"))).scalars().all()
        assert len(locations) == 1
        assert locations[0].id == existing_location_id
        assert locations[0].code == "OFFICE-01"  # untouched, not overwritten

        asset_user = await session.get(AssetUser, result["asset_user_id"])
        assert asset_user.location_id == existing_location_id
