"""S7 (P1-2): safe retries -- the `Idempotency-Key` header on the "create / receive / move" requests.

A double tap, a bouncing key, a second browser tab or an automatic client retry can send the SAME request
twice within milliseconds. The screen cannot always stop that, so the server does: a request that carries
`Idempotency-Key: <a fresh uuid per user action>` is done at most once per user and key.

Contract (only for the requests listed in IDEMPOTENT_ROUTES; every other request, and every request without
the header, behaves exactly as before):

1. The first request with a key claims it (a row in `idempotency_key`, committed on its own before the
   request runs), then runs normally. A success (2xx) is stored: status code and JSON body.
2. The same key again with the SAME request (method, path, query and body) gets the stored answer again --
   same status code and body -- with the header `Idempotency-Replay: true`. Nothing is done a second time.
3. The same key while the first request is still running: 409 "This request is already being processed."
4. The same key with a DIFFERENT request: 422 "This request key was already used for a different request."
5. A request that fails (4xx / 5xx, or an unexpected error) is not stored: its key is released, so the
   corrected request can be sent again with the same key.
6. Keys are per user and kept for 24 hours; older ones are removed whenever a new key is claimed.

The rows are technical bookkeeping, not business records: removing a failed or expired key is part of the
contract above (the business tables are never touched here)."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, delete, func, select, update
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.orm import Mapped, mapped_column
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from app.core import db as core_db
from app.core.db import Base
from app.core.security import decode_token

HEADER = "idempotency-key"
REPLAY_HEADER = "Idempotency-Replay"
KEEP_FOR = timedelta(hours=24)
KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:\-]{8,200}$")

BUSY = "This request is already being processed."
DIFFERENT = "This request key was already used for a different request."
BAD_KEY = "The request key is not valid. Send a new random key (for example a UUID) with each action."

# The requests that honour the header: everything that creates assets / POs / people or moves assets.
IDEMPOTENT_ROUTES: tuple[tuple[str, re.Pattern], ...] = tuple((m, re.compile(p)) for m, p in (
    ("POST", r"^/api/assets$"),
    ("POST", r"^/api/assets/batch$"),
    ("POST", r"^/api/assets/bulk-action$"),
    ("POST", r"^/api/assets/bulk-move$"),
    ("POST", r"^/api/assets/link-items$"),
    ("POST", r"^/api/assets/\d+/events$"),
    ("POST", r"^/api/purchase-orders$"),
    ("POST", r"^/api/purchase-orders/with-lines$"),
    ("POST", r"^/api/purchase-orders/\d+/receive$"),
    ("POST", r"^/api/purchase-orders/\d+/deliver$"),
    ("POST", r"^/api/erp/pos/create$"),
    ("POST", r"^/api/people/[a-z0-9\-/]+$"),
    ("POST", r"^/api/stock-rooms$"),
))


class IdempotencyKey(Base):
    __tablename__ = "idempotency_key"
    __table_args__ = (UniqueConstraint("actor_id", "key", name="uq_idempotency_key_actor_key"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(String(200))
    actor_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_user.id"))
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(500))
    request_hash: Mapped[str] = mapped_column(String(64))
    status_code: Mapped[int | None] = mapped_column(Integer)
    response_json: Mapped[object | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def applies(method: str, path: str) -> bool:
    path = path.rstrip("/") or "/"
    return any(method == m and p.match(path) for m, p in IDEMPOTENT_ROUTES)


def actor_of(authorization: str | None) -> int | None:
    """The user id of a valid access token, else None (the request then runs as usual and is refused by
    its own authentication)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        payload = decode_token(authorization.split(" ", 1)[1].strip())
    except ValueError:
        return None
    if payload.get("type") != "access":
        return None
    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None


def request_hash(method: str, path: str, query: bytes, body: bytes, content_type: str | None) -> str:
    """The same request = same method, path, query and body. A JSON body is compared by its meaning (key
    order and spacing do not matter)."""
    canonical = body
    if body and (content_type or "").split(";")[0].strip().lower() == "application/json":
        try:
            canonical = json.dumps(json.loads(body), sort_keys=True, separators=(",", ":")).encode()
        except (ValueError, UnicodeDecodeError):
            canonical = body
    digest = hashlib.sha256()
    for part in (method.encode(), path.rstrip("/").encode(), query or b"", canonical or b""):
        digest.update(part)
        digest.update(b"\x00")
    return digest.hexdigest()


