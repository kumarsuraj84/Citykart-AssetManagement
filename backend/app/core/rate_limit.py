"""Security AU-03/AU-04: in-process sliding-window rate limits for the sign-in endpoints.

CKAM runs as ONE uvicorn process (no Docker, no proxy in production), so a dictionary in memory is enough --
no Redis. Limits (Settings, per RATE_LIMIT_WINDOW_SECONDS, default one minute):

* POST /api/auth/login            RATE_LIMIT_LOGIN_PER_IP (20) per client address
                                  and RATE_LIMIT_LOGIN_PER_LOGIN_ID (10) per login id (trimmed, lower case)
* POST /api/auth/refresh          RATE_LIMIT_REFRESH_PER_IP (60) per client address
* POST /api/auth/change-password  RATE_LIMIT_CHANGE_PASSWORD_PER_IP (10) per client address

The client address is the request context's (app.observability.middleware.client_ip): the connecting address,
X-Forwarded-For only from a TRUSTED_PROXIES proxy -- a spoofed header cannot buy fresh limits. A request over a
limit is refused with 429, a Retry-After header and the plain sentence below, before any password check, and a
SECURITY RATE_LIMITED row is written (at most one per key and minute, never the password). Refused requests do
not count. Memory is bounded: keys idle for longer than the window are dropped, and the table never holds more
than MAX_KEYS keys. RATE_LIMIT_ENABLED=false switches all of it off (the test suite does, except in its own
rate-limit tests)."""
from __future__ import annotations

import math
import time
from collections import deque

from fastapi import HTTPException, Request, status

from app.core.config import settings
from app.observability import context as obs_context
from app.observability import writer as obs_writer

TOO_MANY = "Too many sign-in attempts. Wait a minute and try again."
MAX_KEYS = 50_000

_hits: dict[str, deque] = {}
_last_sweep = 0.0


def reset() -> None:
    """Forget every counted request (tests)."""
    global _last_sweep
    _hits.clear()
    _last_sweep = 0.0


def _sweep(now: float, window: float) -> None:
    """Drops keys with no request inside the window; if still too many, the least recently used ones."""
    global _last_sweep
    _last_sweep = now
    for key in [k for k, q in _hits.items() if not q or q[-1] <= now - window]:
        _hits.pop(key, None)
    if len(_hits) > MAX_KEYS:
        # down to 90 %, so a flood of new addresses does not sort the whole table on every request
        for key in sorted(_hits, key=lambda k: _hits[k][-1])[: len(_hits) - int(MAX_KEYS * 0.9)]:
            _hits.pop(key, None)


def hit(key: str, limit: int, window: float, now: float | None = None) -> int | None:
    """Counts one request for `key`. None when it is allowed; else the whole seconds until the next one is.
    A limit of 0 (or less) means no limit for that key."""
    if limit <= 0:
        return None
    now = time.monotonic() if now is None else now
    if now - _last_sweep > window or len(_hits) > MAX_KEYS:
        _sweep(now, window)
    q = _hits.get(key)
    if q is None:
        q = _hits[key] = deque()
    while q and q[0] <= now - window:
        q.popleft()
    if len(q) >= limit:
        retry = math.ceil(q[0] + window - now) if q else math.ceil(window)
        return max(1, retry)
    q.append(now)
    return None


def client_address(request: Request | None) -> str:
    ctx = obs_context.current()
    if ctx is not None and ctx.ip:
        return ctx.ip
    client = getattr(request, "client", None) if request is not None else None
    return getattr(client, "host", None) or "unknown"


async def _refuse(endpoint: str, by: str, key: str, retry_after: int, extra: dict | None = None) -> HTTPException:
    await obs_writer.security(
        "RATE_LIMITED", f"Too many {endpoint} requests {by}: refused for {retry_after} s.", outcome="DENIED",
        changes={"endpoint": endpoint, "limited_by": by, "retry_after_seconds": retry_after, **(extra or {})},
        throttle=(f"ratelimit:{key}", 60))
    return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY, headers={"Retry-After": str(retry_after)})


async def check(endpoint: str, request: Request | None, per_ip: int, login_id: str | None = None,
                per_login_id: int | None = None) -> None:
    """Raises 429 when this client address (or this login id) has used up its requests for the window."""
    if not settings.rate_limit_enabled:
        return
    window = float(settings.rate_limit_window_seconds)
    ip = client_address(request)
    retry = hit(f"{endpoint}:ip:{ip}", per_ip, window)
    if retry is not None:
        raise await _refuse(endpoint, "from one address", f"{endpoint}:ip:{ip}", retry)
    if login_id is not None and per_login_id is not None:
        normalized = login_id.strip().lower()[:200]
        retry = hit(f"{endpoint}:id:{normalized}", per_login_id, window)
        if retry is not None:
            raise await _refuse(endpoint, "for one login id", f"{endpoint}:id:{normalized}", retry,
                                {"login_id": normalized})


async def limit_login(request: Request, login_id: str) -> None:
    await check("login", request, settings.rate_limit_login_per_ip, login_id, settings.rate_limit_login_per_login_id)


async def limit_refresh(request: Request) -> None:
    """FastAPI dependency for POST /api/auth/refresh."""
    await check("refresh", request, settings.rate_limit_refresh_per_ip)


async def limit_change_password(request: Request) -> None:
    """FastAPI dependency for POST /api/auth/change-password (declared before the sign-in check)."""
    await check("change-password", request, settings.rate_limit_change_password_per_ip)
