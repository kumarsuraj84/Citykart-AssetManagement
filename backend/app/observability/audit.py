"""The DATA audit trail, written in the SAME transaction as the change it describes (a rolled-back request
leaves no audit row; a committed change always has its row).

1. AUTOMATIC: SQLAlchemy session events record every ORM insert / update / soft delete (is_active
   true -> false, deleted_at set) / delete of the business and configuration tables in SPECS -- one
   `audit_log` row per record with only the changed fields as {old, new} (sensitive fields "***", long
   text cut) and a sentence a person can read ("Vendor 'ARIHANT INFOCOM LLP' updated: name, gstin.").
   `after_flush` reads the changes (ids are known there, history is still intact) and inserts the rows
   with ONE statement on the flush's own connection -- same transaction, same flush.
2. EXPLICIT: `record(session, ...)` adds one summary row for an action (a receipt of 100 units is ONE
   RECEIVE row with counts and ids, not 100 rows). Bulk paths call `suppress(session, "asset", ...)` first,
   so the per-record automatic rows of that request are not written.

Never audited automatically: the log tables themselves, the ledgers that are already an audit trail
(asset_event, asset_field_change, master_audit, purchase_order_erp_change), technical tables (code_counter,
idempotency_key), the ERP copy (erp_* and erp_sync_run -- system_event covers the copies) and the
per-unit rows of POs (pending_asset: the PO actions write explicit rows). See
docs/ai/LOGGING_AND_DIAGNOSTICS.md, "How to add auditing for a new table or route"."""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import event, inspect as sa_inspect
from sqlalchemy.orm import Session

from app.observability import context, writer
from app.observability.models import AuditLog
from app.observability.redact import MASK, is_sensitive_key, json_safe, truncate

LOG_TABLES = frozenset({"audit_log", "error_log", "system_event", "client_report"})
# Tables whose rows are not business changes at all (not counted as writes for the coverage check).
TECHNICAL_TABLES = frozenset({"code_counter", "idempotency_key", "erp_sync_run", "erp_po_line", "erp_vendor",
                              "erp_site", "erp_item", "alembic_version"})
ALWAYS_SKIPPED_FIELDS = frozenset({"created_at", "updated_at", "created_by", "updated_by"})
MAX_VALUE_TEXT = 300


@dataclass(frozen=True)
class EntitySpec:
    entity: str                     # the name in audit_log.entity
    word: str                       # how a person calls it
    label_fields: tuple[str, ...]   # the first non-empty one names the record in the summary
    skip_fields: frozenset = field(default_factory=frozenset)


SPECS: dict[str, EntitySpec] = {spec_table: spec for spec_table, spec in (
    ("company", EntitySpec("company", "Company", ("name", "code"))),
    ("location", EntitySpec("location", "Location", ("name", "code"))),
    ("department", EntitySpec("department", "Department", ("name",))),
    ("cost_center", EntitySpec("cost_center", "Cost centre", ("name", "code"))),
    ("asset_category", EntitySpec("category", "Category", ("name", "code"))),
    ("asset_subcategory", EntitySpec("subcategory", "Sub-category", ("name", "code"))),
    ("brand", EntitySpec("brand", "Brand", ("name", "code"))),
    ("vendor", EntitySpec("vendor", "Vendor", ("name", "code"))),
    ("vendor_erp_link", EntitySpec("vendor_erp_link", "Vendor ERP link", ("erp_vendor_code",))),
    ("custom_field", EntitySpec("custom_field", "Custom field", ("label", "field_key"))),
    ("code_rule", EntitySpec("code_rule", "Code rule", ("prefix_template",))),
    ("item", EntitySpec("item", "Item", ("name",))),
    ("item_map", EntitySpec("item_map", "Item link rule", ("erp_item_code", "name_key", "article_key", "level_key",
                                                           "article_name"))),
    ("bundle", EntitySpec("bundle", "Set", ("name",))),
    ("bundle_part", EntitySpec("bundle_part", "Set part", ("name",))),
    ("asset_user", EntitySpec("asset_user", "Person or place", ("name", "code"),
                              frozenset({"failed_login_count", "locked_until"}))),
    ("purchase_order", EntitySpec("purchase_order", "Purchase order", ("po_number",), frozenset({"erp_synced_at"}))),
    ("purchase_order_erp_baseline", EntitySpec("purchase_order_erp_baseline", "ERP baseline of a PO item", ("item_code",))),
    ("asset_document", EntitySpec("asset_document", "Document", ("file_name",), frozenset({"stored_path"}))),
    # header level only; status / holder / status_since are the lifecycle ledger's (asset_event)
    ("asset", EntitySpec("asset", "Asset", ("asset_code",),
                         frozenset({"status", "current_asset_user_id", "status_since"}))),
    ("app_setting", EntitySpec("app_setting", "Setting", ("key",))),
)}

