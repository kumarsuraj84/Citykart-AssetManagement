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

AM-05: Custom Fields can now be GLOBAL (`company_id IS NULL`) or scoped to
one company. `company_id` here is the ASSET's company -- the definition set
this validates against is only the "applicable" ones (§19 of the AM-05
authorization): every active GLOBAL field, plus every active field scoped
to this specific company. A field scoped to a different company is, from
this asset's point of view, indistinguishable from a field that doesn't
exist at all -- it can't be submitted, can't be required, can't block
anything, for an asset it was never scoped to. This is also what closes
the AM-04-discovered operational risk (a required field created for one
company used to block every company).
"""
from datetime import date
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.masters.models import CustomField


async def applicable_custom_fields(session: AsyncSession, company_id: int) -> dict[str, CustomField]:
    """Every active CustomField definition applicable to an asset belonging
    to `company_id`: GLOBAL (company_id IS NULL) plus this company's own."""
    stmt = select(CustomField).where(
        CustomField.is_active.is_(True),
        or_(CustomField.company_id.is_(None), CustomField.company_id == company_id),
    )
    return {f.field_key: f for f in (await session.execute(stmt)).scalars().all()}


async def any_asset_has_value_for(session: AsyncSession, field_key: str) -> bool:
    """True if at least one asset's custom_fields JSON currently has a value
    stored under this key, across every company -- used to decide whether a
    CustomField's scope may still be changed (AM-05 §22: once any asset has
    a value for it, its scope becomes read-only, so an ADMIN can't silently
    make company-specific data invisible to the company that entered it, or
    vice versa). `custom_fields` is a plain `json` column, not `jsonb`, so
    the containment/key-exists operator needs an explicit cast."""
    stmt = text("SELECT EXISTS (SELECT 1 FROM asset WHERE (custom_fields::jsonb) ? :field_key)")
    result = await session.execute(stmt, {"field_key": field_key})
    return bool(result.scalar())


async def validate_custom_field_values(
    session: AsyncSession, values: dict | None, *, company_id: int, enforce_required: bool = False,
) -> None:
    """Raises ValueError (the same convention app.assets.service already uses for
    other create-time validation problems -- the router turns it into a 422) if
    `values` (an Asset.custom_fields-shaped dict) references a field that isn't
    applicable to `company_id` (unknown, inactive, or scoped to a different
    company), or holds a value of the wrong type for its field's field_type. A
    `None` value for a known field is always allowed (means "not set yet")
    unless `enforce_required` is set and that field is required.

    `enforce_required=True` additionally checks every field applicable to
    `company_id` with `is_required=True` has a non-None value in `values` --
    the caller decides when that check applies (always on create; only when
    `custom_fields` was explicitly part of the request, on update).
    """
    values = values or {}
    defs = await applicable_custom_fields(session, company_id)

    for key, value in values.items():
        field = defs.get(key)
        if field is None:
            raise ValueError(f"unknown, inactive, or not-applicable-to-this-company custom field '{key}'")
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
