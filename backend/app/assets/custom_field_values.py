"""Validates an Asset.custom_fields JSON blob against active CustomField
definitions (app.masters.models.CustomField) before it's written.

AM-02: CustomField definitions and Asset.custom_fields (a JSON dict keyed by
field_key) already existed but nothing validated one against the other --
AM-00's audit found this was a fully dead feature (a master with zero
consumers). This is the smallest robust fix: no new table, no new concept --
the existing JSON blob already prevents a duplicate value for one field on
one asset by construction (it's a dict; a key can't repeat), and the
existing CustomField.field_key is already the stable identifier that
survives a `label` rename, so nothing about history-safety needed building
either. What was missing was purely the write-time validation.
"""
from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.masters.models import CustomField


async def validate_custom_field_values(session: AsyncSession, values: dict | None) -> None:
    """Raises ValueError (the same convention app.assets.service already uses for
    other create-time validation problems -- the router turns it into a 422) if
    `values` (an Asset.custom_fields-shaped dict) references an unknown or
    inactive field, or holds a value of the wrong type for its field's
    field_type. A `None` value for a known field is always allowed (means "not
    set yet").

    Deliberately does NOT enforce CustomField.is_required -- see the AM-02
    report's §11: nothing in the UI writes custom field values yet, so turning
    that on now would break every existing Add Asset / import call. Enforcing
    required fields is explicitly deferred to whichever future stage wires
    Custom Fields into the Add Asset screen.
    """
    if not values:
        return

    stmt = select(CustomField).where(
        CustomField.field_key.in_(values.keys()), CustomField.is_active.is_(True),
    )
    defs = {f.field_key: f for f in (await session.execute(stmt)).scalars().all()}

    for key, value in values.items():
        field = defs.get(key)
        if field is None:
            raise ValueError(f"unknown or inactive custom field '{key}'")
        if value is None:
            continue

        if field.field_type == "text":
            if not isinstance(value, str):
                raise ValueError(f"custom field '{key}' must be text")
        elif field.field_type == "number":
            # bool is a subclass of int in Python -- exclude it explicitly, a
            # checkbox value must never silently pass as a number.
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"custom field '{key}' must be a number")
        elif field.field_type == "date":
            if not isinstance(value, str):
                raise ValueError(f"custom field '{key}' must be a date string (YYYY-MM-DD)")
            try:
                date.fromisoformat(value)
            except ValueError:
                raise ValueError(f"custom field '{key}' must be a valid date (YYYY-MM-DD)")
        elif field.field_type == "checkbox":
            if not isinstance(value, bool):
                raise ValueError(f"custom field '{key}' must be true or false")
        elif field.field_type == "dropdown":
            if not isinstance(value, str):
                raise ValueError(f"custom field '{key}' must be text")
            # Convention (new, since `options` had no defined shape before this):
            # {"choices": ["A", "B", ...]}. A dropdown field with no `options` set
            # yet accepts any string -- there's nothing to validate against.
            choices = (field.options or {}).get("choices") if isinstance(field.options, dict) else None
            if choices and value not in choices:
                raise ValueError(f"custom field '{key}' must be one of {choices}")
