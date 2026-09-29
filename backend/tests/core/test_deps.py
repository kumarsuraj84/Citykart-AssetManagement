import pytest
from fastapi import HTTPException
from app.core.db import SessionLocal
from app.core.deps import get_current_asset_user, require_role, scoped_company_ids
from app.core.security import create_refresh_token, hash_password
from app.asset_users.models import AssetUser, AssetUserCompanyAccess
from app.masters.models import Company, Department, Location


class _FakeAssetUser:
    def __init__(self, role, company_id, id=0):  # noqa: A002 - matches the ORM attribute name
        self.role = role
        self.company_id = company_id
        self.id = id


async def test_scoped_company_ids_admin_sees_all():
    # ADMIN short-circuits before ever touching the session -- None is safe here.
    assert await scoped_company_ids(None, _FakeAssetUser("ADMIN", 1)) is None


async def test_scoped_company_ids_asset_user_sees_own_company_only():
    async with SessionLocal() as session:
        assert await scoped_company_ids(session, _FakeAssetUser("SELF_SERVICE", 7, id=0)) == [7]


async def test_scoped_company_ids_honors_asset_user_company_access_grants(client):
    """AM-24: the actual bug -- asset_user_company_access rows were stored but
    never queried, so a granted second company had zero effect anywhere a
    scope check ran. Confirms the real fix with a real AssetUser + a real
    AssetUserCompanyAccess row, not just a FakeAssetUser unit check."""
    async with SessionLocal() as session:
        co_a = Company(code="DEPS-A", name="Deps Co A")
        co_b = Company(code="DEPS-B", name="Deps Co B")
        session.add_all([co_a, co_b])
        await session.flush()
        loc = Location(company_id=co_a.id, code="DEPS-LOC", name="Deps HO")
        dept = Department(name="DEPS-DEPT")
        session.add_all([loc, dept])
        await session.flush()
        staff = AssetUser(
            company_id=co_a.id, code="DEPS-ITT", name="Deps IT Team", asset_user_type="EMPLOYEE",
            location_id=loc.id, department_id=dept.id, role="OPERATOR",
            login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False,
        )
        session.add(staff)
        await session.flush()
        session.add(AssetUserCompanyAccess(asset_user_id=staff.id, company_id=co_b.id))
        await session.commit()

        allowed = await scoped_company_ids(session, staff)
        assert set(allowed) == {co_a.id, co_b.id}


def test_require_role_rejects_wrong_role():
    checker = require_role("ADMIN", "OPERATOR")
    with pytest.raises(HTTPException) as exc:
        checker(_FakeAssetUser("VIEWER", 1))
    assert exc.value.status_code == 403


def test_require_role_allows_matching_role():
    checker = require_role("ADMIN", "OPERATOR")
    result = checker(_FakeAssetUser("OPERATOR", 1))
    assert result.role == "OPERATOR"


async def test_get_current_asset_user_rejects_refresh_token():
    # A refresh token is a real, validly-signed JWT but must never authenticate
    # like an access token — get_current_asset_user must reject it on the "type"
    # claim before it ever reaches the DB lookup (session=None proves this:
    # the call would blow up on session.get if the type check were skipped).
    token = create_refresh_token(asset_user_id=1)
    with pytest.raises(HTTPException) as exc:
        await get_current_asset_user(request=None, token=token, session=None)
    assert exc.value.status_code == 401
