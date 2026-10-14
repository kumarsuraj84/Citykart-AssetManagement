"""S8: the head-office admin's Logs and Diagnostics API. Head-office admin (Primary Owner) only: anyone else
gets a plain 403. Every use is itself written to the audit trail (ACCESS / EXPORT).

GET   /api/admin/logs/audit                      audit rows (filters, paging, newest first, X-Total-Count)
GET   /api/admin/logs/errors                     error rows, or `group=true` for groups by fingerprint
GET   /api/admin/logs/system                     system events
GET   /api/admin/logs/client-reports             problems reported by browsers
PATCH /api/admin/logs/client-reports/{id}        status NEW <-> REVIEWED
GET   /api/admin/logs/entity/{entity}/{id}       the audit history of one record
GET   /api/admin/logs/request/{request_id}       everything that carries one request id
GET   /api/admin/logs/export                     kind=audit|errors|system|client, format=jsonl|csv (<= 100,000 rows)
GET   /api/admin/diagnostics/bundle              the diagnostics bundle (JSON + `markdown`)
GET   /api/admin/diagnostics/db                  database health
GET   /api/admin/diagnostics/health              application health"""
from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import db as core_db
from app.core.db import get_session
from app.core.deps import require_primary_owner
from app.core.validation import escape_like
from app.observability import diagnostics, events, writer
from app.observability.diagnostics import AUDIT_FIELDS, CLIENT_FIELDS, ERROR_FIELDS, SYSTEM_FIELDS, _row
from app.observability.models import (
    AUDIT_CATEGORIES, AUDIT_OUTCOMES, CLIENT_REPORT_STATUSES, AuditLog, ClientReport, ErrorLog, SystemEvent,
)
from app.observability.redact import json_safe, redact

router = APIRouter(prefix="/api/admin", tags=["admin-logs"])

MAX_PAGE = 200
EXPORT_CAP = 100_000
EXPORT_BATCH = 2000
KINDS = {
    "audit": (AuditLog, AUDIT_FIELDS),
    "errors": (ErrorLog, ERROR_FIELDS),
    "system": (SystemEvent, SYSTEM_FIELDS),
    "client": (ClientReport, CLIENT_FIELDS),
}


def _when(value: str | None, end: bool = False) -> datetime | None:
    """`from` / `to`: a date (2026-10-14; `to` then means the whole day) or a date-time (ISO 8601)."""
    if value is None or not value.strip():
        return None
    text = value.strip()
    try:
        if len(text) == 10:
            day = date.fromisoformat(text)
            moment = datetime.combine(day, time.min, tzinfo=timezone.utc)
            return moment + timedelta(days=1) if end else moment
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Dates must look like 2026-10-14 or 2026-10-14T09:30:00.")


def _period(model, start: str | None, end: str | None) -> list:
    conditions = []
    s, e = _when(start), _when(end, end=True)
    if s is not None:
        conditions.append(model.at >= s)
    if e is not None:
        conditions.append(model.at < e)
    return conditions


def _like(text: str) -> str:
    return f"%{escape_like(text.strip())}%"


async def _page(session, model, conditions, fields, limit, offset, response) -> list[dict]:
    total = (await session.execute(select(func.count()).select_from(model).where(*conditions))).scalar_one()
    rows = (await session.execute(
        select(model).where(*conditions).order_by(model.at.desc(), model.id.desc()).limit(limit).offset(offset)
    )).scalars().all()
    response.headers["X-Total-Count"] = str(total)
    return [_row(r, fields) for r in rows]


async def _viewed(what: str, filters: dict) -> None:
    clean = {k: json_safe(v) for k, v in filters.items() if v not in (None, "", False)}
    await writer.access("LOGS_VIEWED", f"{events.who()} looked at {what}.", changes={"view": what, "filters": clean or None})