_FLUSHED = "ckam_audit_flushed"
_SUPPRESS = "ckam_audit_suppress"
_OFF = "ckam_audit_off"


# ------------------------------------------------------------------ explicit API

def record(session, category: str, action: str, summary: str, *, entity: str | None = None, entity_id=None,
           changes=None, outcome: str = "OK", company_id: int | None = None) -> None:
    """One audit row in the caller's transaction (committed or rolled back with the change)."""
    row = writer.audit_row(category, action, summary, entity=entity, entity_id=entity_id, changes=changes,
                           outcome=outcome, company_id=company_id)
    session.add(AuditLog(**row))


def suppress(session, *entities: str) -> None:
    """No automatic per-record rows for these entities in this session (a bulk action writes one summary)."""
    session.info.setdefault(_SUPPRESS, set()).update(entities)


def disable(session) -> None:
    """No automatic rows at all in this session (maintenance scripts)."""
    session.info[_OFF] = True


ids_preview = writer.ids_preview


# ------------------------------------------------------------------ helpers

def _value(key: str, value):
    if is_sensitive_key(key) or key == "password_hash":
        return MASK if value not in (None, "") else value
    value = json_safe(value)
    if isinstance(value, str):
        return truncate(value, MAX_VALUE_TEXT)
    if isinstance(value, (dict, list)):
        text = str(value)
        return value if len(text) <= MAX_VALUE_TEXT * 3 else truncate(text, MAX_VALUE_TEXT)
    return value


def _label(spec: EntitySpec, values: dict) -> str | None:
    if spec.entity == "asset_user":
        name, code = values.get("name"), values.get("code")
        if name and code:
            return f"{name} ({code})"
        return name or code
    for key in spec.label_fields:
        value = values.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def _summary(spec: EntitySpec, label: str | None, entity_id, verb: str, fields: list[str] | None = None) -> str:
    who = f"{spec.word} '{label}'" if label else f"{spec.word} #{entity_id}"
    text = f"{who} {verb}"
    if fields:
        shown = fields[:12]
        text += ": " + ", ".join(shown) + (f" and {len(fields) - 12} more" if len(fields) > 12 else "")
    return text + "."


def _pk(state) -> str | None:
    identity = state.identity
    if identity is None:
        mapper = state.mapper
        identity = tuple(state.dict.get(col.key) for col in mapper.primary_key)
    if not identity:
        return None
    return ":".join(str(part) for part in identity)


def _create_row(spec: EntitySpec, state) -> dict:
    values = state.dict
    snapshot = {}
    for attr in state.mapper.column_attrs:
        key = attr.key
        if key in ALWAYS_SKIPPED_FIELDS or key in spec.skip_fields or key == "id":
            continue
        value = values.get(key)
        if value is None or value == "" or value == {}:
            continue
        snapshot[key] = _value(key, value)
    entity_id = _pk(state)
    return writer.audit_row("DATA", "CREATE", _summary(spec, _label(spec, values), entity_id, "created"),
                            entity=spec.entity, entity_id=entity_id, changes=snapshot or None,
                            company_id=values.get("company_id"))


def _update_row(spec: EntitySpec, state) -> dict | None:
    changes: dict = {}
    for attr in state.mapper.column_attrs:
        key = attr.key
        if key in ALWAYS_SKIPPED_FIELDS or key in spec.skip_fields:
            continue
        history = state.attrs[key].history
        if not history.has_changes():
            continue
        old = history.deleted[0] if history.deleted else None
        new = history.added[0] if history.added else None
        if old == new:
            continue
        changes[key] = {"old": _value(key, old), "new": _value(key, new)}
    if not changes:
        return None
    values = state.dict
    action, verb = "UPDATE", "updated"
    active = changes.get("is_active")
    if active is not None and active["old"] is True and active["new"] is False:
        action, verb = "DEACTIVATE", "deactivated"
    elif active is not None and active["old"] is False and active["new"] is True:
        action, verb = "REACTIVATE", "made active again"
    elif "deleted_at" in changes and changes["deleted_at"]["old"] is None and changes["deleted_at"]["new"] is not None:
        action, verb = "DELETE", "deleted (kept as a deleted record)"
    fields = [k for k in changes if k not in ("is_active", "deleted_at")] if action != "UPDATE" else list(changes)
    entity_id = _pk(state)
    return writer.audit_row("DATA", action, _summary(spec, _label(spec, values), entity_id, verb, fields or None),
                            entity=spec.entity, entity_id=entity_id, changes=changes,
                            company_id=values.get("company_id"))


