"""AM-04: diffs an asset's editable fields before/after a PUT and writes one
AssetFieldChange row per genuinely changed field, in the same session/
transaction as the edit itself (the router commits once, after this runs --
nothing here calls commit, so a later failure in the same request still
rolls everything back together, and a failure in here prevents the edit
from committing at all)."""
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import AssetFieldChange
from app.masters.models import Vendor

# The editable descriptive/procurement scalar fields AssetUpdateIn accepts,
# excluding custom_fields (diffed separately below, per-key).
AUDITED_SCALAR_FIELDS = (
    "legacy_asset_code", "brand", "model", "serial_number", "description",
    "vendor_id", "po_number", "po_date", "invoice_number", "invoice_date",
    "pi_number", "pi_date", "purchase_cost", "tax_percent", "warranty_upto",
)


def _serialize(value) -> str | None:
    if value is None:
        return None
    return str(value)


async def _describe_vendor(session: AsyncSession, vendor_id) -> str | None:
    """A stable ID alone becomes meaningless once the vendor is renamed years
    later -- snapshot the name alongside it, the same reasoning AM-01 already
    applied to asset_event's holder names."""
    if vendor_id is None:
        return None
    vendor = await session.get(Vendor, vendor_id)
    name = vendor.name if vendor is not None else "unknown vendor"
    return f"{name} (#{vendor_id})"


async def record_field_changes(
    session: AsyncSession,
    *,
    asset_id: int,
    actor_id: int,
    before: dict,
    after: dict,
) -> None:
    """`before`/`after` are plain dicts of the same shape (the audited scalar
    field names plus `custom_fields`), taken immediately before and after
    the fields were assigned onto the ORM object. Writes nothing for a field
    whose value didn't change."""
    request_id = str(uuid4())
    rows: list[AssetFieldChange] = []

    for field in AUDITED_SCALAR_FIELDS:
        old, new = before.get(field), after.get(field)
        if old == new:
            continue
        if field == "vendor_id":
            old_str = await _describe_vendor(session, old)
            new_str = await _describe_vendor(session, new)
        else:
            old_str, new_str = _serialize(old), _serialize(new)
        rows.append(AssetFieldChange(
            asset_id=asset_id, field_name=field, old_value=old_str, new_value=new_str,
            actor_id=actor_id, request_id=request_id,
        ))

    old_custom = before.get("custom_fields") or {}
    new_custom = after.get("custom_fields") or {}
    for key in sorted(set(old_custom) | set(new_custom)):
        old, new = old_custom.get(key), new_custom.get(key)
        if old == new:
            continue
        rows.append(AssetFieldChange(
            asset_id=asset_id, field_name=f"custom_fields.{key}",
            old_value=_serialize(old), new_value=_serialize(new),
            actor_id=actor_id, request_id=request_id,
        ))

    for row in rows:
        session.add(row)
