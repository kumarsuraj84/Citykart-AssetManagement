"""Counts and times every SQL statement of the running request / job (SQLAlchemy engine events), and
reports statements slower than LOG_SLOW_SQL_MS: a WARNING line in app.jsonl / error.jsonl at once (the
statement with its literal values replaced by ?), and -- for requests -- a throttled WARNING row in
error_log (kind 'slow_sql') written by the middleware when the request ends."""
from __future__ import annotations

import logging
import time
from collections import deque

from sqlalchemy import event

from app.core.config import settings
from app.observability import context
from app.observability.redact import redact_sql

logger = logging.getLogger("ckam.sql")
_KEY = "ckam_query_start"
RECENT_SLOW: deque = deque(maxlen=100)       # the latest slow statements of this process (diagnostics)


def _before(conn, _cursor, _statement, _parameters, _context, _executemany):
    conn.info.setdefault(_KEY, []).append(time.perf_counter())


def _after(conn, _cursor, statement, _parameters, _context, executemany):
    try:
        starts = conn.info.get(_KEY)
        if not starts:
            return
        elapsed_ms = (time.perf_counter() - starts.pop()) * 1000
        ctx = context.current()
        if ctx is not None:
            ctx.sql_count += 1
            ctx.sql_ms += elapsed_ms
        threshold = settings.log_slow_sql_ms
        if threshold and elapsed_ms > threshold:
            text = redact_sql(statement, 2000)
            entry = {"statement": text, "duration_ms": round(elapsed_ms, 1), "executemany": bool(executemany),
                     "request_id": ctx.request_id if ctx else None,
                     "route": (ctx.route or ctx.path) if ctx else None,
                     "at": time.time()}
            RECENT_SLOW.append(entry)
            if ctx is not None:
                ctx.slow_sql.append(entry)
            logger.warning("Slow SQL statement (%.0f ms)", elapsed_ms,
                           extra={"fields": {"kind": "slow_sql", "duration_ms": round(elapsed_ms, 1), "statement": text}})
    except Exception:
        pass


def _failed(exception_context):
    try:
        conn = exception_context.connection
        starts = conn.info.get(_KEY) if conn is not None else None
        if starts:
            starts.pop()
    except Exception:
        pass


def install(engine) -> None:
    sync_engine = getattr(engine, "sync_engine", engine)
    if not event.contains(sync_engine, "before_cursor_execute", _before):
        event.listen(sync_engine, "before_cursor_execute", _before)
        event.listen(sync_engine, "after_cursor_execute", _after)
        event.listen(sync_engine, "handle_error", _failed)
