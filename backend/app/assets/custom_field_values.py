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

AM-04: adds `enforce_required`. Add Asset (backend `procure_assets`) is now
the first real UI consumer of Custom Fields, so `CustomField.is_required`
needs a real enforcement point -- but only on CREATE unconditionally. An
existing asset predating a newly-added required field must not be blocked
from an unrelated edit (e.g. fixing a typo'd serial number) just because it
has no value for that field yet; `PUT /api/assets/{id}` only enforces
completeness when the edit request itself includes `custom_fields` (i.e.
the caller is intentionally replacing the custom-field set), matching this
codebase's existing full-replace-on-PUT convention.
"""
from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.masters.models import CustomField


async def validate_custom_field_values(
    session: AsyncSession, values: dict | None, *, enforce_required: bool = False,
) -> None:
    """Raises ValueError (the same convention app.assets.service already uses for
    other create-time validation problems -- the router turns it into a 422) if
    `values` (an Asset.custom_fields-shaped dict) references an unknown or
    inactive field, or holds a value of the wrong type for its field's
    field_type. A `None` value for a known field is always allowed (means "not
    set yet") unless `enforce_required` is set and that field is required.

    `enforce_required=True` additionally checks every currently-active
    `CustomField` with `is_required=True` has a non-None value in `values` --
    the caller decides when that check applies (always on create; only when
    `custom_fields` was explicitly part of the request, on update).
    """
    values = values or {}

    # Fetch every active definition, not just the submitted keys: enforce_required
    # needs to know about required fields the caller didn't even mention, and the
    # per-field custom-field master is expected to stay small (this is UDF
    # functionality, not a low-code platform with hundreds of fields).
    stmt = select(CustomField).where(CustomField.is_active.is_(True))
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

    if enforce_required:
        missing = [key for key, field in defs.items() if field.is_required and values.get(key) is None]
        if missing:
            raise ValueError(f"missing required custom field(s): {', '.join(sorted(missing))}")
