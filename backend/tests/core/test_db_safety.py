import pytest
from conftest import UnsafeTestDatabaseError, _assert_safe_test_database


def test_dedicated_test_database_name_is_allowed():
    _assert_safe_test_database("ckam_test", allow_override=False)


def test_non_test_database_name_is_refused():
    with pytest.raises(UnsafeTestDatabaseError):
        _assert_safe_test_database("ckam", allow_override=False)


def test_non_test_database_name_allowed_with_explicit_override():
    _assert_safe_test_database("ckam", allow_override=True)


def test_refusal_message_names_the_database_and_the_override_var():
    with pytest.raises(UnsafeTestDatabaseError) as exc:
        _assert_safe_test_database("ckam", allow_override=False)
    assert "ckam" in str(exc.value)
    assert "CKAM_ALLOW_TEST_TRUNCATE" in str(exc.value)


def test_missing_database_name_is_refused():
    with pytest.raises(UnsafeTestDatabaseError):
        _assert_safe_test_database(None, allow_override=False)
