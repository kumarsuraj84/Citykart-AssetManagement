import pytest
from fastapi import HTTPException
from app.core.deps import get_current_holder, require_role, scoped_company_ids
from app.core.security import create_refresh_token


class _FakeHolder:
    def __init__(self, role, company_id, holder_company_ids=None):
        self.role = role
        self.company_id = company_id
        self._access = holder_company_ids or []


def test_scoped_company_ids_admin_sees_all():
    assert scoped_company_ids(_FakeHolder("ADMIN", 1)) is None


def test_scoped_company_ids_holder_sees_own_company_only():
    assert scoped_company_ids(_FakeHolder("HOLDER", 7)) == [7]


def test_require_role_rejects_wrong_role():
    checker = require_role("ADMIN", "IT_TEAM")
    with pytest.raises(HTTPException) as exc:
        checker(_FakeHolder("VIEWER", 1))
    assert exc.value.status_code == 403


def test_require_role_allows_matching_role():
    checker = require_role("ADMIN", "IT_TEAM")
    result = checker(_FakeHolder("IT_TEAM", 1))
    assert result.role == "IT_TEAM"


async def test_get_current_holder_rejects_refresh_token():
    # A refresh token is a real, validly-signed JWT but must never authenticate
    # like an access token — get_current_holder must reject it on the "type"
    # claim before it ever reaches the DB lookup (session=None proves this:
    # the call would blow up on session.get if the type check were skipped).
    token = create_refresh_token(holder_id=1)
    with pytest.raises(HTTPException) as exc:
        await get_current_holder(token=token, session=None)
    assert exc.value.status_code == 401
