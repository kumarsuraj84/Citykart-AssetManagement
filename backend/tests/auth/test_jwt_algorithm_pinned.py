"""Closure WP-A1 item 8 (dependency recheck): the python-jose advisory PYSEC-2026-4298 needs a verifier that lets the
token choose its algorithm and uses an asymmetric public key as the HMAC secret. CKAM has no asymmetric key and
pins HS256 on decode; these tests keep it that way."""
import base64
import json

import pytest
from jose import jwt

from app.core.config import settings
from app.core.security import create_access_token, decode_token


def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def test_a_normal_token_decodes():
    assert decode_token(create_access_token(7, "OPERATOR", None))["sub"] == "7"


@pytest.mark.parametrize("alg", ["HS384", "HS512"])
def test_a_token_signed_with_another_hmac_algorithm_is_refused_even_with_the_right_secret(alg):
    forged = jwt.encode({"sub": "1", "type": "access"}, settings.jwt_secret, algorithm=alg)
    with pytest.raises(ValueError):
        decode_token(forged)


@pytest.mark.parametrize("alg", ["none", "None", "RS256", "ES256"])
def test_an_unsigned_or_asymmetric_header_is_refused(alg):
    forged = f"{_b64({'alg': alg, 'typ': 'JWT'})}.{_b64({'sub': '1', 'type': 'access'})}."
    with pytest.raises(ValueError):
        decode_token(forged)
    with pytest.raises(ValueError):
        decode_token(forged + "c2ln")