def _audit_conditions(start, end, actor_id, entity, entity_id, category, action, outcome, request_id, q) -> list:
    conditions = _period(AuditLog, start, end)
    if actor_id is not None:
        conditions.append(AuditLog.actor_id == actor_id)
    if entity:
        conditions.append(AuditLog.entity == entity.strip())
    if entity_id:
        conditions.append(AuditLog.entity_id == entity_id.strip())
    if category:
        wanted = category.strip().upper()
        if wanted not in AUDIT_CATEGORIES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"Choose a category: {', '.join(c.lower() for c in AUDIT_CATEGORIES)}.")
        conditions.append(AuditLog.category == wanted)
    if action:
        conditions.append(AuditLog.action == action.strip().upper())
    if outcome:
        wanted = outcome.strip().upper()
        if wanted not in AUDIT_OUTCOMES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose an outcome: ok, denied or failed.")
        conditions.append(AuditLog.outcome == wanted)
    if request_id:
        conditions.append(AuditLog.request_id == request_id.strip())
    if q and q.strip():
        pattern = _like(q)
        conditions.append(or_(AuditLog.summary.ilike(pattern, escape="\\"), AuditLog.actor_name.ilike(pattern, escape="\\"),
                              AuditLog.actor_code.ilike(pattern, escape="\\"), AuditLog.entity_id.ilike(pattern, escape="\\"),
                              AuditLog.request_id.ilike(pattern, escape="\\")))
    return conditions


@router.get("/logs/audit")
async def list_audit(
    response: Response,
    start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
    actor_id: int | None = None, entity: str | None = Query(None, max_length=50),
    entity_id: str | None = Query(None, max_length=100), category: str | None = Query(None, max_length=20),
    action: str | None = Query(None, max_length=60), outcome: str | None = Query(None, max_length=10),
    request_id: str | None = Query(None, max_length=64), q: str | None = Query(None, max_length=200),
    limit: int = Query(50, ge=1, le=MAX_PAGE), offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session), _owner=Depends(require_primary_owner()),
):
    conditions = _audit_conditions(start, end, actor_id, entity, entity_id, category, action, outcome, request_id, q)
    rows = await _page(session, AuditLog, conditions, AUDIT_FIELDS, limit, offset, response)
    await _viewed("the audit trail", {"from": start, "to": end, "actor_id": actor_id, "entity": entity,
                                      "entity_id": entity_id, "category": category, "action": action,
                                      "outcome": outcome, "request_id": request_id, "q": q})
    return rows


def _error_conditions(start, end, level, source, kind, fingerprint, request_id, route, q) -> list:
    conditions = _period(ErrorLog, start, end)
    if level:
        conditions.append(ErrorLog.level == level.strip().upper())
    if source:
        conditions.append(ErrorLog.source == source.strip().lower())
    if kind:
        conditions.append(ErrorLog.kind == kind.strip().lower())
    if fingerprint:
        conditions.append(ErrorLog.fingerprint == fingerprint.strip())
    if request_id:
        conditions.append(ErrorLog.request_id == request_id.strip())
    if route:
        conditions.append(ErrorLog.route == route.strip())
    if q and q.strip():
        pattern = _like(q)
        conditions.append(or_(ErrorLog.message.ilike(pattern, escape="\\"),
                              ErrorLog.exception_type.ilike(pattern, escape="\\"),
                              ErrorLog.route.ilike(pattern, escape="\\")))
    return conditions


@router.get("/logs/errors")
async def list_errors(
    response: Response,
    start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
    level: str | None = Query(None, max_length=10), source: str | None = Query(None, max_length=10),
    kind: str | None = Query(None, max_length=30), fingerprint: str | None = Query(None, max_length=60),
    request_id: str | None = Query(None, max_length=64), route: str | None = Query(None, max_length=300),
    actor_id: int | None = None, q: str | None = Query(None, max_length=200), group: bool = False,
    limit: int = Query(50, ge=1, le=MAX_PAGE), offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session), _owner=Depends(require_primary_owner()),
):
    """`group=true`: one row per fingerprint {fingerprint, exception_type, message, level, kind, count,
    first_seen, last_seen, last_request_id, sample_route}, most recent first."""
    conditions = _error_conditions(start, end, level, source, kind, fingerprint, request_id, route, q)
    if actor_id is not None:
        conditions.append(ErrorLog.actor_id == actor_id)
    if group:
        rows, total = await diagnostics.error_groups(session, None, limit=limit, offset=offset, filters=conditions)
        response.headers["X-Total-Count"] = str(total)
    else:
        rows = await _page(session, ErrorLog, conditions, ERROR_FIELDS, limit, offset, response)
    await _viewed("the error log", {"from": start, "to": end, "level": level, "source": source, "kind": kind,
                                    "fingerprint": fingerprint, "request_id": request_id, "group": group, "q": q})
    return rows


