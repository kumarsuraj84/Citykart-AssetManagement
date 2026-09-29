"""AM-04: diffs an asset's editable fields before/after a PUT and writes one
AssetFieldChange row per genuinely changed field, in the same session/
transaction as the edit itself (the router commits once, after this runs --
nothing here calls commit, so a later failure in the same request still
rolls everything back together, and a failure in here prevents the edit
from committing at all).

AM-07: `record_correction_changes` is the equivalent entry point for a
controlled asset correction (category/subcategory/purchase_date -- see
app/assets/correction_service.py), reusing the same `AssetFieldChange`
table and the same before/after-diff shape rather than a parallel audit
system. Deliberately a separate function from `record_field_changes`
(not a shared field list) so ordinary Edit-mode audits are never at risk
of picking up category/subcategory/purchase_date just because
`AssetUpdateIn` might one day grow a field with a matching name."""
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import AssetFieldChange
from app.masters.models import AssetCategory, AssetSubcategory, Vendor

# The editable descriptive/procurement scalar fields AssetUpdateIn accepts,
# excluding custom_fields (diffed separately below, per-key).
AUDITED_SCALAR_FIELDS = (
    "legacy_asset_code", "brand", "model", "serial_number", "barcode", "description",
    "vendor_id", "po_number", "po_date", "invoice_number", "invoice_date",
    "pi_number", "pi_date", "purchase_cost", "tax_percent", "warranty_years",
)
# AM-18: warranty_years is the real input (like purchase_cost/tax_percent
# above); warranty_upto is a derived column (like tax_amount/total_cost,
# neither of which is audited separately either) -- see
# app.assets.service.compute_warranty_upto.


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


async def _describe_category(session: AsyncSession, category_id) -> str | None:
    """AM-07 §16: a correction's audit row must stay readable even after a
    future category rename -- same `"{code} - {name} (#{id})"` snapshot
    pattern as `_describe_vendor`."""
    if category_id is None:
        return None
    category = await session.get(AssetCategory, category_id)
    if category is None:
        return f"unknown category (#{category_id})"
    return f"{category.code} - {category.name} (#{category_id})"


async def _describe_subcategory(session: AsyncSession, subcategory_id) -> str | None:
    if subcategory_id is None:
        return None
    subcategory = await session.get(AssetSubcategory, subcategory_id)
    if subcategory is None:
        return f"unknown subcategory (#{subcategory_id})"
    return f"{subcategory.code} - {subcategory.name} (#{subcategory_id})"


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


# AM-07: the only three fields a controlled correction may ever touch.
# Deliberately its own tuple, never merged with AUDITED_SCALAR_FIELDS.
CORRECTION_FIELDS = ("category_id", "subcategory_id", "purchase_date")


async def record_correction_changes(
    session: AsyncSession,
    *,
    asset_id: int,
    actor_id: int,
    reason: str,
    before: dict,
    after: dict,
) -> int:
    """`before`/`after` are `{"category_id": ..., "subcategory_id": ...,
    "purchase_date": ...}` dicts, taken immediately before and after
    `correction_service.correct_asset` assigns the new values onto the ORM
    object. Writes one `AssetFieldChange` row per genuinely-changed field,
    every row sharing one `request_id` and carrying the mandatory `reason`
    (the field that's always NULL on an ordinary edit's rows, and always
    populated here -- see the module docstring). Returns the number of rows
    written, so the caller can confirm at least one field actually changed
    without re-deriving the diff itself."""
    request_id = str(uuid4())
    rows: list[AssetFieldChange] = []

    for field in CORRECTION_FIELDS:
        old, new = before.get(field), after.get(field)
        if old == new:
            continue
        if field == "category_id":
            old_str, new_str = await _describe_category(session, old), await _describe_category(session, new)
        elif field == "subcategory_id":
            old_str, new_str = await _describe_subcategory(session, old), await _describe_subcategory(session, new)
        else:
            old_str, new_str = _serialize(old), _serialize(new)
        rows.append(AssetFieldChange(
            asset_id=asset_id, field_name=field, old_value=old_str, new_value=new_str,
            actor_id=actor_id, request_id=request_id, reason=reason,
        ))

    for row in rows:
        session.add(row)
    return len(rows)
