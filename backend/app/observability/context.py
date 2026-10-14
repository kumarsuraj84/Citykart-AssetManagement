"""The request id and the who / where / what of the running request or background job.

One `RequestContext` object per request (made by app.observability.middleware) or per background job run
(`job()` below), held in a context variable. Code that runs inside the request -- dependencies, routes,
services, SQLAlchemy events, logging -- reads it with `current()`. The object itself is shared and
mutable on purpose: the authenticated actor is filled in by app.core.deps after the middleware has made
the context, and the middleware reads it back when it writes the access line."""
from __future__ import annotations

import re
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field

REQUEST_ID_HEADER = "X-Request-ID"
_INCOMING_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


@dataclass
class RequestContext:
    request_id: str
    source: str = "api"                 # api | job | script
    method: str | None = None
    path: str | None = None
    route: str | None = None            # the route template, e.g. /api/assets/{asset_id}
    ip: str | None = None
    user_agent: str | None = None
    component: str | None = None        # for jobs: erp_sync, retention, ...
    actor_id: int | None = None
    actor_code: str | None = None
    actor_name: str | None = None
    actor_role: str | None = None
    is_head_office_admin: bool = False
    company_id: int | None = None
    started: float = field(default_factory=time.perf_counter)
    # filled while the request runs
    sql_count: int = 0
    sql_ms: float = 0.0
    slow_sql: list = field(default_factory=list)
    audit_rows: int = 0                 # audit_log rows written for this request (any session)
    db_writes: int = 0                  # business rows inserted / changed / deleted (audited or not)
    body_sample: bytes = b""            # the first 64 KB of the request body (for the redacted error context)
    body_size: int = 0
    content_type: str | None = None
    query_string: str = ""
    path_params: dict = field(default_factory=dict)


_current: ContextVar[RequestContext | None] = ContextVar("ckam_request_context", default=None)


def current() -> RequestContext | None:
    return _current.get()


def request_id() -> str | None:
    ctx = _current.get()
    return ctx.request_id if ctx is not None else None


def new_request_id() -> str:
    return uuid.uuid4().hex


def accept_incoming(value: str | None) -> str | None:
    """A well-formed incoming X-Request-ID (1-64 characters of A-Z a-z 0-9 . _ -), else None."""
    if value and _INCOMING_ID.match(value):
        return value
    return None


def set_actor(user) -> None:
    """Called once the request is authenticated (app.core.deps.get_current_asset_user, login)."""
    ctx = _current.get()
    if ctx is None or user is None:
        return
    ctx.actor_id = getattr(user, "id", None)
    ctx.actor_code = getattr(user, "code", None)
    ctx.actor_name = getattr(user, "name", None)
    ctx.actor_role = getattr(user, "role", None)
    ctx.is_head_office_admin = bool(getattr(user, "is_primary_owner", False))
    ctx.company_id = getattr(user, "company_id", None)


@contextmanager
def bind(ctx: RequestContext):
    token = _current.set(ctx)
    try:
        yield ctx
    finally:
        _current.reset(token)


def job_context(component: str) -> RequestContext:
    """A context for one run of a background job: its own id ("job-<component>-<hex>") as request id."""
    return RequestContext(request_id=f"job-{component}-{uuid.uuid4().hex[:12]}", source="job", component=component)


@contextmanager
def job(component: str):
    """`with job("erp_sync") as ctx:` -- everything logged / audited inside carries the job's id."""
    with bind(job_context(component)) as ctx:
        yield ctx
