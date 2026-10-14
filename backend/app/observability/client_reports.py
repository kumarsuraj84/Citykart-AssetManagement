"""S8: POST /api/client-reports -- the browser reports a problem (a JavaScript error, a failed API call, or
the person's own "Report a problem").

Any signed-in person. The server redacts everything (secrets by key and by pattern), cuts it to 64 KB in
all, counts one identical report (same fingerprint) per person and minute only once (the second one gets
the first one's id back), and refuses more than 30 reports per person and minute (429). The answer is
`{id, reference, duplicate}`: `reference` is the id the person can quote (it finds the report under
Logs > by request)."""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core.deps import get_current_asset_user
from app.observability import context, writer
from app.observability.redact import redact, redact_text

router = APIRouter(prefix="/api/client-reports", tags=["client-reports"])

MAX_TOTAL_BYTES = 64 * 1024
MAX_REQUEST_BYTES = 512 * 1024
RATE_PER_MINUTE = 30
DEDUPE_SECONDS = 60
TOO_MANY = "You have sent many problem reports in the last minute. Wait a minute and try again."

_sent: dict[int, list[float]] = {}
_recent: dict[tuple[int, str], tuple[float, int, str]] = {}


def reset_limits() -> None:
    _sent.clear()
    _recent.clear()


class ClientReportIn(BaseModel):
    kind: Literal["JS_ERROR", "API_ERROR", "USER_REPORT"]
    message: str = Field(default="", max_length=20000)
    stack: str | None = Field(default=None, max_length=200000)
    route: str | None = Field(default=None, max_length=2000)
    app_version: str | None = Field(default=None, max_length=200)
    breadcrumbs: list[Any] = Field(default_factory=list, max_length=500)
    recent_requests: list[Any] = Field(default_factory=list, max_length=200)
    note: str | None = Field(default=None, max_length=20000)
    request_id: str | None = Field(default=None, max_length=64)


def _clean(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    return redact_text(text.replace("\x00", ""), limit)


def _size(value) -> int:
    return len(json.dumps(value, default=str, ensure_ascii=False).encode("utf-8"))


def _fit(row: dict) -> dict:
    """Cuts the report to MAX_TOTAL_BYTES: the long parts go first (oldest breadcrumbs / requests, then the
    stack, then the note)."""
    while _size(row) > MAX_TOTAL_BYTES and row["breadcrumbs"]:
        row["breadcrumbs"] = row["breadcrumbs"][len(row["breadcrumbs"]) // 2 + 1:] if len(row["breadcrumbs"]) > 1 else []
    while _size(row) > MAX_TOTAL_BYTES and row["recent_requests"]:
        row["recent_requests"] = row["recent_requests"][len(row["recent_requests"]) // 2 + 1:] \
            if len(row["recent_requests"]) > 1 else []
    for key, floor in (("stack", 2000), ("note", 2000), ("message", 1000), ("stack", 0), ("note", 0)):
        excess = _size(row) - MAX_TOTAL_BYTES
        if excess <= 0:
            break
        value = row.get(key) or ""
        keep = max(floor, len(value) - excess - 100)
        row[key] = value[:keep] + ("... (cut)" if keep < len(value) else "") if value else value
    return row


def fingerprint(kind: str, message: str | None, route: str | None, stack: str | None) -> str:
    top = next((line.strip() for line in (stack or "").splitlines() if line.strip()), "")
    return hashlib.sha1(f"{kind}|{(message or '')[:300]}|{route or ''}|{top[:200]}".encode("utf-8")).hexdigest()


@router.post("", status_code=201)
async def report_problem(body: ClientReportIn, request: Request, user=Depends(get_current_asset_user)):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_REQUEST_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The report is too large.")
    now = time.monotonic()
    window = [t for t in _sent.get(user.id, []) if now - t < 60]
    if len(window) >= RATE_PER_MINUTE:
        _sent[user.id] = window
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY)
    window.append(now)
    _sent[user.id] = window

    ctx = context.current()
    reference = ctx.request_id if ctx else context.new_request_id()
    message = _clean(body.message, 4000) or ""
    stack = _clean(body.stack, 30000)
    route = _clean(body.route, 500)
    fp = fingerprint(body.kind, message, route, stack)
    key = (user.id, fp)
    seen = _recent.get(key)
    if seen is not None and now - seen[0] < DEDUPE_SECONDS:
        return JSONResponse({"id": seen[1], "reference": seen[2], "duplicate": True}, status_code=200)

    row = _fit({
        "request_id": (body.request_id or "").strip() or reference,
        "reference": reference,
        "actor_id": user.id,
        "actor_code": user.code or user.name,
        "route": route,
        "app_version": _clean(body.app_version, 100),
        "user_agent": _clean(request.headers.get("user-agent"), 300),
        "kind": body.kind,
        "message": message,
        "stack": stack,
        "breadcrumbs": redact(body.breadcrumbs[-100:], 1000),
        "recent_requests": redact(body.recent_requests[-50:], 1000),
        "note": _clean(body.note, 4000),
        "status": "NEW",
        "fingerprint": fp,
    })
    new_id = await writer.client_report(row)
    if new_id is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "The report could not be saved right now. Try again in a moment.")
    _recent[key] = (now, new_id, reference)
    if len(_recent) > 5000:
        for old_key in [k for k, v in _recent.items() if now - v[0] > DEDUPE_SECONDS]:
            _recent.pop(old_key, None)
    return {"id": new_id, "reference": reference, "duplicate": False}
