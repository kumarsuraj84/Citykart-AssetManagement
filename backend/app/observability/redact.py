"""Removes secrets before anything is stored in a log table or written to a log file.

Two independent nets, both always applied:
1. by KEY NAME, recursively through dicts and lists: any key that names a password, token, secret, cookie,
   authorization header, API key or database URL has its value replaced by "***";
2. by VALUE PATTERN, in every string (also free text such as exception messages and stack traces): Bearer
   tokens, JWT-shaped strings, argon2 password hashes, "password=..." pairs, the password inside a
   database URL, and the running server's own secrets (JWT secret, database and ERP passwords) wherever
   they appear.
Long strings are cut (with a note of how much was cut) so one huge value can never bloat a row."""
from __future__ import annotations

import datetime as _dt
import decimal
import re
from typing import Any

MASK = "***"
DEFAULT_MAX_TEXT = 2000
MAX_DEPTH = 8
MAX_ITEMS = 200

# exact key names (lower case, without "_" / "-" / spaces)
_SENSITIVE_EXACT = {
    "password", "newpassword", "oldpassword", "temppassword", "passwordhash", "pw", "pwd", "passwd",
    "token", "accesstoken", "refreshtoken", "idtoken", "authorization", "proxyauthorization", "cookie",
    "setcookie", "secret", "jwtsecret", "clientsecret", "apikey", "xapikey", "privatekey", "databaseurl",
    "dburl", "dsn", "posourcepassword", "credentials", "sessionid", "csrftoken",
}
# yes/no flags whose names merely mention a password (never a secret themselves)
_NOT_SENSITIVE = {"mustchangepassword", "onlywithoutpassword"}
# key name fragments
_SENSITIVE_PARTS = ("password", "passwd", "secret", "token", "apikey", "cookie", "authorization", "credential")

_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9\-._~+/]+=*"), "Bearer " + MASK),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}"), MASK),
    (re.compile(r"\$argon2(?:id|i|d)\$[^\s\"']+"), MASK),
    # scheme://user:password@host  ->  scheme://user:***@host
    (re.compile(r"(?i)\b([a-z][a-z0-9+.\-]*://[^\s:/@\"']+:)[^\s@\"']+@"), r"\1" + MASK + "@"),
    # password=..., "password": "...", temp_password: ...
    (re.compile(r"(?i)(\b[\w\-]*(?:password|passwd|pwd|secret|token|api[_\-]?key)[\w\-]*\b[\"']?\s*[=:]\s*[\"']?)"
                r"([^\s\"',;&}]+)"), r"\1" + MASK),
    (re.compile(r"(?i)\b(refresh_token|access_token)=[^;\s]+"), r"\1=" + MASK),
]

_known_secrets: list[str] = []


def register_secret(value: str | None) -> None:
    """Values that must never appear anywhere (the JWT secret, database / ERP passwords)."""
    if value and len(value) >= 6 and value not in _known_secrets:
        _known_secrets.append(value)
        _known_secrets.sort(key=len, reverse=True)


def register_settings_secrets(settings) -> None:
    register_secret(getattr(settings, "jwt_secret", None))
    register_secret(getattr(settings, "po_source_password", None))
    url = getattr(settings, "database_url", "") or ""
    m = re.search(r"://[^:/@]+:([^@]+)@", url)
    if m:
        register_secret(m.group(1))


def is_sensitive_key(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    norm = re.sub(r"[\s_\-.]", "", key.lower())
    if norm in _NOT_SENSITIVE:
        return False
    if norm in _SENSITIVE_EXACT:
        return True
    return any(part in norm for part in _SENSITIVE_PARTS)


def truncate(text: str, limit: int = DEFAULT_MAX_TEXT) -> str:
    if limit and len(text) > limit:
        return text[:limit] + f"... (cut, {len(text) - limit} more characters)"
    return text


def redact_text(text: Any, limit: int = DEFAULT_MAX_TEXT) -> Any:
    if text is None:
        return None
    if not isinstance(text, str):
        text = str(text)
    for secret in _known_secrets:
        if secret in text:
            text = text.replace(secret, MASK)
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    text = text.replace("\x00", "\\0")
    return truncate(text, limit)


def json_safe(value: Any) -> Any:
    """A value that json.dumps / JSONB accept."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, decimal.Decimal):
        return float(value) if value == value.to_integral_value() or abs(value) < 10**12 else str(value)
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [json_safe(v) for v in value]
    return str(value)


def redact(value: Any, limit: int = DEFAULT_MAX_TEXT, _depth: int = 0) -> Any:
    """A JSON-safe copy of `value` with every secret masked (by key and by pattern) and long text cut."""
    if _depth > MAX_DEPTH:
        return "..."
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return redact_text(value, limit)
    if isinstance(value, dict):
        out: dict = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= MAX_ITEMS:
                out["..."] = f"{len(value) - MAX_ITEMS} more keys"
                break
            key = str(k)
            out[key] = MASK if is_sensitive_key(key) and v not in (None, "") else redact(v, limit, _depth + 1)
        return out
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)
        out_list = [redact(v, limit, _depth + 1) for v in items[:MAX_ITEMS]]
        if len(items) > MAX_ITEMS:
            out_list.append(f"... {len(items) - MAX_ITEMS} more")
        return out_list
    return redact(json_safe(value), limit, _depth + 1)


_SQL_STRING = re.compile(r"'(?:[^']|'')*'")
_SQL_NUMBER = re.compile(r"(?<![\w$])-?\d+(?:\.\d+)?\b")


def redact_sql(statement: str, limit: int = 2000) -> str:
    """A statement with its literal values replaced by ? (parameters are already $n placeholders)."""
    text = _SQL_STRING.sub("?", statement or "")
    text = _SQL_NUMBER.sub("?", text)
    text = re.sub(r"\s+", " ", text).strip()
    return redact_text(text, limit)
