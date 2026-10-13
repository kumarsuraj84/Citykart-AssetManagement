"""S3a-1: writes rows of the append-only `master_audit` trail.

Rows are only ever ADDED (never updated or deleted -- a database trigger
refuses both). They are added to the caller's session and committed together
with the change they describe, so a failed change leaves no audit row and a
change can never be saved without its audit row."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.masters.models import MasterAudit

MAX_VALUE = 1000


def _text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)[:MAX_VALUE]


def record(session: AsyncSession, *, entity: str, entity_id: int, actor_id: int,
           changes: dict[str, tuple]) -> int:
    """One row per field whose old and new values differ. `changes` maps a
    field name to (old, new). Returns the number of rows added."""
    added = 0
    for field, (old, new) in changes.items():
        old_text, new_text = _text(old), _text(new)
        if old_text == new_text:
            continue
        session.add(MasterAudit(entity=entity, entity_id=entity_id, field=field,
                                old_value=old_text, new_value=new_text, actor_id=actor_id))
        added += 1
    return added
