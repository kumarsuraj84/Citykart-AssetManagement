from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.db import SessionLocal
from app.masters.models import Company, Location, Department
from app.asset_users.models import AssetUser


async def test_emp_code_unique_within_company():
    async with SessionLocal() as session:
        co = Company(code="CKS2", name="Test Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code="HO2", name="Head Office 2")
        dept = Department(name="IT-Test")
        session.add_all([loc, dept])
        await session.flush()
        company_id = co.id  # captured before the rollback below expires `co`

        session.add(AssetUser(
            company_id=co.id, code="CS6872", name="Ankur",
            asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="SELF_SERVICE",
        ))
        await session.commit()

        dup = AssetUser(
            company_id=co.id, code="CS6872", name="Duplicate",
            asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="SELF_SERVICE",
        )
        session.add(dup)
        raised = False
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raised = True
        assert raised

        rows = (await session.execute(select(AssetUser).where(AssetUser.company_id == company_id))).scalars().all()
        assert len(rows) == 1


async def test_email_unique_within_company_case_insensitive():
    """POST /api/auth/login accepts email as an alternative login_id (matched
    case-insensitively), so a duplicate email within one company would make
    that lookup non-deterministic -- migration 0005_asset_user_email_unique.py's
    partial unique index on (company_id, lower(email)) WHERE email IS NOT
    NULL must make that structurally impossible, including across case."""
    async with SessionLocal() as session:
        co = Company(code="CKS-EM1", name="Email Unique Test Co")
        session.add(co)
        await session.flush()
        loc = Location(company_id=co.id, code="HO-EM1", name="Head Office EM1")
        dept = Department(name="IT-EM1")
        session.add_all([loc, dept])
        await session.flush()

        session.add(AssetUser(
            company_id=co.id, code="EM1-A", name="Ankur",
            asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="SELF_SERVICE", email="ankur.pahwa@citykartstores.com",
        ))
        await session.commit()

        # Different code (so this doesn't just re-trip the code
        # constraint), same email but different case -- must still collide
        # because the index is on lower(email).
        dup = AssetUser(
            company_id=co.id, code="EM1-B", name="Duplicate",
            asset_user_type="EMPLOYEE", location_id=loc.id, department_id=dept.id,
            role="SELF_SERVICE", email="ANKUR.PAHWA@CITYKARTSTORES.COM",
        )
        session.add(dup)
        raised = False
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raised = True
        assert raised


async def test_email_can_repeat_across_different_companies():
    """The unique index is scoped to (company_id, lower(email)), matching how
    code uniqueness already works -- the same email must be allowed to
    appear once per company, not globally."""
    async with SessionLocal() as session:
        co_a = Company(code="CKS-EM2A", name="Email Cross-Company Co A")
        co_b = Company(code="CKS-EM2B", name="Email Cross-Company Co B")
        session.add_all([co_a, co_b])
        await session.flush()
        loc_a = Location(company_id=co_a.id, code="HO-EM2A", name="Head Office EM2A")
        loc_b = Location(company_id=co_b.id, code="HO-EM2B", name="Head Office EM2B")
        dept = Department(name="IT-EM2")
        session.add_all([loc_a, loc_b, dept])
        await session.flush()

        session.add(AssetUser(
            company_id=co_a.id, code="EM2-A", name="Ankur A",
            asset_user_type="EMPLOYEE", location_id=loc_a.id, department_id=dept.id,
            role="SELF_SERVICE", email="shared@example.com",
        ))
        session.add(AssetUser(
            company_id=co_b.id, code="EM2-B", name="Ankur B",
            asset_user_type="EMPLOYEE", location_id=loc_b.id, department_id=dept.id,
            role="SELF_SERVICE", email="shared@example.com",
        ))
        # Must NOT raise -- same email, two different companies.
        await session.commit()

        rows = (await session.execute(
            select(AssetUser).where(AssetUser.email == "shared@example.com")
        )).scalars().all()
        assert len(rows) == 2
