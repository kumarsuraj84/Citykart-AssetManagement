"""Diagnostics for the head-office admin: database health, application health, and the diagnostics BUNDLE
(everything an engineer -- or Claude -- needs to understand a problem, redacted, with a ready-to-paste
Markdown version).

Every pg_stat_* query runs on its own and is allowed to fail: the application's database role is not a
superuser in production, so a view it may not read is reported as "not permitted" instead of failing the
whole answer."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.core import db as core_db
from app.core.config import settings
from app.observability import filelog, sqltiming, system
from app.observability.models import AuditLog, ClientReport, ErrorLog, SystemEvent
from app.observability.redact import json_safe, redact, redact_sql, redact_text

LONG_QUERY_SECONDS = 30
KEY_TABLES = ("company", "location", "asset_user", "vendor", "item", "item_map", "asset", "asset_event",
              "asset_field_change", "purchase_order", "pending_asset", "asset_document", "erp_po_line", "erp_sync_run",
              "audit_log", "error_log", "system_event", "client_report")
MARKDOWN_LIMIT = 200_000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _denied(exc: Exception) -> str:
    pg = getattr(getattr(exc, "orig", None), "__cause__", None) or getattr(exc, "orig", None)
    code = getattr(pg, "sqlstate", None) or getattr(pg, "pgcode", None)
    if code == "42501" or "permission denied" in str(exc).lower() or "must be superuser" in str(exc).lower():
        return "not permitted"
    return f"failed ({type(exc).__name__})"


async def _query(conn, sql: str, params: dict | None = None):
    """Rows as dicts, or the string "not permitted" / "failed (...)" (the transaction is reset either way)."""
    try:
        result = await conn.execute(text(sql), params or {})
        rows = [dict(r._mapping) for r in result.fetchall()]
        await conn.commit()
        return [{k: json_safe(v) for k, v in row.items()} for row in rows]
    except (DBAPIError, Exception) as exc:      # noqa: BLE001 -- any refusal becomes a word, never an error
        try:
            await conn.rollback()
        except Exception:
            pass
        return _denied(exc)


async def db_diagnostics() -> dict:
    out: dict = {"checked_at": _now().isoformat()}
    started = time.perf_counter()
    try:
        async with core_db.engine.connect() as conn:
            await conn.execute(text("SET statement_timeout = '5s'"))
            await conn.commit()
            await conn.execute(text("select 1"))
            await conn.commit()
            out["connected"] = True
            out["latency_ms"] = round((time.perf_counter() - started) * 1000, 1)
            version = await _query(conn, "show server_version")
            out["server_version"] = version[0]["server_version"] if isinstance(version, list) and version else version
            out["database"] = await _query(conn, "select current_database() as name, current_user as role, "
                                                 "pg_size_pretty(pg_database_size(current_database())) as size, "
                                                 "pg_database_size(current_database()) as size_bytes, "
                                                 "pg_is_in_recovery() as is_replica")
            out["connections_by_state"] = await _query(
                conn, "select coalesce(state, 'background') as state, count(*) as connections from pg_stat_activity "
                      "where datname = current_database() group by 1 order by 2 desc")
            long_running = await _query(
                conn, "select pid, usename as role, state, wait_event_type, "
                      "round(extract(epoch from now() - query_start)::numeric, 1) as seconds, left(query, 500) as query "
                      "from pg_stat_activity where datname = current_database() and state <> 'idle' "
                      "and pid <> pg_backend_pid() and query_start < now() - make_interval(secs => :secs) "
                      "order by query_start limit 20", {"secs": LONG_QUERY_SECONDS})
            if isinstance(long_running, list):
                for row in long_running:
                    row["query"] = redact_sql(row.get("query") or "", 500)
            out["long_running_queries"] = long_running
            blocked = await _query(
                conn, "select pid, pg_blocking_pids(pid) as blocked_by, wait_event_type, wait_event, "
                      "round(extract(epoch from now() - query_start)::numeric, 1) as seconds, left(query, 300) as query "
                      "from pg_stat_activity where datname = current_database() "
                      "and cardinality(pg_blocking_pids(pid)) > 0 limit 20")
            if isinstance(blocked, list):
                for row in blocked:
                    row["query"] = redact_sql(row.get("query") or "", 300)
            out["lock_waits"] = blocked
            out["largest_tables"] = await _query(
                conn, "select relname as table, pg_total_relation_size(relid) as bytes, "
                      "pg_size_pretty(pg_total_relation_size(relid)) as size, n_live_tup as live_rows "
                      "from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 10")
            out["dead_tuples_top"] = await _query(
                conn, "select relname as table, n_live_tup as live, n_dead_tup as dead, "
                      "round(n_dead_tup::numeric / greatest(n_live_tup + n_dead_tup, 1), 3) as dead_ratio, "
                      "last_autovacuum, last_vacuum from pg_stat_user_tables where n_dead_tup > 0 "
                      "order by n_dead_tup desc limit 10")
            out["replication"] = await _query(
                conn, "select client_addr::text as client, state, sync_state, "
                      "extract(epoch from replay_lag) as replay_lag_seconds from pg_stat_replication")
            out["replica_lag_seconds"] = await _query(
                conn, "select case when pg_is_in_recovery() then "
                      "extract(epoch from now() - pg_last_xact_replay_timestamp()) end as seconds")
            settings_rows = await _query(
                conn, "select name, setting, unit from pg_settings where name in ('log_min_duration_statement', "
                      "'log_lock_waits', 'deadlock_timeout', 'log_checkpoints', 'log_connections', 'log_line_prefix', "
                      "'log_temp_files', 'logging_collector', 'log_directory', 'max_connections', 'statement_timeout') "
                      "order by name")
            out["logging_settings"] = settings_rows
            if isinstance(settings_rows, list):
                value = next((r["setting"] for r in settings_rows if r["name"] == "log_min_duration_statement"), None)
                out["slow_statement_logging_on"] = value not in (None, "-1")
            await conn.execute(text("RESET statement_timeout"))
            await conn.commit()
    except Exception as exc:
        out["connected"] = False
        out["error"] = redact_text(f"{type(exc).__name__}: {exc}", 500)
    return out


async def table_counts(tables=KEY_TABLES) -> dict:
    counts: dict = {}
    try:
        async with core_db.engine.connect() as conn:
            for table in tables:
                rows = await _query(conn, f'select count(*) as n from "{table}"')
                counts[table] = rows[0]["n"] if isinstance(rows, list) and rows else rows
    except Exception as exc:
        counts["error"] = f"{type(exc).__name__}"
    return counts


async def erp_sync_status(limit: int = 5) -> dict:
    try:
        async with core_db.engine.connect() as conn:
            runs = await _query(conn, "select id, started_at, finished_at, status, trigger, message, po_lines_new, "
                                      "po_lines_changed, po_lines_gone, vendors, items from erp_sync_run "
                                      "order by id desc limit :n", {"n": limit})
            ok = await _query(conn, "select max(finished_at) as at from erp_sync_run where status = 'success'")
    except Exception as exc:
        return {"error": type(exc).__name__}
    last_ok = ok[0]["at"] if isinstance(ok, list) and ok else None
    age = None
    if last_ok:
        try:
            age = round((_now() - datetime.fromisoformat(last_ok)).total_seconds() / 60, 1)
        except ValueError:
            age = None
    if isinstance(runs, list):
        for run in runs:
            run["message"] = redact_text(run.get("message"), 500)
    return {"configured": bool(settings.po_source_host and settings.po_source_db), "enabled": settings.erp_sync_enabled,
            "last_success_at": last_ok, "minutes_since_last_success": age, "recent_runs": runs}


async def health() -> dict:
    checks: dict = {}
    started = time.perf_counter()
    try:
        async with core_db.engine.connect() as conn:
            await conn.execute(text("select 1"))
        checks["database"] = {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
    except Exception as exc:
        checks["database"] = {"ok": False, "error": type(exc).__name__}
    checks["log_dir"] = {"ok": filelog.writable_now(), "path": filelog.directory(), "problem": filelog.problem()}
    migration = await system.migration_state()
    checks["migrations"] = {"ok": bool(migration["matches"]), **migration}
    erp = await erp_sync_status(1)
    erp_ok = (not erp.get("configured") or not erp.get("enabled")
              or (erp.get("minutes_since_last_success") is not None and erp["minutes_since_last_success"] < 48 * 60))
    checks["erp_sync"] = {"ok": bool(erp_ok), "configured": erp.get("configured"),
                          "minutes_since_last_success": erp.get("minutes_since_last_success")}
    checks["table_counts"] = await table_counts(("asset", "purchase_order", "asset_user", "audit_log", "error_log"))
    status = "ok" if all(c.get("ok", True) for c in checks.values() if isinstance(c, dict) and "ok" in c) else "degraded"
    return {"status": status, "version": system.app_version(), "environment": settings.environment_name,
            "checked_at": _now().isoformat(), "checks": checks}


# ------------------------------------------------------------------ the bundle

def _row(obj, fields: tuple[str, ...]) -> dict:
    return {f: json_safe(getattr(obj, f, None)) for f in fields}


AUDIT_FIELDS = ("id", "at", "request_id", "source", "actor_id", "actor_code", "actor_name", "actor_role",
                "is_head_office_admin", "company_id", "ip", "category", "action", "entity", "entity_id", "summary",
                "changes", "outcome")
ERROR_FIELDS = ("id", "at", "request_id", "level", "source", "kind", "exception_type", "message", "stack", "route",
                "method", "status_code", "actor_id", "actor_code", "ip", "user_agent", "context", "fingerprint")
SYSTEM_FIELDS = ("id", "at", "level", "component", "event", "message", "details", "request_id")
CLIENT_FIELDS = ("id", "at", "request_id", "reference", "actor_id", "actor_code", "route", "app_version",
                 "user_agent", "kind", "message", "stack", "breadcrumbs", "recent_requests", "note", "status",
                 "fingerprint", "reviewed_by", "reviewed_at")


async def error_groups(session, since: datetime | None = None, limit: int = 20, offset: int = 0,
                       filters: list | None = None, with_stack: bool = False) -> tuple[list[dict], int]:
    from sqlalchemy import Text
    from sqlalchemy.dialects.postgresql import ARRAY, aggregate_order_by

    def latest(col):
        return func.array_agg(aggregate_order_by(col, ErrorLog.at.desc(), ErrorLog.id.desc()), type_=ARRAY(Text))[1]

    conditions = list(filters or [])
    if since is not None:
        conditions.append(ErrorLog.at >= since)
    key = func.coalesce(ErrorLog.fingerprint, func.concat("id:", ErrorLog.id))
    stmt = (
        select(
            key.label("fingerprint"),
            latest(ErrorLog.exception_type).label("exception_type"),
            latest(ErrorLog.message).label("message"),
            latest(ErrorLog.level).label("level"),
            latest(ErrorLog.kind).label("kind"),
            func.count().label("count"),
            func.min(ErrorLog.at).label("first_seen"),
            func.max(ErrorLog.at).label("last_seen"),
            latest(ErrorLog.request_id).label("last_request_id"),
            latest(ErrorLog.route).label("sample_route"),
            *( [latest(ErrorLog.stack).label("stack")] if with_stack else [] ),
        )
        .where(*conditions)
        .group_by(key)
    )
    total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await session.execute(stmt.order_by(func.max(ErrorLog.at).desc()).limit(limit).offset(offset))).all()
    return [{k: json_safe(v) for k, v in r._mapping.items()} for r in rows], total


async def correlate(session, request_id: str) -> dict:
    """Everything that carries one request id: audit rows (security ones apart), errors, system events,
    client reports, and the matching access-log lines of the current log files."""
    audit_rows = (await session.execute(
        select(AuditLog).where(AuditLog.request_id == request_id).order_by(AuditLog.id))).scalars().all()
    errors = (await session.execute(
        select(ErrorLog).where(ErrorLog.request_id == request_id).order_by(ErrorLog.id))).scalars().all()
    events = (await session.execute(
        select(SystemEvent).where(SystemEvent.request_id == request_id).order_by(SystemEvent.id))).scalars().all()
    reports = (await session.execute(
        select(ClientReport).where((ClientReport.request_id == request_id) | (ClientReport.reference == request_id))
        .order_by(ClientReport.id))).scalars().all()
    found_lines = await asyncio.to_thread(filelog.find_lines, "app.jsonl", request_id, 2, 50)   # file reading off the loop
    access = [line for line in found_lines if line.get("request_id") == request_id and line.get("kind") == "access"]
    return {
        "request_id": request_id,
        "audit": [_row(a, AUDIT_FIELDS) for a in audit_rows if a.category != "SECURITY"],
        "security": [_row(a, AUDIT_FIELDS) for a in audit_rows if a.category == "SECURITY"],
        "errors": [_row(e, ERROR_FIELDS) for e in errors],
        "system": [_row(s, SYSTEM_FIELDS) for s in events],
        "client_reports": [_row(c, CLIENT_FIELDS) for c in reports],
        "access_log": redact(access),
        "found": bool(audit_rows or errors or events or reports or access),
    }


async def bundle(session, hours: int = 24, request_id: str | None = None) -> dict:
    since = _now() - timedelta(hours=hours)
    groups, _ = await error_groups(session, since, limit=20, with_stack=True)
    for group in groups:
        group["stack"] = redact_text(group.get("stack"), 4000)
    security = (await session.execute(
        select(AuditLog).where(AuditLog.category == "SECURITY", AuditLog.at >= since)
        .order_by(AuditLog.id.desc()).limit(30))).scalars().all()
    events = (await session.execute(
        select(SystemEvent).where(SystemEvent.at >= since).order_by(SystemEvent.id.desc()).limit(30))).scalars().all()
    reports = (await session.execute(
        select(ClientReport).where(ClientReport.status == "NEW").order_by(ClientReport.id.desc()).limit(20)
    )).scalars().all()
    slow_routes = (await session.execute(
        select(ErrorLog.route, func.count().label("count"), func.max(ErrorLog.at).label("last"))
        .where(ErrorLog.kind == "slow_request", ErrorLog.at >= since)
        .group_by(ErrorLog.route).order_by(func.count().desc()).limit(10))).all()
    slow_sql = (await session.execute(
        select(func.count()).select_from(ErrorLog).where(ErrorLog.kind == "slow_sql", ErrorLog.at >= since))).scalar_one()
    db = await db_diagnostics()
    data = {
        "generated_at": _now().isoformat(),
        "period_hours": hours,
        "app": {"version": system.app_version(), "environment": settings.environment_name,
                "packages": system.package_versions()},
        "migration": await system.migration_state(),
        "config": system.safe_config(),
        "erp_sync": await erp_sync_status(5),
        "database": {k: db.get(k) for k in ("connected", "latency_ms", "server_version", "database",
                                            "connections_by_state", "long_running_queries", "lock_waits",
                                            "dead_tuples_top", "slow_statement_logging_on", "error")},
        "table_counts": await table_counts(),
        "error_groups": groups,
        "security_events": [_row(a, AUDIT_FIELDS) for a in security],
        "system_events": [_row(s, SYSTEM_FIELDS) for s in events],
        "new_client_reports": [_row(c, CLIENT_FIELDS) for c in reports],
        "slow": {"slow_requests_by_route": [{"route": r.route, "count": r.count, "last": json_safe(r.last)}
                                            for r in slow_routes],
                 "slow_sql_rows": slow_sql,
                 "recent_slow_sql_this_process": list(sqltiming.RECENT_SLOW)[-10:]},
    }
    if request_id:
        data["request"] = await correlate(session, request_id)
    data = redact(data, 4000)
    data["markdown"] = to_markdown(data)
    return data


def _md_json(value) -> str:
    return "```json\n" + json.dumps(value, indent=1, default=str, ensure_ascii=False)[:20000] + "\n```"


def to_markdown(data: dict) -> str:
    """The bundle as one Markdown text to paste into a chat ("here is the diagnostics bundle, the user
    reported X")."""
    lines: list[str] = []
    add = lines.append
    app = data.get("app") or {}
    add(f"# CKAM diagnostics bundle ({data.get('generated_at')})")
    add("")
    add(f"- Version: `{app.get('version')}`, environment: **{app.get('environment')}**, last {data.get('period_hours')} hours")
    mig = data.get("migration") or {}
    add(f"- Migrations: code `{mig.get('code_head')}`, database `{mig.get('db_head')}` "
        f"({'match' if mig.get('matches') else 'MISMATCH'})")
    db = data.get("database") or {}
    add(f"- Database: connected={db.get('connected')}, latency {db.get('latency_ms')} ms, server {db.get('server_version')}")
    erp = data.get("erp_sync") or {}
    add(f"- ERP copy: configured={erp.get('configured')}, last success {erp.get('last_success_at')} "
        f"({erp.get('minutes_since_last_success')} minutes ago)")
    pk = app.get("packages") or {}
    add("- Packages: " + ", ".join(f"{k} {v}" for k, v in pk.items() if v))
    add("")
    if data.get("request"):
        req = data["request"]
        add(f"## Request {req.get('request_id')}")
        for part in ("access_log", "audit", "security", "errors", "system", "client_reports"):
            if req.get(part):
                add(f"### {part.replace('_', ' ').title()}")
                add(_md_json(req[part]))
        add("")
    add("## Error groups (newest first)")
    groups = data.get("error_groups") or []
    if not groups:
        add("None in this period.")
    for g in groups:
        add(f"### {g.get('exception_type') or g.get('kind')} x{g.get('count')} on `{g.get('sample_route')}`")
        add(f"- message: {g.get('message')}")
        add(f"- first {g.get('first_seen')}, last {g.get('last_seen')}, last request `{g.get('last_request_id')}`, "
            f"fingerprint `{(g.get('fingerprint') or '')[:12]}`")
        if g.get("stack"):
            add("```\n" + str(g["stack"])[:4000] + "\n```")
    add("")
    add("## Security events")
    for a in data.get("security_events") or []:
        add(f"- {a.get('at')} {a.get('action')} ({a.get('outcome')}): {a.get('summary')} [req `{a.get('request_id')}`]")
    add("")
    add("## System events")
    for s in data.get("system_events") or []:
        add(f"- {s.get('at')} {s.get('level')} {s.get('component')}/{s.get('event')}: {s.get('message')}")
    add("")
    add("## New client reports")
    for c in data.get("new_client_reports") or []:
        add(f"- {c.get('at')} {c.get('kind')} on `{c.get('route')}` by {c.get('actor_code')}: {c.get('message')} "
            f"(ref `{c.get('reference')}`)")
    add("")
    slow = data.get("slow") or {}
    add("## Slow requests / SQL")
    for r in slow.get("slow_requests_by_route") or []:
        add(f"- {r.get('route')}: {r.get('count')} slow (last {r.get('last')})")
    add(f"- slow SQL rows: {slow.get('slow_sql_rows')}")
    add("")
    add("## Database")
    add(_md_json(db))
    add("## Table counts")
    add(_md_json(data.get("table_counts")))
    add("## Configuration (no secrets)")
    add(_md_json(data.get("config")))
    text_out = "\n".join(lines)
    if len(text_out) > MARKDOWN_LIMIT:
        text_out = text_out[:MARKDOWN_LIMIT] + "\n\n(cut: the bundle was too long)"
    return redact_text(text_out, MARKDOWN_LIMIT + 100)