@router.get("/logs/system")
async def list_system(
    response: Response,
    start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
    level: str | None = Query(None, max_length=10), component: str | None = Query(None, max_length=30),
    event: str | None = Query(None, max_length=60), request_id: str | None = Query(None, max_length=64),
    q: str | None = Query(None, max_length=200),
    limit: int = Query(50, ge=1, le=MAX_PAGE), offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session), _owner=Depends(require_primary_owner()),
):
    conditions = _period(SystemEvent, start, end)
    if level:
        conditions.append(SystemEvent.level == level.strip().upper())
    if component:
        conditions.append(SystemEvent.component == component.strip().lower())
    if event:
        conditions.append(SystemEvent.event == event.strip())
    if request_id:
        conditions.append(SystemEvent.request_id == request_id.strip())
    if q and q.strip():
        conditions.append(SystemEvent.message.ilike(_like(q), escape="\\"))
    rows = await _page(session, SystemEvent, conditions, SYSTEM_FIELDS, limit, offset, response)
    await _viewed("the system events", {"from": start, "to": end, "level": level, "component": component,
                                        "event": event, "request_id": request_id, "q": q})
    return rows


@router.get("/logs/client-reports")
async def list_client_reports(
    response: Response,
    start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
    status_filter: str | None = Query(None, alias="status", max_length=10), kind: str | None = Query(None, max_length=20),
    actor_id: int | None = None, request_id: str | None = Query(None, max_length=64),
    q: str | None = Query(None, max_length=200),
    limit: int = Query(50, ge=1, le=MAX_PAGE), offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session), _owner=Depends(require_primary_owner()),
):
    conditions = _period(ClientReport, start, end)
    if status_filter:
        wanted = status_filter.strip().upper()
        if wanted not in CLIENT_REPORT_STATUSES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a status: new or reviewed.")
        conditions.append(ClientReport.status == wanted)
    if kind:
        conditions.append(ClientReport.kind == kind.strip().upper())
    if actor_id is not None:
        conditions.append(ClientReport.actor_id == actor_id)
    if request_id:
        conditions.append(or_(ClientReport.request_id == request_id.strip(), ClientReport.reference == request_id.strip()))
    if q and q.strip():
        pattern = _like(q)
        conditions.append(or_(ClientReport.message.ilike(pattern, escape="\\"), ClientReport.note.ilike(pattern, escape="\\"),
                              ClientReport.route.ilike(pattern, escape="\\")))
    rows = await _page(session, ClientReport, conditions, CLIENT_FIELDS, limit, offset, response)
    await _viewed("the client reports", {"from": start, "to": end, "status": status_filter, "kind": kind,
                                         "actor_id": actor_id, "q": q})
    return rows


class ClientReportStatusIn(BaseModel):
    status: Literal["NEW", "REVIEWED", "new", "reviewed"]


@router.patch("/logs/client-reports/{report_id}")
async def set_client_report_status(
    report_id: int, body: ClientReportStatusIn, session: AsyncSession = Depends(get_session),
    owner=Depends(require_primary_owner()),
):
    report = await session.get(ClientReport, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This report was not found.")
    old = report.status
    report.status = body.status.upper()
    report.reviewed_by = owner.id if report.status == "REVIEWED" else None
    report.reviewed_at = datetime.now(timezone.utc) if report.status == "REVIEWED" else None
    await session.commit()
    await session.refresh(report)
    await writer.access("CLIENT_REPORT_STATUS", f"{events.who()} marked client report #{report.id} as "
                        f"{report.status.lower()}.", entity="client_report", entity_id=report.id,
                        changes={"status": {"old": old, "new": report.status}})
    return _row(report, CLIENT_FIELDS)


@router.get("/logs/entity/{entity}/{entity_id}")
async def entity_history(
    entity: str, entity_id: str, response: Response,
    limit: int = Query(100, ge=1, le=MAX_PAGE), offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session), _owner=Depends(require_primary_owner()),
):
    """The audit history of one record (e.g. /entity/vendor/12, /entity/asset_user/5), newest first: every
    DATA change and every SECURITY / ACCESS / LIFECYCLE row that names it."""
    conditions = [AuditLog.entity == entity.strip(), AuditLog.entity_id == entity_id.strip()]
    rows = await _page(session, AuditLog, conditions, AUDIT_FIELDS, limit, offset, response)
    await _viewed(f"the history of {entity} {entity_id}", {"entity": entity, "entity_id": entity_id})
    return rows


