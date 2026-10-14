"""Shared helpers for the S8 logging / audit tests."""
import json
from pathlib import Path

from sqlalchemy import event, select

from app.core.db import SessionLocal, engine
from app.observability import filelog
from app.observability.models import AuditLog, ClientReport, ErrorLog, SystemEvent


async def rows(model, *conditions) -> list:
    async with SessionLocal() as s:
        return list((await s.execute(select(model).where(*conditions).order_by(model.id))).scalars().all())


async def audit(*conditions) -> list[AuditLog]:
    return await rows(AuditLog, *conditions)


async def audit_for(request_id: str) -> list[AuditLog]:
    return await audit(AuditLog.request_id == request_id)


async def errors(*conditions) -> list[ErrorLog]:
    return await rows(ErrorLog, *conditions)


async def system_events(*conditions) -> list[SystemEvent]:
    return await rows(SystemEvent, *conditions)


async def client_reports(*conditions) -> list[ClientReport]:
    return await rows(ClientReport, *conditions)


def as_text(items) -> str:
    """Every column of every row as one string (to search for secrets)."""
    out = []
    for obj in items:
        out.append(json.dumps({c.key: getattr(obj, c.key) for c in obj.__table__.columns}, default=str))
    return "\n".join(out)


async def everything_logged() -> str:
    """All four log tables and all log files, as one text."""
    parts = [as_text(await audit()), as_text(await errors()), as_text(await system_events()),
             as_text(await client_reports())]
    directory = filelog.directory()
    if directory:
        for path in Path(directory).glob("*.jsonl*"):
            parts.append(path.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(parts)


def log_lines(name: str) -> list[dict]:
    directory = filelog.directory()
    path = Path(directory) / name
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out


def flush_logs() -> None:
    import logging
    for name in ("ckam", "ckam.audit"):
        for handler in logging.getLogger(name).handlers:
            handler.flush()


class Statements:
    """Counts the SQL statements sent while active."""

    def __init__(self):
        self.count = 0
        self.sql: list[str] = []

    def __call__(self, conn, cursor, statement, *args):
        self.count += 1
        self.sql.append(statement)

    def __enter__(self):
        event.listen(engine.sync_engine, "before_cursor_execute", self)
        return self

    def __exit__(self, *exc):
        event.remove(engine.sync_engine, "before_cursor_execute", self)
