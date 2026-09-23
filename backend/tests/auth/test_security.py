from app.core.security import hash_password, verify_password, create_access_token, decode_token


def test_hash_and_verify_roundtrip():
    hashed = hash_password("S3cret!23")
    assert hashed != "S3cret!23"
    assert verify_password("S3cret!23", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_token_roundtrip():
    token = create_access_token(holder_id=42, role="ADMIN", company_scope=None)
    payload = decode_token(token)
    assert payload["sub"] == "42"
    assert payload["role"] == "ADMIN"
    assert payload["company_scope"] is None
