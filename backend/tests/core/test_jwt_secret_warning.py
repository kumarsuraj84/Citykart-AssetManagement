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