def _delete_row(spec: EntitySpec, state) -> dict:
    values = state.dict
    entity_id = _pk(state)
    snapshot = {k: _value(k, v) for k, v in values.items()
                if not k.startswith("_") and k not in ALWAYS_SKIPPED_FIELDS and k not in spec.skip_fields
                and isinstance(v, (str, int, float, bool)) and v not in (None, "")}
    return writer.audit_row("DATA", "DELETE", _summary(spec, _label(spec, values), entity_id, "removed"),
                            entity=spec.entity, entity_id=entity_id, changes=snapshot or None,
                            company_id=values.get("company_id"))


def _table(obj) -> str | None:
    table = getattr(obj, "__table__", None)
    return getattr(table, "name", None)


# ------------------------------------------------------------------ session events

def _after_flush(session: Session, _flush_context) -> None:
    try:
        ctx = context.current()
        if session.info.get(_OFF):
            return
        suppressed = session.info.get(_SUPPRESS) or ()
        pending: list[dict] = []
        flushed: list[dict] = session.info.setdefault(_FLUSHED, [])
        writes = 0
        for obj in session.new:
            table = _table(obj)
            if table == "audit_log":
                flushed.append({k: v for k, v in sa_inspect(obj).dict.items() if not k.startswith("_")})
                continue
            if table in LOG_TABLES or table in TECHNICAL_TABLES:
                continue
            writes += 1
            spec = SPECS.get(table)
            if spec is None or spec.entity in suppressed:
                continue
            pending.append(_create_row(spec, sa_inspect(obj)))
        for obj in session.dirty:
            table = _table(obj)
            if table in LOG_TABLES or table in TECHNICAL_TABLES:
                continue
            if not session.is_modified(obj, include_collections=False):
                continue
            writes += 1
            spec = SPECS.get(table)
            if spec is None or spec.entity in suppressed:
                continue
            row = _update_row(spec, sa_inspect(obj))
            if row is not None:
                pending.append(row)
        for obj in session.deleted:
            table = _table(obj)
            if table in LOG_TABLES or table in TECHNICAL_TABLES:
                continue
            writes += 1
            spec = SPECS.get(table)
            if spec is None or spec.entity in suppressed:
                continue
            pending.append(_delete_row(spec, sa_inspect(obj)))
        if ctx is not None:
            ctx.db_writes += writes
            ctx.audit_rows += sum(1 for obj in session.new if _table(obj) == "audit_log") + len(pending)
    except Exception as exc:                      # describing the change must never break the business write
        writer.report_failure("audit (after_flush)", exc)
        return
    if pending:
        # Same connection, same transaction, same flush: one INSERT for all rows of this flush. A failure
        # here fails the business write too -- a change is never saved without its audit row.
        session.connection().execute(AuditLog.__table__.insert(), pending)
        flushed.extend(pending)


def _after_commit(session: Session) -> None:
    flushed = session.info.pop(_FLUSHED, None)
    if flushed:
        writer.mirror_audit(flushed)


def _after_rollback(session: Session) -> None:
    session.info.pop(_FLUSHED, None)


def _do_orm_execute(state) -> None:
    """Bulk INSERT / UPDATE / DELETE statements (insert(Asset).returning(...), update(PendingAsset)...) are
    not seen by the flush events: they are counted as writes (for the coverage check) and audited by the
    explicit summary row of the action that ran them."""
    try:
        if not (state.is_insert or state.is_update or state.is_delete):
            return
        ctx = context.current()
        if ctx is None:
            return
        mapper = state.bind_mapper
        table = mapper.local_table.name if mapper is not None else None
        if table and table not in LOG_TABLES and table not in TECHNICAL_TABLES:
            ctx.db_writes += 1
    except Exception as exc:
        writer.report_failure("audit (orm execute)", exc)


_installed = {"done": False}


def install() -> None:
    if _installed["done"]:
        return
    event.listen(Session, "after_flush", _after_flush)
    event.listen(Session, "after_commit", _after_commit)
    event.listen(Session, "after_rollback", _after_rollback)
    event.listen(Session, "do_orm_execute", _do_orm_execute)
    _installed["done"] = True