async def claim(
    actor_id: int, key: str, method: str, path: str, hashed: str, _attempt: int = 0,
) -> tuple[str, IdempotencyKey | int | None]:
    """("new", row id) when this request may run; ("done", row) for a stored success; ("busy", None) while
    the first one runs; ("different", None) for the key reused on another request. Commits on its own."""
    async with core_db.SessionLocal() as s:
        now = datetime.now(timezone.utc)
        await s.execute(delete(IdempotencyKey).where(IdempotencyKey.created_at < now - KEEP_FOR))
        row_id = (await s.execute(
            insert(IdempotencyKey).values(key=key, actor_id=actor_id, method=method, path=path[:500], request_hash=hashed)
            .on_conflict_do_nothing(constraint="uq_idempotency_key_actor_key").returning(IdempotencyKey.id)
        )).scalar_one_or_none()
        await s.commit()
        if row_id is not None:
            return "new", row_id
        row = (await s.execute(
            select(IdempotencyKey).where(IdempotencyKey.actor_id == actor_id, IdempotencyKey.key == key)
        )).scalar_one_or_none()
    if row is None:                       # released by its failing first request a moment ago: claim again
        if _attempt >= 3:
            return "busy", None
        return await claim(actor_id, key, method, path, hashed, _attempt + 1)
    if row.request_hash != hashed:
        return "different", None
    if row.completed_at is None:
        return "busy", None
    return "done", row


async def complete(row_id: int, status_code: int, body: object) -> None:
    async with core_db.SessionLocal() as s:
        await s.execute(update(IdempotencyKey).where(IdempotencyKey.id == row_id).values(
            status_code=status_code, response_json=body, completed_at=func.now()))
        await s.commit()


async def release(row_id: int) -> None:
    async with core_db.SessionLocal() as s:
        await s.execute(delete(IdempotencyKey).where(IdempotencyKey.id == row_id))
        await s.commit()


def _json_or_none(body: bytes):
    if not body:
        return None
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return None


class IdempotencyMiddleware:
    """Pure ASGI middleware (the request body is read once and handed on unchanged)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not applies(scope["method"], scope["path"]):
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        key = headers.get(HEADER)
        if key is None:
            return await self.app(scope, receive, send)
        actor_id = actor_of(headers.get("authorization"))
        if actor_id is None:
            return await self.app(scope, receive, send)
        key = key.strip()
        if not KEY_PATTERN.match(key):
            return await JSONResponse({"detail": BAD_KEY}, status_code=422)(scope, receive, send)

        chunks = []
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunks.append(message.get("body", b""))
            more = message.get("more_body", False)
        body = b"".join(chunks)
        hashed = request_hash(scope["method"], scope["path"], scope.get("query_string", b""), body,
                              headers.get("content-type"))

        state, found = await claim(actor_id, key, scope["method"], scope["path"], hashed)
        if state == "busy":
            return await JSONResponse({"detail": BUSY}, status_code=409)(scope, receive, send)
        if state == "different":
            return await JSONResponse({"detail": DIFFERENT}, status_code=422)(scope, receive, send)
        if state == "done":
            replay = JSONResponse(found.response_json, status_code=found.status_code, headers={REPLAY_HEADER: "true"})
            return await replay(scope, receive, send)

        row_id = found
        sent_body = False

        async def replay_receive():
            nonlocal sent_body
            if not sent_body:
                sent_body = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        started: dict = {}
        out = bytearray()

        async def capture(message):
            if message["type"] == "http.response.start":
                started.update(message)
            elif message["type"] == "http.response.body":
                out.extend(message.get("body", b""))

        try:
            await self.app(scope, replay_receive, capture)
        except BaseException:
            try:
                await release(row_id)
            except Exception:       # the key then simply expires after 24 hours
                pass
            raise
        status_code = started.get("status", 500)
        if 200 <= status_code < 300:
            await complete(row_id, status_code, _json_or_none(bytes(out)))
        else:
            await release(row_id)
        await send(started or {"type": "http.response.start", "status": status_code, "headers": []})
        await send({"type": "http.response.body", "body": bytes(out), "more_body": False})
