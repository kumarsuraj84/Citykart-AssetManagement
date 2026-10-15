"""Security N1: a request body is refused once it is bigger than the endpoint could ever use.

In the single-port production setup there is no nginx in front, so nothing stopped a 256 MB body to
POST /api/auth/login from being read in full before it was refused (the process grew to 650 MB+). This pure-ASGI
middleware answers 413 straight away when Content-Length is over the limit, and counts the bytes of a chunked body
(no Content-Length) and stops reading when the limit is passed. Limits: sign-in / password endpoints 64 KB, file
uploads (multipart) 16 MB, everything else 5 MB of JSON. The nginx of the Docker setup allows 11 MB; the Excel
import reader allows 15 MB (app.core.uploads), so uploads stay possible.
"""
from __future__ import annotations

import json

from starlette.exceptions import HTTPException

from app.observability import context as obs_context

AUTH_MAX_BYTES = 64 * 1024
JSON_MAX_BYTES = 5 * 1024 * 1024
UPLOAD_MAX_BYTES = 16 * 1024 * 1024
METHODS_WITH_BODY = {"POST", "PUT", "PATCH", "DELETE"}


def _message(limit: int) -> str:
    size = f"{limit // (1024 * 1024)} MB" if limit >= 1024 * 1024 else f"{limit // 1024} KB"
    return f"This request is larger than the {size} allowed here. Send a smaller one."


class _TooLarge(HTTPException):
    """Raised from the body reader: inside the app it is turned into the usual envelope by the exception handlers
    (FastAPI turns any OTHER exception during body reading into a 400); outside it, __call__ below answers it."""

    def __init__(self, limit: int):
        super().__init__(status_code=413, detail=_message(limit))


def limit_for(path: str, content_type: str) -> int:
    if path.startswith("/api/auth/"):
        return AUTH_MAX_BYTES
    if content_type.startswith("multipart/"):
        return UPLOAD_MAX_BYTES
    return JSON_MAX_BYTES


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in METHODS_WITH_BODY:
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        limit = limit_for(scope.get("path", ""), headers.get("content-type", "").lower())
        declared = headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > limit:
                    return await self._refuse(send, limit)
            except ValueError:
                return await self._refuse(send, limit)

        seen = 0
        started = False

        async def counting_receive():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise _TooLarge(limit)
            return message

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _TooLarge:
            if not started:
                await self._refuse(send, limit)

    @staticmethod
    async def _refuse(send, limit: int) -> None:
        detail = _message(limit)
        body: dict = {"detail": detail, "errors": [{"message": detail}]}
        rid = obs_context.request_id()
        if rid:
            body["request_id"] = rid
        raw = json.dumps(body).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode()),
                                (b"connection", b"close")]})
        await send({"type": "http.response.body", "body": raw})
