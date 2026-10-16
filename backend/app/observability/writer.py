"""Security / access / error / system rows, written in their OWN short database session.

These rows must survive a request whose own transaction is rolled back (a failed login, a refused
request, an unexpected error), so they never use the request's session. Every function here swallows its
own failures: logging can never break or fail a request. A failure is reported to stderr and the error log on
its first occurrence and then at most once a minute with a running count while it repeats (CL2-IF-01), plus a
system_event row when the database still accepts one (and the row's line is still written to the log files)."""
from __future__ import annotations

import hashlib
import json
import logging
import sys
import time
import traceback
from urllib.parse import parse_qsl

from sqlalchemy import insert

from app.core import db as core_db
from app.observability import context, filelog
from app.observability.models import AuditLog, ClientReport, ErrorLog, SystemEvent
from app.observability.redact import MASK, is_sensitive_key, redact, redact_text

errors_logger = logging.getLogger("ckam.errors")
system_logger = logging.getLogger("ckam.system")

MAX_SUMMARY = 1000
MAX_MESSAGE = 4000
MAX_STACK = 20000
MAX_IDS = 200

# ------------------------------------------------------------------ throttling (one process)

_last_seen: dict[str, float] = {}


def allow(key: str, seconds: float = 60.0) -> bool:
    """True at most once per `seconds` for one key (in this process)."""
    now = time.monotonic()
    last = _last_seen.get(key)
    if last is not None and now - last < seconds:
        return False
    _last_seen[key] = now
    if len(_last_seen) > 20000:
        cutoff = now - 3600
        for k in [k for k, t in _last_seen.items() if t < cutoff]:
            _last_seen.pop(k, None)
    return True


def reset_throttles() -> None:
    _last_seen.clear()
    _failures.clear()


# ------------------------------------------------------------------ failure reporting

# CL2-IF-01 / CL2-IF-OBS-03: a failing log write used to be reported ONCE per process and then hidden, so an
# exhausted audit_log id sequence silently stopped the database audit trail. Now a repeating failure is reported
# again at most once per REPORT_EVERY_SECONDS with a running count (never silent, never a flood), to stderr AND the
# error log, and -- when the database still accepts it -- as a system_event row. Nothing here ever raises.
REPORT_EVERY_SECONDS = 60.0
_clock = time.monotonic                       # tests replace it to move time forward
_failures: dict[str, dict] = {}               # where -> {"total", "unreported", "last_report"}


def failure_counts() -> dict[str, int]:
    """Log-write failures per kind in this process (for diagnostics and tests)."""
    return {where: state["total"] for where, state in _failures.items()}


def reset_failure_reports() -> None:
    _failures.clear()


def report_failure(where: str, exc: BaseException) -> bool:
    """Counts a log-write failure; reports it on the first occurrence and then at most once per minute while it
    repeats. True when this call reported (the caller may also record a system_event)."""
    try:
        now = _clock()
        state = _failures.setdefault(where, {"total": 0, "unreported": 0, "last_report": None})
        state["total"] += 1
        state["unreported"] += 1
        last = state["last_report"]
        if last is not None and now - last < REPORT_EVERY_SECONDS:
            return False
        detail = f"{type(exc).__name__}: {redact_text(str(exc), 300)}"
        if last is None:
            message = (f"CKAM logging: could not write {where} ({detail}). Failure 1; while it continues it is "
                       f"reported again at most once a minute with a count.")
        else:
            message = (f"CKAM logging: could not write {where} ({detail}). {state['total']} failures so far, "
                       f"{state['unreported']} since the last report {int(now - last)} s ago.")
        state["last_report"] = now
        state["unreported"] = 0
        try:
            sys.stderr.write(message + "\n")
        except Exception:
            pass
        if where != "error.jsonl":                   # the error log itself is what failed: stderr only
            try:
                # Marked so the console handler does not print the same line on stderr a second time.
                errors_logger.error(message, extra={"fields": {"kind": "log_write_failed", "where": where,
                                                               "failures_total": state["total"]},
                                                    "ckam_stderr_done": True})
            except Exception:
                pass
        return True
    except Exception:
        return False


