"""S8 log tables (migration e6f8a0b2c4d6). None of them has a foreign key: a log row must never block,
or be blocked by, the business rows it talks about (and they outlive them). These tables are never part
of the automatic data audit themselves (app.observability.audit.LOG_TABLES)."""
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

AUDIT_CATEGORIES = ("DATA", "SECURITY", "ACCESS", "IMPORT", "EXPORT", "ERP", "LIFECYCLE", "SYSTEM")
AUDIT_OUTCOMES = ("OK", "DENIED", "FAILED")
SOURCES = ("api", "job", "script")
ERROR_LEVELS = ("ERROR", "WARNING", "CRITICAL")
ERROR_SOURCES = ("api", "db", "job", "client")
SYSTEM_COMPONENTS = ("startup", "shutdown", "migration", "erp_sync", "backup", "scheduler", "db", "retention", "config")
CLIENT_REPORT_KINDS = ("JS_ERROR", "API_ERROR", "USER_REPORT")
CLIENT_REPORT_STATUSES = ("NEW", "REVIEWED")


class AuditLog(Base):
    """Who did what to which record, when, from where, under which request id. APPEND-ONLY: a database
    trigger refuses UPDATE and DELETE (DELETE only inside the guarded archive function
    ckam_purge_audit_log, see the migration)."""
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_at", "at"),
        Index("ix_audit_log_entity", "entity", "entity_id"),
        Index("ix_audit_log_actor", "actor_id"),
        Index("ix_audit_log_request", "request_id"),
        Index("ix_audit_log_category_at", "category", "at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    request_id: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, default="api", server_default="api")
    actor_id: Mapped[int | None] = mapped_column(BigInteger)
    actor_code: Mapped[str | None] = mapped_column(Text)
    actor_name: Mapped[str | None] = mapped_column(Text)
    actor_role: Mapped[str | None] = mapped_column(Text)
    is_head_office_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    company_id: Mapped[int | None] = mapped_column(BigInteger)
    ip: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    entity: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    changes: Mapped[object | None] = mapped_column(JSONB)
    outcome: Mapped[str] = mapped_column(Text, default="OK", server_default="OK")


class ErrorLog(Base):
    """Unexpected errors (with a redacted stack and request context), database errors, slow requests and
    slow SQL. Grouped by `fingerprint`."""
    __tablename__ = "error_log"
    __table_args__ = (
        Index("ix_error_log_at", "at"),
        Index("ix_error_log_fingerprint", "fingerprint"),
        Index("ix_error_log_request", "request_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    request_id: Mapped[str | None] = mapped_column(Text)
    level: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, default="exception", server_default="exception")
    exception_type: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text)
    stack: Mapped[str | None] = mapped_column(Text)
    route: Mapped[str | None] = mapped_column(Text)
    method: Mapped[str | None] = mapped_column(Text)
    status_code: Mapped[int | None] = mapped_column(Integer)
    actor_id: Mapped[int | None] = mapped_column(BigInteger)
    actor_code: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    context: Mapped[object | None] = mapped_column(JSONB)
    fingerprint: Mapped[str | None] = mapped_column(Text)


class SystemEvent(Base):
    """What the application itself did: start / stop, ERP copies, purges, migration mismatches, log
    directory and database problems, background-loop failures."""
    __tablename__ = "system_event"
    __table_args__ = (
        Index("ix_system_event_at", "at"),
        Index("ix_system_event_component_at", "component", "at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    level: Mapped[str] = mapped_column(Text, default="INFO", server_default="INFO")
    component: Mapped[str] = mapped_column(Text)
    event: Mapped[str] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text)
    details: Mapped[object | None] = mapped_column(JSONB)
    request_id: Mapped[str | None] = mapped_column(Text)


class ClientReport(Base):
    """A problem reported by the browser: a JavaScript error, a failed API call, or a person's own report
    ("Report a problem"). `reference` is the id the person can quote (the request id of the report)."""
    __tablename__ = "client_report"
    __table_args__ = (
        Index("ix_client_report_at", "at"),
        Index("ix_client_report_request", "request_id"),
        Index("ix_client_report_reference", "reference"),
        Index("ix_client_report_fingerprint", "fingerprint"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    request_id: Mapped[str | None] = mapped_column(Text)
    reference: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[int | None] = mapped_column(BigInteger)
    actor_code: Mapped[str | None] = mapped_column(Text)
    route: Mapped[str | None] = mapped_column(Text)
    app_version: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text)
    stack: Mapped[str | None] = mapped_column(Text)
    breadcrumbs: Mapped[object | None] = mapped_column(JSONB)
    recent_requests: Mapped[object | None] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="NEW", server_default="NEW")
    fingerprint: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[int | None] = mapped_column(BigInteger)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
