import pytest
from fastapi import HTTPException
from app.core.deps import require_role, scoped_company_ids


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