async def _record_failure_event(where: str) -> None:
    """A system_event row for a reported log-write failure, written directly (no logger: the line is already in
    stderr / the error log) and never for a failing system_event write itself (no loop)."""
    if where.startswith("system_event"):
        return
    try:
        total = _failures.get(where, {}).get("total", 0)
        row = {"level": "ERROR", "component": "logging", "event": "write_failed",
               "message": f"Could not write {where}: {total} failure(s) so far in this process.",
               "details": {"where": where, "failures_total": total}, "request_id": None}
        ctx = context.current()
        if ctx is not None:
            row["request_id"] = ctx.request_id
        await insert_rows(SystemEvent, [row], "system_event (logging failure)")
    except Exception:
        pass


async def insert_rows(model, rows: list[dict], where: str) -> bool:
    if not rows:
        return True
    try:
        async with core_db.SessionLocal() as session:
            await session.execute(insert(model), rows)
            await session.commit()
        return True
    except Exception as exc:
        if report_failure(where, exc):
            await _record_failure_event(where)
        return False


# ------------------------------------------------------------------ audit rows

def ids_preview(ids, limit: int = MAX_IDS) -> dict:
    ids = list(ids)
    return {"ids": ids[:limit], "total": len(ids)}


def actor_columns(actor=None) -> dict:
    """Who: the given actor (a user object or dict), else the request's authenticated actor."""
    ctx = context.current()
    if actor is None:
        if ctx is None:
            return {"actor_id": None, "actor_code": None, "actor_name": None, "actor_role": None,
                    "is_head_office_admin": False}
        return {"actor_id": ctx.actor_id, "actor_code": ctx.actor_code, "actor_name": ctx.actor_name,
                "actor_role": ctx.actor_role, "is_head_office_admin": bool(ctx.is_head_office_admin)}
    get = actor.get if isinstance(actor, dict) else (lambda k, d=None: getattr(actor, k, d))
    return {"actor_id": get("id"), "actor_code": get("code"), "actor_name": get("name"), "actor_role": get("role"),
            "is_head_office_admin": bool(get("is_primary_owner", False))}


def audit_row(category: str, action: str, summary: str, *, entity: str | None = None, entity_id=None,
              changes=None, outcome: str = "OK", company_id: int | None = None, actor=None) -> dict:
    ctx = context.current()
    if company_id is None:
        if actor is not None:
            company_id = actor.get("company_id") if isinstance(actor, dict) else getattr(actor, "company_id", None)
        elif ctx is not None:
            company_id = ctx.company_id
    row = {
        "request_id": ctx.request_id if ctx else None,
        "source": ctx.source if ctx else "script",
        **actor_columns(actor),
        "company_id": company_id,
        "ip": ctx.ip if ctx else None,
        "category": category,
        "action": action,
        "entity": entity,
        "entity_id": None if entity_id is None else str(entity_id)[:100],
        "summary": redact_text(summary, MAX_SUMMARY) or action,
        "changes": redact(changes) if changes is not None else None,
        "outcome": outcome,
    }
    return row


def mirror_audit(rows: list[dict]) -> None:
    """Writes audit rows to audit.jsonl (after they are committed)."""
    for row in rows:
        try:
            filelog.audit_logger.info("", extra={"fields": {k: v for k, v in row.items() if v is not None}})
        except Exception as exc:
            report_failure("audit.jsonl", exc)


def count_audit(n: int = 1) -> None:
    ctx = context.current()
    if ctx is not None:
        ctx.audit_rows += n


async def audit_now(category: str, action: str, summary: str, **kwargs) -> None:
    """An audit row in its own session (survives the request's rollback). For SECURITY / ACCESS / EXPORT /
    IMPORT events. `throttle=(key, seconds)` writes at most one row per key and period."""
    throttle = kwargs.pop("throttle", None)
    try:
        if throttle is not None and not allow(*throttle):
            return
        row = audit_row(category, action, summary, **kwargs)
        count_audit()
        mirror_audit([row])
        await insert_rows(AuditLog, [row], "audit_log")
    except Exception as exc:
        report_failure("audit_log (build)", exc)


