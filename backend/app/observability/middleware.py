"""The outermost middleware: one request id and one context per request.

* Takes a well-formed incoming `X-Request-ID` (1-64 of A-Z a-z 0-9 . _ -), else makes a UUID4 hex, and
  echoes it as `X-Request-ID` on EVERY response (2xx, 4xx, 5xx, idempotency replays, files, the SPA).
* Keeps the first 64 KB of the request body (only to describe its keys and sizes if an error happens --
  values are never stored).
* An exception nobody handled: an error_log row (redacted stack + context + fingerprint), then the plain
  answer `{"detail": "...", "request_id": ...}` with status 500, then the exception is re-raised like
  Starlette itself does (the server logs it; test clients can still see it).
* When the request ends: one access line in app.jsonl (request id, actor, role, ip, method, route template,
  path, status, duration, bytes, SQL count / time), a throttled WARNING row for a slow request (and its
  slow SQL statements), and -- the coverage safety net -- a DATA row when a successful write request
  changed business rows but wrote no audit row at all (so nothing is ever silently unaudited; the route
  should get its own explicit row, see docs/ai/LOGGING_AND_DIAGNOSTICS.md)."""
from __future__ import annotations

import ipaddress
import logging
import time
from functools import lru_cache

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse

from app.core.config import settings
from app.observability import context, filelog, writer

BODY_SAMPLE = 64 * 1024
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
UNEXPECTED = "Something went wrong on the server. Nothing more was saved. Quote the reference to the administrator."

access_logger = logging.getLogger(filelog.ACCESS)


@lru_cache(maxsize=8)
def _trusted_networks(spec: str) -> tuple:
    nets = []
    for part in (spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        if part == "*":
            return ("*",)
        try:
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            continue
    return tuple(nets)


def _is_trusted(ip: str | None) -> bool:
    nets = _trusted_networks(settings.trusted_proxies)
    if not nets or not ip:
        return False
    if nets == ("*",):
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in nets)


def client_ip(scope, headers: Headers) -> str | None:
    """The connecting address; X-Forwarded-For only when that address is a TRUSTED_PROXIES proxy (then the
    right-most address that is not itself a trusted proxy)."""
    client = scope.get("client")
    peer = client[0] if client else None
    if not _is_trusted(peer):
        return peer
    forwarded = headers.get("x-forwarded-for")
    if not forwarded:
        return peer
    for candidate in reversed([p.strip() for p in forwarded.split(",") if p.strip()]):
        try:
            ipaddress.ip_address(candidate)
        except ValueError:
            return peer
        if not _is_trusted(candidate):
            return candidate
    return peer


def route_of(scope) -> str | None:
    """The full route template ("/api/masters/vendors/{item_id}"). FastAPI puts the matched route in the
    scope; for a router included inside another router its `path` lacks the outer prefix, so the prefix is
    taken from the real path when the rendered template is its tail."""
    route = scope.get("route")
    template = getattr(route, "path", None)
    if not template:
        return None
    path = scope.get("path") or ""
    fmt = getattr(route, "path_format", None) or template
    try:
        rendered = fmt.format(**{k: v for k, v in (scope.get("path_params") or {}).items()})
    except (KeyError, IndexError, ValueError):
        return template
    if rendered != path and path.endswith(rendered):
        return path[: len(path) - len(rendered)] + template
    return template


class RequestContextMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        rid = context.accept_incoming(headers.get("x-request-id")) or context.new_request_id()
        ctx = context.RequestContext(
            request_id=rid, source="api", method=scope.get("method"), path=scope.get("path"),
            ip=client_ip(scope, headers), user_agent=(headers.get("user-agent") or "")[:300] or None,
            content_type=headers.get("content-type"),
            query_string=(scope.get("query_string") or b"").decode("latin-1"),
        )
        state = {"status": None, "bytes": 0, "started": False}

        async def receive_wrapper():
            message = await receive()
            if message.get("type") == "http.request":
                body = message.get("body", b"") or b""
                ctx.body_size += len(body)
                room = BODY_SAMPLE - len(ctx.body_sample)
                if room > 0 and body:
                    ctx.body_sample += body[:room]
            return message

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                state["started"] = True
                state["status"] = message["status"]
                message["headers"] = list(message.get("headers") or [])
                MutableHeaders(scope=message)[context.REQUEST_ID_HEADER] = rid
            elif message["type"] == "http.response.body":
                state["bytes"] += len(message.get("body", b"") or b"")
            await send(message)

        with context.bind(ctx):
            error: BaseException | None = None
            try:
                await self.app(scope, receive_wrapper, send_wrapper)
            except Exception as exc:
                error = exc
                ctx.route = route_of(scope)
                ctx.path_params = dict(scope.get("path_params") or {})
                await writer.exception(exc, status_code=500)
                if not state["started"]:
                    response = JSONResponse(
                        {"detail": UNEXPECTED, "request_id": rid}, status_code=500,
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
                    )
                    await response(scope, receive, send_wrapper)
                raise
            finally:
                try:
                    await self._finish(scope, ctx, state, error)
                except Exception as exc:          # never let logging break the request
                    writer.report_failure("access log", exc)

    async def _finish(self, scope, ctx: context.RequestContext, state: dict, error: BaseException | None) -> None:
        duration_ms = round((time.perf_counter() - ctx.started) * 1000, 1)
        status = state["status"] or 500
        ctx.route = ctx.route or route_of(scope)
        if not ctx.path_params:
            ctx.path_params = dict(scope.get("path_params") or {})
        route = ctx.route or ctx.path
        access_logger.info(
            "%s %s %s %.0fms", ctx.method, ctx.path, status, duration_ms,
            extra={"fields": {
                "kind": "access", "request_id": ctx.request_id, "actor_id": ctx.actor_id, "role": ctx.actor_role,
                "ip": ctx.ip, "method": ctx.method, "route": ctx.route, "path": ctx.path, "status": status,
                "duration_ms": duration_ms, "bytes": state["bytes"], "sql_count": ctx.sql_count,
                "sql_ms": round(ctx.sql_ms, 1),
            }},
        )
        threshold = settings.log_slow_request_ms
        if threshold and duration_ms > threshold:
            await writer.warning(
                "slow_request", f"{ctx.method} {route} took {duration_ms:.0f} ms (limit {threshold} ms).",
                fp=writer.fingerprint("slow_request", ctx.method, route), status_code=status,
                details={"duration_ms": duration_ms, "sql_count": ctx.sql_count, "sql_ms": round(ctx.sql_ms, 1),
                         **writer.request_snapshot(ctx)},
                throttle=(f"slow_request:{ctx.method}:{route}", 60),
            )
        for entry in ctx.slow_sql[:5]:
            fp = writer.fingerprint("slow_sql", entry["statement"][:300])
            await writer.warning(
                "slow_sql", f"A database statement took {entry['duration_ms']:.0f} ms (limit {settings.log_slow_sql_ms} ms).",
                fp=fp, details=entry, throttle=(f"slow_sql:{fp}", 60), source="db",
            )
        if (error is None and ctx.method in WRITE_METHODS and 200 <= status < 400
                and ctx.db_writes > 0 and ctx.audit_rows == 0):
            await writer.audit_now(
                "DATA", "WRITE", f"{ctx.method} {route} saved changes that have no specific audit entry.",
                changes={"path": ctx.path, "status": status, "writes": ctx.db_writes},
            )
        if status < 500 and ctx.sql_count > 0:
            await writer.note_db_ok()
