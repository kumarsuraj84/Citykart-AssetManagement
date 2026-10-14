"""Retention of the log tables (a daily job in the application's background loop).

error_log, system_event and client_report rows older than LOG_RETENTION_DAYS (default 180) are deleted;
CRITICAL errors and REVIEWED client reports are kept twice as long. Every run writes a system_event.

audit_log is NEVER purged by this job. Archiving it is a deliberate, separate step: export the period
(GET /api/admin/logs/export?kind=audit&from=&to=), keep the file, then -- with a role allowed to execute
it -- run the guarded database function in one transaction:

    BEGIN; SET LOCAL ckam.allow_audit_purge = 'on'; SELECT ckam_purge_audit_log('2025-01-01'); COMMIT;

`purge_audit_log_before` below wraps exactly that for a future archive tool; nothing in the application
calls it."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, or_, text

from app.core import db as core_db
from app.core.config import settings
from app.observability import context, writer
from app.observability.models import ClientReport, ErrorLog, SystemEvent

logger = logging.getLogger("ckam.retention")
FIRST_RUN_AFTER_SECONDS = 300
EVERY_SECONDS = 24 * 3600


async def purge_old_logs(now: datetime | None = None, days: int | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    days = settings.log_retention_days if days is None else days
    cutoff = now - timedelta(days=days)
    long_cutoff = now - timedelta(days=2 * days)
    async with core_db.SessionLocal() as session:
        errors = (await session.execute(delete(ErrorLog).where(or_(
            and_(ErrorLog.level != "CRITICAL", ErrorLog.at < cutoff),
            and_(ErrorLog.level == "CRITICAL", ErrorLog.at < long_cutoff),
        )))).rowcount
        events = (await session.execute(delete(SystemEvent).where(SystemEvent.at < cutoff))).rowcount
        reports = (await session.execute(delete(ClientReport).where(or_(
            and_(ClientReport.status != "REVIEWED", ClientReport.at < cutoff),
            and_(ClientReport.status == "REVIEWED", ClientReport.at < long_cutoff),
        )))).rowcount
        await session.commit()
    result = {"error_log": errors or 0, "system_event": events or 0, "client_report": reports or 0,
              "retention_days": days, "cutoff": cutoff.isoformat()}
    await writer.system("retention", "purge_finished",
                        f"Old log rows removed: {result['error_log']} errors, {result['system_event']} system events, "
                        f"{result['client_report']} client reports (older than {days} days).", details=result)
    return result


async def purge_audit_log_before(session, before: datetime) -> int:
    """Deletes audit_log rows older than `before` through the guarded database function, in the caller's
    transaction (the caller commits). Refused by the database unless `before` is at least a day old.
    UNUSED by the application -- for a future archive tool, after the rows have been exported."""
    await session.execute(text("SET LOCAL ckam.allow_audit_purge = 'on'"))
    return (await session.execute(text("SELECT ckam_purge_audit_log(:before)"), {"before": before})).scalar_one()


async def retention_loop(stop: asyncio.Event) -> None:
    """Runs the purge a few minutes after start, then once a day. Never raises."""
    delay = FIRST_RUN_AFTER_SECONDS
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
            return
        except asyncio.TimeoutError:
            pass
        with context.job("retention"):
            try:
                await purge_old_logs()
            except Exception as exc:
                logger.exception("Log retention failed")
                await writer.exception(exc, source="job")
                await writer.system("retention", "purge_failed", f"The daily log purge failed ({type(exc).__name__}).",
                                    level="ERROR")
        delay = EVERY_SECONDS