async def security(action: str, summary: str, **kwargs) -> None:
    await audit_now(kwargs.pop("category", "SECURITY"), action, summary, **kwargs)


async def access(action: str, summary: str, **kwargs) -> None:
    await audit_now(kwargs.pop("category", "ACCESS"), action, summary, **kwargs)


# ------------------------------------------------------------------ errors

def top_app_frame(tb) -> str | None:
    """The innermost frame of CKAM's own code ("app/purchase_orders/receive.py:receive_goods"), without a
    line number so the fingerprint survives unrelated edits."""
    best = None
    for frame in traceback.extract_tb(tb) if tb is not None else []:
        name = frame.filename.replace("\\", "/")
        idx = name.rfind("/app/")
        if idx == -1 or "/app/observability/" in name[idx:]:
            continue
        best = f"{name[idx + 1:]}:{frame.name}"
    return best


def fingerprint(*parts) -> str:
    return hashlib.sha1("|".join(str(p or "") for p in parts).encode("utf-8")).hexdigest()


def _body_shape(ctx) -> dict | None:
    if ctx is None or not ctx.body_size:
        return None
    shape: dict = {"content_type": (ctx.content_type or "")[:100], "size": ctx.body_size}
    if (ctx.content_type or "").split(";")[0].strip().lower() == "application/json" and ctx.body_sample:
        try:
            data = json.loads(ctx.body_sample)
        except (ValueError, UnicodeDecodeError):
            shape["note"] = "not readable as JSON (or larger than 64 KB)"
            return shape
        if isinstance(data, dict):
            keys = {}
            for k, v in list(data.items())[:100]:
                if isinstance(v, (list, dict)):
                    info = {"type": type(v).__name__, "items": len(v)}
                elif isinstance(v, str):
                    info = {"type": "text", "length": len(v)}
                else:
                    info = {"type": type(v).__name__}
                if is_sensitive_key(k):
                    info = {"type": MASK}
                keys[str(k)[:100]] = info
            shape["keys"] = keys
        elif isinstance(data, list):
            shape["items"] = len(data)
    return shape


def request_snapshot(ctx=None) -> dict:
    """The redacted request context of an error: path parameters, query keys and values (sensitive ones
    masked), the body's keys and sizes (never its values)."""
    ctx = ctx or context.current()
    if ctx is None:
        return {}
    snap: dict = {}
    if ctx.path_params:
        snap["path_params"] = redact(ctx.path_params, 200)
    if ctx.query_string:
        pairs = parse_qsl(ctx.query_string, keep_blank_values=True)[:50]
        snap["query"] = redact({k: (MASK if is_sensitive_key(k) else v) for k, v in pairs}, 200)
    body = _body_shape(ctx)
    if body:
        snap["body"] = body
    if ctx.path:
        snap["path"] = redact_text(ctx.path, 300)
    return snap


def _error_row(level: str, source: str, kind: str, *, exception_type=None, message=None, stack=None,
               status_code=None, context_data=None, fp=None, ctx=None) -> dict:
    ctx = ctx or context.current()
    return {
        "request_id": ctx.request_id if ctx else None,
        "level": level,
        "source": source,
        "kind": kind,
        "exception_type": exception_type,
        "message": redact_text(message, MAX_MESSAGE),
        "stack": redact_text(stack, MAX_STACK) if stack else None,
        "route": (ctx.route or ctx.path) if ctx else None,
        "method": ctx.method if ctx else None,
        "status_code": status_code,
        "actor_id": ctx.actor_id if ctx else None,
        "actor_code": ctx.actor_code if ctx else None,
        "ip": ctx.ip if ctx else None,
        "user_agent": redact_text(ctx.user_agent, 300) if ctx and ctx.user_agent else None,
        "context": redact(context_data) if context_data else None,
        "fingerprint": fp,
    }


def _log_error_line(row: dict) -> None:
    level = {"CRITICAL": logging.CRITICAL, "ERROR": logging.ERROR}.get(row["level"], logging.WARNING)
    fields = {k: row[k] for k in ("kind", "source", "exception_type", "route", "method", "status_code",
                                  "fingerprint", "stack", "context") if row.get(k) is not None}
    if row.get("request_id"):
        fields["request_id"] = row["request_id"]
    try:
        errors_logger.log(level, row.get("message") or row.get("kind") or "error", extra={"fields": fields})
    except Exception as exc:
        report_failure("error.jsonl", exc)


