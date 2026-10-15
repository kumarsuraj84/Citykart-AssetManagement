import secrets
from datetime import datetime, timedelta, timezone
from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHash
from jose import jwt, JWTError
from app.core.config import settings

_hasher = PasswordHasher()

# Security AU-01: a real Argon2 hash (same parameters as every stored one) of a random throw-away value. Sign-in
# checks the typed password against it when no usable account matches, so "no such account / disabled / locked"
# costs the same ~40 ms as a real password check and the response time no longer tells which login ids exist.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(24))


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    """Return False for any verification failure: a genuine mismatch, or a
    malformed/empty hash (e.g. InvalidHash, which is not an Argon2Error
    subclass and must be caught separately) rather than raising a 500."""
    try:
        return _hasher.verify(hashed, raw)
    except (Argon2Error, InvalidHash):
        return False


def burn_password_check(raw: str) -> None:
    """Security AU-01: the same work as a real password check, for a sign-in that has no usable account."""
    verify_password(raw or "", _DUMMY_HASH)


def _jwt_times(lifetime: timedelta) -> dict:
    now = datetime.now(timezone.utc)
    return {"iat": int(now.timestamp()), "exp": now + lifetime}


def create_access_token(asset_user_id: int, role: str, company_scope: int | None, token_version: int = 0) -> str:
    # Security AU-05/AU-06: `tv` is the account's session version (asset_user.token_version) -- a token whose
    # version is not the account's current one is refused (sign-out, password change / reset, deactivation,
    # access change all raise it). `jti` makes every token unique, even two minted in the same second.
    payload = {
        "sub": str(asset_user_id),
        "role": role,
        "company_scope": company_scope,
        "type": "access",
        "tv": int(token_version or 0),
        "jti": secrets.token_urlsafe(16),
        **_jwt_times(timedelta(minutes=settings.jwt_access_minutes)),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_refresh_token(asset_user_id: int, token_version: int = 0) -> str:
    payload = {"sub": str(asset_user_id), "type": "refresh", "tv": int(token_version or 0),
               "jti": secrets.token_urlsafe(16), **_jwt_times(timedelta(hours=settings.jwt_refresh_hours))}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise ValueError("invalid token") from exc


def token_version_of(payload: dict) -> int | None:
    """The session version a token was issued for. A token from before versions existed has no `tv`: it counts as
    version 0, so sessions that were open at the upgrade keep working until the account's version first changes.
    None for a malformed claim (never matches)."""
    value = payload.get("tv", 0)
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def token_is_current(payload: dict, asset_user) -> bool:
    """Security AU-05: the token was issued for the account's current session version."""
    return token_version_of(payload) == int(getattr(asset_user, "token_version", 0) or 0)


def end_all_sessions(asset_user) -> None:
    """Security AU-05/AU-07: every access and refresh token issued to this account so far stops working (the
    caller commits). Used on sign-out, password change / reset, deactivation, sign-in switched off and any
    change of role, work area, company or company access."""
    asset_user.token_version = int(getattr(asset_user, "token_version", 0) or 0) + 1
