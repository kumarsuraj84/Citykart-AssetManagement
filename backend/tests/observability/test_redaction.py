"""S8: the redaction every log row and line goes through."""
from datetime import date
from decimal import Decimal

import pytest

from app.observability.redact import (
    MASK, is_sensitive_key, redact, redact_sql, redact_text, register_secret, truncate,
)


@pytest.mark.parametrize("key", ["password", "new_password", "temp_password", "password_hash", "Authorization",
                                 "Cookie", "refresh_token", "access_token", "api_key", "X-Api-Key", "jwt_secret",
                                 "database_url", "po_source_password", "client-secret"])
def test_sensitive_keys(key):
    assert is_sensitive_key(key)


@pytest.mark.parametrize("key", ["name", "login_id", "gstin", "request_id", "idempotency_key", "status", "summary"])
def test_ordinary_keys(key):
    assert not is_sensitive_key(key)


def test_nested_values_are_masked_by_key_at_any_depth():
    data = {"user": {"login_id": "ravi", "password": "p@ss"}, "items": [{"token": "t1"}, {"name": "ok"}],
            "headers": {"Authorization": "Bearer abc", "Accept": "json"}}
    out = redact(data)
    assert out == {"user": {"login_id": "ravi", "password": MASK}, "items": [{"token": MASK}, {"name": "ok"}],
                   "headers": {"Authorization": MASK, "Accept": "json"}}


@pytest.mark.parametrize("text,leak", [
    ("Authorization: Bearer abc.def-ghi_123", "abc.def-ghi_123"),
    ("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here", "c2lnbmF0dXJl"),
    ("hash $argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA", "aGFzaA"),
    ("postgresql+asyncpg://ckam:SuperPw9@db:5432/ckam", "SuperPw9"),
    ('{"password": "Hunter2"}', "Hunter2"),
    ("temp_password=Xy9!abc", "Xy9!abc"),
    ("Cookie: refresh_token=abc123def; path=/", "abc123def"),
])
def test_values_are_masked_by_pattern(text, leak):
    assert leak not in redact_text(text)


def test_registered_secrets_are_masked_anywhere():
    register_secret("a-very-specific-secret-value")
    assert "a-very-specific-secret-value" not in redact_text("x a-very-specific-secret-value y")
    register_secret("abc")          # too short to register (would mask ordinary words)
    assert redact_text("abc") == "abc"


def test_long_text_is_cut_with_a_note():
    out = truncate("x" * 5000, 100)
    assert out.startswith("x" * 100) and "4900 more characters" in out
    assert len(redact({"note": "y" * 5000})["note"]) < 2100


def test_values_become_json_safe():
    out = redact({"amount": Decimal("12.50"), "day": date(2026, 10, 14), "raw": b"\x00\x01", "ids": {3, 4}})
    assert out["amount"] == 12.5 and out["day"] == "2026-10-14" and out["raw"] == "<2 bytes>"
    assert sorted(out["ids"]) == [3, 4]


def test_sql_literals_are_replaced():
    sql = "SELECT * FROM asset_user WHERE email = 'ravi@x.com' AND id = 42 AND code = $1"
    out = redact_sql(sql)
    assert "ravi@x.com" not in out and " 42" not in out and "$1" in out


def test_nul_characters_are_shown_not_stored():
    assert redact_text("a\x00b") == "a\\0b"
