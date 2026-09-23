import logging

from app.core.config import DEFAULT_DEV_JWT_SECRET
from app.main import warn_if_default_jwt_secret


def test_warns_loudly_when_default_dev_secret_is_in_use(caplog):
    with caplog.at_level(logging.WARNING):
        assert warn_if_default_jwt_secret(DEFAULT_DEV_JWT_SECRET) is True
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings, "expected a WARNING log record"
    text = " ".join(r.getMessage() for r in warnings)
    assert "JWT_SECRET" in text
    assert "forge" in text.lower()


def test_silent_when_a_real_secret_is_configured(caplog):
    with caplog.at_level(logging.WARNING):
        assert warn_if_default_jwt_secret("a-real-long-random-secret-from-.env") is False
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]


def test_warns_on_the_other_committed_placeholder_from_env_example(caplog):
    # .env.example ships JWT_SECRET=change_me_too -- anyone who copies that
    # file to .env without editing this line is just as forgeable as the
    # app's own default, and must get the same loud warning.
    with caplog.at_level(logging.WARNING):
        assert warn_if_default_jwt_secret("change_me_too") is True
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings
    assert "JWT_SECRET" in " ".join(r.getMessage() for r in warnings)


def test_warns_on_a_too_short_secret_even_if_not_a_known_placeholder(caplog):
    with caplog.at_level(logging.WARNING):
        assert warn_if_default_jwt_secret("short") is True
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings
    assert "5 characters" in " ".join(r.getMessage() for r in warnings)