@router.get("/logs/request/{request_id}")
async def by_request(
    request_id: str, session: AsyncSession = Depends(get_session), _owner=Depends(require_primary_owner()),
):
    """Everything that carries one request id: {request_id, found, audit, security, errors, system,
    client_reports, access_log}. A client report's `reference` is found here too."""
    if len(request_id) > 64:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A reference is at most 64 characters.")
    result = await diagnostics.correlate(session, request_id.strip())
    await _viewed(f"request {request_id}", {"request_id": request_id})
    return result


def _csv_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=str, ensure_ascii=False)
    text = str(value)
    # a cell starting with = + - @ is a formula in Excel: keep it text
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


@router.get("/logs/export")
async def export_logs(
    kind: Literal["audit", "errors", "system", "client"] = Query(...),
    start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
    format: Literal["jsonl", "csv"] = Query("jsonl"),
    session: AsyncSession = Depends(get_session), _owner=Depends(require_primary_owner()),
):
    """Streams the rows of one log for a period (oldest first), at most 100,000 (the header
    `X-Row-Count` says how many; `X-Truncated: true` when there were more). Redacted again on the way out.
    The export itself is an EXPORT audit row."""
    model, fields = KINDS[kind]
    conditions = _period(model, start, end)
    total = (await session.execute(select(func.count()).select_from(model).where(*conditions))).scalar_one()
    rows_out = min(total, EXPORT_CAP)
    await events.exported(f"the {kind} log", rows_out, {"from": start, "to": end, "format": format,
                                                        "truncated": total > EXPORT_CAP})

    async def generate():
        sent = 0
        last_id = 0
        if format == "csv":
            buf = io.StringIO()
            csv.writer(buf).writerow(fields)
            yield buf.getvalue()
        async with core_db.SessionLocal() as s:
            while sent < rows_out:
                batch = (await s.execute(
                    select(model).where(*conditions, model.id > last_id).order_by(model.id)
                    .limit(min(EXPORT_BATCH, rows_out - sent))
                )).scalars().all()
                if not batch:
                    break
                buf = io.StringIO()
                out = csv.writer(buf) if format == "csv" else None
                for obj in batch:
                    data = redact(_row(obj, fields), 20000)
                    if out is not None:
                        out.writerow([_csv_value(data.get(f)) for f in fields])
                    else:
                        buf.write(json.dumps(data, default=str, ensure_ascii=False) + "\n")
                last_id = batch[-1].id
                sent += len(batch)
                yield buf.getvalue()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    media = "text/csv; charset=utf-8" if format == "csv" else "application/x-ndjson"
    return StreamingResponse(generate(), media_type=media, headers={
        "Content-Disposition": f"attachment; filename=ckam-{kind}-log-{stamp}.{format}",
        "X-Row-Count": str(rows_out), "X-Truncated": "true" if total > EXPORT_CAP else "false",
    })


@router.get("/diagnostics/bundle")
async def diagnostics_bundle(
    hours: int = Query(24, ge=1, le=24 * 30), request_id: str | None = Query(None, max_length=64),
    session: AsyncSession = Depends(get_session), _owner=Depends(require_primary_owner()),
):
    """Everything needed to understand a problem, redacted: version, migration state, safe config, ERP copy,
    database health, table counts, the last 20 error groups with stacks, security and system events, new
    client reports, slow requests / SQL, and (with `request_id`) that request's whole story. `markdown` is
    the same as one text to paste into a chat."""
    result = await diagnostics.bundle(session, hours=hours, request_id=request_id)
    await writer.access("DIAGNOSTICS_BUNDLE", f"{events.who()} made a diagnostics bundle ({hours} hours"
                        + (f", request {request_id}" if request_id else "") + ").",
                        changes={"hours": hours, "request_id": request_id})
    return result


@router.get("/diagnostics/db")
async def diagnostics_db(_owner=Depends(require_primary_owner())):
    result = await diagnostics.db_diagnostics()
    await writer.access("DIAGNOSTICS_VIEWED", f"{events.who()} looked at the database diagnostics.",
                        changes={"view": "db"})
    return result


@router.get("/diagnostics/health")
async def diagnostics_health(_owner=Depends(require_primary_owner())):
    result = await diagnostics.health()
    await writer.access("DIAGNOSTICS_VIEWED", f"{events.who()} looked at the application health.",
                        changes={"view": "health"})
    return result