async def error_row(row: dict) -> None:
    _log_error_line(row)
    await insert_rows(ErrorLog, [row], "error_log")


_db_state = {"down": False}
_DB_DOWN_TYPES = ("OperationalError", "InterfaceError", "ConnectionRefusedError", "ConnectionDoesNotExistError",
                  "CannotConnectNowError", "TooManyConnectionsError", "gaierror", "TimeoutError")


def _is_connection_problem(exc: BaseException) -> bool:
    seen = 0
    while exc is not None and seen < 5:
        if type(exc).__name__ in _DB_DOWN_TYPES:
            return True
        exc = getattr(exc, "orig", None) or exc.__cause__
        seen += 1
    return False


async def exception(exc: BaseException, *, level: str = "ERROR", source: str = "api", status_code: int | None = None,
                    kind: str = "exception", message: str | None = None) -> None:
    """An error_log row (and an error.jsonl line) for one exception, with its redacted stack and request
    context and a fingerprint that groups the same fault."""
    try:
        ctx = context.current()
        exc_type = type(exc).__name__
        stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        route = (ctx.route or ctx.path) if ctx else None
        fp = fingerprint(exc_type, top_app_frame(exc.__traceback__), route)
        if _is_connection_problem(exc):
            level = "CRITICAL"
            if not _db_state["down"]:
                _db_state["down"] = True
                await system("db", "connectivity_lost", "The database could not be reached.", level="CRITICAL",
                             details={"exception_type": exc_type, "message": redact_text(str(exc), 500)})
        row = _error_row(level, source, kind, exception_type=exc_type, message=message or str(exc) or exc_type,
                         stack=stack, status_code=status_code, context_data=request_snapshot(ctx), fp=fp, ctx=ctx)
        await error_row(row)
    except Exception as inner:
        report_failure("error_log (build)", inner)


async def warning(kind: str, message: str, *, fp: str | None = None, details: dict | None = None,
                  status_code: int | None = None, source: str = "api", throttle: tuple | None = None,
                  level: str = "WARNING") -> None:
    """A WARNING error_log row that is not an exception (slow request, slow SQL)."""
    try:
        if throttle is not None and not allow(*throttle):
            return
        row = _error_row(level, source, kind, message=message, status_code=status_code, context_data=details, fp=fp)
        await error_row(row)
    except Exception as exc:
        report_failure("error_log (warning)", exc)


async def note_db_ok() -> None:
    if _db_state["down"]:
        _db_state["down"] = False
        await system("db", "connectivity_restored", "The database can be reached again.")


# ------------------------------------------------------------------ system events

async def system(component: str, event: str, message: str, *, level: str = "INFO", details: dict | None = None) -> None:
    try:
        ctx = context.current()
        row = {
            "level": level, "component": component, "event": event,
            "message": redact_text(message, MAX_MESSAGE),
            "details": redact(details) if details else None,
            "request_id": ctx.request_id if ctx else None,
        }
        lvl = {"CRITICAL": logging.CRITICAL, "ERROR": logging.ERROR, "WARNING": logging.WARNING}.get(level, logging.INFO)
        try:
            system_logger.log(lvl, message, extra={"fields": {"component": component, "event": event,
                                                              "details": row["details"]}})
        except Exception as exc:
            report_failure("app.jsonl (system)", exc)
        await insert_rows(SystemEvent, [row], "system_event")
    except Exception as exc:
        report_failure("system_event (build)", exc)


async def client_report(row: dict) -> int | None:
    """Inserts one client report and returns its id (None if it could not be stored)."""
    try:
        async with core_db.SessionLocal() as session:
            new_id = (await session.execute(insert(ClientReport).values(**row).returning(ClientReport.id))).scalar_one()
            await session.commit()
            return new_id
    except Exception as exc:
        report_failure("client_report", exc)
        return None
