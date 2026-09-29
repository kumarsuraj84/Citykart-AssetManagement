"""AM-07: a controlled, explicit correction of an asset's Category,
Subcategory, and/or Purchase Date -- the three fields deliberately kept out
of `AssetUpdateIn`/`PUT /api/assets/{id}` since AM-02 (see the Asset Field
Policy Matrix). This is NOT a normal edit: it requires a mandatory reason,
never regenerates `asset_code` (the numbering service is never called
here), never touches lifecycle state (`status`/`current_asset_user_id`/
`status_since` -- `apply_event` is never called here either), and every
change it makes is written to `asset_field_change` with `reason` populated
(see `app.assets.audit_service.record_correction_changes`).

Invariants this enforces, each backed by an actual code path elsewhere in
this codebase (see `docs/ai/AM-07_ASSET_CORRECTION_WORKFLOW_REPORT.md` §6
for the full audit):

- Asset Code, Company, Cost Centre, Status, current AssetUser are never
  touched -- this module has no write path to any of them.
- A new Category/Subcategory must exist and be active.
- A Subcategory must belong to the *resulting* Category (new if provided,
  otherwise the asset's current one) -- never left as an invalid pair.
- A corrected Purchase Date can never land in the future (mirrors
  `app.lifecycle.service.apply_event`'s own "event date cannot be in the
  future" rule) and can never land after the asset's earliest recorded
  `asset_event` (mirrors that same function's "event date cannot be before
  the asset's last recorded event" rule, applied in the historical
  direction: a corrected purchase can't retroactively happen *after*
  activity the ledger already recorded against it). No existing
  `asset_event` row is ever modified -- that ledger stays append-only and
  untouched.
"""
from datetime import date, datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.audit_service import record_correction_changes
from app.assets.models import Asset
from app.asset_users.models import AssetUser
from app.lifecycle.models import AssetEvent
from app.masters.models import AssetCategory, AssetSubcategory

# Sentinel distinguishing "this field was not part of the request at all"
# from a real value (including `None`, which for subcategory_id means
# "clear it" -- a legitimate, different instruction).
UNSET = object()

REASON_MAX_LENGTH = 500


async def correct_asset(
    session: AsyncSession,
    asset: Asset,
    actor: AssetUser,
    *,
    category_id=UNSET,
    subcategory_id=UNSET,
    purchase_date_value=UNSET,
    reason: str,
) -> int:
    """Raises ValueError (the same convention every other asset-mutation
    service in this codebase uses -- the router turns it into a 422) for
    any validation failure. Returns the number of `asset_field_change` rows
    written; the caller should treat 0 as impossible by this point (the
    no-op check below already rejects that case), but the audit function
    itself is the actual source of truth for what changed.
    """
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("a reason is required for this correction")
    if len(reason) > REASON_MAX_LENGTH:
        raise ValueError(f"reason must be at most {REASON_MAX_LENGTH} characters")

    if category_id is UNSET and subcategory_id is UNSET and purchase_date_value is UNSET:
        raise ValueError("at least one of category_id, subcategory_id, or purchase_date must be provided")

    # ---- Category ----
    effective_category_id = asset.category_id
    if category_id is not UNSET:
        if category_id is None:
            raise ValueError("category_id cannot be cleared")
        category = await session.get(AssetCategory, category_id)
        if category is None or not category.is_active:
            raise ValueError(f"category {category_id} not found or inactive")
        effective_category_id = category_id

    # ---- Subcategory ----
    effective_subcategory_id = asset.subcategory_id
    if subcategory_id is not UNSET:
        effective_subcategory_id = subcategory_id
    if effective_subcategory_id is not None:
        subcategory = await session.get(AssetSubcategory, effective_subcategory_id)
        if subcategory is None or not subcategory.is_active:
            raise ValueError(f"subcategory {effective_subcategory_id} not found or inactive")
        if subcategory.category_id != effective_category_id:
            if subcategory_id is UNSET:
                # The asset's *existing* subcategory no longer belongs to the
                # newly-requested category -- the caller must explicitly
                # supply a valid replacement or clear it (AM-07 §8), never
                # silently left as an invalid pair.
                raise ValueError(
                    "the asset's current subcategory does not belong to the new category; "
                    "supply a valid subcategory_id for the new category, or set subcategory_id to null"
                )
            raise ValueError("subcategory does not belong to the selected category")

    # ---- Purchase Date ----
    effective_purchase_date = asset.purchase_date
    if purchase_date_value is not UNSET:
        if purchase_date_value is None:
            raise ValueError("purchase_date cannot be cleared")
        if not isinstance(purchase_date_value, date):
            raise ValueError("purchase_date must be a valid date")
        now = datetime.now(timezone.utc)
        if datetime.combine(purchase_date_value, datetime.min.time()).replace(tzinfo=timezone.utc) > now:
            raise ValueError("purchase date cannot be in the future")

        earliest_event_stmt = (
            select(AssetEvent)
            .where(AssetEvent.asset_id == asset.id)
            .order_by(AssetEvent.event_date.asc(), AssetEvent.id.asc())
        )
        earliest_event = (await session.execute(earliest_event_stmt)).scalars().first()
        if earliest_event is not None and purchase_date_value > earliest_event.event_date.date():
            raise ValueError(
                f"purchase date cannot be after the asset's earliest recorded event "
                f"({earliest_event.event_date.date().isoformat()})"
            )
        effective_purchase_date = purchase_date_value

    if (
        effective_category_id == asset.category_id
        and effective_subcategory_id == asset.subcategory_id
        and effective_purchase_date == asset.purchase_date
    ):
        raise ValueError("no changes requested -- every provided value already matches the asset's current data")

    before = {
        "category_id": asset.category_id, "subcategory_id": asset.subcategory_id,
        "purchase_date": asset.purchase_date,
    }

    # Never asset_code/company_id/cost_center_id (trg_asset_no_identity_change
    # would reject those anyway), never status/current_asset_user_id/status_since
    # (apply_event's exclusive domain), never the numbering service.
    asset.category_id = effective_category_id
    asset.subcategory_id = effective_subcategory_id
    asset.purchase_date = effective_purchase_date

    after = {
        "category_id": asset.category_id, "subcategory_id": asset.subcategory_id,
        "purchase_date": asset.purchase_date,
    }

    return await record_correction_changes(
        session, asset_id=asset.id, actor_id=actor.id, reason=reason, before=before, after=after,
    )
